(() => {
  'use strict';

  const root = document.querySelector('[data-journey]');
  if (!root) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const steps = Array.from(root.querySelectorAll('[data-journey-step]'));
  const image = root.querySelector('#journey-preview-image');
  const count = root.querySelector('[data-journey-preview-count]');
  const preview = root.querySelector('[data-journey-preview]');
  let activeIndex = 0;
  let swapTimer = 0;

  const activate = (index) => {
    const step = steps[index];
    if (!step) return;

    steps.forEach((item, itemIndex) => {
      const selected = itemIndex === index;
      item.classList.toggle('is-active', selected);
      if (selected) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });

    if (count) count.textContent = String(index + 1).padStart(2, '0');
    if (!image || index === activeIndex) {
      activeIndex = index;
      return;
    }

    window.clearTimeout(swapTimer);
    preview?.classList.add('is-changing');

    const commit = () => {
      image.src = step.dataset.src || image.src;
      image.alt = step.dataset.alt || '';
      window.requestAnimationFrame(() => preview?.classList.remove('is-changing'));
    };

    if (reducedMotion.matches) commit();
    else swapTimer = window.setTimeout(commit, 100);
    activeIndex = index;
  };

  steps.forEach((step, index) => {
    if (step.dataset.src) {
      const preload = new Image();
      preload.src = step.dataset.src;
    }
    step.addEventListener('click', () => activate(index));
    step.addEventListener('focus', () => activate(index));
    step.addEventListener('pointerenter', () => activate(index));
  });

  activate(0);
})();
