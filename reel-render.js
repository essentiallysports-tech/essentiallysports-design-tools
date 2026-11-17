// Reels Studio renderer: turns a reel plan into a JSON timeline (EDL) and
// draws any frame of it. Pure functions, no DOM: the page passes a canvas
// context, images and a measure(text, font) function, so timing and layout
// are testable in Node (scripts/test-reel-render.mjs).
//
//   buildTimeline(plan, opts)        -> timeline (EDL, research §4.2)
//   frameAt(timeline, tMs)           -> what is on screen at t (shot mix,
//                                       graphic progress, caption card, music gain)
//   layoutGraphic(measure, g, tl)    -> text ops with boxes (safe-zone checks)
//   layoutCaption(measure, card, tl) -> caption ops
//   drawFrame(ctx, timeline, tMs, env)
//   captionCards / estimateWordTimes / duckPoints / musicGainDbAt / contrast
//
// Reuses video-ads-render.js for the photo framing (videoRect), the tint
// maths (tintLayers) and the animated team-colour background (drawGenerated).
//
// The look (research §1.3, §5.1): 1080×1920, text inside x 65–1015 and
// y 270–1580, heavy condensed type (Acumin Pro Condensed, the ES artwork
// face), ease-out motion, photo pushes of at most 10%, cross-fades of 220 ms,
// no spins or wipes, word-level captions with one highlighted word.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./video-ads-render.js') : root.VideoAdsRender, node ? require('./reel-formats.js') : root.ReelFormats);
  if (node) module.exports = api;
  else root.ReelRender = api;
}(typeof self !== 'undefined' ? self : this, (VA, F) => {
  'use strict';

  const W = 1080;
  const H = 1920;
  const FPS = 30;
  const SAFE = { left: 65, right: 1015, top: 270, bottom: 1580 };
  const MARGIN = 84; // text column x 84–996, inside the safe zone
  const COL = W - 2 * MARGIN;
  const ZONE = { graphicTop: 360, graphicBottom: 1250, captionBaseline: 1500, captionTop: 1330 };
  const CONDENSED = (VA && VA.CONDENSED) || '"Acumin Pro Condensed Local", "Roboto Condensed", sans-serif';
  const BODY = 'Roboto, sans-serif';
  const font = (weight, size, family) => `${weight} ${Math.round(size * 10) / 10}px ${family}`;
  const CAP = 0.7; // cap height share (Acumin and Roboto are both close)
  const XFADE_MS = 220;
  const ES_BLUE = '#0A6FDE';
  const WHITE = '#FFFFFF';

  // ─── Easing ─────────────────────────────────────────────────────────────
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const ease = {
    linear: t => clamp01(t),
    outCubic: t => 1 - (1 - clamp01(t)) ** 3,
    outQuint: t => 1 - (1 - clamp01(t)) ** 5,
    inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
    outBack: t => { const x = clamp01(t); const c = 1.2; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
  };
  const progress = (t, start, dur) => clamp01((t - start) / Math.max(1, dur));

  // ─── Colour ─────────────────────────────────────────────────────────────
  const HEX6 = /^#[0-9a-f]{6}$/i;
  function luminance(hex) {
    if (VA && VA.luminance) return VA.luminance(hex);
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const lin = c => { const v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // The colour behind a highlighted word (white text on it). Team colours first,
  // when white reads on them at 4.5:1; else ES Blue 600 (4.8:1).
  function accessibleHighlight(colors = []) {
    const list = (Array.isArray(colors) ? colors : [colors]).filter(c => HEX6.test(String(c)));
    return list.find(c => contrast(WHITE, c) >= 4.5) || ES_BLUE;
  }

  // ─── Words, timing and captions ─────────────────────────────────────────
  // Word times for a VO line with no alignment: spread over the line by
  // character weight, with small pauses after punctuation.
  function estimateWordTimes(text, startMs, durMs) {
    const list = F.words(text);
    if (!list.length || !(durMs > 0)) return [];
    const weights = list.map(w => Math.max(2, w.replace(/[^\w%$]/g, '').length) + (/[,;:]$/.test(w) ? 2.5 : 0) + (/[.!?]$/.test(w) ? 4 : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = startMs;
    return list.map((w, i) => {
      const span = (weights[i] / total) * durMs;
      const pause = /[.!?]$/.test(w) ? span * 0.3 : (/[,;:]$/.test(w) ? span * 0.18 : 0);
      const word = { w, s: Math.round(at), e: Math.round(at + span - pause) };
      at += span;
      return word;
    });
  }

  // Caption cards: 1–3 words for hype ('highlight'), up to 6 on two short
  // lines for 'box'. A card ends at punctuation or a pause, never mid-beat.
  function captionCards(words, { style = 'highlight', maxWords, maxChars } = {}) {
    const mw = maxWords || (style === 'box' ? 6 : 3);
    const mc = maxChars || (style === 'box' ? 34 : 20);
    const cards = [];
    let card = null;
    words.forEach((word, index) => {
      const prev = words[index - 1];
      const gap = prev ? word.s - prev.e : 0;
      const breakHere = !card
        || card.words.length >= mw
        || card.chars + word.w.length + 1 > mc
        || gap > 350
        || (prev && prev.beat !== word.beat)
        || (prev && /[.!?;:]$/.test(prev.w) && card.words.length >= 1)
        || (prev && /,$/.test(prev.w) && card.words.length >= 2);
      if (breakHere) {
        // Never leave an orphan one-letter card ("a", "I") when it can join the last.
        card = { s: word.s, e: word.e, words: [index], chars: word.w.length, beat: word.beat };
        cards.push(card);
      } else {
        card.words.push(index);
        card.e = word.e;
        card.chars += word.w.length + 1;
      }
    });
    // Hold each card until the next one starts (no flicker in short gaps).
    cards.forEach((c, i) => {
      const next = cards[i + 1];
      c.e = next && next.beat === c.beat && next.s - c.e < 600 ? next.s : c.e + 220;
    });
    return cards.map(({ s, e, words: w, beat }) => ({ s, e, words: w, beat }));
  }

  // ─── Music ducking (VO-led, music 14 dB under speech) ──────────────────
  const MUSIC = { baseDb: -10, duckDb: -24, attackMs: 90, releaseMs: 320, fadeInMs: 250, fadeOutMs: 900, floorDb: -60 };
  function duckPoints(voClips, durationMs, opts = {}) {
    const o = { ...MUSIC, ...opts };
    const points = [{ t: 0, db: o.floorDb }, { t: o.fadeInMs, db: o.baseDb }];
    const spans = (voClips || [])
      .filter(c => c.durMs > 0)
      .map(c => [Math.max(0, c.inMs - o.attackMs), c.inMs, c.inMs + c.durMs, c.inMs + c.durMs + o.releaseMs])
      .sort((a, b) => a[0] - b[0]);
    // Merge spans that touch, so the music does not bob between beats.
    const merged = [];
    spans.forEach(span => {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[3]) { last[2] = Math.max(last[2], span[2]); last[3] = Math.max(last[3], span[3]); } else merged.push([...span]);
    });
    merged.forEach(([a, b, c, d]) => {
      points.push({ t: Math.max(a, o.fadeInMs), db: o.baseDb }, { t: Math.max(b, o.fadeInMs), db: o.duckDb }, { t: c, db: o.duckDb }, { t: d, db: o.baseDb });
    });
    const end = Math.max(0, durationMs - o.fadeOutMs);
    const kept = points.filter(p => p.t < end).sort((a, b) => a.t - b.t);
    kept.push({ t: end, db: musicGainDbAt(points.sort((a, b) => a.t - b.t), end) }, { t: durationMs, db: o.floorDb });
    return kept;
  }
  function musicGainDbAt(points, t) {
    if (!points || !points.length) return MUSIC.floorDb;
    if (t <= points[0].t) return points[0].db;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (t <= b.t) return b.t === a.t ? b.db : a.db + (b.db - a.db) * ((t - a.t) / (b.t - a.t));
    }
    return points[points.length - 1].db;
  }
  const dbToGain = db => (db <= -59 ? 0 : 10 ** (db / 20));

  // ─── Stat values (count-up) ─────────────────────────────────────────────
  function parseStatValue(raw) {
    const text = String(raw || '').trim();
    const m = text.match(/^([^\d-+]*)([-+]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(.*)$/);
    if (!m) return null;
    const num = Number(`${m[2] === '-' ? '-' : ''}${m[3].replace(/,/g, '')}${m[4] ? `.${m[4]}` : ''}`);
    if (!Number.isFinite(num)) return null;
    return { prefix: m[1] + (m[2] === '+' ? '+' : ''), num, decimals: m[4] ? m[4].length : 0, comma: m[3].includes(','), suffix: m[5] };
  }
  function formatStat(spec, value) {
    if (!spec) return '';
    const fixed = Math.abs(value).toFixed(spec.decimals);
    const [int, dec] = fixed.split('.');
    const grouped = spec.comma ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
    return `${spec.prefix}${value < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}${spec.suffix}`;
  }

  // ─── Timeline (EDL) ─────────────────────────────────────────────────────
  const TEMPLATE_FOR = { hook: 'hook', stat: 'stat', rank: 'rank', quote: 'quote', cta: 'cta', context: 'text', point: 'text', payoff: 'text' };
  const clean = (v, max = 400) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // opts:
  //   voice:   { [beatId]: { durationMs, words: [{ w, s, e }] (ms from the clip start), asset } }
  //   photos:  { [beatId]: [assetId, …] }   (ES image pool picks, in order)
  //   assets:  { [assetId]: { kind, src, label, rights } }
  //   team:    { name, colors: [a, b], logo }  (the reel's team, optional)
  //   captionStyle: 'highlight' | 'box'; voiceMode: 'elevenlabs' | 'gateway' | 'off'
  //   music:   { asset, title } | null; sources: [{ type, title, url }]; corpus: string
  function buildTimeline(plan, opts = {}) {
    const fmt = F.FORMATS[plan && plan.format] ? plan.format : 'explainer';
    const voice = opts.voice || {};
    const photos = opts.photos || {};
    const team = opts.team && opts.team.name ? { name: clean(opts.team.name, 80), colors: (opts.team.colors || []).filter(c => HEX6.test(String(c))).slice(0, 2), logo: opts.team.logo || '' } : null;
    const captionStyle = opts.captionStyle === 'box' ? 'box' : 'highlight';
    const voiceMode = ['elevenlabs', 'gateway'].includes(opts.voiceMode) ? opts.voiceMode : 'off';
    const assets = { ...(opts.assets || {}) };
    const beats = [];
    const video = [];
    const graphics = [];
    const audio = [];
    const words = [];
    let t = 0;
    const list = (plan && Array.isArray(plan.beats) ? plan.beats : []).slice(0, 12);
    list.forEach((raw, index) => {
      const id = clean(raw.id, 12) || `b${index + 1}`;
      const kind = F.KINDS.includes(raw.kind) ? raw.kind : 'point';
      const vo = clean(raw.vo, 320);
      const v = voice[id] || null;
      const voMs = v && v.durationMs > 0 ? Math.round(v.durationMs) : F.estimateVoMs(vo);
      const lead = index === 0 ? F.PACE.voLeadMs : 120;
      const last = index === list.length - 1;
      const min = F.PACE.beatMinMs[kind] || F.PACE.beatMinMs.default;
      const dur = Math.max(min, voMs ? lead + voMs + (last ? F.PACE.endTailMs : F.PACE.tailMs) : min);
      const beat = {
        id, kind, inMs: t, outMs: t + dur,
        text: clean(raw.text, 120), vo, emphasis: clean(raw.emphasis, 40),
        label: F.KIND_LABELS[kind] || '',
        stat: raw.stat && raw.stat.value ? { value: clean(raw.stat.value, 16), label: clean(raw.stat.label, 24) } : null,
        rank: kind === 'rank' ? Math.max(1, Math.min(10, Number(raw.rank) || 0)) || null : null,
        name: clean(raw.name, 60), detail: clean(raw.detail, 120),
        quote: raw.quote && raw.quote.text ? { text: clean(raw.quote.text, 220), by: clean(raw.quote.by, 60) } : null,
        photo: clean(raw.photo, 80),
      };
      beats.push(beat);

      // Shots: a beat longer than shotMaxMs gets a second (or third) shot, so
      // the picture changes every 1.5–3.2 s.
      const picks = (photos[id] || []).filter(a => assets[a]);
      const n = Math.min(3, Math.max(1, Math.ceil(dur / F.PACE.shotMaxMs)));
      for (let k = 0; k < n; k += 1) {
        const inMs = t + Math.round((dur * k) / n);
        const outMs = t + Math.round((dur * (k + 1)) / n);
        const asset = picks.length ? picks[k % picks.length] : null;
        const sameAgain = picks.length && k >= picks.length;
        const odd = (index + k) % 2 === 1;
        video.push({
          id: `${id}s${k + 1}`, beat: id, asset, inMs, outMs,
          // Push-ins only, at most +8% (rule: <= 10%); a repeated photo punches
          // in tighter on a different focus instead of repeating the move.
          motion: sameAgain
            ? { from: 1.1, to: 1.16, focus: [odd ? 0.42 : 0.58, 0.34], drift: [odd ? 0.06 : -0.06, 0.02] }
            : { from: 1.0, to: 1.08, focus: [0.5, 0.36], drift: [odd ? -0.05 : 0.05, -0.03] },
        });
      }

      graphics.push({
        id: `${id}g`, beat: id, template: TEMPLATE_FOR[kind] || 'text', inMs: t, outMs: t + dur,
        data: { text: beat.text, emphasis: beat.emphasis, label: beat.label, stat: beat.stat, rank: beat.rank, name: beat.name, detail: beat.detail, quote: beat.quote },
      });

      if (vo) {
        const start = t + lead;
        const span = voMs || F.estimateVoMs(vo);
        const timed = v && Array.isArray(v.words) && v.words.length
          ? v.words.map(word => ({ w: clean(word.w, 40), s: start + Math.round(word.s), e: start + Math.round(word.e) })).filter(word => word.w)
          : estimateWordTimes(vo, start, span);
        timed.forEach(word => words.push({ ...word, beat: id }));
        if (v && v.asset) audio.push({ id: `vo-${id}`, kind: 'vo', beat: id, asset: v.asset, inMs: start, durMs: span, gainDb: 0 });
      }
      t += dur;
    });

    const durationMs = t;
    if (opts.music && opts.music.asset && assets[opts.music.asset]) {
      const voClips = audio.filter(a => a.kind === 'vo');
      audio.push({ id: 'music', kind: 'music', asset: opts.music.asset, inMs: 0, gainDb: MUSIC.baseDb, duck: true, envelope: duckPoints(voClips, durationMs) });
    }

    // Rights for what the renderer itself makes (research §3.3 step 4).
    if (video.some(shot => !shot.asset)) {
      assets['bg:generated'] = { kind: 'graphic', label: 'Animated team-colour background', rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    }
    assets['graphics:es'] = { kind: 'graphic', label: 'Type, stat cards and captions', rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    assets['logo:es'] = { kind: 'logo', label: 'EssentiallySports mark', src: 'assets/brand-logos/essentiallysports-mark.svg', rights: { source: 'EssentiallySports', licence: 'ES brand mark', organic: true, paid: true } };
    if (team && team.logo) {
      assets['logo:team'] = { kind: 'logo', label: `${team.name} logo`, src: team.logo, rights: { source: 'Team mark (ESPN logo CDN)', licence: 'Editorial use of a team mark; not cleared for paid ads', organic: true, paid: false } };
    }

    const highlight = accessibleHighlight(team ? team.colors : []);
    const cards = captionCards(words, { style: captionStyle });
    return {
      v: 1, fps: FPS, size: [W, H], durationMs,
      format: fmt, tag: F.FORMATS[fmt].tag, sport: clean(plan && plan.sport, 12), title: clean(plan && plan.title, 140),
      team, highlight, captionStyle, voice: { mode: voiceMode },
      beats,
      tracks: { video, graphics, captions: { style: captionStyle, words, cards }, audio },
      assets,
      sources: (opts.sources || []).slice(0, 20),
      corpus: String(opts.corpus || '').slice(0, 12000),
    };
  }

  // ─── What is on screen at t (pure; the timing tests read this) ─────────
  function findIndex(list, t) {
    for (let i = 0; i < list.length; i += 1) if (t >= list[i].inMs && t < list[i].outMs) return i;
    return t >= (list[list.length - 1] || {}).outMs ? list.length - 1 : 0;
  }
  function frameAt(timeline, tMs) {
    const t = Math.max(0, Math.min(timeline.durationMs - 1, tMs));
    const shots = timeline.tracks.video;
    const si = findIndex(shots, t);
    const shot = shots[si];
    const prev = si > 0 ? shots[si - 1] : null;
    const mix = prev && shot ? ease.inOutSine(progress(t, shot.inMs, XFADE_MS)) : 1;
    const gi = findIndex(timeline.tracks.graphics, t);
    const graphic = timeline.tracks.graphics[gi] || null;
    const gLocal = graphic ? t - graphic.inMs : 0;
    const gLeft = graphic ? graphic.outMs - t : 0;
    const isLast = gi === timeline.tracks.graphics.length - 1;
    const words = timeline.tracks.captions.words;
    const cards = timeline.tracks.captions.cards;
    const card = cards.find(c => t >= c.s && t < c.e) || null;
    let active = -1;
    if (card) {
      card.words.forEach(i => { if (t >= words[i].s) active = i; });
    }
    const music = timeline.tracks.audio.find(a => a.kind === 'music');
    return {
      t,
      shot: shot ? { ...shot, local: t - shot.inMs, p: progress(t, shot.inMs, shot.outMs - shot.inMs) } : null,
      prev: prev && mix < 1 ? { ...prev, local: t - prev.inMs, p: progress(t, prev.inMs, prev.outMs - prev.inMs) } : null,
      mix,
      graphic: graphic ? { ...graphic, local: gLocal, exit: isLast ? 0 : 1 - clamp01(gLeft / 180) } : null,
      beatIndex: gi,
      caption: card ? { ...card, active, local: t - card.s } : null,
      musicDb: music ? musicGainDbAt(music.envelope, t) : null,
    };
  }

  // ─── Layout (static positions; the draw step animates them) ───────────
  function wrap(measure, text, fontStr, maxWidth) {
    const list = String(text || '').split(/\s+/).filter(Boolean);
    const space = measure(' ', fontStr);
    const lines = [];
    let line = [];
    let width = 0;
    list.forEach(word => {
      const w = measure(word, fontStr);
      if (line.length && width + space + w > maxWidth) { lines.push({ words: line, width }); line = []; width = 0; }
      line.push({ text: word, x: line.length ? width + space : 0, w });
      width = line.length > 1 ? width + space + w : w;
    });
    if (line.length) lines.push({ words: line, width });
    return lines;
  }
  // The biggest size (from max down to min) that fits in maxLines.
  function fitText(measure, text, { family = CONDENSED, weight = 700, max, min, maxLines, width = COL, step = 0.94 }) {
    let size = max;
    let lines = wrap(measure, text, font(weight, size, family), width);
    while ((lines.length > maxLines || lines.some(l => l.width > width)) && size > min) {
      size = Math.max(min, size * step);
      lines = wrap(measure, text, font(weight, size, family), width);
    }
    return { size, lines, font: font(weight, size, family) };
  }
  const isEmph = (word, emphasis) => {
    if (!emphasis) return false;
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9%$]/g, '');
    const targets = String(emphasis).split(/\s+/).map(norm).filter(Boolean);
    return targets.includes(norm(word));
  };

  // A block of lines → ops, top at `top`, left-aligned at MARGIN.
  function linesOps(fit, top, { lineHeight = 0.96, color = WHITE, emphasis = '', role = 'text', upper = true, align = 'left', delayStep = 50, baseDelay = 0 }) {
    const ops = [];
    let y = top + fit.size * CAP;
    let n = 0;
    fit.lines.forEach(line => {
      const x0 = align === 'center' ? (W - line.width) / 2 : MARGIN;
      line.words.forEach(word => {
        const text = upper ? word.text.toUpperCase() : word.text;
        ops.push({ type: 'word', role, text, font: fit.font, size: fit.size, x: x0 + word.x, y, w: word.w, color, lit: isEmph(word.text, emphasis), delay: baseDelay + n * delayStep });
        n += 1;
      });
      y += fit.size * lineHeight;
    });
    const height = fit.size * CAP + (fit.lines.length - 1) * fit.size * lineHeight;
    return { ops, height, bottom: top + height };
  }
  const upperMeasure = measure => (text, f) => measure(String(text).toUpperCase(), f);

  // Ops for one graphic. Boxes: every op has x, y (baseline), w, size, so a
  // box is [x, y - size*CAP, w, size*CAP] (what the lint checks against SAFE).
  function layoutGraphic(measure, graphic, timeline = {}) {
    const d = graphic.data || {};
    const m = upperMeasure(measure);
    const ops = [];
    const bottom = ZONE.graphicBottom;
    const tag = timeline.tag || '';
    if (graphic.template === 'hook') {
      const fit = fitText(m, d.text, { max: 150, min: 92, maxLines: 4 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.94;
      const pillH = 58;
      const top = Math.max(ZONE.graphicTop + pillH + 28, bottom - block);
      if (tag) ops.push({ type: 'pill', role: 'tag', text: tag, font: font(700, 30, BODY), size: 30, x: MARGIN, y: top - 28 - pillH, h: pillH, w: measure(tag, font(700, 30, BODY)) + 44, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.94, emphasis: d.emphasis, delayStep: 40 }).ops);
    } else if (graphic.template === 'stat') {
      const value = String(d.stat?.value || d.text || '');
      const numFit = fitText(measure, value, { max: 360, min: 160, maxLines: 1 });
      const label = String(d.stat?.label || '').toUpperCase();
      const labelFit = label ? fitText(m, label, { max: 86, min: 56, maxLines: 1 }) : null;
      const line = d.text && d.text !== value && !new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(d.text) ? fitText(measure, d.text, { family: BODY, weight: 600, max: 48, min: 38, maxLines: 2 }) : null;
      const gapBar = 34;
      const heights = [numFit.size * CAP, labelFit ? gapBar + 12 + gapBar + labelFit.size * CAP : 0, line ? 40 + line.size * CAP + (line.lines.length - 1) * line.size * 1.2 : 0];
      const total = heights.reduce((a, b) => a + b, 0);
      let y = Math.max(ZONE.graphicTop + 150, bottom - total);
      if (timeline.team && timeline.team.name) ops.push({ type: 'logo', role: 'team', x: MARGIN, y: y - 150, w: 112, h: 112, delay: 0 });
      ops.push({ type: 'count', role: 'number', text: value, spec: parseStatValue(value), font: numFit.font, size: numFit.size, x: MARGIN, y: y + numFit.size * CAP, w: numFit.lines[0] ? numFit.lines[0].width : 0, color: WHITE, delay: 80 });
      y += numFit.size * CAP;
      if (labelFit) {
        ops.push({ type: 'bar', role: 'bar', x: MARGIN, y: y + gapBar, w: 140, h: 12, delay: 260 });
        y += gapBar + 12 + gapBar;
        ops.push({ type: 'word', role: 'label', text: label, font: labelFit.font, size: labelFit.size, x: MARGIN, y: y + labelFit.size * CAP, w: labelFit.lines[0] ? labelFit.lines[0].width : 0, color: WHITE, delay: 300 });
        y += labelFit.size * CAP;
      }
      if (line) ops.push(...linesOps(line, y + 40, { lineHeight: 1.2, upper: false, role: 'line', color: 'rgba(255,255,255,0.88)', baseDelay: 420, delayStep: 0 }).ops);
    } else if (graphic.template === 'rank') {
      const rank = d.rank || 0;
      const name = d.name || d.text;
      const nameFit = fitText(m, name, { max: 120, min: 76, maxLines: 2 });
      const detail = d.detail || (d.name && d.text !== d.name ? d.text : '');
      const detailFit = detail ? fitText(measure, detail, { family: BODY, weight: 500, max: 46, min: 38, maxLines: 2 }) : null;
      const numSize = 300;
      const nameH = nameFit.size * CAP + (nameFit.lines.length - 1) * nameFit.size * 0.96;
      const detailH = detailFit ? 36 + detailFit.size * CAP + (detailFit.lines.length - 1) * detailFit.size * 1.22 : 0;
      const top = Math.max(ZONE.graphicTop + 90, bottom - (numSize * CAP + 40 + nameH + detailH));
      ops.push({ type: 'dots', role: 'countdown', rank, x: MARGIN, y: top - 70, w: 5 * 44, h: 28, delay: 0 });
      ops.push({ type: 'word', role: 'rank', text: `#${rank}`, font: font(700, numSize, CONDENSED), size: numSize, x: MARGIN - 6, y: top + numSize * CAP, w: measure(`#${rank}`, font(700, numSize, CONDENSED)), color: 'HIGHLIGHT', delay: 0, pop: true });
      const nameBlock = linesOps(nameFit, top + numSize * CAP + 40, { lineHeight: 0.96, delayStep: 45, baseDelay: 160 });
      ops.push(...nameBlock.ops);
      if (detailFit) ops.push(...linesOps(detailFit, nameBlock.bottom + 36, { lineHeight: 1.22, upper: false, role: 'line', color: 'rgba(255,255,255,0.86)', baseDelay: 380, delayStep: 0 }).ops);
    } else if (graphic.template === 'quote') {
      const q = d.quote?.text || d.text;
      const fit = fitText(measure, q, { max: 96, min: 62, maxLines: 6 });
      const by = d.quote?.by ? `— ${d.quote.by}` : '';
      const block = 150 + fit.size * CAP + (fit.lines.length - 1) * fit.size * 1.04 + (by ? 70 : 0);
      const top = Math.max(ZONE.graphicTop + 40, bottom - block);
      ops.push({ type: 'mark', role: 'quote-mark', x: MARGIN - 4, y: top + 120, size: 260, delay: 0 });
      const body = linesOps(fit, top + 150, { lineHeight: 1.04, upper: false, emphasis: d.emphasis, delayStep: 28, baseDelay: 120 });
      ops.push(...body.ops);
      if (by) ops.push({ type: 'word', role: 'byline', text: by.toUpperCase(), font: font(700, 38, BODY), size: 38, x: MARGIN, y: body.bottom + 70, w: measure(by.toUpperCase(), font(700, 38, BODY)), color: 'rgba(255,255,255,0.9)', delay: 500 });
    } else if (graphic.template === 'cta') {
      const fit = fitText(m, d.text, { max: 120, min: 80, maxLines: 3 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.96;
      const top = Math.round((ZONE.graphicTop + bottom) / 2 - block / 2 + 60);
      ops.push({ type: 'esmark', role: 'es-mark', x: (W - 168) / 2, y: top - 210, w: 168, h: 143, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.96, emphasis: d.emphasis, align: 'center', delayStep: 45, baseDelay: 140 }).ops);
      const sub = 'ESSENTIALLYSPORTS';
      ops.push({ type: 'word', role: 'sub', text: sub, font: font(700, 34, BODY), size: 34, x: (W - measure(sub, font(700, 34, BODY))) / 2, y: top + block + 84, w: measure(sub, font(700, 34, BODY)), color: 'rgba(255,255,255,0.8)', delay: 420 });
    } else {
      const fit = fitText(m, d.text, { max: 116, min: 78, maxLines: 4 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.96;
      const top = Math.max(ZONE.graphicTop + 90, bottom - block);
      if (d.label) ops.push({ type: 'pill', role: 'label', outline: true, text: d.label, font: font(700, 28, BODY), size: 28, x: MARGIN, y: top - 34 - 54, h: 54, w: measure(d.label, font(700, 28, BODY)) + 40, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.96, emphasis: d.emphasis, delayStep: 45, baseDelay: 80 }).ops);
    }
    return ops;
  }

  function layoutCaption(measure, card, timeline) {
    const words = timeline.tracks.captions.words;
    const style = timeline.captionStyle;
    const list = card.words.map(i => ({ i, text: words[i].w.replace(/^[“"]|[”"]$/g, '') }));
    if (style === 'box') {
      const fit = fitText(measure, list.map(w => w.text).join(' '), { family: BODY, weight: 700, max: 56, min: 44, maxLines: 2, width: COL - 60 });
      const lineH = fit.size * 1.18;
      const ops = [];
      let k = 0;
      const blockH = fit.size * CAP + (fit.lines.length - 1) * lineH;
      const top = ZONE.captionBaseline - blockH;
      fit.lines.forEach((line, li) => {
        const x0 = (W - line.width) / 2;
        line.words.forEach(word => { ops.push({ type: 'cword', i: list[k].i, text: word.text, font: fit.font, size: fit.size, x: x0 + word.x, y: top + fit.size * CAP + li * lineH, w: word.w }); k += 1; });
      });
      const widest = Math.max(...fit.lines.map(l => l.width));
      return { style, ops, box: { x: (W - widest) / 2 - 30, y: top - 26, w: widest + 60, h: blockH + 52 } };
    }
    const m = upperMeasure(measure);
    const fit = fitText(m, list.map(w => w.text).join(' '), { max: 96, min: 64, maxLines: 2, width: COL });
    const ops = [];
    let k = 0;
    const lineH = fit.size * 1.0;
    const blockH = fit.size * CAP + (fit.lines.length - 1) * lineH;
    fit.lines.forEach((line, li) => {
      const x0 = (W - line.width) / 2;
      line.words.forEach(word => { ops.push({ type: 'cword', i: list[k].i, text: word.text.toUpperCase(), font: fit.font, size: fit.size, x: x0 + word.x, y: ZONE.captionBaseline - blockH + fit.size * CAP + li * lineH, w: word.w }); k += 1; });
    });
    return { style, ops, box: null };
  }

  // Boxes of every text op in the reel (for the safe-zone lint).
  function textBoxes(measure, timeline) {
    const boxes = [];
    timeline.tracks.graphics.forEach(g => layoutGraphic(measure, g, timeline).forEach(op => {
      if (op.type === 'word' || op.type === 'count' || op.type === 'pill') {
        const top = op.type === 'pill' ? op.y : op.y - op.size * CAP;
        boxes.push({ beat: g.beat, role: op.role, text: op.text, x: op.x, y: top, w: op.w, h: op.type === 'pill' ? op.h : op.size * CAP });
      }
    }));
    timeline.tracks.captions.cards.forEach(card => {
      const cap = layoutCaption(measure, card, timeline);
      cap.ops.forEach(op => boxes.push({ beat: card.beat, role: 'caption', text: op.text, x: op.x, y: op.y - op.size * CAP, w: op.w, h: op.size * CAP }));
    });
    return boxes;
  }

  // ─── Drawing ────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    if (VA && VA.roundRect) return VA.roundRect(ctx, x, y, w, h, r);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    return undefined;
  }

  function drawShot(ctx, shot, timeline, env, alpha) {
    if (!shot) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const asset = shot.asset ? timeline.assets[shot.asset] : null;
    const image = asset && env.images ? env.images[shot.asset] : null;
    if (image && (image.naturalWidth || image.width)) {
      const m = shot.motion || {};
      const e = ease.inOutSine(shot.p);
      const zoom = (m.from || 1) + ((m.to || 1.08) - (m.from || 1)) * e;
      const focus = m.focus || [0.5, 0.36];
      const drift = m.drift || [0, 0];
      const sw = image.naturalWidth || image.width;
      const sh = image.naturalHeight || image.height;
      // Pan so the focus point (faces sit high in sports photos) stays framed.
      const panX = Math.max(-1, Math.min(1, (0.5 - focus[0]) * -2 + drift[0] * e * 2));
      const panY = Math.max(-1, Math.min(1, (0.5 - focus[1]) * -2 + drift[1] * e * 2));
      const r = VA.videoRect(sw, sh, W, H, { zoom, panX, panY, fit: 'fill' });
      if (r) ctx.drawImage(image, r.x, r.y, r.w, r.h);
    } else {
      const colors = timeline.team && timeline.team.colors.length ? timeline.team.colors : ['#0A2342', ES_BLUE];
      VA.drawGenerated(ctx, W, H, { colors, t: (shot.inMs + shot.local) / 1000, duration: 14, grain: env.grain || null });
    }
    ctx.restore();
  }

  function drawGrade(ctx, timeline) {
    // Team tint (light), top shade for the ES mark, deep bottom for type.
    const tint = timeline.team && timeline.team.colors[0] ? VA.tintLayers({ color: timeline.team.colors[0], amount: 0.18 }) : [];
    tint.forEach(layer => { ctx.save(); ctx.globalCompositeOperation = layer.mode; ctx.globalAlpha = layer.alpha; ctx.fillStyle = layer.color; ctx.fillRect(0, 0, W, H); ctx.restore(); });
    const top = ctx.createLinearGradient(0, 0, 0, 520);
    top.addColorStop(0, 'rgba(8,10,14,0.62)');
    top.addColorStop(1, 'rgba(8,10,14,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, 520);
    const bottom = ctx.createLinearGradient(0, 640, 0, H);
    bottom.addColorStop(0, 'rgba(8,10,14,0)');
    bottom.addColorStop(0.38, 'rgba(8,10,14,0.62)');
    bottom.addColorStop(1, 'rgba(8,10,14,0.92)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 640, W, H - 640);
  }

  function textShadow(ctx, on) {
    ctx.shadowColor = on ? 'rgba(0,0,0,0.38)' : 'transparent';
    ctx.shadowBlur = on ? 28 : 0;
    ctx.shadowOffsetY = on ? 4 : 0;
  }

  function drawGraphic(ctx, frame, timeline, env) {
    const g = frame.graphic;
    if (!g) return;
    const ops = env.layoutCache ? env.layoutCache(g) : layoutGraphic(env.measure, g, timeline);
    const hl = timeline.highlight || ES_BLUE;
    const exitA = 1 - ease.outCubic(g.exit);
    const exitY = -18 * ease.outCubic(g.exit);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ops.forEach(op => {
      const local = g.local - (op.delay || 0);
      const dur = g.template === 'hook' ? 300 : 380;
      const p = ease.outCubic(progress(local, 0, dur));
      // Frame 0 of the reel is never empty: the hook's first words and pill start visible.
      const floor = g.template === 'hook' && g.inMs === 0 && (op.delay || 0) <= 80 ? 0.55 : 0;
      const a = Math.max(floor, p) * exitA;
      if (a <= 0.001) return;
      const dy = (1 - Math.max(floor, p)) * 34 + exitY;
      ctx.save();
      ctx.globalAlpha = a;
      if (op.type === 'pill') {
        ctx.font = op.font;
        if (op.outline) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 3;
          roundRect(ctx, op.x, op.y + dy, op.w, op.h, op.h / 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = hl;
          roundRect(ctx, op.x, op.y + dy, op.w, op.h, op.h / 2);
          ctx.fill();
        }
        ctx.fillStyle = WHITE;
        ctx.fillText(op.text, op.x + (op.w - env.measure(op.text, op.font)) / 2, op.y + dy + op.h / 2 + op.size * 0.36);
      } else if (op.type === 'word') {
        ctx.font = op.font;
        if (op.lit) {
          const padX = op.size * 0.1;
          const reveal = ease.outQuint(progress(local - 60, 0, 320));
          ctx.fillStyle = hl;
          roundRect(ctx, op.x - padX, op.y + dy - op.size * CAP - op.size * 0.12, (op.w + padX * 2) * reveal, op.size * (CAP + 0.24), op.size * 0.08);
          ctx.fill();
        }
        textShadow(ctx, !op.lit);
        ctx.fillStyle = op.color === 'HIGHLIGHT' ? hl : op.color;
        let scale = 1;
        if (op.pop) scale = 0.86 + 0.14 * ease.outBack(progress(local, 0, 420));
        if (scale !== 1) {
          ctx.translate(op.x, op.y + dy);
          ctx.scale(scale, scale);
          ctx.fillText(op.text, 0, 0);
          if (op.color === 'HIGHLIGHT') { textShadow(ctx, false); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(op.text, 0, 0); }
        } else {
          ctx.fillText(op.text, op.x, op.y + dy);
        }
      } else if (op.type === 'count') {
        ctx.font = op.font;
        textShadow(ctx, true);
        ctx.fillStyle = WHITE;
        const c = ease.outQuint(progress(local, 0, 900));
        const text = op.spec ? formatStat(op.spec, op.spec.num * c) : op.text;
        ctx.fillText(text, op.x, op.y + dy);
      } else if (op.type === 'bar') {
        ctx.fillStyle = hl;
        roundRect(ctx, op.x, op.y + dy, op.w * ease.outQuint(progress(local, 0, 420)), op.h, op.h / 2);
        ctx.fill();
      } else if (op.type === 'dots') {
        for (let n = 5; n >= 1; n -= 1) {
          const i = 5 - n;
          const on = n === op.rank;
          const done = n > op.rank;
          ctx.fillStyle = on ? hl : (done ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)');
          roundRect(ctx, op.x + i * 44, op.y + dy, on ? 36 : 28, op.h, op.h / 2);
          ctx.fill();
        }
      } else if (op.type === 'mark') {
        ctx.font = font(700, op.size, CONDENSED);
        ctx.fillStyle = WHITE;
        ctx.fillText('“', op.x, op.y + dy + op.size * 0.12);
      } else if (op.type === 'logo') {
        const img = env.images && env.images['logo:team'];
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.arc(op.x + op.w / 2, op.y + dy + op.h / 2, op.w / 2, 0, Math.PI * 2);
        ctx.fill();
        if (img && (img.naturalWidth || img.width)) ctx.drawImage(img, op.x + 12, op.y + dy + 12, op.w - 24, op.h - 24);
        else if (timeline.team && timeline.team.colors.length) {
          const [a, b] = [timeline.team.colors[0], timeline.team.colors[1] || timeline.team.colors[0]];
          ctx.fillStyle = a; ctx.beginPath(); ctx.arc(op.x + op.w / 2, op.y + dy + op.h / 2, op.w / 2 - 10, Math.PI * 0.75, Math.PI * 1.75); ctx.fill();
          ctx.fillStyle = b; ctx.beginPath(); ctx.arc(op.x + op.w / 2, op.y + dy + op.h / 2, op.w / 2 - 10, Math.PI * 1.75, Math.PI * 2.75); ctx.fill();
        }
      } else if (op.type === 'esmark') {
        const img = env.images && env.images['logo:es'];
        if (img && (img.naturalWidth || img.width)) {
          const s = 0.9 + 0.1 * ease.outBack(progress(local, 0, 420));
          ctx.drawImage(img, op.x + op.w * (1 - s) / 2, op.y + dy + op.h * (1 - s) / 2, op.w * s, op.h * s);
        }
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function drawCaption(ctx, frame, timeline, env) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    const hl = timeline.highlight || ES_BLUE;
    const appear = ease.outCubic(progress(card.local, 0, 140));
    ctx.save();
    ctx.globalAlpha = appear;
    const dy = (1 - appear) * 14;
    ctx.textBaseline = 'alphabetic';
    if (layout.box) {
      ctx.fillStyle = 'rgba(16,17,20,0.8)';
      roundRect(ctx, layout.box.x, layout.box.y + dy, layout.box.w, layout.box.h, 22);
      ctx.fill();
    }
    layout.ops.forEach(op => {
      const on = op.i === card.active;
      const spoken = op.i <= card.active;
      ctx.font = op.font;
      if (layout.style === 'box') {
        ctx.fillStyle = on ? '#9DCBFD' : (spoken ? WHITE : 'rgba(255,255,255,0.72)');
        ctx.fillText(op.text, op.x, op.y + dy);
        return;
      }
      const word = timeline.tracks.captions.words[op.i];
      const pop = on ? 1 + 0.06 * (1 - ease.outCubic(progress(frame.t - word.s, 0, 160))) : 1;
      ctx.save();
      ctx.translate(op.x + op.w / 2, op.y + dy - op.size * CAP / 2);
      ctx.scale(pop, pop);
      ctx.translate(-(op.x + op.w / 2), -(op.y + dy - op.size * CAP / 2));
      if (on) {
        const padX = op.size * 0.12;
        ctx.fillStyle = hl;
        roundRect(ctx, op.x - padX, op.y + dy - op.size * CAP - op.size * 0.14, op.w + padX * 2, op.size * (CAP + 0.28), op.size * 0.1);
        ctx.fill();
      }
      ctx.lineJoin = 'round';
      ctx.lineWidth = op.size * 0.12;
      ctx.strokeStyle = on ? 'rgba(0,0,0,0)' : 'rgba(8,10,14,0.75)';
      if (!on) ctx.strokeText(op.text, op.x, op.y + dy);
      ctx.fillStyle = WHITE;
      ctx.fillText(op.text, op.x, op.y + dy);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawBug(ctx, frame, timeline, env) {
    // The ES mark stays top-left (inside the safe zone); on the end card it
    // is drawn big instead.
    if (frame.graphic && frame.graphic.template === 'cta') return;
    const img = env.images && env.images['logo:es'];
    if (!img || !(img.naturalWidth || img.width)) return;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(img, MARGIN, 290, 76, 65);
    ctx.restore();
  }

  // env: { measure(text, font), images: { assetId: Image }, grain }
  function drawFrame(ctx, timeline, tMs, env = {}) {
    const frame = frameAt(timeline, tMs);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (frame.prev) drawShot(ctx, frame.prev, timeline, env, 1);
    drawShot(ctx, frame.shot, timeline, env, frame.prev ? frame.mix : 1);
    drawGrade(ctx, timeline);
    drawBug(ctx, frame, timeline, env);
    drawGraphic(ctx, frame, timeline, env);
    drawCaption(ctx, frame, timeline, env);
    ctx.restore();
    return frame;
  }

  return {
    W, H, FPS, SAFE, ZONE, MARGIN, COL, CONDENSED, BODY, CAP, XFADE_MS, MUSIC, ES_BLUE,
    ease, contrast, luminance, accessibleHighlight,
    estimateWordTimes, captionCards, duckPoints, musicGainDbAt, dbToGain, parseStatValue, formatStat,
    buildTimeline, frameAt, wrap, fitText, layoutGraphic, layoutCaption, textBoxes, drawFrame,
  };
}));
