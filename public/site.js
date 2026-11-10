(() => {
  const menu = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      menu.textContent = open ? '✕' : '☰';
    });
    nav.addEventListener('click', event => {
      if (event.target.closest('a')) {
        nav.classList.remove('open');
        menu.setAttribute('aria-expanded', 'false');
        menu.textContent = '☰';
      }
    });
  }

  // One theme preference is shared by every page on this origin.
  const THEME_KEY = 'devzikky-pay-theme';
  const getTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const updateThemeMeta = theme => {
    document.documentElement.style.colorScheme = theme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', theme === 'light' ? '#f5f7fc' : '#070910');
  };
  const paintThemeButton = button => {
    const theme = getTheme();
    const next = theme === 'dark' ? 'light' : 'dark';
    const icon = theme === 'dark' ? '☀' : '☾';
    const label = theme === 'dark' ? 'Light' : 'Dark';
    button.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${icon}</span><span class="theme-toggle-label">${label}</span>`;
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.setAttribute('title', `Switch to ${next} theme`);
    button.setAttribute('aria-pressed', String(theme === 'light'));
  };
  const headerInner = document.querySelector('.header-inner');
  if (headerInner) {
    let themeButton = headerInner.querySelector('[data-theme-toggle]');
    if (!themeButton) {
      themeButton = document.createElement('button');
      themeButton.type = 'button';
      themeButton.className = 'theme-toggle';
      themeButton.setAttribute('data-theme-toggle', '');
      const menuButton = headerInner.querySelector('[data-menu-toggle]');
      if (menuButton) headerInner.insertBefore(themeButton, menuButton);
      else headerInner.appendChild(themeButton);
    }
    paintThemeButton(themeButton);
    updateThemeMeta(getTheme());
    themeButton.addEventListener('click', () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      updateThemeMeta(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* Theme still changes for this page. */ }
      paintThemeButton(themeButton);
      document.dispatchEvent(new CustomEvent('dz:themechange', { detail: { theme: next } }));
    });
  }

  // Keep already-open tabs in sync when the theme is changed in another tab.
  window.addEventListener('storage', event => {
    if (event.key !== THEME_KEY || (event.newValue !== 'light' && event.newValue !== 'dark')) return;
    document.documentElement.setAttribute('data-theme', event.newValue);
    updateThemeMeta(event.newValue);
    const existingButton = document.querySelector('[data-theme-toggle]');
    if (existingButton) paintThemeButton(existingButton);
  });

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });
    revealItems.forEach(item => observer.observe(item));
  } else revealItems.forEach(item => item.classList.add('is-visible'));

  const backTop = document.querySelector('[data-back-top]');
  if (backTop) {
    const paint = () => backTop.classList.toggle('show', window.scrollY > 520);
    window.addEventListener('scroll', paint, { passive: true });
    paint();
    backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // A small circular tap ripple, suitable for touchscreens and mouse clicks.
  let activeRipples = 0;
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activeRipples >= 5) return;
    const ring = document.createElement('span');
    ring.className = 'dz-tap-ripple';
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    document.body.appendChild(ring);
    activeRipples++;
    window.setTimeout(() => { ring.remove(); activeRipples = Math.max(0, activeRipples - 1); }, 720);
  }, { passive: true });
})();
