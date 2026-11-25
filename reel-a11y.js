// Reels Studio accessibility (Reels 2.0, lane D).
//   - Scrubber keys: arrows = one frame, Shift + arrows = one second, Home /
//     End, J and L = two seconds back / forward, K or Space = play / pause.
//     Its aria-valuetext reads "0:07, scene 3 of 7, Number".
//   - A polite text description of the scene on screen, updated when the
//     scene changes (never on every frame).
//   - Reorder announcements ("Scene 3 moved to position 2 of 7") in a live region.
//   - A calm preview: scenes cut in place of the wipe. Preview only: exports
//     draw their own frames and keep the full motion.
//   - Captions are always on: a voiced scene with no caption words is an error.
// The pure helpers (ReelA11yCore) load in Node for the tests; the page part
// attaches to window.ReelMakerCtx and publishes ctx.modules.a11y.
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ReelA11yCore = core;
  if (typeof document !== 'undefined') core.attach();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const FPS = 30;
  const FRAME_MS = 1000 / FPS;
  const SKIP_MS = 2000;
  const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const clean = text => String(text == null ? '' : text).replace(/\*/g, '').replace(/\s+/g, ' ').trim();

  // "0:07, scene 3 of 7, Number"
  function valueText({ t = 0, index = 0, total = 0, name = '' } = {}) {
    const parts = [fmtTime(t)];
    if (total > 0) parts.push(`scene ${Math.min(total, index + 1)} of ${total}`);
    if (name) parts.push(name);
    return parts.join(', ');
  }
  // "Scene 3 moved to position 2 of 7"
  function moveText({ from = 0, to = 0, total = 0 } = {}) {
    return `Scene ${from + 1} moved to position ${to + 1} of ${total}`;
  }
  // What a sighted person sees and hears in one scene, in one sentence or two.
  function sceneText({ index = 0, total = 0, name = '', strings = [], vo = '', media = '' } = {}) {
    const on = strings.map(clean).filter(Boolean);
    const said = clean(vo);
    return [
      `Scene ${index + 1} of ${total}${name ? `: ${name}` : ''}.`,
      on.length ? `On screen: ${on.join(', ')}.` : '',
      media ? `${media}.` : '',
      said ? `Voiceover: ${said}${/[.!?]$/.test(said) ? '' : '.'}` : '',
    ].filter(Boolean).join(' ');
  }
  // The key -> what the scrubber does. null: not ours.
  function keyAction(key, { shift = false } = {}) {
    const k = String(key || '');
    if (k === 'ArrowLeft' || k === 'ArrowDown') return { type: 'seek', delta: shift ? -1000 : -FRAME_MS };
    if (k === 'ArrowRight' || k === 'ArrowUp') return { type: 'seek', delta: shift ? 1000 : FRAME_MS };
    if (k === 'Home') return { type: 'to', at: 'start' };
    if (k === 'End') return { type: 'to', at: 'end' };
    if (k === 'j' || k === 'J') return { type: 'seek', delta: -SKIP_MS };
    if (k === 'l' || k === 'L') return { type: 'seek', delta: SKIP_MS };
    if (k === 'k' || k === 'K' || k === ' ') return { type: 'toggle' };
    return null;
  }
  // The time after a key, kept inside the reel and on a frame.
  function seekTo(action, t, durationMs) {
    const end = Math.max(0, durationMs - 1);
    if (!action) return t;
    if (action.type === 'to') return action.at === 'start' ? 0 : end;
    if (action.type !== 'seek') return t;
    const frame = Math.round((t + action.delta) / FRAME_MS);
    return Math.max(0, Math.min(end, Math.round(frame * FRAME_MS)));
  }
  // Calm preview: the time to draw for t, so a scene change is a cut. In the
  // first half of the wipe the old scene holds its last frame; in the second
  // half the new scene shows as it is once the wipe has gone.
  function calmTime(timeline, t, wipeMs = 500) {
    const graphics = (timeline && timeline.tracks && timeline.tracks.graphics) || [];
    if (!wipeMs || graphics.length < 2) return t;
    for (let i = 1; i < graphics.length; i += 1) {
      const start = graphics[i].inMs;
      if (t >= start && t < start + wipeMs) {
        const len = Math.min(wipeMs, Math.max(1, graphics[i].outMs - start));
        return t < start + len / 2 ? Math.max(0, start - 1) : Math.min(start + len, graphics[i].outMs - 1);
      }
    }
    return t;
  }
  // Scenes that are voiced but show no caption words (captions are always on).
  function captionGaps(timeline) {
    const tl = timeline || {};
    const tracks = tl.tracks || {};
    const words = (tracks.captions && tracks.captions.words) || [];
    const voiced = new Set((tracks.audio || []).filter(a => a && a.kind === 'vo').map(a => String(a.asset || '').replace(/^vo:/, '')));
    return (tl.beats || []).filter(b => voiced.has(b.id) && !words.some(w => w.s >= b.inMs - 1 && w.s < b.outMs)).map(b => b.id);
  }

  // ─── Page ────────────────────────────────────────────────────────────────
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.a11y) return;
      const { state, els } = ctx;
      const ui = ctx.ui || {};
      const live = document.getElementById('rm-sb-live');
      const desc = document.getElementById('rm-scene-desc');
      let announceTimer = 0;
      // The same text twice in a row is still read: the region is cleared first.
      function announce(text) {
        if (!live) return;
        clearTimeout(announceTimer);
        live.textContent = '';
        announceTimer = setTimeout(() => { live.textContent = String(text || ''); }, 30);
      }
      function describe(index) {
        const plan = state.plan;
        const beat = plan && plan.beats[index];
        if (!beat) return '';
        const es = ui.esOn && ui.esOn() && ctx.ES;
        const strings = es ? ctx.ES.blockStrings(ctx.ES.blockOf(beat)) : [beat.text, beat.stat && beat.stat.value, beat.stat && beat.stat.label, beat.quote && beat.quote.text].filter(Boolean);
        const asset = state.assets[(state.photos[beat.id] || [])[0]];
        const media = asset ? ({ clip: 'A video clip plays behind it', photo: 'A photo sits behind it', upload: 'Your image sits behind it', scene: 'An AI scene sits behind it', tile: 'A team graphic sits behind it' }[asset.kind] || '') : '';
        return sceneText({ index, total: plan.beats.length, name: ui.beatName ? ui.beatName(beat) : '', strings, vo: beat.vo, media });
      }
      ctx.on('scene', ({ index }) => { if (desc) desc.textContent = describe(index); });

      // Scrubber keys. The range's own arrow step (a thousandth of the reel) is replaced.
      const hint = document.createElement('span');
      hint.id = 'rm-scrub-keys';
      hint.className = 'es-sr-only';
      hint.textContent = 'Arrow keys move one frame. Shift and an arrow moves one second. Home and End jump to the start and the end. J and L skip two seconds. K or Space plays and pauses.';
      els.scrub.after(hint);
      els.scrub.setAttribute('aria-describedby', hint.id);
      function act(action) {
        if (!state.timeline || !action) return false;
        if (action.type === 'toggle') { if (state.playing) ctx.stop(); else ctx.play(); return true; }
        ctx.seek(seekTo(action, state.t, state.timeline.durationMs));
        return true;
      }
      els.scrub.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const action = keyAction(event.key, { shift: event.shiftKey });
        if (action && act(action)) event.preventDefault();
      });
      // J / K / L anywhere on the page that is not a text field, a control with its own keys or a dialog.
      document.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey || !/^[jkl]$/i.test(event.key)) return;
        if (event.target.closest('input, textarea, select, [contenteditable], dialog, [role="radio"]')) return;
        if (act(keyAction(event.key))) event.preventDefault();
      });

      // Less motion asked for by the system: the calm preview follows it, unless the person chose.
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      const chosen = () => { try { return localStorage.getItem('frameup.reels.calm.v1') != null; } catch { return false; } };
      if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (!chosen() && ui.setCalm) ui.setCalm(mq.matches); });

      ctx.register('a11y', { announce, describe, valueText, moveText, calm: () => Boolean(state.calm) });
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { FPS, FRAME_MS, SKIP_MS, fmtTime, valueText, moveText, sceneText, keyAction, seekTo, calmTime, captionGaps, attach };
}));
