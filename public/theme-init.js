(() => {
  const STORAGE_KEY = 'devzikky-pay-theme';
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch (_) {
    // Private browsing/storage restrictions should not prevent the site from rendering.
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
})();
