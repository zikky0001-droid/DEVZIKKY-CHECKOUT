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

function csvCellSafe(value) {
  let text = String(value ?? "");
  // Neutralize spreadsheet formulas in donor-controlled fields before CSV quoting.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
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

function formatTimestampExport(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hourCycle: "h12"
  }).format(date) + " WAT";
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

function hasAutomationKey(req) {
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  return safeEqual(supplied, process.env.API_KEY || "");
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
    throw new Error(
      `Payment amount must be between ₦${minimumNgn.toLocaleString("en-NG")} and ₦${maximumNgn.toLocaleString("en-NG")}`
    );
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
    if (!callbackBase) throw new Error("APP_URL is not configured");
    const data = await paystackRequest("/transaction/initialize", {
      email: details.email,
      amount: String(amountMinor),
      currency: "NGN",
      reference,
      callback_url: `${callbackBase.replace(/\/$/, "")}/thank-you?payment=return`,
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

async function verifyPayment(db, reference, log) {
  const existing = await db`
    SELECT reference, amount_minor, currency, type
    FROM transactions
    WHERE reference = ${reference}
    LIMIT 1
  `;
  if (!existing.length) {
    log("warn", "payment.verify.unknown_reference", { reference });
    throw new Error("Payment reference was not found");
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

  const verifiedStatus = data.status === "success"
    ? "success"
    : ["failed", "abandoned"].includes(String(data.status).toLowerCase())
      ? "failed"
      : "pending";

  // A verified success is terminal for this simple checkout state machine:
  // later delayed/non-success responses must never downgrade it.
  const status = existing[0].status === "success" ? "success" : verifiedStatus;

  await db`
    UPDATE transactions
    SET status = ${status},
        paystack_status = CASE
          WHEN status = 'success' THEN COALESCE(paystack_status, 'success')
          WHEN ${status} = 'success' THEN 'success'
          ELSE ${String(data.status)}
        END,
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

    if (path === "payment-limits" && req.method === "GET") {
      return sendJson(res, 200, {
        currency: "NGN",
        minimum_amount_ngn: APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN,
        maximum_amount_ngn: APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN
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

      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
        return sendJson(res, 400, { error: "Invalid amount" }, requestId);
      }

      const rates = await getRates(db, log);
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

      const amountNgn = currencyCode === "NGN" ? amount : amount * ngnRate;
      if (!Number.isFinite(amountNgn) ||
          amountNgn < APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN ||
          amountNgn > APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN) {
        return sendJson(res, 400, {
          error: `Converted amount must be between ₦${APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")} and ₦${APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")}.`
        }, requestId);
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
        amount_ngn: Math.round(amountNgn * 100) / 100,
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
      const result = await verifyPayment(db, reference, log);
      return sendJson(res, 200, result, requestId);
    }

    if (path === "automation/initialize" && req.method === "POST") {
      if (!hasAutomationKey(req)) {
        log("warn", "automation.authentication.failed");
        return sendJson(res, 401, { error: "Unauthorized" }, requestId);
      }

      const body = await readBody(req);
      const automationAmount = Number(body.amount);
      if (!Number.isFinite(automationAmount) ||
          automationAmount < APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN ||
          automationAmount > APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN) {
        return sendJson(res, 400, {
          error: `Amount must be between ₦${APP_CONFIG.MIN_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")} and ₦${APP_CONFIG.MAX_PAYMENT_AMOUNT_NGN.toLocaleString("en-NG")}`
        }, requestId);
      }
      const payment = await initializePayment(db, {
        amountNgn: automationAmount,
        email: APP_CONFIG.API_EMAIL,
        name: "Anonymous",
        type: "transaction",
        note: "Automation",
        source: "api"
      }, log);

      log("info", "automation.payment_link.created", {
        reference: payment.reference
      });

      return sendJson(res, 200, {
        ...payment,
        currency: "NGN",
        email: APP_CONFIG.API_EMAIL
      }, requestId);
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
      const columns = ["Transaction reference", "Amount (NGN)", "Original currency", "Payment type", "Payment date (Lagos)", "Donor note (public consent only)"];
      const csv = "\uFEFF" + [
        columns.map(csvCellSafe).join(","),
        ...rows.map(row => [row.reference, Number(row.amount_ngn || 0).toFixed(2), row.original_currency,
          exportLabel(row.type, "type"), formatTimestampExport(row.paid_at_lagos), row.public_note]
          .map(csvCellSafe).join(","))
      ].join("\r\n");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="devzikky-pay-public-transactions-${from}-to-${to}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Request-ID", requestId);
      log("info", "statistics.public_export.completed", {
        rows: rows.length,
        from: isoDateToDmy(from),
        to: isoDateToDmy(to)
      });
      return res.end(csv);
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
      return sendJson(res, 200, {
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
      }, requestId);
    }

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

        const columns = ["Transaction reference", "Donor name", "Email address", "Amount received (NGN)",
          "Original amount", "Original currency", "Payment type", "Donor note", "Note visibility",
          "Payment source", "Payment status", "Created (Lagos time)", "Paid (Lagos time)"];
        const csv = "\uFEFF" + [
          columns.map(csvCellSafe).join(","),
          ...rows.map(row => [row.reference, row.name, row.email, Number(row.amount_ngn || 0).toFixed(2),
            row.original_amount == null ? "" : Number(row.original_amount).toFixed(2), row.original_currency,
            exportLabel(row.type, "type"), row.note,
            row.note_public ? "Public — donor consented" : "Private — admin only",
            exportLabel(row.source, "source"), exportLabel(row.status, "status"),
            formatTimestampExport(row.created_at), formatTimestampExport(row.paid_at)]
            .map(csvCellSafe).join(","))
        ].join("\r\n");

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="devzikky-pay-${requestedStatus}-transactions.csv"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Request-ID", requestId);
        log("info", "admin.export.completed", { rows: rows.length, status: requestedStatus });
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
      message: error.message || "Unknown error",
      stack: status >= 500 ? error.stack : undefined
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
