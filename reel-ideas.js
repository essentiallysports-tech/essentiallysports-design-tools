/* Reels Studio: the ideas room (Reels 2.0, lane B).
   A topic or a trend -> the ES angles for it, each with a storyboard that is
   ready to become a reel. The server (/api/reel-maker, mode "ideas") gathers
   ES articles, the trend, game and player data, asks the AI once and checks
   every number and quote in code; "Use this angle" builds the reel from the
   plan the server already validated, with no second AI call.

   Publishes ctx.modules.ideas = { open({ topic, trend, sport, steer }), close(), mount(el) }.
   Until the Start screen places it (mount), it opens as a dialog from a
   temporary "Brainstorm angles" button under the trend list.

   Sample data (local preview): on localhost (or ?demo=reels off production) the
   panel uses reel-b-sample.js instead of the API, marked "Sample data", with no
   AI or network calls. ?demo=off turns it off.

   The pure helpers at the top also load in Node (scripts/test-reel-ideas.mjs). */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ReelIdeasCore = core;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  // Shown before a run; the reply carries the real cost (netlify/functions/_reel-ideas.js PRICES).
  const PRICES = { main: 0.002, best: 0.04, factCheckCap: 0.03 };
  const PROD_HOSTS = ['frameup.essentiallysports.com', 'essentiallysports-design-tools.vercel.app'];
  const LENS_LABEL = { 'fan-first': 'Fan first', 'quote-led': 'Quote led', verdict: 'Verdict', money: 'Money', 'fan-reaction': 'Fan reaction', 'behind-the-moment': 'Behind the moment' };
  const RECIPE_LABEL = { 'stat-drop': 'Stat drop', 'quote-reaction': 'Quote reaction', explainer: 'Explainer', countdown: 'Countdown', versus: 'Versus', 'fan-pulse': 'Fan pulse', verdict: 'Verdict', 'money-story': 'Money story' };
  const BLOCK_LABEL = { hook: 'Hook', statement: 'Statement', number: 'Number', dots: 'Dots', compare: 'Compare', quote: 'Quote', endcard: 'End card' };
  const SOURCE_LABEL = { es: 'ES article', trend: 'Trend', news: 'News', game: 'Game result', player: 'Player stats', 'fact-check': 'Fact check', brief: 'Your topic' };
  const SPORTS = [['', 'Any sport'], ['nfl', 'NFL'], ['cfb', 'College football'], ['mlb', 'MLB'], ['nba', 'NBA'], ['wnba', 'WNBA'], ['golf', 'Golf'], ['tennis', 'Tennis'], ['nascar', 'NASCAR']];

  function isDemo(loc) {
    if (!loc) return false;
    const params = new URLSearchParams(loc.search || '');
    const flag = params.get('demo');
    if (flag === 'off') return false;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(loc.hostname || '');
    if (local) return true;
    return flag === 'reels' && !PROD_HOSTS.includes(loc.hostname);
  }
  const fmtUsd = usd => { const n = Number(usd) || 0; if (n === 0) return '$0'; if (n < 0.001) return '<$0.001'; return n < 0.1 ? `$${String(Math.round(n * 1000) / 1000)}` : `$${n.toFixed(2)}`; };
  // What a run will cost at most, for the line under the button.
  function estimate({ best = false, factCheck = false } = {}) {
    return (best ? PRICES.best : PRICES.main) + (factCheck ? PRICES.factCheckCap : 0);
  }
  function costLine({ best = false, factCheck = false, demo = false, ai = true } = {}) {
    if (demo) return 'Sample data: no cost.';
    if (!ai) return 'AI is off here, so you get free drafts built from headlines and facts.';
    return `About ${fmtUsd(best ? PRICES.best : PRICES.main)} per run${factCheck ? `, plus up to ${fmtUsd(PRICES.factCheckCap)} for the fact check` : ''}. Repeat runs within 30 minutes are free. Counts toward your weekly AI limit.`;
  }
  // An angle -> what the page's applyPlan takes. The plan is the one the
  // server validated; nothing is rewritten here.
  function applyData(angle, result = {}) {
    const plan = JSON.parse(JSON.stringify(angle.plan));
    const cited = new Set(angle.sources || []);
    const all = Array.isArray(result.sources) ? result.sources : [];
    const ordered = [...all.filter(s => cited.has(s.id)), ...all.filter(s => !cited.has(s.id))];
    return {
      plan,
      source: angle.free ? 'draft' : 'director',
      notice: angle.free ? 'This is a free draft built from headlines and facts. Edit the beats before you post.' : '',
      issues: angle.issues || [],
      corpus: result.corpus || '',
      sources: ordered.slice(0, 16).map(s => ({ type: s.type === 'es' ? 'news' : s.type, title: s.title, url: s.url || '', source: s.type === 'es' ? 'EssentiallySports' : (s.source || '') })),
      model: result.model || '',
      cost: 0,
    };
  }
  // "ES articles 5 · Trend 3 · Game results 1": what the gathering found.
  function gatherLine(result = {}) {
    const steps = result.steps || {};
    const part = (key, label) => {
      const s = steps[key];
      if (!s || s.skipped) return '';
      if (!s.ok) return `${label}: not reachable`;
      return `${label}: ${s.count || 0}`;
    };
    return [part('es', 'ES articles'), part('trend', 'Trend headlines'), part('games', 'Game results'), part('player', 'Player stats'), part('factCheck', 'Fact check')].filter(Boolean).join(' · ');
  }
  return { PRICES, PROD_HOSTS, LENS_LABEL, RECIPE_LABEL, BLOCK_LABEL, SOURCE_LABEL, SPORTS, isDemo, fmtUsd, estimate, costLine, applyData, gatherLine };
}));

