// FrameUp tour engine: a spotlight (dimmed page with a cut-out around one real
// element) and a small coach-mark card. No libraries. Styles: frameup-tour.css.
//
//   FrameUpTour.register({ id, label, steps: [...] })
//   FrameUpTour.start('welcome' | tourObject, { startAt, onEnd })
//   FrameUpTour.stop()
//
// A step:
//   title, text       Short copy. Keep text to one or two lines.
//   target            CSS selector, or a list of selectors (first visible wins).
//                     No target = a centred card over a dimmed page.
//   page              File the step lives on ('generate.html'). Omit = any page.
//   pageLabel         Name used in the "Continue on <page>" card.
//   route             Hash on that page ('#instagram'), or a function returning
//                     one (or null to stay where the person is).
//   media             Media query the step needs ('(min-width: 901px)').
//   when              Function; false skips the step.
//   placement         'auto' (default), 'right', 'left', 'bottom' or 'top'.
//   nextLabel         Override the Next button label for this step.
//
// Missing or hidden targets are skipped quietly. Multi-page tours keep their
// place in sessionStorage and resume after the next page loads.
// Events on window: 'frameup:tour-start' and 'frameup:tour-end'
// (detail: { id, completed, reason }).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpTour = api;
})(typeof window !== 'undefined' ? window : globalThis, function (win) {
  'use strict';

  const doc = win.document;
  const RESUME_KEY = 'frameup.tour.resume';
  const RESUME_MAX_AGE = 2 * 60 * 1000;
  const WAIT_SHORT = 600;
  const WAIT_LONG = 6000;
  const GAP = 14;
  const MARGIN = 16;
  const NARROW = '(max-width: 600px)';

  // Site root, from this script's own URL (pages live in / and /ai-page/).
  const scriptSrc = (doc && doc.currentScript && doc.currentScript.src) || '';
  const rootUrl = scriptSrc ? new URL('.', scriptSrc).href : '';

  const registry = new Map();
  let run = null;          // the tour in progress
  let ui = null;           // the overlay nodes, built once

  // ─── Small pure helpers (also used by scripts/test-tour.mjs) ─────────

  /** File name of the current page, relative to the site root ('ai-page/profile.html'). */
  function pageFile(location = win.location) {
    const path = (location && location.pathname) || '/';
    const inAiPage = /\/ai-page\//.test(path);
    const file = path.split('/').pop() || 'index.html';
    return (inAiPage ? 'ai-page/' : '') + file;
  }

  function samePage(page, location = win.location) {
    if (!page) return true;
    return String(page).split(/[?#]/)[0] === pageFile(location);
  }

  function prefersReducedMotion() {
    try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (error) { return false; }
  }

  function mediaMatches(query) {
    if (!query) return true;
    try { return win.matchMedia(query).matches; } catch (error) { return true; }
  }

  /** True when an element is rendered, has size and is not hidden by CSS. */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    // Hidden or inert ancestors are things like closed menus and other views.
    if (el.closest && el.closest('[hidden], [inert]')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = win.getComputedStyle(el);
    // Opacity is ignored on purpose: entrance animations start at 0.
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  }

  /** First visible element for a step's target (string or list of selectors). */
  function resolveTarget(target, root = doc) {
    if (!target) return null;
    const selectors = Array.isArray(target) ? target : [target];
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = [...root.querySelectorAll(selector)]; } catch (error) { nodes = []; }
      const hit = nodes.find(isVisible);
      if (hit) return hit;
    }
    return null;
  }

  /** Whether a step applies here at all (media query + `when`). */
  function stepApplies(step) {
    if (!step) return false;
    if (!mediaMatches(step.media)) return false;
    if (typeof step.when === 'function') {
      try { return Boolean(step.when()); } catch (error) { return false; }
    }
    return true;
  }

  /**
   * Next index from `from` moving by `dir` (+1/-1) whose step passes
   * `isUsable(step, index)`. Returns -1 when the tour runs out.
   */
  function findStep(steps, from, dir, isUsable) {
    for (let i = from; i >= 0 && i < steps.length; i += dir) {
      if (isUsable(steps[i], i)) return i;
    }
    return -1;
  }

  function resolveRoute(step) {
    if (typeof step.route === 'function') {
      try { return step.route() || null; } catch (error) { return null; }
    }
    return step.route || null;
  }

  function pageUrl(page, route) {
    const base = rootUrl || new URL('.', win.location.href).href;
    const url = new URL(page, base);
    if (route) url.hash = route.replace(/^#?/, '#');
    return url.href;
  }

  // Waits for the target to appear (pages build parts of their UI late).
  function waitForTarget(target, timeout, isCurrent) {
    return new Promise(resolve => {
      const started = Date.now();
      const check = () => {
        if (!isCurrent()) return resolve(null);
        const el = resolveTarget(target);
        if (el) return resolve(el);
        if (Date.now() - started >= timeout) return resolve(null);
        win.setTimeout(check, 80);
      };
      check();
    });
  }

  // requireAuth hides the page until the session is confirmed: wait for it.
  function whenPageVisible(timeout = 15000) {
    return new Promise(resolve => {
      const started = Date.now();
      const check = () => {
        const hidden = doc.documentElement.style.visibility === 'hidden';
        if (!hidden && doc.body) return resolve(true);
        if (Date.now() - started > timeout) return resolve(false);
        win.setTimeout(check, 120);
      };
      check();
    });
  }

  // ─── Overlay ──────────────────────────────────────────────────────────

  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  function supportsPopover() {
    return Boolean(doc && doc.documentElement && typeof doc.documentElement.showPopover === 'function');
  }

  function buildUi() {
    if (ui) return ui;
    const layer = doc.createElement('div');
    layer.className = 'fu-tour';
    layer.hidden = true;
    layer.innerHTML = `
      <div class="fu-tour__blocker" aria-hidden="true"></div>
      <div class="fu-tour__spot" aria-hidden="true"></div>
      <section class="fu-tour__card" role="dialog" aria-modal="true" aria-labelledby="fu-tour-title" aria-describedby="fu-tour-text" tabindex="-1">
        <div class="fu-tour__head">
          <span class="fu-tour__icon" data-tour-icon aria-hidden="true" hidden></span>
          <span class="fu-tour__kicker" data-tour-kicker></span>
          <span class="fu-tour__count" data-tour-count></span>
          <button class="fu-tour__close" type="button" data-tour-skip aria-label="Close tour (Esc)" title="Close (Esc)">${ICON_CLOSE}</button>
        </div>
        <h2 class="fu-tour__title es-type-card-title" id="fu-tour-title" data-tour-title></h2>
        <p class="fu-tour__text" id="fu-tour-text" data-tour-text></p>
        <ol class="fu-tour__dots" data-tour-dots aria-hidden="true"></ol>
        <div class="fu-tour__actions">
          <button class="es-btn es-btn--tertiary es-btn--sm fu-tour__skip" type="button" data-tour-skip>Skip tour</button>
          <span class="fu-tour__nav">
            <button class="es-btn es-btn--sm" type="button" data-tour-back>Back</button>
            <button class="es-btn es-btn--primary es-btn--sm fu-tour__next" type="button" data-tour-next>Next</button>
          </span>
        </div>
        <p class="fu-tour__live" aria-live="polite" aria-atomic="true" data-tour-live></p>
      </section>`;
    // The top layer (popover) sits above everything and ignores ancestors
    // with a transform (phones have one on <body>, which would turn
    // position: fixed into "scrolls with the page"). Older browsers: mount on
    // <html> instead, outside the transformed <body>.
    if (supportsPopover()) {
      layer.setAttribute('popover', 'manual');
      doc.body.appendChild(layer);
    } else {
      doc.documentElement.appendChild(layer);
    }
    ui = {
      layer,
      spot: layer.querySelector('.fu-tour__spot'),
      card: layer.querySelector('.fu-tour__card'),
      count: layer.querySelector('[data-tour-count]'),
      kicker: layer.querySelector('[data-tour-kicker]'),
      icon: layer.querySelector('[data-tour-icon]'),
      dots: layer.querySelector('[data-tour-dots]'),
      title: layer.querySelector('[data-tour-title]'),
      text: layer.querySelector('[data-tour-text]'),
      back: layer.querySelector('[data-tour-back]'),
      next: layer.querySelector('[data-tour-next]'),
      skipButtons: [...layer.querySelectorAll('[data-tour-skip]')],
      live: layer.querySelector('[data-tour-live]'),
    };
    ui.next.addEventListener('click', () => go(+1));
    ui.back.addEventListener('click', () => go(-1));
    ui.skipButtons.forEach(button => button.addEventListener('click', () => stop('skipped')));
    // Clicks on the dimmed page do nothing (the tour stays put); the card
    // keeps its own clicks.
    layer.querySelector('.fu-tour__blocker').addEventListener('click', event => event.preventDefault());
    return ui;
  }

  // ─── Positioning ──────────────────────────────────────────────────────

  function viewport() {
    return { w: doc.documentElement.clientWidth || win.innerWidth, h: win.innerHeight };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function placeSpot(rect) {
    const { spot } = ui;
    if (!rect) {
      const { w, h } = viewport();
      spot.classList.add('is-empty');
      Object.assign(spot.style, { top: `${h / 2}px`, left: `${w / 2}px`, width: '0px', height: '0px' });
      return;
    }
    spot.classList.remove('is-empty');
    Object.assign(spot.style, {
      top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  // The highlighted box: the target plus padding, kept inside the viewport.
  function spotRect(el, step) {
    const { w, h } = viewport();
    const pad = step.padding ?? 6;
    const r = el.getBoundingClientRect();
    const top = clamp(r.top - pad, 4, h - 8);
    const left = clamp(r.left - pad, 4, w - 8);
    const bottom = clamp(r.bottom + pad, top + 8, h - 4);
    const right = clamp(r.right + pad, left + 8, w - 4);
    return { top, left, width: right - left, height: bottom - top, bottom, right };
  }

  function placeCard(rect, step) {
    const { card } = ui;
    const { w, h } = viewport();
    card.style.removeProperty('--fu-arrow');
    card.removeAttribute('data-side');
    card.removeAttribute('data-dock');

    // Phones: dock to the bottom, or the top when the target sits down there.
    if (mediaMatches(NARROW)) {
      card.style.top = '';
      card.style.left = '';
      const cardH = card.offsetHeight;
      const coversTarget = rect && rect.bottom > h - cardH - MARGIN * 2 && rect.top > cardH + MARGIN * 2;
      card.dataset.dock = coversTarget ? 'top' : 'bottom';
      return;
    }

    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (!rect) {
      card.dataset.side = 'center';
      card.style.left = `${Math.round((w - cw) / 2)}px`;
      card.style.top = `${Math.round((h - ch) / 2)}px`;
      return;
    }

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const options = {
      right: { left: rect.right + GAP, top: clamp(cy - ch / 2, MARGIN, h - ch - MARGIN), fits: rect.right + GAP + cw <= w - MARGIN },
      left: { left: rect.left - GAP - cw, top: clamp(cy - ch / 2, MARGIN, h - ch - MARGIN), fits: rect.left - GAP - cw >= MARGIN },
      bottom: { left: clamp(cx - cw / 2, MARGIN, w - cw - MARGIN), top: rect.bottom + GAP, fits: rect.bottom + GAP + ch <= h - MARGIN },
      top: { left: clamp(cx - cw / 2, MARGIN, w - cw - MARGIN), top: rect.top - GAP - ch, fits: rect.top - GAP - ch >= MARGIN },
    };
    const order = step.placement && step.placement !== 'auto'
      ? [step.placement, 'bottom', 'right', 'top', 'left']
      : ['bottom', 'right', 'top', 'left'];
    const side = order.find(name => options[name] && options[name].fits);

    if (!side) {
      // Nothing fits (a very large target): float over its lower part.
      card.dataset.side = 'over';
      card.style.left = `${Math.round(clamp(cx - cw / 2, MARGIN, w - cw - MARGIN))}px`;
      card.style.top = `${Math.round(clamp(rect.bottom - ch - MARGIN * 2, MARGIN, h - ch - MARGIN))}px`;
      return;
    }
    const pos = options[side];
    card.dataset.side = side;
    card.style.left = `${Math.round(pos.left)}px`;
    card.style.top = `${Math.round(pos.top)}px`;
    // The little arrow points at the target's centre.
    const arrow = side === 'left' || side === 'right'
      ? clamp(cy - pos.top, 22, ch - 22)
      : clamp(cx - pos.left, 22, cw - 22);
    card.style.setProperty('--fu-arrow', `${Math.round(arrow)}px`);
  }

  function reposition() {
    if (!run || !ui) return;
    const el = run.targetEl;
    if (el && !el.isConnected) {
      // The page rebuilt the element: find it again, or fall back to centred.
      run.targetEl = resolveTarget(run.steps[run.index]?.target);
    }
    const step = run.steps[run.index] || {};
    const rect = run.targetEl && !run.interstitial ? spotRect(run.targetEl, step) : (run.navEl ? spotRect(run.navEl, step) : null);
    placeSpot(rect);
    placeCard(rect, step);
  }

  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = win.requestAnimationFrame(() => { frame = 0; reposition(); });
  }

  function scrollIntoViewIfNeeded(el) {
    const r = el.getBoundingClientRect();
    const { h, w } = viewport();
    const narrow = mediaMatches(NARROW);
    const reserve = narrow ? Math.min(ui.card.offsetHeight + MARGIN * 2, h * 0.5) : 0;
    // Phones keep a sticky header at the top: leave room for it.
    const top = narrow ? 72 : 8;
    if (r.top >= top && r.bottom <= h - 8 - reserve && r.left >= 0 && r.right <= w) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (error) {
      el.scrollIntoView();
    }
  }

  // ─── Keyboard and focus ───────────────────────────────────────────────

  function focusables() {
    return [...ui.card.querySelectorAll('button:not([disabled]):not([hidden])')].filter(button => button.offsetParent !== null);
  }

  function onKeydown(event) {
    if (!run) return;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      stop('dismissed');
    } else if (key === 'ArrowRight' && !run.busy) {
      event.preventDefault();
      go(+1);
    } else if (key === 'ArrowLeft' && !run.busy) {
      event.preventDefault();
      if (!ui.back.hidden) go(-1);
    } else if (key === 'Tab') {
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = ui.card.contains(doc.activeElement);
      if (event.shiftKey && (doc.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    // While the tour is open, page shortcuts (⌘K, '/', '?', ⌘E…) stay quiet.
    // Default actions (Enter/Space on the card's buttons) still happen.
    event.stopPropagation();
  }

  function onFocusIn(event) {
    if (run && ui && !ui.card.contains(event.target)) {
      (ui.next.hidden ? ui.card : ui.next).focus({ preventScroll: true });
    }
  }

  // ─── Running a tour ───────────────────────────────────────────────────

  function normalize(def) {
    const steps = Array.isArray(def.steps) ? def.steps.filter(Boolean) : [];
    return { id: def.id || 'tour', label: def.label || def.title || 'Tour', description: def.description || '', kicker: def.kicker || '', icon: def.icon || '', steps, onEnd: def.onEnd };
  }

  function toTour(idOrDef) {
    if (typeof idOrDef === 'string') return registry.get(idOrDef) || null;
    if (idOrDef && Array.isArray(idOrDef.steps)) return normalize(idOrDef);
    return null;
  }

  /**
   * Start a tour. Options: startAt (index), onEnd(result), autoNavigate (go
 * straight to the first step's page instead of asking first).
   * Returns false when the tour has no usable steps.
   */
  function start(idOrDef, options = {}) {
    const tour = toTour(idOrDef);
    if (!tour || !tour.steps.length || !doc || !doc.body) return false;
    if (run) teardown(false);
    buildUi();
    const resumed = Boolean(options.resumed);
    run = {
      tour,
      id: tour.id,
      steps: tour.steps,
      index: -1,
      token: 0,
      skipped: new Set(options.skipped || []),
      onEnd: options.onEnd || tour.onEnd,
      returnFocus: resumed ? null : doc.activeElement,
      serializable: typeof idOrDef === 'string' || registry.has(tour.id) ? null : stripFunctions(idOrDef),
      targetEl: null,
      navEl: null,
      interstitial: false,
      busy: false,
      // After a page load the target may still be building: wait longer once.
      waitBoost: resumed,
      autoNavigate: Boolean(options.autoNavigate),
    };
    // Page-independent steps (sidebar, search) whose target isn't here now
    // won't appear later either: drop them up front so "3 of 12" stays true.
    tour.steps.forEach((step, i) => {
      if (step.target && !step.page && !step.route && step.fallback !== 'center' && stepApplies(step) && !resolveTarget(step.target)) {
        run.skipped.add(i);
      }
    });
    ui.layer.hidden = false;
    if (supportsPopover()) { try { ui.layer.showPopover(); } catch (error) { /* already open */ } }
    ui.layer.classList.toggle('is-reduced', prefersReducedMotion());
    doc.documentElement.classList.add('fu-tour-open');
    win.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('focusin', onFocusIn);
    win.addEventListener('resize', schedule);
    win.addEventListener('scroll', schedule, true);
    run.resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
    run.resizeObserver?.observe(ui.card);
    run.tick = win.setInterval(schedule, 400);
    if (!resumed) win.dispatchEvent(new CustomEvent('frameup:tour-start', { detail: { id: tour.id } }));
    show(clamp(Number(options.startAt) || 0, 0, tour.steps.length - 1), options.dir || +1);
    return true;
  }

  function stripFunctions(def) {
    try { return JSON.parse(JSON.stringify(def)); } catch (error) { return null; }
  }

  // Count shown on the card: steps that apply here and haven't been skipped.
  function progress(index) {
    const usable = run.steps
      .map((step, i) => ({ step, i }))
      .filter(({ step, i }) => stepApplies(step) && !run.skipped.has(i));
    const position = usable.findIndex(entry => entry.i === index);
    return { position: position + 1, total: usable.length };
  }

  function isLastUsable(index) {
    return findStep(run.steps, index + 1, +1, (step, i) => stepApplies(step) && !run.skipped.has(i)) === -1;
  }

  function isFirstUsable(index) {
    return findStep(run.steps, index - 1, -1, (step, i) => stepApplies(step) && !run.skipped.has(i)) === -1;
  }

  async function show(index, dir) {
    if (!run) return;
    const token = ++run.token;
    const current = () => run && run.token === token;
    const next = findStep(run.steps, index, dir, (step, i) => stepApplies(step) && !run.skipped.has(i));
    if (next === -1) {
      if (dir > 0) return stop('completed');
      // Going back past the first step: stay where we are.
      if (run.index >= 0) return show(run.index, +1);
      return stop('empty');
    }
    const step = run.steps[next];
    run.index = next;
    run.navEl = null;
    run.interstitial = false;

    // The step lives on another page: offer to go there (or just go, when the
    // person picked this tour from a list on another page).
    const autoNavigate = run.autoNavigate;
    run.autoNavigate = false;
    if (!samePage(step.page)) {
      if (autoNavigate) {
        saveResume(next, step);
        win.location.href = pageUrl(step.page, resolveRoute(step));
        return undefined;
      }
      return showInterstitial(next, step, dir);
    }

    run.busy = true;
    ui.layer.classList.add('is-moving');
    let waitMs = run.waitBoost ? WAIT_LONG : WAIT_SHORT;
    run.waitBoost = false;
    const route = resolveRoute(step);
    if (route && win.location.hash !== route) {
      win.location.hash = route;
      waitMs = WAIT_LONG;
    }
    // While waiting, the previous highlight stays put (no flash to centre).
    const el = step.target ? await waitForTarget(step.target, step.wait ?? waitMs, current) : null;
    if (!current()) return;
    if (step.target && !el && step.fallback !== 'center') {
      run.skipped.add(next);
      run.busy = false;
      return show(next + dir, dir);
    }
    run.targetEl = el;
    // Release-note steps whose target is gone still show, centred.
    fill(step, next, el ? {} : { kind: 'centered' });
    if (el) scrollIntoViewIfNeeded(el);
    run.busy = false;
    ui.layer.classList.remove('is-moving');
    reposition();
    focusCard();
  }

  // Icons are trusted SVG strings from tours/tours.js (never from the manifest).
  function iconFor(step, overrides) {
    const icon = overrides.icon || step.icon || run.tour.icon || '';
    return typeof icon === 'string' && icon.trim().startsWith('<svg') ? icon : '';
  }

  function renderDots(position, total) {
    const dots = ui.dots;
    dots.hidden = total < 2;
    if (dots.childElementCount !== total) {
      dots.innerHTML = Array.from({ length: total }, () => '<li></li>').join('');
    }
    [...dots.children].forEach((dot, i) => {
      dot.classList.toggle('is-done', i < position - 1);
      dot.classList.toggle('is-current', i === position - 1);
    });
  }

  function fill(step, index, overrides = {}) {
    const { position, total } = progress(index);
    const last = isLastUsable(index);
    const icon = iconFor(step, overrides);
    ui.icon.innerHTML = icon;
    ui.icon.hidden = !icon;
    ui.kicker.textContent = run.tour.kicker || '';
    ui.count.textContent = total > 1 ? `${position} of ${total}` : '';
    ui.title.textContent = overrides.title || step.title || '';
    ui.text.textContent = overrides.text || step.text || '';
    ui.text.hidden = !ui.text.textContent;
    renderDots(position, total);
    ui.back.hidden = isFirstUsable(index);
    ui.next.textContent = overrides.next || step.nextLabel || (last ? 'Done' : 'Next');
    // "Skip tour" on every step but the last (Done ends it there).
    ui.skipButtons[1].hidden = last && !overrides.next;
    ui.live.textContent = `Step ${position} of ${total}. ${ui.title.textContent}. ${ui.text.textContent}`;
    ui.card.dataset.kind = overrides.kind || (step.target ? 'anchored' : 'centered');
    // Replay the entrance on every step (CSS keys off this attribute).
    ui.card.dataset.step = String(index);
    ui.card.classList.remove('is-entering');
    void ui.card.offsetWidth;
    ui.card.classList.add('is-entering');
  }


  function showInterstitial(index, step, dir) {
    const label = step.pageLabel || String(step.page).replace(/\.html.*$/, '').replace(/[-_]/g, ' ');
    run.interstitial = true;
    run.busy = false;
    ui.layer.classList.remove('is-moving');
    run.navEl = step.navTarget ? resolveTarget(step.navTarget) : null;
    fill(step, index, {
      kind: 'interstitial',
      title: dir < 0 ? `Back to ${label}` : `Next: ${label}`,
      text: dir < 0 ? `We'll reopen ${label}.` : `We'll open ${label} and pick up there.`,
      next: dir < 0 ? `Back to ${label}` : `Continue on ${label}`,
    });
    // Back from here goes to the previous step on this page as usual.
    run.pendingNav = { index, step };
    reposition();
    focusCard();
  }

  function focusCard() {
    win.requestAnimationFrame(() => {
      if (!run) return;
      (ui.next.hidden ? ui.card : ui.next).focus({ preventScroll: true });
    });
  }

  function go(dir) {
    if (!run || run.busy) return;
    if (run.interstitial && dir > 0 && run.pendingNav) {
      const { index, step } = run.pendingNav;
      saveResume(index, step);
      win.location.href = pageUrl(step.page, resolveRoute(step));
      return;
    }
    if (run.interstitial && dir < 0 && run.pendingNav) {
      // From a "Continue on …" card, Back returns to the step before it.
      run.pendingNav = null;
      return show(run.index - 1, -1);
    }
    run.pendingNav = null;
    show(run.index + dir, dir);
  }

  function saveResume(index, step) {
    const state = {
      id: run.id,
      tour: run.serializable,
      index,
      skipped: [...run.skipped],
      page: String(step.page).split(/[?#]/)[0],
      at: Date.now(),
    };
    try { win.sessionStorage.setItem(RESUME_KEY, JSON.stringify(state)); } catch (error) { /* tab-only */ }
    teardown(false);
  }

  function readResume() {
    try {
      const state = JSON.parse(win.sessionStorage.getItem(RESUME_KEY) || 'null');
      win.sessionStorage.removeItem(RESUME_KEY);
      if (!state || Date.now() - state.at > RESUME_MAX_AGE) return null;
      return state;
    } catch (error) {
      return null;
    }
  }

  /** Picks a tour back up after a "Continue on <page>" step. */
  async function resume() {
    const state = readResume();
    if (!state) return false;
    await whenPageVisible();
    const def = registry.get(state.id) || state.tour;
    if (!def) return false;
    if (state.page && !samePage(state.page)) return false;
    return start(registry.has(state.id) ? state.id : def, { startAt: state.index, skipped: state.skipped, resumed: true });
  }

  function teardown(restoreFocus) {
    if (!run) return;
    win.clearInterval(run.tick);
    run.resizeObserver?.disconnect();
    win.removeEventListener('keydown', onKeydown, true);
    doc.removeEventListener('focusin', onFocusIn);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('scroll', schedule, true);
    doc.documentElement.classList.remove('fu-tour-open');
    if (ui) {
      if (supportsPopover()) { try { ui.layer.hidePopover(); } catch (error) { /* already closed */ } }
      ui.layer.hidden = true;
      ui.live.textContent = '';
    }
    const focusTarget = run.returnFocus;
    run = null;
    if (restoreFocus && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
    }
  }

  /** Ends the tour. reason: 'completed' | 'skipped' | 'dismissed'. */
  function stop(reason = 'dismissed') {
    if (!run) return;
    const { id, onEnd } = run;
    teardown(true);
    const result = { id, completed: reason === 'completed', reason };
    try { if (typeof onEnd === 'function') onEnd(result); } catch (error) { console.warn('[tour] onEnd failed:', error); }
    win.dispatchEvent(new CustomEvent('frameup:tour-end', { detail: result }));
  }

  function register(def) {
    if (!def || !def.id) return null;
    const tour = normalize(def);
    registry.set(tour.id, tour);
    return tour;
  }

  const api = {
    register,
    start,
    stop,
    resume,
    get: id => registry.get(id) || null,
    list: () => [...registry.values()],
    active: () => (run ? { id: run.id, index: run.index } : null),
    isRunning: () => Boolean(run),
    pageFile,
    pageUrl,
    whenPageVisible,
    // Exposed for tests and for other tour modules.
    _internals: { resolveTarget, isVisible, stepApplies, findStep, samePage, resolveRoute },
  };

  // Resume a multi-page tour once the page (and the tour data) has loaded.
  // Never inside a frame: Generate renders designs in an iframe of the editor,
  // which must not pick up (and use up) the tour state meant for the page.
  let framed = false;
  try { framed = win.top !== win; } catch (error) { framed = true; }
  if (doc && typeof doc.addEventListener === 'function' && !framed) {
    const boot = () => win.setTimeout(() => { resume(); }, 350);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return api;
});
