/*
 * FrameUp Generate: the AI design assistant for ONE composed design.
 *
 * Two halves in one UMD file:
 *   1. The scene-patch engine (pure, Node + browser; _design-assistant.js
 *      requires it): JSON ops on a FrameUpCompose scene, the local intents
 *      that need no AI ("brighten the photo", "bigger number"), the undo stack,
 *      critique merging and the per-count cost estimate.
 *   2. The browser controller window.FrameUpAssistant (no layout of its own):
 *        mount(slotEl, { getScene, setScene, designId, runId, context? })
 *          renders the chat inside gen-ui's #gen-assistant-slot;
 *        register(designId, { getScene, setScene, runId, critique, context })
 *          lets cards apply improvements without the focus view;
 *        applyImprovement(designId, improvementId)  one-click AI fix;
 *        undo / redo / commit / history(designId), resize(designId, size);
 *        signal(type, designId, extra)  learning signals (pick, export, ...);
 *        mergeCritique(director, judge), costEstimate(count).
 *      Every change goes through the history and fires
 *      document 'frameup:design-changed' { designId, scene, label, source,
 *      canUndo, canRedo }.
 *
 * Patch ops (validated by FrameUpCompose.checkScene + the fact check):
 *   { op:'set',   target, props }      layout / type / colour props (whitelist)
 *   { op:'text',  target, text }       copy (digits must be facts)
 *   { op:'fx',    target, fx }         shadow / glow / opacity / blend / rotate
 *   { op:'move',  target, dx, dy }     { op:'scale', target, by }
 *   { op:'remove', target }            { op:'order', target, to }
 *   { op:'add',   layer }              shape / pill / text / logo (known logo)
 *   { op:'fix',   name, src? }         FrameUpCompose.FIXES + macros
 *   { op:'photo', src, cutout? }       one of this design's ES photos
 *   { op:'palette', flip | colors }    { op:'archetype', id }  { op:'size', size }
 *   { op:'replace', scene }            a whole scene (server-built)
 * target: a layer index, or { index } / { role, type, nth }.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpAssistant = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const VERSION = '2026-11-19';
  const SAFE = 50;
  const MAX_LAYERS = 28;
  const OPS = ['set', 'text', 'fx', 'move', 'scale', 'remove', 'order', 'add', 'fix', 'photo', 'palette', 'archetype', 'size', 'replace'];
  const MACROS = ['brighten-photo', 'darken-photo', 'more-drama', 'add-logo', 'bigger-logo'];
  const NUM_PROPS = { x: [-1080, 2160], y: [-1350, 3300], w: [0, 2200], h: [0, 3900], size: [10, 700], minSize: [10, 700], maxLines: [1, 10], lineHeight: [0.7, 2], tracking: [-5, 20], radius: [0, 200], textureOpacity: [0, 1], labelSize: [10, 300], maxW: [40, 1080] };
  const ENUM_PROPS = { align: ['left', 'center', 'right'], valign: ['top', 'middle', 'bottom'], font: ['display', 'condensed', 'body'], fit: ['cover', 'contain'], anchor: ['bottom', 'top', 'center'], texture: ['grain', 'halftone', 'rays', 'grid', 'lines', 'none'] };
  const COLOR_PROPS = ['color', 'bg', 'textureColor', 'labelColor', 'unitColor', 'track'];
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'lighten', 'darken'];
  const ADD_TYPES = ['shape', 'pill', 'text', 'logo'];
  const SIZE_KEYS = { portrait: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };

  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
  const isHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const clean = (value, max = 220) => String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max);
  const digitsIn = text => (String(text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []);
  const compose = ctx => ctx?.compose || root?.FrameUpCompose || null;

  // ─── Targets ───────────────────────────────────────────────────────────
  function resolveTarget(scene, target) {
    const layers = scene.layers || [];
    if (Number.isInteger(target)) return target >= 0 && target < layers.length ? [target] : [];
    if (!target || typeof target !== 'object') return [];
    if (Number.isInteger(target.index)) return target.index >= 0 && target.index < layers.length ? [target.index] : [];
    const role = target.role ? String(target.role) : '';
    const type = target.type ? String(target.type) : '';
    if (!role && !type) return [];
    const hits = layers.map((l, i) => ({ l, i })).filter(({ l }) => (!role || l.role === role) && (!type || l.type === type)).map(({ i }) => i);
    if (Number.isInteger(target.nth)) return hits[target.nth] != null ? [hits[target.nth]] : [];
    return hits;
  }

  // ─── Single ops ────────────────────────────────────────────────────────
  function cleanFx(fx) {
    const out = {};
    if (!fx || typeof fx !== 'object') return out;
    if (fx.opacity != null && Number.isFinite(Number(fx.opacity))) out.opacity = clamp(Number(fx.opacity), [0, 1]);
    if (fx.rotate != null && Number.isFinite(Number(fx.rotate))) out.rotate = clamp(Number(fx.rotate), [-8, 8]);
    if (fx.blur != null && Number.isFinite(Number(fx.blur))) out.blur = clamp(Number(fx.blur), [0, 40]);
    if (fx.blend != null && BLENDS.includes(fx.blend)) out.blend = fx.blend;
    ['shadow', 'glow'].forEach(key => {
      if (fx[key] === null) out[key] = null;
      else if (fx[key] && typeof fx[key] === 'object') {
        const s = fx[key];
        out[key] = { color: isHex(s.color) ? s.color.toUpperCase() : '#000000', blur: clamp(Number(s.blur) || 20, [0, 200]), x: clamp(Number(s.x) || 0, [-100, 100]), y: clamp(Number(s.y) || 0, [-100, 100]), alpha: clamp(Number(s.alpha ?? 0.5), [0, 1]) };
      }
    });
    return out;
  }

  function setProps(layer, props) {
    let changed = 0;
    Object.entries(props || {}).forEach(([key, value]) => {
      if (NUM_PROPS[key] && Number.isFinite(Number(value))) { layer[key] = clamp(Number(value), NUM_PROPS[key]); changed += 1; }
      else if (ENUM_PROPS[key] && ENUM_PROPS[key].includes(value)) { layer[key] = value; changed += 1; }
      else if (COLOR_PROPS.includes(key) && isHex(value)) { layer[key] = String(value).toUpperCase(); changed += 1; }
      else if (key === 'duotone' && (value === null || (Array.isArray(value) && value.length === 2 && value.every(isHex)))) { layer.duotone = value; changed += 1; }
      else if (key === 'focus' && value && typeof value === 'object') { layer.focus = { x: clamp(Number(value.x) || 0.5, [0, 1]), y: clamp(Number(value.y) || 0.5, [0, 1]) }; changed += 1; }
      else if (key === 'stops' && Array.isArray(value) && value.length <= 6 && value.every(s => Array.isArray(s) && s.length === 2)) { layer.stops = value.map(([at, a]) => [clamp(Number(at) || 0, [0, 1]), clamp(Number(a) || 0, [0, 1])]); changed += 1; }
    });
    return changed;
  }

  function photoLayers(scene) {
    return scene.layers.filter(l => l.type === 'photo' && l.role !== 'art' && !String(l.src || '').startsWith('proc:'));
  }

  // Where a new logo fits: the free corner (never the ES mark's top-right).
  function freeCorner(scene, w, h) {
    const W = scene.size?.w || 1080;
    const H = scene.size?.h || 1350;
    const corners = [{ x: SAFE, y: H - SAFE - h }, { x: W - SAFE - w, y: H - SAFE - h }, { x: SAFE, y: SAFE }];
    const textish = scene.layers.filter(l => ['text', 'number', 'pill', 'chart'].includes(l.type));
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + (b.w || b.maxW || 0)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + (b.h || 0)) - Math.max(a.y, b.y));
    return corners.map(c => ({ ...c, cost: textish.reduce((n, l) => n + overlap({ ...c, w, h }, l), 0) })).sort((a, b) => a.cost - b.cost)[0];
  }

  function macro(scene, name, op, ctx) {
    const C = compose(ctx);
    let next = scene;
    if (name === 'brighten-photo') {
      const photos = photoLayers(next);
      if (!photos.length) return { scene: next, error: 'There is no photo to brighten.' };
      photos.forEach(l => { l.fx = { ...(l.fx || {}), opacity: Math.min(1, (l.fx?.opacity ?? 1) + 0.25) }; if (l.fx.blend === 'multiply') delete l.fx.blend; });
      next.layers.filter(l => l.shape === 'gradient').forEach(l => { l.stops = (l.stops || [[0, 0], [1, 0.9]]).map(([at, a]) => [at, Math.max(0, Number((a * 0.75).toFixed(2)))]); });
    } else if (name === 'darken-photo') {
      const photos = photoLayers(next);
      if (!photos.length) return { scene: next, error: 'There is no photo to darken.' };
      photos.forEach(l => { l.fx = { ...(l.fx || {}), opacity: Math.max(0.25, Number(((l.fx?.opacity ?? 1) * 0.75).toFixed(2))) }; });
      if (C) next = C.applyFix(next, 'darker-mist');
    } else if (name === 'more-drama') {
      if (C) next = C.applyFix(next, 'more-contrast');
      next.layers.forEach(l => {
        if (l.type === 'background') { l.textureOpacity = Math.min(0.3, (l.textureOpacity || 0.06) + 0.06); if (!l.texture) l.texture = 'grain'; }
        if (l.role === 'headline' || l.role === 'number') l.size = Math.round((l.size || 120) * 1.08);
        if (l.shape === 'gradient') l.stops = (l.stops || [[0, 0], [1, 0.9]]).map(([at, a]) => [at, Math.min(1, Number((a + 0.1).toFixed(2)))]);
      });
    } else if (name === 'add-logo') {
      const src = op.src || ctx?.logos?.[0]?.src || '';
      if (!src || !(ctx?.logos || []).some(l => l.src === src)) return { scene: next, error: 'No team or league logo is known for this story.' };
      if (next.layers.some(l => l.type === 'logo' && l.src === src)) return { scene: next, error: 'The logo is already on the design.' };
      const spot = freeCorner(next, 130, 130);
      next.layers.push({ type: 'logo', kind: 'team', src, x: spot.x, y: spot.y, w: 130, h: 130 });
    } else if (name === 'bigger-logo') {
      const logos = next.layers.filter(l => l.type === 'logo');
      if (!logos.length) return { scene: next, error: 'There is no logo on the design.' };
      logos.forEach(l => { l.w = Math.round((l.w || 110) * 1.2); l.h = Math.round((l.h || 110) * 1.2); });
    }
    return { scene: next };
  }

  // Composer input from a scene (for archetype swaps and size changes).
  function inputsFromScene(scene, ctx = {}) {
    const layers = scene.layers || [];
    const textOf = role => layers.find(l => l.role === role && (l.type === 'text' || l.type === 'pill'))?.text || '';
    const nums = layers.filter(l => l.type === 'number' && l.value);
    const main = nums.find(l => l.factId) || nums[0] || null;
    const photos = photoLayers(scene);
    const sizeKey = Object.keys(SIZE_KEYS).find(k => SIZE_KEYS[k].w === scene.size?.w && SIZE_KEYS[k].h === scene.size?.h) || 'portrait';
    const quote = textOf('quote');
    const unitChart = layers.find(l => l.type === 'chart' && l.chart === 'units');
    return {
      size: sizeKey,
      sport: ctx.sport || scene.sport || '',
      palette: scene.palette,
      kicker: textOf('kicker'),
      headline: textOf('headline') || quote,
      highlight: [],
      body: textOf('body'),
      name: textOf('name'),
      number: main ? { prefix: main.prefix || '', value: main.value, suffix: main.suffix || '', label: main.label || '', factId: main.factId || '' } : null,
      numbers: nums.map(l => ({ prefix: l.prefix || '', value: l.value, suffix: l.suffix || '', display: `${l.prefix || ''}${l.value}${l.suffix || ''}`, label: l.label || '', factId: l.factId || '' })),
      photo: photos[0] ? { src: photos[0].src, focus: photos[0].focus } : (ctx.photos?.[0] ? { src: ctx.photos[0].src } : null),
      photos: photos.slice(1).map(p => ({ src: p.src })),
      cutout: layers.find(l => l.type === 'cutout') ? { src: layers.find(l => l.type === 'cutout').src } : (ctx.photos?.find(p => p.cutout) ? { src: ctx.photos.find(p => p.cutout).cutout } : null),
      art: layers.find(l => l.role === 'art') ? { src: layers.find(l => l.role === 'art').src } : null,
      logos: [...layers.filter(l => l.type === 'logo').map(l => ({ src: l.src })), ...(ctx.logos || [])].filter((l, i, a) => l.src && a.findIndex(x => x.src === l.src) === i),
      quote: quote ? { text: quote, by: textOf('name') } : null,
      unit: unitChart?.unit || 'dot',
      facts: scene.facts || [],
      // Scores, records, compares, split sides and quotes the composer kept.
      ...(scene.extra && typeof scene.extra === 'object' ? scene.extra : {}),
    };
  }

  function rebuild(scene, archetype, sizeKey, ctx) {
    const C = compose(ctx);
    if (!C) return { error: 'The composer is not loaded.' };
    if (!C.BY_ID?.[archetype]) return { error: `"${archetype}" is not a composition.` };
    const input = { ...inputsFromScene(scene, ctx), ...(sizeKey ? { size: sizeKey } : {}) };
    if (!C.fits(archetype, input)) return { error: `The ${C.BY_ID[archetype].name} composition needs things this design does not have.` };
    const variant = archetype === scene.archetype ? (scene.variant || 0) : 0;
    const next = C.build(archetype, input, variant);
    next.facts = scene.facts || next.facts;
    if (scene.id) next.id = scene.id;
    return { scene: next };
  }

  function applyOne(scene, op, ctx = {}) {
    if (!op || typeof op !== 'object' || !OPS.includes(op.op)) return { scene, error: `Unknown change "${clean(op?.op, 20)}".` };
    const C = compose(ctx);
    let next = clone(scene);
    const idx = op.target != null ? resolveTarget(next, op.target) : [];
    const needTarget = ['set', 'text', 'fx', 'move', 'scale', 'remove', 'order'].includes(op.op);
    if (needTarget && !idx.length) return { scene, error: 'That part of the design was not found.' };
    switch (op.op) {
      case 'set': {
        const n = idx.reduce((sum, i) => sum + setProps(next.layers[i], op.props), 0);
        if (!n) return { scene, error: 'Nothing to change.' };
        break;
      }
      case 'text': {
        const value = clean(op.text, 220);
        if (!value) return { scene, error: 'Empty text.' };
        idx.slice(0, 1).forEach(i => {
          const l = next.layers[i];
          if (l.type === 'number') l.label = value.toUpperCase();
          else if (l.type === 'text' || l.type === 'pill') l.text = l.role === 'body' ? value : value.toUpperCase();
        });
        break;
      }
      case 'fx':
        idx.forEach(i => {
          const fx = cleanFx(op.fx);
          const merged = { ...(next.layers[i].fx || {}), ...fx };
          Object.keys(merged).forEach(k => { if (merged[k] === null) delete merged[k]; });
          next.layers[i].fx = merged;
        });
        break;
      case 'move': {
        const dx = clamp(Number(op.dx) || 0, [-1000, 1000]);
        const dy = clamp(Number(op.dy) || 0, [-1400, 1400]);
        idx.forEach(i => { const l = next.layers[i]; if (l.type === 'background') return; l.x = (l.x || 0) + dx; l.y = (l.y || 0) + dy; });
        break;
      }
      case 'scale': {
        const by = clamp(Number(op.by) || 1, [0.5, 2]);
        idx.forEach(i => {
          const l = next.layers[i];
          if (l.type === 'background') return;
          const cx = (l.x || 0) + (l.w || 0) / 2;
          const cy = (l.y || 0) + (l.h || 0) / 2;
          if (l.w) l.w = Math.round(l.w * by);
          if (l.h) l.h = Math.round(l.h * by);
          if (l.size) l.size = Math.round(l.size * by);
          if (l.minSize) l.minSize = Math.round(l.minSize * Math.min(by, 1.2));
          l.x = Math.round(cx - (l.w || 0) / 2);
          l.y = Math.round(cy - (l.h || 0) / 2);
        });
        break;
      }
      case 'remove': {
        const drop = new Set(idx.filter(i => next.layers[i].type !== 'background'));
        if (!drop.size) return { scene, error: 'The background cannot be removed.' };
        next.layers = next.layers.filter((_, i) => !drop.has(i));
        break;
      }
      case 'order': {
        const i = idx[0];
        const [layer] = next.layers.splice(i, 1);
        if (layer.type === 'background') return { scene, error: 'The background stays at the back.' };
        const bottom = next.layers[0]?.type === 'background' ? 1 : 0;
        const to = op.to === 'front' ? next.layers.length : op.to === 'back' ? bottom : op.to === 'up' ? Math.min(next.layers.length, i + 1) : op.to === 'down' ? Math.max(bottom, i - 1) : i;
        next.layers.splice(to, 0, layer);
        break;
      }
      case 'add': {
        const raw = op.layer && typeof op.layer === 'object' ? op.layer : null;
        if (!raw || !ADD_TYPES.includes(raw.type)) return { scene, error: 'Only shapes, pills, text and known logos can be added.' };
        if (next.layers.length >= MAX_LAYERS) return { scene, error: 'The design already has the most layers allowed.' };
        if (raw.type === 'logo' && !(ctx.logos || []).some(l => l.src === raw.src)) return { scene, error: 'Only this story\'s team or league logos can be added.' };
        const layer = { type: raw.type };
        if (raw.type === 'shape') layer.shape = ['rect', 'gradient'].includes(raw.shape) ? raw.shape : 'rect';
        if (raw.type === 'text' || raw.type === 'pill') {
          layer.role = ['kicker', 'body', 'label', 'headline'].includes(raw.role) ? raw.role : 'label';
          layer.text = layer.role === 'body' ? clean(raw.text, 160) : clean(raw.text, 80).toUpperCase();
          if (!layer.text) return { scene, error: 'Empty text.' };
          layer.font = ENUM_PROPS.font.includes(raw.font) ? raw.font : 'condensed';
          layer.maxLines = 2;
        }
        if (raw.type === 'logo') { layer.kind = raw.kind === 'league' ? 'league' : 'team'; layer.src = raw.src; }
        setProps(layer, { x: SAFE, y: SAFE, w: 300, h: 80, size: 40, color: next.palette?.ink, ...raw });
        if (raw.type === 'pill') { layer.bg = isHex(raw.bg) ? raw.bg : next.palette?.accent; layer.h = layer.h || 52; }
        if (raw.fx) layer.fx = cleanFx(raw.fx);
        next.layers.push(layer);
        break;
      }
      case 'fix': {
        const name = String(op.name || '');
        if (MACROS.includes(name)) {
          const res = macro(next, name, op, ctx);
          if (res.error) return { scene, error: res.error };
          next = res.scene;
        } else if (C && (C.FIXES || []).includes(name)) {
          next = C.applyFix(next, name);
        } else return { scene, error: `Unknown fix "${clean(name, 30)}".` };
        break;
      }
      case 'photo': {
        const pick = (ctx.photos || []).find(p => p.src === op.src);
        if (!pick) return { scene, error: 'Only this design\'s ES photos can be used.' };
        if (!C) return { scene, error: 'The composer is not loaded.' };
        next = C.swapPhoto(next, { from: C.mainPhoto(next), to: pick.src, cutout: pick.cutout || '', photo: pick });
        break;
      }
      case 'palette': {
        if (!C) return { scene, error: 'The composer is not loaded.' };
        let pal = null;
        if (op.flip) pal = C.flipPalette(next.palette);
        else if (Array.isArray(op.colors) && op.colors.length && op.colors.every(isHex)) pal = C.makePalette(op.colors.slice(0, 4), { name: clean(op.name, 40) });
        if (!pal) return { scene, error: 'Pick a palette.' };
        const old = next.palette || {};
        const map = new Map(['bg', 'bg2', 'ink', 'accent', 'paper', 'paperInk', 'mist'].filter(k => isHex(old[k]) && isHex(pal[k])).map(k => [String(old[k]).toUpperCase(), String(pal[k]).toUpperCase()]));
        next.layers.forEach(l => {
          COLOR_PROPS.forEach(k => { if (map.has(String(l[k] || '').toUpperCase())) l[k] = map.get(String(l[k]).toUpperCase()); });
          if (l.fill?.colors) l.fill.colors = l.fill.colors.map(c => map.get(String(c).toUpperCase()) || c);
          if (Array.isArray(l.duotone)) l.duotone = l.duotone.map(c => map.get(String(c).toUpperCase()) || c);
        });
        next.palette = pal;
        break;
      }
      case 'archetype':
      case 'size': {
        const sizeKey = op.op === 'size' ? (SIZE_KEYS[op.size] ? op.size : '') : '';
        if (op.op === 'size' && !sizeKey) return { scene, error: 'Sizes: portrait, story or square.' };
        const res = rebuild(next, op.op === 'size' ? next.archetype : String(op.id || ''), sizeKey, ctx);
        if (res.error) return { scene, error: res.error };
        next = res.scene;
        break;
      }
      case 'replace': {
        const s = op.scene;
        if (!s || typeof s !== 'object' || !Array.isArray(s.layers) || s.kind !== 'composed') return { scene, error: 'Not a design.' };
        next = clone(s);
        if (!next.facts?.length) next.facts = scene.facts || [];
        break;
      }
      default:
        return { scene, error: 'Unknown change.' };
    }
    return { scene: next };
  }

  // The ES gate + the fact check: digits must come from the brief's facts or
  // already be on the design. Returns { ok, errors, fixes, scene }.
  function validate(scene, original, ctx = {}) {
    const C = compose(ctx);
    if (!C) return { ok: false, errors: [{ rule: 'composer', msg: 'The composer is not loaded.' }], fixes: [], scene };
    const before = (original?.layers || []).flatMap(l => digitsIn(`${l.prefix || ''}${l.value || ''}${l.suffix || ''} ${l.label || ''} ${l.text || ''} ${l.count != null ? l.count : ''}`));
    const facts = [...(scene.facts || original?.facts || []), ...(ctx.facts || []), { id: 'on-design', text: before.join(' ') }];
    const next = clone(scene);
    const checked = C.checkScene(next, { facts });
    return { ok: checked.ok, errors: checked.errors, fixes: checked.fixes, scene: checked.scene || next };
  }

  // Applies ops one at a time; an op that breaks the ES gate or the fact
  // check is skipped (and said why), the rest still apply.
  function applyPatch(scene, ops = [], ctx = {}) {
    let current = clone(scene);
    const applied = [];
    const skipped = [];
    const fixes = [];
    (Array.isArray(ops) ? ops : [ops]).slice(0, 12).forEach(op => {
      const res = applyOne(current, op, ctx);
      if (res.error) { skipped.push({ op: op?.op || '', why: res.error }); return; }
      const checked = validate(res.scene, scene, ctx);
      if (!checked.ok) { skipped.push({ op: op.op, why: checked.errors.map(e => e.msg).join('; ').slice(0, 200) }); return; }
      current = checked.scene;
      fixes.push(...checked.fixes.map(f => f.what));
      applied.push(op);
    });
    return { scene: current, applied, skipped, fixes: [...new Set(fixes)].slice(0, 8), ok: applied.length > 0 };
  }

  // ─── Local intents (free: no AI call) ──────────────────────────────────
  const ROLE_WORDS = { number: { type: 'number' }, stat: { type: 'number' }, headline: { role: 'headline' }, title: { role: 'headline' }, kicker: { role: 'kicker' }, logo: { type: 'logo' }, photo: { type: 'photo' }, name: { role: 'name' }, quote: { role: 'quote' }, label: { role: 'label' } };
  function localIntent(text, scene, ctx = {}) {
    const t = clean(text, 300).toLowerCase();
    if (!t) return null;
    // Compound asks ("X and Y", "then") go to the AI.
    if (/\b(?:and then|then|also)\b|,\s*\w+\s+the\b/.test(t)) return null;
    const C = compose(ctx);
    const one = (op, reply) => ({ ops: [op], reply });
    if (/\b(?:bright(?:en|er)|lighter|lift)\b[^.]*\b(?:photo|image|picture)\b|\b(?:photo|image|picture)\b[^.]*\b(?:brighter|too dark|lighter)\b/.test(t)) return one({ op: 'fix', name: 'brighten-photo' }, 'Brightened the photo and lightened the mist.');
    if (/\b(?:darken|darker|moodier|dim)\b[^.]*\b(?:photo|image|picture|background)\b/.test(t)) return one({ op: 'fix', name: 'darken-photo' }, 'Darkened the photo so the type pops.');
    if (/\b(?:bigger|larger|enlarge|increase|grow)\b[^.]*\bnumber\b|\bnumber\b[^.]*\b(?:bigger|larger)\b/.test(t)) return one({ op: 'fix', name: 'bigger-number' }, 'Made the number bigger.');
    if (/\b(?:bigger|larger|enlarge)\b[^.]*\bheadline\b|\bheadline\b[^.]*\b(?:bigger|larger)\b/.test(t)) return one({ op: 'fix', name: 'bigger-headline' }, 'Made the headline bigger.');
    if (/\bmore contrast\b|\bmore readable\b|\beasier to read\b/.test(t)) return one({ op: 'fix', name: 'more-contrast' }, 'Added contrast behind the type.');
    if (/\b(?:less clutter|declutter|cleaner|simplify|simpler|calmer)\b/.test(t)) return one({ op: 'fix', name: 'less-clutter' }, 'Removed the extra pills and body copy.');
    if (/\b(?:swap|flip|invert|reverse)\b[^.]*\b(?:palette|colou?rs)\b/.test(t)) return one({ op: 'palette', flip: true }, 'Flipped the palette.');
    if (/\bmove (?:the )?headline up\b/.test(t)) return one({ op: 'fix', name: 'move-headline-up' }, 'Moved the headline up.');
    if (/\bmore drama\b|\bmore dramatic\b|\bmake it pop\b/.test(t)) return one({ op: 'fix', name: 'more-drama' }, 'More drama: deeper mist, more contrast, bigger type, more grain.');
    if (/\b(?:add|show|put|include)\b[^.]*\blogo\b/.test(t)) {
      const logo = (ctx.logos || []).find(l => t.includes(String(l.name || '').toLowerCase()) && l.name) || (ctx.logos || [])[0];
      return logo ? one({ op: 'fix', name: 'add-logo', src: logo.src }, `Added the ${logo.name || 'team'} logo in the free corner.`) : null;
    }
    if (/\b(?:bigger|larger)\b[^.]*\blogo\b/.test(t)) return one({ op: 'fix', name: 'bigger-logo' }, 'Made the logo bigger.');
    const move = t.match(/\bmove (?:the )?(number|stat|headline|title|kicker|logo|photo|name|quote|label)\s+(?:to the\s+)?(left|right|up|down)(?:\s+(?:by\s+)?(\d{1,3})\s*(?:px)?)?\b/);
    if (move) {
      const by = Math.min(400, Number(move[3]) || 80);
      const d = { left: [-by, 0], right: [by, 0], up: [0, -by], down: [0, by] }[move[2]];
      return one({ op: 'move', target: { ...ROLE_WORDS[move[1]], nth: 0 }, dx: d[0], dy: d[1] }, `Moved the ${move[1]} ${move[2]}.`);
    }
    const size = t.match(/\b(?:make it|switch to|change to|as an?|resize to)\s+(?:a |an |the )?(story|square|portrait)\b/);
    if (size) return one({ op: 'size', size: size[1] }, `Rebuilt it as ${size[1] === 'story' ? 'a 1080 × 1920 story' : size[1] === 'square' ? 'a 1080 × 1080 square' : 'a 1080 × 1350 portrait'}.`);
    if (C && /\b(?:swap|switch|change|turn|try|use)\b[^.]*\b(?:to|into|as|the)\b[^.]*\b(?:layout|composition|design|look|version)\b/.test(t)) {
      const words = t.replace(/[^a-z ]/g, ' ');
      const hit = (C.ARCHETYPES || []).map(a => ({ a, score: [a.id.replace(/-/g, ' '), String(a.name || '').toLowerCase()].reduce((n, label) => n + label.split(' ').filter(w => w.length > 3 && words.includes(w)).length, 0) })).filter(x => x.score > 0).sort((x, y) => y.score - x.score)[0];
      if (hit && hit.a.id !== scene.archetype) return one({ op: 'archetype', id: hit.a.id }, `Rebuilt it as ${hit.a.name}.`);
    }
    return null;
  }

  // ─── Undo / redo ───────────────────────────────────────────────────────
  function createHistory(initial, { limit = 50 } = {}) {
    let past = [];
    let present = { scene: clone(initial), label: 'Original' };
    let future = [];
    return {
      get current() { return clone(present.scene); },
      get label() { return present.label; },
      push(scene, label = 'Change') {
        past.push(present);
        if (past.length > limit) past = past.slice(past.length - limit);
        present = { scene: clone(scene), label: clean(label, 80) || 'Change' };
        future = [];
        return clone(present.scene);
      },
      undo() {
        if (!past.length) return null;
        future.unshift(present);
        present = past.pop();
        return clone(present.scene);
      },
      redo() {
        if (!future.length) return null;
        past.push(present);
        present = future.shift();
        return clone(present.scene);
      },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      entries: () => [...past.map((e, i) => ({ label: e.label, at: i, current: false })), { label: present.label, at: past.length, current: true }, ...future.map((e, i) => ({ label: e.label, at: past.length + 1 + i, current: false }))],
      size: () => past.length + 1 + future.length,
    };
  }

  // ─── Critique ──────────────────────────────────────────────────────────
  // design.critique = { strengths:[], improvements:[{ id, text, fix:{op...} }], nextTime:'' }
  const fingerprint = text => String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(' ').filter(w => w.length > 3).slice(0, 4).sort().join(' ');
  function mergeCritique(...parts) {
    const list = parts.filter(p => p && typeof p === 'object');
    const strengths = [];
    const improvements = [];
    const seen = new Set();
    list.forEach(p => (p.strengths || []).forEach(s => { const v = clean(s, 140); if (v && !strengths.some(x => fingerprint(x) === fingerprint(v))) strengths.push(v); }));
    list.forEach(p => (p.improvements || []).forEach(item => {
      const text = clean(typeof item === 'string' ? item : item?.text, 160);
      if (!text) return;
      const key = fingerprint(text);
      const fixKey = item?.fix?.op === 'fix' ? `fix:${item.fix.name}` : '';
      if (seen.has(key) || (fixKey && seen.has(fixKey))) return;
      seen.add(key);
      if (fixKey) seen.add(fixKey);
      const fix = item?.fix && OPS.concat('assist').includes(item.fix.op) ? item.fix : { op: 'assist', instruction: text };
      improvements.push({ id: `i${improvements.length + 1}`, text, fix, source: item?.source || p.source || '' });
    }));
    const nextTime = clean(list.map(p => p.nextTime).find(Boolean), 160);
    return { strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 4), nextTime };
  }
  // design.critique for a card: the director's (and the free checks'), then
  // the judge's, minus the fix the judge already applied to this scene.
  function designCritique(directionCritique, verdictCritique, scene) {
    const merged = mergeCritique(verdictCritique, directionCritique);
    const done = scene?.fixApplied || '';
    merged.improvements = merged.improvements.filter(i => !(done && i.fix?.op === 'fix' && i.fix.name === done)).map((i, n) => ({ ...i, id: `i${n + 1}` }));
    return merged;
  }
  // A suggestion chip's label: the whole suggestion, never cut mid-word (the
  // chip wraps). Sentence case, no closing full stop.
  const chipLabel = item => clean(item?.text, 400).replace(/[.]+$/, '').replace(/^./, c => c.toUpperCase());

  // ─── Design review (gen v4) ────────────────────────────────────────────
  // The server fixes small problems WHILE designing and returns
  //   design.review = { autoFixed: [...], suggestions: [...] }
  // where suggestions are creative ideas only ("Try a versus layout"). The page
  // shows autoFixed as one quiet line and suggestions as chips. A repair that
  // still reaches the page (an older server, the quick check) is never offered
  // as a suggestion: repairs are the director's job before delivery.
  const REPAIR = /\b(?:murky|washed[- ]?out|irrelevant|unrelated|blurr?y|blurred|low[- ]?res|pixel\w*|grainy|missing|absent|no (?:photo|image|picture|logo|cut-?out|face)|without (?:a |any )?(?:photo|image|picture)|shows no|dropp?(?:ed|s)|typo|misspel\w*|colon|comma|apostrophe|punctuation|capitali[sz]\w*|tag|cut off|cropp?ed|clipp?ed|overlap\w*|collid\w*|clash\w*|covers? (?:the |his |her )?(?:face|head|text|headline|number)|hidden behind|behind the (?:headline|text|number)|too (?:small|dark|light|bright|faint|busy|long|tight|close|low|thin)|hard to (?:read|see)|legib\w*|contrast|unreadable|off[- ]cent\w*|misalign\w*|empty|blank|cramped|crowded|wrong|incorrect|mismatch\w*|(?:does not|doesn't|not) match|error|broken|lacks?|stray|duplicated?|repeated|safe (?:area|zone)|margins?|edges?|could (?:be|use) (?:a )?\w+er|needs? (?:to|a|more|less)|should (?:be|have))\b/i;
  const IDEA = /^(?:try|swap|switch|lead with|open with|make it|go (?:bolder|bigger|darker|lighter|minimal|editorial|retro)|turn|flip|consider|experiment|play|pair|frame|tell|build|add (?:a |an )?(?:quote|stat|second|countdown|timeline|versus|comparison|record|split)|use (?:a |the )?\S+ (?:layout|look|style|treatment))\b/i;
  function isRepair(item) {
    const text = clean(typeof item === 'string' ? item : item?.text, 400);
    if (!text) return true;
    const fix = item && typeof item === 'object' ? item.fix : null;
    const name = fix?.op === 'fix' ? fix.name : fix && fix.op && !OPS.includes(fix.op) && fix.op !== 'assist' ? fix.op : '';
    if (name) return true; // a named composer fix is a repair by definition
    if (IDEA.test(text)) return REPAIR.test(text.replace(IDEA, ''));
    return REPAIR.test(text);
  }
  // { given, autoFixed: [string], suggestions: [{ text, fix }] } from any review
  // shape: strings or { text | what | note | label } items, several sources.
  const noteText = item => clean(typeof item === 'string' ? item : item?.text || item?.what || item?.note || item?.label || '', 200).replace(/[.]+$/, '');
  function normalizeReview(...sources) {
    const autoFixed = [];
    const suggestions = [];
    let given = false;
    sources.filter(s => s && typeof s === 'object').forEach(s => {
      if (Array.isArray(s.autoFixed) || Array.isArray(s.suggestions)) given = true;
      (Array.isArray(s.autoFixed) ? s.autoFixed : []).forEach(item => {
        const text = noteText(item);
        if (text && !autoFixed.some(x => x.toLowerCase() === text.toLowerCase())) autoFixed.push(text);
      });
      (Array.isArray(s.suggestions) ? s.suggestions : []).forEach(item => {
        const text = noteText(item);
        if (!text || suggestions.some(x => x.text.toLowerCase() === text.toLowerCase())) return;
        suggestions.push({ text, fix: item && typeof item === 'object' && item.fix ? item.fix : null });
      });
    });
    return { given, autoFixed: autoFixed.slice(0, 8), suggestions: suggestions.filter(s => !isRepair(s)).slice(0, 3) };
  }
  // "Brighter photo, the colon after MANFRED and 1 more." Every item is named
  // in full (no cut words); past four they are counted.
  function fixedLine(autoFixed = [], { max = 4 } = {}) {
    const list = (autoFixed || []).map(noteText).filter(Boolean);
    if (!list.length) return '';
    const shown = list.slice(0, max).map((t, i) => (i === 0 ? t.replace(/^./, c => c.toUpperCase()) : t.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())));
    const rest = list.length - shown.length;
    const parts = rest > 0 ? [...shown, `${rest} more`] : shown;
    return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
  }
  // What a design shows after delivery: what works and next time (director /
  // judge), autoFixed (with the judge's one in-code fix) and improvements =
  // creative suggestions only. Ids stay stable, so Apply matches everywhere.
  function reviewCritique(directionCritique, verdictCritique, scene, ...reviews) {
    const merged = designCritique(directionCritique, verdictCritique, scene);
    const review = normalizeReview(...reviews, scene?.review);
    const own = scene?.fixApplied ? String(scene.fixApplied).replace(/-/g, ' ') : '';
    const autoFixed = own && !review.autoFixed.some(x => x.toLowerCase().includes(own.toLowerCase())) ? [...review.autoFixed, own] : review.autoFixed;
    const improvements = review.given
      ? review.suggestions.map((s, n) => ({ id: `s${n + 1}`, text: s.text, fix: s.fix && (OPS.includes(s.fix.op) || s.fix.op === 'assist') ? s.fix : { op: 'assist', instruction: s.text }, source: 'review' }))
      : merged.improvements.filter(i => !isRepair(i));
    return { ...merged, improvements, autoFixed, reviewed: review.given };
  }

  // ─── Cost per design count (shown before a run) ────────────────────────
  // director (Sonnet, ~$0.008 for 4, grows with count), vision judge (Sonnet,
  // ~$0.0009 per 360px image; 3 candidates up to 4 designs, 2 above),
  // assets (cut-outs + concept art when the asset service is on).
  function costEstimate(count = 4, { assets = true } = {}) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count) || 4)));
    const perDesign = n > 4 ? 2 : 3;
    // gen5: Opus art director, a Sonnet judge with 3 ES board references, one
    // second look at repaired designs (the server caps a run at $0.25).
    const director = 0.045 + 0.006 * n;
    const judge = 0.012 + 0.0022 * n * perDesign;
    const recheck = 0.008 + 0.002 * n;
    const low = director + judge + recheck + (assets ? 0.02 : 0);
    const high = director + judge + recheck + (assets ? 0.03 + 0.03 * Math.min(n, 6) : 0);
    return { count: n, candidatesPerDesign: perDesign, low: Number(low.toFixed(3)), high: Number(high.toFixed(3)), label: `~$${low.toFixed(2)}–$${high.toFixed(2)}` };
  }

  const engine = { VERSION, OPS, MACROS, resolveTarget, applyOne, applyPatch, validate, localIntent, inputsFromScene, createHistory, mergeCritique, designCritique, reviewCritique, normalizeReview, isRepair, fixedLine, chipLabel, costEstimate };

  // ─── Browser controller ────────────────────────────────────────────────
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (!hasDom) return { ...engine, engine };

  const designs = new Map();
  const esc = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => `$${Number(v || 0).toFixed(Number(v || 0) >= 0.1 ? 2 : 3)}`;
  const G = () => window.FrameUpGenerate;
  const Creative = () => window.FrameUpCreative;

  // The plan's direction for a design id ("d2", "run:d2", "d2c1").
  function directionFor(designId) {
    const plan = Creative()?.state?.run?.plan;
    const id = String(designId || '');
    return (plan?.directions || []).find(d => id === d.id || id.endsWith(`:${d.id}`) || id.endsWith(`-${d.id}`) || id.startsWith(`${d.id}c`)) || null;
  }
  function contextFor(entry) {
    const plan = Creative()?.state?.run?.plan;
    const dir = directionFor(entry.designId);
    const own = entry.context || {};
    return {
      sport: own.sport || plan?.read?.sport || '',
      brief: own.brief || Creative()?.state?.run?.brief || '',
      photos: own.photos || (dir?.photos || []).map(p => ({ src: p.src, cutout: p.cutout || '', person: p.person || '' })),
      logos: own.logos || (plan?.read?.teams || []).filter(t => t.logo).map(t => ({ src: t.logo, name: t.name })),
      facts: own.facts || (plan?.read?.facts || []).map(f => ({ id: f.id, text: f.text })),
      archetypeName: dir?.archetypeName || '',
      compose: window.FrameUpCompose,
    };
  }

  function entryFor(designId, opts = {}) {
    const id = String(designId || '');
    if (!id) return null;
    let entry = designs.get(id);
    if (!entry) {
      entry = { designId: id, chat: [], cost: 0, applied: new Set(), history: null };
      designs.set(id, entry);
    }
    ['getScene', 'setScene', 'runId', 'critique', 'context'].forEach(k => { if (opts[k] !== undefined) entry[k] = opts[k]; });
    if (!entry.history && !hostOf(entry) && typeof entry.getScene === 'function') {
      const scene = entry.getScene();
      if (scene) entry.history = createHistory(scene);
    }
    return entry;
  }

  // ONE history. On the Generate page the design's versions live in
  // generate-creative.js (FrameUpCreative.design(id).history, gen-ui's History):
  // every assistant change goes through the host's setScene(scene, { label })
  // (one version per change, the host fires 'frameup:design-changed'), and
  // undo / redo call the host. The private stack below is only for pages that
  // mount the assistant without such a host.
  function hostOf(entry) {
    try { return Creative()?.design?.(entry?.designId) || null; } catch (error) { return null; }
  }
  const hostHistory = entry => hostOf(entry)?.history || null;
  function currentScene(entry) {
    const host = hostOf(entry);
    if (host) return clone(host.getScene());
    if (entry?.history) return entry.history.current;
    const scene = typeof entry?.getScene === 'function' ? entry.getScene() : null;
    return scene ? clone(scene) : null;
  }
  // The design's critique: the one registered for it (B's merged critique, the
  // same object the cards render) or, failing that, the host's.
  function critiqueOf(entry) {
    const own = entry?.critique;
    if (own?.improvements?.length) return own;
    try { return hostOf(entry)?.critique?.() || own || null; } catch (error) { return own || null; }
  }
  // A quick-check item carries a bare fix name ({ op: 'more-contrast' }).
  const fixOp = fix => (fix && fix.op && !OPS.includes(fix.op) && fix.op !== 'assist' ? { op: 'fix', name: fix.op } : fix);
  function improvementOf(entry, id) {
    const pick = list => (list?.improvements || []).find(i => i.id === id);
    let item = pick(entry?.critique);
    if (!item) { try { item = pick(hostOf(entry)?.critique?.()); } catch (error) { item = null; } }
    return item ? { ...item, fix: fixOp(item.fix) } : null;
  }
  const canUndo = entry => { const h = hostHistory(entry); return h ? Boolean(h.canUndo) : Boolean(entry?.history?.canUndo()); };
  const canRedo = entry => { const h = hostHistory(entry); return h ? Boolean(h.canRedo) : Boolean(entry?.history?.canRedo()); };
  // A new version: through the host when there is one, else the private stack.
  async function pushScene(entry, scene, label, source) {
    const host = hostOf(entry);
    if (host) {
      await (entry.setScene || host.setScene)(scene, { label, source: 'assistant', via: source });
      entry.ui?.paint();
      return true;
    }
    if (!entry.history) entry.history = createHistory(scene);
    else entry.history.push(scene, label);
    emit(entry, label, source);
    return true;
  }

  // source 'host': the host already shows this scene (its own edit), so only
  // the history and the event change.
  function emit(entry, label, source) {
    const scene = entry.history.current;
    if (source !== 'host') {
      try { entry.setScene?.(scene, { label, source: 'assistant', via: source }); } catch (error) { /* the host re-renders on the event */ }
    }
    document.dispatchEvent(new CustomEvent('frameup:design-changed', { detail: { designId: entry.designId, scene, label, source, canUndo: entry.history.canUndo(), canRedo: entry.history.canRedo(), history: entry.history.entries() } }));
    entry.ui?.paint();
  }

  function commit(designId, scene, label = 'Edit', source = 'host') {
    const entry = entryFor(designId);
    if (!entry || !scene) return false;
    if (hostOf(entry)) { entry.ui?.paint(); return true; } // the host's history already has it
    if (!entry.history) entry.history = createHistory(scene);
    else entry.history.push(scene, label);
    emit(entry, label, source);
    return true;
  }
  function undo(designId) {
    const entry = entryFor(designId);
    const host = hostOf(entry);
    if (host) return host.history?.canUndo ? (host.undo(), true) : false;
    if (!entry?.history?.canUndo()) return false;
    entry.history.undo();
    emit(entry, 'Undo', 'history');
    return true;
  }
  function redo(designId) {
    const entry = entryFor(designId);
    const host = hostOf(entry);
    if (host) return host.history?.canRedo ? (host.redo(), true) : false;
    if (!entry?.history?.canRedo()) return false;
    entry.history.redo();
    emit(entry, 'Redo', 'history');
    return true;
  }
  const history = designId => {
    const entry = entryFor(designId);
    const h = hostHistory(entry);
    if (h) return h.entries.map((e, i) => ({ label: e.label, at: i, current: i === h.index }));
    return entry?.history?.entries() || [];
  };

  // Learning signals (fire-and-forget; the server learns lessons from them).
  function signal(type, designId, extra = {}) {
    try {
      const entry = designId ? entryFor(designId) : null;
      const scene = entry ? currentScene(entry) : null;
      const ctx = entry ? contextFor(entry) : {};
      const body = { mode: 'creative-signal', signal: { type, designId, runId: entry?.runId || Creative()?.state?.run?.plan?.runId || '', archetype: scene?.archetype || extra.archetype || '', archetypeName: scene?.archetypeName || ctx.archetypeName || '', sport: ctx.sport || '', ...extra } };
      window.ESAuth?.fetchWithAuth?.('/api/es-generate', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })?.catch?.(() => {});
    } catch (error) { /* learning is optional */ }
  }

  async function callServer(body) {
    if (G()?.callApi) return G().callApi('/api/es-generate', body);
    if (!window.ESAuth?.fetchWithAuth) throw new Error('Sign-in is still loading. Try again in a moment.');
    const response = await window.ESAuth.fetchWithAuth('/api/es-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), { reason: data?.reason || '', status: response.status });
    return data;
  }

  // One instruction: local intent first (free), else the server (Haiku, or
  // Sonnet for layout changes). Returns { ok, reply, cost, skipped }.
  async function ask(designId, instruction, { source = 'chat' } = {}) {
    const entry = entryFor(designId);
    const scene = entry ? currentScene(entry) : null;
    if (!scene) return { ok: false, reply: 'This design is not ready yet.' };
    const text = clean(instruction, 300);
    if (!text) return { ok: false, reply: 'Type what to change.' };
    const ctx = contextFor(entry);
    const local = localIntent(text, scene, ctx);
    if (local) {
      const res = applyPatch(scene, local.ops, ctx);
      if (res.ok) {
        await pushScene(entry, res.scene, local.reply, source);
        signal('assistant', designId, { text });
        return { ok: true, reply: local.reply, cost: 0, model: 'rules', skipped: res.skipped };
      }
      if (!res.skipped.length) return { ok: false, reply: 'Nothing changed.' };
      // A local intent that could not apply: let the AI try.
    }
    const turns = entry.chat.slice(-6).map(m => ({ role: m.role, text: clean(m.text, 200) }));
    const data = await callServer({ mode: 'creative-assist', instruction: text, scene, history: turns, runId: entry.runId || '', context: { sport: ctx.sport, photos: ctx.photos.slice(0, 8), logos: ctx.logos.slice(0, 4), facts: ctx.facts.slice(0, 20), critique: critiqueOf(entry) ? { improvements: (critiqueOf(entry).improvements || []).map(i => i.text).slice(0, 4) } : undefined } });
    const cost = Number(data?.costUsd) || 0;
    entry.cost += cost;
    let applied = null;
    if (data?.ops?.length) {
      applied = applyPatch(scene, data.ops, ctx);
      // The server's own result when this page's composer cannot rebuild it.
      if (!applied.ok && data.scene) applied = { ok: true, scene: data.scene, skipped: data.skipped || [] };
    }
    if (applied?.ok) {
      const label = clean(data.reply, 80) || text;
      await pushScene(entry, applied.scene, label, source);
    }
    return { ok: Boolean(applied?.ok), reply: clean(data?.reply, 400) || (applied?.ok ? 'Done.' : 'I could not make that change.'), cost, model: data?.model || '', tier: data?.tier || '', skipped: [...(data?.skipped || []), ...(applied && !applied.ok ? applied.skipped : [])], suggestions: data?.suggestions || [] };
  }

  // The director's "what could be better", one click.
  async function applyImprovement(designId, improvementId) {
    const entry = entryFor(designId);
    const item = improvementOf(entry, improvementId);
    const scene = entry ? currentScene(entry) : null;
    if (!scene || !item) return { ok: false, reply: 'That suggestion is not available.' };
    let result;
    if (item.fix && item.fix.op && item.fix.op !== 'assist') {
      const res = applyPatch(scene, [item.fix], contextFor(entry));
      if (res.ok) {
        const label = `Applied: ${chipLabel(item).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())}`;
        await pushScene(entry, res.scene, label, 'improvement');
        result = { ok: true, reply: `${label}.`, cost: 0 };
      }
    }
    if (!result) {
      try {
        result = await ask(designId, item.fix?.instruction || item.text, { source: 'improvement' });
      } catch (error) {
        result = { ok: false, reply: error.message || 'The assistant is not available right now.' };
      }
    }
    if (result.ok) {
      entry.applied.add(improvementId);
      signal('improvement', designId, { text: item.text });
    }
    entry.ui?.log('assistant', result.reply, result.cost);
    entry.ui?.paint();
    return result;
  }

  function resize(designId, size) {
    const entry = entryFor(designId);
    const host = hostOf(entry);
    if (host?.resize) return host.resize(size);
    const scene = entry ? currentScene(entry) : null;
    if (!scene) return false;
    const res = applyPatch(scene, [{ op: 'size', size }], contextFor(entry));
    if (!res.ok) return false;
    pushScene(entry, res.scene, `Size: ${size}`, 'resize');
    return true;
  }

  function register(designId, opts = {}) {
    const entry = entryFor(designId, opts);
    return Boolean(entry);
  }

  // ── Chat UI (inside the host's slot; ES UI Library classes) ──────────
  const STYLE_ID = 'frameup-assistant-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.fa-chat{display:grid;gap:var(--es-space-4,16px);min-width:0;font-family:var(--es-font-ui,Roboto,sans-serif);color:var(--es-ink)}
.fa-chat__head{display:flex;align-items:center;gap:var(--es-space-2,8px);flex-wrap:wrap}
.fa-chat__title{margin:0;font-size:var(--es-type-card-title-size,16px);font-weight:var(--es-type-card-title-weight,700);line-height:1.3;margin-right:auto}
.fa-chat__log{list-style:none;margin:0;padding:0;display:grid;gap:var(--es-space-2,8px);max-height:320px;overflow:auto;overscroll-behavior:contain}
.fa-chat__log:empty{display:none}
.fa-chat__msg{padding:var(--es-space-2,8px) var(--es-space-3,12px);border-radius:var(--es-radius-control,12px);font-size:var(--es-type-body-size,14px);line-height:1.45;background:var(--es-sunk);overflow-wrap:anywhere}
.fa-chat__msg--user{background:var(--es-brand-soft);color:var(--es-brand-text);justify-self:end;max-width:90%}
.fa-chat__msg--assistant{justify-self:start;max-width:100%}
.fa-chat__msg small{display:block;margin-top:var(--es-space-1,4px);color:var(--es-ink-3);font-size:var(--es-type-helper-size,12px)}
.fa-chat__msg--busy{color:var(--es-ink-3)}
.fa-chat__ideas{display:grid;gap:var(--es-space-2,8px);min-width:0}
.fa-chat__ideas[hidden]{display:none}
.fa-chat__eyebrow{margin:0;color:var(--es-ink-3);font-size:var(--es-type-eyebrow-size,12px);font-weight:var(--es-type-eyebrow-weight,600);letter-spacing:var(--es-type-eyebrow-tracking,.04em);line-height:16px;text-transform:uppercase}
.fa-chat__chips{display:grid;gap:var(--es-space-2,8px);min-width:0}
.fa-chat__chips .es-chip{display:flex;align-items:flex-start;gap:var(--es-space-2,8px);width:100%;max-width:100%;height:auto;min-height:40px;padding:var(--es-space-2,8px) var(--es-space-3,12px);white-space:normal;overflow-wrap:anywhere;text-align:left;line-height:20px;justify-content:flex-start}
.fa-chat__chips .es-chip svg{flex:none;width:16px;height:16px;margin-top:2px;color:var(--es-brand-text,#0A62C7)}
.fa-chat__chips .es-chip span{min-width:0}
.fa-fixed{display:flex;align-items:flex-start;gap:var(--es-space-2,8px);margin:0;color:var(--es-ink-3);font-size:var(--es-type-helper-size,12px);line-height:16px}
.fa-fixed[hidden]{display:none}
.fa-fixed svg{flex:none;width:14px;height:14px;margin-top:1px;color:var(--es-good,#13804B)}
.fa-fixed b{color:var(--es-ink-2,#3f4450);font-weight:600}
html[data-theme="dark"] .fa-fixed b{color:#DCE3EE}
html[data-theme="dark"] .fa-fixed svg{color:#4ADE80}
html[data-theme="dark"] .fa-chat__chips .es-chip svg{color:#7DB8FF}
.fa-chat__form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--es-space-2,8px);align-items:end}
.fa-chat__form textarea{min-height:64px;max-height:160px;padding:var(--es-space-2,8px) var(--es-space-3,12px);resize:vertical;line-height:20px}
.fa-chat__hint{margin:0;color:var(--es-ink-3);font-size:var(--es-type-helper-size,12px);line-height:1.4}
.fa-chat [hidden]{display:none!important}
.fa-chat__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){.fa-chat__form{grid-template-columns:1fr}.fa-chat__form .es-btn{justify-self:end}}
@media (prefers-reduced-motion:reduce){.fa-chat__log{scroll-behavior:auto}}`;
    document.head.append(style);
  }

  // With no ideas from the director: creative asks to start from (never repairs).
  const STARTERS = ['Make the headline punchier', 'Try a darker, moodier look', 'Add the team logo', 'Try another layout', 'More drama'];
  const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>';
  const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function mount(slotEl, opts = {}) {
    if (!slotEl) return null;
    const designId = String(opts.designId || slotEl.dataset.designId || '');
    const entry = entryFor(designId, opts);
    if (!entry) return null;
    injectStyle();
    entry.ui?.destroy?.();
    const uid = `fa-${Math.random().toString(36).slice(2, 8)}`;
    slotEl.innerHTML = `
      <div class="fa-chat" role="region" aria-labelledby="${uid}-title">
        <div class="fa-chat__head">
          <h3 class="fa-chat__title" id="${uid}-title">AI assistant</h3>
          <span class="es-badge" data-fa="cost" title="AI cost of this design's chat" hidden>$0.000</span>
          <button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-fa="undo" aria-keyshortcuts="Control+Z Meta+Z">Undo</button>
          <button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-fa="redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">Redo</button>
        </div>
        <p class="fa-fixed" data-fa="fixed" hidden></p>
        <ol class="fa-chat__log" aria-live="polite" aria-label="Conversation"></ol>
        <div class="fa-chat__ideas" data-fa="ideas" hidden>
          <p class="fa-chat__eyebrow" id="${uid}-ideas">Ideas to try</p>
          <div class="fa-chat__chips" role="group" aria-labelledby="${uid}-ideas"></div>
        </div>
        <form class="fa-chat__form">
          <label class="es-field">
            <span class="fa-chat__sr">Tell the assistant what to change</span>
            <textarea class="es-input" rows="2" maxlength="300" placeholder="Ask for a change, e.g. a darker photo"></textarea>
          </label>
          <button class="es-btn es-btn--sm" type="submit">Send</button>
        </form>
        <p class="fa-chat__hint">Facts and numbers stay from the brief, and every change passes the ES check. Simple asks are free; others use a small AI call (Haiku, or Sonnet for a new layout).</p>
      </div>`;
    const $ = sel => slotEl.querySelector(sel);
    const logEl = $('.fa-chat__log');
    const chips = $('.fa-chat__chips');
    const form = $('.fa-chat__form');
    const input = $('textarea');
    const send = form.querySelector('button[type="submit"]');
    let busy = false;

    const log = (role, text, cost) => {
      entry.chat.push({ role, text, cost: cost || 0 });
      const li = document.createElement('li');
      li.className = `fa-chat__msg fa-chat__msg--${role}`;
      li.textContent = text;
      if (role === 'assistant' && cost != null) {
        const small = document.createElement('small');
        small.textContent = cost ? `AI · ${money(cost)}` : 'Free · no AI call';
        li.append(small);
      }
      logEl.append(li);
      logEl.scrollTop = logEl.scrollHeight;
      return li;
    };
    const paint = () => {
      // Hosted: the focus view's own Undo / Redo (top bar, History) are the
      // controls; the chat does not show a second pair.
      const hosted = Boolean(hostOf(entry));
      $('[data-fa="undo"]').hidden = hosted;
      $('[data-fa="redo"]').hidden = hosted;
      $('[data-fa="undo"]').disabled = !canUndo(entry);
      $('[data-fa="redo"]').disabled = !canRedo(entry);
      $('[data-fa="cost"]').textContent = money(entry.cost);
      $('[data-fa="cost"]').hidden = !(entry.cost > 0);
      const crit = critiqueOf(entry);
      // The fixes the director made before delivery: one quiet line.
      const fixed = fixedLine(crit?.autoFixed || []);
      const fixedEl = $('[data-fa="fixed"]');
      fixedEl.hidden = !fixed;
      fixedEl.innerHTML = fixed ? `${TICK}<span><b>Fixed while designing:</b> ${esc(fixed)}</span>` : '';
      // Creative ideas from the director (full text), else starter asks.
      const items = (crit?.improvements || []).filter(i => !entry.applied.has(i.id) && !isRepair(i));
      const list = items.length ? items.map(i => ({ id: i.id, label: chipLabel(i) })) : STARTERS.filter(s => !/logo/i.test(s) || contextFor(entry).logos.length).slice(0, 3).map(s => ({ text: s, label: s }));
      $('.fa-chat__eyebrow').textContent = items.length ? 'Ideas to try' : 'Try asking';
      $('[data-fa="ideas"]').hidden = !list.length;
      chips.innerHTML = list.map(c => `<button class="es-chip" type="button" ${c.id ? `data-fa-improve="${esc(c.id)}"` : `data-fa-say="${esc(c.text)}"`}>${c.id ? SPARK : ''}<span>${esc(c.label)}</span></button>`).join('');
      send.disabled = busy;
      input.disabled = busy;
    };
    const run = async (task, userText) => {
      if (busy) return;
      busy = true;
      if (userText) log('user', userText);
      const pending = log('assistant', 'Working on it…');
      pending.classList.add('fa-chat__msg--busy');
      paint();
      try {
        const res = await task();
        pending.remove();
        entry.chat.pop();
        const skipped = (res.skipped || []).map(s => s.why).filter(Boolean);
        log('assistant', `${res.reply}${skipped.length ? ` (Skipped: ${skipped.slice(0, 2).join('; ')})` : ''}`, res.cost);
      } catch (error) {
        pending.remove();
        entry.chat.pop();
        log('assistant', error?.reason === 'weekly-limit' || error?.reason === 'team-limit' || error?.reason === 'feature-off' ? error.message : `That did not work: ${error?.message || 'try again in a moment.'}`);
      } finally {
        busy = false;
        paint();
        input.focus({ preventScroll: true });
      }
    };
    const onSubmit = event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      input.value = '';
      run(() => ask(designId, text), text);
    };
    const onClick = event => {
      const btn = event.target.closest('button');
      if (!btn || btn.disabled || !slotEl.contains(btn)) return;
      if (btn.dataset.fa === 'undo') undo(designId);
      else if (btn.dataset.fa === 'redo') redo(designId);
      else if (btn.dataset.faImprove) {
        const item = improvementOf(entry, btn.dataset.faImprove);
        if (!item) return;
        log('user', chipLabel(item));
        busy = true;
        paint();
        applyImprovement(designId, item.id).finally(() => { busy = false; paint(); });
      } else if (btn.dataset.faSay) run(() => ask(designId, btn.dataset.faSay), btn.dataset.faSay);
    };
    const onKey = event => {
      if (event.key === 'Enter' && !event.shiftKey && event.target === input) { event.preventDefault(); form.requestSubmit(); return; }
      if (hostOf(entry)) return; // the host's keyboard shortcuts undo / redo (once)
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z' || event.target === input) return;
      event.preventDefault();
      if (event.shiftKey) redo(designId); else undo(designId);
    };
    const onChanged = event => { if (event.detail?.designId === designId) paint(); };
    form.addEventListener('submit', onSubmit);
    slotEl.addEventListener('click', onClick);
    slotEl.addEventListener('keydown', onKey);
    document.addEventListener('frameup:design-changed', onChanged);
    entry.ui = {
      slot: slotEl,
      paint,
      log,
      destroy() {
        form.removeEventListener('submit', onSubmit);
        slotEl.removeEventListener('click', onClick);
        slotEl.removeEventListener('keydown', onKey);
        document.removeEventListener('frameup:design-changed', onChanged);
        entry.ui = null;
      },
    };
    entry.chat.slice(-12).forEach(m => {
      const li = document.createElement('li');
      li.className = `fa-chat__msg fa-chat__msg--${m.role}`;
      li.textContent = m.text;
      logEl.append(li);
    });
    paint();
    return { designId, ask: text => run(() => ask(designId, text), text), destroy: () => entry.ui?.destroy() };
  }

  // The focus view calls this before it re-mounts the slot for another design.
  function unmount(slotEl) {
    designs.forEach(entry => { if (entry.ui && (!slotEl || entry.ui.slot === slotEl)) entry.ui.destroy(); });
  }

  return Object.freeze({ ...engine, engine, mount, unmount, register, applyImprovement, ask, undo, redo, commit, history, resize, signal, _designs: designs });
}));
