/*
 * Generate: the Creative look (composed designs, art-directed).
 *
 *   1. POST /api/es-generate { mode: 'creative', count }: the art director's
 *      directions (one per story / idea), each with 2-3 candidate scenes.
 *   2. Here: every candidate is drawn small (frameup-compose.js) and scored by
 *      the free heuristic check (text fit, phone size, contrast).
 *   3. POST { mode: 'creative-judge' } with the small JPEGs: the vision pass
 *      picks one per direction, writes the director's note and names at most
 *      one fix, which is applied here in code. No AI key: the heuristic picks.
 *   4. Cards: big preview (click = the focus view, generate-focus.js), one badge
 *      row (layout · On-brand · score), the name, the story, the director's
 *      note with "What could be better" (Apply), and one labelled toolbar:
 *      Open, Try another composition, Swap photo, Edit text, PNG, JPG.
 *
 * Every change to a design goes through commit(): a version in its history
 * (undo / redo / restore in the focus view), the card preview and the focus
 * view repaint, and a 'frameup:design-changed' event.
 *
 * Needs window.FrameUpGenerate (generate.html), window.FrameUpCompose and
 * window.FrameUpFocus (generate-focus.js).
 */
(function () {
  'use strict';

  const LOOK_KEY = 'frameup.generate.look.v1';
  const COUNT_KEY = 'frameup.generate.count.v1';
  const COUNTS = [1, 2, 4, 6, 8];
  const G = () => window.FrameUpGenerate;
  const C = () => window.FrameUpCompose;
  const F = () => window.FrameUpFocus;
  const U = () => window.FrameUpFocus?.util;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Lucide icons (ISC licence).
  const ICON = {
    shuffle: svg('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    type: svg('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    clapper: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    expand: svg('<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'),
    wand: svg('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>'),
    sparkles: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'),
    star: svg('<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>'),
    bulb: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  };

  let look = 'creative';
  try { look = localStorage.getItem(LOOK_KEY) === 'templates' ? 'templates' : 'creative'; } catch (error) { /* private mode */ }
  let count = 4;
  try { const saved = Number(localStorage.getItem(COUNT_KEY)); if (COUNTS.includes(saved)) count = saved; } catch (error) { /* private mode */ }
  const isOn = () => look === 'creative' && Boolean(C()) && Boolean(G());
  const state = { run: null, cards: [] };
  const registry = new Map(); // designId → card
  const money = value => `$${Number(value || 0).toFixed(value >= 0.1 ? 2 : 3)}`;
  const cleanStory = text => (U()?.cleanStory ? U().cleanStory(text) : String(text || '').replace(/^Story:\s*/i, ''));
  // How many designs this run makes: templates stop at 4 (the server cap there).
  const wanted = () => (look === 'templates' ? Math.min(count, 4) : count);
  // The cost per choice: Creative uses the assistant engine's costEstimate (the
  // same budget the server applies), shown as a range; templates one figure.
  const estLabel = n => {
    const range = U()?.estimateRange?.(n, look);
    if (range) return `${money(range.low)}–${money(range.high)}`;
    const est = U()?.estimateCost?.(n, look);
    return est != null ? money(est) : '';
  };

  // ── Look switch and the number of designs (in the composer) ───────────────
  function mountSwitch() {
    const steer = document.getElementById('gen-steer');
    if (!steer || document.getElementById('gen-look')) return;
    const group = document.createElement('div');
    group.className = 'gen-steer__group gen-look';
    group.innerHTML = `
      <span class="gen-row__label" id="gen-look-label">Look</span>
      <div class="es-segmented" id="gen-look" role="radiogroup" aria-labelledby="gen-look-label" aria-describedby="gen-look-hint">
        <button class="es-segmented__item" type="button" role="radio" data-look="creative">Creative<span class="gen-look__new" aria-hidden="true">New</span></button>
        <button class="es-segmented__item" type="button" role="radio" data-look="templates">ES templates</button>
      </div>
      <span class="gen-sr" id="gen-look-hint">Creative composes new designs (cut-outs, big numbers, layered type) and an art director picks the best of 2 to 3 compositions per idea. ES templates fills the standard templates.</span>`;
    steer.prepend(group);
    const chips = [...group.querySelectorAll('[data-look]')];
    const paint = () => {
      chips.forEach(chip => {
        const on = chip.dataset.look === look;
        chip.setAttribute('aria-checked', String(on));
        chip.tabIndex = on ? 0 : -1;
      });
      document.getElementById('gen-form')?.classList.toggle('is-creative', look === 'creative');
      paintCount();
    };
    const choose = (value, focus) => {
      look = value;
      try { localStorage.setItem(LOOK_KEY, look); } catch (error) { /* private mode */ }
      paint();
      if (focus) chips.find(chip => chip.dataset.look === look)?.focus();
    };
    group.addEventListener('click', event => {
      const chip = event.target.closest('[data-look]');
      if (chip) choose(chip.dataset.look);
    });
    group.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const i = chips.findIndex(chip => chip.dataset.look === look);
      const next = chips[(i + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + chips.length) % chips.length];
      choose(next.dataset.look, true);
    });
    mountCount();
    paint();
  }

  // "Designs 1 2 4 6 8 · est. $0.14" in the composer's action bar.
  function mountCount() {
    const expect = document.getElementById('gen-expect');
    if (!expect || document.getElementById('gen-count')) return;
    expect.classList.add('gen-count-wrap');
    expect.innerHTML = `
      <span class="gen-row__label" id="gen-count-label">Designs</span>
      <div class="es-segmented gen-count" id="gen-count" role="radiogroup" aria-labelledby="gen-count-label" aria-describedby="gen-count-cost">
        ${COUNTS.map(n => `<button type="button" role="radio" class="es-segmented__item gen-count__item" data-count="${n}" aria-checked="false">${n}</button>`).join('')}
      </div>
      <span class="gen-count__cost" id="gen-count-cost" aria-live="polite"></span>`;
    const items = [...expect.querySelectorAll('[data-count]')];
    const choose = (n, focus) => {
      count = n;
      try { localStorage.setItem(COUNT_KEY, String(n)); } catch (error) { /* private mode */ }
      paintCount();
      if (focus) expect.querySelector(`[data-count="${n}"]`)?.focus();
    };
    expect.addEventListener('click', event => {
      const b = event.target.closest('[data-count]');
      if (b && !b.disabled) choose(Number(b.dataset.count));
    });
    expect.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !event.target.closest('[data-count]')) return;
      event.preventDefault();
      const enabled = items.filter(b => !b.disabled).map(b => Number(b.dataset.count));
      const i = enabled.indexOf(wanted());
      choose(enabled[(i + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length], true);
    });
    // Hover / focus previews that choice's cost.
    const preview = n => {
      const est = estLabel(n);
      const cost = document.getElementById('gen-count-cost');
      if (cost && est) cost.innerHTML = `<span class="gen-sr">Estimated AI cost for ${n} design${n === 1 ? '' : 's'}: </span>est. ${est}<span class="gen-count__per" aria-hidden="true"> · ${look === 'creative' ? 'art-directed' : 'templates'}</span>`;
    };
    expect.addEventListener('pointerover', event => { const b = event.target.closest('[data-count]'); if (b && !b.disabled) preview(Number(b.dataset.count)); });
    expect.addEventListener('pointerleave', () => preview(wanted()));
    expect.addEventListener('focusin', event => { const b = event.target.closest('[data-count]'); if (b) preview(Number(b.dataset.count)); });
    expect.addEventListener('focusout', () => preview(wanted()));
    expect._preview = preview;
  }
  function paintCount() {
    const expect = document.getElementById('gen-expect');
    if (!expect) return;
    const n = wanted();
    expect.querySelectorAll('[data-count]').forEach(b => {
      const value = Number(b.dataset.count);
      const off = look === 'templates' && value > 4;
      b.disabled = off;
      b.title = off ? 'ES templates make up to 4 designs' : `${value} design${value === 1 ? '' : 's'} · est. ${estLabel(value)}`;
      b.setAttribute('aria-checked', String(value === n));
      b.tabIndex = value === n ? 0 : -1;
    });
    expect._preview?.(n);
  }

  // ── Rendering helpers ────────────────────────────────────────────────────
  async function small(scene) {
    return C().toDataUrl(scene, { width: 360, quality: 0.8 });
  }
  async function preview(card) {
    const media = card.querySelector('.gen-cc__media');
    const img = media.querySelector('img');
    const token = (card._previewToken = (card._previewToken || 0) + 1);
    media.classList.add('is-busy');
    try {
      const { dataUrl, report } = await C().toDataUrl(card._scene, { width: 720, quality: 0.9 });
      if (token !== card._previewToken) return;
      img.src = dataUrl;
      card._thumb = dataUrl;
      card._report = report;
      card.classList.remove('is-failed');
      const missing = report.missing?.length;
      const warn = card.querySelector('.gen-cc__warn');
      warn.hidden = !missing;
      warn.textContent = missing ? 'An image did not load; swap the photo or try another composition.' : '';
      paintCritique(card);
    } catch (error) {
      card.classList.add('is-failed');
    } finally {
      if (token === card._previewToken) {
        media.classList.remove('is-busy');
        media.classList.add('is-ready');
      }
    }
  }

  const textEl = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    return el;
  };

  function skeleton() {
    const card = document.createElement('article');
    card.className = 'gen-card gen-cc is-skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<div class="gen-cc__media"></div><div class="gen-card__body"><span class="es-skeleton"></span><span class="es-skeleton"></span><span class="es-skeleton"></span></div>';
    return card;
  }

  // One toolbar: icon over a short label; the full action in the tooltip.
  const tool = (act, icon, label, tip, extra = '') => `<button class="gen-tool" type="button" data-cc="${act}" aria-label="${tip}" data-tip="${tip}" ${extra}>${icon}<span>${label}</span></button>`;

  function buildCard(dir, verdict) {
    const card = document.createElement('article');
    card.className = 'gen-card gen-cc';
    card.innerHTML = `
      <button class="gen-cc__media" type="button" data-cc="open"><img alt=""><span class="gen-cc__open" aria-hidden="true">${ICON.expand}Open</span></button>
      <div class="gen-card__body">
        <div class="gen-cc__badges">
          <span class="gen-card__type"></span>
          <span class="gen-card__guide">${ICON.check}<span>On-brand</span></span>
          <span class="gen-cc__score" hidden></span>
        </div>
        <div class="gen-cc__titles">
          <h3 class="gen-cc__name"></h3>
          <p class="gen-cc__story"></p>
        </div>
        <details class="gen-cc__director">
          <summary><span class="gen-cc__who">${ICON.clapper}Director</span><span class="gen-cc__lede"></span><span class="gen-cc__more" hidden></span><span class="gen-cc__chev" aria-hidden="true">${ICON.chevron}</span></summary>
          <div class="gen-cc__crit">
            <p class="gen-cc__note-text"></p>
            <ul class="gen-cc__good" hidden></ul>
            <div class="gen-cc__better" hidden><p class="gen-cc__eyebrow">What could be better</p><ul></ul></div>
            <p class="gen-cc__next" hidden></p>
          </div>
        </details>
        <p class="gen-cc__warn" hidden></p>
        <p class="gen-card__source gen-cc__source" hidden>Source: <a target="_blank" rel="noopener"></a></p>
        <div class="gen-cc__bar" role="toolbar" aria-label="Design actions">
          ${tool('open', ICON.expand, 'Open', 'Open the design to edit with AI')}
          ${tool('another', ICON.shuffle, 'Shuffle', 'Try another composition')}
          ${tool('photos', ICON.image, 'Photo', 'Swap photo', 'aria-expanded="false"')}
          ${tool('text', ICON.type, 'Text', 'Edit text', 'aria-expanded="false"')}
          <span class="gen-cc__bar-sep" aria-hidden="true"></span>
          ${tool('download', ICON.download, 'PNG', 'Download PNG (1080)')}
          ${tool('jpeg', ICON.download, 'JPG', 'Download JPEG (1080)')}
        </div>
        <div class="gen-cc__panel gen-cc__photos" hidden></div>
        <form class="gen-cc__panel gen-cc__text" hidden></form>
      </div>`;
    card._dir = dir;
    card._verdict = verdict || {};
    card._index = Math.max(0, dir.candidates.findIndex(s => s.id === verdict?.best));
    card._scene = verdict?.scene || dir.candidates[card._index];
    card._designId = U()?.designIdFor ? U().designIdFor(state.run?.plan?.runId, dir.id) : `run-${dir.id}`;
    card.dataset.designId = card._designId;
    card._history = U()?.History ? new (U().History)(card._scene, 'Original') : null;
    registry.set(card._designId, card);
    // gen-brain: one critique ("what could be better") for the card, the
    // focus view and the assistant, so Apply ids match everywhere.
    const A = window.FrameUpAssistant;
    card._critique = A?.designCritique ? A.designCritique(dir.critique, verdict?.critique, card._scene) : null;
    // The assistant changes this design only through C's commit() (one history).
    A?.register?.(card._designId, { getScene: () => card._scene, setScene: (scene, meta) => design(card._designId)?.setScene(scene, meta), runId: state.run?.plan?.runId || '', critique: card._critique });
    fill(card);
    return card;
  }

  function fill(card) {
    const dir = card._dir;
    const scene = card._scene;
    const layout = scene.archetypeName || dir.archetypeName;
    card.querySelector('.gen-card__type').textContent = layout;
    card.querySelector('.gen-cc__name').textContent = dir.name || dir.archetypeName;
    const story = cleanStory(dir.storyText);
    const storyEl = card.querySelector('.gen-cc__story');
    storyEl.textContent = story;
    storyEl.hidden = !story;
    storyEl.title = story;
    const guide = card.querySelector('.gen-card__guide');
    const fixes = (scene.guideline?.fixes || []).map(f => f.what);
    guide.title = fixes.length ? `Passed the ES guideline check after: ${fixes.join('; ')}` : 'Passed the ES guideline check for composed designs';
    const score = card.querySelector('.gen-cc__score');
    const total = scoreOf(card)?.total;
    score.hidden = !total;
    score.innerHTML = total ? `${ICON.star}<span>${Number(total).toFixed(1)}</span><span class="gen-cc__of">/5</span>` : '';
    score.title = card._verdict.source === 'vision' ? 'Art director score (vision), out of 5' : 'Quick check score (no AI), out of 5';
    const cited = (dir.cited || []).find(c => /^https?:\/\//.test(c.url));
    const source = card.querySelector('.gen-cc__source');
    source.hidden = !cited;
    if (cited) {
      const a = source.querySelector('a');
      a.href = cited.url;
      a.textContent = cited.title || cited.url;
    }
    // Swap photo only where a photo or cut-out is on the design (not concept art).
    card.querySelector('[data-cc="photos"]').hidden = !(dir.photos || []).length || !(C().mainPhoto(scene) || scene.layers.some(l => l.type === 'cutout'));
    card.querySelector('[data-cc="another"]').disabled = dir.candidates.length < 2;
    const label = `${layout}: ${C().editableText(scene).map(t => t.text).join(' · ')}`;
    card.querySelector('img').alt = label;
    const media = card.querySelector('.gen-cc__media');
    media.setAttribute('aria-label', `Open ${dir.name || layout} to edit`);
    // The card shows the whole design at any size (4:5, 9:16, 1:1).
    media.style.aspectRatio = `${scene.size?.w || 1080} / ${scene.size?.h || 1350}`;
    paintCritique(card);
  }

  function scoreOf(card) {
    const s = card._verdict.scores?.[card._scene.id];
    if (!s) return null;
    const parts = {};
    ['hierarchy', 'focal', 'readability', 'brand', 'originality'].forEach(k => { if (Number.isFinite(Number(s[k]))) parts[k] = Number(s[k]); });
    return { total: s.total, parts: Object.keys(parts).length ? parts : null, source: card._verdict.source };
  }
  const noteOf = card => {
    const scene = card._scene;
    const note = card._verdict.note || card._dir.note || '';
    return `${note}${scene.fixApplied ? `${note ? ' ' : ''}Fix applied: ${scene.fixApplied.replace(/-/g, ' ')}.` : ''}`.trim();
  };
  // card._critique is gen-brain's merged critique (director + judge, ids i1..),
  // the same object the assistant holds, so Apply ids match on both sides.
  const critiqueOf = card => (U()?.critiqueFor ? U().critiqueFor({ verdict: { ...card._verdict, critique: card._critique || card._verdict.critique }, dir: card._dir, scene: card._scene, report: card._report }) : { source: 'quick', strengths: [], improvements: [], nextTime: '' });
  // A fix the composer can apply here, free: { op:'fix', name } (gen-brain) or
  // a bare { op:'<fix>' } (the quick check).
  const localFix = fix => { const name = fix?.op === 'fix' ? fix.name : fix?.op; return name && C()?.FIXES?.includes(name) ? name : ''; };

  // The director's note, collapsed to one line; open: what works, what could
  // be better (each with Apply), and the lesson for next time.
  function paintCritique(card) {
    const note = noteOf(card);
    const crit = critiqueOf(card);
    card.querySelector('.gen-cc__lede').textContent = note || (crit.improvements[0]?.text ?? 'No notes on this version.');
    card.querySelector('.gen-cc__note-text').textContent = note;
    card.querySelector('.gen-cc__note-text').hidden = !note;
    const more = card.querySelector('.gen-cc__more');
    const toImprove = crit.improvements.filter(i => !isApplied(card, i.id)).length;
    more.hidden = !toImprove;
    more.textContent = toImprove ? `${toImprove} to improve` : '';
    const good = card.querySelector('.gen-cc__good');
    good.hidden = !crit.strengths.length;
    good.innerHTML = crit.strengths.map(s => `<li>${ICON.check}<span>${G().esc(s)}</span></li>`).join('');
    const better = card.querySelector('.gen-cc__better');
    better.hidden = !crit.improvements.length;
    better.querySelector('.gen-cc__eyebrow').textContent = crit.source === 'quick' ? 'What could be better · quick check' : 'What could be better';
    const viaAssistant = typeof window.FrameUpAssistant?.applyImprovement === 'function';
    better.querySelector('ul').innerHTML = crit.improvements.map(i => {
      const local = localFix(i.fix);
      const button = viaAssistant || local
        ? `<button class="gen-cc__apply" type="button" data-cc="apply" data-id="${G().esc(i.id)}" title="${viaAssistant ? 'The AI assistant makes this change' : 'Apply the fix'}">${ICON.wand}Apply</button>`
        : `<button class="gen-cc__apply" type="button" data-cc="ask" data-id="${G().esc(i.id)}" title="Open the design and ask the AI assistant">${ICON.sparkles}Ask AI</button>`;
      const done = isApplied(card, i.id) ? `<span class="gen-cc__applied">${ICON.check}Applied</span>` : '';
      return `<li${done ? ' class="is-applied"' : ''}><span>${G().esc(i.text)}</span>${done || button}</li>`;
    }).join('');
    const next = card.querySelector('.gen-cc__next');
    next.hidden = !crit.nextTime;
    next.innerHTML = crit.nextTime ? `${ICON.bulb}<span><b>Next time</b> ${G().esc(crit.nextTime)}</span>` : '';
    const details = card.querySelector('.gen-cc__director');
    details.hidden = !note && !crit.improvements.length && !crit.strengths.length;
  }

  // ── Every change goes through here ───────────────────────────────────────
  const LABELS = { another: 'Another composition', photo: 'Swapped photo', text: 'Edited text', size: 'Changed size', fix: 'Applied fix', assistant: 'AI assistant', undo: 'Undo', redo: 'Redo', restore: 'Restored' };
  async function commit(card, scene, { label = '', source = 'edit', record = true, coalesce = false } = {}) {
    if (!scene || !Array.isArray(scene.layers)) return false;
    card._scene = scene;
    if (record && card._history) card._history.push(scene, label || LABELS[source] || 'Edit', source, { coalesce });
    fill(card);
    const done = preview(card);
    F()?.refresh?.(card._designId, { parts: source === 'text' ? 'text' : 'all' });
    document.dispatchEvent(new CustomEvent('frameup:design-changed', { detail: { designId: card._designId, scene, label: label || LABELS[source] || 'Edit', source, origin: 'generate' } }));
    await done;
    return true;
  }

  // Numbers stay facts: a typed digit that is not on the design is refused.
  function digitError(card, value) {
    const first = card._history?.entries?.[0]?.scene || card._scene;
    const facts = new Set([first, card._scene].flatMap(s => s.layers).flatMap(l => String(`${l.text || ''} ${l.value || ''} ${l.label || ''}`).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []));
    (card._scene.facts || []).forEach(f => String(f.text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.forEach(d => facts.add(d)));
    const stray = (String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).filter(d => !facts.has(d));
    return stray.length ? `Numbers must come from the brief (${stray.join(', ')} is not).` : '';
  }

  // An applied improvement shows "Applied" (not a second Apply) while the
  // version it made is current or behind the current one; undo brings Apply back.
  function isApplied(card, id) {
    const h = card._history;
    const entry = card._applied?.get(id);
    if (!h || !entry) return false;
    const at = h.entries.indexOf(entry);
    return at > 0 && at <= h.index;
  }
  function markApplied(card, id) {
    const h = card._history;
    if (!h) return;
    (card._applied ||= new Map()).set(id, h.entries[h.index]);
    paintCritique(card);
    F()?.refresh?.(card._designId, { parts: 'all' });
  }

  async function applyImprovement(card, id) {
    const crit = critiqueOf(card);
    const item = crit.improvements.find(i => i.id === id);
    if (!item) return false;
    if (typeof window.FrameUpAssistant?.applyImprovement === 'function') {
      try {
        // The assistant changes the design through design(id).setScene, so the
        // version lands in this card's History once.
        const res = await window.FrameUpAssistant.applyImprovement(card._designId, id);
        if (res?.ok !== false) {
          G().track('fix_applied', { runId: state.run?.plan?.runId, directionId: card._dir.id, payload: { id, text: item.text, via: 'assistant', cost: res?.cost || 0 } });
          markApplied(card, id);
          return true;
        }
        if (!localFix(item.fix)) { G().setNotice('Could not apply that', ` ${res?.reply || 'The assistant could not make that change.'}`); return false; }
      } catch (error) {
        if (!localFix(item.fix)) { G().setNotice('Could not apply that', ` ${error?.message || 'The assistant did not answer.'}`); return false; }
      }
    }
    const name = localFix(item.fix);
    if (name) {
      await commit(card, C().applyFix(card._scene, name), { label: `Fix: ${item.text}`, source: 'fix' });
      G().track('fix_applied', { runId: state.run?.plan?.runId, directionId: card._dir.id, payload: { id, text: item.text, fix: name, via: 'local' } });
      markApplied(card, id);
      return true;
    }
    return false;
  }

  // The facts a version may show: the scene's, the direction's input, and every
  // digit already on the original (so a checked edit is never refused for them).
  function factsFor(card) {
    const first = card._history?.entries?.[0]?.scene || card._scene;
    const onDesign = first.layers.map(l => `${l.prefix || ''}${l.value || ''}${l.suffix || ''} ${l.label || ''} ${l.text || ''}`).join(' ');
    return [...(card._scene.facts || []), ...(card._dir.input?.facts || []), { id: 'on-design', text: onDesign }];
  }
  // Composer input for a rebuild: the server's input for this direction, with
  // the current version's copy, photo and palette when they were edited.
  function inputFor(card) {
    const base = card._scene.input || card._dir.input || null;
    if (!base) return null;
    const A = window.FrameUpAssistant;
    const first = card._history?.entries?.[0]?.scene;
    if (!A?.inputsFromScene || !first || JSON.stringify(first) === JSON.stringify(card._scene)) return base;
    const was = A.inputsFromScene(first);
    const now = A.inputsFromScene(card._scene);
    const out = { ...base };
    ['kicker', 'headline', 'body', 'name'].forEach(k => { if (now[k] !== was[k]) { out[k] = now[k]; if (k === 'headline') out.highlight = []; } });
    if (now.photo?.src && now.photo.src !== was.photo?.src) out.photo = now.photo;
    if (now.cutout?.src !== was.cutout?.src) out.cutout = now.cutout;
    if (JSON.stringify(now.palette) !== JSON.stringify(was.palette)) out.palette = now.palette;
    return out;
  }

  // The design as the focus view and the assistant see it.
  function design(designId) {
    const card = registry.get(designId);
    if (!card || !card.isConnected) return null;
    return {
      designId,
      runId: state.run?.plan?.runId || '',
      card,
      title: card._dir.name || card._dir.archetypeName,
      layout: card._scene.archetypeName || card._dir.archetypeName,
      note: noteOf(card),
      source: (card._dir.cited || []).find(c => /^https?:\/\//.test(c.url)) || null,
      history: card._history,
      thumb: () => card._thumb || card.querySelector('.gen-cc__media img')?.src || '',
      getScene: () => card._scene,
      // The assistant (and anything else) sets a new scene here; it is checked
      // against the ES gate first, so a patch can never break the guidelines.
      setScene: (scene, meta = {}) => {
        const checked = C().checkScene?.(scene, { facts: factsFor(card) });
        if (checked && !checked.ok) throw new Error(checked.errors?.[0]?.msg || 'That change breaks the ES guidelines.');
        return commit(card, checked?.scene || scene, { label: meta.label || 'AI assistant', source: meta.source || 'assistant' });
      },
      critique: () => critiqueOf(card),
      score: () => scoreOf(card),
      photos: () => card._dir.photos || [],
      checkDigits: value => digitError(card, value),
      setText: (index, text) => commit(card, C().setText(card._scene, index, text), { label: 'Edited text', source: 'text', coalesce: true }),
      swapPhoto: index => {
        const photo = card._dir.photos?.[index];
        if (!photo) return false;
        return commit(card, C().swapPhoto(card._scene, { from: C().mainPhoto(card._scene), to: photo.src, cutout: photo.cutout || '' }), { label: 'Swapped photo', source: 'photo' });
      },
      resize: key => {
        // Built from its inputs when the server sends them (plan.directions[].input),
        // with this version's edits on top (text, photo, palette: the assistant
        // engine reads them off the scene); otherwise reframed.
        const input = inputFor(card);
        let next = null;
        try { next = input && C().build && C().fits?.(card._scene.archetype, { ...input, size: key }) !== false ? C().build(card._scene.archetype, { ...input, size: key }, card._scene.variant || 0) : U().reframe(card._scene, key); } catch (error) { next = null; }
        if (!next) { try { next = U().reframe(card._scene, key); } catch (error) { next = null; } }
        if (!next) return false;
        next.id = card._scene.id;
        if (!next.facts?.length) next.facts = card._scene.facts;
        const checked = C().checkScene?.(next, { facts: factsFor(card) });
        if (checked && !checked.ok) return false;
        const names = { portrait: '4:5 · 1080 × 1350', story: '9:16 · 1080 × 1920', square: '1:1 · 1080 × 1080' };
        commit(card, checked?.scene || next, { label: `Size ${names[key] || key}`, source: 'size' });
        return true;
      },
      undo: () => (card._history?.canUndo ? commit(card, card._history.undo(), { record: false, source: 'undo' }) : false),
      redo: () => (card._history?.canRedo ? commit(card, card._history.redo(), { record: false, source: 'redo' }) : false),
      restore: i => (card._history ? commit(card, card._history.restore(i), { record: false, source: 'restore' }) : false),
      applyImprovement: id => applyImprovement(card, id),
      isApplied: id => isApplied(card, id),
      export: type => exportCard(card, type),
      openInEditor: typeof window.FrameUpCompose?.openInEditor === 'function' ? () => window.FrameUpCompose.openInEditor(card._scene) : undefined,
    };
  }
  const designs = () => state.cards.filter(c => c.isConnected).map(c => design(c._designId)).filter(Boolean);

  // The assistant's own changes (when it does not go through setScene).
  document.addEventListener('frameup:design-changed', event => {
    const d = event.detail || {};
    if (d.origin === 'generate') return;
    const card = registry.get(d.designId);
    if (!card) return;
    if (d.scene && Array.isArray(d.scene.layers)) commit(card, d.scene, { label: d.label || 'AI assistant', source: 'assistant' });
    else { fill(card); preview(card); F()?.refresh?.(card._designId); }
  });

  function openFocus(card, tab = '') {
    if (!F()?.open) return;
    F().open(card._designId, { tab, opener: card.querySelector('.gen-cc__media') });
  }

  // ── The run ──────────────────────────────────────────────────────────────
  async function run(brief) {
    const g = G();
    if (!g || g.isBusy()) return;
    const { els } = g;
    const n = wanted();
    g.setBusy(true);
    g.setNotice('');
    els.empty.hidden = true;
    els.research.hidden = true;
    F()?.close?.();
    document.getElementById('gen-setbar')?.setAttribute('hidden', '');
    els.grid.replaceChildren(...Array.from({ length: n }, skeleton));
    els.grid.setAttribute('aria-busy', 'true');
    const progress = g.startProgress(['Reading ES coverage', 'Art director planning', 'Composing candidates', 'Art director judging'], [2400, 9000]);
    // The editor frame records exports in the Gallery; load it while we work.
    g.renderer?.().catch(() => {});
    try {
      const plan = await g.callApi('/api/es-generate', { mode: 'creative', brief, count: n, steer: g.steer() });
      if (!plan?.directions?.length) {
        progress.stop();
        els.grid.replaceChildren();
        // Never leave someone empty-handed: Generate falls back to ES templates.
        return 'fallback';
      }
      // Imagery v3: cut out the hero subject(s) in the browser before composing.
      await addCutouts(plan);
      progress.designing?.();
      // Every candidate small, with the free check.
      const sets = [];
      const heuristics = {};
      for (const dir of plan.directions) {
        const items = [];
        for (const scene of dir.candidates) {
          const { dataUrl, report } = await small(scene);
          heuristics[scene.id] = { score: report.heuristic.score, fix: report.heuristic.fix };
          items.push({ id: scene.id, image: dataUrl });
        }
        sets.push({ direction: dir.id, archetype: dir.archetype, items });
      }
      let judged = { directions: [], cost: 0, source: 'heuristic' };
      try {
        judged = await g.callApi('/api/es-generate', { mode: 'creative-judge', brief, runId: plan.runId, sport: plan.read?.sport || '', sets, heuristics });
      } catch (error) { /* the heuristic picks below */ }
      state.run = { brief, plan, judged };
      registry.clear();
      const cards = plan.directions.map(dir => {
        const verdict = (judged.directions || []).find(v => v.id === dir.id) || {};
        const ranked = [...dir.candidates].sort((a, b) => (heuristics[b.id]?.score || 0) - (heuristics[a.id]?.score || 0));
        const best = dir.candidates.find(s => s.id === verdict.best) || ranked[0];
        const fix = verdict.fix || (judged.source !== 'vision' ? heuristics[best.id]?.fix : '');
        const scene = fix ? C().applyFix(best, fix) : best;
        return buildCard(dir, { ...verdict, best: best.id, scene, source: judged.source, scores: verdict.scores || Object.fromEntries(dir.candidates.map(s => [s.id, { total: heuristics[s.id]?.score }])) });
      });
      state.cards = cards;
      els.grid.replaceChildren(...cards);
      for (const card of cards) await preview(card);
      const seconds = progress.stop();
      g.rememberBrief?.(brief);
      window.FrameUpPosted?.markGenerateRun?.({ count: cards.length, format: 'creative' });
      const cost = (plan.cost?.total || 0) + (judged.cost || 0);
      const composed = plan.directions.reduce((k, d) => k + d.candidates.length, 0);
      const fewer = cards.length < n ? ` <span class="gen-summary__muted">(asked for ${n}; the brief had ${cards.length} strong idea${cards.length === 1 ? '' : 's'})</span>` : '';
      g.setSummary(`<span class="gen-mode is-ai">Creative</span><span class="gen-mode">${judged.source === 'vision' ? 'Art director · vision' : 'Quick check'}</span><span><strong>${cards.length} design${cards.length === 1 ? '' : 's'}</strong> from ${composed} compositions · ${Math.max(1, Math.round(seconds))}s · ${plan.cached ? 'cached' : money(cost)}${fewer}</span><span class="gen-summary__hint">Click a design to open it</span>`);
      renderDropped(plan);
      if (plan.research?.articles) g.showResearch(plan.research.articles);
      g.track('generate_run', { runId: plan.runId, payload: { look: 'creative', designs: cards.length, asked: n, cost, judge: judged.source } });
    } catch (error) {
      progress.stop();
      els.grid.replaceChildren();
      // A limit or switched-off reply is shown as is; any other failure falls
      // back to ES templates so Generate always produces something.
      if (error?.status === 429 || error?.status === 503 || /limit|budget|switched off/i.test(String(error?.message || ''))) {
        els.empty.hidden = false;
        g.setNotice('Could not compose designs', ` ${error.message || 'Something went wrong.'} Your brief is still here.`, '', { label: 'Try again', run: () => run(brief) });
        return 'stop';
      }
      return 'fallback';
    } finally {
      els.grid.removeAttribute('aria-busy');
      g.setBusy(false);
      g.restoreFocus(els.grid.querySelector('.gen-cc .gen-cc__media') || els.submit);
    }
  }

  // ── Imagery v3: cut-outs the plan asked for (plan.imagery.cutoutPlan) ──────
  // Made here because only the browser can keep the photo's original pixels
  // (FrameUpAssets: AI mask, alignment checks, shared store so the next run gets
  // them at $0). Each direction of that person without a cut-out is rebuilt from
  // its input with the cut-out, through the same ES gate as the server. Photo /
  // cut-out preparation only: archetypes and layout are the composer's.
  // Without a server plan: each named person's lead photo (one per person, 3 at
  // most), never a team, crowd, venue or object photo, never one already cut out.
  function cutoutPlanFrom(plan) {
    const out = [];
    (plan?.directions || []).forEach(dir => {
      const photo = dir.photo;
      const person = photo?.person || '';
      const kind = String(dir.input?.photo?.kind || '');
      if (!person || !photo?.src || dir.input?.cutout || ['crowd', 'venue', 'object'].includes(kind)) return;
      if ((plan.read?.teams || []).some(t => t.name === person)) return;
      if (out.some(item => item.person === person) || out.length >= 3) return;
      const match = String(photo.src).match(/[?&]image=([^&]+)/);
      const sourceUrl = match ? decodeURIComponent(match[1]) : (/^https:\/\//.test(photo.src) ? photo.src : '');
      if (sourceUrl) out.push({ fromPhoto: photo.src, sourceUrl, person });
    });
    return out;
  }

  async function addCutouts(plan) {
    const items = plan?.imagery?.cutoutPlan?.length ? plan.imagery.cutoutPlan : cutoutPlanFrom(plan);
    const A = window.FrameUpAssets;
    if (!items.length || !A?.prepareCutouts || !C()?.candidates) return;
    let made;
    try { made = await A.prepareCutouts(items, { max: 3 }); } catch (error) { return; }
    plan.imagery.cutoutCost = made.cost || 0;
    if (plan.cost) plan.cost.total = Number(((plan.cost.total || 0) + (made.cost || 0)).toFixed(5));
    if (!made.cutouts?.length) return;
    const contract = made.cutouts.map(({ url, width, height, person, fromPhoto }) => ({ url, src: url, width, height, person, fromPhoto }));
    plan.directions.forEach(dir => {
      const person = dir.photo?.person || dir.input?.name || '';
      const mine = contract.filter(c => c.person && c.person === person);
      (dir.photos || []).forEach(p => { const hit = contract.find(c => c.fromPhoto === p.src); if (hit && !p.cutout) p.cutout = hit.url; });
      if (!mine.length || !dir.input || dir.input.cutout) return;
      const cut = mine.find(c => c.fromPhoto === dir.photo?.src) || mine[0];
      const input = { ...dir.input, cutout: { src: cut.url }, cutouts: mine };
      let rebuilt = [];
      try {
        rebuilt = C().candidates(dir.archetype, input, Math.max(2, dir.candidates.length))
          .filter(scene => C().checkScene(scene, { facts: input.facts }).ok);
      } catch (error) { rebuilt = []; }
      dir.input = input;
      if (!rebuilt.some(scene => scene.layers?.some(l => l.type === 'cutout'))) return;
      const was = dir.candidates[0] || {};
      dir.candidates = rebuilt.map((scene, i) => {
        const checked = C().checkScene(scene, { facts: input.facts });
        return Object.assign(scene, { id: `${dir.id}c${i + 1}`, ...(was.extra ? { extra: was.extra } : {}), guideline: { ok: true, fixes: (checked.fixes || []).map(({ rule, what }) => ({ rule, what })), version: was.guideline?.version } });
      });
      dir.cutout = { src: cut.url };
    });
  }

  // Ideas the director had that code dropped (off-brief, invented numbers...).
  function renderDropped(plan) {
    const list = (plan.dropped || []).filter(d => d.why);
    if (!list.length) return;
    const box = document.createElement('details');
    box.className = 'gen-cc__dropped';
    box.append(textEl('summary', '', `${list.length} idea${list.length === 1 ? '' : 's'} left out by the fact check`));
    const ul = document.createElement('ul');
    list.forEach(d => ul.append(textEl('li', '', `${d.headline ? `“${d.headline}”` : d.archetype}: ${d.why}`)));
    box.append(ul);
    G().els.grid.append(box);
  }

  // ── Card actions ─────────────────────────────────────────────────────────
  async function exportCard(card, type) {
    const scene = card._scene;
    const canvas = document.createElement('canvas');
    const started = performance.now();
    await C().render(scene, canvas, { scale: 1 });
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed.'))), type, type === 'image/jpeg' ? 0.92 : undefined));
    const slug = String(card._dir.name || scene.archetype).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'frameup';
    const filename = `frameup-${slug}-${scene.size.w}x${scene.size.h}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    G().setSummary(`<span><strong>${type === 'image/jpeg' ? 'JPEG' : 'PNG'} downloaded</strong> · ${scene.size.w} × ${scene.size.h}</span>`);
    // Gallery record (the editor frame has dashboard-data.js loaded).
    try {
      await Promise.race([G().renderer?.(), new Promise(resolve => setTimeout(resolve, 8000))]).catch(() => {});
      const frame = G().rendererFrame?.() || document.querySelector('iframe.gen-renderer');
      const data = frame?.contentWindow?.ESDashboardData || window.ESDashboardData;
      const thumb = await C().toDataUrl(scene, { width: 270, quality: 0.72 });
      await data?.recordDesignExport?.({
        workspace: 'instagram', workspaceVariant: `creative-${scene.archetype}`, title: C().editableText(scene).find(t => t.role === 'headline')?.text || card._dir.name,
        sport: state.run?.plan?.read?.sport || '', filename, imageWidth: canvas.width, imageHeight: canvas.height, mimeType: type,
        previewDataUrl: thumb.dataUrl, durationMs: performance.now() - started,
        metadata: { generated: { source: 'generate-creative', runId: state.run?.plan?.runId, archetype: scene.archetype, brief: (state.run?.brief || '').slice(0, 300), versions: card._history?.entries.length || 1 } },
      });
    } catch (error) { /* the download still happened */ }
    window.FrameUpPosted?.exported?.({ source: 'generate', title: card._dir.name || scene.archetypeName, template: `Creative · ${scene.archetypeName}`, style: scene.archetype, brand: 'essentiallysports', aiMade: 'generate' });
    G().track('design_exported', { runId: state.run?.plan?.runId, directionId: card._dir.id, postType: `creative:${scene.archetype}`, payload: { look: 'creative', fix: scene.fixApplied || '', versions: card._history?.entries.length || 1, size: `${scene.size.w}x${scene.size.h}` } });
    window.FrameUpAssistant?.signal?.('export', card._designId);
  }

  function photosPanel(card) {
    const panel = card.querySelector('.gen-cc__photos');
    const dir = card._dir;
    const current = C().mainPhoto(card._scene) || card._scene.layers.find(l => l.type === 'cutout')?.src || '';
    panel.innerHTML = `<span class="gen-photos__label">ES photos</span><div class="gen-photos__strip">${(dir.photos || []).map((p, i) => `<button class="gen-thumb" type="button" data-cc="pick" data-index="${i}" aria-pressed="${p.src === current || p.cutout === current}" aria-label="${G().esc(`ES photo ${i + 1}${p.person ? ` of ${p.person}` : ''}`)}"><img src="${G().esc(p.src)}" alt="" loading="lazy"></button>`).join('')}</div><p class="gen-photos__hint">Cut-outs stay with their own photo; a swapped photo fills the photo slots.</p>`;
  }

  function textPanel(card) {
    const form = card.querySelector('.gen-cc__text');
    const fields = C().editableText(card._scene);
    form.innerHTML = fields.map(f => `<label class="es-field gen-cc__field"><span>${G().esc(f.role.charAt(0).toUpperCase() + f.role.slice(1))}</span><input type="text" maxlength="160" data-index="${f.index}" value="${G().esc(f.text)}"></label>`).join('') || '<p class="gen-photos__hint">This composition has no editable text.</p>';
  }

  let typing = null;
  document.addEventListener('input', event => {
    const input = event.target.closest?.('.gen-cc__text input');
    if (!input) return;
    const card = input.closest('.gen-cc');
    const err = digitError(card, input.value);
    input.setCustomValidity(err);
    input.reportValidity();
    if (err) return;
    clearTimeout(typing);
    typing = setTimeout(() => {
      const before = C().editableText(card._scene).find(f => f.index === Number(input.dataset.index))?.text || '';
      commit(card, C().setText(card._scene, Number(input.dataset.index), input.value), { label: 'Edited text', source: 'text', coalesce: true });
      // gen-brain learning signal: one 'edit' per typing burst.
      clearTimeout(card._editSignal);
      if (card._editBefore == null) card._editBefore = before;
      card._editSignal = setTimeout(() => {
        window.FrameUpAssistant?.signal?.('edit', card._designId, { before: card._editBefore, after: input.value });
        card._editBefore = null;
      }, 4000);
    }, 250);
  });
  document.addEventListener('submit', event => {
    if (event.target.closest?.('.gen-cc__text')) event.preventDefault();
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-cc]');
    const card = button?.closest('.gen-cc');
    if (!card || button.disabled || card.classList.contains('is-skeleton')) return;
    const act = button.dataset.cc;
    if (act === 'open') {
      openFocus(card);
    } else if (act === 'download' || act === 'jpeg') {
      button.disabled = true;
      try {
        await exportCard(card, act === 'jpeg' ? 'image/jpeg' : 'image/png');
      } catch (error) {
        G().setNotice('Download failed', ` ${error.message || ''}`);
      } finally {
        setTimeout(() => { button.disabled = false; }, 800);
      }
    } else if (act === 'another') {
      // The next candidate (the art director ranked them); then the palette flip.
      const dir = card._dir;
      card._index = (card._index + 1) % (dir.candidates.length + 1);
      const next = card._index < dir.candidates.length ? dir.candidates[card._index] : C().applyFix(dir.candidates[0], 'swap-palette');
      await commit(card, next, { label: card._index < dir.candidates.length ? `Composition ${card._index + 1} of ${dir.candidates.length}` : 'Palette flip', source: 'another' });
      G().track('direction_more', { runId: state.run?.plan?.runId, directionId: dir.id, payload: { look: 'creative', candidate: card._scene.id || 'palette' } });
    } else if (act === 'photos' || act === 'text') {
      const panel = card.querySelector(act === 'photos' ? '.gen-cc__photos' : '.gen-cc__text');
      const open = panel.hidden;
      if (open) (act === 'photos' ? photosPanel : textPanel)(card);
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('button, input')?.focus({ preventScroll: true });
    } else if (act === 'pick') {
      const index = Number(button.dataset.index);
      await design(card._designId)?.swapPhoto(index);
      photosPanel(card);
      card.querySelector(`[data-cc="pick"][data-index="${index}"]`)?.focus({ preventScroll: true });
    } else if (act === 'apply') {
      button.disabled = true;
      button.classList.add('is-busy');
      await applyImprovement(card, button.dataset.id);
      if (button.isConnected) { button.disabled = false; button.classList.remove('is-busy'); }
      else (card.querySelector('.gen-cc__better :is([data-cc="apply"], [data-cc="ask"])') || card.querySelector('.gen-cc__director > summary'))?.focus({ preventScroll: true });
    } else if (act === 'ask') {
      openFocus(card, 'assistant');
    }
  });

  window.FrameUpCreative = Object.freeze({
    isOn, run, mountSwitch, state,
    count: () => wanted(),
    design, designs,
    track: (type, extra = {}) => G()?.track?.(type, { runId: state.run?.plan?.runId, ...extra }),
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSwitch);
  else mountSwitch();
}());
