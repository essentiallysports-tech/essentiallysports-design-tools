// FrameUp editor: "Remove background" on each photo in the Photos panel.
//
//   - With BRIA_API_KEY set on the server, /api/remove-bg cuts the subject
//     out with Bria RMBG 2.0 (about $0.018 per image, logged and capped like
//     every AI call). Results are kept for this session, so the same photo is
//     never sent twice.
//   - Without it, the button says it isn't set up, and offers the free
//     "plain backdrop" tool instead when the photo suits it: a flood fill
//     from the edges that runs fully in the browser (no model download). It
//     only works on studio-style photos with a plain, even backdrop, and
//     says so rather than guessing on busy photos.
// The pixel maths is pure and exported for tests (scripts/test-cutout.mjs).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpCutout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
  // Vercel rejects request bodies over about 4.5 MB, and base64 adds a third.
  const MAX_SEND_BASE64 = 4 * 1024 * 1024;
  const MAX_SEND_SIDE = 2048;
  const PLAIN_MAX_SIDE = 1600;

  function colorDistance(data, i, color) {
    const dr = data[i] - color[0];
    const dg = data[i + 1] - color[1];
    const db = data[i + 2] - color[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }

  // The backdrop colour (median of the outer edge) and how much of the edge
  // matches it. A plain studio backdrop scores near 1; a stadium near 0.
  function edgeStats(data, width, height, tolerance = 32) {
    const indexes = [];
    const step = Math.max(1, Math.floor(Math.max(width, height) / 400));
    for (let x = 0; x < width; x += step) indexes.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y += step) indexes.push(y * width, y * width + width - 1);
    const opaque = indexes.filter(p => data[p * 4 + 3] > 8);
    if (!opaque.length) return { color: [0, 0, 0], uniformity: 0 };
    const color = [0, 1, 2].map(c => median(opaque.map(p => data[p * 4 + c])));
    const matching = opaque.filter(p => colorDistance(data, p * 4, color) <= tolerance).length;
    return { color, uniformity: matching / opaque.length };
  }

  // Alpha mask for a plain backdrop: flood fill from every edge pixel that
  // matches the backdrop colour, with a soft 1-step edge. Returns null when
  // the photo doesn't look like a plain backdrop or nearly nothing/everything
  // would be removed.
  function plainBackdropMask(data, width, height, { tolerance = 32, minUniformity = 0.7 } = {}) {
    const stats = edgeStats(data, width, height, tolerance);
    if (stats.uniformity < minUniformity) return { ok: false, reason: 'busy', uniformity: stats.uniformity };
    const total = width * height;
    const background = new Uint8Array(total);
    const queue = new Uint32Array(total);
    let head = 0;
    let tail = 0;
    const seed = p => {
      if (background[p] || colorDistance(data, p * 4, stats.color) > tolerance) return;
      background[p] = 1;
      queue[tail++] = p;
    };
    for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      if (x > 0) seed(p - 1);
      if (x < width - 1) seed(p + 1);
      if (p >= width) seed(p - width);
      if (p < total - width) seed(p + width);
    }
    const removed = tail / total;
    if (removed < 0.05 || removed > 0.95) return { ok: false, reason: removed < 0.05 ? 'nothing' : 'everything', uniformity: stats.uniformity, removed };
    const alpha = new Uint8ClampedArray(total);
    const soft = tolerance * 0.75;
    for (let p = 0; p < total; p++) {
      if (background[p]) { alpha[p] = 0; continue; }
      const x = p % width;
      const touchesBackground = (x > 0 && background[p - 1]) || (x < width - 1 && background[p + 1])
        || (p >= width && background[p - width]) || (p < total - width && background[p + width]);
      if (!touchesBackground) { alpha[p] = 255; continue; }
      // Edge pixels close to the backdrop colour fade out instead of a hard line.
      const d = colorDistance(data, p * 4, stats.color) - tolerance;
      alpha[p] = Math.round(255 * Math.min(1, Math.max(0.25, d / soft)));
    }
    return { ok: true, alpha, removed, color: stats.color, uniformity: stats.uniformity };
  }

  // Fit inside maxSide on the longest side, never upscale.
  function scaledSize(width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function base64Bytes(dataUrl) {
    const comma = String(dataUrl).indexOf(',');
    const length = comma >= 0 ? String(dataUrl).length - comma - 1 : 0;
    return Math.floor(length * 3 / 4);
  }

  const api = { MAX_UPLOAD_BYTES, MAX_SEND_BASE64, MAX_SEND_SIDE, edgeStats, plainBackdropMask, scaledSize, base64Bytes };

  // ─── Browser ────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return Object.freeze(api);
  const g = window;

  /* global state, getImageToolDescriptor, saveMediaContext, syncPhotoControls, syncEntityPhotoControls, syncEntityPhotoControls2, syncImageToolControls, render, scheduleDesignHistory, showEsDialog, activeWorkspace */
  const cutouts = new WeakMap(); // source image -> cut-out image (this session)
  const isCutout = new WeakSet();
  let statusPromise = null;

  function toast(message, tone) {
    if (typeof g.showToast === 'function') g.showToast(message, tone);
  }

  function slotFields(inputId) {
    if (inputId === 'entity-photo-input-2') return ['entityPhoto2', 'entityPhotoName2'];
    if (inputId === 'entity-photo-input') return ['entityPhoto', 'entityPhotoName'];
    return ['photo', 'photoName'];
  }

  function applyToSlot(tool, image, sourceName) {
    const descriptor = getImageToolDescriptor(tool);
    const [imageKey, nameKey] = slotFields(descriptor.inputId);
    state[imageKey] = image;
    state[nameKey] = `${String(sourceName || 'Photo').replace(/\s*\(cut out\)$/, '')} (cut out)`;
    try { saveMediaContext(); } catch (error) { /* media cache is best effort */ }
    [typeof syncPhotoControls === 'function' && syncPhotoControls,
      typeof syncEntityPhotoControls === 'function' && syncEntityPhotoControls,
      typeof syncEntityPhotoControls2 === 'function' && syncEntityPhotoControls2,
      typeof syncImageToolControls === 'function' && syncImageToolControls].forEach(fn => { try { fn && fn(); } catch (error) { /* keep going */ } });
    render();
    try { scheduleDesignHistory(); } catch (error) { /* history is optional */ }
  }

  function loadImage(src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The cut-out image could not be loaded.'));
      img.src = src;
    });
  }

  function drawToCanvas(image, maxSide) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    const size = scaledSize(w, h, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return { canvas, ctx };
  }

  async function sessionToken() {
    const auth = g.ESAuth;
    try {
      const client = (await auth?.ensureSupabaseReady?.()) ? auth.getSupabaseClient() : null;
      const session = client ? (await client.auth.getSession()).data?.session : null;
      return session?.access_token || '';
    } catch (error) {
      return '';
    }
  }

  // { configured: bool } from the server, asked once per page load.
  function serviceStatus(token) {
    if (!statusPromise) {
      statusPromise = fetch('/api/remove-bg', { headers: { Authorization: `Bearer ${token}` } })
        .then(response => (response.ok ? response.json() : { configured: false }))
        .then(body => ({ configured: body?.configured === true }))
        .catch(() => ({ configured: false }));
      // A failed check is asked again next time (the network may be back).
      statusPromise.then(result => { if (!result.configured) setTimeout(() => { statusPromise = null; }, 30000); });
    }
    return statusPromise;
  }

  function encodeForUpload(image) {
    for (const side of [MAX_SEND_SIDE, 1600, 1200]) {
      const { canvas } = drawToCanvas(image, side);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (dataUrl.length <= MAX_SEND_BASE64 && base64Bytes(dataUrl) <= MAX_UPLOAD_BYTES) return dataUrl;
    }
    throw new Error('That photo is too large to send. Try a smaller one.');
  }

  async function removeWithBria(image, token) {
    let dataUrl;
    try {
      dataUrl = encodeForUpload(image);
    } catch (error) {
      if (error?.name === 'SecurityError') throw new Error('This photo comes from another site, so it can’t be processed. Download it and upload it instead.');
      throw error;
    }
    const response = await fetch('/api/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: dataUrl }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      const error = new Error(body.error || 'The background could not be removed. Try again in a moment.');
      error.reason = body.reason || '';
      throw error;
    }
    return body.dataUrl ? loadImage(body.dataUrl) : loadImage(body.url, true);
  }

  async function removePlainBackdrop(image) {
    const { canvas, ctx } = drawToCanvas(image, PLAIN_MAX_SIDE);
    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      throw new Error('This photo comes from another site, so it can’t be processed. Download it and upload it instead.');
    }
    const mask = plainBackdropMask(pixels.data, canvas.width, canvas.height);
    if (!mask.ok) return { ok: false, reason: mask.reason };
    for (let p = 0; p < mask.alpha.length; p++) pixels.data[p * 4 + 3] = Math.min(pixels.data[p * 4 + 3], mask.alpha[p]);
    ctx.putImageData(pixels, 0, 0);
    return { ok: true, image: await loadImage(canvas.toDataURL('image/png')) };
  }

  function plainCheck(image) {
    try {
      const { canvas, ctx } = drawToCanvas(image, 400);
      const stats = edgeStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      return stats.uniformity >= 0.7;
    } catch (error) {
      return false;
    }
  }

  async function runPlain(tool, image, name) {
    const result = await removePlainBackdrop(image);
    if (!result.ok) {
      toast(result.reason === 'busy' ? 'This photo’s backdrop isn’t plain enough for the free tool.' : 'Couldn’t find a backdrop to remove in this photo.', 'error');
      return;
    }
    cutouts.set(image, result.image);
    isCutout.add(result.image);
    applyToSlot(tool, result.image, name);
    toast('Plain backdrop removed. Undo brings it back.', 'success');
  }

  function explainNotSetUp(tool, image, name) {
    const plain = plainCheck(image);
    showEsDialog({
      title: 'Remove background isn’t set up yet',
      body: plain
        ? 'The AI cut-out needs a Bria key on the server (an admin adds BRIA_API_KEY). This photo has a plain backdrop, so the free in-browser tool can remove it now.'
        : 'The AI cut-out needs a Bria key on the server (an admin adds BRIA_API_KEY). The free in-browser tool only handles plain studio backdrops, and this photo’s backdrop is too busy for it.',
      actions: plain
        ? [
          { label: 'Not now', variant: 'quiet' },
          { label: 'Remove plain backdrop', variant: 'primary', onClick: () => runPlain(tool, image, name).catch(error => toast(error.message, 'error')) },
        ]
        : [{ label: 'OK', variant: 'primary' }],
    });
  }

  async function removeBackground(tool, button) {
    const descriptor = getImageToolDescriptor(tool);
    const image = descriptor.image;
    if (!image) {
      toast('Add a photo first.', 'error');
      return;
    }
    if (isCutout.has(image)) {
      toast('The background is already removed.', 'neutral');
      return;
    }
    const cached = cutouts.get(image);
    if (cached) {
      applyToSlot(tool, cached, descriptor.name);
      toast('Background removed', 'success');
      return;
    }
    const label = button?.textContent;
    const busy = on => {
      if (!button) return;
      button.disabled = on;
      if (on) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
      button.textContent = on ? 'Removing…' : label;
    };
    busy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        toast('Sign in to FrameUp to remove backgrounds.', 'error');
        return;
      }
      const status = await serviceStatus(token);
      if (!status.configured) {
        explainNotSetUp(tool, image, descriptor.name);
        return;
      }
      const result = await removeWithBria(image, token);
      cutouts.set(image, result);
      isCutout.add(result);
      // Only apply if the slot still shows the photo we sent.
      if (getImageToolDescriptor(tool).image === image) {
        applyToSlot(tool, result, descriptor.name);
        toast('Background removed. Undo brings it back.', 'success');
      }
    } catch (error) {
      if (error.reason === 'off') {
        statusPromise = Promise.resolve({ configured: false });
        explainNotSetUp(tool, image, descriptor.name);
      } else {
        toast(error.message || 'The background could not be removed.', 'error');
      }
    } finally {
      busy(false);
    }
  }

  function addButtons() {
    document.querySelectorAll('.image-context-actions').forEach(row => {
      const remove = row.querySelector('[data-image-slot-remove]');
      if (!remove || row.querySelector('[data-image-slot-cutout]')) return;
      const tool = remove.dataset.imageSlotRemove;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.imageSlotCutout = tool;
      button.textContent = 'Remove background';
      button.title = 'Cut the subject out of this photo';
      button.addEventListener('click', event => {
        event.stopPropagation();
        removeBackground(tool, button);
      });
      row.appendChild(button);
    });
  }

  function init() {
    if (typeof getImageToolDescriptor !== 'function') return;
    addButtons();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  return Object.freeze({ ...api, removeBackground, _cutouts: cutouts });
});
