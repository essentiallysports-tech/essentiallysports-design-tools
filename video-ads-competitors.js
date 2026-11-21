/* Video Ads: Competitor ads. What other sports publishers and newsletters run
   on Facebook / Instagram (Meta's Ad Library, via /api/meta-ads), what looks
   like it works, what they are testing, and ideas for our newsletters that drop
   straight into the Copy step ("Use this idea", with Undo).
   Nothing is saved anywhere: results live in this tab (the server keeps a
   30-minute in-memory copy so a repeat check is free). The person's own extra
   quick picks are the only thing kept, in localStorage.
   Sample data (local preview): on localhost (or ?demo=ads off production) the
   panel uses video-ads-competitors-demo.js instead of the API, marked
   "Sample data", so every state can be seen without APIFY_TOKEN. ?demo=off
   turns it off locally. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VideoAdsCompetitors = api; if (typeof document !== 'undefined') api.boot(); }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // ─── Config (owner: edit freely) ──────────────────────────────────────────
  // A pick may carry a pageId (from the Page's Ad Library link) for an exact
  // match; without one the name is searched and the matching Page kept.
  const QUICK_PICKS = [
    { group: 'Sports publishers', items: [
      { label: 'The Athletic' }, { label: 'Front Office Sports' }, { label: 'Bleacher Report' }, { label: 'Barstool Sports' },
      { label: 'ESPN' }, { label: 'Yahoo Sports' }, { label: 'On3' }, { label: '247Sports' },
    ] },
    { group: 'Best-in-class newsletters', items: [
      { label: 'Morning Brew' }, { label: '1440' }, { label: 'The Hustle' },
    ] },
  ];
  const PER_RESULT_USD = 0.30 / 1000;
  const DEFAULT_LIMIT = 50;
  const STORE_KEY = 'frameup.va.competitorPicks.v1';
  const PROD_HOSTS = ['frameup.essentiallysports.com'];
  const ETA = { min: 30, max: 90 }; // seconds, a synchronous Apify run for ~50 ads

  // ─── Pure helpers (tested in scripts/test-meta-ads.mjs) ───────────────────
  const estimateCost = (limit = DEFAULT_LIMIT) => Math.round(Math.max(0, limit) * PER_RESULT_USD * 10000) / 10000;
  const fmtUsd = usd => { const n = Number(usd) || 0; if (n === 0) return '$0'; if (n < 0.001) return '<$0.001'; return n < 0.1 ? `$${(Math.round(n * 1000) / 1000).toFixed(3)}` : `$${n.toFixed(2)}`; };
  const daysLabel = d => (d == null || !Number.isFinite(Number(d)) ? 'Start date unknown' : Number(d) === 0 ? 'Started today' : Number(d) === 1 ? '1 day running' : `${Number(d)} days running`);
  function isDemo(loc) {
    if (!loc) return false;
    const params = new URLSearchParams(loc.search || '');
    const flag = params.get('demo');
    if (flag === 'off') return false;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(loc.hostname || '');
    if (local) return true;
    return flag === 'ads' && !PROD_HOSTS.includes(loc.hostname);
  }
  // An idea -> the Video Ads copy fields (highlight style), and its newsletter.
  function ideaToCopy(idea, brands = []) {
    const brand = brands.find(b => b.id === idea?.brand) || null;
    const headline = String(idea?.headline || '').trim();
    let highlight = String(idea?.highlight || '').trim();
    if (highlight && !headline.toLowerCase().includes(highlight.toLowerCase())) highlight = '';
    else if (highlight) { const at = headline.toLowerCase().indexOf(highlight.toLowerCase()); highlight = headline.slice(at, at + highlight.length); }
    const body = (Array.isArray(idea?.body) ? idea.body : [idea?.body]).map(p => String(p || '').trim()).filter(Boolean).slice(0, 3);
    while (body.length < 3) body.push('');
    const cta = String(idea?.cta || '').trim();
    return {
      brandId: brand ? brand.id : '',
      fields: { style: 'highlight', headline, highlight, body, cta: brand && cta.toUpperCase() === String(brand.cta || '').toUpperCase() ? '' : cta },
    };
  }
  const median = list => { const s = list.filter(n => Number.isFinite(n)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  function readPicks(storage) { try { const v = JSON.parse(storage?.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, 12) : []; } catch { return []; } }
  function writePicks(storage, list) { try { storage?.setItem(STORE_KEY, JSON.stringify(list.slice(0, 12))); return true; } catch { return false; } }

  // ─── The panel ────────────────────────────────────────────────────────────
  function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    const main = document.getElementById('main');
    const steps = document.querySelector('.va-steps');
    const work = document.querySelector('.va-work');
    if (!main || !steps || !work || document.getElementById('va-comp')) return;
    const B = window.VideoAdsBrands || { AD_BRANDS: [] };
    const demo = isDemo(window.location);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const I = {
      radar: svg('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>'),
      back: svg('<path d="m15 18-6-6 6-6"/>'),
      search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
      ext: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
      plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
      x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
      key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 7 3 3"/>'),
      alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
      image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
      video: svg('<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>'),
      carousel: svg('<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M2 7v10"/><path d="M22 7v10"/>'),
      text: svg('<path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/>'),
      spark: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
      empty: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8 11h6"/>'),
    };
    const MEDIA_LABEL = { video: 'Video', image: 'Image', carousel: 'Carousel', text: 'Text only' };

    const state = {
      open: false,
      status: demo ? 'ready' : 'checking', // checking | ready | not-set-up
      config: { capUsd: 4, estimateUsd: estimateCost(), configured: demo },
      query: '', country: 'US', includeStopped: false,
      run: null,            // { status: 'loading'|'done'|'error'|'empty'|'over-cap', started, error, data }
      analysis: null,       // { status: 'loading'|'done'|'error', data, error }
      section: 'working',
      picks: readPicks(window.localStorage),
      demoState: 'live',
    };
    let returnFocus = null;
    let tick = null;
    let runSeq = 0;

    // Entry button beside the steps.
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'es-btn es-btn--sm va-comp-entry';
    entry.id = 'va-comp-open';
    entry.setAttribute('aria-controls', 'va-comp');
    entry.setAttribute('aria-expanded', 'false');
    entry.title = 'See which ads competitors run on Facebook and Instagram';
    entry.innerHTML = `${I.radar}<span>Competitor ads</span>`;
    steps.append(entry);

    const view = document.createElement('section');
    view.className = 'va-comp';
    view.id = 'va-comp';
    view.hidden = true;
    view.setAttribute('aria-labelledby', 'va-comp-title');
    view.innerHTML = `
      <header class="va-comp__head">
        <div class="va-comp__intro">
          <h2 class="va-comp__title" id="va-comp-title" tabindex="-1">Competitor ads</h2>
          <p class="va-hint">See which ads sports publishers and newsletters run on Facebook and Instagram, what seems to work, and get ideas for our ads.</p>
        </div>
        <button class="es-btn es-btn--sm" type="button" id="va-comp-close">${I.back}<span>Back to your ad</span></button>
      </header>
      ${demo ? `<div class="va-comp__demo" id="va-comp-demo" role="note">
        <span class="va-comp__demo-tag">Sample data</span>
        <span class="va-comp__demo-text">Local preview: made-up brands and ads, no Apify or AI calls.</span>
        <label class="va-comp__demo-pick"><span>Show</span>
          <select class="va-input va-comp__select" id="va-comp-demo-state" aria-label="Preview state">
            <option value="live">Results</option><option value="loading">Loading</option><option value="empty">No ads found</option>
            <option value="error">Error</option><option value="over-cap">Over the weekly cap</option><option value="not-set-up">Not set up</option><option value="analysis-error">AI error</option>
          </select>
        </label>
      </div>` : ''}
      <div class="va-comp__setup" id="va-comp-setup" hidden></div>
      <form class="va-comp__search" id="va-comp-form" novalidate>
        <div class="va-field">
          <label class="va-label" for="va-comp-q">Brand, Facebook Page link or keyword</label>
          <div class="va-comp__row">
            <input class="va-input" id="va-comp-q" type="text" autocomplete="off" spellcheck="false" placeholder="${demo ? 'e.g. Sample Sports Daily' : 'e.g. Morning Brew or facebook.com/…'}" aria-describedby="va-comp-cost">
            <button class="es-btn es-btn--primary" type="submit" id="va-comp-check">${I.search}<span>Check</span></button>
          </div>
          <p class="va-hint va-comp__cost" id="va-comp-cost" aria-live="polite"></p>
        </div>
        <div class="va-comp__picks" id="va-comp-picks"></div>
        <div class="va-comp__opts">
          <label class="va-comp__country"><span class="va-hint">Country</span>
            <select class="va-input va-comp__select" id="va-comp-country" aria-label="Country">
              <option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option><option value="ALL">All countries</option>
            </select>
          </label>
          <label class="va-switch"><input type="checkbox" id="va-comp-stopped"><span class="va-switch__track" aria-hidden="true"></span><span>Include stopped ads <span class="va-comp__muted">(better “Not working” read)</span></span></label>
        </div>
      </form>
      <div class="va-comp__out" id="va-comp-out" aria-live="polite"></div>`;
    work.after(view);

    const $ = id => document.getElementById(id);
    const els = { form: $('va-comp-form'), q: $('va-comp-q'), check: $('va-comp-check'), cost: $('va-comp-cost'), picks: $('va-comp-picks'), out: $('va-comp-out'), setup: $('va-comp-setup'), country: $('va-comp-country'), stopped: $('va-comp-stopped'), close: $('va-comp-close'), demoState: $('va-comp-demo-state') };

    // Broken creative (expired CDN link, blocked image): a neutral tile instead.
    view.addEventListener('error', event => {
      const img = event.target;
      if (img?.tagName !== 'IMG' || !img.closest('.va-comp-ad__media')) return;
      const box = img.parentElement;
      img.remove();
      box.classList.add('is-empty');
      if (!box.querySelector('.va-comp-ad__ph')) box.insertAdjacentHTML('afterbegin', `<span class="va-comp-ad__ph">${I.image}<span>Preview unavailable</span></span>`);
    }, true);

    // ── Open / close ──
    function open({ focus = true } = {}) {
      if (state.open) return;
      returnFocus = document.activeElement;
      state.open = true;
      work.hidden = true;
      view.hidden = false;
      entry.setAttribute('aria-expanded', 'true');
      entry.classList.add('is-on');
      if (!demo && state.status === 'checking') loadStatus();
      render();
      if (focus) $('va-comp-title').focus();
      try { if (location.hash !== '#competitors') history.replaceState(null, '', '#competitors'); } catch { /* ignore */ }
    }
    function close({ focus = true } = {}) {
      if (!state.open) return;
      state.open = false;
      work.hidden = false;
      view.hidden = true;
      entry.setAttribute('aria-expanded', 'false');
      entry.classList.remove('is-on');
      try { if (location.hash === '#competitors') history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      if (focus) (returnFocus && returnFocus !== document.body && returnFocus.isConnected && returnFocus !== els.close ? returnFocus : entry).focus();
      window.dispatchEvent(new Event('resize')); // the stage re-measures its canvas
    }
    entry.addEventListener('click', () => (state.open ? close() : open()));
    els.close.addEventListener('click', () => close());
    // A step button (Copy / Clip / Export) goes back to the ad.
    steps.addEventListener('click', event => { if (state.open && event.target.closest('.va-step')) close({ focus: false }); });
    view.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.target.closest('select')) { event.preventDefault(); close(); }
    });
    if (location.hash === '#competitors') setTimeout(() => open({ focus: false }), 0);

    // ── API ──
    async function api(body) {
      if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { status: 0 });
      const response = await window.ESAuth.fetchWithAuth('/api/meta-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || `Something went wrong (${response.status}). Try again.`), { status: response.status, reason: data.reason, data });
      return data;
    }
    async function loadStatus() {
      try {
        const data = await api({ mode: 'status' });
        state.config = { capUsd: data.capUsd, estimateUsd: data.estimateUsd ?? estimateCost(), configured: Boolean(data.configured) };
        state.status = data.configured ? 'ready' : 'not-set-up';
      } catch (error) {
        state.status = 'ready'; // the check itself will explain
      }
      render();
    }
    const demoData = () => window.VideoAdsCompetitorsDemo;
    function loadDemo() {
      if (demoData()) return Promise.resolve(demoData());
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'video-ads-competitors-demo.js?v=20261121-compads';
        s.onload = () => (demoData() ? resolve(demoData()) : reject(new Error('Sample data did not load.')));
        s.onerror = () => reject(new Error('Sample data did not load.'));
        document.head.append(s);
      });
    }
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // ── Check ──
    async function runCheck(query) {
      const q = String(query ?? els.q.value).trim();
      if (!q) { showInputError('Type a brand name, a Facebook Page link or a keyword.'); return; }
      els.q.value = q;
      els.q.removeAttribute('aria-invalid');
      state.query = q;
      const seq = ++runSeq;
      state.run = { status: 'loading', started: Date.now(), query: q };
      state.analysis = null;
      state.section = 'working';
      render();
      startTick();
      try {
        let data;
        if (demo) {
          const D = await loadDemo();
          const mode = state.demoState;
          await wait(mode === 'loading' ? 600000 : 900);
          if (mode === 'error') throw Object.assign(new Error("The ad library check didn't work. Try again in a moment."), { status: 502, reason: 'apify' });
          if (mode === 'over-cap') throw Object.assign(new Error("This week's $4 budget for competitor checks is used up. Checks come back Monday; earlier results in this tab still work."), { status: 429, reason: 'over-cap' });
          if (mode === 'not-set-up') throw Object.assign(new Error("Competitor ads isn't set up yet. Ask an admin to add APIFY_TOKEN in Vercel to turn this on."), { status: 503, reason: 'not-set-up' });
          data = D.ads(q, { empty: mode === 'empty' });
        } else {
          data = await api({ mode: 'ads', query: q, country: state.country, status: state.includeStopped ? 'all' : 'active', limit: DEFAULT_LIMIT });
        }
        if (seq !== runSeq) return;
        state.run = { status: data.ads?.length ? 'done' : 'empty', data, query: q };
        stopTick();
        render();
        if (data.ads?.length) runAnalysis(data, seq);
      } catch (error) {
        if (seq !== runSeq) return;
        stopTick();
        if (error.reason === 'not-set-up') { state.status = 'not-set-up'; state.run = null; }
        else state.run = { status: ['over-cap', 'over-budget'].includes(error.reason) ? 'over-cap' : 'error', error: error.message, reason: error.reason, query: q };
        render();
      }
    }
    async function runAnalysis(data, seq) {
      state.analysis = { status: 'loading' };
      render();
      try {
        let result;
        if (demo) {
          const D = await loadDemo();
          await wait(700);
          if (state.demoState === 'analysis-error') throw new Error("The AI couldn't read these ads right now. The ads and counts above still work; try again in a moment.");
          result = D.analysis(data);
        } else {
          result = await api({ mode: 'analyze', target: data.matchedPage?.pageName || data.target?.label || state.query, ads: data.ads });
        }
        if (seq !== runSeq) return;
        state.analysis = { status: 'done', data: result };
      } catch (error) {
        if (seq !== runSeq) return;
        state.analysis = { status: 'error', error: error.message };
      }
      render();
    }
    function startTick() {
      stopTick();
      tick = setInterval(() => {
        const bar = $('va-comp-progress');
        const note = $('va-comp-elapsed');
        if (!bar || state.run?.status !== 'loading') { stopTick(); return; }
        const secs = Math.round((Date.now() - state.run.started) / 1000);
        bar.style.width = `${Math.min(95, (secs / ETA.max) * 100)}%`;
        note.textContent = secs < ETA.max ? `${secs} s so far · usually ${ETA.min}–${ETA.max} s` : `${secs} s so far · taking longer than usual`;
      }, 1000);
    }
    function stopTick() { if (tick) clearInterval(tick); tick = null; }
    function showInputError(message) {
      els.q.setAttribute('aria-invalid', 'true');
      els.cost.innerHTML = `<span class="va-comp__err">${esc(message)}</span>`;
      els.q.focus();
    }

    els.form.addEventListener('submit', event => { event.preventDefault(); if (state.status !== 'not-set-up' && state.run?.status !== 'loading') runCheck(); });
    els.q.addEventListener('input', () => { if (els.q.getAttribute('aria-invalid')) { els.q.removeAttribute('aria-invalid'); } renderCost(); renderPicks(); });
    els.country.addEventListener('change', () => { state.country = els.country.value; });
    els.stopped.addEventListener('change', () => { state.includeStopped = els.stopped.checked; });
    els.demoState?.addEventListener('change', () => {
      state.demoState = els.demoState.value;
      if (state.demoState === 'not-set-up') { state.status = 'not-set-up'; state.run = null; state.analysis = null; render(); return; }
      state.status = 'ready';
      if (state.run || state.demoState !== 'live') runCheck(state.query || 'Sample Sports Daily'); else render();
    });

    // Quick picks: config list + the person's own (localStorage).
    els.picks.addEventListener('click', event => {
      const add = event.target.closest('[data-pick-add]');
      if (add) {
        const q = els.q.value.trim();
        if (q && !state.picks.includes(q) && !QUICK_PICKS.some(g => g.items.some(i => i.label.toLowerCase() === q.toLowerCase()))) { state.picks = [...state.picks, q].slice(-12); writePicks(window.localStorage, state.picks); }
        renderPicks();
        els.q.focus();
        return;
      }
      const remove = event.target.closest('[data-pick-remove]');
      if (remove) { state.picks = state.picks.filter(p => p !== remove.dataset.pickRemove); writePicks(window.localStorage, state.picks); renderPicks(); els.q.focus(); return; }
      const pick = event.target.closest('[data-pick]');
      if (pick && state.status !== 'not-set-up' && state.run?.status !== 'loading') { els.q.value = pick.dataset.pick; runCheck(pick.dataset.pick); }
    });

    els.out.addEventListener('click', event => {
      const sec = event.target.closest('[data-comp-sec]');
      if (sec) { state.section = sec.dataset.compSec; renderResults(); $(`va-comp-tab-${state.section}`)?.focus(); return; }
      const adv = event.target.closest('[data-adv]');
      if (adv) { els.q.value = adv.dataset.adv; runCheck(adv.dataset.adv); return; }
      const use = event.target.closest('[data-use-idea]');
      if (use) { useIdea(Number(use.dataset.useIdea)); return; }
      if (event.target.closest('[data-comp-retry]')) { runCheck(state.query); return; }
      if (event.target.closest('[data-comp-reanalyze]') && state.run?.data) runAnalysis(state.run.data, runSeq);
    });
    els.out.addEventListener('keydown', event => {
      const tab = event.target.closest('[role="tab"][data-comp-sec]');
      if (!tab) return;
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const tabs = [...els.out.querySelectorAll('[role="tab"][data-comp-sec]')];
      let i = tabs.indexOf(tab) + keys[event.key];
      i = Math.max(0, Math.min(tabs.length - 1, keys[event.key] === -99 ? 0 : keys[event.key] === 99 ? tabs.length - 1 : (i + tabs.length) % tabs.length));
      state.section = tabs[i].dataset.compSec;
      renderResults();
      $(`va-comp-tab-${state.section}`)?.focus();
    });

    function useIdea(index) {
      const idea = state.analysis?.data?.analysis?.ideas?.[index];
      const page = window.VideoAdsPage;
      if (!idea || !page?.applyCopy) return;
      const { brandId, fields } = ideaToCopy(idea, B.AD_BRANDS || []);
      close({ focus: false });
      page.goStep?.('copy', { focus: false });
      if (brandId && page.state?.brandId !== brandId) document.querySelector(`#va-brands [data-brand="${brandId}"]`)?.click();
      page.applyCopy(fields, { label: 'Idea added to your copy' });
      try { window.FrameUpTrack?.track('generate', { tool: 'video-ads', action: 'competitor-idea', label: brandId }); } catch { /* best effort */ }
      document.getElementById('va-headline')?.focus();
    }

    // ── Render ──
    function render() {
      renderSetup();
      renderCost();
      renderPicks();
      renderResults();
      const loading = state.run?.status === 'loading';
      const off = state.status === 'not-set-up';
      els.check.disabled = loading || off;
      els.q.disabled = off;
      els.check.querySelector('span').textContent = loading ? 'Checking…' : 'Check';
      els.check.setAttribute('aria-busy', String(loading));
    }
    function renderSetup() {
      const off = state.status === 'not-set-up';
      els.setup.hidden = !off;
      els.setup.innerHTML = off ? `<div class="va-comp-state va-comp-state--setup" role="status">${I.key}<strong>Competitor ads isn’t set up yet</strong><span>Ask an admin to add APIFY_TOKEN in Vercel to turn this on. Everything else in Video Ads works as usual.</span></div>` : '';
    }
    function renderCost() {
      if (state.status === 'not-set-up') { els.cost.textContent = 'Checks are off until the key is added.'; return; }
      if (els.q.getAttribute('aria-invalid')) return;
      const est = state.config.estimateUsd ?? estimateCost();
      const cap = state.config.capUsd;
      const last = state.run?.status === 'done' || state.run?.status === 'empty' ? state.run.data?.cost : null;
      const lastText = last ? (last.cached ? ' · Last check: $0 (from the 30-minute cache)' : ` · Last check: ${fmtUsd(last.usd)} (${last.results} results)`) : '';
      els.cost.textContent = demo ? `Sample data: no cost${lastText ? ' · Last check: $0' : ''}` : `About ${fmtUsd(est)} per check (up to ${DEFAULT_LIMIT} ads) · Repeat checks within 30 minutes are free · Weekly limit $${cap}${lastText}`;
    }
    function renderPicks() {
      const off = state.status === 'not-set-up';
      const current = els.q.value.trim().toLowerCase();
      const chip = (label, own) => `<span class="va-comp-pick${own ? ' va-comp-pick--own' : ''}"><button class="es-chip" type="button" data-pick="${esc(label)}" aria-pressed="${String(current === label.toLowerCase())}" ${off ? 'disabled' : ''}>${esc(label)}</button>${own ? `<button class="va-comp-pick__x" type="button" data-pick-remove="${esc(label)}" aria-label="Remove ${esc(label)} from your picks" title="Remove">${I.x}</button>` : ''}</span>`;
      const demoGroup = demo ? [{ group: 'Sample brands', items: (demoData()?.brands || ['Sample Sports Daily', 'Sample Gridiron Brief', 'Sample Morning Letter']).map(label => ({ label })) }] : [];
      const canAdd = els.q.value.trim() && !state.picks.includes(els.q.value.trim());
      els.picks.innerHTML = [...demoGroup, ...QUICK_PICKS].map(g => `<div class="va-comp-picks__group"><span class="va-hint va-comp-picks__label">${esc(g.group)}</span><div class="va-chips">${g.items.map(i => chip(i.label, false)).join('')}</div></div>`).join('')
        + `<div class="va-comp-picks__group"><span class="va-hint va-comp-picks__label">Your picks</span><div class="va-chips">${state.picks.map(p => chip(p, true)).join('')}<button class="es-chip va-comp-pick__add" type="button" data-pick-add ${canAdd && !off ? '' : 'disabled'} title="Save what's in the box as a quick pick (this browser only)">${I.plus}<span>Save current</span></button></div></div>`;
    }

    const imgTag = (url, alt) => (url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
    function adCard(ad, note) {
      const media = MEDIA_LABEL[ad.mediaType] || 'Ad';
      const fresh = Number.isFinite(ad.daysRunning) && ad.daysRunning <= 7;
      const long = ad.daysRunning >= 30;
      const thumb = ad.thumbnailUrl ? imgTag(ad.thumbnailUrl, `${ad.pageName || 'Competitor'} ad creative`) : `<span class="va-comp-ad__ph">${I[ad.mediaType] || I.image}<span>${ad.mediaType === 'text' ? 'Text-only ad' : 'No preview'}</span></span>`;
      return `<article class="va-comp-ad">
        <div class="va-comp-ad__media${ad.thumbnailUrl ? '' : ' is-empty'}">${thumb}
          <span class="va-comp-badge va-comp-badge--media">${I[ad.mediaType] || ''}${esc(media)}${ad.cardCount > 1 ? ` · ${ad.cardCount}` : ''}</span>
        </div>
        <div class="va-comp-ad__body">
          <div class="va-comp-ad__meta">
            <span class="va-comp-ad__page">${esc(ad.pageName || 'Unknown page')}</span>
            <span class="va-comp-badge${long ? ' va-comp-badge--good' : fresh ? ' va-comp-badge--new' : ''}">${esc(daysLabel(ad.daysRunning))}${ad.isActive === false ? ' · stopped' : ''}</span>
          </div>
          ${ad.title ? `<p class="va-comp-ad__title">${esc(ad.title)}</p>` : ''}
          ${ad.body ? `<p class="va-comp-ad__text">${esc(ad.body)}</p>` : ''}
          ${note ? `<p class="va-comp-ad__note">${I.spark}<span>${esc(note)}</span></p>` : ''}
          <div class="va-comp-ad__foot">
            ${ad.ctaText ? `<span class="va-comp-cta">${esc(ad.ctaText)}</span>` : ''}
            ${ad.platforms?.length ? `<span class="va-comp-ad__plat">${esc(ad.platforms.join(' · '))}</span>` : ''}
          </div>
          <div class="va-comp-ad__actions">
            ${ad.adLibraryUrl ? `<a class="va-link" href="${esc(ad.adLibraryUrl)}" target="_blank" rel="noopener noreferrer">View in Ad Library${I.ext}<span class="va-sr"> (opens in a new tab)</span></a>` : ''}
            ${ad.linkDomain ? `<span class="va-comp-ad__domain" title="${esc(ad.linkUrl)}">${esc(ad.linkDomain)}</span>` : ''}
          </div>
        </div>
      </article>`;
    }
    function summaryStrip(data) {
      const s = data.summary || {};
      const m = s.media || {};
      const med = s.medianDays ?? median((data.ads || []).map(a => a.daysRunning));
      const tile = (value, label, hint) => `<div class="va-comp-stat"><span class="va-comp-stat__v">${esc(value)}</span><span class="va-comp-stat__l">${esc(label)}</span>${hint ? `<span class="va-sr">${esc(hint)}</span>` : ''}</div>`;
      return `<div class="va-comp-stats" role="group" aria-label="Summary">
        ${tile(s.total ?? data.ads.length, 'Ads')}
        ${tile(m.video || 0, 'Video')}
        ${tile(m.image || 0, 'Image')}
        ${tile(m.carousel || 0, 'Carousel')}
        ${tile(med == null ? '–' : `${med} d`, 'Median running', 'median days running')}
        ${tile(s.longRunning ?? 0, '30+ days')}
        ${tile(s.newThisWeek ?? 0, 'New this week')}
      </div>`;
    }
    function stateBox(kind, icon, title, text, action = '') {
      return `<div class="va-comp-state va-comp-state--${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${icon}<strong>${esc(title)}</strong><span>${esc(text)}</span>${action}</div>`;
    }

    function renderResults() {
      const run = state.run;
      if (state.status === 'not-set-up') { els.out.innerHTML = ''; return; }
      if (!run) {
        els.out.innerHTML = stateBox('idle', I.radar, 'Pick a competitor to start', 'Tap a quick pick or type a brand. FrameUp reads their live ads from Meta’s public Ad Library and sorts them into what’s working, what’s new and what to try.');
        return;
      }
      if (run.status === 'loading') {
        els.out.innerHTML = `<div class="va-comp-state va-comp-state--loading" role="status" aria-busy="true">
          <span class="va-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <strong>Checking ${esc(run.query)}’s ads…</strong>
          <span>Reading Meta’s Ad Library. Usually ${ETA.min}–${ETA.max} seconds; you can go back to your ad meanwhile.</span>
          <span class="va-comp-progress" aria-hidden="true"><span id="va-comp-progress"></span></span>
          <span class="va-hint" id="va-comp-elapsed">0 s so far · usually ${ETA.min}–${ETA.max} s</span>
        </div>`;
        return;
      }
      if (run.status === 'error') { els.out.innerHTML = stateBox('error', I.alert, 'That check didn’t work', run.error || 'Try again in a moment.', '<button class="es-btn es-btn--sm" type="button" data-comp-retry>Try again</button>'); return; }
      if (run.status === 'over-cap') { els.out.innerHTML = stateBox('cap', I.alert, 'Weekly limit reached', run.error); return; }
      const data = run.data;
      const advs = (data.advertisers || []).filter(a => a.pageName && a.pageId !== data.matchedPage?.pageId).slice(0, 6);
      const didYouMean = !data.matchedPage && data.target?.query && advs.length
        ? `<div class="va-comp-adv"><span class="va-hint">No Page called “${esc(data.target.query)}” in these results. Did you mean:</span><div class="va-chips">${advs.map(a => `<button class="es-chip" type="button" data-adv="${esc(a.pageName)}">${esc(a.pageName)}<span class="es-chip__count">${esc(a.adCount)}</span></button>`).join('')}</div></div>` : '';
      if (run.status === 'empty') {
        els.out.innerHTML = stateBox('empty', I.empty, `No live ads found for “${run.query}”`, 'They may not be advertising right now in this country. Try another spelling, their Facebook Page link, or turn on “Include stopped ads”.') + didYouMean;
        return;
      }
      const ads = data.ads || [];
      const byId = new Map(ads.map(a => [a.id, a]));
      const an = state.analysis;
      const A = an?.status === 'done' ? an.data.analysis : null;
      const counts = {
        working: A ? A.working.length : ads.filter(a => a.daysRunning >= 30).length,
        testing: A ? A.testing.length : ads.filter(a => Number.isFinite(a.daysRunning) && a.daysRunning <= 7).length,
        trends: A ? A.trends.length : null,
        notWorking: A ? A.notWorking.length : null,
        ideas: A ? A.ideas.length : null,
        all: ads.length,
      };
      const SECS = [['working', 'Working'], ['testing', 'Testing'], ['trends', 'Trends'], ['notWorking', 'Not working'], ['ideas', 'Ideas'], ['all', 'All ads']];
      const tabs = `<div class="va-comp-tabs" role="tablist" aria-label="Results">${SECS.map(([id, label]) => `<button class="es-tab va-comp-tab" type="button" role="tab" id="va-comp-tab-${id}" data-comp-sec="${id}" aria-selected="${String(state.section === id)}" aria-controls="va-comp-sec" tabindex="${state.section === id ? 0 : -1}">${esc(label)}${counts[id] != null ? `<span class="va-comp-tab__n">${counts[id]}</span>` : ''}</button>`).join('')}</div>`;
      const who = data.matchedPage ? `<a class="va-link" href="${esc(data.adLibraryUrl)}" target="_blank" rel="noopener noreferrer">${esc(data.matchedPage.pageName)}${I.ext}<span class="va-sr"> in the Ad Library (opens in a new tab)</span></a>` : `ads mentioning “${esc(data.target?.query || run.query)}”`;
      const cost = data.cost ? (data.cost.sample ? 'Sample data · no cost' : data.cost.cached ? 'From the 30-minute cache · $0' : `Cost ${fmtUsd(data.cost.usd)} · ${data.cost.results} results`) : '';
      const aiCost = an?.status === 'done' && an.data.cost ? (an.data.cost.sample ? '' : an.data.cost.cached ? ' · AI read: cached' : ` · AI read ${fmtUsd(an.data.cost.usd)}`) : '';
      els.out.innerHTML = `
        <div class="va-comp-res__head">
          <p class="va-comp-res__who">${ads.length} live ad${ads.length === 1 ? '' : 's'} from ${who}${data.target?.country ? ` · ${esc(data.target.country === 'ALL' ? 'all countries' : data.target.country)}` : ''}</p>
          <p class="va-hint va-comp-res__cost">${esc(cost + aiCost)}</p>
        </div>
        ${didYouMean}
        ${summaryStrip(data)}
        ${A?.headline ? `<p class="va-comp-headline">${I.spark}<span>${esc(A.headline)}</span></p>` : ''}
        ${an?.status === 'done' && an.data.ai === false ? `<p class="va-hint va-comp-free">AI notes are paused (${an.data.reason === 'free' ? 'this week’s AI budget is used up' : 'AI is off'}), so this view shows the counted facts only.</p>` : ''}
        ${tabs}
        <div class="va-comp-sec" id="va-comp-sec" role="tabpanel" aria-labelledby="va-comp-tab-${state.section}" tabindex="0">${section(state.section, ads, byId, an, A)}</div>`;
    }

    function analysisWait(an) {
      if (!an || an.status === 'loading') return `<div class="va-comp-state va-comp-state--loading" role="status" aria-busy="true"><span class="va-dots" aria-hidden="true"><i></i><i></i><i></i></span><strong>Reading the ads…</strong><span>The AI is sorting what works and writing ideas. A few seconds.</span></div>`;
      return stateBox('error', I.alert, 'The AI notes didn’t load', an.error || 'Try again in a moment.', '<button class="es-btn es-btn--sm" type="button" data-comp-reanalyze>Try again</button>');
    }
    function grid(items) { return items.length ? `<div class="va-comp-grid">${items.join('')}</div>` : ''; }
    function section(id, ads, byId, an, A) {
      if (id === 'all') return `<p class="va-hint va-comp-sec__intro">Longest-running first. Long-running ads usually earn their spend.</p>${grid(ads.map(a => adCard(a)))}`;
      if (id === 'working') {
        const list = A ? A.working.map(w => (byId.get(w.id) ? adCard(byId.get(w.id), w.why) : '')).filter(Boolean) : ads.filter(a => a.daysRunning >= 30).slice(0, 8).map(a => adCard(a));
        return `<p class="va-hint va-comp-sec__intro">Running 30+ days. Advertisers rarely keep paying for ads that don’t work.</p>${an?.status !== 'done' ? analysisWait(an) : ''}${grid(list) || stateBox('empty', I.empty, 'No long-running ads here', 'Nothing has run for 30 days or more. Check “Testing” and “All ads”.')}`;
      }
      if (id === 'testing') {
        const list = A ? A.testing.map(w => (byId.get(w.id) ? adCard(byId.get(w.id), w.what) : '')).filter(Boolean) : ads.filter(a => Number.isFinite(a.daysRunning) && a.daysRunning <= 7).slice(0, 8).map(a => adCard(a));
        return `<p class="va-hint va-comp-sec__intro">Started in the last 7 days: what they are trying now.</p>${an?.status !== 'done' ? analysisWait(an) : ''}${grid(list) || stateBox('empty', I.empty, 'Nothing new this week', 'No ads started in the last 7 days.')}`;
      }
      if (an?.status !== 'done') return analysisWait(an);
      if (id === 'trends') {
        return A.trends.length ? `<ul class="va-comp-trends">${A.trends.map(t => `<li class="va-comp-trend"><span class="va-comp-trend__label">${esc(t.label)}</span><p>${esc(t.detail)}</p></li>`).join('')}</ul>` : stateBox('empty', I.empty, 'No clear trends', 'Too few ads to see a pattern.');
      }
      if (id === 'notWorking') {
        const intro = '<p class="va-hint va-comp-sec__intro">Inferred, not measured: Meta doesn’t publish results. Short runs and replaced variants are the clues.</p>';
        return intro + (A.notWorking.length ? `<ul class="va-comp-trends">${A.notWorking.map(n => `<li class="va-comp-trend"><span class="va-comp-trend__label">Likely not working</span><p><b>${esc(n.pattern)}</b> ${esc(n.why)}</p>${n.id && byId.get(n.id) ? `<a class="va-link" href="${esc(byId.get(n.id).adLibraryUrl)}" target="_blank" rel="noopener noreferrer">See the ad${I.ext}<span class="va-sr"> (opens in a new tab)</span></a>` : ''}</li>`).join('')}</ul>` : stateBox('empty', I.empty, 'Nothing to flag', 'No short-lived or replaced ads stood out. Turn on “Include stopped ads” for a better read.'));
      }
      if (id === 'ideas') {
        if (!A.ideas.length) return stateBox('empty', I.empty, 'No ideas this time', an.data.ai === false ? 'AI ideas come back when AI is available again.' : 'The AI didn’t return ideas that pass our checks. Try again.', an.data.ai === false ? '' : '<button class="es-btn es-btn--sm" type="button" data-comp-reanalyze>Try again</button>');
        const brands = B.AD_BRANDS || [];
        return `<p class="va-hint va-comp-sec__intro">New ads for our newsletters, in the Highlight style. “Use this idea” fills your copy; Undo puts it back.</p><div class="va-comp-ideas">${A.ideas.map((idea, i) => {
          const brand = brands.find(b => b.id === idea.brand);
          const { fields } = ideaToCopy(idea, brands);
          const hl = fields.highlight ? esc(fields.headline).replace(esc(fields.highlight), `<mark>${esc(fields.highlight)}</mark>`) : esc(fields.headline);
          return `<article class="va-comp-idea">
            <div class="va-comp-idea__top"><span class="va-comp-idea__brand"><span class="va-dot" style="--c:${esc(brand?.wordmark?.bg || brand?.accent || '#0A6FDE')}" aria-hidden="true"></span>${esc(brand?.label || idea.brand)}</span>${idea.angle ? `<span class="va-comp-badge">${esc(idea.angle)}</span>` : ''}</div>
            <p class="va-comp-idea__headline">${hl}</p>
            ${fields.body.filter(Boolean).map(p => `<p class="va-comp-idea__body">${esc(p)}</p>`).join('')}
            <p class="va-comp-idea__cta"><span class="va-comp-cta">${esc(idea.cta || brand?.cta || '')}</span></p>
            ${idea.inspiredBy?.length ? `<p class="va-hint va-comp-idea__from">Inspired by ${idea.inspiredBy.map((id, k) => (byId.get(id) ? `<a class="va-link" href="${esc(byId.get(id).adLibraryUrl)}" target="_blank" rel="noopener noreferrer">ad ${k + 1}<span class="va-sr"> from ${esc(byId.get(id).pageName)} (opens in a new tab)</span></a>` : '')).join(', ')}</p>` : ''}
            <div class="va-comp-idea__actions"><button class="es-btn es-btn--sm" type="button" data-use-idea="${i}">Use this idea</button></div>
          </article>`;
        }).join('')}</div>`;
      }
      return '';
    }

    // Exposed for the UI sweep and the console.
    window.VideoAdsCompetitorsPanel = { open, close, runCheck, state, demo };
    render();
  }

  return { QUICK_PICKS, PER_RESULT_USD, DEFAULT_LIMIT, STORE_KEY, estimateCost, fmtUsd, daysLabel, isDemo, ideaToCopy, readPicks, writePicks, median, boot };
}));
