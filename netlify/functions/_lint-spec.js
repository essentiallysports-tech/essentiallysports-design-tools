'use strict';
// Generate's brand checker. Runs on every design the AI writes, after the
// template's character limits (checkFields) have passed.
//
//   errors   -> the design is sent back for one targeted repair; if it still
//               fails it is dropped (never shown with invented facts or text
//               that will not fit).
//   warnings -> shown to the designer, design kept.
//   patch    -> safe automatic fixes (team spelled the brand kit's way, or
//               cleared when it is not a real team, so the editor never guesses
//               colours from a wrong name).
//
// Rules live in frameup-rules.js; letter widths in _glyph-widths.js.
const RULES = require('../../frameup-rules.js');
const BRAND_KIT = require('../../brand-kit.js');
const { fitSize, fitWrapped } = require('./_glyph-widths.js');

const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;
const norm = text => String(text || '').trim().toLowerCase();
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Numbers ───────────────────────────────────────────────────────────────
// "1,120" = "1120", ".312" = "0.312", "40%" = "40", "3rd" = "3".
const numberTokens = text => (String(text || '').match(/\d[\d,]*(?:\.\d+)?|\.\d+/g) || [])
  .map(token => token.replace(/,/g, '').replace(/^\./, '0.').replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));

// Numbers inside real team names ("76ers", "49ers") are never invented.
const TEAM_NUMBERS = new Set(BRAND_KIT.flatMap(entry => numberTokens(entry.team || entry.variation || '')));

// ─── Teams ─────────────────────────────────────────────────────────────────
const SPORTS = [...new Set(BRAND_KIT.map(entry => entry.sport))];
const SPORT_ALIASES = {
  ncaaf: 'CFB', 'college football': 'CFB', 'ncaa football': 'CFB',
  ncaab: 'CBB Men', 'college basketball': 'CBB Men', "men's college basketball": 'CBB Men', 'ncaa basketball': 'CBB Men',
  "women's college basketball": 'CBB Women', ncaaw: 'CBB Women',
  unrivaled: 'WNBA Unrivaled', pga: 'Golf', 'pga tour': 'Golf', liv: 'Golf', atp: 'Tennis', wta: 'Tennis',
};
const teamsFor = sport => BRAND_KIT.filter(entry => entry.sport === sport).map(entry => entry.variation || entry.team).filter(Boolean);
const hasWords = (text, words) => new RegExp(`\\b${escapeRe(words)}s?\\b`, 'i').test(text);

function findSport(value) {
  const wanted = norm(value);
  if (!wanted) return '';
  return SPORTS.find(sport => norm(sport) === wanted) || SPORT_ALIASES[wanted] || '';
}

// Same matching as the editor (frameup-spec.js findOption): exact name first,
// then whole-word ("Chiefs" -> "Kansas City Chiefs").
function findTeam(sport, value) {
  const wanted = norm(value);
  if (!wanted) return '';
  const pool = sport ? teamsFor(sport) : SPORTS.flatMap(teamsFor);
  return pool.find(team => norm(team) === wanted)
    || pool.find(team => hasWords(wanted, norm(team)) || hasWords(norm(team), wanted))
    || '';
}

// ─── The text on a design ──────────────────────────────────────────────────
function textFields(spec) {
  const f = spec.fields || {};
  switch (spec.postType) {
    case 'cover': return (f.pills || []).map((text, i) => ({ field: `pill ${i + 1}`, text }));
    case 'quote': return (f.lines || []).map((text, i) => ({ field: `line ${i + 1}`, text }));
    case 'long-quote': return [{ field: 'quote', text: f.text }];
    case 'double-entity-quote': return ['a', 'b'].flatMap(side => [
      { field: `${side}.quote`, text: f[side]?.quote },
      { field: `${side}.name`, text: f[side]?.name },
      { field: `${side}.context`, text: f[side]?.context },
    ]);
    case 'stats-single-ent': return [{ field: 'headline', text: f.headline }, ...(f.stats || []).flatMap((s, i) => [
      { field: `stat ${i + 1} value`, text: s.value }, { field: `stat ${i + 1} label`, text: s.label },
    ])];
    case 'stats-double-ent': return [{ field: 'headline', text: f.headline }, ...['a', 'b'].flatMap(side => [
      { field: `${side}.name`, text: f[side]?.name },
      ...(f[side]?.stats || []).flatMap((s, i) => [{ field: `${side} stat ${i + 1} value`, text: s.value }, { field: `${side} stat ${i + 1} label`, text: s.label }]),
    ])];
    case 'listicle-type-1':
    case 'listicle-type-2': return [
      { field: 'title', text: f.title },
      ...['entityHeader', 'metric1Header', 'metric2Header'].filter(key => f[key]).map(key => ({ field: key, text: f[key] })),
      ...(f.rows || []).flatMap((row, i) => [
        { field: `row ${i + 1} name`, text: row.entity },
        ...(row.metric1 ? [{ field: `row ${i + 1} value 1`, text: row.metric1 }] : []),
        ...(row.metric2 ? [{ field: `row ${i + 1} value 2`, text: row.metric2 }] : []),
        ...(row.subtitle ? [{ field: `row ${i + 1} subtitle`, text: row.subtitle }] : []),
      ]),
    ];
    default: return (spec.lines || []).map((text, i) => ({ field: `line ${i + 1}`, text }));
  }
}

