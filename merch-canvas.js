// Merch Designs: move and resize the design right on the stage canvas
// (browser: window.MerchCanvas; tests: require). Same idea as the Social Media
// editor's text drag (index.html setupCanvasDrag / canStartTextDragAt): pointer
// events, a few px before a press becomes a drag, rAF-throttled live updates.
//
//   const ctl = MerchCanvas.attach({
//     canvas,                       // #mx-stage-canvas
//     getConcept: () => concept,    // the selected design (reads concept.fit)
//     getView: () => ({ view: 'tee' | 'closeup', templateId, photoIndex, spec, calibrated, pad?, kind? }),
//     onChange: (fit, { final, source }) => {},   // final: true once per gesture (one undo step)
//     onSelect: () => {},           // optional: a press on the design
//   });
//   ctl.refresh();  // after every stage redraw (and it watches the canvas itself)
//   ctl.detach();
//
// fit = { scale 0.6-1.6, topIn (inches from the print area's top; null = default),
//         xIn (design centre's offset from the area's centre line, inches; + = right),
//         yIn (hard goods only: the design's shift down from where the engine
//         centres it, inches; the tote's up/down moves) }.
//
// The outline and handles are DOM drawn over the canvas, never canvas pixels, so
// the mockup and downloads stay clean. They show only where the design's real
// position is known: a calibrated Fourthwall photo (the print wrapped round the
// body exactly as MerchPrint.photoMock draws it) or the close-up (the design
// fitted to the canvas, so move/resize map 1:1 to the design box). Uncalibrated
// photos and the flat drawn preview show nothing.
//
// The tote (tote-drag 2026-11-28): its photo is a flat panel in perspective, so
// MerchPrint.photoGeometry is projective (toCanvas / toInches). The overlay is
// then the design box's 4 projected corners (an SVG polygon, hit-tested as the
// quad) with a handle on each; every move / resize is worked out in inches and
// projected back. Hard goods can't grow past 100% (the engine only shrinks them)
// and move up/down with fit.yIn inside their safe edge.
//
// Engine: uses MerchPrint.designBox / photoGeometry when present, else works it
// out from MerchPrint.layout + photoCal (the same maths photoMock uses). Sideways
// moves (fit.xIn) need an engine whose fitOf() knows xIn; with an older engine
// the design stays centred and only moves up/down.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MerchCanvas = api;
}(typeof self !== 'undefined' ? self : globalThis, (root) => {
  'use strict';

  const LIMITS = Object.freeze({ scaleMin: 0.6, scaleMax: 1.6, topMinIn: 0.5, topMaxIn: 10 });
  const MOVE_STEP_IN = 0.1;
  const MOVE_BIG_IN = 0.5;
  const SCALE_STEP = 0.05;
  const ACTIVATE_PX = 3; // CSS px before a press becomes a drag (as in index.html)
  const SNAP_PX = 6; // CSS px from the centre line that snaps without Shift
  const MAX_TH = 1.5; // MerchPrint's wrap clamps the body angle to ±1.5 rad

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r2 = v => Math.round(v * 100) / 100;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // ─── Pure geometry (tested in scripts/test-merch-canvas.mjs) ────────────
  // A map turns print-area inches (x right from the area's left edge, y down
  // from its top) into canvas pixels and back. Two kinds:
  //   { kind: 'linear', ox, oy, k }  canvas = o + inches * k (close-up)
  //   { kind: 'photo', W, H, inW, cal } a calibrated photo: x wraps round the
  //     body (cylinder: cal.body.cx, r, yaw; cal.ppi, cal.top are fractions of
  //     the photo), y is straight, exactly as MerchPrint.photoMock draws it.
  //   { kind: 'proj', toC, toI, W, H, inW, inH } a flat panel in perspective (the
  //     tote): toC(xIn, yIn) -> [px, py] and toI(px, py) -> [xIn, yIn] are
  //     MerchPrint.photoGeometry's own homography and its inverse.
  function wrapFrac(cal, d) {
    const th = clamp(cal.body.yaw * Math.PI / 180 + (d * cal.ppi) / cal.body.r, -MAX_TH, MAX_TH);
    return cal.body.cx + cal.body.r * Math.sin(th);
  }
  function unwrapFrac(cal, xf) {
    const s = clamp((xf - cal.body.cx) / cal.body.r, -Math.sin(MAX_TH), Math.sin(MAX_TH));
    return ((Math.asin(s) - cal.body.yaw * Math.PI / 180) * cal.body.r) / cal.ppi;
  }
  function inchesToCanvas(pt, map) {
    if (map.kind === 'proj') { const [x, y] = map.toC(pt.x, pt.y); return { x, y }; }
    if (map.kind === 'photo') return { x: wrapFrac(map.cal, pt.x - map.inW / 2) * map.W, y: map.cal.top * map.H + pt.y * map.cal.ppi * map.W };
    return { x: map.ox + pt.x * map.k, y: map.oy + pt.y * map.k };
  }
  function canvasToInches(pt, map) {
    if (map.kind === 'proj') { const [x, y] = map.toI(pt.x, pt.y); return { x, y }; }
    if (map.kind === 'photo') return { x: map.inW / 2 + unwrapFrac(map.cal, pt.x / map.W), y: (pt.y - map.cal.top * map.H) / (map.cal.ppi * map.W) };
    return { x: (pt.x - map.ox) / map.k, y: (pt.y - map.oy) / map.k };
  }
  // An inches box -> its 4 corners on the canvas (TL, TR, BR, BL).
  function quadToCanvas(b, map) {
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => inchesToCanvas({ x, y }, map));
  }
  // Is a point inside a convex quad (either winding)?
  function pointInQuad(pt, q) {
    let sign = 0;
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      const c = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (Math.abs(c) < 1e-9) continue;
      if (!sign) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
    }
    return true;
  }
  // An inches box -> the canvas box it covers (the wrap keeps edges monotonic;
  // in perspective, the box round the 4 projected corners).
  function rectToCanvas(b, map) {
    if (map.kind === 'proj') {
      const q = quadToCanvas(b, map);
      const xs = q.map(p => p.x), ys = q.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    const a = inchesToCanvas({ x: b.x, y: b.y }, map);
    const z = inchesToCanvas({ x: b.x + b.w, y: b.y + b.h }, map);
    return { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), w: Math.abs(z.x - a.x), h: Math.abs(z.y - a.y) };
  }
  // Canvas pixels per inch around a point (for snap thresholds and nudges).
  function pxPerInch(map, xIn = map.inW / 2 || 0) {
    if (map.kind === 'proj') { const y = (map.inH || 0) / 2; const a = inchesToCanvas({ x: xIn - 0.05, y }, map), b = inchesToCanvas({ x: xIn + 0.05, y }, map); return Math.hypot(b.x - a.x, b.y - a.y) / 0.1; }
    if (map.kind !== 'photo') return map.k;
    return Math.abs(inchesToCanvas({ x: xIn + 0.05, y: 0 }, map).x - inchesToCanvas({ x: xIn - 0.05, y: 0 }, map).x) / 0.1;
  }

  // Keeps a fit printable: scale in range; the design (w x h inches, its top
  // topOffsetIn below topIn) inside the area, topIn within the engine's limits;
  // xIn so the design stays inside the area's width (0 when sideways is off).
  // Hard goods (as MerchPrint.layout clamps them): baseX / baseY = the design's
  // left / top with no shift (inches); xIn and, with allowY, yIn are shifts kept
  // so the design stays safeIn inside the area's edges.
  function clampFit(fit, { design = { w: 0, h: 0 }, area = { inW: 0, inH: 0 }, limits = LIMITS, topOffsetIn = 0, allowX = true, allowY = false, baseX = null, baseY = null, safeIn = 0 } = {}) {
    const out = { scale: clamp(num(fit.scale, 1), limits.scaleMin, limits.scaleMax), topIn: fit.topIn, xIn: 0 };
    if (out.topIn !== null && out.topIn !== undefined && Number.isFinite(Number(out.topIn))) {
      const lo = Math.max(limits.topMinIn, -topOffsetIn);
      const hi = Math.min(limits.topMaxIn, area.inH - design.h - topOffsetIn);
      out.topIn = r2(hi >= lo ? clamp(Number(out.topIn), lo, hi) : lo);
    } else out.topIn = null;
    const shift = (v, base, size, span) => { const lo = safeIn - base; const hi = span - safeIn - base - size; return lo <= hi ? clamp(num(v, 0), lo, hi) : 0; };
    if (allowX && Number.isFinite(baseX)) out.xIn = r2(clamp(shift(fit.xIn, baseX, design.w, area.inW), -10, 10));
    else if (allowX) {
      const room = Math.max(0, (area.inW - design.w) / 2);
      out.xIn = r2(clamp(num(fit.xIn, 0), -room, room));
    }
    if (allowY) out.yIn = r2(clamp(Number.isFinite(baseY) ? shift(fit.yIn, baseY, design.h, area.inH) : num(fit.yIn, 0), -10, 10));
    out.scale = r2(out.scale);
    return out;
  }

  // Proportional resize from a corner. start = the design box (inches) when the
  // drag began; corner = the handle dragged ('nw'|'ne'|'sw'|'se'); pointer =
  // where it is now (inches). The opposite corner stays put (fromCentre: the
  // centre does). The ratio is the pointer's projection on the box diagonal,
  // limited so startScale * ratio stays in range.
  // centreX: the centre line stays instead of the opposite side (no sideways
  // moves), the opposite top/bottom edge still holds.
  function resizeFromCorner({ start, corner = 'se', pointer, startScale = 1, limits = LIMITS, fromCentre = false, centreX = false }) {
    const sx = corner.includes('e') ? 1 : -1;
    const sy = corner.includes('s') ? 1 : -1;
    const kx = fromCentre || centreX ? 0.5 : 1;
    const ky = fromCentre ? 0.5 : 1;
    const anchor = {
      x: kx < 1 ? start.x + start.w / 2 : sx > 0 ? start.x : start.x + start.w,
      y: ky < 1 ? start.y + start.h / 2 : sy > 0 ? start.y : start.y + start.h,
    };
    const vx = sx * start.w * kx;
    const vy = sy * start.h * ky;
    const len2 = vx * vx + vy * vy || 1;
    let ratio = ((pointer.x - anchor.x) * vx + (pointer.y - anchor.y) * vy) / len2;
    ratio = clamp(ratio, limits.scaleMin / startScale, limits.scaleMax / startScale);
    const box = placeAtAnchor({ w: start.w * ratio, h: start.h * ratio }, { anchor, corner, fromCentre, centreX });
    return { scale: startScale * ratio, ratio, anchor, box };
  }
  // Places a measured box (w x h) so the anchor from resizeFromCorner stays put.
  function placeAtAnchor(size, { anchor, corner = 'se', fromCentre = false, centreX = false }) {
    const x = fromCentre || centreX ? anchor.x - size.w / 2 : corner.includes('e') ? anchor.x : anchor.x - size.w;
    const y = fromCentre ? anchor.y - size.h / 2 : corner.includes('s') ? anchor.y : anchor.y - size.h;
    return { x, y, w: size.w, h: size.h };
  }

  // Horizontal centre snap: Shift forces it; otherwise within thresholdIn.
  function snapX(xIn, { force = false, thresholdIn = 0 } = {}) {
    if (force || Math.abs(xIn) <= thresholdIn) return { xIn: 0, snapped: true };
    return { xIn, snapped: false };
  }

  // ─── Engine access (feature-detected) ───────────────────────────────────
  const MP = () => root.MerchPrint || null;
  function engineLimits() {
    const F = MP()?.FIT || {};
    return { scaleMin: num(F.scaleMin, LIMITS.scaleMin), scaleMax: num(F.scaleMax, LIMITS.scaleMax), topMinIn: num(F.topMinIn, LIMITS.topMinIn), topMaxIn: num(F.topMaxIn, LIMITS.topMaxIn) };
  }
  function engineHasX() {
    try { return Object.prototype.hasOwnProperty.call(MP().fitOf({ fit: { xIn: 1 } }) || {}, 'xIn'); } catch { return false; }
  }
  function engineHasY() {
    try { return Object.prototype.hasOwnProperty.call(MP().fitOf({ fit: { yIn: 1 } }) || {}, 'yIn'); } catch { return false; }
  }
  function fitOf(concept) {
    const f = MP()?.fitOf ? MP().fitOf(concept || {}) : { scale: num(concept?.fit?.scale, 1), topIn: concept?.fit?.topIn ?? null };
    return { scale: f.scale, topIn: f.topIn ?? null, xIn: num(f.xIn, 0), yIn: num(f.yIn, 0) };
  }
  function fullSpec(view) {
    const kind = view.kind || view.spec?.kind || 'tee';
    return { ...(MP()?.DEFAULT_AREAS?.[kind] || {}), ...(view.spec || {}), kind };
  }
  // The design box in print-area inches for a concept + fit, plus the area.
  function measure(concept, spec, fit) {
    const c = fit ? { ...concept, fit } : concept;
    const scene = MP().layout(c, spec);
    const dpi = scene.dpi;
    let box = null;
    if (MP().designBox) { try { box = MP().designBox(c, spec); } catch { box = null; } }
    if (!box || !Number.isFinite(box.w)) box = { x: scene.design.x / dpi, y: scene.design.y / dpi, w: scene.design.w / dpi, h: scene.design.h / dpi };
    return { box, scene, area: { inW: scene.inW, inH: scene.inH }, apparel: scene.apparel !== false };
  }
  const sideOf = spec => (/back/i.test(String(spec.regionId || spec.region || '')) ? 'back' : 'front');
  // The map for the current view, or null when the design's position isn't known.
  function mapFor(view, concept, canvas) {
    if (!MP()?.layout || !concept) return null;
    const spec = fullSpec(view);
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return null;
    if (view.view === 'closeup') {
      const m = measure(concept, spec);
      const d = m.scene.design;
      const pad = num(view.pad, 0.14);
      const k = Math.min((W * (1 - 2 * pad)) / Math.max(1, d.w), (H * (1 - 2 * pad)) / Math.max(1, d.h));
      const dpi = m.scene.dpi;
      return { kind: 'linear', k: k * dpi, ox: W / 2 - (d.x + d.w / 2) * k, oy: H / 2 - (d.y + d.h / 2) * k, inW: m.area.inW, inH: m.area.inH, W, H, view: 'closeup' };
    }
    if (view.view !== 'tee' || !view.calibrated) return null;
    const cal = MP().photoCal?.(view.templateId, { photoIndex: view.photoIndex });
    if (!cal || (cal.side && cal.side !== sideOf(spec))) return null;
    const scene = MP().layout(concept, spec);
    if (!cal.body) {
      // A flat panel in perspective (the tote): the engine's own homography.
      const g = MP().photoGeometry?.(view.templateId, view.photoIndex, W, H, { inW: scene.inW, inH: scene.inH });
      if (g?.projective && typeof g.toCanvas === 'function' && typeof g.toInches === 'function') return { kind: 'proj', toC: g.toCanvas, toI: g.toInches, W, H, inW: scene.inW, inH: scene.inH, view: 'tee' };
    }
    if (cal.body && Number.isFinite(cal.ppi)) return { kind: 'photo', cal, W, H, inW: scene.inW, inH: scene.inH, view: 'tee' };
    // No body model: the engine's own linear geometry.
    const g = MP().photoGeometry?.(view.templateId, view.photoIndex, W, H);
    if (!g?.area) return null;
    return { kind: 'linear', k: g.area.w / scene.inW, ox: g.area.x, oy: g.area.y, inW: scene.inW, inH: scene.inH, W, H, view: 'tee' };
  }

  // ─── Styles (injected once) ─────────────────────────────────────────────
  const CSS = `
.mx-cv { position: absolute; inset: 0; z-index: 1; pointer-events: none; --mx-cv-blue: var(--mx-brand, #0a6fde); --mx-cv-fill: #ffffff; --mx-cv-tag: rgb(14 16 20 / .86); }
html[data-theme="dark"] .mx-cv { --mx-cv-blue: var(--mx-brand, #3D96FB); --mx-cv-fill: #1F2126; --mx-cv-tag: rgb(0 0 0 / .8); }
.mx-cv[hidden], .mx-cv [hidden] { display: none !important; }
.mx-cv__box { position: absolute; box-sizing: border-box; pointer-events: auto; cursor: move; touch-action: none; border-radius: 2px; outline: none; -webkit-tap-highlight-color: transparent; }
.mx-cv__box::before { content: ""; position: absolute; inset: -1px; border: 1.5px solid var(--mx-cv-blue); border-radius: 2px; opacity: 0; transition: opacity 120ms ease; pointer-events: none; }
.mx-cv__box:hover::before, .mx-cv__box.is-active::before { opacity: 1; }
.mx-cv__box:focus-visible::before { opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-cv-blue) 30%, transparent); }
.mx-cv__h { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; box-sizing: border-box; border: 1.5px solid var(--mx-cv-blue); border-radius: 2px; background: var(--mx-cv-fill); opacity: 0; transition: opacity 120ms ease; touch-action: none; }
.mx-cv__h::before { content: ""; position: absolute; inset: -8px; }
@media (pointer: coarse) { .mx-cv__h { width: 14px; height: 14px; margin: -7px 0 0 -7px; } .mx-cv__h::before { inset: -12px; } }
.mx-cv__box:hover .mx-cv__h, .mx-cv__box.is-active .mx-cv__h, .mx-cv__box:focus-visible .mx-cv__h { opacity: 1; }
.mx-cv__h[data-corner="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.mx-cv__h[data-corner="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.mx-cv__h[data-corner="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.mx-cv__h[data-corner="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.mx-cv.is-dragging .mx-cv__box { cursor: grabbing; }
.mx-cv.is-resizing .mx-cv__box { cursor: inherit; }
.mx-cv__guide { position: absolute; width: 0; border-left: 1px dashed var(--mx-cv-blue); pointer-events: none; transform-origin: 0 0; }
.mx-cv__quad { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mx-cv__quad polygon { fill: transparent; stroke: var(--mx-cv-blue); stroke-width: 1.5; stroke-linejoin: round; stroke-opacity: 0; vector-effect: non-scaling-stroke; pointer-events: fill; cursor: move; transition: stroke-opacity 120ms ease; }
.mx-cv__box.is-quad { pointer-events: none; border-radius: 0; }
.mx-cv__box.is-quad::before { display: none; }
.mx-cv__box.is-quad .mx-cv__h { pointer-events: auto; }
.mx-cv__box.is-quad:hover polygon, .mx-cv__box.is-quad.is-active polygon, .mx-cv__box.is-quad:focus-visible polygon { stroke-opacity: 1; }
.mx-cv__box.is-quad:focus-visible polygon { stroke-width: 2.5; }
.mx-cv .mx-cv__box.is-quad:focus, .mx-cv .mx-cv__box.is-quad:focus-visible { outline: none !important; } /* the quad's own stroke is the focus ring; a rectangle would not match the bag */
.mx-cv.is-dragging .mx-cv__quad polygon { cursor: grabbing; }
.mx-cv__tag { position: absolute; transform: translate(-50%, 8px); padding: 3px 8px; border-radius: 999px; background: var(--mx-cv-tag); color: #fff; font: 600 11px/1.3 var(--es-font-ui, system-ui, sans-serif); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.mx-cv__ghost { position: absolute; pointer-events: none; }
.mx-cv__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (prefers-reduced-motion: reduce) { .mx-cv__box::before, .mx-cv__h, .mx-cv__quad polygon { transition: none; } }
`;
  function injectCss(doc) {
    if (doc.getElementById('mx-canvas-css')) return;
    const s = doc.createElement('style');
    s.id = 'mx-canvas-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  // Keys: one capture listener on window, registered when this file loads, so
  // it runs before merch.js's own Design shortcuts (←/→ switch designs there).
  const boxes = new WeakMap();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', e => {
      const ctl = e.target && boxes.get(e.target);
      if (!ctl || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ctl.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  // ─── Controller ─────────────────────────────────────────────────────────
  function attach({ canvas, getConcept, getView, onChange = () => {}, onSelect = null } = {}) {
    if (!canvas || typeof getConcept !== 'function' || typeof getView !== 'function') throw new Error('MerchCanvas.attach needs canvas, getConcept and getView');
    const doc = canvas.ownerDocument;
    const win = doc.defaultView;
    injectCss(doc);
    const host = canvas.parentElement;
    if (win.getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const rootEl = doc.createElement('div');
    rootEl.className = 'mx-cv';
    rootEl.hidden = true;
    rootEl.innerHTML = `
      <canvas class="mx-cv__ghost" hidden></canvas>
      <div class="mx-cv__guide" hidden></div>
      <div class="mx-cv__box" tabindex="0" role="group" aria-label="Design position" aria-roledescription="movable design">
        <svg class="mx-cv__quad" aria-hidden="true" focusable="false" hidden><polygon points=""></polygon></svg>
        <span class="mx-cv__h" data-corner="nw" aria-hidden="true"></span><span class="mx-cv__h" data-corner="ne" aria-hidden="true"></span>
        <span class="mx-cv__h" data-corner="sw" aria-hidden="true"></span><span class="mx-cv__h" data-corner="se" aria-hidden="true"></span>
      </div>
      <div class="mx-cv__tag" hidden></div>
      <span class="mx-cv__sr es-sr-only" data-mx-cv-hint></span>
      <div class="mx-cv__sr es-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`;
    host.insertBefore(rootEl, canvas.nextSibling);
    const box = rootEl.querySelector('.mx-cv__box');
    const guide = rootEl.querySelector('.mx-cv__guide');
    const tag = rootEl.querySelector('.mx-cv__tag');
    const ghost = rootEl.querySelector('.mx-cv__ghost');
    const quadSvg = rootEl.querySelector('.mx-cv__quad');
    const quadPoly = quadSvg.querySelector('polygon');
    const handles = [...rootEl.querySelectorAll('.mx-cv__h')];
    const live = rootEl.querySelector('[role=status]');
    const hint = rootEl.querySelector('[data-mx-cv-hint]');
    hint.id = `mx-cv-hint-${Math.random().toString(36).slice(2, 8)}`;
    box.setAttribute('aria-describedby', hint.id);

    let cur = null; // { concept, view, spec, map, m (measure), fit, hasX, canMove }
    let drag = null;
    let raf = 0;
    let pending = null;
    let detached = false;

    // The canvas's drawn content in CSS px, relative to the host (object-fit: contain aware).
    function contentRect() {
      const r = canvas.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      if (!r.width || !r.height || !canvas.width || !canvas.height) return null;
      const cs = win.getComputedStyle(canvas);
      const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
      const iw = r.width - bl - pl - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
      const ih = r.height - bt - pt - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const fitMode = cs.objectFit;
      let sx = iw / canvas.width, sy = ih / canvas.height;
      if (fitMode === 'contain' || fitMode === 'scale-down') { const s = Math.min(sx, sy, fitMode === 'scale-down' ? 1 : Infinity); sx = sy = s; }
      else if (fitMode === 'cover') { const s = Math.max(sx, sy); sx = sy = s; }
      const dw = canvas.width * sx, dh = canvas.height * sy;
      return {
        left: r.left - h.left - host.clientLeft + host.scrollLeft + bl + pl + (iw - dw) / 2,
        top: r.top - h.top - host.clientTop + host.scrollTop + bt + pt + (ih - dh) / 2,
        sx, sy, clientLeft: r.left + bl + pl + (iw - dw) / 2, clientTop: r.top + bt + pt + (ih - dh) / 2,
      };
    }
    const visible = () => !canvas.hidden && canvas.getClientRects().length > 0 && win.getComputedStyle(canvas).display !== 'none';

    function read() {
      const concept = getConcept();
      const view = getView() || {};
      if (!concept || !visible() || !MP()?.layout) return null;
      let map = null;
      try { map = mapFor(view, concept, canvas); } catch (error) { console.warn('merch canvas', error); }
      if (!map) return null;
      const spec = fullSpec(view);
      const m = measure(concept, spec);
      // Hard goods move only where the photo shows the real position (the tote's
      // panel); they never grow past 100% (MerchPrint.layout only shrinks them).
      const yMode = !m.apparel && map.kind === 'proj' && engineHasY();
      const canMove = m.apparel || yMode;
      const limits = engineLimits();
      if (!m.apparel) limits.scaleMax = Math.min(limits.scaleMax, 1);
      const safeIn = num(MP()?.SAFE_IN?.[spec.kind], 0);
      return { concept, view, spec, map, m, fit: fitOf(concept), hasX: engineHasX() && canMove, canMove, yMode, limits, safeIn };
    }

    function place(el, rect, cr) {
      el.style.left = `${cr.left + rect.x * cr.sx}px`;
      el.style.top = `${cr.top + rect.y * cr.sy}px`;
      el.style.width = `${Math.max(1, rect.w * cr.sx)}px`;
      el.style.height = `${Math.max(1, rect.h * cr.sy)}px`;
    }
    // Draws the overlay for an inches box under a map.
    function show(boxIn, map, { snapped = false, label = '' } = {}) {
      const cr = contentRect();
      if (!cr) { rootEl.hidden = true; return null; }
      rootEl.hidden = false;
      const rc = rectToCanvas(boxIn, map);
      place(box, rc, cr);
      box.dataset.canvasBox = [rc.x, rc.y, rc.w, rc.h].map(v => v.toFixed(1)).join(',');
      const quad = map.kind === 'proj';
      box.classList.toggle('is-quad', quad);
      quadSvg.toggleAttribute('hidden', !quad); // SVG has no .hidden property
      if (quad) {
        // The projected corners, in CSS px from the box's top-left (TL TR BR BL).
        const q = quadToCanvas(boxIn, map);
        const pts = q.map(p => [(p.x - rc.x) * cr.sx, (p.y - rc.y) * cr.sy]);
        quadSvg.setAttribute('width', String(Math.max(1, rc.w * cr.sx)));
        quadSvg.setAttribute('height', String(Math.max(1, rc.h * cr.sy)));
        quadPoly.setAttribute('points', pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
        const at = { nw: 0, ne: 1, se: 2, sw: 3 };
        handles.forEach(h => { const [x, y] = pts[at[h.dataset.corner]]; h.style.left = `${x}px`; h.style.top = `${y}px`; });
        box.dataset.canvasQuad = q.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      } else {
        handles.forEach(h => { h.style.left = ''; h.style.top = ''; });
        delete box.dataset.canvasQuad;
      }
      guide.hidden = !snapped;
      if (snapped && quad) {
        // The area's centre line, projected (a slanted line on the tote).
        const a = inchesToCanvas({ x: map.inW / 2, y: 0 }, map);
        const b = inchesToCanvas({ x: map.inW / 2, y: map.inH }, map);
        const dx = (b.x - a.x) * cr.sx, dy = (b.y - a.y) * cr.sy;
        guide.style.left = `${cr.left + a.x * cr.sx}px`;
        guide.style.top = `${cr.top + a.y * cr.sy}px`;
        guide.style.height = `${Math.hypot(dx, dy)}px`;
        guide.style.transform = `rotate(${Math.atan2(-dx, dy)}rad)`;
      } else if (snapped) {
        guide.style.transform = '';
        const cx = inchesToCanvas({ x: map.inW / 2, y: 0 }, map).x;
        const y0 = map.view === 'closeup' ? 0 : inchesToCanvas({ x: 0, y: 0 }, map).y;
        const y1 = map.view === 'closeup' ? map.H : Math.min(map.H, inchesToCanvas({ x: 0, y: map.inH }, map).y);
        guide.style.left = `${cr.left + cx * cr.sx}px`;
        guide.style.top = `${cr.top + y0 * cr.sy}px`;
        guide.style.height = `${Math.max(0, (y1 - y0) * cr.sy)}px`;
      }
      tag.hidden = !label;
      if (label) { tag.textContent = label; tag.style.left = `${cr.left + (rc.x + rc.w / 2) * cr.sx}px`; tag.style.top = `${cr.top + (rc.y + rc.h) * cr.sy}px`; }
      return rc;
    }

    function hintText(state) {
      const moves = state?.canMove ? (state.hasX ? 'Arrow keys move it' : 'Up and down arrows move it') : '';
      return `${moves ? `${moves} (Shift for bigger steps), ` : ''}plus and minus resize, 0 resets.`;
    }
    function refresh() {
      if (detached || drag) return;
      cur = read();
      if (!cur) { rootEl.hidden = true; ghost.hidden = true; return; }
      hint.textContent = hintText(cur);
      show(cur.m.box, cur.map);
      ghost.hidden = true;
    }

    // Fit for a wanted design top / centre (inches) at a scale: measured once,
    // corrected for the engine's own offsets, then clamped inside the area.
    function solve(state, { scale, top, cx, keepTopNull = false }) {
      const limits = state.limits || engineLimits();
      const s = clamp(scale, limits.scaleMin, limits.scaleMax);
      const base = { ...state.fit, scale: s };
      if (!state.canMove) {
        // Size only; a saved sideways / up-down shift stays as it was.
        const f = { ...clampFit({ ...base, topIn: state.fit.topIn }, { design: state.m.box, area: state.m.area, limits, allowX: false }), xIn: state.fit.xIn || 0 };
        if (state.fit.yIn) f.yIn = state.fit.yIn;
        return { fit: f, m: measure(state.concept, state.spec, f) };
      }
      if (state.yMode) {
        // Hard goods: measure where the engine puts the design with no shift, then
        // shift it (xIn, yIn) to the wanted top / centre, kept inside the safe edge.
        const zero = { ...base, xIn: 0, yIn: 0 };
        const m0 = measure(state.concept, state.spec, zero);
        const want = { ...zero, xIn: state.hasX ? cx - m0.box.w / 2 - m0.box.x : 0, yIn: top - m0.box.y };
        const f = clampFit(want, { design: m0.box, area: m0.area, limits, allowX: state.hasX, allowY: true, baseX: m0.box.x, baseY: m0.box.y, safeIn: state.safeIn });
        f.topIn = state.fit.topIn; // apparel's field: left as it was
        return { fit: f, m: measure(state.concept, state.spec, f) };
      }
      // Measure at a top the engine accepts, then correct for its own offsets
      // (elements above the pills, rounding) so the design lands where wanted.
      const guess = { ...base, topIn: keepTopNull ? null : clamp(top, limits.topMinIn, limits.topMaxIn), xIn: state.hasX ? cx - state.m.area.inW / 2 : 0 };
      let m = measure(state.concept, state.spec, guess);
      const offset = guess.topIn === null ? 0 : m.box.y - guess.topIn;
      if (!keepTopNull) guess.topIn = top - offset;
      if (state.hasX) guess.xIn += cx - (m.box.x + m.box.w / 2);
      const f = clampFit(guess, { design: m.box, area: m.area, limits, topOffsetIn: offset, allowX: state.hasX });
      m = measure(state.concept, state.spec, f);
      return { fit: f, m };
    }

    function announce(text) { live.textContent = ''; win.setTimeout(() => { live.textContent = text; }, 30); }
    function describe(fit, m) {
      const parts = [`${Math.round(fit.scale * 100)}% size, ${m.box.w.toFixed(1)} by ${m.box.h.toFixed(1)} in`];
      if (m.apparel || cur?.yMode) {
        parts.push(`${m.box.y.toFixed(1)} in from the top of the print area`);
        const off = m.box.x + m.box.w / 2 - m.area.inW / 2;
        parts.push(Math.abs(off) < 0.05 ? 'centred' : `${Math.abs(off).toFixed(1)} in ${off > 0 ? 'right' : 'left'} of centre`);
      }
      return parts.join(', ');
    }
    const sizeLabel = m => `${m.box.w.toFixed(1)} × ${m.box.h.toFixed(1)} in`;

    function emit(fit, final, source) {
      try { onChange({ ...fit }, { final, source }); } catch (error) { console.warn('merch canvas onChange', error); }
    }

    // ─── Pointer ─────────────────────────────────────────────────────────
    const toCanvas = (e, cr) => ({ x: (e.clientX - cr.clientLeft) / cr.sx, y: (e.clientY - cr.clientTop) / cr.sy });

    function onDown(e) {
      if (detached) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (drag && drag.pointers && e.pointerType === 'touch' && drag.pointers.size === 1) { startPinch(e); return; }
      // A mouse release we never saw (outside the window): finish that drag first.
      if (drag && e.pointerType === 'mouse' && drag.pointers.has(e.pointerId)) end({ pointerId: e.pointerId });
      if (drag) return;
      const state = read();
      if (!state) return;
      const cr = contentRect();
      if (!cr) return;
      cur = state;
      const corner = e.target.closest?.('.mx-cv__h')?.dataset.corner || '';
      // In perspective only a press inside the projected design box grabs it.
      if (!corner && state.map.kind === 'proj' && !pointInQuad(toCanvas(e, cr), quadToCanvas(state.m.box, state.map))) return;
      drag = {
        id: e.pointerId, mode: corner ? 'resize' : 'move', corner, cr, state, map: state.map,
        startPt: canvasToInches(toCanvas(e, cr), state.map), startClient: { x: e.clientX, y: e.clientY },
        startFit: { ...state.fit }, startBox: { ...state.m.box }, fit: { ...state.fit }, m: state.m, active: false,
        pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
      };
      if (!state.canMove && drag.mode === 'move') drag.mode = 'none';
      box.classList.add('is-active');
      try { box.setPointerCapture(e.pointerId); } catch {}
      box.focus({ preventScroll: true });
      if (onSelect) { try { onSelect(); } catch {} }
      e.preventDefault();
    }
    function startPinch(e) {
      drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...drag.pointers.values()];
      drag.mode = 'pinch';
      drag.active = true;
      drag.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, fit: { ...drag.fit }, box: { ...drag.m.box } };
      try { canvas.setPointerCapture?.(e.pointerId); } catch {}
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag || !drag.pointers.has(e.pointerId)) return;
      if (e.pointerType === 'mouse' && !(Number(e.buttons) & 1)) { end(e); return; } // released elsewhere
      const ev = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().slice(-1)[0]) || e;
      drag.pointers.set(e.pointerId, { x: ev.clientX, y: ev.clientY });
      if (drag.mode === 'none') return;
      if (drag.mode !== 'pinch' && e.pointerId !== drag.id) return;
      if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.startClient.x, ev.clientY - drag.startClient.y) < ACTIVATE_PX) return;
        drag.active = true;
        rootEl.classList.add(drag.mode === 'move' ? 'is-dragging' : 'is-resizing');
        if (drag.map.view === 'closeup') startGhost();
      }
      pending = { client: { x: ev.clientX, y: ev.clientY }, shift: e.shiftKey, alt: e.altKey };
      if (!raf) raf = win.requestAnimationFrame(frame);
      e.preventDefault();
    }
    function compute(p) {
      const { state, map, cr } = drag;
      const limits = state.limits || engineLimits();
      const ppi = pxPerInch(map, state.m.area.inW / 2) * cr.sx; // CSS px per inch
      const snapIn = SNAP_PX / Math.max(1e-6, ppi);
      if (drag.mode === 'pinch') {
        const [a, b] = [...drag.pointers.values()];
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch.dist;
        const pb = drag.pinch.box;
        const scale = clamp(drag.pinch.fit.scale * ratio, limits.scaleMin, limits.scaleMax);
        const m0 = measure(state.concept, state.spec, { ...drag.pinch.fit, scale });
        const placed = placeAtAnchor(m0.box, { anchor: { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }, fromCentre: true });
        return { ...solve(state, { scale, top: placed.y, cx: placed.x + placed.w / 2, keepTopNull: !state.canMove }), snapped: false };
      }
      const pt = canvasToInches(toCanvas({ clientX: p.client.x, clientY: p.client.y }, cr), map);
      if (drag.mode === 'move') {
        const sb = drag.startBox;
        const top = sb.y + (pt.y - drag.startPt.y);
        let cx = sb.x + sb.w / 2 + (state.hasX ? pt.x - drag.startPt.x : 0);
        const sn = state.hasX ? snapX(cx - state.m.area.inW / 2, { force: p.shift, thresholdIn: snapIn }) : { xIn: cx - state.m.area.inW / 2, snapped: false };
        cx = state.m.area.inW / 2 + sn.xIn;
        return { ...solve(state, { scale: drag.startFit.scale, top, cx }), snapped: sn.snapped && state.hasX };
      }
      // resize
      // Alt: from the centre. Without sideways moves the centre line stays and
      // the opposite top/bottom edge holds.
      const opts = { corner: drag.corner, fromCentre: p.alt, centreX: !state.hasX };
      const res = resizeFromCorner({ start: drag.startBox, pointer: pt, startScale: drag.startFit.scale, limits, ...opts });
      const m0 = measure(state.concept, state.spec, { ...drag.startFit, scale: res.scale });
      const placed = placeAtAnchor(m0.box, { anchor: res.anchor, ...opts });
      let cx = placed.x + placed.w / 2;
      const sn = state.hasX ? snapX(cx - state.m.area.inW / 2, { force: p.shift, thresholdIn: 0 }) : { xIn: 0, snapped: false };
      if (sn.snapped) cx = state.m.area.inW / 2;
      return { ...solve(state, { scale: res.scale, top: placed.y, cx, keepTopNull: !state.canMove }), snapped: sn.snapped };
    }
    function frame() {
      raf = 0;
      if (!drag || !pending) return;
      const p = pending;
      pending = null;
      const out = compute(p);
      drag.fit = out.fit;
      drag.m = out.m;
      show(out.m.box, drag.map, { snapped: out.snapped, label: drag.mode === 'move' ? '' : sizeLabel(out.m) });
      if (drag.map.view === 'closeup') drawGhost();
      emit(out.fit, false, 'pointer');
    }
    function end(e, cancelled = false) {
      if (!drag || !drag.pointers.has(e.pointerId)) return;
      drag.pointers.delete(e.pointerId);
      // A pinch ends (and commits) when either finger lifts.
      if (raf) { win.cancelAnimationFrame(raf); raf = 0; if (pending && !cancelled) frame(); }
      try { box.releasePointerCapture(drag.id); } catch {}
      const d = drag;
      drag = null;
      pending = null;
      rootEl.classList.remove('is-dragging', 'is-resizing');
      guide.hidden = true;
      tag.hidden = true;
      ghost.hidden = true;
      if (!d.active) { refresh(); return; }
      if (cancelled) { emit(d.startFit, false, 'cancel'); refresh(); return; }
      emit(d.fit, true, 'pointer');
      announce(describe(d.fit, d.m));
      refresh();
    }

    // Close-up: the stage redraws re-centred, so a ghost of the design follows the pointer.
    function startGhost() {
      const cr = contentRect();
      if (!cr) return;
      const src = doc.createElement('canvas');
      src.width = canvas.width; src.height = canvas.height;
      src.getContext('2d').drawImage(canvas, 0, 0);
      let bg = '#ffffff';
      try { const px = canvas.getContext('2d').getImageData(1, 1, 1, 1).data; bg = `rgb(${px[0]} ${px[1]} ${px[2]})`; } catch {}
      drag.ghost = { src, bg, from: rectToCanvas(drag.startBox, drag.map) };
      ghost.width = canvas.width; ghost.height = canvas.height;
      ghost.style.left = `${cr.left}px`; ghost.style.top = `${cr.top}px`;
      ghost.style.width = `${canvas.width * cr.sx}px`; ghost.style.height = `${canvas.height * cr.sy}px`;
      ghost.hidden = false;
      drawGhost();
    }
    function drawGhost() {
      if (!drag?.ghost) return;
      const g = ghost.getContext('2d');
      const { src, bg, from } = drag.ghost;
      const to = rectToCanvas(drag.m.box, drag.map);
      g.fillStyle = bg;
      g.fillRect(0, 0, ghost.width, ghost.height);
      g.drawImage(src, from.x, from.y, from.w, from.h, to.x, to.y, to.w, to.h);
    }

    // ─── Keyboard ────────────────────────────────────────────────────────
    function key(e) {
      if (drag) { if (e.key === 'Escape') { end({ pointerId: drag.id }, true); return true; } return false; }
      const state = read();
      if (!state) return false;
      cur = state;
      const big = e.shiftKey ? MOVE_BIG_IN : MOVE_STEP_IN;
      const b = state.m.box;
      let out = null;
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        if (!state.canMove) return true;
        out = solve(state, { scale: state.fit.scale, top: b.y + (k === 'ArrowUp' ? -big : big), cx: b.x + b.w / 2 });
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (!state.canMove || !state.hasX) { announce('The design stays centred side to side.'); return true; }
        out = solve(state, { scale: state.fit.scale, top: b.y, cx: b.x + b.w / 2 + (k === 'ArrowLeft' ? -big : big) });
      } else if (k === '+' || k === '=' || k === '-' || k === '_' || k === '−') {
        const limits = state.limits || engineLimits();
        const scale = clamp(r2(state.fit.scale + ((k === '+' || k === '=') ? SCALE_STEP : -SCALE_STEP)), limits.scaleMin, limits.scaleMax);
        const m0 = measure(state.concept, state.spec, { ...state.fit, scale });
        out = solve(state, { scale, top: b.y + b.h / 2 - m0.box.h / 2, cx: b.x + b.w / 2, keepTopNull: !state.canMove });
      } else if (k === '0') {
        const fit = state.yMode ? { scale: 1, topIn: state.fit.topIn, xIn: 0, yIn: 0 } : { scale: 1, topIn: null, xIn: 0 };
        out = { fit, m: measure(state.concept, state.spec, fit) };
      } else return false;
      emit(out.fit, true, 'key');
      announce(k === '0' ? `Reset. ${describe(out.fit, out.m)}` : describe(out.fit, out.m));
      // Show the result now; the page's redraw calls refresh() again.
      if (!rootEl.hidden) show(out.m.box, state.map);
      return true;
    }

    // ─── Wiring ──────────────────────────────────────────────────────────
    const onBlur = () => { if (!drag) box.classList.remove('is-active'); };
    const onDocDown = e => { if (!drag && !box.contains(e.target)) box.classList.remove('is-active'); };
    const onCanvasDown = e => { if (drag && e.pointerType === 'touch' && drag.pointers.size === 1) startPinch(e); };
    // Moves and releases are read on the window too: the press captures the
    // pointer, but a release outside the stage must still end the drag.
    const onUp = e => end(e);
    const onCancel = e => end(e, true);
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onCanvasDown);
    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onCancel, true);
    doc.addEventListener('pointerdown', onDocDown, true);
    boxes.set(box, { key });

    let queued = 0;
    const soon = () => { if (queued || detached) return; queued = win.requestAnimationFrame(() => { queued = 0; refresh(); }); };
    const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(soon) : null;
    ro?.observe(canvas);
    ro?.observe(host);
    const mo = typeof win.MutationObserver === 'function' ? new win.MutationObserver(soon) : null;
    mo?.observe(canvas, { attributes: true, attributeFilter: ['width', 'height', 'hidden', 'style', 'class'] });
    win.addEventListener('resize', soon);
    refresh();

    function detach() {
      detached = true;
      drag = null;
      if (raf) win.cancelAnimationFrame(raf);
      if (queued) win.cancelAnimationFrame(queued);
      ro?.disconnect();
      mo?.disconnect();
      win.removeEventListener('resize', soon);
      canvas.removeEventListener('pointerdown', onCanvasDown);
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onCancel, true);
      doc.removeEventListener('pointerdown', onDocDown, true);
      boxes.delete(box);
      rootEl.remove();
    }
    return {
      refresh, detach,
      get element() { return rootEl; },
      // For checks: the overlay's box in canvas pixels, or null when hidden.
      box() { if (rootEl.hidden || !cur) return null; return rectToCanvas(cur.m.box, cur.map); },
      // For checks: the design box's 4 corners on the canvas (TL TR BR BL; projected on the tote).
      quad() { if (rootEl.hidden || !cur) return null; return quadToCanvas(cur.m.box, cur.map); },
      // For checks: what the overlay is drawn from.
      state() { return cur ? { view: { ...cur.view }, spec: { ...cur.spec }, box: { ...cur.m.box }, map: cur.map.kind, canMove: cur.canMove, hasX: cur.hasX, yMode: cur.yMode, limits: { ...cur.limits } } : null; },
    };
  }

  return {
    VERSION: '2026-11-28-totedrag1', LIMITS, attach,
    canvasToInches, inchesToCanvas, rectToCanvas, quadToCanvas, pointInQuad, clampFit, resizeFromCorner, placeAtAnchor, snapX, pxPerInch,
    // Exposed for tests: the view map from a concept, the engine's design box.
    _mapFor: mapFor, _measure: measure,
  };
}));
