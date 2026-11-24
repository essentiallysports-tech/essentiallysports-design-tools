/* Reels Studio: trend + inspiration radar (Reels 2.0, lane B).
   Pick a trend (with its ES fit and ES angle), see the official X clips that
   are doing well on it (ranked by views per hour, linked out, never embedded
   or stored), get an AI read of what is working, and hand "our version" to
   the ideas room. Inspiration is a style reference only, never a fact source:
   a brief travels as an editor's note, not as a source.

   Publishes ctx.modules.radar = { open({ trend }), close(), mount(el) }.
   Until the Start screen places it (mount), it opens as a dialog from a
   temporary "What's doing well" button under the trend list.

   Sample data (local preview): on localhost (or ?demo=reels off production) the
   panel uses reel-b-sample.js instead of the API, marked "Sample data", with no
   AI or network calls. ?demo=off turns it off.

   The pure helpers at the top also load in Node (scripts/test-reel-radar.mjs). */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ReelRadarCore = core;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const PRICES = { find: 0, analyze: 0.001, angles: 0.001 };
  const PROD_HOSTS = ['frameup.essentiallysports.com', 'essentiallysports-design-tools.vercel.app'];
  const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'College FB', mlb: 'MLB', golf: 'Golf', tennis: 'Tennis', nba: 'NBA', wnba: 'WNBA', nascar: 'NASCAR' };
  const LENS_LABEL = { 'fan-first': 'Fan first', 'quote-led': 'Quote led', verdict: 'Verdict', money: 'Money', 'fan-reaction': 'Fan reaction', 'behind-the-moment': 'Behind the moment' };
  const SOURCE_LABEL = { official: 'Team account', league: 'League account', media: 'Network' };

  function isDemo(loc) {
    if (!loc) return false;
    const params = new URLSearchParams(loc.search || '');
    const flag = params.get('demo');
    if (flag === 'off') return false;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(loc.hostname || '');
    if (local) return true;
    return flag === 'reels' && !PROD_HOSTS.includes(loc.hostname);
  }
  const fmtUsd = usd => { const n = Number(usd) || 0; if (n === 0) return '$0'; if (n < 0.001) return '<$0.001'; return n < 0.1 ? `$${(Math.round(n * 1000) / 1000).toFixed(3)}` : `$${n.toFixed(2)}`; };
  // 12400 -> "12k", 1250000 -> "1.3M"
  function compact(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  }
  const ageLabel = hours => (hours == null || !Number.isFinite(Number(hours)) ? '' : hours < 1 ? 'Just now' : hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`);
  const durationLabel = seconds => { const s = Math.round(Number(seconds) || 0); return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };
  // "1.2M views" / "900 likes" / "Views unknown": never a guess.
  function reachLabel(clip = {}) {
    if (Number(clip.views) > 0) return `${compact(clip.views)} views`;
    if (Number(clip.likes) > 0) return `${compact(clip.likes)} likes`;
    return 'Views unknown';
  }
  function speedLabel(clip = {}) {
    if (!(Number(clip.velocity) > 0)) return '';
    return Number(clip.views) > 0 ? `${compact(clip.velocity)} views an hour` : '';
  }
  // The hand-off to the ideas room: the story is the topic; a brief is only a note.
  function handoff({ trend = null, topic = '', sport = '', brief = null } = {}) {
    const steer = brief ? `Treatment idea (style only, not a fact): ${[brief.title, brief.brief].filter(Boolean).join('. ')}`.slice(0, 300) : '';
    return { topic: String(topic || (trend && trend.title) || '').slice(0, 600), trend: trend || null, sport: sport || (trend && trend.sport) || '', steer };
  }
  const fitLabel = fit => (Number.isFinite(Number(fit)) && fit !== null ? `ES fit ${Math.round(Number(fit))}` : '');
  return { PRICES, PROD_HOSTS, CLIP_SPORTS, SPORT_LABEL, LENS_LABEL, SOURCE_LABEL, isDemo, fmtUsd, compact, ageLabel, durationLabel, reachLabel, speedLabel, handoff, fitLabel };
}));

(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const C = window.ReelRadarCore;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
  const safeUrl = url => (/^https:\/\//.test(String(url || '')) ? String(url) : '');
  const SAMPLE_SRC = 'reel-b-sample.js?v=20261125-reels2b';
  const loadSample = () => {
    if (window.ReelSampleB) return Promise.resolve(window.ReelSampleB);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SAMPLE_SRC;
      s.onload = () => (window.ReelSampleB ? resolve(window.ReelSampleB) : reject(new Error('Sample data did not load.')));
      s.onerror = () => reject(new Error('Sample data did not load.'));
      document.head.append(s);
    });
  };
  async function post(path, body) {
    if (!window.ESAuth?.fetchWithAuth) throw new Error('Sign-in is still loading. Try again in a moment.');
    let response;
    try {
      response = await window.ESAuth.fetchWithAuth(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) { throw new Error('The radar’s server is not reachable.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const error = new Error(response.status === 401 ? 'Your sign-in expired. Refresh the page and try again.' : (data && data.error) || `Something went wrong (${response.status}). Try again.`);
      error.reason = data && data.reason;
      throw error;
    }
    return data;
  }

  function create(ctx) {
    const demo = C.isDemo(window.location);
    const state = {
      trends: [], trendsState: 'idle', // idle | loading | ready | error
      league: 'all', picked: null, topic: '', sport: 'nfl',
      find: 'idle', clips: null, findError: '', // idle | loading | done | error
      read: 'idle', analysis: null, readError: '', readMeta: null, // idle | loading | done | error
      angles: 'idle', demoState: 'live', run: 0,
    };
    let host = null;
    let dialog = null;
    let els = {};

    function shell() {
      host.classList.add('rb', 'rb-radar');
      host.innerHTML = `
        <header class="rb__head">
          <div>
            <p class="rb__eyebrow">Radar</p>
            <h2 class="rb__title" id="rb-radar-title">What's doing well</h2>
          </div>
          ${dialog ? `<button class="rb__close" type="button" id="rb-radar-close" aria-label="Close the radar">${X}</button>` : ''}
        </header>
        <p class="rb__lede">Pick a trending story to see the official X clips fans are watching, then make the ES version. Clips are for style only: facts come from your own sources.</p>
        ${demo ? `<div class="rb-demo" role="note">
          <span class="rb-demo__tag">Sample data</span>
          <span class="rb-demo__text">Local preview: made-up trends, accounts and clips. No AI or network calls.</span>
          <label class="rb-demo__pick"><span>Show</span>
            <select class="es-select es-select--sm" id="rb-radar-demo" aria-label="Preview state">
              <option value="live">Clips and AI read</option><option value="unknown">Views unknown</option><option value="free">Free read</option>
              <option value="empty">No clips</option><option value="unsupported">Sport not covered</option><option value="error">Error</option><option value="loading">Loading</option>
            </select></label>
        </div>` : ''}
        <div class="rb-radar__grid">
          <section class="rb-radar__pick" aria-labelledby="rb-radar-pick-title">
            <div class="rb-out__head"><h3 class="rb-out__title" id="rb-radar-pick-title">Trending now</h3>
              <label class="rb-radar__league"><span class="es-sr-only">League</span><select class="es-select es-select--sm" id="rb-radar-league" aria-label="League"></select></label></div>
            <ul class="rb-trends" id="rb-radar-trends" role="radiogroup" aria-label="Trending stories"></ul>
            <div class="rb-radar__angles" id="rb-radar-angles"></div>
            <form class="rb-form rb-radar__form" id="rb-radar-form" novalidate>
              <label class="es-field__label" for="rb-radar-topic">Or type a story</label>
              <div class="rb-form__row">
                <input class="es-input rb-radar__topic" id="rb-radar-topic" type="text" maxlength="160" autocomplete="off" placeholder="e.g. Admirals walk-off win" aria-describedby="rb-radar-cost">
                <select class="es-select" id="rb-radar-sport" aria-label="Sport"><option value="nfl">NFL</option><option value="cfb">College football</option><option value="mlb">MLB</option></select>
                <button class="es-btn es-btn--primary rb-form__go" type="submit" id="rb-radar-go">Find clips</button>
              </div>
              <p class="rb-cost" id="rb-radar-cost">${demo ? 'Sample data: no cost.' : 'Finding clips is free. Official team, league and network accounts on X only.'}</p>
            </form>
          </section>
          <section class="rb-radar__out" id="rb-radar-out" aria-live="polite" aria-labelledby="rb-radar-title"></section>
        </div>`;
      const $ = id => host.querySelector(`#${id}`);
      els = { trends: $('rb-radar-trends'), league: $('rb-radar-league'), angles: $('rb-radar-angles'), form: $('rb-radar-form'), topic: $('rb-radar-topic'), sport: $('rb-radar-sport'), go: $('rb-radar-go'), out: $('rb-radar-out'), close: $('rb-radar-close'), demoState: $('rb-radar-demo') };
      els.close?.addEventListener('click', close);
      els.league.addEventListener('change', () => { state.league = els.league.value; renderTrends(); });
      els.form.addEventListener('submit', event => {
        event.preventDefault();
        const topic = els.topic.value.trim();
        if (topic.length < 3 && !state.picked) { els.topic.focus(); state.find = 'error'; state.findError = 'Pick a trend or type a story first.'; renderOut(); return; }
        if (topic.length >= 3) { state.picked = null; state.topic = topic; state.sport = els.sport.value; renderTrends(); }
        find();
      });
      els.trends.addEventListener('click', event => {
        const row = event.target.closest('[data-trend]');
        if (!row) return;
        pick(state.trends.find(t => t.id === row.dataset.trend), { focus: true });
      });
      els.trends.addEventListener('keydown', event => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const rows = [...els.trends.querySelectorAll('[data-trend]')];
        const at = rows.indexOf(document.activeElement);
        if (at < 0) return;
        event.preventDefault();
        rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
      });
      els.angles.addEventListener('click', event => { if (event.target.closest('[data-angles]')) addAngles(); });
      els.out.addEventListener('click', event => {
        if (event.target.closest('[data-read]')) { read(); return; }
        if (event.target.closest('[data-retry]')) { find(); return; }
        const make = event.target.closest('[data-make]');
        if (make) makeOurs(make.dataset.make);
      });
      els.demoState?.addEventListener('change', () => { state.demoState = els.demoState.value; if (state.picked || state.topic) find(); });
      renderTrends();
      renderOut();
    }

    // ── Trends ───────────────────────────────────────────────────────────
    async function loadTrends() {
      if (state.trendsState === 'loading') return;
      const fromPage = Array.isArray(ctx.state.trends) ? ctx.state.trends : [];
      if (demo) {
        state.trendsState = 'loading';
        renderTrends();
        try { state.trends = (await loadSample()).trends(); state.trendsState = 'ready'; } catch (error) { state.trendsState = 'error'; }
        renderTrends();
        return;
      }
      if (fromPage.length) { state.trends = fromPage.map(t => ({ ...t })); state.trendsState = 'ready'; renderTrends(); return; }
      state.trendsState = 'loading';
      renderTrends();
      try { state.trends = (await ctx.api({ mode: 'trends' })).items || []; state.trendsState = 'ready'; } catch (error) { state.trendsState = 'error'; }
      renderTrends();
    }
    function visibleTrends() {
      return state.trends.filter(t => state.league === 'all' || t.sport === state.league).slice(0, 14);
    }
    function renderTrends() {
      if (!els.trends) return;
      const sports = [...new Set(state.trends.map(t => t.sport).filter(Boolean))];
      const wanted = ['all', ...sports];
      if ([...els.league.options].map(o => o.value).join() !== wanted.join()) {
        els.league.innerHTML = wanted.map(id => `<option value="${esc(id)}">${id === 'all' ? 'All sports' : esc(C.SPORT_LABEL[id] || id.toUpperCase())}</option>`).join('');
        els.league.value = wanted.includes(state.league) ? state.league : 'all';
      }
      els.trends.setAttribute('aria-busy', String(state.trendsState === 'loading'));
      if (state.trendsState === 'loading' || state.trendsState === 'idle') {
        els.trends.innerHTML = Array.from({ length: 4 }, () => '<li class="rb-trend is-skeleton"><span class="es-skeleton rb-sk rb-sk--a"></span><span class="es-skeleton rb-sk rb-sk--b"></span></li>').join('');
        els.angles.innerHTML = '';
        return;
      }
      if (state.trendsState === 'error') {
        els.trends.innerHTML = '<li class="es-error-state rb-state" role="alert"><p class="es-error-state__title">Trends did not load</p><p class="es-error-state__copy">Type a story below instead.</p></li>';
        els.angles.innerHTML = '';
        return;
      }
      const items = visibleTrends();
      if (!items.length) {
        els.trends.innerHTML = '<li class="es-empty rb-state"><p class="es-empty__title">No fresh stories here</p><p class="es-empty__copy">Try another league, or type a story below.</p></li>';
        els.angles.innerHTML = '';
        return;
      }
      const tab = items.some(t => t.id === state.picked?.id) ? state.picked.id : items[0].id;
      els.trends.innerHTML = items.map(t => {
        const on = state.picked?.id === t.id;
        const fit = C.fitLabel(t.fit);
        const meta = [C.SPORT_LABEL[t.sport] || '', t.publishedAt ? C.ageLabel((Date.now() - new Date(t.publishedAt).getTime()) / 3600e3) : ''].filter(Boolean).join(' · ');
        const angle = t.angle && t.angle.line ? `<span class="rb-trend__angle"><span class="rb-lens rb-lens--${esc(t.angle.lens)}">${esc(C.LENS_LABEL[t.angle.lens] || 'ES angle')}</span>${esc(t.angle.line)}</span>` : '';
        return `<li role="none"><button class="rb-trend" type="button" role="radio" aria-checked="${on}" tabindex="${t.id === tab ? 0 : -1}" data-trend="${esc(t.id)}">
          <span class="rb-trend__title">${esc(t.title)}</span>
          <span class="rb-trend__meta"><span>${esc(meta)}</span>${fit ? `<span class="es-badge ${Number(t.fit) >= 75 ? 'es-badge--good' : 'es-badge--ink'}">${esc(fit)}</span>` : ''}${C.CLIP_SPORTS.includes(t.sport) ? '' : '<span class="es-badge">No clip search</span>'}</span>
          ${angle}
        </button></li>`;
      }).join('');
      const missing = items.filter(t => !t.angle).length;
      const busy = state.angles === 'loading';
      els.angles.innerHTML = missing && !demo
        ? `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-angles ${busy ? 'disabled' : ''}>${busy ? 'Adding ES angles…' : 'Add ES angles'}</button><span class="rb-note">${state.angles === 'error' ? 'ES angles are unavailable right now.' : `For the top stories here. About ${C.fmtUsd(C.PRICES.angles)}.`}</span>`
        : '';
    }
    // The ES angle of the top stories: Trends' own enrichment (one light AI call, cached 6 hours).
    async function addAngles() {
      const batch = visibleTrends().filter(t => !t.angle).slice(0, 6);
      if (!batch.length || state.angles === 'loading') return;
      state.angles = 'loading';
      renderTrends();
      try {
        const data = await post('/api/trend-design', { mode: 'enrich', items: batch.map(t => ({ id: t.id, title: t.title, related: (t.related || []).map(r => r.title), sport: C.SPORT_LABEL[t.sport] || '' })) });
        let added = 0;
        state.trends.forEach(t => { const hit = data.items && data.items[t.id]; if (hit && hit.angle) { t.angle = hit.angle; t.why = hit.why || t.why; added += 1; } });
        state.angles = added ? 'idle' : 'error';
      } catch (error) { state.angles = 'error'; }
      renderTrends();
    }
    function pick(trend, { focus = false } = {}) {
      if (!trend) return;
      state.picked = trend;
      state.topic = trend.title;
      state.sport = trend.sport;
      if (els.topic) els.topic.value = '';
      renderTrends();
      if (focus) els.trends.querySelector(`[data-trend="${CSS.escape(trend.id)}"]`)?.focus({ preventScroll: true });
      find();
    }

    // ── Clips ────────────────────────────────────────────────────────────
    async function find() {
      const run = ++state.run;
      state.find = 'loading';
      state.clips = null;
      state.findError = '';
      state.read = 'idle';
      state.analysis = null;
      renderOut();
      try {
        let data;
        if (demo) {
          const sample = await loadSample();
          await new Promise(resolve => setTimeout(resolve, state.demoState === 'loading' ? 600000 : 300));
          if (state.demoState === 'error') throw new Error('The radar is unavailable right now. Try again in a moment.');
          data = sample.radarFind({ topic: state.topic, sport: state.sport, state: state.demoState });
        } else {
          data = await post('/api/reel-radar', { mode: 'find', topic: state.topic, sport: state.sport, trend: state.picked ? { id: state.picked.id, title: state.picked.title, sport: state.picked.sport } : null });
        }
        if (run !== state.run) return;
        state.clips = data;
        state.find = 'done';
      } catch (error) {
        if (run !== state.run) return;
        state.find = 'error';
        state.findError = error && error.message ? error.message : 'The radar is unavailable right now. Try again in a moment.';
      }
      renderOut();
    }
    async function read() {
      const clips = state.clips && state.clips.clips;
      if (!clips || !clips.length || state.read === 'loading') return;
      const run = state.run;
      state.read = 'loading';
      state.readError = '';
      renderOut();
      try {
        let data;
        if (demo) {
          const sample = await loadSample();
          await new Promise(resolve => setTimeout(resolve, 300));
          data = sample.radarAnalysis({ state: state.demoState });
        } else {
          data = await post('/api/reel-radar', { mode: 'analyze', topic: state.topic, sport: state.sport, clips: clips.map(({ id, handle, caption, views, likes, ageHours, duration, velocity, source }) => ({ id, handle, caption, views, likes, ageHours, duration, velocity, source })) });
        }
        if (run !== state.run) return;
        state.analysis = data.analysis;
        state.readMeta = { ai: Boolean(data.ai), cost: data.cost || {}, reason: data.reason || '' };
        state.read = 'done';
      } catch (error) {
        if (run !== state.run) return;
        state.read = 'error';
        state.readError = error && error.message ? error.message : "The AI couldn't read these clips right now.";
      }
      renderOut();
    }
    function makeOurs(index) {
      const brief = index === 'story' ? null : (state.analysis && state.analysis.briefs[Number(index)]) || null;
      const ideas = ctx.modules.ideas;
      if (!ideas) { ctx.toast('The ideas room is still loading. Try again in a moment.', { tone: 'error' }); return; }
      const payload = C.handoff({ trend: state.picked, topic: state.topic, sport: state.sport, brief });
      ctx.emit('radar-handoff', { lens: brief ? brief.lens : '', sport: payload.sport, clips: state.clips ? state.clips.clips.length : 0 });
      close();
      ideas.open(payload);
    }

    const clipHtml = clip => {
      const url = safeUrl(clip.url);
      // https, or (sample data only) a same-site image file name.
      const thumb = safeUrl(clip.thumb) || (demo && /^[\w-]+\.(?:webp|png|jpg)$/.test(String(clip.thumb || '')) ? clip.thumb : '');
      const stats = [C.reachLabel(clip), C.ageLabel(clip.ageHours), C.durationLabel(clip.duration)].filter(Boolean);
      const speed = C.speedLabel(clip);
      return `<li class="rb-clip">
        <a class="rb-clip__thumb" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open the clip by @${esc(clip.handle)} on X">
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="rb-clip__nothumb">No preview</span>'}
          <span class="rb-clip__id">${esc(clip.id)}</span>${clip.older ? '<span class="rb-clip__older">Older</span>' : ''}
        </a>
        <div class="rb-clip__body">
          <p class="rb-clip__by">@${esc(clip.handle)}<span>${esc(clip.sourceLabel || C.SOURCE_LABEL[clip.source] || '')}</span></p>
          <p class="rb-clip__caption">${esc(clip.caption || 'No caption')}</p>
          <p class="rb-clip__stats${clip.viewsKnown || clip.likes ? '' : ' is-unknown'}">${stats.map(esc).join(' · ')}</p>
          ${speed ? `<p class="rb-clip__speed">${esc(speed)}</p>` : ''}
          <a class="rb-clip__link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open on X ${OUT}</a>
        </div>
      </li>`;
    };
    function readHtml() {
      if (state.read === 'idle') {
        return `<div class="rb-read rb-read--idle">
          <div><h3 class="rb-out__title">What's working here?</h3>
          <p class="rb-note">The AI reads the captions, lengths and how fast the views came. It cannot watch the videos. ${demo ? 'Sample data: no cost.' : `About ${C.fmtUsd(C.PRICES.analyze)} a read.`}</p></div>
          <button class="es-btn" type="button" data-read>Read these clips</button>
        </div>`;
      }
      if (state.read === 'loading') return '<div class="rb-read" aria-busy="true"><h3 class="rb-out__title">Reading the clips…</h3><span class="es-skeleton rb-sk rb-sk--b"></span><span class="es-skeleton rb-sk rb-sk--c"></span></div>';
      if (state.read === 'error') return `<div class="rb-read"><div class="es-error-state rb-state" role="alert"><p class="es-error-state__title">The read did not work</p><p class="es-error-state__copy">${esc(state.readError)}</p><button class="es-btn" type="button" data-read>Try again</button></div></div>`;
      const a = state.analysis || { patterns: [], briefs: [] };
      const meta = state.readMeta || {};
      const label = !meta.ai ? '<span class="es-badge es-badge--warn">Free read</span>' : '';
      const spent = demo ? 'Sample data: no cost.' : !meta.ai ? 'Counted from the clips, with no AI: no cost.' : meta.cost.cached ? 'From the last 30 minutes: no cost.' : `This read cost ${C.fmtUsd(meta.cost.usd)}.`;
      const patterns = a.patterns.length
        ? `<ul class="rb-patterns">${a.patterns.map(p => `<li><span class="rb-patterns__label">${esc(p.label)}</span><span>${esc(p.detail)}${(p.clips || []).length ? ` <span class="rb-patterns__refs">${p.clips.map(esc).join(', ')}</span>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="rb-note">No clear pattern in these clips.</p>';
      const briefs = a.briefs.map((b, i) => `<li class="rb-brief">
          <div class="rb-angle__top"><span class="rb-lens rb-lens--${esc(b.lens)}">${esc(C.LENS_LABEL[b.lens] || 'Our version')}</span>${b.free ? '<span class="es-badge es-badge--warn">Free draft</span>' : ''}</div>
          <h4 class="rb-brief__title">${esc(b.title)}</h4>
          ${b.hook ? `<p class="rb-brief__hook">${esc(b.hook)}</p>` : ''}
          <p class="rb-brief__text">${esc(b.brief)}</p>
          <button class="es-btn" type="button" data-make="${i}">Make our version</button>
        </li>`).join('');
      return `<div class="rb-read">
        <div class="rb-out__head"><h3 class="rb-out__title">What's working ${label}</h3><span class="rb-note">${esc(spent)}</span></div>
        ${a.read ? `<p class="rb-read__lede">${esc(a.read)}</p>` : ''}
        ${patterns}
        <p class="rb-note">Read from captions, lengths and view speed only. The AI did not watch the videos.</p>
        <h3 class="rb-out__title rb-read__ours">Our version</h3>
        <ul class="rb-briefs">${briefs}</ul>
      </div>`;
    }
    function renderOut() {
      if (!els.out) return;
      const busy = state.find === 'loading';
      els.go.disabled = busy;
      els.go.textContent = busy ? 'Finding…' : 'Find clips';
      els.out.setAttribute('aria-busy', String(busy));
      if (state.find === 'idle') {
        els.out.innerHTML = '<div class="es-empty rb-state"><p class="es-empty__title">Pick a story</p><p class="es-empty__copy">Choose a trend on the left, or type a story, to see the clips that are doing well on it.</p></div>';
        return;
      }
      if (busy) {
        els.out.innerHTML = `<p class="rb-note rb-loading">Looking for official clips on “${esc(state.topic)}”…</p>
          <ul class="rb-clips" aria-hidden="true">${Array.from({ length: 4 }, () => '<li class="rb-clip is-skeleton"><span class="es-skeleton rb-sk rb-sk--thumb"></span><span class="es-skeleton rb-sk rb-sk--b"></span></li>').join('')}</ul>`;
        return;
      }
      if (state.find === 'error') {
        els.out.innerHTML = `<div class="es-error-state rb-state" role="alert"><p class="es-error-state__title">Clips did not load</p><p class="es-error-state__copy">${esc(state.findError)}</p><button class="es-btn" type="button" data-retry>Try again</button></div>`;
        return;
      }
      const data = state.clips;
      const story = `<div class="rb-story"><div><p class="rb__eyebrow">${esc(C.SPORT_LABEL[state.sport] || 'Story')}</p><h3 class="rb-story__title">${esc(state.topic)}</h3>
        ${state.picked && state.picked.angle ? `<p class="rb-trend__angle"><span class="rb-lens rb-lens--${esc(state.picked.angle.lens)}">${esc(C.LENS_LABEL[state.picked.angle.lens] || 'ES angle')}</span>${esc(state.picked.angle.line)}</p>` : ''}</div>
        <button class="es-btn" type="button" data-make="story">Make our version</button></div>`;
      if (data.supported === false) {
        els.out.innerHTML = `${story}<div class="es-empty rb-state"><p class="es-empty__title">No clip search for this sport yet</p><p class="es-empty__copy">${esc(data.note || 'Clips can be found for NFL, college football and MLB right now.')} You can still make our version from ES articles.</p></div>`;
        return;
      }
      if (!data.clips.length) {
        els.out.innerHTML = `${story}<div class="es-empty rb-state"><p class="es-empty__title">No official clips yet</p><p class="es-empty__copy">${esc(data.note || 'No team, league or network account has posted a clip on this story.')} You can still make our version from ES articles.</p></div>`;
        return;
      }
      const ranking = data.ranking === 'views-per-hour' ? 'Ranked by views per hour' : 'Newest first';
      els.out.innerHTML = `${story}
        <div class="rb-out__head"><h3 class="rb-out__title">${data.clips.length} official clip${data.clips.length === 1 ? '' : 's'}</h3><span class="rb-note">${esc(ranking)}${data.cost && data.cost.cached ? ' · from the last 30 minutes' : ''}</span></div>
        ${data.note ? `<p class="rb-note">${esc(data.note)}</p>` : ''}
        <ul class="rb-clips">${data.clips.map(clipHtml).join('')}</ul>
        <p class="rb-note">Clips open on X. They are a style reference only: nothing here is used as a fact, and nothing is downloaded or stored.</p>
        ${readHtml()}`;
    }

    // ── Public API ───────────────────────────────────────────────────────
    function mount(el) {
      if (!el) return api;
      if (dialog) { dialog.close?.(); dialog.remove(); dialog = null; }
      document.getElementById('rb-entry-radar')?.remove();
      host = el;
      shell();
      loadTrends();
      return api;
    }
    function ensureDialog() {
      if (host) return;
      dialog = document.createElement('dialog');
      dialog.className = 'es-dialog rb-dialog rb-dialog--wide';
      dialog.setAttribute('aria-labelledby', 'rb-radar-title');
      dialog.innerHTML = '<div class="rb-dialog__body"></div>';
      (document.querySelector('.rm-page') || document.body).append(dialog);
      dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
      host = dialog.firstElementChild;
      shell();
    }
    function open(opts = {}) {
      ensureDialog();
      if (dialog && !dialog.open) dialog.showModal();
      else if (!dialog) host.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      const ready = state.trendsState === 'ready' && state.trends.length ? Promise.resolve() : loadTrends();
      const trend = opts.trend && opts.trend.title ? opts.trend : null;
      Promise.resolve(ready).then(() => {
        if (!trend) return;
        const known = state.trends.find(t => t.id === trend.id) || trend;
        if (!state.trends.some(t => t.id === known.id)) state.trends.unshift(known);
        pick(known);
      });
      return api;
    }
    function close() {
      if (dialog && dialog.open) dialog.close();
    }
    const api = { open, close, mount, state: () => ({ ...state }) };
    return api;
  }

  // The temporary entry button, until the Start screen places the panel.
  function addEntry(ctx, api) {
    const anchor = document.getElementById('rm-trends-note');
    if (!anchor || document.getElementById('rb-entry-radar')) return;
    let row = document.getElementById('rb-entry');
    if (!row) {
      row = document.createElement('div');
      row.id = 'rb-entry';
      row.className = 'rb-entry';
      anchor.after(row);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'rb-entry-radar';
    button.className = 'es-btn es-btn--tertiary es-btn--sm';
    button.textContent = "What's doing well";
    button.addEventListener('click', () => api.open({ trend: ctx.state.trend || null }));
    row.append(button);
  }

  function start(ctx) {
    if (!ctx || ctx.modules.radar) return;
    const api = create(ctx);
    ctx.register('radar', api);
    addEntry(ctx, api);
  }
  if (window.ReelMakerCtx) start(window.ReelMakerCtx);
  else document.addEventListener('reelmaker:ready', event => start(event.detail && event.detail.ctx), { once: true });
}());
