import { neon } from "@neondatabase/serverless";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, CURRENCIES } from "../config.js";

const SERVICE = "DEVZIKKY PAY";
const MAX_BODY_BYTES = 1024 * 1024;

function sanitizeLogValue(value, depth = 0) {
  if (typeof value === "string") return redactLogText(value, 1200);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeLogValue(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth >= 3) return "[nested object omitted]";
    return Object.fromEntries(
      Object.entries(value).slice(0, 30).map(([key, item]) => [key, sanitizeLogValue(item, depth + 1)])
    );
  }
  return String(value ?? "");
}

function logger(requestId, level, event, details = {}) {
  const safeDetails = sanitizeLogValue(details);
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    request_id: requestId,
    event,
    ...safeDetails
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}

function sendJson(res, status, data, requestId) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (requestId) res.setHeader("X-Request-ID", requestId);
  res.end(JSON.stringify(data, null, 2));
}

function redactLogText(value, maxLength = 1200) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted-database-url]")
    .replace(/(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/gi, "[redacted-payment-key]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(DATABASE_URL|PAYSTACK_KEY|ADMIN_KEY|API_KEY)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/((?:api|admin)[_-]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function safeLogPath(value) {
  try {
    return new URL(String(value || "/"), "https://local.invalid").pathname.slice(0, 180);
  } catch {
    return String(value || "/").split("?")[0].slice(0, 180);
  }
}

async function readBody(req) {
  if (req.__dzBodyParsed) return req.body || {};
  req.__dzBodyParsed = true;

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    req.rawBody = JSON.stringify(req.body);
    return req.body;
  }

  let raw = "";
  if (typeof req.body === "string") {
    raw = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString("utf8");
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large");
        error.statusCode = 413;
        throw error;
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }

  req.rawBody = raw;
  if (!raw.trim()) {
    req.body = {};
    return req.body;
  }

  try {
    req.body = JSON.parse(raw);
    return req.body;
  } catch {
    const error = new Error("Request body must contain valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

const validEmail = value =>
  typeof value === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) &&
  value.trim().length <= 254;

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function dateAgeDays(dateString) {
  const timestamp = Date.parse(`${dateString}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / 86400000;
}

function allCurrenciesPresent(rates) {
  return CURRENCIES.every(currency =>
    currency.code === "NGN" ||
    (Number.isFinite(Number(rates?.[currency.code])) && Number(rates[currency.code]) > 0)
  );
}

/**
 * Provider response convention:
 *   base=NGN, rates.USD = USD units per 1 NGN.
 *
 * Checkout convention:
 *   ngn_per_unit.USD = NGN required for 1 USD.
 *
 * We retain provider values unchanged in `rates`, and derive `ngn_per_unit`
 * separately for the calculation. Never overwrite source values with inverses.
 */
function normalizeStoredSnapshot(stored) {
  if (stored && stored.provider_rates && stored.ngn_per_unit) {
    return {
      rates: stored.provider_rates,
      ngn_per_unit: stored.ngn_per_unit
    };
  }

  // Backward compatibility for snapshots created by the previous ZIP.
  // Previous versions stored NGN-per-unit values directly in the JSONB column.
  const legacyNgnPerUnit = stored && typeof stored === "object" ? stored : {};
  const rates = {};
  const ngnPerUnit = { NGN: 1 };

  for (const currency of CURRENCIES) {
    if (currency.code === "NGN") continue;
    const oldValue = Number(legacyNgnPerUnit[currency.code]);
    if (Number.isFinite(oldValue) && oldValue > 0) {
      ngnPerUnit[currency.code] = oldValue;
      rates[currency.code] = 1 / oldValue;
    }
  }
  return { rates, ngn_per_unit: ngnPerUnit, legacy: true };
}

async function getRates(db, log) {
  let liveData = null;

  // 1. Try the live provider.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APP_CONFIG.RATE_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(APP_CONFIG.RATE_SOURCE_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Rates API returned HTTP ${response.status}`);

    const data = await response.json();
    if (data.base !== "NGN") throw new Error(`Unexpected rates base: ${data.base || "missing"}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ""))) {
      throw new Error("Rates API returned an invalid date");
    }

    const age = dateAgeDays(data.date);
    if (age > APP_CONFIG.RATE_MAX_AGE_DAYS || age < -1) {
      throw new Error(`Rates API date ${data.date} is stale or in the future`);
    }

    const providerRates = {};
    const ngnPerUnit = { NGN: 1 };

    for (const currency of CURRENCIES) {
      if (currency.code === "NGN") continue;
      const exactProviderValue = Number(data.rates?.[currency.code]);
      if (!Number.isFinite(exactProviderValue) || exactProviderValue <= 0) {
        throw new Error(`Rates API is missing a valid ${currency.code} rate`);
      }
      // This exact raw value is preserved for the public /api/rates response.
      providerRates[currency.code] = exactProviderValue;
      // This inverse is only for converting visitor-entered foreign currency to NGN.
      ngnPerUnit[currency.code] = 1 / exactProviderValue;
    }

    if (!allCurrenciesPresent(providerRates) || !allCurrenciesPresent(ngnPerUnit)) {
      throw new Error("Rates API did not return all configured currencies");
    }

    liveData = {
      rates: providerRates,
      ngn_per_unit: ngnPerUnit,
      rateDate: data.date,
      source: "live",
      missing: []
    };
    log("info", "rates.provider.success", {
      provider: "theratesapi",
      rate_date: data.date,
      currency_count: CURRENCIES.length
    });
  } catch (error) {
    log("warn", "rates.provider.failed", {
      provider: "theratesapi",
      message: error.message
    });
  }

  // 2. Return live values even if writing the snapshot fails.
  if (liveData) {
    try {
      const snapshot = {
        format_version: 2,
        provider_rates: liveData.rates,
        ngn_per_unit: liveData.ngn_per_unit
      };
      await db`
        INSERT INTO rate_snapshots(rate_date, source_url, rates)
        VALUES(${liveData.rateDate}, ${APP_CONFIG.RATE_SOURCE_URL}, ${JSON.stringify(snapshot)}::jsonb)
        ON CONFLICT(rate_date, source_url)
        DO UPDATE SET rates = EXCLUDED.rates, created_at = NOW()
      `;
      log("info", "rates.snapshot.saved", { rate_date: liveData.rateDate });
    } catch (error) {
      log("error", "rates.snapshot.save_failed", {
        message: error.message
      });
    }
    return liveData;
  }

  // 3. Use the last valid stored snapshot.
  try {
    const cached = await db`
      SELECT rate_date, rates
      FROM rate_snapshots
      ORDER BY rate_date DESC, created_at DESC
      LIMIT 1
    `;

    if (cached.length) {
      const date = String(cached[0].rate_date).slice(0, 10);
      const age = dateAgeDays(date);
      const normalized = normalizeStoredSnapshot(cached[0].rates);

      if (age <= APP_CONFIG.RATE_MAX_AGE_DAYS && age >= -1 &&
          allCurrenciesPresent(normalized.ngn_per_unit)) {
        log("warn", "rates.fallback.cached", {
          rate_date: date,
          legacy_snapshot: Boolean(normalized.legacy)
        });
        return {
          ...normalized,
          rateDate: date,
          source: normalized.legacy ? "cached_legacy" : "cached",
          missing: []
        };
      }

      log("warn", "rates.cached_snapshot.unusable", {
        rate_date: date,
        age_days: Number.isFinite(age) ? Number(age.toFixed(2)) : null
      });
    }
  } catch (error) {
    log("error", "rates.cache.read_failed", { message: error.message });
  }

  // 4. Last-resort static backup. It contains 33 currencies from 2026-11-06.
  const ngnPerUnit = { ...APP_CONFIG.STATIC_BACKUP_NGN_PER_UNIT };
  const providerRates = {};
  for (const [code, value] of Object.entries(ngnPerUnit)) {
    if (code !== "NGN" && Number(value) > 0) providerRates[code] = 1 / Number(value);
  }

  const missing = CURRENCIES
    .filter(currency => !Number.isFinite(Number(ngnPerUnit[currency.code])) ||
      Number(ngnPerUnit[currency.code]) <= 0)
    .map(currency => currency.code);

  log("warn", "rates.fallback.static_backup", {
    rate_date: APP_CONFIG.STATIC_BACKUP_DATE,
    available_currency_count: Object.keys(ngnPerUnit).length,
    missing_currencies: missing
  });

  return {
    rates: providerRates,
    ngn_per_unit: ngnPerUnit,
    rateDate: APP_CONFIG.STATIC_BACKUP_DATE,
    source: "static_backup",
    missing
  };
}

async function safeLazyCleanup(db, log) {
  try {
    const deleted = await db`
      WITH claim AS (
        UPDATE maintenance_state
        SET last_run_at = NOW()
        WHERE task = 'transaction_retention'
          AND (last_run_at IS NULL OR last_run_at < NOW() - INTERVAL '24 hours')
        RETURNING task
      )
      DELETE FROM transactions
      WHERE created_at < NOW() - (${APP_CONFIG.RETENTION_YEARS}::int * INTERVAL '1 year')
        AND EXISTS (SELECT 1 FROM claim)
      RETURNING id
    `;

    if (deleted.length) {
      log("info", "maintenance.retention.deleted", {
        deleted_count: deleted.length,
        retention_years: APP_CONFIG.RETENTION_YEARS
      });
    }
  } catch (error) {
    // Maintenance must never make unrelated endpoints (including checkout/login) fail.
    log("error", "maintenance.retention.failed", {
      message: error.message,
      hint: "Check schema.sql tables maintenance_state and transactions"
    });
  }
}

function createAdminSession() {
  if (!process.env.ADMIN_KEY) throw new Error("ADMIN_KEY is not configured");
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url");
  const signature = createHmac("sha256", process.env.ADMIN_KEY).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasAdminSession(req) {
  if (!process.env.ADMIN_KEY) return false;
  const cookieHeader = req.headers.cookie || "";
  const token = cookieHeader.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("dz_admin="))
    ?.slice("dz_admin=".length);

  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = createHmac("sha256", process.env.ADMIN_KEY)
    .update(payload)
    .digest("base64url");

  if (!safeEqual(signature, expected)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function hasAutomationKey(req) {
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  return safeEqual(supplied, process.env.API_KEY || "");
}

async function paystackRequest(path, payload, method, log) {
  if (!process.env.PAYSTACK_KEY) throw new Error("PAYSTACK_KEY is not configured");

  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
      "Content-Type": "application/json"
    },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    const message = data.message || `Paystack returned HTTP ${response.status}`;
    log("error", "paystack.request.failed", {
      endpoint: path.split("?")[0],
      method,
      http_status: response.status,
      message
    });
    throw new Error(message);
  }

  log("info", "paystack.request.succeeded", {
    endpoint: path.split("?")[0],
    method,
    http_status: response.status
  });
  return data.data;
}

async function verifyPayment(db, reference, log) {
  const existing = await db`
    SELECT reference, amount_minor, currency
    FROM transactions
    WHERE reference = ${reference}
    LIMIT 1
  `;
  if (!existing.length) {
    log("warn", "payment.verify.unknown_reference");
    const error = new Error("Payment reference was not found");
    error.statusCode = 404;
    throw error;
  }

  const data = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    null,
    "GET",
    log
  );

  const expectedAmount = Number(existing[0].amount_minor);
  const receivedAmount = Number(data.amount);
  if (data.reference !== reference || data.currency !== "NGN" ||
      !Number.isFinite(receivedAmount) || receivedAmount !== expectedAmount) {
    log("error", "payment.verify.mismatch", {
      reference,
      provider_currency: data.currency,
      expected_currency: existing[0].currency,
      amount_match: receivedAmount === expectedAmount
    });
    throw new Error("Paystack verification details did not match the stored transaction");
  }

  const status = data.status === "success"
    ? "success"
    : data.status === "failed"
      ? "failed"
      : "pending";

  await db`
    UPDATE transactions
    SET status = ${status},
        paystack_status = ${data.status},
        paid_at = CASE
          WHEN ${status} = 'success' THEN COALESCE(paid_at, NOW())
          ELSE paid_at
        END,
        updated_at = NOW()
    WHERE reference = ${reference}
  `;

  log(status === "success" ? "info" : "warn", "payment.verify.completed", {
    reference,
    payment_status: status
  });

  return {
    status,
    reference,
    amount: data.amount,
    currency: data.currency
  };
}

async function handleWebhook(req, db, log) {
  const signature = req.headers["x-paystack-signature"];
  if (!signature || !process.env.PAYSTACK_KEY) {
    log("warn", "paystack.webhook.missing_signature_or_key");
    return false;
  }

  const rawBody = req.rawBody || "";
  const expected = createHmac("sha512", process.env.PAYSTACK_KEY)
    .update(rawBody)
    .digest("hex");

  if (!safeEqual(signature, expected)) {
    log("error", "paystack.webhook.invalid_signature");
    return false;
  }

  const event = req.body || {};
  log("info", "paystack.webhook.received", {
    event: String(event.event || "unknown")
  });

  if (event.event === "charge.success" && event.data?.reference) {
    await verifyPayment(db, event.data.reference, log);
  }
  return true;
}

async function healthCheck(requestId, res, log) {
  const checks = {
    database: "not_checked",
    schema: "not_checked",
    paystack_key: Boolean(process.env.PAYSTACK_KEY),
    admin_key: Boolean(process.env.ADMIN_KEY),
    api_key: Boolean(process.env.API_KEY),
    app_url: Boolean(process.env.APP_URL)
  };

  let databaseError = null;
  try {
    const db = getSql();
    const result = await db`
      SELECT
        to_regclass('public.transactions') IS NOT NULL AS transactions,
        to_regclass('public.rate_snapshots') IS NOT NULL AS rate_snapshots,
        to_regclass('public.maintenance_state') IS NOT NULL AS maintenance_state
    `;
    checks.database = "ok";
    checks.schema = result[0] &&
      result[0].transactions &&
      result[0].rate_snapshots &&
      result[0].maintenance_state
      ? "ok"
      : "incomplete";
    if (checks.schema === "incomplete") {
      databaseError = "One or more required tables are missing";
      log("error", "health.schema.incomplete", { tables: result[0] });
    } else {
      log("info", "health.database.ready");
    }
  } catch (error) {
    checks.database = "error";
    checks.schema = "unknown";
    databaseError = "Database connection check failed";
    log("error", "health.database.failed", {
      message: redactLogText(error.message),
      stack: redactLogText(error.stack)
    });
  }

  const missingEnvironment = ["PAYSTACK_KEY", "ADMIN_KEY", "API_KEY", "APP_URL"]
    .filter(name => !process.env[name]);
  const requiredOk = checks.database === "ok" &&
    checks.schema === "ok" &&
    missingEnvironment.length === 0;

  if (missingEnvironment.length) {
    log("error", "health.environment.incomplete", {
      missing_variables: missingEnvironment
    });
  }

  log(requiredOk ? "info" : "warn", "health.check.completed", {
    ready: requiredOk,
    database: checks.database,
    schema: checks.schema
  });

  return sendJson(res, requiredOk ? 200 : 503, {
    ok: requiredOk,
    status: requiredOk ? "healthy" : "degraded",
    service: SERVICE,
    timestamp: new Date().toISOString(),
    checks,
    ...(databaseError ? { database_message: databaseError } : {}),
    note: "This endpoint reports configuration presence, not the validity of secret values."
  }, requestId);
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const startedAt = Date.now();
  const requestId = req.headers["x-vercel-id"] || randomUUID();
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  const path = url.pathname
    .replace(/^\/api\/?/, "")
    .replace(/^\/+|\/+$/g, "");

  const log = (level, event, details = {}) =>
    logger(requestId, level, event, {
      method: req.method,
      route: path || "/",
      ...details
    });

  log("info", "request.started");

  try {
    // Liveness endpoint: no database dependency.
    if ((path === "ping" || path === "") && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        status: "alive",
        service: SERVICE,
        timestamp: new Date().toISOString()
      }, requestId);
    }

    // Readiness endpoint: checks Neon connection, schema, and required env presence.
    if (path === "health" && req.method === "GET") {
      return await healthCheck(requestId, res, log);
    }

    // Admin authentication does not need PostgreSQL. Handle it before creating
    // a database client so the administrator can still sign in during a DB outage.
    if (path === "admin/login" && req.method === "POST") {
      const body = await readBody(req);
      const supplied = typeof body.key === "string" ? body.key : "";
      const expected = process.env.ADMIN_KEY || "";

      if (!expected) {
        log("error", "admin.login.configuration_error", {
          missing_environment_variable: "ADMIN_KEY"
        });
        return sendJson(res, 503, { error: "Admin login is not configured" }, requestId);
      }

      if (!safeEqual(supplied, expected)) {
        log("warn", "admin.login.failed", { reason: "invalid_key" });
        return sendJson(res, 401, { error: "Invalid admin key" }, requestId);
      }

      const token = createAdminSession();
      res.setHeader(
        "Set-Cookie",
        `dz_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`
      );

      log("info", "admin.login.succeeded");
      return sendJson(res, 200, { ok: true, message: "Admin session created" }, requestId);
    }

    if (path === "admin/logout" && req.method === "POST") {
      res.setHeader(
        "Set-Cookie",
        "dz_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      );
      log("info", "admin.logout");
      return sendJson(res, 200, { ok: true }, requestId);
    }

    // Browser errors are reported without request bodies, customer data,
    // cookies, query strings, or credentials. This endpoint never writes to DB.
    if (path === "client-error") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, 405, { error: "Method not allowed" }, requestId);
      }

      const origin = req.headers.origin;
      if (origin && origin !== url.origin) {
        log("warn", "client.error.origin_rejected");
        return sendJson(res, 403, { error: "Origin not allowed" }, requestId);
      }

      const body = await readBody(req);
      if (String(req.rawBody || "").length > 4096) {
        return sendJson(res, 413, { error: "Error report is too large" }, requestId);
      }

      const allowedTypes = new Set([
        "window.error",
        "resource.error",
        "unhandledrejection",
        "api.network.error",
        "api.response.error"
      ]);
      const type = allowedTypes.has(body.type) ? body.type : "client.error";
      const message = redactLogText(body.message || "Unspecified browser error", 320);
      const page = safeLogPath(body.page || "/");
      const filename = safeLogPath(body.filename || "");
      const line = Math.max(0, Math.min(10000000, Number(body.line) || 0));
      const column = Math.max(0, Math.min(10000000, Number(body.column) || 0));

      log("error", "client.error.reported", {
        client_error_type: type,
        message,
        page,
        filename,
        line,
        column
      });
      return sendJson(res, 202, { ok: true, request_id: requestId }, requestId);
    }

    // Payment creation remains disabled until merchant eligibility, account
    // authority and customer-facing obligations have been confirmed against
    // the payment provider's current terms. Verification/webhooks remain live.
    if ((path === "pay/initialize" || path === "automation/initialize") && req.method === "POST") {
      log("warn", "payment.initialization.paused", {
        provider: "paystack",
        reason: "merchant_eligibility_and_account_authority_review"
      });
      return sendJson(res, 503, {
        error: "New payment initialization is currently paused.",
        code: "PAYMENTS_PAUSED",
        message: "Existing references may still be verified. No new payment link was created."
      }, requestId);
    }

    const db = getSql();

    // Maintenance is best-effort and never blocks unrelated API work.
    await safeLazyCleanup(db, log);

    if ((path === "rates" || path === "rate") && req.method === "GET") {
      const result = await getRates(db, log);

      // Public API contract: expose provider-direction rates only, sorted by code.
      // NGN is the base currency and is therefore represented by `base`, not
      // duplicated inside `rates`. The inverse map remains server-side for checkout.
      const sortedRates = Object.fromEntries(
        Object.entries(result.rates)
          .filter(([code, value]) =>
            code !== "NGN" && Number.isFinite(Number(value)) && Number(value) > 0
          )
          .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      );

      const payload = {
        base: "NGN",
        source: result.source,
        ...(result.source === "live" ? {} : { date: result.rateDate }),
        rates: sortedRates
      };

      log("info", "rates.response.completed", {
        source: result.source,
        currency_count: Object.keys(sortedRates).length,
        includes_snapshot_date: result.source !== "live"
      });

      return sendJson(res, 200, payload, requestId);
    }

    if (path === "webhook" && req.method === "POST") {
      await readBody(req);
      const accepted = await handleWebhook(req, db, log);
      return sendJson(res, accepted ? 200 : 401, { received: accepted }, requestId);
    }

    if (path === "pay/verify" && req.method === "GET") {
      const reference = url.searchParams.get("reference") || url.searchParams.get("trxref");
      if (!reference || reference.length > 128 || !/^[A-Za-z0-9_-]+$/.test(reference)) {
        log("warn", "payment.verify.invalid_reference");
        return sendJson(res, 400, { error: "A valid payment reference is required" }, requestId);
      }
      const result = await verifyPayment(db, reference, log);
      return sendJson(res, 200, result, requestId);
    }

    if (path === "stats" && req.method === "GET") {
      const [totals, byCurrency, byType, recent] = await Promise.all([
        db`
          SELECT COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'success'), 0)::numeric / 100 AS total_ngn
          FROM transactions
        `,
        db`
          SELECT original_currency AS currency, COUNT(*)::int AS count,
            COALESCE(SUM(original_amount), 0)::numeric AS total
          FROM transactions
          WHERE status = 'success'
          GROUP BY original_currency
          ORDER BY count DESC
        `,
        db`
          SELECT type, COUNT(*)::int AS count,
            COALESCE(SUM(amount_minor), 0)::numeric / 100 AS total_ngn
          FROM transactions
          WHERE status = 'success'
          GROUP BY type
        `,
        db`
          SELECT reference, amount_minor::numeric / 100 AS amount_ngn,
            type, created_at
          FROM transactions
          WHERE status = 'success'
          ORDER BY paid_at DESC
          LIMIT 20
        `
      ]);

      log("info", "statistics.generated", {
        successful_transactions: Number(totals[0]?.successful || 0),
        currency_groups: byCurrency.length
      });
      return sendJson(res, 200, {
        totals: totals[0],
        by_currency: byCurrency,
        by_type: byType,
        recent
      }, requestId);
    }

    if (path.startsWith("admin/")) {
      if (!hasAdminSession(req)) {
        log("warn", "admin.authorization.denied");
        return sendJson(res, 401, { error: "Admin authentication required" }, requestId);
      }

      if (path === "admin/transactions" && req.method === "GET") {
        const rows = await db`
          SELECT id, reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, source, status,
            created_at, paid_at
          FROM transactions
          ORDER BY created_at DESC
          LIMIT 500
        `;
        log("info", "admin.transactions.loaded", { count: rows.length });
        return sendJson(res, 200, { transactions: rows }, requestId);
      }

      if (path === "admin/export" && req.method === "GET") {
        const rows = await db`
          SELECT reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, source, status,
            created_at, paid_at
          FROM transactions
          ORDER BY created_at DESC
        `;

        const columns = Object.keys(rows[0] || { reference: "" });
        const csv = [
          columns.join(","),
          ...rows.map(row => columns.map(column =>
            `"${String(row[column] ?? "").replace(/"/g, '""')}"`
          ).join(","))
        ].join("\n");

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="devzikky-pay-transactions.csv"');
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Request-ID", requestId);
        log("info", "admin.export.completed", { rows: rows.length });
        return res.end(csv);
      }
    }

    log("warn", "request.route_not_found");
    return sendJson(res, 404, { error: "Route not found" }, requestId);
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    log(status >= 500 ? "error" : "warn", "request.failed", {
      status,
      error_name: error.name || "Error",
      message: redactLogText(error.message || "Unknown error"),
      stack: status >= 500 ? redactLogText(error.stack) : undefined
    });
    return sendJson(res, status, {
      error: status >= 500 ? "Server error. Check Vercel function logs." : error.message,
      request_id: requestId
    }, requestId);
  } finally {
    log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      "request.completed", {
        status: res.statusCode || 200,
        duration_ms: Date.now() - startedAt
      });
  }
}
