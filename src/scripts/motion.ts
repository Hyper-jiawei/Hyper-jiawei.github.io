// One shared observer, no scroll handlers. Content stays visible without JS.
// Until the first observer callback, html.enter-pending (set in Base.astro's
// head) keeps [data-enter] hidden, so nothing is painted and then re-animated.
const root = document.documentElement;
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const targets = [...document.querySelectorAll<HTMLElement>('[data-enter]')];

if (!preference.matches && 'IntersectionObserver' in window && targets.length) {
  root.dataset.motion = '';
  let remaining = targets.length;
  let first = true;
  const observer = new IntersectionObserver((entries) => {
    let delay = 0;
    for (const entry of entries) {
      // on the first pass, anything already peeking into view (inside the
      // -24px margin) enters too, or it would show now and re-animate later
      const r = entry.boundingClientRect;
      const peeking = first && r.top < innerHeight && r.bottom > 0;
      if (!entry.isIntersecting && !peeking) continue;
      const target = entry.target as HTMLElement;
      observer.unobserve(target);
      remaining--;
      // Recheck the preference in case it changed while this page was open.
      if (!preference.matches) {
        target.style.setProperty('--enter-delay', `${delay}ms`);
        target.classList.add('enter-visible');
        delay = Math.min(delay + 35, 105);
      }
    }
    // the first callback has sorted what is on screen; the rest animates on scroll
    first = false;
    root.classList.remove('enter-pending');
    if (!remaining) observer.disconnect();
  }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });
  targets.forEach((target) => observer.observe(target));
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
} else {
  root.classList.remove('enter-pending');
}
