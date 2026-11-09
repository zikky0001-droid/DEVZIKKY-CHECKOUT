(() => {
  const root = document.getElementById('dzLoader');
  if (!root) return;
  const fill = root.querySelector('[data-loader-fill]');
  const percent = root.querySelector('[data-loader-percent]');
  const subtitle = root.querySelector('[data-loader-subtitle]');
  const status = root.querySelector('[data-loader-status]');
  const skip = root.querySelector('[data-loader-skip]');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = prefersReduced ? 900 : 6200;
  const phrases = [
    'Preparing your DEVZIKKY PAY experience',
    'Connecting the story behind the software',
    'Arranging the tools, projects and details',
    'Polishing the interface and interactions',
    'Making room for the next useful idea',
    'Almost ready — welcome in'
  ];
  const started = performance.now();
  let finished = false;
  let phraseIndex = 0;
  subtitle.textContent = phrases[0];
  const phraseTimer = window.setInterval(() => {
    phraseIndex = (phraseIndex + 1) % phrases.length;
    subtitle.textContent = phrases[phraseIndex];
  }, 1050);
  const dismiss = () => {
    if (finished) return;
    finished = true;
    window.clearInterval(phraseTimer);
    fill.style.width = '100%';
    percent.textContent = '100%';
    status.textContent = 'READY · WELCOME';
    root.classList.add('is-done');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('loader-active');
    window.setTimeout(() => root.remove(), 800);
  };
  skip?.addEventListener('click', dismiss);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !finished) dismiss();
  }, { once: true });
  const tick = now => {
    if (finished) return;
    const ratio = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - ratio, 2.2);
    const value = Math.min(99, Math.round(eased * 100));
    fill.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    status.textContent = ratio < .3 ? 'INITIALIZING' : ratio < .72 ? 'PREPARING INTERFACE' : 'FINAL TOUCHES';
    if (ratio >= 1) dismiss();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
