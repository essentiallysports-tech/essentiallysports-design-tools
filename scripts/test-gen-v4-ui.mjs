// Generate v4 UI (agent gen4-ui), offline, no network:
//   1. Focus view: idea chips are the full text (never cut mid-word), only
//      creative ideas are offered (repairs never), "Fixed while designing" line.
//   6. ETA: model by look / count / people, learned from past runs, honest
//      live progress when a run goes long.
//   7. Sources card markup and copy.
//   8. AI usage card: details popover with per tool, team, what counts, resets
//      and free mode.
//  10. Briefs from trends: a real brief (who, what, context, angle), never
//      "Story:" / "Sport:" lines, nothing invented, league kept beside it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const A = require(path.join(ROOT, 'generate-assistant.js'));
const { util: U } = require(path.join(ROOT, 'generate-focus.js'));
const L = require(path.join(ROOT, 'trends-logic.js'));
const H = require(path.join(ROOT, 'frameup-home-today.js'));
let passed = 0;
const ok = (name, fn) => { try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } };

// ── 1. Focus view ─────────────────────────────────────────────────────────
ok('chip labels are the whole suggestion', () => {
  const long = 'Try a versus layout: the Bills and the Chiefs side by side, with the 30-21 score between them as the one big number.';
  assert.equal(A.chipLabel({ text: long }), long.replace(/\.$/, ''));
  assert.ok(!A.chipLabel({ text: long }).startsWith('Apply:'));
});
ok('repairs are never ideas; creative ideas are', () => {
  const repairs = [
    'the washed-out trophy and gavel box is murky, irrelevant, and covers the headline',
    'no Manfred photo although he is named, and the MLB tag is tiny',
    'headline drops the colon after MANFRED, so it reads as one run-on',
    'manfred is named but this design shows no photo of them',
    'The number could be bigger',
    'Text overlaps the cut-out',
    { text: 'Brighter photo', fix: { op: 'fix', name: 'brighten-photo' } },
  ];
  repairs.forEach(r => assert.ok(A.isRepair(r), `repair: ${JSON.stringify(r)}`));
  const ideas = ['Try a versus layout with both owners', 'Lead with the 2028 date as one giant number', 'Swap to a darker, moodier treatment', 'Make it a quote card with the commissioner\'s words'];
  ideas.forEach(i => assert.ok(!A.isRepair(i), `idea: ${i}`));
});
ok('the review: autoFixed line + creative suggestions only', () => {
  const review = { autoFixed: ['Brighter photo', { what: 'Added the Manfred photo' }, 'Restored the colon.'], suggestions: ['Try a versus layout', { text: 'The MLB tag is tiny' }, { text: 'Lead with the number' }] };
  const n = A.normalizeReview(review);
  assert.equal(n.given, true);
  assert.deepEqual(n.autoFixed, ['Brighter photo', 'Added the Manfred photo', 'Restored the colon']);
  assert.deepEqual(n.suggestions.map(s => s.text), ['Try a versus layout', 'Lead with the number']);
  assert.equal(A.fixedLine(n.autoFixed), 'Brighter photo, added the Manfred photo and restored the colon.');
  assert.equal(A.fixedLine(['a', 'b', 'c', 'd', 'e', 'f']), 'A, b, c, d and 2 more.');
  assert.equal(A.fixedLine([]), '');
});
ok('reviewCritique: review wins; without one, repairs are filtered', () => {
  const dirCrit = { strengths: ['Big number reads at phone size'], improvements: [{ id: 'c1', text: 'Photo is murky', fix: { op: 'fix', name: 'brighten-photo' } }, { id: 'c2', text: 'Try a versus layout' }] };
  const withReview = A.reviewCritique(dirCrit, null, { fixApplied: 'more-contrast' }, { autoFixed: ['Brighter photo'], suggestions: [{ text: 'Try a timeline of the season' }] });
  assert.deepEqual(withReview.improvements.map(i => i.text), ['Try a timeline of the season']);
  assert.equal(withReview.improvements[0].fix.op, 'assist');
  assert.deepEqual(withReview.autoFixed, ['Brighter photo', 'more contrast'], 'the judge\'s in-code fix is listed as fixed');
  assert.equal(withReview.strengths[0], 'Big number reads at phone size');
  const legacy = A.reviewCritique(dirCrit, null, {});
  assert.deepEqual(legacy.improvements.map(i => i.text), ['Try a versus layout']);
  assert.equal(legacy.reviewed, false);
  // The focus view keeps a reviewed critique even with no ideas (no quick-check repairs).
  const kept = U.critiqueFor({ verdict: { critique: { strengths: [], improvements: [], nextTime: '', autoFixed: ['x'] } }, report: { heuristic: { issues: [{ fix: 'more-contrast', what: 'contrast 2:1' }] } } });
  assert.equal(kept.source, 'director');
  assert.equal(kept.improvements.length, 0);
});
ok('page wiring: chips wrap, no 60-character cut, fixed line in all three places', () => {
  const asst = fs.readFileSync(path.join(ROOT, 'generate-assistant.js'), 'utf8');
  assert.ok(!/clean\(item\.text, 60\)/.test(asst), 'the old 60-char cut is gone');
  assert.match(asst, /Fixed while designing:/);
  assert.match(asst, /white-space:normal/);
  assert.match(fs.readFileSync(path.join(ROOT, 'generate-creative.js'), 'utf8'), /reviewCritique\(dir\.critique, verdict\?\.critique, card\._scene, verdict\?\.review, dir\.review\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'generate-focus.js'), 'utf8'), /Fixed while designing:/);
});

