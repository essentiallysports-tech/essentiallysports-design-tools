// Reels Studio storyboard (Reels 2.0, lane D; v3: the scene strip and the
// picked scene's editor with Swap, see attach()). Every scene of the reel is a
// card: a live thumbnail drawn by the real renderer, the block switcher, the
// on-screen words with colour chips (ink, blue, green for a win, red for a
// loss) in place of the typed "TEXT | blue" syntax, friendly controls for
// compare bars, dots and the stamp, a place to drop a photo or a clip, and
// three ways to reorder (drag, the Move buttons, Alt + an arrow key). The end
// card is always last and does not move.
//
// Every edit goes through the page's one path: ctx.setField -> setEsField.
// Field ids keep the pattern rm-es-<field>-<beatId>.
// The pure helpers (ReelStoryboardCore) load in Node for the tests; the page
// part attaches to window.ReelMakerCtx and publishes ctx.modules.storyboard
// = { render(), refresh(), select(id, { focus }), move(id, delta), moveTo(id, index) }.
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ReelStoryboardCore = core;
  if (typeof document !== 'undefined') core.attach();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // The four text colours of the ES system. Green and red carry meaning.
  const COLORS = [
    { id: 'ink', label: 'Ink' },
    { id: 'blue', label: 'Blue' },
    { id: 'green', label: 'Green: a win' },
    { id: 'red', label: 'Red: a loss' },
  ];
  const ROWS = {
    pills: { noun: 'pill', title: 'Pills', max: 3, min: 1, chars: 14, placeholder: 'THE CUBS LOST.' },
    lines: { noun: 'line', title: 'Lines', max: 3, min: 1, chars: 14, placeholder: 'IT WASN’T' },
    items: { noun: 'bar', title: 'Bars', max: 4, min: 2, chars: 28 },
  };

  // The index of the end card (always the last scene), or -1.
  function endIndex(beats, isEnd) {
    const last = (beats || []).length - 1;
    return last >= 0 && isEnd(beats[last], last) ? last : -1;
  }
  // Where a scene may go: anywhere before the end card. The end card stays.
  function canMove(count, from, to, end = -1) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
    if (from < 0 || from >= count || to < 0 || to >= count) return false;
    if (end >= 0 && (from === end || to >= end)) return false;
    return true;
  }
  // -> the reordered copy, or null when the move is not allowed.
  function move(list, from, to, end = -1) {
    if (!canMove(list.length, from, to, end)) return null;
    const out = list.slice();
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
  }
  // Dropping "before the card at `over`" (or after it): the index the scene lands on.
  function dropIndex(from, over, after, count, end = -1) {
    let to = over + (after ? 1 : 0);
    if (from < to) to -= 1;
    const max = end >= 0 ? end - 1 : count - 1;
    return Math.max(0, Math.min(max, to));
  }
  // The word a new stamp starts with: the person's own *emphasised* word, else the last word on screen.
  function stampWord(vo, texts) {
    const marked = String(vo || '').match(/\*([^*]+)\*/g);
    const pick = marked && marked.length ? marked[marked.length - 1] : (texts || []).filter(Boolean).slice(-1)[0] || '';
    const words = String(pick).replace(/\*/g, '').trim().split(/\s+/).filter(Boolean);
    return (words[words.length - 1] || '').replace(/[^\w$%'’-]/g, '').toUpperCase().slice(0, 20);
  }
  // ── Reels v4 (UI) ── chapters, motion and the honest "Ready to post".
  // A chapter marker in plain words: '1 · THE RUN', '#3' (a countdown chip), '2 of 5'.
  function markerText(marker, i) {
    if (!marker) return String(i + 1);
    if (typeof marker === 'string') return marker;
    if (marker.kind === 'countdown') return `#${marker.n}`;
    if (marker.kind === 'progress') return `${marker.i} of ${marker.of}`;
    return String(i + 1);
  }
  // The strip's groups: a v4 plan's chapters (beats matched by id to the flat
  // list the page edits), else one unnamed group holding every scene.
  function chaptersOf(plan) {
    if (!plan) return [];
    const flat = Array.isArray(plan.beats) ? plan.beats : [];
    if (!Array.isArray(plan.chapters) || !plan.chapters.length) return [{ id: 'all', n: 0, marker: '', headline: '', tone: '', beats: flat }];
    const byId = new Map(flat.map(b => [b.id, b]));
    const seen = new Set();
    const groups = plan.chapters.map((c, i) => {
      const beats = (Array.isArray(c.beats) ? c.beats : []).map(b => byId.get(b && b.id) || null).filter(b => b && !seen.has(b.id));
      beats.forEach(b => seen.add(b.id));
      return { id: c.id || `c${i + 1}`, n: i + 1, marker: markerText(c.marker, i), headline: String(c.headline || '').replace(/\*/g, '').trim(), tone: c.tone || '', beats };
    });
    // Scenes the chapters do not hold (added on the page, the end card) join the chapter before them.
    flat.forEach((b, k) => {
      if (seen.has(b.id)) return;
      const prev = flat.slice(0, k).reverse().find(x => seen.has(x.id));
      const g = (prev && groups.find(x => x.beats.includes(prev))) || groups[groups.length - 1];
      if (g) { g.beats.splice(prev ? g.beats.indexOf(prev) + 1 : g.beats.length, 0, b); seen.add(b.id); }
    });
    return groups.filter(g => g.beats.length);
  }
  // ── Plan v4 on a page built for flat beats ──
  // A v4 plan keeps its scenes in chapters[].beats. linkV4 gives it a
  // plan.beats accessor (the flat list, in order) so every part of the page
  // that reads beats keeps working; assigning plan.beats puts the scenes back
  // into their chapters (relink). JSON keeps both fields, so a server that only
  // knows flat beats still reads the plan, and linkV4 takes the flat list's
  // content (by id) when a reply carries both.
  function relink(plan, next) {
    const chapters = plan.chapters;
    const orig = new Map();
    chapters.forEach((c, ci) => (c.beats || []).forEach(b => orig.set(b && b.id, ci)));
    const list = (Array.isArray(next) ? next : []).filter(Boolean);
    const ci = list.map((b, i) => (orig.has(b.id) ? orig.get(b.id) : -1));
    // A new scene joins the chapter of the scene before it (the first chapter at the start).
    ci.forEach((c, i) => { if (c < 0) ci[i] = i ? ci[i - 1] : 0; });
    // A scene moved across a boundary takes the chapter of the scene now before it.
    ci.forEach((c, i) => {
      const prev = i ? ci[i - 1] : null;
      const nxt = i < ci.length - 1 ? ci[i + 1] : null;
      if (prev != null && c < prev) ci[i] = prev;
      else if (prev != null && nxt != null && c > prev && c > nxt) ci[i] = prev;
      else if (prev == null && nxt != null && c > nxt) ci[i] = nxt;
    });
    for (let i = 1; i < ci.length; i += 1) if (ci[i] < ci[i - 1]) ci[i] = ci[i - 1];
    chapters.forEach(c => { c.beats = []; });
    list.forEach((b, i) => { const c = chapters[Math.min(chapters.length - 1, Math.max(0, ci[i]))]; c.beats.push(b); });
    return plan;
  }
  function linkV4(plan) {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.chapters) || !plan.chapters.length) return plan;
    plan.chapters.forEach((c, i) => { if (!c.id) c.id = `c${i + 1}`; if (!Array.isArray(c.beats)) c.beats = []; });
    const own = Object.getOwnPropertyDescriptor(plan, 'beats');
    const flat = own && 'value' in own && Array.isArray(own.value) ? own.value : null;
    if (own && !('value' in own)) return plan; // already linked
    delete plan.beats;
    Object.defineProperty(plan, 'beats', {
      configurable: true, enumerable: true,
      get() { return plan.chapters.flatMap(c => c.beats || []); },
      set(next) { relink(plan, next); },
    });
    if (flat && flat.length) {
      const inCh = new Map(plan.chapters.flatMap(c => c.beats).map(b => [b && b.id, b]));
      relink(plan, flat.map(b => (b && inCh.has(b.id) ? Object.assign(inCh.get(b.id), b) : b)));
    }
    return plan;
  }
  // v4 plans: the flat accessor; v3 plans through ReelES.toV4 when the engine has it (else as they are).
  function ensureV4(plan, ES) {
    if (!plan || typeof plan !== 'object') return plan;
    if (Array.isArray(plan.chapters) && plan.chapters.length) return linkV4(plan);
    if (ES && typeof ES.toV4 === 'function' && Array.isArray(plan.beats) && plan.beats.length) {
      let out = null;
      try { out = ES.toV4(plan); } catch { out = null; }
      if (out && Array.isArray(out.chapters) && out.chapters.length) {
        const keep = Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'beats'));
        delete plan.beats;
        Object.assign(plan, keep);
        return linkV4(plan);
      }
    }
    return plan;
  }
  const isV4 = plan => Boolean(plan && Array.isArray(plan.chapters) && plan.chapters.length);
  // The words people say, compared loosely (case, punctuation, *emphasis* and spacing ignored).
  const looseWords = text => String(text || '').toLowerCase().replace(/[*]/g, '').replace(/[’‘]/g, "'").replace(/[^a-z0-9'%$.\s-]/g, ' ').replace(/[.\-]+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  // Does the plan say the script word for word? (The AI never rewrites it.)
  function keepsScript(plan, script) {
    const said = (plan && Array.isArray(plan.beats) ? plan.beats : []).map(b => b && b.vo).filter(Boolean).join(' ');
    return Boolean(looseWords(script)) && looseWords(said) === looseWords(script);
  }
  // Words, seconds and the length target for the script meter (2.6 words a second).
  function scriptMeter(text, target = { min: 80, max: 100 }, wps = 2.6) {
    const words = String(text || '').replace(/[*]/g, '').trim().split(/\s+/).filter(Boolean).length;
    const sec = Math.round(words / wps);
    const state = !words ? 'empty' : sec < target.min ? 'short' : sec > target.max ? 'long' : 'ok';
    return { words, sec, state, need: { min: Math.ceil(target.min * wps), max: Math.floor(target.max * wps) } };
  }
  // Data blocks animate on their own (counts, bars, dots); hook / statement /
  // quote type over plain paper does not.
  const MOTION_BLOCKS = ['number', 'dots', 'compare', 'statTiles', 'dotGrid', 'streak', 'rankTile'];
  // Does a scene move? media: 'clip' | 'photo' (a verified photo, or your own upload: Ken Burns on its focus box) | ''.
  // motionOk from ReelSourcing.mediaFor (v4) wins when it is given.
  function motionOf({ media = '', block = '', module = '', motionOk } = {}) {
    if (typeof motionOk === 'boolean') return { ok: motionOk, why: motionOk ? (media || (module ? 'module' : 'ok')) : 'static' };
    if (media === 'clip') return { ok: true, why: 'clip' };
    if (media === 'photo') return { ok: true, why: 'photo' };
    if (module || MOTION_BLOCKS.includes(block)) return { ok: true, why: 'module' };
    return { ok: false, why: 'static' };
  }
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // The badge: Draft, Needs clips, N to fix, a static scene, the critic, else Ready to post.
  //   beats: [{ id, ok }], clipCount, critic: null (did not run) | { pass, score?, notes? },
  //   critical / warnings: the code checks and the AI review.
  function readiness({ draft = false, beats = [], clipCount = 0, critic = null, critical = 0, warnings = 0, gated = true } = {}) {
    const still = beats.filter(b => !b.ok).length;
    const checks = gated ? [
      { id: 'motion', ok: !still, label: still ? `${plural(still, 'scene')} with no motion: add a clip, a photo or a data block` : 'Every scene moves', severity: 'critical' },
      { id: 'clips', ok: clipCount >= 1, label: clipCount ? `${plural(clipCount, 'confirmed clip')}` : 'No confirmed clip yet: a reel needs at least one', severity: 'critical' },
      { id: 'critic', ok: critic ? critic.pass !== false : true, label: critic ? (critic.pass === false ? 'AI critic: the story needs work' : `AI critic: passed${critic.score != null ? ` (${critic.score}/10)` : ''}`) : 'AI critic did not run (AI is off or capped)', severity: critic ? 'warning' : 'info' },
    ] : [];
    let state = 'ready';
    if (draft) state = 'draft';
    else if (critical) state = 'fix';
    else if (gated && clipCount < 1) state = 'clips';
    else if (gated && still) state = 'motion';
    else if (gated && critic && critic.pass === false) state = 'critic';
    const label = {
      draft: gated && clipCount < 1 ? 'Draft · needs clips' : 'Draft',
      fix: `${critical} to fix before posting`,
      clips: 'Needs clips',
      motion: `${plural(still, 'static scene')}`,
      critic: 'Critic flagged the story',
      ready: warnings ? `Ready to post · ${warnings} to review` : 'Ready to post',
    }[state];
    const tone = { draft: 'draft', fix: 'bad', clips: 'warn', motion: 'warn', critic: 'warn', ready: 'good' }[state];
    return { state, label, tone, ready: state === 'ready', still, needsClips: gated && clipCount < 1, checks };
  }
  const dotsLine = (count, highlight) => {
    const c = Math.max(0, Math.round(Number(count) || 0));
    const h = Math.max(0, Math.min(c, Math.round(Number(highlight) || 0)));
    return `${h.toLocaleString('en-US')} of ${c.toLocaleString('en-US')} ${c === 1 ? 'dot' : 'dots'} ${h === 1 ? 'is' : 'are'} green.`;
  };

  // ─── Page ────────────────────────────────────────────────────────────────
  // Reels Studio v3: the scene strip under the phone (each card: the scene's
  // frame with its media, the block, its words, a Swap control) and the picked
  // scene's editor in the Review panel (#rm-scene-edit): block, words, media
  // with Swap from the verified candidates, Move and Delete.
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.storyboard || !ctx.ui) return;
      const { state, els, ES, F, R } = ctx;
      const ui = ctx.ui;
      const { ICON, esc } = ui;
      const list = els.beats;
      const editorEl = els.sceneEdit || document.getElementById('rm-scene-edit');
      const live = document.getElementById('rm-sb-live');
      const say = text => { const a = ctx.modules.a11y; if (a) a.announce(text); else if (live) live.textContent = text; };
      const es = () => Boolean(ui.esOn() && ES);
      const beats = () => (state.plan ? state.plan.beats : []);
      const isEnd = (beat, i) => i === beats().length - 1 && (es() ? ES.blockOf(beat).type === 'endcard' : beat.kind === 'cta');
      const endAt = () => endIndex(beats(), isEnd);
      const beatOf = id => beats().find(b => b.id === id);
      const cardOf = id => list.querySelector(`[data-beat="${CSS.escape(id)}"]`);
      const fid = (field, id) => `rm-${field.replace(/\./g, '-')}-${id}`;
      // Receipts is motion only: no media, no Swap (unless the person added some).
      const takes = beat => (ui.takesMedia ? ui.takesMedia(beat) : (es() ? ES.takesMedia(beat) : beat.kind !== 'cta'));
      // The cards show the ES safe frame (y 290 to 1650), where every word sits.
      // Review v4: evenly sized thumbnails of the whole frame (9:16, or 4:5 for the feed size), drawn at 2x.
      const thumbSize = () => { const s = (state.timeline && state.timeline.size) || [1080, 1920]; return s[1] === 1350 ? [160, 200] : [160, 284]; };

      // ── Fields ──
      const field = (id, name, label, value, { max = 120, type = 'text', ph = '', cls = '' } = {}) => `<div class="rm-bf${cls ? ` ${cls}` : ''}"><label class="rm-bf__label" for="${fid(name, id)}">${label}</label><input class="es-input rm-bf__input" id="${fid(name, id)}" data-field="${name}" type="${type}" maxlength="${max}" value="${esc(value == null ? '' : value)}" placeholder="${esc(ph)}"${type === 'number' ? ' inputmode="decimal" step="any"' : ''}></div>`;
      const chips = (value, label, attr = '') => `<div class="rm-chipset rm-dots" role="radiogroup" aria-label="${esc(label)}"${attr}>${COLORS.map((c, k) => { const on = c.id === value; const tab = on || (!COLORS.some(x => x.id === value) && k === 0); return `<button class="rm-cchip rm-cchip--${c.id}" type="button" role="radio" aria-checked="${on}" tabindex="${tab ? 0 : -1}" data-sb-color="${c.id}" aria-label="${c.label}" title="${c.label}"></button>`; }).join('')}</div>`;
      const countOf = (text, max) => { const n = String(text || '').trim().length; return `<span class="rm-count${n > max ? ' is-over' : ''}" data-sb-count="${max}" aria-hidden="true">${n}/${max}</span>`; };
      function rowsHtml(id, key, rows) {
        const def = ROWS[key];
        const Noun = def.noun[0].toUpperCase() + def.noun.slice(1);
        const row = (x, k) => {
          const del = `<button class="rm-icon-btn rm-icon-btn--sm rm-row__del" type="button" data-sb-del aria-label="Remove ${def.noun} ${k + 1}" title="Remove"${rows.length <= def.min ? ' disabled' : ''}>${ICON.x}</button>`;
          if (key === 'items') {
            return `<div class="rm-row rm-row--bar" data-sb-row>
              <div class="rm-row__pair rm-row__pair--bar"><input class="es-input rm-bf__input" id="rm-es-items-${k}-label-${esc(id)}" data-sb-label type="text" maxlength="28" value="${esc(x.label || '')}" aria-label="Bar ${k + 1} label" placeholder="Label">
              <input class="es-input rm-bf__input" id="rm-es-items-${k}-value-${esc(id)}" data-sb-display type="text" maxlength="16" value="${esc(x.display || (x.value == null ? '' : x.value))}" aria-label="Bar ${k + 1} value, as shown" placeholder="$692M"></div>
              <div class="rm-row__meta">${chips(x.color || '', `Bar ${k + 1} colour`)}${del}</div></div>`;
          }
          return `<div class="rm-row rm-row--line" data-sb-row>
            <span class="rm-field"><input class="es-input rm-bf__input" id="rm-es-${key}-${k}-${esc(id)}" data-sb-text type="text" maxlength="40" value="${esc(x.text || '')}" aria-label="${Noun} ${k + 1}, up to ${def.chars} characters" placeholder="${esc(def.placeholder)}">${countOf(x.text, def.chars)}</span>
            ${chips(x.color || 'ink', `${Noun} ${k + 1} colour`)}${del}</div>`;
        };
        return `<div class="rm-rows" data-sb-rows="${key}" role="group" aria-label="${def.title}">
          <span class="rm-bf__label">${def.title}</span>
          ${rows.map(row).join('')}
          ${rows.length < def.max ? `<button class="rm-addrow" type="button" data-sb-add="${key}">${ICON.plus}<span>Add a ${def.noun}</span></button>` : ''}
        </div>`;
      }
      // Your script is read-only here unless you choose Edit script: the words are yours, the visuals follow them.
      state.voEdit = state.voEdit || {};
      function voHtml(beat) {
        const id = beat.id;
        if (ui.scriptLocked() && !state.voEdit[id]) {
          return `<div class="rm-bf rm-voread"><div class="rm-bf__row"><span class="rm-bf__label" id="rm-vo-${esc(id)}-label">Your words</span><button class="rm-link rm-voread__edit" type="button" data-sb-editvo aria-describedby="rm-vo-${esc(id)}-label">Edit script</button></div>
            <p class="rm-voread__text" id="rm-vo-${esc(id)}">${esc(String(beat.vo || '').replace(/\*/g, '')) || '<span class="rm-meta">No words on this scene.</span>'}</p></div>`;
        }
        return `<div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-vo-${esc(id)}">${ui.scriptLocked() ? 'Voiceover (your words)' : 'Voiceover'}</label>${ui.count(beat.vo, F.PACE.voMaxWords)}</div>
          <textarea class="es-input rm-bf__input" id="rm-vo-${esc(id)}" data-field="vo" rows="2" maxlength="300" title="Wrap the key word in *asterisks* to make it yellow in the captions.">${esc(beat.vo || '')}</textarea></div>`;
      }
      // A label for a field the engine adds (photoCard, statTiles, streak…): "clipLabel" -> "Clip label".
      const nice = key => { const s = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase(); return s[0].toUpperCase() + s.slice(1); };
      // Blocks without their own editor (the engine's v3 blocks): every
      // word and number on the block, as plain fields; lists as rows.
      function genericBody(id, b) {
        const parts = [];
        Object.entries(b).forEach(([k, v]) => {
          if (k === 'type' || k === 'media' || k === 'focus') return;
          if (typeof v === 'string' || typeof v === 'number') parts.push(field(id, `es.${k}`, nice(k), v, { max: 80, type: typeof v === 'number' ? 'number' : 'text' }));
          else if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
            parts.push(`<fieldset class="rm-genrows"><legend class="rm-bf__label">${esc(nice(k))}</legend>${v.slice(0, 8).map((item, i) => `<div class="rm-bf-pair">${Object.entries(item || {}).filter(([, x]) => typeof x === 'string' || typeof x === 'number').filter(([p]) => p !== 'tone' && p !== 'color' && p !== 'r').slice(0, 3).map(([p, x]) => field(id, `es.${k}.${i}.${p}`, `${nice(p)} ${i + 1}`, x, { max: 40, type: typeof x === 'number' ? 'number' : 'text' })).join('')}</div>`).join('')}</fieldset>`);
          } else if (Array.isArray(v) || (v && typeof v === 'object' && typeof v.text === 'string')) {
            if (!Array.isArray(v)) parts.push(field(id, `es.${k}.text`, nice(k), v.text, { max: 40 }));
          }
        });
        return parts.join('');
      }
      function esBody(beat) {
        const id = beat.id;
        const b = ES.blockOf(beat);
        const parts = [];
        if (b.type === 'hook') {
          parts.push(rowsHtml(id, 'pills', b.pills && b.pills.length ? b.pills : [{ text: '', color: 'ink' }]));
          const st = b.stamp;
          parts.push(`<div class="rm-stamp"><label class="rm-switch"><input type="checkbox" role="switch" data-sb-stamp${st ? ' checked' : ''}><span>Stamp</span></label>
            ${st ? `<div class="rm-bf-pair">${field(id, 'es.stamp.text', 'Stamp word', st.text, { max: 20, ph: 'One word' })}${field(id, 'es.stamp.at', 'Lands at (s)', st.at != null ? st.at : '', { type: 'number', max: 5, ph: 'Auto' })}</div>` : '<p class="rm-hint">One word that slams in on the payoff.</p>'}</div>`);
        } else if (b.type === 'statement') {
          parts.push(rowsHtml(id, 'lines', b.lines && b.lines.length ? b.lines : [{ text: '', color: 'ink' }]));
        } else if (b.type === 'number') {
          parts.push(field(id, 'es.kicker', 'Kicker', b.kicker || '', { max: 40, ph: '2011 · Green Bay' }));
          parts.push(`<div class="rm-bf-trio">${field(id, 'es.prefix', 'Before', b.prefix || '', { max: 3, ph: '$' })}${field(id, 'es.value', 'Number', b.value, { type: 'number', max: 12 })}${field(id, 'es.suffix', 'After', b.suffix || '', { max: 4, ph: '%' })}</div>`);
          parts.push(field(id, 'es.label', 'Label', b.label || '', { max: 40, ph: 'Touchdowns' }));
          parts.push(`<div class="rm-bf rm-bf--chips"><span class="rm-bf__label" id="rm-es-color-${esc(id)}-label">Number colour</span>${chips(b.color || 'blue', 'Number colour', ' data-sb-single="es.color"')}</div>`);
        } else if (b.type === 'dots') {
          parts.push(`<div class="rm-bf-pair">${field(id, 'es.count', 'Dots', b.count, { type: 'number', max: 5 })}${field(id, 'es.highlight', 'Blue ones', b.highlight, { type: 'number', max: 5 })}</div>`);
          parts.push(`<p class="rm-hint" data-sb-dots>${esc(dotsLine(b.count, b.highlight))} Up to 2,600.</p>`);
          parts.push(field(id, 'es.label', 'Label', b.label || '', { max: 40, ph: 'Achilles tears' }), field(id, 'es.note', 'Note', b.note || '', { max: 40, ph: '26 got back to 90%' }));
        } else if (b.type === 'compare') {
          parts.push(field(id, 'es.kicker', 'Kicker', b.kicker || '', { max: 40, ph: 'Made it back' }));
          const items = (b.items || []).slice();
          while (items.length < 2) items.push({ label: '', display: '', color: items.length ? 'ink' : 'blue' });
          parts.push(rowsHtml(id, 'items', items), '<p class="rm-hint">Bars scale to the biggest value.</p>');
        } else if (b.type === 'quote') {
          parts.push(`<div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-es-text-${esc(id)}">Quote (their exact words)</label>${countOf(b.text, 70)}</div><textarea class="es-input rm-bf__input" id="rm-es-text-${esc(id)}" data-field="es.text" rows="2" maxlength="200">${esc(b.text || '')}</textarea></div>`);
          parts.push(field(id, 'es.who', 'Who said it', b.who || '', { max: 60, ph: 'Andy Reid' }));
        } else if (b.type === 'endcard') {
          const cta = b.cta || ES.DEFAULT_CTA;
          parts.push(`<div class="rm-bf-pair">${field(id, 'es.cta.0', 'Line 1', cta[0] || '', { max: 30 })}${field(id, 'es.cta.1', 'Line 2', cta[1] || '', { max: 30 })}</div>`);
          parts.push(field(id, 'plan.sourceLine', 'Source line', state.plan.sourceLine || (state.timeline && state.timeline.sourceLine) || '', { max: 120, ph: 'Source: ESPN, PFF' }));
          return parts.join('');
        } else {
          parts.push(genericBody(id, b));
        }
        parts.push(voHtml(beat));
        return parts.join('');
      }

      // ── What a scene shows ──
      const SOURCE = { 'x-clip': 'Official clip', upload: 'Your upload', 'upload-clip': 'Your clip', photo: 'ES photo', headshot: 'ES photo', tile: 'Team graphic', scene: 'AI scene', 'ai-clip': 'AI b-roll clip', design: 'Designed background', paper: 'Infographic', none: 'Infographic' };
      function mediaOf(beat) {
        const ids = state.photos[beat.id] || [];
        const asset = ids[0] ? state.assets[ids[0]] : null;
        const src = state.visualSrc[beat.id] || (asset ? (asset.kind === 'clip' ? 'x-clip' : 'photo') : 'none');
        return { asset, src, img: ids[0] && state.images[ids[0]], clip: Boolean(asset && asset.kind === 'clip'), verified: Boolean(asset && asset.verified) };
      }
      const mediaBadge = m => (m.asset ? `${m.clip ? 'Clip' : 'Photo'}${m.verified ? ' ✓' : ''}` : 'Infographic');
      // Allowed blocks for the scene: the style's list when the engine gives one.
      function blockOptions(beat, i) {
        const type = ES.blockOf(beat).type;
        const style = ui.curStyle ? ui.styleDef(ui.curStyle()) : null;
        let options = style && Array.isArray(style.blocks) && style.blocks.length ? style.blocks.filter(t => ES.BLOCKS[t]) : (i === 0 ? ['hook', 'statement'] : ['statement', 'number', 'dots', 'compare', 'quote']);
        options = options.filter(t => t !== 'endcard');
        if (!options.includes(type)) options.unshift(type);
        return options;
      }

      // ── The strip ──
      // One line under a thumbnail: the block (or v4 module) and a short title.
      // About 13 characters fit under an 80px thumbnail at 11px; the type takes its share first.
      const shortTitle = (words, room = 13) => { const w = String(words || '').replace(/[*]/g, '').replace(/\s+/g, ' ').trim(); return room < 3 ? '' : (w.length > room ? `${w.slice(0, room - 1).trim()}…` : w); };
      function cardHtml(beat, i) {
        const n = beats().length;
        const id = beat.id;
        const tl = state.timeline;
        const b = tl ? tl.beats.find(x => x.id === id) : null;
        const on = id === state.selected;
        const end = isEnd(beat, i);
        const name = ui.beatName(beat);
        const time = b ? `${ui.fmtTime(b.inMs)}–${ui.fmtTime(b.outMs)}` : '';
        const [tw, th] = thumbSize();
        const m = mediaOf(beat);
        const words = ui.v4Beat && ui.v4Beat(beat) ? (beat.vo || '') : (es() && ES.blockText ? ES.blockText(ES.blockOf(beat)) : (beat.text || ''));
        const media = takes(beat) && !end;
        const mv = ui.motionOf ? ui.motionOf(beat) : null;
        const still = Boolean(mv && !mv.ok && !end);
        return `<li class="rm-card${on ? ' is-on' : ''}${end ? ' is-end' : ''}${still ? ' is-still' : ''}" data-beat="${esc(id)}" data-ri-beat="${esc(id)}" data-kind="${esc(beat.kind)}">
          <button class="rm-card__face" type="button" data-sb-face draggable="${end ? 'false' : 'true'}" aria-pressed="${on}" aria-label="Scene ${i + 1} of ${n}, ${esc(name)}${media ? `, ${esc(mediaBadge(m))}` : ''}${still ? ', no motion yet' : ''}${time ? `, ${time}` : ''}. ${end ? 'Always last.' : 'Alt and an arrow key moves it.'}" title="${esc(`${name}: ${words || ''}`)}">
            <span class="rm-card__media"><canvas class="rm-card__thumb" width="${tw}" height="${th}" data-sb-thumb aria-hidden="true"></canvas>
              <span class="rm-card__n" aria-hidden="true">${i + 1}</span>
              ${media ? `<span class="rm-card__badge${m.asset ? (m.clip ? ' is-clip' : (m.verified ? ' is-verified' : '')) : ' is-none'}" aria-hidden="true">${m.asset ? (m.clip ? ICON.film : ICON.image) : ICON.stat}</span>` : ''}
              ${still ? '<span class="rm-card__still" aria-hidden="true">Static</span>' : ''}</span>
            <span class="rm-card__label" aria-hidden="true"><b>${esc(name)}</b><span class="rm-card__words">${words && shortTitle(words, 13 - name.length - 3) ? ` · ${esc(shortTitle(words, 13 - name.length - 3))}` : ''}</span></span>
          </button>
          ${media ? `<button class="rm-card__swap" type="button" data-visual="swap" aria-label="Swap the media for scene ${i + 1}" title="Swap media">${ICON.refresh}<span class="es-sr-only">Swap</span></button>` : ''}
          <p class="rm-beat__flag" aria-live="polite"></p>
        </li>`;
      }
      // Chapters as groups (a v4 plan); a v3 reel is one group with no heading.
      function stripHtml() {
        const all = beats();
        const groups = chaptersOf(state.plan);
        const idx = new Map(all.map((b, k) => [b.id, k]));
        if (groups.length <= 1 && !groups[0]?.headline && !(state.plan && Array.isArray(state.plan.chapters))) return all.map(cardHtml).join('');
        return groups.map(g => `<li class="rm-chap" data-chap="${esc(g.id)}"><span class="rm-chap__head"><span class="rm-chap__marker${g.tone === 'red' ? ' is-red' : ''}">${esc(g.marker)}</span><span class="rm-chap__title" title="${esc(g.headline)}">${esc(g.headline || `Chapter ${g.n}`)}</span></span>
          <ol class="rm-chap__beats" aria-label="${esc(`Chapter ${g.n}${g.headline ? `: ${g.headline}` : ''}`)}">${g.beats.map(b => cardHtml(b, idx.get(b.id))).join('')}</ol></li>`).join('');
      }
      // Thumbnails: the real renderer, past the wipe and the entrances.
      function drawThumb(card) {
        const cv = card && card.querySelector('[data-sb-thumb]');
        const tl = state.timeline;
        const b = tl && tl.beats.find(x => x.id === card.dataset.beat);
        if (!cv || !b) return;
        const [tw, th] = thumbSize();
        if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
        const size = tl.size || [1080, 1920];
        const g = cv.getContext('2d');
        const t = Math.min(b.outMs - 1, Math.max(b.inMs + 1, b.inMs + Math.min((b.outMs - b.inMs) * 0.7, 1800)));
        const k = tw / size[0];
        g.save();
        g.setTransform(k, 0, 0, k, 0, 0);
        try { R.drawFrame(g, tl, t, ui.envFor(tl)); } catch (error) { window.FrameUpErrors?.report?.(error, 'reels storyboard thumb'); }
        g.restore();
      }
      let seen = 0;
      function refresh() {
        if (!state.plan || !state.timeline) return;
        const cards = [...list.querySelectorAll('.rm-card')];
        if (cards.length !== beats().length) { render(); return; }
        cards.forEach(card => {
          drawThumb(card);
          const beat = beatOf(card.dataset.beat);
          const w = card.querySelector('.rm-card__words');
          if (beat && w && es() && ES.blockText && !(ui.v4Beat && ui.v4Beat(beat))) { const nm = ui.beatName(beat); const t = shortTitle(ES.blockText(ES.blockOf(beat)), 13 - nm.length - 3); w.textContent = t ? ` · ${t}` : ''; }
        });
        drawEditorThumb();
        seen = Object.keys(state.images).length;
      }
      function keepFocus(fn) {
        const active = document.activeElement;
        const inside = active && (list.contains(active) || (editorEl && editorEl.contains(active)));
        const keepId = inside ? active.id : '';
        const face = inside && active.matches('[data-sb-face]') ? active.closest('[data-beat]').dataset.beat : '';
        const caret = keepId && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
        fn();
        if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus({ preventScroll: true }); if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } } } }
        else if (face) cardOf(face)?.querySelector('[data-sb-face]')?.focus({ preventScroll: true });
      }
      function render() {
        if (!state.plan) { list.innerHTML = ''; if (editorEl) { editorEl.innerHTML = ''; editorEl.hidden = true; } return; }
        if (!beats().some(b => b.id === state.selected)) state.selected = beats()[0]?.id || '';
        keepFocus(() => { list.innerHTML = stripHtml(); renderEditor(); });
        refresh();
        playhead();
      }
      function rerender(id) {
        const card = cardOf(id);
        const i = beats().findIndex(b => b.id === id);
        if (!card || i < 0) { render(); return; }
        keepFocus(() => { card.outerHTML = cardHtml(beats()[i], i); if (id === state.selected) renderEditor(); });
        drawThumb(cardOf(id));
        drawEditorThumb();
        ctx.renderLint();
      }
      // Keeps a card in view inside the strip only (never scrolls the page).
      function scrollToCard(card) {
        const box = card && card.closest('.rm-sb__scroll');
        if (!box) return;
        const r = card.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const pad = 32;
        if (r.left < b.left + pad) box.scrollLeft -= (b.left + pad) - r.left;
        else if (r.right > b.right - pad) box.scrollLeft += r.right - (b.right - pad);
      }
      // The playhead: a hairline over the strip at the preview's time.
      const head = document.getElementById('rm-playhead');
      let lastLive = '';
      function playhead(t = state.t) {
        const tl = state.timeline;
        const box = list.closest('.rm-sb__scroll');
        if (!head || !box) return;
        const b = tl ? tl.beats.find(x => t >= x.inMs && t < x.outMs) || tl.beats[tl.beats.length - 1] : null;
        const card = b && cardOf(b.id);
        const media = card && card.querySelector('.rm-card__media');
        if (!media) { head.hidden = true; return; }
        const r = media.getBoundingClientRect();
        const o = box.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (t - b.inMs) / Math.max(1, b.outMs - b.inMs)));
        head.hidden = false;
        head.style.transform = `translateX(${(r.left - o.left + box.scrollLeft + f * r.width).toFixed(1)}px)`;
        head.style.top = `${(r.top - o.top + box.scrollTop - 4).toFixed(1)}px`;
        head.style.height = `${(r.height + 8).toFixed(1)}px`;
        if (state.playing && b.id !== lastLive) { lastLive = b.id; scrollToCard(card); }
      }
      function select(id, { focus = false } = {}) {
        list.querySelectorAll('.rm-card').forEach(card => {
          const on = card.dataset.beat === id;
          card.classList.toggle('is-on', on);
          card.querySelector('[data-sb-face]')?.setAttribute('aria-pressed', String(on));
        });
        if (state.swapOpen && state.swapOpen !== id) state.swapOpen = '';
        keepFocus(renderEditor);
        const card = cardOf(id);
        if (!card) return;
        scrollToCard(card);
        if (focus) (editorEl.querySelector('input, textarea') || card.querySelector('[data-sb-face]'))?.focus({ preventScroll: true });
      }

      // ── The picked scene's editor (Review panel) ──
      let swapJob = 0;
      function mediaSection(beat, i) {
        const m = mediaOf(beat);
        const note = state.visualNote && state.visualNote[beat.id];
        const open = state.swapOpen === beat.id;
        const credit = m.asset && m.asset.rights && m.asset.rights.credit ? ` · ${m.asset.rights.credit}` : '';
        // A photo says "shows the right person" only when vision checked it; an agency caption says so.
        const by = m.asset && m.asset.checkedBy;
        const what = m.clip ? 'Checked: right subject and moment' : (by === 'caption' ? 'From an agency caption' : (by && by !== 'vision' ? 'Checked by its source' : 'Checked: shows the right person'));
        const shortNote = m.clip && m.asset.short ? '<span class="rm-meta">The clip is shorter than the scene, so it loops.</span>' : '';
        const status = m.asset ? (m.verified ? `<span class="rm-verified${by === 'caption' && !m.clip ? ' is-caption' : ''}">${by === 'caption' && !m.clip ? '' : ICON.check}<span>${what}</span></span>${shortNote}` : (ui.sourcingOn && ui.sourcingOn() ? '' : '<span class="rm-meta">Not checked yet</span>')) : '<span class="rm-meta">No clip or photo matched this scene, so it is an infographic.</span>';
        return `<div class="rm-scene__media">
          <div class="rm-scene__mediarow">
            <span class="rm-scene__thumb${m.img ? '' : ' is-empty'}" aria-hidden="true">${m.img ? (m.img.tagName === 'CANVAS' ? '<span data-sb-poster></span>' : `<img src="${esc(m.img.src)}" alt="">`) : ICON.image}</span>
            <div class="rm-scene__mediameta"><p class="rm-scene__src">${esc(SOURCE[m.src] || m.src)}${esc(credit)}</p>${note ? `<p class="rm-hint">${esc(note)}</p>` : status}</div>
            <button class="es-btn es-btn--sm" type="button" data-sb-swap aria-expanded="${open}" aria-controls="rm-swap-${esc(beat.id)}">${ICON.refresh}<span>Swap</span></button>
          </div>
          <div class="rm-swap" id="rm-swap-${esc(beat.id)}" ${open ? '' : 'hidden'}>
            <ul class="rm-swap__grid" data-swap-list aria-label="Other media for scene ${i + 1}" aria-busy="true"><li class="rm-swap__sk"><span class="es-skeleton"></span></li><li class="rm-swap__sk"><span class="es-skeleton"></span></li><li class="rm-swap__sk"><span class="es-skeleton"></span></li></ul>
            <div class="rm-swap__more" role="group" aria-label="More ways">
              <button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-visual="photo">${ICON.image}<span>Search ES photos</span></button>
              <button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-visual="upload">${ICON.upload}<span>Upload</span></button>
              ${m.asset ? `<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-sb-nomedia>${ICON.stat}<span>Use an infographic</span></button>` : ''}
            </div>
          </div>
        </div>`;
      }
      async function fillSwap(id) {
        const box = editorEl.querySelector('[data-swap-list]');
        if (!box || state.swapOpen !== id) return;
        const job = ++swapJob;
        const cands = await ui.swapCandidates(id).catch(() => []);
        if (job !== swapJob || state.swapOpen !== id) return;
        const target = editorEl.querySelector('[data-swap-list]');
        if (!target) return;
        target.setAttribute('aria-busy', 'false');
        swapCache.set(id, cands);
        const now = ui.mediaKey(id);
        target.innerHTML = cands.length ? cands.map((c, k) => `<li><button class="rm-swap__item${c.key === now ? ' is-on' : ''}" type="button" data-cand="${k}" aria-pressed="${c.key === now}" aria-label="${esc(`${c.kind === 'clip' ? 'Clip' : 'Photo'}: ${c.label}${c.by ? `, ${c.by}` : ''}${c.verified ? ', checked' : ''}`)}" title="${esc(c.label)}">
            ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">` : `<span class="rm-swap__noimg">${ICON.film}</span>`}
            <span class="rm-swap__tag">${c.kind === 'clip' ? ICON.film : ICON.image}${c.verified ? ICON.check : ''}</span></button></li>`).join('')
          : `<li class="rm-swap__empty"><p>${ui.sourcingOn && ui.sourcingOn() ? 'No other clip or photo passed the check for this scene.' : 'No other media found for this scene.'}</p></li>`;
      }
      const swapCache = new Map();
      // ── Plan v4 scenes: media kind, module, stamp, tag, the chapter headline ──
      const MEDIA_NAME = { clip: 'Game clip', presser: 'Press clip', photo: 'Photo', cards: 'Name cards', cutout: 'Cut-out', none: 'None' };
      const MODULES = ['scoreboard', 'bars', 'numberLine', 'dotGrid', 'scatter', 'wl', 'rankList', 'statTiles', 'reveal', 'compare', 'tally', 'calendar', 'timeline', 'playDiagram', 'flow', 'checklist', 'quote', 'lineChart'];
      function moduleSelect(beat) {
        const id = beat.id;
        const cur = beat.module && beat.module.type ? beat.module.type : '';
        const label = ui.moduleLabel || {};
        return `<div class="rm-bf rm-scene__block rm-scene__block--stack"><label class="rm-bf__label" for="rm-module-${esc(id)}">Module</label><select class="es-select es-select--sm rm-bf__input" id="rm-module-${esc(id)}" data-sb-module>
          <option value=""${cur ? '' : ' selected'}>None (media only)</option>${MODULES.map(t => `<option value="${t}"${t === cur ? ' selected' : ''}>${esc(label[t] || nice(t))}</option>`).join('')}</select></div>`;
      }
      function chapterOf(beat) { return (state.plan.chapters || []).find(c => (c.beats || []).some(b => b.id === beat.id)) || null; }
      function v4Body(beat) {
        const id = beat.id;
        const parts = [];
        const ch = chapterOf(beat);
        if (ch && ch.beats[0] && ch.beats[0].id === id) parts.push(field(id, 'chap.headline', 'Chapter headline', ch.headline || '', { max: 60, ph: 'DALLAS BLEW A *21-POINT LEAD*' }), '<p class="rm-hint">Holds for the whole chapter. Wrap one word in *asterisks* to colour it.</p>');
        if (beat.media && beat.media.kind !== 'none') parts.push(field(id, 'v4.media.label', 'Media label', (beat.media && beat.media.label) || '', { max: 24, ph: 'EAGLES BALL' }));
        parts.push(`<div class="rm-bf-pair">${field(id, 'v4.stamp.text', 'Stamp', (beat.stamp && beat.stamp.text) || '', { max: 24, ph: 'BAD CALL' })}${field(id, 'v4.tag.text', 'Tag', (beat.tag && beat.tag.text) || '', { max: 28, ph: '0:02 LEFT' })}</div>`);
        if (beat.module && beat.module.type) parts.push(`<div class="rm-modfields">${genericBody(id, beat.module).replace(/data-field="es\./g, 'data-field="v4.module.').replace(/id="rm-es-/g, 'id="rm-v4m-')}</div><p class="rm-hint">Numbers must come from a source.</p>`);
        parts.push(voHtml(beat));
        return parts.join('');
      }
      // Ask AI about this one scene: the visuals change, your words do not.
      function askHtml(beat, i) {
        if (!ui.reviseBeat || !state.config.ai || state.config.offline) return '';
        return `<form class="rm-askbeat" data-sb-ask><label class="rm-bf__label" for="rm-askbeat-${esc(beat.id)}">Ask AI about scene ${i + 1}</label>
          <div class="rm-askbeat__row"><input class="es-input" id="rm-askbeat-${esc(beat.id)}" type="text" maxlength="200" placeholder="Show the clip from the 4th down"><button class="es-btn" type="submit">${ICON.sparkles || ''}<span>Ask</span></button></div>
          <p class="rm-hint">Changes the media, module or on-screen words. Your script stays as written.</p></form>`;
      }
      function renderEditor() {
        if (!editorEl) return;
        const i = beats().findIndex(b => b.id === state.selected);
        const beat = beats()[i];
        editorEl.hidden = !beat || state.step !== 'edit';
        if (!beat) { editorEl.innerHTML = ''; return; }
        const id = beat.id;
        const n = beats().length;
        const end = isEnd(beat, i);
        const endI = endAt();
        const tl = state.timeline;
        const b = tl ? tl.beats.find(x => x.id === id) : null;
        const voiced = state.voice[id] && state.voice[id].text === beat.vo;
        let side = '';
        let body = '';
        if (ui.v4Beat && ui.v4Beat(beat)) {
          side = moduleSelect(beat);
          body = `${takes(beat) ? `<h4 class="rm-insp__h">Media · ${esc(MEDIA_NAME[beat.media.kind] || beat.media.kind)}</h4>${mediaSection(beat, i)}` : ''}<h4 class="rm-insp__h">On screen</h4><div class="rm-beat__fields">${v4Body(beat)}</div>${askHtml(beat, i)}`;
        } else if (es()) {
          const type = ES.blockOf(beat).type;
          side = end ? '<span class="rm-meta">The end card is always last.</span>'
            : `<div class="rm-bf rm-scene__block rm-scene__block--stack"><label class="rm-bf__label" for="rm-estype-${esc(id)}">Block</label><select class="es-select es-select--sm rm-bf__input" id="rm-estype-${esc(id)}" data-field="es.type">${blockOptions(beat, i).map(t => `<option value="${t}"${t === type ? ' selected' : ''}>${esc(ES.BLOCKS[t].label)}</option>`).join('')}</select></div>`;
          body = `${!end && takes(beat) ? `<h4 class="rm-insp__h">Media</h4>${mediaSection(beat, i)}` : ''}<h4 class="rm-insp__h">${end ? 'End card' : 'On screen'}</h4><div class="rm-beat__fields">${esBody(beat)}</div>${end ? '' : askHtml(beat, i)}`;
        } else {
          body = `${beat.kind === 'cta' ? '' : ctx.visualCard(beat)}<div class="rm-beat__fields">${ctx.beatFields(beat, i)}</div>`;
        }
        editorEl.dataset.beat = id;
        editorEl.dataset.riBeat = id;
        editorEl.setAttribute('aria-label', `Scene ${i + 1} of ${n}`);
        const prev = beats()[i - 1];
        const next = beats()[i + 1];
        editorEl.innerHTML = `<div class="rm-scene__head">
            <div class="rm-scene__title"><span class="rm-scene__n">Scene ${i + 1}<span class="rm-meta"> / ${n}</span></span><span class="rm-meta">${b ? `${ui.fmtTime(b.inMs)}–${ui.fmtTime(b.outMs)}` : ''}${voiced ? ' · VO ready' : ''}</span></div>
            <div class="rm-scene__nav" role="group" aria-label="Go to scene">
              <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-go="${prev ? esc(prev.id) : ''}" aria-label="Previous scene" title="Previous scene"${prev ? '' : ' disabled'}>${ICON.left}</button>
              <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-go="${next ? esc(next.id) : ''}" aria-label="Next scene" title="Next scene"${next ? '' : ' disabled'}>${ICON.chevronRight}</button>
            </div>
          </div>
          <div class="rm-scene__body">
          ${side}
          <p class="rm-scene__flag" data-scene-flag hidden></p>
          ${body}
          ${end ? '' : `<div class="rm-scene__actions" role="group" aria-label="Scene ${i + 1}">
              <span class="rm-bf__label">Scene</span>
              <button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-sb-move="-1" aria-label="Move scene ${i + 1} earlier"${canMove(n, i, i - 1, endI) ? '' : ' disabled'}>${ICON.up}<span>Earlier</span></button>
              <button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-sb-move="1" aria-label="Move scene ${i + 1} later"${canMove(n, i, i + 1, endI) ? '' : ' disabled'}>${ICON.down}<span>Later</span></button>
              <button class="es-btn es-btn--sm es-btn--tertiary rm-scene__del" type="button" data-remove aria-label="Delete scene ${i + 1}"${n <= 2 ? ' disabled' : ''}>${ICON.trash}<span>Delete</span></button>
            </div>`}
          </div>`;
        drawEditorThumb();
        if (state.swapOpen === id) fillSwap(id);
      }
      function drawEditorThumb() {
        const holder = editorEl && editorEl.querySelector('[data-sb-poster]');
        if (!holder) return;
        const img = state.images[(state.photos[editorEl.dataset.beat] || [])[0]];
        if (!img || img.tagName !== 'CANVAS') return;
        const c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        const k = Math.max(96 / img.width, 96 / img.height);
        c.getContext('2d').drawImage(img, (96 - img.width * k) / 2, (96 - img.height * k) / 2, img.width * k, img.height * k);
        holder.replaceWith(c);
      }

      // ── Reorder ──
      function moveTo(id, to, { via = 'button' } = {}) {
        const all = beats();
        const from = all.findIndex(b => b.id === id);
        const next = move(all, from, to, endAt());
        if (!next) {
          if (from >= 0) say(from === endAt() ? 'The end card stays last.' : (to >= endAt() && endAt() >= 0 ? 'The end card stays last. This scene is already just before it.' : (to < 0 ? 'This is the first scene.' : 'This scene cannot move there.')));
          return false;
        }
        state.plan.beats = next;
        state.selected = id;
        ctx.rebuild();
        render();
        select(id);
        say(`${ctx.modules.a11y ? ctx.modules.a11y.moveText({ from, to, total: next.length }) : `Scene ${from + 1} moved to position ${to + 1} of ${next.length}`}`);
        ctx.logEvent('edit', { what: 'reorder', via });
        return true;
      }
      const moveBy = (id, delta, opts) => moveTo(id, beats().findIndex(b => b.id === id) + delta, opts);

      // ── Structured edits (rows with colour chips, the stamp, the number colour) ──
      function commitRows(group) {
        const card = group.closest('[data-beat]');
        const beat = beatOf(card.dataset.beat);
        if (!beat) return;
        const key = group.dataset.sbRows;
        const rows = [...group.querySelectorAll('[data-sb-row]')].map(row => {
          const color = row.querySelector('[data-sb-color][aria-checked="true"]');
          if (key === 'items') return { label: row.querySelector('[data-sb-label]').value, display: row.querySelector('[data-sb-display]').value, color: color ? color.dataset.sbColor : '' };
          return { text: row.querySelector('[data-sb-text]').value, color: color ? color.dataset.sbColor : 'ink' };
        });
        ctx.setField(beat, `es.${key}`, rows);
        ui.edited();
      }
      editorEl.addEventListener('input', event => {
        const t = event.target;
        if (t.matches('[data-sb-text], [data-sb-label], [data-sb-display]')) {
          const counter = t.closest('[data-sb-row]').querySelector('[data-sb-count]');
          if (counter) { const max = Number(counter.dataset.sbCount); const n = t.value.trim().length; counter.textContent = `${n}/${max}`; counter.classList.toggle('is-over', n > max); }
          commitRows(t.closest('[data-sb-rows]'));
          return;
        }
        if (t.dataset.field === 'es.text') { const counter = t.closest('.rm-bf').querySelector('[data-sb-count]'); if (counter) { const n = t.value.trim().length; counter.textContent = `${n}/70`; counter.classList.toggle('is-over', n > 70); } }
        if (t.dataset.field === 'es.count' || t.dataset.field === 'es.highlight') {
          const line = editorEl.querySelector('[data-sb-dots]');
          if (line) line.textContent = `${dotsLine(editorEl.querySelector('[data-field="es.count"]').value, editorEl.querySelector('[data-field="es.highlight"]').value)} Up to 2,600.`;
        }
      });
      editorEl.addEventListener('submit', event => {
        const form = event.target.closest('[data-sb-ask]');
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector('input');
        const v = input.value.trim();
        if (v.length < 3) { input.focus(); return; }
        ui.reviseBeat(editorEl.dataset.beat, v, form);
      });
      editorEl.addEventListener('change', event => {
        const mod = event.target.closest('[data-sb-module]');
        if (mod) {
          const beat = beatOf(editorEl.dataset.beat);
          if (!beat) return;
          ui.setModule(beat, mod.value);
          rerender(beat.id);
          document.getElementById(`rm-module-${beat.id}`)?.focus({ preventScroll: true });
          return;
        }
        const box = event.target.closest('[data-sb-stamp]');
        if (!box) return;
        const beat = beatOf(editorEl.dataset.beat);
        if (!beat) return;
        const block = ES.blockOf(beat);
        ctx.setField(beat, 'es.stamp', box.checked ? { text: stampWord(beat.vo, (block.pills || []).map(p => p.text)) || 'BIG' } : null);
        ctx.rebuild();
        rerender(beat.id);
        (box.checked ? editorEl.querySelector('[data-field="es.stamp.text"]') : editorEl.querySelector('[data-sb-stamp]'))?.focus({ preventScroll: true });
      });
      editorEl.addEventListener('click', event => {
        const t = event.target;
        const id = editorEl.dataset.beat;
        const beat = beatOf(id);
        if (!beat) return;
        if (t.closest('[data-sb-swap]')) {
          state.swapOpen = state.swapOpen === id ? '' : id;
          keepFocus(renderEditor);
          editorEl.querySelector('[data-sb-swap]')?.focus({ preventScroll: true });
          if (state.swapOpen) ctx.logEvent('visuals', { action: 'swap-open' });
          return;
        }
        if (t.closest('[data-sb-editvo]')) {
          state.voEdit[id] = true;
          keepFocus(renderEditor);
          const ta = document.getElementById(`rm-vo-${id}`);
          if (ta && ta.tagName === 'TEXTAREA') { ta.focus({ preventScroll: true }); ui.voBefore?.(id); }
          return;
        }
        const go = t.closest('[data-sb-go]');
        if (go) { if (go.dataset.sbGo) { ctx.selectBeat(go.dataset.sbGo, { seek: true }); editorEl.querySelector(`[data-sb-go]:not(:disabled)`)?.focus({ preventScroll: true }); } return; }
        const cand = t.closest('[data-cand]');
        if (cand) { const c = (swapCache.get(id) || [])[Number(cand.dataset.cand)]; if (c) ui.useCandidate(id, c); return; }
        if (t.closest('[data-sb-nomedia]')) { ui.useNoMedia(id); return; }
        const mv = t.closest('[data-sb-move]');
        if (mv) {
          const delta = Number(mv.dataset.sbMove);
          if (moveBy(id, delta)) (editorEl.querySelector(`[data-sb-move="${delta}"]:not(:disabled)`) || editorEl.querySelector('[data-sb-move]:not(:disabled)'))?.focus({ preventScroll: true });
          return;
        }
        const chip = t.closest('[data-sb-color]');
        if (chip) {
          const set = chip.closest('.rm-chipset');
          set.querySelectorAll('[data-sb-color]').forEach(c => { const on = c === chip; c.setAttribute('aria-checked', String(on)); c.tabIndex = on ? 0 : -1; });
          if (set.dataset.sbSingle) { ctx.setField(beat, set.dataset.sbSingle, chip.dataset.sbColor); ui.edited(); } else commitRows(chip.closest('[data-sb-rows]'));
          ctx.rebuild();
          return;
        }
        const add = t.closest('[data-sb-add]');
        const del = t.closest('[data-sb-del]');
        if (add || del) {
          const group = (add || del).closest('[data-sb-rows]');
          const key = group.dataset.sbRows;
          const block = ES.blockOf(beat);
          const rows = [...group.querySelectorAll('[data-sb-row]')];
          const at = del ? rows.indexOf(del.closest('[data-sb-row]')) : rows.length;
          const values = rows.map(row => { const color = row.querySelector('[data-sb-color][aria-checked="true"]'); return key === 'items' ? { label: row.querySelector('[data-sb-label]').value || ' ', display: row.querySelector('[data-sb-display]').value, color: color ? color.dataset.sbColor : '' } : { text: row.querySelector('[data-sb-text]').value || ' ', color: color ? color.dataset.sbColor : 'ink' }; });
          if (del) values.splice(at, 1); else values.push(key === 'items' ? { label: 'NEW BAR', display: '0', color: 'ink' } : { text: key === 'pills' ? 'NEW PILL' : 'NEW LINE', color: (block[key] || []).length ? 'blue' : 'ink' });
          ctx.setField(beat, `es.${key}`, values.map(v => (key === 'items' ? { ...v, label: v.label.trim() || 'BAR' } : { ...v, text: v.text.trim() || (key === 'pills' ? 'PILL' : 'LINE') })));
          ctx.rebuild();
          rerender(id);
          const again = editorEl.querySelector(`[data-sb-rows="${key}"]`);
          const inputs = again ? again.querySelectorAll(key === 'items' ? '[data-sb-label]' : '[data-sb-text]') : [];
          const focusAt = inputs[Math.min(del ? Math.max(0, at - 1) : inputs.length - 1, inputs.length - 1)];
          if (focusAt) { focusAt.focus({ preventScroll: true }); if (add) focusAt.select(); }
          ctx.logEvent('edit', { what: add ? 'row-add' : 'row-remove', block: block.type });
        }
      });

      // ── The strip: pick, Swap, keyboard reorder, drag ──
      list.addEventListener('click', event => {
        const t = event.target;
        const card = t.closest('[data-beat]');
        if (!card) return;
        const id = card.dataset.beat;
        if (t.closest('[data-sb-face]')) { ctx.selectBeat(id, { seek: true }); }
      });
      list.addEventListener('focusin', event => {
        const face = event.target.closest('[data-sb-face]');
        const card = face && face.closest('[data-beat]');
        if (card && card.dataset.beat !== state.selected && !dragging) ctx.selectBeat(card.dataset.beat, { seek: true });
      });
      list.addEventListener('keydown', event => {
        if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const card = event.target.closest('[data-beat]');
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        const id = card.dataset.beat;
        moveBy(id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1, { via: 'keyboard' });
        cardOf(id)?.querySelector('[data-sb-face]')?.focus({ preventScroll: true });
      }, true);
      let dragging = '';
      const clearDrop = () => list.querySelectorAll('[data-drop]').forEach(el => el.removeAttribute('data-drop'));
      list.addEventListener('dragstart', event => {
        const face = event.target.closest && event.target.closest('[data-sb-face]');
        if (!face || !event.dataTransfer) return;
        const card = face.closest('[data-beat]');
        dragging = card.dataset.beat;
        event.dataTransfer.setData('application/x-rm-scene', dragging);
        event.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      const overCard = event => {
        const card = event.target.closest && event.target.closest('[data-beat]');
        if (!card) return null;
        const r = card.getBoundingClientRect();
        return { card, after: event.clientX > r.left + r.width / 2 };
      };
      list.addEventListener('dragover', event => {
        if (!dragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const hit = overCard(event);
        clearDrop();
        if (hit && hit.card.dataset.beat !== dragging) hit.card.dataset.drop = hit.after ? 'after' : 'before';
      });
      list.addEventListener('drop', event => {
        if (!dragging) return;
        event.preventDefault();
        const hit = overCard(event);
        const id = dragging;
        dragging = '';
        clearDrop();
        if (!hit) return;
        const all = beats();
        const from = all.findIndex(b => b.id === id);
        const over = all.findIndex(b => b.id === hit.card.dataset.beat);
        const to = dropIndex(from, over, hit.after, all.length, endAt());
        if (to !== from) moveTo(id, to, { via: 'drag' });
      });
      list.addEventListener('dragend', () => { dragging = ''; clearDrop(); list.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging')); });

      // The scene on screen while it plays.
      ctx.on('scene', ({ id }) => { list.querySelectorAll('.rm-card').forEach(card => card.classList.toggle('is-live', card.dataset.beat === id)); });
      ctx.on('time', ({ t }) => playhead(t));
      list.closest('.rm-sb__scroll')?.addEventListener('scroll', () => playhead(), { passive: true });
      if (window.ResizeObserver) new ResizeObserver(() => playhead()).observe(list);
      ctx.on('step', ({ step }) => { if (editorEl) editorEl.hidden = step !== 'edit' || !state.plan; });
      // Photos and clips arrive after the cards are drawn: thumbnails catch up.
      setInterval(() => { if (state.plan && state.step === 'edit' && !document.hidden && Object.keys(state.images).length !== seen) refresh(); }, 1500);

      ctx.register('storyboard', { render, refresh, select, rerender, editor: () => keepFocus(renderEditor), move: moveBy, moveTo, COLORS });
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { COLORS, ROWS, endIndex, canMove, move, dropIndex, stampWord, dotsLine, markerText, chaptersOf, motionOf, readiness, MOTION_BLOCKS, relink, linkV4, ensureV4, isV4, keepsScript, looseWords, scriptMeter, attach };
}));