const leadLine = spec => squash(spec.lines?.[0] || spec.listicle?.title || '').trim();

// ─── Fit (pixels, not characters) ──────────────────────────────────────────
function fitIssues(spec) {
  const box = RULES.FIT[spec.postType];
  if (!box) return [];
  const issues = [];
  const tooSmall = (field, text, rule, shownAt) => issues.push({
    field,
    code: 'too-long',
    msg: `"${text}" is too long for the ${field} (it would shrink to ${Math.round(shownAt)}px, smaller than ES posts allow)`,
    fix: `shorten the ${field} to about ${Math.max(2, Math.floor([...String(text)].length * (shownAt / rule.minSize) * 0.95))} characters, or split it`,
  });
  const line = (field, text, rule) => {
    const shown = rule.upper ? String(text || '').toUpperCase() : String(text || '');
    if (!shown.trim()) return;
    const size = fitSize(shown, rule);
    if (size < rule.minSize) tooSmall(field, text, rule, size);
  };
  const wrapped = (field, text, rule) => {
    const shown = rule.upper ? String(text || '').toUpperCase() : String(text || '');
    if (!shown.trim()) return;
    const { size, fits } = fitWrapped(shown, rule);
    if (!fits) tooSmall(field, text, rule, size * 0.9);
  };
  const f = spec.fields || {};
  switch (spec.postType) {
    case 'cover': (f.pills || []).forEach((p, i) => line(`pill ${i + 1}`, p, box.pill)); break;
    case 'quote': (f.lines || []).forEach((l, i) => line(`line ${i + 1}`, l, box.line)); break;
    case 'long-quote': wrapped('quote', f.text, box.text); break;
    case 'double-entity-quote':
      ['a', 'b'].forEach(side => { wrapped(`${side}.quote`, f[side]?.quote, box.quote); line(`${side}.name`, f[side]?.name, box.name); });
      break;
    case 'stats-single-ent':
      line('headline', f.headline, box.headline);
      (f.stats || []).forEach((s, i) => { line(`stat ${i + 1} value`, s.value, box.value); line(`stat ${i + 1} label`, s.label, box.label); });
      break;
    case 'stats-double-ent':
      line('headline', f.headline, box.headline);
      // The surname is the big line; the first name sits small above it.
      ['a', 'b'].forEach(side => {
        const name = String(f[side]?.name || '').trim().split(/\s+/);
        line(`${side}.name`, name.length > 1 ? name.slice(1).join(' ') : name[0], box.name);
      });
      break;
    default: break;
  }
  return issues;
}

