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
 * Logs safe request metadata to DevTools; server-side structured logs appear in the server environment.
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
    const errorPayload = data.error;
    const errorMessage = typeof errorPayload === "string"
      ? errorPayload
      : errorPayload?.message || data.message || "Request failed";
    const suffix = requestId || data.request_id
      ? ` (request ID: ${requestId || data.request_id})`
      : "";
    const apiError = new Error(`${errorMessage}${suffix}`);
    apiError.code = typeof errorPayload === "object" ? errorPayload?.code : data.code;
    throw apiError;
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
  const amountInput = form.elements.amount;
  const noteInput = form.elements.note;
  const noteCounter = $("#noteCounter");
  let paymentLimits = {
    minimum_amount_ngn: 100,
    maximum_amount_ngn: 5000000,
    toast_duration_ms: 5000
  };

  const toastDuration = () => {
    const configured = Number(paymentLimits.toast_duration_ms);
    return Number.isInteger(configured) && configured >= 1000 && configured <= 15000
      ? configured : 5000;
  };

  let toastTimer = null;
  let toastHost = null;
  function showPaymentToast(message, kind = "error") {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "dz-payment-toast-region";
      toastHost.setAttribute("aria-label", "Payment notifications");
      toastHost.setAttribute("aria-live", "polite");
      toastHost.setAttribute("aria-relevant", "additions text");
      document.body.appendChild(toastHost);
    }
    if (toastTimer) window.clearTimeout(toastTimer);
    toastHost.replaceChildren();

    const duration = toastDuration();
    const toast = document.createElement("div");
    toast.className = `dz-payment-toast dz-payment-toast-${kind}`;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");
    toast.style.setProperty("--toast-duration", `${duration}ms`);

    const progress = document.createElement("span");
    progress.className = "dz-payment-toast-progress";
    progress.setAttribute("aria-hidden", "true");

    const icon = document.createElement("span");
    icon.className = "dz-payment-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = kind === "error" ? "!" : "✓";

    const copy = document.createElement("span");
    copy.className = "dz-payment-toast-copy";
    const title = document.createElement("strong");
    title.textContent = kind === "error" ? "Payment amount needs attention" : "Checkout update";
    const body = document.createElement("span");
    body.textContent = String(message);
    copy.append(title, body);
    toast.append(progress, icon, copy);
    toastHost.appendChild(toast);

    toastTimer = window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 180);
    }, duration);
  }

  const updateNoteCounter = () => {
    if (noteInput && noteCounter) noteCounter.textContent = `${noteInput.value.length} / 200 characters`;
  };
  noteInput?.addEventListener("input", updateNoteCounter);
  updateNoteCounter();

  let rateData;
  try {
    const limitsData = await api("payment-limits");
    const minimum = Number(limitsData.minimum_amount_ngn);
    const maximum = Number(limitsData.maximum_amount_ngn);
    if (limitsData.currency !== "NGN" || !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) || minimum <= 0 || maximum < minimum) {
      throw new Error("Payment limit configuration returned invalid values.");
    }
    paymentLimits = {
      minimum_amount_ngn: minimum,
      maximum_amount_ngn: maximum,
      toast_duration_ms: Number(limitsData.toast_duration_ms) || 5000
    };
    $("#amountLimits").textContent =
      `Minimum: ₦${minimum.toLocaleString("en-NG")} | Maximum: ₦${maximum.toLocaleString("en-NG")} · Whole numbers only`;
    try {
      rateData = await loadRates();
    } catch (rateError) {
      // NGN checkout does not need FX rates. Keep it available while
      // temporarily disabling foreign currencies until rates recover.
      rateData = { base: "NGN", source: "ngn-only-fallback", rates: {} };
      window.__dzRates = rateData;
      $("#message").textContent = "Foreign-currency rates are temporarily unavailable. NGN payments are still available.";
      console.warn("[DEVZIKKY PAY] FX rates unavailable; keeping NGN checkout active", {
        message: rateError.message
      });
    }

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

  // Add thousands separators while preserving the cursor position.
  // Invalid characters are rejected; decimals are never silently truncated.
  let lastValidAmount = "";
  const formatAmountInput = () => {
    const original = amountInput.value;
    const cursor = amountInput.selectionStart ?? original.length;
    const digitsBeforeCursor = original.slice(0, cursor).replace(/\D/g, "").length;

    if (/[^0-9,]/.test(original)) {
      amountInput.value = lastValidAmount;
      const end = amountInput.value.length;
      try { amountInput.setSelectionRange(end, end); } catch {}
      showPaymentToast("Only whole numbers are accepted. Decimal amounts are not allowed.");
      updateEstimate();
      return false;
    }

    const digits = original.replace(/,/g, "");
    if (digits.length > 15) {
      amountInput.value = lastValidAmount;
      const end = amountInput.value.length;
      try { amountInput.setSelectionRange(end, end); } catch {}
      showPaymentToast("The entered amount is too long. Check the payment limits.");
      updateEstimate();
      return false;
    }

    const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    amountInput.value = formatted;
    lastValidAmount = formatted;

    let nextCursor = 0;
    let digitsSeen = 0;
    while (nextCursor < formatted.length && digitsSeen < digitsBeforeCursor) {
      if (/\d/.test(formatted[nextCursor])) digitsSeen += 1;
      nextCursor += 1;
    }
    try { amountInput.setSelectionRange(nextCursor, nextCursor); } catch {}
    updateEstimate();
    return true;
  };

  amountInput.addEventListener("beforeinput", event => {
    if (event.inputType?.startsWith("insert") && event.data && /[^0-9,]/.test(event.data)) {
      event.preventDefault();
      showPaymentToast("Only whole numbers are accepted. Decimal amounts are not allowed.");
    }
  });

  const updateEstimate = () => {
    const code = currencySelect.value;
    const digits = amountInput.value.replace(/,/g, "");
    const amount = digits && /^\d+$/.test(digits) ? Number(digits) : NaN;
    const providerRate = code === "NGN" ? 1 : Number(rateData.rates?.[code]);
    const ngnRate = code === "NGN" ? 1 :
      (Number.isFinite(providerRate) && providerRate > 0 ? 1 / providerRate : NaN);

    $("#currencyHint").textContent = code;

    if (Number.isSafeInteger(amount) && amount > 0 && Number.isFinite(ngnRate) && ngnRate > 0) {
      const rawEstimateNgn = code === "NGN" ? amount : amount * ngnRate;
      const estimateNgn = code === "NGN" ? amount : Math.ceil(rawEstimateNgn / 10) * 10;
      const providerLine = code === "NGN"
        ? "NGN is the base currency"
        : `Provider rate: ₦1 = ${providerRate} ${code}`;
      const fallbackDate = rateData.date ? ` · Snapshot date: ${formatIsoDateDmy(rateData.date)}` : "";
      estimate.textContent =
        `Estimated Paystack charge: ${new Intl.NumberFormat(undefined, { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(estimateNgn)} · ` +
        `${providerLine} · ${rateData.source}${fallbackDate}`;
    } else {
      const fallbackDate = rateData.date ? ` · Snapshot date: ${formatIsoDateDmy(rateData.date)}` : "";
      estimate.textContent = `Enter a whole-number amount. Rate source: ${rateData.source}${fallbackDate}`;
    }
  };

  amountInput.addEventListener("input", formatAmountInput);
  currencySelect.addEventListener("change", updateEstimate);
  // Also normalize an autofilled or restored value on initial page load.
  formatAmountInput();

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const digits = amountInput.value.replace(/,/g, "");
    if (!/^\d+$/.test(digits)) {
      showPaymentToast("Enter a whole-number amount using digits only.");
      amountInput.focus();
      return;
    }
    const enteredAmount = Number(digits);
    if (!Number.isSafeInteger(enteredAmount) || enteredAmount <= 0) {
      showPaymentToast("Enter a valid whole-number amount.");
      amountInput.focus();
      return;
    }

    const selectedCurrency = String(currencySelect.value || "NGN").toUpperCase();
    const providerRate = selectedCurrency === "NGN" ? 1 : Number(rateData?.rates?.[selectedCurrency]);
    const estimatedNgn = selectedCurrency === "NGN" ? enteredAmount :
      (providerRate > 0 ? enteredAmount / providerRate : NaN);
    const estimatedMinor = Math.round(estimatedNgn * 100);
    const minimumMinor = Math.round(paymentLimits.minimum_amount_ngn * 100);
    const maximumMinor = Math.round(paymentLimits.maximum_amount_ngn * 100);

    if (!Number.isSafeInteger(estimatedMinor) || estimatedMinor < minimumMinor) {
      showPaymentToast(`The minimum payment is ₦${paymentLimits.minimum_amount_ngn.toLocaleString("en-NG")} after currency conversion.`);
      amountInput.focus();
      return;
    }
    if (estimatedMinor > maximumMinor) {
      showPaymentToast(`The maximum payment is ₦${paymentLimits.maximum_amount_ngn.toLocaleString("en-NG")} after currency conversion.`);
      amountInput.focus();
      return;
    }

    const button = $("#payButton");
    button.disabled = true;
    $("#message").textContent = "Preparing secure checkout…";

    try {
      const values = Object.fromEntries(new FormData(form));
      // Commas are presentation-only and are removed before backend submission.
      values.amount = String(enteredAmount);
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
      showPaymentToast(error.message);
      console.error("[DEVZIKKY PAY] Checkout initialization failed", {
        message: error.message,
        code: error.code || null
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
    if (!series.length) {
      $("#statsSeriesRows").innerHTML = '<tr><td colspan="6">No records found.</td></tr>';
      return;
    }
    $("#statsSeriesRows").innerHTML = [...series].reverse().map(row =>
      `<tr><td>${safe(displayBucket(row.bucket))}</td><td>${Number(row.total).toLocaleString()}</td><td>${Number(row.successful).toLocaleString()}</td><td>${Number(row.pending).toLocaleString()}</td><td>${Number(row.failed).toLocaleString()}</td><td>${moneyNgn(row.successful_ngn)}</td></tr>`
    ).join("");
  };
  const renderRecent = rows => {
    $("#statsRecent").innerHTML = rows.length ? rows.map(row =>
      `<tr><td>${safe(row.reference)}</td><td>${moneyNgn(row.amount_ngn)}</td><td>${safe(row.type)}</td><td>${safe(formatLagosDateTime(row.paid_at))}</td><td class="public-note-cell">${safe(row.public_note || "—")}</td></tr>`
    ).join("") : '<tr><td colspan="5">No verified payments in this window.</td></tr>';
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
      window.dispatchEvent(new CustomEvent("dz:stats-updated", { detail: data }));
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
    const fromText = fromInput.value.trim();
    const toText = toInput.value.trim();
    if (!parseDmy(fromText) || !parseDmy(toText)) {
      setHint("Enter valid dates as DD/MM/YYYY before exporting chart data.");
      return;
    }
    if (!lastStats) {
      setHint("Load Statistics successfully before exporting chart data.");
      return;
    }
    const query = new URLSearchParams({
      from: fromText,
      to: toText,
      grain,
      download: "json"
    });
    setHint("Preparing your pretty-printed Statistics JSON download…");
    window.location.assign(`/api/stats?${query.toString()}`);
  });

  $("#downloadPublicTransactions").addEventListener("click", () => {
    const fromText = fromInput.value.trim();
    const toText = toInput.value.trim();
    if (!parseDmy(fromText) || !parseDmy(toText)) {
      setHint("Enter valid dates as DD/MM/YYYY before exporting transaction details.");
      return;
    }
    const query = new URLSearchParams({ from: fromText, to: toText });
    setHint("Preparing your public transaction JSON download…");
    window.location.assign(`/api/stats/export?${query.toString()}`);
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
  const summary = $("#adminStatusSummary");
  if (summary) {
    summary.textContent = `${labels[activeAdminStatus]} · ${rows.length.toLocaleString()} records shown. JSON export includes every matching record, not only the latest 500 shown here.`;
  }
  const jsonDownload = $("#adminStatusJsonDownload");
  if (jsonDownload) {
    jsonDownload.href = `/api/admin/export?status=${encodeURIComponent(activeAdminStatus)}`;
    jsonDownload.textContent = `Export ${activeAdminStatus === "all" ? "all" : activeAdminStatus} records · JSON ↓`;
  }
  const table = rows.length ? `<table class="admin-transactions-table">
    <thead><tr>${["Reference", "Donor", "Amount received", "Original amount", "Type", "Donor note", "Visibility", "Source", "Status", "Created · Lagos", "Paid · Lagos"].map(value => `<th>${escapeHtml(value)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td><span class="admin-reference">${escapeHtml(row.reference)}</span></td>
      <td><span class="admin-donor-name">${escapeHtml(row.name || "Anonymous")}</span><span class="admin-donor-email">${escapeHtml(row.email || "—")}</span></td>
      <td><span class="admin-amount">${escapeHtml(money(row.amount_ngn))}</span><span class="admin-currency">NGN received</span></td>
      <td><span class="admin-original-amount">${escapeHtml(row.original_amount ?? "—")}</span><span class="admin-currency">${escapeHtml(row.original_currency || "")}</span></td>
      <td><span class="admin-type-pill">${escapeHtml(row.type || "—")}</span></td>
      <td class="admin-note-cell"><span title="${escapeHtml(row.note || "")}">${escapeHtml(row.note || "No note supplied")}</span></td>
      <td><span class="admin-note-visibility ${row.note_public ? "is-public" : "is-private"}">${row.note_public ? "✦ Public" : "🔒 Private"}</span></td>
      <td>${escapeHtml(row.source || "—")}</td>
      <td><span class="admin-status-pill status-${escapeHtml(String(row.status || "unknown").toLowerCase())}">${escapeHtml(row.status || "Unknown")}</span></td>
      <td><span class="admin-date">${escapeHtml(formatLagosDateTime(row.created_at))}</span></td>
      <td><span class="admin-date">${escapeHtml(formatLagosDateTime(row.paid_at))}</span></td>
    </tr>`).join("")}</tbody>
  </table>` : '<div class="admin-empty-state"><span>◎</span><strong>No transactions found</strong><p>There are no records in this status filter yet.</p></div>';
  const rowsContainer = $("#adminRows");
  if (rowsContainer) rowsContainer.innerHTML = table;
  document.querySelectorAll("[data-admin-status]").forEach(button => {
    button.classList.toggle("primary", button.dataset.adminStatus === activeAdminStatus);
    button.setAttribute("aria-pressed", String(button.dataset.adminStatus === activeAdminStatus));
  });
}

async function downloadAdminExport(link) {
  const message = $("#adminActionMessage");
  const originalText = link.textContent;
  link.setAttribute("aria-busy", "true");
  link.textContent = "Preparing JSON…";
  if (message) message.textContent = "";
  try {
    const response = await fetch(link.getAttribute("href"), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });
    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON error handled below */ }
      const detail = payload.error || `JSON export failed (HTTP ${response.status}).`;
      if (response.status === 401) {
        throw new Error(`${detail} Make sure you are signed in on this exact domain, then sign in again.${requestId ? ` Request ID: ${requestId}` : ""}`);
      }
      throw new Error(`${detail}${requestId ? ` Request ID: ${requestId}` : ""}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("The export endpoint did not return a JSON document.");
    const blob = await response.blob();
    // Validate the downloaded payload before saving it as a .json file.
    const jsonText = await blob.text();
    try { JSON.parse(jsonText); } catch { throw new Error("The server response is not valid JSON; no file was downloaded."); }
    const jsonBlob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const filename = filenameMatch?.[1] || "devzikky-pay-transactions.json";
    const objectUrl = URL.createObjectURL(jsonBlob);
    const download = document.createElement("a");
    download.href = objectUrl;
    download.download = filename;
    document.body.appendChild(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    if (message) message.textContent = `Downloaded ${filename}.`;
  } catch (error) {
    if (message) message.textContent = error.message;
    console.error("[DEVZIKKY PAY] Admin export failed", { message: error.message });
  } finally {
    link.removeAttribute("aria-busy");
    link.textContent = originalText;
  }
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
  document.querySelectorAll("[data-admin-export]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      void downloadAdminExport(link);
    });
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("#loginMessage");
    const button = loginForm.querySelector('button[type="submit"], button');
    const originalText = button?.textContent || "Sign in securely ↗";
    if (button) button.disabled = true;
    if (message) message.textContent = "Signing in…";
    try {
      await api("admin/login", {
        method: "POST",
        body: JSON.stringify({ key: loginForm.elements.key.value })
      });
      loginForm.reset();
      const loaded = await showAdmin(false);
      if (!loaded) throw new Error(message.textContent || "Login succeeded, but the transaction list could not be loaded. Check the request ID and server logs.");
      if (message) message.textContent = "";
    } catch (error) {
      if (message) message.textContent = error.message;
      console.error("[DEVZIKKY PAY] Admin sign-in failed", { message: error.message });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  });

  $("#logout")?.addEventListener("click", async () => {
    try {
      await api("admin/logout", { method: "POST", body: "{}" });
      $("#adminPanel")?.classList.add("hidden");
      $("#loginPanel")?.classList.remove("hidden");
      adminTransactions = [];
    } catch (error) {
      const message = $("#loginMessage");
      if (message) message.textContent = error.message;
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
    const message = $("#loginMessage");
    if (!quiet && message) message.textContent = error.message;
    return false;
  }
}

checkoutPage();
thankYouPage();
statisticsPage();
adminPage();
logsPage();


async function logsPage() {
  const loginForm = $("#logsLoginForm");
  if (!loginForm) return;

  const loginPanel = $("#logsLoginPanel");
  const logsPanel = $("#logsPanel");
  const keyInput = $("#logsAdminKey");
  const keyToggle = $("#toggleLogsKey");
  const loginMessage = $("#logsLoginMessage");
  const statusMessage = $("#logsStatusMessage");
  const logsList = $("#logsList");
  const levelFilter = $("#logsLevelFilter");
  const statusFilter = $("#logsStatusFilter");
  const searchInput = $("#logsSearch");
  let allLogs = [];
  let isLoading = false;
  let autoRefreshInterval = null;
  const AUTO_REFRESH_MS = 60 * 1000;
  const refreshButton = $("#logsRefresh");
  const loginSubmit = loginForm.querySelector('button[type="submit"]');
  if (loginSubmit) loginSubmit.disabled = true;

  const stopAutoRefresh = () => {
    if (autoRefreshInterval !== null) {
      window.clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  };
  const startAutoRefresh = () => {
    if (autoRefreshInterval !== null) return;
    autoRefreshInterval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void loadLogs(true, true);
    }, AUTO_REFRESH_MS);
  };
  const showLogin = message => {
    stopAutoRefresh();
    logsPanel.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    if (message && loginMessage) loginMessage.textContent = message;
  };
  const showWorkspace = () => {
    loginPanel.classList.add("hidden");
    logsPanel.classList.remove("hidden");
    startAutoRefresh();
  };
  const lagosTime = value => {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return "Unknown time";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).format(date) + " WAT";
  };

  const renderLogs = () => {
    const level = levelFilter.value;
    const status = statusFilter.value;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allLogs.filter(item => {
      if (level !== "all" && String(item.level).toLowerCase() !== level) return false;
      const code = Number(item.status_code || 0);
      if (status === "5xx" && !(code >= 500 && code <= 599)) return false;
      if (status === "4xx" && !(code >= 400 && code <= 499)) return false;
      if (status === "2xx" && !(code >= 200 && code <= 299)) return false;
      if (query) {
        const haystack = [item.message, item.path, item.request_id, item.domain, item.deployment_id, item.method, item.status_code]
          .join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    $("#logsFilteredCount").textContent = `${filtered.length} shown · ${allLogs.length} fetched`;
    if (!filtered.length) {
      logsList.innerHTML = '<div class="logs-empty-state"><span>◎</span><strong>No matching runtime events</strong><p>Try another severity, status or search term.</p></div>';
      return;
    }
    logsList.innerHTML = filtered.map(item => {
      const severity = String(item.level || "info").toLowerCase();
      const statusCode = item.status_code == null ? "LOG" : String(item.status_code);
      const statusClass = item.status_code == null ? "neutral" : Number(statusCode) >= 500 ? "error" : Number(statusCode) >= 400 ? "warning" : "ok";
      const method = escapeHtml(item.method || "—");
      const route = escapeHtml(item.path || "(no request path)");
      const message = escapeHtml(item.message || "Runtime event");
      const requestId = escapeHtml(item.request_id || "Not provided");
      const deployment = escapeHtml(item.deployment_id || "Unknown deployment");
      const source = escapeHtml(item.source || "function");
      const domain = escapeHtml(item.domain || "");
      const service = escapeHtml(item.service || "Not provided");
      const region = escapeHtml(item.region || "Not provided");
      const runtime = escapeHtml(item.runtime || "Not provided");
      const stream = escapeHtml(item.stream || "Not provided");
      const branch = escapeHtml(item.branch || "Not provided");
      const traceId = escapeHtml(item.trace_id || "Not provided");
      return `<article class="runtime-log-card level-${escapeHtml(severity)}"><div class="runtime-log-top"><span class="runtime-level">${escapeHtml(severity.toUpperCase())}</span><time>${escapeHtml(lagosTime(item.timestamp_ms))}</time><span class="runtime-status status-${statusClass}">${escapeHtml(statusCode)}</span></div><div class="runtime-log-route"><span class="runtime-method">${method}</span><code>${route}</code></div><p class="runtime-log-message">${message}</p><div class="runtime-log-meta"><span>${domain || service || source}</span><span>Request: ${requestId}</span></div><details><summary>Deployment and event details</summary><dl><dt>Deployment</dt><dd>${deployment}</dd><dt>Source</dt><dd>${source}</dd><dt>Service</dt><dd>${service}</dd><dt>Region</dt><dd>${region}</dd><dt>Runtime</dt><dd>${runtime}</dd><dt>Stream</dt><dd>${stream}</dd><dt>Branch</dt><dd>${branch}</dd><dt>Trace ID</dt><dd>${traceId}</dd><dt>Request ID</dt><dd>${requestId}</dd><dt>Raw timestamp</dt><dd>${escapeHtml(item.timestamp_ms || "—")}</dd><dt>Message truncated</dt><dd>${item.message_truncated ? "Yes" : "No"}</dd></dl></details></article>`;
    }).join("");
  };

  async function loadLogs(quiet = false, bypassCache = true) {
    if (isLoading) return;
    isLoading = true;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Refreshing…";
      refreshButton.setAttribute("aria-busy", "true");
    }
    if (statusMessage) statusMessage.textContent = "Requesting the last hour of production runtime logs from Vercel…";
    try {
      const refreshQuery = bypassCache ? "&refresh=1" : "";
      const data = await api(`admin/logs?limit=100${refreshQuery}`);
      allLogs = Array.isArray(data.logs) ? data.logs : [];
      $("#logsCount").textContent = Number(data.count ?? allLogs.length).toLocaleString();
      $("#logsErrorCount").textContent = allLogs.filter(item => item.level === "error" || Number(item.status_code) >= 500).length.toLocaleString();
      $("#logsDeploymentCount").textContent = Number(data.deployments_scanned || 0).toLocaleString();
      const fetchedAt = new Date(data.fetched_at || Date.now());
      $("#logsLastRefresh").textContent = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      }).format(fetchedAt);
      const moreText = data.has_more ? " More matching entries are available beyond the 100-entry page." : "";
      if (statusMessage) statusMessage.textContent = `${allLogs.length} runtime entries loaded from the newest production deployment for the last ${Number(data.history_hours || 1)} hour. Auto-refresh runs every 60 seconds.${moreText}`;
      renderLogs();
      showWorkspace();
    } catch (error) {
      if (error.status === 401 || /Runtime Logs authentication required/i.test(error.message)) {
        showLogin("Your Runtime Logs session has expired. Sign in again.");
      } else {
        // An upstream Vercel failure does not invalidate the independent Logs session.
        // Keep the last successful records visible while the next retry is pending.
        showWorkspace();
        if (statusMessage) statusMessage.textContent = allLogs.length
          ? `Refresh failed: ${error.message} Previously loaded entries remain visible.`
          : error.message;
        if (!allLogs.length && logsList) logsList.innerHTML = '<div class="logs-empty-state"><strong>Logs are temporarily unavailable</strong><p>Your session is still active. Check the Vercel integration and refresh.</p></div>';
      }
      if (!quiet) console.error("[DEVZIKKY PAY] Server runtime logs failed", { message: error.message });
    } finally {
      isLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "↻ Refresh logs";
        refreshButton.setAttribute("aria-busy", "false");
      }
    }
  }

  keyToggle?.addEventListener("click", () => {
    const reveal = keyInput.type === "password";
    keyInput.type = reveal ? "text" : "password";
    keyToggle.textContent = reveal ? "Hide" : "Show";
    keyToggle.setAttribute("aria-pressed", String(reveal));
    keyToggle.setAttribute("aria-label", reveal ? "Hide admin key" : "Show admin key");
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = "Signing in…"; }
    if (loginMessage) loginMessage.textContent = "Verifying Runtime Logs credentials…";
    try {
      await api("logs/login", { method: "POST", body: JSON.stringify({ key: keyInput.value }) });
      loginForm.reset();
      if (loginMessage) loginMessage.textContent = "";
      showWorkspace();
      // Do not make successful authentication wait for the Vercel Logs API.
      void loadLogs(false, true);
    } catch (error) {
      if (loginMessage) loginMessage.textContent = error.message;
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = "Sign in securely ↗"; }
    }
  });

  refreshButton?.addEventListener("click", () => void loadLogs(false, true));
  $("#logsLogout")?.addEventListener("click", async () => {
    try {
      await api("logs/logout", { method: "POST", body: "{}" });
      allLogs = [];
      showLogin("You have been signed out of Runtime Logs. The Control Room session is unchanged.");
      if (logsList) logsList.innerHTML = '<div class="logs-empty-state">Sign in to load runtime logs.</div>';
    } catch (error) {
      if (statusMessage) statusMessage.textContent = error.message;
    }
  });
  [levelFilter, statusFilter].forEach(input => input?.addEventListener("change", renderLogs));
  searchInput?.addEventListener("input", renderLogs);

  window.addEventListener("pagehide", stopAutoRefresh, { once: true });

  // Check only the Logs cookie. This endpoint never contacts Vercel.
  try {
    const session = await api("logs/session");
    if (session.authenticated) {
      showWorkspace();
      void loadLogs(true, true);
    } else {
      showLogin("");
    }
  } catch (error) {
    showLogin("Could not verify your Runtime Logs session. Please refresh and try again.");
    if (loginMessage) loginMessage.textContent = error.message;
  } finally {
    if (loginSubmit) loginSubmit.disabled = false;
  }
}

