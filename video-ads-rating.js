// Video Ads rating: browser helpers for /api/ad-rating. One file for the
// browser (window.VideoAdsRating) and Node tests (require), like frameup-rules.js.
//
//   framesFromCanvas(canvas, maxWidth?, quality?)  -> JPEG data URL (≤540px wide)
//   pickFrameTimes(duration, count?)                -> [seconds...] hook, middle, end
//   captureFrames(drawFrameAt, times, options?)     -> Promise<[dataUrl...]>
//   requestRating({ frames, context, ... })         -> Promise<result>
//   ratingPanelHtml(result)                         -> escaped HTML string
//   renderRatingPanel(container, result)            -> renders result / loading / error
//
// The score is a subjective creative assessment computed on the server from
// the model's factor ratings; it is not a performance forecast.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoAdsRating = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const ENDPOINT = '/api/ad-rating';
  const MAX_FRAMES = 4;

  const FACTOR_ORDER = ['headlineOffer', 'cta', 'readability55Plus', 'trust', 'stopScroll', 'audienceFit', 'simplicity', 'placementFit'];
  const FACTOR_LABELS = {
    headlineOffer: 'Headline / offer clarity',
    cta: 'CTA alignment / visibility',
    readability55Plus: '55+ readability',
    trust: 'Trust & credibility',
    stopScroll: 'Stop-scroll hook',
    audienceFit: 'Audience relevance',
    simplicity: 'Simplicity / cognitive load',
    placementFit: 'Placement fit',
  };
  const VERDICT_TONES = {
    'Launch a test': 'good',
    'Revise first': 'warn',
    Redesign: 'bad',
    'Policy review required': 'warn',
  };
  const NOTE = 'Subjective creative assessment, not a performance forecast.';

  const globalRoot = typeof self !== 'undefined' ? self : globalThis;
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const one = value => num(value).toFixed(1);

  // ── Frames ──────────────────────────────────────────────────────────────

  // A downscaled JPEG of the canvas as it is now. Works with a canvas
  // element or an OffscreenCanvas-like source that drawImage accepts.
  function framesFromCanvas(canvas, maxWidth = 540, quality = 0.8) {
    if (!canvas || !canvas.width || !canvas.height) throw new Error('framesFromCanvas needs a canvas with a size.');
    const scale = Math.min(1, maxWidth / canvas.width);
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // JPEG has no alpha: start from black so transparent areas don't turn grey.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);
    return out.toDataURL('image/jpeg', quality);
  }

  // Which moments to sample: the hook (inside the first second), the middle,
  // and near the end where the CTA has had time to land.
  function pickFrameTimes(duration, count = 3) {
    const d = Math.max(0, num(duration));
    const n = Math.max(1, Math.min(MAX_FRAMES, Math.round(num(count, 3))));
    if (!d) return [0];
    const first = Math.min(0.5, d / 4);
    const last = Math.max(first, d - Math.min(0.5, d / 4));
    if (n === 1) return [Math.round(first * 10) / 10];
    return Array.from({ length: n }, (_, i) => Math.round((first + ((last - first) * i) / (n - 1)) * 10) / 10);
  }

  // drawFrameAt(t) draws the full-size ad at time t (seconds) and resolves to
  // the canvas holding it (or resolves to nothing if options.canvas is used).
  async function captureFrames(drawFrameAt, times, options = {}) {
    if (typeof drawFrameAt !== 'function') throw new Error('captureFrames needs a drawFrameAt(t) function.');
    const list = (Array.isArray(times) ? times : []).slice(0, MAX_FRAMES);
    const frames = [];
    for (const t of list) {
      const drawn = await drawFrameAt(t);
      const canvas = drawn && drawn.width ? drawn : options.canvas;
      frames.push(framesFromCanvas(canvas, options.maxWidth || 540, options.quality || 0.8));
    }
    return frames;
  }

  // ── Request ─────────────────────────────────────────────────────────────

  // Posts frames + context. Uses ESAuth.fetchWithAuth (signed-in session)
  // unless a fetch function is passed. Resolves to the rating; rejects with
  // an Error carrying .status, .reason and a plain-English .message.
  async function requestRating({ frames, context, endpoint = ENDPOINT, fetchImpl, signal } = {}) {
    const doFetch = fetchImpl
      || (globalRoot.ESAuth && typeof globalRoot.ESAuth.fetchWithAuth === 'function' ? globalRoot.ESAuth.fetchWithAuth.bind(globalRoot.ESAuth) : null);
    if (!doFetch) throw new Error('Sign in to rate ads.');
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: (frames || []).slice(0, MAX_FRAMES), context: context || {} }),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const error = new Error((data && data.error) || 'Ad rating is unavailable right now. Try again in a moment.');
      error.status = response.status;
      error.reason = data && data.reason;
      throw error;
    }
    return data;
  }

  // ── Panel ───────────────────────────────────────────────────────────────

  function formatCost(cost) {
    const c = num(cost);
    if (!c) return '$0';
    return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`;
  }

  function factorRow(key, factor) {
    const rating = Math.min(10, Math.max(1, num(factor && factor.rating, 1)));
    const evidence = (factor && Array.isArray(factor.evidence) && factor.evidence[0]) || '';
    const label = (factor && factor.label) || FACTOR_LABELS[key] || key;
    const weight = factor && factor.weight ? `${num(factor.weight)}%` : '';
    return `<li class="va-rate-factor">
      <div class="va-rate-factor__head">
        <span class="va-rate-factor__name">${esc(label)}${weight ? ` <span class="va-rate-factor__weight">${esc(weight)}</span>` : ''}</span>
        <span class="va-rate-factor__value">${esc(one(rating))}</span>
      </div>
      <div class="va-rate-bar" role="meter" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${esc(rating)}" aria-label="${esc(`${label}: ${one(rating)} out of 10`)}"><span class="va-rate-bar__fill" style="width:${(rating * 10).toFixed(0)}%"></span></div>
      ${evidence ? `<p class="va-rate-factor__evidence">${esc(evidence)}</p>` : ''}
    </li>`;
  }

  function ratingPanelHtml(result) {
    if (!result) return '';
    if (result.loading) {
      return `<p class="va-rate-status">${esc(result.message || 'Rating the ad\u2026')}</p>`;
    }
    if (result.error || result.ok === false) {
      return `<p class="va-rate-status va-rate-status--error" role="alert">${esc(result.error || 'Ad rating is unavailable right now.')}</p>`;
    }
    const score = Math.min(10, Math.max(1, num(result.score, 1)));
    const verdict = String(result.verdict || '');
    const tone = VERDICT_TONES[verdict] || 'warn';
    const factors = result.factors || {};
    const caps = Array.isArray(result.caps) ? result.caps : [];
    const fixes = (Array.isArray(result.fixes) ? result.fixes : []).slice(0, 3);
    const confidence = String(result.confidence || '');
    return `<div class="va-rate-summary">
      <h3 class="va-rate-title">Ad rating</h3>
      <p class="va-rate-score"><span class="va-rate-score__value">${esc(one(score))}</span><span class="va-rate-score__max"> / 10</span></p>
      <p class="va-rate-verdict va-rate-verdict--${esc(tone)}">${esc(verdict)}</p>
    </div>
    ${caps.length ? `<section class="va-rate-section">
      <h4 class="va-rate-heading">Caps applied</h4>
      <ul class="va-rate-caps">${caps.map(c => `<li>${esc(c.reason)} <span class="va-rate-cap">max ${esc(one(c.cap))}</span></li>`).join('')}</ul>
    </section>` : ''}
    <section class="va-rate-section">
      <h4 class="va-rate-heading">Factors</h4>
      <ul class="va-rate-factors">${FACTOR_ORDER.filter(key => factors[key]).map(key => factorRow(key, factors[key])).join('')}</ul>
    </section>
    ${fixes.length ? `<section class="va-rate-section">
      <h4 class="va-rate-heading">Top fixes</h4>
      <ol class="va-rate-fixes">${fixes.map(fix => `<li><span class="va-rate-fix__change">${esc(fix.change)}</span>${fix.priority ? ` <span class="va-rate-tag">${esc(fix.priority)}</span>` : ''}${fix.performanceHypothesis ? `<span class="va-rate-fix__why">${esc(fix.performanceHypothesis)}</span>` : ''}</li>`).join('')}</ol>
    </section>` : ''}
    <p class="va-rate-meta">${confidence ? `Confidence: ${esc(confidence)}` : ''}${result.cost != null ? `${confidence ? ' \u00b7 ' : ''}Cost ${esc(formatCost(result.cost))}` : ''}</p>
    <p class="va-rate-note">${esc(NOTE)}</p>`;
  }

  // result: a rating, { loading: true, message? }, or { error }. The
  // container becomes a labelled, polite live region.
  function renderRatingPanel(container, result) {
    if (!container) return;
    container.classList.add('va-rate');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-busy', result && result.loading ? 'true' : 'false');
    if (!container.getAttribute('aria-label')) container.setAttribute('aria-label', 'Ad rating');
    container.innerHTML = ratingPanelHtml(result);
  }

  return {
    ENDPOINT,
    MAX_FRAMES,
    FACTOR_ORDER,
    FACTOR_LABELS,
    VERDICT_TONES,
    NOTE,
    escapeHtml: esc,
    formatCost,
    framesFromCanvas,
    pickFrameTimes,
    captureFrames,
    requestRating,
    ratingPanelHtml,
    renderRatingPanel,
  };
}));
