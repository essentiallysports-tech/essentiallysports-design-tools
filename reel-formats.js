// Reels Studio: the reel formats, the code-first format router, pacing, the
// number-provenance helpers and the per-reel cost estimate. One file for the
// browser (window.ReelFormats) and the server (require), like video-ads-brands.js.
//
// project-docs/ai-reels-research.md §1.2-1.4 (formats, craft norms, router),
// §5.1 (lint rules) and §7.1 (costs). Formats need no game footage: ES photos,
// team logos, stat cards drawn by the renderer, a voiceover and captions.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelFormats = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const SPORTS = [
    { id: 'nfl', label: 'NFL' },
    { id: 'cfb', label: 'College Football' },
    { id: 'mlb', label: 'MLB' },
    { id: 'golf', label: 'Golf' },
  ];

  // Beat kinds the director may write and the renderer draws.
  //   hook     the claim or number, visible from frame 0
  //   context  what happened (label: WHAT HAPPENED)
  //   point    one idea per beat
  //   stat     a big number + label (kinetic count-up)
  //   rank     a Top-5 entry (#5 … #1)
  //   quote    a quote card (never a cloned voice; the VO reads context, not the quote as the speaker)
  //   payoff   why it matters
  //   cta      the end card: a question that invites comments
  const KINDS = ['hook', 'context', 'point', 'stat', 'rank', 'quote', 'payoff', 'cta'];

  const FORMATS = {
    explainer: {
      id: 'explainer',
      label: 'Explained in 30s',
      short: 'Explainer',
      tag: 'EXPLAINED',
      blurb: 'What happened and why it matters, in five to seven beats.',
      beats: { min: 5, max: 8 },
      kinds: ['hook', 'context', 'point', 'stat', 'quote', 'payoff', 'cta'],
      targetSeconds: [24, 40],
      maxSeconds: 60,
    },
    stat: {
      id: 'stat',
      label: 'Stat / Record alert',
      short: 'Stat alert',
      tag: 'STAT ALERT',
      blurb: 'One surprising number, counted up, then the context.',
      beats: { min: 4, max: 7 },
      kinds: ['hook', 'stat', 'context', 'point', 'quote', 'payoff', 'cta'],
      targetSeconds: [20, 35],
      maxSeconds: 60,
    },
    top5: {
      id: 'top5',
      label: 'Top-5 countdown',
      short: 'Top 5',
      tag: 'TOP 5',
      blurb: 'Five ranked entries, #5 to #1. Viewers stay for #1.',
      beats: { min: 7, max: 8 },
      kinds: ['hook', 'rank', 'cta'],
      targetSeconds: [28, 50],
      maxSeconds: 75,
    },
    quote: {
      id: 'quote',
      label: 'Quote reel',
      short: 'Quote',
      tag: 'IN THEIR WORDS',
      blurb: 'A real quote as kinetic type, with context. Never a cloned voice.',
      beats: { min: 4, max: 7 },
      kinds: ['hook', 'quote', 'context', 'point', 'payoff', 'cta'],
      targetSeconds: [20, 40],
      maxSeconds: 60,
    },
  };
  const FORMAT_IDS = Object.keys(FORMATS);

  // Labels drawn above context / point / payoff beats.
  const KIND_LABELS = { context: 'WHAT HAPPENED', point: 'THE DETAIL', payoff: 'WHY IT MATTERS', stat: '', rank: '', quote: '', hook: '', cta: '' };

  // Pacing (research §1.3): about 2.6 words a second for VO, a visual change
  // every 1.5-3 s, one idea per beat. On-screen text 1-9 words; VO up to 28.
  const PACE = {
    wordsPerSecond: 2.6,
    beatMinMs: { hook: 1800, stat: 2200, rank: 2400, cta: 2200, default: 1600 },
    beatMaxMs: 7000,
    tailMs: 260, // air after the VO before the next beat
    endTailMs: 700, // the last beat holds a little longer (loop-friendly)
    voLeadMs: 100, // VO starts 0.1 s into the reel (hook rule: <= 0.2 s)
    shotMaxMs: 3200, // longer beats get a second shot (punch-in or a second photo)
    textMaxWords: 9,
    voMaxWords: 28,
    reelMinSeconds: 20,
    reelMaxSeconds: 45,
  };

  // ─── Router (code first; the director is the tiebreaker) ───────────────
  const ROUTES = [
    { format: 'top5', re: /\b(?:top[\s-]?(?:5|five|10|ten)|best|worst|power rankings?|ranked|rankings?|mvp race|heisman race|cy young race|biggest|longest)\b/i },
    { format: 'stat', re: /\b(?:first|most|record|since|fastest|youngest|oldest|career[- ]high|all[- ]time|history|historic|streak|milestone)\b|\d[\d,.]*\s*(?:yards|yds|tds?|touchdowns|hrs?|home runs|strikeouts|points|birdies|under par|shots|strokes|wins)\b/i },
    { format: 'quote', re: /[“"][^”"]{12,}[”"]|\b(?:said|says|slams|responds|blasts|admits|reveals|told reporters|press conference)\b/i },
    { format: 'explainer', re: /\b(?:trade[ds]?|injur(?:y|ed|ies)|contract|extension|signs?|signed|fired|firing|suspend(?:ed|ion)|release[ds]?|waive[ds]?|benched|explained|why)\b/i },
  ];
  function routeFormat(text) {
    const source = String(text || '');
    const hits = ROUTES.filter(route => route.re.test(source)).map(route => route.format);
    return { format: hits[0] || 'explainer', candidates: hits.length ? hits : ['explainer'], ruled: Boolean(hits.length) };
  }

  // ─── Numbers: provenance (research §5.1 "Facts", blocking) ─────────────
  // Every number in on-screen text, VO and stat cards must appear in the
  // sources (the brief, the trend, ES facts or the capped fact check).
  const NUMBER_RE = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  const normNumber = raw => String(raw).replace(/,/g, '').replace(/^0+(?=\d)/, '').replace(/\.0+$/, '');
  function numbersIn(text) {
    return [...String(text || '').matchAll(NUMBER_RE)].map(match => normNumber(match[0]));
  }
  // Spelled-out small numbers are words, not facts; ordinals keep their digits.
  function numberSet(text) {
    return new Set(numbersIn(text));
  }
  // Numbers that need no source: the rank of a Top-5 entry and its "Top 5".
  function structuralNumbers(format, beat) {
    const allowed = new Set();
    if (format === 'top5') { allowed.add('5'); ['1', '2', '3', '4', '5'].forEach(n => { if (beat && String(beat.rank) === n) allowed.add(n); }); }
    return allowed;
  }
  // Returns the numbers in a beat that the sources do not back.
  function unsourcedNumbers(beat, sourceSet, format) {
    const allowed = structuralNumbers(format, beat);
    const fields = [beat.text, beat.vo, beat.stat && beat.stat.value, beat.stat && beat.stat.label, beat.detail, beat.quote && beat.quote.text];
    const out = [];
    fields.forEach(field => numbersIn(field).forEach(n => {
      if (!sourceSet.has(n) && !allowed.has(n) && !out.includes(n)) out.push(n);
    }));
    return out;
  }

  // ─── Words ──────────────────────────────────────────────────────────────
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);
  const wordCount = text => words(text).length;
  function estimateVoMs(vo) {
    const n = wordCount(vo);
    if (!n) return 0;
    const pauses = (String(vo).match(/[,;:—–-]\s/g) || []).length * 140 + (String(vo).match(/[.!?](\s|$)/g) || []).length * 220;
    return Math.round((n / PACE.wordsPerSecond) * 1000 + pauses);
  }

  // ─── Cost estimate per reel (research §7.1, Gateway list prices 2026-11) ─
  // Shown in the UI before anything is spent. Real costs come back from the
  // server on every call and are logged in frameup_ai_usage (feature reels-*).
  const PRICES = {
    directorHaiku: 0.002,
    directorSonnet: 0.02,
    revise: 0.0015,
    factCheckCap: 0.03, // two web searches, hard-capped on the server
    // Gateway list prices (ai-gateway.vercel.sh/v1/models, 2026-11-17):
    // elevenlabs/eleven-flash-v2.5 $0.00004/char; scribe-v2 alignment $0.000061/s.
    voicePerChar: { elevenlabs: 0.00004, gateway: 0.00004, off: 0 },
    alignPerSecond: { elevenlabs: 0, gateway: 0.000061112, off: 0 },
    musicPerSecond: 0.0025,
  };
  function estimateCost({ tier = 'standard', factCheck = false, voiceMode = 'off', voChars = 450, revisions = 0, musicSeconds = 0 } = {}) {
    const director = tier === 'economy' ? PRICES.directorHaiku : PRICES.directorHaiku + 0.35 * PRICES.directorSonnet; // standard escalates to Sonnet only on a weak plan
    const lines = [
      { id: 'director', label: tier === 'economy' ? 'Script (Haiku)' : 'Script (Haiku, Sonnet if weak)', usd: director },
      { id: 'factcheck', label: 'Fact check (2 searches, capped)', usd: factCheck ? PRICES.factCheckCap : 0 },
      { id: 'voice', label: voiceMode === 'off' ? 'Voiceover (captions only)' : 'Voiceover + caption timing', usd: (PRICES.voicePerChar[voiceMode] || 0) * Math.max(0, voChars) + (PRICES.alignPerSecond[voiceMode] || 0) * (Math.max(0, voChars) / 15) },
      { id: 'revise', label: 'Revisions', usd: revisions * PRICES.revise },
      ...(musicSeconds ? [{ id: 'music', label: 'Generated music bed', usd: musicSeconds * PRICES.musicPerSecond }] : []),
      { id: 'render', label: 'Render and export (in your browser)', usd: 0 },
    ];
    const total = lines.reduce((sum, line) => sum + line.usd, 0);
    return { lines, total: Math.round(total * 10000) / 10000 };
  }
  const money = usd => (usd < 0.01 ? `$${(Math.max(0, usd)).toFixed(3)}` : `$${usd.toFixed(2)}`);

  // ─── Sentences and stats from free text (the no-AI draft) ──────────────
  const STAT_WORDS = { yards: 'YDS', yds: 'YDS', touchdowns: 'TD', touchdown: 'TD', tds: 'TD', interceptions: 'INT', 'home runs': 'HR', 'home run': 'HR', hr: 'HR', rbis: 'RBI', rbi: 'RBI', strikeouts: 'SO', points: 'PTS', wins: 'WINS', birdies: 'BIRDIES', sacks: 'SACKS', era: 'ERA', 'under par': 'UNDER PAR' };
  function statsIn(text) {
    const out = [];
    const re = /(\d[\d,.]*%?)\s+(home runs?|under par|[A-Za-z]{2,13})\b/gi;
    let match;
    while ((match = re.exec(String(text || '')))) {
      const label = STAT_WORDS[match[2].toLowerCase()];
      if (!label || out.some(stat => stat.label === label)) continue;
      out.push({ value: match[1].replace(/[.,]$/, ''), label });
      if (out.length >= 4) break;
    }
    return out;
  }
  function sentences(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+(?=[A-Z“"0-9])/)
      .map(s => s.trim())
      .filter(s => s.length > 3);
  }
  const trimWords = (text, max) => {
    const list = words(text);
    return list.length > max ? `${list.slice(0, max).join(' ').replace(/[,;:]$/, '')}` : list.join(' ');
  };
  const stripLabel = line => String(line || '').replace(/^\s*(?:headline|story|context|why fans care|team|sport|brief)\s*:\s*/i, '').trim();

  // A grounded draft with no AI: every line comes from the brief, so every
  // number is sourced. Used when AI is off, over the cap, or fails.
  function fallbackPlan({ brief = '', title = '', format = '', sport = '', team = '' } = {}) {
    const text = [title, brief].filter(Boolean).join('. ');
    const fmt = FORMATS[format] ? format : routeFormat(text).format;
    const lines = String(brief || '').split('\n').map(stripLabel).filter(Boolean);
    const sentence = s => (/[.!?]$/.test(s) ? s : `${s}.`);
    const seen = new Set();
    const all = sentences([title, ...lines].filter(Boolean).map(sentence).join(' '))
      .filter(s => { const k = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
    const pool = all.length ? all : [title || 'Here is what happened'];
    const beats = [];
    const hookLine = pool[0];
    beats.push({ kind: 'hook', text: trimWords(hookLine.replace(/[.]$/, ''), PACE.textMaxWords), vo: trimWords(hookLine, PACE.voMaxWords), emphasis: '', photo: '' });
    // One sentence per beat. In a stat reel a sentence with a stat becomes a
    // stat card (at most two), the rest are context and points.
    let statBeats = 0;
    pool.slice(1, 6).forEach((line, index) => {
      const vo = trimWords(line, PACE.voMaxWords);
      const stat = fmt === 'stat' && statBeats < 2 ? statsIn(line)[0] : null;
      if (stat) {
        statBeats += 1;
        beats.push({ kind: 'stat', text: trimWords(line.replace(/[.]$/, ''), PACE.textMaxWords), vo, stat, photo: '' });
        return;
      }
      const kind = index === 0 ? 'context' : (index >= 3 ? 'payoff' : 'point');
      beats.push({ kind, text: trimWords(line.replace(/[.]$/, ''), PACE.textMaxWords), vo, photo: '' });
    });
    while (beats.length < 3) beats.push({ kind: beats.length === 1 ? 'context' : 'payoff', text: beats.length === 1 ? 'Here is the story' : 'What comes next', vo: beats.length === 1 ? 'Here is the story.' : 'Keep an eye on what comes next.', photo: '' });
    beats.push({ kind: 'cta', text: 'What do you make of it?', vo: 'What do you make of it? Tell us below.', photo: '' });
    return {
      format: fmt === 'top5' ? 'explainer' : fmt, // a Top-5 needs five sourced entries: only the director writes those
      title: trimWords(title || hookLine, 12),
      sport, team, angle: '', source: 'draft', beats,
    };
  }

  return {
    SPORTS, KINDS, FORMATS, FORMAT_IDS, KIND_LABELS, PACE, ROUTES, PRICES,
    routeFormat, numbersIn, numberSet, normNumber, unsourcedNumbers, structuralNumbers,
    words, wordCount, estimateVoMs, estimateCost, money, statsIn, sentences, trimWords, fallbackPlan,
  };
}));
