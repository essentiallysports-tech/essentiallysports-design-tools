#!/usr/bin/env node
// Generate's brand checker (netlify/functions/_lint-spec.js) and the letter
// widths it measures with (_glyph-widths.js).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { measure } = require('../netlify/functions/_glyph-widths.js');
const { lintSpec, applyPatch, numberTokens, findTeam, findSport } = require('../netlify/functions/_lint-spec.js');

// 1. Letter widths match the browser (real widths per 1000px, measured
//    2026-11-15 with the editor's canvas font strings) within 4%.
const BROWSER = {
  post: [['CAN ANYONE STOP MAHOMES?', 11195], ['WARRIORS\' $40M GAMBLE', 9591], ['STATEMENT MADE', 6579], ['NO ONE CAN STOP HER', 8202], ['LEBRON JAMES EXPLAINS WHY', 11189], ['1,120', 1675]],
  condensed: [['CAN ANYONE STOP MAHOMES?', 10989], ['WE ARE NOT DONE YET', 8077], ['Top 3 Rushing Yards This Season', 11793]],
};
for (const [font, cases] of Object.entries(BROWSER)) {
  for (const [text, real] of cases) {
    const ratio = measure(text, font, 1000) / real;
    assert.ok(ratio > 0.96 && ratio < 1.04, `${font} "${text}" estimate within 4% (got ${ratio.toFixed(3)})`);
  }
}

// 2. Numbers are compared the way people write them.
assert.deepEqual(numberTokens('1,120 yards, .312 avg, 40% and 3rd'), ['1120', '0.312', '40', '3']);

// 3. Teams and sports come from the brand kit.
assert.equal(findSport('NCAAF'), 'CFB');
assert.equal(findSport('nfl'), 'NFL');
assert.ok(findTeam('NFL', 'Kansas City Chiefs'), 'a full team name matches its kit entry');
assert.equal(findTeam('NFL', 'Springfield Atoms'), '', 'a made-up team matches nothing');

const brief = 'Mahomes after the Chiefs win: "We are not done yet." 320 YDS, 3 TD, 1 INT';
const corpus = 'Patrick Mahomes threw for 320 yards and 3 touchdowns as Kansas City beat Denver 27-17. "We just keep fighting," he said.';
const ctx = () => ({ brief, corpus, leads: new Set() });
const codes = result => result.errors.map(issue => issue.code);

const stats = (values, extra = {}) => ({
  postType: 'stats-single-ent', sport: 'NFL', team: 'Kansas City Chiefs',
  fields: { headline: 'Mahomes Delivers', stats: values.map(([value, label]) => ({ value, label })) },
  lines: ['Mahomes Delivers'], ...extra,
});

// 4. Real numbers pass; an invented one is an error.
assert.equal(lintSpec(stats([['320', 'YDS'], ['3', 'TD'], ['1', 'INT']]), ctx()).ok, true);
assert.deepEqual(codes(lintSpec(stats([['412', 'YDS'], ['3', 'TD'], ['1', 'INT']]), ctx())), ['unsourced-number']);

// 5. Quotes must be someone's real words (brief or deep in the research).
const quote = lines => ({ postType: 'quote', sport: 'NFL', team: 'Kansas City Chiefs', fields: { lines }, lines });
assert.equal(lintSpec(quote(['We Are Not', 'Done Yet']), ctx()).ok, true, 'quote from the brief');
assert.equal(lintSpec(quote(['We Just Keep', 'Fighting']), ctx()).ok, true, 'quote found in the research body');
assert.deepEqual(codes(lintSpec(quote(['We Run', 'This League']), ctx())), ['unsourced-quote']);

// 6. Pixel fit: a pill that would shrink below the ES minimum is too long.
const cover = (pills, extra = {}) => ({ postType: 'cover', sport: 'NFL', team: 'Kansas City Chiefs', fields: { pills }, lines: pills, ...extra });
assert.equal(lintSpec(cover(['Can Anyone', 'Stop Mahomes?']), ctx()).ok, true);
assert.ok(codes(lintSpec(cover(['Mahomes Masterclass Again']), ctx())).includes('too-long'));

// 7. Banned words and patterns.
assert.ok(codes(lintSpec(cover(['Shocking Win']), ctx())).includes('banned'), 'hype word');
assert.ok(codes(lintSpec(cover(['Mahomes Mode', '#ChiefsKingdom']), ctx())).includes('banned'), 'hashtag');
assert.ok(codes(lintSpec(cover(['What A Win!!']), ctx())).includes('banned'), 'repeated punctuation');

// 8. No two cards lead with the same line.
const leads = new Set();
const first = lintSpec(cover(['Can Anyone', 'Stop Mahomes?']), { brief, corpus, leads });
leads.add(first.lead);
assert.deepEqual(codes(lintSpec(cover(['Can Anyone', 'Stop Mahomes?']), { brief, corpus, leads })), ['duplicate']);

// 9. Unknown team: cleared (warning), so no colours are guessed from it.
const unknown = lintSpec(cover(['Can Anyone', 'Stop Them?'], { sport: 'NCAAF', team: 'Springfield Atoms' }), ctx());
assert.equal(unknown.ok, true);
assert.deepEqual(unknown.patch, { sport: 'CFB', team: '' });
assert.ok(unknown.warnings.some(w => w.code === 'unknown-team'));
const patched = applyPatch(cover(['X']), unknown.patch);
assert.equal(patched.team, '');
assert.equal(patched.sport, 'CFB');

// 10. A real team stays exactly as written.
assert.equal(lintSpec(cover(['Can Anyone', 'Stop Mahomes?']), ctx()).patch.team, undefined);

console.log('Brand checker tests passed.');
