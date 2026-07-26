(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealTargets = [...document.querySelectorAll('[data-how-reveal], [data-how-stagger]')];
  const headerOffset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-header-height')) || 72;

  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -5% 0px' });
    revealTargets.forEach(element => revealObserver.observe(element));
  }

  const smoothScrollTo = targetY => {
    if (reducedMotion.matches) {
      window.scrollTo(0, targetY);
      return;
    }
    const startY = window.scrollY;
    const distance = targetY - startY;
    const duration = 660;
    const startedAt = performance.now();
    const ease = progress => progress < .5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const step = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      window.scrollTo(0, startY + distance * ease(progress));
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash) return;
    const target = document.querySelector(url.hash);
    if (!target) return;
    event.preventDefault();
    smoothScrollTo(Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerOffset() * 1.1));
    window.history.pushState(null, '', url.hash);
  });

  const workflow = document.querySelector('[data-workflow]');
  const workflowCards = workflow ? [...workflow.querySelectorAll('[data-workflow-step]')] : [];
  const workflowProgress = workflow?.querySelector('.workflow-track span');
  let activeWorkflow = 0;
  let workflowTimer = 0;
  let workflowPaused = false;

  const setWorkflowStep = index => {
    activeWorkflow = (index + workflowCards.length) % workflowCards.length;
    workflowCards.forEach((card, cardIndex) => {
      const active = cardIndex === activeWorkflow;
      card.classList.toggle('is-active', active);
      if (active) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
    });
    if (workflowProgress) {
      workflowProgress.style.transform = `scaleY(${(activeWorkflow + 1) / workflowCards.length})`;
    }
  };

  const stopWorkflowTimer = () => window.clearInterval(workflowTimer);
  const startWorkflowTimer = () => {
    stopWorkflowTimer();
    if (reducedMotion.matches || workflowPaused || workflowCards.length < 2) return;
    workflowTimer = window.setInterval(() => setWorkflowStep(activeWorkflow + 1), 4800);
  };

  workflowCards.forEach((card, index) => {
    card.addEventListener('pointerenter', () => setWorkflowStep(index));
    card.addEventListener('focus', () => setWorkflowStep(index));
  });
  workflow?.addEventListener('pointerenter', () => { workflowPaused = true; stopWorkflowTimer(); });
  workflow?.addEventListener('pointerleave', () => { workflowPaused = false; startWorkflowTimer(); });
  workflow?.addEventListener('focusin', () => { workflowPaused = true; stopWorkflowTimer(); });
  workflow?.addEventListener('focusout', event => {
    if (workflow.contains(event.relatedTarget)) return;
    workflowPaused = false;
    startWorkflowTimer();
  });
  reducedMotion.addEventListener?.('change', startWorkflowTimer);
  setWorkflowStep(0);
  startWorkflowTimer();

  const scrollLinesSection = document.querySelector('[data-scroll-lines]');
  const scrollLines = scrollLinesSection ? [...scrollLinesSection.querySelectorAll('.frameup-intro__line')] : [];
  let scrollLinesFrame = 0;

  const updateScrollLines = () => {
    scrollLinesFrame = 0;
    if (!scrollLinesSection || !scrollLines.length) return;

    if (reducedMotion.matches) {
      scrollLines.forEach(line => {
        line.style.setProperty('--line-progress', '100%');
        line.style.setProperty('--cursor-opacity', '0');
      });
      return;
    }

    const rect = scrollLinesSection.getBoundingClientRect();
    const range = Math.max(1, scrollLinesSection.offsetHeight - window.innerHeight);
    const totalProgress = Math.min(1, Math.max(0, -rect.top / range));
    const segment = 1 / scrollLines.length;

    scrollLines.forEach((line, index) => {
      const start = index * segment;
      const localProgress = Math.min(1, Math.max(0, (totalProgress - start) / segment));
      const percent = `${Math.round(localProgress * 1000) / 10}%`;
      const cursorVisible = localProgress > 0 && localProgress < 1 ? '1' : '0';
      line.style.setProperty('--line-progress', percent);
      line.style.setProperty('--cursor-opacity', cursorVisible);
    });
  };

  const queueScrollLines = () => {
    if (scrollLinesFrame) return;
    scrollLinesFrame = window.requestAnimationFrame(updateScrollLines);
  };

  window.addEventListener('scroll', queueScrollLines, { passive: true });
  window.addEventListener('resize', queueScrollLines);
  reducedMotion.addEventListener?.('change', updateScrollLines);
  updateScrollLines();

  const creationFlow = document.querySelector('[data-creation-flow]');
  if (creationFlow) {
    const creationSteps = [...creationFlow.querySelectorAll('[data-creation-step]')];
    const creationPreview = creationFlow.querySelector('[data-creation-preview]');
    const creationImage = creationPreview?.querySelector('img');
    const creationCount = creationFlow.querySelector('[data-creation-count]');
    let creationTimer = 0;

    const setCreationStep = index => {
      const selected = creationSteps[index];
      if (!selected || !creationPreview || !creationImage) return;

      creationSteps.forEach((step, stepIndex) => {
        const active = stepIndex === index;
        step.classList.toggle('is-active', active);
        if (active) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });

      window.clearTimeout(creationTimer);
      creationPreview.classList.add('is-changing');
      creationTimer = window.setTimeout(() => {
        creationImage.src = selected.dataset.src;
        creationImage.alt = selected.dataset.alt || '';
        if (creationCount) creationCount.textContent = String(index + 1).padStart(2, '0');
        window.requestAnimationFrame(() => creationPreview.classList.remove('is-changing'));
      }, reducedMotion.matches ? 0 : 90);
    };

    creationSteps.forEach((step, index) => {
      step.addEventListener('click', () => setCreationStep(index));
      step.addEventListener('pointerenter', () => setCreationStep(index));
      step.addEventListener('focus', () => setCreationStep(index));
    });
  }

  const requestJourney = document.querySelector('[data-request-journey]');
  const requestWindow = requestJourney?.querySelector('[data-request-window]');
  const requestTrack = requestJourney?.querySelector('[data-request-track]');
  const requestProgress = requestJourney?.querySelector('[data-request-progress]');
  const requestSteps = requestTrack ? [...requestTrack.children] : [];
  const desktopJourney = window.matchMedia('(min-width: 861px)');
  let requestFrame = 0;

  const updateRequestJourney = () => {
    requestFrame = 0;
    if (!requestJourney || !requestWindow || !requestTrack || !desktopJourney.matches) {
      requestTrack?.style.removeProperty('transform');
      requestProgress?.style.removeProperty('transform');
      requestSteps.forEach((step, index) => {
        if (index === 0) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
      return;
    }

    const rect = requestJourney.getBoundingClientRect();
    const scrollRange = Math.max(1, requestJourney.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, -rect.top / scrollRange));
    const travel = Math.max(0, requestTrack.scrollWidth - requestWindow.clientWidth);
    requestTrack.style.transform = `translate3d(${-travel * progress}px, 0, 0)`;
    if (requestProgress) requestProgress.style.transform = `scaleX(${progress})`;
    const activeIndex = Math.min(requestSteps.length - 1, Math.round(progress * (requestSteps.length - 1)));
    requestSteps.forEach((step, index) => {
      if (index === activeIndex) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  };

  const queueRequestJourney = () => {
    if (requestFrame) return;
    requestFrame = window.requestAnimationFrame(updateRequestJourney);
  };

  window.addEventListener('scroll', queueRequestJourney, { passive: true });
  window.addEventListener('resize', queueRequestJourney);
  desktopJourney.addEventListener?.('change', updateRequestJourney);
  updateRequestJourney();
})();