// ─── The checker ───────────────────────────────────────────────────────────
// ctx: { brief, corpus, leads:Set (lead lines already used by other cards) }
function lintSpec(spec, ctx = {}) {
  const errors = [];
  const warnings = [];
  const patch = {};
  const fields = textFields(spec).filter(item => String(item.text || '').trim());

  // 1. Fits its box.
  errors.push(...fitIssues(spec));

  // 2. Banned words and patterns.
  fields.forEach(({ field, text }) => {
    const hit = RULES.BANNED.find(rule => rule.re.test(String(text)));
    if (hit) errors.push({ field, code: 'banned', msg: `"${text}" breaks the ES style (${hit.why})`, fix: 'rewrite without it' });
    else if (RULES.WEAK_WORDS.test(String(text))) warnings.push({ field, code: 'weak-word', msg: `"${text}" has a filler word`, fix: 'cut the filler word' });
  });

  // 3. Every number is real: it appears in the brief or the ES research.
  const known = new Set([...numberTokens(ctx.brief), ...numberTokens(ctx.corpus), ...TEAM_NUMBERS]);
  const rowCount = spec.listicle?.rows?.length || 0;
  fields.forEach(({ field, text }) => {
    numberTokens(text).forEach(number => {
      if (known.has(number)) return;
      // "Top 5 …" over a 5-row list is the list's own count.
      if (field === 'title' && rowCount && Number(number) === rowCount) return;
      errors.push({ field, code: 'unsourced-number', msg: `the number ${number} in "${text}" is not in the brief or the ES research`, fix: 'use only numbers from the brief or research, or remove it' });
    });
  });

  // 4. Quotes are real words someone said.
  const source = squash(`${ctx.brief || ''} ${ctx.corpus || ''}`);
  const quotes = spec.postType === 'quote' ? [{ field: 'quote', text: (spec.fields?.lines || []).join(' ') }]
    : spec.postType === 'long-quote' ? [{ field: 'quote', text: spec.fields?.text }]
      : spec.postType === 'double-entity-quote' ? ['a', 'b'].map(side => ({ field: `${side}.quote`, text: spec.fields?.[side]?.quote }))
        : [];
  quotes.forEach(({ field, text }) => {
    const words = squash(text);
    if (words.trim().length >= 4 && !source.includes(words)) {
      errors.push({ field, code: 'unsourced-quote', msg: `the quote "${text}" is not in the brief or the ES research`, fix: 'use exact words someone said (from the brief or research), or choose another template' });
    }
  });

  // 5. One card, one idea: no two cards lead with the same line.
  const lead = leadLine(spec);
  if (lead && ctx.leads?.has(lead)) errors.push({ field: 'headline', code: 'duplicate', msg: 'another design already leads with this line', fix: 'write a clearly different hook' });

  // 6. Hooks stay hooks (Cover: 2-10 words in all).
  if (spec.postType === 'cover') {
    const words = (spec.fields?.pills || []).join(' ').split(/\s+/).filter(Boolean).length;
    if (words > 10) warnings.push({ field: 'pills', code: 'long-hook', msg: `the Cover runs ${words} words; ES hooks are 2-8`, fix: 'tighten to one punchy claim or question' });
  }

  // 7. Team and sport are real brand-kit entries (they set the colours).
  const sport = findSport(spec.sport);
  if (spec.sport && !sport) {
    patch.sport = '';
    warnings.push({ field: 'sport', code: 'unknown-sport', msg: `"${spec.sport}" has no ES brand colours; the neutral ES look is used` });
  } else if (sport && sport !== spec.sport) {
    patch.sport = sport;
  }
  // A real team stays as written (the editor matches "Kansas City Chiefs" to the
  // kit's entry); a name that matches nothing is cleared so no colours are
  // guessed from it. A missing sport is filled from the team's kit entry.
  if (spec.team) {
    const team = findTeam(sport, spec.team) || (!sport ? '' : findTeam('', spec.team));
    if (!team) {
      patch.team = '';
      warnings.push({ field: 'team', code: 'unknown-team', msg: `"${spec.team}" is not in the ES brand kit; the team is left for the editor to confirm` });
    } else if (!sport) {
      const entry = BRAND_KIT.find(item => (item.variation || item.team) === team);
      if (entry) patch.sport = entry.sport;
    }
  }
  if (spec.listicle?.rows?.length) {
    const rows = spec.listicle.rows.map(row => {
      if (!row.team) return row;
      const known = findTeam(sport || patch.sport, row.team) || findTeam('', row.team);
      return known ? row : { ...row, team: '' };
    });
    if (rows.some((row, i) => row.team !== spec.listicle.rows[i].team)) patch.rows = rows;
  }

  return { ok: !errors.length, errors, warnings, patch, lead };
}

// Applies the safe automatic fixes from lintSpec to a spec (in place).
function applyPatch(spec, patch = {}) {
  if ('sport' in patch) spec.sport = patch.sport;
  if ('team' in patch) spec.team = patch.team;
  if (patch.rows && spec.listicle) {
    spec.listicle = { ...spec.listicle, rows: patch.rows };
    spec.fields = { ...spec.fields, rows: patch.rows };
  }
  return spec;
}

module.exports = { lintSpec, applyPatch, numberTokens, findTeam, findSport, textFields, fitIssues };
