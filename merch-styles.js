// Merch Designs: the style library (browser: window.MerchStyles; tests: require).
//
//   MerchStyles.STYLES                      -> [{ id, label, why, pro, make(base, ctx) -> concept | null }]
//   MerchStyles.expand(concepts, opts)      -> concepts: the AI concepts first (source 'ai'), then
//                                              the same words in named ES layouts (source 'style')
//                                              until there are at least opts.min unique designs.
//   MerchStyles.apply(styleId, base, opts)  -> one styled concept (or null)
//   MerchStyles.signature(concept)          -> the dedupe key (what the print would look like)
//   MerchStyles.prepare(base, opts)         -> the ctx a style reads (words, smalls, palette, tee...)
//
// opts: { mode: 'basic'|'pro', min: 20, max: 28, garment: '#hex' (the tee the person
// picked; default white), sport: 'tennis' | ..., teamPalette: { a, b, ink } (overrides),
// source: the brief text (numbers for the Pro number styles come only from here or
// the design's own rows), check: false to skip the print checks }.
//
// Owner (2026-11-28): "I need minimum 20 different styles here". The styles only use
// what the print engine draws (merch-print.js): ES pill rows (big | mid | small),
// fill / ink keys, left | center, fit { scale, topIn }, the garment, and for Pro the
// elements (number, rule, block, icon). No AI, no cost. Every design goes through
// MerchPrint.checks on its own tee and is dropped on any print error. Basic never
// gets elements. Rows never change the words: the same line, other layouts.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? () => require('./merch-print.js') : () => root.MerchPrint || null);
  if (isNode) module.exports = api;
  else root.MerchStyles = api;
}(typeof self !== 'undefined' ? self : this, (getPrint) => {
  'use strict';

  const VERSION = '2026-11-28-styles1';
  const WHITE = '#FFFFFF';
  const BLACK_TEE = '#111111';
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
  const up = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const MP = () => getPrint();
  const contrast = (x, y) => MP().boxContrast(x, y);
  const isLightHex = c => contrast(c, '#000000') > contrast(c, WHITE);
  const TINY = new Set(['A', 'AN', 'THE', 'OF', 'IN', 'ON', 'AT', 'TO', 'FOR', 'AND', 'OR', 'BY', 'IS', 'IT', 'MY', 'NO', 'SO', 'WE', 'I', 'ME', 'US']);
  const bare = w => w.replace(/[^A-Z0-9]/g, '');

  // Sport -> the engine's own icon (original shapes, never a league mark).
  const SPORT_ICONS = [
    [/basketball|\bnba\b|wnba|hoops/i, 'basketball'], [/football|\bnfl\b|quarterback|touchdown/i, 'football'], [/baseball|\bmlb\b|home run|pitcher/i, 'baseball'],
    [/soccer|\bmls\b|premier league|\bgoal\b/i, 'soccer'], [/hockey|\bnhl\b|puck/i, 'hockey'], [/golf|\bpga\b|masters|birdie/i, 'golf'],
    [/tennis|wimbledon|grand slam|\batp\b|\bwta\b/i, 'tennis'], [/\bf1\b|formula|nascar|racing|grand prix|indycar/i, 'racing-flag'],
  ];
  function sportIcon(...texts) {
    const t = texts.filter(Boolean).join(' ');
    const hit = SPORT_ICONS.find(([re]) => re.test(t));
    return hit ? hit[1] : 'star';
  }

  // ─── Splitting words into rows ─────────────────────────────────────────
  // Balanced rows by target weights (DP): weights [1, 1] = two equal rows,
  // [1, 2, 3] = a pyramid (each row longer than the last), [3, 2, 1] = a funnel.
  function partition(words, weights) {
    const n = words.length;
    const k = weights.length;
    if (n < k || k < 1 || n > 24) return null;
    const total = words.join(' ').length;
    const sumW = weights.reduce((s, w) => s + w, 0);
    const target = weights.map(w => (total * w) / sumW);
    const len = (i, j) => words.slice(i, j).join(' ').length;
    const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
    best[0][0] = 0;
    for (let r = 1; r <= k; r += 1) {
      for (let j = r; j <= n; j += 1) {
        for (let i = r - 1; i < j; i += 1) {
          if (best[r - 1][i] === Infinity) continue;
          const v = best[r - 1][i] + (len(i, j) - target[r - 1]) ** 2;
          if (v < best[r][j]) { best[r][j] = v; from[r][j] = i; }
        }
      }
    }
    const rows = [];
    let j = n;
    for (let r = k; r >= 1; r -= 1) { const i = from[r][j]; rows.unshift(words.slice(i, j).join(' ')); j = i; }
    return rows;
  }
  const isRamp = (rows, dir) => rows.every((r, i) => !i || (dir > 0 ? r.length > rows[i - 1].length : r.length < rows[i - 1].length));
  // Big rows longer than the engine's WRAP_AT (18) wrap into more pills, which
  // would break a shape: those styles skip that base instead.
  const fits = rows => rows.every(r => r.length <= ((MP() && MP().WRAP_AT) || 18));
  // Rows that grow (dir 1) or shrink (dir -1) every time: 4 rows, else 3, else 2.
  function ramp(units, dir) {
    for (let k = Math.min(4, units.length); k >= 2; k -= 1) {
      const rows = partition(units, Array.from({ length: k }, (_, i) => (dir > 0 ? i + 1 : k - i)));
      if (rows && isRamp(rows, dir) && fits(rows)) return rows;
    }
    return null;
  }

  // ─── ctx: everything a style needs from one base concept ───────────────
  function prepare(base = {}, opts = {}) {
    const P = MP();
    const pal = { ...P.teamPalette(base.team?.name), ...Object.fromEntries(Object.entries({ ...(base.palette || {}), ...(opts.teamPalette || {}) }).filter(([, v]) => hexOk(v)).map(([k, v]) => [k, v.toUpperCase()])) };
    const stack = (Array.isArray(base.stack) ? base.stack : []).filter(r => r && up(r.text));
    let smalls = stack.filter((r, i) => r.size === 'small' && i > 0).map(r => up(r.text));
    let text = stack.filter((r, i) => !(r.size === 'small' && i > 0)).map(r => up(r.text)).join(' ');
    // "… QUIT ME — DAVID FERRER": the attribution is its own small row, never a big pill.
    const by = text.match(/\s[—–-]\s*([A-Z][A-Z'’.-]*(?:\s+[A-Z][A-Z'’.-]*){0,3})$/);
    if (by && !smalls.length) { text = text.slice(0, by.index).trim(); smalls = [`— ${by[1]}`]; }
    // Units: one word each, tiny words ("I", "THE") riding with the next (never alone on a pill).
    const words = P.splitWords(text, 'word');
    const tee = hexOk(opts.garment) ? opts.garment.toUpperCase() : WHITE;
    const light = isLightHex(tee);
    const color = key => P.resolve(key, pal);
    // Text on a box: the palette's ink when it reads, else white or black.
    const inkFor = key => {
      const bg = color(key);
      if (key !== 'ink' && contrast(color('ink'), bg) >= 3) return 'ink';
      return contrast(WHITE, bg) >= contrast('#000000', bg) ? 'white' : 'black';
    };
    // The plain neutral pill for this tee (black on light, white on dark).
    const neutral = light ? 'black' : 'white';
    // An element colour that stands well off the tee (rules, icons, patches).
    const elColor = (need = 3) => ['a', 'b', light ? 'black' : 'white'].find(k => contrast(color(k), tee) >= need) || (light ? 'black' : 'white');
    const source = `${opts.source || ''} ${stack.map(r => r.text).join(' ')}`;
    const own = up(stack.map(r => r.text).join(' '));
    // A 1-2 digit number on the design itself (never one we make up).
    const numMatch = own.match(/(?:^|[^\d.,$#])(\d{1,2})(?![\d%]|[.,]\d)/);
    const strength = w => Math.max(...w.split(' ').filter(p => !TINY.has(bare(p))).map(p => bare(p).length), 0);
    const longest = words.map((w, i) => [w, i]).filter(([w]) => strength(w) > 0).sort((x, y) => strength(y[0]) - strength(x[0]) || x[1] - y[1])[0];
    const per = (mode) => {
      let rows = P.splitWords(text, mode);
      if (rows.length > 8 && mode === 'word') rows = P.splitWords(text, 'pair');
      if (rows.length > 8) rows = P.splitWords(text, 'line');
      return rows.length > 9 ? null : rows;
    };
    return {
      base, pal, tee, light, text, words, smalls, color, inkFor, neutral, elColor, per,
      number: numMatch ? numMatch[1] : '', hero: longest ? longest[1] : -1,
      icon: sportIcon(opts.sport, base.team?.name, source),
      mode: opts.mode === 'pro' ? 'pro' : 'basic',
    };
  }

  // ─── Row builders ──────────────────────────────────────────────────────
  const row = (ctx, text, size, fill, ink) => ({ text, size, fill, ink: ink || ctx.inkFor(fill) });
  const alt = (ctx, texts, keys = ['a', 'b'], size = 'big') => texts.map((t, i) => row(ctx, t, size, keys[i % keys.length]));
  const mono = (ctx, texts, fill, size = 'big', ink) => texts.map(t => row(ctx, t, size, fill, ink));
  const tail = (ctx, fill = 'b', size = 'small') => ctx.smalls.map(t => row(ctx, t, size, fill));
  // Long pills that stay whole: as long as the engine draws a big row without wrapping it.
  const longRows = x => MP().wrapText(x.text, MP().WRAP_AT || 18);
  const cap = rows => (rows && rows.length && rows.length <= 10 ? rows : null);
  const teamTee = ctx => ({ color: ctx.color('a'), name: MP().colorName(ctx.color('a')) });
  const plainTee = ctx => ({ color: ctx.tee, name: MP().colorName(ctx.tee) });

  // ─── The styles ────────────────────────────────────────────────────────
  // make(base, ctx) returns { stack, align, fit?, garment?, elements? } or null;
  // apply() turns that into a full concept. Labels are short (filmstrip, <= 16).
  const STYLES = [
    { id: 'stack', label: 'Stacked words', why: 'One word per pill, alternating the two colours.', make: (b, x) => ({ stack: cap([...alt(x, x.per('word') || []), ...tail(x)]), align: 'left' }) },
    { id: 'stagger', label: 'Centre stagger', why: 'Two words a pill, centred, so the edges step in and out.', make: (b, x) => ({ stack: cap([...alt(x, x.per('pair') || []), ...tail(x)]), align: 'center' }) },
    { id: 'headline', label: 'Big + mid', why: 'The first words big, the rest in mid pills under them.', make: (b, x) => {
      const rows = MP().splitWords(x.text, 'auto');
      const [first, ...rest] = rows.length > 1 ? rows : x.words;
      return rest.length ? { stack: cap([row(x, first, 'big', 'a'), ...rest.map((t, i) => row(x, t, 'mid', i % 2 ? 'a' : 'b')), ...tail(x)]), align: 'left' } : null;
    } },
    { id: 'banner', label: 'Wide banner', why: 'Long pills in one colour, like a headline across the chest.', make: (b, x) => ({ stack: cap([...mono(x, longRows(x), 'a'), ...tail(x)]), align: 'center' }) },
    { id: 'knockout', label: 'Team knockout', why: 'Team-colour tee with light pills; the shirt shows through the letters.', make: (b, x) => {
      if (contrast(x.color('a'), WHITE) < 1.3 || contrast(x.color('a'), '#000000') < 1.3) return null;
      return { stack: cap([...mono(x, x.per('word') || [], 'white', 'big', 'a'), ...x.smalls.map(t => row(x, t, 'small', 'white', 'a'))]), align: 'left', garment: teamTee(x) };
    } },
    { id: 'compact', label: 'Compact chest', why: 'Small and left-aligned, team colour and a plain pill: a neat chest print.', make: (b, x) => ({ stack: cap([...alt(x, x.per('pair') || [], ['a', x.neutral]), ...tail(x)]), align: 'left', fit: { scale: 0.7, topIn: null } }) },
    { id: 'bold', label: 'Bold & big', why: 'Bigger pills, one word each, centred, team colour and a plain pill.', make: (b, x) => ({ stack: cap([...alt(x, x.per('word') || [], ['a', x.neutral]), ...tail(x)]), align: 'center', fit: { scale: 1.35, topIn: null } }) },
    { id: 'lead-in', label: 'Lead-in', why: 'A mid pill leads in; the rest of the line lands big.', make: (b, x) => {
      if (x.words.length < 2) return null;
      const rest = MP().splitWords(x.words.slice(1).join(' '), x.words.length > 4 ? 'pair' : 'word');
      return { stack: cap([row(x, x.words[0], 'mid', 'b'), ...mono(x, rest, 'a'), ...tail(x)]), align: 'left' };
    } },
    { id: 'team-tee', label: 'Team tee', why: 'A team-colour tee with plain pills on it.', make: (b, x) => {
      const tee = x.color('a');
      const pill = isLightHex(tee) ? 'black' : 'white';
      if (contrast(tee, WHITE) < 1.3 || contrast(tee, '#000000') < 1.3) return null;
      return { stack: cap([...mono(x, x.per('pair') || [], pill, 'big', pill === 'white' ? 'black' : 'white'), ...x.smalls.map(t => row(x, t, 'small', pill, pill === 'white' ? 'black' : 'white'))]), align: 'center', garment: teamTee(x) };
    } },
    { id: 'pyramid', label: 'Pyramid', why: 'Each row longer than the last, centred: the line builds to its end.', make: (b, x) => {
      const rows = ramp(x.words, 1);
      return rows ? { stack: cap([...alt(x, rows), ...tail(x)]), align: 'center' } : null;
    } },
    { id: 'funnel', label: 'Funnel', why: 'Widest row first, narrowing down, in one colour.', make: (b, x) => {
      const rows = ramp(x.words, -1);
      return rows ? { stack: cap([...mono(x, rows, 'a'), ...tail(x)]), align: 'center' } : null;
    } },
    { id: 'three-tone', label: 'Three-tone', why: 'Three colours in turn: team, second colour, then a plain pill.', make: (b, x) => {
      const rows = x.per('word') || [];
      // Three colours that read as three (ES navy next to black does not).
      const keys = ['a', 'b', x.neutral];
      const onTee = k => MP().rowColors({ fill: k }, x.pal, x.tee, true).bg;
      if (keys.some((k, i) => keys.slice(i + 1).some(q => contrast(onTee(k), onTee(q)) < 1.8))) return null;
      return rows.length >= 3 ? { stack: cap([...rows.map((t, i) => row(x, t, 'big', keys[i % 3])), ...tail(x, 'a')]), align: 'left' } : null;
    } },
    { id: 'team-mono', label: 'Team mono', why: 'Every pill in the team colour; same-colour rows overlap like the ES editor.', make: (b, x) => ({ stack: cap([...mono(x, x.per('word') || [], 'a'), ...tail(x, 'a')]), align: 'left' }) },
    { id: 'mono-ink', label: 'Mono ink', why: 'One plain colour: black pills on a light tee, white on a dark one.', make: (b, x) => ({ stack: cap([...mono(x, x.per('pair') || [], x.neutral), ...tail(x, x.neutral)]), align: 'center' }) },
    { id: 'tee-swap', label: 'Dark tee', why: 'The other tee: black with team-colour and white pills (white tee when yours is dark).', make: (b, x) => {
      if (!x.light) return { label: 'White tee', why: 'The other tee: white, with the team colours.', stack: cap([...alt(x, x.per('pair') || []), ...tail(x)]), align: 'center', garment: { color: WHITE, name: 'White' } };
      if (contrast(x.color('a'), BLACK_TEE) < 1.7) return null;
      return { stack: cap([...(x.per('pair') || []).map((t, i) => (i % 2 ? row(x, t, 'big', 'white', 'a') : row(x, t, 'big', 'a'))), ...x.smalls.map(t => row(x, t, 'small', 'white', 'a'))]), align: 'center', garment: { color: BLACK_TEE, name: 'Black' } };
    } },
    { id: 'hero', label: 'Hero word', why: 'The strongest word big in the team colour; the rest in mid pills around it.', make: (b, x) => {
      if (x.words.length < 3 || x.hero < 0) return null;
      const before = x.words.slice(0, x.hero).join(' ');
      const after = x.words.slice(x.hero + 1).join(' ');
      const mids = t => (t ? MP().splitWords(t, 'line').map(s => row(x, s, 'mid', 'b')) : []);
      return { stack: cap([...mids(before), row(x, x.words[x.hero], 'big', 'a'), ...mids(after), ...tail(x)]), align: 'center' };
    } },
    { id: 'signed', label: 'Signed quote', why: 'The words in long pills, the name under them a size up.', make: (b, x) => (x.smalls.length ? { stack: cap([...mono(x, longRows(x), 'a'), ...x.smalls.map(t => row(x, t, 'mid', 'b'))]), align: 'left' } : null) },
    { id: 'name-first', label: 'Name first', why: 'The name leads in a big pill; the words follow in mid pills.', make: (b, x) => {
      if (!x.smalls.length) return null;
      const name = x.smalls[0].replace(/^[—–-]\s*/, '');
      return { stack: cap([row(x, name, 'big', 'a'), ...MP().splitWords(x.text, 'pair').map((t, i) => row(x, t, 'mid', i % 2 ? 'a' : 'b'))]), align: 'left' };
    } },
    { id: 'tower', label: 'Tower', why: 'One word a pill in the second colour, centred and tall.', make: (b, x) => ({ stack: cap([...mono(x, x.per('word') || [], 'b'), ...tail(x, 'a')]), align: 'center', fit: { scale: 1.15, topIn: null } }) },
    { id: 'pairs', label: 'Word pairs', why: 'Two words a pill, left-aligned, starting on the second colour.', make: (b, x) => ({ stack: cap([...alt(x, x.per('pair') || [], ['b', 'a']), ...tail(x, 'a')]), align: 'left' }) },
    { id: 'two-line', label: 'Two-line banner', why: 'The whole line in two balanced pills, centred.', make: (b, x) => {
      const rows = partition(x.words, [1, 1]);
      return rows && fits(rows) ? { stack: cap([...alt(x, rows), ...tail(x)]), align: 'center' } : null;
    } },
    { id: 'colour-pop', label: 'Colour pop', why: 'Plain pills with one word popped in the team colour.', make: (b, x) => {
      const rows = x.per('word') || [];
      const heroWord = x.hero >= 0 ? x.words[x.hero] : '';
      let hit = rows.findIndex(t => heroWord && t.split(' ').includes(heroWord));
      if (hit < 0) hit = rows.length - 1;
      return rows.length >= 2 ? { stack: cap([...rows.map((t, i) => row(x, t, 'big', i === hit ? 'a' : x.neutral)), ...tail(x, x.neutral)]), align: 'left' } : null;
    } },
    { id: 'pocket', label: 'Pocket print', why: 'Small and high, one colour: the quiet chest print.', make: (b, x) => ({ stack: cap([...mono(x, x.per('pair') || [], 'a'), ...tail(x, 'b', 'mid')]), align: 'left', fit: { scale: 0.6, topIn: 1 } }) },
    { id: 'back-print', label: 'Back print', why: 'Full size and high, built for the back of the shirt.', make: (b, x) => ({ stack: cap([...alt(x, x.per('word') || []), ...tail(x, 'b', 'mid')]), align: 'left', fit: { scale: 1.6, topIn: 1.5 } }) },
    { id: 'big-mid', label: 'Big / mid', why: 'Rows alternate big and mid, so the line has a rhythm.', make: (b, x) => {
      const rows = x.per('word') || [];
      return rows.length >= 2 ? { stack: cap([...rows.map((t, i) => row(x, t, i % 2 ? 'mid' : 'big', i % 2 ? 'b' : 'a')), ...tail(x)]), align: 'center' } : null;
    } },
    // ── Pro: the same pills plus one or two engine elements ──
    { id: 'number-behind', label: 'Number behind', pro: true, why: 'The number from the story, big and outlined behind the words.', make: (b, x) => (x.number ? { stack: cap([...alt(x, x.per('word') || []), ...tail(x)]), align: 'center', elements: [{ type: 'number', text: x.number, style: 'outline', color: x.elColor(3), position: 'behind' }] } : null) },
    { id: 'rule-frame', label: 'Rule frame', pro: true, why: 'Thick bars above and below frame the stack.', make: (b, x) => ({ stack: cap([...mono(x, MP().splitWords(x.text, 'auto'), 'a'), ...tail(x)]), align: 'center', elements: [{ type: 'rule', position: 'above', color: x.elColor(), weight: 'thick' }, { type: 'rule', position: 'below', color: x.elColor(), weight: 'thick' }] }) },
    { id: 'icon-top', label: 'Icon on top', pro: true, why: 'A simple sport icon crowns the stack.', make: (b, x) => ({ stack: cap([...alt(x, x.per('word') || []), ...tail(x)]), align: 'center', elements: [{ type: 'icon', name: x.icon, position: 'above', color: x.elColor() }] }) },
    { id: 'patch', label: 'Patch', pro: true, why: 'A solid patch behind the stack, like a sewn-on badge.', make: (b, x) => {
      const block = x.elColor(1.7);
      const pill = x.neutral;
      if (contrast(x.color(block), x.color(pill)) < 2) return null;
      return { stack: cap([...mono(x, x.per('pair') || [], pill, 'big', block), ...x.smalls.map(t => row(x, t, 'small', pill, block))]), align: 'center', elements: [{ type: 'block', position: 'behind', color: block }] };
    } },
    { id: 'ticket', label: 'Ticket', pro: true, why: 'Headline, a bar, then the details in mid pills: like a ticket stub.', make: (b, x) => {
      const rows = MP().splitWords(x.text, 'auto');
      const [first, ...rest] = rows.length > 1 ? rows : x.words;
      return rest.length ? { stack: cap([row(x, first, 'big', 'a'), ...rest.map(t => row(x, t, 'mid', 'b')), ...tail(x, 'a')]), align: 'left', elements: [{ type: 'rule', position: 'between', color: x.elColor(), weight: 'thin' }] } : null;
    } },
    { id: 'number-top', label: 'Number on top', pro: true, why: 'The number from the story, solid, leading the stack.', make: (b, x) => (x.number ? { stack: cap([...mono(x, x.per('pair') || [], 'a'), ...tail(x)]), align: 'left', elements: [{ type: 'number', text: x.number, style: 'solid', color: x.elColor(), position: 'above' }] } : null) },
    { id: 'icon-badge', label: 'Icon badge', pro: true, why: 'The sport icon beside a one-colour stack.', make: (b, x) => ({ stack: cap([...mono(x, x.per('pair') || [], 'b'), ...tail(x, 'a')]), align: 'left', elements: [{ type: 'icon', name: x.icon, position: 'left', color: x.elColor() }] }) },
    { id: 'crowned', label: 'Crowned', pro: true, why: 'A crown above and a bar below: the champion look.', make: (b, x) => ({ stack: cap([...alt(x, x.per('pair') || [], ['a', x.neutral]), ...tail(x)]), align: 'center', elements: [{ type: 'icon', name: 'crown', position: 'above', color: x.elColor() }, { type: 'rule', position: 'below', color: x.elColor(), weight: 'thin' }] }) },
  ];
  const BY_ID = Object.fromEntries(STYLES.map(s => [s.id, s]));

  // ─── Dedupe: what the print would really look like ─────────────────────
  function signature(c = {}) {
    const P = MP();
    const pal = { ...P.teamPalette(c.team?.name), ...Object.fromEntries(Object.entries(c.palette || {}).filter(([, v]) => hexOk(v)).map(([k, v]) => [k, v.toUpperCase()])) };
    const tee = hexOk(c.garment?.color) ? c.garment.color.toUpperCase() : WHITE;
    const rows = P.rowsOf(c).map(r => { const k = P.rowColors(r.row, pal, tee, true); return [r.text, r.rel, k.bg, k.ink, k.knockout ? 1 : 0]; });
    const f = P.fitOf(c);
    const els = (c.mode === 'basic' ? [] : P.elementsOf(c)).map(e => [e.type, e.position, e.text || e.name || '', e.style || e.weight || '', P.resolve(e.color || 'a', pal)]).sort();
    // One row reads the same left or centred.
    return JSON.stringify([rows, rows.length > 1 && c.align === 'center' ? 'c' : 'l', f.scale, f.topIn, tee, els]);
  }
  // No print errors on the design's own tee (the engine's checks, tee print area).
  function printable(c) {
    const P = MP();
    if (!P.checks) return true;
    try {
      const spec = { ...P.DEFAULT_AREAS.tee, kind: 'tee', garmentColor: c.garment?.color || WHITE };
      return !P.checks({ ...c, blanks: ['tee', ...(c.blanks || []).filter(k => k !== 'tee')] }, spec).some(x => x.level === 'error');
    } catch { return false; }
  }

  function apply(styleId, base, opts = {}, ctx = null) {
    const s = typeof styleId === 'string' ? BY_ID[styleId] : styleId;
    if (!s || !base) return null;
    const mode = opts.mode === 'pro' ? 'pro' : 'basic';
    if (s.pro && mode !== 'pro') return null;
    const x = ctx || prepare(base, opts);
    if (!x.words.length) return null;
    let made = null;
    try { made = s.make(base, x); } catch { made = null; }
    if (!made || !made.stack || !made.stack.length) return null;
    const rootId = String(base.variantOf || base.id || 'c').replace(/-s-[a-z-]+$/, '');
    const out = {
      ...base, id: `${rootId}-s-${s.id}`, variantOf: base.variantOf || base.id, source: 'style', style: s.id, label: made.label || s.label, why: made.why || s.why,
      palette: { ...x.pal }, stack: made.stack, align: made.align || 'left', fit: made.fit || { scale: 1, topIn: null },
      garment: made.garment || plainTee(x), mode,
    };
    delete out.variant;
    if (mode === 'pro' && made.elements && made.elements.length) out.elements = made.elements; else delete out.elements;
    return out;
  }

  // Pro: an element style after every two pill styles, so extras show up
  // before max is reached; Basic: the pill styles only.
  function order(mode) {
    const plain = STYLES.filter(s => !s.pro);
    if (mode !== 'pro') return plain;
    const pro = STYLES.filter(s => s.pro);
    const out = [];
    plain.forEach((s, i) => { out.push(s); if (i % 2 === 1 && pro.length) out.push(pro.shift()); });
    return [...out, ...pro];
  }
  // The bases: the first three concepts that carry the person's words (core ES
  // lines only when nothing else came back).
  // A one-pill design ("32") is a weak base: it needs at least two words.
  function basesOf(list, n = 3, opts = {}) {
    const P = MP();
    const words = c => { try { return prepare(c, opts).words.length; } catch { return 0; } };
    const own = list.filter(c => c.collection !== 'core');
    const strong = own.filter(c => words(c) >= 2);
    return (strong.length ? strong : own.length ? own : list).slice(0, n).filter(() => P);
  }

  function expand(concepts, opts = {}) {
    const P = MP();
    const mode = opts.mode === 'pro' ? 'pro' : 'basic';
    const min = Number.isFinite(opts.min) ? opts.min : 20;
    const max = Math.max(min, Number.isFinite(opts.max) ? opts.max : 28);
    const list = (Array.isArray(concepts) ? concepts : []).filter(c => c && Array.isArray(c.stack) && c.stack.some(r => r && up(r.text)))
      .map(c => { const x = { ...c, source: c.source || 'ai' }; if (mode === 'basic') delete x.elements; return x; });
    if (!P || !P.layout) return list;
    const out = [];
    const seen = new Set();
    list.forEach(c => { let s = ''; try { s = signature(c); } catch { s = c.id; } if (!seen.has(s)) { seen.add(s); out.push(c); } });
    const bases = basesOf(list.filter(c => c.source !== 'style'), 3, { ...opts, mode });
    if (!bases.length) return out;
    const ctxs = bases.map(b => prepare(b, { ...opts, mode }));
    const styles = order(mode);
    const tried = new Set();
    const tryOne = (s, bi) => {
      const key = `${s.id}|${bi}`;
      if (tried.has(key)) return false;
      tried.add(key);
      const c = apply(s, bases[bi], { ...opts, mode }, ctxs[bi]);
      if (!c) return false;
      let sig;
      try { sig = signature(c); } catch { return false; }
      if (seen.has(sig) || (opts.check !== false && !printable(c))) return false;
      seen.add(sig);
      out.push(c);
      return true;
    };
    // Pass 1: every style once, round-robin over the bases (a style that can't
    // use its base tries the others). Later passes only run while under min.
    styles.forEach((s, i) => {
      if (out.length >= max) return;
      for (let k = 0; k < bases.length; k += 1) if (tryOne(s, (i + k) % bases.length)) break;
    });
    for (let pass = 1; pass < bases.length && out.length < min; pass += 1) {
      styles.forEach((s, i) => { if (out.length < max) tryOne(s, (i + pass) % bases.length); });
    }
    return out;
  }

  return { VERSION, STYLES, BY_ID, order, expand, apply, prepare, signature, printable, partition, sportIcon };
}));
