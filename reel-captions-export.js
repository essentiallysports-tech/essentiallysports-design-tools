// Reels Studio 2.0, lane C (inputs): caption files for a reel.
//
// The files are built from the same caption cards the renderer burns into the
// video (timeline.tracks.captions.cards, made by ReelRender.captionCards), so
// an SRT or VTT uploaded next to the MP4 matches the picture cue for cue.
// Emphasis asterisks (*word*) are never shown.
//
//   cues(timeline)         [{ n, s, e, text, beat }]  (ms)
//   toSrt(timeline)        SubRip text
//   toVtt(timeline)        WebVTT text
//   toTranscript(timeline) plain text, one paragraph per beat
//   fileName(timeline, kind)
//
// In the browser it also publishes ctx.modules.captions =
// { srt(), vtt(), transcript(), download(kind) } and mounts temporary
// download buttons in the Export pane (lane D moves them).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelCaptionsExport = api;
  if (typeof document !== 'undefined') api.attach();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const KINDS = {
    srt: { label: 'SRT', ext: 'srt', mime: 'application/x-subrip;charset=utf-8', hint: 'For Instagram, YouTube and most editors' },
    vtt: { label: 'VTT', ext: 'vtt', mime: 'text/vtt;charset=utf-8', hint: 'For web players' },
    transcript: { label: 'Transcript', ext: 'txt', mime: 'text/plain;charset=utf-8', hint: 'Plain text, one paragraph per scene' },
  };
  // A word as it is read in a caption file: no emphasis marks, no stray spaces.
  const plain = word => String(word == null ? '' : word).replace(/\*/g, '').replace(/\s+/g, ' ').trim();

  function parts(timeline) {
    const captions = (timeline && timeline.tracks && timeline.tracks.captions) || {};
    return { words: Array.isArray(captions.words) ? captions.words : [], cards: Array.isArray(captions.cards) ? captions.cards : [] };
  }

  // One cue per burned-in card, at the card's own times. A cue never runs past
  // the next one's start or the end of the reel (players reject overlaps).
  function cues(timeline) {
    const { words, cards } = parts(timeline);
    const total = Number(timeline && timeline.durationMs) || 0;
    const list = cards.map(card => ({
      s: Math.max(0, Math.round(card.s)), e: Math.round(card.e), beat: card.beat || '',
      text: (card.words || []).map(i => plain(words[i] && words[i].w)).filter(Boolean).join(' '),
    })).filter(cue => cue.text);
    list.forEach((cue, i) => {
      const next = list[i + 1];
      if (next && cue.e > next.s) cue.e = next.s;
      if (total && cue.e > total) cue.e = total;
      if (cue.e <= cue.s) cue.e = cue.s + 1;
    });
    return list.map((cue, i) => ({ n: i + 1, ...cue }));
  }

  const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');
  function stamp(ms, sep) {
    const t = Math.max(0, Math.round(ms));
    return `${pad(t / 3600000)}:${pad((t % 3600000) / 60000)}:${pad((t % 60000) / 1000)}${sep}${pad(t % 1000, 3)}`;
  }
  // "-->" inside a cue would end it early in both formats.
  const cueText = text => text.replace(/-->/g, '→');

  function toSrt(timeline) {
    return cues(timeline).map(cue => `${cue.n}\n${stamp(cue.s, ',')} --> ${stamp(cue.e, ',')}\n${cueText(cue.text)}\n`).join('\n');
  }
  function toVtt(timeline) {
    const body = cues(timeline).map(cue => `${cue.n}\n${stamp(cue.s, '.')} --> ${stamp(cue.e, '.')}\n${cueText(cue.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
    return `WEBVTT\n\n${body}`;
  }
  // The spoken words, a paragraph per beat, in reel order.
  function toTranscript(timeline) {
    const { words } = parts(timeline);
    const order = [];
    const byBeat = new Map();
    words.forEach(word => {
      const text = plain(word.w);
      if (!text) return;
      const key = word.beat || '';
      if (!byBeat.has(key)) { byBeat.set(key, []); order.push(key); }
      byBeat.get(key).push(text);
    });
    const body = order.map(key => byBeat.get(key).join(' ')).join('\n\n');
    return body ? `${body}\n` : '';
  }
  const BUILD = { srt: toSrt, vtt: toVtt, transcript: toTranscript };
  function fileName(timeline, kind) {
    const slug = String((timeline && timeline.title) || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'reel';
    return `es-reel-${slug}${kind === 'transcript' ? '-transcript' : '-captions'}.${(KINDS[kind] || KINDS.srt).ext}`;
  }

  // ─── Browser: ctx.modules.captions and the temporary Export-pane buttons ──
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.captions) return;
      const timeline = () => ctx.state.timeline;
      const count = () => (timeline() ? cues(timeline()).length : 0);
      function download(kind) {
        const tl = timeline();
        const def = KINDS[kind];
        if (!def) return false;
        if (!tl || !count()) { ctx.toast('This reel has no caption words yet. Add a voiceover line to a scene first.', { tone: 'error' }); return false; }
        const name = fileName(tl, kind);
        const url = URL.createObjectURL(new Blob([BUILD[kind](tl)], { type: def.mime }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        ctx.toast(`Saved ${name}`);
        ctx.logEvent('captions_export', { kind, cues: count(), seconds: Math.round((tl.durationMs || 0) / 1000) });
        // Usage tracking (frameup-track.js): a caption file is a take, like the Reel Captions SRT.
        window.FrameUpTrack?.track?.('download', { tool: 'reels-studio', action: kind, label: name, meta: { kind: 'captions', count: count() } });
        return true;
      }
      const api = { srt: () => (timeline() ? toSrt(timeline()) : ''), vtt: () => (timeline() ? toVtt(timeline()) : ''), transcript: () => (timeline() ? toTranscript(timeline()) : ''), download, cues: () => (timeline() ? cues(timeline()) : []), mount };
      // Temporary entry point (lane D owns the final Export layout): a row of
      // three buttons under the exported files list.
      let box = null;
      function sync() {
        if (!box) return;
        const n = count();
        box.querySelectorAll('button').forEach(btn => { btn.disabled = !n; });
        box.querySelector('[data-ri-cap-note]').textContent = n ? `${n} caption${n === 1 ? '' : 's'}, timed exactly like the ones in the video.` : 'Captions appear here once a scene has voiceover words.';
      }
      function mount(el) {
        if (!el) return null;
        box = document.createElement('div');
        box.className = 'rm-sec ri-captions';
        box.id = 'ri-captions';
        box.innerHTML = `<span class="es-field__label" id="ri-captions-label">Caption files</span>
          <div class="ri-captions__row" role="group" aria-labelledby="ri-captions-label">${Object.entries(KINDS).map(([kind, def]) => `<button class="es-btn es-btn--sm" type="button" data-ri-cap="${kind}" title="${def.hint}">${def.label}</button>`).join('')}</div>
          <p class="rm-hint" data-ri-cap-note></p>`;
        box.addEventListener('click', event => { const btn = event.target.closest('[data-ri-cap]'); if (btn) download(btn.dataset.riCap); });
        el.append(box);
        sync();
        return box;
      }
      ctx.register('captions', api);
      const files = document.getElementById('rm-files');
      if (files && files.parentNode && !document.getElementById('ri-captions')) {
        const host = document.createElement('div');
        files.after(host);
        mount(host);
      }
      ctx.on('rebuild', sync);
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { KINDS, cues, toSrt, toVtt, toTranscript, fileName, stamp, attach };
}));
