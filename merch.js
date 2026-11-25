/* Merch Designs (merch.html): Content → Designs → Setup → Push & live, plus
   the "Your merch" tab.
   Calls /api/merch (modes status, templates, concepts, copy, upload-url,
   register, preview, create, publish, hide, product, archive, list,
   collections, collection-create, collection-set, sales; upload-relay as a
   fallback when the direct upload is blocked: the PNG goes to Supabase Storage
   merch-art/<user>/<file>.png first, then the server streams it to Fourthwall)
   and window.MerchPrint (preview / render / checks / fallbackConcepts). Blanks:
   tee, hoodie, poster, sticker, mug. Until
   merch-print.js lands, merch-stub.js stands in (loaded only when needed).
   Sample data: on localhost, or ?demo=merch off production, replies come from
   merch-demo.js and no network call is made for /api/merch; ?demo=off uses
   the real API. ?state=free|not-set-up|cant-push|error picks a sample state. */
(function () {
  'use strict';
  const PROD_HOSTS = ['frameup.essentiallysports.com'];
  const COLLECTIONS = [
    { id: 'auto', label: 'Auto', blurb: 'FrameUp picks' },
    { id: 'replay', label: 'Replay', blurb: 'An era fans still talk about' },
    { id: 'nickname', label: 'Nickname', blurb: 'Almost famous' },
    { id: 'quote', label: 'In their own words', blurb: 'An exact quote' },
    { id: 'core', label: 'Core ES', blurb: 'Lines that are ours' },
    { id: 'current', label: 'Current', blurb: 'This week’s story' },
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
  const ETA = { concepts: '10–20 seconds', preview: '10–30 seconds', create: 'about 30 seconds' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
  const $ = id => document.getElementById(id);

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
    if (!window.MerchStub) await loadScript('merch-stub.js?v=20261125-merch');
  }
  const P = fn => (typeof window.MerchPrint?.[fn] === 'function' ? window.MerchPrint : window.MerchStub)[fn];

  async function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    if (!$('mx-steps')) return;
    const demo = isDemo(window.location);
    const scenario = new URLSearchParams(window.location.search).get('state') || 'ok';
    await ensurePrint();
    if (demo && !window.MerchDemo) await loadScript('merch-demo.js?v=20261125-merch2');

    const state = {
      step: 'content', status: null, statusError: '',
      collection: 'auto', trend: null, trends: null,
      concepts: [], selected: null, conceptsFree: false, busy: '',
      templates: null, templateId: '', colors: [], side: 'front', placement: '', copyFor: '',
      ack: false, mockups: [], image: null, logo: null, logoImage: null, editing: '', product: null,
      shopColls: null, shopCollsError: '', pick: { setup: [], live: [] }, newColl: '',
      list: null, listError: '', listSource: '', salesAt: '', listBusy: false, archiving: null,
    };

    // ── API ──
    async function api(body) {
      if (demo && window.MerchDemo) {
        await new Promise(r => setTimeout(r, 150));
        const [status, data] = window.MerchDemo.reply(body, scenario);
        if (status >= 400 || data.ok === false) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status, reason: data.reason });
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

    // ── Banner (page-level state) ──
    function banner(kind, text, { retry = null } = {}) {
      const el = $('mx-banner');
      if (!kind) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
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
    }

    // ── Steps ──
    const canGo = step => step === 'content' || step === 'list' || (step === 'designs' && state.concepts.length > 0) || (step === 'setup' && Boolean(selectedConcept())) || (step === 'live' && Boolean(selectedConcept()) && state.ack);
    function go(step) {
      if (!canGo(step)) return;
      state.step = step;
      document.querySelectorAll('.mx-view').forEach(v => { v.hidden = v.dataset.view !== step; });
      renderSteps();
      renderTabs();
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
      $('mx-collections').innerHTML = COLLECTIONS.map(c => `<button class="mx-coll" type="button" role="radio" aria-checked="${state.collection === c.id}" tabindex="${state.collection === c.id ? 0 : -1}" data-coll="${c.id}"><span class="mx-coll__name">${esc(c.label)}</span><span class="mx-coll__blurb">${esc(c.blurb)}</span></button>`).join('');
    }
    $('mx-collections').addEventListener('click', e => { const b = e.target.closest('[data-coll]'); if (!b) return; state.collection = b.dataset.coll; renderCollections(); $('mx-collections').querySelector(`[data-coll="${state.collection}"]`).focus(); });
    $('mx-collections').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const i = COLLECTIONS.findIndex(c => c.id === state.collection);
      state.collection = COLLECTIONS[(i + d + COLLECTIONS.length) % COLLECTIONS.length].id;
      renderCollections();
      $('mx-collections').querySelector(`[data-coll="${state.collection}"]`).focus();
    });

    async function loadTrends() {
      const box = $('mx-trends');
      box.innerHTML = '<span class="mx-meta">Loading trends…</span>';
      try {
        let items;
        if (demo && window.MerchDemo) items = window.MerchDemo.TRENDS;
        else {
          const response = await fetch('/api/trend-design', { headers: { Accept: 'application/json' } });
          const data = await response.json();
          items = data.items || [];
        }
        const picks = window.TrendsLogic?.topPicks ? window.TrendsLogic.topPicks(items, { n: 8, maxPerSport: 3 }) : items.slice(0, 8);
        state.trends = picks;
        box.innerHTML = picks.length
          ? picks.map(t => `<button class="es-chip" type="button" aria-pressed="${state.trend?.id === t.id}" data-trend="${esc(t.id)}">${esc(t.title)}</button>`).join('')
          : '<span class="mx-meta">No trends right now. Paste your own words above.</span>';
        $('mx-trends-load').textContent = 'Refresh';
      } catch {
        box.innerHTML = '<span class="mx-meta">Trends didn’t load. Paste your own words above.</span>';
      }
    }
    $('mx-trends-load').addEventListener('click', loadTrends);
    $('mx-trends').addEventListener('click', e => {
      const b = e.target.closest('[data-trend]');
      if (!b) return;
      const t = (state.trends || []).find(x => String(x.id) === b.dataset.trend);
      state.trend = state.trend?.id === t?.id ? null : t;
      if (state.trend) $('mx-text').value = state.trend.title;
      $('mx-trends').querySelectorAll('[data-trend]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.trend === String(state.trend?.id))));
      syncContent();
    });

    function contentPayload() {
      const raw = $('mx-text').value.trim();
      const url = (raw.match(/https?:\/\/\S+/) || [''])[0];
      return { text: raw.replace(url, '').trim(), url, trend: state.trend ? { id: state.trend.id, title: state.trend.title, sport: state.trend.category || state.trend.sport || '' } : null };
    }
    function syncContent() {
      const has = $('mx-text').value.trim().length > 1;
      $('mx-create').disabled = !has || state.busy === 'concepts';
      $('mx-content-meta').textContent = has ? '' : 'Add some words or pick a trend to start.';
    }
    $('mx-text').addEventListener('input', () => { if (state.trend && $('mx-text').value.trim() !== state.trend.title) { state.trend = null; $('mx-trends').querySelectorAll('[data-trend]').forEach(x => x.setAttribute('aria-pressed', 'false')); } syncContent(); });
    $('mx-text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$('mx-create').disabled) createDesigns(); } });

    async function createDesigns() {
      const content = contentPayload();
      state.busy = 'concepts';
      const btn = $('mx-create');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Creating designs…';
      $('mx-content-meta').textContent = `Usually ${ETA.concepts}.`;
      syncContent();
      let concepts = null, free = false;
      try {
        const data = await api(state.collection === 'auto' ? { mode: 'concepts', content } : { mode: 'concepts', content, collection: state.collection });
        if (data.free || !Array.isArray(data.concepts)) free = true; else concepts = data.concepts;
      } catch (error) {
        const why = explain(error);
        if (why.kind === 'setup' || why.kind === 'error' || why.kind === 'rate') free = true; // designs never need Fourthwall: fall back to code concepts
        if (why.kind === 'rate' || why.kind === 'cap') banner(why.kind, why.text);
      }
      if (free) {
        banner('free', 'Free mode: designs are made without AI this time. They still follow the ES style.');
        concepts = await P('fallbackConcepts')({ ...content, collection: state.collection });
        state.conceptsFree = true;
      } else state.conceptsFree = false;
      state.busy = '';
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Create designs';
      $('mx-content-meta').textContent = '';
      syncContent();
      // The person's own line always comes back whole ("Your words"), even when the AI shortened it.
      try {
        const MP = window.MerchPrint;
        if (MP?.yourWords && Array.isArray(concepts) && !concepts.some(c => MP.hasLine(c, content.text))) { const mine = MP.yourWords(content); if (mine) concepts = [mine, ...concepts]; }
      } catch (error) { console.warn('merch your words', error); }
      state.concepts = (concepts || []).map(c => ({ ...c, garment: { ...(c.garment || { color: '#FFFFFF', name: 'White' }) } }));
      state.selected = state.concepts[0]?.id || null;
      state.ack = false; $('mx-ack').checked = false; state.image = null; state.mockups = []; state.copyFor = '';
      if (!state.concepts.length) { $('mx-content-meta').textContent = 'No designs came back. Try different words.'; return; }
      renderGrid();
      go('designs');
    }
    $('mx-create').addEventListener('click', createDesigns);

    // ── 2 Designs ──
    const selectedConcept = () => state.concepts.find(c => c.id === state.selected) || null;
    const garmentChoices = c => {
      const list = [{ name: 'White', color: '#FFFFFF' }, { name: 'Black', color: '#101114' }];
      if (c.palette?.a) list.push({ name: 'Team colour', color: c.palette.a });
      if (c.palette?.b) list.push({ name: 'Second colour', color: c.palette.b });
      if (c.garment?.color && !list.some(g => g.color.toLowerCase() === c.garment.color.toLowerCase())) list.unshift({ name: c.garment.name || 'Garment', color: c.garment.color });
      return list.filter((g, i, a) => a.findIndex(x => x.color.toLowerCase() === g.color.toLowerCase()) === i).slice(0, 5);
    };
    function cardHtml(c) {
      const on = c.id === state.selected;
      const rights = (c.rights || []).map(r => `<span class="mx-rchip" title="${esc(r.text)}">${esc(RIGHTS_LABEL[r.kind] || r.kind)}</span>`).join('');
      const swatches = garmentChoices(c).map(g => `<button class="mx-swatch" type="button" style="--sw:${esc(g.color)}" aria-pressed="${(c.garment?.color || '').toLowerCase() === g.color.toLowerCase()}" aria-label="${esc(g.name)} tee" title="${esc(g.name)}" data-act="garment" data-color="${esc(g.color)}" data-name="${esc(g.name)}"></button>`).join('');
      return `<article class="mx-design${on ? ' is-on' : ''}${c.variantOf ? ' is-variant' : ''}" data-id="${esc(c.id)}">
        <button class="mx-design__pick" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="Choose ${esc(c.title)}">
          <canvas class="mx-design__tee" width="480" height="560" aria-hidden="true"></canvas>
        </button>
        <div class="mx-design__body">
          <div class="mx-design__tags"><span class="mx-tag">${c.label ? esc(c.label) : esc(COLLECTION_LABEL[c.collection] || c.collection)}</span>${c.variantOf ? '<span class="mx-design__team">Variation</span>' : ''}${c.team?.name ? `<span class="mx-design__team">${esc(c.team.name)}</span>` : ''}</div>
          <h3 class="mx-design__title">${esc(c.title)}</h3>
          ${c.why ? `<p class="mx-design__why">${esc(c.why)}</p>` : ''}
          ${rights ? `<div class="mx-design__rights" aria-label="Rights to check">${rights}</div>` : ''}
          <div class="mx-design__swatches" role="group" aria-label="Tee colour">${swatches}</div>
          <div class="mx-design__edits" role="group" aria-label="Quick edits">
            <button class="mx-edit" type="button" data-act="vary" title="The same words in other ES pill layouts">Variations</button>
            <button class="mx-edit" type="button" data-act="text" aria-expanded="${state.editing === c.id}">Edit pills</button>
            <button class="mx-edit" type="button" data-act="size" title="Cycle: all big, first big with mid lines, first big with small lines">Pill sizes</button>
            <button class="mx-edit" type="button" data-act="swap" title="Swap the two pill colours">Swap colours</button>
            <button class="mx-edit" type="button" data-act="align" title="Left or centre">${c.align === 'center' ? 'Align left' : 'Centre'}</button>
          </div>
          ${state.editing === c.id ? `<div class="mx-pills" role="group" aria-label="Pills">${(c.stack || []).map((r, i) => `<div class="mx-pill-row"><input class="mx-input mx-input--sm" type="text" value="${esc(r.text)}" maxlength="60" aria-label="Pill ${i + 1} text" data-pill="${i}"><button class="mx-icon" type="button" data-act="up" data-i="${i}" aria-label="Move pill ${i + 1} up"${i === 0 ? ' disabled' : ''}>↑</button><button class="mx-icon" type="button" data-act="drop" data-i="${i}" aria-label="Remove pill ${i + 1}"${(c.stack || []).length < 2 ? ' disabled' : ''}>×</button></div>`).join('')}<button class="mx-edit" type="button" data-act="add"${(c.stack || []).length >= 10 ? ' disabled' : ''}>Add a pill</button></div>` : ''}
        </div>
      </article>`;
    }
    async function drawCard(card, c) {
      const cv = card.querySelector('canvas');
      try { await P(state.cardView === 'tee' || !window.MerchPrint?.closeup ? 'preview' : 'closeup')(c, c.garment?.color, cv); } catch (error) { console.warn('merch preview', error); }
    }
    function renderGrid() {
      const grid = $('mx-grid');
      grid.setAttribute('role', 'radiogroup');
      grid.setAttribute('aria-label', 'Designs');
      grid.innerHTML = state.concepts.map(cardHtml).join('');
      grid.querySelectorAll('.mx-design').forEach(card => drawCard(card, state.concepts.find(c => c.id === card.dataset.id)));
      $('mx-designs-sub').textContent = state.conceptsFree ? 'Made without AI (free mode). Quick edits change a design on the spot.' : 'Click a design to choose it. Quick edits change it on the spot.';
      syncDesigns();
    }
    function syncDesigns() {
      const c = selectedConcept();
      $('mx-to-setup').disabled = !c;
      $('mx-designs-meta').textContent = c ? `Chosen: ${c.title}` : 'Choose a design.';
      renderSteps();
    }
    function edit(c, act, btn) {
      const stack = c.stack || [];
      if (act === 'garment') c.garment = { color: btn.dataset.color, name: btn.dataset.name };
      else if (act === 'swap') c.palette = { ...c.palette, a: c.palette?.b || c.palette?.a, b: c.palette?.a || c.palette?.b };
      else if (act === 'align') c.align = c.align === 'center' ? 'left' : 'center';
      else if (act === 'size') {
        // All big → first big, rest mid → first big, rest small → all big.
        const rest = stack.slice(1).map(r => r.size);
        const next = rest.every(x => x === 'mid') && rest.length ? 'small' : rest.every(x => x === 'big' || !x) ? 'mid' : 'big';
        c.stack = stack.map((r, i) => ({ ...r, size: i === 0 ? 'big' : next }));
      }
      else if (act === 'text') state.editing = state.editing === c.id ? '' : c.id;
      else if (act === 'up') { const i = Number(btn.dataset.i); if (i > 0) { const s2 = [...stack]; [s2[i - 1], s2[i]] = [s2[i], s2[i - 1]]; c.stack = s2; } }
      else if (act === 'drop') { if (stack.length > 1) c.stack = stack.filter((_, i) => i !== Number(btn.dataset.i)); }
      else if (act === 'add') { const last = stack[stack.length - 1] || { size: 'big', fill: 'a', ink: 'ink' }; c.stack = [...stack, { ...last, text: 'New pill', fill: last.fill === 'a' ? 'b' : 'a' }]; }
      state.image = null; state.mockups = [];
    }
    $('mx-grid').addEventListener('click', e => {
      const card = e.target.closest('.mx-design');
      if (!card) return;
      const c = state.concepts.find(x => x.id === card.dataset.id);
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'vary') { addVariations(c); return; }
      if (act) {
        edit(c, act.dataset.act, act);
        state.selected = c.id;
        const fresh = document.createElement('div');
        fresh.innerHTML = cardHtml(c);
        const next = fresh.firstElementChild;
        card.replaceWith(next);
        drawCard(next, c);
        $('mx-grid').querySelectorAll('.mx-design').forEach(x => { const on = x.dataset.id === c.id; x.classList.toggle('is-on', on); const p = x.querySelector('.mx-design__pick'); p.setAttribute('aria-checked', String(on)); p.tabIndex = on ? 0 : -1; });
        next.querySelector(`[data-act="${act.dataset.act}"]${act.dataset.color ? `[data-color="${act.dataset.color}"]` : ''}${act.dataset.i ? `[data-i="${Math.max(0, Number(act.dataset.i) - (act.dataset.act === 'up' ? 1 : 0))}"]` : ''}`)?.focus();
        syncDesigns();
        return;
      }
      if (e.target.closest('.mx-design__pick')) {
        state.selected = c.id;
        $('mx-grid').querySelectorAll('.mx-design').forEach(x => { const on = x.dataset.id === c.id; x.classList.toggle('is-on', on); const p = x.querySelector('.mx-design__pick'); p.setAttribute('aria-checked', String(on)); p.tabIndex = on ? 0 : -1; });
        state.ack = false; $('mx-ack').checked = false; state.image = null; state.mockups = []; state.copyFor = '';
        syncDesigns();
      }
    });
    // Variations: the same words in other pill layouts, added right after the
    // design (replacing its earlier variations). No AI, no cost.
    function addVariations(c) {
      const list = window.MerchPrint?.variations ? window.MerchPrint.variations(c) : [];
      if (!list.length) { $('mx-designs-meta').textContent = 'No other layouts fit these words. Edit the pills and try again.'; return; }
      const root = c.variantOf || c.id;
      const at = state.concepts.findIndex(x => x.id === c.id);
      const keep = state.concepts.filter(x => x.variantOf !== root || x.id === c.id);
      const pos = keep.findIndex(x => x.id === c.id);
      const fresh = list.filter(v => v.id !== c.id).map(v => ({ ...v, variantOf: root, garment: { ...(v.garment || {}) } }));
      state.concepts = [...keep.slice(0, pos + 1), ...fresh, ...keep.slice(pos + 1)];
      renderGrid();
      window.FrameUpTrack?.track?.('merch', { action: 'variations', count: fresh.length, at });
      $('mx-designs-meta').textContent = `${fresh.length} variations added after “${c.label || c.title}”.`;
      $('mx-grid').querySelector(`.mx-design[data-id="${CSS.escape(fresh[0].id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    $('mx-grid').addEventListener('input', e => {
      const input = e.target.closest('[data-pill]');
      if (!input) return;
      const card = input.closest('.mx-design');
      const c = state.concepts.find(x => x.id === card.dataset.id);
      c.stack[Number(input.dataset.pill)].text = input.value;
      state.image = null; state.mockups = [];
      clearTimeout(input._t);
      input._t = setTimeout(() => drawCard(card, c), 120);
    });
    $('mx-grid').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d || !e.target.closest('.mx-design__pick')) return;
      e.preventDefault();
      const i = state.concepts.findIndex(c => c.id === state.selected);
      const next = state.concepts[(i + d + state.concepts.length) % state.concepts.length];
      $('mx-grid').querySelector(`.mx-design[data-id="${CSS.escape(next.id)}"] .mx-design__pick`).click();
      $('mx-grid').querySelector(`.mx-design[data-id="${CSS.escape(next.id)}"] .mx-design__pick`).focus();
    });
    document.querySelectorAll('[data-card-view]').forEach(b => b.addEventListener('click', () => {
      state.cardView = b.dataset.cardView;
      document.querySelectorAll('[data-card-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $('mx-grid').querySelectorAll('.mx-design').forEach(card => drawCard(card, state.concepts.find(c => c.id === card.dataset.id)));
    }));
    $('mx-to-setup').addEventListener('click', () => go('setup'));
    $('mx-again').addEventListener('click', () => go('content'));

    // ── 3 Setup ──
    // templates → [{ blank, label, templateId, name, basePrice, suggestedPrice?, printSpec,
    //   areas:[{ regionId, pixelsWidth, pixelsHeight, dpi, renderable, suitsLogo, suitsDesign, available }], colors, defaultColor, sizes }]
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
    const logoText = () => (logoInline() ? 'ES logo inside the design' : logoArea() ? `ES logo on the ${areaLabel(logoArea()).toLowerCase()}` : 'no ES logo');
    const garmentHex = () => (template()?.colors || []).find(x => x.name === state.colors[0])?.hex || (apparel() ? selectedConcept()?.garment?.color : '#FFFFFF');
    // The print spec for the chosen blank and area (what render and checks use).
    function printSpec() {
      const a = area() || { regionId: state.side, ...(window.MerchPrint?.DEFAULT_AREAS?.[kind()] || { pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 }) };
      const spec = { ...(template()?.printSpec || {}), templateId: state.templateId, kind: kind(), region: /back/i.test(a.regionId) ? 'back' : 'front', regionId: a.regionId, pixelsWidth: a.pixelsWidth, pixelsHeight: a.pixelsHeight, dpi: a.dpi, garmentColor: garmentHex() };
      if (logoInline()) spec.logo = 'inside';
      return spec;
    }
    async function drawStage() {
      const c = selectedConcept();
      const cv = $('mx-stage-canvas');
      const spec = printSpec();
      try { await P('preview')(c, garmentHex(), cv, { logoSpot: logoSpot(), size: 560, kind: kind(), spec: { pixelsWidth: spec.pixelsWidth, pixelsHeight: spec.pixelsHeight, dpi: spec.dpi } }); } catch (error) { console.warn('merch preview', error); }
      cv.setAttribute('aria-label', `${BLANK_INFO[kind()].label} preview, ${logoText()}`);
    }
    async function enterSetup() {
      const c = selectedConcept();
      renderRights();
      loadShopColls();
      if (!state.templates) {
        $('mx-blanks').innerHTML = '<span class="mx-meta">Loading products…</span>';
        try {
          const data = await api({ mode: 'templates' });
          const list = (data.templates || []).filter(Boolean);
          state.templates = list.sort((x, y) => BLANK_ORDER.indexOf(kindOf(x)) - BLANK_ORDER.indexOf(kindOf(y)));
        } catch (error) {
          const why = explain(error);
          $('mx-blanks').innerHTML = `<span class="mx-meta mx-meta--bad">${esc(why.text)}</span> <button class="es-btn es-btn--sm" type="button" id="mx-blanks-retry">Try again</button>`;
          $('mx-blanks-retry').addEventListener('click', enterSetup);
          state.templates = null;
          syncSetup();
          return;
        }
      }
      if (!template() && state.templates[0]) {
        const fit = state.templates.find(t => (c?.blanks || []).includes(kindOf(t)) && kindOf(t) === 'tee') || state.templates.find(t => kindOf(t) === 'tee') || state.templates[0];
        pickTemplate(fit.templateId, false);
      } else pickColorFor(c);
      renderSetup();
      if (state.copyFor !== copyKey(c)) loadCopy(c);
    }
    function pickColorFor(c) {
      const t = template();
      const match = (apparel() && (t?.colors?.find(x => x.hex?.toLowerCase() === String(c?.garment?.color || '').toLowerCase()) || t?.colors?.find(x => x.name === c?.garment?.name))) || t?.colors?.find(x => x.name === t.defaultColor) || t?.colors?.[0];
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
      state.image = null; state.logoImage = null; state.mockups = [];
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
      const k = kind();
      const fits = (selectedConcept()?.blanks || []).includes(k);
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
      drawStage();
      renderFit();
      renderMockups();
      renderChecks();
      syncEarn();
      syncSetup();
    }
    // ── Size and layout (the person's own fit, saved on the design) ──
    const DEFAULT_TOP_IN = 1.75;
    function renderFit() {
      const c = selectedConcept();
      if (!c) return;
      const f = window.MerchPrint?.fitOf ? window.MerchPrint.fitOf(c) : { scale: 1, topIn: null };
      $('mx-fit-scale').value = Math.round(f.scale * 100);
      $('mx-fit-scale-out').textContent = `${Math.round(f.scale * 100)}%`;
      $('mx-fit-top-row').hidden = !apparel();
      $('mx-fit-split').value = c.split || '';
      document.querySelectorAll('[data-fit-align]').forEach(b => b.setAttribute('aria-pressed', String((c.align === 'center' ? 'center' : 'left') === b.dataset.fitAlign)));
      let read = '';
      try {
        const sc = window.MerchPrint.layout(c, printSpec());
        const top = sc.designIn?.top ?? DEFAULT_TOP_IN;
        if (apparel()) { $('mx-fit-top').value = f.topIn ?? Math.round(top * 4) / 4; $('mx-fit-top-out').textContent = `${Number($('mx-fit-top').value).toFixed(2)} in`; }
        read = `Print size ${sc.designIn.w.toFixed(1)} × ${sc.designIn.h.toFixed(1)} in${apparel() ? `, ${top.toFixed(1)} in below the top of the print area` : ''}.`;
      } catch (error) { console.warn('merch fit', error); }
      $('mx-fit-read').textContent = read;
    }
    function fitChanged() {
      state.image = null; state.mockups = [];
      renderFit(); drawStage(); renderMockups(); renderChecks(); syncSetup();
    }
    $('mx-fit-scale').addEventListener('input', () => { const c = selectedConcept(); if (!c) return; c.fit = { ...(c.fit || {}), scale: Number($('mx-fit-scale').value) / 100 }; fitChanged(); });
    $('mx-fit-top').addEventListener('input', () => { const c = selectedConcept(); if (!c) return; c.fit = { ...(c.fit || {}), topIn: Number($('mx-fit-top').value) }; fitChanged(); });
    $('mx-fit-split').addEventListener('change', () => {
      const c = selectedConcept();
      if (!c) return;
      const mode = $('mx-fit-split').value;
      if (!c.designedStack) c.designedStack = (c.stack || []).map(r => ({ ...r }));
      if (!mode) { c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; fitChanged(); return; }
      const base = c.designedStack;
      const smalls = base.filter((r, i) => r.size === 'small' && i > 0);
      const words = base.filter(r => !smalls.includes(r)).map(r => r.text).join(' ');
      const parts = window.MerchPrint.splitWords(words, mode);
      if (parts.length > 9) { $('mx-fit-read').textContent = 'That makes too many pills for one print. Pick another option.'; $('mx-fit-split').value = c.split || ''; return; }
      const first = base[0] || { fill: 'a', ink: 'white' };
      const second = base.find((r, i) => i > 0 && r.size !== 'small') || { fill: first.fill === 'a' ? 'b' : 'a', ink: 'ink' };
      c.stack = [...parts.map((t, i) => ({ text: t, size: 'big', fill: (i % 2 ? second : first).fill, ink: (i % 2 ? second : first).ink })), ...smalls.map(r => ({ ...r }))];
      c.split = mode;
      fitChanged();
    });
    document.querySelectorAll('[data-fit-align]').forEach(b => b.addEventListener('click', () => { const c = selectedConcept(); if (!c) return; c.align = b.dataset.fitAlign; fitChanged(); }));
    $('mx-fit-reset').addEventListener('click', () => { const c = selectedConcept(); if (!c) return; c.fit = { scale: 1, topIn: null }; if (c.designedStack) c.stack = c.designedStack.map(r => ({ ...r })); c.split = ''; fitChanged(); });

    // Print checks for the chosen blank (300 DPI hard goods, mug wrap, sticker cut, poster trim).
    function printChecks() {
      const c = selectedConcept();
      if (!c || !template() || typeof window.MerchPrint?.checks !== 'function') return [];
      try { return window.MerchPrint.checks(c, printSpec()); } catch (error) { console.warn('merch checks', error); return []; }
    }
    const blockingChecks = () => printChecks().filter(x => x.level === 'error');
    // Problems and warnings in full; passing checks fold into one line with the details on request.
    const checkRow = x => `<li class="mx-check-row mx-check-row--${esc(x.level)}"><span class="mx-check-row__mark" aria-hidden="true">${x.level === 'ok' ? '✓' : '!'}</span><span><span class="es-sr-only">${x.level === 'error' ? 'Problem: ' : x.level === 'warn' ? 'Warning: ' : 'OK: '}</span>${esc(x.text)}</span></li>`;
    function renderChecks() {
      const list = printChecks();
      $('mx-checks-block').hidden = !list.length;
      const issues = list.filter(x => x.level !== 'ok');
      const passed = list.filter(x => x.level === 'ok');
      const dpi = passed.find(x => x.id === 'dpi');
      const summary = issues.length ? '' : `<li class="mx-check-row mx-check-row--ok"><span class="mx-check-row__mark" aria-hidden="true">✓</span><span>Ready to print on a ${esc(BLANK_INFO[kind()].label.toLowerCase())}${dpi ? `: ${esc(dpi.text.replace(/: full print size\.$/, '.'))}` : '.'}</span></li>`;
      $('mx-checks').innerHTML = `${issues.map(checkRow).join('')}${summary}${passed.length ? `<li><details class="mx-check-more"><summary>${issues.length ? `${passed.length} other checks pass` : `See all ${passed.length} checks`}</summary><ul class="mx-checks">${passed.map(checkRow).join('')}</ul></details></li>` : ''}`;
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
        const data = await api({ mode: 'copy', concept: c, content: contentPayload(), blank: kind() });
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
      $('mx-preview').disabled = !ready || state.busy === 'preview' || !pushAllowed().ok;
      $('mx-preview').title = pushAllowed().ok ? '' : pushAllowed().text;
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
    $('mx-colors').addEventListener('click', e => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      state.colors = [b.dataset.color];
      state.mockups = [];
      renderSetup();
      $('mx-colors').querySelector(`[data-color="${CSS.escape(b.dataset.color)}"]`)?.focus();
    });
    $('mx-colors').addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const list = template()?.colors || [];
      if (!d || !list.length) return;
      e.preventDefault();
      const i = list.findIndex(x => x.name === state.colors[0]);
      state.colors = [list[(i + d + list.length) % list.length].name];
      state.mockups = [];
      renderSetup();
      $('mx-colors').querySelector('[aria-checked="true"]')?.focus();
    });
    $('mx-side').addEventListener('change', () => { state.side = $('mx-side').value; if (state.logo === state.side) state.logo = null; state.image = null; state.mockups = []; renderSetup(); });
    $('mx-logo').addEventListener('change', () => { state.logo = $('mx-logo').value || null; state.image = apparel() ? state.image : null; state.logoImage = null; state.mockups = []; renderMockups(); drawStage(); renderChecks(); syncSetup(); });
    ['mx-title-input', 'mx-desc'].forEach(id => $(id).addEventListener('input', syncSetup));
    $('mx-price').addEventListener('input', () => { syncEarn(); syncSetup(); });
    $('mx-ack').addEventListener('change', () => { state.ack = $('mx-ack').checked; syncSetup(); });
    $('mx-to-live').addEventListener('click', () => go('live'));

    const imgUrl = m => (typeof m === 'string' ? m : m?.url || m?.transformedUrl || '');
    // Every mockup Fourthwall made, labelled by colour; click one to see it big.
    const galleries = new Map();
    let galleryN = 0;
    function imagesHtml(list, label) {
      const items = (list || []).filter(m => imgUrl(m));
      if (!items.length) return '';
      const id = `g${++galleryN}`;
      galleries.set(id, items.map((m, i) => ({ url: imgUrl(m), caption: [m?.color || label, m?.region ? String(m.region).replace(/_/g, ' ') : '', `${i + 1} of ${items.length}`].filter(Boolean).join(' · ') })));
      if (galleries.size > 30) galleries.delete(galleries.keys().next().value);
      return `<p class="mx-meta mx-mockups__count">${items.length} mockup${items.length === 1 ? '' : 's'}</p><div class="mx-mockups__grid">${items.map((m, i) => `<figure class="mx-mock"><button class="mx-mock__btn" type="button" data-gal="${id}" data-gi="${i}" aria-label="View ${esc(m?.color || label)} mockup ${i + 1} of ${items.length}"><img src="${esc(imgUrl(m))}" alt="" loading="lazy"></button>${m?.color ? `<figcaption>${esc(m.color)}</figcaption>` : ''}</figure>`).join('')}</div>`;
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
    function renderMockups() {
      const box = $('mx-mockups');
      const what = apparel() ? (state.colors[0] || '') : BLANK_INFO[kind()].label;
      if (!state.mockups.length) { box.innerHTML = '<p class="mx-meta">This is a FrameUp preview. Preview mockups shows Fourthwall’s own images.</p>'; return; }
      box.innerHTML = `<p class="mx-label">Fourthwall mockups · ${esc(what)}</p>${imagesHtml(state.mockups, what || 'Product')}`;
    }

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
      const key = JSON.stringify([c.stack, c.palette, c.align, spec]);
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
    $('mx-preview').addEventListener('click', async () => {
      const gate = pushAllowed();
      if (!gate.ok) { $('mx-setup-meta').textContent = gate.text; return; }
      state.busy = 'preview';
      syncSetup();
      try {
        const img = await ensureImages((p, text) => { $('mx-setup-meta').textContent = text; });
        $('mx-setup-meta').textContent = `Asking Fourthwall for mockups… usually ${ETA.preview}.`;
        const body = { mode: 'preview', blank: kind(), imageId: img.imageId, region: img.region };
        if (state.colors[0]) body.color = state.colors[0];
        if (img.logo) body.logo = img.logo;
        const data = await api(body);
        state.mockups = data.images || [];
        renderMockups();
        $('mx-setup-meta').textContent = state.mockups.length ? '' : 'Fourthwall sent no mockups. You can still continue.';
      } catch (error) {
        $('mx-setup-meta').textContent = explain(error).text;
      }
      state.busy = '';
      syncSetup();
    });

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
          mode: 'create', concept: c, content: contentPayload(), blank: kind(), imageId: img.imageId, region: img.region,
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
    renderCollections();
    syncContent();
    renderSteps();
    renderTabs();
    renderConn();
    loadStatus();
    window.MerchUI = { state, go, demo }; // for the UI check
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
