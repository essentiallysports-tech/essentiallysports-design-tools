// FrameUp editor: "Remove background" on each photo in the Photos panel.
//
//   - /api/remove-bg asks a cut-out model (default: OpenAI gpt-image-1-mini
//     with a transparent background, using the server's OPENAI_API_KEY; Bria
//     and the Vercel AI Gateway are optional providers). Logged and capped
//     like every AI call; results are kept for this session per photo.
//   - LIKENESS: a generative model redraws pixels, so its version of a real
//     athlete's face, jersey or logos may differ. The editor never shows it.
//     It uses ONLY the returned image's alpha as a mask, scaled back onto the
//     ORIGINAL photo's own pixels, and first checks that the mask lines up
//     (coverage, spill into the padding, colour agreement under the mask).
//     A mask that fails falls back to the free tool below, or says it
//     couldn't cut this one out cleanly.
//   - Without a key, the button says it isn't set up (naming the env var) and
//     offers the free "plain backdrop" tool when the photo suits it: a flood
//     fill from the edges that runs fully in the browser (no model download).
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
  // Neutral grey for the padding around the photo sent to the model.
  const PAD_GREY = 128;

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

  // ─── Model mask on the original photo ────────────────────────────────
  // The model only takes 1024x1024, 1024x1536 or 1536x1024. The photo is
  // fitted (never cropped) into the closest one, centred on grey padding, so
  // the returned mask maps back to the photo with a plain rectangle.
  function padPlan(width, height) {
    const ratio = width / height;
    const [cw, ch] = ratio < 0.83 ? [1024, 1536] : ratio > 1.2 ? [1536, 1024] : [1024, 1024];
    const scale = Math.min(cw / width, ch / height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    return { size: `${cw}x${ch}`, width: cw, height: ch, region: { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w, h } };
  }

  // Alpha from the model's RGBA (already scaled to the photo's size), with
  // near-0/near-255 snapped clean and a 3x3 soften on the edge only.
  function maskFromModel(rgba, width, height) {
    const total = width * height;
    const raw = new Uint8ClampedArray(total);
    for (let p = 0; p < total; p++) {
      const a = rgba[p * 4 + 3];
      raw[p] = a < 10 ? 0 : a > 245 ? 255 : a;
    }
    const alpha = new Uint8ClampedArray(total);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = raw[p];
        let edge = false;
        if (x > 0 && raw[p - 1] !== v) edge = true;
        else if (x < width - 1 && raw[p + 1] !== v) edge = true;
        else if (y > 0 && raw[p - width] !== v) edge = true;
        else if (y < height - 1 && raw[p + width] !== v) edge = true;
        if (!edge) { alpha[p] = v; continue; }
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += raw[yy * width + xx];
            count++;
          }
        }
        alpha[p] = Math.round(sum / count);
      }
    }
    return alpha;
  }

  // Share of the grey padding (outside the photo) the model made opaque. A
  // model that moved or rescaled the subject paints into the padding.
  function paddingSpill(rgba, width, height, region) {
    let padding = 0;
    let opaque = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) continue;
        padding++;
        if (rgba[(y * width + x) * 4 + 3] > 128) opaque++;
      }
    }
    return padding ? opaque / padding : 0;
  }

  function maskBox(alpha, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[y * width + x] <= 128) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // Is this mask safe to put on the original? Checks:
  //   coverage: not (nearly) empty or (nearly) everything;
  //   spill:    the model didn't paint into the padding (moved/rescaled);
  //   colour:   under the mask, the model's pixels still look like the
  //             original's (same subject in the same place): low mean
  //             difference AND few clearly different pixels. A model that
  //             redrew or shifted the person disagrees here.
  //   box:      the kept area isn't a sliver.
  function checkMask({ alpha, modelRgba, originalRgba, width, height, spill = 0 }, limits = {}) {
    const { minCoverage = 0.03, maxCoverage = 0.97, maxSpill = 0.04, maxColorDiff = 48, maxMismatch = 0.2, minBoxShare = 0.02 } = limits;
    const total = width * height;
    let sum = 0;
    for (let p = 0; p < total; p++) sum += alpha[p];
    const coverage = sum / (255 * total);
    const box = maskBox(alpha, width, height);
    const step = Math.max(1, Math.floor(Math.sqrt(total / 40000)));
    let diff = 0;
    let samples = 0;
    let mismatched = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const p = y * width + x;
        if (alpha[p] < 220) continue;
        const i = p * 4;
        const d = (Math.abs(modelRgba[i] - originalRgba[i]) + Math.abs(modelRgba[i + 1] - originalRgba[i + 1]) + Math.abs(modelRgba[i + 2] - originalRgba[i + 2])) / 3;
        diff += d;
        if (d > 40) mismatched++;
        samples++;
      }
    }
    const colorDiff = samples ? diff / samples : 255;
    // Share of kept pixels that clearly disagree with the photo (a moved or
    // redrawn subject), so a partly shifted mask isn't averaged away.
    const mismatch = samples ? mismatched / samples : 1;
    const boxShare = box ? (box.w * box.h) / total : 0;
    const stats = { coverage, spill, colorDiff, mismatch, box, boxShare };
    if (coverage < minCoverage || !box) return { ok: false, reason: 'empty', ...stats };
    if (coverage > maxCoverage) return { ok: false, reason: 'full', ...stats };
    if (spill > maxSpill) return { ok: false, reason: 'misaligned', ...stats };
    if (boxShare < minBoxShare) return { ok: false, reason: 'empty', ...stats };
    if (colorDiff > maxColorDiff || mismatch > maxMismatch) return { ok: false, reason: 'redrawn', ...stats };
    return { ok: true, reason: '', ...stats };
  }

  // The original's own pixels, with the mask as alpha. Never the model's RGB.
  function applyMask(originalRgba, alpha) {
    const out = new Uint8ClampedArray(originalRgba);
    for (let p = 0; p < alpha.length; p++) out[p * 4 + 3] = Math.min(out[p * 4 + 3], alpha[p]);
    return out;
  }

  const api = { MAX_UPLOAD_BYTES, MAX_SEND_BASE64, MAX_SEND_SIDE, PAD_GREY, edgeStats, plainBackdropMask, scaledSize, base64Bytes, padPlan, maskFromModel, paddingSpill, maskBox, checkMask, applyMask };

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

  // { configured, envVar } from the server, asked once per page load.
  function serviceStatus(token) {
    if (!statusPromise) {
      statusPromise = fetch('/api/remove-bg', { headers: { Authorization: `Bearer ${token}` } })
        .then(response => (response.ok ? response.json() : { configured: false }))
        .then(body => ({ configured: body?.configured === true, envVar: String(body?.envVar || 'OPENAI_API_KEY') }))
        .catch(() => ({ configured: false, envVar: 'OPENAI_API_KEY' }));
      // A failed check is asked again next time (the network may be back).
      statusPromise.then(result => { if (!result.configured) setTimeout(() => { statusPromise = null; }, 30000); });
    }
    return statusPromise;
  }

  const CROSS_SITE = 'This photo comes from another site, so it can’t be processed. Download it and upload it instead.';

  // Sends the photo, padded to the model's size, and turns the answer into a
  // cut-out of the ORIGINAL photo (mask only). Returns { ok, image } or
  // { ok: false, reason, stats }.
  async function removeWithModel(image, token) {
    const original = drawToCanvas(image, MAX_SEND_SIDE);
    const width = original.canvas.width;
    const height = original.canvas.height;
    let originalPixels;
    try {
      originalPixels = original.ctx.getImageData(0, 0, width, height);
    } catch (error) {
      throw new Error(CROSS_SITE);
    }
    const plan = padPlan(width, height);
    const padded = document.createElement('canvas');
    padded.width = plan.width;
    padded.height = plan.height;
    const pctx = padded.getContext('2d');
    pctx.fillStyle = `rgb(${PAD_GREY}, ${PAD_GREY}, ${PAD_GREY})`;
    pctx.fillRect(0, 0, plan.width, plan.height);
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(original.canvas, plan.region.x, plan.region.y, plan.region.w, plan.region.h);
    const dataUrl = padded.toDataURL('image/jpeg', 0.9);
    if (dataUrl.length > MAX_SEND_BASE64) throw new Error('That photo is too large to send. Try a smaller one.');

    const response = await fetch('/api/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: dataUrl, size: plan.size }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok || !body.dataUrl) {
      const error = new Error(body.error || 'The background could not be removed. Try again in a moment.');
      error.reason = body.reason || '';
      error.envVar = body.envVar || '';
      throw error;
    }
    const modelImage = await loadImage(body.dataUrl);
    // The model may answer at another resolution: map the plan onto it.
    const sx = (modelImage.naturalWidth || plan.width) / plan.width;
    const sy = (modelImage.naturalHeight || plan.height) / plan.height;

    const full = document.createElement('canvas');
    full.width = plan.width;
    full.height = plan.height;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(modelImage, 0, 0, plan.width, plan.height);
    const spill = paddingSpill(fctx.getImageData(0, 0, plan.width, plan.height).data, plan.width, plan.height, plan.region);

    const fitted = document.createElement('canvas');
    fitted.width = width;
    fitted.height = height;
    const mctx = fitted.getContext('2d', { willReadFrequently: true });
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(modelImage, plan.region.x * sx, plan.region.y * sy, plan.region.w * sx, plan.region.h * sy, 0, 0, width, height);
    const modelRgba = mctx.getImageData(0, 0, width, height).data;
    const alpha = maskFromModel(modelRgba, width, height);
    const check = checkMask({ alpha, modelRgba, originalRgba: originalPixels.data, width, height, spill });
    if (!check.ok) return { ok: false, reason: check.reason, stats: check };
    originalPixels.data.set(applyMask(originalPixels.data, alpha));
    original.ctx.putImageData(originalPixels, 0, 0);
    return { ok: true, image: await loadImage(original.canvas.toDataURL('image/png')), stats: check };
  }

  async function removePlainBackdrop(image) {
    const { canvas, ctx } = drawToCanvas(image, PLAIN_MAX_SIDE);
    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      throw new Error(CROSS_SITE);
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

  function explainNotSetUp(tool, image, name, envVar = 'OPENAI_API_KEY') {
    const plain = plainCheck(image);
    const need = `The AI cut-out needs a key on the server (an admin adds ${envVar}).`;
    showEsDialog({
      title: 'Remove background isn’t set up yet',
      body: plain
        ? `${need} This photo has a plain backdrop, so the free in-browser tool can remove it now.`
        : `${need} The free in-browser tool only handles plain studio backdrops, and this photo’s backdrop is too busy for it.`,
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
        explainNotSetUp(tool, image, descriptor.name, status.envVar);
        return;
      }
      const result = await removeWithModel(image, token);
      if (!result.ok) {
        // The model's mask didn't line up with this photo: never guess.
        console.info('Remove background: mask rejected', result.reason, result.stats);
        if (plainCheck(image)) {
          await runPlain(tool, image, descriptor.name);
        } else {
          toast('Couldn’t cut this one out cleanly. Try another photo.', 'error');
        }
        return;
      }
      cutouts.set(image, result.image);
      isCutout.add(result.image);
      // Only apply if the slot still shows the photo we sent.
      if (getImageToolDescriptor(tool).image === image) {
        applyToSlot(tool, result.image, descriptor.name);
        toast('Background removed. Undo brings it back.', 'success');
      }
    } catch (error) {
      if (error.reason === 'off') {
        statusPromise = Promise.resolve({ configured: false, envVar: error.envVar || 'OPENAI_API_KEY' });
        explainNotSetUp(tool, image, descriptor.name, error.envVar || 'OPENAI_API_KEY');
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

  return Object.freeze({ ...api, removeBackground, removeWithModel, _cutouts: cutouts });
});
