import { neon } from "@neondatabase/serverless";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, CURRENCIES } from "../config.js";

const SERVICE = "DEVZIKKY PAY";
const MAX_BODY_BYTES = 1024 * 1024;

function logger(requestId, level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    request_id: requestId,
    event,
    ...details
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

function parseWholeAmount(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, code: "INVALID_AMOUNT" };
    if (!Number.isSafeInteger(value)) {
      return { ok: false, code: Number.isInteger(value) ? "AMOUNT_OUT_OF_SAFE_RANGE" : "AMOUNT_WHOLE_NUMBER_REQUIRED" };
    }
    return value > 0 ? { ok: true, value } : { ok: false, code: "INVALID_AMOUNT" };
  }

  if (typeof value !== "string") return { ok: false, code: "INVALID_AMOUNT" };
  const input = value.trim();
  if (!input) return { ok: false, code: "INVALID_AMOUNT" };

  if (/^\d+$/.test(input)) {
    const amount = Number(input);
    return Number.isSafeInteger(amount) && amount > 0
      ? { ok: true, value: amount }
      : { ok: false, code: "AMOUNT_OUT_OF_SAFE_RANGE" };
  }

  if (/^\d{1,3}(?:,\d{3})+$/.test(input)) {
    const amount = Number(input.replace(/,/g, ""));
    return Number.isSafeInteger(amount) && amount > 0
      ? { ok: true, value: amount }
      : { ok: false, code: "AMOUNT_OUT_OF_SAFE_RANGE" };
  }

  if (/^[+-]?[\d,]+\.\d+$/.test(input)) {
    return { ok: false, code: "AMOUNT_WHOLE_NUMBER_REQUIRED" };
  }
  return { ok: false, code: "INVALID_AMOUNT_FORMAT" };
}

function paymentAmountError(code, currency = "NGN") {
  const messages = {
    INVALID_AMOUNT: "Enter a valid amount greater than zero.",
    INVALID_AMOUNT_FORMAT: "Use digits only. Thousands separators must be correctly grouped, for example 5,000.",
    AMOUNT_WHOLE_NUMBER_REQUIRED: "Only whole-number amounts are accepted. Decimal amounts are not allowed.",
    AMOUNT_OUT_OF_SAFE_RANGE: "The amount is too large or outside the supported numeric range.",
    AMOUNT_BELOW_MINIMUM: `The minimum payment is NGN ${APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")}.`,
    AMOUNT_ABOVE_MAXIMUM: `The maximum payment is NGN ${APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")}.`,
    AMOUNT_OUT_OF_RANGE: `The converted amount must be between NGN ${APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")} and NGN ${APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")}.`
  };
  return {
    success: false,
    error: {
      code,
      message: messages[code] || "The payment amount is invalid.",
      currency,
      whole_numbers_only: true,
      minimum_amount_ngn: APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN,
      maximum_amount_ngn: APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN
    }
  };
}

