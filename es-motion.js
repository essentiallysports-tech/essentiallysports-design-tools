/* FrameUp micro-animation hooks (pairs with es-motion.css).
   Small and dependency-free. Every effect is CSS; this file only adds or
   restarts classes, so prefers-reduced-motion (handled in CSS) keeps things
   static. Safe to load on any page, before or after the page script.

   window.FrameUpMotion
     .tick(el)               flash a count that changed (scale + blue, once)
     .setCount(el, value)    set text; ticks only when the value changed
     .check(extraClass)      SVG markup: a check whose stroke draws in
     .glyph()                SVG markup: the pulse line for live section titles
     .busy(button, on)       aria-busy on a refresh button (its icon spins)
     .tabs(container, item)  slide an ink underline between tabs (item selector, default .es-tab)
   Automatic:
     [data-es-tick="key"]    text changes tick (keyed, so re-rendered nodes count)
     .es-tabs                get a sliding ink
     .es-new-shine[data-es-new-key]  shimmers once, the first time it is seen */
(function () {
  'use strict';
  if (window.FrameUpMotion) return;

  const lastByKey = new Map();

  function tick(el) {
    if (!el) return;
    el.classList.add('es-tick');
    el.classList.remove('is-ticking');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-ticking');
    el.addEventListener('animationend', () => el.classList.remove('is-ticking'), { once: true });
  }

  function setCount(el, value) {
    if (!el) return;
    const next = String(value);
    if (el.textContent === next) return;
    const had = el.textContent !== '';
    el.textContent = next;
    if (had) tick(el);
  }

  function check(extraClass) {
    return '<svg class="es-check' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path pathLength="1" d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';
  }

  function glyph() {
    return '<svg class="es-pulse-glyph" viewBox="0 0 30 16" aria-hidden="true" focusable="false"><path pathLength="1" d="M1 8h6l2.5-6 4 12 3.5-9 2.5 3H29"/></svg>';
  }

  function busy(button, on) {
    if (!button) return;
    button.classList.add('es-refresh');
    if (on) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  /* Sliding ink for underline tabs. */
  const inked = new WeakSet();
  function tabs(container, item) {
    if (!container || inked.has(container)) return;
    const itemSel = typeof item === 'string' ? item : '.es-tab';
    inked.add(container);
    const ink = document.createElement('span');
    ink.className = 'es-tabs__ink';
    ink.setAttribute('aria-hidden', 'true');
    container.appendChild(ink);
    container.classList.add('has-ink');
    const place = () => {
      const active = container.querySelector(itemSel + ':is([aria-selected="true"], [aria-current="page"], .is-active)');
      if (!active || !active.offsetWidth) { ink.style.width = '0px'; return; }
      ink.style.width = active.offsetWidth + 'px';
      ink.style.transform = 'translateX(' + active.offsetLeft + 'px)';
    };
    new MutationObserver(place).observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'class'] });
    if ('ResizeObserver' in window) new ResizeObserver(place).observe(container);
    else window.addEventListener('resize', place);
    place();
  }

  /* "NEW" badges shimmer once per key, the first time they are seen. */
  function shineOnce(el) {
    const key = 'frameup.new-seen.' + (el.dataset.esNewKey || '');
    let seen = false;
    try { seen = localStorage.getItem(key) === '1'; } catch (_) {}
    if (seen) return;
    el.classList.add('is-shining');
    try { localStorage.setItem(key, '1'); } catch (_) {}
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('.es-tabs')) tabs(root);
    root.querySelectorAll('.es-tabs').forEach(el => tabs(el));
    root.querySelectorAll('.es-new-shine[data-es-new-key]:not(.is-shining)').forEach(shineOnce);
    root.querySelectorAll('[data-es-tick]').forEach(el => {
      const key = el.dataset.esTick;
      if (key && !lastByKey.has(key)) lastByKey.set(key, el.textContent);
    });
  }

  function watch() {
    scan(document);
    new MutationObserver(records => {
      const seen = new Set();
      for (const record of records) {
        record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); });
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const el = target && target.closest ? target.closest('[data-es-tick]') : null;
        const els = el ? [el] : [];
        record.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches('[data-es-tick]')) els.push(node);
          node.querySelectorAll('[data-es-tick]').forEach(child => els.push(child));
        });
        els.forEach(item => {
          if (seen.has(item)) return;
          seen.add(item);
          const key = item.dataset.esTick || '';
          const text = item.textContent;
          const prev = lastByKey.get(key);
          lastByKey.set(key, text);
          if (prev !== undefined && prev !== text && text.trim() !== '') tick(item);
        });
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  window.FrameUpMotion = { tick, setCount, check, glyph, busy, tabs };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
})();
