/*
 * FrameUp custom logos: a personal library of square (1:1) logos people upload
 * for the Social Media, YouTube and Newsletter editors.
 *
 *   FrameUpCustomLogos.store.list()            -> { logos, mode, note }
 *   FrameUpCustomLogos.store.add({ blob, thumb, name, width, height })
 *   FrameUpCustomLogos.store.rename(id, name) / remove(id) / touch(id)
 *   FrameUpCustomLogos.store.thumbUrl(logo)    -> object URL (grid thumbnails)
 *   FrameUpCustomLogos.store.dataUrl(logo)     -> PNG data URL (canvas + exports)
 *   FrameUpCustomLogos.openCrop(file, { onSave }) -> crop dialog, resolves
 *     { blob, thumb, name, width, height, bytes } or null when cancelled
 *
 * Storage: rows in public.frameup_custom_logos (one per logo, owner = the
 * signed-in person) and two PNGs in the private 'custom-logos' bucket under
 * <auth user id>/ (supabase/migrations/20261128120000_frameup_custom_logos.sql).
 * Images are read with the person's own session (storage download -> blob),
 * never through public URLs, and handed to the canvas as data URLs, so exports
 * are never tainted and saved designs keep working after a session ends.
 *
 * Before that migration runs (or when signed out / offline) the library works
 * for this tab only (in memory) and says so; nothing throws.
 *
 * SVG uploads are drawn through an <img> (static image mode: no scripts, no
 * external loads) and rasterised to PNG; their markup is never put in the page.
 *
 * The pure helpers are exported under FrameUpCustomLogos.helpers for tests
 * (scripts/test-custom-logos.mjs).
 * UMD: window.FrameUpCustomLogos in the browser, module.exports under Node.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpCustomLogos = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const TABLE = 'frameup_custom_logos';
  const BUCKET = 'custom-logos';
  const MAX_BYTES = 5 * 1024 * 1024;
  const OUT_SIZE = 1024;
  const THUMB_SIZE = 256;
  const NAME_MAX = 80;
  const MAX_SIDE = 12000;
  const MAX_PIXELS = 60 * 1000 * 1000;
  const MIN_SIDE = 16;
  const MAX_ZOOM = 8;
  const MAX_LOGOS = 500;
  const TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
  const EXT_KIND = Object.freeze({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', svg: 'svg' });
  const TYPE_KIND = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/svg+xml': 'svg' });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── Pure helpers ──────────────────────────────────────────────────────────
  function fileKind(file) {
    if (!file) return '';
    const byType = TYPE_KIND[String(file.type || '').toLowerCase()];
    if (byType) return byType;
    // Some systems send SVGs (and the odd PNG) with no type: trust the extension only then.
    if (file.type) return '';
    const ext = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return (ext && EXT_KIND[ext[1]]) || '';
  }

  function validateFile(file) {
    if (!file) return 'Choose a logo file.';
    if (!fileKind(file)) return 'Use a PNG, JPG, WebP or SVG logo.';
    if (!(file.size > 0)) return 'That file is empty. Choose another logo.';
    if (file.size > MAX_BYTES) return 'Logo must be 5 MB or smaller.';
    return '';
  }

  // PNG, WebP and SVG keep their see-through background; JPG has none.
  function keepsTransparency(kind) { return kind === 'png' || kind === 'webp' || kind === 'svg'; }

  function validateDimensions(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w < MIN_SIDE || h < MIN_SIDE) return `That image is too small. Use one at least ${MIN_SIDE} px on each side.`;
    if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) return 'That image is too large to edit here. Use one under 12,000 px on each side.';
    return '';
  }

  function cleanName(raw) {
    const value = String(raw == null ? '' : raw)
      .trim()
      .replace(/\.(png|jpe?g|webp|svg)$/i, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(value).slice(0, NAME_MAX).join('').trim() || 'Logo';
  }

  // "Bulls" -> "Bulls 2" when the person already has a "Bulls" (case-insensitive).
  function uniqueName(name, existing) {
    const base = cleanName(name);
    const taken = new Set((existing || []).map(item => String(item || '').toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n += 1) {
      const suffix = ' ' + n;
      const candidate = Array.from(base).slice(0, NAME_MAX - suffix.length).join('').trim() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  function isUuid(value) { return UUID.test(String(value || '')); }

  function objectPaths(userId, logoId) {
    if (!isUuid(userId) || !isUuid(logoId)) throw new Error('bad logo path');
    const folder = String(userId).toLowerCase();
    const id = String(logoId).toLowerCase();
    return { path: `${folder}/${id}.png`, thumbPath: `${folder}/${id}-thumb.png` };
  }

  function newId(cryptoImpl) {
    const c = cryptoImpl || (root && root.crypto);
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // ── Crop math ──
  // The crop frame is the unit square; (x, y) is the image centre's offset from
  // the frame centre in frame units. zoom 1 = the whole image fits (contain).
  // A larger image must keep covering the frame on that axis; a smaller one
  // must stay inside it, so the logo can never be dragged out of view.
  function cropSize(crop) {
    const longest = Math.max(crop.w, crop.h) || 1;
    return { dw: (crop.w / longest) * crop.zoom, dh: (crop.h / longest) * crop.zoom };
  }
  function fillZoom(w, h) {
    const a = Math.max(1, Number(w) || 1);
    const b = Math.max(1, Number(h) || 1);
    return Math.max(a, b) / Math.min(a, b);
  }
  function maxZoom(w, h) { return Math.max(MAX_ZOOM, fillZoom(w, h) * 2); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clampCrop(crop) {
    const zoom = clamp(Number(crop.zoom) || 1, 1, maxZoom(crop.w, crop.h));
    const next = { w: crop.w, h: crop.h, zoom, x: Number(crop.x) || 0, y: Number(crop.y) || 0 };
    const { dw, dh } = cropSize(next);
    const lx = Math.abs(dw - 1) / 2;
    const ly = Math.abs(dh - 1) / 2;
    next.x = clamp(next.x, -lx, lx);
    next.y = clamp(next.y, -ly, ly);
    return next;
  }
  function createCrop(w, h, mode) {
    const crop = { w: Math.max(1, Number(w) || 1), h: Math.max(1, Number(h) || 1), zoom: 1, x: 0, y: 0 };
    if (mode === 'fill') crop.zoom = fillZoom(crop.w, crop.h);
    return clampCrop(crop);
  }
  // Zoom keeping the frame point (ax, ay) (frame units from the centre) still.
  function zoomCrop(crop, factor, ax, ay) {
    const anchorX = Number(ax) || 0;
    const anchorY = Number(ay) || 0;
    const target = clampCrop({ ...crop, zoom: crop.zoom * (Number(factor) || 1) });
    const k = target.zoom / crop.zoom;
    return clampCrop({ ...target, x: anchorX - (anchorX - crop.x) * k, y: anchorY - (anchorY - crop.y) * k });
  }
  function setZoom(crop, zoom) { return zoomCrop(crop, (Number(zoom) || 1) / crop.zoom, 0, 0); }
  function panCrop(crop, dx, dy) { return clampCrop({ ...crop, x: crop.x + (Number(dx) || 0), y: crop.y + (Number(dy) || 0) }); }
  // Where to draw the image on a size x size canvas: drawImage(img, x, y, w, h).
  function drawRect(crop, size) {
    const s = Number(size) || OUT_SIZE;
    const { dw, dh } = cropSize(crop);
    return { x: (0.5 + crop.x - dw / 2) * s, y: (0.5 + crop.y - dh / 2) * s, w: dw * s, h: dh * s };
  }

  // ── Library list helpers ──
  function time(value) {
    const t = Date.parse(value || '');
    return Number.isFinite(t) ? t : 0;
  }
  function normalizeRow(row) {
    const r = row || {};
    return {
      id: String(r.id || ''),
      name: cleanName(r.name),
      path: String(r.path || ''),
      thumbPath: String(r.thumb_path || r.thumbPath || ''),
      width: Number(r.width) || OUT_SIZE,
      height: Number(r.height) || OUT_SIZE,
      bytes: Number(r.bytes) || 0,
      createdAt: r.created_at || r.createdAt || '',
      lastUsedAt: r.last_used_at || r.lastUsedAt || '',
    };
  }
  // Last used first; never-used logos by upload time, newest first.
  function sortLogos(list) {
    return (Array.isArray(list) ? list.slice() : []).sort((a, b) =>
      Math.max(time(b.lastUsedAt), time(b.createdAt)) - Math.max(time(a.lastUsedAt), time(a.createdAt))
      || String(a.name).localeCompare(String(b.name)));
  }
  function filterLogos(list, query) {
    const q = String(query || '').trim().toLowerCase();
    const items = Array.isArray(list) ? list : [];
    return q ? items.filter(item => String(item.name || '').toLowerCase().includes(q)) : items;
  }
  // The table or bucket is not there yet (migration not run).
  function isMissingError(error) {
    if (!error) return false;
    const code = String(error.code || error.error || '');
    const status = String(error.statusCode || error.status || '');
    const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''} ${error.error || ''}`;
    if (['42P01', 'PGRST205', 'PGRST204', '42703', 'PGRST202'].includes(code)) return true;
    if (/does not exist|could not find the table|schema cache|bucket not found/i.test(text)) return true;
    return status === '404' && /bucket/i.test(text);
  }

  const helpers = Object.freeze({
    TABLE, BUCKET, MAX_BYTES, OUT_SIZE, THUMB_SIZE, NAME_MAX, MAX_ZOOM, MAX_LOGOS, TYPES,
    fileKind, validateFile, keepsTransparency, validateDimensions, cleanName, uniqueName, isUuid, objectPaths, newId,
    cropSize, fillZoom, maxZoom, clampCrop, createCrop, zoomCrop, setZoom, panCrop, drawRect,
    normalizeRow, sortLogos, filterLogos, isMissingError,
  });

  if (!root || typeof root.document === 'undefined') {
    return Object.freeze({ helpers, store: null, openCrop() { return Promise.resolve(null); } });
  }

  // ── Browser-only below ──────────────────────────────────────────────────
  const doc = root.document;

  function track(action, logo, extra) {
    try {
      const tracker = root.FrameUpTrack;
      if (!tracker || typeof tracker.track !== 'function') return;
      const page = doc.body && doc.body.dataset ? doc.body.dataset.currentPage : '';
      const tool = typeof tracker.toolForWorkspace === 'function' ? tracker.toolForWorkspace(page) : 'other';
      tracker.track('open', { tool, action, label: logo && logo.name ? logo.name : 'Custom logo', meta: Object.assign({ asset: 'custom-logo' }, extra || {}) });
    } catch (error) { /* tracking never breaks a feature */ }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  // ── Store: Supabase when the table + bucket exist, else this tab only ──
  const store = (() => {
    const SESSION_NOTE = 'Your logo library isn’t set up yet, so uploads stay in this tab only and are gone when you close it.';
    const SIGNED_OUT_NOTE = 'Sign in to keep your logos. Uploads stay in this tab only for now.';
    const OFFLINE_NOTE = 'FrameUp storage isn’t reachable, so uploads stay in this tab only for now.';
    const state = { mode: 'unknown', note: '', logos: [], loaded: false };
    const memory = new Map();       // id -> { full: Blob, thumb: Blob } for session logos (and a cache for cloud ones)
    const thumbUrls = new Map();    // id -> object URL
    const dataUrls = new Map();     // id -> data URL
    let user = null;

    async function getClient() {
      const auth = root.ESAuth;
      try {
        if (!auth || typeof auth.ensureSupabaseReady !== 'function' || !(await auth.ensureSupabaseReady())) return null;
        const client = auth.getSupabaseClient && auth.getSupabaseClient();
        if (!client || !client.from || !client.storage) return null;
        const { data } = await client.auth.getSession();
        const sessionUser = data && data.session && data.session.user;
        if (!sessionUser || !isUuid(sessionUser.id)) return null;
        user = { id: sessionUser.id, email: String(sessionUser.email || '').toLowerCase() };
        return client;
      } catch (error) {
        return null;
      }
    }

    // supabase-js query builders are thenables without .catch: one guard for both kinds.
    async function run(fn) {
      try { return await fn(); } catch (error) { return { error }; }
    }

    function goSession(note) {
      state.mode = 'session';
      state.note = note || SESSION_NOTE;
    }

    function snapshot() { return { logos: sortLogos(state.logos), mode: state.mode, note: state.note }; }

    async function list(options) {
      const force = options && options.force;
      if (state.loaded && !force) return snapshot();
      if (state.mode === 'session' && state.loaded) return snapshot();
      const client = await getClient();
      if (!client) {
        goSession(SIGNED_OUT_NOTE);
        state.loaded = true;
        return snapshot();
      }
      let result;
      try {
        result = await client.from(TABLE)
          .select('id,name,path,thumb_path,width,height,bytes,created_at,last_used_at')
          .order('created_at', { ascending: false })
          .limit(MAX_LOGOS);
      } catch (error) {
        result = { error };
      }
      if (result && result.error) {
        if (isMissingError(result.error)) { goSession(SESSION_NOTE); state.loaded = true; return snapshot(); }
        const failure = new Error('Your logos could not be loaded.');
        failure.cause = result.error;
        throw failure;
      }
      const sessionOnly = state.logos.filter(logo => logo.session);
      state.logos = (Array.isArray(result && result.data) ? result.data : []).map(normalizeRow).concat(sessionOnly);
      state.mode = 'cloud';
      state.note = '';
      state.loaded = true;
      return snapshot();
    }

    function addSession(input, id) {
      const logo = normalizeRow({ id, name: input.name, width: input.width, height: input.height, bytes: input.blob.size, created_at: new Date().toISOString() });
      logo.session = true;
      memory.set(id, { full: input.blob, thumb: input.thumb || input.blob });
      state.logos.push(logo);
      return logo;
    }

    async function add(input) {
      if (!input || !input.blob) throw new Error('No logo to save.');
      if (input.blob.size > MAX_BYTES) throw new Error('That logo is over 5 MB after cropping. Try a simpler image.');
      if (!state.loaded) { try { await list(); } catch (error) { /* save anyway */ } }
      const name = uniqueName(input.name, state.logos.map(logo => logo.name));
      const id = newId();
      const payload = Object.assign({}, input, { name });
      if (state.mode !== 'cloud') { const logo = addSession(payload, id); track('custom-logo-upload', logo, { saved: 'session' }); return logo; }
      const client = await getClient();
      if (!client) { goSession(OFFLINE_NOTE); const logo = addSession(payload, id); track('custom-logo-upload', logo, { saved: 'session' }); return logo; }
      const { path, thumbPath } = objectPaths(user.id, id);
      const bucket = client.storage.from(BUCKET);
      const up1 = await run(() => bucket.upload(path, input.blob, { contentType: 'image/png', upsert: false, cacheControl: '31536000' }));
      if (up1 && up1.error) {
        if (isMissingError(up1.error)) { goSession(SESSION_NOTE); const logo = addSession(payload, id); track('custom-logo-upload', logo, { saved: 'session' }); return logo; }
        throw new Error('The logo could not be uploaded. Try again.');
      }
      const up2 = await run(() => bucket.upload(thumbPath, input.thumb || input.blob, { contentType: 'image/png', upsert: false, cacheControl: '31536000' }));
      if (up2 && up2.error) {
        await bucket.remove([path]).catch(() => {});
        throw new Error('The logo could not be uploaded. Try again.');
      }
      const row = {
        id,
        owner_id: user.id,
        owner_email: user.email,
        name,
        path,
        thumb_path: thumbPath,
        width: Number(input.width) || OUT_SIZE,
        height: Number(input.height) || OUT_SIZE,
        bytes: input.blob.size,
      };
      const inserted = await run(() => client.from(TABLE).insert(row).select('id,name,path,thumb_path,width,height,bytes,created_at,last_used_at').single());
      if (inserted && inserted.error) {
        await bucket.remove([path, thumbPath]).catch(() => {});
        if (isMissingError(inserted.error)) { goSession(SESSION_NOTE); const logo = addSession(payload, id); track('custom-logo-upload', logo, { saved: 'session' }); return logo; }
        throw new Error('The logo could not be saved to your library. Try again.');
      }
      const logo = normalizeRow((inserted && inserted.data) || Object.assign({ created_at: new Date().toISOString() }, row));
      memory.set(logo.id, { full: input.blob, thumb: input.thumb || input.blob });
      state.logos.push(logo);
      track('custom-logo-upload', logo, { saved: 'library' });
      return logo;
    }

    function find(id) { return state.logos.find(logo => logo.id === id) || null; }

    async function rename(id, rawName) {
      const logo = find(id);
      if (!logo) throw new Error('That logo is no longer in your library.');
      const name = cleanName(rawName);
      if (name === logo.name) return logo;
      if (!logo.session) {
        const client = await getClient();
        if (!client) throw new Error('Sign in again to rename this logo.');
        const result = await run(() => client.from(TABLE).update({ name }).eq('id', id));
        if (result && result.error) throw new Error('The logo could not be renamed. Try again.');
      }
      logo.name = name;
      return logo;
    }

    function forget(id) {
      const url = thumbUrls.get(id);
      if (url) { try { root.URL.revokeObjectURL(url); } catch (error) { /* ignore */ } }
      thumbUrls.delete(id);
      dataUrls.delete(id);
      memory.delete(id);
      state.logos = state.logos.filter(logo => logo.id !== id);
    }

    async function remove(id) {
      const logo = find(id);
      if (!logo) return;
      if (!logo.session) {
        const client = await getClient();
        if (!client) throw new Error('Sign in again to delete this logo.');
        const result = await run(() => client.from(TABLE).delete().eq('id', id));
        if (result && result.error) throw new Error('The logo could not be deleted. Try again.');
        // The row is gone; the files go too (a leftover file is invisible and harmless).
        await client.storage.from(BUCKET).remove([logo.path, logo.thumbPath].filter(Boolean)).catch(() => {});
      }
      forget(id);
    }

    // Last used first next time (in this list at once; in the table quietly).
    function touch(id) {
      const logo = find(id);
      if (!logo) return;
      logo.lastUsedAt = new Date().toISOString();
      if (logo.session) return;
      getClient().then(client => client && client.from(TABLE).update({ last_used_at: logo.lastUsedAt }).eq('id', id)).catch(() => {});
    }

    async function download(path) {
      const client = await getClient();
      if (!client) throw new Error('Sign in again to load your logos.');
      const result = await client.storage.from(BUCKET).download(path);
      if (!result || result.error || !result.data) throw new Error('The logo could not be loaded.');
      return result.data;
    }

    async function blobFor(logo, kind) {
      const cached = memory.get(logo.id);
      if (cached && cached[kind]) return cached[kind];
      if (logo.session) throw new Error('This logo was only kept in a previous tab.');
      const blob = await download(kind === 'thumb' ? (logo.thumbPath || logo.path) : logo.path);
      memory.set(logo.id, Object.assign({}, memory.get(logo.id), { [kind]: blob }));
      return blob;
    }

    async function thumbUrl(logo) {
      if (thumbUrls.has(logo.id)) return thumbUrls.get(logo.id);
      const url = root.URL.createObjectURL(await blobFor(logo, 'thumb'));
      thumbUrls.set(logo.id, url);
      return url;
    }

    async function dataUrl(logo) {
      if (dataUrls.has(logo.id)) return dataUrls.get(logo.id);
      const url = await blobToDataUrl(await blobFor(logo, 'full'));
      if (!/^data:image\/png;base64,/i.test(url)) throw new Error('The logo could not be read.');
      dataUrls.set(logo.id, url);
      return url;
    }

    // Which saved logo a placed data URL came from (this page session only).
    function idForSrc(src) {
      if (!src) return '';
      for (const [id, url] of dataUrls) if (url === src) return id;
      return '';
    }

    async function getById(id) {
      if (!isUuid(id)) return null;
      try { await list(); } catch (error) { return null; }
      return find(id);
    }

    root.addEventListener && root.addEventListener('es:auth-updated', () => { state.loaded = false; state.mode = 'unknown'; user = null; });

    return Object.freeze({ list, add, rename, remove, touch, thumbUrl, dataUrl, getById, idForSrc, track, get mode() { return state.mode; }, get note() { return state.note; } });
  })();

  // ── Crop dialog ─────────────────────────────────────────────────────────
  const ICON = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = root.URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve({ img, url });
      img.onerror = () => { root.URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function renderCrop(img, crop, size) {
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const r = drawRect(crop, size);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/png'));
  }

  let cropEl = null;
  let cropSession = null;

  function buildCrop() {
    cropEl = doc.createElement('dialog');
    cropEl.className = 'fcl';
    cropEl.setAttribute('aria-labelledby', 'fcl-title');
    cropEl.innerHTML = `
      <div class="fcl__scrim" data-fcl-cancel></div>
      <section class="fcl__dialog">
        <header class="fcl__head">
          <h2 class="fcl__title" id="fcl-title">Crop logo</h2>
          <button type="button" class="es-icon-btn fcl__close" data-fcl-cancel aria-label="Cancel and close">${ICON.close}</button>
        </header>
        <div class="fcl__body">
          <div class="fcl__stage-wrap">
            <div class="fcl__stage" tabindex="0" role="img" data-fcl-stage aria-roledescription="crop area" aria-label="Square crop. Drag or use the arrow keys to move the logo; plus and minus zoom; 0 fits it." aria-describedby="fcl-help">
              <canvas class="fcl__canvas" data-fcl-canvas width="640" height="640"></canvas>
            </div>
            <p class="fcl__help" id="fcl-help">Drag to move · scroll or pinch to zoom</p>
          </div>
          <div class="fcl__side">
            <div class="es-field fcl__field">
              <label class="es-field__label" for="fcl-zoom">Zoom</label>
              <div class="fcl__zoom">
                <button type="button" class="es-icon-btn fcl__step" data-fcl-zoom="-1" aria-label="Zoom out">${ICON.minus}</button>
                <input type="range" id="fcl-zoom" class="fcl__range" min="1" max="8" step="0.01" value="1" data-fcl-range>
                <button type="button" class="es-icon-btn fcl__step" data-fcl-zoom="1" aria-label="Zoom in">${ICON.plus}</button>
              </div>
              <div class="es-segmented es-segmented--sm fcl__fit" role="group" aria-label="Fit">
                <button type="button" class="es-segmented__item" data-fcl-fit="contain" aria-pressed="true">Fit whole logo</button>
                <button type="button" class="es-segmented__item" data-fcl-fit="fill" aria-pressed="false">Fill square</button>
              </div>
            </div>
            <div class="es-field fcl__field">
              <span class="es-field__label" id="fcl-preview-label">Preview</span>
              <div class="fcl__previews" role="group" aria-labelledby="fcl-preview-label">
                <figure class="fcl__preview is-light"><canvas width="128" height="128" data-fcl-preview="light"></canvas><figcaption>Light</figcaption></figure>
                <figure class="fcl__preview is-dark"><canvas width="128" height="128" data-fcl-preview="dark"></canvas><figcaption>Dark</figcaption></figure>
              </div>
              <p class="es-field__hint" data-fcl-alpha></p>
            </div>
            <div class="es-field fcl__field">
              <label class="es-field__label" for="fcl-name">Name</label>
              <input id="fcl-name" class="es-input fcl__name" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" placeholder="Bulls alternate" data-fcl-name aria-describedby="fcl-error">
            </div>
            <p class="fcl__error" id="fcl-error" role="alert" data-fcl-error></p>
          </div>
        </div>
        <footer class="fcl__foot">
          <button type="button" class="es-btn" data-fcl-cancel>Cancel</button>
          <button type="button" class="es-btn es-btn--primary" data-fcl-save>Save logo</button>
        </footer>
      </section>`;
    doc.body.appendChild(cropEl);
    cropEl.addEventListener('cancel', event => { event.preventDefault(); if (!cropSession || !cropSession.busy) endCrop(null); });
    cropEl.addEventListener('click', onCropClick);
    cropEl.addEventListener('keydown', onCropKey);
    const stage = cropEl.querySelector('[data-fcl-stage]');
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    cropEl.querySelector('[data-fcl-range]').addEventListener('input', event => {
      if (!cropSession) return;
      setCrop(setZoom(cropSession.crop, Number(event.target.value)));
    });
  }

  function syncFitButtons() {
    const s = cropSession;
    const fill = fillZoom(s.crop.w, s.crop.h);
    const mode = Math.abs(s.crop.zoom - 1) < 0.005 ? 'contain' : (Math.abs(s.crop.zoom - fill) < 0.005 ? 'fill' : '');
    cropEl.querySelectorAll('[data-fcl-fit]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.fclFit === mode)));
  }

  function draw() {
    const s = cropSession;
    if (!s) return;
    const canvas = cropEl.querySelector('[data-fcl-canvas]');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    const r = drawRect(s.crop, canvas.width);
    ctx.drawImage(s.img, r.x, r.y, r.w, r.h);
    cropEl.querySelectorAll('[data-fcl-preview]').forEach(preview => {
      const pctx = preview.getContext('2d');
      pctx.clearRect(0, 0, preview.width, preview.height);
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(canvas, 0, 0, preview.width, preview.height);
    });
    const range = cropEl.querySelector('[data-fcl-range]');
    range.max = String(maxZoom(s.crop.w, s.crop.h).toFixed(2));
    range.value = String(s.crop.zoom);
    range.setAttribute('aria-valuetext', `${Math.round(s.crop.zoom * 100)}%`);
    syncFitButtons();
  }

  function setCrop(next) {
    if (!cropSession) return;
    cropSession.crop = clampCrop(next);
    if (!cropSession.frame) {
      cropSession.frame = root.requestAnimationFrame(() => { if (cropSession) { cropSession.frame = 0; draw(); } });
    }
  }

  function stageMetrics(event) {
    const rect = cropEl.querySelector('[data-fcl-stage]').getBoundingClientRect();
    const size = Math.max(1, rect.width);
    return { size, ax: (event.clientX - rect.left) / size - 0.5, ay: (event.clientY - rect.top) / size - 0.5 };
  }

  function onPointerDown(event) {
    if (!cropSession || cropSession.busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    cropSession.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.classList.add('is-dragging');
  }
  function onPointerMove(event) {
    const s = cropSession;
    if (!s || !s.pointers.has(event.pointerId)) return;
    const prev = s.pointers.get(event.pointerId);
    const { size } = stageMetrics(event);
    if (s.pointers.size >= 2) {
      const others = Array.from(s.pointers.entries()).filter(([id]) => id !== event.pointerId).map(([, p]) => p);
      const other = others[0];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y) || 1;
      const mid = stageMetrics({ clientX: (event.clientX + other.x) / 2, clientY: (event.clientY + other.y) / 2 });
      setCrop(zoomCrop(s.crop, after / before, mid.ax, mid.ay));
    } else {
      setCrop(panCrop(s.crop, (event.clientX - prev.x) / size, (event.clientY - prev.y) / size));
    }
    s.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function onPointerUp(event) {
    if (!cropSession) return;
    cropSession.pointers.delete(event.pointerId);
    if (!cropSession.pointers.size) event.currentTarget.classList.remove('is-dragging');
  }
  function onWheel(event) {
    if (!cropSession || cropSession.busy) return;
    event.preventDefault();
    const { ax, ay } = stageMetrics(event);
    const factor = Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * (event.ctrlKey ? 0.01 : 0.0025));
    setCrop(zoomCrop(cropSession.crop, factor, ax, ay));
  }

  function focusables() {
    return Array.from(cropEl.querySelectorAll('button, input, [tabindex="0"]')).filter(node => !node.disabled && node.offsetParent !== null);
  }

  function onCropKey(event) {
    const s = cropSession;
    if (!s) return;
    // Esc closes only this dialog. Handled here (not the native cancel) so the
    // logo picker underneath, opened in the same gesture, stays open.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!s.busy) endCrop(null);
      return;
    }
    if (event.key === 'Tab') {
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-fcl-name]')) { event.preventDefault(); save(); return; }
    if (!event.target.closest('[data-fcl-stage]') || s.busy) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) { event.preventDefault(); setCrop(panCrop(s.crop, moves[event.key][0], moves[event.key][1])); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setCrop(zoomCrop(s.crop, 1.1, 0, 0)); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); setCrop(zoomCrop(s.crop, 1 / 1.1, 0, 0)); return; }
    if (event.key === '0') { event.preventDefault(); setCrop(createCrop(s.crop.w, s.crop.h, 'contain')); }
  }

  function onCropClick(event) {
    const s = cropSession;
    if (!s) return;
    if (event.target.closest('[data-fcl-cancel]')) { if (!s.busy) endCrop(null); return; }
    if (s.busy) return;
    const zoom = event.target.closest('[data-fcl-zoom]');
    if (zoom) { setCrop(zoomCrop(s.crop, Number(zoom.dataset.fclZoom) > 0 ? 1.15 : 1 / 1.15, 0, 0)); return; }
    const fit = event.target.closest('[data-fcl-fit]');
    if (fit) { setCrop(createCrop(s.crop.w, s.crop.h, fit.dataset.fclFit === 'fill' ? 'fill' : 'contain')); return; }
    if (event.target.closest('[data-fcl-save]')) save();
  }

  function setError(text) {
    const node = cropEl.querySelector('[data-fcl-error]');
    node.textContent = text || '';
    cropEl.querySelector('[data-fcl-name]').setAttribute('aria-invalid', String(Boolean(text) && /name/i.test(text)));
  }

  function setBusy(busy) {
    const s = cropSession;
    s.busy = busy;
    const button = cropEl.querySelector('[data-fcl-save]');
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? 'Saving…' : 'Save logo';
    cropEl.querySelector('.fcl__dialog').setAttribute('aria-busy', String(busy));
  }

  async function save() {
    const s = cropSession;
    if (!s || s.busy) return;
    setError('');
    setBusy(true);
    try {
      const full = renderCrop(s.img, s.crop, OUT_SIZE);
      const blob = await canvasToBlob(full);
      const thumbCanvas = doc.createElement('canvas');
      thumbCanvas.width = THUMB_SIZE;
      thumbCanvas.height = THUMB_SIZE;
      const tctx = thumbCanvas.getContext('2d');
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(full, 0, 0, THUMB_SIZE, THUMB_SIZE);
      const thumb = await canvasToBlob(thumbCanvas);
      if (blob.size > MAX_BYTES) throw new Error('That logo is over 5 MB after cropping. Try a simpler image.');
      const result = { blob, thumb, name: cleanName(cropEl.querySelector('[data-fcl-name]').value || s.defaultName), width: OUT_SIZE, height: OUT_SIZE, bytes: blob.size, kind: s.kind };
      if (typeof s.onSave === 'function') await s.onSave(result);
      if (cropSession === s) endCrop(result);
    } catch (error) {
      if (cropSession === s) {
        setBusy(false);
        setError((error && error.message) || 'The logo could not be saved. Try again.');
      }
    }
  }

  function endCrop(result) {
    const s = cropSession;
    if (!s) return;
    cropSession = null;
    if (s.frame) root.cancelAnimationFrame(s.frame);
    try { root.URL.revokeObjectURL(s.url); } catch (error) { /* ignore */ }
    if (cropEl.open && typeof cropEl.close === 'function') cropEl.close(); else cropEl.removeAttribute('open');
    if (s.lastFocus && typeof s.lastFocus.focus === 'function' && s.lastFocus.isConnected) s.lastFocus.focus();
    s.resolve(result);
  }

  // Opens the square crop step for one file. Rejects with a readable message
  // when the file can't be used; resolves null when cancelled.
  async function openCrop(file, options) {
    const opts = options || {};
    const problem = validateFile(file);
    if (problem) throw new Error(problem);
    let loaded;
    try { loaded = await loadImage(file); }
    catch (error) { throw new Error(fileKind(file) === 'svg' ? 'That SVG could not be read. Try a PNG.' : 'That image could not be read. Try another file.'); }
    const kind = fileKind(file);
    // An SVG without its own size gets a square working size; it is drawn as vectors at the output size.
    const w = loaded.img.naturalWidth || OUT_SIZE;
    const h = loaded.img.naturalHeight || (loaded.img.naturalWidth || OUT_SIZE);
    const sizeProblem = kind === 'svg' ? '' : validateDimensions(w, h);
    if (sizeProblem) { root.URL.revokeObjectURL(loaded.url); throw new Error(sizeProblem); }
    if (cropSession) endCrop(null);
    if (!cropEl) buildCrop();
    return new Promise(resolve => {
      const defaultName = cleanName(opts.name || file.name);
      cropSession = { img: loaded.img, url: loaded.url, kind, crop: createCrop(w, h, 'contain'), pointers: new Map(), busy: false, frame: 0, onSave: opts.onSave, resolve, defaultName, lastFocus: doc.activeElement };
      cropEl.querySelector('#fcl-title').textContent = opts.title || 'Crop logo';
      cropEl.querySelector('[data-fcl-name]').value = defaultName;
      cropEl.querySelector('[data-fcl-alpha]').textContent = keepsTransparency(kind)
        ? 'See-through areas stay see-through.'
        : 'JPG has no see-through background: the empty corners stay see-through, the photo’s own background stays.';
      setError('');
      setBusy(false);
      if (typeof cropEl.showModal === 'function') { if (!cropEl.open) cropEl.showModal(); } else cropEl.setAttribute('open', '');
      draw();
      root.requestAnimationFrame(() => cropEl.querySelector('[data-fcl-stage]').focus({ preventScroll: true }));
    });
  }

  return Object.freeze({ helpers, store, openCrop, track, isCropOpen: () => Boolean(cropSession) });
}));