// ── 6. ETA ────────────────────────────────────────────────────────────────
ok('ETA model and learning', () => {
  assert.ok(U.etaModel({ count: 8 }) > U.etaModel({ count: 1 }), 'more designs take longer');
  assert.ok(U.etaModel({ count: 4, people: true }) > U.etaModel({ count: 4, people: false }), 'photos + cut-outs take longer');
  assert.ok(U.etaModel({ look: 'templates', count: 4 }) < U.etaModel({ count: 4 }));
  assert.equal(U.etaEstimate([], { count: 4 }).learned, 0);
  let h = [];
  [112, 120, 115, 118].forEach(s => { h = U.etaRecord(h, { look: 'creative', count: 4, people: true, s }); });
  const est = U.etaEstimate(h, { look: 'creative', count: 4, people: true });
  assert.equal(est.learned, 4);
  assert.ok(est.seconds > 100 && est.seconds < 125, `learned slower runs (${est.seconds})`);
  assert.ok(U.etaEstimate(h, { look: 'creative', count: 1, people: false }).seconds > U.etaModel({ count: 1, people: false }), 'the learned ratio carries to other counts');
  assert.equal(U.etaRecord(h, { s: 2 }).length, 4, 'nonsense durations are ignored');
  for (let i = 0; i < 40; i += 1) h = U.etaRecord(h, { look: 'templates', count: 2, s: 20 });
  assert.equal(h.length, 30, 'keeps the last 30 runs');
});
ok('ETA labels and live progress are honest', () => {
  assert.equal(U.etaLabel(42), 'about 40 s');
  assert.equal(U.etaLabel(65), 'about 1 min 5 s');
  assert.equal(U.etaLabel(120), 'about 2 min');
  assert.equal(U.clock(75), '1:15');
  const early = U.etaProgress(10, 60);
  assert.equal(early.over, false);
  assert.match(early.text, /left$/);
  const late = U.etaProgress(90, 60);
  assert.equal(late.over, true);
  assert.match(late.text, /longer than usual/);
  assert.ok(late.pct < 100 && late.pct >= 90, 'the bar never claims done');
  assert.match(U.etaProgress(170, 60).text, /3 min/);
});

// ── 7. Sources card ───────────────────────────────────────────────────────
ok('sources card says what it is', () => {
  const html = fs.readFileSync(path.join(ROOT, 'generate.html'), 'utf8');
  assert.ok(!html.includes('<summary>Based on these ES stories</summary>'));
  assert.match(html, /The ES articles these facts and numbers came from\. Open one to check a fact before you publish\./);
  assert.match(html, /function sourceDate\(/);
  assert.match(html, /opens in a new tab/);
});

// ── 8. AI usage card ──────────────────────────────────────────────────────
ok('AI usage details: per tool, team, what counts, resets, free mode', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'app-shell.js'), 'utf8');
  ['Your AI this week', 'By tool', 'Everyone at ES', 'What counts', 'Resets', 'Free mode:', 'es-usage__mini'].forEach(t => assert.ok(shell.includes(t), t));
  assert.ok(!/ai\?\.admin && Number\.isFinite\(teamSpent\)/.test(shell), 'the team line is not admin-only (it is an aggregate)');
  const css = fs.readFileSync(path.join(ROOT, 'es-ui.css'), 'utf8');
  assert.match(css, /\.es-usage__pop \{[^}]*width: min\(320px/);
});

