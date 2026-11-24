// ES Reels: the ES video team's reels design system (from Vinay, brand kit of
// 2 Nov 2026), built into Reels Studio as data and pure functions. One file
// for the browser (window.ReelES), the server and the tests (require), like
// reel-styles.js. reel-render.js draws the 'es' style with it, reel-lint.js
// runs its checklist, the director and the page read its blocks.
//
//   TOKENS / TYPE / MOTION / LIMITS     the brand rules as numbers
//   geometry([w, h])                    column, safe frame, caption line, marks
//                                       (1080x1920; 1080x1350 scaled, see below)
//   BLOCKS / blockOf(beat) / cleanBlock / legacyFields / blockText
//                                       the seven blocks and their exact fields
//   parseEmphasis(vo) / plainVo(vo)     *word* caption emphasis
//   scriptToPlan(script, opts)          the person's script, word for word, in beats
//   layoutBlock / layoutCaption / textBoxes   ops with boxes (safe-frame maths)
//   drawFrame / drawSlab / drawMark     canvas drawing (helpers passed in by reel-render)
//   checks(timeline, opts) / checklist(issues)   the system's checklist as lint
//
// What is written in the kit is followed exactly; what the kit's HTML template
// would have decided (it was not available) is marked INFERRED below.
//
// Reels 2.0 (looks): reel-es-themes.js holds the looks as data (Paper, Ink,
// Blue, Team colour, Photo-led, Data-led, Minimal, Bold). themeOf(timeline)
// resolves the reel's look; the ground, colours, pills, captions, dots, the
// mark's colourway and the slab's two colours come from it. Fonts, the safe
// frame, the caption line, the marks' places, the wipe's shape and timing, the
// end card and LIMITS do not: no look can move them. A reel with no look is
// Paper and draws exactly as before (scripts/test-reel-looks.mjs holds a
// golden copy of every draw call).
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./reel-es-themes.js') : root.ReelESThemes);
  if (node) module.exports = api;
  else root.ReelES = api;
}(typeof self !== 'undefined' ? self : this, TH => {
  'use strict';
  if (!TH) throw new Error('reel-es.js needs reel-es-themes.js loaded first.');

  // ─── Brand tokens (references/brand.md) ─────────────────────────────────
  const TOKENS = { blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F', white: '#FFFFFF' };
  // Signal colours mean something (win / loss / emphasis). At most 2 per beat.
  const SIGNALS = ['green', 'red', 'yellow'];
  const COLOR_NAMES = ['ink', 'blue', 'red', 'green', 'yellow', 'white'];
  // Display: condensed black uppercase. Acumin Pro Condensed Black where the
  // machine has it (Adobe Fonts), else Roboto Condensed 800 (the page loads
  // it). Small text: Roboto 500. Never a third typeface.
  const TYPE = {
    display: '"Acumin Pro Condensed Black", "Roboto Condensed", sans-serif',
    displayWeight: 800,
    small: 'Roboto, sans-serif',
    smallWeight: 500,
    lineHeight: 0.84,
    tracking: -0.01, // em
    cap: 0.71, // cap height of Roboto Condensed (Acumin is within 1%)
    pad: 0.16, // boxed words: 0.16em round the trimmed cap-height-to-baseline box
  };
  const displayFont = size => `${TYPE.displayWeight} ${Math.round(size * 10) / 10}px ${TYPE.display}`;
  const smallFont = size => `${TYPE.smallWeight} ${Math.round(size * 10) / 10}px ${TYPE.small}`;

  // ─── Motion (references/brand.md, Motion) ───────────────────────────────
  const MOTION = {
    enterMs: 400, enterMinMs: 350, enterMaxMs: 450, ease: 'expo.out',
    fromLeft: 60, fromBelow: 36, // 60 px from the left, or 30-40 px from below
    staggerMs: 160, staggerMinMs: 150, staggerMaxMs: 180,
    wipeMs: 500, wipeSkewDeg: -14, wipeColors: ['blue', 'ink'], // the only cut
    driftFrom: 1, driftTo: 1.1, // photos, over the whole scene
    stampMs: 200, stampEase: 'power4.in', stampRotDeg: -9, stampFrom: 1.7, shakeMs: 260, shakePx: 12,
    countMs: 1000, // number count-up (INFERRED: the kit gives no duration)
    captionMaxWords: 3, // captions cut on 1-3 words at a time, never word by word
  };
  const ease = {
    expoOut: t => { const x = clamp01(t); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); },
    power4In: t => clamp01(t) ** 5, // GSAP power4 = quint
    inOutCubic: t => { const x = clamp01(t); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; },
    inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
  };
  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  // ─── Copy limits (references/blocks.md, copy.md, checklist.md) ──────────
  const LIMITS = { pillChars: 14, pills: 3, lineChars: 14, lines: 3, quoteChars: 70, dotsMax: 2600, compareMin: 2, compareMax: 4, digits: 6, signalsPerBeat: 2, endcardMs: 3000, wordsPerSecond: 2.6 };
  const DEFAULT_CTA = ['WE BRING', 'THE RECEIPTS.'];

  // ─── Layout (1080 x 1920) and the 4:5 export ───────────────────────────
  // 9:16 is the kit, to the pixel. 4:5 (1080x1350) is INFERRED: the same
  // rules with every vertical position scaled by 1350/1920 (safe frame top
  // 211, bottom 1153, captions at 824, ES mark top 232), the same 60 px
  // column and 40 px side margin, type scaled by 0.82 so blocks keep their
  // proportions in the shorter frame, marks at full size (never scaled).
  function geometry(size) {
    const w = Array.isArray(size) ? Number(size[0]) || 1080 : 1080;
    const h = Array.isArray(size) ? Number(size[1]) || 1920 : 1920;
    const k = h / 1920;
    const r = v => Math.round(v * k);
    return {
      w, h, k, type: h >= 1900 ? 1 : 0.82,
      col: { x: 60, w: 960 },
      safe: { top: r(300), bottom: r(1640), side: 40 },
      captionY: r(1172),
      mark: { size: 80, x: w - 60 - 80, y: r(330), clear: 40 },
      logotype: { h: 96 },
      top: { hook: r(480), statement: r(440), block: r(440) },
      contentBottom: r(1100), // blocks stay above the caption line
      lowerTop: r(1268), // below the caption line (dots note)
      sourceY: r(1590),
    };
  }
  const GEO = geometry([1080, 1920]);

  // ─── Blocks (references/blocks.md; the only building blocks) ───────────
  // kind: the Reels Studio beat kind each block rides on, so formats, the
  // director, number provenance and the lint keep working unchanged.
  const BLOCKS = {
    hook: { kind: 'hook', fields: ['media', 'pills', 'stamp'], label: 'Hook', media: true },
    statement: { kind: 'point', fields: ['lines', 'media', 'top'], label: 'Statement', media: true },
    number: { kind: 'stat', fields: ['value', 'prefix', 'suffix', 'label', 'kicker', 'color'], label: 'Number' },
    dots: { kind: 'dotrank', fields: ['count', 'highlight', 'label', 'note'], label: 'Dots' },
    compare: { kind: 'bars', fields: ['items', 'kicker'], label: 'Compare' },
    quote: { kind: 'quote', fields: ['text', 'who'], label: 'Quote' },
    endcard: { kind: 'cta', fields: ['cta'], label: 'End card' },
  };
  const BLOCK_TYPES = Object.keys(BLOCKS);
  const KIND_FOR = Object.fromEntries(BLOCK_TYPES.map(t => [t, BLOCKS[t].kind]));
  // Every Reels Studio beat kind lands on a block.
  const BLOCK_FOR_KIND = { hook: 'hook', context: 'statement', point: 'statement', payoff: 'statement', rank: 'statement', steps: 'statement', tiles: 'statement', mystery: 'statement', stat: 'number', dotrank: 'dots', chips: 'dots', bars: 'compare', versus: 'compare', roles: 'compare', quote: 'quote', cta: 'endcard' };
  const TEMPLATES = BLOCK_TYPES.map(t => `es-${t}`);

  const str = (v, n = 200) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const colorName = (c, fallback = 'ink') => (COLOR_NAMES.includes(String(c || '').toLowerCase()) ? String(c).toLowerCase() : fallback);
  // ─── The look (reel-es-themes.js) ───────────────────────────────────────
  // themeOf: the reel's look, resolved (a missing or unknown look is Paper).
  // The Team colour look reads the reel's first team colour.
  function themeOf(timeline) {
    const tl = timeline || {};
    const team = tl.team && Array.isArray(tl.team.colors) ? tl.team.colors[0] : '';
    return TH.resolve(tl.look, { team });
  }
  const PAPER = TH.resolve('paper');
  // A colour name ('ink', 'blue', 'team'…) as a colour, in the look.
  const colorOf = (name, theme) => (theme ? theme.colors[name] : TOKENS[name]) || name || TOKENS.ink;
  const numOf = v => { const m = String(v == null ? '' : v).replace(/[$,]/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);

  // Greedy wrap into lines of at most `max` characters (a longer word keeps its own line).
  function splitLines(text, max = 14) {
    const out = [];
    let line = '';
    words(text).forEach(w => {
      if (!line) line = w;
      else if (`${line} ${w}`.length <= max) line = `${line} ${w}`;
      else { out.push(line); line = w; }
    });
    if (line) out.push(line);
    return out;
  }
  // The same, cut to `n` lines (for headlines made from a sentence, never the VO).
  function fitLines(text, max, n) {
    const lines = splitLines(text, max);
    return lines.length > n ? lines.slice(0, n) : lines;
  }

  // Shape a raw block to its exact fields (anything else is dropped).
  function cleanBlock(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const type = BLOCK_TYPES.includes(b.type) ? b.type : 'statement';
    const out = { type };
    if (type === 'hook') {
      out.pills = (Array.isArray(b.pills) ? b.pills : []).slice(0, LIMITS.pills).map(p => (typeof p === 'string' ? { text: str(p, 40), color: 'ink' } : { text: str(p && p.text, 40), color: colorName(p && p.color), ...(Number(p && p.size) >= 60 ? { size: Math.min(160, Number(p.size)) } : {}) })).filter(p => p.text);
      if (b.stamp && str(b.stamp.text || b.stamp, 20)) {
        const s = typeof b.stamp === 'string' ? { text: b.stamp } : b.stamp;
        out.stamp = { text: str(s.text, 20).split(' ')[0] };
        if (Number.isFinite(Number(s.at)) && s.at !== '' && s.at != null) out.stamp.at = Math.max(0, Math.min(12, Number(s.at)));
        ['x', 'y', 'size'].forEach(k => { if (Number.isFinite(Number(s[k])) && s[k] !== '' && s[k] != null) out.stamp[k] = Number(s[k]); });
      }
      if (b.media) out.media = str(b.media, 200);
    } else if (type === 'statement') {
      out.lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 4).map(l => (typeof l === 'string' ? { text: str(l, 40), color: 'ink' } : { text: str(l && l.text, 40), color: colorName(l && l.color) })).filter(l => l.text);
      if (Number.isFinite(Number(b.top)) && b.top !== '' && b.top != null) out.top = Math.max(300, Math.min(1100, Number(b.top)));
      if (b.media) out.media = str(b.media, 200);
    } else if (type === 'number') {
      const v = numOf(b.value);
      out.value = Number.isFinite(v) ? v : 0;
      out.prefix = str(b.prefix, 3);
      out.suffix = str(b.suffix, 4);
      out.label = str(b.label, 40);
      out.kicker = str(b.kicker, 40);
      out.color = colorName(b.color, 'blue');
      if (b.display) out.display = str(b.display, 16);
    } else if (type === 'dots') {
      out.count = Math.max(1, Math.min(LIMITS.dotsMax * 2, Math.round(numOf(b.count)) || 1));
      out.highlight = Math.max(0, Math.min(out.count, Math.round(numOf(b.highlight)) || 0));
      out.label = str(b.label, 40);
      out.note = str(b.note, 40);
    } else if (type === 'compare') {
      out.items = (Array.isArray(b.items) ? b.items : []).slice(0, 6).map(it => {
        const value = numOf(it && (it.value != null && it.value !== '' ? it.value : it.display));
        return { label: str(it && it.label, 28), value: Number.isFinite(value) ? Math.abs(value) : 0, display: str(it && (it.display || it.value), 16), ...(it && it.color ? { color: colorName(it.color) } : {}) };
      }).filter(it => it.label);
      out.kicker = str(b.kicker, 40);
    } else if (type === 'quote') {
      out.text = str(b.text, 200).replace(/^[“"]|[”"]$/g, '');
      out.who = str(b.who || b.by, 60);
    } else if (type === 'endcard') {
      const cta = Array.isArray(b.cta) ? b.cta.map(c => str(c, 30)).filter(Boolean).slice(0, 2) : [];
      out.cta = cta.length ? cta : DEFAULT_CTA.slice();
    }
    return out;
  }

  // A beat's block: its own (an ES plan, or edited in Review), else made
  // from the beat's existing fields, so every plan (AI, draft, saved) draws
  // in the ES system without a rewrite.
  function blockOf(beat) {
    const b = beat || {};
    if (b.block && BLOCK_TYPES.includes(b.block.type)) return cleanBlock(b.block);
    const type = BLOCK_FOR_KIND[b.kind] || 'statement';
    const text = str(b.text, 120);
    if (type === 'hook') {
      const out = { type, pills: hookPills(text.replace(/[.!?]+$/, '')) };
      const em = str(b.emphasis, 20).split(' ')[0];
      if (em) out.stamp = { text: em };
      return out;
    }
    if (type === 'statement') {
      const src = b.kind === 'rank' && b.name ? `#${b.rank || ''} ${b.name}` : text;
      const lines = headlineLines(src.replace(/[!?]+$/, ''), LIMITS.lineChars, LIMITS.lines);
      return { type, lines: lines.map((t, i) => ({ text: t, color: i === lines.length - 1 && lines.length > 1 ? 'blue' : 'ink' })) };
    }
    if (type === 'number') {
      const raw = str(b.stat && b.stat.value, 16);
      const m = raw.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
      return { type, value: m ? Number(m[2].replace(/,/g, '')) : 0, prefix: m ? m[1].trim().slice(0, 3) : '', suffix: m ? m[3].trim().slice(0, 4) : '', label: str(b.stat && b.stat.label, 40), kicker: text.length <= 28 ? text : words(text).slice(0, 4).join(' '), color: 'blue', ...(raw ? { display: raw } : {}) };
    }
    if (type === 'dots') {
      if (b.chips) return { type, count: Math.max(1, Math.round(numOf(b.chips.total)) || 1), highlight: Math.max(0, Math.round(numOf(b.chips.filled)) || 0), label: str(b.chips.label || text, 40), note: '' };
      const d = b.dotrank || {};
      return { type, count: Math.max(1, Math.round(numOf(d.total)) || 1), highlight: 1, label: text, note: str(d.label, 40) };
    }
    if (type === 'compare') {
      const list = b.bars || (b.versus || []).map(v => ({ label: v.name, value: v.value })) || [];
      const rows = (b.roles || []).map(r => ({ label: r.role, value: r.value }));
      const items = (list.length ? list : rows).slice(0, LIMITS.compareMax).map((x, i) => ({ label: str(x.label, 28), value: Math.abs(numOf(x.value)) || 0, display: str(x.value, 16), color: i === 0 ? 'blue' : 'ink' }));
      return { type, items, kicker: text.length <= 28 ? text : words(text).slice(0, 4).join(' ') };
    }
    if (type === 'quote') return { type, text: str(b.quote && b.quote.text, 200), who: str(b.quote && b.quote.by, 60) };
    return { type: 'endcard', cta: DEFAULT_CTA.slice() };
  }
  const takesMedia = beat => Boolean(BLOCKS[blockOf(beat).type].media);

  // How a number shows on screen ("$692M", "274,000").
  function numberDisplay(block, value = block.value) {
    const v = Number(value) || 0;
    const decimals = (String(block.value).split('.')[1] || '').length;
    const fixed = Math.abs(v).toFixed(Math.min(2, decimals));
    const [int, dec] = fixed.split('.');
    const grouped = int.length > 4 || (block.display && /,/.test(block.display)) ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
    return `${block.prefix || ''}${v < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}${block.suffix || ''}`;
  }
  // The on-screen words of a block (lint, provenance, the legacy text field).
  function blockStrings(block) {
    const b = block || {};
    if (b.type === 'hook') return [...(b.pills || []).map(p => p.text), b.stamp ? b.stamp.text : ''].filter(Boolean);
    if (b.type === 'statement') return (b.lines || []).map(l => l.text);
    if (b.type === 'number') return [b.kicker, numberDisplay(b), b.label].filter(Boolean);
    if (b.type === 'dots') return [b.label, b.note].filter(Boolean);
    if (b.type === 'compare') return [b.kicker, ...(b.items || []).flatMap(it => [it.label, it.display])].filter(Boolean);
    if (b.type === 'quote') return [b.text, b.who].filter(Boolean);
    if (b.type === 'endcard') return (b.cta || []).filter(Boolean);
    return [];
  }
  const blockText = block => {
    const b = block || {};
    if (b.type === 'hook') return (b.pills || []).map(p => p.text).join(' ');
    if (b.type === 'statement') return (b.lines || []).map(l => l.text).join(' ');
    if (b.type === 'number') return b.kicker || b.label || numberDisplay(b);
    if (b.type === 'dots' || b.type === 'compare') return b.label || b.kicker || '';
    if (b.type === 'quote') return b.text;
    return (b.cta || []).join(' ');
  };
  // The legacy fields a block implies (kind, text, stat, bars, dotrank,
  // quote), so the rest of Reels Studio sees a normal beat.
  function legacyFields(block) {
    const b = cleanBlock(block);
    const out = { kind: KIND_FOR[b.type], text: blockText(b).slice(0, 90), block: b };
    if (b.type === 'number') out.stat = { value: b.display || numberDisplay(b), label: b.label };
    if (b.type === 'compare') out.bars = (b.items || []).map(it => ({ label: it.label, value: it.display || String(it.value) }));
    if (b.type === 'dots') out.dotrank = { total: String(b.count), rank: String(b.highlight), label: b.note };
    if (b.type === 'quote') out.quote = { text: b.text, by: b.who };
    return out;
  }
  // Signal colours a block uses (green and red; yellow too, though only
  // captions should use it). The dots' highlight is green.
  function signalsIn(block, vo = '') {
    const b = block || {};
    const used = new Set();
    const add = c => { if (SIGNALS.includes(c)) used.add(c); };
    (b.pills || []).forEach(p => add(p.color));
    if (b.stamp) add('red');
    (b.lines || []).forEach(l => add(l.color));
    if (b.type === 'number') add(b.color);
    if (b.type === 'dots' && b.highlight > 0) add('green');
    (b.items || []).forEach(it => add(it.color));
    if (parseEmphasis(vo).flags.some(Boolean)) add('yellow');
    return [...used];
  }

  // ─── Captions: *word* emphasis ─────────────────────────────────────────
  // "The Cubs lost. This bar got *paid.*" -> plain words + a flag per word.
  function parseEmphasis(vo) {
    const list = words(vo);
    let open = false;
    const flags = [];
    const plain = list.map(w => {
      const starts = /^[“"(]*\*/.test(w);
      const ends = /\*[.,!?;:”")]*$/.test(w);
      const on = open || starts;
      if (starts && !ends) open = true;
      if (ends) open = false;
      flags.push(on);
      return w.replace(/\*/g, '');
    }).map(w => w).filter((w, i) => { if (!w) flags[i] = null; return Boolean(w); });
    return { words: plain, flags: flags.filter(f => f !== null), text: plain.join(' ') };
  }
  const plainVo = vo => String(vo || '').replace(/\*/g, '');

  // ─── Script -> beats (the person's words, never rewritten) ─────────────
  const FILLER_START = /^(?:so|and|but|now|well|look|okay|ok|plus|also)[,]?\s+/i;
  const TRAIL_STOP = /\s+(?:the|a|an|on|in|of|to|as|at|for|and|but|with|by|their|his|her|its|our|your|is|are|was|were|that|this|so|very|just)$/i;
  function trimTrail(text) { let t = String(text || '').trim(); let prev; do { prev = t; t = t.replace(TRAIL_STOP, ''); } while (t !== prev); return t; }
  function headline(sentence, maxWords = 8) {
    const s = String(sentence || '').replace(/\*/g, '').replace(FILLER_START, '').replace(/[“”"]/g, '');
    const list = words(s).map(w => w.replace(/[,;:—–]+$/, ''));
    return trimTrail(list.slice(0, maxWords).join(' ').replace(/[.!?]+$/, ''));
  }
  // Lines for a statement (1-3, under 14 characters) from a headline; when
  // the words don't fit, the end is cut at a word that can close a line.
  function headlineLines(text, max, n) {
    let list = words(text);
    while (list.length > 1 && splitLines(list.join(' '), max).length > n) list = list.slice(0, -1);
    return splitLines(trimTrail(list.join(' ')) || list.join(' '), max);
  }
  // Pills for a hook: up to 3 at 14 characters; longer lines drop to size 110
  // (the kit's rule) and take about 18.
  function hookPills(text) {
    const at14 = splitLines(text, LIMITS.pillChars);
    const fit = at14.length <= LIMITS.pills ? { lines: at14, size: 0 } : { lines: headlineLines(text, 18, LIMITS.pills), size: 110 };
    return fit.lines.map((t, i) => ({ text: t, color: i === fit.lines.length - 1 && fit.lines.length > 1 ? 'blue' : 'ink', ...(fit.size && t.length > LIMITS.pillChars ? { size: fit.size } : {}) }));
  }
  // Sentences, keeping every character: joined back with single spaces they
  // equal the script (whitespace normalised).
  function scriptSentences(script) {
    const text = String(script || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return text.split(/(?<=[.!?…]["”’)*]*)\s+(?=["“(*]?[A-Z0-9$])/).map(s => s.trim()).filter(Boolean);
  }
  // A long sentence splits at a comma, semicolon or dash near its middle.
  function splitLong(sentence, max = 22) {
    const list = words(sentence);
    if (list.length <= max) return [sentence];
    const mid = list.length / 2;
    let best = -1;
    list.forEach((w, i) => { if (i > 2 && i < list.length - 3 && /[,;:—–]$/.test(w) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
    if (best < 0) best = Math.floor(mid) - 1;
    return [list.slice(0, best + 1).join(' '), ...splitLong(list.slice(best + 1).join(' '), max)];
  }
  // The words that follow a number, up to the next comma (stop words dropped).
  const STOP = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'as', 'at', 'for', 'and', 'but', 'with', 'by', 'was', 'were', 'is', 'are']);
  function labelAfter(text, from, n) {
    const rest = text.slice(from).split(/[,;:.!?—–(]|\s(?:compared|while|than|vs\.?|versus|and)\s/i)[0];
    return words(rest).map(w => w.replace(/[^\w'’-]/g, '')).filter(w => w && !STOP.has(w.toLowerCase())).slice(0, n).join(' ');
  }
  const NUM_TOKEN = /(\$?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%|[KMB]\b|\s?(?:million|billion|thousand)\b)?/gi;
  // Block for one beat of script (code only, free). The person can change
  // the block and its words in Review.
  function blockForLine(line, { first = false } = {}) {
    const plain = line.replace(/\*/g, '');
    const quoted = plain.match(/[“"]([^”"]{4,})[”"]/);
    if (!first && quoted && quoted[1].length <= LIMITS.quoteChars) {
      const who = (plain.match(/([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})\s+(?:said|says|told|added|admitted)\b/) || plain.match(/\b(?:said|says)\s+([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})/) || [])[1] || '';
      return { type: 'quote', text: quoted[1].trim().replace(/[,;:]$/, ''), who: who.toUpperCase() };
    }
    if (first) return { type: 'hook', pills: hookPills(headline(quoted ? quoted[1] : plain, 8)) };
    const scale = plain.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:in|out of)\s+(?:every\s+)?(\d{1,3}(?:,\d{3})+|\d+)\b/i);
    if (scale) {
      const hi = Number(scale[1].replace(/,/g, ''));
      const count = Number(scale[2].replace(/,/g, ''));
      const after = labelAfter(plain, scale.index + scale[0].length, 4);
      const before = headline(plain.slice(0, scale.index).replace(/\b(?:says?|said|reports?|shows?|found)\s*$/i, ''), 4);
      if (count >= 2 && count <= LIMITS.dotsMax && hi <= count) return { type: 'dots', count, highlight: hi, label: words(before).length >= 2 ? before : after, note: `${scale[1]} IN ${scale[2]}` };
    }
    const nums = [...plain.matchAll(NUM_TOKEN)].filter(m => !/^(?:19|20)\d\d$/.test(m[2]) || m[1] || m[3]);
    const compareWord = /\b(?:vs\.?|versus|compared (?:to|with)|than|while|against)\b/i.test(plain);
    if (nums.length >= 2 && compareWord) {
      const items = nums.slice(0, LIMITS.compareMax).map((m, i) => {
        const label = labelAfter(plain, m.index + m[0].length, 2) || `ITEM ${i + 1}`;
        return { label, value: Number(m[2].replace(/,/g, '')), display: `${m[1]}${m[2]}${(m[3] || '').trim()}`, color: i === 0 ? 'blue' : 'ink' };
      });
      const before = headline(plain.slice(0, nums[0].index), 4);
      return { type: 'compare', items, kicker: words(before).length >= 2 ? before : '' };
    }
    const big = nums.find(m => m[1] || m[3] || m[2].replace(/[,.]/g, '').length >= 2);
    if (big) {
      const unit = (big[3] || '').trim();
      const kicker = headline(plain.slice(0, big.index), 4);
      return { type: 'number', value: Number(big[2].replace(/,/g, '')), prefix: big[1], suffix: unit.length <= 2 ? unit.toUpperCase() : '', label: labelAfter(plain, big.index + big[0].length, 3), kicker: words(kicker).length >= 2 ? kicker : '', color: 'blue', display: `${big[1]}${big[2]}${unit.length <= 2 ? unit.toUpperCase() : ''}` };
    }
    const lines = headlineLines(headline(plain, 8), LIMITS.lineChars, LIMITS.lines);
    return { type: 'statement', lines: lines.map((t, i) => ({ text: t, color: i === lines.length - 1 && lines.length > 1 ? 'blue' : 'ink' })) };
  }
  // opts: { title, sport, voLengthSec, sourceLine, format }
  function scriptToPlan(script, opts = {}) {
    const sentences = scriptSentences(script).flatMap(s => splitLong(s));
    // Very short sentences ride with the next one (one idea, 2-5 s a beat).
    const lines = [];
    sentences.forEach(s => {
      const last = lines[lines.length - 1];
      if (last && words(last).length < 4 && words(last).length + words(s).length <= 22) lines[lines.length - 1] = `${last} ${s}`;
      else lines.push(s);
    });
    const beats = lines.map((line, i) => {
      const block = cleanBlock(blockForLine(line, { first: i === 0 }));
      return { id: `b${i + 1}`, ...legacyFields(block), vo: line, emphasis: '', photo: '' };
    });
    beats.push({ id: `b${beats.length + 1}`, ...legacyFields({ type: 'endcard', cta: DEFAULT_CTA.slice() }), vo: '', emphasis: '', photo: '' });
    const plan = {
      format: opts.format || 'explainer', title: str(opts.title, 120) || headline(lines[0] || '', 10), sport: opts.sport || '', team: null,
      angle: '', source: 'script', beats, style: 'es', script: { text: String(script || '').replace(/\s+/g, ' ').trim(), locked: true },
      sourceLine: str(opts.sourceLine, 120),
    };
    const sec = Number(opts.voLengthSec);
    if (sec > 0) plan.voLengthMs = Math.round(sec * 1000);
    return plan;
  }
  // True when the beats still read the script word for word (in order).
  function voMatchesScript(plan) {
    const want = plan && plan.script && plan.script.text;
    if (!want) return true;
    const got = (plan.beats || []).map(b => String(b.vo || '').trim()).filter(Boolean).join(' ');
    return got.replace(/\s+/g, ' ') === want.replace(/\s+/g, ' ');
  }

  // ─── Layout: ops with boxes ─────────────────────────────────────────────
  // op: { type: 'text', role, text, font, size, x, y (baseline), w, color,
  //       fill? (a boxed word), enter: 'left' | 'up' | 'none', delay, rot? }
  //     { type: 'rect' | 'panel' | 'dots' | 'bar' | 'media' | 'quote-mark' | 'mark' | 'logotype' }
  const tracked = (measure, text, size) => measure(text, displayFont(size)) + TYPE.tracking * size * Math.max(0, text.length - 1);
  // The hug box of a boxed word: cap-height to baseline, 0.16em all round.
  function hugBox(x, y, w, size) {
    const pad = TYPE.pad * size;
    return { x: x - pad, y: y - TYPE.cap * size - pad, w: w + 2 * pad, h: TYPE.cap * size + 2 * pad };
  }
  // The text colour (a name) for a boxed word's fill, in the look.
  const inkOn = (name, theme) => TH.inkOn(name, theme ? theme.colors : null);
  // Biggest size in [min, max] at which every line fits `width` (boxed: with its padding).
  function fitSize(measure, lines, { max, min, width, boxed = false }) {
    let size = max;
    const ok = s => lines.every(t => tracked(measure, t, s) + (boxed ? 2 * TYPE.pad * s : 0) <= width + 0.01);
    while (size > min && !ok(size)) size = Math.max(min, size * 0.96);
    return size;
  }
  function boxedText(measure, text, x, top, size, fill, extra = {}, theme = null) {
    const t = String(text).toUpperCase();
    const w = tracked(measure, t, size);
    const pad = TYPE.pad * size;
    const y = top + pad + TYPE.cap * size;
    return { type: 'text', text: t, font: displayFont(size), size, x: x + pad, y, w, color: inkOn(fill, theme), fill, track: TYPE.tracking * size, ...extra };
  }
  // A word whose colour would not read on the scene's ground (a red line on
  // ES blue) sits on the surface's plate: an ink hug box, kept in the column.
  function plateOps(ops, S, theme, geo) {
    if (!S.plate) return;
    const ground = theme.hex(S.ground);
    ops.forEach(op => {
      if ((op.type !== 'text' && op.type !== 'count') || op.fill || op.noCheck || op.small) return;
      if (TH.contrast(theme.hex(op.color), ground) >= TH.ACCENT_MIN) return;
      const need = op.w + 2 * TYPE.pad * op.size;
      if (need > geo.col.w) {
        const k = geo.col.w / need;
        op.size *= k; op.w *= k; op.track = TYPE.tracking * op.size; op.font = displayFont(op.size);
      }
      op.fill = S.plate;
      op.plated = true;
      op.x = Math.max(op.x, geo.col.x + TYPE.pad * op.size);
    });
  }
  const opBox = op => (op.fill ? hugBox(op.x, op.y, op.w, op.size) : { x: op.x, y: op.y - TYPE.cap * op.size, w: op.w, h: TYPE.cap * op.size });

  function layoutBlock(measure, graphic, timeline = {}) {
    const geo = geometry(timeline.size);
    const block = (graphic.data && graphic.data.block) || blockOf(graphic.data || {});
    const theme = themeOf(timeline);
    const S = theme.surfaceFor(block.type); // the scene's surface (ground + how colour names land on it)
    const LY = theme.layout;
    const tx = name => S.text[name] || name; // a text colour name on this surface
    const fl = name => S.fill[name] || name; // a boxed word's fill on this surface
    const boxed = (text, x, top, size, fill, extra) => boxedText(m, text, x, top, size, fl(fill), extra, theme);
    const T = geo.type;
    const X = geo.col.x;
    const CW = geo.col.w;
    const st = theme.motion.staggerMs;
    const ops = [];
    const m = (t, f) => measure(String(t), f);
    const boxStep = size => size * (TYPE.cap + 2 * TYPE.pad) + 12 * T;
    // A photo under the words: the whole frame, or the part below them.
    const mediaFull = () => ({ type: 'media', role: 'media', x: 0, y: 0, w: geo.w, h: geo.h });
    const mediaBelow = bottom => {
      const y0 = Math.max(bottom + 64 * geo.k, 720 * geo.k);
      return geo.h - y0 > 360 * geo.k ? { type: 'media', role: 'media', x: 0, y: Math.round(y0), w: geo.w, h: geo.h - Math.round(y0) } : null;
    };
    if (block.type === 'hook') {
      const full = LY.media.hook === 'full';
      if (graphic.media && full) ops.push(mediaFull());
      let top = geo.top.hook;
      let bottom = top;
      (block.pills || []).forEach((p, i) => {
        const text = String(p.text).toUpperCase();
        const max = Math.min(160, (p.size || 128) * LY.pillScale) * T;
        if (LY.pillBoxed) {
          const size = fitSize(m, [text], { max, min: 64 * T, width: CW, boxed: true });
          ops.push(boxed(text, X, top, size, p.color || 'ink', { role: 'pill', enter: 'left', delay: i * st }));
          bottom = top + size * (TYPE.cap + 2 * TYPE.pad);
          top += boxStep(size);
        } else {
          // Plain pills (Minimal): the same words as display type, no box.
          const size = fitSize(m, [text], { max, min: 64 * T, width: CW });
          const c = p.color === 'yellow' || p.color === 'white' ? 'ink' : (p.color || 'ink');
          ops.push({ type: 'text', role: 'pill', text, font: displayFont(size), size, x: X, y: top + TYPE.cap * size, w: tracked(m, text, size), color: tx(c), track: TYPE.tracking * size, enter: 'left', delay: i * st });
          bottom = top + TYPE.cap * size;
          top += TYPE.lineHeight * size + 12 * T;
        }
      });
      if (graphic.media && !full) { const md = mediaBelow(bottom); if (md) ops.unshift(md); }
      if (block.stamp && block.stamp.text) {
        const size = (block.stamp.size || 170) * T;
        const text = block.stamp.text.toUpperCase();
        const sx = block.stamp.x != null ? block.stamp.x : 300;
        const sy = (block.stamp.y != null ? block.stamp.y : 860) * geo.k;
        const op = boxed(text, sx, sy, size, 'red', { role: 'stamp', enter: 'stamp', at: graphic.stampAt != null ? graphic.stampAt : 1200, rot: MOTION.stampRotDeg });
        // Keep the tilted stamp inside the column.
        const b = rotatedBox(op);
        const shift = Math.min(0, geo.col.x + geo.col.w - (b.x + b.w)) + Math.max(0, geo.col.x - b.x);
        op.x += shift;
        ops.push(op);
      }
    } else if (block.type === 'statement') {
      const lines = (block.lines || []).map(l => ({ ...l, text: String(l.text).toUpperCase() }));
      const lineColor = l => (l.color === 'yellow' || l.color === 'white' ? 'ink' : l.color);
      const top0 = block.top != null ? block.top * geo.k : geo.top.statement;
      let bottom;
      if (LY.statementBoxed) {
        // Boxed lines (Photo-led, Bold): every line a hug box, like the hook's pills.
        const size = fitSize(m, lines.map(l => l.text), { max: LY.statementMax * T, min: 72 * T, width: CW, boxed: true });
        let top = top0;
        lines.forEach((l, i) => { ops.push(boxed(l.text, X, top, size, lineColor(l) || 'ink', { role: 'line', enter: 'up', delay: i * st })); top += boxStep(size); });
        bottom = top - 12 * T;
      } else {
        const size = fitSize(m, lines.map(l => l.text), { max: LY.statementMax * T, min: 88 * T, width: CW });
        let y = top0 + TYPE.cap * size;
        lines.forEach((l, i) => {
          ops.push({ type: 'text', role: 'line', text: l.text, font: displayFont(size), size, x: X, y, w: tracked(m, l.text, size), color: tx(lineColor(l)), track: TYPE.tracking * size, enter: 'up', delay: i * st });
          y += TYPE.lineHeight * size;
        });
        bottom = y - TYPE.lineHeight * size;
      }
      if (graphic.media) {
        const md = LY.media.statement === 'full' && LY.statementBoxed ? mediaFull() : mediaBelow(bottom);
        if (md) ops.unshift(md);
      }
    } else if (block.type === 'number') {
      let top = geo.top.block;
      if (block.kicker) {
        const ks = fitSize(m, [block.kicker.toUpperCase()], { max: 64 * T, min: 40 * T, width: CW, boxed: LY.kickerBoxed });
        if (LY.kickerBoxed) {
          ops.push(boxed(block.kicker, X, top, ks, LY.kickerFill, { role: 'kicker', enter: 'left', delay: 0 }));
          top += ks * (TYPE.cap + 2 * TYPE.pad) + 56 * T;
        } else {
          const kt = block.kicker.toUpperCase();
          ops.push({ type: 'text', role: 'kicker', text: kt, font: displayFont(ks), size: ks, x: X, y: top + TYPE.cap * ks, w: tracked(m, kt, ks), color: tx('ink'), track: TYPE.tracking * ks, enter: 'left', delay: 0 });
          top += ks * TYPE.cap + 64 * T;
        }
      }
      const full = numberDisplay(block);
      const size = fitSize(m, [full], { max: LY.numberMax * T, min: 150 * T, width: CW });
      const y = top + TYPE.cap * size;
      ops.push({ type: 'count', role: 'number', text: full, block, font: displayFont(size), size, x: X, y, w: tracked(m, full, size), color: tx(block.color || 'blue'), track: TYPE.tracking * size, enter: 'up', delay: st });
      if (block.label) {
        const label = block.label.toUpperCase();
        const ls = fitSize(m, [label], { max: 96 * T, min: 56 * T, width: CW });
        ops.push({ type: 'text', role: 'label', text: label, font: displayFont(ls), size: ls, x: X, y: y + 44 * T + TYPE.cap * ls, w: tracked(m, label, ls), color: tx('ink'), track: TYPE.tracking * ls, enter: 'up', delay: 2 * st });
      }
    } else if (block.type === 'dots') {
      let top = geo.top.block;
      if (block.label) {
        const lines = fitLines(block.label.toUpperCase(), 22, 2);
        const ls = fitSize(m, lines, { max: 96 * T, min: 56 * T, width: CW });
        let y = top + TYPE.cap * ls;
        lines.forEach((t, i) => { ops.push({ type: 'text', role: 'label', text: t, font: displayFont(ls), size: ls, x: X, y, w: tracked(m, t, ls), color: tx('ink'), track: TYPE.tracking * ls, enter: 'up', delay: i * st }); y += TYPE.lineHeight * ls; });
        top = y - TYPE.lineHeight * ls + 48 * T;
      }
      const n = Math.max(1, Math.min(LIMITS.dotsMax, block.count));
      const hi = Math.min(n, block.highlight || 0);
      const note = block.note ? block.note.toUpperCase() : '';
      const ns = note ? fitSize(m, [note], { max: 88 * T, min: 52 * T, width: CW, boxed: true }) : 0;
      const noteH = note ? ns * (TYPE.cap + 2 * TYPE.pad) + 40 * T : 0;
      const region = { x: X, y: top, w: CW, h: Math.max(160 * geo.k, geo.contentBottom - noteH - top) };
      let cell = Math.floor(Math.sqrt((region.w * region.h) / n));
      cell = Math.max(6, Math.min(140, cell));
      let cols = Math.max(1, Math.floor(region.w / cell));
      let rows = Math.ceil(n / cols);
      while (rows * cell > region.h && cell > 6) { cell -= 1; cols = Math.max(1, Math.floor(region.w / cell)); rows = Math.ceil(n / cols); }
      ops.push({ type: 'dots', role: 'dots', x: X, y: region.y, w: cols * cell, h: rows * cell, n, hi, cell, cols, base: S.dot, enter: 'none', delay: st });
      if (note) ops.push(boxed(note, X, region.y + rows * cell + 40 * T, ns, hi ? 'green' : 'ink', { role: 'note', enter: 'left', delay: 1500 }));
    } else if (block.type === 'compare') {
      let top = geo.top.block;
      if (block.kicker) {
        const ks = fitSize(m, [block.kicker.toUpperCase()], { max: 64 * T, min: 40 * T, width: CW, boxed: LY.kickerBoxed });
        if (LY.kickerBoxed) {
          ops.push(boxed(block.kicker, X, top, ks, LY.kickerFill, { role: 'kicker', enter: 'left', delay: 0 }));
          top += ks * (TYPE.cap + 2 * TYPE.pad) + 56 * T;
        } else {
          const kt = block.kicker.toUpperCase();
          ops.push({ type: 'text', role: 'kicker', text: kt, font: displayFont(ks), size: ks, x: X, y: top + TYPE.cap * ks, w: tracked(m, kt, ks), color: tx('ink'), track: TYPE.tracking * ks, enter: 'left', delay: 0 });
          top += ks * TYPE.cap + 64 * T;
        }
      }
      const items = (block.items || []).slice(0, LIMITS.compareMax);
      const max = Math.max(0, ...items.map(it => it.value)) || 1;
      const unit = (geo.contentBottom - top) / Math.max(2, items.length);
      const barH = Math.round(Math.min(128 * T * LY.barScale, unit * 0.44));
      const ls = Math.round(Math.min(76 * T, unit * 0.26));
      const valueSize = Math.round(barH * 0.92);
      const reserve = Math.max(...items.map(it => tracked(m, String(it.display || it.value).toUpperCase(), valueSize)), 0) + 24;
      const barMax = Math.max(160, CW - reserve);
      items.forEach((it, i) => {
        const y0 = top + i * unit;
        const label = it.label.toUpperCase();
        const lsz = fitSize(m, [label], { max: ls, min: 32 * T, width: CW });
        ops.push({ type: 'text', role: 'item-label', text: label, font: displayFont(lsz), size: lsz, x: X, y: y0 + TYPE.cap * lsz, w: tracked(m, label, lsz), color: tx('ink'), track: TYPE.tracking * lsz, enter: 'left', delay: i * st });
        const by = y0 + TYPE.cap * lsz + 16 * T;
        // A tiny value still reads as a bar, never as a thin stripe.
        const w = Math.max(Math.ceil(barH * 0.4), Math.round((barMax * it.value) / max));
        const color = it.color || (i === 0 ? 'blue' : 'ink');
        ops.push({ type: 'bar', role: 'bar', x: X, y: by, w, h: barH, fill: fl(color), enter: 'grow', delay: i * st + 120 });
        const disp = String(it.display || it.value).toUpperCase();
        ops.push({ type: 'text', role: 'item-value', text: disp, font: displayFont(valueSize), size: valueSize, x: X + w + 20, y: by + barH / 2 + (TYPE.cap * valueSize) / 2, w: tracked(m, disp, valueSize), color: tx('ink'), track: TYPE.tracking * valueSize, enter: 'left', delay: i * st + 360 });
      });
    } else if (block.type === 'quote') {
      const text = `${block.text}`.toUpperCase();
      // Balanced: no one-word last line when a narrower measure avoids it.
      const lines0 = s => { for (const k of [1, 0.86, 0.74]) { const l = wrapWidth(m, text, s, CW * k); if (l.length === 1 || words(l[l.length - 1]).length > 1) return l; } return wrapWidth(m, text, s, CW); };
      let size = 128 * T;
      while (size > 72 * T && (lines0(size).length > 5 || lines0(size).length * TYPE.lineHeight * size > 560 * geo.k)) size *= 0.95;
      const lines = lines0(size);
      const qm = 360 * T;
      ops.push({ type: 'text', role: 'quote-mark', text: '“', font: displayFont(qm), size: qm * 0.5, x: X - 8, y: geo.top.block + qm * 0.62, w: qm * 0.42, color: tx('blue'), noCheck: true, enter: 'up', delay: 0 });
      let y = geo.top.block + qm * 0.62 + 24 * T + TYPE.cap * size;
      lines.forEach((t, i) => { ops.push({ type: 'text', role: 'quote', text: t, font: displayFont(size), size, x: X, y, w: tracked(m, t, size), color: tx('ink'), track: TYPE.tracking * size, enter: 'up', delay: (i + 1) * st }); y += TYPE.lineHeight * size; });
      if (block.who) {
        const ws = fitSize(m, [block.who.toUpperCase()], { max: 68 * T, min: 40 * T, width: CW, boxed: LY.whoBoxed });
        const wtop = y - TYPE.lineHeight * size + 64 * T;
        if (LY.whoBoxed) ops.push(boxed(block.who, X, wtop, ws, 'blue', { role: 'who', enter: 'left', delay: (lines.length + 1) * st }));
        else { const wt = block.who.toUpperCase(); ops.push({ type: 'text', role: 'who', text: wt, font: displayFont(ws), size: ws, x: X, y: wtop + TYPE.cap * ws, w: tracked(m, wt, ws), color: tx('blue'), track: TYPE.tracking * ws, enter: 'left', delay: (lines.length + 1) * st }); }
      }
    } else if (block.type === 'endcard') {
      const cta = (block.cta || DEFAULT_CTA).map(c => String(c).toUpperCase());
      const size = fitSize(m, cta, { max: 150 * T, min: 80 * T, width: CW, boxed: true });
      const pad = TYPE.pad * size;
      const lh = TYPE.lineHeight * size;
      const widest = Math.max(...cta.map(t => tracked(m, t, size)));
      const top = geo.top.hook;
      const panel = { type: 'panel', role: 'cta-panel', x: X, y: top, w: widest + 2 * pad, h: TYPE.cap * size + (cta.length - 1) * lh + 2 * pad, fill: S.cta, enter: 'left', delay: 0 };
      if (LY.ctaPanel) ops.push(panel);
      // Minimal: the same words without the panel, the last line in the accent.
      cta.forEach((t, i) => ops.push({ type: 'text', role: 'cta', text: t, font: displayFont(size), size, x: X + (LY.ctaPanel ? pad : 0), y: top + pad + TYPE.cap * size + i * lh, w: tracked(m, t, size), color: LY.ctaPanel ? inkOn(S.cta, theme) : tx(i === cta.length - 1 && cta.length > 1 ? 'blue' : 'ink'), track: TYPE.tracking * size, enter: 'left', delay: 0 }));
      const lw = Math.round((258 * geo.logotype.h) / 30.6864);
      // INFERRED: the message on top, the logotype as the signature above the source line.
      ops.push({ type: 'logotype', role: 'logotype', x: X, y: Math.round(Math.max(panel.y + panel.h + 96 * geo.k, geo.sourceY - 92 * geo.k - geo.logotype.h - 34)), w: lw, h: geo.logotype.h, variant: S.logo, enter: 'up', delay: st });
      const src = String(timeline.sourceLine || '').trim();
      if (src) {
        const s = 34 * T;
        const text = src.toUpperCase();
        const f = smallFont(s);
        let w = measure(text, f);
        const size2 = w > CW ? s * (CW / w) : s;
        w = Math.min(w, CW);
        ops.push({ type: 'text', role: 'source', text, font: smallFont(size2), size: size2, x: X, y: geo.sourceY, w, color: tx('ink'), alpha: S.small, enter: 'up', delay: 2 * st, small: true });
      }
    }
    plateOps(ops, S, theme, geo);
    // A scene that leaves the look's ground (the kit's quote on ink) paints its own first.
    if (S.ground !== theme.base.ground) ops.unshift({ type: 'rect', role: 'ground', x: 0, y: 0, w: geo.w, h: geo.h, fill: S.ground, noBox: true, enter: 'none' });
    return ops;
  }
  function wrapWidth(measure, text, size, width) {
    const out = [];
    let line = '';
    words(text).forEach(w => {
      const next = line ? `${line} ${w}` : w;
      if (line && tracked(measure, next, size) > width) { out.push(line); line = w; } else line = next;
    });
    if (line) out.push(line);
    return out;
  }
  // Axis-aligned box of a tilted (stamp) op.
  function rotatedBox(op) {
    const b = hugBox(op.x, op.y, op.w, op.size);
    if (!op.rot) return b;
    const a = (op.rot * Math.PI) / 180;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // Captions: one line at y 1172, centred, 1-3 words cut on together, in an
  // ink box that hugs the line; *emphasis* words in yellow.
  function layoutCaption(measure, card, timeline) {
    const geo = geometry(timeline.size);
    const list = card.words.map(i => ({ i, text: String(timeline.tracks.captions.words[i].w).replace(/^[“"]|[”"]$/g, '').toUpperCase(), em: Boolean(timeline.tracks.captions.words[i].em) }));
    const line = list.map(w => w.text).join(' ');
    const size = fitSize((t, f) => measure(t, f), [line], { max: 84 * geo.type, min: 48 * geo.type, width: geo.col.w, boxed: true });
    const w = tracked(measure, line, size);
    const box = hugBox(0, 0, w, size);
    const x0 = (geo.w - w) / 2;
    const y = geo.captionY - box.h / 2 + TYPE.pad * size + TYPE.cap * size;
    const space = measure(' ', displayFont(size)) + TYPE.tracking * size;
    let x = x0;
    const ops = list.map(word => {
      const ww = tracked(measure, word.text, size);
      const op = { type: 'cword', i: word.i, text: word.text, em: word.em, font: displayFont(size), size, x, y, w: ww, track: TYPE.tracking * size };
      x += ww + space;
      return op;
    });
    return { style: 'es', ops, box: hugBox(x0, y, w, size), size };
  }

  // Every word box of an ES reel (the safe-frame maths): text, boxed words
  // with their padding, tilted stamps, captions. Background panels count
  // too when they carry words (the CTA panel).
  function textBoxes(measure, timeline, layout = layoutBlock) {
    const out = [];
    timeline.tracks.graphics.forEach(g => layout(measure, g, timeline).forEach(op => {
      if ((op.type === 'text' || op.type === 'count') && !op.noCheck) {
        const b = op.rot ? rotatedBox(op) : opBox(op);
        out.push({ beat: g.beat, role: op.role, text: op.text, ...b });
      } else if (op.type === 'panel') out.push({ beat: g.beat, role: op.role, text: '', x: op.x, y: op.y, w: op.w, h: op.h });
    }));
    timeline.tracks.captions.cards.forEach(card => {
      const cap = layoutCaption(measure, card, timeline);
      if (cap.box) out.push({ beat: card.beat, role: 'caption', text: cap.ops.map(o => o.text).join(' '), ...cap.box });
    });
    return out;
  }
  // Inside the safe frame: no words above y 300, within 40 px of the sides, or below y 1640.
  function outsideSafe(box, size) {
    const geo = geometry(size);
    return box.y < geo.safe.top - 0.5 || box.y + box.h > geo.safe.bottom + 0.5 || box.x < geo.safe.side - 0.5 || box.x + box.w > geo.w - geo.safe.side + 0.5;
  }
  // Marks: the ES mark on the hook and the end card only; the logotype on the end card only.
  function markRect(size) { const g = geometry(size); return { x: g.mark.x, y: g.mark.y, w: g.mark.size, h: g.mark.size, clear: g.mark.clear }; }
  const MARK_BLOCKS = new Set(['hook', 'endcard']);

  // ─── Drawing ────────────────────────────────────────────────────────────
  // helpers (from reel-render): { drawVisual(ctx, assetId, rect, timeline, env, opts), drawBrand(ctx, id, x, y, w, h, variant, env), BRAND }
  function enterState(op, local, motion = null) {
    const l = local - (op.delay || 0);
    const p = ease.expoOut(l / ((motion && motion.enterMs) || MOTION.enterMs));
    if (op.enter === 'none' || op.enter === 'grow' || op.enter === 'stamp') return { a: 1, dx: 0, dy: 0, p, l };
    const a = l <= 0 ? 0 : 1;
    if (op.enter === 'left') return { a, dx: -(1 - p) * MOTION.fromLeft, dy: 0, p, l };
    return { a, dx: 0, dy: (1 - p) * MOTION.fromBelow, p, l };
  }
  function setTrack(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px || 0}px`; }
  function fillHug(ctx, op, color, theme) {
    const b = hugBox(op.x, op.y, op.w, op.size);
    ctx.fillStyle = colorOf(color, theme);
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  function drawText(ctx, op, text = op.text, theme = null) {
    ctx.font = op.font;
    if (op.fill) fillHug(ctx, op, op.fill, theme);
    ctx.fillStyle = colorOf(op.color, theme);
    if (op.track) setTrack(ctx, op.track);
    ctx.fillText(text, op.x, op.y);
    if (op.track) setTrack(ctx, 0);
  }
  function drawDots(ctx, op, local, theme = null) {
    // Grey dots fill in row by row over 1.2 s; the highlighted ones (the
    // last cells) land last, in green, with a small pop.
    const plain = op.n - op.hi;
    const shown = Math.floor(plain * ease.expoOut((local - (op.delay || 0)) / 1200));
    const r = op.cell * 0.36;
    // The plain dots take the look's dot colour; the highlight is always green.
    ctx.fillStyle = colorOf(op.base || 'ink', theme);
    ctx.globalAlpha *= 0.3;
    ctx.beginPath();
    for (let i = 0; i < shown; i += 1) {
      const cx = op.x + (i % op.cols) * op.cell + op.cell / 2;
      const cy = op.y + Math.floor(i / op.cols) * op.cell + op.cell / 2;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha /= 0.3;
    if (!op.hi) return;
    const t = local - (op.delay || 0) - 1250;
    if (t <= 0) return;
    const k = 1 + 0.5 * (1 - ease.expoOut(t / 300));
    // A few highlighted dots in a big field would vanish: they draw at least
    // 9 px across, with a green ring round each (flat, no glow).
    const few = op.hi <= 12;
    const rr = (few ? Math.max(op.cell * 0.46, 9) : op.cell * 0.42) * k;
    const centre = j => { const i = plain + j; return [op.x + (i % op.cols) * op.cell + op.cell / 2, op.y + Math.floor(i / op.cols) * op.cell + op.cell / 2]; };
    ctx.fillStyle = TOKENS.green;
    ctx.beginPath();
    for (let j = 0; j < op.hi; j += 1) { const [cx, cy] = centre(j); ctx.moveTo(cx + rr, cy); ctx.arc(cx, cy, rr, 0, Math.PI * 2); }
    ctx.fill();
    if (few) {
      ctx.strokeStyle = TOKENS.green;
      ctx.lineWidth = 4;
      for (let j = 0; j < op.hi; j += 1) { const [cx, cy] = centre(j); ctx.beginPath(); ctx.arc(cx, cy, rr + 12, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  // The ES mark: the official artwork scaled uniformly to 80 px wide, its
  // blue box extended to an 80 px square (INFERRED: the kit's own mark file
  // was not available; the letters are the official vectors, never retyped).
  // variant: 'blue', or 'black' where what is under the mark is ES blue (the
  // brand guide's two colourways; a look never picks any other).
  function drawMark(ctx, x, y, size, helpers, env, variant = 'blue') {
    const v = variant === 'black' ? 'black' : 'blue';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = v === 'black' ? '#000000' : TOKENS.blue;
    ctx.fillRect(x, y, size, size);
    const art = helpers && helpers.BRAND && helpers.BRAND.mark;
    const h = art ? (size * art.h) / art.w : size;
    if (helpers && helpers.drawBrand) helpers.drawBrand(ctx, 'mark', x, y + (size - h) / 2, size, h, v, env);
    ctx.restore();
  }
  function drawStampOp(ctx, op, local, theme = null) {
    const t = local - op.at;
    if (t < 0) return;
    const p = clamp01(t / MOTION.stampMs);
    const k = MOTION.stampFrom - (MOTION.stampFrom - 1) * ease.power4In(p);
    const b = hugBox(op.x, op.y, op.w, op.size);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, 0.4 + p);
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((op.rot * Math.PI) / 180);
    ctx.scale(k, k);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    drawText(ctx, op, op.text, theme);
    ctx.restore();
  }
  // The small screen shake when the stamp lands (decays over 0.26 s).
  function shakeAt(ops, local) {
    const s = ops.find(o => o.enter === 'stamp');
    if (!s) return [0, 0];
    const t = local - s.at - MOTION.stampMs;
    if (t < 0 || t > MOTION.shakeMs) return [0, 0];
    const d = (1 - t / MOTION.shakeMs) * MOTION.shakePx;
    return [Math.sin(t / 14) * d, Math.cos(t / 11) * d * 0.6];
  }
  function drawOps(ctx, ops, graphic, timeline, frame, env, helpers, times, theme = themeOf(timeline)) {
    const local = times.ops;
    const [sx, sy] = shakeAt(ops, times.stamp);
    ctx.save();
    ctx.translate(sx, sy);
    ops.forEach(op => {
      if (op.type === 'media') {
        const shot = frame.shot && frame.shot.beat === graphic.beat ? frame.shot : (timeline.tracks.video.find(s => s.beat === graphic.beat) || null);
        if (!shot || !shot.asset) return;
        const p = clamp01((frame.t - shot.inMs) / Math.max(1, shot.outMs - shot.inMs));
        ctx.save();
        ctx.beginPath(); ctx.rect(op.x, op.y, op.w, op.h); ctx.clip();
        helpers.drawVisual(ctx, shot.asset, op, timeline, env, { p, motion: shot.motion, tMs: frame.t });
        ctx.restore();
        return;
      }
      if (op.type === 'rect') { ctx.fillStyle = colorOf(op.fill, theme); ctx.fillRect(op.x, op.y, op.w, op.h); return; }
      if (op.enter === 'stamp') { drawStampOp(ctx, op, times.stamp, theme); return; }
      const st = enterState(op, local, theme.motion);
      if (st.a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= st.a * (op.alpha || 1);
      ctx.translate(st.dx, st.dy);
      if (op.type === 'text') drawText(ctx, op, op.text, theme);
      else if (op.type === 'count') {
        const c = ease.expoOut((local - (op.delay || 0)) / MOTION.countMs);
        drawText(ctx, op, numberDisplay(op.block, op.block.value * c), theme);
      } else if (op.type === 'panel') { ctx.fillStyle = colorOf(op.fill, theme); ctx.fillRect(op.x, op.y, op.w, op.h); } else if (op.type === 'bar') {
        ctx.fillStyle = colorOf(op.fill, theme);
        ctx.fillRect(op.x, op.y, Math.max(0, op.w * ease.expoOut(st.l / 600)), op.h);
      } else if (op.type === 'dots') drawDots(ctx, op, local, theme);
      else if (op.type === 'logotype') { if (helpers.drawBrand) helpers.drawBrand(ctx, 'wordmark', op.x, op.y, op.w, op.h, op.variant === 'black' ? 'black' : 'blue', env); }
      ctx.restore();
    });
    ctx.restore();
  }
  // The look's ground. Paper (and Bold) carry the faint still grain; the flat
  // grounds (ink, blue, white, a team colour) carry none.
  function drawGround(ctx, geo, env, theme = PAPER) {
    ctx.fillStyle = colorOf(theme.base.ground, theme);
    ctx.fillRect(0, 0, geo.w, geo.h);
    // Faint grain, still (no flicker): the page's noise tile at 5%.
    if (theme.grain > 0 && env.grain && typeof ctx.createPattern === 'function') {
      const pattern = ctx.createPattern(env.grain, 'repeat');
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = theme.grain;
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, geo.w, geo.h);
        ctx.restore();
      }
    }
  }
  const drawPaper = (ctx, geo, env) => drawGround(ctx, geo, env, PAPER); // the old name, kept
  // The slab wipe: a blue slab, then an ink slab over it, both skewed -14°,
  // cover the frame by the half-way point (the cut happens under the ink),
  // then leave to the right. 0.5 s; no cross-fade, no zoom. A look names the
  // two colours (theme.wipe); the shape, skew and timing are the same in all.
  function slabs(p, geo = GEO, theme = null) {
    const lean = Math.tan((Math.abs(MOTION.wipeSkewDeg) * Math.PI) / 180) * geo.h;
    const SW = geo.w + lean + 80;
    const cover = -40;
    const out = [];
    if (p < 0.5) {
      const q = p / 0.5;
      const xb = -SW + (cover + SW) * ease.inOutCubic(q / 0.8);
      const xi = -SW + (cover + SW) * ease.inOutCubic((q - 0.2) / 0.8);
      out.push({ color: 'blue', x: xb }, { color: 'ink', x: xi });
    } else {
      const q = (p - 0.5) / 0.5;
      const x = cover + (geo.w + lean + 40 - cover) * ease.inOutCubic(q);
      out.push({ color: 'ink', x });
    }
    const named = theme ? { blue: theme.wipe[0], ink: theme.wipe[1] } : null;
    return out.map(s => ({ ...s, ...(named ? { color: named[s.color] } : {}), lean, w: SW, poly: [[s.x, 0], [s.x + SW, 0], [s.x + SW - lean, geo.h], [s.x - lean, geo.h]] }));
  }
  function drawSlab(ctx, p, geo = GEO, theme = null) {
    slabs(p, geo, theme).forEach(s => {
      ctx.fillStyle = colorOf(s.color, theme);
      ctx.beginPath();
      s.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    });
  }
  function drawScene(ctx, graphic, timeline, frame, env, helpers, times, layout) {
    const geo = geometry(timeline.size);
    const block = graphic.data.block;
    const theme = themeOf(timeline);
    drawGround(ctx, geo, env, theme);
    const ops = env.layoutCache ? env.layoutCache(graphic) : layout(env.measure, graphic, timeline);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    drawOps(ctx, ops, graphic, timeline, frame, env, helpers, times, theme);
    ctx.restore();
    // The marks: the hook and the end card only, same place and size in every look.
    if (MARK_BLOCKS.has(block.type)) { const mk = markRect(timeline.size); drawMark(ctx, mk.x, mk.y, mk.w, helpers, env, markVariantFor(theme, block.type, ops, mk)); }
  }
  // The mark's colourway in a scene: the surface's (black on ES blue), or blue
  // when a photo is under it.
  function markVariantFor(theme, type, ops, mk) {
    const S = theme.surfaceFor(type);
    const photoUnder = (ops || []).some(o => o.type === 'media' && o.y <= mk.y && o.y + o.h >= mk.y + mk.h);
    return photoUnder ? 'blue' : S.mark;
  }
  function drawCaption(ctx, frame, timeline, env) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    if (!layout.ops.length) return;
    const theme = themeOf(timeline);
    const cap = theme.caption;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colorOf(cap.fill, theme);
    ctx.fillRect(layout.box.x, layout.box.y, layout.box.w, layout.box.h);
    layout.ops.forEach(op => {
      ctx.font = op.font;
      // Emphasis is always yellow: yellow words on a dark box, or (a light
      // box) the word in ink on a yellow highlight the height of the box.
      if (op.em && cap.mode === 'highlight') {
        ctx.fillStyle = colorOf(cap.em, theme);
        ctx.fillRect(op.x - 0.09 * op.size, layout.box.y, op.w + 0.18 * op.size, layout.box.h);
      }
      ctx.fillStyle = op.em ? colorOf(cap.mode === 'highlight' ? inkOn(cap.em, theme) : cap.em, theme) : colorOf(cap.ink, theme);
      setTrack(ctx, op.track);
      ctx.fillText(op.text, op.x, op.y);
      setTrack(ctx, 0);
    });
    ctx.restore();
  }
  // Frame one is the cover: the opening hook is already composed at t = 0
  // (its pills landed; only the stamp lands later, on its own time). Every
  // other scene builds in once the slab has cleared it (half the wipe).
  function sceneTimes(graphic, local) {
    if (graphic.inMs === 0) return { ops: local + 60000, stamp: local };
    const l = local - MOTION.wipeMs / 2;
    return { ops: l, stamp: l };
  }
  function drawFrame(ctx, timeline, frame, env, helpers, layout = layoutBlock) {
    const geo = geometry(timeline.size);
    const g = frame.graphic;
    const theme = themeOf(timeline);
    if (!g) { drawGround(ctx, geo, env, theme); return; }
    const tr = frame.transition;
    if (tr && tr.p < 0.5) {
      const from = tr.from;
      drawScene(ctx, from, timeline, { ...frame, shot: tr.fromShot || frame.shot }, env, helpers, sceneTimes(from, from.outMs - from.inMs), layout);
    } else {
      drawScene(ctx, g, timeline, frame, env, helpers, sceneTimes(g, g.local), layout);
    }
    if (tr) drawSlab(ctx, tr.p, geo, theme);
    drawCaption(ctx, frame, timeline, env);
  }

  // ─── Checks (references/checklist.md + brand.md "Banned") ──────────────
  const EMOJI = /\p{Extended_Pictographic}/u;
  const issue = (id, severity, message, fix = '', beat = '') => ({ id, severity, message, fix, beat });
  // Numbers as spoken: "7.5K" on screen when the VO says "7,500" is flagged.
  function numberTokens(text) {
    const out = [];
    const re = /(\$?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|k\b|m\b|b\b|thousand\b|million\b|billion\b)?/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const n = Number(m[2].replace(/,/g, ''));
      const unit = (m[3] || '').toLowerCase();
      const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[unit] || 1;
      out.push({ raw: m[0].trim(), value: Math.round(n * mult * 1000) / 1000, form: m[2] + (unit === '%' ? '%' : (mult > 1 ? unit[0] : '')) });
    }
    return out;
  }
  // The look's own checks: it is a real ES look, it passes validateLook with
  // this reel's team colour, and every word drawn has the contrast it needs
  // against what is under it (4.5:1 for reading text, 3:1 for accent and
  // signal display type; the kit's own paper pairings are left as they are).
  function lookChecks(timeline, { measure = null, layout = layoutBlock } = {}) {
    const out = [];
    const raw = timeline && timeline.look;
    const theme = themeOf(timeline);
    const name = theme.look.label;
    if (raw && !TH.LOOKS[raw]) out.push(issue('look', 'warning', `“${String(raw).slice(0, 24)}” is not an ES look, so this reel is drawn in Paper.`, 'Pick a look.'));
    TH.validateLook(theme.look, { team: theme.team }).forEach(msg => out.push(issue('look', 'critical', `The ${name} look breaks an ES rule (${msg})`, 'Pick another look.')));
    if (theme.teamMissing) out.push(issue('look', 'info', 'The Team colour look needs a team. This reel has none, so it is drawn in ES blue.', 'Pick a team, or another look.'));
    const graphics = (timeline.tracks && timeline.tracks.graphics) || [];
    const blocks = graphics.map(g => (g.data && g.data.block) || null).filter(Boolean);
    if (theme.id === 'data' && blocks.filter(b => ['number', 'dots', 'compare'].includes(b.type)).length < 2) out.push(issue('look', 'info', 'Data-led works best with at least two number, dots or compare scenes.', 'Add a figure, or pick another look.'));
    if (theme.id === 'photo') {
      const bare = graphics.filter(g => g.data && g.data.block && BLOCKS[g.data.block.type].media && !g.media);
      if (bare.length) out.push(issue('look', 'info', `Photo-led: ${bare.length === 1 ? 'one scene has' : `${bare.length} scenes have`} no photo yet.`, 'Add a photo to each hook and statement.', bare[0].beat));
    }
    if (measure) {
      graphics.forEach((g, i) => {
        const b = g.data && g.data.block;
        if (!b) return;
        const S = theme.surfaceFor(b.type);
        const ops = layout(measure, g, timeline);
        const media = ops.filter(o => o.type === 'media');
        const seen = new Set();
        ops.forEach(op => {
          if ((op.type !== 'text' && op.type !== 'count') || op.noCheck) return;
          const box = opBox(op);
          const onPhoto = !op.fill && media.some(mo => box.y + box.h > mo.y && box.y < mo.y + mo.h && box.x + box.w > mo.x && box.x < mo.x + mo.w);
          if (onPhoto) { if (!seen.has('photo')) out.push(issue('look', 'critical', `Beat ${i + 1}: “${String(op.text).slice(0, 24)}” sits on the photo without a box.`, 'Use boxed words over a photo.', g.beat)); seen.add('photo'); return; }
          const kit = !S.plate && ['paper', 'white'].includes(S.ground) && !op.fill && SIGNALS.includes(op.color);
          if (kit) return;
          const accent = SIGNALS.includes(op.color) || (!op.fill && op.color === (S.text.blue || 'blue') && op.color !== (S.text.ink || 'ink')) || ['blue', 'red'].includes(op.fill);
          const min = accent ? TH.ACCENT_MIN : TH.TEXT_MIN;
          let fg = colorOf(op.color, theme);
          const bg = colorOf(op.fill || S.ground, theme);
          if (op.alpha && op.alpha < 1) fg = TH.blend(fg, bg, op.alpha);
          const c = TH.contrast(fg, bg);
          const key = `${op.color}|${op.fill || S.ground}`;
          if (c < min && !seen.has(key)) { seen.add(key); out.push(issue('look', c < 2 ? 'critical' : 'warning', `Beat ${i + 1}: “${String(op.text).slice(0, 24)}” is ${op.color} on ${op.fill || S.ground} (${c.toFixed(1)}:1; it needs ${min}:1).`, 'Change the colour of the words, or pick another look.', g.beat)); }
        });
      });
    }
    return out;
  }
  // timeline: an ES timeline (graphics carry data.block). opts: { boxes, measure, layout }
  function checks(timeline, { boxes = null, measure = null, layout = layoutBlock } = {}) {
    const out = [];
    const graphics = timeline.tracks.graphics || [];
    const label = i => `Beat ${i + 1}`;
    // Safe frame.
    if (Array.isArray(boxes)) {
      const seen = new Set();
      boxes.filter(b => outsideSafe(b, timeline.size)).forEach(b => {
        const key = `${b.beat}:${b.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(issue('safe-frame', 'critical', `“${String(b.text || b.role).slice(0, 24)}” is outside the safe frame (no words above y 300, within 40 px of the sides, or below y 1640).`, 'Shorten the words or pick a smaller block.', b.beat));
      });
    }
    graphics.forEach((g, i) => {
      const b = g.data.block;
      const beat = timeline.beats[i] || {};
      if (!b) return;
      // Signal colours.
      const sig = signalsIn(b, beat.vo);
      if (sig.length > LIMITS.signalsPerBeat) out.push(issue('signals', 'critical', `${label(i)} uses ${sig.length} signal colours (${sig.join(', ')}). Two at most: if everything is highlighted, nothing is.`, 'Keep green and red for meaning; drop one.', g.beat));
      (b.lines || []).forEach(l => { if (l.color === 'yellow') out.push(issue('signals', 'warning', `${label(i)}: yellow is for caption emphasis only.`, 'Use ink, blue, green or red for the line.', g.beat)); });
      // Copy lengths.
      (b.pills || []).forEach(p => { if (p.text.length > LIMITS.pillChars && !(p.size && p.size <= 110)) out.push(issue('copy', 'warning', `${label(i)}: the pill “${p.text.slice(0, 24)}” is ${p.text.length} characters. Keep pills to about ${LIMITS.pillChars}.`, 'Shorten it, or split it into two pills.', g.beat)); });
      if (b.type === 'hook' && !(b.pills || []).length) out.push(issue('copy', 'critical', `${label(i)}: the hook has no pills.`, 'Add one to three short pills that state the tension.', g.beat));
      if (b.type === 'statement') {
        if (!(b.lines || []).length) out.push(issue('copy', 'critical', `${label(i)}: the statement has no lines.`, 'Add one to three short lines.', g.beat));
        if ((b.lines || []).length > LIMITS.lines) out.push(issue('copy', 'warning', `${label(i)}: ${b.lines.length} lines. A statement has 1 to 3.`, 'Cut a line, or make it two scenes.', g.beat));
        (b.lines || []).forEach(l => { if (l.text.length > LIMITS.lineChars) out.push(issue('copy', 'warning', `${label(i)}: the line “${l.text.slice(0, 24)}” is ${l.text.length} characters. Keep lines under ${LIMITS.lineChars}.`, 'Shorten it or split it.', g.beat)); });
      }
      if (b.type === 'quote') {
        if (b.text.length > LIMITS.quoteChars) out.push(issue('copy', 'warning', `${label(i)}: the quote is ${b.text.length} characters. Keep it under ${LIMITS.quoteChars}.`, 'Use the strongest part of what they said, word for word.', g.beat));
        if (!b.who) out.push(issue('copy', 'warning', `${label(i)}: the quote doesn't say who said it.`, 'Add the speaker under “Who”.', g.beat));
      }
      if (b.type === 'compare' && ((b.items || []).length < LIMITS.compareMin || (b.items || []).length > LIMITS.compareMax)) out.push(issue('copy', 'warning', `${label(i)}: compare shows ${(b.items || []).length} items. Use 2 to 4.`, 'Add or remove an item.', g.beat));
      if (b.type === 'dots' && b.count > LIMITS.dotsMax) out.push(issue('copy', 'warning', `${label(i)}: ${b.count.toLocaleString('en-US')} dots. The block draws up to ${LIMITS.dotsMax.toLocaleString('en-US')}.`, 'Show the scale another way (a number block), or a smaller share.', g.beat));
      if (b.type === 'number' && String(Math.round(Math.abs(b.value))).length > LIMITS.digits) out.push(issue('copy', 'warning', `${label(i)}: the number has more than ${LIMITS.digits} digits.`, 'Use M or K, as the voiceover says it.', g.beat));
      // Numbers as spoken.
      if (b.type !== 'endcard' && beat.vo) {
        const said = numberTokens(plainVo(beat.vo));
        const shown = blockStrings(b).flatMap(numberTokens);
        shown.forEach(n => {
          if (!said.length) return;
          const same = said.find(s => Math.abs(s.value - n.value) < 1e-9);
          if (!same) out.push(issue('as-spoken', 'warning', `${label(i)} shows ${n.raw}, but the voiceover doesn't say it.`, 'Show numbers exactly as the voiceover says them.', g.beat));
          else if (same.form.replace(/,/g, '') !== n.form.replace(/,/g, '') || (/,/.test(same.raw) !== /,/.test(n.raw) && n.value >= 10000)) out.push(issue('as-spoken', 'warning', `${label(i)} shows ${n.raw}; the voiceover says ${same.raw}.`, `Show it as “${same.raw}”.`, g.beat));
        });
      }
      // Banned: emoji in on-screen words.
      if (blockStrings(b).some(t => EMOJI.test(t))) out.push(issue('banned', 'critical', `${label(i)} has an emoji on screen. The ES system never uses emoji.`, 'Remove it.', g.beat));
    });
    // End card: present, last, with a source.
    const ends = graphics.map((g, i) => (g.data.block && g.data.block.type === 'endcard' ? i : -1)).filter(i => i >= 0);
    if (!ends.length) out.push(issue('endcard', 'critical', 'The reel has no end card.', 'The ES end card closes every reel (it is added for you when you rebuild).'));
    else if (ends[ends.length - 1] !== graphics.length - 1 || ends.length > 1) out.push(issue('endcard', 'critical', 'The end card is not the last scene.', 'Move the end card to the end.', graphics[ends[0]].beat));
    else {
      const e = graphics[ends[0]];
      if (Math.abs(e.outMs - e.inMs - LIMITS.endcardMs) > 40) out.push(issue('endcard', 'warning', 'The reel should end 3 s after the end card starts.', 'Rebuild the reel.', e.beat));
    }
    if (!String(timeline.sourceLine || '').trim()) out.push(issue('source', 'critical', 'The end card has no source line.', 'Every claim has a source: add it on the end card (for example “Source: ESPN”).', ends.length ? graphics[ends[0]].beat : ''));
    // Frame one says something.
    const g0 = graphics[0];
    if (!g0 || g0.inMs > 0 || !g0.data.block || !blockStrings(g0.data.block).filter(t => !/^(?:WE BRING|THE RECEIPTS\.)$/i.test(t)).length || g0.data.block.type === 'endcard') {
      out.push(issue('frame-one', 'critical', 'Frame one is empty. It must already say something.', 'Give the hook one to three pills.', g0 ? g0.beat : ''));
    } else if (g0.data.block.type !== 'hook') out.push(issue('frame-one', 'warning', 'The reel does not open on a hook block.', 'Make beat 1 a hook.', g0.beat));
    else if (g0.media) out.push(issue('frame-one', 'info', 'Frame one has a photo: check it shows who it is (face, number or jersey).', '', g0.beat));
    // Banned drawing: left-edge accent stripes, gradients or glow on text.
    if (measure) {
      graphics.forEach((g, i) => {
        const ops = layout(measure, g, timeline);
        if (ops.some(o => (o.type === 'rect' || o.type === 'panel' || (o.type === 'bar' && o.role !== 'bar')) && o.x <= 120 && o.w <= 24 && o.h >= 60)) out.push(issue('banned', 'critical', `${label(i)} has a left-edge accent stripe.`, 'Remove the stripe: premium comes from flat 2D motion.', g.beat));
        if (ops.some(o => o.glow || o.gradient || o.shadow)) out.push(issue('banned', 'critical', `${label(i)} has glow or a gradient on text.`, 'Flat colour only.', g.beat));
      });
    }
    // The look: on brand and readable.
    out.push(...lookChecks(timeline, { measure, layout }));
    return out;
  }
  // The system's checklist, one row per rule, for the Quality checks panel.
  const CHECKLIST = [
    { id: 'safe-frame', ok: 'Safe frame', bad: 'Words outside the safe frame' },
    { id: 'frame-one', ok: 'Frame one says something', bad: 'Frame one' },
    { id: 'signals', ok: 'Two signal colours at most', bad: 'Signal colours' },
    { id: 'copy', ok: 'Pills, lines and quotes short', bad: 'Copy length' },
    { id: 'as-spoken', ok: 'Numbers as spoken', bad: 'Numbers as spoken' },
    { id: 'endcard', ok: 'End card last, 3 s', bad: 'End card' },
    { id: 'source', ok: 'Source on the end card', bad: 'Source missing' },
    { id: 'banned', ok: 'No emoji, stripes or glow', bad: 'Banned item' },
    { id: 'look', ok: 'Look on brand and readable', bad: 'Look' },
  ];
  function checklist(issues) {
    return CHECKLIST.map(row => {
      const hits = (issues || []).filter(i => i.id === row.id && i.severity !== 'info');
      return { id: row.id, ok: !hits.length, label: hits.length ? row.bad : row.ok, n: hits.length, severity: hits.some(h => h.severity === 'critical') ? 'critical' : (hits.length ? 'warning' : '') };
    });
  }

  // ─── Guidelines (plain English, for the help panel) ────────────────────
  const GUIDELINES = [
    { title: 'Your script, your words', items: ['You bring the script and the voiceover. Reels Studio splits your words into scenes and never rewrites them.', 'With no voiceover yet, scenes are timed at about 2.6 words a second. Those times are estimates until the voice is recorded.'] },
    { title: 'Seven blocks', items: ['Hook: the first 3 to 6 seconds, two or three pills, readable at frame one. An optional one-word stamp slams in.', 'Statement: 1 to 3 short lines. Number: one number that counts up. Dots: scale, up to 2,600 dots. Compare: 2 to 4 bars. Quote: the exact words and who said them.', 'End card: always last. "We bring the receipts", the ES logotype and the source line. The reel ends 3 seconds later.'] },
    { title: 'Colour and type', items: ['ES blue, ink and paper. Green, red and yellow only mean something (win, loss, emphasis), and never more than two in one scene.', 'Condensed black capitals for display, Roboto for small text. Boxed words hug their letters.'] },
    { title: 'Layout', items: ['No words above y 300, within 40 px of the sides, or below y 1640. Turn on Safe zones to see the frame.', 'Captions sit on one line at y 1172, cut on 1 to 3 words at a time. Wrap a word in *asterisks* in the voiceover to make it yellow.', 'The ES mark sits top right on the hook and the end card only. The logotype is on the end card only. Never the round ES icon.'] },
    { title: 'Motion', items: ['Entrances take 0.35 to 0.45 s, from the left or from below. Every cut is the blue-then-ink slab wipe.', 'Photos drift slowly. No spins, bounces, 3D, glow, gradients on text, left-edge stripes or emoji.'] },
    { title: 'Before you post', items: ['Numbers on screen exactly as the voiceover says them. Every claim has a source on the end card.', 'Export the MP4 here: it renders in your browser at 1080x1920, 30 fps, with your voiceover.'] },
  ];

  return {
    TOKENS, SIGNALS, COLOR_NAMES, TYPE, MOTION, LIMITS, DEFAULT_CTA, GEO, BLOCKS, BLOCK_TYPES, KIND_FOR, BLOCK_FOR_KIND, TEMPLATES, MARK_BLOCKS, GUIDELINES, CHECKLIST,
    // Looks (reel-es-themes.js)
    LOOKS: TH.LOOKS, LOOK_IDS: TH.LOOK_IDS, DEFAULT_LOOK: TH.DEFAULT_LOOK, LOOK_LAYOUTS: TH.LAYOUTS, LOOK_MOTIONS: TH.MOTIONS, themes: TH,
    themeOf, validateLook: TH.validateLook, lookForStyle: TH.lookForStyle, inkOn, drawGround, drawPaper, markVariantFor, lookChecks,
    ease, geometry, displayFont, smallFont, colorOf, splitLines, fitLines, cleanBlock, blockOf, takesMedia, numberDisplay, blockStrings, blockText, legacyFields, signalsIn,
    parseEmphasis, plainVo, headline, scriptSentences, splitLong, blockForLine, scriptToPlan, voMatchesScript,
    hugBox, rotatedBox, layoutBlock, layoutCaption, textBoxes, outsideSafe, markRect, numberTokens,
    enterState, sceneTimes, slabs, drawSlab, drawMark, drawCaption, drawFrame, drawScene, checks, checklist,
  };
}));
