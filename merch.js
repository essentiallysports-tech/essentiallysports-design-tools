/* Merch Designs (merch.html): Content → Designs → Setup → Push & live.
   Calls /api/merch (modes status, templates, concepts, copy, upload-url,
   upload-relay, register, preview, create, publish, hide, archive, product,
   list) and window.MerchPrint (preview / render / fallbackConcepts). Until
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
    if (demo && !window.MerchDemo) await loadScript('merch-demo.js?v=20261125-merch');

    const state = {
      step: 'content', status: null, statusError: '',
      collection: 'auto', trend: null, trends: null,
      concepts: [], selected: null, conceptsFree: false, busy: '',
      templates: null, templateId: '', colors: [], side: 'front', placement: '', copyFor: '',
      ack: false, mockups: [], image: null, logo: null, logoImage: null, editing: '', product: null, list: null, archiveArm: false,
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
      else if (s?.free) banner('free', 'Free mode: this week’s AI budget is used, so designs are made without AI. They still follow the ES style.');
      renderLiveGate();
    }

    // ── Steps ──
    const canGo = step => step === 'content' || (step === 'designs' && state.concepts.length > 0) || (step === 'setup' && Boolean(selectedConcept())) || (step === 'live' && Boolean(selectedConcept()) && state.ack);
    function go(step) {
      if (!canGo(step)) return;
      state.step = step;
      document.querySelectorAll('.mx-view').forEach(v => { v.hidden = v.dataset.view !== step; });
      renderSteps();
      if (step === 'setup') enterSetup();
      if (step === 'live') { renderLiveGate(); if (!state.list) loadList(); }
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
        const data = await api({ mode: 'concepts', content, collection: state.collection });
        if (data.free || !Array.isArray(data.concepts)) free = true; else concepts = data.concepts;
      } catch (error) {
        const why = explain(error);
        if (why.kind === 'setup' || why.kind === 'error' || why.kind === 'rate') free = true; // designs never need Fourthwall: fall back to code concepts
        if (why.kind === 'rate' || why.kind === 'cap') banner(why.kind, why.text);
      }
      if (free) {
        concepts = await P('fallbackConcepts')({ ...content, collection: state.collection });
        state.conceptsFree = true;
      } else state.conceptsFree = false;
      state.busy = '';
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Create designs';
      $('mx-content-meta').textContent = '';
      syncContent();
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
      return `<article class="mx-design${on ? ' is-on' : ''}" data-id="${esc(c.id)}">
        <button class="mx-design__pick" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="Choose ${esc(c.title)}">
          <canvas class="mx-design__tee" width="480" height="560" aria-hidden="true"></canvas>
        </button>
        <div class="mx-design__body">
          <div class="mx-design__tags"><span class="mx-tag">${esc(COLLECTION_LABEL[c.collection] || c.collection)}</span>${c.team?.name ? `<span class="mx-design__team">${esc(c.team.name)}</span>` : ''}</div>
          <h3 class="mx-design__title">${esc(c.title)}</h3>
          ${c.why ? `<p class="mx-design__why">${esc(c.why)}</p>` : ''}
          ${rights ? `<div class="mx-design__rights" aria-label="Rights to check">${rights}</div>` : ''}
          <div class="mx-design__swatches" role="group" aria-label="Tee colour">${swatches}</div>
          <div class="mx-design__edits" role="group" aria-label="Quick edits">
            <button class="mx-edit" type="button" data-act="text" aria-expanded="${state.editing === c.id}">Edit pills</button>
            <button class="mx-edit" type="button" data-act="size" title="First pill big and the rest small, or all big">Big / small</button>
            <button class="mx-edit" type="button" data-act="swap" title="Swap the two pill colours">Swap colours</button>
            <button class="mx-edit" type="button" data-act="align" title="Left or centre">${c.align === 'center' ? 'Align left' : 'Centre'}</button>
          </div>
          ${state.editing === c.id ? `<div class="mx-pills" role="group" aria-label="Pills">${(c.stack || []).map((r, i) => `<div class="mx-pill-row"><input class="mx-input mx-input--sm" type="text" value="${esc(r.text)}" maxlength="40" aria-label="Pill ${i + 1} text" data-pill="${i}"><button class="mx-icon" type="button" data-act="up" data-i="${i}" aria-label="Move pill ${i + 1} up"${i === 0 ? ' disabled' : ''}>↑</button><button class="mx-icon" type="button" data-act="drop" data-i="${i}" aria-label="Remove pill ${i + 1}"${(c.stack || []).length < 2 ? ' disabled' : ''}>×</button></div>`).join('')}<button class="mx-edit" type="button" data-act="add"${(c.stack || []).length >= 8 ? ' disabled' : ''}>Add a pill</button></div>` : ''}
        </div>
      </article>`;
    }
    async function drawCard(card, c) {
      const cv = card.querySelector('canvas');
      try { await P('preview')(c, c.garment?.color, cv); } catch (error) { console.warn('merch preview', error); }
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
      else if (act === 'size') { const mixed = stack.some(r => r.size === 'small'); c.stack = stack.map((r, i) => ({ ...r, size: mixed || i === 0 ? 'big' : 'small' })); }
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
    $('mx-to-setup').addEventListener('click', () => go('setup'));
    $('mx-again').addEventListener('click', () => go('content'));

    // ── 3 Setup ──
    const template = () => (state.templates || []).find(t => t.id === state.templateId) || null;
    const isLogoArea = a => Boolean(a && (a.logo === true || /sleeve|neck|label/i.test(a.region || '')));
    const printAreas = () => (template()?.areas || []).filter(a => !isLogoArea(a));
    const logoAreas = () => (template()?.areas || []).filter(isLogoArea);
    const areaLabel = a => a.label || String(a.region).replace(/-/g, ' ').replace(/^./, m => m.toUpperCase());
    const area = () => printAreas().find(a => a.region === state.side) || printAreas()[0] || null;
    const logoArea = () => logoAreas().find(a => a.region === state.logo) || null;
    // The tee preview, with the chosen ES logo spot marked.
    const LOGO_SPOT = { 'sleeve-left': [0.86, 0.31, 'Left sleeve'], 'sleeve-right': [0.14, 0.31, 'Right sleeve'], 'back-neck': [0.5, 0.115, 'Back neck'], 'neck-label': [0.5, 0.135, 'Neck label'] };
    async function drawStage() {
      const c = selectedConcept();
      const cv = $('mx-stage-canvas');
      try { await P('preview')(c, c.garment?.color, cv); } catch { return; }
      const la = logoArea();
      if (!la) return;
      const key = Object.keys(LOGO_SPOT).find(k => la.region.includes(k.split('-')[0]) && la.region.includes(k.split('-')[1])) || (/sleeve/.test(la.region) ? 'sleeve-left' : 'back-neck');
      const [fx, fy] = LOGO_SPOT[key];
      const g = cv.getContext('2d');
      const w = cv.width, h = cv.height, pw = w * 0.1, ph = pw * 0.16;
      g.save();
      g.fillStyle = '#0A7DFA';
      g.fillRect(w * fx - pw / 2, h * fy - ph / 2, pw, ph);
      g.setLineDash([4, 3]);
      g.strokeStyle = '#0A7DFA';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(w * fx, h * fy, pw * 0.75, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      cv.setAttribute('aria-label', `Tee preview, ES logo on the ${areaLabel(la).toLowerCase()}`);
    }
    async function enterSetup() {
      const c = selectedConcept();
      renderRights();
      if (!state.templates) {
        $('mx-blanks').innerHTML = '<span class="mx-meta">Loading blanks…</span>';
        try {
          const data = await api({ mode: 'templates', blank: 'tee' });
          state.templates = (data.templates || []).filter(t => !t.blank || t.blank === 'tee');
        } catch (error) {
          const why = explain(error);
          $('mx-blanks').innerHTML = `<span class="mx-meta mx-meta--bad">${esc(why.text)}</span> <button class="es-btn es-btn--sm" type="button" id="mx-blanks-retry">Try again</button>`;
          $('mx-blanks-retry').addEventListener('click', enterSetup);
          state.templates = null;
          syncSetup();
          return;
        }
        if (state.templates[0]) pickTemplate(state.templates[0].id, false);
      }
      renderSetup();
      if (state.copyFor !== c.id) loadCopy(c);
    }
    function pickTemplate(id, render = true) {
      state.templateId = id;
      const t = template();
      const c = selectedConcept();
      const match = t?.colors?.find(x => x.hex.toLowerCase() === String(c?.garment?.color || '').toLowerCase()) || t?.colors?.find(x => x.name === c?.garment?.name) || t?.colors?.[0];
      state.colors = match ? [match.name] : [];
      const a = area();
      state.placement = a?.placements?.[0] || '';
      if (!printAreas().some(x => x.region === state.side)) state.side = printAreas()[0]?.region || 'front';
      const logos = logoAreas();
      if (!logos.some(x => x.region === state.logo)) state.logo = (logos.find(x => /back-?neck/.test(x.region)) || logos[0])?.region || null;
      state.image = null; state.logoImage = null; state.mockups = [];
      if (render) renderSetup();
    }
    function renderSetup() {
      const t = template();
      $('mx-blanks').innerHTML = (state.templates || []).length
        ? state.templates.map(x => `<button class="mx-blank" type="button" role="radio" aria-checked="${x.id === state.templateId}" tabindex="${x.id === state.templateId ? 0 : -1}" data-tpl="${esc(x.id)}"><span class="mx-blank__name">${esc(x.name)}</span><span class="mx-blank__price">From ${money(x.priceFrom)}</span></button>`).join('')
        : '<span class="mx-meta">No tee blanks found on Fourthwall.</span>';
      $('mx-colors').innerHTML = (t?.colors || []).map(x => `<button class="es-chip" type="button" aria-pressed="${state.colors.includes(x.name)}" data-color="${esc(x.name)}"><span class="es-chip__dot" style="--dot:${esc(x.hex)}"></span>${esc(x.name)}</button>`).join('');
      const sides = printAreas().map(a => a.region);
      const logos = logoAreas();
      $('mx-logo').innerHTML = `${logos.map(a => `<option value="${esc(a.region)}">${esc(areaLabel(a))}</option>`).join('')}<option value="">No logo</option>`;
      $('mx-logo').value = state.logo || '';
      $('mx-logo-hint').textContent = logos.length ? 'The small ESSENTIALLYSPORTS pill, printed as its own area. Marked on the preview.' : 'This tee has no small print areas, so the logo is off.';
      drawStage();
      [...$('mx-side').options].forEach(o => { o.disabled = sides.length > 0 && !sides.includes(o.value); });
      $('mx-side').value = state.side;
      const a = area();
      $('mx-placement').innerHTML = (a?.placements || ['center']).map(p => `<option value="${esc(p)}">${esc(String(p).replace(/-/g, ' ').replace(/^./, m => m.toUpperCase()))}</option>`).join('');
      $('mx-placement').value = state.placement || (a?.placements || ['center'])[0];
      const cols = state.status?.collections || [];
      $('mx-fw-collection').innerHTML = `<option value="">None</option>${cols.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}`;
      renderMockups();
      syncEarn();
      syncSetup();
    }
    function syncEarn() {
      const t = template();
      const price = Number($('mx-price').value);
      if (!t || !(price > 0)) { $('mx-earn').textContent = ''; return; }
      const earn = price - (Number(t.priceFrom) || 0);
      $('mx-earn').innerHTML = earn > 0 ? `You earn about <strong>${money(earn)}</strong> per sale (base cost ${money(t.priceFrom)}).` : `<span class="mx-meta--bad">Below the base cost of ${money(t.priceFrom)}. Raise the price.</span>`;
    }
    async function loadCopy(c) {
      state.copyFor = c.id;
      $('mx-title-input').value = c.title ? `${c.title} tee` : '';
      $('mx-setup-meta').textContent = 'Writing the title and description…';
      try {
        const data = await api({ mode: 'copy', concept: c, templateId: state.templateId });
        if (data.title) $('mx-title-input').value = data.title;
        if (data.description) $('mx-desc').value = data.description;
        if (data.price) $('mx-price').value = data.price;
        $('mx-setup-meta').textContent = '';
      } catch (error) {
        $('mx-setup-meta').textContent = 'Couldn’t write the copy. Fill in the title, description and price yourself.';
      }
      if (!$('mx-price').value) $('mx-price').value = 30;
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
      return Boolean(template()) && state.colors.length > 0 && $('mx-title-input').value.trim().length > 2 && Number($('mx-price').value) > (Number(template()?.priceFrom) || 0);
    }
    function syncSetup() {
      const ready = setupReady();
      $('mx-to-live').disabled = !(ready && state.ack);
      $('mx-preview').disabled = !ready || state.busy === 'preview' || !pushAllowed().ok;
      $('mx-preview').title = pushAllowed().ok ? '' : pushAllowed().text;
      renderSteps();
    }
    $('mx-blanks').addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b) pickTemplate(b.dataset.tpl); });
    $('mx-colors').addEventListener('click', e => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      const name = b.dataset.color;
      state.colors = state.colors.includes(name) ? state.colors.filter(x => x !== name) : [...state.colors, name];
      b.setAttribute('aria-pressed', String(state.colors.includes(name)));
      state.mockups = [];
      renderMockups();
      syncSetup();
    });
    $('mx-side').addEventListener('change', () => { state.side = $('mx-side').value; state.placement = area()?.placements?.[0] || ''; state.image = null; state.mockups = []; renderSetup(); });
    $('mx-logo').addEventListener('change', () => { state.logo = $('mx-logo').value || null; state.logoImage = null; state.mockups = []; renderMockups(); drawStage(); });
    $('mx-placement').addEventListener('change', () => { state.placement = $('mx-placement').value; state.mockups = []; renderMockups(); });
    ['mx-title-input', 'mx-desc'].forEach(id => $(id).addEventListener('input', syncSetup));
    $('mx-price').addEventListener('input', () => { syncEarn(); syncSetup(); });
    $('mx-ack').addEventListener('change', () => { state.ack = $('mx-ack').checked; syncSetup(); });
    $('mx-to-live').addEventListener('click', () => go('live'));

    function renderMockups() {
      const box = $('mx-mockups');
      if (!state.mockups.length) { box.innerHTML = '<p class="mx-meta">This is a FrameUp preview. Preview mockups shows Fourthwall’s own images.</p>'; return; }
      box.innerHTML = `<p class="mx-label">Fourthwall mockups</p><div class="mx-mockups__grid">${state.mockups.slice(0, 4).map(m => `<figure class="mx-mock"><img src="${esc(m.url)}" alt="${esc(m.color)} mockup" loading="lazy"><figcaption>${esc(m.color)}</figcaption></figure>`).join('')}</div>`;
    }

    // ── Print file: render, upload, register (shared by preview and create) ──
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
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', 'image/png');
        xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(e.loaded / e.total); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error(`Upload failed (${xhr.status}).`), { status: xhr.status })));
        xhr.onerror = () => reject(Object.assign(new Error('network'), { network: true }));
        xhr.send(blob);
      });
    }
    const blobToBase64 = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
    // Draw → upload-url → PUT (progress) → register, or upload-relay when the
    // direct PUT is blocked (CORS / network). Returns the Fourthwall imageId.
    async function uploadCanvas(canvas, what, onStatus, from, span) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error(`The ${what} couldn’t be drawn. Try again.`);
      onStatus(from, `Uploading the ${what}…`);
      const up = await api({ mode: 'upload-url', contentType: 'image/png', size: blob.size });
      try {
        await putWithProgress(up.uploadUrl, blob, f => onStatus(from + f * span, `Uploading the ${what}… ${Math.round(f * 100)}%`));
        const reg = await api({ mode: 'register', fileUrl: up.fileUrl, uploadUrl: up.uploadUrl });
        if (reg.imageId) return reg.imageId;
      } catch (error) {
        if (!error.network) throw error;
        onStatus(from + span / 2, 'Direct upload was blocked. Sending through FrameUp instead…');
        const relay = await api({ mode: 'upload-relay', contentType: 'image/png', data: await blobToBase64(blob) });
        if (relay.imageId) return relay.imageId;
      }
      throw new Error(`Fourthwall didn’t accept the ${what}. Try again.`);
    }
    async function ensureImages(onStatus = () => {}) {
      const c = selectedConcept();
      const a = area() || { region: state.side, pixelsWidth: 3600, pixelsHeight: 4800, dpi: 300 };
      const spec = { templateId: state.templateId, region: state.side, pixelsWidth: a.pixelsWidth, pixelsHeight: a.pixelsHeight, dpi: a.dpi, garmentColor: c.garment?.color };
      const key = JSON.stringify([c.stack, c.palette, c.align, spec]);
      if (state.image?.key !== key) {
        onStatus(5, `Drawing the print file (${a.pixelsWidth} × ${a.pixelsHeight} px)…`);
        const canvas = document.createElement('canvas');
        await P('render')(c, spec, canvas);
        state.image = { key, imageId: await uploadCanvas(canvas, 'print file', onStatus, 10, 45) };
      }
      const la = logoArea();
      if (la) {
        const lspec = { templateId: state.templateId, region: la.region, pixelsWidth: la.pixelsWidth, pixelsHeight: la.pixelsHeight, dpi: la.dpi, garmentColor: c.garment?.color };
        const lkey = JSON.stringify(lspec);
        if (state.logoImage?.key !== lkey) {
          onStatus(58, 'Drawing the ES logo…');
          const canvas = document.createElement('canvas');
          await P('renderLogo')(lspec, canvas);
          state.logoImage = { key: lkey, imageId: await uploadCanvas(canvas, 'ES logo', onStatus, 60, 15) };
        }
      }
      return { main: state.image.imageId, logo: la ? state.logoImage.imageId : null, logoRegion: la?.region || null };
    }
    function productBody(images) {
      const c = selectedConcept();
      const regions = [{ region: state.side, imageId: images.main, placementStrategy: state.placement || 'center' }];
      if (images.logo) regions.push({ region: images.logoRegion, imageId: images.logo, placementStrategy: 'center' });
      return {
        templateId: state.templateId, colors: state.colors, regions, logoRegion: images.logoRegion,
        title: $('mx-title-input').value.trim(), description: $('mx-desc').value.trim(), price: Number($('mx-price').value),
        collectionId: $('mx-fw-collection').value || null, concept: c,
        rightsAck: { acknowledged: state.ack, items: c.rights || [], at: new Date().toISOString() },
      };
    }
    $('mx-preview').addEventListener('click', async () => {
      const gate = pushAllowed();
      if (!gate.ok) { $('mx-setup-meta').textContent = gate.text; return; }
      state.busy = 'preview';
      syncSetup();
      try {
        const images = await ensureImages((p, text) => { $('mx-setup-meta').textContent = text; });
        $('mx-setup-meta').textContent = `Asking Fourthwall for mockups… usually ${ETA.preview}.`;
        const data = await api({ mode: 'preview', ...productBody(images) });
        state.mockups = data.mockups || [];
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
      if (state.product) { $('mx-push').hidden = true; return; }
      $('mx-push').hidden = false;
      btn.disabled = !gate.ok || state.busy === 'create' || !state.ack;
      if (!gate.ok) $('mx-push-status').textContent = gate.text;
      else if (state.busy !== 'create') $('mx-push-status').textContent = `${state.colors.length} colour${state.colors.length === 1 ? '' : 's'} · ${money($('mx-price').value)} · ${state.status?.capLeft != null ? `${state.status.capLeft} creates left today` : 'up to 10 creates a day'}`;
    }
    $('mx-create-fw').addEventListener('click', async () => {
      const gate = pushAllowed();
      if (!gate.ok) { $('mx-push-status').textContent = gate.text; return; }
      state.busy = 'create';
      const btn = $('mx-create-fw');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        const images = await ensureImages(progress);
        progress(80, `Creating the product (hidden)… ${ETA.create}.`);
        const data = await api({ mode: 'create', ...productBody(images) });
        state.product = data.product;
        progress(null, '');
        state.list = null;
        loadList();
      } catch (error) {
        const why = explain(error);
        progress(null, why.text);
        if (why.kind === 'error' || why.kind === 'rate') banner(why.kind, why.text, { retry: () => $('mx-create-fw').click() });
      }
      state.busy = '';
      btn.removeAttribute('aria-busy');
      renderLiveGate();
      renderLive();
    });

    const STATE_LABEL = { HIDDEN: ['Hidden', 'warn'], AVAILABLE: ['Live', 'good'], ARCHIVED: ['Archived', 'ink'] };
    function renderLive() {
      const box = $('mx-live');
      const p = state.product;
      if (!p) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      const [label, tone] = STATE_LABEL[p.state] || [p.state || 'Unknown', 'ink'];
      const live = p.state === 'AVAILABLE';
      box.innerHTML = `
        <div class="mx-row mx-row--between">
          <div class="mx-live__head">
            <h2 class="mx-h2">${esc(p.name)}</h2>
            <span class="es-badge es-badge--${tone}">${esc(label)}</span>
          </div>
          <div class="mx-row">
            ${p.url ? `<a class="es-btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open on Fourthwall</a>` : ''}
            <button class="es-btn" type="button" data-live="${live ? 'hide' : 'publish'}">${live ? 'Hide' : 'Publish'}</button>
            <button class="es-btn es-btn--danger" type="button" data-live="archive">${state.archiveArm ? 'Archive for good?' : 'Archive'}</button>
            ${state.archiveArm ? '<button class="es-btn es-btn--ghost" type="button" data-live="cancel">Cancel</button>' : ''}
          </div>
        </div>
        ${state.archiveArm ? '<p class="mx-meta mx-meta--bad">Archiving deletes the product from Fourthwall. This can’t be undone.</p>' : ''}
        ${p.url ? `<p class="mx-meta">Product link: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></p>` : ''}
        <div class="mx-mockups__grid">${(p.mockups || []).slice(0, 4).map(m => `<figure class="mx-mock"><img src="${esc(m.url)}" alt="${esc(m.color)} mockup" loading="lazy"><figcaption>${esc(m.color)}</figcaption></figure>`).join('')}</div>
        ${(p.variants || []).length ? `<div class="es-table-wrap mx-variants"><table class="es-table"><caption class="es-sr-only">Variants</caption><thead><tr><th scope="col">SKU</th><th scope="col">Colour</th><th scope="col">Size</th><th scope="col">Price</th><th scope="col">Stock</th></tr></thead><tbody>${p.variants.map(v => `<tr><td>${esc(v.sku)}</td><td>${esc(v.color)}</td><td>${esc(v.size)}</td><td>${money(v.price)}</td><td>${esc(v.stock ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <p class="mx-meta">To change title, price or art after it’s on Fourthwall, edit it in the Fourthwall dashboard.</p>
        <p class="mx-meta" id="mx-live-status" role="status" aria-live="polite"></p>`;
    }
    $('mx-live').addEventListener('click', async e => {
      const b = e.target.closest('[data-live]');
      if (!b || !state.product) return;
      const act = b.dataset.live;
      if (act === 'cancel') { state.archiveArm = false; renderLive(); return; }
      if (act === 'archive' && !state.archiveArm) { state.archiveArm = true; renderLive(); $('mx-live').querySelector('[data-live="archive"]').focus(); return; }
      b.disabled = true;
      try {
        const data = await api({ mode: act, productId: state.product.id });
        if (act === 'archive') { state.product = null; state.archiveArm = false; $('mx-push-status').textContent = 'Archived.'; }
        else state.product = data.product || { ...state.product, state: act === 'publish' ? 'AVAILABLE' : 'HIDDEN' };
        state.list = null;
        loadList();
      } catch (error) {
        state.archiveArm = false;
        renderLive();
        $('mx-live-status').textContent = explain(error).text;
        return;
      }
      renderLive();
      renderLiveGate();
    });

    async function loadList() {
      const box = $('mx-list');
      box.innerHTML = '<p class="mx-meta">Loading…</p>';
      try {
        const data = await api({ mode: 'list' });
        state.list = data.products || [];
      } catch (error) {
        box.innerHTML = `<p class="mx-meta">${esc(explain(error).text)}</p>`;
        return;
      }
      box.innerHTML = state.list.length
        ? `<ul class="mx-list">${state.list.map(p => { const [label, tone] = STATE_LABEL[p.state] || [p.state, 'ink']; return `<li class="mx-list__row"><span class="mx-list__name">${esc(p.name)}</span><span class="es-badge es-badge--${tone}">${esc(label)}</span><span class="mx-meta">${p.price ? money(p.price) : ''}</span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">View</a>` : ''}<button class="es-btn es-btn--sm es-btn--ghost" type="button" data-open="${esc(p.id)}">Manage</button></li>`; }).join('')}</ul>`
        : '<p class="mx-meta">No merch on Fourthwall yet.</p>';
    }
    $('mx-list-refresh').addEventListener('click', () => loadList());
    $('mx-list').addEventListener('click', async e => {
      const b = e.target.closest('[data-open]');
      if (!b) return;
      try { const data = await api({ mode: 'product', productId: b.dataset.open }); state.product = data.product || state.list.find(p => p.id === b.dataset.open); } catch { state.product = state.list.find(p => p.id === b.dataset.open); }
      state.archiveArm = false;
      renderLive(); renderLiveGate();
      $('mx-live').scrollIntoView({ block: 'start' });
    });

    // ── Start ──
    renderCollections();
    syncContent();
    renderSteps();
    renderConn();
    loadStatus();
    window.MerchUI = { state, go, demo }; // for the UI check
  }
  boot();
}());