function classifyNgnMinorAmount(amountNgn) {
  if (!Number.isFinite(amountNgn)) return "INVALID_AMOUNT";
  const amountMinor = Math.round(amountNgn * 100);
  const minMinor = Math.round(APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN * 100);
  const maxMinor = Math.round(APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN * 100);
  if (!Number.isSafeInteger(amountMinor)) return "AMOUNT_OUT_OF_SAFE_RANGE";
  if (amountMinor < minMinor) return "AMOUNT_BELOW_MINIMUM";
  if (amountMinor > maxMinor) return "AMOUNT_ABOVE_MAXIMUM";
  return null;
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

function makeReference() {
  return "DZP-" + Date.now().toString(36).toUpperCase() + "-" +
    randomBytes(5).toString("hex").toUpperCase();
}

function dateAgeDays(dateString) {
  const timestamp = Date.parse(`${dateString}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / 86400000;
}

// Transaction timestamps remain TIMESTAMPTZ in Neon. Only user-facing date
// inputs/outputs use DD/MM/YYYY; SQL filters are normalised to ISO dates.
function parseCalendarDate(value) {
  const input = String(value ?? "").trim();
  let day, month, year;

  // Preferred public format: DD/MM/YYYY.
  let match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    // Keep ISO date support for existing API callers during migration.
    match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }

  if (!Number.isInteger(year) || year < 1970 || year > 9999 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 31) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoDateToDmy(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? "");
}

function currentLagosIsoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTimestampLagos(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}:${values.second}`;
}

function exportLabel(value, kind) {
  const labels = {
    type: { donation: "Donation", service: "Service payment", transaction: "API transaction" },
    source: { website: "Website", api: "API" },
    status: { success: "Successful", pending: "Pending", failed: "Failed", reversed: "Reversed" }
  };
  return labels[kind]?.[String(value ?? "").toLowerCase()] || String(value ?? "");
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
  // Existing three-year retention policy. Never delete recent payment history.
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
    log("error", "maintenance.retention.failed", {
      message: error.message,
      hint: "Check schema.sql tables maintenance_state and transactions"
    });
  }

  // Reconcile old pending transactions against Paystack. Do not delete them.
  try {
    await db`
      INSERT INTO maintenance_state(task, last_run_at)
      VALUES ('pending_reconciliation', NULL)
      ON CONFLICT (task) DO NOTHING
    `;
    const claim = await db`
      UPDATE maintenance_state
      SET last_run_at = NOW()
      WHERE task = 'pending_reconciliation'
        AND (last_run_at IS NULL OR last_run_at <
          NOW() - (${APP_CONFIG.PENDING_CLEANUP_INTERVAL_MINUTES}::int * INTERVAL '1 minute'))
      RETURNING task
    `;
    if (!claim.length) return;

    const stale = await db`
      SELECT reference
      FROM transactions
      WHERE status = 'pending'
        AND created_at < NOW() -
          (${APP_CONFIG.PENDING_PAYMENT_MAX_AGE_MINUTES}::int * INTERVAL '1 minute')
      ORDER BY created_at ASC
      LIMIT ${APP_CONFIG.PENDING_CLEANUP_BATCH_SIZE}
    `;

    let checked = 0;
    let confirmed = 0;
    await Promise.all(stale.map(async row => {
      try {
        const result = await verifyPayment(db, row.reference, log);
        checked += 1;
        if (result.status === "success" || result.status === "failed") confirmed += 1;
      } catch (error) {
        // A timeout/provider error is not proof of failure. Keep pending for retry.
        log("warn", "maintenance.pending_reconciliation.deferred", {
          reference: row.reference,
          message: error.message
        });
      }
    }));
    if (stale.length) {
      log("info", "maintenance.pending_reconciliation.completed", {
        eligible_age_minutes: APP_CONFIG.PENDING_PAYMENT_MAX_AGE_MINUTES,
        batch_size: stale.length,
        checked,
        resolved: confirmed
      });
    }
  } catch (error) {
    log("error", "maintenance.pending_reconciliation.failed", {
      message: error.message,
      hint: "Check maintenance_state and pending transaction schema"
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

// Runtime Logs has its own cookie/session namespace while deliberately reusing
// ADMIN_KEY as the credential, as requested. Domain separation prevents a
// dz_admin token from being accepted as a dz_logs token.
function logsSessionSigningKey() {
  if (!process.env.ADMIN_KEY) throw new Error("ADMIN_KEY is not configured");
  return createHmac("sha256", process.env.ADMIN_KEY)
    .update("DEVZIKKY PAY Runtime Logs session v1")
    .digest();
}

function createLogsSession() {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ expiresAt, scope: "runtime-logs" })).toString("base64url");
  const signature = createHmac("sha256", logsSessionSigningKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasLogsSession(req) {
  if (!process.env.ADMIN_KEY) return false;
  const token = String(req.headers.cookie || "").split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("dz_logs="))
    ?.slice("dz_logs=".length);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", logsSessionSigningKey()).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.scope === "runtime-logs" && Number(session.expiresAt) > Date.now();
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


// Vercel runtime-log responses may be JSON arrays or newline-delimited JSON.
// Never send the Vercel access token or raw upstream error body to the browser.
let vercelLogsCache = null;
let vercelLogsCacheUntil = 0;

function redactLogText(value, maxLength = 6000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/\b(VERCEL_ACCESS_TOKEN|ADMIN_KEY|API_KEY|PAYSTACK_KEY|DATABASE_URL)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/([\"']?(?:authorization|access[_-]?token|refresh[_-]?token|secret|password|admin[_-]?key|api[_-]?key|paystack[_-]?key|database[_-]?url)[\"']?\s*[:=]\s*[\"']?)[^\"'\s,;}]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .slice(0, maxLength);
}

function safeRuntimePath(value) {
  const raw = String(value ?? "");
  // Query strings can contain payment references, email addresses, or tokens.
  // Keep the pathname only; never expose query parameter values in the Logs UI.
  return redactLogText(raw.split(/[?#]/, 1)[0], 500);
}

function parseRuntimeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      return numeric > 0 && numeric < 100000000000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeVercelRuntimeLog(entry, deployment) {
  const timestampMs = parseRuntimeTimestamp(
    entry?.timestampInMs ?? entry?.timestamp ?? entry?.createdAt ?? entry?.created
  );
  const attributes = entry?.attributes && typeof entry.attributes === "object"
    ? entry.attributes : {};
  const rawStatus = entry?.responseStatusCode ?? entry?.statusCode ?? entry?.httpStatus ??
    attributes.responseStatusCode ?? attributes.statusCode ?? attributes.httpStatus;
  const status = Number(rawStatus) || null;
  let level = String(entry?.level || "info").toLowerCase();
  if (level === "fatal") level = "error";
  if (level === "warn") level = "warning";
  if (level === "trace") level = "debug";
  if (!("debug info warning error".split(" ").includes(level))) {
    level = status >= 500 ? "error" : status >= 400 ? "warning" : "info";
  }
  if (status >= 500 && level === "info") level = "error";
  else if (status >= 400 && level === "info") level = "warning";

  const deploymentId = String(entry?.deploymentId || deployment.uid);
  return {
    timestamp_ms: timestampMs || null,
    level,
    message: redactLogText(entry?.message || entry?.text || "Runtime event", 6000),
    domain: redactLogText(entry?.domain || entry?.host || "", 200),
    method: redactLogText(entry?.requestMethod || entry?.method || "", 16),
    path: safeRuntimePath(entry?.requestPath || entry?.path || ""),
    status_code: status,
    request_id: redactLogText(entry?.requestId || "", 160),
    source: redactLogText(entry?.source || "function", 80),
    service: redactLogText(entry?.service || "", 120),
    region: redactLogText(entry?.region || "", 80),
    runtime: redactLogText(entry?.runtime || "", 80),
    stream: redactLogText(entry?.stream || "", 40),
    branch: redactLogText(entry?.branch || "", 160),
    trace_id: redactLogText(entry?.traceId || "", 160),
    span_id: redactLogText(entry?.spanId || "", 160),
    is_system_log: entry?.isSystemLog === true,
    environment: redactLogText(entry?.environment || "", 40),
    row_id: redactLogText(entry?.rowId || entry?.id || "", 160),
    message_truncated: entry?.truncated === true || entry?.messageTruncated === true,
    deployment_id: redactLogText(deploymentId, 160),
    deployment_url: redactLogText(deployment.url || "", 250)
  };
}

async function fetchVercelApi(url, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = 20000
  } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_ACCESS_TOKEN}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Vercel API returned HTTP ${response.status}`);
      error.upstreamStatus = response.status;
      throw error;
    }
    return text;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Vercel Observability API request timed out");
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getVercelRuntimeLogs(requestedLimit, forceRefresh, requestId, log) {
  const token = process.env.VERCEL_ACCESS_TOKEN || "";
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const teamId = process.env.VERCEL_TEAM_ID || "";
  if (!token || !projectId || !teamId) {
    log("error", "admin.logs.configuration_missing", {
      missing: [
        ...(!token ? ["VERCEL_ACCESS_TOKEN"] : []),
        ...(!projectId ? ["VERCEL_PROJECT_ID"] : []),
        ...(!teamId ? ["VERCEL_TEAM_ID"] : [])
      ]
    });
    return sendJson(requestId.res, 503, {
      error: "Vercel Logs are not configured. Set VERCEL_ACCESS_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID in the server environment."
    }, requestId.id);
  }

  const limit = Math.max(1, Math.min(100, Number.parseInt(requestedLimit, 10) || 100));
  const now = Date.now();
  if (!forceRefresh && vercelLogsCache && now < vercelLogsCacheUntil) {
    const cachedLogs = vercelLogsCache.logs.slice(0, limit);
    const cached = { ...vercelLogsCache, count: cachedLogs.length, logs: cachedLogs, cache: "warm-instance" };
    log("info", "admin.logs.cache_hit", { count: cached.logs.length });
    return sendJson(requestId.res, 200, cached, requestId.id);
  }

  const historyHours = 1;
  const queryEnd = new Date(now);
  const queryStart = new Date(now - historyHours * 60 * 60 * 1000);

  try {
    // Keep the deployment scope selected for this monitor: newest production deployment.
    const deploymentUrl = new URL("https://api.vercel.com/v7/deployments");
    deploymentUrl.searchParams.set("projectId", projectId);
    deploymentUrl.searchParams.set("target", "production");
    deploymentUrl.searchParams.set("limit", "1");
    deploymentUrl.searchParams.set("teamId", teamId);

    const deploymentsText = await fetchVercelApi(deploymentUrl.toString());
    const deploymentPayload = JSON.parse(deploymentsText);
    const deployments = (Array.isArray(deploymentPayload.deployments) ? deploymentPayload.deployments : [])
      .filter(item => item && (item.uid || item.id) && (!item.target || item.target === "production"))
      .sort((a, b) =>
        parseRuntimeTimestamp(b.createdAt ?? b.created) -
        parseRuntimeTimestamp(a.createdAt ?? a.created)
      )
      .slice(0, 1)
      .map(item => ({
        uid: String(item.uid || item.id),
        url: String(item.url || ""),
        created_at: parseRuntimeTimestamp(item.createdAt ?? item.created),
        state: String(item.readyState || item.state || "unknown"),
        target: String(item.target || "production")
      }));

    if (!deployments.length) {
      const empty = {
        ok: true,
        source: "vercel-observability-events",
        fetched_at: new Date().toISOString(),
        history_hours: historyHours,
        since: queryStart.toISOString(),
        until: queryEnd.toISOString(),
        limit,
        count: 0,
        deployments_scanned: 0,
        has_more: false,
        partial: false,
        logs: []
      };
      vercelLogsCache = empty;
      vercelLogsCacheUntil = Date.now() + 10000;
      return sendJson(requestId.res, 200, empty, requestId.id);
    }

    const deployment = deployments[0];
    const eventsUrl = new URL("https://api.vercel.com/v1/observability/events");
    eventsUrl.searchParams.set("teamId", teamId);
    const quoteFilterValue = value => JSON.stringify(String(value));
    const filter = [
      `deploymentId:${quoteFilterValue(deployment.uid)}`,
      `environment:${quoteFilterValue("production")}`
    ].map(clause => `(${clause})`).join(" AND ");
    const queryBody = {
      event: "vercel.log",
      scope: {
        ownerId: teamId,
        projectIds: [projectId]
      },
      timeRange: {
        start: queryStart.toISOString(),
        end: queryEnd.toISOString()
      },
      filter,
      select: [
        "projectId", "requestId", "branch", "deploymentId", "domain",
        "environment", "requestPath", "requestMethod", "source", "service",
        "isSystemLog", "region", "runtime", "level", "message", "stream",
        "traceId", "spanId", "attributes", "truncated"
      ],
      order: "desc",
      limit
    };

    // This is the same bounded Observability Events query used by Vercel's own CLI.
    // Unlike /runtime-logs, it supports a historical time range and returns a finite page.
    const eventsText = await fetchVercelApi(eventsUrl.toString(), {
      method: "POST",
      body: queryBody,
      headers: { "x-vercel-observability-query-reason": "cli/logs-runtime" },
      timeoutMs: 20000
    });
    let eventsPayload;
    try {
      eventsPayload = JSON.parse(eventsText);
    } catch {
      throw new Error("Vercel Observability API returned invalid JSON");
    }
    if (!eventsPayload || !Array.isArray(eventsPayload.events)) {
      throw new Error("Vercel Observability API returned an unexpected events response");
    }

    const rawRows = eventsPayload.events.slice(0, limit);
    const normalized = rawRows
      .map(row => normalizeVercelRuntimeLog(row, deployment))
      .filter(row => row.timestamp_ms &&
        row.timestamp_ms >= queryStart.getTime() &&
        row.timestamp_ms <= queryEnd.getTime() &&
        row.deployment_id === deployment.uid &&
        (!row.environment || row.environment === "production"))
      .sort((a, b) => Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0));
    const seen = new Set();
    const unique = normalized.filter(row => {
      const identity = row.row_id || `${row.deployment_id}:${row.timestamp_ms}:${row.request_id}:${row.path}:${row.message}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, limit);

    const payload = {
      ok: true,
      source: "vercel-observability-events",
      fetched_at: new Date().toISOString(),
      timezone: "Vercel timestamps are UTC; display in Africa/Lagos",
      history_hours: historyHours,
      since: queryStart.toISOString(),
      until: queryEnd.toISOString(),
      limit,
      count: unique.length,
      deployments_scanned: deployments.length,
      deployments: deployments.map(({ uid, url, created_at, state, target }) => ({
        id: uid, url, created_at, state, target
      })),
      has_more: eventsPayload.pagination?.hasMore === true,
      partial: false,
      logs: unique
    };
    vercelLogsCache = payload;
    vercelLogsCacheUntil = Date.now() + 15000;
    log("info", "admin.logs.fetch_completed", {
      count: payload.count,
      deployments_scanned: payload.deployments_scanned,
      history_hours: historyHours,
      has_more: payload.has_more
    });
    return sendJson(requestId.res, 200, payload, requestId.id);
  } catch (error) {
    log("error", "admin.logs.fetch_failed", {
      upstream_status: error.upstreamStatus || null,
      error_name: error.name || "Error",
      timed_out: error.isTimeout === true,
      message: redactLogText(error.message, 500)
    });
    const status = error.isTimeout ? 504
      : error.upstreamStatus === 429 ? 503
      : error.upstreamStatus ? (error.upstreamStatus >= 400 && error.upstreamStatus < 500 ? error.upstreamStatus : 502)
      : 502;
    return sendJson(requestId.res, status, {
      error: error.isTimeout
        ? "Vercel Observability query timed out. Your Runtime Logs session is still valid; use refresh to retry."
        : error.upstreamStatus === 401 || error.upstreamStatus === 403
          ? "Vercel rejected the access token or its project permissions. Check the token and team access."
          : error.upstreamStatus === 429
            ? "Vercel is rate-limiting log requests. Please wait before refreshing."
            : error.upstreamStatus === 404
              ? "Vercel could not find the project or deployment for this log query. Check VERCEL_PROJECT_ID and team access."
              : "Vercel runtime logs could not be loaded. Check the server-side Vercel function logs for details."
    }, requestId.id);
  }
}

async function paystackRequest(path, payload, method, log) {
  if (!process.env.PAYSTACK_KEY) throw new Error("PAYSTACK_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
        "Content-Type": "application/json"
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  } finally {
    clearTimeout(timeout);
  }

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

async function initializePayment(db, details, log) {
  const amountNgn = Number(details.amountNgn);
  const minimumNgn = Number(APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN);
  const maximumNgn = Number(APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN);
  const minimumMinor = Math.round(minimumNgn * 100);
  const maximumMinor = Math.round(maximumNgn * 100);
  const amountMinor = Math.round(amountNgn * 100);

  // Validate the exact kobo value that will be inserted and sent to Paystack.
  // This prevents sub-kobo rounding from slipping above the configured ceiling.
  if (!Number.isFinite(amountNgn) || !Number.isSafeInteger(amountMinor) ||
      !Number.isSafeInteger(minimumMinor) || !Number.isSafeInteger(maximumMinor) ||
      minimumMinor < 1 || maximumMinor < minimumMinor ||
      amountMinor < minimumMinor || amountMinor > maximumMinor) {
    const error = new Error(
      `Payment amount must be between NGN ${minimumNgn.toLocaleString("en-NG")} and NGN ${maximumNgn.toLocaleString("en-NG")}.`
    );
    error.statusCode = 400;
    error.code = "AMOUNT_OUT_OF_RANGE";
    throw error;
  }

  const reference = makeReference();

  await db`
    INSERT INTO transactions
      (reference, name, email, amount_minor, currency, original_amount,
       original_currency, exchange_rate, rate_date, rate_source,
       type, note, note_public, source)
    VALUES
      (${reference}, ${details.name}, ${details.email}, ${amountMinor}, 'NGN',
       ${details.originalAmount ?? amountNgn}, ${details.originalCurrency ?? "NGN"},
       ${details.exchangeRate ?? 1}, ${details.rateDate ?? null},
       ${details.rateSource ?? "api"}, ${details.type}, ${details.note ?? null},
       ${Boolean(details.notePublic)}, ${details.source})
  `;

  try {
    const callbackBase = process.env.APP_URL;
    if (!details.callbackUrl && !callbackBase) {
      throw new Error("APP_URL is not configured");
    }
    // A request-specific callback overrides APP_URL for this transaction only.
    // Keep the legacy gateway thank-you callback as the default behaviour.
    const callbackUrl = details.callbackUrl ||
      `${callbackBase.replace(/\/$/, "")}/thank-you?payment=return`;
    const data = await paystackRequest("/transaction/initialize", {
      email: details.email,
      amount: String(amountMinor),
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        custom_fields: [
          { display_name: "Payment type", variable_name: "payment_type", value: details.type },
          { display_name: "Source", variable_name: "source", value: details.source }
        ]
      }
    }, "POST", log);

    log("info", "payment.initialized", {
      reference,
      source: details.source,
      currency: "NGN"
    });

    return {
      reference,
      authorization_url: data.authorization_url,
      access_code: data.access_code
    };
  } catch (error) {
    await db`
      UPDATE transactions
      SET status = 'failed', updated_at = NOW()
      WHERE reference = ${reference}
    `;
    log("error", "payment.initialization.failed", {
      reference,
      source: details.source,
      message: error.message
    });
    throw error;
  }
}

function verificationError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.apiError = true;
  return error;
}

function validPaymentReference(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9._-]{6,100}$/.test(value.trim());
}

// Optional automation callback destinations are browser redirects, not server
// fetch targets. Require HTTPS and reject credentials/fragments to avoid
// ambiguous or misleading redirect destinations.
function parseAutomationCallbackUrl(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_CALLBACK_URL" };
  }

  const input = value.trim();
  if (!input || input.toLowerCase() === "null") {
    return { ok: true, value: null };
  }
  if (input.length > 2048 || input.includes("\u0000")) {
    return { ok: false, code: "INVALID_CALLBACK_URL" };
  }

  try {
    const parsed = new URL(input);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return { ok: false, code: "INVALID_CALLBACK_URL" };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, code: "INVALID_CALLBACK_URL" };
  }
}

async function verifyPayment(db, reference, log) {
  const existing = await db`
    SELECT reference, amount_minor, currency, type, status
    FROM transactions
    WHERE reference = ${reference}
    LIMIT 1
  `;
  if (!existing.length) {
    log("warn", "payment.verify.unknown_reference", { reference });
    throw verificationError("Payment reference was not found.", 404, "TRANSACTION_NOT_FOUND");
  }

  // A successful state can only be written after server-side Paystack verification.
  // Reuse that durable result instead of failing an already-paid transaction when
  // Paystack is temporarily unavailable on a later repeat verification request.
  if (existing[0].status === "success") {
    log("info", "payment.verify.already_successful", { reference });
    return {
      status: "success",
      reference,
      amount: existing[0].amount_minor,
      currency: existing[0].currency,
      payment_type: existing[0].type
    };
  }

  let data;
  try {
    data = await paystackRequest(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      null,
      "GET",
      log
    );
  } catch (error) {
    // A timeout, network failure, missing provider key or upstream rejection is
    // not evidence that a transaction failed. Leave its database state unchanged.
    log("warn", "payment.verify.provider_unavailable", {
      reference,
      error_name: error?.name || "Error"
    });
    throw verificationError(
      "Paystack verification is temporarily unavailable. Retry this request.",
      503,
      "VERIFICATION_UNAVAILABLE"
    );
  }

  if (!data || typeof data !== "object") {
    throw verificationError(
      "Paystack returned an invalid verification response. Retry this request.",
      503,
      "VERIFICATION_UNAVAILABLE"
    );
  }

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
    throw verificationError(
      "Paystack verification details did not match the stored transaction.",
      502,
      "PAYMENT_DETAILS_MISMATCH"
    );
  }

  const providerStatus = String(data.status || "").toLowerCase();
  // Only explicit Paystack failure states are failed. Unknown/processing states
  // remain pending and are never treated as proof of a failed payment.
  const verifiedStatus = providerStatus === "success"
    ? "success"
    : ["failed", "abandoned"].includes(providerStatus)
      ? "failed"
      : "pending";

  // The SQL expression checks the row's current status at UPDATE time, not only
  // the earlier SELECT snapshot. A delayed response cannot overwrite a success
  // committed by a webhook or another concurrent verification request.
  const updated = await db`
    UPDATE transactions
    SET status = CASE
          WHEN status IN ('success', 'reversed') THEN status
          WHEN ${verifiedStatus} = 'success' THEN 'success'
          ELSE ${verifiedStatus}
        END,
        paystack_status = CASE
          WHEN status IN ('success', 'reversed') THEN COALESCE(paystack_status, status)
          WHEN ${verifiedStatus} = 'success' THEN 'success'
          ELSE ${providerStatus || "pending"}
        END,
        paid_at = CASE
          WHEN status = 'success' THEN COALESCE(paid_at, NOW())
          WHEN status = 'reversed' THEN paid_at
          WHEN ${verifiedStatus} = 'success' THEN COALESCE(paid_at, NOW())
          ELSE paid_at
        END,
        updated_at = NOW()
    WHERE reference = ${reference}
    RETURNING status
  `;

  const status = String(updated[0]?.status || existing[0].status || verifiedStatus);
  log(status === "success" ? "info" : "warn", "payment.verify.completed", {
    reference,
    payment_status: status
  });

  return {
    status,
    reference,
    // Preserve the existing website contract: Paystack amounts are in kobo.
    amount: data.amount,
    currency: data.currency,
    payment_type: existing[0].type
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
    app_url: Boolean(process.env.APP_URL),
    public_note_consent: "not_checked"
  };

  let databaseError = null;
  try {
    const db = getSql();
    const result = await db`
      SELECT
        to_regclass('public.transactions') IS NOT NULL AS transactions,
        to_regclass('public.rate_snapshots') IS NOT NULL AS rate_snapshots,
        to_regclass('public.maintenance_state') IS NOT NULL AS maintenance_state,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transactions'
            AND column_name = 'note_public'
        ) AS note_public_consent
    `;
    checks.database = "ok";
    checks.public_note_consent = result[0]?.note_public_consent ? "ok" : "missing";
    checks.schema = result[0] &&
      result[0].transactions &&
      result[0].rate_snapshots &&
      result[0].maintenance_state &&
      result[0].note_public_consent
      ? "ok"
      : "incomplete";
    if (checks.schema === "incomplete") {
      databaseError = "One or more required tables or columns are missing";
      log("error", "health.schema.incomplete", { tables: result[0] });
    } else {
      log("info", "health.database.ready");
    }
  } catch (error) {
    checks.database = "error";
    checks.schema = "unknown";
    databaseError = error.message;
    log("error", "health.database.failed", {
      message: error.message,
      stack: error.stack
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
    ...(databaseError ? { database_message: "Database readiness failed; inspect server-side function logs." } : {}),
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

    // Runtime Logs authentication is independent from the Control Room session.
    // It reuses ADMIN_KEY but issues and validates only the dz_logs cookie.
    if (path === "logs/login" && req.method === "POST") {
      const body = await readBody(req);
      const supplied = typeof body.key === "string" ? body.key : "";
      const expected = process.env.ADMIN_KEY || "";
      if (!expected) {
        log("error", "logs.login.configuration_error", { missing_environment_variable: "ADMIN_KEY" });
        return sendJson(res, 503, { error: "Runtime Logs login is not configured" }, requestId);
      }
      if (!safeEqual(supplied, expected)) {
        log("warn", "logs.login.failed", { reason: "invalid_key" });
        return sendJson(res, 401, { error: "Invalid Admin key" }, requestId);
      }
      const token = createLogsSession();
      res.setHeader("Set-Cookie", `dz_logs=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=28800`);
      log("info", "logs.login.succeeded");
      return sendJson(res, 200, { ok: true, message: "Runtime Logs session created", expires_in: 28800 }, requestId);
    }

    if (path === "logs/session" && req.method === "GET") {
      const authenticated = hasLogsSession(req);
      return sendJson(res, 200, { ok: true, authenticated }, requestId);
    }

    if (path === "logs/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", "dz_logs=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0");
      log("info", "logs.logout");
      return sendJson(res, 200, { ok: true }, requestId);
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

    // Server-to-server automation routes use the existing API_KEY.
    // Authenticate and reject incorrect methods before Neon initialization or maintenance.
    const automationRoutes = ["automation/initialize", "automation/verify", "automation/transactions"];
    if (automationRoutes.includes(path)) {
      const expectedMethod = path === "automation/transactions" ? "GET" : "POST";
      if (req.method !== expectedMethod) {
        res.setHeader("Allow", expectedMethod);
        return sendJson(res, 405, {
          ok: false,
          error: { code: "METHOD_NOT_ALLOWED", message: `Use ${expectedMethod} for this endpoint.` }
        }, requestId);
      }
      if (!hasAutomationKey(req)) {
        log("warn", "automation.authentication.failed");
        return sendJson(res, 401, {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "A valid API key is required." }
        }, requestId);
      }
    }

    // Runtime Logs data is authorized only by its own dz_logs session.
    // It intentionally does not inherit a Control Room dz_admin session.
    if (path === "admin/logs") {
      if (!hasLogsSession(req)) {
        log("warn", "logs.authorization.denied");
        return sendJson(res, 401, { error: "Runtime Logs authentication required. Sign in on the Runtime Logs page." }, requestId);
      }
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendJson(res, 405, { error: "Method not allowed. Use GET." }, requestId);
      }
      const forceRefresh = ["1", "true"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
      return await getVercelRuntimeLogs(url.searchParams.get("limit"), forceRefresh, { res, id: requestId }, log);
    }

    // Gate every remaining Admin endpoint before Neon initialization or lazy maintenance.
    // Website Admin access is session-cookie-only; API_KEY is not an Admin credential.
    if (path.startsWith("admin/")) {
      if (!hasAdminSession(req)) {
        const cookieHeader = String(req.headers.cookie || "");
        const adminCookiePresent = cookieHeader.split(";").some(part => part.trim().startsWith("dz_admin="));
        log("warn", "admin.authorization.denied", {
          host: String(req.headers.host || "").slice(0, 200) || null,
          origin: String(req.headers.origin || "").slice(0, 300) || null,
          admin_cookie_present: adminCookiePresent
        });
        return sendJson(res, 401, {
          error: "Admin authentication required. Sign in again on this same domain.",
          request_id: requestId
        }, requestId);
      }

    }

    if (path === "payment-limits" && req.method === "GET") {
      return sendJson(res, 200, {
        currency: "NGN",
        minimum_amount_ngn: APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN,
        maximum_amount_ngn: APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN,
        whole_numbers_only: true,
        toast_duration_ms: APP_CONFIG.TOAST_DURATION_MS
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

    if (path === "pay/initialize" && req.method === "POST") {
      const body = await readBody(req);
      if (!validEmail(body.email)) {
        log("warn", "checkout.validation.failed", { field: "email" });
        return sendJson(res, 400, { error: "Enter a valid email address" }, requestId);
      }
      const note = body.note == null ? "" : String(body.note);
      if (note.length > 200) {
        log("warn", "checkout.validation.failed", { field: "note", max_length: 200 });
        return sendJson(res, 400, { error: "Your note must be 200 characters or fewer." }, requestId);
      }
      const notePublic = note.trim().length > 0 &&
        [true, "true", "on", "1"].includes(body.note_public);

      const currencyCode = String(body.currency || "NGN").toUpperCase();
      const currency = CURRENCIES.find(item => item.code === currencyCode);
      if (!currency) {
        return sendJson(res, 400, { error: "Unsupported currency" }, requestId);
      }

      const parsedAmount = parseWholeAmount(body.amount);
      if (!parsedAmount.ok) {
        log("warn", "checkout.validation.failed", {
          field: "amount",
          reason: parsedAmount.code,
          currency: currencyCode
        });
        return sendJson(res, 400, paymentAmountError(parsedAmount.code, currencyCode), requestId);
      }
      const amount = parsedAmount.value;

      // NGN is the Paystack settlement currency; it does not depend on the
      // external exchange-rate provider. Only foreign-currency payments fetch rates.
      const rates = currencyCode === "NGN"
        ? { ngn_per_unit: { NGN: 1 }, rateDate: null, source: "base" }
        : await getRates(db, log);
      const ngnRate = Number(rates.ngn_per_unit[currencyCode]);
      if (!Number.isFinite(ngnRate) || ngnRate <= 0) {
        log("warn", "checkout.currency_unavailable", {
          currency: currencyCode,
          rate_source: rates.source
        });
        return sendJson(res, 503, {
          error: "This currency is temporarily unavailable",
          currency: currencyCode,
          rate_source: rates.source
        }, requestId);
      }

      const rawAmountNgn = currencyCode === "NGN" ? amount : amount * ngnRate;
      const amountNgn = currencyCode === "NGN" ? amount : Math.ceil(rawAmountNgn / 10) * 10;
      const rangeError = classifyNgnMinorAmount(amountNgn);
      if (rangeError) {
        log("warn", "checkout.validation.failed", {
          field: "converted_amount",
          reason: rangeError,
          currency: currencyCode
        });
        return sendJson(res, 400, paymentAmountError(rangeError, currencyCode), requestId);
      }
      const payment = await initializePayment(db, {
        amountNgn,
        email: body.email.trim(),
        name: String(body.name || "Customer").slice(0, 100),
        type: ["donation", "service"].includes(body.type) ? body.type : "donation",
        note,
        notePublic,
        source: "website",
        originalAmount: amount,
        originalCurrency: currencyCode,
        exchangeRate: ngnRate,
        rateDate: rates.rateDate,
        rateSource: rates.source
      }, log);

      return sendJson(res, 200, {
        ...payment,
        currency: "NGN",
        amount_ngn: amountNgn,
        original_amount: amount,
        original_currency: currencyCode,
        rate_date: rates.rateDate,
        rate_source: rates.source
      }, requestId);
    }

    if (path === "pay/verify" && req.method === "GET") {
      const reference = url.searchParams.get("reference") || url.searchParams.get("trxref");
      if (!reference) {
        return sendJson(res, 400, { error: "Missing payment reference" }, requestId);
      }
      const normalizedReference = reference.trim();
      if (!validPaymentReference(normalizedReference)) {
        return sendJson(res, 400, { error: "Invalid payment reference", code: "INVALID_REFERENCE" }, requestId);
      }
      const result = await verifyPayment(db, normalizedReference, log);
      return sendJson(res, 200, result, requestId);
    }

    if (path === "automation/initialize" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(res, 400, {
          ok: false,
          error: { code: "INVALID_REQUEST_BODY", message: "Send a JSON object in the request body." }
        }, requestId);
      }

      const parsedAutomationAmount = parseWholeAmount(body.amount);
      if (!parsedAutomationAmount.ok) {
        log("warn", "automation.validation.failed", {
          field: "amount",
          reason: parsedAutomationAmount.code
        });
        return sendJson(res, 400, paymentAmountError(parsedAutomationAmount.code, "NGN"), requestId);
      }
      const automationAmount = parsedAutomationAmount.value;
      const automationRangeError = classifyNgnMinorAmount(automationAmount);
      if (automationRangeError) {
        log("warn", "automation.validation.failed", {
          field: "amount",
          reason: automationRangeError
        });
        return sendJson(res, 400, paymentAmountError(automationRangeError, "NGN"), requestId);
      }

      const optionalAutomationField = (field, fallback, maxLength) => {
        const value = body[field];
        if (value === undefined || value === null) return { ok: true, value: fallback };
        if (typeof value !== "string") return { ok: false, code: "INVALID_FIELD_TYPE" };
        const normalized = value.trim();
        if (!normalized || normalized.toLowerCase() === "null") {
          return { ok: true, value: fallback };
        }
        if (normalized.includes("\u0000")) return { ok: false, code: "INVALID_FIELD_VALUE" };
        if (normalized.length > maxLength) return { ok: false, code: "FIELD_TOO_LONG" };
        return { ok: true, value: normalized };
      };

      const automationName = optionalAutomationField("name", "Anonymous", 20);
      const automationEmail = optionalAutomationField("email", APP_CONFIG.API_EMAIL, 50);
      const automationNote = optionalAutomationField("note", "Automation", 200);
      const automationCallback = parseAutomationCallbackUrl(body.url);
      if (!automationCallback.ok) {
        log("warn", "automation.validation.failed", {
          field: "url",
          reason: automationCallback.code
        });
        return sendJson(res, 400, {
          ok: false,
          error: {
            code: automationCallback.code,
            message: "url must be a valid HTTPS callback URL without credentials or a fragment.",
            field: "url",
            max_length: 2048
          }
        }, requestId);
      }

      for (const [field, parsed, maxLength] of [
        ["name", automationName, 20],
        ["email", automationEmail, 50],
        ["note", automationNote, 200]
      ]) {
        if (!parsed.ok) {
          const message = parsed.code === "FIELD_TOO_LONG"
            ? `${field} must be ${maxLength} characters or fewer.`
            : parsed.code === "INVALID_FIELD_VALUE"
              ? `${field} contains an unsupported character.`
              : `${field} must be a string, null, or omitted.`;
          log("warn", "automation.validation.failed", { field, reason: parsed.code });
          return sendJson(res, 400, {
            ok: false,
            error: { code: parsed.code, message, field, max_length: maxLength }
          }, requestId);
        }
      }

      if (!validEmail(automationEmail.value) || automationEmail.value.length > 50) {
        log("warn", "automation.validation.failed", { field: "email", reason: "INVALID_EMAIL" });
        return sendJson(res, 400, {
          ok: false,
          error: { code: "INVALID_EMAIL", message: "email must be a valid email address of 50 characters or fewer.", field: "email", max_length: 50 }
        }, requestId);
      }

      const payment = await initializePayment(db, {
        amountNgn: automationAmount,
        email: automationEmail.value,
        name: automationName.value,
        type: "transaction",
        note: automationNote.value,
        notePublic: false,
        source: "api",
        callbackUrl: automationCallback.value
      }, log);

      log("info", "automation.payment_link.created", {
        reference: payment.reference
      });

      return sendJson(res, 200, {
        ...payment,
        currency: "NGN",
        amount_ngn: automationAmount,
        email: automationEmail.value
      }, requestId);
    }

if (path === "automation/transactions" && req.method === "GET") {
      // Private ZCard transaction feed. Includes the five canonical fixed plans
      // and server-calculated custom-duration notes (1–365 days). Restrict to
      // automation transactions and never return customer email/name.
      const pageText = url.searchParams.get("page") || "1";
      const limitText = url.searchParams.get("limit") || "25";
      const statusFilter = String(url.searchParams.get("status") || "all").toLowerCase();
      if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) {
        return sendJson(res, 400, { ok: false, error: { code: "INVALID_PAGINATION", message: "Page and limit must be positive integers." } }, requestId);
      }
      const page = Number(pageText);
      const limit = Number(limitText);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return sendJson(res, 400, { ok: false, error: { code: "INVALID_PAGINATION", message: "Page must be 1–100000 and limit must be 1–100." } }, requestId);
      }
      if (!["all", "success", "pending", "failed", "reversed"].includes(statusFilter)) {
        return sendJson(res, 400, { ok: false, error: { code: "INVALID_STATUS_FILTER", message: "Unsupported transaction status filter." } }, requestId);
      }

      const summaryRows = await db`
        SELECT
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE status = 'success')::integer AS successful,
          COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed,
          COUNT(*) FILTER (WHERE status = 'reversed')::integer AS reversed,
          COALESCE(SUM(amount_minor) FILTER (WHERE status = 'success'), 0)::numeric / 100 AS successful_revenue_ngn
        FROM transactions
        WHERE type = 'transaction'
          AND source = 'api'
          AND (
            note IN (
              'ZCARD|v1|plan=day|days=1|amount_ngn=500',
              'ZCARD|v1|plan=week|days=7|amount_ngn=3000',
              'ZCARD|v1|plan=month|days=30|amount_ngn=16500',
              'ZCARD|v1|plan=quarter|days=90|amount_ngn=28000',
              'ZCARD|v1|plan=year|days=365|amount_ngn=95600'
            )
            OR CASE
              WHEN note ~ '^ZCARD\\|v1\\|custom\\|days=([1-9][0-9]{0,2})\\|amount_ngn=[1-9][0-9]*$' THEN
                substring(note from 'days=([0-9]+)')::integer BETWEEN 1 AND 365
                AND substring(note from 'days=([0-9]+)')::integer NOT IN (1, 7, 30, 90, 365)
                AND amount_minor = round(
                  3000::numeric * substring(note from 'days=([0-9]+)')::numeric / 7
                ) * 100
                AND split_part(split_part(note, '|', 5), '=', 2)::numeric = amount_minor / 100
              ELSE FALSE
            END
          )
      `;
      const countRows = await db`
        SELECT COUNT(*)::integer AS total
        FROM transactions
        WHERE type = 'transaction'
          AND source = 'api'
          AND (
            note IN (
              'ZCARD|v1|plan=day|days=1|amount_ngn=500',
              'ZCARD|v1|plan=week|days=7|amount_ngn=3000',
              'ZCARD|v1|plan=month|days=30|amount_ngn=16500',
              'ZCARD|v1|plan=quarter|days=90|amount_ngn=28000',
              'ZCARD|v1|plan=year|days=365|amount_ngn=95600'
            )
            OR CASE
              WHEN note ~ '^ZCARD\\|v1\\|custom\\|days=([1-9][0-9]{0,2})\\|amount_ngn=[1-9][0-9]*$' THEN
                substring(note from 'days=([0-9]+)')::integer BETWEEN 1 AND 365
                AND substring(note from 'days=([0-9]+)')::integer NOT IN (1, 7, 30, 90, 365)
                AND amount_minor = round(
                  3000::numeric * substring(note from 'days=([0-9]+)')::numeric / 7
                ) * 100
                AND split_part(split_part(note, '|', 5), '=', 2)::numeric = amount_minor / 100
              ELSE FALSE
            END
          )
        AND (
          ${statusFilter} = 'all'
          OR status = ${statusFilter}
          OR (${statusFilter} = 'failed' AND status = 'reversed')
        )
      `;
      const rows = await db`
        SELECT reference, amount_minor::numeric / 100 AS amount_ngn,
          note, status, created_at, paid_at, updated_at
        FROM transactions
        WHERE type = 'transaction'
          AND source = 'api'
          AND (
            note IN (
              'ZCARD|v1|plan=day|days=1|amount_ngn=500',
              'ZCARD|v1|plan=week|days=7|amount_ngn=3000',
              'ZCARD|v1|plan=month|days=30|amount_ngn=16500',
              'ZCARD|v1|plan=quarter|days=90|amount_ngn=28000',
              'ZCARD|v1|plan=year|days=365|amount_ngn=95600'
            )
            OR CASE
              WHEN note ~ '^ZCARD\\|v1\\|custom\\|days=([1-9][0-9]{0,2})\\|amount_ngn=[1-9][0-9]*$' THEN
                substring(note from 'days=([0-9]+)')::integer BETWEEN 1 AND 365
                AND substring(note from 'days=([0-9]+)')::integer NOT IN (1, 7, 30, 90, 365)
                AND amount_minor = round(
                  3000::numeric * substring(note from 'days=([0-9]+)')::numeric / 7
                ) * 100
                AND split_part(split_part(note, '|', 5), '=', 2)::numeric = amount_minor / 100
              ELSE FALSE
            END
          )
        AND (
          ${statusFilter} = 'all'
          OR status = ${statusFilter}
          OR (${statusFilter} = 'failed' AND status = 'reversed')
        )
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `;
      const planByNote = {
        "ZCARD|v1|plan=day|days=1|amount_ngn=500": { id: "day", title: "Daily Access", days: 1 },
        "ZCARD|v1|plan=week|days=7|amount_ngn=3000": { id: "week", title: "Weekly Access", days: 7 },
        "ZCARD|v1|plan=month|days=30|amount_ngn=16500": { id: "month", title: "Monthly Access", days: 30 },
        "ZCARD|v1|plan=quarter|days=90|amount_ngn=28000": { id: "quarter", title: "Quarterly Access", days: 90 },
        "ZCARD|v1|plan=year|days=365|amount_ngn=95600": { id: "year", title: "Annual Access", days: 365 }
      };
      function zcardPlanFromNote(note) {
        if (planByNote[note]) return planByNote[note];
        const match = /^ZCARD\|v1\|custom\|days=([1-9]\d{0,2})\|amount_ngn=([1-9]\d*)$/.exec(String(note || ""));
        if (!match) return null;
        const days = Number(match[1]);
        const amount = Number(match[2]);
        if (!Number.isSafeInteger(days) || days < 1 || days > 365 ||
            [1, 7, 30, 90, 365].includes(days) ||
            !Number.isSafeInteger(amount) || amount !== Math.round(3000 * days / 7)) return null;
        return { id: "custom", title: "Custom Access", days };
      }
      const total = Number(countRows[0]?.total || 0);
      const summary = summaryRows[0] || {};
      log("info", "automation.zcard_transactions.loaded", { count: rows.length, total, page, limit, status: statusFilter });
      return sendJson(res, 200, {
        ok: true,
        source: "DEVZIKKY CHECKOUT",
        filter: "ZCARD_NOTE_V1",
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        status_filter: statusFilter,
        summary: {
          total: Number(summary.total || 0),
          successful: Number(summary.successful || 0),
          pending: Number(summary.pending || 0),
          failed: Number(summary.failed || 0),
          reversed: Number(summary.reversed || 0),
          successful_revenue_ngn: Number(summary.successful_revenue_ngn || 0)
        },
        transactions: rows.map(row => ({
          reference: row.reference,
          amount_ngn: Number(row.amount_ngn || 0),
          note: row.note,
          plan: zcardPlanFromNote(row.note),
          status: row.status,
          created_at: row.created_at,
          paid_at: row.paid_at,
          updated_at: row.updated_at
        }))
      }, requestId);
    }

        if (path === "automation/verify" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(res, 400, {
          ok: false,
          error: { code: "INVALID_REQUEST_BODY", message: "Send a JSON object in the request body." }
        }, requestId);
      }

      if (!validPaymentReference(body.reference)) {
        return sendJson(res, 400, {
          ok: false,
          error: {
            code: body.reference === undefined || body.reference === null || body.reference === ""
              ? "REFERENCE_REQUIRED" : "INVALID_REFERENCE",
            message: "Provide a valid payment reference in the reference field."
          }
        }, requestId);
      }

      const reference = body.reference.trim();
      const result = await verifyPayment(db, reference, log);
      return sendJson(res, 200, {
        ok: true,
        reference: result.reference,
        payment_status: result.status,
        paid: result.status === "success",
        amount: Number(result.amount) / 100,
        currency: result.currency
      }, requestId);
    }

    if (path === "stats/export" && req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "Method not allowed. Use GET." }, requestId);
    }

    if (path === "stats/export" && req.method === "GET") {
      const todayIso = currentLagosIsoDate();
      const defaultFromDate = new Date(`${todayIso}T12:00:00Z`);
      defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
      const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
      const fromInput = url.searchParams.get("from") || isoDateToDmy(defaultFrom);
      const toInput = url.searchParams.get("to") || isoDateToDmy(todayIso);
      const from = parseCalendarDate(fromInput);
      const to = parseCalendarDate(toInput);

      if (!from || !to || from > to || to > todayIso) {
        return sendJson(res, 400, {
          error: "Choose a valid date range in DD/MM/YYYY format.",
          expected_format: "DD/MM/YYYY"
        }, requestId);
      }
      const rangeDays = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
      if (!Number.isFinite(rangeDays) || rangeDays > 1096) {
        return sendJson(res, 400, { error: "Statistics exports are limited to a maximum three-year window." }, requestId);
      }

      // This public export contains no customer identity or contact fields.
      // Notes are included only when the donor explicitly opted in at checkout.
      const rows = await db`
        SELECT
          reference,
          amount_minor::numeric / 100 AS amount_ngn,
          original_currency,
          type,
          COALESCE(paid_at, created_at) AS paid_at_lagos,
          CASE WHEN note_public IS TRUE THEN COALESCE(note, '') ELSE '' END AS public_note
        FROM transactions
        WHERE status = 'success'
          AND (COALESCE(paid_at, created_at) AT TIME ZONE 'Africa/Lagos')::date
            BETWEEN ${from}::date AND ${to}::date
        ORDER BY COALESCE(paid_at, created_at) DESC
      `;
      const formatPublicLagos = value => {
        if (!value) return null;
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return null;
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        }).formatToParts(date);
        const fields = Object.fromEntries(parts.filter(part => part.type !== "literal")
          .map(part => [part.type, part.value]));
        return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
      };
      const payload = {
        export: {
          application: "DEVZIKKY PAY",
          report: "Public successful payment activity",
          generated_at_lagos: formatPublicLagos(new Date()),
          timezone: "Africa/Lagos",
          from: isoDateToDmy(from),
          to: isoDateToDmy(to),
          record_count: rows.length,
          privacy: "Donor names, email addresses and private notes are excluded."
        },
        transactions: rows.map(row => ({
          transaction: {
            reference: row.reference,
            payment_type: exportLabel(row.type, "type"),
            status: "Successful"
          },
          amounts: {
            received_ngn: Number(row.amount_ngn || 0),
            original_currency: row.original_currency || null
          },
          timestamps: {
            paid_at_lagos: formatPublicLagos(row.paid_at_lagos)
          },
          donor_note: row.public_note ? {
            text: row.public_note,
            visibility: "public"
          } : null
        }))
      };
      const json = JSON.stringify(payload, null, 2);
      JSON.parse(json);
      // Fail closed if a future change accidentally produces malformed JSON.
      JSON.parse(json);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="devzikky-pay-public-transactions-${from}-to-${to}.json"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Request-ID", requestId);
      log("info", "statistics.public_export.completed", {
        rows: rows.length,
        from: isoDateToDmy(from),
        to: isoDateToDmy(to),
        format: "json"
      });
      return res.end(json);
    }

    if (path === "stats" && req.method === "GET") {
      const todayIso = currentLagosIsoDate();
      const defaultFromIso = new Date(`${todayIso}T12:00:00Z`);
      defaultFromIso.setUTCDate(defaultFromIso.getUTCDate() - 29);
      const defaultFrom = defaultFromIso.toISOString().slice(0, 10);
      const fromInput = url.searchParams.get("from") || isoDateToDmy(defaultFrom);
      const toInput = url.searchParams.get("to") || isoDateToDmy(todayIso);
      const grain = url.searchParams.get("grain") || "day";
      const allowedGrains = new Set(["day", "week", "month", "year"]);
      const from = parseCalendarDate(fromInput);
      const to = parseCalendarDate(toInput);

      if (!from || !to) {
        log("warn", "statistics.invalid_date", {
          from_input: fromInput, to_input: toInput, grain,
          expected_format: "DD/MM/YYYY"
        });
        return sendJson(res, 400, {
          error: "Invalid date. Enter dates as DD/MM/YYYY (for example, 10/11/2026).",
          expected_format: "DD/MM/YYYY"
        }, requestId);
      }
      if (from > to) {
        return sendJson(res, 400, {
          error: "The start date must be on or before the end date.",
          expected_format: "DD/MM/YYYY"
        }, requestId);
      }
      if (!allowedGrains.has(grain)) {
        return sendJson(res, 400, {
          error: "Invalid grouping. Choose day, week, month or year."
        }, requestId);
      }
      if (to > todayIso) {
        return sendJson(res, 400, {
          error: "The end date cannot be in the future. Use DD/MM/YYYY."
        }, requestId);
      }
      const rangeDays = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
      if (!Number.isFinite(rangeDays) || rangeDays > 1096) {
        return sendJson(res, 400, {
          error: "Statistics history is limited to a maximum three-year window."
        }, requestId);
      }
      const statsQueries = [
        db`
          WITH activity AS (
            SELECT *, CASE WHEN status = 'success'
              THEN COALESCE(paid_at, created_at)
              ELSE created_at END AS activity_at
            FROM transactions
          )
          SELECT
            COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status IN ('failed','reversed'))::int AS failed,
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'success'), 0)::numeric / 100 AS total_ngn
          FROM activity
          WHERE (activity_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${from}::date AND ${to}::date
        `,
        db`
          WITH activity AS (
            SELECT *, CASE WHEN status = 'success'
              THEN COALESCE(paid_at, created_at)
              ELSE created_at END AS activity_at
            FROM transactions
          )
          SELECT status, COUNT(*)::int AS count,
            COALESCE(SUM(amount_minor),0)::numeric / 100 AS total_ngn
          FROM activity
          WHERE (activity_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${from}::date AND ${to}::date
          GROUP BY status
        `,
        db`
          WITH bounds AS (
            SELECT
              date_trunc(${grain}, ${from}::date::timestamp) AS first_bucket,
              date_trunc(${grain}, ${to}::date::timestamp) AS last_bucket
          ),
          buckets AS (
            SELECT generate_series(
              first_bucket,
              last_bucket,
              CASE ${grain}
                WHEN 'day' THEN INTERVAL '1 day'
                WHEN 'week' THEN INTERVAL '1 week'
                WHEN 'month' THEN INTERVAL '1 month'
                ELSE INTERVAL '1 year'
              END
            ) AS bucket
            FROM bounds
          ),
          activity AS (
            SELECT *, CASE WHEN status = 'success'
              THEN COALESCE(paid_at, created_at)
              ELSE created_at END AS activity_at
            FROM transactions
          ),
          activity_buckets AS (
            SELECT
              date_trunc(${grain}, activity.activity_at AT TIME ZONE 'Africa/Lagos') AS bucket,
              activity.status,
              activity.amount_minor
            FROM activity
            WHERE (activity.activity_at AT TIME ZONE 'Africa/Lagos')::date
              BETWEEN ${from}::date AND ${to}::date
          ),
          aggregated AS (
            SELECT
              bucket,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status IN ('failed','reversed'))::int AS failed,
              COALESCE(SUM(amount_minor) FILTER (WHERE status = 'success'),0)::numeric / 100 AS successful_ngn
            FROM activity_buckets
            GROUP BY bucket
          )
          SELECT
            to_char(buckets.bucket, 'DD/MM/YYYY') AS bucket,
            COALESCE(aggregated.total, 0)::int AS total,
            COALESCE(aggregated.successful, 0)::int AS successful,
            COALESCE(aggregated.pending, 0)::int AS pending,
            COALESCE(aggregated.failed, 0)::int AS failed,
            COALESCE(aggregated.successful_ngn, 0)::numeric AS successful_ngn
          FROM buckets
          LEFT JOIN aggregated ON aggregated.bucket = buckets.bucket
          ORDER BY buckets.bucket
        `,
        db`
          WITH activity AS (
            SELECT *, COALESCE(paid_at, created_at) AS activity_at
            FROM transactions WHERE status = 'success'
          )
          SELECT original_currency AS currency, COUNT(*)::int AS count,
            COALESCE(SUM(original_amount), 0)::numeric AS total
          FROM activity
          WHERE (activity_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${from}::date AND ${to}::date
          GROUP BY original_currency ORDER BY count DESC
        `,
        db`
          WITH activity AS (
            SELECT *, COALESCE(paid_at, created_at) AS activity_at
            FROM transactions WHERE status = 'success'
          )
          SELECT type, COUNT(*)::int AS count,
            COALESCE(SUM(amount_minor), 0)::numeric / 100 AS total_ngn
          FROM activity
          WHERE (activity_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${from}::date AND ${to}::date
          GROUP BY type
        `,
        db`
          WITH activity AS (
            SELECT *, COALESCE(paid_at, created_at) AS activity_at
            FROM transactions WHERE status = 'success'
          )
          SELECT reference, amount_minor::numeric / 100 AS amount_ngn,
            type, activity_at AS paid_at,
            CASE WHEN note_public IS TRUE THEN COALESCE(note, '') ELSE '' END AS public_note
          FROM activity
          WHERE (activity_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${from}::date AND ${to}::date
          ORDER BY activity_at DESC
          LIMIT 20
        `
      ];
      const statsQueryNames = ["totals", "status_breakdown", "timeline_series", "currency_breakdown", "type_breakdown", "recent_public_activity"];
      const [totals, byStatus, series, byCurrency, byType, recent] = await Promise.all(
        statsQueries.map((query, index) => Promise.resolve(query).catch(error => {
          log("error", "statistics.query_failed", {
            query: statsQueryNames[index],
            error_name: error?.name || "Error",
            error_code: error?.code || error?.cause?.code || null,
            message: error?.message || "Unknown database error",
            detail: error?.detail || error?.cause?.detail || null,
            hint: error?.hint || error?.cause?.hint || null,
            position: error?.position || error?.cause?.position || null,
            stack: error?.stack || null
          });
          throw error;
        }))
      );

      const statusMap = Object.fromEntries(byStatus.map(row => [row.status, row]));
      log("info", "statistics.generated", {
        from: isoDateToDmy(from), to: isoDateToDmy(to), grain,
        from_iso: from, to_iso: to,
        successful_transactions: Number(totals[0]?.successful || 0),
        pending_transactions: Number(totals[0]?.pending || 0),
        failed_transactions: Number(totals[0]?.failed || 0)
      });
      const statsPayload = {
        window: {
          from: isoDateToDmy(from), to: isoDateToDmy(to),
          from_iso: from, to_iso: to, grain,
          timezone: "Africa/Lagos",
          date_basis: { successful: "paid_at (fallback: created_at)", pending_failed_reversed: "created_at" },
          retention_years: APP_CONFIG.RETENTION_YEARS
        },
        totals: totals[0],
        statuses: {
          success: statusMap.success || { count: 0, total_ngn: 0 },
          pending: statusMap.pending || { count: 0, total_ngn: 0 },
          failed: {
            count: Number(statusMap.failed?.count || 0) + Number(statusMap.reversed?.count || 0),
            total_ngn: Number(statusMap.failed?.total_ngn || 0) + Number(statusMap.reversed?.total_ngn || 0)
          }
        },
        series, by_currency: byCurrency, by_type: byType, recent
      };

      if (url.searchParams.get("download") === "json") {
        const downloadPayload = {
          export: {
            application: SERVICE,
            report: "Statistics timeline",
            generated_at_lagos: formatTimestampLagos(new Date()),
            timezone: "Africa/Lagos",
            interval: grain,
            from: isoDateToDmy(from),
            to: isoDateToDmy(to),
            record_count: series.length
          },
          summary: {
            totals: statsPayload.totals,
            statuses: statsPayload.statuses,
            by_currency: statsPayload.by_currency,
            by_type: statsPayload.by_type
          },
          timeline: series.map(row => ({
            period: row.bucket,
            all_transactions: Number(row.total || 0),
            successful: Number(row.successful || 0),
            pending: Number(row.pending || 0),
            failed_or_reversed: Number(row.failed || 0),
            successful_value_ngn: Number(row.successful_ngn || 0)
          })),
          recent_public_activity: recent
        };
        const json = JSON.stringify(downloadPayload, null, 2);
        JSON.parse(json);
        const safeFrom = from.replace(/-/g, "");
        const safeTo = to.replace(/-/g, "");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="devzikky-pay-${grain}-statistics-${safeFrom}-to-${safeTo}.json"`);
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("X-Request-ID", requestId);
        log("info", "statistics.timeline_export.completed", {
          grain, from: isoDateToDmy(from), to: isoDateToDmy(to), buckets: series.length
        });
        return res.end(json);
      }

      return sendJson(res, 200, statsPayload, requestId);
    }

    if (path.startsWith("admin/")) {
      // All Admin paths reach this block only after the session gate above.
      if (path === "admin/transactions" && req.method === "GET") {
        const rows = await db`
          SELECT id, reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, note_public, source, status,
            created_at, paid_at
          FROM transactions
          ORDER BY created_at DESC
          LIMIT 500
        `;
        log("info", "admin.transactions.loaded", { count: rows.length });
        return sendJson(res, 200, { transactions: rows }, requestId);
      }

      if (path === "admin/export" && req.method === "GET") {
        const requestedStatus = url.searchParams.get("status") || "all";
        if (!["all", "success", "pending", "failed"].includes(requestedStatus)) {
          return sendJson(res, 400, { error: "Invalid export status" }, requestId);
        }
        const rows = requestedStatus === "all" ? await db`
          SELECT reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, note_public, source, status,
            created_at, paid_at
          FROM transactions ORDER BY created_at DESC
        ` : requestedStatus === "failed" ? await db`
          SELECT reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, note_public, source, status,
            created_at, paid_at
          FROM transactions WHERE status IN ('failed','reversed')
          ORDER BY created_at DESC
        ` : await db`
          SELECT reference, name, email,
            amount_minor::numeric / 100 AS amount_ngn,
            original_amount, original_currency, type, note, note_public, source, status,
            created_at, paid_at
          FROM transactions WHERE status = ${requestedStatus}
          ORDER BY created_at DESC
        `;

        const formatJsonLagos = value => {
          if (!value) return null;
          const date = new Date(value);
          if (!Number.isFinite(date.getTime())) return null;
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
          }).formatToParts(date);
          const fields = Object.fromEntries(parts.filter(part => part.type !== "literal")
            .map(part => [part.type, part.value]));
          return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
        };

        const payload = {
          export: {
            application: "DEVZIKKY PAY",
            report: "Transaction records",
            generated_at_lagos: formatJsonLagos(new Date()),
            timezone: "Africa/Lagos",
            status_filter: requestedStatus,
            record_count: rows.length
          },
          transactions: rows.map(row => ({
            transaction: {
              reference: row.reference,
              payment_type: exportLabel(row.type, "type"),
              payment_source: exportLabel(row.source, "source"),
              status: exportLabel(row.status, "status")
            },
            donor: {
              name: row.name || null,
              email: row.email || null,
              note: row.note || null,
              note_visibility: row.note_public ? "public" : "private"
            },
            amounts: {
              received_ngn: Number(row.amount_ngn || 0),
              original_amount: row.original_amount == null ? null : Number(row.original_amount),
              original_currency: row.original_currency || null
            },
            timestamps: {
              created_at_lagos: formatJsonLagos(row.created_at),
              paid_at_lagos: formatJsonLagos(row.paid_at)
            }
          }))
        };

        const json = JSON.stringify(payload, null, 2);
        // Validate the serialized document before returning a successful response.
        JSON.parse(json);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="devzikky-pay-${requestedStatus}-transactions.json"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Request-ID", requestId);
        log("info", "admin.export.completed", { rows: rows.length, status: requestedStatus, format: "json" });
        return res.end(json);
      }
    }

    log("warn", "request.route_not_found");
    return sendJson(res, 404, { error: "Route not found" }, requestId);
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    log(status >= 500 ? "error" : "warn", "request.failed", {
      status,
      error_name: error.name || "Error",
      message: error.message || "Unknown error",
      stack: status >= 500 ? error.stack : undefined
    });
    if (error.apiError === true) {
      return sendJson(res, status, {
        ok: false,
        error: {
          code: error.code || "REQUEST_FAILED",
          message: error.message || "The request could not be completed."
        },
        request_id: requestId
      }, requestId);
    }
    return sendJson(res, status, {
      success: false,
      error: status >= 500 ? "Server error. Check Vercel function logs." : error.message,
      ...(error.code ? { code: error.code } : {}),
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
