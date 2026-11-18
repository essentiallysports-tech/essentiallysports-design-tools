// FrameUp asset service, browser side (Generate's Creative composer).
//
//   FrameUpAssets.generateBackground({ prompt, style, palette, size, seed, quality, space, sport, avoid, referenceUrl })
//   FrameUpAssets.generateConceptArt({ concept, sport, palette, avoid, size, seed, quality, space })
//   FrameUpAssets.findPhotos({ person, team, sport, query, count, exclude })
//   FrameUpAssets.cutout({ imageUrl, source })  -> transparent PNG of the ORIGINAL photo
//   FrameUpAssets.prepareCutouts(plan.imagery.cutoutPlan, { max, timeoutMs, maxUsd }) -> { cutouts, cost }
//   FrameUpAssets.storeCutout({ sourceUrl, image })  -> shared store URL (reused by later runs at $0)
//   FrameUpAssets.status()
// All resolve to { ok, url | dataUrl, width, height, cost, cached, rights: { source, licence, aiGenerated } }
// (failures: { ok: false, reason, error }). They never throw.
//
// Cut-outs: the photo is padded to the model's size here, /api/gen-assets
// returns a mask, and only its ALPHA is put on the original pixels after the
// alignment checks in frameup-cutout.js (a generative model may redraw a real
// person's face; that drawing is never shown). Without a cut-out key, photos
// on a plain backdrop still cut out with the free in-browser flood fill.
// Results are cached for the page session.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpAssets = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const ENDPOINT = '/api/gen-assets';
  const ES_HOSTS = /^(?:image-cdn|www|www\.staging)\.essentiallysports\.com$|\.amazonaws\.com$/i;
  const session = new Map();
  const MAX_SESSION = 60;

  // ES photos load through the same-origin proxy so a canvas can read them.
  function toProxied(url) {
    const value = String(url || '');
    if (!/^https:\/\//i.test(value)) return value;
    try {
      return ES_HOSTS.test(new URL(value).hostname) ? `/api/es-image-search?image=${encodeURIComponent(value)}` : value;
    } catch (error) {
      return value;
    }
  }

  function stableKey(op, args) {
    const sorted = Object.keys(args || {}).sort().reduce((out, key) => { out[key] = args[key]; return out; }, {});
    return `${op}:${JSON.stringify(sorted)}`;
  }

  async function sessionToken() {
    const auth = root && root.ESAuth;
    try {
      const client = (await auth?.ensureSupabaseReady?.()) ? auth.getSupabaseClient() : null;
      const current = client ? (await client.auth.getSession()).data?.session : null;
      return current?.access_token || '';
    } catch (error) {
      return '';
    }
  }

  async function post(body, token) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || await sessionToken()}` },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) return { ok: false, reason: data.reason || (response.status === 404 ? 'off' : 'error'), error: data.error || 'The asset service is not available right now.', cost: Number(data.cost) || 0, status: response.status };
      return data;
    } catch (error) {
      return { ok: false, reason: 'network', error: 'The asset service could not be reached.', cost: 0 };
    }
  }

  // Same arguments in the same page session: the first answer, at no cost.
  async function cached(op, args, run) {
    const key = stableKey(op, args);
    if (session.has(key)) {
      const hit = await session.get(key);
      if (hit.ok) return { ...hit, cost: 0, cached: true };
      session.delete(key);
    }
    const promise = run();
    if (session.size >= MAX_SESSION) session.delete(session.keys().next().value);
    session.set(key, promise);
    const result = await promise;
    if (!result.ok) session.delete(key);
    return result;
  }

  const generateBackground = (args = {}) => cached('background', args, () => post({ op: 'background', ...args }));
  const generateConceptArt = (args = {}) => cached('concept', args, () => post({ op: 'concept', ...args }));
  const findPhotos = (args = {}) => cached('photos', args, () => post({ op: 'photos', ...args }));

  async function status() {
    try {
      const response = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${await sessionToken()}` } });
      return response.ok ? await response.json() : { images: false, cutout: false, photos: false };
    } catch (error) {
      return { images: false, cutout: false, photos: false };
    }
  }

  // ─── Cut-out (browser only) ───────────────────────────────────────────
  function cutoutLib() {
    if (root && root.FrameUpCutout) return root.FrameUpCutout;
    if (typeof require === 'function') {
      try { return require('./frameup-cutout.js'); } catch (error) { /* browser without the script */ }
    }
    return null;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:\/\//i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The photo could not be loaded.'));
      img.src = src;
    });
  }

  function canvasOf(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  async function runCutout({ imageUrl, source }) {
    const lib = cutoutLib();
    if (!lib || typeof document === 'undefined') return { ok: false, reason: 'client', error: 'Cut-outs need the browser and frameup-cutout.js.', cost: 0 };
    let image;
    try {
      image = await loadImage(toProxied(imageUrl));
    } catch (error) {
      return { ok: false, reason: 'load', error: error.message, cost: 0 };
    }
    const size = lib.scaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height, lib.MAX_SEND_SIDE);
    const original = canvasOf(size.width, size.height);
    original.ctx.imageSmoothingQuality = 'high';
    original.ctx.drawImage(image, 0, 0, size.width, size.height);
    let pixels;
    try {
      pixels = original.ctx.getImageData(0, 0, size.width, size.height);
    } catch (error) {
      return { ok: false, reason: 'cross-site', error: 'This photo comes from another site, so it can’t be cut out.', cost: 0 };
    }
    const rights = { source: source || 'ES image pool (original pixels; AI used only for the mask)', licence: 'As the source photo', aiGenerated: false };
    const finish = (alpha, extra) => {
      pixels.data.set(lib.applyMask(pixels.data, alpha));
      original.ctx.putImageData(pixels, 0, 0);
      return { ok: true, dataUrl: original.canvas.toDataURL('image/png'), width: size.width, height: size.height, rights, ...extra };
    };
    const plain = reasonFrom => {
      const result = lib.plainBackdropMask(pixels.data, size.width, size.height);
      return result.ok ? finish(result.alpha, { cost: 0, cached: false, method: 'plain-backdrop' }) : { ok: false, reason: reasonFrom, error: 'This photo could not be cut out cleanly.', cost: 0 };
    };

    const plan = lib.padPlan(size.width, size.height);
    const padded = canvasOf(plan.width, plan.height);
    padded.ctx.fillStyle = `rgb(${lib.PAD_GREY}, ${lib.PAD_GREY}, ${lib.PAD_GREY})`;
    padded.ctx.fillRect(0, 0, plan.width, plan.height);
    padded.ctx.imageSmoothingQuality = 'high';
    padded.ctx.drawImage(original.canvas, plan.region.x, plan.region.y, plan.region.w, plan.region.h);
    const sent = padded.canvas.toDataURL('image/jpeg', 0.9);
    if (sent.length > lib.MAX_SEND_BASE64) return { ok: false, reason: 'too-large', error: 'That photo is too large to send.', cost: 0 };

    const answer = await post({ op: 'cutout', image: sent, size: plan.size, source });
    if (!answer.ok) return answer.reason === 'off' ? plain('off') : answer;
    let mask;
    try {
      mask = await loadImage(answer.dataUrl);
    } catch (error) {
      return { ok: false, reason: 'error', error: 'The cut-out mask could not be read.', cost: answer.cost };
    }
    const sx = (mask.naturalWidth || plan.width) / plan.width;
    const sy = (mask.naturalHeight || plan.height) / plan.height;
    const full = canvasOf(plan.width, plan.height);
    full.ctx.drawImage(mask, 0, 0, plan.width, plan.height);
    const spill = lib.paddingSpill(full.ctx.getImageData(0, 0, plan.width, plan.height).data, plan.width, plan.height, plan.region);
    const fitted = canvasOf(size.width, size.height);
    fitted.ctx.imageSmoothingQuality = 'high';
    fitted.ctx.drawImage(mask, plan.region.x * sx, plan.region.y * sy, plan.region.w * sx, plan.region.h * sy, 0, 0, size.width, size.height);
    const modelRgba = fitted.ctx.getImageData(0, 0, size.width, size.height).data;
    const alpha = lib.maskFromModel(modelRgba, size.width, size.height);
    const check = lib.checkMask({ alpha, modelRgba, originalRgba: pixels.data, width: size.width, height: size.height, spill });
    if (!check.ok) {
      const fallback = plain(check.reason);
      return fallback.ok ? { ...fallback, cost: answer.cost } : { ...fallback, cost: answer.cost, stats: check };
    }
    return finish(alpha, { cost: answer.cost, cached: Boolean(answer.cached), method: 'model-mask', model: answer.model, stats: { coverage: check.coverage, colorDiff: check.colorDiff } });
  }

  const cutout = (args = {}) => cached('cutout', { imageUrl: String(args.imageUrl || ''), source: args.source || '' }, () => runCutout(args));

  // Keep a finished cut-out (a PNG of the ORIGINAL pixels) in the shared store,
  // named after its ES photo, so the next run on any server gets it at $0.
  const storeCutout = ({ sourceUrl, image } = {}) => post({ op: 'cutout-store', sourceUrl, image });

  // Generate imagery v3: make the cut-outs a Creative plan asks for
  // (plan.imagery.cutoutPlan: [{ fromPhoto, sourceUrl, person, path }]).
  // At most `max` (default 3) per run, in parallel, within `timeoutMs`
  // (default 25 s) and `maxUsd` (default $0.05: about 3-5 low-quality masks).
  // Resolves to { cutouts: [{ url, width, height, person, fromPhoto }], cost, made, failed }.
  // Never throws; whatever is not done in time is skipped (the design keeps its photo).
  async function prepareCutouts(items = [], { max = 3, timeoutMs = 25000, maxUsd = 0.05, store = true } = {}) {
    const list = (Array.isArray(items) ? items : []).filter(item => item && item.sourceUrl).slice(0, Math.max(0, max));
    const out = { cutouts: [], cost: 0, made: 0, failed: 0 };
    if (!list.length || typeof document === 'undefined') return out;
    let spent = 0;
    const one = async item => {
      if (spent >= maxUsd) { out.failed += 1; return; }
      const result = await cutout({ imageUrl: item.sourceUrl, source: 'ES photo (original pixels; AI used only for the mask)' });
      spent += Number(result.cost) || 0;
      out.cost += Number(result.cost) || 0;
      if (!result.ok || !result.dataUrl) { out.failed += 1; return; }
      out.made += 1;
      let url = result.dataUrl;
      if (store) {
        const kept = await storeCutout({ sourceUrl: item.sourceUrl, image: result.dataUrl });
        if (kept.ok && kept.url) url = kept.url;
      }
      out.cutouts.push({ url, width: result.width, height: result.height, person: item.person || '', fromPhoto: item.fromPhoto || toProxied(item.sourceUrl), dataUrl: result.dataUrl });
    };
    let timer;
    await Promise.race([
      Promise.all(list.map(item => one(item).catch(() => { out.failed += 1; }))),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
    out.cost = Number(out.cost.toFixed(5));
    return out;
  }

  return Object.freeze({ generateBackground, generateConceptArt, findPhotos, cutout, storeCutout, prepareCutouts, status, _test: { toProxied, stableKey, session } });
});
