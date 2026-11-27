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
      const takes = beat => (es() ? ES.takesMedia(beat) : beat.kind !== 'cta');
      // The cards show the ES safe frame (y 290 to 1650), where every word sits.
      const CROP = { y: 290, h: 1360 };
      const thumbSize = () => { const s = (state.timeline && state.timeline.size) || [1080, 1920]; return s[1] === 1350 ? [240, 300] : [240, Math.round(240 * CROP.h / 1080)]; };

      // ── Fields ──
      const field = (id, name, label, value, { max = 120, type = 'text', ph = '', cls = '' } = {}) => `<div class="rm-bf${cls ? ` ${cls}` : ''}"><label class="rm-bf__label" for="${fid(name, id)}">${label}</label><input class="es-input rm-bf__input" id="${fid(name, id)}" data-field="${name}" type="${type}" maxlength="${max}" value="${esc(value == null ? '' : value)}" placeholder="${esc(ph)}"${type === 'number' ? ' inputmode="decimal" step="any"' : ''}></div>`;
      const chips = (value, label, attr = '') => `<div class="rm-chipset" role="radiogroup" aria-label="${esc(label)}"${attr}>${COLORS.map((c, k) => { const on = c.id === value; const tab = on || (!COLORS.some(x => x.id === value) && k === 0); return `<button class="rm-cchip rm-cchip--${c.id}" type="button" role="radio" aria-checked="${on}" tabindex="${tab ? 0 : -1}" data-sb-color="${c.id}" aria-label="${c.label}" title="${c.label}"></button>`; }).join('')}</div>`;
      const countOf = (text, max) => { const n = String(text || '').trim().length; return `<span class="rm-count${n > max ? ' is-over' : ''}" data-sb-count="${max}">${n}/${max}</span>`; };
      function rowsHtml(id, key, rows) {
        const def = ROWS[key];
        const Noun = def.noun[0].toUpperCase() + def.noun.slice(1);
        const row = (x, k) => {
          const del = `<button class="rm-icon-btn rm-icon-btn--sm rm-row__del" type="button" data-sb-del aria-label="Remove ${def.noun} ${k + 1}" title="Remove"${rows.length <= def.min ? ' disabled' : ''}>${ICON.x}</button>`;
          if (key === 'items') {
            return `<div class="rm-row rm-row--bar" data-sb-row>
              <div class="rm-row__pair"><input class="es-input rm-bf__input" id="rm-es-items-${k}-label-${esc(id)}" data-sb-label type="text" maxlength="28" value="${esc(x.label || '')}" aria-label="Bar ${k + 1} label" placeholder="Label">
              <input class="es-input rm-bf__input" id="rm-es-items-${k}-value-${esc(id)}" data-sb-display type="text" maxlength="16" value="${esc(x.display || (x.value == null ? '' : x.value))}" aria-label="Bar ${k + 1} value, as shown" placeholder="$692M"></div>
              <div class="rm-row__meta">${chips(x.color || '', `Bar ${k + 1} colour`)}${del}</div></div>`;
          }
          return `<div class="rm-row" data-sb-row>
            <input class="es-input rm-bf__input" id="rm-es-${key}-${k}-${esc(id)}" data-sb-text type="text" maxlength="40" value="${esc(x.text || '')}" aria-label="${Noun} ${k + 1}" placeholder="${esc(def.placeholder)}">
            <div class="rm-row__meta">${chips(x.color || 'ink', `${Noun} ${k + 1} colour`)}${countOf(x.text, def.chars)}${del}</div></div>`;
        };
        return `<div class="rm-rows" data-sb-rows="${key}" role="group" aria-label="${def.title}">
          <span class="rm-bf__label">${def.title}</span>
          ${rows.map(row).join('')}
          ${rows.length < def.max ? `<button class="rm-addrow" type="button" data-sb-add="${key}">${ICON.plus}<span>Add a ${def.noun}</span></button>` : ''}
        </div>`;
      }
      function voHtml(beat) {
        const id = beat.id;
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
        const words = es() && ES.blockText ? ES.blockText(ES.blockOf(beat)) : (beat.text || '');
        const media = takes(beat) && !end;
        return `<li class="rm-card${on ? ' is-on' : ''}${end ? ' is-end' : ''}" data-beat="${esc(id)}" data-ri-beat="${esc(id)}" data-kind="${esc(beat.kind)}">
          <button class="rm-card__face" type="button" data-sb-face draggable="${end ? 'false' : 'true'}" aria-pressed="${on}" aria-label="Scene ${i + 1} of ${n}, ${esc(name)}${media ? `, ${esc(mediaBadge(m))}` : ''}${time ? `, ${time}` : ''}. ${end ? 'Always last.' : 'Alt and an arrow key moves it.'}">
            <span class="rm-card__media"><canvas class="rm-card__thumb" width="${tw}" height="${th}" data-sb-thumb aria-hidden="true"></canvas>
              <span class="rm-card__n" aria-hidden="true">${i + 1}</span>
              ${media ? `<span class="rm-card__badge${m.asset ? (m.verified ? ' is-verified' : '') : ' is-none'}" aria-hidden="true">${esc(mediaBadge(m))}</span>` : ''}</span>
            <span class="rm-card__body" aria-hidden="true"><span class="rm-card__block">${esc(name)}</span><span class="rm-card__words">${esc(words || '—')}</span></span>
          </button>
          ${media ? `<button class="rm-card__swap" type="button" data-visual="swap" aria-label="Swap the media for scene ${i + 1}" title="Swap media">${ICON.refresh}<span>Swap</span></button>` : ''}
          <p class="rm-beat__flag" aria-live="polite"></p>
        </li>`;
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
        const y0 = size[1] === 1350 ? 0 : CROP.y;
        g.save();
        g.setTransform(k, 0, 0, k, 0, -y0 * k);
        try { R.drawFrame(g, tl, t, ui.envFor(tl)); } catch (error) { window.FrameUpErrors?.report?.(error, 'reels storyboard thumb'); }
        g.restore();
      }
      let seen = 0;
      function refresh() {
        if (!state.plan || !state.timeline) return;
        if (list.children.length !== beats().length) { render(); return; }
        [...list.children].forEach(card => {
          drawThumb(card);
          const beat = beatOf(card.dataset.beat);
          const w = card.querySelector('.rm-card__words');
          if (beat && w && es() && ES.blockText) w.textContent = ES.blockText(ES.blockOf(beat)) || '—';
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
        keepFocus(() => { list.innerHTML = beats().map(cardHtml).join(''); renderEditor(); });
        refresh();
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
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (focus) (editorEl.querySelector('input, textarea') || card.querySelector('[data-sb-face]'))?.focus({ preventScroll: true });
      }

      // ── The picked scene's editor (Review panel) ──
      let swapJob = 0;
      function mediaSection(beat, i) {
        const m = mediaOf(beat);
        const note = state.visualNote && state.visualNote[beat.id];
        const open = state.swapOpen === beat.id;
        const credit = m.asset && m.asset.rights && m.asset.rights.credit ? ` · ${m.asset.rights.credit}` : '';
        const status = m.asset ? (m.verified ? `<span class="rm-verified">${ICON.check}<span>Checked: ${m.clip ? 'right subject and moment' : 'shows the right person'}</span></span>` : (ui.sourcingOn && ui.sourcingOn() ? '' : '<span class="rm-meta">Not checked yet</span>')) : '<span class="rm-meta">No clip or photo matched this scene, so it is an infographic.</span>';
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
        if (es()) {
          const type = ES.blockOf(beat).type;
          side = end ? '<span class="rm-meta">The end card is always last.</span>'
            : `<div class="rm-bf rm-scene__block"><label class="rm-bf__label" for="rm-estype-${esc(id)}">Block</label><select class="es-select es-select--sm rm-bf__input" id="rm-estype-${esc(id)}" data-field="es.type">${blockOptions(beat, i).map(t => `<option value="${t}"${t === type ? ' selected' : ''}>${esc(ES.BLOCKS[t].label)}</option>`).join('')}</select></div>`;
          body = `${!end && takes(beat) ? mediaSection(beat, i) : ''}<div class="rm-beat__fields">${esBody(beat)}</div>`;
        } else {
          body = `${beat.kind === 'cta' ? '' : ctx.visualCard(beat)}<div class="rm-beat__fields">${ctx.beatFields(beat, i)}</div>`;
        }
        editorEl.dataset.beat = id;
        editorEl.dataset.riBeat = id;
        editorEl.setAttribute('aria-label', `Scene ${i + 1} of ${n}`);
        editorEl.innerHTML = `<div class="rm-scene__head">
            <div class="rm-scene__title"><span class="rm-scene__n">Scene ${i + 1}<span class="rm-meta"> of ${n}</span></span><span class="rm-meta">${b ? `${ui.fmtTime(b.inMs)}–${ui.fmtTime(b.outMs)}` : ''}${voiced ? ' · VO ready' : ''}</span></div>
            ${end ? '' : `<div class="rm-card__tools" role="group" aria-label="Scene ${i + 1}">
              <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-move="-1" aria-label="Move scene ${i + 1} earlier" title="Move earlier"${canMove(n, i, i - 1, endI) ? '' : ' disabled'}>${ICON.left}</button>
              <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-move="1" aria-label="Move scene ${i + 1} later" title="Move later"${canMove(n, i, i + 1, endI) ? '' : ' disabled'}>${ICON.chevronRight}</button>
              <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-remove aria-label="Delete scene ${i + 1}" title="Delete"${n <= 2 ? ' disabled' : ''}>${ICON.trash}</button>
            </div>`}
          </div>
          ${side}
          <p class="rm-scene__flag" data-scene-flag hidden></p>
          ${body}`;
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
      editorEl.addEventListener('change', event => {
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
      ctx.on('step', ({ step }) => { if (editorEl) editorEl.hidden = step !== 'edit' || !state.plan; });
      // Photos and clips arrive after the cards are drawn: thumbnails catch up.
      setInterval(() => { if (state.plan && state.step === 'edit' && !document.hidden && Object.keys(state.images).length !== seen) refresh(); }, 1500);

      ctx.register('storyboard', { render, refresh, select, rerender, editor: () => keepFocus(renderEditor), move: moveBy, moveTo, COLORS });
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { COLORS, ROWS, endIndex, canMove, move, dropIndex, stampWord, dotsLine, attach };
}));