(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const C = window.ReelIdeasCore;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
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

  function create(ctx) {
    const demo = C.isDemo(window.location);
    const state = {
      status: 'idle', // idle | loading | done | error
      topic: '', sport: '', trend: null, steer: '', best: false, factCheck: false,
      result: null, error: '', demoState: 'live', run: 0, used: '',
    };
    let host = null; // where the panel is mounted
    let dialog = null; // the temporary dialog, when not mounted by the Start screen
    let els = {};

    const aiOn = () => demo || Boolean(ctx.state && ctx.state.config && ctx.state.config.ai && !ctx.state.config.offline);

    function shell() {
      host.classList.add('rb', 'rb-ideas');
      host.innerHTML = `
        <header class="rb__head">
          <div>
            <p class="rb__eyebrow">Ideas room</p>
            <h2 class="rb__title" id="rb-ideas-title">Find the ES angle</h2>
          </div>
          ${dialog ? `<button class="rb__close" type="button" id="rb-ideas-close" aria-label="Close the ideas room">${X}</button>` : ''}
        </header>
        <p class="rb__lede">Type a story or pick a trend. You get the angles ES would take, each with a storyboard, checked against ES articles and real data.</p>
        ${demo ? `<div class="rb-demo" role="note">
          <span class="rb-demo__tag">Sample data</span>
          <span class="rb-demo__text">Local preview: made-up teams, players and articles. No AI or network calls.</span>
          <label class="rb-demo__pick"><span>Show</span>
            <select class="es-select es-select--sm" id="rb-ideas-demo" aria-label="Preview state">
              <option value="live">AI angles</option><option value="free">Free drafts</option><option value="over">Over budget</option>
              <option value="empty">No angles</option><option value="error">Error</option><option value="loading">Loading</option>
            </select></label>
        </div>` : ''}
        <form class="rb-form" id="rb-ideas-form" novalidate>
          <label class="es-field__label" for="rb-ideas-topic">Topic or story</label>
          <textarea class="es-input rb-form__topic" id="rb-ideas-topic" rows="2" maxlength="600" placeholder="e.g. A veteran quarterback's new contract and what fans make of it" aria-describedby="rb-ideas-cost"></textarea>
          <div class="rb-form__row">
            <label class="rb-form__field"><span class="es-field__label">Sport</span>
              <select class="es-select" id="rb-ideas-sport">${C.SPORTS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>
            <label class="rb-check"><input type="checkbox" id="rb-ideas-best"><span>Stronger model <small>about ${C.fmtUsd(C.PRICES.best)}</small></span></label>
            <label class="rb-check"><input type="checkbox" id="rb-ideas-facts"><span>Check facts on the web <small>up to ${C.fmtUsd(C.PRICES.factCheckCap)}</small></span></label>
            <button class="es-btn es-btn--primary rb-form__go" type="submit" id="rb-ideas-go">Brainstorm</button>
          </div>
          <p class="rb-cost" id="rb-ideas-cost"></p>
        </form>
        <div class="rb-out" id="rb-ideas-out" aria-live="polite"></div>`;
      const $ = id => host.querySelector(`#${id}`);
      els = { form: $('rb-ideas-form'), topic: $('rb-ideas-topic'), sport: $('rb-ideas-sport'), best: $('rb-ideas-best'), facts: $('rb-ideas-facts'), go: $('rb-ideas-go'), cost: $('rb-ideas-cost'), out: $('rb-ideas-out'), close: $('rb-ideas-close'), demoState: $('rb-ideas-demo') };
      els.form.addEventListener('submit', event => { event.preventDefault(); brainstorm(); });
      els.topic.addEventListener('input', () => { state.topic = els.topic.value; if (state.trend && els.topic.value.trim() !== state.trend.title) state.trend = null; });
      els.sport.addEventListener('change', () => { state.sport = els.sport.value; });
      els.best.addEventListener('change', () => { state.best = els.best.checked; renderCost(); });
      els.facts.addEventListener('change', () => { state.factCheck = els.facts.checked; renderCost(); });
      els.close?.addEventListener('click', close);
      els.demoState?.addEventListener('change', () => { state.demoState = els.demoState.value; brainstorm(); });
      els.out.addEventListener('click', event => {
        const use = event.target.closest('[data-use]');
        if (use) { useAngle(use.dataset.use); return; }
        if (event.target.closest('[data-retry]')) brainstorm();
      });
      syncForm();
      render();
    }
    function syncForm() {
      if (!els.topic) return;
      els.topic.value = state.topic;
      els.sport.value = C.SPORTS.some(([id]) => id === state.sport) ? state.sport : '';
      els.best.checked = state.best;
      els.facts.checked = state.factCheck;
      renderCost();
    }
    function renderCost() {
      if (!els.cost) return;
      els.cost.textContent = C.costLine({ best: state.best, factCheck: state.factCheck, demo, ai: aiOn() });
      const off = !aiOn();
      els.best.disabled = off;
      els.facts.disabled = off;
    }

    async function brainstorm() {
      const topic = els.topic.value.trim();
      if (topic.length < 3) {
        state.status = 'error';
        state.error = 'Type a topic or pick a trend first.';
        state.result = null;
        render();
        els.topic.focus();
        return;
      }
      state.topic = topic;
      state.status = 'loading';
      state.error = '';
      state.used = '';
      const run = ++state.run;
      render();
      try {
        let result;
        if (demo) {
          const sample = await loadSample();
          await new Promise(resolve => setTimeout(resolve, state.demoState === 'loading' ? 600000 : 350));
          if (state.demoState === 'error') throw new Error('The ideas room is unavailable right now. Try again in a moment.');
          result = sample.ideas({ topic, state: state.demoState });
        } else {
          result = await ctx.api({ mode: 'ideas', topic, sport: state.sport, trend: state.trend, steer: state.steer, tier: state.best ? 'best' : 'main', factCheck: state.factCheck });
        }
        if (run !== state.run) return;
        state.result = result;
        state.status = 'done';
      } catch (error) {
        if (run !== state.run) return;
        state.status = 'error';
        state.error = error && error.message ? error.message : 'The ideas room is unavailable right now. Try again in a moment.';
      }
      render();
    }

    function useAngle(id) {
      const result = state.result;
      const angle = result && result.angles.find(a => a.id === id);
      if (!angle) return;
      const data = C.applyData(angle, result);
      const trend = state.trend ? { id: state.trend.id, title: state.trend.title, sport: state.trend.sport, url: state.trend.url } : null;
      try {
        ctx.applyPlan(data, { brief: result.topic || state.topic, trend });
      } catch (error) {
        window.FrameUpErrors?.report?.(error, 'reels ideas use');
        ctx.toast('That storyboard could not be opened. Try another angle.', { tone: 'error' });
        return;
      }
      state.used = id;
      ctx.emit('idea', { lens: angle.lens, recipe: angle.recipe, free: Boolean(angle.free), topic: result.topic || state.topic });
      ctx.logEvent('idea_pick', { lens: angle.lens, recipe: angle.recipe, free: Boolean(angle.free), sources: (result.sources || []).length });
      ctx.toast(`Storyboard built from the "${angle.lensLabel}" angle.`);
      if (dialog) close(); else render();
    }

    // ── Rendering ────────────────────────────────────────────────────────
    const pill = p => `<span class="rb-pill rb-pill--${esc(p.color || 'ink')}">${esc(p.text)}</span>`;
    function sourcesHtml(result) {
      const list = result.sources || [];
      if (!list.length) return '<p class="rb-note">No sources were found for this topic, so the angles use only your words. Check every fact before you post.</p>';
      const es = list.filter(s => s.type === 'es').length;
      const row = s => {
        const url = safeUrl(s.url);
        const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : `<span>${esc(s.title)}</span>`;
        return `<li class="rb-src"><span class="rb-src__id">${esc(s.id)}</span><span class="rb-src__body">${title}
          <span class="rb-src__meta">${[C.SOURCE_LABEL[s.type] || 'Source', s.source && s.type !== 'es' ? s.source : '', s.date].filter(Boolean).map(esc).join(' · ')}${s.mostRead ? ' <span class="es-badge es-badge--brand">Most read</span>' : ''}</span></span></li>`;
      };
      return `<details class="rb-sources" ${list.length <= 6 ? 'open' : ''}>
        <summary><span class="rb-sources__title">What the ideas are built on</span><span class="rb-sources__meta">${list.length} source${list.length === 1 ? '' : 's'}${es ? `, ${es} from ES` : ''}</span></summary>
        <p class="rb-note">${esc(C.gatherLine(result))}</p>
        <ul class="rb-srclist">${list.map(row).join('')}</ul>
      </details>`;
    }
    function angleHtml(angle) {
      const used = state.used === angle.id;
      const board = angle.storyboard.map(b => `<li class="rb-beat"><span class="rb-beat__type">${esc(C.BLOCK_LABEL[b.type] || 'Beat')}</span><span class="rb-beat__text">${esc(b.text)}</span></li>`).join('');
      const poll = angle.poll ? `<div class="rb-poll"><p class="rb-poll__q"><span class="rb-poll__tag">Fan pulse</span>${esc(angle.poll.question)}</p><ul class="rb-poll__opts">${angle.poll.options.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>` : '';
      const cited = (angle.sources || []).length ? `<p class="rb-angle__cites">Built on ${angle.sources.map(esc).join(', ')}</p>` : '';
      const issues = (angle.issues || []).length ? `<details class="rb-angle__issues"><summary>${angle.issues.length} change${angle.issues.length === 1 ? '' : 's'} by the fact check</summary><ul>${angle.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>` : '';
      return `<li class="rb-angle${used ? ' is-used' : ''}">
        <div class="rb-angle__top">
          <span class="rb-lens rb-lens--${esc(angle.lens)}">${esc(angle.lensLabel || C.LENS_LABEL[angle.lens] || 'Angle')}</span>
          <span class="rb-angle__recipe">${esc(C.RECIPE_LABEL[angle.recipe] || '')}</span>
          ${angle.free ? '<span class="es-badge es-badge--warn">Free draft</span>' : ''}
        </div>
        <h3 class="rb-angle__line">${esc(angle.angle)}</h3>
        <div class="rb-hook" aria-label="Hook">${(angle.hook.pills || []).map(pill).join('')}${angle.hook.stamp ? `<span class="rb-stamp">${esc(angle.hook.stamp.text)}</span>` : ''}</div>
        <ol class="rb-board" aria-label="Storyboard">${board}</ol>
        ${poll}${cited}${issues}
        <button class="es-btn rb-angle__use" type="button" data-use="${esc(angle.id)}">${used ? 'Storyboard built' : 'Use this angle'}</button>
      </li>`;
    }
    function render() {
      if (!els.out) return;
      const busy = state.status === 'loading';
      els.go.disabled = busy;
      els.go.textContent = busy ? 'Brainstorming…' : 'Brainstorm';
      els.out.setAttribute('aria-busy', String(busy));
      if (state.status === 'idle') {
        els.out.innerHTML = '<div class="es-empty rb-state"><p class="es-empty__title">No angles yet</p><p class="es-empty__copy">Type a story above or pick a trend, then press Brainstorm. Nothing is spent until you do.</p></div>';
        return;
      }
      if (busy) {
        els.out.innerHTML = `<p class="rb-note rb-loading">Reading ES coverage, the trend and the game data. This takes up to a minute.</p>
          <ul class="rb-angles" aria-hidden="true">${Array.from({ length: 3 }, () => '<li class="rb-angle is-skeleton"><span class="es-skeleton rb-sk rb-sk--a"></span><span class="es-skeleton rb-sk rb-sk--b"></span><span class="es-skeleton rb-sk rb-sk--c"></span></li>').join('')}</ul>`;
        return;
      }
      if (state.status === 'error') {
        els.out.innerHTML = `<div class="es-error-state rb-state" role="alert"><p class="es-error-state__title">Brainstorm did not work</p><p class="es-error-state__copy">${esc(state.error)}</p><button class="es-btn" type="button" data-retry>Try again</button></div>`;
        return;
      }
      const result = state.result;
      const over = result.reason === 'weekly-limit' || result.reason === 'budget' || result.reason === 'limit';
      const notice = result.free
        ? `<div class="rb-callout ${over ? 'rb-callout--warn' : ''}" role="status"><strong>${over ? 'Over the AI budget' : 'Free drafts'}</strong><span>${esc(result.notice || 'These are free drafts built from the headlines and facts found, with no AI. Edit them before you post.')}</span></div>`
        : '';
      const dropped = (result.dropped || []).length ? `<details class="rb-dropped"><summary>${result.dropped.length} idea${result.dropped.length === 1 ? ' was' : 's were'} dropped by the fact check</summary><ul>${result.dropped.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : '';
      const spent = demo ? 'Sample data: no cost.' : result.cached ? 'From the last 30 minutes: no cost.' : result.free && !result.cost ? 'No AI was used: no cost.' : `This run cost ${C.fmtUsd(result.cost)}.`;
      const angles = result.angles.length
        ? `<ul class="rb-angles">${result.angles.map(angleHtml).join('')}</ul>`
        : '<div class="es-empty rb-state"><p class="es-empty__title">No angle held up</p><p class="es-empty__copy">Nothing could be backed by the sources found. Add a detail to the topic (a name, a team, what happened) and try again.</p></div>';
      els.out.innerHTML = `${notice}${sourcesHtml(result)}
        <div class="rb-out__head"><h3 class="rb-out__title">${result.angles.length ? `${result.angles.length} angle${result.angles.length === 1 ? '' : 's'}${result.newsletter ? ` for ${esc(result.newsletter)}` : ''}` : 'Angles'}</h3><span class="rb-note">${esc(spent)}</span></div>
        ${angles}${dropped}
        <p class="rb-note">Every number and quote was checked against the sources above. Still read it through before you post.</p>`;
    }

    // ── Public API ───────────────────────────────────────────────────────
    function mount(el) {
      if (!el) return api;
      if (dialog) { dialog.close?.(); dialog.remove(); dialog = null; }
      document.getElementById('rb-entry-ideas')?.remove();
      host = el;
      shell();
      return api;
    }
    function ensureDialog() {
      if (host) return;
      dialog = document.createElement('dialog');
      dialog.className = 'es-dialog rb-dialog';
      dialog.setAttribute('aria-labelledby', 'rb-ideas-title');
      dialog.innerHTML = '<div class="rb-dialog__body"></div>';
      (document.querySelector('.rm-page') || document.body).append(dialog);
      dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
      host = dialog.firstElementChild;
      shell();
    }
    function open(opts = {}) {
      ensureDialog();
      const trend = opts.trend && opts.trend.title ? opts.trend : null;
      if (opts.topic || trend) {
        state.topic = String(opts.topic || trend.title).slice(0, 600);
        state.trend = trend ? { id: trend.id, title: trend.title, sport: trend.sport, team: trend.team || '', url: trend.url || '', related: trend.related || [] } : null;
        state.sport = opts.sport || (trend && trend.sport) || state.sport;
        state.steer = String(opts.steer || '').slice(0, 300);
        if (state.status !== 'loading') { state.status = 'idle'; state.result = null; }
      }
      syncForm();
      render();
      if (dialog && !dialog.open) dialog.showModal();
      else if (!dialog) host.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      els.topic?.focus({ preventScroll: true });
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
    if (!anchor || document.getElementById('rb-entry-ideas')) return;
    let row = document.getElementById('rb-entry');
    if (!row) {
      row = document.createElement('div');
      row.id = 'rb-entry';
      row.className = 'rb-entry';
      anchor.after(row);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'rb-entry-ideas';
    button.className = 'es-btn es-btn--tertiary es-btn--sm';
    button.textContent = 'Brainstorm angles';
    button.addEventListener('click', () => {
      const trend = ctx.state.trend || null;
      const brief = ctx.els.brief && ctx.state.source === 'brief' ? ctx.els.brief.value.trim() : '';
      api.open({ trend: brief ? null : trend, topic: brief || (trend ? trend.title : ''), sport: (trend && trend.sport) || '' });
    });
    row.prepend(button);
  }

  function start(ctx) {
    if (!ctx || ctx.modules.ideas) return;
    const api = create(ctx);
    ctx.register('ideas', api);
    addEntry(ctx, api);
  }
  if (window.ReelMakerCtx) start(window.ReelMakerCtx);
  else document.addEventListener('reelmaker:ready', event => start(event.detail && event.detail.ctx), { once: true });
}());
