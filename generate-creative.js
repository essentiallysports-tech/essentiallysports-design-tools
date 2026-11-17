/*
 * Generate: the Creative look (composed designs, art-directed).
 *
 *   1. POST /api/es-generate { mode: 'creative' }: the art director's
 *      directions (one per story / idea), each with 2-3 candidate scenes.
 *   2. Here: every candidate is drawn small (frameup-compose.js) and scored by
 *      the free heuristic check (text fit, phone size, contrast).
 *   3. POST { mode: 'creative-judge' } with the small JPEGs: the vision pass
 *      picks one per direction, writes the director's note and names at most
 *      one fix, which is applied here in code. No AI key: the heuristic picks.
 *   4. Cards: big preview, the composition's name, the director's note, the
 *      story it tells, Try another composition, Swap photo, Edit text, PNG/JPEG
 *      download (recorded in the Gallery like any export), the run's cost.
 *
 * Needs window.FrameUpGenerate (generate.html) and window.FrameUpCompose.
 */
(function () {
  'use strict';

  const LOOK_KEY = 'frameup.generate.look.v1';
  const G = () => window.FrameUpGenerate;
  const C = () => window.FrameUpCompose;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Lucide icons (ISC licence).
  const ICON = {
    shuffle: svg('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    type: svg('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    clapper: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
  };

  let look = 'creative';
  try { look = localStorage.getItem(LOOK_KEY) === 'templates' ? 'templates' : 'creative'; } catch (error) { /* private mode */ }
  const isOn = () => look === 'creative' && Boolean(C()) && Boolean(G());
  const state = { run: null, cards: [] };

  // ── The Look switch (in the steer row) ───────────────────────────────────
  function mountSwitch() {
    const steer = document.getElementById('gen-steer');
    if (!steer || document.getElementById('gen-look')) return;
    const group = document.createElement('div');
    group.className = 'gen-steer__group gen-look';
    group.innerHTML = `
      <span class="gen-row__label" id="gen-look-label">Look</span>
      <div class="gen-chips" id="gen-look" role="radiogroup" aria-labelledby="gen-look-label" aria-describedby="gen-look-hint">
        <button class="gen-chip" type="button" role="radio" data-look="creative">Creative<span class="gen-look__new" aria-hidden="true">New</span></button>
        <button class="gen-chip" type="button" role="radio" data-look="templates">ES templates</button>
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
      const expect = document.getElementById('gen-expect');
      if (expect) {
        const span = expect.querySelector('span');
        if (span) span.innerHTML = look === 'creative' ? '<strong>Up to 4 composed designs</strong> · art-directed' : '<strong>Up to 4 designs</strong> · edit any in the editor';
      }
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
    paint();
  }

  // ── Rendering helpers ────────────────────────────────────────────────────
  const money = value => `$${Number(value || 0).toFixed(value >= 0.1 ? 2 : 3)}`;
  async function small(scene) {
    return C().toDataUrl(scene, { width: 360, quality: 0.8 });
  }
  async function preview(card) {
    const media = card.querySelector('.gen-cc__media');
    const img = media.querySelector('img');
    media.classList.add('is-busy');
    try {
      const { dataUrl, report } = await C().toDataUrl(card._scene, { width: 720, quality: 0.9 });
      img.src = dataUrl;
      card._report = report;
      card.classList.remove('is-failed');
      const missing = report.missing?.length;
      const warn = card.querySelector('.gen-cc__warn');
      warn.hidden = !missing;
      warn.textContent = missing ? 'An image did not load; swap the photo or try another composition.' : '';
    } catch (error) {
      card.classList.add('is-failed');
    } finally {
      media.classList.remove('is-busy');
      media.classList.add('is-ready');
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
    card.innerHTML = '<div class="gen-cc__media"></div><div class="gen-card__body"><span class="es-skeleton"></span><span class="es-skeleton"></span></div>';
    return card;
  }

  function buildCard(dir, verdict) {
    const card = document.createElement('article');
    card.className = 'gen-card gen-cc';
    card.innerHTML = `
      <div class="gen-cc__media"><img alt=""></div>
      <div class="gen-card__body">
        <div class="gen-card__tags">
          <span class="gen-card__type"></span>
          <span class="gen-card__guide">${ICON.check}<span>On-brand</span></span>
          <span class="gen-cc__score" hidden></span>
        </div>
        <h3 class="gen-cc__name"></h3>
        <p class="gen-cc__story"></p>
        <div class="gen-note gen-cc__note"><p><span class="gen-note__who">${ICON.clapper}Director</span><span class="gen-cc__note-text"></span></p></div>
        <p class="gen-cc__warn" hidden></p>
        <p class="gen-card__source gen-cc__source" hidden>Source: <a target="_blank" rel="noopener"></a></p>
        <div class="gen-card__actions gen-cc__actions">
          <button class="es-btn es-btn--sm gen-cc__dl" type="button" data-cc="download">${ICON.download}PNG</button>
          <button class="es-icon-btn" type="button" data-cc="another" aria-label="Try another composition" title="Try another composition">${ICON.shuffle}</button>
          <button class="es-icon-btn" type="button" data-cc="photos" aria-label="Swap photo" title="Swap photo" aria-expanded="false">${ICON.image}</button>
          <button class="es-icon-btn" type="button" data-cc="text" aria-label="Edit text" title="Edit text" aria-expanded="false">${ICON.type}</button>
          <button class="es-icon-btn" type="button" data-cc="jpeg" aria-label="Download JPEG" title="Download JPEG">JPG</button>
        </div>
        <div class="gen-cc__panel gen-cc__photos" hidden></div>
        <form class="gen-cc__panel gen-cc__text" hidden></form>
      </div>`;
    card._dir = dir;
    card._verdict = verdict || {};
    card._index = Math.max(0, dir.candidates.findIndex(s => s.id === verdict?.best));
    card._scene = verdict?.scene || dir.candidates[card._index];
    fill(card);
    return card;
  }

  function fill(card) {
    const dir = card._dir;
    const scene = card._scene;
    card.querySelector('.gen-card__type').textContent = scene.archetypeName || dir.archetypeName;
    card.querySelector('.gen-cc__name').textContent = dir.name || dir.archetypeName;
    const story = card.querySelector('.gen-cc__story');
    story.replaceChildren(textEl('strong', '', 'Story: '), document.createTextNode(dir.storyText || ''));
    const note = card._verdict.note || dir.note || '';
    card.querySelector('.gen-cc__note-text').textContent = ` ${note}${scene.fixApplied ? ` Fix applied: ${scene.fixApplied.replace(/-/g, ' ')}.` : ''}`;
    const guide = card.querySelector('.gen-card__guide');
    const fixes = (scene.guideline?.fixes || []).map(f => f.what);
    guide.title = fixes.length ? `Passed the ES guideline check after: ${fixes.join('; ')}` : 'Passed the ES guideline check for composed designs';
    const score = card.querySelector('.gen-cc__score');
    const total = card._verdict.scores?.[scene.id]?.total;
    score.hidden = !total;
    score.textContent = total ? `${Number(total).toFixed(1)} / 5` : '';
    score.title = card._verdict.source === 'vision' ? 'Art director score (vision)' : 'Quick check score (no AI)';
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
    card.querySelector('img').alt = `${scene.archetypeName}: ${C().editableText(scene).map(t => t.text).join(' · ')}`;
  }

  // ── The run ──────────────────────────────────────────────────────────────
  async function run(brief) {
    const g = G();
    if (!g || g.isBusy()) return;
    const { els } = g;
    g.setBusy(true);
    g.setNotice('');
    els.empty.hidden = true;
    els.research.hidden = true;
    document.getElementById('gen-setbar')?.setAttribute('hidden', '');
    els.grid.replaceChildren(...Array.from({ length: 4 }, skeleton));
    els.grid.setAttribute('aria-busy', 'true');
    const progress = g.startProgress(['Reading ES coverage', 'Art director planning', 'Composing candidates', 'Art director judging'], [2400, 9000]);
    // The editor frame records exports in the Gallery; load it while we work.
    g.renderer?.().catch(() => {});
    try {
      const plan = await g.callApi('/api/es-generate', { mode: 'creative', brief, count: 4, steer: g.steer() });
      if (!plan?.directions?.length) {
        progress.stop();
        els.grid.replaceChildren();
        // Never leave someone empty-handed: Generate falls back to ES templates.
        return 'fallback';
      }
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
        judged = await g.callApi('/api/es-generate', { mode: 'creative-judge', brief, runId: plan.runId, sets, heuristics });
      } catch (error) { /* the heuristic picks below */ }
      const cards = plan.directions.map(dir => {
        const verdict = (judged.directions || []).find(v => v.id === dir.id) || {};
        const ranked = [...dir.candidates].sort((a, b) => (heuristics[b.id]?.score || 0) - (heuristics[a.id]?.score || 0));
        const best = dir.candidates.find(s => s.id === verdict.best) || ranked[0];
        const fix = verdict.fix || (judged.source !== 'vision' ? heuristics[best.id]?.fix : '');
        const scene = fix ? C().applyFix(best, fix) : best;
        return buildCard(dir, { ...verdict, best: best.id, scene, source: judged.source, scores: verdict.scores || Object.fromEntries(dir.candidates.map(s => [s.id, { total: heuristics[s.id]?.score }])) });
      });
      state.run = { brief, plan, judged };
      state.cards = cards;
      els.grid.replaceChildren(...cards);
      for (const card of cards) await preview(card);
      const seconds = progress.stop();
      g.rememberBrief?.(brief);
      window.FrameUpPosted?.markGenerateRun?.({ count: cards.length, format: 'creative' });
      const cost = (plan.cost?.total || 0) + (judged.cost || 0);
      const composed = plan.directions.reduce((n, d) => n + d.candidates.length, 0);
      g.setSummary(`<span class="gen-mode is-ai">Creative</span><span class="gen-mode">${judged.source === 'vision' ? 'Art director · vision' : 'Quick check'}</span><span><strong>${cards.length} design${cards.length === 1 ? '' : 's'}</strong> from ${composed} compositions · ${Math.max(1, Math.round(seconds))}s · ${plan.cached ? 'cached' : money(cost)}</span>`);
      renderDropped(plan);
      if (plan.research?.articles) g.showResearch(plan.research.articles);
      g.track('generate_run', { runId: plan.runId, payload: { look: 'creative', designs: cards.length, cost, judge: judged.source } });
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
      g.restoreFocus(els.grid.querySelector('.gen-cc [data-cc="download"]') || els.submit);
    }
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
        metadata: { generated: { source: 'generate-creative', runId: state.run?.plan?.runId, archetype: scene.archetype, brief: (state.run?.brief || '').slice(0, 300) } },
      });
    } catch (error) { /* the download still happened */ }
    window.FrameUpPosted?.exported?.({ source: 'generate', title: card._dir.name || scene.archetypeName, template: `Creative · ${scene.archetypeName}`, style: scene.archetype, brand: 'essentiallysports', aiMade: 'generate' });
    G().track('design_exported', { runId: state.run?.plan?.runId, directionId: card._dir.id, postType: `creative:${scene.archetype}`, payload: { look: 'creative', fix: scene.fixApplied || '' } });
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
    // Numbers stay facts: a typed digit that is not on the design is refused.
    const facts = new Set(card._scene.layers.flatMap(l => String(`${l.text || ''} ${l.value || ''} ${l.label || ''}`).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []));
    (card._scene.facts || []).forEach(f => String(f.text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.forEach(d => facts.add(d)));
    const stray = (input.value.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).filter(d => !facts.has(d));
    input.setCustomValidity(stray.length ? `Numbers must come from the brief (${stray.join(', ')} is not).` : '');
    input.reportValidity();
    if (stray.length) return;
    clearTimeout(typing);
    typing = setTimeout(() => {
      card._scene = C().setText(card._scene, Number(input.dataset.index), input.value);
      preview(card);
    }, 250);
  });
  document.addEventListener('submit', event => {
    if (event.target.closest?.('.gen-cc__text')) event.preventDefault();
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-cc]');
    const card = button?.closest('.gen-cc');
    if (!card || button.disabled) return;
    const act = button.dataset.cc;
    if (act === 'download' || act === 'jpeg') {
      button.disabled = true;
      try {
        await exportCard(card, act === 'jpeg' ? 'image/jpeg' : 'image/png');
        G().setSummary(`<span><strong>${act === 'jpeg' ? 'JPEG' : 'PNG'} downloaded</strong> · 1080 × ${card._scene.size.h}</span>`);
      } catch (error) {
        G().setNotice('Download failed', ` ${error.message || ''}`);
      } finally {
        setTimeout(() => { button.disabled = false; }, 800);
      }
    } else if (act === 'another') {
      // The next candidate (the art director ranked them); then the palette flip.
      const dir = card._dir;
      card._index = (card._index + 1) % (dir.candidates.length + 1);
      card._scene = card._index < dir.candidates.length ? dir.candidates[card._index] : C().applyFix(dir.candidates[0], 'swap-palette');
      fill(card);
      await preview(card);
      G().track('direction_more', { runId: state.run?.plan?.runId, directionId: dir.id, payload: { look: 'creative', candidate: card._scene.id || 'palette' } });
    } else if (act === 'photos' || act === 'text') {
      const panel = card.querySelector(act === 'photos' ? '.gen-cc__photos' : '.gen-cc__text');
      const open = panel.hidden;
      if (open) (act === 'photos' ? photosPanel : textPanel)(card);
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('button, input')?.focus({ preventScroll: true });
    } else if (act === 'pick') {
      const photo = card._dir.photos[Number(button.dataset.index)];
      if (!photo) return;
      const from = C().mainPhoto(card._scene);
      card._scene = C().swapPhoto(card._scene, { from, to: photo.src, cutout: photo.cutout || '' });
      photosPanel(card);
      await preview(card);
      card.querySelector(`[data-cc="pick"][data-index="${button.dataset.index}"]`)?.focus({ preventScroll: true });
    }
  });

  window.FrameUpCreative = Object.freeze({ isOn, run, mountSwitch, state });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSwitch);
  else mountSwitch();
}());
