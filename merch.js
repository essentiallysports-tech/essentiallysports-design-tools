/* Merch Designs (merch.html): Content → Design studio → Product → Push & live,
   plus the "Your merch" tab. Merch v4 (merch4): Basic / Pro AI modes,
   merch-worthy moments, a design studio (big stage on Fourthwall's real blank
   photo or a close-up, filmstrip, full editor, AI chat edits with undo) and
   live Fourthwall mockups in the Product step.
   Calls /api/merch (modes status, templates, concepts, refine, moments, copy,
   upload-url, register, preview, create, publish, hide, product, archive, list,
   collections, collection-create, collection-set, sales; upload-relay as a
   fallback when the direct upload is blocked: the PNG goes to Supabase Storage
   merch-art/<user>/<file>.png first, then the server streams it to Fourthwall)
   and window.MerchPrint (preview / closeup / photoMock / photoFor / render /
   checks / fallbackConcepts / variations / elementsOf). Blanks: tee, hoodie,
   poster, sticker, mug. merch-stub.js stands in for anything MerchPrint lacks.
   window.MerchGuidelines (merch-guidelines.js) gives the "The AI follows ES
   merch rules" bullets; the page works without it.
   Sample data: on localhost, or ?demo=merch off production, replies come from
   merch-demo.js and no network call is made for /api/merch; ?demo=off uses
   the real API. ?state=free|not-set-up|cant-push|error|pro-cap picks a sample state. */
