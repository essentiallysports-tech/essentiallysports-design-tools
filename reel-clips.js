// Reels Studio clip picker: which clip goes on which beat, and which part of
// it. One file for the browser (window.ReelClips), the server and the tests
// (require), like reel-formats.js.
//
//   subjectFor(beat, plan)            -> { key, terms, team, players }
//   heuristicScore(clip, subject)     -> { score, parts }   (free, always on)
//   judgedScore(clip, subject, j)     -> score with the vision judgement
//   motionEnergy(frames)              -> [0..1] per sample (tiny grey frames)
//   bestSegment(samples, beatSec, clipSec) -> { inSec, outSec, score }
//   assign(pool, beats, plan, opts)   -> { [beatId]: { clip, score, why, segment } }
//   preselect(pool, beats, plan, n)   -> the clips worth sampling and judging
//   judgeCost({ clips, frames, model }) -> USD estimate for one judge call
//   validateJudgement(raw, frameCount) -> a clean judgement or null
//   makeCache(storage)                -> judgements per clip URL (7 days)
//   sampleClip(video, opts)           -> browser only: frames + motion
//
// Ranking (per beat): relevance to the beat's subject (team or player, from
// the post text, the clip's tagged teams / players and, when AI is on, what a
// vision model saw in sampled frames), recency, quality (resolution, length,
// motion, a clean picture) and source (official team > league > media). The
// same clip is not reused while another good one is free; when a clip must be
// reused, a different segment of it is used.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelClips = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // The vision judge. Gemini 3.8 Flash: the newest Flash on the Gateway
  // (2026-11-18, $0.75 in / $3.75 out per 1M), strong on frames and sports
  // scenes, about $0.01 per reel for 8 clips x 3 frames. Claude Haiku 5.5
  // ($0.10 / $0.50, vision) is the fallback when Gemini fails.
  // Reels v3: up to 24 candidates per reel (was 8), 4 per call, capped at
  // $0.03 a reel (24 x 3 frames ~ $0.030 on Gemini 3.8 Flash).
  const JUDGE = {
    model: 'google/gemini-3.8-flash',
    fallback: 'anthropic/claude-haiku-5.5',
    maxUsdPerReel: 0.03,
    maxClips: 24,
    perCall: 4, // clips per request (4 x 3 small JPEGs ~ 160-240 KB; the mode allows 320 KB)
    framesPerClip: 3,
    frameWidth: 320,
    tokensPerFrame: 260, // Gemini counts a small image at ~258 tokens; Claude ~(w*h)/750
    promptTokens: 900,
    outTokensPerClip: 120,
    cacheDays: 7,
  };
  // The relevance gate (Reels v3): a clip goes on a scene only when the judge
  // confirms its subject (relevance >= 7 of 10) and, when the scene names a
  // moment, the moment (>= 5), and it is real footage (not a graphic or a
  // studio segment). No gate pass, no clip: the scene takes a verified photo
  // or an infographic block instead.
  const GATE = { relevance: 7, moment: 5, badKinds: ['graphic-or-text', 'studio-talk'] };
  const PRICES = {
    'google/gemini-3.8-flash': { input: 0.75, output: 3.75 },
    'google/gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
    'anthropic/claude-haiku-5.5': { input: 0.10, output: 0.50 },
    'anthropic/claude-sonnet-5.5': { input: 2, output: 10 },
  };
  const KINDS = ['game-action', 'highlight-replay', 'celebration', 'practice', 'press-conference', 'interview', 'crowd-stadium', 'graphic-or-text', 'studio-talk', 'other'];
  // How much each kind of footage suits a reel beat (moving sport first).
  const KIND_FIT = { 'game-action': 1, 'highlight-replay': 0.95, celebration: 0.85, practice: 0.6, 'crowd-stadium': 0.5, interview: 0.45, 'press-conference': 0.4, 'studio-talk': 0.2, 'graphic-or-text': 0.1, other: 0.3 };
  const SOURCE_FIT = { official: 1, league: 0.85, media: 0.7, other: 0.35, fan: 0.35 };

  const norm = v => String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[^\w\s#]/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'his', 'her', 'their', 'from', 'into', 'what', 'just', 'now', 'look', 'other', 'stars', 'many', 'more', 'than', 'year', 'season', 'game', 'team', 'nfl', 'mlb', 'cfb', 'right', 'back', 'here', 'where', 'which', 'why', 'how', 'who', 'are', 'was', 'has', 'have', 'not', 'isn', 'your', 'our', 'out', 'over']);
  const tokens = v => norm(v).split(' ').filter(w => w.length > 2 && !STOP.has(w));

  // ─── Subject of a beat ───────────────────────────────────────────────────
  // The players or teams the beat is about: its photo query, versus names,
  // rank name and words of its text; the reel's team as a backstop.
  function subjectFor(beat = {}, plan = {}) {
    // Reels v3: the director's per-scene subject leads when there is one.
    const sub = beat.subject && typeof beat.subject === 'object' && beat.subject.name ? subjectOfBeat(beat, plan) : null;
    const team = sub && sub.team ? sub.team : (plan.team && plan.team.name ? String(plan.team.name) : '');
    const named = [sub && sub.type === 'player' ? sub.name : '', beat.photo, beat.name, ...(Array.isArray(beat.versus) ? beat.versus.map(v => v && v.name !== '?' ? (v.photo || v.name) : '') : [])].filter(Boolean).map(String);
    const players = [...new Set(named.filter(n => !team || norm(n) !== norm(team)))];
    const terms = [...new Set([...named.flatMap(tokens), ...tokens(sub && sub.moment).slice(0, 4), ...tokens(beat.text).slice(0, 6)])];
    const key = sub ? sub.key : (norm(players[0] || team || beat.text || '').slice(0, 40) || 'reel');
    return { key, terms, team, teamTerms: tokens(team), players, ...(sub ? { type: sub.type, name: sub.name, moment: sub.moment || '', date: sub.date || '' } : {}) };
  }

  // ─── Reels v3: styles, scene subjects, the relevance gate ───────────────
  const STYLE_IDS = ['gametape', 'statcard', 'receipts', 'hypecut'];
  // What media each style puts on its scenes (ENGINE's ReelES.STYLES decides
  // the blocks; this is only the sourcing side). order: what to try, in turn.
  const STYLE_MEDIA = {
    gametape: { clips: 1, photos: 1, order: ['clip', 'photo'] },
    hypecut: { clips: 1, photos: 1, order: ['clip', 'photo'] },
    statcard: { clips: 0, photos: 1, order: ['photo'] },
    receipts: { clips: 0, photos: 0, order: [] },
  };
  // Blocks that carry a picture, and which kind ('any' = the style's order).
  const MEDIA_BLOCKS = { hook: 'any', statement: 'any', tagPill: 'any', clipLabel: 'clip', photoCard: 'photo' };
  // Contract legacy map: look / recipe -> style.
  const LEGACY = {
    receipts: ['data', 'data-led', 'stat drop', 'stat-drop', 'statdrop', 'money story', 'money', 'versus', 'paper', 'ink', 'blue', 'team', 'minimal', 'quote', 'explainer'],
    statcard: ['photo', 'photo-led'],
    hypecut: ['bold', 'countdown', 'hype'],
  };
  const lc = v => String(v == null ? '' : v).trim().toLowerCase();
  function legacyStyle(look = '', recipe = '', plan = null) {
    const hasClips = Boolean(plan && Array.isArray(plan.beats) && plan.beats.some(b => b && (b.visual === 'clip' || (b.block && b.block.type === 'clipLabel'))));
    for (const v of [lc(recipe), lc(look)]) {
      if (!v) continue;
      if (LEGACY.statcard.includes(v)) return 'statcard';
      if (LEGACY.hypecut.includes(v)) return 'hypecut';
      if (LEGACY.receipts.includes(v)) {
        const plain = ['paper', 'ink', 'blue', 'team', 'minimal', 'quote', 'explainer'].includes(v);
        return plain && hasClips ? 'gametape' : 'receipts';
      }
    }
    return hasClips ? 'gametape' : 'receipts';
  }
  // The reel's style: ENGINE's ReelES.styleOf when loaded, else the plan's own.
  function styleOf(plan = {}, wanted = '') {
    if (STYLE_IDS.includes(lc(wanted))) return lc(wanted);
    const p = plan || {};
    const ES = (typeof self !== 'undefined' && self.ReelES) || null;
    if (ES && typeof ES.styleOf === 'function') { try { const id = ES.styleOf(p); if (STYLE_IDS.includes(id)) return id; } catch { /* fall through */ } }
    if (STYLE_IDS.includes(p.esStyle)) return p.esStyle;
    if (STYLE_IDS.includes(p.style)) return p.style;
    return legacyStyle(p.look, p.recipe, p);
  }

  const SUBJECT_TYPES = ['player', 'team', 'moment', 'game'];
  const cleanText = (v, n) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const subjectKey = sub => norm(sub && sub.name).slice(0, 40) || 'reel';
  // A scene's subject: the director's (cleaned), else derived from the beat's
  // photo query, names and the reel's team. -> { type, name, team, date, moment, key }
  function subjectOfBeat(beat = {}, plan = {}) {
    const raw = beat.subject && typeof beat.subject === 'object' ? beat.subject : null;
    const reelTeam = plan.team && plan.team.name ? String(plan.team.name) : '';
    let name = raw ? cleanText(raw.name, 60) : '';
    let type = raw && SUBJECT_TYPES.includes(raw.type) ? raw.type : '';
    const team = raw ? cleanText(raw.team, 60) || reelTeam : reelTeam;
    if (!name) {
      const block = beat.block || {};
      const named = [block.photo, beat.photo, beat.name].map(v => cleanText(v, 60)).filter(Boolean);
      name = named[0] || team || '';
      type = name && team && norm(name) === norm(team) ? 'team' : (name ? 'player' : 'moment');
      if (!name) name = cleanText(plan.title || beat.text, 60);
    }
    if (!type) type = team && norm(name) === norm(team) ? 'team' : 'player';
    const out = { type, name, team: type === 'team' ? name : team };
    const date = raw ? cleanText(raw.date, 20) : '';
    const moment = raw ? cleanText(raw.moment, 60) : '';
    if (date) out.date = date;
    if (moment) out.moment = moment;
    out.key = subjectKey(out);
    return out;
  }
  // What a beat wants on screen in this style: 'clip', 'photo' or 'none'.
  function wantsFor(beat = {}, style = 'gametape') {
    const media = STYLE_MEDIA[style] || STYLE_MEDIA.gametape;
    if (!media.order.length) return 'none';
    const type = beat.block && beat.block.type ? beat.block.type : (beat.kind === 'hook' ? 'hook' : (['context', 'point', 'payoff'].includes(beat.kind) ? 'statement' : ''));
    const takes = MEDIA_BLOCKS[type];
    if (!takes || beat.kind === 'cta') return 'none';
    if (takes === 'any') return media.order[0];
    if (takes === 'clip') return media.clips ? 'clip' : (media.photos ? 'photo' : 'none');
    return media.photos ? 'photo' : 'none';
  }
  const relOf = (j, key) => (j && j.relevance && Number.isFinite(j.relevance[key]) ? j.relevance[key] : null);
  const momOf = (j, key) => (j && j.moment && Number.isFinite(j.moment[key]) ? j.moment[key] : null);
  // The judge confirmed this clip for this subject.
  function passesGate(judgement, subject = {}, gate = GATE) {
    if (!judgement) return false;
    if ((gate.badKinds || []).includes(judgement.kind)) return false;
    const rel = relOf(judgement, subject.key);
    if (rel == null || rel < gate.relevance) return false;
    if (subject.moment) { const m = momOf(judgement, subject.key); if (m == null || m < gate.moment) return false; }
    return true;
  }
  // Only when no judge can run (AI off, free mode): the post must name the
  // player in full, or be the team's own official post (strict; never a
  // keyword hit on one word).
  function textGate(clip = {}, sub = {}) {
    const players = Array.isArray(sub.players) ? sub.players : [];
    const subject = { ...sub, name: sub.name || players[0] || sub.team || '', type: sub.type || (players.length ? 'player' : 'team') };
    if (!subject.name) return false;
    const text = ` ${norm([clip.text, ...(clip.players || [])].join(' '))} `;
    const source = clip.source || clip.sourceKind;
    const trusted = ['official', 'league', 'media'].includes(source) || clip.trusted === true;
    if (!trusted) return false;
    if (subject.type === 'team') {
      const tagged = (clip.teams || []).some(t => norm(t) === norm(subject.name));
      return source === 'official' && tagged;
    }
    const parts = tokens(subject.name);
    if (parts.length < 2) return false;
    return text.includes(` ${parts.join(' ')} `);
  }
  // The clips worth judging, best first, taking turns between the scenes so
  // every scene's best candidates are judged before a 2nd-best of another.
  //   scenes: [{ beatId, subject, clips }]   judged: (url, key) -> bool
  function judgeQueue(scenes = [], { cap = JUDGE.maxClips, judged = () => false } = {}) {
    const lists = scenes.map(s => (s.clips || []).filter(c => c && c.url && !judged(c.url, s.subject && s.subject.key))
      .map(c => ({ c, score: heuristicScore(c, subjectFor({ subject: s.subject }, {})).score }))
      .sort((a, b) => b.score - a.score).map(x => x.c));
    const out = new Map();
    for (let round = 0; out.size < cap && lists.some(l => l.length > round); round += 1) {
      lists.forEach((list, i) => {
        const c = list[round];
        if (!c || out.size >= cap && !out.has(c.url)) return;
        const e = out.get(c.url) || { url: c.url, beatIds: [], keys: [] };
        if (!e.beatIds.includes(scenes[i].beatId)) e.beatIds.push(scenes[i].beatId);
        const key = scenes[i].subject && scenes[i].subject.key;
        if (key && !e.keys.includes(key)) e.keys.push(key);
        out.set(c.url, e);
      });
    }
    return [...out.values()].slice(0, cap);
  }
  // An infographic block for a scene with no relevant picture.
  function fallbackBlock(beat = {}) {
    const b = beat.block || {};
    const words = cleanText(beat.text, 90);
    if (beat.stat && /\d/.test(String(beat.stat.value || ''))) return { type: 'statTiles', tiles: [{ value: cleanText(beat.stat.value, 16), label: cleanText(beat.stat.label, 24), tone: 'blue' }] };
    if (b.type === 'hook' && Array.isArray(b.pills)) return { ...b, media: undefined };
    if (b.type === 'statement' && Array.isArray(b.lines)) { const out = { ...b }; delete out.media; return out; }
    if (b.type === 'tagPill' && b.text) return { type: 'tagPill', text: b.text, tone: b.tone || 'ink' };
    const text = cleanText(b.text || b.label || words, 90);
    const lines = [];
    let line = '';
    text.split(' ').filter(Boolean).forEach(w => { if (!line) line = w; else if (`${line} ${w}`.length <= 14) line = `${line} ${w}`; else { lines.push(line); line = w; } });
    if (line) lines.push(line);
    const kept = lines.slice(0, 3).map(t => t.toUpperCase());
    return { type: 'statement', lines: kept.map((t, i) => ({ text: t, color: i === kept.length - 1 && kept.length > 1 ? 'blue' : 'ink' })) };
  }
  // One pick per scene. scenes: [{ beatId, subject, wants, clips, photos, durMs }]
  //   opts: { judgements, samples, judgeTimes, judgeAvailable, used:Set(clip urls), usedPhotos:Set }
  // -> { [beatId]: { kind: 'clip'|'photo'|'none', clip?, segment?, relevance?, gate?, photo?, fallback?, why, candidates } }
  function gatedPicks(scenes = [], { judgements = {}, samples = {}, judgeTimes = {}, judgeAvailable = true, used = new Set(), usedPhotos = new Set(), gate = GATE } = {}) {
    const out = {};
    const uses = new Map([...used].map(u => [u, 1]));
    const photoUses = new Set(usedPhotos);
    const J = url => { const j = judgements[url]; return j ? (typeof j.actionAt === 'function' ? j : withActionAt(j, judgeTimes[url] || [])) : null; };
    // Scenes with a named player choose first.
    const order = scenes.map((s, i) => ({ s, i })).sort((a, b) => ((b.s.subject && b.s.subject.type === 'player') - (a.s.subject && a.s.subject.type === 'player')) || a.i - b.i);
    order.forEach(({ s }) => {
      const subject = { ...subjectFor({ subject: s.subject }, {}), key: s.subject ? s.subject.key : 'reel' };
      const ok = (s.clips || []).filter(c => c && c.url).map(clip => {
        const j = J(clip.url);
        const judged = Boolean(j && relOf(j, subject.key) != null);
        const pass = judged ? passesGate(j, subject, gate) : (!judgeAvailable && textGate(clip, subject));
        if (!pass) return null;
        const sc = judgedScore(clip, subject, j);
        const reused = uses.get(clip.url) || 0;
        return { clip, score: sc.score - reused * 30, reused, relevance: judged ? relOf(j, subject.key) : null, moment: judged ? momOf(j, subject.key) : null, gate: judged ? 'judge' : 'text' };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      const photos = (s.photos || []).filter(p => p && p.verified === true && p.url);
      const candidates = [...ok.map(x => ({ kind: 'clip', clip: x.clip, relevance: x.relevance, gate: x.gate })), ...photos.map(p => ({ kind: 'photo', photo: p }))];
      const tryClip = () => {
        const pick = ok.find(x => !x.reused) || null; // never the same clip on two scenes by default
        if (!pick) return null;
        const clipSec = (Number(pick.clip.durationMs) || 6000) / 1000;
        const beatSec = Math.max(0.5, (Number(s.durMs) || 2500) / 1000);
        const sm = (samples[pick.clip.url] || []).map((x, k) => ({ ...x, action: J(pick.clip.url) ? J(pick.clip.url).actionAt(k, x.t) : undefined }));
        uses.set(pick.clip.url, (uses.get(pick.clip.url) || 0) + 1);
        return { kind: 'clip', clip: pick.clip, segment: bestSegment(sm, beatSec, clipSec), relevance: pick.relevance, moment: pick.moment, gate: pick.gate, why: pick.gate === 'judge' ? `judge confirmed ${subject.name || 'the subject'} (${pick.relevance}/10)` : `post names ${subject.name}` };
      };
      const tryPhoto = () => {
        const p = photos.find(x => !photoUses.has(x.sourceUrl || x.url)) || null;
        if (!p) return null;
        photoUses.add(p.sourceUrl || p.url);
        return { kind: 'photo', photo: p, why: `verified photo of ${subject.name || 'the subject'}` };
      };
      let pick = null;
      if (s.wants === 'clip') pick = tryClip() || tryPhoto();
      else if (s.wants === 'photo') pick = tryPhoto();
      if (!pick) pick = { kind: 'none', fallback: s.beat ? fallbackBlock(s.beat) : null, why: s.wants === 'none' ? 'no media in this style' : 'no relevant clip or verified photo' };
      out[s.beatId] = { ...pick, candidates };
    });
    return out;
  }

  // ─── Free ranking (always on; the only ranking when AI is off) ──────────
  function overlap(words, text) {
    if (!words.length) return 0;
    const hay = ` ${norm(text)} `;
    const hits = words.filter(w => hay.includes(` ${w} `) || hay.includes(` ${w}s `));
    return hits.length / words.length;
  }
  function heuristicScore(clip = {}, subject = { terms: [], teamTerms: [], players: [] }) {
    const text = [clip.text, clip.handle, ...(clip.teams || []), ...(clip.players || [])].join(' ');
    const playerHit = subject.players.length ? Math.max(0, ...subject.players.map(p => overlap(tokens(p), text))) : 0;
    const teamHit = subject.teamTerms.length ? overlap(subject.teamTerms, text) : 0;
    const termHit = overlap(subject.terms, text);
    const relevance = Math.min(1, playerHit * 0.7 + teamHit * 0.35 + termHit * 0.4);
    const hours = Number(clip.ageHours);
    const recency = Number.isFinite(hours) ? Math.max(0, 1 - hours / 120) : 0.5;
    const side = Number(clip.shortSide) || Math.min(...(clip.variants || [{}]).map(v => Math.min(v.width || 0, v.height || 0) || 9999)) || 0;
    const res = side >= 1080 ? 1 : side >= 720 ? 0.85 : side >= 480 ? 0.5 : 0.3;
    const secs = (Number(clip.durationMs) || 0) / 1000;
    const length = secs >= 5 && secs <= 60 ? 1 : secs > 0 ? 0.6 : 0.7;
    const source = SOURCE_FIT[clip.source || clip.sourceKind] ?? 0.4;
    const parts = { relevance, recency, quality: res * 0.7 + length * 0.3, source };
    const score = 100 * (0.45 * parts.relevance + 0.15 * parts.recency + 0.2 * parts.quality + 0.2 * parts.source);
    return { score: Math.round(score * 10) / 10, parts };
  }

  // With a vision judgement: what is actually on screen counts most.
  function judgedScore(clip, subject, judgement) {
    const base = heuristicScore(clip, subject);
    if (!judgement) return { ...base, judged: false };
    const rel = judgement.relevance && Number.isFinite(judgement.relevance[subject.key]) ? judgement.relevance[subject.key] / 10 : null;
    const seen = [...(judgement.players || []), ...(judgement.teams || [])].join(' ');
    const seenHit = Math.max(subject.players.length ? Math.max(0, ...subject.players.map(p => overlap(tokens(p), seen))) : 0, overlap(subject.teamTerms, seen) * 0.8);
    const relevance = Math.min(1, Math.max(rel != null ? rel : 0, seenHit, base.parts.relevance * 0.6));
    const action = judgement.action.length ? judgement.action.reduce((a, b) => a + b, 0) / judgement.action.length / 10 : 0.5;
    const quality = Math.min(1, (judgement.quality / 10) * 0.6 + base.parts.quality * 0.25 + (judgement.textOverlay ? 0 : 0.15));
    const kind = KIND_FIT[judgement.kind] ?? 0.3;
    const parts = { relevance, recency: base.parts.recency, quality, source: base.parts.source, action, kind };
    const score = 100 * (0.38 * relevance + 0.1 * parts.recency + 0.16 * quality + 0.12 * parts.source + 0.12 * action + 0.12 * kind);
    return { score: Math.round(score * 10) / 10, parts, judged: true };
  }

  // ─── Best segment ────────────────────────────────────────────────────────
  // Motion energy between tiny grey frames (0..1 per sample).
  function motionEnergy(frames) {
    const list = (frames || []).filter(f => f && f.length);
    if (list.length < 2) return list.map(() => 0.5);
    const diffs = list.map((f, i) => {
      const g = list[i - 1] || list[i + 1];
      let sum = 0;
      for (let k = 0; k < f.length; k += 1) sum += Math.abs(f[k] - g[k]);
      return sum / f.length / 255;
    });
    const max = Math.max(...diffs, 1e-6);
    return diffs.map(d => Math.round((d / max) * 1000) / 1000);
  }
  // samples: [{ t (sec), motion 0..1, action 0..10 (judge, optional) }].
  // Slides a window of the beat's length over the clip (after the first
  // 0.4 s: team intros, black frames) and keeps the one with the most action.
  function bestSegment(samples, beatSec, clipSec, { skip = 0.4, step = 0.25, avoid = null } = {}) {
    const len = Math.max(0.5, Number(clipSec) || 0);
    const want = Math.max(0.5, Number(beatSec) || 2);
    const start0 = len > want + skip ? skip : 0;
    if (!samples || !samples.length || len <= want + start0) return { inSec: start0, outSec: len, score: 0 };
    const value = s => (Number.isFinite(s.action) ? 0.6 * (s.action / 10) + 0.4 * (s.motion ?? 0.5) : (s.motion ?? 0.5));
    const at = t => {
      // Linear interpolation between samples.
      const list = samples;
      if (t <= list[0].t) return value(list[0]);
      for (let i = 1; i < list.length; i += 1) if (t <= list[i].t) { const a = list[i - 1]; const b = list[i]; const k = (t - a.t) / Math.max(1e-6, b.t - a.t); return value(a) + (value(b) - value(a)) * k; }
      return value(list[list.length - 1]);
    };
    let best = { inSec: start0, outSec: Math.min(len, start0 + want), score: -1 };
    for (let s = start0; s + want <= len + 1e-6; s += step) {
      // avoid: [in, out] of a part already used on another beat.
      if (avoid && s < avoid[1] && s + want > avoid[0]) continue;
      let sum = 0; let n = 0;
      for (let t = s; t <= s + want + 1e-6; t += step / 2) { sum += at(t); n += 1; }
      const score = sum / n - (s > len * 0.6 ? 0.02 : 0); // a small lean to the start of the clip on a tie
      if (score > best.score + 1e-9) best = { inSec: Math.round(s * 100) / 100, outSec: Math.round(Math.min(len, s + want) * 100) / 100, score: Math.round(score * 1000) / 1000 };
    }
    return best;
  }

  // ─── Choosing the candidates to sample (free) ────────────────────────────
  function preselect(pool, beats, plan, n = JUDGE.maxClips) {
    const list = (pool || []).filter(c => c && c.url);
    if (list.length <= n) return list;
    const best = new Map();
    (beats || []).forEach(beat => {
      const subject = subjectFor(beat, plan);
      list.forEach(c => { const s = heuristicScore(c, subject).score; best.set(c.url, Math.max(best.get(c.url) || 0, s)); });
    });
    return [...list].sort((a, b) => (best.get(b.url) || 0) - (best.get(a.url) || 0)).slice(0, n);
  }

  // ─── Assignment (one clip per beat, no reuse while others are free) ────
  //   beats: [{ id, durMs, ...plan beat }]
  //   opts: { judgements: { [url]: judgement }, samples: { [url]: [{t, motion, action}] }, used: Set(urls already on other beats) }
  // Reels v3: gated. A judged clip must pass the relevance gate for the
  // beat's subject; an unjudged one only the strict text gate. Nothing that
  // fails goes on a beat (no "best of the rest", no keyword fallback).
  function assign(pool, beats, plan = {}, { judgements = {}, samples = {}, judgeTimes = {}, used = new Set(), minScore = 18, gate = GATE } = {}) {
    const out = {};
    const J = url => { const j = judgements[url]; return j ? (typeof j.actionAt === 'function' ? j : withActionAt(j, judgeTimes[url] || [])) : null; };
    const uses = new Map([...used].map(u => [u, 1]));
    // Beats with the most specific subject choose first.
    const order = [...(beats || [])].map((beat, i) => ({ beat, i, subject: subjectFor(beat, plan) }))
      .sort((a, b) => (b.subject.players.length - a.subject.players.length) || (a.i - b.i));
    order.forEach(({ beat, subject }) => {
      const ranked = (pool || []).filter(clip => {
        const j = J(clip.url);
        return j && relOf(j, subject.key) != null ? passesGate(j, subject, gate) : textGate(clip, subject);
      }).map(clip => {
        const s = judgedScore(clip, subject, J(clip.url));
        const reused = uses.get(clip.url) || 0;
        // Reuse costs a lot: a free clip that is nearly as good wins.
        return { clip, score: s.score - reused * 30, raw: s, reused };
      }).sort((a, b) => b.score - a.score);
      const pick = ranked[0];
      if (!pick || pick.score < minScore) return;
      const clipSec = (Number(pick.clip.durationMs) || 6000) / 1000;
      const beatSec = Math.max(0.5, (Number(beat.durMs) || 2500) / 1000);
      const sm = (samples[pick.clip.url] || []).map((x, k) => ({ ...x, action: J(pick.clip.url) ? J(pick.clip.url).actionAt(k, x.t) : undefined }));
      let segment = bestSegment(sm, beatSec, clipSec);
      // A reused clip plays a different part: the best window away from the first.
      if (pick.reused) {
        const first = Object.values(out).find(o => o.clip.url === pick.clip.url);
        if (first && Math.abs(first.segment.inSec - segment.inSec) < beatSec) {
          const alt = bestSegment(sm, beatSec, clipSec, { avoid: [first.segment.inSec, first.segment.outSec] });
          if (alt.score >= 0) segment = alt;
        }
      }
      uses.set(pick.clip.url, (uses.get(pick.clip.url) || 0) + 1);
      const p = pick.raw.parts;
      const why = [
        p.relevance >= 0.5 ? `about ${subject.players[0] || subject.team || 'this beat'}` : '',
        pick.raw.judged && p.kind >= 0.85 ? 'game action' : '',
        p.source >= 0.85 ? 'official source' : '',
        p.recency >= 0.7 ? 'fresh' : '',
        pick.reused ? 'reused (no other clip fits)' : '',
      ].filter(Boolean).join(' · ');
      out[beat.id] = { clip: pick.clip, score: Math.round(pick.score * 10) / 10, judged: pick.raw.judged, why, segment };
    });
    return out;
  }

  // ─── The judgement (server output, validated on both sides) ─────────────
  const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  function validateJudgement(raw, frameCount = JUDGE.framesPerClip) {
    if (!raw || typeof raw !== 'object') return null;
    const action = (Array.isArray(raw.action) ? raw.action : []).slice(0, Math.max(1, frameCount)).map(v => clampN(v, 0, 10, 5));
    const relevance = {};
    if (raw.relevance && typeof raw.relevance === 'object') Object.entries(raw.relevance).slice(0, 12).forEach(([k, v]) => { relevance[norm(k).slice(0, 40)] = clampN(v, 0, 10, 0); });
    const moment = {};
    if (raw.moment && typeof raw.moment === 'object') Object.entries(raw.moment).slice(0, 12).forEach(([k, v]) => { moment[norm(k).slice(0, 40)] = clampN(v, 0, 10, 0); });
    const list = (v, n) => (Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, n);
    return {
      kind: KINDS.includes(raw.kind) ? raw.kind : 'other',
      teams: list(raw.teams, 4),
      players: list(raw.players, 4),
      quality: clampN(raw.quality, 0, 10, 5),
      action,
      relevance,
      moment,
      textOverlay: raw.textOverlay === true,
      note: String(raw.note || '').replace(/\s+/g, ' ').slice(0, 80),
    };
  }
  // The action score at sample k (judge frames are a subset of the samples:
  // spread evenly, so sample k maps to the nearest judged frame).
  function withActionAt(j, times = []) {
    if (!j) return null;
    return {
      ...j,
      actionAt(k, t) {
        if (!j.action.length) return undefined;
        if (times.length === j.action.length) {
          let best = 0;
          times.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(times[best] - t)) best = i; });
          return j.action[best];
        }
        return j.action[Math.min(j.action.length - 1, Math.round((k / Math.max(1, times.length || j.action.length)) * (j.action.length - 1)))];
      },
    };
  }

  // ─── Cost ────────────────────────────────────────────────────────────────
  function judgeCost({ clips = 1, frames = JUDGE.framesPerClip, model = JUDGE.model } = {}) {
    const price = PRICES[model] || PRICES[JUDGE.model];
    const input = JUDGE.promptTokens + clips * (frames * JUDGE.tokensPerFrame + 80);
    const output = clips * JUDGE.outTokensPerClip;
    return (input * price.input + output * price.output) / 1e6;
  }
  // Estimate for a reel (cost panel): the clips we would judge, minus cached ones.
  function reelJudgeEstimate(candidates = JUDGE.maxClips, cached = 0) {
    const n = Math.max(0, Math.min(JUDGE.maxClips, candidates) - cached);
    if (!n) return 0;
    const calls = Math.ceil(n / JUDGE.perCall);
    return Math.min(JUDGE.maxUsdPerReel, judgeCost({ clips: n }) + (calls - 1) * (JUDGE.promptTokens * PRICES[JUDGE.model].input) / 1e6);
  }

  // ─── Cache (per clip URL) ────────────────────────────────────────────────
  function makeCache(storage, { key = 'frameup.reelClipJudge.v1', days = JUDGE.cacheDays, now = () => Date.now() } = {}) {
    let data = {};
    try { data = JSON.parse((storage && storage.getItem(key)) || '{}') || {}; } catch { data = {}; }
    const ttl = days * 864e5;
    const save = () => {
      const entries = Object.entries(data).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
      data = Object.fromEntries(entries);
      try { if (storage) storage.setItem(key, JSON.stringify(data)); } catch { /* storage full or blocked */ }
    };
    return {
      get(url) { const e = data[url]; return e && now() - e.at < ttl ? e.j : null; },
      set(url, j) { if (!url || !j) return; data[url] = { at: now(), j }; save(); },
      size() { return Object.keys(data).length; },
    };
  }

  // ─── Browser: sample a clip (frames for the judge + motion) ─────────────
  // Seeks a <video> to `count` evenly spaced times; returns small JPEGs
  // (every k-th, for the judge) and grey 48x27 frames for motion energy.
  async function sampleClip(video, { count = 8, judgeFrames = JUDGE.framesPerClip, width = JUDGE.frameWidth, doc = typeof document !== 'undefined' ? document : null } = {}) {
    if (!video || !doc) return { samples: [], frames: [], times: [] };
    const dur = Math.max(0.5, video.duration || 0);
    const times = Array.from({ length: count }, (_, i) => Math.min(dur - 0.05, 0.2 + (i * (dur - 0.4)) / Math.max(1, count - 1)));
    const pickEvery = new Set(Array.from({ length: judgeFrames }, (_, i) => Math.round(((i + 0.5) * count) / judgeFrames - 0.5)));
    const big = doc.createElement('canvas');
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    big.width = width; big.height = Math.max(2, Math.round((width * vh) / vw));
    const small = doc.createElement('canvas');
    small.width = 48; small.height = 27;
    const bg = big.getContext('2d');
    const sg = small.getContext('2d', { willReadFrequently: true });
    const greys = [];
    const frames = [];
    const frameTimes = [];
    for (let i = 0; i < times.length; i += 1) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, 1500);
        video.addEventListener('seeked', done, { once: true });
        try { video.currentTime = times[i]; } catch { done(); }
      });
      try {
        sg.drawImage(video, 0, 0, 48, 27);
        const d = sg.getImageData(0, 0, 48, 27).data;
        const g = new Uint8Array(48 * 27);
        for (let k = 0; k < g.length; k += 1) g[k] = (d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11) | 0;
        greys.push(g);
        if (pickEvery.has(i)) { bg.drawImage(video, 0, 0, big.width, big.height); frames.push(big.toDataURL('image/jpeg', 0.6)); frameTimes.push(times[i]); }
      } catch { greys.push(null); }
    }
    const motion = motionEnergy(greys.filter(Boolean));
    const samples = times.map((t, i) => ({ t: Math.round(t * 100) / 100, motion: motion[i] ?? 0.5 }));
    return { samples, frames, times: frameTimes };
  }

  return { JUDGE, GATE, PRICES, KINDS, KIND_FIT, SOURCE_FIT, STYLE_IDS, STYLE_MEDIA, MEDIA_BLOCKS, styleOf, legacyStyle, subjectOfBeat, subjectKey, wantsFor, passesGate, textGate, judgeQueue, gatedPicks, fallbackBlock, subjectFor, heuristicScore, judgedScore, motionEnergy, bestSegment, preselect, assign, validateJudgement, withActionAt, judgeCost, reelJudgeEstimate, makeCache, sampleClip, norm };
}));
