// FrameUp AI Studio: scroll-in fades for [data-ais-reveal] (ai-studio.css).
// Only with prefers-reduced-motion: no-preference and IntersectionObserver;
// otherwise nothing is hidden. Elements added later: AIStudio.reveal(root).
(() => {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
  let observer = null;
  if (motion.matches && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('ais-motion');
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
  }
  function reveal(root = document) {
    const pending = [...root.querySelectorAll('[data-ais-reveal]:not(.is-in)')];
    pending.forEach(el => {
      if (observer) observer.observe(el); else el.classList.add('is-in');
    });
    if (!observer || !pending.length) return;
    // Safety net: never leave content invisible. Anything at or above the fold
    // (or inside a view that is still display:none) is shown after a moment
    // even if the observer never fires (background tab, odd layouts).
    setTimeout(() => {
      pending.forEach(el => {
        if (el.classList.contains('is-in')) return;
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('is-in');
          observer.unobserve(el);
        }
      });
    }, 1200);
  }
  // Reduced motion switched on mid-visit: show everything at once.
  motion.addEventListener?.('change', event => {
    if (event.matches) return;
    document.documentElement.classList.remove('ais-motion');
    document.querySelectorAll('[data-ais-reveal]').forEach(el => el.classList.add('is-in'));
  });
  window.AIStudio = Object.freeze({ reveal });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => reveal(), { once: true });
  else reveal();
})();