(function () {
  'use strict';
  const PROD_HOSTS = ['frameup.essentiallysports.com'];
  const COLLECTIONS = [
    { id: 'auto', label: 'Auto', blurb: 'FrameUp picks the best fit for your words.' },
    { id: 'replay', label: 'Replay', blurb: 'An era fans still talk about.' },
    { id: 'nickname', label: 'Nickname', blurb: 'Almost famous: one name, one era.' },
    { id: 'quote', label: 'In their own words', blurb: 'An exact quote, printed word for word.' },
    { id: 'core', label: 'Core ES', blurb: 'Lines that are ours.' },
    { id: 'current', label: 'Current', blurb: 'This week’s story.' },
  ];
  const COLLECTION_LABEL = Object.fromEntries(COLLECTIONS.map(c => [c.id, c.label]));
  const RIGHTS_LABEL = { name: 'Name', nickname: 'Nickname', quote: 'Quote', team: 'Team colours' };
  const STEPS = ['content', 'designs', 'setup', 'live'];
  const BLANK_ORDER = ['tee', 'hoodie', 'poster', 'sticker', 'mug'];
  const BLANK_INFO = {
    tee: { label: 'T-shirt', noun: 'Tee', apparel: true },
    hoodie: { label: 'Hoodie', noun: 'Hoodie', apparel: true },
    poster: { label: 'Poster', noun: 'Poster', apparel: false },
    sticker: { label: 'Sticker', noun: 'Sticker', apparel: false },
    mug: { label: 'Mug', noun: 'Mug', apparel: false },
  };
  const ART_BUCKET = 'merch-art';
  const ETA = { basic: '10–20 seconds', pro: '20–40 seconds', preview: '10–30 seconds', create: 'about 30 seconds' };
  // Basic / Pro (owner decision): open to everyone; Pro counts against the same
  // weekly AI cap and the server falls back to Basic (fellBack) on cap / free mode / AI error.
  const AI_KEY = 'designMode'; // request + reply field for Basic / Pro ('mode' is the API action, and free mode rewrites it)
  const AI_MODES = {
    basic: { label: 'Basic', note: 'Simple ES pill designs. Quick, and light on your AI usage.', create: '4 ES pill designs' },
    pro: { label: 'Pro', note: 'Smarter AI (more usage), richer designs with extra elements, chat edits.', create: '6 designs with a plan, trend angles and extras' },
  };
  const MODE_STORE = 'frameup.merch.aiMode';
  const FELL = {
    cap: 'Pro wasn’t used: you’ve reached this week’s AI limit, so Basic made these.',
    free: 'Pro wasn’t used: FrameUp is in free mode right now, so Basic made these.',
    ai: 'Pro wasn’t used: the smarter AI didn’t answer, so Basic made these.',
  };
  const FELL_SHORT = { cap: 'weekly AI limit reached', free: 'free mode', ai: 'Pro didn’t answer' };
  const KIND_LABEL = { quote: 'Quote', nickname: 'Nickname', moment: 'Moment', era: 'Era', stat: 'Stat', rivalry: 'Rivalry' };
  const KIND_COLLECTION = { quote: 'quote', nickname: 'nickname', era: 'replay', moment: 'current', stat: 'current', rivalry: 'current' };
  const SUGGESTIONS = ['Shorter', 'Use team colours', 'Add the nickname', 'Bolder', 'Centre it', 'Dark tee'];
  const SIZES = [['big', 'Big'], ['mid', 'Mid'], ['small', 'Small']];
  const FILLS = [['a', 'Team colour 1'], ['b', 'Team colour 2'], ['white', 'White'], ['black', 'Black']];
  const EL_LABEL = { number: 'Number', rule: 'Rule', block: 'Block', icon: 'Icon' };
  const POS_LABEL = { behind: 'Behind', above: 'Above', below: 'Below', between: 'Between', left: 'Left' };
  const EL_COLORS = [['a', 'Team colour 1'], ['b', 'Team colour 2'], ['ink', 'Ink colour'], ['white', 'White'], ['black', 'Black']];
  const SPORT_ICON = { nba: 'basketball', wnba: 'basketball', ncaab: 'basketball', basketball: 'basketball', nfl: 'football', ncaaf: 'football', football: 'football', mlb: 'baseball', baseball: 'baseball', soccer: 'soccer', mls: 'soccer', epl: 'soccer', nhl: 'hockey', hockey: 'hockey', golf: 'golf', pga: 'golf', liv: 'golf', tennis: 'tennis', f1: 'racing-flag', nascar: 'racing-flag', racing: 'racing-flag', motorsport: 'racing-flag' };
  const WHITE = '#FFFFFF';
  const BLACK = '#101114';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const sameHex = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();

  function isDemo(loc) {
    const flag = new URLSearchParams(loc.search || '').get('demo');
    if (flag === 'off') return false;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(loc.hostname || '')) return true;
    return flag === 'merch' && !PROD_HOSTS.includes(loc.hostname);
  }
  function loadScript(src) {
    return new Promise(resolve => { const s = document.createElement('script'); s.src = src; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.append(s); });
  }

  // ─── Renderer: the real MerchPrint, or the stub for what it lacks ──────────
  const NEEDS = ['preview', 'render', 'renderLogo', 'fallbackConcepts'];
  async function ensurePrint() {
    if (NEEDS.every(fn => typeof window.MerchPrint?.[fn] === 'function')) return;
    if (!window.MerchStub) await loadScript('merch-stub.js?v=20261126-merch4');
  }
  const P = fn => (typeof window.MerchPrint?.[fn] === 'function' ? window.MerchPrint : window.MerchStub)[fn];
  const MP = () => window.MerchPrint || {};

  async function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    if (!$('mx-steps')) return;
    const demo = isDemo(window.location);
    const scenario = new URLSearchParams(window.location.search).get('state') || 'ok';
    await ensurePrint();
    if (demo && !window.MerchDemo) await loadScript('merch-demo.js?v=20261126-merch4');

    const readMode = () => { try { return window.localStorage.getItem(MODE_STORE) === 'pro' ? 'pro' : 'basic'; } catch { return 'basic'; } };
    const state = {
      step: 'content', status: null, statusError: '',
      aiMode: readMode(), collection: 'auto', trend: null,
      moments: null, momentsBusy: false, momentsError: '', momentsNote: '', momentsAt: '', sport: '',
      concepts: [], selected: null, conceptsFree: false, busy: '', plan: null, madeMode: '', fellBack: '',
      stage: 'tee', history: {}, lastEdit: {}, chat: {}, notes: {}, refining: false,
      templates: null, templatesError: '', templateId: '', colors: [], side: 'front', placement: '', copyFor: '',
      ack: false, mock: { key: '', images: [], busy: false, error: '' }, autoMockFor: '',
      image: null, logo: null, logoImage: null, product: null,
      shopColls: null, shopCollsError: '', pick: { setup: [], live: [] }, newColl: '',
      list: null, listError: '', listSource: '', salesAt: '', listBusy: false, archiving: null,
    };

    // ── API ──
    async function api(body) {
      if (demo && window.MerchDemo) {
        await new Promise(r => setTimeout(r, 150));
        const [status, data] = window.MerchDemo.reply(body, scenario);
        if (status >= 400 || data.ok === false) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status, reason: data.reason, data });
        return data;
      }
      if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { status: 0 });
      const response = await window.ESAuth.fetchWithAuth('/api/merch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || `Something went wrong (${response.status}). Try again.`), { status: response.status, reason: data.reason, data });
      return data;
    }
    // Plain-English message for a failed call.
    function explain(error) {
      const r = error.reason || '';
      if (r === 'not-set-up') return { kind: 'setup', text: 'Fourthwall isn’t connected yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' };
      if (r === 'cant-push' || error.status === 403) return { kind: 'push', text: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' };
      if (r === 'daily-cap') return { kind: 'cap', text: error.message || 'You’ve reached today’s limit for new products. It resets tomorrow.' };
      if (error.status === 429) return { kind: 'rate', text: 'Fourthwall is busy (5 requests a minute). Wait a minute, then try again.' };
      return { kind: 'error', text: error.message || 'Something went wrong. Try again.' };
    }
    const track = (event, data) => { try { window.FrameUpTrack?.track?.(event, data); } catch { /* tracking never breaks the page */ } };

    // ── Banner (page-level state) ──
    function banner(kind, text, { retry = null } = {}) {
      const el = $('mx-banner');
      if (!kind) { el.hidden = true; el.innerHTML = ''; el.dataset.kind = ''; return; }
      el.hidden = false;
      el.dataset.kind = kind;
      el.className = `mx-banner mx-banner--${kind}`;
      el.innerHTML = `<span>${esc(text)}</span>${retry ? '<button class="es-btn es-btn--sm" type="button" data-retry>Try again</button>' : ''}`;
      if (retry) el.querySelector('[data-retry]').addEventListener('click', () => { banner(null); retry(); });
    }

    function renderConn() {
      const s = state.status;
      const el = $('mx-conn');
      if (demo) { el.className = 'mx-conn mx-conn--demo'; el.textContent = 'Sample data'; return; }
      if (!s) { el.className = 'mx-conn'; el.textContent = state.statusError ? 'Fourthwall: unknown' : 'Checking Fourthwall…'; return; }
      el.className = `mx-conn ${s.configured ? 'mx-conn--ok' : 'mx-conn--off'}`;
      el.textContent = s.configured ? `Fourthwall connected${s.shop?.name ? ` · ${s.shop.name}` : ''}` : 'Fourthwall not set up';
    }

    async function loadStatus() {
      try { state.status = await api({ mode: 'status' }); state.statusError = ''; } catch (error) { state.statusError = explain(error).text; }
      renderConn();
      const s = state.status;
      if (s && !s.configured) banner('setup', 'Fourthwall isn’t connected yet, so you can design but not create products. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.');
      renderLiveGate();
      if (state.step === 'setup') renderMockups();
    }

    // ── Basic / Pro ──
    function renderMode() {
      document.querySelectorAll('#mx-mode [data-ai]').forEach(b => { const on = b.dataset.ai === state.aiMode; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      $('mx-mode-note').textContent = AI_MODES[state.aiMode].note;
      $('mx-mode-box').dataset.mode = state.aiMode;
    }
    function setMode(mode) {
      if (!AI_MODES[mode] || mode === state.aiMode) return;
      state.aiMode = mode;
      try { window.localStorage.setItem(MODE_STORE, mode); } catch { /* private mode: remembered for this visit only */ }
      renderMode();
      syncContent();
      if (state.step === 'designs' && selectedConcept()) { renderElements(selectedConcept()); renderChatNote(); }
      track('merch', { action: 'ai-mode', mode });
    }
    $('mx-mode').addEventListener('click', e => { const b = e.target.closest('[data-ai]'); if (b) { setMode(b.dataset.ai); b.focus(); } });
    $('mx-mode').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      setMode(state.aiMode === 'pro' ? 'basic' : 'pro');
      $('mx-mode').querySelector(`[data-ai="${state.aiMode}"]`).focus();
    });

    // ── Steps ──
    const canGo = step => step === 'content' || step === 'list' || (step === 'designs' && state.concepts.length > 0) || (step === 'setup' && Boolean(selectedConcept()) && !blockingChecks().length) || (step === 'live' && Boolean(selectedConcept()) && state.ack);
    function go(step) {
      if (!canGo(step)) return;
      state.step = step;
      document.querySelectorAll('.mx-view').forEach(v => { v.hidden = v.dataset.view !== step; });
      renderSteps();
      renderTabs();
      if (step === 'designs') enterStudio();
      if (step === 'setup') enterSetup();
      if (step === 'live') { renderLiveGate(); renderLive(); }
      if (step === 'list' && !state.list && !state.listBusy) loadList();
      const h = $(`mx-h-${step}`);
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      window.scrollTo(0, 0);
    }
    function renderSteps() {
      const at = STEPS.indexOf(state.step);
      document.querySelectorAll('.mx-step').forEach(b => {
        const i = STEPS.indexOf(b.dataset.step);
        b.disabled = !canGo(b.dataset.step);
        b.classList.toggle('is-done', i < at);
        if (i === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
    }
    $('mx-steps').addEventListener('click', e => { const b = e.target.closest('.mx-step'); if (b) go(b.dataset.step); });

    // ── Tabs: Create merch / Your merch ──
    let lastMakeStep = 'content';
    function renderTabs() {
      const onList = state.step === 'list';
      if (!onList) lastMakeStep = state.step;
      $('mx-steps-nav').hidden = onList;
      $('mx-mode-box').hidden = onList;
      document.querySelectorAll('.mx-tabs [role=tab]').forEach(t => {
        const on = (t.dataset.tab === 'list') === onList;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
    }
    function pickTab(tab) { go(tab === 'list' ? 'list' : lastMakeStep); }
    document.querySelector('.mx-tabs').addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) pickTab(t.dataset.tab); });
    document.querySelector('.mx-tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const next = state.step === 'list' ? 'make' : 'list';
      pickTab(next);
      document.querySelector(`.mx-tabs [data-tab="${next}"]`).focus();
    });

    // ── 1 Content ──
    function renderCollections() {
      $('mx-collections').innerHTML = COLLECTIONS.map(c => `<button class="es-chip" type="button" role="radio" aria-checked="${state.collection === c.id}" tabindex="${state.collection === c.id ? 0 : -1}" data-coll="${c.id}">${esc(c.label)}</button>`).join('');
      $('mx-coll-blurb').textContent = COLLECTIONS.find(c => c.id === state.collection)?.blurb || '';
    }
    function pickCollection(id, focus = true) {
      state.collection = COLLECTIONS.some(c => c.id === id) ? id : 'auto';
      renderCollections();
      if (focus) $('mx-collections').querySelector(`[data-coll="${state.collection}"]`).focus();
    }
    $('mx-collections').addEventListener('click', e => { const b = e.target.closest('[data-coll]'); if (b) pickCollection(b.dataset.coll); });
    $('mx-collections').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const i = COLLECTIONS.findIndex(c => c.id === state.collection);
      pickCollection(COLLECTIONS[(i + d + COLLECTIONS.length) % COLLECTIONS.length].id);
    });
    function renderRules() {
      const list = Array.isArray(window.MerchGuidelines?.SUMMARY) ? window.MerchGuidelines.SUMMARY.filter(x => typeof x === 'string' && x.trim()) : [];
      $('mx-rules').hidden = !list.length;
      $('mx-rules-list').innerHTML = list.map(x => `<li>${esc(x)}</li>`).join('');
    }

    // Merch-worthy moments: the trends feed, scored for merch by the server (30-min shared cache).
    async function loadMoments() {
      if (state.momentsBusy) return;
      state.momentsBusy = true;
      state.momentsError = '';
      renderMoments();
      try {
        const data = await api({ mode: 'moments' });
        state.moments = (Array.isArray(data.moments) ? data.moments : []).filter(m => m && m.title).sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0));
        state.momentsAt = data.at || '';
        state.momentsNote = !state.moments.length && data.error ? data.error : '';
        if (state.sport && !state.moments.some(m => sportOf(m) === state.sport)) state.sport = '';
      } catch (error) {
        state.momentsError = explain(error).text;
      }
      state.momentsBusy = false;
      renderMoments();
    }
    const sportOf = m => String(m?.sportLabel || m?.sport || m?.trend?.sport || m?.trend?.category || '').trim().toUpperCase();
    const teamName = t => (t && typeof t === 'object' ? t.short || t.name || '' : String(t || ''));
    function momentCard(m) {
      const on = state.trend && String(state.trend.momentId || state.trend.id) === String(m.id);
      const score = Math.max(0, Math.min(100, Math.round(Number(m.score) || 0)));
      const where = [sportOf(m), teamName(m.team)].filter(Boolean).join(' · ');
      return `<article class="mx-moment${on ? ' is-on' : ''}" data-mid="${esc(m.id)}">
        <div class="mx-moment__top">
          <span class="mx-kind mx-kind--${esc(KIND_LABEL[m.kind] ? m.kind : 'moment')}">${esc(KIND_LABEL[m.kind] || 'Moment')}</span>
          ${where ? `<span class="mx-moment__where">${esc(where)}</span>` : ''}
          <span class="mx-score" title="Merch score: how well this could sell as a shirt"><span class="es-sr-only">Merch score </span><span class="mx-score__bar" style="--v:${score}%" aria-hidden="true"></span><span class="mx-score__n">${score}</span></span>
        </div>
        <h3 class="mx-moment__title">${esc(m.title)}</h3>
        ${m.why ? `<p class="mx-moment__why">${esc(m.why)}</p>` : ''}
        <div class="mx-moment__foot">
          ${m.line ? `<p class="mx-moment__line"><span class="es-sr-only">Suggested line: </span>${esc(m.line)}</p>` : '<span></span>'}
          <button class="es-btn es-btn--sm${on ? ' is-on' : ''}" type="button" data-design="${esc(m.id)}" aria-label="Design this: ${esc(m.title)}">${on ? 'In the brief' : 'Design this'}</button>
        </div>
      </article>`;
    }
    function renderMoments() {
      const box = $('mx-moments');
      const list = state.moments;
      box.setAttribute('aria-busy', String(state.momentsBusy));
      $('mx-moments-refresh').disabled = state.momentsBusy;
      const sports = [...new Set((list || []).map(sportOf).filter(Boolean))];
      $('mx-moments-sports').hidden = sports.length < 2;
      $('mx-moments-sports').innerHTML = ['', ...sports].map(s => `<button class="es-chip" type="button" aria-pressed="${state.sport === s}" data-sport="${esc(s)}">${s ? esc(s) : 'All'}</button>`).join('');
      if (state.momentsBusy && !list) {
        box.innerHTML = '<span class="es-sr-only">Loading moments…</span>' + '<div class="mx-moment mx-moment--skel" aria-hidden="true"><span class="es-skeleton mx-skel mx-skel--tag"></span><span class="es-skeleton mx-skel mx-skel--title"></span><span class="es-skeleton mx-skel mx-skel--line"></span><span class="es-skeleton mx-skel mx-skel--short"></span></div>'.repeat(4);
        return;
      }
      if (state.momentsError && !list) {
        box.innerHTML = `<div class="es-error-state mx-moments__state" role="alert"><p class="es-error-state__title">Moments didn’t load</p><p class="es-error-state__copy">${esc(state.momentsError)} You can still write your own line.</p><button class="es-btn es-btn--sm" type="button" data-moments="retry">Try again</button></div>`;
        return;
      }
      if (!list) { box.innerHTML = ''; return; }
      const shown = list.filter(m => !state.sport || sportOf(m) === state.sport);
      if (!shown.length) {
        box.innerHTML = `<div class="es-empty mx-moments__state"><p class="es-empty__title">No merch-worthy moments right now</p><p class="es-empty__copy">${esc(state.momentsNote || '')} Write your own line on the left, or check back later.</p></div>`;
        return;
      }
      box.innerHTML = shown.map(momentCard).join('');
      $('mx-moments-meta').textContent = state.momentsAt ? `Today’s trends, scored for merch. Updated ${timeText(state.momentsAt)}.` : 'Today’s trends, scored for merch.';
    }
    $('mx-moments-refresh').addEventListener('click', loadMoments);
    $('mx-moments-sports').addEventListener('click', e => { const b = e.target.closest('[data-sport]'); if (!b) return; state.sport = b.dataset.sport; renderMoments(); $('mx-moments-sports').querySelector(`[data-sport="${CSS.escape(state.sport)}"]`)?.focus(); });
    $('mx-moments').addEventListener('click', e => {
      if (e.target.closest('[data-moments=retry]')) { loadMoments(); return; }
      const b = e.target.closest('[data-design]');
      if (!b) return;
      const m = (state.moments || []).find(x => String(x.id) === b.dataset.design);
      if (m) useMoment(m);
    });
    // "Design this": the suggested line goes in the brief, the trend goes with the concepts call.
    function useMoment(m) {
      const t = m.trend && typeof m.trend === 'object' ? m.trend : {};
      state.trend = { ...t, id: t.id || m.id, title: t.title || m.title, sport: t.sport || t.category || m.sport || '', momentId: m.id };
      if (m.team && !state.trend.team) state.trend.team = m.team;
      $('mx-text').value = m.line || m.title;
      if (KIND_COLLECTION[m.kind]) pickCollection(KIND_COLLECTION[m.kind], false);
      renderUsing();
      renderMoments();
      syncContent();
      track('merch', { action: 'moment', kind: m.kind || '' });
      $('mx-create').focus({ preventScroll: true });
      $('mx-text').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function renderUsing() {
      $('mx-using').hidden = !state.trend;
      $('mx-using-title').textContent = state.trend ? state.trend.title : '';
    }
    $('mx-using-clear').addEventListener('click', () => { state.trend = null; renderUsing(); renderMoments(); syncContent(); $('mx-text').focus(); });

    // The trend as the server takes it (normalizeTrend): the trend fields, no page-only extras.
    function trendBody() {
      if (!state.trend) return null;
      const { momentId, ...t } = state.trend;
      return { ...t, id: t.id || momentId };
    }
    function contentPayload() {
      const raw = $('mx-text').value.trim();
      const inText = (raw.match(/https?:\/\/\S+/) || [''])[0];
      return { text: raw.replace(inText, '').trim(), url: $('mx-url').value.trim() || inText };
    }
    function syncContent() {
      const c = contentPayload();
      const has = c.text.length > 1 || /^https?:\/\/\S+\.\S+/.test(c.url);
      $('mx-create').disabled = !has || state.busy === 'concepts';
      if (state.busy === 'concepts') return;
      $('mx-content-meta').textContent = has ? `${AI_MODES[state.aiMode].label}: ${AI_MODES[state.aiMode].create}.` : 'Add a line, a link, or pick a moment to start.';
    }
    ['mx-text', 'mx-url'].forEach(id => {
      $(id).addEventListener('input', syncContent);
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$('mx-create').disabled) createDesigns(); } });
    });

    async function createDesigns() {
      const content = contentPayload();
      const trend = trendBody();
      const asked = state.aiMode;
      state.busy = 'concepts';
      const btn = $('mx-create');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Creating designs…';
      $('mx-content-meta').textContent = `${AI_MODES[asked].label}: usually ${ETA[asked]}.`;
      syncContent();
      let concepts = null, free = false, data = null, freeWhy = '';
      try {
        const body = { mode: 'concepts', content, [AI_KEY]: asked };
        if (trend) body.trend = trend;
        if (state.collection !== 'auto') body.collection = state.collection;
        data = await api(body);
        if (data.free || !Array.isArray(data.concepts) || !data.concepts.length) free = true; else concepts = data.concepts;
        if (free && data?.fellBack) freeWhy = data.fellBack;
      } catch (error) {
        const why = explain(error);
        if (why.kind === 'setup' || why.kind === 'error' || why.kind === 'rate') free = true; // designs never need Fourthwall: fall back to code concepts
        if (why.kind === 'rate' || why.kind === 'cap') banner(why.kind, why.text);
      }
      if (free) {
        if (!freeWhy) banner('free', 'Free mode: designs are made without AI this time. They still follow the ES style.'); // a Pro fallback is explained in the studio
        concepts = await P('fallbackConcepts')({ ...content, trend, collection: state.collection });
        state.conceptsFree = true;
        state.plan = null;
        state.madeMode = 'free';
        state.fellBack = asked === 'pro' ? freeWhy : '';
      } else {
        if ($('mx-banner').dataset.kind === 'free') banner(null);
        state.conceptsFree = false;
        state.plan = data.plan && (data.plan.idea || data.plan.angle) ? data.plan : null;
        const dm = data[AI_KEY];
        state.madeMode = dm === 'pro' || dm === 'basic' ? dm : asked;
        state.fellBack = data.fellBack || (asked === 'pro' && state.madeMode === 'basic' ? 'ai' : '');
      }
      state.busy = '';
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Create with AI';
      syncContent();
      // The person's own line always comes back whole ("Your words"), even when the AI shortened it.
      try {
        if (MP().yourWords && Array.isArray(concepts) && content.text && !concepts.some(c => MP().hasLine(c, content.text))) { const mine = MP().yourWords(content); if (mine) concepts = [mine, ...concepts]; }
      } catch (error) { console.warn('merch your words', error); }
      const pro = state.madeMode === 'pro';
      state.concepts = (concepts || []).map(c => {
        const x = { ...c, garment: { ...(c.garment || { color: WHITE, name: 'White' }) }, mode: pro ? (c.mode || 'pro') : 'basic' };
        if (!pro) delete x.elements; // Basic is pills only
        return x;
      });
      state.selected = state.concepts[0]?.id || null;
      state.history = {}; state.chat = {}; state.notes = {}; state.lastEdit = {};
      state.ack = false; $('mx-ack').checked = false; state.image = null; state.copyFor = '';
      if (!state.concepts.length) { $('mx-content-meta').textContent = 'No designs came back. Try different words.'; return; }
      track('merch', { action: 'concepts', mode: state.madeMode, asked, count: state.concepts.length, trend: Boolean(trend) });
      go('designs');
    }
    $('mx-create').addEventListener('click', createDesigns);

    // ── 2 Design studio ──
    const selectedConcept = () => state.concepts.find(c => c.id === state.selected) || null;
    const conceptLabel = c => c.label || COLLECTION_LABEL[c.collection] || 'Design';
    function replaceConcept(next) {
      const i = state.concepts.findIndex(c => c.id === next.id);
      if (i >= 0) state.concepts[i] = next;
      return next;
    }
    // Templates load once, when the studio opens (real tee colours and photos) or in Product.
    let templatesP = null;
    function ensureTemplates() {
      if (state.templates) return Promise.resolve(true);
      if (!templatesP) {
        templatesP = api({ mode: 'templates' })
          .then(data => { state.templates = (data.templates || []).filter(Boolean).sort((x, y) => BLANK_ORDER.indexOf(kindOf(x)) - BLANK_ORDER.indexOf(kindOf(y))); state.templatesError = ''; return true; })
          .catch(error => { state.templatesError = explain(error).text; return false; })
          .finally(() => { templatesP = null; });
      }
      return templatesP;
    }
    function defaultTemplate() {
      const c = selectedConcept();
      const list = state.templates || [];
      return list.find(t => (c?.blanks || []).includes(kindOf(t)) && kindOf(t) === 'tee') || list.find(t => kindOf(t) === 'tee') || list[0] || null;
    }
    function enterStudio() {
      renderStudio();
      if (!state.templates) {
        ensureTemplates().then(ok => {
          if (state.step !== 'designs') return;
          if (!ok) { renderTeeColors(); return; }
          if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
          renderTeeColors(); renderFit(); renderStudioChecks(); syncDesigns(); drawStage();
        });
      } else if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
    }
    function renderStudio() {
      renderMadeMode();
      renderStrip();
      renderEditor();
      renderStudioChecks();
      drawStage();
      syncDesigns();
    }
    function renderMadeMode() {
      const m = state.madeMode;
      const b = $('mx-made-mode');
      b.hidden = !m;
      b.className = `es-badge es-badge--${m === 'pro' ? 'brand' : m === 'free' ? 'warn' : 'ink'}`;
      b.textContent = m === 'pro' ? 'Made with Pro' : m === 'free' ? 'Made without AI' : 'Made with Basic';
      $('mx-fell').hidden = !state.fellBack;
      $('mx-fell').textContent = m === 'free' && state.fellBack ? `Pro wasn’t used (${FELL_SHORT[state.fellBack] || 'not available'}), so these were made without AI. They still follow the ES style.` : FELL[state.fellBack] || (state.fellBack ? 'Pro wasn’t used this time, so Basic made these.' : '');
      $('mx-designs-sub').textContent = state.conceptsFree ? `Made without AI${state.fellBack ? ' this time' : ' (free mode)'}. Pick a design and edit it by hand.` : 'Pick a design, then edit it by hand or tell the AI what to change.';
      const p = state.plan;
      $('mx-idea').hidden = !p;
      $('mx-idea-text').textContent = p?.idea || '';
      $('mx-idea-angle').textContent = p?.angle ? `Angle: ${p.angle}` : '';
    }

    // Filmstrip: every design as a small close-up.
    const thumbSpec = () => { const s = printSpec(); return { pixelsWidth: s.pixelsWidth, pixelsHeight: s.pixelsHeight, dpi: s.dpi }; };
    async function drawThumb(c) {
      if (!c) return;
      const cv = $('mx-strip').querySelector(`[data-id="${CSS.escape(c.id)}"] canvas`);
      if (!cv) return;
      try {
        if (MP().closeup) await MP().closeup(c, c.garment?.color, cv, { kind: kind(), spec: thumbSpec(), pad: 0.12 });
        else await P('preview')(c, c.garment?.color, cv, { size: 224, kind: kind() });
      } catch (error) { console.warn('merch thumb', error); }
    }
    function renderStrip() {
      const box = $('mx-strip');
      box.innerHTML = state.concepts.map(c => {
        const on = c.id === state.selected;
        const pro = (MP().elementsOf ? MP().elementsOf(c) : (c.elements || [])).length > 0;
        return `<button class="mx-film${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-id="${esc(c.id)}" title="${esc(c.title)}" aria-label="${esc(conceptLabel(c))}: ${esc(c.title)}${c.variantOf ? ', variation' : ''}">
          <canvas class="mx-film__img" width="192" height="224" aria-hidden="true"></canvas>
          <span class="mx-film__label">${esc(conceptLabel(c))}</span>
          ${c.variantOf || pro ? `<span class="mx-film__tags">${c.variantOf ? '<span class="mx-film__tag">Variation</span>' : ''}${pro ? '<span class="mx-film__tag mx-film__tag--pro">Extras</span>' : ''}</span>` : ''}
        </button>`;
      }).join('');
      $('mx-strip-count').textContent = `${state.concepts.length} design${state.concepts.length === 1 ? '' : 's'}`;
      state.concepts.forEach(drawThumb);
    }
    function selectDesign(id, focus = false) {
      if (id === state.selected) return;
      state.selected = id;
      state.ack = false; $('mx-ack').checked = false; state.image = null; state.copyFor = '';
      if (template()) pickColorFor(selectedConcept());
      $('mx-strip').querySelectorAll('.mx-film').forEach(b => { const on = b.dataset.id === id; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      if (focus) $('mx-strip').querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
      renderEditor();
      renderStudioChecks();
      drawStage();
      syncDesigns();
    }
    $('mx-strip').addEventListener('click', e => { const b = e.target.closest('.mx-film'); if (b) selectDesign(b.dataset.id); });
    $('mx-strip').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d && !['Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const n = state.concepts.length;
      const i = state.concepts.findIndex(c => c.id === state.selected);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + d + n) % n;
      selectDesign(state.concepts[next].id, true);
    });

    // The big stage: "On a tee" = FrameUp's composite on Fourthwall's real blank
    // photo in the chosen colour (flat drawn tee when there is no photo);
    // "Close-up" = the print on the shirt colour.
    function photoChoice(garment) {
      const t = template() || defaultTemplate();
      if (!t || !MP().photoFor || !BLANK_INFO[kindOf(t)].apparel) return null;
      try { const r = MP().photoFor(t.colors || [], garment || WHITE); return r?.url ? { url: r.url, hex: r.color?.hex || garment, name: r.color?.name || '' } : null; } catch { return null; }
    }
    // Draws the design on a fresh canvas, then copies it to the visible one (no half-drawn frames).
    async function paint(c, view, { garment, onCaption } = {}) {
      const off = document.createElement('canvas');
      const spec = thumbSpec();
      const k = kind();
      const g = garment || c.garment?.color || WHITE;
      let caption = '';
      try {
        if (view === 'closeup' && MP().closeup) {
          off.width = 720; off.height = 840;
          await MP().closeup(c, g, off, { kind: k, spec, pad: 0.14 });
          caption = 'Close-up of the print on the shirt colour.';
        } else {
          const ph = BLANK_INFO[k].apparel ? photoChoice(g) : null;
          let done = null;
          if (ph && MP().photoMock) {
            off.width = 720;
            done = await MP().photoMock(c, off, { photo: ph.url, kind: k, garmentColor: ph.hex, spec, logoSpot: logoSpotFor() });
          }
          if (done) caption = `FrameUp preview on Fourthwall’s blank photo${ph.name ? ` · ${ph.name}` : ''}`;
          else {
            await P('preview')(c, g, off, { logoSpot: logoSpotFor(), size: 720, kind: k, spec });
            caption = BLANK_INFO[k].apparel ? 'FrameUp drawn preview (Fourthwall’s blank photo isn’t available).' : `FrameUp drawn preview of the ${BLANK_INFO[k].label.toLowerCase()}.`;
          }
        }
      } catch (error) { console.warn('merch stage', error); }
      return { off, caption };
    }
    const tokens = { stage: 0, product: 0 };
    async function drawStage() {
      const c = selectedConcept();
      if (!c) return;
      const t = ++tokens.stage;
      const { off, caption } = await paint(c, state.stage, {});
      if (t !== tokens.stage) return;
      const cv = $('mx-stage-canvas');
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.setAttribute('aria-label', `${conceptLabel(c)} design, ${state.stage === 'closeup' ? 'close-up' : `on a ${BLANK_INFO[kind()].label.toLowerCase()}`}: ${(c.stack || []).map(r => r.text).join(' / ')}`);
      $('mx-stage-cap').textContent = caption;
    }
    document.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => {
      state.stage = b.dataset.stage;
      document.querySelectorAll('[data-stage]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      drawStage();
    }));

    // Print checks inline in the studio (errors block "Use this design").
    function renderStudioChecks() { renderChecks('mx-studio-checks', 'mx-studio-checks-card'); }
    function syncDesigns() {
      const c = selectedConcept();
      const bad = c ? blockingChecks() : [];
      $('mx-to-setup').disabled = !c || bad.length > 0;
      $('mx-designs-meta').textContent = !c ? 'Choose a design.' : bad.length ? `Fix the print problem first: ${bad[0].text}` : `Chosen: ${conceptLabel(c)} · ${c.title}`;
      $('mx-undo').disabled = !(state.history[c?.id] || []).length;
      renderSteps();
    }

    // ── Editor ──
    // Undo: a per-design stack of snapshots. Bursts of typing or sliding are one step.
    function remember(c, tag = '') {
      const now = Date.now();
      const h = state.history[c.id] || (state.history[c.id] = []);
      if (tag && state.lastEdit.id === c.id && state.lastEdit.tag === tag && now - state.lastEdit.at < 1500) { state.lastEdit.at = now; return; }
      h.push(clone(c));
      if (h.length > 30) h.shift();
      state.lastEdit = { id: c.id, tag, at: now };
    }
    function undo() {
      const c = selectedConcept();
      const h = state.history[c?.id] || [];
      if (!h.length) return;
      const prev = replaceConcept(h.pop());
      state.lastEdit = {};
      if (template() && state.colors[0] !== prev.garment?.name) pickColorFor(prev);
      state.notes[prev.id] = { text: 'Undone: back to the version before.', tone: 'info' };
      renderEditor();
      designChanged();
      $('mx-undo').focus({ preventScroll: true });
    }
    $('mx-undo').addEventListener('click', undo);
    let drawT = 0;
    function designChanged() {
      const c = selectedConcept();
      state.image = null;
      clearTimeout(drawT);
      drawT = setTimeout(() => { drawStage(); drawThumb(c); }, 80);
      renderStudioChecks();
      renderFit();
      syncDesigns();
    }
    function renderEditor() {
      const c = selectedConcept();
      if (!c) return;
      const tags = [`<span class="mx-tag">${esc(conceptLabel(c))}</span>`];
      if (c.variantOf) tags.push('<span class="mx-design__team">Variation</span>');
      if (c.team?.name) tags.push(`<span class="mx-design__team">${esc(c.team.name)}</span>`);
      $('mx-ed-tags').innerHTML = tags.join('');
      $('mx-ed-title').textContent = c.title || 'Untitled design';
      $('mx-ed-why').textContent = c.why || '';
      $('mx-ed-why').hidden = !c.why;
      $('mx-ed-rights').innerHTML = (c.rights || []).map(r => `<span class="mx-rchip" title="${esc(r.text)}">${esc(RIGHTS_LABEL[r.kind] || r.kind)}</span>`).join('');
      renderPills(c);
      renderFit();
      renderTeeColors();
      renderElements(c);
      renderChatNote();
      syncChat();
    }

    // Pills: text (60), size, colour, order, remove, add (10 max).
    const fillHex = (c, key) => (key === 'white' ? WHITE : key === 'black' ? BLACK : c.palette?.[key] || (key === 'a' ? '#0A7DFA' : '#033162'));
    function renderPills(c) {
      const stack = c.stack || [];
      $('mx-pills').innerHTML = stack.map((r, i) => {
        const n = i + 1;
        return `<div class="mx-pill" data-row="${i}">
          <div class="mx-pill__top">
            <span class="mx-pill__n" aria-hidden="true">${n}</span>
            <input class="mx-input mx-input--sm" type="text" value="${esc(r.text)}" maxlength="60" aria-label="Pill ${n} text" data-pill-text="${i}">
            <button class="mx-icon" type="button" data-pill-act="up" data-i="${i}" aria-label="Move pill ${n} up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="mx-icon" type="button" data-pill-act="down" data-i="${i}" aria-label="Move pill ${n} down"${i === stack.length - 1 ? ' disabled' : ''}>↓</button>
            <button class="mx-icon" type="button" data-pill-act="drop" data-i="${i}" aria-label="Remove pill ${n}"${stack.length < 2 ? ' disabled' : ''}>×</button>
          </div>
          <div class="mx-pill__opts">
            <div class="es-segmented es-segmented--sm mx-pill__sizes" role="group" aria-label="Pill ${n} size">${SIZES.map(([k, l]) => `<button class="es-segmented__item" type="button" data-pill-size="${k}" data-i="${i}" aria-pressed="${(r.size || 'big') === k}">${l}</button>`).join('')}</div>
            <div class="mx-pill__fills" role="group" aria-label="Pill ${n} colour">${FILLS.map(([k, l]) => `<button class="mx-swatch mx-swatch--sm" type="button" style="--sw:${esc(fillHex(c, k))}" data-pill-fill="${k}" data-i="${i}" aria-pressed="${(r.fill || 'a') === k}" aria-label="Pill ${n}: ${l}" title="${l}"></button>`).join('')}</div>
          </div>
        </div>`;
      }).join('');
      $('mx-pill-add').disabled = stack.length >= 10;
      $('mx-pill-add').textContent = stack.length >= 10 ? '10 pills is the most' : 'Add a pill';
    }
    // A hand edit to the pills is the new "as designed" for words per pill.
    const pillsEdited = c => { c.designedStack = null; c.split = ''; };
    $('mx-pills').addEventListener('input', e => {
      const input = e.target.closest('[data-pill-text]');
      if (!input) return;
      const c = selectedConcept();
      const i = Number(input.dataset.pillText);
      remember(c, `text${i}`);
      c.stack[i] = { ...c.stack[i], text: input.value.slice(0, 60) };
      pillsEdited(c);
      designChanged();
    });
    $('mx-pills').addEventListener('click', e => {
      const b = e.target.closest('[data-pill-act],[data-pill-size],[data-pill-fill]');
      if (!b) return;
      const c = selectedConcept();
      const i = Number(b.dataset.i);
      const s = [...(c.stack || [])];
      let focus = '';
      remember(c);
      if (b.dataset.pillAct === 'up' && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; focus = i - 1 > 0 ? `[data-pill-act="up"][data-i="${i - 1}"]` : `[data-pill-act="down"][data-i="${i - 1}"]`; }
      else if (b.dataset.pillAct === 'down' && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; focus = i + 1 < s.length - 1 ? `[data-pill-act="down"][data-i="${i + 1}"]` : `[data-pill-act="up"][data-i="${i + 1}"]`; }
      else if (b.dataset.pillAct === 'drop' && s.length > 1) { s.splice(i, 1); focus = `[data-pill-text="${Math.max(0, i - 1)}"]`; }
      else if (b.dataset.pillSize) { s[i] = { ...s[i], size: b.dataset.pillSize }; focus = `[data-pill-size="${b.dataset.pillSize}"][data-i="${i}"]`; }
      else if (b.dataset.pillFill) {
        const f = b.dataset.pillFill;
        const ink = f === 'white' ? 'a' : f === 'black' ? 'white' : f === 'b' ? 'ink' : (s[i].ink && s[i].ink !== 'a' ? s[i].ink : 'white');
        s[i] = { ...s[i], fill: f, ink };
        focus = `[data-pill-fill="${f}"][data-i="${i}"]`;
      } else { (state.history[c.id] || []).pop(); return; }
      c.stack = s;
      pillsEdited(c);
      renderPills(c);
      designChanged();
      if (focus) $('mx-pills').querySelector(focus)?.focus();
    });
    $('mx-pill-add').addEventListener('click', () => {
      const c = selectedConcept();
      const s = c.stack || [];
      if (s.length >= 10) return;
      remember(c);
      const last = s[s.length - 1] || { size: 'big', fill: 'a', ink: 'white' };
      c.stack = [...s, { ...last, text: 'New pill', fill: last.fill === 'a' ? 'b' : 'a', ink: last.fill === 'a' ? 'ink' : 'white' }];
      pillsEdited(c);
      renderPills(c);
      designChanged();
      const input = $('mx-pills').querySelector(`[data-pill-text="${c.stack.length - 1}"]`);
      input?.focus(); input?.select();
    });
    // Variations: the same words in other pill layouts, added right after the
    // design (replacing its earlier variations). No AI, no cost.
    function addVariations(c) {
      const list = MP().variations ? MP().variations(c) : [];
      if (!list.length) { $('mx-designs-meta').textContent = 'No other layouts fit these words. Edit the pills and try again.'; return; }
      const root = c.variantOf || c.id;
      const keep = state.concepts.filter(x => x.variantOf !== root || x.id === c.id);
      const pos = keep.findIndex(x => x.id === c.id);
      const fresh = list.filter(v => v.id !== c.id).map(v => ({ ...v, variantOf: root, mode: c.mode, garment: { ...(v.garment || {}) } }));
      state.concepts = [...keep.slice(0, pos + 1), ...fresh, ...keep.slice(pos + 1)];
      renderStrip();
      track('merch', { action: 'variations', count: fresh.length });
      $('mx-designs-meta').textContent = `${fresh.length} variations added after “${conceptLabel(c)}”. Pick one in Designs.`;
      $('mx-strip').querySelector(`[data-id="${CSS.escape(fresh[0].id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    $('mx-vary').addEventListener('click', () => { const c = selectedConcept(); if (c) addVariations(c); });

    // Size and layout (the person's own fit, saved on the design).
    const DEFAULT_TOP_IN = 1.75;
    function renderFit() {
      const c = selectedConcept();
      if (!c) return;
      const f = MP().fitOf ? MP().fitOf(c) : { scale: 1, topIn: null };
      $('mx-fit-scale').value = Math.round(f.scale * 100);
      $('mx-fit-scale-out').textContent = `${Math.round(f.scale * 100)}%`;
      $('mx-fit-top-row').hidden = !apparel();
      $('mx-fit-split').value = c.split || '';
      document.querySelectorAll('[data-fit-align]').forEach(b => b.setAttribute('aria-pressed', String((c.align === 'center' ? 'center' : 'left') === b.dataset.fitAlign)));
      let read = '';
      try {
        const sc = MP().layout(c, printSpec());
        const top = sc.designIn?.top ?? DEFAULT_TOP_IN;
        if (apparel()) { $('mx-fit-top').value = f.topIn ?? Math.round(top * 4) / 4; $('mx-fit-top-out').textContent = `${Number($('mx-fit-top').value).toFixed(2)} in`; }
        read = `Prints ${sc.designIn.w.toFixed(1)} × ${sc.designIn.h.toFixed(1)} in${apparel() ? `, ${top.toFixed(1)} in below the top of the print area` : ''}.`;
      } catch (error) { console.warn('merch fit', error); }
      $('mx-fit-read').textContent = read;
    }
    $('mx-fit-scale').addEventListener('input', () => { const c = selectedConcept(); if (!c) return; remember(c, 'scale'); c.fit = { ...(c.fit || {}), scale: Number($('mx-fit-scale').value) / 100 }; designChanged(); });
    $('mx-fit-top').addEventListener('input', () => { const c = selectedConcept(); if (!c) return; remember(c, 'top'); c.fit = { ...(c.fit || {}), topIn: Number($('mx-fit-top').value) }; designChanged(); });
    $('mx-fit-split').addEventListener('change', () => {
      const c = selectedConcept();
      if (!c) return;
      const mode = $('mx-fit-split').value;
      remember(c);
      if (!c.designedStack) c.designedStack = (c.stack || []).map(r => ({ ...r }));
      if (!mode) { c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; renderPills(c); designChanged(); return; }
      const base = c.designedStack;
      const smalls = base.filter((r, i) => r.size === 'small' && i > 0);
      const words = base.filter(r => !smalls.includes(r)).map(r => r.text).join(' ');
      const parts = MP().splitWords(words, mode);
      if (parts.length > 9) { (state.history[c.id] || []).pop(); $('mx-fit-read').textContent = 'That makes too many pills for one print. Pick another option.'; $('mx-fit-split').value = c.split || ''; return; }
      const first = base[0] || { fill: 'a', ink: 'white' };
      const second = base.find((r, i) => i > 0 && r.size !== 'small') || { fill: first.fill === 'a' ? 'b' : 'a', ink: 'ink' };
      c.stack = [...parts.map((t, i) => ({ text: t, size: 'big', fill: (i % 2 ? second : first).fill, ink: (i % 2 ? second : first).ink })), ...smalls.map(r => ({ ...r }))];
      c.split = mode;
      renderPills(c);
      designChanged();
    });
    document.querySelectorAll('[data-fit-align]').forEach(b => b.addEventListener('click', () => { const c = selectedConcept(); if (!c || (c.align === 'center' ? 'center' : 'left') === b.dataset.fitAlign) return; remember(c); c.align = b.dataset.fitAlign; designChanged(); }));
    $('mx-fit-reset').addEventListener('click', () => { const c = selectedConcept(); if (!c) return; remember(c); c.fit = { scale: 1, topIn: null }; if (c.designedStack) c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; renderPills(c); designChanged(); });

    // Tee colour: the real template colours once templates load; else White, Black and the team colours.
    function teeColorChoices(c) {
      const t = template() || defaultTemplate();
      if (t && BLANK_INFO[kindOf(t)].apparel && (t.colors || []).length) return { real: true, list: t.colors.filter(x => x.hex).map(x => ({ name: x.name, color: x.hex })) };
      const list = [{ name: 'White', color: WHITE }, { name: 'Black', color: BLACK }];
      if (c.palette?.a) list.push({ name: MP().colorName ? MP().colorName(c.palette.a) : 'Team colour', color: c.palette.a });
      if (c.palette?.b) list.push({ name: MP().colorName ? MP().colorName(c.palette.b) : 'Second colour', color: c.palette.b });
      if (c.garment?.color) list.unshift({ name: c.garment.name || 'Shirt', color: c.garment.color });
      return { real: false, list: list.filter((g, i, a) => a.findIndex(x => sameHex(x.color, g.color)) === i).slice(0, 6) };
    }
    function currentTee(c, list) {
      return list.find(g => g.name === c.garment?.name && sameHex(g.color, c.garment?.color)) || list.find(g => sameHex(g.color, c.garment?.color)) || list.find(g => g.name === c.garment?.name) || null;
    }
    function renderTeeColors() {
      const c = selectedConcept();
      if (!c) return;
      const t = template();
      const hard = t && !apparel();
      $('mx-tee-colors').hidden = hard;
      if (hard) { $('mx-tee-colors-note').textContent = `A ${BLANK_INFO[kind()].label.toLowerCase()} prints on white. Change the product in the next step.`; return; }
      const { real, list } = teeColorChoices(c);
      const cur = currentTee(c, list);
      $('mx-tee-colors-label').textContent = `${BLANK_INFO[kind()].noun} colour`;
      $('mx-tee-colors').innerHTML = list.map(g => { const on = g === cur; return `<button class="mx-swatch" type="button" role="radio" aria-checked="${on}" tabindex="${on || (!cur && g === list[0]) ? 0 : -1}" style="--sw:${esc(g.color)}" aria-label="${esc(g.name)}" title="${esc(g.name)}" data-hex="${esc(g.color)}" data-name="${esc(g.name)}"></button>`; }).join('');
      $('mx-tee-colors-note').textContent = `${cur ? cur.name : c.garment?.name || ''}${real ? ' · Fourthwall’s colours for this blank' : state.templatesError ? ' · the shop’s colours didn’t load' : ' · loading the shop’s colours…'}`;
    }
    function pickTee(btn) {
      const c = selectedConcept();
      if (!c || !btn) return;
      remember(c);
      c.garment = { color: btn.dataset.hex, name: btn.dataset.name };
      if (template() && (template().colors || []).some(x => x.name === btn.dataset.name)) state.colors = [btn.dataset.name];
      renderTeeColors();
      designChanged();
      $('mx-tee-colors').querySelector(`[data-name="${CSS.escape(btn.dataset.name)}"]`)?.focus();
    }
    $('mx-tee-colors').addEventListener('click', e => pickTee(e.target.closest('[data-hex]')));
    $('mx-tee-colors').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const all = [...$('mx-tee-colors').querySelectorAll('[data-hex]')];
      const i = Math.max(0, all.findIndex(b => b.getAttribute('aria-checked') === 'true'));
      pickTee(all[(i + d + all.length) % all.length]);
    });

    // Pro extras: number, rule, block, icon (max 3; the engine draws them).
    const sourceNumber = () => { const m = `${contentPayload().text} ${state.trend?.title || ''}`.match(/(?:^|[^\d.,])(\d{1,2})(?![\d.,]*\d)/); return m ? m[1] : ''; };
    const sportIcon = c => SPORT_ICON[String(state.trend?.sport || c.team?.sport || c.team?.league || '').toLowerCase()] || 'star';
    function renderElements(c) {
      const list = Array.isArray(c.elements) ? c.elements : [];
      const pro = state.aiMode === 'pro';
      $('mx-elements-sec').hidden = !(pro || list.length);
      const types = MP().ELEMENT_TYPES || { number: ['behind', 'above'], rule: ['above', 'below', 'between'], block: ['behind'], icon: ['above', 'below', 'left'] };
      const icons = MP().ICONS || ['star'];
      const sel = (field, i, opts, value, label) => `<select class="mx-input mx-input--sm" data-el-field="${field}" data-i="${i}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      $('mx-elements').innerHTML = list.length ? list.map((e, i) => {
        const n = `Extra ${i + 1} (${(EL_LABEL[e.type] || e.type).toLowerCase()})`;
        const bits = [];
        if (e.type === 'icon') bits.push(sel('name', i, icons.map(x => [x, x.replace(/-/g, ' ').replace(/^./, m => m.toUpperCase())]), e.name, `${n} shape`));
        if (e.type === 'number') bits.push(`<input class="mx-input mx-input--sm mx-el__num" type="text" inputmode="numeric" maxlength="2" pattern="\\d{1,2}" value="${esc(e.text || '')}" data-el-field="text" data-i="${i}" aria-label="${esc(n)} digits" title="1 or 2 digits from your story">`, sel('style', i, [['solid', 'Solid'], ['outline', 'Outline']], e.style || 'solid', `${n} style`));
        if (e.type === 'rule') bits.push(sel('weight', i, [['thick', 'Thick'], ['thin', 'Thin']], e.weight || 'thick', `${n} weight`));
        const pos = types[e.type] || ['above'];
        if (pos.length > 1) bits.push(sel('position', i, pos.map(p => [p, POS_LABEL[p] || p]), e.position || pos[0], `${n} position`));
        bits.push(sel('color', i, EL_COLORS, e.color || 'a', `${n} colour`));
        return `<div class="mx-el" data-el="${i}"><span class="mx-el__type">${esc(EL_LABEL[e.type] || e.type)}</span><div class="mx-el__fields">${bits.join('')}</div><button class="mx-icon" type="button" data-el-drop="${i}" aria-label="Remove ${esc(n)}">×</button></div>`;
      }).join('') : '<p class="mx-meta">No extras yet. Pills alone are the classic ES look.</p>';
      $('mx-elements-count').textContent = `${list.length} of 3`;
      const num = sourceNumber();
      $('mx-el-add').querySelectorAll('[data-el-add]').forEach(b => {
        const noNum = b.dataset.elAdd === 'number' && !num;
        b.disabled = !pro || list.length >= 3 || noNum;
        b.title = !pro ? 'Switch to Pro to add extras.' : list.length >= 3 ? 'Up to 3 extras.' : noNum ? 'Numbers come from your story: add one to your words first.' : '';
      });
    }
    $('mx-el-add').addEventListener('click', e => {
      const b = e.target.closest('[data-el-add]');
      const c = selectedConcept();
      if (!b || !c || b.disabled) return;
      const list = Array.isArray(c.elements) ? c.elements : [];
      if (list.length >= 3) return;
      const make = { number: { type: 'number', text: sourceNumber(), style: 'solid', color: 'b', position: 'behind' }, rule: { type: 'rule', position: 'below', color: 'a', weight: 'thick' }, block: { type: 'block', position: 'behind', color: 'b' }, icon: { type: 'icon', name: sportIcon(c), position: 'above', color: 'a' } }[b.dataset.elAdd];
      remember(c);
      c.elements = [...list, make];
      c.mode = 'pro';
      renderElements(c);
      renderStrip();
      designChanged();
      $('mx-elements').querySelector(`[data-el="${c.elements.length - 1}"] select, [data-el="${c.elements.length - 1}"] input`)?.focus();
    });
    $('mx-elements').addEventListener('change', e => {
      const f = e.target.closest('[data-el-field]');
      const c = selectedConcept();
      if (!f || !c) return;
      const i = Number(f.dataset.i);
      remember(c);
      const v = f.dataset.elField === 'text' ? String(f.value).replace(/\D/g, '').slice(0, 2) : f.value;
      c.elements = c.elements.map((x, j) => (j === i ? { ...x, [f.dataset.elField]: v } : x));
      if (f.dataset.elField === 'text') f.value = v;
      designChanged();
    });
    $('mx-elements').addEventListener('click', e => {
      const b = e.target.closest('[data-el-drop]');
      const c = selectedConcept();
      if (!b || !c) return;
      remember(c);
      c.elements = c.elements.filter((_, j) => j !== Number(b.dataset.elDrop));
      renderElements(c);
      renderStrip();
      designChanged();
      ($('mx-elements').querySelector('[data-el-drop]') || $('mx-el-add').querySelector('button:not(:disabled)'))?.focus();
    });

    // AI chat edits: "Tell the AI what to change" → refine (the last 4 instructions go along).
    $('mx-chat-chips').innerHTML = SUGGESTIONS.map(s => `<button class="es-chip" type="button" data-say="${esc(s)}">${esc(s)}</button>`).join('');
    function syncChat() {
      const busy = state.refining;
      $('mx-chat-send').disabled = busy;
      $('mx-chat-send').textContent = busy ? 'Changing…' : 'Change it';
      $('mx-chat-send').setAttribute('aria-busy', String(busy));
      $('mx-chat-chips').querySelectorAll('button').forEach(b => { b.disabled = busy; });
    }
    function renderChatNote() {
      const c = selectedConcept();
      const n = c ? state.notes[c.id] : null;
      const el = $('mx-chat-note');
      el.className = `mx-chat__note${n ? ` mx-chat__note--${n.tone}` : ''}`;
      if (!n) { el.innerHTML = state.aiMode === 'pro' ? '<span class="mx-meta">Pro uses the smarter AI for edits.</span>' : '<span class="mx-meta">Basic edits are quick. Switch to Pro for the smarter AI.</span>'; return; }
      const who = n.mode ? `<span class="mx-chat__who">${n.mode === 'pro' ? 'Pro' : n.mode === 'free' ? 'No AI' : n.mode === 'code' ? 'Quick edit' : 'Basic'}${n.fellBack ? ` (${esc(FELL_SHORT[n.fellBack] || 'fell back')})` : ''}</span>` : '';
      const canUndo = (state.history[c.id] || []).length > 0 && n.tone === 'ok';
      el.innerHTML = `${who}<span class="mx-chat__text">${esc(n.text)}</span>${canUndo ? '<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-chat-undo>Undo</button>' : ''}`;
    }
    $('mx-chat-note').addEventListener('click', e => { if (e.target.closest('[data-chat-undo]')) undo(); });
    const forServer = c => { const { designedStack, ...rest } = c; return rest; };
    async function refine(instruction) {
      const c = selectedConcept();
      if (!c || state.refining) return;
      const text = String(instruction || '').trim().slice(0, 300);
      if (!text) { state.notes[c.id] = { text: 'Type what to change, or pick a suggestion.', tone: 'info' }; renderChatNote(); $('mx-chat-input').focus(); return; }
      state.refining = true;
      syncChat();
      state.notes[c.id] = { text: `Changing it: “${text}”…`, tone: 'busy' };
      renderChatNote();
      const history = (state.chat[c.id] || []).slice(-4);
      const body = { mode: 'refine', concept: forServer(c), instruction: text, content: contentPayload(), [AI_KEY]: state.aiMode, history };
      const trend = trendBody();
      if (trend) body.trend = trend;
      try {
        const data = await api(body);
        const same = selectedConcept()?.id === c.id;
        if (!data.concept) {
          state.notes[c.id] = { text: data.error || 'The AI couldn’t make that change. Try saying it another way.', tone: 'warn', mode: data.free ? 'free' : data[AI_KEY] };
        } else {
          remember(c);
          const fresh = { ...c, ...data.concept, id: c.id, variantOf: c.variantOf, label: data.concept.label || c.label, garment: { ...(data.concept.garment || c.garment || {}) }, designedStack: null, split: '' };
          if (data[AI_KEY] === 'basic' && !Array.isArray(data.concept.elements)) delete fresh.elements;
          replaceConcept(fresh);
          if (template() && state.selected === c.id) pickColorFor(fresh);
          state.chat[c.id] = [...history, text].slice(-4);
          state.notes[c.id] = { text: data.note || 'Changed.', tone: 'ok', mode: data.ai === false ? 'code' : (data[AI_KEY] || state.aiMode), fellBack: data.fellBack || '' };
          track('merch', { action: 'refine', mode: data[AI_KEY] || state.aiMode, ai: data.ai !== false });
          if (same) { $('mx-chat-input').value = ''; renderEditor(); designChanged(); }
          drawThumb(fresh);
        }
      } catch (error) {
        const invalid = error.reason === 'invalid';
        state.notes[c.id] = { text: invalid ? `${error.message || 'The AI’s change broke an ES rule.'} Nothing changed. Try saying it another way.` : explain(error).text, tone: 'warn', mode: error.data?.free ? 'free' : '' };
      }
      state.refining = false;
      syncChat();
      renderChatNote();
    }
    $('mx-chat-send').addEventListener('click', () => refine($('mx-chat-input').value));
    $('mx-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); refine($('mx-chat-input').value); } });
    $('mx-chat-chips').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) refine(b.dataset.say); });

    $('mx-to-setup').addEventListener('click', () => go('setup'));
    $('mx-again').addEventListener('click', () => go('content'));

    // ── 3 Product ──
    // templates → [{ blank, label, templateId, name, basePrice, suggestedPrice?, printSpec,
    //   areas:[{ regionId, pixelsWidth, pixelsHeight, dpi, renderable, suitsLogo, suitsDesign, available }],
    //   colors:[{ name, hex, photos?:[url] }], defaultColor, sizes }]
    const template = () => (state.templates || []).find(t => t.templateId === state.templateId) || null;
    const kindOf = t => (BLANK_INFO[t?.kind] ? t.kind : BLANK_INFO[t?.blank] ? t.blank : 'tee');
    const kind = () => kindOf(template());
    const apparel = () => (typeof template()?.apparel === 'boolean' ? template().apparel : BLANK_INFO[kind()].apparel);
    const usable = a => a && a.renderable !== false && a.available !== false;
    // Sizes always come from the template: register rejects files that aren't the area's
    // exact size. Hard goods have one area (the printSpec); apparel areas keep the
    // printSpec's numbers for the printSpec's own region.
    const specArea = t => (t?.printSpec ? [{ ...t.printSpec, name: t.printSpec.name || (kindOf(t) === 'mug' ? 'Wrap' : 'Print'), regionId: t.printSpec.regionId || 'front' }] : []);
    const designAreas = () => {
      const t = template();
      if (!apparel() || t?.logo === 'inside') return specArea(t);
      const list = (t?.areas || []).filter(a => usable(a) && a.suitsDesign).map(a => (a.regionId === t.printSpec?.regionId ? { ...a, pixelsWidth: t.printSpec.pixelsWidth, pixelsHeight: t.printSpec.pixelsHeight, dpi: t.printSpec.dpi } : a));
      return list.length ? list : specArea(t);
    };
    // Apparel: the ES logo is its own print in a small area. Hard goods have one
    // print area, so the logo goes under the design in the same print ('inline').
    const logoAreas = () => (apparel() ? (template()?.areas || []).filter(a => usable(a) && a.suitsLogo && a.regionId !== state.side) : []);
    const areaLabel = a => a.name || a.label || String(a.regionId).replace(/[_-]+/g, ' ').replace(/^./, m => m.toUpperCase());
    const area = () => designAreas().find(a => a.regionId === state.side) || designAreas()[0] || null;
    const logoArea = () => logoAreas().find(a => a.regionId === state.logo) || null;
    const logoInline = () => !apparel() && state.logo === 'inline';
    const logoSpot = () => { if (logoInline()) return 'inline'; const la = logoArea(); if (!la) return 'none'; const r = la.regionId.toLowerCase(); return /sleeve/.test(r) ? 'sleeve' : /back/.test(r) ? 'back-neck' : /label/.test(r) ? 'label' : 'neck'; };
    const logoSpotFor = () => (template() ? logoSpot() : 'sleeve');
    const logoText = () => (logoInline() ? 'ES logo inside the design' : logoArea() ? `ES logo on the ${areaLabel(logoArea()).toLowerCase()}` : 'no ES logo');
    const garmentHex = () => (template()?.colors || []).find(x => x.name === state.colors[0])?.hex || (apparel() ? selectedConcept()?.garment?.color : WHITE);
    // The print spec for the chosen blank and area (what render and checks use).
    function printSpec() {
      const a = area() || { regionId: state.side, ...(MP().DEFAULT_AREAS?.[kind()] || { pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 }) };
      const spec = { ...(template()?.printSpec || {}), templateId: state.templateId, kind: kind(), region: /back/i.test(a.regionId) ? 'back' : 'front', regionId: a.regionId, pixelsWidth: a.pixelsWidth, pixelsHeight: a.pixelsHeight, dpi: a.dpi, garmentColor: garmentHex() || WHITE };
      if (logoInline()) spec.logo = 'inside';
      return spec;
    }
    // The Product step's stage: FrameUp's composite on Fourthwall's blank photo
    // (or the flat drawn blank) until Fourthwall's live mockups arrive.
    async function drawProductStage() {
      const c = selectedConcept();
      if (!c) return;
      const t = ++tokens.product;
      const { off, caption } = await paint(c, 'tee', { garment: garmentHex() });
      if (t !== tokens.product) return;
      const cv = $('mx-pstage-canvas');
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.setAttribute('aria-label', `${BLANK_INFO[kind()].label} preview, ${logoText()}`);
      cv.dataset.caption = caption;
      if (!state.mock.images.length) $('mx-pstage-kind').textContent = caption;
    }
    async function enterSetup() {
      const c = selectedConcept();
      renderRights();
      loadShopColls();
      if (!state.templates) {
        $('mx-blanks').innerHTML = '<span class="mx-meta">Loading products…</span>';
        const ok = await ensureTemplates();
        if (!ok) {
          $('mx-blanks').innerHTML = `<span class="mx-meta mx-meta--bad">${esc(state.templatesError)}</span> <button class="es-btn es-btn--sm" type="button" id="mx-blanks-retry">Try again</button>`;
          $('mx-blanks-retry').addEventListener('click', enterSetup);
          syncSetup();
          return;
        }
        if (state.step !== 'setup') return;
      }
      if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
      else pickColorFor(c);
      renderSetup();
      if (state.copyFor !== copyKey(c)) loadCopy(c);
      autoMockups();
    }
    function pickColorFor(c) {
      const t = template();
      const match = (apparel() && (t?.colors?.find(x => x.name === c?.garment?.name && sameHex(x.hex, c?.garment?.color)) || t?.colors?.find(x => sameHex(x.hex, c?.garment?.color)) || t?.colors?.find(x => x.name === c?.garment?.name))) || t?.colors?.find(x => x.name === t.defaultColor) || t?.colors?.[0];
      state.colors = match ? [match.name] : [];
    }
    const suggested = () => { const t = template(); if (!t) return 0; const sp = Number(t.pricing?.suggested ?? t.suggestedPrice); if (sp > 0) return sp; return window.MerchRules?.suggestedPrice ? window.MerchRules.suggestedPrice(kind(), base()) : Math.ceil(base() * 1.8); };
    function pickTemplate(id, render = true) {
      const before = kind();
      state.templateId = id;
      pickColorFor(selectedConcept());
      state.side = designAreas()[0]?.regionId || template()?.printSpec?.regionId || 'front';
      if (template()?.printSpec?.regionId && designAreas().some(a => a.regionId === template().printSpec.regionId)) state.side = template().printSpec.regionId;
      const logos = logoAreas();
      if (!apparel()) state.logo = 'inline';
      else if (!logos.some(x => x.regionId === state.logo)) state.logo = logos[0]?.regionId || null;
      state.image = null; state.logoImage = null;
      if (before !== kind()) state.mock = { key: '', images: [], busy: state.mock.busy, error: '' }; // another product's mockups don't apply
      if (render) {
        renderSetup();
        const c = selectedConcept();
        if (before !== kind() && c) loadCopy(c);
      }
    }
    const base = () => Number(template()?.basePrice) || 0;
    function blankCard(x) {
      const k = kindOf(x);
      const on = x.templateId === state.templateId;
      const fits = (selectedConcept()?.blanks || []).includes(k);
      const sug = Number(x.pricing?.suggested ?? x.suggestedPrice) > 0 ? Number(x.pricing?.suggested ?? x.suggestedPrice) : (window.MerchRules?.suggestedPrice ? window.MerchRules.suggestedPrice(k, x.basePrice) : null);
      return `<button class="mx-blank" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-tpl="${esc(x.templateId)}" data-kind="${esc(k)}" aria-label="${esc(x.label || BLANK_INFO[k].label)}, base cost ${x.basePrice != null ? money(x.basePrice) : 'unknown'}${sug ? `, suggested price ${money(sug)}` : ''}${fits ? ', suits this design' : ''}">
        <span class="mx-blank__icon" aria-hidden="true">${BLANK_ICON[k] || ''}${fits ? '<span class="mx-blank__fit"></span>' : ''}</span>
        <span class="mx-blank__name">${esc(x.label || BLANK_INFO[k].label)}</span>
        <span class="mx-blank__price">${x.basePrice != null ? money(x.basePrice) : '—'}</span>
      </button>`;
    }
    function blankDetail() {
      const t = template();
      if (!t) return '';
      const fits = (selectedConcept()?.blanks || []).includes(kind());
      return [t.name, `base ${money(base())}`, suggested() ? `suggested price ${money(suggested())}` : '', fits ? 'suits this design' : ''].filter(Boolean).join(' · ');
    }
    function renderSetup() {
      const t = template();
      const k = kind();
      $('mx-blanks').innerHTML = (state.templates || []).length
        ? state.templates.map(blankCard).join('')
        : '<span class="mx-meta">No products found on Fourthwall.</span>';
      $('mx-blank-detail').textContent = blankDetail();
      const colors = t?.colors || [];
      $('mx-colors-label').textContent = `${BLANK_INFO[k].noun} colour`;
      $('mx-colors-block').hidden = colors.length < 2;
      $('mx-colors').innerHTML = colors.map(x => { const on = state.colors.includes(x.name); return `<button class="es-chip" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-color="${esc(x.name)}"><span class="es-chip__dot" style="--dot:${esc(x.hex)}"></span>${esc(x.name)}</button>`; }).join('');
      $('mx-side').innerHTML = designAreas().map(a => `<option value="${esc(a.regionId)}">${esc(areaLabel(a))}${a.dpi ? ` · ${esc(a.dpi)} DPI` : ''}</option>`).join('');
      $('mx-side').value = state.side;
      $('mx-side').disabled = designAreas().length < 2;
      const logos = logoAreas();
      $('mx-logo').innerHTML = apparel()
        ? `${logos.map(a => `<option value="${esc(a.regionId)}">${esc(areaLabel(a))}</option>`).join('')}<option value="">No logo</option>`
        : '<option value="inline">Inside the design (small ES pill at the bottom)</option><option value="">No logo</option>';
      $('mx-logo').value = (apparel() ? state.logo : (state.logo === 'inline' ? 'inline' : '')) || '';
      $('mx-logo-hint').textContent = !apparel()
        ? `A ${BLANK_INFO[k].label.toLowerCase()} has one print area, so the small ESSENTIALLYSPORTS pill is printed at the bottom of the design, in the same file.`
        : logos.length ? 'The ES logo is the small ESSENTIALLYSPORTS pill, printed in its own area. The preview shows where.' : `This ${BLANK_INFO[k].label.toLowerCase()} has no small print areas, so it goes without the ES logo.`;
      drawProductStage();
      renderMockups();
      renderChecks('mx-checks', 'mx-checks-block');
      syncEarn();
      syncSetup();
    }
    // A change in the Product step: redraw, re-check, and mark live mockups out of date.
    function productChanged() {
      state.image = null;
      drawProductStage();
      renderMockups();
      renderChecks('mx-checks', 'mx-checks-block');
      syncSetup();
    }

    // Print checks for the chosen blank (300 DPI hard goods, mug wrap, sticker cut, poster trim).
    function printChecks() {
      const c = selectedConcept();
      if (!c || typeof MP().checks !== 'function') return [];
      try { return MP().checks(c, printSpec()); } catch (error) { console.warn('merch checks', error); return []; }
    }
    const blockingChecks = () => printChecks().filter(x => x.level === 'error');
    // Problems and warnings in full; passing checks fold into one line with the details on request.
    const checkRow = x => `<li class="mx-check-row mx-check-row--${esc(x.level)}"><span class="mx-check-row__mark" aria-hidden="true">${x.level === 'ok' ? '✓' : '!'}</span><span><span class="es-sr-only">${x.level === 'error' ? 'Problem: ' : x.level === 'warn' ? 'Warning: ' : 'OK: '}</span>${esc(x.text)}</span></li>`;
    function renderChecks(listId, blockId) {
      const list = printChecks();
      $(blockId).hidden = !list.length;
      const issues = list.filter(x => x.level !== 'ok');
      const passed = list.filter(x => x.level === 'ok');
      const dpi = passed.find(x => x.id === 'dpi');
      const summary = issues.length ? '' : `<li class="mx-check-row mx-check-row--ok"><span class="mx-check-row__mark" aria-hidden="true">✓</span><span>Ready to print on a ${esc(BLANK_INFO[kind()].label.toLowerCase())}${dpi ? `: ${esc(dpi.text.replace(/: full print size\.$/, '.'))}` : '.'}</span></li>`;
      $(listId).innerHTML = `${issues.map(checkRow).join('')}${summary}${passed.length ? `<li><details class="mx-check-more"><summary>${issues.length ? `${passed.length} other checks pass` : `See all ${passed.length} checks`}</summary><ul class="mx-checks">${passed.map(checkRow).join('')}</ul></details></li>` : ''}`;
    }
    function syncEarn() {
      const price = Number($('mx-price').value);
      if (!template() || !(price > 0)) { $('mx-earn').textContent = ''; return; }
      const m = window.MerchRules?.marginFor ? window.MerchRules.marginFor(price, base()) : null;
      const earn = m && Number.isFinite(m.margin) ? m.margin : price - base();
      const sug = suggested();
      $('mx-earn').innerHTML = earn > 0 ? `You earn about <strong>${money(earn)}</strong> per sale (base cost ${money(base())}${sug ? `, suggested ${money(sug)}` : ''}).` : `<span class="mx-meta--bad">Below the base cost of ${money(base())}. Raise the price.</span>`;
    }
    const copyKey = c => `${c?.id || ''}|${kind()}`;
    async function loadCopy(c) {
      const key = copyKey(c);
      state.copyFor = key;
      const noun = BLANK_INFO[kind()].noun;
      $('mx-title-input').value = c.title ? `${c.title} ${noun}` : '';
      $('mx-price').value = suggested() || '';
      $('mx-setup-meta').textContent = 'Writing the title and description…';
      try {
        const data = await api({ mode: 'copy', concept: forServer(c), content: { ...contentPayload(), trend: trendBody() }, blank: kind() });
        if (state.copyFor !== key) return;
        const copy = data.copy || data;
        if (copy.title) $('mx-title-input').value = copy.title;
        if (copy.description) $('mx-desc').value = copy.description;
        if (copy.retail) $('mx-price').value = copy.retail;
        $('mx-setup-meta').textContent = '';
      } catch (error) {
        if (state.copyFor !== key) return;
        $('mx-setup-meta').textContent = 'Couldn’t write the copy. Fill in the title, description and price yourself.';
      }
      if (!$('mx-price').value) $('mx-price').value = suggested() || 30;
      syncEarn();
      syncSetup();
    }
    function renderRights() {
      const c = selectedConcept();
      const list = c?.rights || [];
      $('mx-rights-list').innerHTML = list.length
        ? list.map(r => `<li><span class="mx-rchip">${esc(RIGHTS_LABEL[r.kind] || r.kind)}</span> ${esc(r.text)}</li>`).join('')
        : '<li class="mx-meta">No names, quotes or team colours found.</li>';
    }
    function setupReady() {
      return Boolean(template()) && (state.colors.length > 0 || !(template()?.colors || []).length) && $('mx-title-input').value.trim().length > 2 && Number($('mx-price').value) > base() && !blockingChecks().length;
    }
    function syncSetup() {
      const ready = setupReady();
      $('mx-to-live').disabled = !(ready && state.ack);
      syncMockButton();
      renderSteps();
    }
    $('mx-blanks').addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b && b.dataset.tpl !== state.templateId) { pickTemplate(b.dataset.tpl); $('mx-blanks').querySelector(`[data-tpl="${CSS.escape(b.dataset.tpl)}"]`)?.focus(); } });
    $('mx-blanks').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const list = state.templates || [];
      if (!d || !list.length) return;
      e.preventDefault();
      const i = list.findIndex(x => x.templateId === state.templateId);
      pickTemplate(list[(i + d + list.length) % list.length].templateId);
      $('mx-blanks').querySelector('[aria-checked="true"]')?.focus();
    });
    // Picking a colour here also changes the design's shirt colour, so the studio matches.
    function pickColor(name) {
      state.colors = [name];
      const hex = (template()?.colors || []).find(x => x.name === name)?.hex;
      const c = selectedConcept();
      if (c && hex && apparel()) c.garment = { color: hex, name };
      renderSetup();
      $('mx-colors').querySelector(`[data-color="${CSS.escape(name)}"]`)?.focus();
    }
    $('mx-colors').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) pickColor(b.dataset.color); });
    $('mx-colors').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const list = template()?.colors || [];
      if (!d || !list.length) return;
      e.preventDefault();
      const i = list.findIndex(x => x.name === state.colors[0]);
      pickColor(list[(i + d + list.length) % list.length].name);
    });
    $('mx-side').addEventListener('change', () => { state.side = $('mx-side').value; if (state.logo === state.side) state.logo = null; state.image = null; renderSetup(); });
    $('mx-logo').addEventListener('change', () => { state.logo = $('mx-logo').value || null; state.logoImage = null; if (!apparel()) state.image = null; productChanged(); });
    ['mx-title-input', 'mx-desc'].forEach(id => $(id).addEventListener('input', syncSetup));
    $('mx-price').addEventListener('input', () => { syncEarn(); syncSetup(); });
    $('mx-ack').addEventListener('change', () => { state.ack = $('mx-ack').checked; syncSetup(); });
    $('mx-to-live').addEventListener('click', () => go('live'));
    $('mx-back-studio').addEventListener('click', () => go('designs'));

    const imgUrl = m => (typeof m === 'string' ? m : m?.url || m?.transformedUrl || '');
    // Every mockup Fourthwall made, labelled by colour; click one to see it big.
    const galleries = new Map();
    let galleryN = 0;
    function galleryOf(items, label) {
      const id = `g${++galleryN}`;
      galleries.set(id, items.map((m, i) => ({ url: imgUrl(m), caption: [m?.color || label, m?.region ? String(m.region).replace(/_/g, ' ') : '', `${i + 1} of ${items.length}`].filter(Boolean).join(' · ') })));
      if (galleries.size > 30) galleries.delete(galleries.keys().next().value);
      return id;
    }
    function imagesHtml(list, label, gid = '') {
      const items = (list || []).filter(m => imgUrl(m));
      if (!items.length) return '';
      const id = gid || galleryOf(items, label);
      return `<p class="mx-meta mx-mockups__count">${items.length} mockup${items.length === 1 ? '' : 's'} · click one to enlarge</p><div class="mx-mockups__grid">${items.map((m, i) => `<figure class="mx-mock"><button class="mx-mock__btn" type="button" data-gal="${id}" data-gi="${i}" aria-label="View ${esc(m?.color || label)} mockup ${i + 1} of ${items.length}"><img src="${esc(imgUrl(m))}" alt="" loading="lazy"></button>${m?.color ? `<figcaption>${esc(m.color)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    }
    let galleryAt = { id: '', i: 0, from: null };
    function showGallery() {
      const list = galleries.get(galleryAt.id) || [];
      const it = list[galleryAt.i];
      if (!it) return;
      $('mx-gallery-img').src = it.url;
      $('mx-gallery-img').alt = it.caption;
      $('mx-gallery-cap').textContent = it.caption;
      $('mx-gallery-open').href = it.url;
      $('mx-gallery-prev').disabled = list.length < 2;
      $('mx-gallery-next').disabled = list.length < 2;
    }
    function stepGallery(d) { const n = (galleries.get(galleryAt.id) || []).length; if (n) { galleryAt.i = (galleryAt.i + d + n) % n; showGallery(); } }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-gal]');
      if (!b) return;
      galleryAt = { id: b.dataset.gal, i: Number(b.dataset.gi) || 0, from: b };
      showGallery();
      const d = $('mx-gallery');
      if (d.showModal && !d.open) d.showModal(); else d.setAttribute('open', '');
    });
    $('mx-gallery-prev').addEventListener('click', () => stepGallery(-1));
    $('mx-gallery-next').addEventListener('click', () => stepGallery(1));
    $('mx-gallery-close').addEventListener('click', () => $('mx-gallery').close());
    $('mx-gallery').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); stepGallery(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); stepGallery(1); } });
    $('mx-gallery').addEventListener('close', () => galleryAt.from?.focus?.());

    // ── Mockups: Fourthwall's live mockups first (admins), else FrameUp's preview ──
    // The key says what the mockups show; when the design, colour, area or logo
    // changes they are out of date and "Update mockups" appears.
    const mockKey = () => { const c = selectedConcept(); return c ? JSON.stringify([c.stack, c.palette, c.align, c.fit || null, c.elements || null, c.mode || '', printSpec(), state.colors[0] || '', logoSpot()]) : ''; };
    const mockFresh = () => state.mock.images.length > 0 && state.mock.key === mockKey();
    function mockStatus(text) { $('mx-mockup-status').textContent = text || ''; }
    function syncMockButton() {
      const btn = $('mx-preview');
      const gate = pushAllowed();
      const has = state.mock.images.length > 0;
      btn.hidden = !gate.ok || (has && mockFresh() && !state.mock.busy);
      btn.disabled = state.mock.busy || !template() || blockingChecks().length > 0;
      btn.setAttribute('aria-busy', String(state.mock.busy));
      btn.textContent = state.mock.busy ? 'Getting mockups…' : has ? 'Update mockups' : 'Get live mockups';
      btn.title = blockingChecks().length ? 'Fix the print check first.' : '';
    }
    function renderMockups() {
      const has = state.mock.images.length > 0;
      const fresh = mockFresh();
      const what = apparel() ? (state.colors[0] || '') : BLANK_INFO[kind()].label;
      const main = $('mx-pstage-main');
      main.querySelector('.mx-pstage__live')?.remove();
      $('mx-pstage-canvas').hidden = has;
      main.classList.toggle('is-stale', has && !fresh);
      if (has) {
        const items = state.mock.images.filter(m => imgUrl(m));
        const gid = galleryOf(items, what || 'Product');
        main.insertAdjacentHTML('beforeend', `<button class="mx-pstage__live" type="button" data-gal="${gid}" data-gi="0" aria-label="Enlarge the first Fourthwall mockup"><img src="${esc(imgUrl(items[0]))}" alt="Fourthwall mockup${what ? `, ${esc(what)}` : ''}"></button>`);
        $('mx-pstage-title').innerHTML = `Fourthwall live mockups${what ? ` · ${esc(what)}` : ''}${fresh ? '' : ' <span class="es-badge es-badge--warn">Out of date</span>'}`;
        $('mx-pstage-kind').textContent = fresh ? 'The images the shop will show.' : 'The design, colour or print area changed since. Update to see the new version.';
        $('mx-mockups').innerHTML = imagesHtml(items, what || 'Product', gid);
      } else {
        $('mx-pstage-title').textContent = 'FrameUp preview on Fourthwall’s blank photo';
        $('mx-pstage-kind').textContent = $('mx-pstage-canvas').dataset.caption || '';
        $('mx-mockups').innerHTML = pushAllowed().ok ? '' : `<p class="mx-meta">${state.status && !state.status.configured ? 'Fourthwall’s live mockups appear once Fourthwall is connected.' : 'Fourthwall makes the live mockups when an admin creates the product.'}</p>`;
      }
      if (!state.mock.busy && !state.mock.error) mockStatus(has || !pushAllowed().ok ? '' : 'Live mockups come from Fourthwall.');
      syncMockButton();
    }
    async function requestMockups() {
      const gate = pushAllowed();
      if (!gate.ok) { mockStatus(gate.text); return; }
      if (blockingChecks().length) { mockStatus('Fix the print check first.'); return; }
      if (state.mock.busy) return;
      const key = mockKey();
      state.mock.busy = true;
      state.mock.error = '';
      syncMockButton();
      try {
        const img = await ensureImages((p, text) => mockStatus(text));
        mockStatus(`Asking Fourthwall for live mockups… usually ${ETA.preview}.`);
        const body = { mode: 'preview', blank: kind(), imageId: img.imageId, region: img.region };
        if (state.colors[0]) body.color = state.colors[0];
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        state.mock = { key, images: data.images || [], busy: false, error: '' };
        mockStatus(state.mock.images.length ? '' : 'Fourthwall sent no mockups. The FrameUp preview above is close to what prints.');
      } catch (error) {
        state.mock.busy = false;
        state.mock.error = explain(error).text;
        mockStatus(`${state.mock.error} The FrameUp preview above is close to what prints.`);
      }
      state.mock.busy = false;
      if (state.step === 'setup') renderMockups();
    }
    // Admins: ask Fourthwall automatically when entering the step (once per version of the design).
    function autoMockups() {
      const key = mockKey();
      if (!state.status || !pushAllowed().ok || !template() || blockingChecks().length || state.mock.busy || mockFresh() || state.autoMockFor === key) return;
      state.autoMockFor = key;
      requestMockups();
    }
    $('mx-preview').addEventListener('click', requestMockups);

    // ── Shop collections (Fourthwall) ──
    // One picker, used in Setup (applied after create) and on the live panel.
    async function loadShopColls(force = false) {
      if ((state.shopColls && !force) || state.shopCollsBusy) { renderShopColls(); return; }
      state.shopCollsBusy = true;
      renderShopColls();
      try { const data = await api({ mode: 'collections' }); state.shopColls = data.collections || []; state.shopCollsError = ''; } catch (error) { state.shopCollsError = explain(error).text; }
      state.shopCollsBusy = false;
      renderShopColls();
    }
    function shopCollsHtml(where) {
      if (state.shopCollsBusy && !state.shopColls) return '<span class="mx-meta">Loading collections…</span>';
      if (!state.shopColls) return `<span class="mx-meta mx-meta--bad">${esc(state.shopCollsError || 'Collections didn’t load.')}</span> <button class="es-btn es-btn--sm" type="button" data-coll-act="retry">Try again</button>`;
      const picked = state.pick[where];
      const canEdit = pushAllowed().ok;
      const chips = state.shopColls.map(c => `<label class="mx-cchip"><input type="checkbox" data-coll-id="${esc(c.id)}"${picked.includes(c.id) ? ' checked' : ''}${canEdit ? '' : ' disabled'}><span>${esc(c.name)}</span>${c.count != null ? `<span class="mx-cchip__count">${esc(c.count)}</span>` : ''}</label>`).join('');
      const adding = state.newColl === where;
      return `<div class="mx-chips" role="group" aria-label="Shop collections">${chips || '<span class="mx-meta">No collections in the shop yet.</span>'}</div>
        ${adding ? `<div class="mx-newcoll"><label class="es-field mx-grow"><span class="es-sr-only">New collection name</span><input class="mx-input mx-input--sm" type="text" maxlength="60" placeholder="Collection name" data-coll-name="${where}"></label><button class="es-btn es-btn--sm" type="button" data-coll-act="add">Add</button><button class="es-btn es-btn--ghost es-btn--sm" type="button" data-coll-act="cancel">Cancel</button></div>`
        : `<button class="es-btn es-btn--ghost es-btn--sm mx-newcoll__open" type="button" data-coll-act="new"${canEdit ? '' : ` disabled title="${esc(pushAllowed().text)}"`}>New collection</button>`}
        <p class="mx-meta" data-coll-status="${where}" role="status" aria-live="polite"></p>`;
    }
    function renderShopColls() {
      document.querySelectorAll('[data-colls]').forEach(box => { box.innerHTML = shopCollsHtml(box.dataset.colls); });
    }
    function collStatus(where, text) { const el = document.querySelector(`[data-coll-status="${where}"]`); if (el) el.textContent = text; }
    async function addCollection(where) {
      const input = document.querySelector(`[data-coll-name="${where}"]`);
      const name = String(input?.value || '').trim();
      if (name.length < 2) { collStatus(where, 'Give the collection a name.'); input?.focus(); return; }
      if ((state.shopColls || []).some(c => c.name.toLowerCase() === name.toLowerCase())) { collStatus(where, 'That collection already exists. Tick it above.'); return; }
      collStatus(where, 'Creating the collection…');
      try {
        const data = await api({ mode: 'collection-create', name });
        const col = data.collection;
        if (!col?.id) throw new Error('Fourthwall didn’t create the collection. Try again.');
        if (!(state.shopColls || []).some(c => c.id === col.id)) state.shopColls = [...(state.shopColls || []), { count: 0, ...col }];
        state.pick[where] = [...new Set([...state.pick[where], col.id])];
        state.newColl = '';
        renderShopColls();
        collStatus(where, `${data.existed ? 'Ticked the existing' : 'Added'} “${col.name}”.${where === 'live' ? ' Save to put this product in it.' : ''}`);
        document.querySelector(`[data-colls="${where}"] [data-coll-id="${CSS.escape(col.id)}"]`)?.focus();
      } catch (error) { collStatus(where, explain(error).text); }
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-coll-act]');
      if (!b) return;
      const where = b.closest('[data-colls]')?.dataset.colls;
      const act = b.dataset.collAct;
      if (act === 'retry') loadShopColls(true);
      else if (act === 'new') { state.newColl = where; renderShopColls(); document.querySelector(`[data-coll-name="${where}"]`)?.focus(); }
      else if (act === 'cancel') { state.newColl = ''; renderShopColls(); document.querySelector(`[data-colls="${where}"] [data-coll-act="new"]`)?.focus(); }
      else if (act === 'add') addCollection(where);
      else if (act === 'save') saveLiveCollections();
    });
    document.addEventListener('change', e => {
      const box = e.target.closest('[data-coll-id]');
      if (!box) return;
      const where = box.closest('[data-colls]')?.dataset.colls;
      const id = box.dataset.collId;
      state.pick[where] = box.checked ? [...new Set([...state.pick[where], id])] : state.pick[where].filter(x => x !== id);
      if (where === 'live') syncLiveColls();
    });
    document.addEventListener('keydown', e => {
      const input = e.target.closest?.('[data-coll-name]');
      if (!input) return;
      if (e.key === 'Enter') { e.preventDefault(); addCollection(input.dataset.collName); }
      if (e.key === 'Escape') { e.preventDefault(); state.newColl = ''; renderShopColls(); }
    });
    async function setCollections(productId, ids) {
      const data = await api({ mode: 'collection-set', productId, collectionIds: ids });
      // The server answers with fresh counts.
      (data.collections || []).forEach(c => { const mine = (state.shopColls || []).find(x => x.id === c.id); if (mine && c.count != null) mine.count = c.count; });
      return data;
    }

    // ── Print files: render, upload, register (shared by preview and create) ──
    function pushAllowed() {
      const s = state.status;
      if (s && !s.configured) return { ok: false, text: 'Fourthwall isn’t connected yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' };
      if (s && s.canPush === false) return { ok: false, text: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' };
      if (window.matchMedia('(max-width: 900px)').matches) return { ok: false, text: 'Creating the print file needs a desktop. Open this page on a computer.' };
      return { ok: true };
    }
    function progress(pct, text) {
      $('mx-progress').hidden = pct == null;
      if (pct != null) $('mx-progress-bar').style.width = `${Math.max(2, Math.min(100, pct))}%`;
      if (text != null) $('mx-push-status').textContent = text;
    }
    function putWithProgress(url, blob, onPct) {
      // Sample data: a test can block the direct upload to exercise the relay.
      if (demo && window.__mxBlockPut) return Promise.reject(Object.assign(new Error('network'), { network: true }));
      // Sample data: the sample upload URL is not a real server, so imitate the upload (progress, then done).
      if (String(url).startsWith('/__qa/') && isDemo(window.location) && !window.__mxRealQaUpload) {
        return new Promise(resolve => { let p = 0; const t = setInterval(() => { p += 0.25; onPct(Math.min(1, p)); if (p >= 1) { clearInterval(t); resolve(); } }, 120); });
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', 'image/png');
        // Required by Google Cloud Storage's signed URL (verified on a real shop).
        xhr.setRequestHeader('x-goog-content-length-range', `0,${blob.size}`);
        xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(e.loaded / e.total); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error(`Upload failed (${xhr.status}). Try again.`), { status: xhr.status })));
        xhr.onerror = () => reject(Object.assign(new Error('network'), { network: true }));
        xhr.send(blob);
      });
    }
    // Relay step 1: the PNG goes to Supabase Storage merch-art/<user id>/<file>.png
    // with the page's own signed-in Supabase client. Returns the object path.
    async function stashArt(blob, what) {
      const file = `${Date.now().toString(36)}-${what.replace(/\W+/g, '-')}.png`;
      if (demo && window.MerchDemo?.storageUpload) { const path = `sample-user/${file}`; await window.MerchDemo.storageUpload(path, blob); return path; }
      const ready = window.ESAuth?.ensureSupabaseReady ? await window.ESAuth.ensureSupabaseReady() : false;
      const client = ready && window.ESAuth.getSupabaseClient?.();
      if (!client?.storage) throw new Error('FrameUp storage isn’t available. Try again, or ask an admin.');
      const { data } = await client.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) throw new Error('Your sign-in has expired. Sign in again, then try again.');
      const path = `${uid}/${file}`;
      const { error } = await client.storage.from(ART_BUCKET).upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) throw new Error('Couldn’t save the print file to FrameUp storage. Try again.');
      return path;
    }
    // upload-url → PUT (with progress) → register. If the direct PUT is blocked
    // (CORS / network): Supabase Storage, then upload-relay streams it to the same uploadUrl.
    async function uploadCanvas(canvas, what, region, onStatus, from, span) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error(`The ${what} couldn’t be drawn. Try again.`);
      onStatus(from, `Uploading the ${what}…`);
      const up = await api({ mode: 'upload-url', fileName: `frameup-merch-${what.replace(/\W+/g, '-')}.png`, size: blob.size, contentType: 'image/png' });
      const reg = { mode: 'register', fileUrl: up.fileUrl, width: canvas.width, height: canvas.height, blank: kind(), region };
      try {
        await putWithProgress(up.uploadUrl, blob, f => onStatus(from + f * span, `Uploading the ${what}… ${Math.round(f * 100)}%`));
      } catch (error) {
        if (!error.network) throw error;
        onStatus(from + span / 3, 'Direct upload was blocked. Sending it through FrameUp instead…');
        try {
          const path = await stashArt(blob, what);
          onStatus(from + (span * 2) / 3, 'Passing the file on to Fourthwall…');
          await api({ mode: 'upload-relay', path, bucket: ART_BUCKET, uploadUrl: up.uploadUrl, size: blob.size });
          state.relayed = (state.relayed || 0) + 1;
        } catch (relayError) {
          throw new Error(relayError.status === 501 ? 'The browser couldn’t upload the print file to Fourthwall, and the FrameUp relay isn’t switched on yet. Try again, or ask an admin.' : explain(relayError).text);
        }
      }
      const out = await api(reg);
      if (!out.imageId) throw new Error(`Fourthwall didn’t accept the ${what}. Try again.`);
      return out.imageId;
    }
    async function ensureImages(onStatus = () => {}) {
      const c = selectedConcept();
      const spec = printSpec();
      const key = JSON.stringify([c.stack, c.palette, c.align, c.fit || null, c.elements || null, c.mode || '', spec]);
      if (state.image?.key !== key) {
        onStatus(5, `Drawing the print file (${spec.pixelsWidth} × ${spec.pixelsHeight} px at ${spec.dpi} DPI)…`);
        const canvas = document.createElement('canvas');
        const out = await P('render')(c, spec, canvas, { phone: false });
        const bad = (out?.checks || []).filter(x => x.level === 'error');
        if (bad.length) throw new Error(bad[0].text);
        state.image = { key, imageId: await uploadCanvas(canvas, 'print file', spec.regionId, onStatus, 10, 45) };
      }
      const la = logoArea();
      if (la) {
        const lspec = { templateId: state.templateId, region: la.regionId, regionId: la.regionId, pixelsWidth: la.pixelsWidth, pixelsHeight: la.pixelsHeight, dpi: la.dpi, garmentColor: garmentHex() };
        const lkey = JSON.stringify(lspec);
        if (state.logoImage?.key !== lkey) {
          onStatus(58, 'Drawing the ES logo…');
          const canvas = document.createElement('canvas');
          await P('renderLogo')(lspec, canvas);
          state.logoImage = { key: lkey, imageId: await uploadCanvas(canvas, 'ES logo', la.regionId, onStatus, 60, 15) };
        }
      }
      return { imageId: state.image.imageId, region: spec.regionId, logo: la ? { region: la.regionId, imageId: state.logoImage.imageId } : null };
    }

    // ── 4 Push & live ──
    function renderLiveGate() {
      const btn = $('mx-create-fw');
      if (!btn) return;
      const gate = pushAllowed();
      $('mx-push').hidden = Boolean(state.product);
      if (state.product) return;
      btn.disabled = !gate.ok || state.busy === 'create' || !state.ack;
      const left = state.status?.caps?.person?.left;
      const colls = (state.shopColls || []).filter(c => state.pick.setup.includes(c.id)).map(c => c.name);
      if (!gate.ok) $('mx-push-status').textContent = gate.text;
      else if (state.pushError) $('mx-push-status').textContent = state.pushError;
      else if (state.busy !== 'create') $('mx-push-status').textContent = [BLANK_INFO[kind()].label, apparel() ? (state.colors[0] || 'No colour') : '', money($('mx-price').value), logoText(), colls.length ? `in ${colls.join(', ')}` : '', left != null ? `${left} create${left === 1 ? '' : 's'} left today` : 'up to 10 creates a day'].filter(Boolean).join(' · ');
    }
    $('mx-create-fw').addEventListener('click', async () => {
      const gate = pushAllowed();
      if (!gate.ok) { $('mx-push-status').textContent = gate.text; return; }
      state.busy = 'create';
      state.pushError = '';
      const btn = $('mx-create-fw');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      let collNote = '';
      try {
        const img = await ensureImages(progress);
        progress(80, `Creating the product (hidden)… ${ETA.create}.`);
        const c = selectedConcept();
        const body = {
          mode: 'create', concept: forServer(c), content: { ...contentPayload(), trend: trendBody() }, blank: kind(), imageId: img.imageId, region: img.region,
          title: $('mx-title-input').value.trim(), description: $('mx-desc').value.trim(), retail: Number($('mx-price').value),
          ack: { accepted: state.ack, items: (c.rights || []).map(r => ({ kind: r.kind, text: r.text })) },
        };
        if (state.colors[0]) body.color = state.colors[0];
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        state.product = { id: data.productId, name: data.title || body.title, description: data.description || body.description, url: data.productUrl || '', state: data.state || 'HIDDEN', price: data.price?.retail ?? body.retail, margin: data.price?.margin, images: data.images || [], color: body.color, blank: kind(), collectionIds: [] };
        if (data.caps && state.status) state.status.caps = data.caps;
        window.FrameUpTrack?.track?.('export', { tool: 'merch', action: 'fourthwall-create' });
        // Shop collections: Fourthwall replaces a collection's whole list, so the server reads first and appends.
        if (state.pick.setup.length) {
          progress(95, 'Adding it to the shop collections…');
          try { await setCollections(state.product.id, state.pick.setup); state.product.collectionIds = state.pick.setup.slice(); } catch (error) { collNote = `Created, but it wasn’t added to the collections: ${explain(error).text}`; }
        }
        state.pick.live = state.product.collectionIds.slice();
        state.list = null; // the list has a new product
        progress(null, '');
      } catch (error) {
        const why = explain(error);
        progress(null, why.text);
        state.pushError = why.text;
        if (why.kind === 'error' || why.kind === 'rate') banner(why.kind, why.text, { retry: () => $('mx-create-fw').click() });
      }
      state.busy = '';
      btn.removeAttribute('aria-busy');
      renderLiveGate();
      renderLive();
      if (collNote) $('mx-live-status').textContent = collNote;
    });

    const STATE_LABEL = { HIDDEN: ['Hidden', 'warn'], PUBLIC: ['Live', 'good'], AVAILABLE: ['Live', 'good'], PRIVATE: ['Private', 'ink'], ARCHIVED: ['Archived', 'ink'], DRAFT: ['Draft', 'ink'] };
    const stateKey = s => String(s || '').toUpperCase();
    const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    function syncLiveColls() {
      const btn = document.querySelector('[data-coll-act="save"]');
      if (btn) btn.disabled = !state.product || sameSet(state.pick.live, state.product.collectionIds || []) || !pushAllowed().ok;
    }
    function renderLive() {
      const box = $('mx-live');
      const p = state.product;
      if (!p) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      const st = stateKey(p.state);
      const [label, tone] = STATE_LABEL[st] || [p.state || 'Unknown', 'ink'];
      const live = st === 'PUBLIC' || st === 'AVAILABLE';
      const archived = st === 'ARCHIVED';
      box.innerHTML = `
        <div class="mx-row mx-row--between">
          <div class="mx-live__head">
            <h2 class="mx-h2">${esc(p.name)}</h2>
            <span class="es-badge es-badge--${tone}">${esc(label)}</span>
          </div>
          <div class="mx-row">
            ${p.url && !archived ? `<a class="es-btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open on Fourthwall</a>` : ''}
            ${archived ? '' : `<button class="es-btn" type="button" data-live="${live ? 'hide' : 'publish'}">${live ? 'Hide' : 'Publish'}</button>`}
          </div>
        </div>
        ${archived ? '<p class="mx-meta">Archived: this product is gone from the Fourthwall shop. Past orders stay in Fourthwall.</p>' : `
        <p class="mx-meta">${p.url ? `Product link: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> · ` : ''}${p.price != null ? `${money(p.price)}${p.margin != null ? `, you earn about ${money(p.margin)} a sale` : ''}` : ''}</p>
        ${(p.images || []).length ? imagesHtml(p.images, p.color || p.name) : '<p class="mx-meta">Fourthwall is still making the mockups. Check the product page in a minute.</p>'}
        ${(p.variants || []).length ? `<div class="es-table-wrap mx-variants"><table class="es-table"><caption class="es-sr-only">Variants</caption><thead><tr><th scope="col">SKU</th><th scope="col">Colour</th><th scope="col">Size</th><th scope="col">Price</th><th scope="col">Stock</th></tr></thead><tbody>${p.variants.map(v => `<tr><td>${esc(v.sku)}</td><td>${esc(v.color)}</td><td>${esc(v.size)}</td><td>${money(v.price)}</td><td>${esc(v.stock ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <fieldset class="mx-fieldset mx-shopcolls mx-shopcolls--live">
          <legend class="mx-label">Shop collections</legend>
          <div class="mx-shopcolls__body" data-colls="live"></div>
          <div class="mx-row"><button class="es-btn es-btn--sm" type="button" data-coll-act="save" disabled>Save collections</button></div>
        </fieldset>
        <div class="mx-row mx-row--between">
          <p class="mx-meta">To change title, price or art after it’s on Fourthwall, edit it in the Fourthwall dashboard.</p>
          ${p.description ? '<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-live="copy-desc">Copy description</button>' : ''}
        </div>
        <div class="mx-danger">
          <div><p class="mx-label">Archive</p><p class="mx-meta">Removes the product from Fourthwall for good. Admins only.</p></div>
          <button class="es-btn es-btn--danger es-btn--sm" type="button" data-live="archive"${archiveAllowed().ok ? '' : ` disabled title="${esc(archiveAllowed().text)}"`}>Archive…</button>
        </div>`}
        <p class="mx-meta" id="mx-live-status" role="status" aria-live="polite"></p>`;
      if (!archived) { renderShopColls(); syncLiveColls(); if (!state.shopColls) loadShopColls(); }
      if (!archived && !p.allImages && p.id) loadAllMockups(p);
    }
    // After create, Fourthwall's create reply has a few mockups; the product has them all.
    async function loadAllMockups(p) {
      p.allImages = true;
      try {
        const data = await api({ mode: 'product', productId: p.id });
        const imgs = data.product?.images || [];
        if (state.product === p && imgs.length > (p.images || []).length) { p.images = imgs; renderLive(); }
      } catch { /* the create reply's mockups stay */ }
    }
    async function saveLiveCollections() {
      const p = state.product;
      if (!p) return;
      const ids = state.pick.live.slice();
      collStatus('live', 'Saving…');
      try {
        await setCollections(p.id, ids);
        p.collectionIds = ids;
        collStatus('live', ids.length ? 'Saved. The product is in the ticked collections.' : 'Saved. The product is in no collections.');
      } catch (error) { collStatus('live', explain(error).text); }
      syncLiveColls();
    }
    $('mx-live').addEventListener('click', async e => {
      const b = e.target.closest('[data-live]');
      if (!b || !state.product) return;
      const act = b.dataset.live;
      if (act === 'archive') { openArchive({ productId: state.product.id, title: state.product.name }, b); return; }
      if (act === 'copy-desc') {
        try {
          await navigator.clipboard.writeText(state.product.description);
          window.FrameUpTrack?.track?.('copy', { tool: 'merch', action: 'description' });
          $('mx-live-status').textContent = 'Description copied. Paste it in the Fourthwall dashboard if the shop shows it empty.';
        } catch { $('mx-live-status').textContent = 'Couldn’t copy. Select the description in Setup and copy it there.'; }
        return;
      }
      b.disabled = true;
      try {
        const data = await api({ mode: act, productId: state.product.id });
        const fresh = data.product || {};
        state.product = { ...state.product, state: fresh.state && fresh.state !== 'UNKNOWN' ? fresh.state : (act === 'publish' ? 'PUBLIC' : 'HIDDEN'), url: fresh.url || state.product.url, images: fresh.images?.length ? fresh.images : state.product.images };
        state.list = null;
      } catch (error) {
        renderLive();
        $('mx-live-status').textContent = explain(error).text;
        return;
      }
      renderLive();
    });

    // ── Archive (permanent; typed-name confirm) ──
    const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    let archiveReturn = null;
    // Archive: admins only (status.canArchive), on top of the push gate.
    function archiveAllowed() {
      const gate = pushAllowed();
      if (!gate.ok) return gate;
      if (state.status && state.status.canArchive === false) return { ok: false, text: 'Only admins can archive products.' };
      return { ok: true };
    }
    function openArchive(target, from) {
      if (!archiveAllowed().ok) return;
      state.archiving = target;
      archiveReturn = from || null;
      $('mx-archive-name').textContent = target.title;
      $('mx-archive-input').value = '';
      $('mx-archive-input').setAttribute('placeholder', target.title);
      $('mx-archive-status').textContent = '';
      $('mx-archive-go').disabled = true;
      const dlg = $('mx-archive');
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      $('mx-archive-input').focus();
    }
    function closeArchive() {
      const dlg = $('mx-archive');
      if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
      state.archiving = null;
      if (archiveReturn?.isConnected) archiveReturn.focus();
      archiveReturn = null;
    }
    $('mx-archive-input').addEventListener('input', () => { $('mx-archive-go').disabled = !state.archiving || norm($('mx-archive-input').value) !== norm(state.archiving.title); });
    $('mx-archive-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!$('mx-archive-go').disabled) $('mx-archive-go').click(); } });
    $('mx-archive-cancel').addEventListener('click', closeArchive);
    $('mx-archive').addEventListener('cancel', e => { e.preventDefault(); closeArchive(); });
    $('mx-archive-go').addEventListener('click', async () => {
      const t = state.archiving;
      if (!t || norm($('mx-archive-input').value) !== norm(t.title)) return;
      const go = $('mx-archive-go');
      go.disabled = true; go.setAttribute('aria-busy', 'true');
      $('mx-archive-status').textContent = 'Archiving…';
      try {
        await api({ mode: 'archive', productId: t.productId, confirm: true, confirmName: $('mx-archive-input').value.trim() });
        if (state.product?.id === t.productId) state.product.state = 'ARCHIVED';
        const row = (state.list || []).find(r => r.productId === t.productId);
        if (row) row.state = 'ARCHIVED';
        go.removeAttribute('aria-busy');
        archiveReturn = null;
        closeArchive();
        renderLive();
        renderList();
        const msg = `“${t.title}” is archived.`;
        if (state.step === 'list') $('mx-list-updated').textContent = msg; else if ($('mx-live-status')) $('mx-live-status').textContent = msg;
        (state.step === 'list' ? $('mx-h-list') : $('mx-h-live'))?.focus?.({ preventScroll: true });
      } catch (error) {
        go.removeAttribute('aria-busy');
        go.disabled = false;
        $('mx-archive-status').textContent = explain(error).text;
      }
    });

    // ── Your merch (list + 30-day sales) ──
    const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
    const timeText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
    async function loadList() {
      state.listBusy = true;
      state.listError = '';
      $('mx-list').setAttribute('aria-busy', 'true');
      $('mx-list-refresh').disabled = true;
      renderList();
      try {
        const [list, sales] = await Promise.all([api({ mode: 'list' }), api({ mode: 'sales' }).catch(() => null)]);
        const salesOn = sales && sales.source !== 'none';
        const bySales = new Map(((salesOn && sales.products) || []).map(r => [r.productId, r]));
        state.list = (list.products || []).map(p => { const s = bySales.get(p.productId); return s ? { ...p, units30: s.units30 ?? p.units30, revenue30: s.revenue30 ?? p.revenue30, units7: s.units7, unitsAll: s.unitsAll } : { ...p }; });
        state.listSource = list.source || '';
        state.salesAt = salesOn ? sales.updatedAt || '' : '';
      } catch (error) {
        state.listError = explain(error).text;
      }
      state.listBusy = false;
      $('mx-list').setAttribute('aria-busy', 'false');
      $('mx-list-refresh').disabled = false;
      renderList();
    }
    function listRow(p) {
      const st = stateKey(p.state);
      const [label, tone] = STATE_LABEL[st] || [p.state || 'Unknown', 'ink'];
      const archived = st === 'ARCHIVED';
      const k = BLANK_INFO[p.blank] ? p.blank : 'tee';
      const can = archiveAllowed();
      return `<tr data-pid="${esc(p.productId)}">
        <td class="mx-lt__thumb">${p.thumb ? `<img src="${esc(imgUrl(p.thumb))}" alt="" width="56" height="56" loading="lazy">` : `<span class="mx-lt__ph" aria-hidden="true">${BLANK_ICON[k] || ''}</span>`}</td>
        <th scope="row" class="mx-lt__name"><span class="mx-lt__title">${esc(p.title)}</span><span class="mx-meta">${esc(BLANK_INFO[k].label)}${p.color ? ` · ${esc(p.color)}` : ''}${p.createdAt ? ` · ${esc(dateText(p.createdAt))}` : ''}${p.createdBy ? ` · ${esc(String(p.createdBy).split('@')[0])}` : ''}</span></th>
        <td><span class="es-badge es-badge--${tone}">${esc(label)}</span></td>
        <td class="mx-num">${p.units30 != null ? esc(p.units30) : '—'}</td>
        <td class="mx-num">${p.revenue30 != null ? money(p.revenue30) : '—'}</td>
        <td class="mx-lt__acts">
          ${p.url && !archived ? `<a class="es-btn es-btn--ghost es-btn--sm" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(p.title)} on Fourthwall">Open</a>` : ''}
          <button class="es-btn es-btn--ghost es-btn--sm" type="button" data-row="mockups" aria-expanded="${state.openMocks === p.productId}" aria-label="Mockups of ${esc(p.title)}">Mockups</button>
          ${archived ? '' : `<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-row="refresh" aria-label="Refresh ${esc(p.title)}">Refresh</button>`}
          ${archived ? '' : `<button class="es-btn es-btn--ghost es-btn--sm mx-lt__archive" type="button" data-row="archive" aria-label="Archive ${esc(p.title)}"${can.ok ? '' : ` disabled title="${esc(can.text)}"`}>Archive</button>`}
        </td>
      </tr>${state.openMocks === p.productId ? `<tr class="mx-lt__more" data-more="${esc(p.productId)}"><td colspan="6">${p.imagesBusy ? '<p class="mx-meta">Loading the mockups…</p>' : p.imagesError ? `<p class="mx-meta mx-meta--bad">${esc(p.imagesError)}</p>` : (p.images || []).length ? imagesHtml(p.images, p.color || p.title) : '<p class="mx-meta">Fourthwall has no mockups for this product yet.</p>'}</td></tr>` : ''}`;
    }
    async function toggleMockups(row) {
      if (state.openMocks === row.productId) { state.openMocks = ''; renderList(); return; }
      state.openMocks = row.productId;
      if (!row.imagesLoaded) {
        row.imagesBusy = true; row.imagesError = '';
        renderList();
        try {
          const data = await api({ mode: 'product', productId: row.productId });
          row.images = data.product?.images || [];
          row.imagesLoaded = true;
        } catch (error) { row.imagesError = explain(error).text; }
        row.imagesBusy = false;
      }
      renderList();
      $('mx-list').querySelector(`tr[data-pid="${CSS.escape(row.productId)}"] [data-row="mockups"]`)?.focus();
    }
    function renderList() {
      const box = $('mx-list');
      if (!box) return;
      const rows = state.list;
      $('mx-list-source').hidden = !(rows && state.listSource === 'fourthwall');
      $('mx-list-source').textContent = 'The merch history isn’t set up yet, so this list comes straight from Fourthwall: only products FrameUp made, without who made them.';
      if (state.listBusy && !rows) {
        box.innerHTML = `<div class="mx-lt-skel" aria-label="Loading your merch">${'<div class="mx-lt-skel__row"><span class="es-skeleton mx-lt-skel__img"></span><span class="es-skeleton mx-lt-skel__line"></span></div>'.repeat(3)}</div>`;
        $('mx-list-totals').hidden = true;
        return;
      }
      if (state.listError && !rows) {
        box.innerHTML = `<div class="es-error-state" role="alert"><p class="es-error-state__title">Your merch didn’t load</p><p class="es-error-state__copy">${esc(state.listError)}</p><button class="es-btn" type="button" data-list-act="retry">Try again</button></div>`;
        $('mx-list-totals').hidden = true;
        return;
      }
      if (!rows) { box.innerHTML = ''; return; }
      if (!rows.length) {
        box.innerHTML = '<div class="es-empty"><p class="es-empty__title">No merch yet</p><p class="es-empty__copy">Products you create on Fourthwall show up here, with their sales.</p><button class="es-btn es-btn--primary" type="button" data-list-act="make">Create merch</button></div>';
        $('mx-list-totals').hidden = true;
        return;
      }
      const active = rows.filter(r => stateKey(r.state) !== 'ARCHIVED');
      const live = rows.filter(r => ['PUBLIC', 'AVAILABLE'].includes(stateKey(r.state))).length;
      const units = rows.reduce((s, r) => s + (Number(r.units30) || 0), 0);
      const revenue = rows.reduce((s, r) => s + (Number(r.revenue30) || 0), 0);
      $('mx-list-totals').hidden = false;
      $('mx-list-totals').innerHTML = `<div class="mx-total"><span class="mx-total__v">${active.length}</span><span class="mx-meta">Products</span></div><div class="mx-total"><span class="mx-total__v">${live}</span><span class="mx-meta">Live in the shop</span></div><div class="mx-total"><span class="mx-total__v">${units}</span><span class="mx-meta">Units, 30 days</span></div><div class="mx-total"><span class="mx-total__v">${money(revenue)}</span><span class="mx-meta">Revenue, 30 days</span></div>`;
      box.innerHTML = `<div class="es-table-wrap mx-lt-wrap"><table class="es-table mx-lt"><caption class="es-sr-only">Your merch, with units and revenue for the last 30 days</caption>
        <thead><tr><th scope="col"><span class="es-sr-only">Mockup</span></th><th scope="col">Product</th><th scope="col">Status</th><th scope="col" class="mx-num">Units (30 days)</th><th scope="col" class="mx-num">Revenue (30 days)</th><th scope="col"><span class="es-sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map(listRow).join('')}</tbody></table></div>`;
      if (!state.listBusy) $('mx-list-updated').textContent = state.salesAt ? `Sales updated ${timeText(state.salesAt)}` : '';
    }
    $('mx-list-refresh').addEventListener('click', loadList);
    $('mx-list').addEventListener('click', async e => {
      const a = e.target.closest('[data-list-act]');
      if (a) { if (a.dataset.listAct === 'retry') loadList(); else { go('content'); } return; }
      const b = e.target.closest('[data-row]');
      if (!b) return;
      const tr = b.closest('tr');
      const row = (state.list || []).find(r => r.productId === tr.dataset.pid);
      if (!row) return;
      if (b.dataset.row === 'archive') { openArchive({ productId: row.productId, title: row.title }, b); return; }
      if (b.dataset.row === 'mockups') { toggleMockups(row); return; }
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      $('mx-list-updated').textContent = `Refreshing “${row.title}”…`;
      try {
        const data = await api({ mode: 'product', productId: row.productId, refresh: true });
        const fresh = data.product || {};
        const thumb = fresh.thumb || imgUrl((fresh.images || [])[0]);
        Object.assign(row, { state: fresh.state && fresh.state !== 'UNKNOWN' ? fresh.state : row.state, url: fresh.url || row.url, thumb: thumb || row.thumb, ...(Array.isArray(fresh.images) ? { images: fresh.images, imagesLoaded: true } : {}) });
        renderList();
        $('mx-list-updated').textContent = `“${row.title}” is up to date.`;
        $('mx-list').querySelector(`tr[data-pid="${CSS.escape(row.productId)}"] [data-row="refresh"]`)?.focus();
      } catch (error) {
        b.disabled = false;
        b.removeAttribute('aria-busy');
        $('mx-list-updated').textContent = explain(error).text;
      }
    });

    // ── Start ──
    renderMode();
    renderCollections();
    renderRules();
    renderUsing();
    syncContent();
    renderSteps();
    renderTabs();
    renderConn();
    loadStatus();
    loadMoments();
    window.MerchUI = { state, go, demo, refine, undo }; // for the UI check
  }
  // Small line icons for the blanks (decorative; 24px box, currentColor).
  const svg = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
  const BLANK_ICON = {
    tee: svg('<path d="M8 3 4 5 2 9l3 2 1-1v11h12V10l1 1 3-2-2-4-4-2c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>'),
    hoodie: svg('<path d="M8 4c1-1.5 7-1.5 8 0l4 2 2 5-3 1-1-1v10H6V11l-1 1-3-1 2-5 4-2Z"/><path d="M9 4.5c0 2 1.5 3.5 3 3.5s3-1.5 3-3.5"/>'),
    poster: svg('<rect x="5" y="2.5" width="14" height="19" rx="1"/><path d="M8 7h8M8 10h5"/>'),
    sticker: svg('<path d="M20 12a8 8 0 1 1-8-8h8v8Z"/><path d="M20 12h-4a4 4 0 0 1-4-4V4"/>'),
    mug: svg('<path d="M4 6h12v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/>'),
  };
  boot();
}());
