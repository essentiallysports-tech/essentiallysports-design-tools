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
   collections, collection-create, collection-set, sales, brainstorm-open /
   -turn / -line / -add / -get (the Brainstorm room: a shared line board per
   trend, opened from a moment card or "Brainstorm from my line"); upload-relay as a
   fallback when the direct upload is blocked: the PNG goes to Supabase Storage
   merch-art/<user>/<file>.png first, then the server streams it to Fourthwall)
   and window.MerchPrint (preview / closeup / photoMock / photoFor / render /
   checks / fallbackConcepts / variations / elementsOf; photosFor when the
   engine has it, for the model / angle switcher). Blanks: tee, long sleeve,
   crewneck, hoodie, tank, youth tee, tote, poster, sticker, mug.
   merch-stub.js stands in for anything MerchPrint lacks.
   Merch7: Publish sells one product in several colours (colour chips, send
   colors:[…], a preview per colour), "Quick publish" for admins (one tee,
   the stage colour, the suggested price, created hidden), and "Make an ad"
   (merch-ads.js: feed / story / carousel in the ES look, PNG or .zip).
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
  const VIEWS = ['content', 'brainstorm', 'designs', 'publish', 'list'];
  const BLANK_ORDER = ['tee', 'longsleeve', 'crewneck', 'hoodie', 'tank', 'youth', 'tote', 'poster', 'sticker', 'mug'];
  const BLANK_INFO = {
    tee: { label: 'T-shirt', noun: 'Tee', apparel: true },
    longsleeve: { label: 'Long sleeve', noun: 'Long sleeve tee', apparel: true },
    crewneck: { label: 'Crewneck', noun: 'Crewneck', apparel: true },
    hoodie: { label: 'Hoodie', noun: 'Hoodie', apparel: true },
    tank: { label: 'Tank top', noun: 'Tank', apparel: true },
    youth: { label: 'Youth tee', noun: 'Youth tee', apparel: true },
    tote: { label: 'Tote bag', noun: 'Tote', apparel: false },
    poster: { label: 'Poster', noun: 'Poster', apparel: false },
    sticker: { label: 'Sticker', noun: 'Sticker', apparel: false },
    mug: { label: 'Mug', noun: 'Mug', apparel: false },
  };
  const ANGLE_LABEL_PHOTO = { front: 'Front', side: 'Side', back: 'Back', lifestyle: 'Lifestyle', flat: 'Flat lay', detail: 'Detail' };
  const MAX_COLORS = 12; // the server takes 1–12 colours per product
  const ART_BUCKET = 'merch-art';
  const ETA = { basic: '10–20 seconds', pro: '20–40 seconds', preview: '10–30 seconds', create: 'about 30 seconds' };
  // Basic / Pro (owner decision): open to everyone; Pro counts against the same
  // weekly AI cap and the server falls back to Basic (fellBack) on cap / free mode / AI error.
  const AI_KEY = 'designMode'; // request + reply field for Basic / Pro ('mode' is the API action, and free mode rewrites it)
  const AI_MODES = {
    basic: { label: 'Basic', note: 'Simple ES pill designs. Quick, and light on your AI usage.', hint: '6 AI designs + ES styles (20+) · pills · about 20 s', count: 6 },
    pro: { label: 'Pro', note: 'Smarter AI (more usage), richer designs with extra elements, chat edits.', hint: '10 AI designs + ES styles (28) · art director, extras · about 60 s', count: 10 },
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
  const sameName = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase();
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
    if (demo && !window.MerchDemo) await loadScript('merch-demo.js?v=20261127-m7');

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
      photoAt: null, // the stage's model / angle: { angle, index } of the photo picked in the switcher
      pubColor: '', // the colour the Publish preview shows (one of state.colors)
      copy: null, quick: false,
    };

    // ── API ──
    async function api(body, { signal } = {}) {
      if (demo && window.MerchDemo) {
        // Sample data: long enough for the making checklist to show.
        await wait(body.mode === 'concepts' || body.mode === 'brainstorm-turn' ? 1400 : body.mode === 'brainstorm-open' ? 900 : 150, signal);
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
      syncQuick();
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
      if (state.step === 'brainstorm') renderBsMode();
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
      if (s === 'brainstorm') return Boolean(state.bs?.key);
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
      if (s === 'brainstorm') renderBrainstorm(); else if (from === 'brainstorm') stopPoll();
      if (s === 'designs') enterStudio();
      if (s === 'publish') state.enterP = enterPublish();
      if (s === 'list' && !state.list && !state.listBusy) loadList();
      if (from !== s) track('merch', { action: 'step', step: s, from });
      if (focus === 'heading') { const h = $(`mx-h-${s}`); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
      window.scrollTo(0, 0);
      return true;
    }
    function renderSteps() {
      const at = STEPS.indexOf(state.step === 'brainstorm' ? 'content' : state.step);
      show('mx-steps-crumb', state.step === 'brainstorm');
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
      if (to === 'content' && state.step === 'brainstorm' && b.id === 'mx-bs-back') {
        // Back to moments: land on the moment this board came from.
        const from = state.bs.from;
        go('content', { focus: 'none' });
        const card = from ? $('mx-moments')?.querySelector(`[data-mid="${CSS.escape(from)}"]`) : null;
        const target = card?.querySelector('[data-moment-brainstorm]') || null;
        (card || $('mx-moments-wrap'))?.scrollIntoView({ block: 'center' });
        (target || $('mx-text'))?.focus({ preventScroll: true });
        return;
      }
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
    const ANGLE_LABEL = { quote: 'Quote', nickname: 'Nickname', chant: 'Chant', callback: 'Callback', pun: 'Wordplay', stat: 'Stat', rivalry: 'Rivalry', era: 'Era', city: 'City pride', player: 'Player', troll: 'Troll' };
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
        <div class="mx-moment__print">
          <div class="mx-moment__printhead"><p class="mx-moment__label">What to print</p><button class="mx-moment__bs" type="button" data-moment-brainstorm="${esc(m.id)}" aria-label="Brainstorm more lines for ${esc(m.title)}"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-bulb"/></svg>Brainstorm</button></div>
          ${linesOf(m).length ? `<ul class="mx-mlines">${linesOf(m).map((l, n) => {
            const picked = on_ && state.trend?.momentLine === n;
            return `<li class="mx-mline${picked ? ' is-on' : ''}">
              <span class="mx-mline__main"><span class="mx-mline__pill">${esc(l.text)}</span><span class="mx-mline__angle">${esc(ANGLE_LABEL[l.angle] || 'Idea')}</span></span>
              <button class="es-btn es-btn--sm${picked ? ' is-on' : ''}" type="button" data-moment-line="${esc(m.id)}" data-line="${n}" aria-pressed="${Boolean(picked)}" aria-label="Design “${esc(l.text)}”">${picked ? 'In your brief' : 'Design this'}</button>
            </li>`;
          }).join('')}</ul>` : `<p class="mx-moment__empty">No shirt lines yet. <button class="es-btn es-btn--ghost es-btn--sm" type="button" data-moments="retry">Get AI ideas</button></p>`}
        </div>
        ${m.ai === false ? '' : `<div class="mx-moment__sell">
          <p class="mx-moment__label">Why it works${m.timing && TIMING_LABEL[m.timing] ? ` <span class="mx-moment__timing">${esc(TIMING_LABEL[m.timing])}</span>` : ''}</p>
          ${m.why ? `<p class="mx-moment__why">${esc(m.why)}</p>` : ''}
          ${m.audience ? `<p class="mx-moment__who"><span>Who buys it</span> ${esc(m.audience)}</p>` : ''}
        </div>`}
        ${m.ai === false ? '<p class="mx-moment__quick">Quick pick without AI. Press Refresh for AI shirt ideas.</p>' : ''}
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
      const bs = e.target.closest('[data-moment-brainstorm]');
      if (bs) { const m = (state.moments || []).find(x => String(x.id) === bs.dataset.momentBrainstorm); if (m) openBrainstorm({ trend: trendOfMoment(m), from: String(m.id) }); return; }
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
      show('mx-bs-from-line', contentPayload().text.length > 2);
      if (state.making) return;
      if (has) setText('mx-content-meta', '');
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
      if (typeof syncZoomBtn === 'function') syncZoomBtn();
      if (m && typeof closeZoom === 'function') closeZoom();
      // While the AI works the rail waits: no editing the last design.
      const rail = $('mx-rail');
      if (rail) {
        rail.setAttribute('aria-busy', String(Boolean(m)));
        rail.classList.toggle('is-busy', Boolean(m));
        [...rail.children].forEach(el => { if (!el.classList.contains('mx-actions--rail') && !el.classList.contains('mx-pop')) el.inert = Boolean(m); });
      }
      if (m) { const ang = $('mx-angles'); if (ang) { ang.hidden = true; ang.innerHTML = ''; ang.dataset.key = ''; } }
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
      // The story these designs come from: AI edits check facts against it, not
      // whatever is in the brief box later.
      state.made = { content, trend };
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
      // At least 20 designs a brief (owner, 2026-11-28): the AI picks first, then the same
      // words in named ES styles (merch-styles.js: no AI, no cost; print-checked, deduped).
      let all = next;
      try {
        if (window.MerchStyles && next.length) all = window.MerchStyles.expand(next, { mode: pro ? 'pro' : 'basic', min: 20, max: 28, garment: WHITE, sport: trend?.sport || state.sport || '', source: content.text || '' });
      } catch (error) { console.warn('merch styles', error); }
      // Print-checking, then a check mark before the designs show.
      m.done = true;
      m.stage = makingSteps(m).length;
      renderMaking();
      await wait(450);
      if (state.making !== m) return;
      endMaking();
      state.busy = '';
      syncCreateBtn();
      if (!all.length) {
        go('content', { focus: 'none' });
        setText('mx-content-meta', 'No designs came back. Try different words.');
        $('mx-text')?.focus();
        return;
      }
      state.concepts = all;
      state.selected = all[0].id;
      state.stripFilter = 'all';
      state.history = {}; state.future = []; state.chat = {}; state.notes = {}; state.lastEdit = {}; state.pal = {}; state.errCount = {};
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false;
      state.image = null; state.copyFor = ''; state.product = null; state.progFailed = false;
      track('merch', { action: 'concepts', mode: state.madeMode, asked, count: all.length, ai: next.length, trend: Boolean(trend) });
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
        b.className = `es-badge es-badge--${m === 'pro' || m === 'board' ? 'brand' : m === 'free' ? 'warn' : 'ink'}`;
        b.textContent = m === 'pro' ? 'Made with Pro' : m === 'free' ? 'Made without AI' : m === 'board' ? 'From the brainstorm' : 'Made with Basic';
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
        syncIdeaMore();
      } else setText('mx-idea', p ? [p.idea ? `The idea: ${p.idea}` : '', p.angle ? `Angle: ${p.angle}` : ''].filter(Boolean).join(' · ') : '');
    }

    // The idea box: two lines, "More" when it runs longer.
    function syncIdeaMore() {
      const box = $('mx-idea');
      const more = $('mx-idea-more');
      if (!box || !more) return;
      box.classList.remove('is-open');
      more.setAttribute('aria-expanded', 'false');
      more.textContent = 'More';
      requestAnimationFrame(() => {
        const t = box.querySelector('.mx-idea__text');
        const a = $('mx-idea-angle');
        more.hidden = box.hidden || !((t && t.scrollHeight > t.clientHeight + 1) || (a && a.scrollWidth > a.clientWidth + 1));
      });
    }
    on('mx-idea-more', 'click', () => {
      const box = $('mx-idea');
      const open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      const more = $('mx-idea-more');
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Less' : 'More';
    });
    window.addEventListener('resize', () => { if (!$('mx-idea')?.hidden && !$('mx-idea')?.classList.contains('is-open')) syncIdeaMore(); });

    // Filmstrip: every design as a small close-up; skeleton tiles while making.
    const thumbSpec = () => { const s = printSpec(); return { pixelsWidth: s.pixelsWidth, pixelsHeight: s.pixelsHeight, dpi: s.dpi }; };
    const filmBtn = id => $('mx-strip')?.querySelector(`[data-pick="${CSS.escape(id)}"]`);
    async function drawThumb(c) {
      if (!c) return;
      const cv = filmBtn(c.id)?.querySelector('canvas');
      if (!cv) return;
      try {
        if (MP().closeup) await MP().closeup(c, c.garment?.color, cv, { kind: kind(), spec: thumbSpec(), pad: 0.1 });
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
        const f = state.stripFilter || 'all';
        let shown = state.concepts.filter(c => f === 'all' || (f === 'style' ? c.source === 'style' : c.source !== 'style'));
        if (!shown.length) shown = state.concepts;
        state.stripShown = shown;
        box.innerHTML = shown.map(c => {
          const sel = c.id === state.selected;
          const pro = (MP().elementsOf ? MP().elementsOf(c) : (c.elements || [])).length > 0;
          return `<button class="mx-film${sel ? ' is-on' : ''}" type="button" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-pick="${esc(c.id)}" data-id="${esc(c.id)}" title="${esc(conceptLabel(c))}: ${esc(c.title)}" aria-label="${esc(conceptLabel(c))}: ${esc(c.title)}${c.variantOf ? ', variation' : ''}${pro ? ', with extras' : ''}">
            <canvas class="mx-film__img" width="192" height="224" aria-hidden="true"></canvas>
            <span class="mx-film__label">${esc(conceptLabel(c))}</span>
            ${c.variantOf || pro ? `<span class="mx-film__tags" aria-hidden="true">${c.source === 'style' ? '<span class="mx-film__tag">Style</span>' : c.variantOf ? '<span class="mx-film__tag">Variation</span>' : ''}${pro ? '<span class="mx-film__tag mx-film__tag--pro">Extras</span>' : ''}</span>` : ''}
          </button>`;
        }).join('');
      }
      if (keepNew) box.append(keepNew);
      const ais = state.concepts.filter(c => c.source !== 'style').length;
      setText('mx-strip-count', state.making ? '' : `${plural(state.concepts.length, 'design')}${ais && ais < state.concepts.length ? ` · ${ais} AI picks` : ''}`);
      const chips = $('mx-strip-filter');
      if (chips) chips.hidden = state.making || !state.concepts.some(c => c.source === 'style');
      syncContent();
      requestAnimationFrame(() => { filmIntoView(); syncFilmFade(); });
      if (!state.making) (state.stripShown || state.concepts).forEach(drawThumb);
    }
    on('mx-strip-filter', 'click', e => {
      const b = e.target.closest('[data-strip-filter]');
      if (!b) return;
      state.stripFilter = b.dataset.stripFilter;
      $('mx-strip-filter').querySelectorAll('[data-strip-filter]').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      renderStrip();
    });
    function selectDesign(id, focus = false) {
      if (id === state.selected || state.making) return;
      state.selected = id;
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false;
      state.image = null; state.copyFor = '';
      closePop(false);
      if (template()) pickColorFor(selectedConcept());
      $('mx-strip')?.querySelectorAll('[data-pick]').forEach(b => { const sel = b.dataset.pick === id; b.classList.toggle('is-on', sel); b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
      if (focus) filmBtn(id)?.focus({ preventScroll: true });
      filmIntoView();
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
    // The row scrolls (New set is its last tile); edges fade while there is more.
    function filmIntoView() {
      const row = $('mx-strip')?.closest('.mx-filmrow');
      const b = state.selected && filmBtn(state.selected);
      if (!row || !b) return;
      const r = row.getBoundingClientRect();
      const t = b.getBoundingClientRect();
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (t.left < r.left + 8) row.scrollBy({ left: t.left - r.left - 8, behavior: reduce ? 'auto' : 'smooth' });
      else if (t.right > r.right - 8) row.scrollBy({ left: t.right - r.right + 8, behavior: reduce ? 'auto' : 'smooth' });
    }
    function syncFilmFade() {
      const row = $('mx-strip')?.closest('.mx-filmrow');
      if (!row) return;
      row.dataset.fadeStart = String(row.scrollLeft > 2);
      row.dataset.fadeEnd = String(row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
    }
    document.querySelector('.mx-filmrow')?.addEventListener('scroll', syncFilmFade, { passive: true });
    window.addEventListener('resize', syncFilmFade);
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
    // Every Fourthwall photo of the blank in the nearest colour, as
    // [{ url, angle, index, calibrated, hex, name }]. The engine's photosFor
    // decides which photos have a measured print area (only those get the
    // design drawn); without it, today's rule: photo 0 of a calibrated template.
    // Photos may be strings (older templates) or { url, angle, index }.
    const photoUrl = p => (typeof p === 'string' ? p : p?.url || '');
    function nearestColor(list, garment) {
      const g = normHex(garment) || WHITE;
      const withPhotos = (list || []).filter(x => normHex(x.hex) && (x.photos || []).some(photoUrl));
      return withPhotos.sort((x, y) => colorDist(x.hex, g) - colorDist(y.hex, g))[0] || null;
    }
    // Apparel, plus any blank whose Fourthwall photo is calibrated (the tote).
    const photoKind = t => Boolean(t && (BLANK_INFO[kindOf(t)]?.apparel || (typeof MP().photoCal === 'function' && (() => { try { return Boolean(MP().photoCal(t.templateId, { photoIndex: 0 })); } catch { return false; } })())));
    function photosOf(garment) {
      const t = template() || defaultTemplate();
      if (!t || !photoKind(t)) return [];
      const col = nearestColor(t.colors, garment || WHITE);
      if (!col) return [];
      const meta = { hex: col.hex, name: col.name || '' };
      if (typeof MP().photosFor === 'function') {
        try {
          // Photos with Fourthwall's own sample print are never offered (they'd show someone else's art).
          const list = MP().photosFor(t.colors || [], col.hex, t.templateId, { region: state.side || 'front' });
          if (Array.isArray(list)) return list.filter(p => p && p.url && !p.sampleArt).map((p, i) => ({ url: p.url, angle: p.angle || 'unknown', index: Number.isInteger(p.index) ? p.index : i, view: p.view || p.side || '', calibrated: Boolean(p.calibrated), primary: Boolean(p.primary), ...meta }));
        } catch (error) { console.warn('merch photosFor', error); }
      }
      // Older engine: PHOTO_AREAS by template id then photo index, or the merch6
      // shape (one calibration per kind, photo 0 of the listed templates).
      const byId = MP().PHOTO_AREAS?.[t.templateId];
      const old = MP().PHOTO_AREAS?.[kindOf(t)];
      const oldOk = Boolean(old && Array.isArray(old.templates) && old.templates.includes(t.templateId));
      const calAt = i => Boolean(byId ? byId[i] && (!byId[i].side || byId[i].side === (/back/i.test(state.side || '') ? 'back' : 'front')) : oldOk && i === 0);
      return col.photos.filter(p => !(typeof p === 'object' && p?.sampleArt)).map((p, i) => ({ url: photoUrl(p), angle: (typeof p === 'object' && p?.angle) || (i === 0 ? 'front' : 'unknown'), index: typeof p === 'object' && Number.isInteger(p?.index) ? p.index : i, view: (typeof p === 'object' && p?.view) || '' })).filter(p => p.url).map(p => ({ ...p, calibrated: calAt(p.index), ...meta }));
    }
    // The photo the stage shows: the one picked in the switcher (same angle
    // in the new colour), else the first calibrated one, else the first.
    function photoChoice(garment, { pick = state.photoAt } = {}) {
      const list = photosOf(garment);
      if (!list.length) return null;
      // The same photo when this colour has it, else the same angle in the new colour.
      const same = pick && (list.find(p => p.index === pick.index && p.angle === pick.angle) || list.find(p => p.angle !== 'unknown' && p.angle === pick.angle) || list.find(p => p.index === pick.index));
      return same || list.find(p => p.primary) || list.find(p => p.calibrated) || list[0];
    }
    // A side photo says which way it faces (3/4 front, 3/4 back).
    const angleName = p => (p.angle === 'side' && /^(front|back)$/.test(p.view || '') ? `3/4 ${p.view}` : ANGLE_LABEL_PHOTO[p.angle] || `Photo ${p.index + 1}`);
    // Strip labels: never two the same (a second "Side" becomes "Side 2").
    function angleLabels(list) {
      const seen = {};
      const names = list.map(angleName);
      return names.map(n => { const total = names.filter(x => x === n).length; seen[n] = (seen[n] || 0) + 1; return total > 1 ? `${n} ${seen[n]}` : n; });
    }
    // Draws the design on a fresh canvas, then copies it to the visible one (no half-drawn frames).
    const plainPhotos = new Map();
    function loadPhotoImg(src) {
      if (!plainPhotos.has(src)) plainPhotos.set(src, new Promise(resolve => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => { const plain = new Image(); plain.onload = () => resolve(plain); plain.onerror = () => resolve(null); plain.src = src; }; img.src = src; }));
      return plainPhotos.get(src);
    }
    async function paint(c, view, { garment, photoPick = state.photoAt, width = 720 } = {}) {
      const off = document.createElement('canvas');
      const spec = thumbSpec();
      const k = kind();
      const g = garment || c.garment?.color || WHITE;
      let caption = '';
      try {
        if (view === 'closeup' && MP().closeup) {
          off.width = width; off.height = Math.round(width * 840 / 720);
          await MP().closeup(c, g, off, { kind: k, spec, pad: 0.14 });
          caption = 'Close-up of the print on the shirt colour.';
        } else {
          const ph = BLANK_INFO[k].apparel || photoKind(template() || defaultTemplate()) ? photoChoice(g, { pick: photoPick }) : null;
          let done = null;
          if (ph && !ph.calibrated) {
            // No measured print area on this photo: never draw on it; show the
            // photo as it is and say where the design is shown.
            const img = await loadPhotoImg(ph.url);
            if (img) {
              off.width = width;
              off.height = Math.round(width * (img.naturalHeight || 960) / (img.naturalWidth || 720));
              off.getContext('2d').drawImage(img, 0, 0, off.width, off.height);
              return { off, caption: `${angleName(ph)}${ph.name ? ` · ${ph.name}` : ''}: Fourthwall’s blank photo. The design is shown in Fourthwall’s mockups.`, photo: ph, pic: 'plain' };
            }
          }
          if (ph && ph.calibrated && MP().photoMock) {
            off.width = width;
            // width: engines that know it fetch a larger photo; older ones draw at the canvas size.
            done = await MP().photoMock(c, off, { photo: ph.url, kind: k, garmentColor: ph.hex, spec, logoSpot: logoSpotFor(), templateId: state.templateId || '', angle: ph.angle, photoIndex: ph.index, realism: true, ...(width !== 720 ? { width } : {}) });
          }
          if (done) caption = `FrameUp preview on Fourthwall’s blank photo${ph.angle !== 'unknown' && ph.angle !== 'front' ? ` · ${angleName(ph)}` : ''}${ph.name ? ` · ${ph.name}` : ''}${done.logoNote ? ` · ES logo on the ${({ 'back-neck': 'back neck', label: 'inside label', neck: 'neck' })[done.logoNote] || done.logoNote}, shown in Fourthwall’s mockups` : ''}`;
          else {
            await P('preview')(c, g, off, { logoSpot: logoSpotFor(), size: width, kind: k, spec });
            caption = BLANK_INFO[k].apparel ? 'FrameUp drawn preview (Fourthwall’s blank photo isn’t available).' : `FrameUp drawn preview of the ${BLANK_INFO[k].label.toLowerCase()}.`;
          }
        }
      } catch (error) { console.warn('merch stage', error); }
      return { off, caption, pic: view === 'closeup' ? 'closeup' : /^FrameUp preview on Fourthwall’s blank photo/.test(caption) ? 'photo' : 'flat' };
    }
    const tokens = { stage: 0, product: 0 };
    let canvasCtl = null; // merch-canvas.js: move / resize on the stage
    let canvasGesture = false; // one undo step per drag
    const rightsText = c => ((c.rights || []).length ? [...new Set(c.rights.map(r => RIGHTS_LABEL[r.kind] || r.kind))].join(', ') : 'none found');
    async function drawStage() {
      const c = selectedConcept();
      if (!c || state.making) return;
      const t = ++tokens.stage;
      const { off, caption, pic } = await paint(c, state.view, {});
      if (t !== tokens.stage) return;
      state.stagePic = pic;
      const cv = $('mx-stage-canvas');
      if (!cv) return;
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', `${conceptLabel(c)} design, ${state.view === 'closeup' ? 'close-up' : `on a ${nounLower()}`}: ${(c.stack || []).map(r => r.text).join(' / ')}`);
      cv.title = caption ? `${caption} Click to zoom.` : 'Click to zoom.';
      syncZoomBtn();
      // The caption is the one rights display in Design.
      const cap = $('mx-stage-cap');
      if (cap) cap.innerHTML = `<span class="mx-stage__title">${esc(c.title || 'Untitled design')}</span> · <span class="mx-stage__rights">Rights: ${esc(rightsText(c))}</span>${state.view === 'tee' && caption && /Fourthwall’s mockups\.$/.test(caption) ? `<span class="mx-stage__photo-note">${esc(caption)}</span>` : ''}`;
      renderAngles();
      canvasCtl?.refresh();
    }
    // Model / angle switcher: every Fourthwall photo of the blank in this colour.
    function renderAngles() {
      const c = selectedConcept();
      const list = c && state.view === 'tee' && !state.making && apparel() ? photosOf(c.garment?.color) : [];
      const cur = list.length ? photoChoice(c.garment?.color) : null;
      const key = list.map(p => `${p.url}|${p.calibrated}`).join(',') + `|${cur?.url}`;
      ['mx-angles', 'mx-zoom-angles'].forEach(id => {
        const box = $(id);
        if (!box) return;
        box.hidden = list.length < 2;
        if (list.length < 2) { box.innerHTML = ''; box.dataset.key = ''; return; }
        if (box.dataset.key === key) return;
        box.dataset.key = key;
        box.innerHTML = angleButtons(list, cur);
      });
      if (list.length >= 2) queueAngleThumbs();
    }
    function angleButtons(list, cur) {
      const labels = angleLabels(list);
      return list.map((p, i) => {
        const on_ = p === cur || (cur && p.url === cur.url);
        const name = labels[i];
        return `<button class="mx-angle${p.calibrated ? ' is-drawn' : ' is-plain'}" type="button" role="radio" aria-checked="${on_}" tabindex="${on_ ? 0 : -1}" data-angle-i="${p.index}" data-angle="${esc(p.angle)}" data-url="${esc(p.url)}" aria-label="${esc(name)}${p.calibrated ? ', design shown on this photo' : ', photo only'}" title="${esc(p.calibrated ? `${name}: design shown on this photo` : `${name}: photo only (the design shows in Fourthwall’s mockups)`)}"><span class="mx-angle__pic"><img src="${esc(imgUrl(p.url))}" alt="" loading="lazy"></span><span class="mx-angle__label">${esc(name)}</span></button>`;
      }).join('');
    }
    // Calibrated thumbnails show a small version of the design (cached).
    const angleThumbs = new Map();
    let angleThumbTimer = 0;
    function designKey(c) { return JSON.stringify([c.id, c.stack, c.palette, c.elements, c.fit, c.align, c.split, c.garment, state.templateId, state.side]); }
    function queueAngleThumbs() {
      clearTimeout(angleThumbTimer);
      angleThumbTimer = setTimeout(drawAngleThumbs, 250);
    }
    async function drawAngleThumbs() {
      const c = selectedConcept();
      if (!c || state.making || !MP().photoMock) return;
      const k = kind();
      const list = photosOf(c.garment?.color).filter(p => p.calibrated);
      const dk = designKey(c);
      for (const p of list) {
        const key = `${dk}|${p.url}`;
        let url = angleThumbs.get(key);
        if (!url) {
          try {
            const off = document.createElement('canvas');
            off.width = 144;
            const done = await MP().photoMock(c, off, { photo: p.url, kind: k, garmentColor: p.hex, spec: thumbSpec(), logoSpot: logoSpotFor(), templateId: state.templateId || '', angle: p.angle, photoIndex: p.index, realism: true });
            if (!done) continue;
            url = off.toDataURL('image/jpeg', 0.85);
          } catch { continue; }
          if (angleThumbs.size > 48) angleThumbs.delete(angleThumbs.keys().next().value);
          angleThumbs.set(key, url);
        }
        if (designKey(selectedConcept() || {}) !== dk) return;
        document.querySelectorAll(`.mx-angles [data-url="${CSS.escape(p.url)}"] img`).forEach(img => { if (img.getAttribute('src') !== url) { img.src = url; img.closest('.mx-angle')?.classList.add('has-design'); } });
      }
    }
    function pickAngle(btn) {
      const c = selectedConcept();
      if (!c || !btn) return;
      const strip = btn.closest('.mx-angles')?.id || 'mx-angles';
      state.photoAt = { angle: btn.dataset.angle, index: Number(btn.dataset.angleI) || 0 };
      track('merch', { action: 'angle', angle: btn.dataset.angle });
      drawStage().then(() => {
        if (strip === 'mx-zoom-angles') zoomRender(true);
        $(strip)?.querySelector(`[data-angle-i="${CSS.escape(btn.dataset.angleI)}"]`)?.focus({ preventScroll: true });
      });
    }
    ['mx-angles', 'mx-zoom-angles'].forEach(id => {
      on(id, 'click', e => pickAngle(e.target.closest('[data-angle-i]')));
      on(id, 'keydown', e => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        const all = [...$(id).querySelectorAll('[data-angle-i]')];
        const i = Math.max(0, all.findIndex(b => b.getAttribute('aria-checked') === 'true'));
        pickAngle(all[(i + d + all.length) % all.length]);
      });
    });

    // ── Zoom viewer: the stage photo / close-up at 1x-4x, drawn larger ──
    // Opens from the zoom button or a click on the stage. +/- / wheel / pinch
    // (ctrl+wheel) zoom, drag or arrows pan, 0 resets, Esc closes. The modal
    // dialog keeps focus inside and focus goes back to where it came from.
    const ZOOM_W = 1600;
    const zoom = { s: 1, x: 0, y: 0, token: 0, from: null, drag: null };
    const zoomDlg = () => $('mx-zoom');
    const zoomOpen = () => Boolean(zoomDlg()?.open);
    function zoomCanOpen() { return Boolean(selectedConcept()) && !state.making && !$('mx-stage-canvas')?.hidden; }
    function syncZoomBtn() { const b = $('mx-zoom-open'); if (b) b.disabled = !zoomCanOpen(); }
    function zoomBounds() {
      const view = $('mx-zoom-view');
      const cv = $('mx-zoom-canvas');
      if (!view || !cv) return { mx: 0, my: 0 };
      const w = cv.offsetWidth * zoom.s;
      const h = cv.offsetHeight * zoom.s;
      return { mx: Math.max(0, (w - view.clientWidth) / 2), my: Math.max(0, (h - view.clientHeight) / 2) };
    }
    function zoomApply() {
      const { mx, my } = zoomBounds();
      zoom.x = Math.min(mx, Math.max(-mx, zoom.x));
      zoom.y = Math.min(my, Math.max(-my, zoom.y));
      const cv = $('mx-zoom-canvas');
      if (cv) cv.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
      setText('mx-zoom-level', `${Math.round(zoom.s * 100)}%`);
      const out = $('mx-zoom-out'); if (out) out.disabled = zoom.s <= 1;
      const inn = $('mx-zoom-in'); if (inn) inn.disabled = zoom.s >= 4;
      const view = $('mx-zoom-view');
      if (view) { view.dataset.zoomed = String(zoom.s > 1); view.setAttribute('aria-label', `Zoomed preview at ${Math.round(zoom.s * 100)}%`); }
    }
    // Zoom to s around a point (px from the view's centre; default the centre).
    function zoomTo(s, px = 0, py = 0) {
      const next = Math.min(4, Math.max(1, Math.round(s * 100) / 100));
      const k = next / zoom.s;
      zoom.x = px - (px - zoom.x) * k;
      zoom.y = py - (py - zoom.y) * k;
      zoom.s = next;
      if (next === 1) { zoom.x = 0; zoom.y = 0; }
      zoomApply();
    }
    const zoomStep = dir => zoomTo(dir > 0 ? zoom.s * 1.5 : zoom.s / 1.5);
    function zoomCaption() {
      const c = selectedConcept();
      if (!c) return '';
      const ph = state.view === 'tee' && apparel() ? photoChoice(c.garment?.color) : null;
      return [c.title || conceptLabel(c), state.view === 'closeup' ? 'Close-up' : ph ? angleName(ph) : `On a ${nounLower()}`, ph?.name || c.garment?.name || ''].filter(Boolean).join(' · ');
    }
    // Copy the stage at once, then draw the larger render behind a spinner.
    async function zoomRender(keep = false) {
      const c = selectedConcept();
      const cv = $('mx-zoom-canvas');
      if (!c || !cv || !zoomOpen()) return;
      const t = ++zoom.token;
      const stage = $('mx-stage-canvas');
      if (stage && stage.width) { cv.width = stage.width; cv.height = stage.height; cv.getContext('2d').drawImage(stage, 0, 0); }
      setText('mx-zoom-cap', zoomCaption());
      if (!keep) { zoom.s = 1; zoom.x = 0; zoom.y = 0; }
      zoomApply();
      show('mx-zoom-busy', true);
      $('mx-zoom-view')?.setAttribute('aria-busy', 'true');
      const { off } = await paint(c, state.view, { width: ZOOM_W });
      if (t !== zoom.token || !zoomOpen()) return;
      if (off.width && off.height) { cv.width = off.width; cv.height = off.height; cv.getContext('2d').drawImage(off, 0, 0); cv.dataset.hires = String(off.width); }
      show('mx-zoom-busy', false);
      $('mx-zoom-view')?.setAttribute('aria-busy', 'false');
      zoomApply();
    }
    function openZoom(from) {
      const dlg = zoomDlg();
      if (!dlg || !zoomCanOpen() || dlg.open) return;
      zoom.from = from || document.activeElement;
      ['mx-zoom-angles'].forEach(id => { const b = $(id); if (b) b.dataset.key = ''; });
      dlg.showModal();
      renderAngles();
      zoomRender();
      $('mx-zoom-view')?.focus({ preventScroll: true });
      track('merch', { action: 'zoom', view: state.view });
    }
    function closeZoom() { const dlg = zoomDlg(); if (dlg?.open) dlg.close(); }
    on('mx-zoom', 'close', () => {
      zoom.token += 1;
      zoom.drag = null;
      const back = zoom.from && zoom.from.isConnected && !zoom.from.disabled ? zoom.from : $('mx-zoom-open');
      zoom.from = null;
      // After the browser's own focus restore, so ours wins.
      back?.focus?.({ preventScroll: true });
      setTimeout(() => back?.focus?.({ preventScroll: true }), 0);
    });
    on('mx-zoom-open', 'click', e => openZoom(e.currentTarget));
    on('mx-stage-canvas', 'click', () => openZoom($('mx-zoom-open')));
    on('mx-zoom-close', 'click', closeZoom);
    on('mx-zoom-in', 'click', () => zoomStep(1));
    on('mx-zoom-out', 'click', () => zoomStep(-1));
    on('mx-zoom-reset', 'click', () => zoomTo(1));
    // A click on the backdrop closes it.
    on('mx-zoom', 'click', e => { if (e.target === zoomDlg()) closeZoom(); });
    on('mx-zoom', 'keydown', e => {
      if (e.metaKey || e.altKey) return;
      if (e.target.closest?.('.mx-angles')) return;
      const k = e.key;
      if (k === '+' || k === '=') { e.preventDefault(); zoomStep(1); }
      else if (k === '-' || k === '_') { e.preventDefault(); zoomStep(-1); }
      else if (k === '0') { e.preventDefault(); zoomTo(1); }
      else if (/^Arrow/.test(k) && !e.target.closest?.('button')) {
        e.preventDefault();
        const step = e.shiftKey ? 160 : 48;
        zoom.x += k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0;
        zoom.y += k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
        zoomApply();
      }
    });
    const viewPoint = (e) => { const r = $('mx-zoom-view').getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
    on('mx-zoom-view', 'wheel', e => {
      e.preventDefault();
      // Pinch arrives as ctrl+wheel with small deltas; a mouse wheel as larger steps.
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomTo(zoom.s * f, ...viewPoint(e));
    }, { passive: false });
    on('mx-zoom-view', 'dblclick', e => { if (zoom.s > 1) zoomTo(1); else zoomTo(2, ...viewPoint(e)); });
    on('mx-zoom-view', 'pointerdown', e => {
      if (zoom.s <= 1 || e.button !== 0) return;
      zoom.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y };
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic or ended pointer */ }
      e.currentTarget.classList.add('is-dragging');
    });
    on('mx-zoom-view', 'pointermove', e => {
      const d = zoom.drag;
      if (!d || d.id !== e.pointerId) return;
      zoom.x = d.ox + (e.clientX - d.x);
      zoom.y = d.oy + (e.clientY - d.y);
      zoomApply();
    });
    const endDrag = e => { if (zoom.drag && zoom.drag.id === e.pointerId) { zoom.drag = null; e.currentTarget.classList.remove('is-dragging'); } };
    on('mx-zoom-view', 'pointerup', endDrag);
    on('mx-zoom-view', 'pointercancel', endDrag);
    window.addEventListener('resize', () => { if (zoomOpen()) zoomApply(); });
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
      syncQuick();
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
            <span class="mx-pill__acts">
              <button class="mx-icon es-icon-btn" type="button" data-pill-act="up" data-i="${i}" aria-label="Move pill ${n} up" title="Move up"${i === 0 ? ' disabled' : ''}><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-up"/></svg></button>
              <button class="mx-icon es-icon-btn" type="button" data-pill-act="down" data-i="${i}" aria-label="Move pill ${n} down" title="Move down"${i === stack.length - 1 ? ' disabled' : ''}><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-down"/></svg></button>
              <button class="mx-icon es-icon-btn" type="button" data-pill-act="drop" data-i="${i}" aria-label="Remove pill ${n}" title="Remove"${stack.length < 2 ? ' disabled' : ''}><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-close"/></svg></button>
            </span>
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
      // Replace only this design's earlier "Try other layouts" results (never the
      // style designs), and skip layouts that already exist in the strip.
      const keep = state.concepts.filter(x => !(x.variantOf === root && x.variant && x.source !== 'style') || x.id === c.id);
      const pos = keep.findIndex(x => x.id === c.id);
      const sig = x => JSON.stringify([(x.stack || []).map(r => [r.text, r.size, r.fill, r.ink]), x.align || 'left', x.garment?.color || '', x.fit?.scale || 1, x.fit?.topIn ?? null, (x.elements || []).map(e => [e.type, e.position, e.name || e.text || ''])]);
      const have = new Set(keep.map(sig));
      const fresh = list.filter(v => v.id !== c.id).map(v => ({ ...v, variantOf: root, mode: c.mode, paletteFrom: c.paletteFrom, garment: { ...(v.garment || {}) } })).filter(v => { const k = sig(v); if (have.has(k)) return false; have.add(k); return true; });
      if (!fresh.length) { setText('mx-fit-read', 'Every layout for these words is already in the filmstrip.'); return; }
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
    // position:fixed is relative to the nearest transformed/filtered ancestor
    // (the studio's entrance animation leaves one), not the screen, so the
    // popover could run off-screen. Place it in screen coordinates and subtract
    // that ancestor's offset; measured after it is visible; kept on screen both
    // ways (scrolls inside when taller than the screen).
    function fixedOrigin(el) {
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain || '') || /transform|filter/.test(cs.willChange || '')) {
          const r = a.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }
      }
      return { x: 0, y: 0 };
    }
    function placePop(el, btn) {
      el.style.position = 'fixed';
      el.style.zIndex = '60';
      el.style.maxHeight = `${Math.max(160, window.innerHeight - 16)}px`;
      el.style.overflowY = 'auto';
      const place = () => {
        const r = btn.getBoundingClientRect();
        const w = el.offsetWidth || 304;
        const h = el.offsetHeight || 260;
        let left = r.left;
        if (left + w > window.innerWidth - 8) left = r.right - w;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        const below = r.bottom + 6;
        let top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
        top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
        const o = fixedOrigin(el);
        el.style.left = `${Math.round(left - o.x)}px`;
        el.style.top = `${Math.round(top - o.y)}px`;
      };
      place();
      requestAnimationFrame(place);
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
      if (hard) { setText('mx-tee-colors-note', 'White'); setText('mx-tee-colors-hint', `A ${BLANK_INFO[kind()].label.toLowerCase()} prints on white. Change the product in Publish.`); return; }
      const { real, list } = teeColorChoices(c);
      const cur = currentTee(c, list);
      box.setAttribute('role', 'radiogroup');
      if (!box.getAttribute('aria-label')) box.setAttribute('aria-label', `${BLANK_INFO[kind()].noun} colour`);
      setText('mx-tee-colors-label', `${BLANK_INFO[kind()].noun} colour`);
      box.innerHTML = list.map(g => { const sel = g === cur; return `<button class="mx-swatch${PAL()?.isLight(g.color) ? ' is-light' : ''}" type="button" role="radio" aria-checked="${sel}" tabindex="${sel || (!cur && g === list[0]) ? 0 : -1}" style="--sw:${esc(g.color)}" aria-label="${esc(g.name)}" title="${esc(g.name)}" data-hex="${esc(g.color)}" data-name="${esc(g.name)}"></button>`; }).join('');
      setText('mx-tee-colors-note', cur ? cur.name : c.garment?.name || '');
      setText('mx-tee-colors-hint', real ? 'Fourthwall’s colours for this blank.' : state.templatesError ? 'The shop’s colours didn’t load; showing ES defaults.' : 'Loading the shop’s colours…');
    }
    function pickTee(btn) {
      const c = selectedConcept();
      if (!c || !btn) return;
      remember(c);
      c.garment = { color: btn.dataset.hex, name: btn.dataset.name };
      if (template() && (template().colors || []).some(x => x.name === btn.dataset.name)) state.colors = multiColor() ? [btn.dataset.name, ...state.colors.slice(1).filter(n => n !== btn.dataset.name)] : [btn.dataset.name];
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
      const sel = (field, i, opts, value, label) => `<select class="es-select es-select--sm" data-el-field="${field}" data-i="${i}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
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
        return `<div class="mx-el" data-el="${i}"><div class="mx-el__head"><span class="mx-el__type">${esc(EL_LABEL[e.type] || e.type)}</span><button class="mx-icon es-icon-btn" type="button" data-el-drop="${i}" aria-label="Remove ${esc(n)}" title="Remove"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-close"/></svg></button></div><div class="mx-el__fields">${bits.join('')}</div></div>`;
      }).join('') : '<p class="mx-meta">No extras yet. Pills alone are the classic ES look.</p>'));
      const num = sourceNumber();
      $('mx-el-add')?.querySelectorAll('[data-el-add]').forEach(b => {
        const noNum = b.dataset.elAdd === 'number' && !num;
        b.disabled = !pro || list.length >= 3 || noNum;
        b.title = !pro ? 'Switch to Pro to add extras.' : list.length >= 3 ? 'Up to 3 extras.' : noNum ? 'Needs a number in your story: add one to your words first.' : '';
        // The reason, for screen readers too (the label stays the chip's word).
        let why = b.querySelector('.es-sr-only');
        const reason = b.disabled ? (!pro ? 'needs Pro' : list.length >= 3 ? 'up to 3 extras' : 'needs a number in your story') : '';
        if (reason && !why) { why = document.createElement('span'); why.className = 'es-sr-only'; b.append(why); }
        if (why) why.textContent = reason ? ` (${reason})` : '';
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
      const body = { mode: 'refine', concept: forServer(c), instruction: text, content: state.made?.content || contentPayload(), [AI_KEY]: state.aiMode, history };
      const trend = state.made ? state.made.trend : trendBody();
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
      if (e.target.closest?.('#mx-angles')) return;
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
    // The logo goes inside the print on hard goods and on blanks with no small logo area (tank, youth tee, tote: template.logo 'inside').
    const insideLogo = () => !apparel() || template()?.logo === 'inside';
    const logoAreas = () => (!insideLogo() ? (template()?.areas || []).filter(a => usable(a) && a.suitsLogo && a.regionId !== state.side) : []);
    const areaLabel = a => a.name || a.label || String(a.regionId).replace(/[_-]+/g, ' ').replace(/^./, m => m.toUpperCase());
    const area = () => designAreas().find(a => a.regionId === state.side) || designAreas()[0] || null;
    const logoArea = () => logoAreas().find(a => a.regionId === state.logo) || null;
    const logoInline = () => insideLogo() && state.logo === 'inline';
    const logoSpot = () => { if (logoInline()) return 'inline'; const la = logoArea(); if (!la) return 'none'; const r = la.regionId.toLowerCase(); return /sleeve/.test(r) ? 'sleeve' : /back/.test(r) ? 'back-neck' : /label/.test(r) ? 'label' : 'neck'; };
    const logoSpotFor = () => (template() ? logoSpot() : 'sleeve');
    const logoText = () => (logoInline() ? 'ES logo inside the design' : logoArea() ? `ES logo on the ${areaLabel(logoArea()).toLowerCase()}` : 'no ES logo');
    const hexOfColor = name => (template()?.colors || []).find(x => x.name === name)?.hex || '';
    const garmentHex = () => hexOfColor(state.colors[0]) || (apparel() ? selectedConcept()?.garment?.color : WHITE);
    // Several colours in one product: only when the server says the blank takes them.
    const multiColor = () => Boolean(template()?.multiColor) && (template()?.colors || []).length > 1;
    const pubColorName = () => (state.colors.includes(state.pubColor) ? state.pubColor : state.colors[0] || '');
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
      const { off, caption } = await paint(c, 'tee', { garment: hexOfColor(pubColorName()) || garmentHex(), photoPick: null });
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
      if (state.copyFor !== copyKey(c)) state.copyP = loadCopy(c);
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
      const extras = state.colors.slice(1);
      // The design's colour first; extra colours picked in Publish stay while the product has them.
      const withExtras = main => (multiColor() ? [main, ...extras.filter(n => n !== main && list.some(x => x.name === n))].slice(0, MAX_COLORS) : [main]);
      if (!apparel()) { state.colors = fallback ? withExtras(fallback.name) : []; return; }
      const exact = list.find(x => x.name === c?.garment?.name && sameHex(x.hex, c?.garment?.color)) || list.find(x => sameHex(x.hex, c?.garment?.color)) || list.find(x => x.name === c?.garment?.name);
      if (exact) { state.colors = withExtras(exact.name); return; }
      const g = normHex(c?.garment?.color);
      const near = g ? list.filter(x => normHex(x.hex)).sort((x, y) => colorDist(x.hex, g) - colorDist(y.hex, g))[0] : null;
      const pick = near || fallback;
      state.colors = pick ? withExtras(pick.name) : [];
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
      if (insideLogo()) state.logo = 'inline';
      else if (!logos.some(x => x.regionId === state.logo)) state.logo = logos[0]?.regionId || null;
      state.image = null; state.logoImage = null;
      if (before !== kind()) state.mock = { key: '', images: [], busy: state.mock.busy, error: '' }; // another product's mockups don't apply
      if (render) {
        renderPublish();
        const c = selectedConcept();
        if (before !== kind() && c) state.copyP = loadCopy(c);
        autoMockups();
      }
    }
    // Base cost: the template's, or the highest of the chosen colours when they differ (merch7 colours carry base).
    const base = () => { const t = template(); const per = (t?.colors || []).filter(x => state.colors.includes(x.name)).map(x => Number(x.base)).filter(n => n > 0); return per.length ? Math.max(...per) : Number(t?.basePrice) || 0; };
    function blankCard(x) {
      const k = kindOf(x);
      const sel = x.templateId === state.templateId;
      const fits = (selectedConcept()?.blanks || []).includes(k);
      const sug = Number(x.pricing?.suggested ?? x.suggestedPrice) > 0 ? Number(x.pricing?.suggested ?? x.suggestedPrice) : (window.MerchRules?.suggestedPrice ? window.MerchRules.suggestedPrice(k, x.basePrice) : null);
      const photo = (x.colors || []).find(cc => (cc.photos || []).length)?.photos?.[0] || '';
      return `<button class="mx-blank" type="button" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-tpl="${esc(x.templateId)}" data-kind="${esc(k)}" aria-label="${esc(x.label || BLANK_INFO[k].label)}, base cost ${x.basePrice != null ? money(x.basePrice) : 'unknown'}${sug ? `, suggested price ${money(sug)}` : ''}${fits ? ', suits this design' : ''}">
        <span class="mx-blank__icon" aria-hidden="true">${photo ? `<img class="mx-blank__photo" src="${esc(imgUrl(photo))}" alt="" loading="lazy">` : BLANK_ICON[k] || ''}${fits ? '<span class="mx-blank__fit"></span>' : ''}</span>
        <span class="mx-blank__name" title="${esc(x.label || BLANK_INFO[k].label)}">${esc(BLANK_INFO[k].label)}</span>
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
      if (el) el.textContent = !template() ? '' : apparel() ? `${state.colors[0] || c?.garment?.name || 'White'} ${nounLower()}` : (template().colors || []).length > 1 ? `${state.colors[0] || ''} ${nounLower()}`.trim() : `${BLANK_INFO[kind()].label} · prints on white`;
      show('mx-pub-color-change', Boolean(template()) && apparel());
      if ($('mx-pub-color-note')) { setText('mx-pub-color-note', note); show('mx-pub-color-note', Boolean(note)); }
      renderPubColors();
    }
    // Colours to sell (one product, several colours): the design's colour is
    // always in; tick more. Only when the blank takes several colours.
    function renderPubColors() {
      const wrap = $('mx-pcolors-wrap');
      const box = $('mx-pcolors');
      if (!wrap || !box) return;
      const multi = Boolean(template()) && multiColor();
      wrap.hidden = !multi;
      if (!multi) { box.innerHTML = ''; return; }
      const list = (template().colors || []).filter(x => x.name);
      const main = state.colors[0];
      const full = state.colors.length >= MAX_COLORS;
      box.innerHTML = list.map(x => {
        const on_ = state.colors.includes(x.name);
        const isMain = x.name === main;
        return `<label class="mx-colchip${isMain ? ' is-main' : ''}" title="${esc(isMain ? `${x.name}: the design’s colour. Change it in Design.` : x.name)}"><input type="checkbox" data-pub-color="${esc(x.name)}"${on_ ? ' checked' : ''}${isMain || (full && !on_) ? ' disabled' : ''}><span class="mx-colchip__sw${PAL()?.isLight(x.hex) ? ' is-light' : ''}" style="--sw:${esc(normHex(x.hex) || '#FFFFFF')}" aria-hidden="true"></span><span class="mx-colchip__name">${esc(x.name)}</span>${isMain ? '<span class="mx-colchip__tag">Design</span>' : ''}</label>`;
      }).join('');
      const sizes = (template().sizes || []).filter(Boolean);
      setText('mx-pcolors-note', `${plural(state.colors.length, 'colour')} in one product${sizes.length ? ` · sizes ${sizes[0]}–${sizes[sizes.length - 1]}` : ''}${full ? ` · up to ${MAX_COLORS}` : ''}`);
    }
    on('mx-pcolors', 'change', e => {
      const x = e.target.closest('[data-pub-color]');
      if (!x) return;
      const name = x.dataset.pubColor;
      if (name === state.colors[0]) { x.checked = true; return; }
      state.colors = x.checked ? [...state.colors.filter(n => n !== name), name].slice(0, MAX_COLORS) : state.colors.filter(n => n !== name);
      if (!state.colors.includes(state.pubColor)) state.pubColor = '';
      track('merch', { action: 'colors', count: state.colors.length });
      renderPubColors();
      syncEarn();
      productChanged();
      $('mx-pcolors')?.querySelector(`[data-pub-color="${CSS.escape(name)}"]`)?.focus();
    });
    // A small preview per colour under the stage; pick one to see it big.
    let variantsT = 0;
    async function renderVariants() {
      const box = $('mx-pvariants');
      if (!box) return;
      const c = selectedConcept();
      const names = c && apparel() && !liveShown() ? state.colors.slice() : [];
      box.hidden = names.length < 2;
      if (names.length < 2) { box.innerHTML = ''; return; }
      const cur = pubColorName();
      const key = `${mockKey()}|${names.join(',')}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = names.map(n => `<button class="mx-pvar" type="button" role="radio" aria-checked="${n === cur}" tabindex="${n === cur ? 0 : -1}" data-pvar="${esc(n)}" aria-label="Preview in ${esc(n)}"><canvas class="mx-pvar__img" width="96" height="112" aria-hidden="true"></canvas><span class="mx-pvar__name">${esc(n)}</span></button>`).join('');
        const t = ++variantsT;
        for (const n of names) {
          const { off } = await paint(c, 'tee', { garment: hexOfColor(n) || WHITE, photoPick: null });
          if (t !== variantsT) return;
          const cv = box.querySelector(`[data-pvar="${CSS.escape(n)}"] canvas`);
          if (!cv) continue;
          cv.width = 192; cv.height = Math.round(192 * off.height / Math.max(1, off.width));
          cv.getContext('2d').drawImage(off, 0, 0, cv.width, cv.height);
          cv.dataset.drawn = '1';
        }
      } else box.querySelectorAll('[data-pvar]').forEach(b => { const on_ = b.dataset.pvar === cur; b.setAttribute('aria-checked', String(on_)); b.tabIndex = on_ ? 0 : -1; });
    }
    function pickVariant(btn) {
      if (!btn) return;
      state.pubColor = btn.dataset.pvar;
      renderVariants();
      drawProductStage();
      renderMockups();
      $('mx-pvariants')?.querySelector(`[data-pvar="${CSS.escape(state.pubColor)}"]`)?.focus();
    }
    on('mx-pvariants', 'click', e => pickVariant(e.target.closest('[data-pvar]')));
    on('mx-pvariants', 'keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const all = [...$('mx-pvariants').querySelectorAll('[data-pvar]')];
      const i = Math.max(0, all.findIndex(b => b.getAttribute('aria-checked') === 'true'));
      pickVariant(all[(i + d + all.length) % all.length]);
    });
    // "More options" (description, print area, ES logo, collections): closed, with a one-line summary.
    function renderPubMore() {
      const colls = (state.shopColls || []).filter(x => state.pick.setup.includes(x.id)).length;
      setText('mx-pub-more-meta', template() ? [designAreas().length > 1 ? areaLabel(area() || designAreas()[0]) : '', logoText().replace(/^ES logo /, 'logo '), colls ? plural(colls, 'collection') : 'no collections'].filter(Boolean).join(' · ') : '');
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
        logo.innerHTML = !insideLogo()
          ? `${logos.map(a => `<option value="${esc(a.regionId)}">${esc(areaLabel(a))}</option>`).join('')}<option value="">No logo</option>`
          : '<option value="inline">Inside the design (small ES pill at the bottom)</option><option value="">No logo</option>';
        logo.value = (!insideLogo() ? state.logo : (state.logo === 'inline' ? 'inline' : '')) || '';
      }
      setText('mx-logo-hint', insideLogo()
        ? `A ${BLANK_INFO[k].label.toLowerCase()} has ${apparel() ? 'no small logo area' : 'one print area'}, so the small ESSENTIALLYSPORTS pill is printed at the bottom of the design, in the same file.`
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
        const data = await api({ mode: 'copy', concept: forServer(c), content: { ...contentPayload(), trend: trendBody() }, blank: kind(), ...(state.colors.length ? { colors: state.colors.slice() } : {}) });
        if (state.copyFor !== key) return;
        const copy = data.copy || data;
        state.copy = { key, title: copy.title || '', description: copy.description || '', adLine: copy.adLine || copy.ad?.line || '', ai: data.ai !== false && !data.free };
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
      const colorText = state.colors.length > 2 ? `${state.colors[0]} + ${state.colors.length - 1} more colours` : state.colors.join(' and ');
      const summary = template() ? [BLANK_INFO[kind()].label, apparel() ? colorText : '', Number(val('mx-price')) > 0 ? money(val('mx-price')) : '', logoText(), colls.length ? `in ${colls.join(', ')}` : '', left != null ? `${left} create${left === 1 ? '' : 's'} left today` : 'up to 10 creates a day'].filter(Boolean).join(' · ') : '';
      setText('mx-setup-meta', state.copyMsg || summary);
      syncMockButton();
      renderPubMore();
      syncQuick();
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
    on('mx-logo', 'change', () => { state.logo = val('mx-logo') || null; state.logoImage = null; if (insideLogo()) state.image = null; productChanged(); });
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
      const raw = (list || []).filter(m => imgUrl(m));
      if (!raw.length) return '';
      // Several colours: one group per colour (the gallery follows the same order).
      const colors = [...new Set(raw.map(m => m?.color || '').filter(Boolean))];
      const grouped = colors.length > 1;
      const items = grouped ? colors.flatMap(cn => raw.filter(m => m?.color === cn)).concat(raw.filter(m => !m?.color)) : raw;
      const id = gid || galleryOf(items, label);
      const fig = (m, i) => `<figure class="mx-mock"><button class="mx-mock__btn" type="button" data-gal="${id}" data-gi="${i}" aria-label="View ${esc(m?.color || label)} mockup ${i + 1} of ${items.length}"><img src="${esc(imgUrl(m))}" alt="" loading="lazy"></button>${m?.color && !grouped ? `<figcaption>${esc(m.color)}</figcaption>` : ''}</figure>`;
      const head = `<p class="mx-meta mx-mockups__count">${plural(items.length, 'mockup')}${grouped ? ` in ${plural(colors.length, 'colour')}` : ''} · click one to enlarge</p>`;
      if (!grouped) return `${head}<div class="mx-mockups__grid">${items.map(fig).join('')}</div>`;
      let at = 0;
      return `${head}${[...colors, ''].map(cn => { const part = items.filter(m => (m?.color || '') === cn); if (!part.length) return ''; const html = `<div class="mx-mockups__group"><p class="mx-mockups__color">${esc(cn || 'Other')}<span class="mx-mockups__n">${part.length}</span></p><div class="mx-mockups__grid">${part.map(m => fig(m, at++)).join('')}</div></div>`; return html; }).join('')}`;
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
    const mockKey = () => { const c = selectedConcept(); return c ? JSON.stringify([c.stack, c.palette, c.align, c.fit || null, c.elements || null, c.mode || '', printSpec(), state.colors.join('|'), logoSpot()]) : ''; };
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
      const what = apparel() ? (state.colors.length > 1 ? pubColorName() : state.colors[0] || '') : BLANK_INFO[kind()].label;
      main.querySelector('.mx-pstage__live')?.remove();
      show('mx-pstage-canvas', !has);
      main.classList.toggle('is-stale', has && !fresh);
      if (has) {
        const all = (live ? state.product.images : state.mock.images).filter(m => imgUrl(m));
        // Several colours: the stage shows the picked colour's mockups first.
        const lead = all.filter(m => m?.color && sameName(m.color, what));
        const items = lead.length ? [...lead, ...all.filter(m => !lead.includes(m))] : all;
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
      renderVariants();
      show('mx-adcta', Boolean(selectedConcept()) && !liveShown());
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
        if (state.colors[0]) { body.color = state.colors[0]; body.colors = state.colors.slice(); }
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
      if (state.quick) return; // Quick publish: Fourthwall makes the mockups when it creates the product
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
    on('mx-create-fw', 'click', () => createOnFourthwall());
    async function createOnFourthwall() {
      const gate = pushAllowed();
      if (!gate.ok) { setText('mx-pub-blocker', gate.text); show('mx-pub-blocker', true); return false; }
      if (state.busy === 'create' || pubBlocker()) return false;
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
        // One product, every chosen colour (colors); color stays for older servers.
        if (state.colors[0]) { body.color = state.colors[0]; body.colors = state.colors.slice(); }
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        const made = Array.isArray(data.colors) && data.colors.length ? data.colors.map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean) : (body.colors || []);
        state.product = { id: data.productId, forId: c.id, name: data.title || body.title, description: data.description || body.description, url: data.productUrl || '', state: data.state || 'HIDDEN', price: data.price?.retail ?? body.retail, margin: data.price?.margin, images: data.images || [], color: body.color, colors: made, blank: kind(), collectionIds: [] };
        if (body.colors && body.colors.length > 1 && made.length < body.colors.length) collNote = `Fourthwall made it in ${made.join(', ') || body.color} only.`;
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
      if (state.product && liveShown()) $('mx-live-h')?.focus?.({ preventScroll: true });
      return Boolean(state.product && liveShown());
    }

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
            <h2 class="mx-h2" id="mx-live-h" tabindex="-1">${esc(p.name)}</h2>
            <span class="es-badge es-badge--${tone}">${esc(label)}</span>
          </div>
          <div class="mx-row">
            ${archived ? '' : `<button class="es-btn${live ? '' : ' es-btn--primary'}" type="button" data-live="${live ? 'hide' : 'publish'}">${live ? 'Hide' : 'Publish to shop'}</button>`}
            ${p.url && !archived ? `<a class="es-btn es-btn--ghost" href="${esc(p.url)}" target="_blank" rel="noopener">View on Fourthwall</a>` : ''}
          </div>
        </div>
        ${archived ? '<p class="mx-meta">Archived: this product is gone from the Fourthwall shop. Past orders stay in Fourthwall.</p>' : `
        <p class="mx-live__next">${live ? 'It’s live in the shop. Make an ad to tell fans.' : 'Created hidden. Check the mockups, then publish it to the shop.'}</p>
        <p class="mx-meta">${p.url ? `Product link: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> · ` : ''}${p.price != null ? `${money(p.price)}${p.margin != null ? `, you earn ${money(p.margin)} a sale` : ''}` : ''}${(p.colors || []).length > 1 ? ` · ${esc(p.colors.join(', '))}` : ''}</p>
        <div class="mx-adcta mx-adcta--live">
          <span class="mx-adcta__icon" aria-hidden="true"><svg class="mx-i" viewBox="0 0 24 24"><use href="#mx-i-megaphone"/></svg></span>
          <div class="mx-adcta__text"><p class="mx-adcta__title">Make an ad</p><p class="mx-meta">Feed post, story or carousel with the product link${(p.images || []).length ? ' and Fourthwall’s mockups' : ''}.</p></div>
          <button class="es-btn es-btn--sm" type="button" data-live="ad" aria-haspopup="dialog">Make an ad</button>
        </div>
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
      if (act === 'ad') { openAd('live'); return; }
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

    // ── Quick publish (admins): one tee, the stage colour, the suggested price ──
    // A confirm dialog (product, colour, price, rights tick), then the normal
    // create path in Publish: the same print file, checks and progress, created
    // hidden. "Change details" opens the full Publish form instead.
    function isAdmin() { return Boolean(state.status && state.status.configured && state.status.canPush === true); }
    function syncQuick() {
      const b = $('mx-quick');
      if (!b) return;
      const c = selectedConcept();
      const can = isAdmin() && pushAllowed().ok && Boolean(c) && !state.making;
      b.hidden = !can;
      if (!can) return;
      const tee = (state.templates || []).find(t => kindOf(t) === 'tee');
      const sug = tee ? (Number(tee.pricing?.suggested ?? tee.suggestedPrice) || (window.MerchRules?.suggestedPrice ? window.MerchRules.suggestedPrice('tee', tee.basePrice) : 0)) : 0;
      setText('mx-quick-meta', [c.garment?.name || 'White', sug ? money(sug) : ''].filter(Boolean).join(' · '));
      b.disabled = state.busy === 'create' || (template() && kind() === 'tee' ? blockingChecks().length > 0 : false);
      b.title = b.disabled && state.busy !== 'create' ? 'Fix the print check first.' : 'Create one t-shirt in this colour at the suggested price, hidden on Fourthwall.';
    }
    function quickStatus(text, bad = false) { const el = $('mx-quick-status'); if (el) { el.textContent = text || ''; el.classList.toggle('mx-meta--bad', bad); } }
    function quickReady() {
      const go_ = $('mx-quick-go');
      if (!go_) return;
      const bad = state.quickBlock || '';
      go_.disabled = Boolean(bad) || !$('mx-quick-ack')?.checked || state.busy === 'create';
    }
    async function openQuick() {
      const c = selectedConcept();
      const d = $('mx-quick-dlg');
      if (!c || !d || !isAdmin()) return;
      state.quickReturn = document.activeElement;
      state.quickBlock = 'loading';
      $('mx-quick-ack').checked = false;
      setHtml('mx-quick-facts', '');
      setHtml('mx-quick-rights', (c.rights || []).map(r => `<li><span class="mx-rchip">${esc(RIGHTS_LABEL[r.kind] || r.kind)}</span> ${esc(r.text)}</li>`).join('') || '<li class="mx-meta">No names, quotes or team colours found.</li>');
      quickStatus('Getting the t-shirt…');
      quickReady();
      if (typeof d.showModal === 'function' && !d.open) d.showModal(); else d.setAttribute('open', '');
      $('mx-quick-ack')?.focus();
      const ok = await ensureTemplates();
      const tee = ok ? (state.templates || []).find(t => kindOf(t) === 'tee') : null;
      if (!tee) { state.quickBlock = 'no-tee'; quickStatus(ok ? 'There’s no t-shirt on Fourthwall yet. Use Continue to Publish.' : state.templatesError, true); quickReady(); return; }
      if (state.templateId !== tee.templateId) pickTemplate(tee.templateId, false); else pickColorFor(c);
      state.colors = state.colors.slice(0, 1);
      state.pubColor = '';
      const price = suggested();
      const m = window.MerchRules?.marginFor ? window.MerchRules.marginFor(price, base()) : null;
      const earn = m && Number.isFinite(m.margin) ? m.margin : price - base();
      const sizes = (tee.sizes || []).filter(Boolean);
      setHtml('mx-quick-facts', [
        ['Product', `${tee.label || 'T-shirt'}${tee.name ? ` · ${tee.name}` : ''}`],
        ['Colour', state.colors[0] || c.garment?.name || 'White'],
        ['Price', price ? `${money(price)} · you earn ${money(earn)}` : 'Suggested price'],
        ['Sizes', sizes.length ? `${sizes[0]}–${sizes[sizes.length - 1]}` : 'Standard sizes'],
        ['ES logo', logoText().replace(/^ES logo /, '').replace(/^no ES logo$/, 'none')],
      ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));
      if (state.colorNote) quickStatus(state.colorNote);
      const cv = $('mx-quick-canvas');
      if (cv) {
        const { off } = await paint(c, 'tee', { garment: garmentHex(), photoPick: null });
        cv.width = off.width; cv.height = off.height;
        cv.getContext('2d').drawImage(off, 0, 0);
        cv.setAttribute('aria-label', `${c.title || 'The design'} on a ${state.colors[0] || ''} t-shirt`.replace(/\s+/g, ' '));
      }
      const bad = blockingChecks();
      state.quickBlock = bad.length ? 'checks' : '';
      if (bad.length) quickStatus(`Fix the print check first: ${bad[0].text}`, true);
      else if (!state.colorNote) quickStatus('');
      quickReady();
    }
    function closeQuick(restore = true) {
      const d = $('mx-quick-dlg');
      if (d?.open) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
      if (restore && state.quickReturn?.isConnected) state.quickReturn.focus({ preventScroll: true });
      state.quickReturn = null;
    }
    async function runQuick() {
      const c = selectedConcept();
      if (!c || state.quickBlock || !$('mx-quick-ack')?.checked) return;
      state.quick = true;
      state.ack = true;
      if ($('mx-ack')) $('mx-ack').checked = true;
      closeQuick(false);
      track('merch', { action: 'quick-publish', step: 'start' });
      if (!go('publish', { focus: 'none' })) { state.quick = false; return; }
      try { await state.enterP; await state.copyP; } catch { /* the form shows what's missing */ }
      const price = suggested();
      if (price && $('mx-price')) $('mx-price').value = price;
      syncEarn();
      syncPublish();
      const ok = await createOnFourthwall();
      state.quick = false;
      track('merch', { action: 'quick-publish', step: ok ? 'created' : 'stopped' });
      if (!ok) { const why = pubBlocker(); if (why && !state.pushError) { setText('mx-pub-blocker', why); show('mx-pub-blocker', true); } $('mx-h-publish')?.focus({ preventScroll: true }); }
    }
    on('mx-quick', 'click', openQuick);
    on('mx-quick-ack', 'change', quickReady);
    on('mx-quick-go', 'click', runQuick);
    on('mx-quick-cancel', 'click', () => closeQuick());
    on('mx-quick-more', 'click', () => { closeQuick(false); go('publish'); });
    on('mx-quick-dlg', 'cancel', e => { e.preventDefault(); closeQuick(); });

    // ── Make an ad (merch-ads.js): feed / story / carousel in the ES look ──
    // The line: the AI copy's ad line when the server sends one, else the
    // first sentence of the AI-written description (already paid for and
    // cached), else a code line. Never a second AI call.
    const CODE_LINE = { quote: 'Word for word, on a tee.', nickname: 'One name. Every fan knows it.', replay: 'For the fans who remember.', current: 'Wear the moment.', core: 'Made for ES fans.' };
    function adSource(c) { return [c?.title, ...(c?.stack || []).map(r => r.text), state.made?.content?.text, state.trend?.title, val('mx-title-input')].filter(Boolean).join(' '); }
    function adLineProblem(line, c = selectedConcept()) {
      const t = String(line || '').trim();
      if (!t) return 'Add a short line for the ad.';
      if (/\b(official|officially|licen[cs]ed|authori[sz]ed|authentic)\b/i.test(t)) return 'Don’t call it official or licensed.';
      if (window.MerchRules?.bannedIn && window.MerchRules.bannedIn(t).length) return 'That word isn’t allowed on ES merch.';
      const src = adSource(c).replace(/,/g, '');
      const stray = (t.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).filter(n => !src.includes(n));
      if (stray.length) return `Numbers must come from the story or the design (${stray[0]} isn’t).`;
      return '';
    }
    function adLineFor(c) {
      const copy = state.copy && state.copy.key === copyKey(c) ? state.copy : null;
      if (copy?.adLine && !adLineProblem(copy.adLine, c)) return { line: copy.adLine.slice(0, 48), source: 'ai' };
      const first = copy?.ai ? String(copy.description || '').split(/(?<=[.!?])\s+/)[0].trim() : '';
      if (first && first.length >= 8 && first.length <= 48 && !/^(this|these|printed|made to order|the es|our|a |an )/i.test(first) && !adLineProblem(first, c)) return { line: first, source: 'ai' };
      return { line: CODE_LINE[c?.collection] || 'Wear the moment.', source: 'code' };
    }
    const canvasUrl = cv => { try { return cv.toDataURL('image/png'); } catch { return ''; } };
    async function adImages(c, p) {
      const out = [];
      const live = (p?.images?.length ? p.images : mockFresh() ? state.mock.images : []).filter(m => imgUrl(m));
      // One Fourthwall mockup per colour, up to 4.
      const seen = new Set();
      for (const m of live) {
        const k = m?.color || '';
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ src: imgUrl(m), kind: 'live', label: `Fourthwall mockup${k ? ` · ${k}` : ''}`, color: k });
        if (out.length >= 4) break;
      }
      const names = apparel() ? ((p?.colors?.length ? p.colors : state.colors).slice(0, 4)) : [''];
      for (const n of names) {
        const { off, pic } = await paint(c, 'tee', { garment: n ? hexOfColor(n) || garmentHex() : garmentHex(), photoPick: null });
        const src = canvasUrl(off);
        if (src && pic !== 'plain') out.push({ src, kind: pic === 'photo' ? 'photo' : 'flat', label: `FrameUp mockup${n ? ` · ${n}` : ''}`, color: n });
      }
      // Other calibrated angles of the main colour (the design drawn on them).
      if (apparel()) {
        const extra = photosOf(hexOfColor(names[0]) || garmentHex()).filter(x => x.calibrated).slice(1, 3);
        for (const ph of extra) {
          const { off, pic } = await paint(c, 'tee', { garment: ph.hex, photoPick: { angle: ph.angle, index: ph.index } });
          const src = canvasUrl(off);
          if (src && pic === 'photo') out.push({ src, kind: 'photo', label: `${angleName(ph)} · ${ph.name}`, color: ph.name, angle: ph.angle });
        }
      }
      const { off } = await paint(c, 'closeup', { garment: hexOfColor(names[0]) || garmentHex() });
      const close = canvasUrl(off);
      if (close) out.push({ src: close, kind: 'closeup', label: 'Close-up of the design', color: names[0] || '' });
      return out;
    }
    async function openAd(from) {
      const c = selectedConcept();
      if (!c) return;
      if (!window.MerchAds) await loadScript('merch-ads.js?v=20261127-m7b');
      if (!window.MerchAds) return;
      const p = liveShown() ? state.product : null;
      const { line, source } = adLineFor(c);
      const btn = document.activeElement;
      btn?.setAttribute?.('aria-busy', 'true');
      const images = await adImages(c, p);
      btn?.removeAttribute?.('aria-busy');
      const price = p?.price ?? (Number(val('mx-price')) > 0 ? Number(val('mx-price')) : 0);
      window.MerchAds.open({
        key: `${c.id}|${p?.id || ''}|${kind()}`, title: p?.name || val('mx-title-input').trim() || c.title || 'ES merch', name: p?.name || c.title,
        line, lineSource: source, fallbackLine: CODE_LINE[c.collection], price, url: p?.url || '', palette: c.palette, collection: c.collection, images,
        check: t => adLineProblem(t, c), track: d => track('merch', { ...d, from }),
      });
    }
    // An ad for a product in Your merch: its Fourthwall mockups and link (no design to redraw).
    async function openRowAd(row, btn) {
      if (!window.MerchAds) await loadScript('merch-ads.js?v=20261127-m7b');
      if (!window.MerchAds) return;
      btn?.setAttribute('aria-busy', 'true');
      if (!row.imagesLoaded) { try { const data = await api({ mode: 'product', productId: row.productId }); row.images = data.product?.images || []; row.imagesLoaded = true; } catch { /* the thumb is enough */ } }
      btn?.removeAttribute('aria-busy');
      const pics = (row.images || []).filter(m => imgUrl(m)).slice(0, 5).map(m => ({ src: imgUrl(m), kind: 'live', label: `Fourthwall mockup${m?.color ? ` · ${m.color}` : ''}`, color: m?.color || '' }));
      if (!pics.length && row.thumb) pics.push({ src: imgUrl(row.thumb), kind: 'live', label: 'Fourthwall mockup' });
      const title = String(row.title || 'ES merch').replace(/\s*\(sample\)$/i, '');
      window.MerchAds.open({
        key: `row|${row.productId}`, title, name: title, line: 'Wear the moment.', lineSource: 'code', price: row.price || 0, url: row.url || '', palette: null, images: pics,
        check: t => (/\b(official|licen[cs]ed)\b/i.test(t) ? 'Don’t call it official or licensed.' : (window.MerchRules?.bannedIn && window.MerchRules.bannedIn(t).length ? 'That word isn’t allowed on ES merch.' : (/\d/.test(t) && !/\d/.test(title) ? 'Numbers must come from the product.' : ''))),
        track: d => track('merch', { ...d, from: 'list' }),
      });
    }
    on('mx-ad-open', 'click', () => openAd('publish'));

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
          ${!archived && (p.url || p.thumb) ? `<button class="es-btn es-btn--ghost es-btn--sm" type="button" data-row="ad" aria-haspopup="dialog" aria-label="Make an ad for ${esc(p.title)}">Ad</button>` : ''}
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
      if (b.dataset.row === 'ad') { openRowAd(row, b); return; }
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

    // ── Brainstorm room: a shared line board per trend (POST brainstorm-*) ──
    // Opens full width from a moment card ("Brainstorm") or from Create
    // ("Brainstorm from my line"). Left: what the AI reads + the chat (angle
    // chips, thinking state, each turn's note and the mode used). Right: the
    // line board (live ES-pill previews in the trend's colours, star, mix,
    // more like this, edit, remove, Design this, Design all starred). The
    // board is shared with ES: it refreshes every 20 s and on focus.
    const BS_POLL_MS = 20000;
    const BS_ANGLES = [
      ['Chant', { kind: 'angle', angle: 'chant' }],
      ['Wordplay', { kind: 'angle', angle: 'pun' }],
      ['Nickname', { kind: 'angle', angle: 'nickname' }],
      ['Stat', { kind: 'angle', angle: 'stat' }],
      ['Rivalry', { kind: 'angle', angle: 'rivalry' }],
      ['Era', { kind: 'angle', angle: 'era' }],
      ['City pride', { kind: 'angle', angle: 'city' }],
      ['Player', { kind: 'angle', angle: 'player' }],
      ['Troll (in good taste)', { kind: 'angle', angle: 'troll' }],
      ['Funnier', { kind: 'tone', tone: 'funnier' }],
      ['More emotional', { kind: 'tone', tone: 'emotional' }],
      ['Shorter', { kind: 'tone', tone: 'shorter' }],
      ['For neutral fans', { kind: 'audience', audience: 'neutral' }],
    ];
    const BS_THINK = { basic: ['Reading the sources', 'Reading the board', 'Writing new lines', 'Checking ES rules'], pro: ['Reading the sources', 'Reading the board', 'Finding the angle', 'Writing new lines', 'Checking ES rules'] };
    const BS_MODE_NOTE = { basic: 'Basic: quick lines, light on your AI usage.', pro: 'Pro: the smarter AI, sharper lines, more usage.' };
    const AV_HUES = [212, 152, 28, 280, 340, 190, 48, 0];
    state.bs = { key: '', trend: null, content: null, from: '', session: null, context: null, me: '', opening: false, error: '', busy: false, pending: null, chatError: '', lastAsk: null, think: 0, filter: 'all', sort: 'new', picks: [], editing: '', fresh: [], turnMeta: {}, addNote: '', addTone: '', dirty: false, refreshing: false };
    const bsLow = s => String(s || '').trim().toLowerCase();
    const isMe = by => Boolean(state.bs.me) && bsLow(by) === state.bs.me;
    function personName(by) {
      if (!by) return 'Someone';
      if (isMe(by)) return 'You';
      const local = String(by).split('@')[0].replace(/[._-]+/g, ' ').trim();
      return local ? local.replace(/\b\w/g, c => c.toUpperCase()) : 'Someone';
    }
    function avatar(by, { ai = false } = {}) {
      if (ai) return '<span class="mx-av mx-av--ai" aria-hidden="true"><span class="es-ai-mark"></span></span>';
      const name = personName(by) === 'You' ? String(by || 'You').split('@')[0] : personName(by);
      const ini = name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
      let h = 0; for (const c of bsLow(by)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return `<span class="mx-av" style="--av-h:${AV_HUES[h % AV_HUES.length]}" aria-hidden="true">${esc(ini)}</span>`;
    }
    const agoText = iso => {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return '';
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const shortAgo = iso => { const t = new Date(iso).getTime(); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
    const bsTeam = () => { const t = state.bs.context?.team || state.bs.session?.team || state.bs.trend?.team; if (!t) return null; if (typeof t === 'string') return { name: t }; return t.name ? { name: t.name, short: t.short || '' } : null; };
    const cr = (x, y) => { try { return window.FrameUpRules?.contrastRatio ? window.FrameUpRules.contrastRatio(x, y) : 4.5; } catch { return 4.5; } };
    function bsPalette() {
      const col = state.bs.context?.colours || state.bs.context?.colors || null;
      const cp = state.bs.context?.palette;
      let p = cp && normHex(cp.a) ? { a: normHex(cp.a), b: normHex(cp.b) || WHITE, ink: normHex(cp.ink) } : null;
      if (p) { /* the server's MerchPrint.teamPalette */ } else if (col && !Array.isArray(col) && typeof col === 'object' && normHex(col.a)) p = { a: normHex(col.a), b: normHex(col.b) || WHITE, ink: normHex(col.ink) };
      else if (Array.isArray(col) && normHex(col[0])) p = { a: normHex(col[0]), b: normHex(col[1]) || WHITE, ink: '' };
      if (!p) { try { p = MP().teamPalette ? { ...MP().teamPalette(bsTeam()?.name || '') } : null; } catch { p = null; } }
      if (!p || !normHex(p.a)) p = { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' };
      if (!normHex(p.ink)) p.ink = cr(p.b, '#000000') >= cr(p.b, WHITE) ? '#000000' : WHITE;
      return { a: normHex(p.a), b: normHex(p.b) || WHITE, ink: normHex(p.ink) };
    }
    const BS_RIGHTS = ['name', 'nickname', 'quote', 'team'];
    // A board line as a studio concept: "Your words" in the trend's palette.
    function lineConcept(l) {
      const pal = bsPalette();
      const team = bsTeam();
      const inkA = cr(pal.a, WHITE) >= 3 ? 'white' : 'ink';
      let base = null;
      try { base = MP().yourWords ? MP().yourWords({ text: l.text, team }) : null; } catch { base = null; }
      const rows = base?.stack?.length ? base.stack.map(r => r.text) : [String(l.text || '').replace(/["“”]/g, '').trim()];
      const stack = rows.map((t, n) => ({ text: t, size: 'big', fill: n % 2 ? 'b' : 'a', ink: n % 2 ? 'ink' : inkA }));
      const seen = new Set();
      const rights = [...(base?.rights || []), ...(Array.isArray(l.rights) ? l.rights : []).map(r => ({ kind: BS_RIGHTS.includes(r?.kind) ? r.kind : 'name', text: String(r?.text || '').slice(0, 80) }))]
        .filter(r => r.text && !seen.has(`${r.kind}:${bsLow(r.text)}`) && seen.add(`${r.kind}:${bsLow(r.text)}`));
      if (team && !rights.some(r => r.kind === 'team')) rights.push({ kind: 'team', text: team.name });
      return { ...(base || {}), id: `bs-${l.id}`, collection: 'current', label: ANGLE_LABEL[l.angle] || 'Your words', title: String(l.text || '').slice(0, 60), team: team ? { id: base?.team?.id || bsLow(team.name).replace(/\W+/g, '-'), name: team.name } : null, palette: pal, garment: { color: WHITE, name: 'White' }, align: base?.align || 'left', stack, blanks: base?.blanks || ['tee', 'hoodie'], rights, why: l.why || 'A line from the brainstorm board.', fit: { scale: 1, topIn: null }, fromBoard: state.bs.session?.id || '' };
    }
    // Live mini previews: one render per line text + palette, then copied.
    const bsArt = new Map();
    async function drawLineArt(cv, l) {
      if (!cv || !MP().closeup) return;
      const c = lineConcept(l);
      const key = JSON.stringify([c.stack.map(r => [r.text, r.fill, r.ink]), c.palette, cv.width, cv.height]);
      if (cv.dataset.key === key) return;
      cv.dataset.key = key;
      if (!bsArt.has(key)) {
        if (bsArt.size > 160) bsArt.clear();
        bsArt.set(key, (async () => { const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height; await MP().closeup(c, WHITE, off, { kind: 'tee', pad: 0.16 }); return off; })().catch(error => { console.warn('merch brainstorm preview', error); bsArt.delete(key); return null; }));
      }
      const off = await bsArt.get(key);
      if (!off || cv.dataset.key !== key) return;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(off, 0, 0);
      cv.classList.add('is-drawn');
    }

    function trendOfMoment(m) {
      const t = m.trend && typeof m.trend === 'object' ? m.trend : {};
      const out = { ...t, id: t.id || m.id, title: t.title || m.title, sport: t.sport || t.category || m.sport || '' };
      if (m.team && !out.team) out.team = m.team;
      return out;
    }
    async function whoAmI() {
      if (state.bs.me) return;
      try { const s = await window.ESAuth?.getSession?.(); const e = s?.user?.email; if (e && !state.bs.me) { state.bs.me = bsLow(e); if (state.step === 'brainstorm') renderBrainstorm(); } } catch { /* signed-in name only affects "You" and Mine */ }
    }
    async function openBrainstorm({ trend = null, content = null, from = '' } = {}) {
      const key = trend?.id ? `t:${trend.id}` : `line:${bsLow(content?.text)}`;
      if (key === 'line:') return;
      const b = state.bs;
      const same = b.key === key && Boolean(b.session);
      if (!same) Object.assign(b, { key, trend, content, session: null, context: null, error: '', picks: [], editing: '', fresh: [], chatError: '', lastAsk: null, addNote: '', filter: 'all', dirty: false });
      b.from = from;
      whoAmI();
      go('brainstorm');
      track('merch', { action: 'brainstorm-open', from: from ? 'moment' : 'line', trend: Boolean(trend) });
      if (same) refreshBoard(); else await loadBoard();
    }
    // 409 'busy': someone else saved the board at the same moment. Retry once, then say so.
    async function apiRetry(body) {
      try { return await api(body); } catch (error) {
        if (error.reason !== 'busy' && error.status !== 409) throw error;
        await wait(400);
        try { return await api(body); } catch (again) {
          if (again.reason === 'busy' || again.status === 409) { refreshBoard(); throw Object.assign(new Error('Someone else just changed this board — refreshed. Try again.'), { reason: 'busy' }); }
          throw again;
        }
      }
    }
    const BS_OPEN_STEPS = ['Reading the trend', 'Finding ES articles', 'Checking facts on the web', 'Setting up the board'];
    function openStep() { const i = Math.min(BS_OPEN_STEPS.length - 1, Math.floor((Date.now() - (state.bs.openAt || Date.now())) / 2600)); return i; }
    function tickOpen() {
      if (!state.bs.opening) { clearInterval(state.bs.openTimer); return; }
      const i = openStep();
      document.querySelectorAll('#mx-bs-opening [data-open-step]').forEach((li, n) => { li.classList.toggle('is-done', n < i); li.classList.toggle('is-active', n === i); });
      setText('mx-bs-open-time', `${Math.floor((Date.now() - state.bs.openAt) / 1000)} s`);
    }
    function openBody() {
      const b = state.bs;
      const body = { mode: 'brainstorm-open', [AI_KEY]: state.aiMode };
      if (b.trend) body.trend = b.trend;
      if (b.content?.text) body.content = b.content;
      return body;
    }
    async function loadBoard() {
      const b = state.bs;
      const key = b.key;
      b.opening = true;
      b.openAt = Date.now();
      b.error = '';
      clearInterval(b.openTimer);
      b.openTimer = setInterval(tickOpen, 300);
      renderBrainstorm();
      try {
        const data = await api(openBody());
        if (b.key !== key) return;
        b.session = data.session || null;
        b.context = data.context || null;
        if (data.me) b.me = bsLow(data.me);
        if (!b.session) b.error = 'The board didn’t open. Try again.';
      } catch (error) {
        if (b.key !== key) return;
        b.error = explain(error).text;
      }
      b.opening = false;
      clearInterval(b.openTimer);
      renderBrainstorm();
      if (b.session) startPoll();
    }
    // Teammates' lines: a quiet re-read every 20 s while the board is open, and on focus.
    let bsPoll = 0;
    function startPoll() { clearInterval(bsPoll); bsPoll = setInterval(() => { if (state.step === 'brainstorm' && !document.hidden) refreshBoard(); }, BS_POLL_MS); }
    function stopPoll() { clearInterval(bsPoll); bsPoll = 0; }
    async function refreshBoard() {
      const b = state.bs;
      if (!b.session || b.busy || b.opening || b.refreshing) return false;
      const key = b.key;
      b.refreshing = true;
      try {
        const data = await apiRetry({ mode: 'brainstorm-get', sessionId: b.session.id, withContext: !b.context });
        if (b.key === key && !b.busy && data.session) {
          const before = new Set((b.session.lines || []).map(l => l.id));
          const changed = data.session.updatedAt !== b.session.updatedAt || (data.session.lines || []).length !== before.size;
          if (data.context) b.context = data.context;
          if (changed) {
            b.session = data.session;
            const added = (data.session.lines || []).filter(l => !before.has(l.id)).map(l => l.id);
            if (added.length) b.fresh = added;
            if (b.editing) b.dirty = true; else renderBrainstorm();
          }
        }
      } catch { /* the next refresh tries again */ }
      b.refreshing = false;
      return true;
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.step === 'brainstorm') refreshBoard(); });
    window.addEventListener('focus', () => { if (state.step === 'brainstorm') refreshBoard(); });

    // ── Rendering ──
    // The room fills the window under its title (wide layouts); see .mx-bs__grid.
    function fitRoom() {
      const g = $('mx-bs-grid-wrap');
      if (!g || state.step !== 'brainstorm' || g.hidden) return;
      const top = g.getBoundingClientRect().top + window.scrollY;
      g.style.setProperty('--bs-h', `${Math.max(560, Math.round(window.innerHeight - top - 16))}px`);
    }
    window.addEventListener('resize', fitRoom);
    function renderBrainstorm() {
      if (state.step !== 'brainstorm') return;
      requestAnimationFrame(fitRoom);
      renderBsHead();
      renderBsContext();
      renderBsMode();
      renderThread();
      renderBoard();
    }
    function bsPeople() {
      const s = state.bs.session;
      if (!s) return [];
      const list = Array.isArray(s.people) && s.people.length ? s.people : [...(s.lines || []).map(l => l.by), ...(s.turns || []).map(t => t.by), s.createdBy];
      return [...new Set(list.filter(Boolean).map(bsLow))];
    }
    function renderBsHead() {
      const b = state.bs;
      const s = b.session;
      const ctx = b.context || {};
      const title = ctx.title || s?.title || b.trend?.title || (b.content?.text ? `“${b.content.text}”` : 'Brainstorm');
      setText('mx-h-brainstorm', title);
      const team = bsTeam();
      const sport = String(ctx.sportLabel || ctx.sport || s?.sport || b.trend?.sport || '').toUpperCase();
      const lines = s ? (s.lines || []).length : 0;
      setText('mx-bs-sub', [sport, team?.name, s ? plural(lines, 'line') : '', s?.updatedAt ? `updated ${agoText(s.updatedAt)}` : ''].filter(Boolean).join(' · '));
      const people = bsPeople();
      const box = $('mx-bs-people');
      if (box) {
        box.hidden = !s;
        box.innerHTML = s ? `<span class="mx-bs-avs">${people.slice(0, 5).map(p => avatar(p)).join('')}${people.length > 5 ? `<span class="mx-av mx-av--more" aria-hidden="true">+${people.length - 5}</span>` : ''}</span><span class="mx-bs-people__text">${people.length <= 1 ? 'Shared with ES' : `${people.length} people on this board`}</span>` : '';
        if (s) box.title = people.map(personName).join(', ');
      }
      const err = $('mx-bs-open-error');
      if (err) {
        err.hidden = !b.error;
        err.innerHTML = b.error ? `<span>${esc(b.error)}</span><button class="es-btn es-btn--sm" type="button" data-bs-retry-open>Try again</button>` : '';
      }
      show('mx-bs-grid-wrap', !b.error || Boolean(s));
    }
    const SRC = [['trend', 'Trend', 'trend', 'Trend headlines'], ['es', 'ES articles', 'news', 'ES’s own articles'], ['web', 'Web check', 'globe', 'A live web fact check']];
    function renderBsContext() {
      const b = state.bs;
      const ctx = b.context;
      const pal = bsPalette();
      const team = bsTeam();
      setHtml('mx-bs-team', ctx || b.session ? `<span class="mx-bs-dots" aria-hidden="true"><i style="background:${pal.a}"></i><i style="background:${pal.b}"></i></span><span>${esc(team ? team.short || team.name : 'ES colours')}</span>` : '');
      const src = ctx?.sources || {};
      if (b.opening && !ctx) {
        setHtml('mx-bs-sources', '<li class="es-skeleton mx-bs-src mx-bs-src--skel" aria-hidden="true"></li>'.repeat(3));
        setHtml('mx-bs-ctx-more', '<span class="es-skeleton mx-skel mx-skel--line" aria-hidden="true"></span><span class="es-skeleton mx-skel mx-skel--short" aria-hidden="true"></span>');
        return;
      }
      const lineOnly = !b.trend && !src.trend;
      setHtml('mx-bs-sources', SRC.map(([k, label0, icon, long0]) => {
        const label = k === 'trend' && lineOnly ? 'Your line' : label0;
        const long = k === 'trend' && lineOnly ? 'Your line (no trend)' : long0;
        const yes = k === 'trend' && lineOnly ? true : k === 'trend' ? src.trend !== false && Boolean(ctx) && (src.trend || (ctx.headlines || []).length > 0) : Boolean(src[k]);
        return `<li class="mx-bs-src${yes ? ' is-on' : ''}" title="${esc(long)}: ${yes ? 'read' : 'not available this time'}"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-${icon}"/></svg><span>${esc(label)}</span><span class="es-sr-only">: ${yes ? 'read' : 'not available'}</span><svg class="mx-i mx-bs-src__mark" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-${yes ? 'check' : 'close'}"/></svg></li>`;
      }).join(''));
      if (!ctx) { setHtml('mx-bs-ctx-more', ''); return; }
      const open = new Set([...document.querySelectorAll('#mx-bs-ctx-more details[open]')].map(d => d.dataset.more));
      const sec = (k, label, items, html) => (items.length ? `<details class="mx-bs-more" data-more="${k}"${open.has(k) ? ' open' : ''}><summary><span>${esc(label)}</span><span class="mx-bs-more__n">${items.length}</span></summary>${html}</details>` : '');
      const heads = (ctx.headlines || []).filter(Boolean).slice(0, 8);
      const arts = (ctx.esArticles || []).filter(a => a && a.title).slice(0, 6);
      const facts = (ctx.facts || []).filter(Boolean).slice(0, 6);
      const nicks = (ctx.nicknames || []).filter(Boolean).slice(0, 10);
      const safeUrl = u => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
      if ($('mx-bs-ctx-more')) $('mx-bs-ctx-more').innerHTML = ([
        sec('headlines', 'Headlines', heads, `<ul class="mx-bs-more__list">${heads.map(h => `<li>${esc(typeof h === 'string' ? h : h.title || '')}</li>`).join('')}</ul>`),
        sec('es', 'ES articles', arts, `<ul class="mx-bs-more__list">${arts.map(a => `<li>${safeUrl(a.url) ? `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title)}</li>`).join('')}</ul>`),
        sec('facts', 'Fact check', facts, `<ul class="mx-bs-more__list">${facts.map(f => `<li>${esc(typeof f === 'string' ? f : f.text || '')}</li>`).join('')}</ul>`),
        sec('nicknames', 'Nicknames', nicks, `<p class="mx-bs-nicks">${nicks.map(n => `<span class="mx-bs-nick">${esc(n)}</span>`).join('')}</p>`),
      ].join('') || '<p class="mx-meta">Only the trend title this time. The AI keeps numbers and quotes to it.</p>') + ((ctx.notes || []).length ? `<p class="mx-meta mx-bs-notes">${esc(ctx.notes.slice(0, 3).join(' · '))}</p>` : '');
    }
    function renderBsMode() {
      document.querySelectorAll('#mx-bs-mode [data-bs-mode]').forEach(x => setOn(x, x.dataset.bsMode === state.aiMode));
      setText('mx-bs-mode-note', `${BS_MODE_NOTE[state.aiMode]} Enter to send.`);
      const b = state.bs;
      const send = $('mx-bs-send');
      if (send) { send.disabled = b.busy || !b.session || !val('mx-bs-input').trim(); send.setAttribute('aria-busy', String(b.busy)); }
      $('mx-bs-angles')?.querySelectorAll('button').forEach(x => { x.disabled = b.busy || !b.session; });
    }
    const lineText = id => (state.bs.session?.lines || []).find(l => l.id === id)?.text || '';
    function askLabel(t) {
      if (t.prompt) return t.prompt;
      const a = t.action || {};
      if (a.kind === 'angle') return BS_ANGLES.find(([, x]) => x.kind === 'angle' && x.angle === a.angle)?.[0] || `Angle: ${a.angle || ''}`;
      if (a.kind === 'tone') return BS_ANGLES.find(([, x]) => x.kind === 'tone' && x.tone === a.tone)?.[0] || `Tone: ${a.tone || ''}`;
      if (a.kind === 'audience') return a.audience === 'neutral' ? 'For neutral fans' : `For ${a.audience || 'fans'}`;
      const ids = Array.isArray(a.lineIds) ? a.lineIds : [];
      if (a.kind === 'more-like') return `More like “${lineText(ids[0]) || a.text || 'that line'}”`;
      if (a.kind === 'mix') { const [x, y] = ids.map(lineText); return x && y ? `Mix “${x}” + “${y}”` : 'Mix 2 lines'; }
      return 'New lines';
    }
    const turnKey = t => `${t.at || ''}|${bsLow(t.by)}`;
    function modeBadge(mode, fellBack) {
      const m = mode === 'pro' ? 'pro' : mode === 'free' || mode === 'code' ? 'free' : mode === 'basic' ? 'basic' : '';
      if (!m) return '';
      const label = m === 'pro' ? 'Pro' : m === 'free' ? 'No AI' : 'Basic';
      const why = fellBack ? ` (${FELL_SHORT[fellBack] || 'fell back'})` : '';
      return `<span class="mx-bs-mbadge mx-bs-mbadge--${m}" title="${esc(m === 'free' ? 'Made in code, no AI this turn' : `Written by ${label}`)}${esc(why)}">${esc(label)}${esc(why)}</span>`;
    }
    function renderThread() {
      const box = $('mx-bs-thread');
      if (!box) return;
      const b = state.bs;
      const s = b.session;
      const ctx = b.context;
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const src = ctx?.sources || {};
      const read = [ctx ? 'the trend' : '', src.es ? `${plural((ctx?.esArticles || []).length || 1, 'ES article')}` : '', src.web ? 'a live web check' : ''].filter(Boolean);
      const readText = read.length > 1 ? `${read.slice(0, -1).join(', ')} and ${read.slice(-1)}` : read[0] || 'the trend';
      const intro = b.opening && !s
        ? `<li class="mx-bs-turn mx-bs-turn--ai is-thinking is-opening" aria-label="Opening the board"><span class="mx-bs-turn__mark" aria-hidden="true"></span><div class="mx-bs-bubble"><span class="mx-bs-think"><span class="mx-bs-think__dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Getting the story first</span></span><span class="mx-bs-think__mode" id="mx-bs-open-time">${Math.floor((Date.now() - (b.openAt || Date.now())) / 1000)} s</span><ol class="mx-bs-opensteps" id="mx-bs-opening">${BS_OPEN_STEPS.map((x, n) => `<li data-open-step="${n}" class="${n < openStep() ? 'is-done' : n === openStep() ? 'is-active' : ''}">${esc(x)}</li>`).join('')}</ol></div></li>`
        : s ? `<li class="mx-bs-turn mx-bs-turn--ai mx-bs-turn--intro"><span class="mx-bs-turn__mark" aria-hidden="true"></span><div class="mx-bs-bubble"><p>I’ve read ${esc(readText)}. Ask for lines in your own words, or pick an angle below. Numbers and quotes only come from these sources.</p></div></li>` : '';
      const turns = (s?.turns || []).slice(-40).map(t => {
        const meta = b.turnMeta[turnKey(t)] || {};
        const mode = t.ai === false ? 'free' : (t.designMode || t.mode || meta.mode || '');
        const n = (t.lineIds || []).filter(id => (s.lines || []).some(l => l.id === id)).length;
        const who = personName(t.by);
        return `<li class="mx-bs-turn mx-bs-turn--ask${isMe(t.by) ? ' is-me' : ''}"><div class="mx-bs-bubble">${esc(askLabel(t))}</div><span class="mx-bs-turn__who">${esc(who)}${t.at ? ` · ${esc(agoText(t.at))}` : ''}</span></li>
          <li class="mx-bs-turn mx-bs-turn--ai"><span class="mx-bs-turn__mark" aria-hidden="true"></span><div class="mx-bs-bubble">${t.note ? `<p>${esc(t.note)}</p>` : ''}<div class="mx-bs-turn__foot">${n ? `<button class="mx-bs-turn__lines" type="button" data-bs-show="${esc(turnKey(t))}">${esc(plural(n, 'new line'))}<svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-arrow"/></svg></button>` : `<span class="mx-bs-turn__none">${(t.lineIds || []).length ? 'Those lines were removed' : 'No new lines this time'}</span>`}${modeBadge(mode, t.fellBack || meta.fellBack)}</div></div></li>`;
      }).join('');
      const pending = b.busy && b.pending ? `<li class="mx-bs-turn mx-bs-turn--ask is-me"><div class="mx-bs-bubble">${esc(askLabel(b.pending))}</div><span class="mx-bs-turn__who">You · just now</span></li>
        <li class="mx-bs-turn mx-bs-turn--ai is-thinking" aria-label="The AI is thinking"><span class="mx-bs-turn__mark" aria-hidden="true"></span><div class="mx-bs-bubble"><span class="mx-bs-think"><span class="mx-bs-think__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="mx-bs-think__text" id="mx-bs-think-text">${esc(thinkText())}</span></span><span class="mx-bs-think__mode">${esc(state.aiMode === 'pro' ? 'Pro' : 'Basic')} · <span id="mx-bs-think-time">0 s</span></span></div></li>` : '';
      const err = b.chatError ? `<li class="mx-bs-turn mx-bs-turn--ai mx-bs-turn--error" role="alert"><span class="mx-bs-turn__mark" aria-hidden="true"></span><div class="mx-bs-bubble"><p>${esc(b.chatError)}</p>${b.lastAsk ? '<button class="es-btn es-btn--sm" type="button" data-bs-retry>Try again</button>' : ''}</div></li>` : '';
      box.innerHTML = intro + turns + pending + err;
      box.setAttribute('aria-busy', String(b.busy));
      if (near || b.busy || b.justAsked) { box.scrollTop = box.scrollHeight; b.justAsked = false; }
    }
    function thinkText() {
      const steps = BS_THINK[state.aiMode] || BS_THINK.basic;
      const at = Math.min(steps.length - 1, Math.floor((Date.now() - (state.bs.thinkAt || Date.now())) / (state.aiMode === 'pro' ? 1600 : 1000)));
      const n = (state.bs.session?.lines || []).length;
      const label = steps[at];
      return label === 'Reading the board' ? `Reading the board (${plural(n, 'line')})…` : `${label}…`;
    }
    function tickThink() {
      if (!state.bs.busy) { clearInterval(state.bs.think); return; }
      setText('mx-bs-think-text', thinkText());
      setText('mx-bs-think-time', `${Math.floor((Date.now() - state.bs.thinkAt) / 1000)} s`);
    }
    function bsVisible() {
      const b = state.bs;
      const all = (b.session?.lines || []).map((l, i) => ({ l, i }));
      let list = all;
      if (b.filter === 'starred') list = list.filter(x => (x.l.starred || []).length > 0);
      if (b.filter === 'mine') list = list.filter(x => isMe(x.l.by));
      const at = x => new Date(x.l.at || 0).getTime() || 0;
      list.sort((x, y) => (b.sort === 'stars' ? ((y.l.starred || []).length - (x.l.starred || []).length) : 0) || (at(y) - at(x)) || (y.i - x.i));
      return list.map(x => x.l);
    }
    const starredLines = () => (state.bs.session?.lines || []).filter(l => (l.starred || []).length > 0).sort((x, y) => (y.starred.length - x.starred.length) || ((new Date(y.at).getTime() || 0) - (new Date(x.at).getTime() || 0)));
    const canEdit = l => isMe(l.by);
    const canRemove = l => isMe(l.by) || Boolean(state.status?.canArchive);
    function lineCard(l) {
      const b = state.bs;
      const stars = (l.starred || []).length;
      const mine = (l.starred || []).some(isMe);
      const picked = b.picks.includes(l.id);
      const fresh = b.fresh.includes(l.id);
      const ai = l.source !== 'person';
      const t = String(l.text || '');
      const who = l.source === 'code' ? `${l.by ? `${personName(l.by)} · ` : ''}No AI` : ai ? `${l.by ? `${personName(l.by)} · ` : ''}AI${l.designMode === 'pro' ? ' Pro' : ''}` : personName(l.by);
      const whoLong = l.source === 'code' ? `A quick pick made from the headlines without AI${l.by ? `, for ${personName(l.by)}` : ''}` : ai ? `Written by the AI${l.by ? ` for ${personName(l.by)}` : ''}${l.at ? `, ${agoText(l.at)}` : ''}` : `Added by ${personName(l.by)}${l.at ? `, ${agoText(l.at)}` : ''}`;
      const starNames = (l.starred || []).map(personName).join(', ');
      const editing = b.editing === l.id;
      const rights = (Array.isArray(l.rights) ? l.rights : []).filter(r => r && r.text).slice(0, 3);
      return `<article class="mx-bsl${mine ? ' is-starred' : ''}${picked ? ' is-picked' : ''}${fresh ? ' is-new' : ''}" data-lid="${esc(l.id)}">
        <div class="mx-bsl__art">
          <div class="mx-bsl__bar">
            <label class="mx-bsl__pick" title="Pick two lines to mix them"><input type="checkbox" data-bs-pick="${esc(l.id)}" data-bs-focus="pick:${esc(l.id)}"${picked ? ' checked' : ''} aria-label="Pick “${esc(t)}” to mix"><span aria-hidden="true">Mix</span></label>
            ${fresh ? '<span class="mx-bsl__new">New</span>' : ''}
            <button class="mx-bsl__star${mine ? ' is-on' : ''}" type="button" data-bs-star="${esc(l.id)}" data-bs-focus="star:${esc(l.id)}" aria-pressed="${mine}" aria-label="${mine ? 'Unstar' : 'Star'} “${esc(t)}”, ${esc(plural(stars, 'star'))}" title="${esc(starNames ? `Starred by ${starNames}` : 'Star this line')}"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-star"/></svg><span>${stars}</span></button>
          </div>
          <canvas class="mx-bsl__canvas" width="560" height="340" role="img" aria-label="Preview: ${esc(t)} as ES pills"></canvas>
        </div>
        <div class="mx-bsl__body">
          ${editing ? `<form class="mx-bsl__edit" data-bs-edit-form="${esc(l.id)}"><label class="es-sr-only" for="mx-bs-edit-${esc(l.id)}">Edit the line</label><input class="mx-input mx-input--sm" id="mx-bs-edit-${esc(l.id)}" data-bs-edit-input maxlength="${l.source === 'person' ? 60 : 32}" value="${esc(t)}"><button class="es-btn es-btn--sm" type="submit">Save</button><button class="es-btn es-btn--ghost es-btn--sm" type="button" data-bs-edit-cancel>Cancel</button></form>`
            : `<div class="mx-bsl__textrow"><p class="mx-bsl__text">${esc(t)}</p>${canEdit(l) ? `<button class="mx-bsl__icon" type="button" data-bs-edit="${esc(l.id)}" data-bs-focus="edit:${esc(l.id)}" aria-label="Edit “${esc(t)}”" title="Edit"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-edit"/></svg></button>` : ''}${canRemove(l) ? `<button class="mx-bsl__icon mx-bsl__icon--bad" type="button" data-bs-remove="${esc(l.id)}" aria-label="Remove “${esc(t)}”" title="Remove"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-trash"/></svg></button>` : ''}</div>`}
          <p class="mx-bsl__meta"><span class="mx-bsl__angle${l.source === 'code' ? ' mx-bsl__angle--quick' : l.source === 'person' ? ' mx-bsl__angle--own' : ''}">${esc(l.source === 'code' ? 'Quick pick' : l.source === 'person' ? 'Own line' : ANGLE_LABEL[l.angle] || 'Idea')}</span><span class="mx-bsl__by" title="${esc(whoLong)}">${avatar(l.by)}<span class="mx-bsl__name">${esc(who)}</span></span>${l.at ? `<span class="mx-bsl__at">${esc(shortAgo(l.at))}</span>` : ''}</p>
          ${l.why ? `<p class="mx-bsl__why">${esc(l.why)}</p>` : ''}
          ${rights.length ? `<p class="mx-bsl__rights">${rights.map(r => `<span class="mx-bsl__flag" title="Rights: check before selling"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-warn"/></svg>${esc(RIGHTS_LABEL[r.kind] || 'Rights')}: ${esc(r.text)}</span>`).join('')}</p>` : ''}
          <div class="mx-bsl__actions">
            <button class="es-btn es-btn--ghost es-btn--sm" type="button" data-bs-more="${esc(l.id)}" data-bs-focus="more:${esc(l.id)}"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-sparkle"/></svg>More like this</button>
            <button class="es-btn es-btn--sm" type="button" data-bs-design="${esc(l.id)}">Design this</button>
          </div>
        </div>
      </article>`;
    }
    const BS_SKEL = '<div class="mx-bsl mx-bsl--skel" aria-hidden="true"><span class="es-skeleton mx-bsl__art"></span><div class="mx-bsl__body"><span class="es-skeleton mx-skel mx-skel--title"></span><span class="es-skeleton mx-skel mx-skel--line"></span><span class="es-skeleton mx-skel mx-skel--short"></span></div></div>';
    function renderBoard() {
      const box = $('mx-bs-lines');
      if (!box) return;
      const b = state.bs;
      const s = b.session;
      document.querySelectorAll('#mx-bs-filter [data-bs-filter]').forEach(x => setOn(x, x.dataset.bsFilter === b.filter));
      if ($('mx-bs-sort')) $('mx-bs-sort').value = b.sort;
      const total = s ? (s.lines || []).length : 0;
      const starred = starredLines();
      setText('mx-bs-count', s ? String(total) : '');
      setText('mx-bs-board-meta', s?.storage === 'memory' && state.status?.canArchive ? 'Board not shared yet: the brainstorm table isn’t set up, so only this server sees it (admins only see this note).' : 'Star the lines you’d sell. Anyone at ES can add and star.');
      setText('mx-bs-design-starred-label', starred.length ? `Design all starred (${starred.length})` : 'Design all starred');
      const ds = $('mx-bs-design-starred');
      if (ds) { ds.disabled = !starred.length; ds.title = starred.length ? `Opens the ${plural(starred.length, 'starred line')} in the studio as one set` : 'Star lines first'; }
      setText('mx-bs-add-note', b.addNote);
      const note = $('mx-bs-add-note');
      if (note) note.dataset.tone = b.addTone || '';
      ['mx-bs-add-input', 'mx-bs-add-btn'].forEach(id => { const el = $(id); if (el) el.disabled = !s; });
      box.setAttribute('aria-busy', String(b.opening || b.busy));
      const focusKey = document.activeElement?.closest?.('#mx-bs-lines') ? document.activeElement.dataset.bsFocus || '' : '';
      if (b.opening && !s) { box.innerHTML = BS_SKEL.repeat(6); renderMix(); return; }
      if (!s) { box.innerHTML = ''; renderMix(); return; }
      const list = bsVisible();
      const skel = b.busy ? BS_SKEL.repeat(4) : '';
      if (!list.length && !skel) {
        const empty = b.filter === 'starred' ? ['No starred lines yet', 'Star the lines you’d sell. Teammates’ stars count too.'] : b.filter === 'mine' ? ['No lines from you yet', 'Ask the AI for lines, or add your own above.'] : ['No lines yet', 'Ask the AI for lines, pick an angle, or add your own.'];
        box.innerHTML = `<div class="es-empty mx-bs-empty"><span class="mx-bs-empty__art" aria-hidden="true"><svg class="mx-i" viewBox="0 0 24 24"><use href="#mx-i-bulb"/></svg></span><p class="es-empty__title">${esc(empty[0])}</p><p class="es-empty__copy">${esc(empty[1])}</p></div>`;
      } else box.innerHTML = skel + list.map(lineCard).join('');
      box.querySelectorAll('.mx-bsl[data-lid]').forEach(card => { const l = (s.lines || []).find(x => x.id === card.dataset.lid); if (l) drawLineArt(card.querySelector('canvas'), l); });
      if (focusKey) box.querySelector(`[data-bs-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
      if (b.editing) { const i = box.querySelector('[data-bs-edit-input]'); if (i && document.activeElement !== i) { i.focus(); i.select(); } }
      renderMix();
    }
    function renderMix() {
      const b = state.bs;
      const lines = b.session?.lines || [];
      b.picks = b.picks.filter(id => lines.some(l => l.id === id));
      show('mx-bs-mixbar', b.picks.length > 0);
      const [x, y] = b.picks.map(lineText);
      setText('mx-bs-mix-text', b.picks.length >= 2 ? `Mix “${x}” + “${y}”` : `“${x || ''}” picked. Pick one more to mix.`);
      const go_ = $('mx-bs-mix');
      if (go_) go_.disabled = b.picks.length < 2 || b.busy;
    }

    // ── Actions ──
    async function bsAsk(req) {
      const b = state.bs;
      if (!b.session || b.busy) return;
      const sid = b.session.id;
      b.busy = true;
      b.pending = req;
      b.chatError = '';
      b.lastAsk = null;
      b.justAsked = true;
      b.thinkAt = Date.now();
      clearInterval(b.think);
      b.think = setInterval(tickThink, 250);
      if (req.prompt && $('mx-bs-input')) $('mx-bs-input').value = '';
      renderBrainstorm();
      const asked = state.aiMode;
      try {
        const data = await api({ mode: 'brainstorm-turn', sessionId: sid, [AI_KEY]: asked, ...req });
        if (b.session?.id !== sid) return;
        const lines = Array.isArray(data.lines) ? data.lines : [];
        if (data.session) b.session = data.session;
        else {
          const at = new Date().toISOString();
          b.session = { ...b.session, lines: [...(b.session.lines || []), ...lines], turns: [...(b.session.turns || []), { by: b.me, at, ...req, note: data.note || '', lineIds: lines.map(l => l.id) }], updatedAt: at };
        }
        const mine = [...(b.session.turns || [])].reverse().find(t => isMe(t.by) || !b.me) || (b.session.turns || []).slice(-1)[0];
        if (mine) b.turnMeta[turnKey(mine)] = { mode: data.free ? 'free' : (data[AI_KEY] || asked), fellBack: data.fellBack || '' };
        b.fresh = lines.map(l => l.id);
        if (lines.length && b.filter !== 'all') b.filter = 'all';
        if (req.action?.kind === 'mix') b.picks = [];
        track('merch', { action: 'brainstorm-turn', mode: data[AI_KEY] || asked, kind: req.action?.kind || 'prompt', lines: lines.length, free: Boolean(data.free) });
      } catch (error) {
        b.chatError = explain(error).text;
        b.lastAsk = req;
        if (req.prompt && $('mx-bs-input') && !$('mx-bs-input').value) $('mx-bs-input').value = req.prompt;
      }
      b.busy = false;
      b.pending = null;
      clearInterval(b.think);
      b.justAsked = true;
      renderBrainstorm();
      if (b.fresh.length) $('mx-bs-lines')?.querySelector('.mx-bsl.is-new')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function sendPrompt() {
      const text = val('mx-bs-input').trim().slice(0, 300);
      if (!text) { $('mx-bs-input')?.focus(); return; }
      bsAsk({ prompt: text });
    }
    async function bsLineOp(lineId, op, text) {
      const b = state.bs;
      const s = b.session;
      const l = s?.lines?.find(x => x.id === lineId);
      if (!s || !l) return false;
      const before = JSON.stringify(s.lines);
      // Stars feel instant; the server's copy wins when it answers.
      if (op === 'star' && !l.starred.some(isMe)) l.starred = [...(l.starred || []), b.me || 'you'];
      if (op === 'unstar') l.starred = (l.starred || []).filter(x => !isMe(x) && x !== 'you');
      if (op === 'star' || op === 'unstar') renderBoard();
      try {
        const data = await apiRetry({ mode: 'brainstorm-line', sessionId: s.id, lineId, op, ...(op === 'edit' ? { text } : {}) });
        if (b.session?.id === s.id && data.session) b.session = data.session;
        else if (op === 'remove') s.lines = s.lines.filter(x => x.id !== lineId);
        else if (op === 'edit') l.text = text;
        b.addNote = op === 'remove' ? `Removed “${l.text}”.` : '';
        b.addTone = '';
        track('merch', { action: 'brainstorm-line', op });
        return true;
      } catch (error) {
        if (op === 'star' || op === 'unstar') s.lines = JSON.parse(before);
        b.addNote = explain(error).text;
        b.addTone = 'bad';
        return false;
      } finally { renderBoard(); renderThread(); renderBsHead(); }
    }
    async function bsAdd() {
      const b = state.bs;
      const input = $('mx-bs-add-input');
      const text = String(input?.value || '').trim().replace(/\s+/g, ' ');
      if (!b.session) return;
      if (text.length < 2) { b.addNote = 'Type a line first (up to 60 characters).'; b.addTone = 'bad'; renderBoard(); input?.focus(); return; }
      const btn = $('mx-bs-add-btn');
      if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
      try {
        const data = await apiRetry({ mode: 'brainstorm-add', sessionId: b.session.id, text });
        const before = new Set((b.session.lines || []).map(l => l.id));
        if (data.session) b.session = data.session;
        b.fresh = (b.session.lines || []).filter(l => !before.has(l.id)).map(l => l.id);
        if (b.filter === 'starred') b.filter = 'all';
        if (input) input.value = '';
        b.addNote = `Added “${text}” to the board.`;
        b.addTone = 'good';
        track('merch', { action: 'brainstorm-add' });
      } catch (error) {
        b.addNote = explain(error).text;
        b.addTone = 'bad';
      }
      btn?.removeAttribute('aria-busy');
      renderBrainstorm();
      input?.focus();
    }
    // A set of board lines → the studio: each line is a Your-words design in the trend's colours.
    function bsDesign(lines, { single = false } = {}) {
      const b = state.bs;
      if (!lines.length || state.making) return;
      let concepts = lines.slice(0, 12).map(lineConcept);
      if (single && MP().variations) {
        try { concepts = [concepts[0], ...MP().variations(concepts[0], { max: 3 }).map(v => ({ ...v, variantOf: concepts[0].id, garment: { ...(v.garment || {}) } }))]; } catch (error) { console.warn('merch brainstorm variations', error); }
      }
      const team = bsTeam();
      const title = b.context?.title || b.session?.title || '';
      const plan = single
        ? { idea: lines[0].why || `“${lines[0].text}” from the brainstorm board.`, angle: `${ANGLE_LABEL[lines[0].angle] || 'Line'}, in ${team ? team.name : 'ES'} colours. Three other layouts follow it.` }
        : { idea: `${plural(lines.length, 'starred line')} from the ${title ? `“${title}” ` : ''}board, one design each.`, angle: `Your words in ${team ? team.name : 'ES'} colours; tune each one by hand or ask the AI.` };
      const trend = b.trend ? { ...b.trend, momentId: b.from || b.trend.id, momentKind: 'moment', momentLine: null } : null;
      loadSet(concepts, { plan, brief: lines[0].text, trend });
      track('merch', { action: 'brainstorm-design', count: lines.length, single });
    }
    function loadSet(concepts, { plan = null, brief = '', trend = null } = {}) {
      if (state.making || !concepts.length) return;
      state.concepts = concepts.map(c => { const x = { ...c, garment: { ...(c.garment || { color: WHITE, name: 'White' }) }, mode: 'basic' }; delete x.elements; return x; });
      state.selected = state.concepts[0].id;
      state.history = {}; state.future = []; state.chat = {}; state.notes = {}; state.lastEdit = {}; state.pal = {}; state.errCount = {};
      state.ack = false; if ($('mx-ack')) $('mx-ack').checked = false;
      state.image = null; state.copyFor = ''; state.product = null; state.progFailed = false;
      state.conceptsFree = false; state.plan = plan; state.madeMode = 'board'; state.fellBack = '';
      const text = $('mx-text');
      if (text && brief) text.value = brief;
      if (trend) state.trend = trend;
      state.made = { content: { text: brief, url: '' }, trend: trendBody() };
      renderChip(); renderMoments(); syncContent();
      go('designs');
    }

    // ── Wiring ──
    document.addEventListener('click', e => {
      const ret = e.target.closest('[data-bs-retry-open]');
      if (ret) { loadBoard(); return; }
    });
    // A board for the line itself (key = the line); a moment in the brief goes along as context only.
    on('mx-bs-from-line', 'click', () => { const c = contentPayload(); const t = trendBody(); if (c.text.length > 2) openBrainstorm({ content: { text: c.text, ...(c.url ? { url: c.url } : {}), ...(t ? { trend: t } : {}) } }); });
    on('mx-bs-angles', 'click', e => { const x = e.target.closest('[data-bs-angle]'); if (!x || x.disabled) return; const a = BS_ANGLES[Number(x.dataset.bsAngle)]; if (a) bsAsk({ action: { ...a[1] } }); });
    on('mx-bs-send', 'click', sendPrompt);
    on('mx-bs-input', 'input', renderBsMode);
    on('mx-bs-input', 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPrompt(); } });
    on('mx-bs-mode', 'click', e => { const x = e.target.closest('[data-bs-mode]'); if (x) { setMode(x.dataset.bsMode); x.focus(); } });
    on('mx-bs-mode', 'keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); setMode(state.aiMode === 'pro' ? 'basic' : 'pro'); $('mx-bs-mode').querySelector(`[data-bs-mode="${state.aiMode}"]`)?.focus(); });
    on('mx-bs-thread', 'click', e => {
      if (e.target.closest('[data-bs-retry]')) { const req = state.bs.lastAsk; if (req) { if (req.prompt && $('mx-bs-input')) $('mx-bs-input').value = ''; bsAsk(req); } return; }
      const x = e.target.closest('[data-bs-show]');
      if (!x) return;
      const t = (state.bs.session?.turns || []).find(y => turnKey(y) === x.dataset.bsShow);
      if (!t) return;
      Object.assign(state.bs, { fresh: (t.lineIds || []).slice(), filter: 'all', sort: 'new' });
      renderBoard();
      $('mx-bs-lines')?.querySelector('.mx-bsl.is-new')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    on('mx-bs-filter', 'click', e => { const x = e.target.closest('[data-bs-filter]'); if (!x) return; state.bs.filter = x.dataset.bsFilter; renderBoard(); x.focus(); });
    on('mx-bs-sort', 'change', () => { state.bs.sort = val('mx-bs-sort') === 'stars' ? 'stars' : 'new'; renderBoard(); });
    on('mx-bs-add', 'submit', e => { e.preventDefault(); bsAdd(); });
    on('mx-bs-design-starred', 'click', () => { const list = starredLines(); if (list.length) bsDesign(list); });
    on('mx-bs-mix', 'click', () => { const ids = state.bs.picks.slice(0, 2); if (ids.length === 2) bsAsk({ action: { kind: 'mix', lineIds: ids } }); });
    on('mx-bs-mix-clear', 'click', () => { state.bs.picks = []; renderBoard(); });
    on('mx-bs-lines', 'change', e => {
      const x = e.target.closest('[data-bs-pick]');
      if (!x) return;
      const id = x.dataset.bsPick;
      const b = state.bs;
      b.picks = x.checked ? [...b.picks.filter(p => p !== id), id].slice(-2) : b.picks.filter(p => p !== id);
      renderBoard();
    });
    on('mx-bs-lines', 'click', e => {
      const b = state.bs;
      const find = id => (b.session?.lines || []).find(l => l.id === id);
      const star = e.target.closest('[data-bs-star]');
      if (star) { const l = find(star.dataset.bsStar); if (l) bsLineOp(l.id, l.starred?.some(isMe) ? 'unstar' : 'star'); return; }
      const more = e.target.closest('[data-bs-more]');
      if (more) { bsAsk({ action: { kind: 'more-like', lineIds: [more.dataset.bsMore] } }); return; }
      const des = e.target.closest('[data-bs-design]');
      if (des) { const l = find(des.dataset.bsDesign); if (l) bsDesign([l], { single: true }); return; }
      const edit = e.target.closest('[data-bs-edit]');
      if (edit) { b.editing = edit.dataset.bsEdit; renderBoard(); return; }
      if (e.target.closest('[data-bs-edit-cancel]')) { const id = b.editing; b.editing = ''; if (b.dirty) { b.dirty = false; renderBrainstorm(); } else renderBoard(); $('mx-bs-lines')?.querySelector(`[data-bs-focus="edit:${CSS.escape(id)}"]`)?.focus(); return; }
      const rm = e.target.closest('[data-bs-remove]');
      if (rm) { const l = find(rm.dataset.bsRemove); if (l) bsLineOp(l.id, 'remove'); }
    });
    on('mx-bs-lines', 'submit', async e => {
      const f = e.target.closest('[data-bs-edit-form]');
      if (!f) return;
      e.preventDefault();
      const id = f.dataset.bsEditForm;
      const text = String(f.querySelector('[data-bs-edit-input]')?.value || '').trim().replace(/\s+/g, ' ');
      const l = (state.bs.session?.lines || []).find(x => x.id === id);
      if (!l) return;
      if (!text || text === l.text) { state.bs.editing = ''; renderBoard(); return; }
      state.bs.editing = '';
      const okEdit = await bsLineOp(id, 'edit', text);
      if (!okEdit) state.bs.editing = id;
      if (state.bs.dirty) { state.bs.dirty = false; renderBrainstorm(); }
      renderBoard();
      if (!state.bs.editing) $('mx-bs-lines')?.querySelector(`[data-bs-focus="edit:${CSS.escape(id)}"]`)?.focus();
    });
    on('mx-bs-lines', 'keydown', e => { if (e.key === 'Escape' && e.target.closest('[data-bs-edit-input]')) { e.preventDefault(); e.target.closest('form')?.querySelector('[data-bs-edit-cancel]')?.click(); } });
    setHtml('mx-bs-angles', BS_ANGLES.map(([label, a], i) => `${i === 9 ? '<span class="mx-bs-angles__sep" aria-hidden="true"></span>' : ''}<button class="es-chip mx-bs-chip${a.kind === 'angle' ? '' : ' mx-bs-chip--tone'}" type="button" data-bs-angle="${i}">${esc(label)}</button>`).join(''));

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
    // Move and resize the design on the stage (merch-canvas.js): only where the
    // design's position is real (a calibrated Fourthwall photo or the close-up).
    function attachStageCanvas() {
      const cv = $('mx-stage-canvas');
      if (!cv || !window.MerchCanvas || canvasCtl) return;
      canvasCtl = window.MerchCanvas.attach({
        canvas: cv,
        getConcept: () => (state.making || state.step !== 'designs' ? null : selectedConcept()),
        getView: () => {
          const c = selectedConcept();
          const ph = state.view === 'tee' && c ? photoChoice(c.garment?.color) : null;
          return {
            view: state.view, kind: kind(), spec: thumbSpec(), pad: 0.14,
            templateId: state.templateId || '', photoIndex: ph?.index,
            calibrated: state.view === 'tee' && state.stagePic === 'photo' && Boolean(ph?.calibrated) && Boolean(BLANK_INFO[kind()]?.apparel),
          };
        },
        onChange: (fit, { final, source }) => {
          const c = selectedConcept();
          if (!c) return;
          if (source === 'cancel') { if (canvasGesture) (state.history[c.id] || []).pop(); canvasGesture = false; c.fit = fit; designChanged(); return; }
          if (!canvasGesture) { remember(c, 'canvas'); canvasGesture = true; }
          c.fit = fit;
          if (final) { canvasGesture = false; designChanged(); return; }
          renderFit();
          clearTimeout(drawT);
          drawT = setTimeout(drawStage, 30);
        },
      });
    }
    try { attachStageCanvas(); } catch (error) { console.warn('merch canvas', error); }
    window.MerchUI = { state, go, demo, refine, undo, redo, stop: stopMaking, openPop, closePop, brainstorm: openBrainstorm, bsRefresh: refreshBoard }; // for the UI check
  }
  // Small line icons for the blanks (decorative; 24px box, currentColor).
  const svg = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
  const BLANK_ICON = {
    tee: svg('<path d="M8 3 4 5 2 9l3 2 1-1v11h12V10l1 1 3-2-2-4-4-2c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>'),
    hoodie: svg('<path d="M8 4c1-1.5 7-1.5 8 0l4 2 2 5-3 1-1-1v10H6V11l-1 1-3-1 2-5 4-2Z"/><path d="M9 4.5c0 2 1.5 3.5 3 3.5s3-1.5 3-3.5"/>'),
    poster: svg('<rect x="5" y="2.5" width="14" height="19" rx="1"/><path d="M8 7h8M8 10h5"/>'),
    sticker: svg('<path d="M20 12a8 8 0 1 1-8-8h8v8Z"/><path d="M20 12h-4a4 4 0 0 1-4-4V4"/>'),
    mug: svg('<path d="M4 6h12v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/>'),
    longsleeve: svg('<path d="M8 3 5 4.5 2.5 19l3 .8L8 10v11h8V10l2.5 9.8 3-.8L19 4.5 16 3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>'),
    crewneck: svg('<path d="M8 3.5 5 5 2.5 19l3 .8L8 10.5V21h8V10.5l2.5 9.3 3-.8L19 5l-3-1.5"/><path d="M8 3.5c1 1.6 2.4 2.3 4 2.3s3-.7 4-2.3"/><path d="M8 19.5h8"/>'),
    tank: svg('<path d="M8.5 3v3.5a3.5 3.5 0 0 0 7 0V3"/><path d="M8.5 3 7 7.5 6 21h12l-1-13.5L15.5 3"/>'),
    youth: svg('<path d="M9 5.5 6 7 4.5 10l2.3 1.4.7-.6V20h9v-9.2l.7.6L19.5 10 18 7l-3-1.5c-.4 1.1-1.6 1.9-3 1.9s-2.6-.8-3-1.9Z"/>'),
    tote: svg('<path d="M4.5 8h15l-1 13h-13l-1-13Z"/><path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10"/>'),
  };
  boot();
}());
