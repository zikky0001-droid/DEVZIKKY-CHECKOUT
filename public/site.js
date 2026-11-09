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
