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
//
// Styles (reel-styles.js): 'classic' keeps the look above. The other styles
// ('explainer', 'series', 'countdown') run the styled engine further down: a
// paper or navy ground, chrome (eyebrow, ES badge, series tag, a persistent
// data strip, a 5-to-1 rail), a headline, one layout per beat kind (framed
// photo or clip with an optional cut-out player, stat hero, comparison bars,
// versus cards, a dot ranking, square chips, a step tracker, team tiles, role
// cards, a "?" card, the end card) and block captions. Every layout is ops
// with boxes, so the safe-zone test covers every style x every kind.
//
// Visuals: a shot's asset is a photo, an AI scene still, an uploaded image, a
// video clip (env.videos[assetId], the page keeps it at clipTimes()), or a
// team graphic tile. A shot with no asset draws the style's designed motion
// background, so no slot is ever empty.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./video-ads-render.js') : root.VideoAdsRender, node ? require('./reel-formats.js') : root.ReelFormats, node ? require('./reel-styles.js') : root.ReelStyles);
  if (node) module.exports = api;
  else root.ReelRender = api;
}(typeof self !== 'undefined' ? self : this, (VA, F, S) => {
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
  //   photos:  { [beatId]: [assetId, …] }   (picks in order: photo, clip, scene, tile, upload)
  //            { ['<beatId>#v<i>']: [assetId] } (versus headshots), { ['<beatId>#t<i>']: [assetId] } (tile logos)
  //   assets:  { [assetId]: { kind, src, label, rights, durationMs?, clipIn? } }
  //   team:    { name, colors: [a, b], logo }  (the reel's team, optional)
  //   style:   'classic' | 'explainer' | 'series' | 'countdown'
  //   captionStyle: 'highlight' | 'box'; voiceMode: 'elevenlabs' | 'gateway' | 'off'
  //   music:   { asset, title } | null; sources: [{ type, title, url }]; corpus: string
  const cleanList = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  function componentData(raw, id, photos, assets) {
    const first = key => ((photos[key] || []).find(a => assets[a]) || '');
    const d = {};
    if (Array.isArray(raw.bars)) d.bars = cleanList(raw.bars, 4).map(b => ({ label: clean(b && b.label, 24), value: clean(b && b.value, 16), note: clean(b && b.note, 60) })).filter(b => b.label && b.value);
    if (Array.isArray(raw.versus)) d.versus = cleanList(raw.versus, 3).map((v, i) => ({ name: clean(v && v.name, 28), value: clean(v && v.value, 14), note: clean(v && v.note, 60), asset: first(`${id}#v${i}`) })).filter(v => v.name);
    if (raw.dotrank && raw.dotrank.total) d.dotrank = { total: clean(raw.dotrank.total, 8), rank: clean(raw.dotrank.rank, 8), label: clean(raw.dotrank.label, 32), note: clean(raw.dotrank.note, 60) };
    if (raw.chips && raw.chips.total) d.chips = { filled: clean(raw.chips.filled, 6), total: clean(raw.chips.total, 6), label: clean(raw.chips.label, 40) };
    if (raw.steps && raw.steps.total) d.steps = { current: clean(raw.steps.current, 2), total: clean(raw.steps.total, 2), label: clean(raw.steps.label, 32) };
    if (Array.isArray(raw.tiles)) d.tiles = cleanList(raw.tiles, 4).map((t, i) => ({ team: clean(t && (t.team || t.name), 32), label: clean(t && t.label, 36), chip: clean(t && t.chip, 18), colors: cleanList(t && t.colors, 2).filter(c => HEX6.test(String(c))), asset: first(`${id}#t${i}`) })).filter(t => t.team);
    if (Array.isArray(raw.roles)) d.roles = cleanList(raw.roles, 4).map(r => ({ role: clean(r && r.role, 8), value: clean(r && r.value, 10), note: clean(r && r.note, 40), tone: r && r.tone === 'good' ? 'good' : 'bad' })).filter(r => r.role && r.value);
    return d;
  }
  function buildTimeline(plan, opts = {}) {
    const fmt = F.FORMATS[plan && plan.format] ? plan.format : 'explainer';
    const style = S.get(opts.style || (plan && plan.style));
    const voice = opts.voice || {};
    const photos = opts.photos || {};
    const team = opts.team && opts.team.name ? { name: clean(opts.team.name, 80), colors: (opts.team.colors || []).filter(c => HEX6.test(String(c))).slice(0, 2), logo: opts.team.logo || '' } : null;
    const captionStyle = style.caption.mode === 'user' ? (opts.captionStyle === 'box' ? 'box' : 'highlight') : style.caption.mode;
    const voiceMode = ['elevenlabs', 'gateway'].includes(opts.voiceMode) ? opts.voiceMode : 'off';
    const assets = { ...(opts.assets || {}) };
    const beats = [];
    const video = [];
    const graphics = [];
    const audio = [];
    const words = [];
    let t = 0;
    const list = (plan && Array.isArray(plan.beats) ? plan.beats : []).slice(0, style.beats.max);
    list.forEach((raw, index) => {
      const id = clean(raw.id, 24) || `b${index + 1}`;
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
        photo: clean(raw.photo, 80), visual: F.VISUALS.includes(raw.visual) ? raw.visual : '',
        ...componentData(raw, id, photos, assets),
      };
      beats.push(beat);

      // Shots: a beat longer than shotMaxMs gets a second (or third) shot, so
      // the picture changes every 1.5–3.2 s. A clip moves by itself: one shot
      // per clip, the clip plays from its trim point.
      const picks = (photos[id] || []).filter(a => assets[a]);
      const isClip = a => assets[a] && assets[a].kind === 'clip';
      const n = picks.length && isClip(picks[0]) ? Math.min(2, picks.length) : Math.min(3, Math.max(1, Math.ceil(dur / F.PACE.shotMaxMs)));
      for (let k = 0; k < n; k += 1) {
        const inMs = t + Math.round((dur * k) / n);
        const outMs = t + Math.round((dur * (k + 1)) / n);
        const asset = picks.length ? picks[k % picks.length] : null;
        const sameAgain = picks.length && k >= picks.length;
        const odd = (index + k) % 2 === 1;
        video.push({
          id: `${id}s${k + 1}`, beat: id, asset, inMs, outMs,
          clip: asset && isClip(asset) ? { inSec: Math.max(0, Number(assets[asset].clipIn) || 0), durSec: Math.max(0.5, (Number(assets[asset].durationMs) || 6000) / 1000) } : null,
          // Push-ins only, at most +8% (rule: <= 10%); a repeated photo punches
          // in tighter on a different focus instead of repeating the move.
          motion: asset && isClip(asset) ? { from: 1.0, to: 1.03, focus: [0.5, 0.42], drift: [0, 0] } : sameAgain
            ? { from: 1.1, to: 1.16, focus: [odd ? 0.42 : 0.58, 0.34], drift: [odd ? 0.06 : -0.06, 0.02] }
            : { from: 1.0, to: 1.08, focus: [0.5, 0.36], drift: [odd ? -0.05 : 0.05, -0.03] },
        });
      }

      const layout = style.layouts[kind] || 'headline-visual';
      graphics.push({
        id: `${id}g`, beat: id, template: layout === 'legacy' ? (TEMPLATE_FOR[kind] || 'text') : layout, kind, inMs: t, outMs: t + dur, index,
        data: { text: beat.text, emphasis: beat.emphasis, label: beat.label, stat: beat.stat, rank: beat.rank, name: beat.name, detail: beat.detail, quote: beat.quote, visual: beat.visual, ...componentData(raw, id, photos, assets) },
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
    if (video.some(shot => assets[shot.asset] && assets[shot.asset].kind === 'design')) {
      assets['bg:generated'] = { kind: 'graphic', label: style.engine === 'classic' ? 'Animated team-colour background' : `${style.label} designed background`, rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    }
    assets['graphics:es'] = { kind: 'graphic', label: 'Type, stat cards and captions', rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    assets['logo:es'] = { kind: 'logo', label: 'EssentiallySports mark', src: 'assets/brand-logos/essentiallysports-mark.svg', rights: { source: 'EssentiallySports', licence: 'ES brand mark', organic: true, paid: true } };
    if (team && team.logo) {
      assets['logo:team'] = { kind: 'logo', label: `${team.name} logo`, src: team.logo, rights: { source: 'Team mark (ESPN logo CDN)', licence: 'Editorial use of a team mark; not cleared for paid ads', organic: true, paid: false } };
    }

    const highlight = accessibleHighlight(team ? team.colors : []);
    const cards = captionCards(words, { style: captionStyle === 'box' ? 'box' : 'highlight' });
    const sx = plan && plan.strip && plan.strip.value ? { label: clean(plan.strip.label, 32), value: clean(plan.strip.value, 14), of: clean(plan.strip.of, 14), note: clean(plan.strip.note, 48), tone: plan.strip.tone === 'good' ? 'good' : 'bad' } : null;
    return {
      v: 1, fps: FPS, size: [W, H], durationMs,
      format: fmt, tag: F.FORMATS[fmt].tag, sport: clean(plan && plan.sport, 12), title: clean(plan && plan.title, 140),
      style: style.id, limits: { maxSeconds: style.seconds.max, targetSeconds: style.seconds.target },
      eyebrow: clean(plan && plan.eyebrow, 48), series: plan && plan.series && plan.series.tag ? { tag: clean(plan.series.tag, 28) } : null,
      strip: style.chrome.strip ? sx : null,
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
    if (S.LAYOUTS.includes(graphic.template) && graphic.template !== 'legacy') return layoutStyled(measure, graphic, { style: 'classic', tracks: { video: [] }, beats: [], ...timeline });
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
    if (timeline.captionStyle === 'block') return layoutBlockCaption(measure, card, timeline);
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
      if (op.type === 'word' || op.type === 'count' || op.type === 'pill' || op.type === 'text') {
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

  // Every drawn box (text, panels, visuals, chrome) of the reel: the tests
  // check all of them sit inside the safe zone in every style.
  function allBoxes(measure, timeline) {
    const out = [];
    const add = (beat, op) => {
      if (op.type === 'word' || op.type === 'count' || op.type === 'text') out.push({ beat, role: op.role, text: op.text, x: op.x, y: op.y - op.size * CAP, w: op.w, h: op.size * CAP });
      else if (op.type === 'dotring') out.push({ beat, role: op.role, x: op.cx - op.r1 - 3, y: op.cy - op.r1 - 3, w: op.r1 * 2 + 6, h: op.r1 * 2 + 6 });
      else if (op.w != null && op.h != null && op.type !== 'mark') out.push({ beat, role: op.role, x: op.x, y: op.y, w: op.w, h: op.h });
    };
    timeline.tracks.graphics.forEach((g, i) => {
      layoutGraphic(measure, g, timeline).forEach(op => add(g.beat, op));
      layoutChrome(measure, timeline, { beatIndex: i, graphic: g }).forEach(op => add(g.beat, op));
    });
    timeline.tracks.captions.cards.forEach(card => layoutCaption(measure, card, timeline).ops.forEach(op => out.push({ beat: card.beat, role: 'caption', text: op.text, x: op.box ? op.box.x : op.x, y: op.box ? op.box.y : op.y - op.size * CAP, w: op.box ? op.box.w : op.w, h: op.box ? op.box.h : op.size * CAP })));
    return out;
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

  // ─── Visuals: photo, AI scene, upload, clip, team tile, designed bg ─────
  function mediaSize(m) {
    if (!m) return null;
    const w = m.videoWidth || m.naturalWidth || m.width;
    const h = m.videoHeight || m.naturalHeight || m.height;
    return w && h ? [w, h] : null;
  }
  // Cover-crop media into a rect with a zoom around a focus point.
  function drawCover(ctx, media, x, y, w, h, { zoom = 1, fx = 0.5, fy = 0.4 } = {}) {
    const size = mediaSize(media);
    if (!size) return false;
    const [sw, sh] = size;
    const scale = Math.max(w / sw, h / sh) * zoom;
    const cw = w / scale;
    const ch = h / scale;
    const cx = Math.max(0, Math.min(sw - cw, sw * fx - cw / 2));
    const cy = Math.max(0, Math.min(sh - ch, sh * fy - ch / 2));
    ctx.drawImage(media, cx, cy, cw, ch, x, y, w, h);
    return true;
  }
  // The clip time to show for a shot at its local time (looping a short clip).
  function clipTime(shot, localMs) {
    if (!shot || !shot.clip) return 0;
    const span = Math.max(0.5, shot.clip.durSec - shot.clip.inSec);
    return shot.clip.inSec + ((Math.max(0, localMs) / 1000) % span);
  }
  // Which clips must show which source time at t (the page seeks or syncs
  // its <video> elements to these before drawing; export awaits each seek).
  function clipTimes(timeline, tMs) {
    const f = frameAt(timeline, tMs);
    const out = [];
    [f.shot, f.prev].forEach(shot => { if (shot && shot.clip && shot.asset) out.push({ asset: shot.asset, time: clipTime(shot, shot.local) }); });
    return out;
  }
  // A team graphic: the logo on a team-colour field with a diagonal texture.
  function drawTile(ctx, asset, x, y, w, h, env, t) {
    const colors = (asset.colors || []).filter(c => HEX6.test(String(c)));
    const a = colors[0] || '#0A2342';
    const b = colors[1] || a;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, a);
    g.addColorStop(1, b === a ? '#000000' : b);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6;
    const shift = ((t || 0) / 40) % 48;
    ctx.beginPath();
    for (let k = -h; k < w + h; k += 48) { ctx.moveTo(x + k + shift, y); ctx.lineTo(x + k + shift - h, y + h); }
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    const logo = env.images && asset.logo ? env.images[asset.logo] : null;
    if (mediaSize(logo)) {
      const [lw, lh] = mediaSize(logo);
      const s = Math.min(w, h) * 0.5 * (1 + 0.03 * Math.sin((t || 0) / 900));
      const k = Math.min(s / lw, s / lh);
      ctx.drawImage(logo, x + (w - lw * k) / 2, y + (h - lh * k) / 2, lw * k, lh * k);
    }
  }
  // The style's designed motion background (fill-chain step 4, an explicit
  // choice: asset kind 'design').
  function drawDesigned(ctx, timeline, x, y, w, h, tMs, env) {
    const colors = timeline.team && timeline.team.colors.length ? timeline.team.colors : ['#0A2342', ES_BLUE];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    VA.drawGenerated(ctx, w, h, { colors, t: tMs / 1000, duration: 14, grain: env.grain || null });
    ctx.restore();
  }
  // Draws one visual into a rect. Nothing chosen yet: plain black (owner's
  // call), never a made-up background.
  function drawVisual(ctx, assetId, rect, timeline, env, { p = 0, local = 0, shot = null, motion = null, tMs = 0 } = {}) {
    const { x, y, w, h } = rect;
    const asset = assetId ? timeline.assets[assetId] : null;
    if (!asset) { ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h); return 'empty'; }
    if (asset.kind === 'design') { drawDesigned(ctx, timeline, x, y, w, h, tMs, env); return 'design'; }
    if (asset.kind === 'tile') { drawTile(ctx, asset, x, y, w, h, env, tMs); return 'tile'; }
    const m = motion || { from: 1, to: 1.06, focus: [0.5, 0.38], drift: [0, 0] };
    const e = ease.inOutSine(p);
    const zoom = (m.from || 1) + ((m.to || 1.06) - (m.from || 1)) * e;
    const fx = Math.max(0.05, Math.min(0.95, (m.focus || [0.5])[0] + ((m.drift || [0])[0] || 0) * e));
    const fy = Math.max(0.05, Math.min(0.95, (m.focus || [0.5, 0.38])[1] + ((m.drift || [0, 0])[1] || 0) * e));
    if (asset.kind === 'clip') {
      const vid = env.videos ? env.videos[assetId] : null;
      if (vid && (vid.readyState || 0) >= 2 && drawCover(ctx, vid, x, y, w, h, { zoom, fx, fy })) return 'clip';
      const poster = env.images ? env.images[assetId] : null;
      if (drawCover(ctx, poster, x, y, w, h, { zoom, fx, fy })) return 'clip';
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
      return 'clip-loading';
    }
    const img = env.images ? env.images[assetId] : null;
    if (drawCover(ctx, img, x, y, w, h, { zoom, fx, fy })) return asset.kind || 'photo';
    ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
    return 'loading';
  }

  function drawShot(ctx, shot, timeline, env, alpha) {
    if (!shot) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawVisual(ctx, shot.asset, { x: 0, y: 0, w: W, h: H }, timeline, env, { p: shot.p, local: shot.local, motion: shot.motion, tMs: shot.inMs + shot.local });
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
    if (S.LAYOUTS.includes(g.template)) { const st = S.get('classic'); drawStyledGraphic(ctx, frame, timeline, env, st, st.palette); return; }
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

  // ─── Styled engine (explainer, series, countdown; components in classic) ─
  const G = S.GRID;
  const CW = G.right - G.left; // 904
  const snap = v => Math.round(v / G.unit) * G.unit;
  const CHART_LAYOUTS = new Set(['stat-hero', 'bars', 'versus', 'dotrank', 'chips', 'tiles', 'roles', 'mystery']);
  const paletteOf = timeline => S.get(timeline.style).palette;
  // Colour tokens ('ink', 'accent', 'hi'…) resolve against the palette; a team
  // colour or any CSS colour passes through.
  const tone = (pal, c) => (c && pal[c]) || c || pal.ink;

  function textOp(measure, text, family, weight, size, x, y, { color = 'ink', role = 'text', upper = true, delay = 0, anim, bg, align = 'left', width } = {}) {
    const t = upper ? String(text).toUpperCase() : String(text);
    const f = font(weight, size, family);
    const w = measure(t, f);
    const x0 = align === 'center' ? (width != null ? x + (width - w) / 2 : x - w / 2) : (align === 'right' ? x - w : x);
    return { type: 'text', role, text: t, font: f, size, x: x0, y, w, color, delay, anim, bg };
  }
  function chipOp(measure, text, x, y, { fill = 'chip', ink = 'chipInk', size = 24, h = 44, role = 'chip', delay = 0, anim } = {}) {
    const t = String(text).toUpperCase();
    const f = font(700, size, S.LABEL);
    const w = measure(t, f) + 32;
    return [
      { type: 'rect', role: `${role}-bg`, x, y, w, h, fill, r: 4, delay, anim },
      { type: 'text', role, text: t, font: f, size, x: x + 16, y: y + h / 2 + size * 0.36, w: w - 32, color: ink, delay, anim },
    ];
  }
  // The headline: up to 3 lines; the emphasis word on a yellow highlight
  // (explainer, countdown) or in red (series; text after a colon turns red).
  function headlineOps(measure, d, top, style, { width = CW, maxLines = 3, align = 'left' } = {}) {
    const m = upperMeasure(measure);
    const [max, min] = style.type.headline;
    const fit = fitText(m, d.text || '', { family: style.type.display, weight: 700, max, min, maxLines, width });
    const ops = [];
    const lh = fit.size * 0.98;
    let y = top + fit.size * CAP;
    let n = 0;
    const colon = style.emphasis === 'color' ? String(d.text || '').indexOf(':') : -1;
    let seenChars = 0;
    fit.lines.forEach(line => {
      const x0 = align === 'center' ? G.left + (width - line.width) / 2 : G.left;
      line.words.forEach(word => {
        const lit = isEmph(word.text, d.emphasis);
        const afterColon = colon >= 0 && seenChars > colon;
        seenChars += word.text.length + 1;
        const red = style.emphasis === 'color' && (lit || afterColon);
        ops.push({ type: 'text', role: 'headline', text: word.text.toUpperCase(), font: fit.font, size: fit.size, x: x0 + word.x, y, w: word.w, color: red ? 'bad' : 'ink', bg: lit && style.emphasis !== 'color' ? 'hi' : '', bgInk: 'hiInk', delay: n * style.motion.stagger, anim: 'rise' });
        n += 1;
      });
      y += lh;
    });
    const bottom = top + fit.size * CAP + (fit.lines.length - 1) * lh;
    return { ops, bottom };
  }
  // A framed visual (photo, clip, tile…) in the style's frame.
  function visualOps(style, rect, { slot = 'shot', role = 'visual', cutout = false, delay = 80, round = false, label = '' } = {}, measure) {
    const ops = [];
    const frame = style.visual === 'card' ? 24 : 0;
    ops.push({ type: 'visual', role, slot, x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: round ? Math.min(rect.w, rect.h) / 2 : frame, cutout, delay, anim: style.motion.enter === 'flip' ? 'flip' : (style.motion.enter === 'wipe' ? 'wipe' : 'rise'), stroke: style.id === 'series' ? 'ink' : (round ? 'accent' : ''), lw: round ? 6 : 4 });
    if (style.id === 'explainer' && !round) ops.push({ type: 'rect', role: 'rule', x: rect.x, y: rect.y + rect.h + 8, w: rect.w, h: 8, fill: 'rule', delay: delay + 120, anim: 'grow' });
    if (label && measure) ops.push(...chipOp(measure, label, rect.x + 16, rect.y + 16, { fill: 'chip', ink: 'chipInk', size: 22, h: 40, role: 'visual-label', delay: delay + 160 }));
    return ops;
  }
  // Content box for a beat (below the headline, above the strip or captions).
  function contentBox(timeline, top) {
    const style = S.get(timeline.style);
    const bottom = style.engine === 'classic' ? ZONE.graphicBottom : (timeline.strip ? 1168 : 1280);
    return { x: G.left, y: snap(top), w: CW, h: Math.max(160, bottom - snap(top)), bottom };
  }
  const num = v => { const p = parseStatValue(v); return p ? p.num : NaN; };

  function layoutStyled(measure, graphic, timeline) {
    const style = S.get(timeline.style);
    const d = graphic.data || {};
    const ops = [];
    const layout = graphic.template;
    const top0 = style.engine === 'classic' ? 380 : 376;
    const head = layout === 'endcard' ? null : headlineOps(measure, layout === 'rank-card' && d.name ? { ...d, text: d.text || d.name } : d, top0, style, { maxLines: layout === 'headline-visual' ? 3 : 2 });
    if (head) ops.push(...head.ops);
    const box = contentBox(timeline, head ? head.bottom + 40 : top0);
    const st = style.motion.stagger;
    const L = style.type.labelSize;
    const delay0 = 200;
    if (layout === 'headline-visual' || layout === 'steps') {
      let y = box.y;
      if (layout === 'steps' && d.steps) {
        const cur = Math.max(0, Math.min(9, Number(d.steps.current) || 0));
        const tot = Math.max(1, Math.min(9, Number(d.steps.total) || 1));
        const chip = chipOp(measure, `${d.steps.label || 'STEP'} · STEP ${cur}/${tot}`, G.left, y, { fill: 'ink', ink: 'paper', size: 24, h: 44, role: 'steps', delay: delay0 });
        ops.push(...chip);
        const x0 = chip[0].x + chip[0].w + 16;
        for (let i = 0; i < tot; i += 1) ops.push({ type: 'rect', role: 'step-square', x: x0 + i * 52, y: y + 4, w: 36, h: 36, fill: i < cur ? 'accent' : 'line', r: 4, delay: delay0 + 60 + i * st, anim: 'pop' });
        y += 72;
      }
      const h = Math.min(box.bottom - y - (d.detail ? 96 : 24), 680);
      const label = d.label && style.engine !== 'classic' ? d.label : '';
      ops.push(...visualOps(style, { x: G.left, y, w: CW, h }, { cutout: style.cutout && graphic.index === 0, label, delay: delay0 }, measure));
      if (d.detail) {
        const fit = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(fit, y + h + 40, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 200, delayStep: 0 }).ops);
      }
    } else if (layout === 'stat-hero') {
      const value = String(d.stat?.value || '');
      const hasVisual = d.visual !== 'chart';
      const numW = hasVisual ? 480 : CW;
      const nf = fitText(measure, value, { family: style.type.display, weight: 700, max: style.type.stat[0], min: style.type.stat[1], maxLines: 1, width: numW });
      let y = box.y + nf.size * CAP;
      ops.push({ type: 'count', role: 'number', text: value, spec: parseStatValue(value), font: nf.font, size: nf.size, x: G.left, y, w: nf.lines[0] ? nf.lines[0].width : 0, color: 'accent', delay: delay0 });
      y += 32;
      if (d.stat?.label) {
        const lf = fitText(upperMeasure(measure), d.stat.label, { family: S.LABEL, weight: 700, max: L + 8, min: L - 6, maxLines: 1, width: numW });
        ops.push({ type: 'text', role: 'label', text: d.stat.label.toUpperCase(), font: lf.font, size: lf.size, x: G.left, y: y + lf.size * CAP, w: lf.lines[0] ? lf.lines[0].width : 0, color: 'ink', delay: delay0 + 160, anim: 'rise' });
        y += lf.size * CAP + 24;
      }
      if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 3, width: numW });
        const block = linesOps(df, y + 8, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 260, delayStep: 0 });
        ops.push(...block.ops);
        y = block.bottom + 24;
      }
      if (hasVisual) ops.push(...visualOps(style, { x: G.left + 512, y: box.y, w: CW - 512, h: Math.min(560, box.h - 24) }, { delay: delay0 + 80 }, measure));
      if (d.chips) ops.push(...chipsOps(measure, d.chips, { x: G.left, y: Math.max(y + 16, box.y + Math.min(560, box.h - 24) + 40), w: CW, bottom: box.bottom }, style, delay0 + 400, false));
    } else if (layout === 'rank-card') {
      const rank = d.rank || 0;
      const cardH = Math.min(style.id === 'countdown' ? 640 : 520, box.h - 260);
      ops.push(...visualOps(style, { x: G.left, y: box.y, w: CW, h: cardH }, { delay: delay0 }, measure));
      const rs = style.id === 'countdown' ? 260 : 200;
      const rf = font(700, rs, style.type.display);
      ops.push({ type: 'text', role: 'rank', text: `#${rank}`, font: rf, size: rs, x: G.left + 24, y: box.y + cardH + rs * CAP * 0.45, w: measure(`#${rank}`, rf), color: style.theme === 'dark' ? 'hi' : 'accent', stroke: style.theme === 'dark' ? 'bg' : 'paper', delay: delay0 + 120, anim: 'pop' });
      const nameTop = box.y + cardH + rs * CAP * 0.45 + 32;
      if (d.name && d.name !== d.text) {
        const nf = fitText(upperMeasure(measure), d.name, { family: style.type.display, weight: 700, max: 88, min: 60, maxLines: 1, width: CW });
        ops.push(...linesOps(nf, nameTop, { role: 'name', color: 'ink', baseDelay: delay0 + 200 }).ops);
      } else if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(df, nameTop, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 260, delayStep: 0 }).ops);
      }
    } else if (layout === 'quote') {
      const q = d.quote?.text || d.text;
      ops.push({ type: 'text', role: 'quote-mark', text: '“', font: font(700, 220, style.type.display), size: 220, x: G.left - 8, y: box.y + 150, w: 100, color: 'accent', delay: delay0, anim: 'pop' });
      const fit = fitText(measure, q, { family: style.type.display, weight: 700, max: 76, min: 50, maxLines: 6, width: CW });
      const body = linesOps(fit, box.y + 120, { lineHeight: 1.06, upper: false, role: 'quote', color: 'ink', baseDelay: delay0 + 100, delayStep: 24 });
      ops.push(...body.ops);
      if (d.quote?.by) {
        const by = `— ${d.quote.by}`;
        ops.push(...visualOps(style, { x: G.left, y: body.bottom + 40, w: 120, h: 120 }, { round: true, delay: delay0 + 400 }, measure));
        ops.push(textOp(measure, by, S.LABEL, 700, L, G.left + 144, body.bottom + 40 + 60 + L * 0.36, { role: 'byline', color: 'ink', delay: delay0 + 460, anim: 'rise' }));
      }
    } else if (layout === 'bars') {
      const bars = (d.bars || []).slice(0, 4);
      let y = box.y;
      if (d.detail) { ops.push(...chipOp(measure, d.detail.slice(0, 40), G.left, y, { fill: 'ink', ink: 'paper', size: 22, h: 40, role: 'bars-head', delay: delay0 })); y += 64; }
      const vals = bars.map(b => num(b.value)).filter(Number.isFinite);
      const max = Math.max(...vals.map(Math.abs), 1);
      const rowH = 104;
      const valueW = 220;
      bars.forEach((b, i) => {
        const v = Math.abs(num(b.value));
        const wBar = Math.round(240 + (CW - valueW - 240 - 24) * (Number.isFinite(v) ? v / max : 0.5));
        const fill = i === 0 ? 'accent' : 'ink';
        ops.push({ type: 'rect', role: 'bar', x: G.left, y, w: wBar, h: rowH - 24, fill, r: 4, delay: delay0 + i * 160, anim: 'grow' });
        const lf = fitText(upperMeasure(measure), b.label, { family: S.LABEL, weight: 700, max: 36, min: 24, maxLines: 1, width: wBar - 40 });
        ops.push({ type: 'text', role: 'bar-label', text: b.label.toUpperCase(), font: lf.font, size: lf.size, x: G.left + 20, y: y + (rowH - 24) / 2 + lf.size * 0.36, w: lf.lines[0] ? lf.lines[0].width : 0, color: i === 0 ? '#FFFFFF' : 'paper', delay: delay0 + i * 160 + 120, anim: 'fade' });
        const vf = fitText(measure, b.value, { family: style.type.display, weight: 700, max: 80, min: 48, maxLines: 1, width: valueW });
        ops.push({ type: 'text', role: 'bar-value', text: b.value, font: vf.font, size: vf.size, x: G.left + wBar + 24, y: y + (rowH - 24) / 2 + vf.size * 0.36, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? 'accent' : 'ink', delay: delay0 + i * 160 + 200, anim: 'rise' });
        y += rowH;
      });
      if (box.bottom - y > 300) ops.push(...visualOps(style, { x: G.left, y: y + 24, w: CW, h: Math.min(480, box.bottom - y - 48) }, { delay: delay0 + 500 }, measure));
    } else if (layout === 'versus') {
      const list = (d.versus || []).slice(0, 3);
      const n = Math.max(1, list.length);
      const gap = 24;
      const cw = Math.floor((CW - gap * (n - 1)) / n);
      const vh = Math.min(400, box.h - 260);
      list.forEach((v, i) => {
        const x = G.left + i * (cw + gap);
        const dl = delay0 + i * 140;
        if (v.name === '?') {
          ops.push({ type: 'rect', role: 'mystery', x, y: box.y, w: cw, h: vh, fill: 'mystery', r: style.visual === 'card' ? 24 : 4, delay: dl, anim: 'flip' });
          ops.push(textOp(measure, '?', style.type.display, 700, 200, x, box.y + vh / 2 + 70, { role: 'mystery-mark', color: 'muted', align: 'center', width: cw, delay: dl + 100, anim: 'pop' }));
          return;
        }
        ops.push({ type: 'visual', role: 'headshot', slot: v.asset || '', x, y: box.y, w: cw, h: vh, r: style.visual === 'card' ? 24 : 0, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'rise', stroke: style.id === 'series' ? 'ink' : '', lw: 4 });
        ops.push(...chipOp(measure, v.name, x + 12, box.y + vh - 56, { fill: 'ink', ink: 'paper', size: 24, h: 44, role: 'versus-name', delay: dl + 120 }));
        if (v.value) {
          const vf = fitText(measure, v.value, { family: style.type.display, weight: 700, max: style.type.cardValue[0], min: style.type.cardValue[1] - 16, maxLines: 1, width: cw });
          ops.push({ type: 'text', role: 'versus-value', text: v.value, font: vf.font, size: vf.size, x, y: box.y + vh + 24 + vf.size * CAP, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? 'accent' : 'ink', delay: dl + 200, anim: 'rise' });
          if (v.note) {
            const nf = fitText(measure, v.note, { family: style.type.body, weight: 500, max: 26, min: 22, maxLines: 2, width: cw });
            ops.push(...linesOps(nf, box.y + vh + 24 + vf.size * CAP + 24, { lineHeight: 1.2, upper: false, role: 'versus-note', color: 'muted', baseDelay: dl + 260, delayStep: 0 }).ops);
          }
        }
      });
    } else if (layout === 'dotrank') {
      const r = d.dotrank || {};
      const total = Math.max(1, Math.round(num(r.total)) || 1);
      const rank = Math.max(1, Math.min(total, Math.round(num(r.rank)) || 1));
      const R1 = Math.min(340, (box.h - 120) / 2);
      const cx = W / 2;
      const cy = box.y + R1 + 8;
      ops.push({ type: 'dotring', role: 'dots', cx, cy, r0: 104, r1: R1, n: Math.min(total, 1200), total, rank, x: cx - R1, y: cy - R1, w: R1 * 2, h: R1 * 2, delay: delay0 });
      ops.push({ type: 'visual', role: 'avatar', slot: 'shot', x: cx - 88, y: cy - 88, w: 176, h: 176, r: 88, stroke: 'accent', lw: 6, delay: delay0 + 200, anim: 'pop' });
      const callout = `#${r.rank}${r.label ? ` ${r.label}` : ''}`;
      const cf = font(700, 28, S.LABEL);
      const cwid = Math.min(CW, measure(callout.toUpperCase(), cf) + 32);
      const cxL = Math.min(G.right - cwid, cx + 104);
      ops.push({ type: 'rect', role: 'callout-bg', x: cxL, y: cy - R1 - 8, w: cwid, h: 48, fill: 'bad', r: 4, delay: delay0 + 900, anim: 'pop' });
      ops.push({ type: 'text', role: 'callout', text: callout.toUpperCase(), font: cf, size: 28, x: cxL + 16, y: cy - R1 - 8 + 34, w: cwid - 32, color: '#FFFFFF', delay: delay0 + 900, anim: 'fade' });
      if (r.note) {
        const nf = fitText(measure, r.note, { family: style.type.body, weight: 500, max: 28, min: 22, maxLines: 2, width: CW });
        ops.push(...linesOps(nf, cy + R1 + 40, { lineHeight: 1.2, upper: false, role: 'dots-note', color: 'muted', baseDelay: delay0 + 600, delayStep: 0 }).ops);
      }
    } else if (layout === 'chips') {
      ops.push(...chipsOps(measure, d.chips || {}, { x: G.left, y: box.y, w: CW, bottom: box.bottom }, style, delay0, true));
    } else if (layout === 'tiles') {
      const list = (d.tiles || []).slice(0, 4);
      const cols = list.length <= 1 ? 1 : 2;
      const rows = Math.ceil(list.length / cols) || 1;
      const gap = 24;
      const tw = Math.floor((CW - gap * (cols - 1)) / cols);
      const th = Math.min(320, Math.floor((box.h - gap * (rows - 1)) / rows));
      list.forEach((t, i) => {
        const x = G.left + (i % cols) * (tw + gap);
        const y = box.y + Math.floor(i / cols) * (th + gap);
        const dl = delay0 + i * 120;
        ops.push({ type: 'rect', role: 'tile', x, y, w: tw, h: th, fill: t.colors[0] || 'panel', r: style.visual === 'card' ? 24 : 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'wipe' });
        if (t.asset) ops.push({ type: 'logo', role: 'tile-logo', slot: t.asset, x: x + tw - 128, y: y + 24, w: 104, h: 104, delay: dl + 80, anim: 'pop' });
        const nf = fitText(upperMeasure(measure), t.team, { family: style.type.display, weight: 700, max: 64, min: 40, maxLines: 1, width: tw - 48 });
        ops.push({ type: 'text', role: 'tile-name', text: t.team.toUpperCase(), font: nf.font, size: nf.size, x: x + 24, y: y + th - 104, w: nf.lines[0] ? nf.lines[0].width : 0, color: '#FFFFFF', delay: dl + 120, anim: 'rise' });
        if (t.label) {
          const lf = fitText(measure, t.label, { family: style.type.body, weight: 500, max: 24, min: 20, maxLines: 1, width: tw - 48 });
          ops.push({ type: 'text', role: 'tile-label', text: t.label, font: lf.font, size: lf.size, x: x + 24, y: y + th - 64, w: lf.lines[0] ? lf.lines[0].width : 0, color: 'rgba(255,255,255,0.88)', delay: dl + 160, anim: 'fade' });
        }
        if (t.chip) ops.push(...chipOp(measure, t.chip, x + 24, y + 24, { fill: 'hi', ink: 'hiInk', size: 22, h: 40, role: 'tile-chip', delay: dl + 200 }));
      });
    } else if (layout === 'roles') {
      const list = (d.roles || []).slice(0, 4);
      const cols = list.length <= 1 ? 1 : 2;
      const rows = Math.ceil(list.length / cols) || 1;
      const gap = 16;
      const tw = Math.floor((CW - gap * (cols - 1)) / cols);
      const th = Math.min(340, Math.floor((box.h - gap * (rows - 1)) / rows));
      list.forEach((r, i) => {
        const x = G.left + (i % cols) * (tw + gap);
        const y = box.y + Math.floor(i / cols) * (th + gap);
        const dl = delay0 + i * 120;
        ops.push({ type: 'rect', role: 'role-card', x, y, w: tw, h: th, fill: r.tone, r: 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'wipe' });
        ops.push(textOp(measure, r.role, S.LABEL, 700, 36, x + 24, y + 56, { role: 'role', color: '#FFFFFF', delay: dl + 80, anim: 'fade' }));
        const vf = fitText(measure, r.value, { family: style.type.display, weight: 700, max: 132, min: 72, maxLines: 1, width: tw - 48 });
        ops.push({ type: 'text', role: 'role-value', text: r.value, font: vf.font, size: vf.size, x: x + 24, y: y + 72 + vf.size * CAP, w: vf.lines[0] ? vf.lines[0].width : 0, color: '#FFFFFF', delay: dl + 140, anim: 'pop' });
        if (r.note) ops.push(...chipOp(measure, r.note.slice(0, 28), x + 24, y + th - 64, { fill: 'ink', ink: 'paper', size: 20, h: 40, role: 'role-note', delay: dl + 220 }));
      });
    } else if (layout === 'mystery') {
      const h = Math.min(560, box.h - (d.detail ? 120 : 24));
      ops.push({ type: 'rect', role: 'mystery', x: G.left, y: box.y, w: CW, h, fill: 'mystery', r: style.visual === 'card' ? 24 : 4, delay: delay0, anim: 'flip' });
      ops.push(textOp(measure, '?', style.type.display, 700, 320, G.left, box.y + h / 2 + 112, { role: 'mystery-mark', color: 'muted', align: 'center', width: CW, delay: delay0 + 160, anim: 'pop' }));
      if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(df, box.y + h + 40, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 300, delayStep: 0 }).ops);
      }
    } else if (layout === 'endcard') {
      const head2 = headlineOps(measure, d, 760, style, { align: 'center', maxLines: 3 });
      ops.push({ type: 'esmark', role: 'es-mark', x: (W - 168) / 2, y: 520, w: 168, h: 143, delay: 0 });
      ops.push(...head2.ops);
      ops.push(textOp(measure, 'ESSENTIALLYSPORTS', S.LABEL, 700, 32, 0, head2.bottom + 80, { role: 'sub', color: 'muted', align: 'center', width: W, delay: 420, anim: 'fade' }));
    }
    // Every op gets the style's entrance unless the layout chose one.
    ops.forEach(op => { if (!op.anim) op.anim = style.motion.enter; });
    return ops;
  }
  // "1 IN 5": the fraction as type, then one square per item (up to 12).
  function chipsOps(measure, c, rect, style, delay, withVisual) {
    const ops = [];
    const filled = Math.round(num(c.filled));
    const total = Math.round(num(c.total));
    if (!(total >= 1) || !(filled >= 0)) return ops;
    const big = `${c.filled} IN ${c.total}`;
    const bf = font(700, 120, style.type.display);
    ops.push({ type: 'text', role: 'chips-big', text: big, font: bf, size: 120, x: rect.x, y: rect.y + 120 * CAP, w: measure(big, bf), color: 'accent', delay, anim: 'rise' });
    let y = rect.y + 120 * CAP + 32;
    if (total <= 12) {
      const gap = 12;
      const side = Math.min(152, Math.floor((rect.w - gap * (total - 1)) / total));
      for (let i = 0; i < total; i += 1) ops.push({ type: 'rect', role: 'chip-square', x: rect.x + i * (side + gap), y, w: side, h: side, fill: i < filled ? 'accent' : 'mystery', r: 4, delay: delay + 120 + i * 60, anim: 'pop' });
      y += side + 24;
    }
    if (c.label) {
      const lf = fitText(upperMeasure(measure), c.label, { family: S.LABEL, weight: 700, max: 32, min: 24, maxLines: 1, width: rect.w });
      ops.push({ type: 'text', role: 'chips-label', text: c.label.toUpperCase(), font: lf.font, size: lf.size, x: rect.x, y: y + lf.size * CAP, w: lf.lines[0] ? lf.lines[0].width : 0, color: 'ink', delay: delay + 400, anim: 'fade' });
      y += lf.size * CAP + 32;
    }
    if (withVisual && rect.bottom - y > 280) ops.push(...visualOps(style, { x: rect.x, y, w: rect.w, h: Math.min(520, rect.bottom - y - 24) }, { delay: delay + 300 }, measure));
    return ops;
  }

  // Chrome drawn on every frame: eyebrow, ES badge, series tag, data strip, rail.
  function layoutChrome(measure, timeline, frame) {
    const style = S.get(timeline.style);
    const ops = [];
    if (style.engine === 'classic') return ops;
    const c = style.chrome;
    if (c.badge) {
      ops.push({ type: 'rect', role: 'badge', x: G.right - 64, y: G.top, w: 64, h: 64, fill: 'accent', r: 4 });
      ops.push(textOp(measure, 'ES', style.type.display, 700, 40, G.right - 64, G.top + 46, { role: 'badge-text', color: '#FFFFFF', align: 'center', width: 64, upper: false }));
    }
    if (c.seriesTag && timeline.series) ops.push(...chipOp(measure, timeline.series.tag, G.left, G.top + 10, { fill: 'chip', ink: 'chipInk', size: 24, h: 44, role: 'series-tag' }));
    else if (c.eyebrow && (timeline.eyebrow || timeline.title)) {
      const t = String(timeline.eyebrow || timeline.title).toUpperCase();
      const fit = fitText(measure, t, { family: S.LABEL, weight: 700, max: style.type.eyebrow, min: 20, maxLines: 1, width: CW - 96 });
      ops.push({ type: 'text', role: 'eyebrow', text: t, font: fit.font, size: fit.size, x: G.left, y: G.top + 40, w: fit.lines[0] ? fit.lines[0].width : 0, color: 'muted' });
    }
    if (c.rail) {
      const ranks = timeline.beats.filter(b => b.kind === 'rank').map(b => b.rank).sort((a, b) => b - a);
      const cur = frame && frame.graphic ? (timeline.beats[frame.beatIndex] || {}).rank : null;
      ranks.forEach((r, i) => {
        const on = r === cur;
        ops.push({ type: 'rect', role: 'rail', x: G.left + i * 72, y: G.top + 8, w: 60, h: 48, fill: on ? 'hi' : 'panel', r: 8 });
        ops.push(textOp(measure, `#${r}`, style.type.display, 700, 32, G.left + i * 72, G.top + 8 + 36, { role: 'rail-text', color: on ? 'hiInk' : 'muted', align: 'center', width: 60, upper: false }));
      });
    }
    if (c.strip && timeline.strip) {
      const sp = timeline.strip;
      const y = 1192;
      ops.push({ type: 'rect', role: 'strip', x: G.left, y, w: CW, h: 104, fill: 'panel', stroke: 'ink', lw: 3, r: 4 });
      ops.push(textOp(measure, sp.label || '', S.LABEL, 700, 22, G.left + 24, y + 32, { role: 'strip-label', color: 'muted' }));
      const vf = font(700, 60, style.type.display);
      ops.push({ type: 'count', role: 'strip-value', text: sp.value, spec: parseStatValue(sp.value), font: vf, size: 60, x: G.left + 24, y: y + 86, w: measure(sp.value, vf), color: sp.tone, delay: 0, once: true });
      const ratio = sp.of && Number.isFinite(num(sp.value)) && num(sp.of) ? Math.max(0, Math.min(1, Math.abs(num(sp.value)) / Math.abs(num(sp.of)))) : null;
      if (sp.note) ops.push(textOp(measure, sp.note, S.LABEL, 700, 20, G.left + 520, y + 32, { role: 'strip-note', color: 'muted' }));
      ops.push({ type: 'rect', role: 'strip-track', x: G.left + 520, y: y + 52, w: 360, h: 28, fill: 'mystery', r: 4 });
      if (ratio != null) ops.push({ type: 'rect', role: 'strip-fill', x: G.left + 520, y: y + 52, w: Math.max(8, 360 * ratio), h: 28, fill: sp.tone, r: 4, anim: 'grow', once: true });
    }
    return ops;
  }

  // Block captions: each word in a dark box, the spoken word in yellow.
  function layoutBlockCaption(measure, card, timeline) {
    const style = S.get(timeline.style);
    const words = timeline.tracks.captions.words;
    const list = card.words.map(i => ({ i, text: words[i].w.replace(/^[“"]|[”"]$/g, '').toUpperCase() }));
    const [max, min] = style.type.caption;
    const pad = 12;
    const gap = 8;
    let size = max;
    let lines;
    const build = () => {
      const f = font(700, size, style.type.display);
      const out = [[]];
      let width = 0;
      list.forEach(w => {
        const ww = measure(w.text, f) + pad * 2;
        if (out[out.length - 1].length && width + gap + ww > 860) { out.push([]); width = 0; }
        out[out.length - 1].push({ ...w, w: ww });
        width += (out[out.length - 1].length > 1 ? gap : 0) + ww;
      });
      return out;
    };
    lines = build();
    while (lines.length > 2 && size > min) { size = Math.max(min, size * 0.92); lines = build(); }
    const f = font(700, size, style.type.display);
    const boxH = size * CAP + 2 * pad + 4;
    const ops = [];
    const blockH = lines.length * boxH + (lines.length - 1) * gap;
    let y = (timeline.strip ? 1480 : 1500) - blockH;
    lines.forEach(line => {
      const lw = line.reduce((a, w) => a + w.w, 0) + gap * (line.length - 1);
      let x = (W - lw) / 2;
      line.forEach(w => {
        ops.push({ type: 'cword', i: w.i, text: w.text, font: f, size, x: x + pad, y: y + pad + 2 + size * CAP, w: w.w - pad * 2, box: { x, y, w: w.w, h: boxH } });
        x += w.w + gap;
      });
      y += boxH + gap;
    });
    return { style: 'block', ops, box: null };
  }

  // ─── Styled drawing ─────────────────────────────────────────────────────
  function animState(op, local, style, exitP) {
    const dur = style.motion.durMs;
    const p = ease.outCubic(progress(local - (op.delay || 0), 0, dur));
    const exitA = 1 - ease.outCubic(exitP);
    return { p, a: p * exitA, dy: op.anim === 'rise' || op.anim === 'fade' ? (op.anim === 'rise' ? (1 - p) * 32 : 0) - 16 * ease.outCubic(exitP) : -16 * ease.outCubic(exitP) };
  }
  function withAnim(ctx, op, st, fn) {
    if (st.a <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= st.a;
    const cx = op.x + (op.w || 0) / 2;
    const cy = (op.type === 'text' || op.type === 'count') ? op.y - op.size * CAP / 2 : op.y + (op.h || 0) / 2;
    if (op.anim === 'flip') { ctx.translate(cx, 0); ctx.scale(Math.max(0.02, st.p), 1); ctx.translate(-cx, 0); } else if (op.anim === 'pop') {
      const k = 0.86 + 0.14 * ease.outBack(st.p);
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    } else if (op.anim === 'wipe' && (op.type === 'rect' || op.type === 'visual')) {
      ctx.beginPath(); ctx.rect(op.x - 8, op.y - 8, ((op.w || 0) + 16) * st.p, (op.h || 0) + 16); ctx.clip();
    }
    ctx.translate(0, st.dy);
    fn();
    ctx.restore();
  }
  function fillRound(ctx, x, y, w, h, r) {
    if (r > 0) { roundRect(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
  }
  function drawStyledOp(ctx, op, st, timeline, env, frame, pal, style) {
    const hl = timeline.highlight || ES_BLUE;
    if (op.type === 'rect') {
      ctx.fillStyle = tone(pal, op.fill);
      const w = op.anim === 'grow' ? op.w * ease.outQuint(st.p) : op.w;
      fillRound(ctx, op.x, op.y, w, op.h, op.r || 0);
      if (op.stroke) { ctx.strokeStyle = tone(pal, op.stroke); ctx.lineWidth = op.lw || 2; roundRect(ctx, op.x, op.y, op.w, op.h, op.r || 0); ctx.stroke(); }
    } else if (op.type === 'text') {
      ctx.font = op.font;
      if (op.bg) {
        const padX = op.size * 0.1;
        const reveal = ease.outQuint(progress((st.p * style.motion.durMs) - 60, 0, 320));
        ctx.fillStyle = tone(pal, op.bg);
        fillRound(ctx, op.x - padX, op.y - op.size * CAP - op.size * 0.12, (op.w + padX * 2) * Math.max(reveal, st.p >= 1 ? 1 : 0), op.size * (CAP + 0.24), op.size * 0.06);
      }
      if (op.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = op.size * 0.05; ctx.strokeStyle = tone(pal, op.stroke); ctx.strokeText(op.text, op.x, op.y); }
      ctx.fillStyle = op.bg ? tone(pal, op.bgInk || 'ink') : tone(pal, op.color);
      if (style.theme === 'dark' && !op.bg) textShadow(ctx, true);
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.type === 'count') {
      ctx.font = op.font;
      ctx.fillStyle = tone(pal, op.color);
      const c = op.once ? ease.outQuint(progress(frame.t, 200, 900)) : ease.outQuint(progress(st.p * style.motion.durMs * 2.2, 0, 900));
      ctx.fillText(op.spec ? formatStat(op.spec, op.spec.num * c) : op.text, op.x, op.y);
    } else if (op.type === 'visual' || op.type === 'logo') {
      const slot = op.slot === 'shot' ? (frame.shot && frame.shot.asset) || '' : op.slot;
      ctx.save();
      ctx.beginPath();
      if (op.r) roundRect(ctx, op.x, op.y, op.w, op.h, op.r); else ctx.rect(op.x, op.y, op.w, op.h);
      if (op.type === 'logo') {
        const img = env.images && env.images[slot];
        const size = mediaSize(img);
        if (size) { const k = Math.min(op.w / size[0], op.h / size[1]); ctx.drawImage(img, op.x + (op.w - size[0] * k) / 2, op.y + (op.h - size[1] * k) / 2, size[0] * k, size[1] * k); }
        ctx.restore();
        return;
      }
      ctx.clip();
      const cut = op.cutout && slot && env.cutouts ? env.cutouts[slot] : null;
      // With a cut-out: the frame shows the beat's second picture (or the
      // same one, darker) and the player stands over it, above the frame.
      const inset = cut ? ((frame.shot && timeline.tracks.video.find(s => s.beat === frame.shot.beat && s.asset && s.asset !== slot)) || {}).asset || slot : slot;
      const kind = drawVisual(ctx, inset, op, timeline, env, { p: frame.shot ? frame.shot.p : 0, motion: frame.shot ? frame.shot.motion : null, tMs: frame.t });
      if (cut && inset === slot) { ctx.fillStyle = 'rgba(10,12,16,0.45)'; ctx.fillRect(op.x, op.y, op.w, op.h); }
      if (kind === 'empty' && style.theme === 'light') { /* plain black until a visual is picked */ }
      ctx.restore();
      if (op.stroke) { ctx.strokeStyle = tone(pal, op.stroke) === pal.accent ? pal.accent : tone(pal, op.stroke); ctx.lineWidth = op.lw || 4; ctx.beginPath(); if (op.r) roundRect(ctx, op.x, op.y, op.w, op.h, op.r); else ctx.rect(op.x, op.y, op.w, op.h); ctx.stroke(); }
      if (cut) {
        const size = mediaSize(cut);
        if (size) {
          const h = op.h * 1.32;
          const w = (size[0] / size[1]) * h;
          const lift = (1 - st.p) * 40;
          ctx.drawImage(cut, op.x + op.w * 0.62 - w / 2, op.y + op.h - h + lift, w, h);
        }
      }
    } else if (op.type === 'dotring') {
      // Phyllotaxis: n dots from r0 to r1, rank 1 nearest the centre.
      const shown = Math.floor(op.n * ease.outCubic(st.p));
      const ga = Math.PI * (3 - Math.sqrt(5));
      const rankAt = op.total > 1 ? (op.rank - 1) / (op.total - 1) : 0;
      ctx.fillStyle = tone(pal, 'muted');
      for (let i = 0; i < shown; i += 1) {
        const f = op.n > 1 ? i / (op.n - 1) : 0;
        const rr = op.r0 + (op.r1 - op.r0) * Math.sqrt(f);
        const a = i * ga;
        ctx.globalAlpha = 0.5 * st.a;
        ctx.fillRect(op.cx + Math.cos(a) * rr - 2.5, op.cy + Math.sin(a) * rr - 2.5, 5, 5);
      }
      ctx.globalAlpha = st.a;
      const rr = op.r0 + (op.r1 - op.r0) * Math.sqrt(rankAt);
      ctx.strokeStyle = tone(pal, 'accent');
      ctx.lineWidth = 4;
      if (ctx.setLineDash) ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.arc(op.cx, op.cy, rr * ease.outCubic(progress(st.p, 0.4, 0.6)), 0, Math.PI * 2); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.fillStyle = tone(pal, 'bad');
      ctx.beginPath(); ctx.arc(op.cx + rr, op.cy, 10, 0, Math.PI * 2); ctx.fill();
    } else if (op.type === 'esmark') {
      const img = env.images && env.images['logo:es'];
      if (mediaSize(img)) ctx.drawImage(img, op.x, op.y, op.w, op.h);
      else { ctx.fillStyle = pal.accent; ctx.fillRect(op.x, op.y, op.w, op.h); }
    }
    void hl;
  }
  function drawBackground(ctx, timeline, frame, env, style, pal) {
    const layout = frame.graphic ? frame.graphic.template : '';
    const shot = frame.shot;
    const clipBehind = shot && shot.asset && timeline.assets[shot.asset] && timeline.assets[shot.asset].kind === 'clip' && CHART_LAYOUTS.has(layout);
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, W, H);
    if (clipBehind) {
      // Data beats sit over the clip, tinted to the paper so the chart reads.
      ctx.save();
      drawVisual(ctx, shot.asset, { x: 0, y: 0, w: W, h: H }, timeline, env, { p: shot.p, motion: shot.motion, tMs: frame.t });
      ctx.globalAlpha = style.theme === 'light' ? 0.86 : 0.8;
      ctx.fillStyle = pal.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // Texture: dots (explainer), a grid (series), diagonal lines (countdown).
    ctx.save();
    ctx.globalAlpha = style.theme === 'light' ? 0.07 : 0.06;
    ctx.fillStyle = pal.ink;
    ctx.strokeStyle = pal.ink;
    if (pal.texture === 'dots') { for (let y = 16; y < H; y += 40) for (let x = 16; x < W; x += 40) ctx.fillRect(x, y, 3, 3); } else if (pal.texture === 'grid') {
      ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= W; x += 72) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += 72) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    } else if (pal.texture === 'lines') {
      ctx.lineWidth = 2; ctx.beginPath();
      for (let k = -H; k < W; k += 56) { ctx.moveTo(k, H); ctx.lineTo(k + H * 0.6, 0); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawStyledGraphic(ctx, frame, timeline, env, style, pal) {
    const g = frame.graphic;
    if (!g) return;
    const ops = env.layoutCache ? env.layoutCache(g) : layoutGraphic(env.measure, g, timeline);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ops.forEach(op => {
      const st = animState(op, g.local + (g.inMs === 0 && (op.delay || 0) <= 80 ? 200 : 0), style, g.exit);
      withAnim(ctx, op, st, () => drawStyledOp(ctx, op, st, timeline, env, frame, pal, style));
    });
    ctx.restore();
  }
  function drawChrome(ctx, frame, timeline, env, style, pal) {
    const ops = layoutChrome(env.measure, timeline, frame);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ops.forEach(op => drawStyledOp(ctx, op, { p: 1, a: 1, dy: 0 }, timeline, env, frame, pal, style));
    ctx.restore();
  }
  function drawBlockCaption(ctx, frame, timeline, env, style, pal) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    const appear = ease.outCubic(progress(card.local, 0, 140));
    ctx.save();
    ctx.globalAlpha = appear;
    const dy = (1 - appear) * 12;
    layout.ops.forEach(op => {
      const on = op.i === card.active;
      ctx.fillStyle = style.caption.box || '#111214';
      ctx.fillRect(op.box.x, op.box.y + dy, op.box.w, op.box.h);
      ctx.font = op.font;
      ctx.fillStyle = on ? (style.caption.active || '#FFD23F') : (style.caption.ink || '#FFFFFF');
      ctx.fillText(op.text, op.x, op.y + dy);
    });
    ctx.restore();
  }
  function drawStyledFrame(ctx, timeline, frame, env) {
    const style = S.get(timeline.style);
    const pal = style.palette;
    drawBackground(ctx, timeline, frame, env, style, pal);
    drawChrome(ctx, frame, timeline, env, style, pal);
    drawStyledGraphic(ctx, frame, timeline, env, style, pal);
    if (timeline.captionStyle === 'block') drawBlockCaption(ctx, frame, timeline, env, style, pal);
    else drawCaption(ctx, frame, timeline, env);
  }

  // env: { measure(text, font), images: { assetId: Image }, grain }
  function drawFrame(ctx, timeline, tMs, env = {}) {
    const frame = frameAt(timeline, tMs);
    ctx.save();
    if (S.get(timeline.style).engine !== 'classic') {
      drawStyledFrame(ctx, timeline, frame, env);
      ctx.restore();
      return frame;
    }
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
    buildTimeline, frameAt, wrap, fitText, layoutGraphic, layoutCaption, layoutChrome, textBoxes, drawFrame,
    clipTimes, clipTime, drawVisual, allBoxes, CHART_LAYOUTS,
  };
}));
