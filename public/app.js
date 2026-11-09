const $ = selector => document.querySelector(selector);
const money = (amount, currency="NGN") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);

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
  const responseText = await response.text();
  let data = {};
  let nonJson = false;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    nonJson = true;
    data = {
      error: responseText
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

    const available = Array.isArray(rateData.supported_currencies)
      ? rateData.supported_currencies
      : Object.keys(rateData.ngn_per_unit || {});

    currencySelect.innerHTML = available
      .map(code => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
      .join("");

    console.info("[DEVZIKKY PAY] Checkout currencies loaded", {
      count: available.length,
      rateDate: rateData.date,
      source: rateData.source
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
    const ngnRate = Number(rateData.ngn_per_unit?.[code]);
    const providerRate = Number(rateData.rates?.[code]);

    $("#currencyHint").textContent = code;

    if (amount > 0 && ngnRate > 0) {
      const estimateNgn = code === "NGN" ? amount : amount * ngnRate;
      const providerLine = code === "NGN"
        ? "NGN is the base currency"
        : `Provider rate: ₦1 = ${providerRate} ${code}`;
      estimate.textContent =
        `Estimated Paystack charge: ${money(estimateNgn, "NGN")} · ` +
        `${providerLine} · Rate date: ${rateData.date} · ${rateData.source}`;
    } else {
      estimate.textContent = `Rate date: ${rateData.date} · Source: ${rateData.source}`;
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
      const result = await api("pay/initialize", {
        method: "POST",
        body: JSON.stringify(values)
      });

      console.info("[DEVZIKKY PAY] Redirecting to Paystack", {
        reference: result.reference,
        originalCurrency: result.original_currency,
        rateDate: result.rate_date
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

async function statisticsPage() {
  if (!$("#total")) return;

  try {
    const data = await api("stats");
    $("#total").textContent = money(data.totals.total_ngn);
    $("#count").textContent = data.totals.successful;

    $("#currencies").innerHTML = buildTable(
      ["Currency", "Successful payments", "Original total"],
      data.by_currency.map(row => [
        row.currency,
        row.count,
        money(row.total, row.currency)
      ])
    );

    $("#recent").innerHTML = buildTable(
      ["Reference", "Amount (NGN)", "Type", "Date"],
      data.recent.map(row => [
        row.reference,
        money(row.amount_ngn),
        row.type,
        new Date(row.created_at).toLocaleDateString()
      ])
    );
  } catch (error) {
    $("#total").textContent = "Unavailable";
    $("#currencies").textContent = error.message;
    console.error("[DEVZIKKY PAY] Statistics page failed", {
      message: error.message
    });
  }
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

async function adminPage() {
  const loginForm = $("#loginForm");
  if (!loginForm) return;

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

      if (!loaded) {
        throw new Error("Login was accepted, but the admin data could not be loaded. Check the request ID and Vercel logs.");
      }

      message.textContent = "";
      console.info("[DEVZIKKY PAY] Admin dashboard opened");
    } catch (error) {
      message.textContent = error.message;
      console.error("[DEVZIKKY PAY] Admin sign-in failed", {
        message: error.message
      });
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
      console.info("[DEVZIKKY PAY] Admin signed out");
    } catch (error) {
      $("#loginMessage").textContent = error.message;
      console.error("[DEVZIKKY PAY] Admin logout failed", {
        message: error.message
      });
    }
  });

  // A 401 here simply means the visitor has not logged in yet.
  await showAdmin(true);
}

async function showAdmin(quiet = false) {
  try {
    const data = await api("admin/transactions");
    $("#adminRows").innerHTML = buildTable(
      ["Reference", "Name", "Email", "NGN", "Original", "Type", "Source", "Status", "Created"],
      data.transactions.map(row => [
        row.reference,
        row.name,
        row.email,
        money(row.amount_ngn),
        `${row.original_amount} ${row.original_currency}`,
        row.type,
        row.source,
        row.status,
        new Date(row.created_at).toLocaleString()
      ])
    );

    $("#loginPanel").classList.add("hidden");
    $("#adminPanel").classList.remove("hidden");
    console.info("[DEVZIKKY PAY] Admin transactions loaded", {
      count: data.transactions.length
    });
    return true;
  } catch (error) {
    if (!quiet) $("#loginMessage").textContent = error.message;
    if (error.message.includes("request ID")) {
      console.error("[DEVZIKKY PAY] Admin data load failed", {
        message: error.message
      });
    }
    return false;
  }
}

checkoutPage();
statisticsPage();
adminPage();
