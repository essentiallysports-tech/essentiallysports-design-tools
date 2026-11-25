// Reels Studio storyboard (Reels 2.0, lane D). Every scene of the reel is a
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
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.storyboard || !ctx.ui) return;
      const { state, els, ES, F, R } = ctx;
      const ui = ctx.ui;
      const { ICON, esc } = ui;
      const list = els.beats;
      const live = document.getElementById('rm-sb-live');
      const say = text => { const a = ctx.modules.a11y; if (a) a.announce(text); else if (live) live.textContent = text; };
      const es = () => Boolean(ui.esOn() && ES);
      const beats = () => (state.plan ? state.plan.beats : []);
      const isEnd = (beat, i) => i === beats().length - 1 && (es() ? ES.blockOf(beat).type === 'endcard' : beat.kind === 'cta');
      const endAt = () => endIndex(beats(), isEnd);
      const beatOf = id => beats().find(b => b.id === id);
      const cardOf = id => list.querySelector(`[data-beat="${CSS.escape(id)}"]`);
      const fid = (field, id) => `rm-${field.replace(/\./g, '-')}-${id}`;
      const thumbSize = () => { const s = (state.timeline && state.timeline.size) || [1080, 1920]; return [108, Math.round(108 * s[1] / s[0])]; };

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
          parts.push(field(id, 'es.kicker', 'Kicker', b.kicker || '', { max: 40, ph: 'Kalshi trades' }));
          parts.push(`<div class="rm-bf-trio">${field(id, 'es.prefix', 'Before', b.prefix || '', { max: 3, ph: '$' })}${field(id, 'es.value', 'Number', b.value, { type: 'number', max: 12 })}${field(id, 'es.suffix', 'After', b.suffix || '', { max: 4, ph: '%' })}</div>`);
          parts.push(field(id, 'es.label', 'Label', b.label || '', { max: 40, ph: 'Contracts' }));
          parts.push(`<div class="rm-bf rm-bf--chips"><span class="rm-bf__label" id="rm-es-color-${esc(id)}-label">Number colour</span>${chips(b.color || 'blue', 'Number colour', ' data-sb-single="es.color"')}</div>`);
        } else if (b.type === 'dots') {
          parts.push(`<div class="rm-bf-pair">${field(id, 'es.count', 'Dots', b.count, { type: 'number', max: 5 })}${field(id, 'es.highlight', 'Green ones', b.highlight, { type: 'number', max: 5 })}</div>`);
          parts.push(`<p class="rm-hint" data-sb-dots>${esc(dotsLine(b.count, b.highlight))} Up to 2,600.</p>`);
          parts.push(field(id, 'es.label', 'Label', b.label || '', { max: 40, ph: 'Every bet on games' }), field(id, 'es.note', 'Note', b.note || '', { max: 40, ph: '1 was insurance' }));
        } else if (b.type === 'compare') {
          parts.push(field(id, 'es.kicker', 'Kicker', b.kicker || '', { max: 40, ph: 'How they bet' }));
          const items = (b.items || []).slice();
          while (items.length < 2) items.push({ label: '', display: '', color: items.length ? 'ink' : 'blue' });
          parts.push(rowsHtml(id, 'items', items), '<p class="rm-hint">Bars scale to the biggest value.</p>');
        } else if (b.type === 'quote') {
          parts.push(`<div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-es-text-${esc(id)}">Quote (their exact words)</label>${countOf(b.text, 70)}</div><textarea class="es-input rm-bf__input" id="rm-es-text-${esc(id)}" data-field="es.text" rows="2" maxlength="200">${esc(b.text || '')}</textarea></div>`);
          parts.push(field(id, 'es.who', 'Who said it', b.who || '', { max: 60, ph: 'Andy Reid' }));
        } else if (b.type === 'endcard') {
          const cta = b.cta || ES.DEFAULT_CTA;
          parts.push(`<div class="rm-bf-pair">${field(id, 'es.cta.0', 'Line 1', cta[0] || '', { max: 30 })}${field(id, 'es.cta.1', 'Line 2', cta[1] || '', { max: 30 })}</div>`);
          parts.push(field(id, 'plan.sourceLine', 'Source line', state.plan.sourceLine || (state.timeline && state.timeline.sourceLine) || '', { max: 120, ph: 'Source: ESPN, Kalshi' }));
          return parts.join('');
        }
        parts.push(voHtml(beat));
        return parts.join('');
      }
      // The scene's picture: what is on it, and how to change it (drop a file on the card too).
      function mediaHtml(beat, i) {
        const ids = state.photos[beat.id] || [];
        const asset = ids[0] ? state.assets[ids[0]] : null;
        const img = ids[0] && state.images[ids[0]];
        const src = state.visualSrc[beat.id] || (asset ? (asset.kind === 'clip' ? 'x-clip' : 'photo') : 'none');
        const SOURCE = { 'x-clip': 'Official X clip', upload: 'Your upload', 'upload-clip': 'Your clip', photo: 'ES photo', headshot: 'ES photo', tile: 'Team graphic', scene: 'AI scene', 'ai-clip': 'AI b-roll clip', design: 'Designed background', paper: 'ES paper', none: 'No picture yet' };
        const note = state.visualNote && state.visualNote[beat.id];
        const clip = asset && asset.kind === 'clip';
        const canAi = state.config.aiClips && state.config.aiClips.ready && state.aiClipsUsed < state.config.aiClips.max;
        const btn = (action, label, icon) => `<button class="rm-icon-btn rm-icon-btn--sm" type="button" data-visual="${action}" aria-label="${label} for scene ${i + 1}" title="${label}">${icon}</button>`;
        return `<div class="rm-media" data-sb-media>
          <span class="rm-media__thumb${img ? '' : ' is-empty'}" aria-hidden="true">${img ? (img.tagName === 'CANVAS' ? '<span data-sb-poster></span>' : `<img src="${esc(img.src)}" alt="">`) : ICON.image}</span>
          <div class="rm-media__meta"><p class="rm-media__src">${esc(SOURCE[src] || src)}${asset && asset.rights && asset.rights.credit ? ` · ${esc(asset.rights.credit)}` : ''}</p>
            <p class="rm-hint">${note ? esc(note) : 'Drop a photo or clip here.'}</p></div>
          <div class="rm-media__actions" role="group" aria-label="Picture for scene ${i + 1}">
            ${btn('photo', 'Use an ES photo', ICON.image)}${btn('swap-clip', clip ? 'Swap the clip' : 'Use a clip', ICON.film)}${btn('upload', 'Upload a photo or clip', ICON.upload)}${state.plan.team ? btn('tile', 'Use the team graphic', ICON.shield) : ''}${canAi ? btn('ai-clip', 'Use an AI clip', ICON.sparkles) : (state.config.ai ? btn('scene', 'Use an AI scene', ICON.sparkles) : '')}
          </div></div>`;
      }
      function cardHtml(beat, i) {
        const all = beats();
        const n = all.length;
        const id = beat.id;
        const tl = state.timeline;
        const b = tl ? tl.beats.find(x => x.id === id) : null;
        const on = id === state.selected;
        const end = isEnd(beat, i);
        const endI = endAt();
        const name = ui.beatName(beat);
        const voiced = state.voice[id] && state.voice[id].text === beat.vo;
        const time = b ? `${ui.fmtTime(b.inMs)}–${ui.fmtTime(b.outMs)}` : '';
        const [tw, th] = thumbSize();
        let side = '';
        let body = '';
        if (es()) {
          const type = ES.blockOf(beat).type;
          // The hook opens the reel and the end card closes it; the scenes between take any other block.
          const options = i === 0 ? ['hook', 'statement'] : ['statement', 'number', 'dots', 'compare', 'quote'];
          if (!options.includes(type)) options.unshift(type);
          side = end ? '<p class="rm-hint rm-card__fixed">Always the last scene.</p>'
            : `<div class="rm-bf rm-card__block"><label class="rm-bf__label" for="rm-estype-${esc(id)}">Block</label><select class="es-select rm-bf__input" id="rm-estype-${esc(id)}" data-field="es.type">${options.filter(t => t !== 'endcard').map(t => `<option value="${t}"${t === type ? ' selected' : ''}>${ES.BLOCKS[t].label}</option>`).join('')}</select></div>`;
          body = `<div class="rm-beat__fields">${esBody(beat)}</div>${!end && ES.takesMedia(beat) ? mediaHtml(beat, i) : ''}`;
        } else {
          body = `${beat.kind === 'cta' ? '' : ctx.visualCard(beat)}<div class="rm-beat__fields">${ctx.beatFields(beat, i)}</div>`;
        }
        return `<li class="rm-card${on ? ' is-on' : ''}${end ? ' is-end' : ''}" data-beat="${esc(id)}" data-ri-beat="${esc(id)}" data-kind="${esc(beat.kind)}">
          <div class="rm-card__top">
            <button class="rm-card__face" type="button" data-sb-face draggable="${end ? 'false' : 'true'}" aria-pressed="${on}" aria-label="Scene ${i + 1} of ${n}, ${esc(name)}${time ? `, ${time}` : ''}. ${end ? 'Always last.' : 'Alt and an arrow key moves it.'}">
              <canvas class="rm-card__thumb" width="${tw}" height="${th}" data-sb-thumb aria-hidden="true"></canvas>
              <span class="rm-card__n" aria-hidden="true">${i + 1}</span>
            </button>
            <div class="rm-card__side">
              <p class="rm-card__name"><span>${esc(name)}</span>${voiced ? '<span class="rm-beat__vo" title="Voiceover ready">VO</span>' : ''}</p>
              <p class="rm-beat__time rm-card__time">${time}</p>
              ${side}
              <div class="rm-card__tools" role="group" aria-label="Scene ${i + 1}">
                ${end ? '' : `<button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-move="-1" aria-label="Move scene ${i + 1} left" title="Move left"${canMove(n, i, i - 1, endI) ? '' : ' disabled'}>${ICON.left}</button>
                <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-sb-move="1" aria-label="Move scene ${i + 1} right" title="Move right"${canMove(n, i, i + 1, endI) ? '' : ' disabled'}>${ICON.chevronRight}</button>
                <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-remove aria-label="Delete scene ${i + 1}" title="Delete"${n <= 2 ? ' disabled' : ''}>${ICON.trash}</button>`}
              </div>
            </div>
          </div>
          <div class="rm-card__body">${body}<p class="rm-beat__flag" aria-live="polite"></p></div>
        </li>`;
      }

      // ── Thumbnails: the real renderer at the middle of each scene ──
      function drawThumb(card) {
        const cv = card.querySelector('[data-sb-thumb]');
        const tl = state.timeline;
        const b = tl && tl.beats.find(x => x.id === card.dataset.beat);
        if (!cv || !b) return;
        const [tw, th] = thumbSize();
        if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
        const size = tl.size || [1080, 1920];
        const g = cv.getContext('2d');
        // Past the wipe and the entrances, before the scene leaves.
        const t = Math.min(b.outMs - 1, Math.max(b.inMs + 1, b.inMs + Math.min((b.outMs - b.inMs) * 0.7, 1800)));
        g.save();
        g.setTransform(tw / size[0], 0, 0, th / size[1], 0, 0);
        try { R.drawFrame(g, tl, t, ui.envFor(tl)); } catch (error) { window.FrameUpErrors?.report?.(error, 'reels storyboard thumb'); }
        g.restore();
      }
      function posters() {
        list.querySelectorAll('[data-sb-poster]').forEach(holder => {
          const id = holder.closest('[data-beat]').dataset.beat;
          const img = state.images[(state.photos[id] || [])[0]];
          if (!img || img.tagName !== 'CANVAS') return;
          const c = document.createElement('canvas');
          c.width = 80; c.height = 80;
          const k = Math.max(80 / img.width, 80 / img.height);
          c.getContext('2d').drawImage(img, (80 - img.width * k) / 2, (80 - img.height * k) / 2, img.width * k, img.height * k);
          holder.replaceWith(c);
        });
      }
      let seen = 0;
      function refresh() {
        if (!state.plan || !state.timeline) return;
        if (list.children.length !== beats().length) { render(); return; }
        [...list.children].forEach(drawThumb);
        seen = Object.keys(state.images).length;
      }
      function keepFocus(fn) {
        const active = document.activeElement;
        const keepId = active && list.contains(active) ? active.id : '';
        const face = active && list.contains(active) && active.matches('[data-sb-face]') ? active.closest('[data-beat]').dataset.beat : '';
        const caret = keepId && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
        fn();
        if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus({ preventScroll: true }); if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } } } }
        else if (face) cardOf(face)?.querySelector('[data-sb-face]')?.focus({ preventScroll: true });
      }
      function render() {
        if (!state.plan) { list.innerHTML = ''; return; }
        keepFocus(() => { list.innerHTML = beats().map(cardHtml).join(''); });
        list.style.setProperty('--thumb-ratio', thumbSize().join(' / '));
        posters();
        refresh();
      }
      function rerender(id) {
        const card = cardOf(id);
        const i = beats().findIndex(b => b.id === id);
        if (!card || i < 0) { render(); return; }
        keepFocus(() => { card.outerHTML = cardHtml(beats()[i], i); });
        posters();
        drawThumb(cardOf(id));
        ctx.renderLint();
      }
      function select(id, { focus = false } = {}) {
        list.querySelectorAll('.rm-card').forEach(card => {
          const on = card.dataset.beat === id;
          card.classList.toggle('is-on', on);
          card.querySelector('[data-sb-face]')?.setAttribute('aria-pressed', String(on));
        });
        const card = cardOf(id);
        if (!card) return;
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (focus) (card.querySelector('.rm-card__body input, .rm-card__body textarea') || card.querySelector('[data-sb-face]'))?.focus({ preventScroll: true });
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
      list.addEventListener('input', event => {
        const t = event.target;
        if (t.matches('[data-sb-text], [data-sb-label], [data-sb-display]')) {
          const counter = t.closest('[data-sb-row]').querySelector('[data-sb-count]');
          if (counter) { const max = Number(counter.dataset.sbCount); const n = t.value.trim().length; counter.textContent = `${n}/${max}`; counter.classList.toggle('is-over', n > max); }
          commitRows(t.closest('[data-sb-rows]'));
          return;
        }
        const card = t.closest('[data-beat]');
        if (!card) return;
        if (t.dataset.field === 'es.text') { const counter = t.closest('.rm-bf').querySelector('[data-sb-count]'); if (counter) { const n = t.value.trim().length; counter.textContent = `${n}/70`; counter.classList.toggle('is-over', n > 70); } }
        if (t.dataset.field === 'es.count' || t.dataset.field === 'es.highlight') {
          const line = card.querySelector('[data-sb-dots]');
          if (line) line.textContent = `${dotsLine(card.querySelector('[data-field="es.count"]').value, card.querySelector('[data-field="es.highlight"]').value)} Up to 2,600.`;
        }
      });
      list.addEventListener('change', event => {
        const box = event.target.closest('[data-sb-stamp]');
        if (!box) return;
        const card = box.closest('[data-beat]');
        const beat = beatOf(card.dataset.beat);
        if (!beat) return;
        const block = ES.blockOf(beat);
        ctx.setField(beat, 'es.stamp', box.checked ? { text: stampWord(beat.vo, (block.pills || []).map(p => p.text)) || 'BIG' } : null);
        ctx.rebuild();
        rerender(beat.id);
        const again = cardOf(beat.id);
        (box.checked ? again.querySelector('[data-field="es.stamp.text"]') : again.querySelector('[data-sb-stamp]'))?.focus({ preventScroll: true });
      });
      list.addEventListener('click', event => {
        const t = event.target;
        const card = t.closest('[data-beat]');
        if (!card) return;
        const id = card.dataset.beat;
        const beat = beatOf(id);
        if (!beat) return;
        if (t.closest('[data-sb-face]')) { ctx.selectBeat(id, { seek: true }); return; }
        const mv = t.closest('[data-sb-move]');
        if (mv) {
          const delta = Number(mv.dataset.sbMove);
          if (moveBy(id, delta)) { const again = cardOf(id); (again.querySelector(`[data-sb-move="${delta}"]:not(:disabled)`) || again.querySelector('[data-sb-move]:not(:disabled)') || again.querySelector('[data-sb-face]'))?.focus({ preventScroll: true }); }
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
          // Collect what is on the card (a half-typed row included), then add or drop one.
          const values = rows.map(row => { const color = row.querySelector('[data-sb-color][aria-checked="true"]'); return key === 'items' ? { label: row.querySelector('[data-sb-label]').value || ' ', display: row.querySelector('[data-sb-display]').value, color: color ? color.dataset.sbColor : '' } : { text: row.querySelector('[data-sb-text]').value || ' ', color: color ? color.dataset.sbColor : 'ink' }; });
          if (del) values.splice(at, 1); else values.push(key === 'items' ? { label: 'NEW BAR', display: '0', color: 'ink' } : { text: key === 'pills' ? 'NEW PILL' : 'NEW LINE', color: (block[key] || []).length ? 'blue' : 'ink' });
          ctx.setField(beat, `es.${key}`, values.map(v => (key === 'items' ? { ...v, label: v.label.trim() || 'BAR' } : { ...v, text: v.text.trim() || (key === 'pills' ? 'PILL' : 'LINE') })));
          ctx.rebuild();
          rerender(id);
          const again = cardOf(id).querySelector(`[data-sb-rows="${key}"]`);
          const inputs = again.querySelectorAll(key === 'items' ? '[data-sb-label]' : '[data-sb-text]');
          const focusAt = inputs[Math.min(del ? Math.max(0, at - 1) : inputs.length - 1, inputs.length - 1)];
          if (focusAt) { focusAt.focus({ preventScroll: true }); if (add) focusAt.select(); }
          ctx.logEvent('edit', { what: add ? 'row-add' : 'row-remove', block: block.type });
        }
      });
      // Moving into a card with the keyboard selects it (the preview follows).
      list.addEventListener('focusin', event => {
        const card = event.target.closest('[data-beat]');
        if (card && card.dataset.beat !== state.selected && !dragging) ctx.selectBeat(card.dataset.beat, { seek: true });
      });
      // Alt + arrow moves the scene (not inside a text field, where it moves the caret by a word).
      list.addEventListener('keydown', event => {
        if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        if (event.target.closest('input, textarea, select')) return;
        const card = event.target.closest('[data-beat]');
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        const id = card.dataset.beat;
        const again = () => cardOf(id).querySelector('[data-sb-face]')?.focus({ preventScroll: true });
        moveBy(id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1, { via: 'keyboard' });
        again();
      }, true);

      // ── Drag to reorder (the thumbnail is the handle) ──
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
      // Photos and clips arrive after the cards are drawn: thumbnails catch up.
      setInterval(() => { if (state.plan && state.step === 'edit' && !document.hidden && Object.keys(state.images).length !== seen) refresh(); }, 1500);

      ctx.register('storyboard', { render, refresh, select, rerender, move: moveBy, moveTo, COLORS });
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { COLORS, ROWS, endIndex, canMove, move, dropIndex, stampWord, dotsLine, attach };
}));
