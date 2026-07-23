(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealTargets = [...document.querySelectorAll('[data-how-reveal], [data-how-stagger]')];

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

  const journeySteps = [...document.querySelectorAll('[data-journey-step]')];
  const journeyProgress = document.querySelector('[data-journey-progress]');
  const journeyCount = document.querySelector('[data-journey-count]');
  const setJourneyStep = index => {
    journeySteps.forEach((step, stepIndex) => {
      const active = stepIndex === index;
      step.classList.toggle('is-active', active);
      if (active) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    if (journeyProgress) journeyProgress.style.transform = `scaleX(${(index + 1) / journeySteps.length})`;
    if (journeyCount) journeyCount.textContent = String(index + 1).padStart(2, '0');
  };

  if ('IntersectionObserver' in window && journeySteps.length) {
    const journeyObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setJourneyStep(Number(visible.target.dataset.journeyStep));
    }, { threshold: [0.35, 0.55, 0.75], rootMargin: '-18% 0px -35% 0px' });
    journeySteps.forEach(step => journeyObserver.observe(step));
  }
})();
