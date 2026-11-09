(() => {
  let sent = 0;
  const MAX_PER_PAGE = 8;
  const reported = new Set();

  const safePath = value => {
    try { return new URL(String(value || '/'), location.origin).pathname.slice(0, 180); }
    catch (_) { return String(value || '/').split('?')[0].slice(0, 180); }
  };
  const redact = value => String(value || 'Unknown browser error')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api|admin)[_-]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 320);

  const report = (type, message, extra = {}) => {
    const cleanMessage = redact(message);
    const filename = safePath(extra.filename || '');
    const signature = `${type}:${cleanMessage}:${filename}:${extra.line || 0}`;
    if (reported.has(signature) || sent >= MAX_PER_PAGE) return;
    reported.add(signature);
    sent++;

    const payload = {
      type: String(type).slice(0, 40),
      message: cleanMessage,
      page: location.pathname.slice(0, 180),
      filename,
      line: Number(extra.line) || 0,
      column: Number(extra.column) || 0
    };

    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (_) {}
  };

  window.reportDzError = report;

  // Capture phase also sees non-bubbling script, stylesheet and image errors.
  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target !== window) {
      const tag = String(target.tagName || '').toUpperCase();
      if (!['SCRIPT', 'LINK', 'IMG', 'IFRAME'].includes(tag)) return;
      report('resource.error', `${tag} resource failed to load`, {
        filename: target.src || target.href || '',
        line: 0,
        column: 0
      });
      return;
    }
    report('window.error', event.message || event.error?.message || 'Script execution error', {
      filename: event.filename,
      line: event.lineno,
      column: event.colno
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    report('unhandledrejection', reason?.message || String(reason || 'Unhandled promise rejection'));
  });
})();
