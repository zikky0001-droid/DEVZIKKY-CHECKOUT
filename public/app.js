const $ = selector => document.querySelector(selector);
const money = (amount, currency="NGN") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);

// Consistent public date presentation: DD/MM/YYYY in Africa/Lagos.
function formatIsoDateDmy(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? "—");
}

function formatLagosDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

/**
 * Centralized browser API client.
 * Logs safe request metadata to DevTools; server-side structured logs appear in Vercel.
 * Never logs request bodies, passwords, API keys or customer email addresses.
 */
async function api(path, options = {}) {
  const method = options.method || "GET";
  const route = `/api/${String(path).split("?")[0]}`;

  let response;
  try {
    response = await fetch(`/api/${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body && !options.headers?.["Content-Type"]
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    console.error("[DEVZIKKY PAY] API network error", {
      method,
      route,
      message: error.message
    });
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  const requestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();
  let data = {};
  let nonJson = false;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    nonJson = true;
    data = {
      error: response.status === 404
        ? "This API endpoint was not found by the deployment (HTTP 404). Check that the matching serverless function is included in the deployed project."
        : responseText
          ? `The server returned a non-JSON response (HTTP ${response.status}).`
          : `The server returned an empty response (HTTP ${response.status}).`
    };
  }

  const logDetails = {
    method,
    route,
    status: response.status,
    requestId: requestId || data.request_id || null
  };

  if (response.ok) {
    console.info("[DEVZIKKY PAY] API request succeeded", logDetails);
  } else if (response.status >= 500 || nonJson) {
    console.error("[DEVZIKKY PAY] API request failed", {
      ...logDetails,
      contentType,
      nonJson,
      ...(nonJson && responseText ? { responsePreview: responseText.slice(0, 240).replace(/\s+/g, " ") } : {}),
      error: data.error || "Unexpected server response"
    });
  } else {
    console.warn("[DEVZIKKY PAY] API request rejected", {
      ...logDetails,
      error: data.error || "Request rejected"
    });
  }

  if (!response.ok) {
    const suffix = requestId || data.request_id
      ? ` (request ID: ${requestId || data.request_id})`
      : "";
    throw new Error(`${data.error || "Request failed"}${suffix}`);
  }

  return data;
}

async function loadRates() {
  const data = await api("rates");
  window.__dzRates = data;
  return data;
}

async function checkoutPage() {
  const form = $("#checkoutForm");
  if (!form) return;

  const currencySelect = $("#currency");
  const estimate = $("#estimate");
  let rateData;

  try {
    rateData = await loadRates();

    const available = ["NGN", ...Object.keys(rateData.rates || {})]
      .filter((code, index, list) => list.indexOf(code) === index)
      .sort((a, b) => a === "NGN" ? -1 : b === "NGN" ? 1 : a.localeCompare(b));

    currencySelect.innerHTML = available
      .map(code => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
      .join("");

    console.info("[DEVZIKKY PAY] Checkout currencies loaded", {
      count: available.length,
      source: rateData.source,
      ...(rateData.date ? { fallbackDate: rateData.date } : {})
    });
  } catch (error) {
    $("#message").textContent = `Exchange rates unavailable: ${error.message}`;
    console.error("[DEVZIKKY PAY] Checkout initialization failed", {
      message: error.message
    });
    return;
  }

  const updateEstimate = () => {
    const code = currencySelect.value;
    const amount = Number(form.elements.amount.value);
    const providerRate = code === "NGN" ? 1 : Number(rateData.rates?.[code]);
    const ngnRate = code === "NGN" ? 1 :
      (Number.isFinite(providerRate) && providerRate > 0 ? 1 / providerRate : NaN);

    $("#currencyHint").textContent = code;

    if (amount > 0 && ngnRate > 0) {
      const estimateNgn = code === "NGN" ? amount : amount * ngnRate;
      const providerLine = code === "NGN"
        ? "NGN is the base currency"
        : `Provider rate: ₦1 = ${providerRate} ${code}`;
      const fallbackDate = rateData.date ? ` · Snapshot date: ${formatIsoDateDmy(rateData.date)}` : "";
      estimate.textContent =
        `Estimated Paystack charge: ${money(estimateNgn, "NGN")} · ` +
        `${providerLine} · ${rateData.source}${fallbackDate}`;
    } else {
      const fallbackDate = rateData.date ? ` · Snapshot date: ${formatIsoDateDmy(rateData.date)}` : "";
      estimate.textContent = `Rate source: ${rateData.source}${fallbackDate}`;
    }
  };

  currencySelect.addEventListener("change", updateEstimate);
  form.elements.amount.addEventListener("input", updateEstimate);
  updateEstimate();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#payButton");
    button.disabled = true;
    $("#message").textContent = "Preparing secure checkout…";

    try {
      const values = Object.fromEntries(new FormData(form));
      const enteredAmount = Number(values.amount);
      const selectedCurrency = String(values.currency || "NGN").toUpperCase();
      const currentRates = rateData?.rates || {};
      const providerRate = selectedCurrency === "NGN" ? 1 : Number(currentRates[selectedCurrency]);
      const estimatedNgn = selectedCurrency === "NGN" ? enteredAmount :
        (providerRate > 0 ? enteredAmount / providerRate : NaN);
      if (!Number.isFinite(estimatedNgn) || estimatedNgn < 100 || estimatedNgn > 5000000) {
        throw new Error("Converted payment amount must be between ₦100 and ₦5,000,000.");
      }
      const result = await api("pay/initialize", {
        method: "POST",
        body: JSON.stringify(values)
      });

      console.info("[DEVZIKKY PAY] Redirecting to Paystack", {
        reference: result.reference,
        originalCurrency: result.original_currency,
        ...(result.rate_date ? { fallbackDate: result.rate_date } : {})
      });
      window.location.assign(result.authorization_url);
    } catch (error) {
      $("#message").textContent = error.message;
      console.error("[DEVZIKKY PAY] Checkout initialization failed", {
        message: error.message
      });
      button.disabled = false;
    }
  });

  const parameters = new URLSearchParams(window.location.search);
  const reference = parameters.get("reference") || parameters.get("trxref");

  if (reference) {
    $("#paymentResult").classList.remove("hidden");
    $("#verifyMessage").textContent = "Verifying payment…";

    try {
      const result = await api(`pay/verify?reference=${encodeURIComponent(reference)}`);
      $("#verifyMessage").textContent = result.status === "success"
        ? "Payment verified successfully. Thank you!"
        : `Payment status: ${result.status}.`;
    } catch (error) {
      $("#verifyMessage").textContent =
        `We could not verify this payment yet. ${error.message}`;
      console.error("[DEVZIKKY PAY] Callback verification failed", {
        message: error.message
      });
    }
  }
}


async function thankYouPage() {
  const panel = document.querySelector('[data-thankyou-card]');
  if (!panel) return;

  const title = document.querySelector('[data-thankyou-title]');
  const message = document.querySelector('[data-thankyou-message]');
  const status = document.querySelector('[data-thankyou-status]');
  const details = document.querySelector('[data-thankyou-details]');
  const icon = document.querySelector('[data-thankyou-icon]');
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');

  const setState = (state, heading, copy, badge, symbol) => {
    panel.dataset.state = state;
    title.textContent = heading;
    message.textContent = copy;
    status.textContent = badge;
    icon.textContent = symbol;
  };

  if (!reference) {
    setState('unverified', 'We could not confirm your payment yet.',
      'No payment reference was returned. If your account was debited, please contact support with your Paystack receipt so the transaction can be checked.',
      'AWAITING PAYMENT REFERENCE', '…');
    return;
  }

  setState('checking', 'Confirming your support…',
    'Please wait while DEVZIKKY PAY verifies the transaction securely with Paystack.',
    'VERIFYING TRANSACTION', '↻');

  try {
    const result = await api(`pay/verify?reference=${encodeURIComponent(reference)}`);
    if (result.status === 'success') {
      const isDonation = result.type === 'donation';
      setState('success', isDonation ? 'Thank you for your support!' : 'Thank you for your payment!',
        isDonation
          ? 'Your contribution has been verified. It helps us keep building, maintaining and improving the DEVZIKKY TECH project ecosystem.'
          : 'Your payment has been verified successfully. We appreciate your trust in DEVZIKKY TECH.',
        isDonation ? 'DONATION CONFIRMED' : 'PAYMENT CONFIRMED', '✓');
      if (details) {
        details.textContent = `${money(Number(result.amount) / 100, result.currency)} · ${reference}`;
        details.classList.remove('hidden');
      }
      document.querySelectorAll('[data-celebration]').forEach(item => item.classList.add('is-celebrating'));
      console.info('[DEVZIKKY PAY] Thank-you page confirmed payment', {
        reference,
        paymentType: result.type || 'unknown'
      });
    } else {
      setState(result.status || 'pending', 'Your payment is not confirmed yet.',
        'Paystack has not reported a successful payment. You can check again in a moment or contact support if you were debited.',
        `PAYMENT ${String(result.status || 'PENDING').toUpperCase()}`, '…');
      if (details) {
        details.textContent = reference;
        details.classList.remove('hidden');
      }
    }
  } catch (error) {
    setState('unverified', 'We could not verify this payment yet.',
      `${error.message} If you received a Paystack receipt, keep your reference and contact support before trying to pay again.`,
      'VERIFICATION NEEDED', '!');
    if (details) {
      details.textContent = reference;
      details.classList.remove('hidden');
    }
    console.error('[DEVZIKKY PAY] Thank-you verification failed', { message: error.message });
  }
}

async function statisticsPage() {
  if (!$("#statsChart")) return;

  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const shiftDate = (iso, days) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const isoToDmy = iso => {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  };
  const parseDmy = value => {
    const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const maskDmy = input => {
    const digits = input.value.replace(/\D/g, "").slice(0, 8);
    let value = digits.slice(0, 2);
    if (digits.length > 2) value += `/${digits.slice(2, 4)}`;
    if (digits.length > 4) value += `/${digits.slice(4, 8)}`;
    input.value = value;
  };
  const moneyNgn = value => `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const grainLabels = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
  let grain = "day";
  let lastStats = null;

  const fromInput = $("#statsFrom");
  const toInput = $("#statsTo");
  const todayISO = today();
  const earliestISO = shiftDate(todayISO, -1095);
  fromInput.value = isoToDmy(shiftDate(todayISO, -29));
  toInput.value = isoToDmy(todayISO);
  [fromInput, toInput].forEach(input => {
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.maxLength = 10;
    input.placeholder = "DD/MM/YYYY";
    input.setAttribute("aria-label", `${input.id === "statsFrom" ? "Start" : "End"} date, DD/MM/YYYY`);
    input.addEventListener("input", () => maskDmy(input));
  });

  const setHint = message => { $("#statsHint").textContent = message; };
  const safe = value => escapeHtml(value);
  const displayBucket = value => {
    const text = String(value ?? "");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
    return formatIsoDateDmy(text);
  };
  const renderBreakdown = (target, rows, nameKey, countKey, amountKey) => {
    const el = $(target);
    if (!rows.length) {
      el.innerHTML = '<div class="status-row"><div><strong>No records</strong><small>Nothing in this date range.</small></div><b>0</b></div>';
      return;
    }
    el.innerHTML = rows.map(row => `<div class="type-row"><div><strong>${safe(row[nameKey])}</strong><small>${Number(row[countKey] || 0).toLocaleString()} transactions</small></div><b>${moneyNgn(row[amountKey])}</b></div>`).join("");
  };
  const renderStatus = statuses => {
    const rows = [
      ["Successful", statuses.success, "Verified by Paystack", "var(--green)"],
      ["Pending", statuses.pending, "Awaiting final provider status", "var(--amber)"],
      ["Failed / reversed", statuses.failed, "Excluded from successful totals", "var(--pink)"]
    ];
    $("#statusBreakdown").innerHTML = rows.map(([name, item, desc, color]) =>
      `<div class="status-row"><div><strong style="color:${color}">${name}</strong><small>${desc}</small></div><b>${Number(item?.count || 0).toLocaleString()}</b></div>`
    ).join("");
  };
  const renderSeries = series => {
    const chart = $("#statsChart");
    const max = Math.max(1, ...series.map(x => Number(x.total || 0)));
    if (!series.length) {
      chart.innerHTML = "<p>No transaction activity exists in this selected window.</p>";
      $("#statsSeriesRows").innerHTML = '<tr><td colspan="6">No records found.</td></tr>';
      return;
    }
    chart.innerHTML = series.map(row => {
      const total = Number(row.total || 0);
      const h = Math.max(0, Math.min(100, total / max * 100));
      const success = Number(row.successful || 0) / Math.max(1, total) * h;
      const pending = Number(row.pending || 0) / Math.max(1, total) * h;
      const failed = Number(row.failed || 0) / Math.max(1, total) * h;
      const label = displayBucket(row.bucket);
      return `<div class="stats-bar-group" title="${safe(label)} · ${total} transactions"><div class="stats-bar-stack"><i class="stats-bar success" style="height:${success}%"></i><i class="stats-bar pending" style="height:${pending}%"></i><i class="stats-bar failed" style="height:${failed}%"></i></div><span class="stats-bar-label">${safe(label)}</span></div>`;
    }).join("");
    $("#statsSeriesRows").innerHTML = [...series].reverse().map(row =>
      `<tr><td>${safe(displayBucket(row.bucket))}</td><td>${Number(row.total).toLocaleString()}</td><td>${Number(row.successful).toLocaleString()}</td><td>${Number(row.pending).toLocaleString()}</td><td>${Number(row.failed).toLocaleString()}</td><td>${moneyNgn(row.successful_ngn)}</td></tr>`
    ).join("");
  };
  const renderRecent = rows => {
    $("#statsRecent").innerHTML = rows.length ? rows.map(row =>
      `<tr><td>${safe(row.reference)}</td><td>${moneyNgn(row.amount_ngn)}</td><td>${safe(row.type)}</td><td>${safe(formatLagosDateTime(row.paid_at))}</td></tr>`
    ).join("") : '<tr><td colspan="4">No verified payments in this window.</td></tr>';
  };

  async function loadStats() {
    const fromText = fromInput.value.trim();
    const toText = toInput.value.trim();
    const fromIso = parseDmy(fromText);
    const toIso = parseDmy(toText);
    if (!fromIso || !toIso) {
      setHint("Enter both dates as DD/MM/YYYY (for example, 10/11/2026). Check that the calendar dates are valid.");
      fromInput.setAttribute("aria-invalid", String(!fromIso));
      toInput.setAttribute("aria-invalid", String(!toIso));
      return;
    }
    fromInput.removeAttribute("aria-invalid");
    toInput.removeAttribute("aria-invalid");
    if (fromIso > toIso) {
      setHint("The start date must be on or before the end date. Use DD/MM/YYYY.");
      return;
    }
    if (toIso > todayISO) {
      setHint("The end date cannot be in the future.");
      return;
    }
    if (fromIso < earliestISO) {
      setHint(`The earliest available date is ${isoToDmy(earliestISO)} (three-year history).`);
      return;
    }
    const days = (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000;
    if (days > 1096) {
      setHint("The maximum selectable history is three years.");
      return;
    }
    setHint("Updating transaction analytics…");
    $("#statsApply").disabled = true;
    try {
      // Send the same DD/MM/YYYY format shown in the input fields.
      const data = await api(`stats?from=${encodeURIComponent(fromText)}&to=${encodeURIComponent(toText)}&grain=${grain}`);
      lastStats = data;
      $("#statsTotal").textContent = moneyNgn(data.totals.total_ngn);
      $("#statsSuccessCount").textContent = Number(data.totals.successful || 0).toLocaleString();
      $("#statsPendingCount").textContent = Number(data.totals.pending || 0).toLocaleString();
      $("#statsFailedCount").textContent = Number(data.totals.failed || 0).toLocaleString();
      $("#statsSuccessCaption").textContent = `${fromText} to ${toText} · Africa/Lagos`;
      $("#timelineTitle").textContent = `${grainLabels[grain]} payment activity`;
      renderStatus(data.statuses || {});
      renderSeries(data.series || []);
      renderBreakdown("#typeBreakdown", data.by_type || [], "type", "count", "total_ngn");
      const currencyEl = $("#currencyBreakdown");
      const currencyRows = data.by_currency || [];
      currencyEl.innerHTML = currencyRows.length ? currencyRows.map(row =>
        `<div class="type-row"><div><strong>${safe(row.currency)}</strong><small>${Number(row.count || 0).toLocaleString()} successful payments</small></div><b>${Number(row.total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${safe(row.currency)}</b></div>`
      ).join("") : '<div class="status-row"><div><strong>No records</strong><small>No verified payments in this window.</small></div><b>0</b></div>';
      renderRecent(data.recent || []);
      setHint(`Showing ${grainLabels[grain].toLowerCase()} aggregates from ${fromText} through ${toText}. Updated ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setHint(`Statistics could not be loaded: ${error.message}`);
      $("#statsChart").textContent = "Statistics are temporarily unavailable.";
      console.error("[DEVZIKKY PAY] Statistics page failed", {
        message: error.message, from: fromText, to: toText, grain
      });
    } finally {
      $("#statsApply").disabled = false;
    }
  }

  document.querySelectorAll("[data-grain]").forEach(button => button.addEventListener("click", () => {
    grain = button.dataset.grain;
    document.querySelectorAll("[data-grain]").forEach(item => item.classList.toggle("active", item === button));
    void loadStats();
  }));
  document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
    const days = Number(button.dataset.period);
    const to = today();
    toInput.value = isoToDmy(to);
    fromInput.value = isoToDmy(shiftDate(to, -(days - 1)));
    grain = days > 400 ? "month" : days > 100 ? "week" : "day";
    document.querySelectorAll("[data-grain]").forEach(item => item.classList.toggle("active", item.dataset.grain === grain));
    void loadStats();
  }));
  $("#statsApply").addEventListener("click", () => void loadStats());
  $("#downloadAggregate").addEventListener("click", () => {
    if (!lastStats) return;
    const rows = [["period","all","success","pending","failed","successful_ngn"],
      ...(lastStats.series || []).map(row => [displayBucket(row.bucket),row.total,row.successful,row.pending,row.failed,row.successful_ngn])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeFrom = fromInput.value.replace(/\//g, "-");
    const safeTo = toInput.value.replace(/\//g, "-");
    link.download = `devzikky-pay-${grain}-statistics-${safeFrom}-to-${safeTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
  await loadStats();
}

function buildTable(headers, rows) {
  return `<table>
    <thead><tr>${headers.map(value => `<th>${escapeHtml(value)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row =>
      `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`
    ).join("")}</tbody>
  </table>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

let adminTransactions = [];
let activeAdminStatus = "all";

function renderAdminTransactions() {
  const rows = adminTransactions.filter(row => {
    if (activeAdminStatus === "failed") return ["failed", "reversed"].includes(row.status);
    return activeAdminStatus === "all" || row.status === activeAdminStatus;
  });
  const labels = { all: "All transactions", success: "Successful transactions", pending: "Pending transactions", failed: "Failed / reversed transactions" };
  $("#adminStatusSummary").textContent = `${labels[activeAdminStatus]} · ${rows.length.toLocaleString()} records. CSV export includes this status only.`;
  $("#adminStatusDownload").href = `/api/admin/export?status=${encodeURIComponent(activeAdminStatus)}`;
  $("#adminRows").innerHTML = buildTable(
    ["Reference", "Name", "Email", "NGN", "Original", "Type", "Source", "Status", "Created"],
    rows.map(row => [
      row.reference, row.name, row.email, money(row.amount_ngn),
      `${row.original_amount} ${row.original_currency}`, row.type, row.source,
      row.status, formatLagosDateTime(row.created_at)
    ])
  );
  document.querySelectorAll("[data-admin-status]").forEach(button => {
    button.classList.toggle("primary", button.dataset.adminStatus === activeAdminStatus);
  });
}

async function adminPage() {
  const loginForm = $("#loginForm");
  if (!loginForm) return;

  const adminKeyInput = loginForm.elements.key;
  const toggleAdminKey = $("#toggleAdminKey");
  toggleAdminKey?.addEventListener("click", () => {
    const reveal = adminKeyInput.type === "password";
    adminKeyInput.type = reveal ? "text" : "password";
    toggleAdminKey.textContent = reveal ? "Hide" : "Show";
    toggleAdminKey.setAttribute("aria-pressed", String(reveal));
    toggleAdminKey.setAttribute("aria-label", reveal ? "Hide admin key" : "Show admin key");
  });

  document.querySelectorAll("[data-admin-status]").forEach(button => button.addEventListener("click", () => {
    activeAdminStatus = button.dataset.adminStatus;
    renderAdminTransactions();
  }));

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("#loginMessage");
    const button = loginForm.querySelector('button[type="submit"], button');
    const originalText = button.textContent;
    button.disabled = true;
    message.textContent = "Signing in…";
    try {
      await api("admin/login", {
        method: "POST",
        body: JSON.stringify({ key: loginForm.elements.key.value })
      });
      loginForm.reset();
      const loaded = await showAdmin(false);
      if (!loaded) throw new Error("Login was accepted, but admin records could not be loaded. Check Vercel logs.");
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
      console.error("[DEVZIKKY PAY] Admin sign-in failed", { message: error.message });
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  $("#logout").addEventListener("click", async () => {
    try {
      await api("admin/logout", { method: "POST", body: "{}" });
      $("#adminPanel").classList.add("hidden");
      $("#loginPanel").classList.remove("hidden");
      adminTransactions = [];
    } catch (error) {
      $("#loginMessage").textContent = error.message;
    }
  });
  await showAdmin(true);
}

async function showAdmin(quiet = false) {
  try {
    const data = await api("admin/transactions");
    adminTransactions = Array.isArray(data.transactions) ? data.transactions : [];
    renderAdminTransactions();
    $("#loginPanel").classList.add("hidden");
    $("#adminPanel").classList.remove("hidden");
    console.info("[DEVZIKKY PAY] Admin transactions loaded", { count: adminTransactions.length });
    return true;
  } catch (error) {
    if (!quiet) $("#loginMessage").textContent = error.message;
    return false;
  }
}

checkoutPage();
thankYouPage();
statisticsPage();
adminPage();
