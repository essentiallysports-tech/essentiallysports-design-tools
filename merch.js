/* Merch Designs (merch.html): Create → Design → Publish, plus "Your merch".
   Merch5: one header bar (3-step nav + "Your merch" with a count); Create is a
   prompt card (line, moment chip, ES story link, Style, Basic | Pro) with
   trending moments under it; Design opens at once with a "making" checklist
   (Stop aborts), then a stage (On a tee / Close-up, undo + redo, print badge),
   a filmstrip (New set re-runs the brief) and a rail (Ask AI, then folds for
   Text & pills, Colours, Layout & size, Extras and Print checks, open state
   remembered); Publish has one preview (live Fourthwall mockups for admins,
   else FrameUp's photo mockup), the product form, rights and Create on
   Fourthwall, and the live panel replaces the form after create.
   Pill colours (team swatches, ES colours, custom hex, per-pill popover) are
   drawn by merch-palette.js (window.MerchPalette); this file owns the data.
   Calls /api/merch (modes status, templates, concepts, refine, moments, copy,
   upload-url, register, preview, create, publish, hide, product, archive, list,
   collections, collection-create, collection-set, sales; upload-relay as a
   fallback when the direct upload is blocked: the PNG goes to Supabase Storage
   merch-art/<user>/<file>.png first, then the server streams it to Fourthwall)
   and window.MerchPrint (preview / closeup / photoMock / photoFor / render /
   checks / fallbackConcepts / variations / elementsOf). Blanks: tee, hoodie,
   poster, sticker, mug. merch-stub.js stands in for anything MerchPrint lacks.
   window.MerchGuidelines (merch-guidelines.js) gives the "How the AI designs"
   bullets; the page works without it.
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
    { id: 'quote', label: 'Quote', blurb: 'An exact quote, printed word for word.' },
    { id: 'core', label: 'Core', blurb: 'Lines that are ours.' },
    { id: 'current', label: 'Current', blurb: 'This week’s story.' },
  ];
  const COLLECTION_LABEL = { auto: 'Auto', replay: 'Replay', nickname: 'Nickname', quote: 'In their own words', core: 'Core ES', current: 'Current' };
  const RIGHTS_LABEL = { name: 'Name', nickname: 'Nickname', quote: 'Quote', team: 'Team colours' };
  const STEPS = ['content', 'designs', 'publish'];
  const VIEWS = ['content', 'designs', 'publish', 'list'];
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
    basic: { label: 'Basic', note: 'Simple ES pill designs. Quick, and light on your AI usage.', hint: '4 designs · ES pills · about 15 s', count: 4 },
    pro: { label: 'Pro', note: 'Smarter AI (more usage), richer designs with extra elements, chat edits.', hint: '6 designs · AI art director, extras · about 40 s', count: 6 },
  };
  const MODE_STORE = 'frameup.merch.aiMode';
  const FOLD_STORE = 'mx.folds';
  const FOLDS = ['text', 'colors', 'layout', 'extras', 'checks'];
  const FELL = {
    cap: 'You’ve used this week’s Pro designs, so Basic made these. Basic still works.',
    free: 'FrameUp is in free mode right now, so Basic made these.',
    ai: 'The smarter AI didn’t answer, so Basic made these.',
  };
  const FELL_SHORT = { cap: 'weekly AI limit reached', free: 'free mode', ai: 'Pro didn’t answer' };
  const KIND_LABEL = { quote: 'Quote', nickname: 'Nickname', moment: 'Moment', era: 'Era', stat: 'Stat', rivalry: 'Rivalry' };
  const KIND_COLLECTION = { quote: 'quote', nickname: 'nickname', era: 'replay', moment: 'current', stat: 'current', rivalry: 'current' };
  const SUGGESTIONS = ['Shorter', 'Use team colours', 'Add the nickname', 'Bolder', 'Centre it', 'Dark tee'];
  const SIZES = [['big', 'Big'], ['mid', 'Mid'], ['small', 'Small']];
  const EL_LABEL = { number: 'Number', rule: 'Rule', block: 'Block', icon: 'Icon' };
  const POS_LABEL = { behind: 'Behind', above: 'Above', below: 'Below', between: 'Between', left: 'Left' };
  const EL_COLORS = [['a', 'Team colour 1'], ['b', 'Team colour 2'], ['ink', 'Ink colour'], ['white', 'White'], ['black', 'Black']];
  const SPORT_ICON = { nba: 'basketball', wnba: 'basketball', ncaab: 'basketball', basketball: 'basketball', nfl: 'football', ncaaf: 'football', football: 'football', mlb: 'baseball', baseball: 'baseball', soccer: 'soccer', mls: 'soccer', epl: 'soccer', nhl: 'hockey', hockey: 'hockey', golf: 'golf', pga: 'golf', liv: 'golf', tennis: 'tennis', f1: 'racing-flag', nascar: 'racing-flag', racing: 'racing-flag', motorsport: 'racing-flag' };
  // The making checklist: [id, label, proOnly]; times (ms) when each step starts, per mode.
  const MAKING = [['read', 'Reading your line'], ['rules', 'Checking ES merch rules'], ['plan', 'Planning the idea', true], ['draw', 'Drawing {n} designs'], ['check', 'Print-checking']];
  const MAKING_AT = { basic: { read: 0, rules: 1200, draw: 2800, check: 12000 }, pro: { read: 0, rules: 1500, plan: 4000, draw: 10000, check: 32000 } };
  const PROGRESS = [['draw', 'Drawing the print file', 0], ['upload', 'Uploading to Fourthwall', 10], ['create', 'Creating the product (hidden)', 78], ['colls', 'Adding it to shop collections', 94]];
  const WHITE = '#FFFFFF';
  const BLACK = '#101114';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
  const $ = id => document.getElementById(id);
  // Markup-tolerant helpers: a missing element is skipped, never a crash.
  const on = (id, ev, fn, opts) => { const el = $(id); if (el) el.addEventListener(ev, fn, opts); return el; };
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; return el; };
  const setHtml = (id, h) => { const el = $(id); if (el) el.innerHTML = h; return el; };
  const show = (el, yes) => { const x = typeof el === 'string' ? $(el) : el; if (x) x.hidden = !yes; return x; };
  const val = id => ($(id)?.value ?? '');
  const clone = o => JSON.parse(JSON.stringify(o));
  const sameHex = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
  const normHex = v => { const s = String(v || '').trim(); return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : ''; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // A radio in a radiogroup, or a toggle button.
  function setOn(btn, yes) {
    if (!btn) return;
    if (btn.getAttribute('role') === 'radio') { btn.setAttribute('aria-checked', String(yes)); btn.tabIndex = yes ? 0 : -1; } else btn.setAttribute('aria-pressed', String(yes));
    btn.classList.toggle('is-on', yes);
  }
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' })); }, { once: true });
  });

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
    if (!window.MerchStub) await loadScript('merch-stub.js?v=20261126-merch5');
  }
  const P = fn => (typeof window.MerchPrint?.[fn] === 'function' ? window.MerchPrint : window.MerchStub)[fn];
  const MP = () => window.MerchPrint || {};
  const PAL = () => window.MerchPalette || null;

  async function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    if (!$('mx-steps')) return;
    const demo = isDemo(window.location);
    const scenario = new URLSearchParams(window.location.search).get('state') || 'ok';
    await ensurePrint();
    if (demo && !window.MerchDemo) await loadScript('merch-demo.js?v=20261126-merch6');

    const readMode = () => { try { return window.localStorage.getItem(MODE_STORE) === 'pro' ? 'pro' : 'basic'; } catch { return 'basic'; } };
    const state = {
      step: 'content', status: null, statusError: '',
      aiMode: readMode(), collection: 'auto', trend: null,
      moments: null, momentsBusy: false, momentsError: '', momentsNote: '', momentsAt: '', sport: '',
      concepts: [], selected: null, conceptsFree: false, busy: '', plan: null, madeMode: '', fellBack: '',
      making: null, // { at, stage, abort, mode }
      view: 'tee', history: {}, future: [], lastEdit: {}, chat: {}, notes: {}, refining: false, pal: {}, errCount: {}, proNote: false,
      templates: null, templatesError: '', templateId: '', colors: [], colorNote: '', side: 'front', placement: '', copyFor: '', copyMsg: '',
      ack: false, mock: { key: '', images: [], busy: false, error: '' }, autoMockFor: '',
      image: null, logo: null, logoImage: null, product: null, pushError: '', progAt: 0, progFailed: false,
      shopColls: null, shopCollsError: '', pick: { setup: [], live: [] }, newColl: '',
      list: null, listCount: null, listError: '', listSource: '', salesAt: '', listBusy: false, archiving: null,
    };

    // ── API ──
    async function api(body, { signal } = {}) {
      if (demo && window.MerchDemo) {
        // Sample data: long enough for the making checklist to show.
        await wait(body.mode === 'concepts' ? 1400 : 150, signal);
        const [status, data] = window.MerchDemo.reply(body, scenario);
        if (status >= 400 || data.ok === false) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status, reason: data.reason, data });
        return data;
      }
      if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { status: 0 });
      const response = await window.ESAuth.fetchWithAuth('/api/merch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
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
      if (!el) return;
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
      if (!el) return;
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
      if (state.step === 'publish') { syncPublish(); renderMockups(); autoMockups(); }
      loadListCount();
    }

    // ── Basic / Pro (in the prompt card) ──
    const modeOf = b => b.dataset.mode || b.dataset.ai;
    function renderMode() {
      document.querySelectorAll('#mx-mode [data-mode], #mx-mode [data-ai]').forEach(b => setOn(b, modeOf(b) === state.aiMode));
      setText('mx-mode-hint', AI_MODES[state.aiMode].hint);
      setText('mx-mode-note', AI_MODES[state.aiMode].note);
      const box = $('mx-mode-box');
      if (box) box.dataset.mode = state.aiMode;
    }
    function setMode(mode) {
      if (!AI_MODES[mode] || mode === state.aiMode) return;
      state.aiMode = mode;
      try { window.localStorage.setItem(MODE_STORE, mode); } catch { /* private mode: remembered for this visit only */ }
      renderMode();
      syncContent();
      if (state.step === 'designs' && selectedConcept()) { renderElements(selectedConcept()); renderChatNote(); renderFoldMeta(); }
      track('merch', { action: 'ai-mode', mode });
    }
    on('mx-mode', 'click', e => { const b = e.target.closest('[data-mode],[data-ai]'); if (b) { setMode(modeOf(b)); b.focus(); } });
    on('mx-mode', 'keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      setMode(state.aiMode === 'pro' ? 'basic' : 'pro');
      $('mx-mode').querySelector(`[data-mode="${state.aiMode}"],[data-ai="${state.aiMode}"]`)?.focus();
    });

    // ── Steps: Create → Design → Publish (+ Your merch) ──
    const normStep = s => (s === 'setup' || s === 'live' ? 'publish' : s);
    function canGo(step) {
      const s = normStep(step);
      if (s === 'content' || s === 'list') return true;
      if (s === 'designs') return Boolean(state.making) || state.concepts.length > 0;
      if (s === 'publish') return !state.making && Boolean(selectedConcept()) && !blockingChecks().length;
      return false;
    }
    let lastMakeStep = 'content';
    function go(step, { focus = 'heading' } = {}) {
      const s = normStep(step);
      if (!VIEWS.includes(s) || !canGo(s)) return false;
      const from = state.step;
      state.step = s;
      if (s !== 'list') lastMakeStep = s;
      VIEWS.forEach(v => show(`mx-view-${v}`, v === s));
      closePop(false);
      renderSteps();
      renderListTab();
      if (s === 'designs') enterStudio();
      if (s === 'publish') enterPublish();
      if (s === 'list' && !state.list && !state.listBusy) loadList();
      if (from !== s) track('merch', { action: 'step', step: s, from });
      if (focus === 'heading') { const h = $(`mx-h-${s}`); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
      window.scrollTo(0, 0);
      return true;
    }
    function renderSteps() {
      const at = STEPS.indexOf(state.step);
      document.querySelectorAll('#mx-steps [data-step]').forEach(b => {
        const step = normStep(b.dataset.step);
        const i = STEPS.indexOf(step);
        const current = i === at;
        b.disabled = !current && !canGo(step);
        b.classList.toggle('is-done', at >= 0 && i < at);
        b.classList.toggle('is-current', current);
        if (current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
    }
    on('mx-steps', 'click', e => { const b = e.target.closest('[data-step]'); if (b && !b.disabled) go(b.dataset.step); });
    // "Your merch": its own view; the button toggles back to where you were.
    function renderListTab() {
      const b = $('mx-tab-list');
      if (!b) return;
      const onList = state.step === 'list';
      b.classList.toggle('is-on', onList);
      if (onList) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    on('mx-tab-list', 'click', () => go(state.step === 'list' ? lastMakeStep : 'list'));
    function renderListCount() {
      const el = $('mx-list-count');
      if (!el) return;
      const n = state.list ? state.list.filter(r => stateKey(r.state) !== 'ARCHIVED').length : state.listCount;
      el.hidden = n == null || n === 0;
      el.textContent = n == null ? '' : String(n);
      if (n != null) el.setAttribute('aria-label', `${plural(n, 'product')}`);
    }
    // The count only (no sales call): one light read when the page opens.
    async function loadListCount() {
      if (state.list || state.listCount != null || state.listCountBusy) return;
      state.listCountBusy = true;
      try { const data = await api({ mode: 'list' }); state.listCount = (data.products || []).filter(p => stateKey(p.state) !== 'ARCHIVED').length; } catch { /* the badge stays empty */ }
      state.listCountBusy = false;
      renderListCount();
    }
    // Any [data-go] link or button moves between views.
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b || b.disabled) return;
      e.preventDefault();
      const to = b.dataset.go;
      if (to === 'content') { go('content', { focus: 'none' }); $('mx-text')?.focus({ preventScroll: true }); return; }
      go(to);
    });

    // ── 1 Create ──
    function renderCollections() {
      const sel = $('mx-collection');
      if (sel && sel.tagName === 'SELECT') {
        if (!sel.options.length) sel.innerHTML = COLLECTIONS.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
        sel.value = state.collection;
        sel.title = COLLECTIONS.find(c => c.id === state.collection)?.blurb || '';
      }
    }
    function pickCollection(id) {
      state.collection = COLLECTIONS.some(c => c.id === id) ? id : 'auto';
      renderCollections();
    }
    on('mx-collection', 'change', () => pickCollection(val('mx-collection')));
    function renderRules() {
      const list = Array.isArray(window.MerchGuidelines?.SUMMARY) ? window.MerchGuidelines.SUMMARY.filter(x => typeof x === 'string' && x.trim()) : [];
      show('mx-rules', list.length > 0);
      setHtml('mx-rules-list', list.map(x => `<li>${esc(x)}</li>`).join(''));
    }
    // "+ ES story link" reveals the link field (the toggle's aria-controls, else #mx-url).
    function urlTarget() { const t = $('mx-url-toggle'); return $(t?.getAttribute('aria-controls') || '') || $('mx-url'); }
    function renderUrl(open) {
      const t = $('mx-url-toggle');
      const box = urlTarget();
      if (!t || !box) return;
      const isOpen = open ?? (Boolean(val('mx-url').trim()) || !box.hidden);
      box.hidden = !isOpen;
      t.setAttribute('aria-expanded', String(isOpen));
    }
    on('mx-url-toggle', 'click', () => {
      const box = urlTarget();
      const open = Boolean(box?.hidden);
      renderUrl(open);
      if (open) $('mx-url')?.focus();
    });

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
    const TIMING_LABEL = { now: 'Sell now', week: 'This week', season: 'All season', evergreen: 'Evergreen' };
    const ANGLE_LABEL = { quote: 'Quote', nickname: 'Nickname', chant: 'Chant', callback: 'Callback', pun: 'Wordplay', stat: 'Stat', rivalry: 'Rivalry', era: 'Era' };
    const linesOf = m => { const l = (Array.isArray(m.lines) ? m.lines : []).filter(x => x && x.text); return l.length ? l.slice(0, 3) : (m.line ? [{ text: m.line, angle: 'callback' }] : []); };
    function momentCard(m) {
      const on_ = state.trend && String(state.trend.momentId || state.trend.id) === String(m.id);
      const score = Math.max(0, Math.min(100, Math.round(Number(m.score) || 0)));
      const where = [sportOf(m), teamName(m.team)].filter(Boolean).join(' · ');
      const kind = KIND_LABEL[m.kind] ? m.kind : 'moment';
      return `<article class="es-tile mx-moment${on_ ? ' is-on' : ''}" data-mid="${esc(m.id)}">
        <div class="mx-moment__top">
          <span class="es-badge mx-kind mx-kind--${esc(kind)}">${esc(KIND_LABEL[kind])}</span>
          ${where ? `<span class="mx-moment__where">${esc(where)}</span>` : ''}
          <span class="mx-score" title="Merch score: how well this could sell as a shirt"><span class="es-sr-only">Merch score </span><span class="mx-score__bar" style="--v:${score}%" aria-hidden="true"></span><span class="mx-score__n">${score}</span></span>
        </div>
        <h3 class="mx-moment__title">${esc(m.title)}</h3>
        <div class="mx-moment__sell">
          <p class="mx-moment__label">Why it works${m.timing && TIMING_LABEL[m.timing] ? ` <span class="mx-moment__timing">${esc(TIMING_LABEL[m.timing])}</span>` : ''}</p>
          ${m.why ? `<p class="mx-moment__why">${esc(m.why)}</p>` : ''}
          ${m.audience ? `<p class="mx-moment__who"><span>Who buys it</span> ${esc(m.audience)}</p>` : ''}
        </div>
        <div class="mx-moment__print">
          <p class="mx-moment__label">What to print</p>
          <ul class="mx-mlines">${linesOf(m).map((l, n) => {
            const picked = on_ && state.trend?.momentLine === n;
            return `<li class="mx-mline${picked ? ' is-on' : ''}">
              <span class="mx-mline__pill">${esc(l.text)}</span>
              <span class="mx-mline__angle">${esc(ANGLE_LABEL[l.angle] || 'Idea')}</span>
              <button class="es-btn es-btn--sm${picked ? ' is-on' : ''}" type="button" data-moment-line="${esc(m.id)}" data-line="${n}" aria-pressed="${Boolean(picked)}" aria-label="Design “${esc(l.text)}”">${picked ? 'In your brief' : 'Design this'}</button>
            </li>`;
          }).join('')}</ul>
        </div>
        ${m.ai === false ? '<p class="mx-moment__quick">Quick pick, made without AI. Refresh later for more ideas.</p>' : ''}
      </article>`;
    }
    function renderMoments() {
      const box = $('mx-moments');
      if (!box) return;
      const list = state.moments;
      box.setAttribute('aria-busy', String(state.momentsBusy));
      const refresh = $('mx-moments-refresh');
      if (refresh) { refresh.disabled = state.momentsBusy; window.FrameUpMotion?.busy?.(refresh, state.momentsBusy); }
      const sports = [...new Set((list || []).map(sportOf).filter(Boolean))];
      show('mx-moments-sports', sports.length >= 2);
      setHtml('mx-moments-sports', ['', ...sports].map(s => `<button class="es-chip" type="button" aria-pressed="${state.sport === s}" data-sport="${esc(s)}">${s ? esc(s) : 'All'}</button>`).join(''));
      if (state.momentsBusy && !list) {
        box.innerHTML = '<span class="es-sr-only">Loading moments…</span>' + '<div class="es-tile mx-moment mx-moment--skel" aria-hidden="true"><span class="es-skeleton mx-skel mx-skel--tag"></span><span class="es-skeleton mx-skel mx-skel--title"></span><span class="es-skeleton mx-skel mx-skel--line"></span><span class="es-skeleton mx-skel mx-skel--short"></span></div>'.repeat(6);
        return;
      }
      if (state.momentsError && !list) {
        box.innerHTML = `<div class="es-error-state mx-moments__state" role="alert"><p class="es-error-state__title">Moments didn’t load</p><p class="es-error-state__copy">${esc(state.momentsError)} You can still write your own line.</p><button class="es-btn es-btn--sm" type="button" data-moments="retry">Try again</button></div>`;
        return;
      }
      if (!list) { box.innerHTML = ''; return; }
      const shown = list.filter(m => !state.sport || sportOf(m) === state.sport);
      if (!shown.length) {
        box.innerHTML = `<div class="es-empty mx-moments__state"><p class="es-empty__title">No merch-worthy moments right now.</p><p class="es-empty__copy">${state.momentsNote ? `${esc(state.momentsNote)} ` : ''}Refresh, or write your own line.</p></div>`;
        return;
      }
      box.innerHTML = shown.map(momentCard).join('');
      setText('mx-moments-meta', state.momentsAt ? `Today’s trends, scored for merch. Updated ${timeText(state.momentsAt)}.` : 'Today’s trends, scored for merch.');
    }
    on('mx-moments-refresh', 'click', loadMoments);
    on('mx-moments-sports', 'click', e => { const b = e.target.closest('[data-sport]'); if (!b) return; state.sport = b.dataset.sport; renderMoments(); $('mx-moments-sports').querySelector(`[data-sport="${CSS.escape(state.sport)}"]`)?.focus(); });
    on('mx-moments', 'click', e => {
      if (e.target.closest('[data-moments=retry]')) { loadMoments(); return; }
      const b = e.target.closest('[data-moment-line],[data-moment-use],[data-design]');
      if (!b) return;
      const id = b.dataset.momentLine ?? b.dataset.momentUse ?? b.dataset.design;
      const m = (state.moments || []).find(x => String(x.id) === id);
      if (m) useMoment(m, b.dataset.line != null ? Number(b.dataset.line) : null);
    });
    // "Use this": the moment becomes the chip in the prompt card and goes with the
    // concepts call; its suggested line fills the brief only when the brief is empty.
    // A picked line ("Design this") always goes into the brief; "Use this" (old
    // markup) only fills an empty brief.
    function useMoment(m, lineIndex = null) {
      const t = m.trend && typeof m.trend === 'object' ? m.trend : {};
      const lines = linesOf(m);
      state.trend = { ...t, id: t.id || m.id, title: t.title || m.title, sport: t.sport || t.category || m.sport || '', momentId: m.id, momentKind: KIND_LABEL[m.kind] ? m.kind : 'moment', momentLine: lineIndex };
      if (m.team && !state.trend.team) state.trend.team = m.team;
      const text = $('mx-text');
      const pick = lineIndex != null ? lines[lineIndex]?.text : null;
      const filled = Boolean(text && (pick || !text.value.trim()));
      if (filled) text.value = pick || m.line || m.title;
      const coll = (m.collection && m.collection !== 'core' && m.collection) || KIND_COLLECTION[m.kind];
      if (coll) pickCollection(coll);
      renderChip();
      renderMoments();
      syncContent();
      track('merch', { action: 'moment', kind: m.kind || '', filled, line: lineIndex, ai: m.ai !== false });
      $('mx-prompt')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      $(filled ? 'mx-create' : 'mx-text')?.focus({ preventScroll: true });
    }
    function renderChip() {
      const el = $('mx-moment-chip');
      if (el) {
        el.hidden = !state.trend;
        el.innerHTML = state.trend ? `<span class="mx-chip__text">Moment: ${esc(state.trend.title)} · ${esc(KIND_LABEL[state.trend.momentKind] || 'Moment')}</span><button class="mx-chip__x" type="button" data-chip-clear aria-label="Remove the moment ${esc(state.trend.title)}">×</button>` : '';
      }
      // Older markup: "Using: …" line.
      show('mx-using', Boolean(state.trend));
      setText('mx-using-title', state.trend ? state.trend.title : '');
    }
    function clearTrend() { state.trend = null; renderChip(); renderMoments(); syncContent(); $('mx-text')?.focus(); }
    on('mx-moment-chip', 'click', e => { if (e.target.closest('[data-chip-clear]')) clearTrend(); });
    on('mx-using-clear', 'click', clearTrend);

    // The trend as the server takes it (normalizeTrend): the trend fields, no page-only extras.
    function trendBody() {
      if (!state.trend) return null;
      const { momentId, momentKind, ...t } = state.trend;
      return { ...t, id: t.id || momentId };
    }
    function contentPayload() {
      const raw = val('mx-text').trim();
      const inText = (raw.match(/https?:\/\/\S+/) || [''])[0];
      return { text: raw.replace(inText, '').trim(), url: val('mx-url').trim() || inText };
    }
    const hasContent = () => { const c = contentPayload(); return c.text.length > 1 || /^https?:\/\/\S+\.\S+/.test(c.url); };
    function syncContent() {
      const has = hasContent();
      const btn = $('mx-create');
      if (btn) btn.disabled = !has || Boolean(state.making);
      const neu = $('mx-strip-new');
      if (neu) neu.disabled = !has || Boolean(state.making);
      if (state.making) return;
      setText('mx-content-meta', has ? '' : 'Add a line, a link, or pick a moment to start.');
    }
    ['mx-text', 'mx-url'].forEach(id => {
      on(id, 'input', syncContent);
      on(id, 'keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$('mx-create')?.disabled) createDesigns(); } });
    });
    on('mx-create', 'click', () => createDesigns());

    // ── Making: the checklist while the AI works (Stop aborts) ──
    let makingTimer = 0;
    const makingSteps = m => MAKING.filter(s => !s[2] || m.mode === 'pro');
    function stageBox() { return $('mx-stage-canvas')?.closest('.mx-stage') || $('mx-stage-canvas')?.parentElement || null; }
    function renderMaking() {
      const m = state.making;
      const box = stageBox();
      const empty = !m && !state.concepts.length;
      if (box) box.dataset.state = m ? 'making' : empty ? 'empty' : 'ready';
      ['mx-making', 'mx-making-time', 'mx-stop'].forEach(id => show(id, Boolean(m)));
      const wrap = $('mx-making')?.parentElement;
      if (wrap && wrap !== box && /making/.test(wrap.className || '')) wrap.hidden = !m;
      show('mx-empty-stage', empty);
      show('mx-stage-canvas', !m && !empty);
      if (!m) return;
      const steps = makingSteps(m);
      const n = AI_MODES[m.mode].count;
      const check = window.FrameUpMotion?.check ? window.FrameUpMotion.check('mx-making__check') : '✓';
      setHtml('mx-making', steps.map(([id, label, pro], i) => {
        const done = i < m.stage;
        const active = i === m.stage;
        return `<li class="mx-making__step${done ? ' is-done' : ''}${active ? ' is-active' : ''}" data-making-step="${id}"${pro ? ' data-pro' : ''}${active ? ' aria-current="step"' : ''}><span class="mx-making__mark" aria-hidden="true">${done ? check : ''}</span><span class="mx-making__label">${esc(label.replace('{n}', n))}</span>${done ? '<span class="es-sr-only"> (done)</span>' : ''}</li>`;
      }).join(''));
      const s = Math.floor((Date.now() - m.at) / 1000);
      setText('mx-making-time', `${s} s`);
    }
    function tickMaking() {
      const m = state.making;
      if (!m) { clearInterval(makingTimer); return; }
      const steps = makingSteps(m);
      const at = MAKING_AT[m.mode];
      const t = Date.now() - m.at;
      let stage = 0;
      steps.forEach(([id], i) => { if (at[id] != null && t >= at[id]) stage = i; });
      if (stage > m.stage && !m.done) m.stage = stage;
      const before = $('mx-making-time')?.textContent;
      const sec = `${Math.floor(t / 1000)} s`;
      if (m.lastStage !== m.stage) { m.lastStage = m.stage; renderMaking(); } else if (before !== sec) setText('mx-making-time', sec);
    }
    function startMaking(mode) {
      const m = { at: Date.now(), stage: 0, abort: new AbortController(), mode, lastStage: 0 };
      state.making = m;
      clearInterval(makingTimer);
      makingTimer = setInterval(tickMaking, 250);
      return m;
    }
    function endMaking() { clearInterval(makingTimer); state.making = null; }
    function stopMaking() {
      const m = state.making;
      if (!m) return;
      try { m.abort.abort(); } catch { /* already done */ }
      endMaking();
      state.busy = '';
      syncCreateBtn();
      track('merch', { action: 'stop', mode: m.mode, ms: Date.now() - m.at });
      go('content', { focus: 'none' });
      setText('mx-content-meta', 'Stopped. Your brief is still here.');
      $('mx-text')?.focus();
    }
    on('mx-stop', 'click', stopMaking);
    function syncCreateBtn() {
      const btn = $('mx-create');
      if (!btn) return;
      if (state.making) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
      const label = btn.querySelector('.mx-create__label') || null;
      const text = state.making ? 'Creating designs…' : 'Create designs';
      if (label) label.textContent = text;
      else if (!btn.children.length) btn.textContent = text;
      syncContent();
    }

    async function createDesigns() {
      if (state.making || !hasContent()) return;
      const content = contentPayload();
      const trend = trendBody();
      const asked = state.aiMode;
      const m = startMaking(asked);
      state.busy = 'concepts';
      syncCreateBtn();
      go('designs');
      let concepts = null, free = false, data = null, freeWhy = '';
      try {
        const body = { mode: 'concepts', content, [AI_KEY]: asked };
        if (trend) body.trend = trend;
        if (state.collection !== 'auto') body.collection = state.collection;
        data = await api(body, { signal: m.abort.signal });
        if (data.free || !Array.isArray(data.concepts) || !data.concepts.length) free = true; else concepts = data.concepts;
        if (free && data?.fellBack) freeWhy = data.fellBack;
      } catch (error) {
        if (error.name === 'AbortError' || state.making !== m) return; // Stop
        const why = explain(error);
        if (why.kind === 'setup' || why.kind === 'error' || why.kind === 'rate') free = true; // designs never need Fourthwall: fall back to code concepts
        if (why.kind === 'rate' || why.kind === 'cap') banner(why.kind, why.text);
      }
      if (state.making !== m) return;
      if (free) {
        if (!freeWhy) banner('free', 'Free mode: designs are made without AI this time. They still follow the ES style.'); // a Pro fallback is explained in the studio
        concepts = await P('fallbackConcepts')({ ...content, trend, collection: state.collection });
        if (state.making !== m) return;
        state.conceptsFree = true;
        state.plan = null;
        state.madeMode = 'free';
        state.fellBack = asked === 'pro' ? freeWhy : '';
      } else {
        if ($('mx-banner')?.dataset.kind === 'free') banner(null);
        state.conceptsFree = false;
        state.plan = data.plan && (data.plan.idea || data.plan.angle) ? data.plan : null;
        const dm = data[AI_KEY];
        state.madeMode = dm === 'pro' || dm === 'basic' ? dm : asked;
        state.fellBack = data.fellBack || (asked === 'pro' && state.madeMode === 'basic' ? 'ai' : '');
      }
      // The person's own line always comes back whole ("Your words"), even when the AI shortened it.
      try {
        if (MP().yourWords && Array.isArray(concepts) && content.text && !concepts.some(c => MP().hasLine(c, content.text))) { const mine = MP().yourWords(content); if (mine) concepts = [mine, ...concepts]; }
      } catch (error) { console.warn('merch your words', error); }
      const pro = state.madeMode === 'pro';
      const next = (concepts || []).map(c => {
        const x = { ...c, garment: { ...(c.garment || { color: WHITE, name: 'White' }) }, mode: pro ? (c.mode || 'pro') : 'basic' };
        if (!pro) delete x.elements; // Basic is pills only
        return x;
      });
      // Print-checking, then a check mark before the designs show.
      m.done = true;
      m.stage = makingSteps(m).length;
      renderMaking();
      await wait(450);
      if (state.making !== m) return;
      endMaking();
      state.busy = '';
      syncCreateBtn();
      if (!next.length) {
        go('content', { focus: 'none' });
        setText('mx-content-meta', 'No designs came back. Try different words.');
        $('mx-text')?.focus();
        return;
      }
      state.concepts = next;
      state.selected = next[0].id;
      state.history = {}; state.future = []; state.chat = {}; state.notes = {}; state.lastEdit = {}; state.pal = {}; state.errCount = {};
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false;
      state.image = null; state.copyFor = ''; state.product = null; state.progFailed = false;
      track('merch', { action: 'concepts', mode: state.madeMode, asked, count: next.length, trend: Boolean(trend) });
      if (state.step === 'designs') enterStudio(); else renderSteps();
    }

    // ── 2 Design studio ──
    const selectedConcept = () => state.concepts.find(c => c.id === state.selected) || null;
    const conceptLabel = c => c.label || COLLECTION_LABEL[c.collection] || 'Design';
    function replaceConcept(next) {
      const i = state.concepts.findIndex(c => c.id === next.id);
      if (i >= 0) state.concepts[i] = next;
      return next;
    }
    // Templates load once, when the studio opens (real tee colours and photos) or in Publish.
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
      if (state.making || !selectedConcept()) return;
      if (!state.templates) {
        ensureTemplates().then(ok => {
          if (state.step !== 'designs' || state.making) return;
          if (!ok) { renderTeeColors(); return; }
          if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
          renderTeeColors(); renderPalette(); renderViewToggle(); renderFit(); renderStudioChecks(); syncDesigns(); drawStage(); renderFoldMeta();
        });
      } else if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
    }
    function renderStudio() {
      renderMaking();
      renderMadeMode();
      renderStrip();
      if (state.making || !selectedConcept()) { syncDesigns(); return; }
      renderViewToggle();
      renderEditor();
      renderStudioChecks();
      drawStage();
      syncDesigns();
    }
    function renderMadeMode() {
      const m = state.madeMode;
      const making = Boolean(state.making);
      const b = $('mx-made-mode');
      if (b) {
        b.hidden = !m || making;
        b.className = `es-badge es-badge--${m === 'pro' ? 'brand' : m === 'free' ? 'warn' : 'ink'}`;
        b.textContent = m === 'pro' ? 'Made with Pro' : m === 'free' ? 'Made without AI' : 'Made with Basic';
      }
      const fell = making ? '' : m === 'free' && state.fellBack ? `Pro wasn’t used (${FELL_SHORT[state.fellBack] || 'not available'}), so these were made without AI. They still follow the ES style.` : FELL[state.fellBack] || (state.fellBack ? 'Pro wasn’t used this time, so Basic made these.' : '');
      show('mx-fell', Boolean(fell));
      setText('mx-fell', fell);
      setText('mx-designs-sub', state.conceptsFree ? `Made without AI${state.fellBack ? ' this time' : ' (free mode)'}. Pick a design and edit it by hand.` : 'Pick a design, then edit it by hand or tell the AI what to change.');
      const p = making ? null : state.plan;
      show('mx-idea', Boolean(p));
      if ($('mx-idea-text')) {
        setText('mx-idea-text', p?.idea || '');
        setText('mx-idea-angle', p?.angle ? `Angle: ${p.angle}` : '');
      } else setText('mx-idea', p ? [p.idea ? `The idea: ${p.idea}` : '', p.angle ? `Angle: ${p.angle}` : ''].filter(Boolean).join(' · ') : '');
    }

    // Filmstrip: every design as a small close-up; skeleton tiles while making.
    const thumbSpec = () => { const s = printSpec(); return { pixelsWidth: s.pixelsWidth, pixelsHeight: s.pixelsHeight, dpi: s.dpi }; };
    const filmBtn = id => $('mx-strip')?.querySelector(`[data-pick="${CSS.escape(id)}"]`);
    async function drawThumb(c) {
      if (!c) return;
      const cv = filmBtn(c.id)?.querySelector('canvas');
      if (!cv) return;
      try {
        if (MP().closeup) await MP().closeup(c, c.garment?.color, cv, { kind: kind(), spec: thumbSpec(), pad: 0.12 });
        else await P('preview')(c, c.garment?.color, cv, { size: 224, kind: kind() });
      } catch (error) { console.warn('merch thumb', error); }
    }
    function renderStrip() {
      const box = $('mx-strip');
      if (!box) return;
      // "New set" may sit inside the strip as its last tile: keep it there.
      const neu = $('mx-strip-new');
      const keepNew = neu && box.contains(neu) ? neu : null;
      if (keepNew) keepNew.remove();
      box.setAttribute('role', 'radiogroup');
      if (!box.getAttribute('aria-label')) box.setAttribute('aria-label', 'Designs');
      if (state.making) {
        box.setAttribute('aria-busy', 'true');
        box.innerHTML = '<div class="mx-film mx-film__skel es-skeleton" aria-hidden="true"></div>'.repeat(AI_MODES[state.making.mode].count);
      } else {
        box.setAttribute('aria-busy', 'false');
        box.innerHTML = state.concepts.map(c => {
          const sel = c.id === state.selected;
          const pro = (MP().elementsOf ? MP().elementsOf(c) : (c.elements || [])).length > 0;
          return `<button class="mx-film${sel ? ' is-on' : ''}" type="button" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-pick="${esc(c.id)}" data-id="${esc(c.id)}" title="${esc(c.title)}" aria-label="${esc(conceptLabel(c))}: ${esc(c.title)}${c.variantOf ? ', variation' : ''}">
            <canvas class="mx-film__img" width="192" height="224" aria-hidden="true"></canvas>
            <span class="mx-film__label">${esc(conceptLabel(c))}</span>
            ${c.variantOf || pro ? `<span class="mx-film__tags">${c.variantOf ? '<span class="mx-film__tag">Variation</span>' : ''}${pro ? '<span class="mx-film__tag mx-film__tag--pro">Extras</span>' : ''}</span>` : ''}
          </button>`;
        }).join('');
      }
      if (keepNew) box.append(keepNew);
      setText('mx-strip-count', state.making ? '' : plural(state.concepts.length, 'design'));
      syncContent();
      if (!state.making) state.concepts.forEach(drawThumb);
    }
    function selectDesign(id, focus = false) {
      if (id === state.selected || state.making) return;
      state.selected = id;
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false;
      state.image = null; state.copyFor = '';
      closePop(false);
      if (template()) pickColorFor(selectedConcept());
      $('mx-strip')?.querySelectorAll('[data-pick]').forEach(b => { const sel = b.dataset.pick === id; b.classList.toggle('is-on', sel); b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
      if (focus) filmBtn(id)?.focus();
      renderEditor();
      renderStudioChecks();
      drawStage();
      syncDesigns();
    }
    function stepDesign(d, focus = false) {
      const n = state.concepts.length;
      if (!n) return;
      const i = state.concepts.findIndex(c => c.id === state.selected);
      selectDesign(state.concepts[(i + d + n) % n].id, focus);
    }
    on('mx-strip', 'click', e => { const b = e.target.closest('[data-pick]'); if (b) selectDesign(b.dataset.pick); });
    on('mx-strip', 'keydown', e => {
      if (!e.target.closest('[data-pick]')) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d && !['Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const n = state.concepts.length;
      if (!n) return;
      if (e.key === 'Home') selectDesign(state.concepts[0].id, true);
      else if (e.key === 'End') selectDesign(state.concepts[n - 1].id, true);
      else stepDesign(d, true);
    });
    // "New set": the same brief again.
    on('mx-strip-new', 'click', () => { if (hasContent()) createDesigns(); else go('content'); });

    // The big stage: "On a tee" = FrameUp's composite on Fourthwall's real blank
    // photo in the chosen colour (flat drawn tee when there is no photo);
    // "Close-up" = the print on the shirt colour.
    function photoChoice(garment) {
      const t = template() || defaultTemplate();
      if (!t || !MP().photoFor || !BLANK_INFO[kindOf(t)].apparel) return null;
      try { const r = MP().photoFor(t.colors || [], garment || WHITE); return r?.url ? { url: r.url, hex: r.color?.hex || garment, name: r.color?.name || '' } : null; } catch { return null; }
    }
    // Draws the design on a fresh canvas, then copies it to the visible one (no half-drawn frames).
    async function paint(c, view, { garment } = {}) {
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
    const rightsText = c => ((c.rights || []).length ? [...new Set(c.rights.map(r => RIGHTS_LABEL[r.kind] || r.kind))].join(', ') : 'none found');
    async function drawStage() {
      const c = selectedConcept();
      if (!c || state.making) return;
      const t = ++tokens.stage;
      const { off, caption } = await paint(c, state.view, {});
      if (t !== tokens.stage) return;
      const cv = $('mx-stage-canvas');
      if (!cv) return;
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', `${conceptLabel(c)} design, ${state.view === 'closeup' ? 'close-up' : `on a ${nounLower()}`}: ${(c.stack || []).map(r => r.text).join(' / ')}`);
      cv.title = caption;
      // The caption is the one rights display in Design.
      const cap = $('mx-stage-cap');
      if (cap) cap.innerHTML = `<span class="mx-stage__title">${esc(c.title || 'Untitled design')}</span> · <span class="mx-stage__rights">Rights: ${esc(rightsText(c))}</span>`;
    }
    const nounLower = () => BLANK_INFO[kind()].noun.toLowerCase();
    function renderViewToggle() {
      document.querySelectorAll('#mx-view-toggle [data-view], [data-stage]').forEach(b => {
        const v = b.dataset.view || b.dataset.stage;
        setOn(b, v === state.view);
        if (v === 'tee' && !b.children.length) b.textContent = `On a ${nounLower()}`;
        else if (v === 'tee') { const l = b.querySelector('.mx-view__label'); if (l) l.textContent = `On a ${nounLower()}`; }
      });
    }
    function setView(v) {
      if (!['tee', 'closeup'].includes(v) || v === state.view) return;
      state.view = v;
      renderViewToggle();
      drawStage();
    }
    document.querySelectorAll('#mx-view-toggle [data-view], [data-stage]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view || b.dataset.stage)));

    // Print checks in the Checks fold; errors block "Continue to Publish".
    function renderStudioChecks() {
      const c = selectedConcept();
      renderChecks('mx-studio-checks', 'mx-studio-checks-card');
      const errs = c ? blockingChecks().length : 0;
      // Opens itself when a design gets a new problem (not every redraw).
      if (c && errs > 0 && !(state.errCount[c.id] > 0)) {
        const fold = $('mx-fold-checks');
        if (fold && !fold.open) { fold.dataset.auto = '1'; fold.open = true; }
      }
      if (c) state.errCount[c.id] = errs;
      renderBadge();
      renderFoldMeta();
    }
    function renderBadge() {
      const b = $('mx-stage-badge');
      if (!b) return;
      const c = selectedConcept();
      if (!c || state.making) { b.hidden = true; return; }
      b.hidden = false;
      const n = blockingChecks().length;
      b.className = `es-badge es-badge--${n ? 'bad' : 'good'} mx-stage__badge`;
      b.dataset.state = n ? 'bad' : 'ok';
      b.textContent = n ? `${n} to fix` : 'Print-ready';
      b.setAttribute('aria-label', n ? `${plural(n, 'print problem')} to fix. Show the print checks` : 'Print-ready. Show the print checks');
      if (b.tagName !== 'BUTTON' && !b.hasAttribute('tabindex')) { b.tabIndex = 0; b.setAttribute('role', 'button'); }
    }
    function openChecks() {
      const fold = $('mx-fold-checks');
      if (!fold) return;
      fold.open = true;
      fold.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const first = $('mx-studio-checks')?.querySelector('.mx-check-row--error') || fold.querySelector('summary');
      first?.focus({ preventScroll: true });
    }
    on('mx-stage-badge', 'click', openChecks);
    on('mx-stage-badge', 'keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.currentTarget.tagName !== 'BUTTON') { e.preventDefault(); openChecks(); } });
    on('mx-design-blocker', 'click', openChecks);
    function syncDesigns() {
      const c = selectedConcept();
      const bad = c && !state.making ? blockingChecks() : [];
      const blocked = !c || bad.length > 0 || Boolean(state.making);
      const btn = $('mx-to-setup');
      if (btn) btn.disabled = blocked;
      show('mx-design-blocker', bad.length > 0);
      setText('mx-design-blocker', bad.length ? `Fix ${plural(bad.length, 'print check')} first` : '');
      setText('mx-designs-meta', state.making ? 'Making your designs…' : !c ? 'Choose a design.' : `${conceptLabel(c)} · ${c.title}`);
      const u = $('mx-undo');
      if (u) u.disabled = !c || state.making || !(state.history[c.id] || []).length;
      const r = $('mx-redo');
      if (r) r.disabled = !c || state.making || !state.future.some(f => f.id === c.id);
      renderBadge();
      renderSteps();
    }

    // ── Folds: open state remembered (mx.folds), meta kept current ──
    const readFolds = () => { try { return JSON.parse(window.localStorage.getItem(FOLD_STORE) || '{}') || {}; } catch { return {}; } };
    function initFolds() {
      const saved = readFolds();
      FOLDS.forEach(f => {
        const d = $(`mx-fold-${f}`);
        if (!d) return;
        if (typeof saved[f] === 'boolean' && f !== 'checks') d.open = saved[f];
        d.addEventListener('toggle', () => {
          if (d.dataset.auto) { delete d.dataset.auto; return; } // opened by the page, not the person
          const s = readFolds();
          s[f] = d.open;
          try { window.localStorage.setItem(FOLD_STORE, JSON.stringify(s)); } catch { /* private mode: this visit only */ }
        });
      });
    }
    function renderFoldMeta() {
      const c = selectedConcept();
      if (!c) return;
      const rows = (c.stack || []).length;
      setText('mx-fold-text-meta', plural(rows, 'pill'));
      const from = c.paletteFrom;
      const pillWord = from?.kind === 'team' ? from.team || 'Team colours' : from?.kind === 'es' ? (PAL()?.helpers().ES_SWATCHES.find(s => sameHex(s.bg, c.palette?.a))?.label || 'ES colours') : from?.kind === 'custom' ? `Custom ${normHex(c.palette?.a) || ''}`.trim() : c.team?.name || 'Design colours';
      setText('mx-fold-colors-meta', `${apparel() ? `${c.garment?.name || 'White'} ${nounLower()}` : 'White'} · ${pillWord}`);
      const f = MP().fitOf ? MP().fitOf(c) : { scale: 1 };
      setText('mx-fold-layout-meta', `${Math.round((f.scale || 1) * 100)}% · ${c.align === 'center' ? 'Centre' : 'Left'}`);
      const els = Array.isArray(c.elements) ? c.elements.length : 0;
      setText('mx-fold-extras-meta', state.aiMode === 'pro' ? `${els} of 3` : els ? `${els} · Pro` : 'Pro only');
      const list = printChecks();
      const errs = list.filter(x => x.level === 'error').length;
      const warns = list.filter(x => x.level === 'warn').length;
      setText('mx-fold-checks-meta', errs ? `${errs} to fix` : warns ? `Print-ready · ${plural(warns, 'warning')}` : 'Print-ready');
    }

    // ── Editor ──
    // Undo: a per-design stack of snapshots (state.history); redo: state.future
    // [{ id, snap }]. Bursts of typing or sliding are one step; a new edit clears redo.
    function remember(c, tag = '') {
      const now = Date.now();
      const h = state.history[c.id] || (state.history[c.id] = []);
      if (tag && state.lastEdit.id === c.id && state.lastEdit.tag === tag && now - state.lastEdit.at < 1500) { state.lastEdit.at = now; return; }
      h.push(clone(c));
      if (h.length > 30) h.shift();
      state.future = state.future.filter(f => f.id !== c.id);
      state.lastEdit = { id: c.id, tag, at: now };
    }
    function restore(prev, note) {
      replaceConcept(prev);
      state.lastEdit = {};
      if (template() && state.colors[0] !== prev.garment?.name) pickColorFor(prev);
      state.notes[prev.id] = { text: note, tone: 'info' };
      renderEditor();
      designChanged();
    }
    function undo() {
      const c = selectedConcept();
      const h = state.history[c?.id] || [];
      if (!h.length || state.making) return;
      state.future.push({ id: c.id, snap: clone(c) });
      if (state.future.length > 60) state.future.shift();
      restore(h.pop(), 'Undone: back to the version before.');
      track('merch', { action: 'undo' });
    }
    function redo() {
      const c = selectedConcept();
      if (!c || state.making) return;
      let i = -1;
      for (let j = state.future.length - 1; j >= 0; j--) if (state.future[j].id === c.id) { i = j; break; }
      if (i < 0) return;
      const [{ snap }] = state.future.splice(i, 1);
      (state.history[c.id] || (state.history[c.id] = [])).push(clone(c));
      restore(snap, 'Redone.');
      track('merch', { action: 'redo' });
    }
    on('mx-undo', 'click', () => { undo(); $('mx-undo')?.focus({ preventScroll: true }); });
    on('mx-redo', 'click', () => { redo(); $('mx-redo')?.focus({ preventScroll: true }); });
    let drawT = 0;
    function designChanged() {
      const c = selectedConcept();
      state.image = null;
      clearTimeout(drawT);
      drawT = setTimeout(() => { drawStage(); drawThumb(c); }, 80);
      renderStudioChecks();
      renderFit();
      syncDesigns();
      renderFoldMeta();
    }
    function renderEditor() {
      const c = selectedConcept();
      if (!c) return;
      // Older markup: the design header in the editor.
      if ($('mx-ed-tags')) {
        const tags = [`<span class="mx-tag">${esc(conceptLabel(c))}</span>`];
        if (c.variantOf) tags.push('<span class="mx-design__team">Variation</span>');
        if (c.team?.name) tags.push(`<span class="mx-design__team">${esc(c.team.name)}</span>`);
        setHtml('mx-ed-tags', tags.join(''));
        setText('mx-ed-title', c.title || 'Untitled design');
        setText('mx-ed-why', c.why || '');
        show('mx-ed-why', Boolean(c.why));
      }
      renderPills(c);
      renderFit();
      renderTeeColors();
      renderPalette();
      renderElements(c);
      renderChatNote();
      syncChat();
      renderFoldMeta();
    }

    // Pills: text (60), size, colour dot (popover), order, remove, add (10 max).
    const keyHex = (c, key) => (key === 'white' ? WHITE : key === 'black' ? BLACK : key === 'a' || key === 'b' || key === 'ink' ? (c.palette?.[key] || (key === 'a' ? '#0A7DFA' : key === 'b' ? '#033162' : WHITE)) : normHex(key) || c.palette?.a || '#0A7DFA');
    const colorWord = hex => (MP().colorName ? MP().colorName(hex) : hex);
    const fillWord = (c, r) => { const f = r.fill || 'a'; return f === 'a' ? 'team colour 1' : f === 'b' ? 'team colour 2' : f === 'white' ? 'white' : f === 'black' ? 'black' : `${colorWord(keyHex(c, f)).toLowerCase()} (${normHex(f)})`; };
    function renderPills(c) {
      const stack = c.stack || [];
      setHtml('mx-pills', stack.map((r, i) => {
        const n = i + 1;
        const bg = keyHex(c, r.fill || 'a');
        const ink = keyHex(c, r.ink || (r.fill === 'b' ? 'ink' : 'white'));
        return `<div class="mx-pill" data-row="${i}">
          <div class="mx-pill__top">
            <button class="mx-pill__dot" type="button" data-pill-color="${i}" aria-haspopup="dialog" aria-expanded="false" aria-controls="mx-pill-pop" style="--sw:${esc(bg)};--sw-ink:${esc(ink)}" aria-label="Pill ${n} colour: ${esc(fillWord(c, r))}. Change" title="Pill colour"></button>
            <input class="mx-input mx-input--sm" type="text" value="${esc(r.text)}" maxlength="60" aria-label="Pill ${n} text" data-pill-text="${i}">
            <button class="mx-icon es-icon-btn" type="button" data-pill-act="up" data-i="${i}" aria-label="Move pill ${n} up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="mx-icon es-icon-btn" type="button" data-pill-act="down" data-i="${i}" aria-label="Move pill ${n} down"${i === stack.length - 1 ? ' disabled' : ''}>↓</button>
            <button class="mx-icon es-icon-btn" type="button" data-pill-act="drop" data-i="${i}" aria-label="Remove pill ${n}"${stack.length < 2 ? ' disabled' : ''}>×</button>
          </div>
          <div class="es-segmented es-segmented--sm mx-pill__sizes" role="group" aria-label="Pill ${n} size">${SIZES.map(([k, l]) => `<button class="es-segmented__item" type="button" data-pill-size="${k}" data-i="${i}" aria-pressed="${(r.size || 'big') === k}">${l}</button>`).join('')}</div>
        </div>`;
      }).join(''));
      const add = $('mx-pill-add');
      if (add) {
        add.disabled = stack.length >= 10;
        if (!add.children.length) add.textContent = stack.length >= 10 ? '10 pills is the most' : 'Add a pill';
        add.title = stack.length >= 10 ? '10 pills is the most' : '';
      }
    }
    // A hand edit to the pills is the new "as designed" for words per pill.
    const pillsEdited = c => { c.designedStack = null; c.split = ''; };
    on('mx-pills', 'input', e => {
      const input = e.target.closest('[data-pill-text]');
      if (!input) return;
      const c = selectedConcept();
      const i = Number(input.dataset.pillText);
      remember(c, `text${i}`);
      c.stack[i] = { ...c.stack[i], text: input.value.slice(0, 60) };
      pillsEdited(c);
      designChanged();
    });
    on('mx-pills', 'click', e => {
      const dot = e.target.closest('[data-pill-color]');
      if (dot) { if (popOpen() && pop.i === Number(dot.dataset.pillColor)) closePop(); else openPop(Number(dot.dataset.pillColor), dot); return; }
      const b = e.target.closest('[data-pill-act],[data-pill-size]');
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
      else { (state.history[c.id] || []).pop(); return; }
      c.stack = s;
      pillsEdited(c);
      renderPills(c);
      designChanged();
      if (focus) $('mx-pills').querySelector(focus)?.focus();
    });
    on('mx-pill-add', 'click', () => {
      const c = selectedConcept();
      if (!c) return;
      const s = c.stack || [];
      if (s.length >= 10) return;
      remember(c);
      const last = s[s.length - 1] || { size: 'big', fill: 'a', ink: 'white' };
      const keyed = last.fill === 'a' || last.fill === 'b' || !last.fill;
      c.stack = [...s, keyed ? { ...last, text: 'New pill', fill: last.fill === 'a' || !last.fill ? 'b' : 'a', ink: last.fill === 'a' || !last.fill ? 'ink' : 'white' } : { ...last, text: 'New pill' }];
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
      if (!list.length) { setText('mx-fit-read', 'No other layouts fit these words. Edit the pills and try again.'); return; }
      const root = c.variantOf || c.id;
      const keep = state.concepts.filter(x => x.variantOf !== root || x.id === c.id);
      const pos = keep.findIndex(x => x.id === c.id);
      const fresh = list.filter(v => v.id !== c.id).map(v => ({ ...v, variantOf: root, mode: c.mode, paletteFrom: c.paletteFrom, garment: { ...(v.garment || {}) } }));
      state.concepts = [...keep.slice(0, pos + 1), ...fresh, ...keep.slice(pos + 1)];
      renderStrip();
      track('merch', { action: 'variations', count: fresh.length });
      setText('mx-fit-read', `${plural(fresh.length, 'layout')} added after “${conceptLabel(c)}” in the filmstrip.`);
      filmBtn(fresh[0]?.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    on('mx-vary', 'click', () => { const c = selectedConcept(); if (c) addVariations(c); });

    // ── Pill colours: the Colours fold (design) and the per-pill popover ──
    const palHelpers = () => PAL()?.helpers() || null;
    const designGarment = c => (apparel() ? normHex(c?.garment?.color) || WHITE : WHITE);
    // The Sport / Team shown for a design: the person's last pick, its recorded
    // team palette, else its own team (ES_BRAND_KIT name match).
    function palTeam(c) {
      if (state.pal[c.id]) return state.pal[c.id];
      const from = c.paletteFrom;
      if (from?.kind === 'team' && from.sport && from.team) return { sport: from.sport, team: from.team };
      const hit = PAL()?.findTeam(c.team?.name || state.trend?.team?.name || (typeof state.trend?.team === 'string' ? state.trend.team : ''));
      return hit ? { sport: hit.sport, team: hit.team } : { sport: '', team: '' };
    }
    function designCurrent(c) {
      const from = c.paletteFrom;
      if (!from) return null;
      if (from.kind === 'team') return { kind: 'team', team: from.team, index: from.index, hex: c.palette?.a };
      return { kind: from.kind, hex: c.palette?.a };
    }
    let designPicker = null;
    function ensureDesignPicker() {
      if (designPicker || !PAL() || !$('mx-pal-swatches')) return designPicker;
      designPicker = PAL().picker(
        { sport: $('mx-pal-sport'), team: $('mx-pal-team'), swatches: $('mx-pal-swatches'), es: $('mx-pal-es'), custom: $('mx-pal-custom'), hex: $('mx-pal-hex'), warn: $('mx-pal-warn') },
        { onPick: pickDesignColour, onTeam: t => { const c = selectedConcept(); if (c) state.pal[c.id] = t; } },
      );
      return designPicker;
    }
    function renderPalette() {
      const c = selectedConcept();
      const p = ensureDesignPicker();
      if (!c || !p) return;
      p.render({ ...palTeam(c), current: designCurrent(c), garment: designGarment(c), noun: nounLower() });
    }
    function addTeamRight(c, team) {
      if (!team) return;
      c.rights = Array.isArray(c.rights) ? c.rights : [];
      if (c.rights.some(r => r.kind === 'team' && String(r.text).toLowerCase() === team.toLowerCase())) return;
      c.rights = [...c.rights, { kind: 'team', text: team }];
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false; // new rights item: tick again
    }
    // Design-level pick: a team swatch sets the palette from the brand kit; an ES
    // colour or a custom colour becomes palette.a (b kept when it still reads).
    function pickDesignColour(pick) {
      const c = selectedConcept();
      const H = palHelpers();
      if (!c || !H) return;
      remember(c, 'palette');
      if (pick.kind === 'team') {
        const pal = pick.entry ? H.paletteFromKit(pick.entry, pick.index) : null;
        if (!pal) return;
        c.palette = { ...(c.palette || {}), ...pal };
        c.paletteFrom = { kind: 'team', sport: pick.sport, team: pick.team, index: pick.index };
        state.pal[c.id] = { sport: pick.sport, team: pick.team };
        addTeamRight(c, pick.team);
      } else {
        const a = normHex(pick.hex);
        if (!a) return;
        const cmp = PAL().contrast;
        let b = normHex(c.palette?.b);
        if (!b || sameHex(a, b) || cmp(a, b) < 1.6) b = cmp(a, WHITE) >= cmp(a, '#000000') ? WHITE : '#000000';
        c.palette = { ...(c.palette || {}), a, b, ink: H.pillInk(b, [a]) };
        c.paletteFrom = { kind: pick.kind === 'es' ? 'es' : 'custom' };
      }
      track('merch', { action: 'palette', scope: 'design', kind: pick.kind });
      renderPills(c);
      designChanged();
    }
    // The popover (#mx-pill-pop): the same options for one pill, plus "Use design colours".
    const pop = { i: -1, from: null, picker: null };
    const popOpen = () => { const el = $('mx-pill-pop'); return Boolean(el && !el.hidden && pop.i >= 0); };
    function ensurePopPicker() {
      const el = $('mx-pill-pop');
      if (!el || !PAL()) return null;
      if (pop.picker) return pop.picker;
      const q = k => el.querySelector(`[data-pal="${k}"]`);
      if (!q('swatches')) {
        const body = el.querySelector('[data-pop-body]') || el;
        body.innerHTML = `${body === el ? '<p class="mx-pop__title" id="mx-pill-pop-title" data-pop-title>Pill colour</p>' : ''}
          <p class="mx-label">Team colours</p><div class="mx-swatches" data-pal="swatches"></div>
          <p class="mx-label">ES colours</p><div class="mx-swatches" data-pal="es"></div>
          <div class="mx-pal-custom"><label class="mx-label mx-pal-custom__pick">Custom <input type="color" data-pal="custom" aria-label="Custom pill colour"></label><input class="mx-input mx-input--sm" type="text" data-pal="hex" maxlength="7" placeholder="#RRGGBB" spellcheck="false" autocomplete="off" aria-label="Custom pill colour as a hex code"></div>
          <p class="mx-meta mx-pal-warn" data-pal="warn" role="status" aria-live="polite" hidden></p>
          ${el.querySelector('[data-pill-reset]') ? '' : '<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-pill-reset>Use design colours</button>'}`;
        if (body === el && !el.getAttribute('aria-labelledby')) el.setAttribute('aria-labelledby', 'mx-pill-pop-title');
      }
      if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
      pop.picker = PAL().picker({ swatches: q('swatches'), es: q('es'), custom: q('custom'), hex: q('hex'), warn: q('warn') }, { onPick: pickPillColour });
      el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); } });
      el.addEventListener('click', e => { if (e.target.closest('[data-pill-reset]')) resetPill(); else if (e.target.closest('[data-pop-close]')) closePop(); });
      return pop.picker;
    }
    function placePop(el, btn) {
      const r = btn.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.zIndex = '60';
      const w = el.offsetWidth || 300;
      const h = el.offsetHeight || 260;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    }
    function openPop(i, btn) {
      const el = $('mx-pill-pop');
      const c = selectedConcept();
      const p = ensurePopPicker();
      if (!el || !c || !p || !c.stack?.[i]) return;
      if (popOpen()) closePop(false);
      pop.i = i; pop.from = btn;
      const row = c.stack[i];
      const hex = normHex(row.fill);
      const H = palHelpers();
      const isEs = hex && H?.ES_SWATCHES.some(s => sameHex(s.bg, hex));
      p.render({ ...palTeam(c), current: hex ? { kind: isEs ? 'es' : 'custom', hex } : null, garment: designGarment(c), noun: nounLower() });
      const title = el.querySelector('[data-pop-title]');
      if (title) title.textContent = `Pill ${i + 1} colour`;
      el.setAttribute('aria-label', `Pill ${i + 1} colour`);
      if (typeof el.show === 'function' && el.tagName === 'DIALOG') { if (!el.open) el.show(); }
      el.hidden = false;
      placePop(el, btn);
      btn.setAttribute('aria-expanded', 'true');
      p.focusFirst();
    }
    function closePop(restore = true) {
      const el = $('mx-pill-pop');
      if (!el || el.hidden) { pop.i = -1; return; }
      if (el.tagName === 'DIALOG' && el.open && typeof el.close === 'function') el.close();
      el.hidden = true;
      const from = pop.from;
      from?.setAttribute('aria-expanded', 'false');
      pop.i = -1; pop.from = null;
      if (restore && from?.isConnected) from.focus();
    }
    // Esc closes it even when focus fell out of it (e.g. a re-rendered swatch).
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && popOpen() && !e.defaultPrevented) { e.preventDefault(); closePop(); } });
    document.addEventListener('pointerdown', e => {
      if (!popOpen()) return;
      if (e.target.closest('#mx-pill-pop') || e.target.closest('[data-pill-color]')) return;
      closePop(false);
    });
    window.addEventListener('resize', () => { if (popOpen() && pop.from?.isConnected) placePop($('mx-pill-pop'), pop.from); });
    // After the pills re-render the dot is a new element: point the popover at it.
    function refindDot() {
      const dot = $('mx-pills')?.querySelector(`[data-pill-color="${pop.i}"]`);
      if (dot) { pop.from = dot; dot.setAttribute('aria-expanded', 'true'); }
    }
    function pickPillColour(pick) {
      const c = selectedConcept();
      const H = palHelpers();
      const i = pop.i;
      if (!c || !H || !c.stack?.[i]) return;
      const hex = normHex(pick.hex);
      if (!hex) return;
      remember(c, `pill-color-${i}`);
      const others = c.stack.map((r, j) => (j === i ? '' : keyHex(c, r.fill || 'a'))).filter(Boolean);
      c.stack = c.stack.map((r, j) => (j === i ? { ...r, fill: hex, ink: pick.kind === 'team' && normHex(pick.ink) ? normHex(pick.ink) : H.pillInk(hex, others) } : r));
      if (pick.kind === 'team') addTeamRight(c, pick.team);
      pillsEdited(c);
      track('merch', { action: 'palette', scope: 'pill', kind: pick.kind });
      renderPills(c);
      refindDot();
      designChanged();
    }
    function resetPill() {
      const c = selectedConcept();
      const i = pop.i;
      if (!c || !c.stack?.[i]) return;
      remember(c);
      const fill = i % 2 ? 'b' : 'a';
      c.stack = c.stack.map((r, j) => (j === i ? { ...r, fill, ink: fill === 'a' ? 'white' : 'ink' } : r));
      pillsEdited(c);
      track('merch', { action: 'palette', scope: 'pill', kind: 'reset' });
      renderPills(c);
      refindDot();
      designChanged();
      closePop();
    }

    // Size and layout (the person's own fit, saved on the design).
    const DEFAULT_TOP_IN = 1.75;
    function renderFit() {
      const c = selectedConcept();
      if (!c || !$('mx-fit-scale')) return;
      const f = MP().fitOf ? MP().fitOf(c) : { scale: 1, topIn: null };
      $('mx-fit-scale').value = Math.round(f.scale * 100);
      setText('mx-fit-scale-out', `${Math.round(f.scale * 100)}%`);
      show('mx-fit-top-row', apparel());
      if ($('mx-fit-split')) $('mx-fit-split').value = c.split || '';
      document.querySelectorAll('[data-fit-align]').forEach(b => setOn(b, (c.align === 'center' ? 'center' : 'left') === b.dataset.fitAlign));
      let read = '';
      try {
        const sc = MP().layout(c, printSpec());
        const top = sc.designIn?.top ?? DEFAULT_TOP_IN;
        if (apparel() && $('mx-fit-top')) { $('mx-fit-top').value = f.topIn ?? Math.round(top * 4) / 4; setText('mx-fit-top-out', `${Number($('mx-fit-top').value).toFixed(2)} in`); }
        read = `Prints ${sc.designIn.w.toFixed(1)} × ${sc.designIn.h.toFixed(1)} in${apparel() ? `, ${top.toFixed(1)} in below the top of the print area` : ''}.`;
      } catch (error) { console.warn('merch fit', error); }
      setText('mx-fit-read', read);
    }
    on('mx-fit-scale', 'input', () => { const c = selectedConcept(); if (!c) return; remember(c, 'scale'); c.fit = { ...(c.fit || {}), scale: Number(val('mx-fit-scale')) / 100 }; designChanged(); });
    on('mx-fit-top', 'input', () => { const c = selectedConcept(); if (!c) return; remember(c, 'top'); c.fit = { ...(c.fit || {}), topIn: Number(val('mx-fit-top')) }; designChanged(); });
    on('mx-fit-split', 'change', () => {
      const c = selectedConcept();
      if (!c) return;
      const mode = val('mx-fit-split');
      remember(c);
      if (!c.designedStack) c.designedStack = (c.stack || []).map(r => ({ ...r }));
      if (!mode) { c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; renderPills(c); designChanged(); return; }
      const base = c.designedStack;
      const smalls = base.filter((r, i) => r.size === 'small' && i > 0);
      const words = base.filter(r => !smalls.includes(r)).map(r => r.text).join(' ');
      const parts = MP().splitWords(words, mode);
      if (parts.length > 9) { (state.history[c.id] || []).pop(); setText('mx-fit-read', 'That makes too many pills for one print. Pick another option.'); $('mx-fit-split').value = c.split || ''; return; }
      const first = base[0] || { fill: 'a', ink: 'white' };
      const second = base.find((r, i) => i > 0 && r.size !== 'small') || { fill: first.fill === 'a' ? 'b' : 'a', ink: 'ink' };
      c.stack = [...parts.map((t, i) => ({ text: t, size: 'big', fill: (i % 2 ? second : first).fill, ink: (i % 2 ? second : first).ink })), ...smalls.map(r => ({ ...r }))];
      c.split = mode;
      renderPills(c);
      designChanged();
    });
    document.querySelectorAll('[data-fit-align]').forEach(b => b.addEventListener('click', () => { const c = selectedConcept(); if (!c || (c.align === 'center' ? 'center' : 'left') === b.dataset.fitAlign) return; remember(c); c.align = b.dataset.fitAlign; designChanged(); }));
    on('mx-fit-reset', 'click', () => { const c = selectedConcept(); if (!c) return; remember(c); c.fit = { scale: 1, topIn: null }; if (c.designedStack) c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; renderPills(c); designChanged(); });

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
      const box = $('mx-tee-colors');
      if (!c || !box) return;
      const t = template();
      const hard = t && !apparel();
      box.hidden = hard;
      if (hard) { setText('mx-tee-colors-note', `A ${BLANK_INFO[kind()].label.toLowerCase()} prints on white. Change the product in Publish.`); return; }
      const { real, list } = teeColorChoices(c);
      const cur = currentTee(c, list);
      box.setAttribute('role', 'radiogroup');
      if (!box.getAttribute('aria-label')) box.setAttribute('aria-label', `${BLANK_INFO[kind()].noun} colour`);
      setText('mx-tee-colors-label', `${BLANK_INFO[kind()].noun} colour`);
      box.innerHTML = list.map(g => { const sel = g === cur; return `<button class="mx-swatch${PAL()?.isLight(g.color) ? ' is-light' : ''}" type="button" role="radio" aria-checked="${sel}" tabindex="${sel || (!cur && g === list[0]) ? 0 : -1}" style="--sw:${esc(g.color)}" aria-label="${esc(g.name)}" title="${esc(g.name)}" data-hex="${esc(g.color)}" data-name="${esc(g.name)}"></button>`; }).join('');
      setText('mx-tee-colors-note', `${cur ? cur.name : c.garment?.name || ''}${real ? ' · Fourthwall’s colours for this blank' : state.templatesError ? ' · the shop’s colours didn’t load' : ' · loading the shop’s colours…'}`);
    }
    function pickTee(btn) {
      const c = selectedConcept();
      if (!c || !btn) return;
      remember(c);
      c.garment = { color: btn.dataset.hex, name: btn.dataset.name };
      if (template() && (template().colors || []).some(x => x.name === btn.dataset.name)) state.colors = [btn.dataset.name];
      state.colorNote = '';
      renderTeeColors();
      renderPalette();
      designChanged();
      $('mx-tee-colors').querySelector(`[data-name="${CSS.escape(btn.dataset.name)}"]`)?.focus();
    }
    on('mx-tee-colors', 'click', e => pickTee(e.target.closest('[data-hex]')));
    on('mx-tee-colors', 'keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const all = [...$('mx-tee-colors').querySelectorAll('[data-hex]')];
      const i = Math.max(0, all.findIndex(b => b.getAttribute('aria-checked') === 'true'));
      pickTee(all[(i + d + all.length) % all.length]);
    });

    // Pro extras: number, rule, block, icon (max 3; the engine draws them).
    // Basic: a locked note and "Switch to Pro".
    const sourceNumber = () => { const m = `${contentPayload().text} ${state.trend?.title || ''}`.match(/(?:^|[^\d.,])(\d{1,2})(?![\d.,]*\d)/); return m ? m[1] : ''; };
    const sportIcon = c => SPORT_ICON[String(state.trend?.sport || c.team?.sport || c.team?.league || '').toLowerCase()] || 'star';
    function renderElements(c) {
      const list = Array.isArray(c.elements) ? c.elements : [];
      const pro = state.aiMode === 'pro';
      show('mx-elements-sec', pro || list.length > 0);
      show('mx-extras-locked', !pro);
      show('mx-go-pro', !pro);
      show('mx-elements', pro || list.length > 0);
      show('mx-el-add', pro);
      const types = MP().ELEMENT_TYPES || { number: ['behind', 'above'], rule: ['above', 'below', 'between'], block: ['behind'], icon: ['above', 'below', 'left'] };
      const icons = MP().ICONS || ['star'];
      const sel = (field, i, opts, value, label) => `<select class="mx-input mx-input--sm" data-el-field="${field}" data-i="${i}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const note = pro && state.proNote ? '<p class="mx-meta mx-extras__note">Pro is on. It applies to your next Create or AI change. You can add extras here now.</p>' : '';
      setHtml('mx-elements', note + (list.length ? list.map((e, i) => {
        const n = `Extra ${i + 1} (${(EL_LABEL[e.type] || e.type).toLowerCase()})`;
        const bits = [];
        if (e.type === 'icon') bits.push(sel('name', i, icons.map(x => [x, x.replace(/-/g, ' ').replace(/^./, m => m.toUpperCase())]), e.name, `${n} shape`));
        if (e.type === 'number') bits.push(`<input class="mx-input mx-input--sm mx-el__num" type="text" inputmode="numeric" maxlength="2" pattern="\\d{1,2}" value="${esc(e.text || '')}" data-el-field="text" data-i="${i}" aria-label="${esc(n)} digits" title="1 or 2 digits from your story">`, sel('style', i, [['solid', 'Solid'], ['outline', 'Outline']], e.style || 'solid', `${n} style`));
        if (e.type === 'rule') bits.push(sel('weight', i, [['thick', 'Thick'], ['thin', 'Thin']], e.weight || 'thick', `${n} weight`));
        const pos = types[e.type] || ['above'];
        if (pos.length > 1) bits.push(sel('position', i, pos.map(p => [p, POS_LABEL[p] || p]), e.position || pos[0], `${n} position`));
        bits.push(sel('color', i, EL_COLORS, e.color || 'a', `${n} colour`));
        return `<div class="mx-el" data-el="${i}"><span class="mx-el__type">${esc(EL_LABEL[e.type] || e.type)}</span><div class="mx-el__fields">${bits.join('')}</div><button class="mx-icon es-icon-btn" type="button" data-el-drop="${i}" aria-label="Remove ${esc(n)}">×</button></div>`;
      }).join('') : '<p class="mx-meta">No extras yet. Pills alone are the classic ES look.</p>'));
      setText('mx-elements-count', `${list.length} of 3`);
      const num = sourceNumber();
      $('mx-el-add')?.querySelectorAll('[data-el-add]').forEach(b => {
        const noNum = b.dataset.elAdd === 'number' && !num;
        b.disabled = !pro || list.length >= 3 || noNum;
        b.title = !pro ? 'Switch to Pro to add extras.' : list.length >= 3 ? 'Up to 3 extras.' : noNum ? 'Numbers come from your story: add one to your words first.' : '';
      });
    }
    on('mx-go-pro', 'click', () => {
      setMode('pro');
      state.proNote = true;
      track('merch', { action: 'go-pro', from: 'extras' });
      const c = selectedConcept();
      if (c) renderElements(c);
      renderFoldMeta();
      ($('mx-el-add')?.querySelector('button:not(:disabled)') || $('mx-fold-extras')?.querySelector('summary'))?.focus();
    });
    on('mx-el-add', 'click', e => {
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
    on('mx-elements', 'change', e => {
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
    on('mx-elements', 'click', e => {
      const b = e.target.closest('[data-el-drop]');
      const c = selectedConcept();
      if (!b || !c) return;
      remember(c);
      c.elements = c.elements.filter((_, j) => j !== Number(b.dataset.elDrop));
      renderElements(c);
      renderStrip();
      designChanged();
      ($('mx-elements').querySelector('[data-el-drop]') || $('mx-el-add')?.querySelector('button:not(:disabled)'))?.focus();
    });

    // Ask AI: "Change it" → refine (the last 4 instructions go along).
    setHtml('mx-chat-chips', SUGGESTIONS.map(s => `<button class="es-chip" type="button" data-say="${esc(s)}">${esc(s)}</button>`).join(''));
    function syncChat() {
      const busy = state.refining;
      const send = $('mx-chat-send');
      if (send) {
        send.disabled = busy || Boolean(state.making) || !selectedConcept();
        if (!send.children.length) send.textContent = busy ? 'Changing…' : 'Change it';
        send.setAttribute('aria-busy', String(busy));
      }
      $('mx-chat-chips')?.querySelectorAll('button').forEach(b => { b.disabled = busy || Boolean(state.making); });
    }
    function renderChatNote() {
      const c = selectedConcept();
      const n = c ? state.notes[c.id] : null;
      const el = $('mx-chat-note');
      if (!el) return;
      el.className = `mx-chat__note${n ? ` mx-chat__note--${n.tone}` : ''}`;
      if (!n) { el.innerHTML = state.aiMode === 'pro' ? '<span class="mx-meta">Pro uses the smarter AI for edits.</span>' : '<span class="mx-meta">Basic edits are quick. Switch to Pro for the smarter AI.</span>'; return; }
      const who = n.mode ? `<span class="mx-chat__who">${n.mode === 'pro' ? 'Pro' : n.mode === 'free' ? 'No AI' : n.mode === 'code' ? 'Quick edit' : 'Basic'}${n.fellBack ? ` (${esc(FELL_SHORT[n.fellBack] || 'fell back')})` : ''}</span>` : '';
      const canUndo = (state.history[c.id] || []).length > 0 && n.tone === 'ok';
      el.innerHTML = `${who}<span class="mx-chat__text">${esc(n.text)}</span>${canUndo ? '<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-chat-undo>Undo</button>' : ''}`;
    }
    on('mx-chat-note', 'click', e => { if (e.target.closest('[data-chat-undo]')) undo(); });
    const forServer = c => { const { designedStack, ...rest } = c; return rest; };
    async function refine(instruction) {
      const c = selectedConcept();
      if (!c || state.refining || state.making) return;
      const text = String(instruction || '').trim().slice(0, 300);
      if (!text) { state.notes[c.id] = { text: 'Type what to change, or pick a suggestion.', tone: 'info' }; renderChatNote(); $('mx-chat-input')?.focus(); return; }
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
          if (same) { if ($('mx-chat-input')) $('mx-chat-input').value = ''; renderEditor(); designChanged(); }
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
    on('mx-chat-send', 'click', () => refine(val('mx-chat-input')));
    on('mx-chat-input', 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); refine(val('mx-chat-input')); } });
    on('mx-chat-chips', 'click', e => { const b = e.target.closest('[data-say]'); if (b) refine(b.dataset.say); });

    on('mx-to-setup', 'click', () => go('publish'));

    // ── Shortcuts (Design): ⌘Z / ⇧⌘Z, "/" Ask AI, ←/→ designs, T / C view,
    // ⌘Enter Continue. Never while typing, with a dialog open, or in the popover.
    const isTyping = t => Boolean(t && (t.isContentEditable || (t.closest && t.closest('input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea, select, [contenteditable="true"]'))));
    // Capture phase on window: runs before app-shell's "/" search shortcut.
    window.addEventListener('keydown', e => {
      if (e.defaultPrevented || state.step !== 'designs' || state.making) return;
      if (isTyping(e.target) || popOpen() || document.querySelector('dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); if (!$('mx-to-setup')?.disabled) go('publish'); return; }
      if (mod || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); e.stopImmediatePropagation(); $('mx-chat-input')?.focus(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.target.closest?.('[role=radiogroup], [role=tablist], .es-segmented, details summary')) return;
        e.preventDefault(); stepDesign(e.key === 'ArrowRight' ? 1 : -1); return;
      }
      if (k === 't') { setView('tee'); return; }
      if (k === 'c') setView('closeup');
    }, true);

    // ── 3 Publish ──
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
    const liveShown = () => Boolean(state.product && state.product.forId === state.selected);
    const pstage = () => $('mx-pstage') || $('mx-pstage-main');
    // The one Publish preview until live mockups arrive: FrameUp's composite on
    // Fourthwall's blank photo (or the flat drawn blank).
    async function drawProductStage() {
      const c = selectedConcept();
      if (!c || !$('mx-pstage-canvas')) return;
      const t = ++tokens.product;
      const { off, caption } = await paint(c, 'tee', { garment: garmentHex() });
      if (t !== tokens.product) return;
      const cv = $('mx-pstage-canvas');
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', `${BLANK_INFO[kind()].label} preview, ${logoText()}`);
      cv.dataset.caption = caption;
      if (!state.mock.images.length && !liveShown()) setText('mx-pstage-kind', caption);
    }
    function renderPubState() {
      const live = liveShown();
      show(document.querySelector('#mx-pub-form, .mx-pub-form'), !live);
      show('mx-push', !live); // older markup
      renderLive();
    }
    async function enterPublish() {
      const c = selectedConcept();
      renderRights();
      renderPubState();
      loadShopColls();
      if (!state.templates) {
        setHtml('mx-blanks', '<span class="mx-meta">Loading products…</span>');
        const ok = await ensureTemplates();
        if (!ok) {
          setHtml('mx-blanks', `<span class="mx-meta mx-meta--bad">${esc(state.templatesError)}</span> <button class="es-btn es-btn--sm" type="button" id="mx-blanks-retry">Try again</button>`);
          on('mx-blanks-retry', 'click', enterPublish);
          syncPublish();
          return;
        }
        if (state.step !== 'publish') return;
      }
      if (!template() && defaultTemplate()) pickTemplate(defaultTemplate().templateId, false);
      else pickColorFor(c);
      renderPublish();
      if (state.copyFor !== copyKey(c)) loadCopy(c);
      autoMockups();
    }
    // The product's colour for the design's tee colour: the same colour, else the
    // nearest one it comes in (and a note saying so).
    const rgbOf = h => [1, 3, 5].map(i => parseInt(String(normHex(h) || WHITE).slice(i, i + 2), 16));
    const colorDist = (x, y) => { const [r, g, b] = rgbOf(x); const [R, G, B] = rgbOf(y); return (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11; };
    function pickColorFor(c) {
      const t = template();
      const list = t?.colors || [];
      state.colorNote = '';
      const fallback = list.find(x => x.name === t?.defaultColor) || list[0];
      if (!apparel()) { state.colors = fallback ? [fallback.name] : []; return; }
      const exact = list.find(x => x.name === c?.garment?.name && sameHex(x.hex, c?.garment?.color)) || list.find(x => sameHex(x.hex, c?.garment?.color)) || list.find(x => x.name === c?.garment?.name);
      if (exact) { state.colors = [exact.name]; return; }
      const g = normHex(c?.garment?.color);
      const near = g ? list.filter(x => normHex(x.hex)).sort((x, y) => colorDist(x.hex, g) - colorDist(y.hex, g))[0] : null;
      const pick = near || fallback;
      state.colors = pick ? [pick.name] : [];
      if (c && g && pick?.hex) {
        state.colorNote = `The ${BLANK_INFO[kind()].label.toLowerCase()} doesn’t come in ${c.garment.name || colorWord(g)}, so it’s ${pick.name}, the closest colour.`;
        c.garment = { color: pick.hex, name: pick.name }; // Design shows the same colour
      }
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
        renderPublish();
        const c = selectedConcept();
        if (before !== kind() && c) loadCopy(c);
        autoMockups();
      }
    }
    const base = () => Number(template()?.basePrice) || 0;
    function blankCard(x) {
      const k = kindOf(x);
      const sel = x.templateId === state.templateId;
      const fits = (selectedConcept()?.blanks || []).includes(k);
      const sug = Number(x.pricing?.suggested ?? x.suggestedPrice) > 0 ? Number(x.pricing?.suggested ?? x.suggestedPrice) : (window.MerchRules?.suggestedPrice ? window.MerchRules.suggestedPrice(k, x.basePrice) : null);
      const photo = (x.colors || []).find(cc => (cc.photos || []).length)?.photos?.[0] || '';
      return `<button class="mx-blank" type="button" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-tpl="${esc(x.templateId)}" data-kind="${esc(k)}" aria-label="${esc(x.label || BLANK_INFO[k].label)}, base cost ${x.basePrice != null ? money(x.basePrice) : 'unknown'}${sug ? `, suggested price ${money(sug)}` : ''}${fits ? ', suits this design' : ''}">
        <span class="mx-blank__icon" aria-hidden="true">${photo ? `<img class="mx-blank__photo" src="${esc(imgUrl(photo))}" alt="" loading="lazy">` : BLANK_ICON[k] || ''}${fits ? '<span class="mx-blank__fit"></span>' : ''}</span>
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
    // Tee colour is read-only here (it lives in Design): "Black tee · Change".
    function renderPubColor() {
      const c = selectedConcept();
      const el = $('mx-pub-color');
      const note = state.colorNote;
      if (el) el.textContent = !template() ? '' : apparel() ? `${state.colors[0] || c?.garment?.name || 'White'} ${nounLower()}` : `${BLANK_INFO[kind()].label} · prints on white`;
      show('mx-pub-color-change', Boolean(template()) && apparel());
      if ($('mx-pub-color-note')) { setText('mx-pub-color-note', note); show('mx-pub-color-note', Boolean(note)); }
    }
    on('mx-pub-color-change', 'click', e => {
      e.preventDefault();
      if (!go('designs', { focus: 'none' })) return;
      const fold = $('mx-fold-colors');
      if (fold) { fold.open = true; fold.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      ($('mx-tee-colors')?.querySelector('[aria-checked="true"]') || $('mx-tee-colors')?.querySelector('button') || fold?.querySelector('summary'))?.focus({ preventScroll: true });
    });
    function renderPublish() {
      const k = kind();
      setHtml('mx-blanks', (state.templates || []).length ? state.templates.map(blankCard).join('') : '<span class="mx-meta">No products found on Fourthwall.</span>');
      const blanks = $('mx-blanks');
      if (blanks) { blanks.setAttribute('role', 'radiogroup'); if (!blanks.getAttribute('aria-label')) blanks.setAttribute('aria-label', 'Product'); }
      setText('mx-blank-detail', [blankDetail(), !$('mx-pub-color-note') ? state.colorNote : ''].filter(Boolean).join(' · '));
      renderPubColor();
      const side = $('mx-side');
      if (side) {
        side.innerHTML = designAreas().map(a => `<option value="${esc(a.regionId)}">${esc(areaLabel(a))}${a.dpi ? ` · ${esc(a.dpi)} DPI` : ''}</option>`).join('');
        side.value = state.side;
        side.disabled = designAreas().length < 2;
      }
      const logos = logoAreas();
      const logo = $('mx-logo');
      if (logo) {
        logo.innerHTML = apparel()
          ? `${logos.map(a => `<option value="${esc(a.regionId)}">${esc(areaLabel(a))}</option>`).join('')}<option value="">No logo</option>`
          : '<option value="inline">Inside the design (small ES pill at the bottom)</option><option value="">No logo</option>';
        logo.value = (apparel() ? state.logo : (state.logo === 'inline' ? 'inline' : '')) || '';
      }
      setText('mx-logo-hint', !apparel()
        ? `A ${BLANK_INFO[k].label.toLowerCase()} has one print area, so the small ESSENTIALLYSPORTS pill is printed at the bottom of the design, in the same file.`
        : logos.length ? 'The ES logo is the small ESSENTIALLYSPORTS pill, printed in its own area. The preview shows where.' : `This ${BLANK_INFO[k].label.toLowerCase()} has no small print areas, so it goes without the ES logo.`);
      drawProductStage();
      renderMockups();
      syncEarn();
      syncPublish();
    }
    // A change in Publish: redraw, re-check, and mark live mockups out of date.
    function productChanged() {
      state.image = null;
      drawProductStage();
      renderMockups();
      syncPublish();
    }

    // Print checks for the chosen blank (300 DPI hard goods, mug wrap, sticker cut, poster trim).
    function printChecks() {
      const c = selectedConcept();
      if (!c || typeof MP().checks !== 'function') return [];
      try { return MP().checks(c, printSpec()); } catch (error) { console.warn('merch checks', error); return []; }
    }
    const blockingChecks = () => printChecks().filter(x => x.level === 'error');
    // Problems and warnings in full; passing checks fold into one line with the details on request.
    const checkRow = x => `<li class="mx-check-row mx-check-row--${esc(x.level)}"${x.level === 'error' ? ' tabindex="-1"' : ''}><span class="mx-check-row__mark" aria-hidden="true">${x.level === 'ok' ? '✓' : '!'}</span><span><span class="es-sr-only">${x.level === 'error' ? 'Problem: ' : x.level === 'warn' ? 'Warning: ' : 'OK: '}</span>${esc(x.text)}</span></li>`;
    function renderChecks(listId, blockId) {
      const box = $(listId);
      if (!box) return;
      const list = printChecks();
      if (blockId) show(blockId, list.length > 0);
      const issues = list.filter(x => x.level !== 'ok');
      const passed = list.filter(x => x.level === 'ok');
      const dpi = passed.find(x => x.id === 'dpi');
      const summary = issues.length ? '' : `<li class="mx-check-row mx-check-row--ok"><span class="mx-check-row__mark" aria-hidden="true">✓</span><span>Ready to print on a ${esc(BLANK_INFO[kind()].label.toLowerCase())}${dpi ? `: ${esc(dpi.text.replace(/: full print size\.$/, '.'))}` : '.'}</span></li>`;
      box.innerHTML = `${issues.map(checkRow).join('')}${summary}${passed.length ? `<li><details class="mx-check-more"><summary>${issues.length ? `${passed.length} other checks pass` : `See all ${passed.length} checks`}</summary><ul class="mx-checks">${passed.map(checkRow).join('')}</ul></details></li>` : ''}`;
    }
    function syncEarn() {
      const price = Number(val('mx-price'));
      if (!$('mx-earn')) return;
      if (!template() || !(price > 0)) { setText('mx-earn', ''); return; }
      const m = window.MerchRules?.marginFor ? window.MerchRules.marginFor(price, base()) : null;
      const earn = m && Number.isFinite(m.margin) ? m.margin : price - base();
      const sug = suggested();
      setHtml('mx-earn', earn > 0 ? `You earn <strong>${money(earn)}</strong> per sale (base cost ${money(base())}${sug ? `, suggested ${money(sug)}` : ''}).` : `<span class="mx-meta--bad">Below the base cost of ${money(base())}. Raise the price.</span>`);
    }
    const copyKey = c => `${c?.id || ''}|${kind()}`;
    async function loadCopy(c) {
      if (!c) return;
      const key = copyKey(c);
      state.copyFor = key;
      const noun = BLANK_INFO[kind()].noun;
      if ($('mx-title-input')) $('mx-title-input').value = c.title ? `${c.title} ${noun}` : '';
      if ($('mx-price')) $('mx-price').value = suggested() || '';
      state.copyMsg = 'Writing the title and description…';
      syncPublish();
      try {
        const data = await api({ mode: 'copy', concept: forServer(c), content: { ...contentPayload(), trend: trendBody() }, blank: kind() });
        if (state.copyFor !== key) return;
        const copy = data.copy || data;
        if (copy.title && $('mx-title-input')) $('mx-title-input').value = copy.title;
        if (copy.description && $('mx-desc')) $('mx-desc').value = copy.description;
        if (copy.retail && $('mx-price')) $('mx-price').value = copy.retail;
        state.copyMsg = '';
      } catch (error) {
        if (state.copyFor !== key) return;
        state.copyMsg = 'Couldn’t write the copy. Fill in the title, description and price yourself.';
      }
      if ($('mx-price') && !$('mx-price').value) $('mx-price').value = suggested() || 30;
      syncEarn();
      syncPublish();
    }
    function renderRights() {
      const c = selectedConcept();
      const list = c?.rights || [];
      setHtml('mx-rights-list', list.length
        ? list.map(r => `<li><span class="mx-rchip">${esc(RIGHTS_LABEL[r.kind] || r.kind)}</span> ${esc(r.text)}</li>`).join('')
        : '<li class="mx-meta">No names, quotes or team colours found.</li>');
    }
    // One blocker line: the first thing that stops "Create on Fourthwall".
    function pubBlocker() {
      const gate = pushAllowed();
      if (!gate.ok) return gate.text;
      if (!template()) return state.templatesError || 'Pick a product.';
      if (!state.colors.length && (template().colors || []).length) return 'Pick a colour for the product in Design.';
      const bad = blockingChecks();
      if (bad.length) return `Fix the print check first: ${bad[0].text}`;
      if (val('mx-title-input').trim().length <= 2) return 'Add a product title.';
      if (!(Number(val('mx-price')) > base())) return `Set a price above the base cost of ${money(base())}.`;
      if (!state.ack) return 'Tick the rights box to create it.';
      return '';
    }
    function syncPublish() {
      const btn = $('mx-create-fw');
      const busy = state.busy === 'create';
      const blocker = busy || liveShown() ? '' : pubBlocker();
      if (btn) btn.disabled = busy || Boolean(blocker) || liveShown();
      setText('mx-pub-blocker', blocker);
      show('mx-pub-blocker', Boolean(blocker));
      const left = state.status?.caps?.person?.left;
      const colls = (state.shopColls || []).filter(c => state.pick.setup.includes(c.id)).map(c => c.name);
      const summary = template() ? [BLANK_INFO[kind()].label, apparel() ? (state.colors[0] || '') : '', Number(val('mx-price')) > 0 ? money(val('mx-price')) : '', logoText(), colls.length ? `in ${colls.join(', ')}` : '', left != null ? `${left} create${left === 1 ? '' : 's'} left today` : 'up to 10 creates a day'].filter(Boolean).join(' · ') : '';
      setText('mx-setup-meta', state.copyMsg || summary);
      syncMockButton();
      renderSteps();
    }
    on('mx-blanks', 'click', e => { const b = e.target.closest('[data-tpl]'); if (b && b.dataset.tpl !== state.templateId) { pickTemplate(b.dataset.tpl); $('mx-blanks').querySelector(`[data-tpl="${CSS.escape(b.dataset.tpl)}"]`)?.focus(); } });
    on('mx-blanks', 'keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const list = state.templates || [];
      if (!d || !list.length) return;
      e.preventDefault();
      const i = list.findIndex(x => x.templateId === state.templateId);
      pickTemplate(list[(i + d + list.length) % list.length].templateId);
      $('mx-blanks').querySelector('[aria-checked="true"]')?.focus();
    });
    on('mx-side', 'change', () => { state.side = val('mx-side'); if (state.logo === state.side) state.logo = null; state.image = null; renderPublish(); });
    on('mx-logo', 'change', () => { state.logo = val('mx-logo') || null; state.logoImage = null; if (!apparel()) state.image = null; productChanged(); });
    ['mx-title-input', 'mx-desc'].forEach(id => on(id, 'input', syncPublish));
    on('mx-price', 'input', () => { syncEarn(); syncPublish(); });
    on('mx-ack', 'change', () => { state.ack = $('mx-ack').checked; syncPublish(); });
    on('mx-back-studio', 'click', () => go('designs')); // older markup

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
      return `<p class="mx-meta mx-mockups__count">${plural(items.length, 'mockup')} · click one to enlarge</p><div class="mx-mockups__grid">${items.map((m, i) => `<figure class="mx-mock"><button class="mx-mock__btn" type="button" data-gal="${id}" data-gi="${i}" aria-label="View ${esc(m?.color || label)} mockup ${i + 1} of ${items.length}"><img src="${esc(imgUrl(m))}" alt="" loading="lazy"></button>${m?.color ? `<figcaption>${esc(m.color)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    }
    let galleryAt = { id: '', i: 0, from: null };
    function showGallery() {
      const list = galleries.get(galleryAt.id) || [];
      const it = list[galleryAt.i];
      if (!it) return;
      $('mx-gallery-img').src = it.url;
      $('mx-gallery-img').alt = it.caption;
      setText('mx-gallery-cap', it.caption);
      $('mx-gallery-open').href = it.url;
      $('mx-gallery-prev').disabled = list.length < 2;
      $('mx-gallery-next').disabled = list.length < 2;
    }
    function stepGallery(d) { const n = (galleries.get(galleryAt.id) || []).length; if (n) { galleryAt.i = (galleryAt.i + d + n) % n; showGallery(); } }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-gal]');
      if (!b || !$('mx-gallery')) return;
      galleryAt = { id: b.dataset.gal, i: Number(b.dataset.gi) || 0, from: b };
      showGallery();
      const d = $('mx-gallery');
      if (d.showModal && !d.open) d.showModal(); else d.setAttribute('open', '');
    });
    on('mx-gallery-prev', 'click', () => stepGallery(-1));
    on('mx-gallery-next', 'click', () => stepGallery(1));
    on('mx-gallery-close', 'click', () => $('mx-gallery').close());
    on('mx-gallery', 'keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); stepGallery(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); stepGallery(1); } });
    on('mx-gallery', 'close', () => galleryAt.from?.focus?.());

    // ── Mockups: Fourthwall's live mockups first (admins), else FrameUp's preview ──
    // The key says what the mockups show; when the design, colour, area or logo
    // changes they are out of date and "Update" appears.
    const mockKey = () => { const c = selectedConcept(); return c ? JSON.stringify([c.stack, c.palette, c.align, c.fit || null, c.elements || null, c.mode || '', printSpec(), state.colors[0] || '', logoSpot()]) : ''; };
    const mockFresh = () => state.mock.images.length > 0 && state.mock.key === mockKey();
    function mockStatus(text) { setText('mx-mockup-status', text || ''); }
    function syncMockButton() {
      const btn = $('mx-preview');
      if (!btn) return;
      const gate = pushAllowed();
      const has = state.mock.images.length > 0;
      btn.hidden = liveShown() || !gate.ok || (has && mockFresh() && !state.mock.busy);
      btn.disabled = state.mock.busy || !template() || blockingChecks().length > 0;
      btn.setAttribute('aria-busy', String(state.mock.busy));
      btn.textContent = state.mock.busy ? 'Getting mockups…' : has ? 'Update' : 'Get live mockups';
      btn.title = blockingChecks().length ? 'Fix the print check first.' : '';
    }
    function renderMockups() {
      const main = pstage();
      if (!main) return;
      const live = liveShown() && (state.product.images || []).some(imgUrl);
      const has = live || state.mock.images.length > 0;
      const fresh = live || mockFresh();
      const what = apparel() ? (state.colors[0] || '') : BLANK_INFO[kind()].label;
      main.querySelector('.mx-pstage__live')?.remove();
      show('mx-pstage-canvas', !has);
      main.classList.toggle('is-stale', has && !fresh);
      if (has) {
        const items = (live ? state.product.images : state.mock.images).filter(m => imgUrl(m));
        const gid = galleryOf(items, what || 'Product');
        main.insertAdjacentHTML('beforeend', `<button class="mx-pstage__live" type="button" data-gal="${gid}" data-gi="0" aria-label="Enlarge the first Fourthwall mockup"><img src="${esc(imgUrl(items[0]))}" alt="Fourthwall mockup${what ? `, ${esc(what)}` : ''}"></button>`);
        setHtml('mx-pstage-title', `${live ? 'On Fourthwall' : 'Fourthwall live mockups'}${what ? ` · ${esc(what)}` : ''}`);
        setText('mx-pstage-kind', live ? 'The images the shop shows.' : fresh ? 'The images the shop will show.' : 'The design, colour or print area changed since.');
        setHtml('mx-mockups', imagesHtml(items, what || 'Product', gid));
      } else {
        setText('mx-pstage-title', 'FrameUp preview on Fourthwall’s blank photo');
        setText('mx-pstage-kind', $('mx-pstage-canvas')?.dataset.caption || '');
        setHtml('mx-mockups', pushAllowed().ok ? '' : `<p class="mx-meta">${state.status && !state.status.configured ? 'Fourthwall’s live mockups appear once Fourthwall is connected.' : 'Fourthwall makes the live mockups when an admin creates the product.'}</p>`);
      }
      if (!state.mock.busy && !state.mock.error) mockStatus(live ? '' : has && !fresh ? 'Live mockups out of date.' : has || !pushAllowed().ok ? '' : 'Live mockups come from Fourthwall.');
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
      mockStatus('Getting live mockups…');
      syncMockButton();
      try {
        const img = await ensureImages((p, text) => mockStatus(text));
        mockStatus(`Getting live mockups… usually ${ETA.preview}.`);
        const body = { mode: 'preview', blank: kind(), imageId: img.imageId, region: img.region };
        if (state.colors[0]) body.color = state.colors[0];
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        state.mock = { key, images: data.images || [], busy: false, error: '' };
        mockStatus(state.mock.images.length ? '' : 'Fourthwall sent no mockups. The FrameUp preview is close to what prints.');
      } catch (error) {
        state.mock.busy = false;
        state.mock.error = explain(error).text;
        mockStatus(`${state.mock.error} The FrameUp preview is close to what prints.`);
      }
      state.mock.busy = false;
      if (state.step === 'publish') renderMockups();
    }
    // Admins: ask Fourthwall automatically when entering Publish (once per version of the design).
    function autoMockups() {
      const key = mockKey();
      if (!state.status || liveShown() || !pushAllowed().ok || !template() || blockingChecks().length || state.mock.busy || mockFresh() || state.autoMockFor === key) return;
      state.autoMockFor = key;
      requestMockups();
    }
    on('mx-preview', 'click', requestMockups);

    // ── Shop collections (Fourthwall) ──
    // One picker, used in Publish (applied after create) and on the live panel.
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
      const picked = state.pick[where] || [];
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
        state.pick[where] = [...new Set([...(state.pick[where] || []), col.id])];
        state.newColl = '';
        renderShopColls();
        collStatus(where, `${data.existed ? 'Ticked the existing' : 'Added'} “${col.name}”.${where === 'live' ? ' Save to put this product in it.' : ''}`);
        document.querySelector(`[data-colls="${where}"] [data-coll-id="${CSS.escape(col.id)}"]`)?.focus();
        if (where === 'live') syncLiveColls(); else syncPublish();
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
      const cur = state.pick[where] || [];
      state.pick[where] = box.checked ? [...new Set([...cur, id])] : cur.filter(x => x !== id);
      if (where === 'live') syncLiveColls(); else syncPublish();
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
    // Progress: labelled steps, a bar, a status line, and "Try again" on failure.
    function progress(pct, text, { failed = false } = {}) {
      const box = $('mx-progress');
      if (!box) { if (text != null) setText('mx-push-status', text); return; }
      state.progFailed = failed;
      box.hidden = pct == null && !failed;
      if (pct != null) { state.progAt = pct; const bar = $('mx-progress-bar'); if (bar) bar.style.width = `${Math.max(2, Math.min(100, pct))}%`; }
      if (text != null) setText('mx-push-status', text);
      let list = box.querySelector('[data-prog-steps]');
      if (!list) { list = document.createElement('ol'); list.className = 'mx-progress__steps'; list.dataset.progSteps = ''; box.prepend(list); }
      const steps = PROGRESS.filter(([id]) => id !== 'colls' || state.pick.setup.length);
      const at = steps.reduce((k, s, i) => (state.progAt >= s[2] ? i : k), 0);
      list.innerHTML = steps.map(([id, label], i) => `<li class="mx-progress__step${i < at ? ' is-done' : ''}${i === at ? (failed ? ' is-failed' : ' is-active') : ''}" data-prog="${id}"${i === at ? ' aria-current="step"' : ''}>${esc(label)}${i < at ? '<span class="es-sr-only"> (done)</span>' : i === at && failed ? '<span class="es-sr-only"> (failed)</span>' : ''}</li>`).join('');
      box.querySelector('[data-prog-retry]')?.remove();
      if (failed) box.insertAdjacentHTML('beforeend', '<button class="es-btn es-btn--sm mx-progress__retry" type="button" data-prog-retry>Try again</button>');
    }
    on('mx-progress', 'click', e => { if (e.target.closest('[data-prog-retry]')) $('mx-create-fw')?.click(); });
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

    // ── Create on Fourthwall, then the live panel replaces the form ──
    on('mx-create-fw', 'click', async () => {
      const gate = pushAllowed();
      if (!gate.ok) { setText('mx-pub-blocker', gate.text); show('mx-pub-blocker', true); return; }
      if (state.busy === 'create' || pubBlocker()) return;
      state.busy = 'create';
      state.pushError = '';
      const btn = $('mx-create-fw');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      syncPublish();
      let collNote = '';
      try {
        const img = await ensureImages(progress);
        progress(80, `Creating the product (hidden)… ${ETA.create}.`);
        const c = selectedConcept();
        const body = {
          mode: 'create', concept: forServer(c), content: { ...contentPayload(), trend: trendBody() }, blank: kind(), imageId: img.imageId, region: img.region,
          title: val('mx-title-input').trim(), description: val('mx-desc').trim(), retail: Number(val('mx-price')),
          ack: { accepted: state.ack, items: (c.rights || []).map(r => ({ kind: r.kind, text: r.text })) },
        };
        if (state.colors[0]) body.color = state.colors[0];
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        state.product = { id: data.productId, forId: c.id, name: data.title || body.title, description: data.description || body.description, url: data.productUrl || '', state: data.state || 'HIDDEN', price: data.price?.retail ?? body.retail, margin: data.price?.margin, images: data.images || [], color: body.color, blank: kind(), collectionIds: [] };
        if (data.caps && state.status) state.status.caps = data.caps;
        window.FrameUpTrack?.track?.('export', { tool: 'merch', action: 'fourthwall-create' });
        // Shop collections: Fourthwall replaces a collection's whole list, so the server reads first and appends.
        if (state.pick.setup.length) {
          progress(95, 'Adding it to the shop collections…');
          try { await setCollections(state.product.id, state.pick.setup); state.product.collectionIds = state.pick.setup.slice(); } catch (error) { collNote = `Created, but it wasn’t added to the collections: ${explain(error).text}`; }
        }
        state.pick.live = state.product.collectionIds.slice();
        state.list = null; // the list has a new product
        state.listCount = state.listCount == null ? null : state.listCount + 1;
        renderListCount();
        progress(null, '');
      } catch (error) {
        const why = explain(error);
        state.pushError = why.text;
        progress(state.progAt, why.text, { failed: true });
        if (why.kind === 'rate') banner(why.kind, why.text);
      }
      state.busy = '';
      btn.removeAttribute('aria-busy');
      renderPubState();
      renderMockups();
      syncPublish();
      if (collNote) setText('mx-live-status', collNote);
      if (state.product && liveShown()) $('mx-h-publish')?.focus?.({ preventScroll: true });
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
      if (!box) return;
      const p = state.product;
      if (!p || !liveShown()) { box.hidden = true; box.innerHTML = ''; return; }
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
            ${archived ? '' : `<button class="es-btn${live ? '' : ' es-btn--primary'}" type="button" data-live="${live ? 'hide' : 'publish'}">${live ? 'Hide' : 'Publish to shop'}</button>`}
            ${p.url && !archived ? `<a class="es-btn es-btn--ghost" href="${esc(p.url)}" target="_blank" rel="noopener">View on Fourthwall</a>` : ''}
          </div>
        </div>
        ${archived ? '<p class="mx-meta">Archived: this product is gone from the Fourthwall shop. Past orders stay in Fourthwall.</p>' : `
        <p class="mx-meta">${p.url ? `Product link: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> · ` : ''}${p.price != null ? `${money(p.price)}${p.margin != null ? `, you earn ${money(p.margin)} a sale` : ''}` : ''}</p>
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
        <p class="mx-meta" id="mx-live-status" role="status" aria-live="polite"></p>
        <div class="mx-row mx-live__links"><button class="es-btn es-btn--ghost" type="button" data-go="content">Make another design</button><button class="es-btn es-btn--ghost" type="button" data-go="list">Your merch</button></div>`;
      if (!archived) { renderShopColls(); syncLiveColls(); if (!state.shopColls) loadShopColls(); }
      if (!archived && !p.allImages && p.id) loadAllMockups(p);
    }
    // After create, Fourthwall's create reply has a few mockups; the product has them all.
    async function loadAllMockups(p) {
      p.allImages = true;
      try {
        const data = await api({ mode: 'product', productId: p.id });
        const imgs = data.product?.images || [];
        if (state.product === p && imgs.length > (p.images || []).length) { p.images = imgs; renderLive(); renderMockups(); }
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
    on('mx-live', 'click', async e => {
      const b = e.target.closest('[data-live]');
      if (!b || !state.product) return;
      const act = b.dataset.live;
      if (act === 'archive') { openArchive({ productId: state.product.id, title: state.product.name }, b); return; }
      if (act === 'copy-desc') {
        try {
          await navigator.clipboard.writeText(state.product.description);
          window.FrameUpTrack?.track?.('copy', { tool: 'merch', action: 'description' });
          setText('mx-live-status', 'Description copied. Paste it in the Fourthwall dashboard if the shop shows it empty.');
        } catch { setText('mx-live-status', 'Couldn’t copy. Copy the description from the Fourthwall dashboard.'); }
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
        setText('mx-live-status', explain(error).text);
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
      if (!archiveAllowed().ok || !$('mx-archive')) return;
      state.archiving = target;
      archiveReturn = from || null;
      setText('mx-archive-name', target.title);
      $('mx-archive-input').value = '';
      $('mx-archive-input').setAttribute('placeholder', target.title);
      setText('mx-archive-status', '');
      $('mx-archive-go').disabled = true;
      const dlg = $('mx-archive');
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      $('mx-archive-input').focus();
    }
    function closeArchive() {
      const dlg = $('mx-archive');
      if (dlg?.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
      state.archiving = null;
      if (archiveReturn?.isConnected) archiveReturn.focus();
      archiveReturn = null;
    }
    on('mx-archive-input', 'input', () => { $('mx-archive-go').disabled = !state.archiving || norm(val('mx-archive-input')) !== norm(state.archiving.title); });
    on('mx-archive-input', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!$('mx-archive-go').disabled) $('mx-archive-go').click(); } });
    on('mx-archive-cancel', 'click', closeArchive);
    on('mx-archive', 'cancel', e => { e.preventDefault(); closeArchive(); });
    on('mx-archive-go', 'click', async () => {
      const t = state.archiving;
      if (!t || norm(val('mx-archive-input')) !== norm(t.title)) return;
      const goBtn = $('mx-archive-go');
      goBtn.disabled = true; goBtn.setAttribute('aria-busy', 'true');
      setText('mx-archive-status', 'Archiving…');
      try {
        await api({ mode: 'archive', productId: t.productId, confirm: true, confirmName: val('mx-archive-input').trim() });
        if (state.product?.id === t.productId) state.product.state = 'ARCHIVED';
        const row = (state.list || []).find(r => r.productId === t.productId);
        if (row) row.state = 'ARCHIVED';
        if (!row && state.listCount) state.listCount -= 1;
        goBtn.removeAttribute('aria-busy');
        archiveReturn = null;
        closeArchive();
        renderLive();
        renderList();
        renderListCount();
        const msg = `“${t.title}” is archived.`;
        if (state.step === 'list') setText('mx-list-updated', msg); else setText('mx-live-status', msg);
        (state.step === 'list' ? $('mx-h-list') : $('mx-h-publish') || $('mx-h-live'))?.focus?.({ preventScroll: true });
      } catch (error) {
        goBtn.removeAttribute('aria-busy');
        goBtn.disabled = false;
        setText('mx-archive-status', explain(error).text);
      }
    });

    // ── Your merch (list + 30-day sales) ──
    const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
    const timeText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
    async function loadList() {
      state.listBusy = true;
      state.listError = '';
      $('mx-list')?.setAttribute('aria-busy', 'true');
      if ($('mx-list-refresh')) $('mx-list-refresh').disabled = true;
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
      $('mx-list')?.setAttribute('aria-busy', 'false');
      if ($('mx-list-refresh')) $('mx-list-refresh').disabled = false;
      renderList();
      renderListCount();
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
      show('mx-list-source', Boolean(rows && state.listSource === 'fourthwall'));
      setText('mx-list-source', 'The merch history isn’t set up yet, so this list comes straight from Fourthwall: only products FrameUp made, without who made them.');
      if (state.listBusy && !rows) {
        box.innerHTML = `<div class="mx-lt-skel" aria-label="Loading your merch">${'<div class="mx-lt-skel__row"><span class="es-skeleton mx-lt-skel__img"></span><span class="es-skeleton mx-lt-skel__line"></span></div>'.repeat(3)}</div>`;
        show('mx-list-totals', false);
        return;
      }
      if (state.listError && !rows) {
        box.innerHTML = `<div class="es-error-state" role="alert"><p class="es-error-state__title">Your merch didn’t load</p><p class="es-error-state__copy">${esc(state.listError)}</p><button class="es-btn" type="button" data-list-act="retry">Try again</button></div>`;
        show('mx-list-totals', false);
        return;
      }
      if (!rows) { box.innerHTML = ''; return; }
      if (!rows.length) {
        box.innerHTML = '<div class="es-empty"><p class="es-empty__title">No merch yet</p><p class="es-empty__copy">Products you create on Fourthwall show up here, with their sales.</p><button class="es-btn es-btn--primary" type="button" data-list-act="make">Create merch</button></div>';
        show('mx-list-totals', false);
        return;
      }
      const active = rows.filter(r => stateKey(r.state) !== 'ARCHIVED');
      const live = rows.filter(r => ['PUBLIC', 'AVAILABLE'].includes(stateKey(r.state))).length;
      const units = rows.reduce((s, r) => s + (Number(r.units30) || 0), 0);
      const revenue = rows.reduce((s, r) => s + (Number(r.revenue30) || 0), 0);
      show('mx-list-totals', true);
      setHtml('mx-list-totals', `<div class="mx-total"><span class="mx-total__v">${active.length}</span><span class="mx-meta">Products</span></div><div class="mx-total"><span class="mx-total__v">${live}</span><span class="mx-meta">Live in the shop</span></div><div class="mx-total"><span class="mx-total__v">${units}</span><span class="mx-meta">Units, 30 days</span></div><div class="mx-total"><span class="mx-total__v">${money(revenue)}</span><span class="mx-meta">Revenue, 30 days</span></div>`);
      box.innerHTML = `<div class="es-table-wrap mx-lt-wrap"><table class="es-table mx-lt"><caption class="es-sr-only">Your merch, with units and revenue for the last 30 days</caption>
        <thead><tr><th scope="col"><span class="es-sr-only">Mockup</span></th><th scope="col">Product</th><th scope="col">Status</th><th scope="col" class="mx-num">Units (30 days)</th><th scope="col" class="mx-num">Revenue (30 days)</th><th scope="col"><span class="es-sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map(listRow).join('')}</tbody></table></div>`;
      if (!state.listBusy) setText('mx-list-updated', state.salesAt ? `Sales updated ${timeText(state.salesAt)}` : '');
    }
    on('mx-list-refresh', 'click', loadList);
    on('mx-list', 'click', async e => {
      const a = e.target.closest('[data-list-act]');
      if (a) { if (a.dataset.listAct === 'retry') loadList(); else go('content'); return; }
      const b = e.target.closest('[data-row]');
      if (!b) return;
      const tr = b.closest('tr');
      const row = (state.list || []).find(r => r.productId === tr.dataset.pid);
      if (!row) return;
      if (b.dataset.row === 'archive') { openArchive({ productId: row.productId, title: row.title }, b); return; }
      if (b.dataset.row === 'mockups') { toggleMockups(row); return; }
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      setText('mx-list-updated', `Refreshing “${row.title}”…`);
      try {
        const data = await api({ mode: 'product', productId: row.productId, refresh: true });
        const fresh = data.product || {};
        const thumb = fresh.thumb || imgUrl((fresh.images || [])[0]);
        Object.assign(row, { state: fresh.state && fresh.state !== 'UNKNOWN' ? fresh.state : row.state, url: fresh.url || row.url, thumb: thumb || row.thumb, ...(Array.isArray(fresh.images) ? { images: fresh.images, imagesLoaded: true } : {}) });
        renderList();
        setText('mx-list-updated', `“${row.title}” is up to date.`);
        $('mx-list').querySelector(`tr[data-pid="${CSS.escape(row.productId)}"] [data-row="refresh"]`)?.focus();
      } catch (error) {
        b.disabled = false;
        b.removeAttribute('aria-busy');
        setText('mx-list-updated', explain(error).text);
      }
    });

    // ── Start ──
    renderMode();
    renderCollections();
    renderRules();
    renderUrl();
    renderChip();
    syncContent();
    initFolds();
    VIEWS.forEach(v => show(`mx-view-${v}`, v === state.step));
    renderSteps();
    renderListTab();
    renderListCount();
    renderConn();
    loadStatus();
    loadMoments();
    window.MerchUI = { state, go, demo, refine, undo, redo, stop: stopMaking, openPop, closePop }; // for the UI check
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
