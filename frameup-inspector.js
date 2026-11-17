// FrameUp inspector (the editor's right-hand panel on Social Media, YouTube
// and Newsletter). Styling lives in studio-inspector.css; this file adds:
//
//   1. Selection first: a strip at the top of the panel says what you are
//      editing (the whole design, or the layer picked in the Layers panel or
//      on the canvas). Picking a layer opens the section that holds its
//      settings, scrolls it into view and marks it "Selected".
//   2. A "Photo" title on the photo block, so every block starts the same way.
//   3. Collapse all / Expand all for the sections (open state is still
//      remembered per workspace by index.html's frameup.studioSections.v2).
//   4. Keyboard: ↑ / ↓ / Home / End move between section titles.
//   5. Drag the X / Y / Zoom labels to change the number (Shift = ×10).
//   6. Drag the panel's left edge (or focus it and use ← / →) to resize it,
//      300–440 px, remembered as frameup.inspector.width. Double-click resets.
//
// It only reads editor state and moves DOM around the canvas: no render,
// export or saved-design code is touched. The pure helpers are exported for
// Node tests (scripts/test-inspector.mjs).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document && window.top === window) {
    window.FrameUpInspector = api;
    const start = () => api.install(window);
    if (document.readyState === 'complete') setTimeout(start, 0);
    else window.addEventListener('load', () => setTimeout(start, 0), { once: true });
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // ─── Pure helpers ────────────────────────────────────────────────────────
  const WIDTH = { min: 300, max: 440, wide: 370, narrow: 320, breakpoint: 1280, step: 8 };
  const WIDTH_KEY = 'frameup.inspector.width';

  // Where each layer's settings live in the panel.
  //   section: an accordion section key (index.html studioSectionNodes)
  //   block:   a panel block outside the accordion ('photo' = the image tools)
  //   focus:   a control inside it to flash
  const LAYER_TARGETS = {
    pills: { kind: 'text', name: 'Text', section: 'content', focus: '.text-card' },
    logo: { kind: 'logo', name: 'Logo', section: 'brand', focus: '#brand-logo-control' },
    swipeButton: { kind: 'button', name: 'Swipe button', section: 'content', focus: '#swipe-button-card' },
    photo: { kind: 'photo', name: 'Background image', block: 'photo', focus: '.image-tool-rail' },
  };

  function targetForLayer(id) {
    return LAYER_TARGETS[id] || null;
  }

  // What the selection strip says. `names` are the selected layers' display
  // names (renamed layers keep their own name), in panel order.
  function contextFor({ workspace = '', template = '', ids = [], names = [] } = {}) {
    const list = ids.filter(Boolean);
    if (!list.length) {
      return {
        kind: 'design',
        title: template ? `Whole design · ${template}` : 'Whole design',
        sub: 'Select a layer to jump to its settings',
        selection: false,
      };
    }
    if (list.length === 1) {
      const target = targetForLayer(list[0]);
      const name = names[0] || target?.name || 'Layer';
      const where = target?.section === 'brand' ? 'Brand & Colors'
        : target?.block === 'photo' ? (workspace === 'youtube' ? 'Photos' : 'Photo')
        : 'Content';
      return { kind: target?.kind || 'layer', title: name, sub: `Selected layer · settings in ${where}`, selection: true };
    }
    const shown = names.filter(Boolean).slice(0, 2).join(', ');
    return {
      kind: 'layer',
      title: `${list.length} layers selected`,
      sub: shown ? `${shown}${list.length > 2 ? '…' : ''} · each has its own section` : 'Each has its own section',
      selection: true,
    };
  }

  function clampWidth(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, n)));
  }

  function defaultWidth(viewportWidth) {
    return Number(viewportWidth) < WIDTH.breakpoint ? WIDTH.narrow : WIDTH.wide;
  }

  // A stored width that is missing, broken, or the default for this screen
  // means "follow the CSS" (null), so narrow laptops keep their narrow panel.
  function storedWidth(raw, viewportWidth) {
    if (raw === null || raw === undefined || raw === '') return null;
    const w = clampWidth(raw);
    if (w === null || w === defaultWidth(viewportWidth)) return null;
    return w;
  }

  // Keyboard resize: ← widens (the handle is on the panel's left edge).
  function widthForKey(current, key, { shift = false } = {}) {
    const step = shift ? WIDTH.step * 4 : WIDTH.step;
    if (key === 'ArrowLeft') return clampWidth(current + step);
    if (key === 'ArrowRight') return clampWidth(current - step);
    if (key === 'Home') return WIDTH.min;
    if (key === 'End') return WIDTH.max;
    return null;
  }

  // Drag-to-scrub on a number field: one step per 2 px, ×10 with Shift,
  // clamped to the field's min / max and snapped to its step.
  function scrubValue(start, dx, { step = 1, min = -Infinity, max = Infinity, coarse = false } = {}) {
    const s = Number(step) > 0 ? Number(step) : 1;
    const base = Number.isFinite(Number(start)) ? Number(start) : 0;
    const moved = Math.trunc(Number(dx) / 2) * s * (coarse ? 10 : 1);
    const raw = Math.round((base + moved) / s) * s;
    const lo = Number.isFinite(Number(min)) ? Number(min) : -Infinity;
    const hi = Number.isFinite(Number(max)) ? Number(max) : Infinity;
    return Math.min(hi, Math.max(lo, raw));
  }

  // Roving focus between section titles (WAI-ARIA accordion pattern).
  function nextIndex(index, key, count) {
    if (!count) return -1;
    if (key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
  }

  const pure = { WIDTH, WIDTH_KEY, LAYER_TARGETS, targetForLayer, contextFor, clampWidth, defaultWidth, storedWidth, widthForKey, scrubValue, nextIndex };

  // ─── Browser ─────────────────────────────────────────────────────────────
  const ICONS = {
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>',
  };

  function install(win) {
    const doc = win.document;
    if (win.__frameupInspector) return;
    win.__frameupInspector = true;
    const store = {
      get(key) { try { return win.localStorage.getItem(key); } catch (e) { return null; } },
      set(key, value) { try { if (value === null) win.localStorage.removeItem(key); else win.localStorage.setItem(key, value); } catch (e) { /* storage off */ } },
    };
    const reduceMotion = () => win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktop = () => !win.matchMedia || win.matchMedia('(min-width: 901px)').matches;
    const panel = () => doc.querySelector('.app[data-workspace] > .panel');
    const app = () => doc.querySelector('.app[data-workspace]');
    const workspace = () => app()?.dataset.workspace || doc.body.dataset.currentPage || '';
    const visible = el => Boolean(el) && !el.hidden && el.getClientRects().length > 0;

    // ── Width ──
    let width = storedWidth(store.get(WIDTH_KEY), win.innerWidth);
    function applyWidth(next, { save = false } = {}) {
      width = next;
      if (width) doc.documentElement.style.setProperty('--fi-w-user', `${width}px`);
      else doc.documentElement.style.removeProperty('--fi-w-user');
      if (save) store.set(WIDTH_KEY, width ? String(width) : null);
      syncHandle();
      win.dispatchEvent(new Event('resize'));
    }
    const currentWidth = () => Math.round(panel()?.getBoundingClientRect().width || width || defaultWidth(win.innerWidth));

    let handle = null;
    function ensureHandle() {
      if (handle || !panel()) return;
      handle = doc.createElement('div');
      handle.className = 'fi-resize';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize the settings panel');
      handle.setAttribute('aria-valuemin', String(WIDTH.min));
      handle.setAttribute('aria-valuemax', String(WIDTH.max));
      handle.title = 'Drag to resize · double-click to reset';
      // In <body>: .app keeps an identity transform from its entry animation,
      // which would make it the box a fixed element is placed in.
      doc.body.appendChild(handle);
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startW = currentWidth();
        doc.documentElement.classList.add('fi-is-resizing');
        handle.setPointerCapture?.(event.pointerId);
        const move = e => applyWidth(clampWidth(startW + (startX - e.clientX)));
        const up = () => {
          doc.documentElement.classList.remove('fi-is-resizing');
          handle.removeEventListener('pointermove', move);
          applyWidth(storedWidth(currentWidth(), win.innerWidth), { save: true });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up, { once: true });
        handle.addEventListener('pointercancel', up, { once: true });
      });
      handle.addEventListener('dblclick', () => applyWidth(null, { save: true }));
      handle.addEventListener('keydown', event => {
        const next = widthForKey(currentWidth(), event.key, { shift: event.shiftKey });
        if (next === null) return;
        event.preventDefault();
        applyWidth(storedWidth(next, win.innerWidth) ?? (next === defaultWidth(win.innerWidth) ? null : next), { save: true });
      });
    }
    function syncHandle() {
      if (!handle) return;
      const p = panel();
      const show = desktop() && visible(p);
      handle.hidden = !show;
      if (!show) { handle.style.display = 'none'; return; }
      const r = p.getBoundingClientRect();
      const place = (left, top) => { handle.style.cssText = `position:fixed;display:block;top:${Math.round(top)}px;height:${Math.round(r.height)}px;left:${Math.round(left)}px;`; };
      place(r.left - 4, r.top);
      // A transformed ancestor becomes the box "fixed" is measured from: correct by what landed.
      const got = handle.getBoundingClientRect();
      const dx = got.left - (r.left - 4);
      const dy = got.top - r.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) place(r.left - 4 - dx, r.top - dy);
      handle.setAttribute('aria-valuenow', String(Math.round(r.width)));
    }

    // ── Selection strip + section titles ──
    let strip = null;
    function ensureStrip() {
      const exportSection = doc.querySelector('[data-studio-export-section]');
      if (!exportSection) return null;
      if (strip && strip.isConnected) return strip;
      strip = doc.createElement('div');
      strip.className = 'fi-context';
      strip.dataset.fiContext = '';
      strip.hidden = true;
      strip.innerHTML = `
        <span class="fi-context__icon" aria-hidden="true"></span>
        <div class="fi-context__copy">
          <div class="fi-context__title" data-fi-title></div>
          <div class="fi-context__sub" data-fi-sub></div>
        </div>
        <div class="fi-context__actions">
          <button type="button" class="fi-icon-btn" data-fi-fold aria-label="Collapse all sections" title="Collapse all sections">${ICONS.collapse}</button>
        </div>`;
      exportSection.insertAdjacentElement('afterend', strip);
      strip.querySelector('[data-fi-fold]').addEventListener('click', toggleAll);
      return strip;
    }

    function ensurePhotoTitle() {
      const block = doc.querySelector('.panel .studio-dock-section');
      if (!block) return;
      let title = block.querySelector(':scope > .fi-section-title');
      if (!title) {
        title = doc.createElement('div');
        title.className = 'fi-section-title';
        title.setAttribute('role', 'heading');
        title.setAttribute('aria-level', '3');
        block.insertBefore(title, block.firstChild);
      }
      const text = workspace() === 'youtube' ? 'Photos' : 'Photo';
      if (title.textContent !== text) title.textContent = text;
      // No photo controls for this template (HTML widgets…): no title either.
      const empty = ![...block.children].some(child => child !== title && child.getBoundingClientRect().height > 0);
      if (title.hidden !== empty) title.hidden = empty;
    }

    const sections = () => [...doc.querySelectorAll('.panel [data-studio-accordion-section]')].filter(s => !s.hidden);
    function toggleAll() {
      const list = sections();
      const anyOpen = list.some(s => s.classList.contains('is-open'));
      list.forEach(section => {
        const isOpen = section.classList.contains('is-open');
        if (isOpen === !anyOpen) return;
        section.querySelector('.studio-accordion-trigger')?.click();
      });
      syncFold();
    }
    function syncFold() {
      const button = strip?.querySelector('[data-fi-fold]');
      if (!button) return;
      const list = sections();
      button.hidden = list.length < 2;
      const anyOpen = list.some(s => s.classList.contains('is-open'));
      const label = anyOpen ? 'Collapse all sections' : 'Expand all sections';
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = anyOpen ? ICONS.collapse : ICONS.expand;
      }
    }

    function templateName() {
      const ws = workspace();
      const pick = id => doc.getElementById(id)?.selectedOptions?.[0]?.textContent.trim() || '';
      if (ws === 'instagram') return pick('instagram-post-type-select');
      if (ws === 'youtube') return doc.body.dataset.youtubeQuote === 'true' ? 'Quote thumbnail' : pick('youtube-variation-select');
      if (ws === 'newsletter') return pick('newsletter-asset-select');
      return '';
    }

    function layerName(id) {
      const row = doc.querySelector(`#layers-panel [data-layer-id="${win.CSS?.escape ? win.CSS.escape(id) : id}"]`);
      const label = row?.querySelector('.fu-layer-name');
      const own = label ? [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('') : '';
      return own.trim();
    }

    let lastSig = null;
    function selectedIds() {
      try { return win.FrameUpEditorUI?.selectedLayers?.() || []; } catch (e) { return []; }
    }

    function markSections(ids) {
      doc.querySelectorAll('.panel [data-fi-active]').forEach(el => el.removeAttribute('data-fi-active'));
      const marked = [];
      ids.forEach(id => {
        const target = targetForLayer(id);
        if (!target) return;
        const el = target.section
          ? doc.querySelector(`.panel [data-studio-accordion-section="${target.section}"]`)
          : doc.querySelector('.panel .studio-dock-section');
        if (el && !el.hidden) { el.setAttribute('data-fi-active', ''); marked.push({ el, target }); }
      });
      return marked;
    }

    function reveal(marked) {
      const first = marked[0];
      if (!first) return;
      marked.forEach(({ el }) => {
        if (el.matches('[data-studio-accordion-section]') && !el.classList.contains('is-open')) {
          if (typeof win.ESOpenStudioSection === 'function') win.ESOpenStudioSection(el.dataset.studioAccordionSection);
          else el.querySelector('.studio-accordion-trigger')?.click();
        }
      });
      const focusEl = (first.target.focus && first.el.querySelector(first.target.focus)) || first.el;
      const scroller = panel();
      if (scroller && desktop()) {
        const top = focusEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const sticky = doc.querySelector('[data-studio-export-section]')?.getBoundingClientRect().height || 0;
        if (top < sticky + 8 || top > scroller.clientHeight - 80) {
          scroller.scrollTo({ top: scroller.scrollTop + top - sticky - 12, behavior: reduceMotion() ? 'auto' : 'smooth' });
        }
      }
      focusEl.removeAttribute('data-fi-flash');
      void focusEl.offsetWidth;
      focusEl.setAttribute('data-fi-flash', '');
      win.setTimeout(() => focusEl.removeAttribute('data-fi-flash'), 1300);
    }

    function sync({ initial = false } = {}) {
      ensureHandle();
      syncHandle();
      const s = ensureStrip();
      ensurePhotoTitle();
      if (!s) return;
      const hasLayers = Boolean(app()?.classList.contains('has-layers-panel')) && desktop();
      s.hidden = !hasLayers;
      const ids = hasLayers ? selectedIds() : [];
      const ctx = contextFor({ workspace: workspace(), template: templateName(), ids, names: ids.map(layerName) });
      const title = s.querySelector('[data-fi-title]');
      const sub = s.querySelector('[data-fi-sub]');
      if (title.textContent !== ctx.title) title.textContent = ctx.title;
      if (sub.textContent !== ctx.sub) sub.textContent = ctx.sub;
      s.dataset.kind = ctx.kind;
      s.classList.toggle('is-selection', ctx.selection);
      const marked = markSections(ids);
      const sig = `${workspace()}|${ids.join(',')}`;
      if (!initial && lastSig !== null && sig !== lastSig && ids.length) reveal(marked);
      lastSig = sig;
      syncFold();
    }

    let queued = false;
    function queue() {
      if (queued) return;
      queued = true;
      win.requestAnimationFrame(() => { queued = false; sync(); });
    }

    // ── Keyboard between section titles ──
    doc.addEventListener('keydown', event => {
      const trigger = event.target.closest?.('.panel .studio-accordion-trigger');
      if (!trigger || event.altKey || event.metaKey || event.ctrlKey) return;
      const triggers = sections().map(s => s.querySelector('.studio-accordion-trigger')).filter(visible);
      const next = nextIndex(triggers.indexOf(trigger), event.key, triggers.length);
      if (next < 0) return;
      event.preventDefault();
      triggers[next].focus();
    });

    // ── Drag the X / Y / Zoom labels ──
    doc.addEventListener('pointerdown', event => {
      const label = event.target.closest?.('.panel .image-context-precision label > span:first-child');
      if (!label || event.button !== 0) return;
      const input = label.parentElement.querySelector('input[type="number"]');
      if (!input || input.disabled) return;
      event.preventDefault();
      const startX = event.clientX;
      const start = Number(input.value) || 0;
      const opts = { step: Number(input.step) || 1, min: input.min === '' ? -Infinity : Number(input.min), max: input.max === '' ? Infinity : Number(input.max) };
      let last = start;
      doc.documentElement.classList.add('fi-is-scrubbing');
      label.setPointerCapture?.(event.pointerId);
      const move = e => {
        const value = scrubValue(start, e.clientX - startX, { ...opts, coarse: e.shiftKey });
        if (value === last) return;
        last = value;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const up = () => {
        doc.documentElement.classList.remove('fi-is-scrubbing');
        label.removeEventListener('pointermove', move);
        if (last !== start) input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      label.addEventListener('pointermove', move);
      label.addEventListener('pointerup', up, { once: true });
      label.addEventListener('pointercancel', up, { once: true });
    });
    // Label hint for the scrub (screen readers keep the field's own label).
    function hintScrub() {
      doc.querySelectorAll('.panel .image-context-precision label > span:first-child:not([title])').forEach(span => { span.title = 'Drag to change · Shift for bigger steps'; });
    }

    // ── Wire up ──
    if (width) applyWidth(width);
    sync({ initial: true });
    hintScrub();
    const observer = new win.MutationObserver(queue);
    const layersPanel = doc.getElementById('layers-panel');
    if (layersPanel) observer.observe(layersPanel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'hidden'] });
    const list = doc.querySelector('[data-studio-accordion-list]');
    if (list) observer.observe(list, { subtree: false, childList: false, attributes: true, attributeFilter: ['class'] });
    list?.querySelectorAll('[data-studio-accordion-section]').forEach(section => observer.observe(section, { attributes: true, attributeFilter: ['class', 'hidden'] }));
    const appEl = app();
    if (appEl) observer.observe(appEl, { attributes: true, attributeFilter: ['class', 'data-workspace'] });
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-current-page', 'data-instagram-post-type', 'data-youtube-variation', 'data-youtube-quote', 'data-newsletter-asset'] });
    win.addEventListener('frameup:rendered', queue);
    win.addEventListener('hashchange', queue);
    win.addEventListener('resize', () => { syncHandle(); queue(); });
  }

  return { ...pure, install };
}));
