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

  const blueStory = document.querySelector('[data-blue-story]');
  const blueStoryLines = blueStory ? [...blueStory.querySelectorAll('.frameup-intro__line')] : [];
  const blueStoryFill = blueStory?.querySelector('[data-blue-fill]');
  const blueStoryCount = blueStory?.querySelector('[data-blue-story-count]');
  let blueStoryFrame = 0;
  const clamp01 = value => Math.min(1, Math.max(0, value));
  const smoothstep = value => {
    const progress = clamp01(value);
    return progress * progress * (3 - 2 * progress);
  };

  const updateBlueStory = () => {
    blueStoryFrame = 0;
    if (!blueStory || !blueStoryLines.length) return;

    if (reducedMotion.matches) {
      blueStory.style.setProperty('--story-progress', '1');
      blueStory.style.setProperty('--copy-opacity', '1');
      blueStoryFill?.style.setProperty('--fill-scale', '1');
      blueStoryLines.forEach((line, index) => {
        line.style.setProperty('--line-active', index === blueStoryLines.length - 1 ? '1' : '0');
        line.style.setProperty('--line-y', index === blueStoryLines.length - 1 ? '0px' : '-54px');
      });
      if (blueStoryCount) blueStoryCount.textContent = String(blueStoryLines.length).padStart(2, '0');
      return;
    }

    const rect = blueStory.getBoundingClientRect();
    const range = Math.max(1, blueStory.offsetHeight - window.innerHeight);
    const totalProgress = Math.min(1, Math.max(0, -rect.top / range));
    const fillProgress = smoothstep(totalProgress / .14);
    const copyProgress = smoothstep((totalProgress - .17) / .055);
    const textProgress = clamp01((totalProgress - .22) / .78);
    const activeFloat = textProgress * (blueStoryLines.length - 1);
    const activeIndex = Math.min(blueStoryLines.length - 1, Math.round(activeFloat));

    blueStory.style.setProperty('--story-progress', totalProgress.toFixed(4));
    blueStory.style.setProperty('--copy-opacity', copyProgress.toFixed(3));
    blueStoryFill?.style.setProperty('--fill-scale', (.003 + fillProgress * .997).toFixed(4));
    blueStoryLines.forEach((line, index) => {
      const distance = Math.abs(activeFloat - index);
      const active = copyProgress * (1 - smoothstep(distance / .72));
      line.style.setProperty('--line-active', active.toFixed(3));
      line.style.setProperty('--line-y', `${((index - activeFloat) * 54).toFixed(2)}px`);
    });
    if (blueStoryCount) blueStoryCount.textContent = String(activeIndex + 1).padStart(2, '0');
  };

  const queueBlueStory = () => {
    if (blueStoryFrame) return;
    blueStoryFrame = window.requestAnimationFrame(updateBlueStory);
  };

  window.addEventListener('scroll', queueBlueStory, { passive: true });
  window.addEventListener('resize', queueBlueStory);
  reducedMotion.addEventListener?.('change', updateBlueStory);
  updateBlueStory();

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
      creationImage.src = selected.dataset.src;
      creationImage.alt = selected.dataset.alt || '';
      if (creationCount) creationCount.textContent = String(index + 1).padStart(2, '0');
      creationTimer = window.setTimeout(() => {
        window.requestAnimationFrame(() => creationPreview.classList.remove('is-changing'));
      }, reducedMotion.matches ? 0 : 120);
    };

    const creationInterval = 1800;
    let creationCycle = 0;
    let creationIndex = 0;

    const stopCreationCycle = () => {
      window.clearInterval(creationCycle);
      creationCycle = 0;
    };

    const startCreationCycle = () => {
      if (creationCycle || reducedMotion.matches || creationSteps.length < 2) return;
      creationCycle = window.setInterval(() => {
        creationIndex = (creationIndex + 1) % creationSteps.length;
        setCreationStep(creationIndex);
      }, creationInterval);
    };

    // Only cycle while the section is on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) startCreationCycle();
          else stopCreationCycle();
        });
      }, { threshold: .35 }).observe(creationFlow);
    } else {
      startCreationCycle();
    }

    reducedMotion.addEventListener?.('change', () => {
      if (reducedMotion.matches) stopCreationCycle();
    });
  }

  // Rotating word in the hero headline.
  const titleSwap = document.querySelector('[data-title-swap]');
  if (titleSwap) {
    const swapWords = ['Ideas', 'Thoughts', 'Inspirations'];
    const swapDelay = 2400;
    const swapMove = 260;   // keep in step with the CSS width transition
    // The reserved box means the line width never changes, so the heading's
    // line count is fixed at every size. Gated at 900px only because the
    // reserved lead ("From Inspirations to") needs room to stay on one line.
    const swapWide = window.matchMedia('(min-width: 900px)');
    let swapTimer = 0;
    let swapFadeTimer = 0;
    let swapResize = 0;
    let swapIndex = 0;
    let swapWidths = [];

    // Per-word widths, so the box hugs each word and "to" follows it directly
    // with no reserved gap.
    const measureSwapWords = () => {
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none';
      titleSwap.parentNode.appendChild(probe);
      // The heading runs letter-spacing: -.035em, which pulls the last glyph's
      // advance width in tighter than its actual ink. Add that back, or the
      // container clips the final letter (the "s" of "Ideas").
      const tracking = Math.abs(parseFloat(getComputedStyle(probe).letterSpacing)) || 0;
      swapWidths = swapWords.map(word => {
        probe.textContent = word;
        return Math.ceil(probe.getBoundingClientRect().width + tracking);
      });
      probe.remove();
    };

    // Cross-fade in place: the incoming word is layered over the outgoing one
    // inside a box whose width never changes.
    const crossFadeTo = index => {
      // Drop any still-departing layer up front. Relying only on the cleanup
      // timeout lets layers pile up whenever timers are throttled (background
      // tab), so this keeps it to at most two at any moment.
      titleSwap.querySelectorAll('.how-title-word.is-leaving').forEach(el => el.remove());
      const outgoing = titleSwap.querySelector('.how-title-word:not(.is-leaving)');
      const incoming = document.createElement('span');
      incoming.className = 'how-title-word is-entering';
      incoming.textContent = swapWords[index];
      titleSwap.appendChild(incoming);
      if (swapWidths[index]) titleSwap.style.width = `${swapWidths[index]}px`;
      if (outgoing) outgoing.classList.add('is-leaving');
      // Flush styles so the entering state is the transition's start value,
      // rather than relying on a rAF that a background tab never fires.
      void incoming.offsetWidth;
      incoming.classList.remove('is-entering');
      swapFadeTimer = window.setTimeout(() => outgoing && outgoing.remove(), swapMove + 80);
    };

    const setSwapWord = index => {
      titleSwap.innerHTML = '';
      const word = document.createElement('span');
      word.className = 'how-title-word';
      word.textContent = swapWords[index];
      titleSwap.appendChild(word);
      if (swapWidths[index]) titleSwap.style.width = `${swapWidths[index]}px`;
    };

    const stopSwap = () => {
      window.clearInterval(swapTimer);
      window.clearTimeout(swapFadeTimer);
      swapTimer = 0;
      swapFadeTimer = 0;
    };

    const startSwap = () => {
      if (swapTimer || reducedMotion.matches || !swapWide.matches) return;
      swapTimer = window.setInterval(() => {
        swapIndex = (swapIndex + 1) % swapWords.length;
        crossFadeTo(swapIndex);
      }, swapDelay);
    };

    const resetSwap = () => {
      stopSwap();
      swapIndex = 0;
      if (reducedMotion.matches || !swapWide.matches) {
        titleSwap.style.removeProperty('width');
        setSwapWord(0);
        return;
      }
      measureSwapWords();
      setSwapWord(0);
      startSwap();
    };

    resetSwap();
    // Widths depend on the webfont, so re-measure once it lands.
    document.fonts?.ready.then(resetSwap);
    window.addEventListener('resize', () => {
      window.clearTimeout(swapResize);
      swapResize = window.setTimeout(resetSwap, 180);
    });
    swapWide.addEventListener?.('change', resetSwap);
    reducedMotion.addEventListener?.('change', resetSwap);

    // Don't run the timer while the hero is off screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) startSwap();
          else stopSwap();
        });
      }, { threshold: .2 }).observe(titleSwap.closest('.how-hero') || titleSwap);
    }
  }

  const requestJourney = document.querySelector('[data-request-journey]');
  const requestWindow = requestJourney?.querySelector('[data-request-window]');
  const requestTrack = requestJourney?.querySelector('[data-request-track]');
  const requestProgress = requestJourney?.querySelector('[data-request-progress]');
  const requestCount = requestJourney?.querySelector('[data-request-count]');
  const requestSteps = requestTrack ? [...requestTrack.children] : [];
  const padStep = index => String(index + 1).padStart(2, '0');
  const desktopJourney = window.matchMedia('(min-width: 861px)');
  // Edge fades ramp in over the first and last slice of travel, so the first
  // and last card sit fully crisp at either extreme.
  const fadeLeftMax = 26;
  const fadeRightMax = 130;
  const fadeRamp = .05;
  let requestFrame = 0;

  const updateRequestJourney = () => {
    requestFrame = 0;
    if (!requestJourney || !requestWindow || !requestTrack || !desktopJourney.matches) {
      requestTrack?.style.removeProperty('transform');
      requestProgress?.style.removeProperty('transform');
      requestWindow?.style.removeProperty('--how-brief-fade-l');
      requestWindow?.style.removeProperty('--how-brief-fade-r');
      requestSteps.forEach((step, index) => {
        if (index === 0) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
      if (requestCount) requestCount.textContent = padStep(0);
      return;
    }

    const rect = requestJourney.getBoundingClientRect();
    const scrollRange = Math.max(1, requestJourney.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, -rect.top / scrollRange));
    const travel = Math.max(0, requestTrack.scrollWidth - requestWindow.clientWidth);
    requestTrack.style.transform = `translate3d(${-travel * progress}px, 0, 0)`;
    if (requestProgress) requestProgress.style.transform = `scaleX(${progress})`;
    const fadeLeft = Math.min(1, progress / fadeRamp) * fadeLeftMax;
    const fadeRight = Math.min(1, (1 - progress) / fadeRamp) * fadeRightMax;
    requestWindow.style.setProperty('--how-brief-fade-l', `${fadeLeft.toFixed(1)}px`);
    requestWindow.style.setProperty('--how-brief-fade-r', `${fadeRight.toFixed(1)}px`);
    const activeIndex = Math.min(requestSteps.length - 1, Math.round(progress * (requestSteps.length - 1)));
    requestSteps.forEach((step, index) => {
      if (index === activeIndex) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    if (requestCount) requestCount.textContent = padStep(activeIndex);
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