// ── 10. Briefs ────────────────────────────────────────────────────────────
ok('trend briefs are real briefs from the trend\'s own words', () => {
  const news = L.briefFor({ title: 'Josh Allen leads the Bills past the Chiefs', category: 'nfl', team: { name: 'Buffalo Bills' }, related: [{ title: 'Allen runs for 2 TDs in 30-21 win - ESPN', source: 'ESPN' }, { title: 'Josh Allen leads Bills past the Chiefs' }] }, { why: 'Buffalo finally beat Kansas City', sportLabel: 'NFL' });
  assert.equal(news, 'Josh Allen leads the Bills past the Chiefs.\nContext: Allen runs for 2 TDs in 30-21 win.\nWhy fans care: Buffalo finally beat Kansas City.');
  assert.ok(!/Sport:|Team:|Story:|ESPN/.test(news), 'no labels for sport / team, no outlet names');
  const team = L.briefFor({ title: 'Trade talks heat up before the deadline', category: 'nba', team: { name: 'Los Angeles Lakers' } });
  assert.equal(team, 'Los Angeles Lakers: Trade talks heat up before the deadline.', 'who leads when the headline does not name them');
  const search = L.briefFor({ type: 'search', title: 'Lebron James', category: 'nba', related: [{ title: 'LeBron James scores 40 as Lakers beat Suns 120-110' }, { title: 'Lakers end four-game skid' }] });
  assert.equal(search, 'LeBron James scores 40 as Lakers beat Suns 120-110.\nContext: Lakers end four-game skid.');
  // Never invented: every number in the brief is in the trend's own text.
  const digits = t => (t.match(/\d+/g) || []);
  assert.deepEqual(digits(search).filter(d => !'LeBron James scores 40 as Lakers beat Suns 120-110 Lakers end four-game skid'.includes(d)), []);
});
ok('old labelled briefs are tidied; the league goes beside the brief', () => {
  const t = L.tidyBrief('Story: Josh Allen leads the Bills past the Chiefs\nTeam: Buffalo Bills\nSport: NFL');
  assert.deepEqual(t, { text: 'Josh Allen leads the Bills past the Chiefs.', sport: 'NFL' });
  assert.deepEqual(L.tidyBrief('Caitlin Clark scores 30 PTS'), { text: 'Caitlin Clark scores 30 PTS', sport: '' }, 'own words are kept as written');
  assert.equal(L.withSport('Patrick Mahomes after the win', 'NFL'), 'Patrick Mahomes after the win\nSport: NFL');
  assert.equal(L.withSport('Brief\nSport: NBA', 'NFL'), 'Brief\nSport: NBA', 'a Sport line the person wrote wins');
  // The league is remembered beside the brief (a browser store), keyed by its first line.
  const store = new Map();
  globalThis.window = { localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
  const brief = L.briefFor({ title: 'Scheffler confirms his schedule', category: 'golf' });
  assert.equal(L.sportForBrief(brief), 'Golf');
  assert.equal(L.withSport(`${brief}\nI added a line`), `${brief}\nI added a line\nSport: Golf`);
  assert.equal(L.withSport('A different story entirely'), 'A different story entirely', 'a rewritten brief loses the old league');
  delete globalThis.window;
});
ok('Home and Generate hand-offs use the same builder', () => {
  const href = H.trendHref({ title: 'Mahomes says knee "feels great"', category: 'nfl' }, 'NFL', { logic: L });
  assert.match(href, /&league=NFL&autorun=0$/);
  const html = fs.readFileSync(path.join(ROOT, 'generate.html'), 'utf8');
  assert.ok(!/`Story: \$\{item\.title\}`/.test(html), 'the live trend tiles no longer write "Story:" lines');
  assert.match(html, /TL\(\)\.briefFor\(item, \{ why, sportLabel: sport \}\)/);
  assert.match(html, /const brief = sentBrief\(els\.brief\.value\.trim\(\)\)/);
  assert.match(html, /params\.get\('league'\)/);
});

console.log(`gen v4 ui: ${passed} checks passed`);
