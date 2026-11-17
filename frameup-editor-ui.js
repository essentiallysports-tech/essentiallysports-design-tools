// FrameUp editor UI (Social Media, YouTube, Newsletter).
//
//   1. Layers panel: type icons, a colour chip or photo thumbnail per row,
//      double-click (or F2 / Enter) to rename, eye and lock toggles, click /
//      Shift-click / ⌘-click selection that shows on the canvas (and clicking
//      the canvas selects the row), drag to reorder with a drop line, ⌘[ / ⌘]
//      to move a layer down / up (add Shift for back / front), arrow keys, H
//      to hide, L to lock, filter for long lists, an empty state, a resizable
//      and collapsible column (both remembered in this browser). The YouTube
//      background row expands to show what travels with it.
//   2. One canvas bar for all three workspaces, next to Undo / Redo and the
//      save chip: the template and size (click: change template), Safe zones
//      (YouTube timestamp corner, Instagram profile-grid crop, the ES 50 px
//      margin) and, on YouTube, a small-size preview (search and home sizes).
//   3. Carousel slides: Duplicate, Move left / right and Clear for the
//      current Social Media slide.
//   4. Newsletter: says which asset you are editing, and what Copy image
//      link / Copy HTML give you and where to paste it.
//
// Nothing here draws on the design canvas: overlays are DOM on top of it, so
// exports are unchanged. Layer data stays the same objects the editor saves
// ({ id, label, visible, locked } in state.coverLayers); a renamed layer just
// keeps its new label. The pure helpers are exported for Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document && window.top === window) {
    window.FrameUpEditorUI = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.install(window), { once: true });
    else api.install(window);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // ─── Pure helpers ────────────────────────────────────────────────────────
  const LAYER_TYPES = {
    photo: { type: 'image', kind: 'Image' },
    pills: { type: 'text', kind: 'Text' },
    swipeButton: { type: 'button', kind: 'Button' },
    logo: { type: 'logo', kind: 'Logo' },
  };
  const NAME_MAX = 40;
  const WIDTH_MIN = 200;
  const WIDTH_MAX = 360;
  const WIDTH_DEFAULT = 240;
  const FILTER_FROM = 7; // show the filter box from this many rows

  function layerType(id) {
    return LAYER_TYPES[id] || { type: 'layer', kind: 'Layer' };
  }

  // A typed name: trimmed, single-spaced, at most NAME_MAX characters. Empty
  // means "go back to the default name".
  function normalizeName(input, fallback) {
    const clean = String(input == null ? '' : input).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
    return clean || String(fallback || '');
  }

  // Panel order is top-most first; the data array is bottom-most first.
  function panelOrder(layers) {
    return (Array.isArray(layers) ? layers : []).slice().reverse();
  }

  function ids(layers) {
    return layers.map(layer => layer.id);
  }

  // Rearranges `layers` in place to follow `orderIds` (bottom-most first), so
  // state keeps the same array and layer objects. Unknown ids are ignored and
  // missing ones keep their relative order at the end.
  function applyOrder(layers, orderIds) {
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const next = [];
    orderIds.forEach(id => { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); } });
    layers.forEach(layer => { if (byId.has(layer.id)) next.push(layer); });
    const changed = next.some((layer, index) => layer !== layers[index]);
    if (changed) layers.splice(0, layers.length, ...next);
    return changed;
  }

  // Move the selected layers one step toward the front (delta 1) or back
  // (delta -1). Selected layers move as a block and keep their order; a layer
  // already at the edge stays put. Returns the new order (bottom-most first).
  function moveBy(orderIds, selected, delta) {
    const sel = new Set(selected);
    const order = orderIds.slice();
    if (!sel.size || !delta) return order;
    const step = delta > 0 ? 1 : -1;
    const indexes = order.map((id, index) => (sel.has(id) ? index : -1)).filter(index => index >= 0);
    if (step > 0) indexes.reverse();
    let wall = step > 0 ? order.length : -1;
    indexes.forEach(index => {
      const target = index + step;
      if (target === wall || sel.has(order[target]) && target === wall - step) {
        wall = index;
        return;
      }
      [order[index], order[target]] = [order[target], order[index]];
      wall = target;
    });
    return order;
  }

  // Send the selected layers to the very front or back, keeping their order.
  function moveToEdge(orderIds, selected, edge) {
    const sel = new Set(selected);
    const picked = orderIds.filter(id => sel.has(id));
    const rest = orderIds.filter(id => !sel.has(id));
    return edge === 'front' ? rest.concat(picked) : picked.concat(rest);
  }

  // Drop the dragged layers above or below a target row (placement is in
  // panel terms: 'above' means in front of the target).
  function dropOrder(orderIds, dragged, targetId, placement) {
    const sel = new Set(dragged);
    if (!sel.size || sel.has(targetId)) return orderIds.slice();
    const picked = orderIds.filter(id => sel.has(id));
    const rest = orderIds.filter(id => !sel.has(id));
    const at = rest.indexOf(targetId);
    if (at < 0) return orderIds.slice();
    const insertAt = placement === 'above' ? at + 1 : at;
    return rest.slice(0, insertAt).concat(picked, rest.slice(insertAt));
  }

  // One click on the eye / lock for a selection: if any selected layer is
  // visible (unlocked) they all become hidden (locked); otherwise all are
  // shown (unlocked). Mutates and returns the new value.
  function toggleFlag(layers, selected, flag) {
    const sel = new Set(selected);
    const picked = layers.filter(layer => sel.has(layer.id));
    if (!picked.length) return null;
    if (flag === 'visible') {
      const anyVisible = picked.some(layer => layer.visible !== false);
      picked.forEach(layer => { layer.visible = !anyVisible; });
      return !anyVisible;
    }
    const anyUnlocked = picked.some(layer => layer.locked !== true);
    picked.forEach(layer => { layer.locked = anyUnlocked; });
    return anyUnlocked;
  }

  // Ids (panel order) between the anchor and the target, inclusive.
  function rangeSelect(panelIds, anchorId, targetId) {
    const a = panelIds.indexOf(anchorId);
    const b = panelIds.indexOf(targetId);
    if (a < 0 || b < 0) return b < 0 ? [] : [targetId];
    const [from, to] = a < b ? [a, b] : [b, a];
    return panelIds.slice(from, to + 1);
  }

  // Word-prefix match on the name, the type, and "hidden" / "locked".
  function filterLayers(layers, query, nameOf = layer => layer.label) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return layers.slice();
    return layers.filter(layer => {
      const hay = [nameOf(layer), layerType(layer.id).kind, layer.visible === false ? 'hidden' : 'visible', layer.locked ? 'locked' : '']
        .join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return words.every(word => hay.some(token => token.startsWith(word)));
    });
  }

  function clampWidth(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return WIDTH_DEFAULT;
    return Math.round(Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, n)));
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // The top-most visible layer under a point (boxes: { id, rect } bottom-first).
  function layerAtPoint(layers, boxes, point) {
    const byId = new Map(boxes.map(box => [box.id, box.rect]));
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      if (layer.visible === false) continue;
      const rect = byId.get(layer.id);
      if (rect && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) return layer.id;
    }
    return null;
  }

  // YouTube draws the video length in the bottom-right corner of every
  // thumbnail. Measured on 1280 × 720 thumbnails: about 15% wide and 13% tall
  // with the corner inset, so keep faces and words out of it.
  function youtubeTimestampZone(width, height) {
    const w = Math.round(width * 0.15);
    const h = Math.round(height * 0.13);
    return { x: width - w, y: height - h, w, h };
  }

  // Instagram's profile grid shows portrait posts cropped to 3:4.
  function profileGridCrop(width, height) {
    const cropW = Math.round(height * 0.75);
    if (cropW >= width) return null;
    const side = Math.round((width - cropW) / 2);
    return { left: side, right: side, width: cropW };
  }

  function formatSize(width, height) {
    if (!width || !height) return '';
    return `${width} × ${height}`;
  }

  // What the canvas bar says about the design you're on.
  function describeDesign({ workspace, template, width, height, slide, slides, isHtml }) {
    const size = isHtml ? 'HTML' : formatSize(width, height);
    const parts = [template || ''];
    if (workspace === 'instagram' && slides > 1 && Number.isInteger(slide)) parts.push(`Slide ${slide + 1} of ${slides}`);
    return { label: parts.filter(Boolean).join(' · '), size };
  }

  // Put a reordered subset back into the full order: the subset's slots are
  // refilled in the new order and every other layer keeps its place.
  function mergeOrder(fullIds, subsetIds) {
    const inSubset = new Set(subsetIds);
    const queue = subsetIds.slice();
    return fullIds.map(id => (inSubset.has(id) ? queue.shift() : id));
  }

  // Next empty slide after the current one (wrapping), or -1.
  function nextEmptySlide(filled, current) {
    const total = filled.length;
    for (let step = 1; step < total; step += 1) {
      const index = (current + step) % total;
      if (!filled[index]) return index;
    }
    return -1;
  }

  const pure = {
    LAYER_TYPES, NAME_MAX, WIDTH_MIN, WIDTH_MAX, WIDTH_DEFAULT, FILTER_FROM,
    layerType, normalizeName, panelOrder, ids, applyOrder, moveBy, moveToEdge, dropOrder, toggleFlag,
    rangeSelect, filterLayers, clampWidth, rectsOverlap, layerAtPoint, youtubeTimestampZone, profileGridCrop,
    formatSize, describeDesign, nextEmptySlide, mergeOrder,
  };

  // ─── Browser ─────────────────────────────────────────────────────────────
  function install(win) {
    if (install.done) return;
    install.done = true;
    const doc = win.document;
    // Editor state comes from index.html's FrameUpEditorBridge (let / const
    // bindings); functions are plain globals.
    const g = name => {
      const bridge = win.FrameUpEditorBridge;
      if (bridge && name in bridge) return bridge[name];
      return win[name];
    };
    const call = (name, ...args) => { const fn = g(name); return typeof fn === 'function' ? fn(...args) : undefined; };
    const store = {
      get(key) { try { return win.localStorage.getItem(key); } catch (error) { return null; } },
      set(key, value) { try { win.localStorage.setItem(key, value); } catch (error) { /* storage unavailable */ } },
    };
    const IS_MAC = /Mac|iPhone|iPad/.test(win.navigator.platform || win.navigator.userAgent || '');
    const MOD = IS_MAC ? '⌘' : 'Ctrl';
    const EDITOR_PAGES = new Set(['instagram', 'youtube', 'newsletter']);
    const HTML_ASSETS = new Set(['widgets', 'trivia', 'ticker', 'list', 'list2']);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const isTyping = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const page = () => doc.body?.dataset.currentPage || '';
    const S = () => g('state');
    const ws = () => g('activeWorkspace');

    const ICONS = {
      image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
      text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
      button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="10" x="2" y="7" rx="2"/><path d="m13 10 2 2-2 2"/><path d="m9 10 2 2-2 2"/></svg>',
      logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 7v6c0 4.4 3.4 7.4 8 8 4.6-.6 8-3.6 8-8V7z"/></svg>',
      layer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
      player: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      mist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18"/><path d="M3 17h18"/><path d="M3 21h18" opacity=".5"/></svg>',
      eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>',
      eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/><path d="m2 2 20 20"/></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
      down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
      safe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="10" height="8" x="7" y="8" rx="1"/></svg>',
      small: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
      layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
    };

    // ── Layers panel ──────────────────────────────────────────────────────
    const layersUI = {
      selected: new Set(),
      anchor: null,
      focusId: null,
      renaming: null,
      query: '',
      expanded: new Set(['photo']),
      lastSignature: '',
      dragIds: null,
    };
    const panel = () => doc.getElementById('layers-panel');
    const list = () => doc.getElementById('layers-panel-list');
    const allLayers = () => (call('isCoverLayersPanelActive') ? call('getCoverLayers') || [] : []);
    // YouTube never draws the swipe button, so its row is left out there.
    const layers = () => allLayers().filter(layer => !(ws() === 'youtube' && layer.id === 'swipeButton'));
    const defaultName = id => (g('COVER_LAYER_LABELS') || {})[id] || layerType(id).kind;
    const nameOf = layer => normalizeName(layer.label, defaultName(layer.id));

    function children(layer) {
      if (layer.id !== 'photo') return [];
      const st = S();
      const kids = [{ key: 'mist', label: 'Team colour fade', icon: 'mist' }];
      if (ws() === 'youtube') {
        const variation = g('activeYoutubeVariation');
        if (variation === 'variation-2' || variation === 'variation-3') kids.push({ key: 'foreground-1', label: st?.entityPhotoName ? `Player 1 · ${st.entityPhotoName}` : 'Player 1', icon: 'player', tool: 'foreground-1', empty: !st?.entityPhoto });
        if (variation === 'variation-3') kids.push({ key: 'foreground-2', label: st?.entityPhotoName2 ? `Player 2 · ${st.entityPhotoName2}` : 'Player 2', icon: 'player', tool: 'foreground-2', empty: !st?.entityPhoto2 });
      }
      return kids;
    }

    // A 56 px copy of the photo, made once per image (the photo itself can be
    // a multi-megabyte data URL).
    const thumbs = new WeakMap();
    function photoThumb(img) {
      if (!img || typeof img !== 'object') return '';
      if (thumbs.has(img)) return thumbs.get(img);
      let url = '';
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w && h) {
          const c = doc.createElement('canvas');
          c.width = 56;
          c.height = 56;
          const scale = Math.max(56 / w, 56 / h);
          c.getContext('2d').drawImage(img, (56 - w * scale) / 2, (56 - h * scale) / 2, w * scale, h * scale);
          url = c.toDataURL('image/jpeg', 0.7);
        }
      } catch (error) { url = ''; }
      if (url) thumbs.set(img, url);
      return url;
    }

    function chipFor(layer) {
      const st = S() || {};
      if (layer.id === 'photo') {
        const thumb = photoThumb(st.photo);
        return thumb
          ? `<span class="fu-layer-thumb" style="background-image:url('${thumb}')" aria-hidden="true"></span>`
          : '<span class="fu-layer-thumb is-empty" aria-hidden="true"></span>';
      }
      if (layer.id === 'pills') {
        const palette = st.pillPalette || {};
        const bg = palette.background || palette.bg || palette.pill || '#0A0A0A';
        const fg = palette.foreground || palette.text || '#FFFFFF';
        return `<span class="fu-layer-swatch" style="background:${esc(bg)};color:${esc(fg)}" aria-hidden="true">Aa</span>`;
      }
      return '';
    }

    // The second line of a row: what's in the layer.
    function describeLayer(layer, name) {
      const st = S() || {};
      if (layer.id === 'pills') return String((st.lines || [])[0] || '').trim() || 'Text';
      if (layer.id === 'photo') return st.photoName || 'Photo';
      if (layer.id === 'logo') {
        const brand = doc.querySelector('.brand-logo-option[aria-pressed="true"], .brand-logo-option.is-active, .brand-logo-option.is-selected');
        return brand?.textContent.trim() || 'ES mark';
      }
      const kind = layerType(layer.id).kind;
      return kind === name ? 'On' : kind;
    }

    function rowHtml(layer, depthKids) {
      const type = layerType(layer.id);
      const name = nameOf(layer);
      const hidden = layer.visible === false;
      const locked = layer.locked === true;
      const selected = layersUI.selected.has(layer.id);
      const kids = depthKids || [];
      const open = layersUI.expanded.has(layer.id);
      const st = S() || {};
      const empty = layer.id === 'photo' ? !st.photo : layer.id === 'pills' ? !(st.lines || []).length : layer.id === 'swipeButton' ? (!st.swipeButton || st.swipeButton === 'none') : false;
      const sub = hidden ? 'Hidden' : empty ? (layer.id === 'swipeButton' ? 'Off' : layer.id === 'photo' ? 'No photo yet' : 'Empty') : describeLayer(layer, name);
      const renaming = layersUI.renaming === layer.id;
      return `
        <div class="layers-panel-row fu-layer-row${hidden ? ' is-hidden-layer' : ''}${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}" role="option" aria-selected="${selected}" tabindex="${layersUI.focusId === layer.id ? 0 : -1}" draggable="${renaming ? 'false' : 'true'}" data-layer-id="${esc(layer.id)}" aria-label="${esc(name)}, ${esc(type.kind)} layer${hidden ? ', hidden' : ''}${locked ? ', locked' : ''}">
          ${kids.length ? `<button type="button" class="fu-layer-twisty${open ? ' is-open' : ''}" data-layer-expand tabindex="-1" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(name)}" aria-expanded="${open}">${ICONS.chevron}</button>` : '<span class="fu-layer-twisty-space" aria-hidden="true"></span>'}
          ${chipFor(layer) || `<span class="fu-layer-icon" aria-hidden="true">${ICONS[type.type] || ICONS.layer}</span>`}
          ${renaming
            ? `<input class="fu-layer-name-input" type="text" maxlength="${NAME_MAX}" value="${esc(name)}" aria-label="Layer name" data-layer-rename-input spellcheck="false" autocomplete="off">`
            : `<span class="layers-panel-label fu-layer-name" title="${esc(name)} · double-click to rename">${esc(name)}<small>${esc(sub)}</small></span>`}
          <span class="fu-layer-actions">
          <button type="button" class="layers-panel-toggle fu-layer-toggle" data-layer-lock-toggle data-layer-locked="${locked}" tabindex="-1" title="${locked ? 'Unlock' : 'Lock'} (L)" aria-label="${locked ? 'Unlock' : 'Lock'} ${esc(name)}" aria-pressed="${locked}">${locked ? ICONS.lock : ICONS.unlock}</button>
          <button type="button" class="layers-panel-toggle fu-layer-toggle" data-layer-visibility-toggle tabindex="-1" title="${hidden ? 'Show' : 'Hide'} (H)" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(name)}" aria-pressed="${hidden}">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
          </span>
        </div>
        ${kids.length && open ? kids.map(kid => `
          <div class="fu-layer-child${kid.empty ? ' is-empty' : ''}" data-layer-child="${esc(kid.key)}" data-parent-id="${esc(layer.id)}"${kid.tool ? ` data-image-tool-target="${esc(kid.tool)}"` : ''} role="presentation">
            <span class="fu-layer-icon" aria-hidden="true">${ICONS[kid.icon] || ICONS.layer}</span>
            <span class="fu-layer-name">${esc(kid.label)}${kid.empty ? '<small>No photo yet</small>' : ''}</span>
          </div>`).join('') : ''}`;
    }

    function ensurePanelChrome() {
      const p = panel();
      if (!p || p.dataset.fuEnhanced) return;
      p.dataset.fuEnhanced = '1';
      const head = p.querySelector('.layers-panel-head');
      const title = head?.querySelector('span');
      if (title) { title.classList.add('fu-layers-title'); title.innerHTML = 'Layers <em class="fu-layers-count" data-layers-count></em>'; }
      const tools = doc.createElement('div');
      tools.className = 'fu-layers-tools';
      tools.innerHTML = `
        <label class="fu-layers-filter" data-layers-filter hidden>
          ${ICONS.search}
          <input type="search" placeholder="Filter layers" aria-label="Filter layers" autocomplete="off" spellcheck="false" data-layers-filter-input>
        </label>
        <p class="fu-layers-hint" data-layers-hint>Click to select · Shift or ${MOD} for more · drag or ${MOD}[ ${MOD}] to reorder</p>`;
      head?.insertAdjacentElement('afterend', tools);
      const l = list();
      if (l) {
        l.setAttribute('role', 'listbox');
        l.setAttribute('aria-label', 'Layers, front to back');
        l.setAttribute('aria-multiselectable', 'true');
        const live = doc.createElement('p');
        live.className = 'es-sr-only';
        live.setAttribute('aria-live', 'polite');
        live.dataset.layersLive = '';
        l.insertAdjacentElement('afterend', live);
      }
      const handle = doc.createElement('div');
      handle.className = 'fu-layers-resize';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize layers panel');
      handle.setAttribute('aria-valuemin', String(WIDTH_MIN));
      handle.setAttribute('aria-valuemax', String(WIDTH_MAX));
      handle.tabIndex = 0;
      p.appendChild(handle);
      setupResize(handle);
      const input = tools.querySelector('[data-layers-filter-input]');
      input?.addEventListener('input', () => { layersUI.query = input.value; renderLayers(true); });
      input?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && input.value) { event.stopPropagation(); input.value = ''; layersUI.query = ''; renderLayers(true); }
        if (event.key === 'ArrowDown') { event.preventDefault(); list()?.querySelector('.fu-layer-row')?.focus(); }
      });
    }

    function announce(text) {
      const live = doc.querySelector('[data-layers-live]');
      if (live) live.textContent = text;
    }

    function renderLayers(force) {
      const l = list();
      if (!l) return;
      ensurePanelChrome();
      const all = layers();
      const st = S() || {};
      // Drop selections of layers that are gone (template switch).
      [...layersUI.selected].forEach(id => { if (!all.some(layer => layer.id === id)) layersUI.selected.delete(id); });
      const top = panelOrder(all);
      const shown = filterLayers(top, layersUI.query, nameOf);
      if (!layersUI.focusId || !shown.some(layer => layer.id === layersUI.focusId)) layersUI.focusId = shown[0]?.id || null;
      const sig = JSON.stringify([ws(), g('activeYoutubeVariation'), top.map(layer => [layer.id, layer.label, layer.visible, layer.locked]), [...layersUI.selected], layersUI.focusId, layersUI.renaming, layersUI.query, [...layersUI.expanded], st.photo?.src?.slice(-40), st.entityPhoto ? 1 : 0, st.entityPhoto2 ? 1 : 0, st.entityPhotoName, st.entityPhotoName2, (st.lines || []).length, st.swipeButton, st.pillPalette]);
      if (!force && sig === layersUI.lastSignature) { syncOutlines(); return; }
      if (layersUI.renaming && !force) { syncOutlines(); return; }
      const hadFocus = l.contains(doc.activeElement) && doc.activeElement.classList.contains('fu-layer-row');
      layersUI.lastSignature = sig;
      const filterWrap = doc.querySelector('[data-layers-filter]');
      if (filterWrap) filterWrap.hidden = all.length < FILTER_FROM && !layersUI.query;
      const count = doc.querySelector('[data-layers-count]');
      if (count) count.textContent = all.length ? String(all.length) : '';
      if (!all.length) {
        l.innerHTML = '<div class="fu-layers-empty es-empty" role="presentation"><strong>No layers here</strong><span>This template has a fixed layout. Cover Image and YouTube thumbnails have layers you can hide, lock and reorder.</span></div>';
      } else if (!shown.length) {
        l.innerHTML = `<div class="fu-layers-empty" role="presentation"><strong>No layers match “${esc(layersUI.query)}”</strong><button type="button" class="es-btn es-btn--tertiary es-btn--sm" data-layers-clear-filter>Clear filter</button></div>`;
      } else {
        l.innerHTML = shown.map(layer => rowHtml(layer, children(layer))).join('');
      }
      const input = l.querySelector('[data-layer-rename-input]');
      if (input) { input.focus(); input.select(); }
      else if (hadFocus && layersUI.focusId) l.querySelector(`.fu-layer-row[data-layer-id="${layersUI.focusId}"]`)?.focus();
      syncOutlines();
    }

    function commitOrder(order, message) {
      const all = call('getCoverLayers');
      if (!all) return;
      if (applyOrder(all, mergeOrder(ids(all), order))) {
        call('render');
        renderLayers(true);
        if (message) announce(message);
      }
    }

    function select(id, { additive = false, range = false } = {}) {
      const top = ids(filterLayers(panelOrder(layers()), layersUI.query, nameOf));
      if (range && layersUI.anchor) {
        const span = rangeSelect(top, layersUI.anchor, id);
        if (!additive) layersUI.selected.clear();
        span.forEach(item => layersUI.selected.add(item));
      } else if (additive) {
        if (layersUI.selected.has(id)) layersUI.selected.delete(id); else layersUI.selected.add(id);
        layersUI.anchor = id;
      } else {
        layersUI.selected = new Set([id]);
        layersUI.anchor = id;
      }
      layersUI.focusId = id;
      renderLayers(true);
      activateOnCanvas();
    }

    // The selected background photo also selects the matching image tool, so
    // its crop handles and zoom show on the canvas.
    function activateOnCanvas(tool) {
      const only = layersUI.selected.size === 1 ? [...layersUI.selected][0] : null;
      const target = tool || (only === 'photo' ? 'move' : null);
      if (!target) return;
      const button = doc.querySelector(`[data-image-tool="${target}"]`);
      if (button && button.getAttribute('aria-selected') !== 'true' && button.offsetParent !== null) button.click();
    }

    function selectedIds() {
      return [...layersUI.selected].filter(id => layers().some(layer => layer.id === id));
    }

    function moveSelection(kind) {
      const all = layers();
      const sel = selectedIds();
      if (!all.length || !sel.length) return false;
      const order = ids(all);
      const next = kind === 'front' || kind === 'back' ? moveToEdge(order, sel, kind) : moveBy(order, sel, kind === 'up' ? 1 : -1);
      const names = all.filter(layer => sel.includes(layer.id)).map(nameOf).join(', ');
      commitOrder(next, `${names} moved ${kind === 'up' ? 'forward' : kind === 'down' ? 'backward' : `to the ${kind}`}`);
      return true;
    }

    function toggleSelection(flag, id) {
      const all = call('getCoverLayers');
      if (!all) return;
      const targets = id && !layersUI.selected.has(id) ? [id] : selectedIds();
      if (!targets.length) return;
      const value = toggleFlag(all, targets, flag);
      call('render');
      renderLayers(true);
      announce(`${targets.length > 1 ? `${targets.length} layers` : nameOf(all.find(layer => layer.id === targets[0]))} ${flag === 'visible' ? (value ? 'shown' : 'hidden') : (value ? 'locked' : 'unlocked')}`);
    }

    function startRename(id) {
      layersUI.renaming = id;
      layersUI.focusId = id;
      renderLayers(true);
    }

    function finishRename(save) {
      const id = layersUI.renaming;
      if (!id) return;
      const input = list()?.querySelector('[data-layer-rename-input]');
      const layer = (call('getCoverLayers') || []).find(item => item.id === id);
      layersUI.renaming = null;
      if (save && input && layer) {
        const next = normalizeName(input.value, defaultName(id));
        if (next !== layer.label) {
          layer.label = next;
          call('render');
          announce(`Renamed to ${next}`);
        }
      }
      renderLayers(true);
      list()?.querySelector(`.fu-layer-row[data-layer-id="${id}"]`)?.focus();
    }

    function setupList() {
      const l = list();
      if (!l || l.dataset.fuWired) return;
      l.dataset.fuWired = '1';
      l.addEventListener('click', event => {
        if (event.target.closest('[data-layers-clear-filter]')) {
          layersUI.query = '';
          const input = doc.querySelector('[data-layers-filter-input]');
          if (input) { input.value = ''; input.focus(); }
          renderLayers(true);
          return;
        }
        const child = event.target.closest('[data-layer-child]');
        if (child) {
          select(child.dataset.parentId);
          if (child.dataset.imageToolTarget) activateOnCanvas(child.dataset.imageToolTarget);
          return;
        }
        const row = event.target.closest('.fu-layer-row');
        if (!row || event.target.closest('[data-layer-rename-input]')) return;
        const id = row.dataset.layerId;
        if (event.target.closest('[data-layer-expand]')) {
          if (layersUI.expanded.has(id)) layersUI.expanded.delete(id); else layersUI.expanded.add(id);
          renderLayers(true);
          return;
        }
        if (event.target.closest('[data-layer-visibility-toggle]')) { toggleSelection('visible', id); return; }
        if (event.target.closest('[data-layer-lock-toggle]')) { toggleSelection('locked', id); return; }
        select(id, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
      });
      l.addEventListener('dblclick', event => {
        const row = event.target.closest('.fu-layer-row');
        if (!row || event.target.closest('button, input')) return;
        startRename(row.dataset.layerId);
      });
      l.addEventListener('focusout', event => {
        if (event.target.matches('[data-layer-rename-input]') && layersUI.renaming) finishRename(true);
      });
      l.addEventListener('keydown', event => {
        if (event.target.matches('[data-layer-rename-input]')) {
          if (event.key === 'Enter') { event.preventDefault(); finishRename(true); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishRename(false); }
          return;
        }
        const row = event.target.closest('.fu-layer-row');
        if (!row) return;
        const id = row.dataset.layerId;
        const rows = [...l.querySelectorAll('.fu-layer-row')];
        const index = rows.indexOf(row);
        const mod = event.metaKey || event.ctrlKey;
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !mod) {
          event.preventDefault();
          const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (!next) return;
          if (event.altKey) { layersUI.selected = new Set([id]); moveSelection(event.key === 'ArrowUp' ? 'up' : 'down'); return; }
          layersUI.focusId = next.dataset.layerId;
          if (event.shiftKey) select(next.dataset.layerId, { range: true });
          else select(next.dataset.layerId);
          return;
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const next = event.key === 'Home' ? rows[0] : rows[rows.length - 1];
          if (next) select(next.dataset.layerId);
          return;
        }
        if (event.key === ' ' || (event.key === 'Enter' && !layersUI.selected.has(id))) {
          event.preventDefault();
          select(id, { additive: mod || event.key === ' ' && layersUI.selected.size > 0 && event.shiftKey });
          return;
        }
        if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startRename(id); return; }
        if (!mod && !event.altKey && (event.key === 'h' || event.key === 'H')) { event.preventDefault(); toggleSelection('visible', id); return; }
        if (!mod && !event.altKey && (event.key === 'l' || event.key === 'L')) { event.preventDefault(); toggleSelection('locked', id); return; }
        if (event.key === 'Escape' && layersUI.selected.size) { event.preventDefault(); event.stopPropagation(); layersUI.selected.clear(); renderLayers(true); }
        if (mod && event.key === 'a') { event.preventDefault(); layers().forEach(layer => layersUI.selected.add(layer.id)); renderLayers(true); }
      });
      l.addEventListener('focusin', event => {
        const row = event.target.closest?.('.fu-layer-row');
        if (row) layersUI.focusId = row.dataset.layerId;
      });

      // Drag to reorder, with a line where the layer will land.
      let dropTarget = null;
      const clearDrop = () => {
        l.querySelectorAll('.is-drop-above, .is-drop-below, .is-drop-target').forEach(el => el.classList.remove('is-drop-above', 'is-drop-below', 'is-drop-target'));
        dropTarget = null;
      };
      l.addEventListener('dragstart', event => {
        const row = event.target.closest('.fu-layer-row');
        if (!row) return;
        const id = row.dataset.layerId;
        layersUI.dragIds = layersUI.selected.has(id) ? selectedIds() : [id];
        if (!layersUI.selected.has(id)) { layersUI.selected = new Set([id]); layersUI.anchor = id; }
        l.querySelectorAll('.fu-layer-row').forEach(el => el.classList.toggle('is-dragging', layersUI.dragIds.includes(el.dataset.layerId)));
        l.classList.add('is-dragging-list');
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain', layersUI.dragIds.join(',')); } catch (error) { /* some browsers refuse */ }
      });
      l.addEventListener('dragover', event => {
        if (!layersUI.dragIds) return;
        const row = event.target.closest('.fu-layer-row');
        if (!row) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const placement = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
        if (dropTarget && dropTarget.row === row && dropTarget.placement === placement) return;
        clearDrop();
        if (layersUI.dragIds.includes(row.dataset.layerId)) return;
        row.classList.add(placement === 'above' ? 'is-drop-above' : 'is-drop-below');
        dropTarget = { row, placement };
      });
      l.addEventListener('dragleave', event => {
        if (!l.contains(event.relatedTarget)) clearDrop();
      });
      l.addEventListener('drop', event => {
        if (!layersUI.dragIds) return;
        event.preventDefault();
        const target = dropTarget;
        const dragged = layersUI.dragIds;
        clearDrop();
        if (!target) return;
        const next = dropOrder(ids(layers()), dragged, target.row.dataset.layerId, target.placement);
        commitOrder(next, 'Layer moved');
      });
      l.addEventListener('dragend', () => {
        clearDrop();
        layersUI.dragIds = null;
        l.classList.remove('is-dragging-list');
        l.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
      });
    }

    // Resize: drag the panel's right edge or use ←/→ on the handle.
    function applyWidth(px, remember) {
      const width = clampWidth(px);
      const app = doc.querySelector('.app[data-workspace]');
      app?.style.setProperty('--fu-layers-w', `${width}px`);
      doc.documentElement.style.setProperty('--fu-layers-w', `${width}px`);
      const handle = doc.querySelector('.fu-layers-resize');
      handle?.setAttribute('aria-valuenow', String(width));
      if (remember) store.set('frameup.layers.width', String(width));
      win.dispatchEvent(new Event('resize'));
    }
    function setupResize(handle) {
      applyWidth(store.get('frameup.layers.width') || WIDTH_DEFAULT, false);
      let startX = 0;
      let startW = 0;
      const move = event => applyWidth(startW + event.clientX - startX, false);
      const up = event => {
        handle.releasePointerCapture?.(event.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        doc.documentElement.classList.remove('fu-is-resizing-layers');
        applyWidth(panel()?.getBoundingClientRect().width || WIDTH_DEFAULT, true);
      };
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        startX = event.clientX;
        startW = panel()?.getBoundingClientRect().width || WIDTH_DEFAULT;
        handle.setPointerCapture?.(event.pointerId);
        doc.documentElement.classList.add('fu-is-resizing-layers');
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
      handle.addEventListener('dblclick', () => applyWidth(WIDTH_DEFAULT, true));
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const now = panel()?.getBoundingClientRect().width || WIDTH_DEFAULT;
        applyWidth(now + (event.key === 'ArrowRight' ? 16 : -16), true);
      });
    }

    // ── Selection on the canvas (DOM outlines over the preview) ───────────
    function layerRect(id) {
      const st = S();
      const workspace = call('getWorkspace');
      if (!st || !workspace) return null;
      const W = workspace.width;
      const H = workspace.height;
      if (id === 'photo') return { x: 0, y: 0, w: W, h: H };
      if (id === 'pills') return st.lastTextBounds && (st.lines || []).length ? { ...st.lastTextBounds } : null;
      if (id === 'logo') {
        const lw = g('LOGO_FINAL_W') || 122;
        const lh = g('LOGO_FINAL_H') || 104;
        const m = g('LOGO_SAFE_MARGIN') || 50;
        const swipe = ws() === 'instagram' && st.swipeButton && st.swipeButton !== 'none';
        return { x: swipe ? m : W - lw - m, y: m, w: lw, h: lh };
      }
      if (id === 'swipeButton') {
        if (ws() !== 'instagram' || !st.swipeButton || st.swipeButton === 'none') return null;
        const bw = g('SWIPE_BUTTON_W') || 200;
        const bh = g('SWIPE_BUTTON_H') || 56;
        const m = g('SWIPE_BUTTON_SAFE_MARGIN') || 50;
        return { x: W - bw - m, y: H - bh - m, w: bw, h: bh };
      }
      return null;
    }

    function overlayHost() {
      const wrap = doc.querySelector('.canvas-wrap');
      if (!wrap) return null;
      let host = wrap.querySelector('.fu-canvas-overlays');
      if (!host) {
        host = doc.createElement('div');
        host.className = 'fu-canvas-overlays';
        host.setAttribute('aria-hidden', 'true');
        wrap.appendChild(host);
      }
      const canvas = doc.getElementById('preview');
      if (canvas) {
        host.style.left = `${canvas.offsetLeft}px`;
        host.style.top = `${canvas.offsetTop}px`;
        host.style.width = `${canvas.clientWidth}px`;
        host.style.height = `${canvas.clientHeight}px`;
      }
      return host;
    }

    function pct(rect, W, H) {
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const r = Math.min(W, rect.x + rect.w);
      const b = Math.min(H, rect.y + rect.h);
      return `left:${(x / W) * 100}%;top:${(y / H) * 100}%;width:${(Math.max(0, r - x) / W) * 100}%;height:${(Math.max(0, b - y) / H) * 100}%`;
    }

    function syncOutlines() {
      const host = overlayHost();
      if (!host) return;
      const workspace = call('getWorkspace');
      const active = !!call('isCoverLayersPanelActive');
      const wrap = host.parentElement;
      const editingImage = wrap?.classList.contains('is-image-editing');
      const outlines = !active || !workspace ? [] : selectedIds().map(id => {
        if (id === 'photo' && editingImage) return '';
        const rect = layerRect(id);
        if (!rect) return '';
        const layer = layers().find(item => item.id === id);
        return `<div class="fu-layer-outline${layer?.visible === false ? ' is-hidden-layer' : ''}${id === 'photo' ? ' is-full' : ''}" style="${pct(rect, workspace.width, workspace.height)}"><span>${esc(layer ? nameOf(layer) : id)}</span></div>`;
      }).join('');
      let box = host.querySelector('.fu-outlines');
      if (!box) { box = doc.createElement('div'); box.className = 'fu-outlines'; host.appendChild(box); }
      if (box.innerHTML !== outlines) box.innerHTML = outlines;
      syncSafeZones(host, workspace);
    }

    function setupCanvasSelection() {
      const canvas = doc.getElementById('preview');
      if (!canvas || canvas.dataset.fuLayerSelect) return;
      canvas.dataset.fuLayerSelect = '1';
      canvas.addEventListener('pointerdown', event => {
        if (!call('isCoverLayersPanelActive')) return;
        const workspace = call('getWorkspace');
        if (!workspace) return;
        const rect = canvas.getBoundingClientRect();
        const point = { x: ((event.clientX - rect.left) / rect.width) * workspace.width, y: ((event.clientY - rect.top) / rect.height) * workspace.height };
        const all = layers();
        const boxes = all.map(layer => ({ id: layer.id, rect: layerRect(layer.id) })).filter(box => box.rect);
        let id = null;
        if (call('pointInTextHitArea', point) && all.some(layer => layer.id === 'pills' && layer.visible !== false)) id = 'pills';
        if (!id) id = layerAtPoint(all, boxes, point);
        if (!id) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey) layersUI.selected.add(id);
        else layersUI.selected = new Set([id]);
        layersUI.anchor = id;
        layersUI.focusId = id;
        renderLayers(true);
      }, true);
    }

    // Document shortcuts: ⌘[ / ⌘] (Shift: back / front), Esc clears.
    function setupShortcuts() {
      doc.addEventListener('keydown', event => {
        if (!EDITOR_PAGES.has(page()) || !call('isCoverLayersPanelActive')) return;
        if (isTyping(event.target) || doc.querySelector('dialog[open]')) return;
        const mod = event.metaKey || event.ctrlKey;
        if (!mod || event.altKey) return;
        const code = event.code;
        if (code !== 'BracketLeft' && code !== 'BracketRight') return;
        if (!selectedIds().length) {
          showToast('Select a layer first (Layers panel or click the canvas)');
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (code === 'BracketRight') moveSelection(event.shiftKey ? 'front' : 'up');
        else moveSelection(event.shiftKey ? 'back' : 'down');
      });
    }

    // Shift + 1: fit the canvas (the zoom's 100% is "fit the stage").
    function setupFit() {
      doc.querySelectorAll('.studio-zoom-value').forEach(button => {
        button.title = 'Fit to screen (Shift+1)';
      });
      doc.addEventListener('keydown', event => {
        if (!EDITOR_PAGES.has(page()) || isTyping(event.target) || doc.querySelector('dialog[open]')) return;
        if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.code === 'Digit1') {
          const reset = doc.querySelector('[data-studio-zoom="reset"]');
          if (!reset) return;
          event.preventDefault();
          reset.click();
        }
      });
    }

    function showToast(message, tone) {
      call('showToast', message, tone);
    }

    // ── Canvas bar: template and size, safe zones, small preview ──────────
    const bar = { el: null, safe: store.get('frameup.editor.safeZones') === '1', preview: false, previewTimer: 0 };

    function templateLabel() {
      const w = ws();
      const st = S() || {};
      if (w === 'instagram') {
        const types = g('INSTAGRAM_POST_TYPES') || {};
        return types[st.postType || 'cover']?.label || 'Cover Image';
      }
      if (w === 'youtube') {
        if (st.youtubeQuote) return 'Quote Thumbnail';
        const option = doc.querySelector(`#youtube-variation-select option[value="${g('activeYoutubeVariation')}"]`);
        return option ? `Thumbnail · ${option.textContent.trim()}` : 'Thumbnail';
      }
      if (w === 'newsletter') {
        const select = doc.getElementById('newsletter-asset-select');
        const option = select?.selectedOptions?.[0];
        return option ? option.textContent.trim() : 'Feature Image';
      }
      return '';
    }

    function isHtmlAsset() {
      return ws() === 'newsletter' && HTML_ASSETS.has(g('activeNewsletterAsset'));
    }

    function ensureBar() {
      // app-shell.js moves Undo / Redo into the floating .es-topbar.
      const group = doc.querySelector('.es-topbar .studio-history-group');
      if (!group) return null;
      if (bar.el) {
        if (bar.el.previousElementSibling !== group) group.insertAdjacentElement('afterend', bar.el);
        return bar.el;
      }
      const el = doc.createElement('div');
      el.className = 'fu-canvas-bar';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', 'Design format and view');
      el.innerHTML = `
        <button type="button" class="fu-format-chip" data-fu-format title="Change template (T)">
          <span class="fu-format-chip__label" data-fu-format-label></span>
          <span class="fu-format-chip__size" data-fu-format-size></span>
          ${ICONS.down}
        </button>
        <button type="button" class="fu-view-btn" data-fu-safe aria-pressed="false" title="Safe zones">${ICONS.safe}<span>Safe zones</span><i class="fu-view-btn__warn" data-fu-safe-warn hidden></i></button>
        <button type="button" class="fu-view-btn" data-fu-small aria-pressed="false" aria-expanded="false" aria-controls="fu-small-preview" title="See it at YouTube's sizes" hidden>${ICONS.small}<span>Small size</span></button>`;
      group.insertAdjacentElement('afterend', el);
      el.querySelector('[data-fu-format]').addEventListener('click', openTemplatePicker);
      el.querySelector('[data-fu-safe]').addEventListener('click', () => {
        bar.safe = !bar.safe;
        store.set('frameup.editor.safeZones', bar.safe ? '1' : '0');
        syncBar();
        syncOutlines();
      });
      el.querySelector('[data-fu-small]').addEventListener('click', () => toggleSmallPreview());
      bar.el = el;
      return el;
    }

    function openTemplatePicker() {
      const w = ws();
      if (w === 'youtube') {
        call('ESOpenStudioSection');
        const chip = doc.querySelector('#youtube-variation-card .select-chip[aria-pressed="true"], #youtube-variation-card .select-chip.is-selected, #youtube-variation-card .select-chip');
        chip?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        chip?.focus();
        return;
      }
      const id = w === 'newsletter' ? 'newsletter-asset-select' : 'instagram-post-type-select';
      if (win.FrameUpTemplates?.open) win.FrameUpTemplates.open(id);
      else doc.querySelector(`#${id}`)?.closest('.card')?.querySelector('.select-dropdown-trigger')?.click();
    }

    function textUnderTimestamp() {
      if (ws() !== 'youtube') return false;
      const st = S();
      const workspace = call('getWorkspace');
      if (!st || !workspace || !(st.lines || []).length) return false;
      const zone = youtubeTimestampZone(workspace.width, workspace.height);
      const rects = Array.isArray(st.textHitRects) && st.textHitRects.length ? st.textHitRects : (st.lastTextBounds ? [st.lastTextBounds] : []);
      return rects.some(rect => rectsOverlap(rect, zone));
    }

    function syncBar() {
      const el = ensureBar();
      const w = ws();
      const onEditor = EDITOR_PAGES.has(page()) && EDITOR_PAGES.has(w);
      if (el) el.hidden = !onEditor;
      if (!onEditor) { if (bar.preview) toggleSmallPreview(false); return; }
      const workspace = call('getWorkspace') || {};
      const html = isHtmlAsset();
      const info = describeDesign({ workspace: w, template: templateLabel(), width: workspace.width, height: workspace.height, isHtml: html });
      // Phones have no floating bar; their header and the copy hint still update.
      if (!el) { syncMobileMeta(info); syncNewsletterHints(); return; }
      el.querySelector('[data-fu-format-label]').textContent = info.label;
      el.querySelector('[data-fu-format-size]').textContent = info.size;
      const chip = el.querySelector('[data-fu-format]');
      chip.title = `${info.label} · ${info.size}. Change template (T)`;
      chip.setAttribute('aria-label', `${info.label}, ${info.size}. Change template`);
      const safeBtn = el.querySelector('[data-fu-safe]');
      const safeAvailable = !html && (w === 'youtube' || w === 'instagram');
      safeBtn.hidden = !safeAvailable;
      safeBtn.setAttribute('aria-pressed', String(bar.safe && safeAvailable));
      const warn = safeAvailable && textUnderTimestamp();
      safeBtn.classList.toggle('has-warning', warn);
      safeBtn.querySelector('[data-fu-safe-warn]').hidden = !warn;
      safeBtn.title = warn ? 'Your headline runs under the YouTube timestamp. Show safe zones' : (w === 'youtube' ? 'Safe zones: the timestamp corner and the ES margin' : 'Safe zones: the profile-grid crop and the ES margin');
      const smallBtn = el.querySelector('[data-fu-small]');
      smallBtn.hidden = w !== 'youtube';
      if (w !== 'youtube' && bar.preview) toggleSmallPreview(false);
      // Short of room: drop the button words first, then the size, so the
      // template name stays readable.
      chip.classList.remove('is-compact');
      el.classList.remove('is-tight');
      const labelNode = chip.querySelector('[data-fu-format-label]');
      const truncated = () => labelNode.scrollWidth > labelNode.clientWidth + 1;
      if (truncated()) el.classList.add('is-tight');
      if (truncated()) chip.classList.add('is-compact');
      syncMobileMeta(info);
      syncNewsletterHints();
    }

    function syncSafeZones(host, workspace) {
      let box = host.querySelector('.fu-safe-zones');
      const w = ws();
      const show = bar.safe && workspace && !isHtmlAsset() && (w === 'youtube' || w === 'instagram');
      if (!show) { box?.remove(); return; }
      if (!box) { box = doc.createElement('div'); box.className = 'fu-safe-zones'; host.appendChild(box); }
      const W = workspace.width;
      const H = workspace.height;
      const m = g('LOGO_SAFE_MARGIN') || 50;
      let html = `<div class="fu-safe-margin" style="${pct({ x: m, y: m, w: W - m * 2, h: H - m * 2 }, W, H)}"></div>`;
      if (w === 'youtube') {
        const zone = youtubeTimestampZone(W, H);
        html += `<div class="fu-safe-block${textUnderTimestamp() ? ' is-hit' : ''}" style="${pct(zone, W, H)}"><span>12:34</span></div>`;
        html += '<p class="fu-safe-legend">Timestamp corner · ES margin</p>';
      } else {
        const crop = profileGridCrop(W, H);
        if (crop) {
          html += `<div class="fu-safe-shade" style="${pct({ x: 0, y: 0, w: crop.left, h: H }, W, H)}"></div>`;
          html += `<div class="fu-safe-shade" style="${pct({ x: W - crop.right, y: 0, w: crop.right, h: H }, W, H)}"></div>`;
        }
        html += `<p class="fu-safe-legend">${crop ? 'Shaded: cut from the profile grid · ' : ''}ES margin</p>`;
      }
      if (box.innerHTML !== html) box.innerHTML = html;
    }

    function toggleSmallPreview(force) {
      const next = typeof force === 'boolean' ? force : !bar.preview;
      bar.preview = next;
      const btn = bar.el?.querySelector('[data-fu-small]');
      btn?.setAttribute('aria-pressed', String(next));
      btn?.setAttribute('aria-expanded', String(next));
      let pop = doc.getElementById('fu-small-preview');
      if (!next) {
        pop?.remove();
        clearInterval(bar.previewTimer);
        return;
      }
      if (!pop) {
        pop = doc.createElement('section');
        pop.id = 'fu-small-preview';
        pop.className = 'fu-small-preview';
        pop.setAttribute('aria-label', 'Thumbnail at YouTube sizes');
        pop.innerHTML = `
          <header><strong>How it looks on YouTube</strong><button type="button" class="fu-small-preview__close" aria-label="Close small-size preview">×</button></header>
          <figure><canvas width="246" height="138" data-size="home"></canvas><figcaption>Search results · 246 px wide</figcaption></figure>
          <figure><canvas width="168" height="94" data-size="search"></canvas><figcaption>Up next sidebar · 168 px wide</figcaption></figure>
          <p>Can you read it at the smallest size? If not, use fewer, bigger words.</p>`;
        doc.querySelector('.canvas-stage')?.appendChild(pop);
        pop.querySelector('.fu-small-preview__close').addEventListener('click', () => { toggleSmallPreview(false); btn?.focus(); });
      }
      const draw = () => {
        const src = doc.getElementById('preview');
        if (!src || !src.width) return;
        const dpr = Math.min(2, win.devicePixelRatio || 1);
        pop.querySelectorAll('canvas').forEach(canvas => {
          const cssW = canvas.dataset.size === 'home' ? 246 : 168;
          const cssH = canvas.dataset.size === 'home' ? 138 : 94;
          if (canvas.width !== Math.round(cssW * dpr)) { canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); }
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
          // YouTube's timestamp badge, for scale.
          const bw = Math.round(canvas.width * 0.12);
          const bh = Math.round(canvas.height * 0.11);
          ctx.fillStyle = 'rgba(0,0,0,.8)';
          ctx.fillRect(canvas.width - bw - 4, canvas.height - bh - 4, bw, bh);
          ctx.fillStyle = '#fff';
          ctx.font = `500 ${Math.max(7, Math.round(bh * 0.7))}px Roboto, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('12:34', canvas.width - bw / 2 - 4, canvas.height - bh / 2 - 4);
        });
      };
      draw();
      clearInterval(bar.previewTimer);
      bar.previewTimer = setInterval(() => { if (doc.visibilityState === 'visible') draw(); }, 700);
    }

    // Phones: say what you're editing in the header; Export says Copy HTML
    // when that's what it does.
    function syncMobileMeta(info) {
      const kicker = doc.querySelector('[data-mobile-editor-kicker]');
      if (kicker) kicker.textContent = info.label ? `${info.label}${info.size ? ` · ${info.size}` : ''}` : 'FrameUp';
      const exportBtn = doc.querySelector('[data-mobile-editor-export]');
      if (exportBtn) exportBtn.textContent = isHtmlAsset() ? 'Copy HTML' : 'Export';
    }

    // Newsletter: what the copy buttons give you.
    function syncNewsletterHints() {
      const right = doc.querySelector('.studio-topbar-right');
      if (!right) return;
      let hint = doc.querySelector('[data-fu-copy-hint]');
      if (!hint) {
        hint = doc.createElement('p');
        hint.className = 'fu-copy-hint';
        hint.dataset.fuCopyHint = '';
        hint.id = 'fu-copy-hint';
        right.insertAdjacentElement('afterend', hint);
      }
      const nl = ws() === 'newsletter' && page() === 'newsletter';
      hint.hidden = !nl;
      const link = doc.getElementById('studio-link-btn');
      const linkLabel = link?.querySelector('[data-link-label]');
      if (!nl) {
        if (linkLabel && linkLabel.dataset.fuRenamed) { linkLabel.textContent = 'Copy link'; delete linkLabel.dataset.fuRenamed; }
        return;
      }
      if (isHtmlAsset()) {
        hint.innerHTML = '<strong>Copy HTML</strong> copies this widget’s code. Paste it into an HTML block in the newsletter.';
      } else {
        hint.innerHTML = '<strong>Copy image link</strong> uploads this image and copies its URL for the newsletter’s image block. <strong>Export</strong> downloads the file.';
        if (linkLabel && linkLabel.textContent.trim() === 'Copy link') { linkLabel.textContent = 'Copy image link'; linkLabel.dataset.fuRenamed = '1'; }
      }
      doc.getElementById('widget-copy-btn')?.setAttribute('aria-describedby', 'fu-copy-hint');
      link?.setAttribute('aria-describedby', 'fu-copy-hint');
    }

    // Newsletter widget inputs that only had a placeholder get a real label.
    function labelWidgetInputs() {
      doc.querySelectorAll('.widget-text-input:not([aria-label]):not([id])').forEach(input => {
        const group = input.closest('.widget-field-group');
        const title = group?.querySelector('.widget-field-label')?.textContent.trim() || 'Field';
        const isLink = /https?:|essentiallysports\.com/.test(input.placeholder || '') || /link|url/i.test(input.dataset.list2Field || input.dataset.listField || '');
        input.setAttribute('aria-label', `${title} ${isLink ? 'link' : 'headline'}`);
      });
    }

    // ── Carousel slides: duplicate, move, clear ───────────────────────────
    function ensureSlideMenu() {
      const switcher = doc.querySelector('.carousel-slide-switcher');
      if (!switcher || switcher.parentElement.querySelector('.fu-slide-menu')) return;
      const wrap = doc.createElement('div');
      wrap.className = 'fu-slide-menu';
      wrap.innerHTML = `
        <button type="button" class="carousel-slide-button fu-slide-menu__btn" aria-haspopup="menu" aria-expanded="false" aria-label="Slide actions" title="Slide actions">${ICONS.more}</button>
        <div class="fu-slide-menu__list" role="menu" hidden>
          <button type="button" role="menuitem" data-slide-action="duplicate">Duplicate to next empty slide</button>
          <button type="button" role="menuitem" data-slide-action="left">Move slide left</button>
          <button type="button" role="menuitem" data-slide-action="right">Move slide right</button>
          <button type="button" role="menuitem" data-slide-action="clear" class="is-danger">Clear this slide</button>
        </div>`;
      switcher.insertAdjacentElement('afterend', wrap);
      const btn = wrap.querySelector('.fu-slide-menu__btn');
      const menu = wrap.querySelector('[role="menu"]');
      const items = () => [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const close = focusBtn => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); };
      const open = () => {
        const index = g('activeInstagramSlide') || 0;
        const total = (g('instagramSlideStates') || []).length;
        const filled = (g('instagramSlideStates') || []).map(slide => !!call('slideHasContent', slide));
        menu.querySelector('[data-slide-action="left"]').disabled = index <= 0;
        menu.querySelector('[data-slide-action="right"]').disabled = index >= total - 1;
        const next = nextEmptySlide(filled, index);
        const dup = menu.querySelector('[data-slide-action="duplicate"]');
        dup.disabled = next < 0 || !filled[index];
        dup.textContent = next < 0 ? 'Duplicate (no empty slide left)' : `Duplicate to slide ${next + 1}`;
        menu.querySelector('[data-slide-action="clear"]').disabled = !filled[index];
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        items()[0]?.focus();
      };
      btn.addEventListener('click', () => (menu.hidden ? open() : close(false)));
      menu.addEventListener('keydown', event => {
        const list = items();
        const at = list.indexOf(doc.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === 'ArrowDown') { event.preventDefault(); list[(at + 1) % list.length]?.focus(); }
        if (event.key === 'ArrowUp') { event.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
        if (event.key === 'Tab') close(false);
      });
      doc.addEventListener('pointerdown', event => { if (!wrap.contains(event.target)) close(false); });
      menu.addEventListener('click', event => {
        const action = event.target.closest('[data-slide-action]')?.dataset.slideAction;
        if (!action) return;
        close(true);
        if (action === 'duplicate') {
          const to = call('duplicateInstagramSlide');
          if (Number.isInteger(to) && to >= 0) showToast(`Duplicated to slide ${to + 1}`, 'success');
        } else if (action === 'left' || action === 'right') {
          const to = call('moveInstagramSlide', action === 'left' ? -1 : 1);
          if (Number.isInteger(to)) showToast(`Moved to slide ${to + 1}`);
        } else if (action === 'clear') {
          if (call('clearInstagramSlide')) showToast(`Slide cleared. Undo with ${MOD}+Z`);
        }
        syncBar();
      });
    }

    // ── Mobile: a Layers list in the More sheet ───────────────────────────
    function syncMobileLayers() {
      const more = doc.querySelector('[data-mobile-editor-more-actions]');
      if (!more) return;
      let box = more.querySelector('.fu-mobile-layers');
      const active = !!call('isCoverLayersPanelActive');
      if (!active) { box?.remove(); return; }
      if (!box) {
        box = doc.createElement('section');
        box.className = 'fu-mobile-layers';
        box.setAttribute('aria-label', 'Layers');
        more.prepend(box);
        box.addEventListener('click', event => {
          const row = event.target.closest('[data-m-layer]');
          if (!row) return;
          const id = row.dataset.mLayer;
          if (event.target.closest('[data-m-vis]')) toggleSelection('visible', id);
          else if (event.target.closest('[data-m-lock]')) toggleSelection('locked', id);
          else if (event.target.closest('[data-m-up]')) { layersUI.selected = new Set([id]); moveSelection('up'); }
          else if (event.target.closest('[data-m-down]')) { layersUI.selected = new Set([id]); moveSelection('down'); }
          syncMobileLayers();
        });
      }
      const top = panelOrder(layers());
      const html = `<h3>${ICONS.layers}Layers <small>front to back</small></h3>${top.map((layer, index) => {
        const name = nameOf(layer);
        const hidden = layer.visible === false;
        const locked = layer.locked === true;
        return `<div class="fu-mobile-layer${hidden ? ' is-hidden-layer' : ''}" data-m-layer="${esc(layer.id)}">
          <span class="fu-layer-icon" aria-hidden="true">${ICONS[layerType(layer.id).type] || ICONS.layer}</span>
          <span class="fu-layer-name">${esc(name)}</span>
          <button type="button" data-m-up aria-label="Move ${esc(name)} forward"${index === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" data-m-down aria-label="Move ${esc(name)} backward"${index === top.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" data-m-lock aria-pressed="${locked}" aria-label="${locked ? 'Unlock' : 'Lock'} ${esc(name)}">${locked ? ICONS.lock : ICONS.unlock}</button>
          <button type="button" data-m-vis aria-pressed="${hidden}" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(name)}">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
        </div>`;
      }).join('')}`;
      if (box.innerHTML !== html) box.innerHTML = html;
    }

    // Keep the floating canvas bar between the left columns and the inspector.
    function syncBarBounds() {
      const inspector = doc.querySelector('.app[data-workspace] > .panel');
      const right = inspector ? Math.max(0, win.innerWidth - inspector.getBoundingClientRect().left) : 0;
      doc.documentElement.style.setProperty('--fu-inspector-w', `${Math.round(right)}px`);
    }

    // Collapsed or open is remembered per workspace.
    let collapseFor = '';
    function syncCollapse() {
      const w = ws();
      if (!call('isCoverLayersPanelActive') || w === collapseFor) return;
      collapseFor = w;
      const stored = store.get(`frameup.layers.collapsed.${w}`);
      const legacy = w === 'instagram' ? store.get('frameup.layers.collapsed') : null;
      const value = stored ?? legacy;
      // Defaults: a rail below 1280 px everywhere (the canvas would be squeezed
      // to a sliver at 1024), and on YouTube below 1440 px.
      const collapsed = value != null ? value === '1' : (win.innerWidth < 1280 || (w === 'youtube' && win.innerWidth < 1440));
      const app = doc.querySelector('.app[data-workspace]');
      if (app && app.classList.contains('layers-collapsed') !== collapsed) call('setLayersCollapsed', collapsed, false);
    }
    doc.querySelector('[data-layers-collapse]')?.addEventListener('click', () => {
      const app = doc.querySelector('.app[data-workspace]');
      if (app && ws()) store.set(`frameup.layers.collapsed.${ws()}`, app.classList.contains('layers-collapsed') ? '1' : '0');
    });

    // ── Wiring ────────────────────────────────────────────────────────────
    // Nothing runs before the first paint: the editor paints first, this
    // file catches up right after the page has loaded.
    let ready = false;
    let frame = 0;
    function refresh() {
      frame = 0;
      if (!EDITOR_PAGES.has(page())) { if (bar.el) bar.el.hidden = true; if (bar.preview) toggleSmallPreview(false); return; }
      syncCollapse();
      syncBarBounds();
      syncBar();
      renderLayers(false);
      syncMobileLayers();
      ensureSlideMenu();
      labelWidgetInputs();
    }
    function queue() { if (ready && !frame) frame = win.requestAnimationFrame(refresh); }
    // First run in three small idle steps, so it never adds a long task.
    function markReady() {
      if (ready) return;
      const idle = fn => (win.requestIdleCallback ? win.requestIdleCallback(fn, { timeout: 1200 }) : win.setTimeout(fn, 30));
      idle(() => {
        ready = true;
        api.ready = true;
        setupList();
        setupCanvasSelection();
        if (EDITOR_PAGES.has(page())) { syncCollapse(); syncBarBounds(); syncBar(); }
        idle(() => {
          renderLayers(false);
          idle(() => { queue(); });
        });
      });
    }
    if (doc.readyState === 'complete') win.setTimeout(markReady, 0);
    else win.addEventListener('load', () => win.setTimeout(markReady, 0), { once: true });

    // index.html calls FrameUpEditorUI.renderLayers() from updateLayersPanel()
    // and fires `frameup:rendered` after each preview render.
    api.renderLayers = () => { if (ready) renderLayers(false); };
    api.exportIssues = () => {
      try {
        if (!textUnderTimestamp()) return [];
        return [{
          text: 'Your headline runs into the bottom-right corner, where YouTube shows the video length. Move it up or left so nothing is covered.',
          rule: 'youtube-timestamp-zone',
          fix: { label: 'Show safe zones', run: () => { bar.safe = true; store.set('frameup.editor.safeZones', '1'); syncBar(); syncOutlines(); } },
        }];
      } catch (error) { return []; }
    };
    api.selectLayer = id => select(id);
    api.selectedLayers = () => selectedIds();
    api.moveSelection = moveSelection;
    api.refresh = refresh;
    win.addEventListener('frameup:rendered', queue);
    win.addEventListener('hashchange', queue);
    win.addEventListener('resize', queue);
    const observer = new win.MutationObserver(queue);
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-current-page', 'data-newsletter-asset', 'data-instagram-post-type', 'data-youtube-variation', 'data-youtube-quote'] });
    setupShortcuts();
    setupFit();
  }

  const api = { ...pure, install };
  return api;
}));
