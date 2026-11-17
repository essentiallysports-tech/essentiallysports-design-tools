// The creative brain's memory of past ES posts (_generate-examples.js v2):
// reading the corpus RPC, scoring and picking past posts for a brief, masking
// their numbers, house-style lines, and the fallback before the migration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const examplesPath = path.join(fnDir, '_generate-examples.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
delete require.cache[examplesPath];
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }) } };
const ex = require(examplesPath);
const { normalizeCorpus, scorePastPost, pickPastPosts, formatPastPosts, houseStyle, loadCorpus, _test } = ex;

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = days => new Date(NOW - days * 864e5).toISOString();
const row = extra => ({
  id: `DES${Math.random().toString(36).slice(2, 8)}`, exported_at: daysAgo(2), workspace_variant: 'Cover Image', post_type: 'cover',
  sport: '', team: '', title: '', lines: [], listicle: null, palette_idx: 0, photo_url: null, brief: '', generated: {}, status: 'Assigned', stars: null, ...extra,
});

// ─── 1. normalizeCorpus ────────────────────────────────────────────────────
const posts = normalizeCorpus([
  row({ id: 'A', lines: ['Can Anyone', 'Stop Mahomes?'], sport: 'NFL', team: 'Kansas City Chiefs', brief: 'mahomes after chiefs win', generated: { aiText: ['Can Anyone', 'Stop Mahomes?'], angle: 'Nobody stops him' } }),
  row({ id: 'B', lines: ['Mahomes Is', 'Different'], generated: { aiText: ['Can Anyone', 'Stop Mahomes?'] }, exported_at: daysAgo(3) }),
  row({ id: 'C', post_type: 'listicle-type-1', workspace_variant: 'Listicle Type 1', title: 'top-3-rushers', listicle: { title: 'Top 3 Rushing Yards\nThis Season', headers: ['Player', 'Team', 'Yards'], rows: [{ entity: 'Derrick Henry', metric1: 'Ravens', metric2: '1,120', subtitle: '' }] } }),
  row({ id: 'D', post_type: '', workspace_variant: 'Player Stats', title: 'Statement Made 30 PTS', lines: [] }),
  row({ id: 'E', title: 'nfl-rams', lines: [] }), // a slug, no text: dropped
  row({ id: 'F', lines: ['Can Anyone', 'Stop Mahomes?'], exported_at: daysAgo(9) }), // duplicate text: dropped
]);
const byId = Object.fromEntries(posts.map(post => [post.id, post]));
assert.deepEqual(posts.map(post => post.id), ['A', 'C', 'D', 'B'], 'newest first, slugs and duplicates dropped');
assert.deepEqual(byId.A.lines, ['Can Anyone', 'Stop Mahomes?']);
assert.equal(byId.A.text, 'Can Anyone | Stop Mahomes?');
assert.equal(byId.A.edited, false, 'exported exactly as Generate wrote it');
assert.equal(byId.B.edited, true, 'changed after Generate');
assert.equal(byId.C.edited, null, 'unknown without aiText');
assert.equal(byId.C.listicle.rows[0].entity, 'Derrick Henry');
assert.match(byId.C.text, /^Top 3 Rushing Yards/);
assert.equal(byId.D.postType, 'stats-single-ent', 'the variant names the type when post_type is missing');
assert.deepEqual(byId.D.lines, ['Statement Made 30 PTS'], 'a legacy title stands in for the lines');
assert.equal(byId.A.generated.angle, 'Nobody stops him');

// ─── 2. Scoring ────────────────────────────────────────────────────────────
const read = { brief: 'Mahomes after the Chiefs win', subjects: ['Patrick Mahomes'], team: 'CHIEFS', sport: 'NFL', fits: { cover: true } };
const score = extra => scorePastPost(normalizeCorpus([row(extra)])[0], read, { now: NOW });
const plain = { lines: ['Big Night', 'In Town'], exported_at: daysAgo(10) };
const entity = score({ ...plain, lines: ['Big Night', 'For Mahomes'] });
const team = score({ ...plain, team: 'Kansas City Chiefs', sport: 'NFL' });
const sport = score({ ...plain, sport: 'NFL' });
const base = score(plain);
assert.ok(entity > team && team > sport && sport > base, `entity > team > sport > nothing (${entity}, ${team}, ${sport}, ${base})`);
assert.ok(score({ ...plain, stars: 5 }) > score({ ...plain, stars: 3 }), 'stars raise a post');
assert.ok(score({ ...plain, exported_at: daysAgo(1) }) > score({ ...plain, exported_at: daysAgo(90) }), 'recency decays');
assert.ok(score({ ...plain, brief: 'mahomes after the chiefs win' }) > base, 'a confirmed brief counts');

// ─── 3. Picking (MMR) ──────────────────────────────────────────────────────
const many = normalizeCorpus([
  row({ id: 'c1', lines: ['Can Anyone', 'Stop Mahomes?'], sport: 'NFL', stars: 5, exported_at: daysAgo(1) }),
  row({ id: 'c2', lines: ['Can Anyone', 'Stop Mahomes Now?'], sport: 'NFL', exported_at: daysAgo(1) }), // near-duplicate of c1
  row({ id: 'c3', lines: ['Mahomes Is', 'Built Different'], sport: 'NFL', exported_at: daysAgo(2) }),
  row({ id: 'c4', lines: ['Chiefs Are', 'Back Again'], sport: 'NFL', exported_at: daysAgo(2) }), // 3rd cover: over the per-type cap
  row({ id: 'c5', lines: ['Mahomes Ruined', 'Our Week'], sport: 'NFL', stars: 1, exported_at: daysAgo(1) }), // 1 star: excluded
  row({ id: 'q1', post_type: 'quote', workspace_variant: 'Quote', lines: ['We Are Not', 'Done Yet'], sport: 'NFL', exported_at: daysAgo(4) }),
  row({ id: 's1', post_type: 'stats-single-ent', workspace_variant: 'Player Stats', lines: ['Mahomes Delivers', '320 | YDS'], sport: 'NFL', exported_at: daysAgo(5) }),
]);
const picked = pickPastPosts(many, read, { now: NOW });
const ids = picked.map(post => post.id);
assert.ok(picked.filter(post => post.postType === 'cover').length <= 2, 'at most 2 per template');
assert.ok(!(ids.includes('c1') && ids.includes('c2')), 'no near-duplicates');
assert.ok(!ids.includes('c5'), 'posts rated 2 stars or less are never examples');
assert.ok(ids.includes('c1'), 'the 5-star post is in');
assert.ok(picked.length <= 6);
assert.ok(pickPastPosts(many, read, { allowedTypes: ['quote'], now: NOW }).every(post => post.postType === 'quote'), 'respects the requested format');
// A 4+ star post for the sport is always included when one exists.
const starredLow = normalizeCorpus([
  ...Array.from({ length: 8 }, (_, i) => row({ id: `n${i}`, post_type: ['cover', 'quote', 'stats-single-ent', 'long-quote'][i % 4], lines: [`Mahomes Line ${'abcdefgh'[i]}`, `Other ${'ijklmnop'[i]} Words`], sport: 'NFL', team: 'Kansas City Chiefs', exported_at: daysAgo(1) })),
  row({ id: 'gold', lines: ['An Old', 'Classic'], sport: 'NFL', stars: 4, exported_at: daysAgo(200) }),
]);
assert.ok(pickPastPosts(starredLow, read, { now: NOW }).some(post => post.id === 'gold'), 'one well-starred post for the sport is always shown');

// ─── 4. Formatting masks numbers ───────────────────────────────────────────
const formatted = formatPastPosts(normalizeCorpus([row({ lines: ['Statement Made', '30 | PTS', '1,120 | YDS'], post_type: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', stars: 5, brief: 'clark 30 pts 9 ast' })]));
assert.equal(formatted, '- [Player Stats · WNBA · Indiana Fever · ★5] "Statement Made | # | PTS | # | YDS" (brief: "clark # pts # ast")');
assert.doesNotMatch(formatted.replace(/★5/, ''), /\d/, 'no digits reach the prompt');

// ─── 5. House style needs 8+ samples ───────────────────────────────────────
const covers = n => normalizeCorpus(Array.from({ length: n }, (_, i) => row({ id: `h${i}`, lines: [`Cover Line ${i}a`, i % 2 ? 'Who Stops Him?' : 'He Is Back'], exported_at: daysAgo(i + 1) })));
assert.deepEqual(houseStyle(covers(7), read), [], 'nothing under 8 samples');
const style = houseStyle(covers(8), read);
assert.ok(style.some(line => /^ES Covers here run 2 pills of about \d+ characters\.$/.test(line)), style.join(' / '));
assert.ok(style.includes('50% of recent ES Covers are questions.'));
assert.ok(style.every(line => line.length <= 120));
assert.ok(houseStyle(covers(40), read).length <= 5);
const palettes = normalizeCorpus(Array.from({ length: 3 }, (_, i) => row({ id: `p${i}`, lines: [`Chiefs ${'xyz'[i]}`, 'Line'], team: 'Kansas City Chiefs', palette_idx: 2 })));
assert.ok(houseStyle(palettes, read).includes('For CHIEFS, editors use palette inverted 100% of the time.'));

// ─── 6. loadCorpus: rich, then the old examples before the migration, then none ──
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
let calls = [];
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  if (String(url).endsWith('/rpc/list_frameup_generate_corpus')) return reply(200, [row({ id: 'R1', lines: ['Rich', 'Row Here'] })]);
  throw new Error(`unexpected fetch ${url}`);
};
_test.reset();
let loaded = await loadCorpus('tok');
assert.equal(loaded.source, 'rich');
assert.equal(loaded.rows[0].id, 'R1');
assert.equal(calls.length, 1, 'a short first page is the whole corpus');
calls = [];
await loadCorpus('tok');
assert.equal(calls.length, 0, 'cached for 10 minutes');

_test.reset();
globalThis.fetch = async url => {
  calls.push(String(url));
  if (String(url).endsWith('/rpc/list_frameup_generate_corpus')) return reply(404, { code: 'PGRST202', message: 'Could not find the function' });
  if (String(url).endsWith('/rpc/list_frameup_examples')) return reply(200, [{ title: 'Can Anyone Stop Mahomes?', workspace_variant: 'Cover Image', exported_at: daysAgo(1), brief: 'mahomes win' }]);
  throw new Error(`unexpected fetch ${url}`);
};
loaded = await loadCorpus('tok');
assert.equal(loaded.source, 'legacy', 'before the migration: the old examples RPC');
assert.equal(loaded.designs[0].text, 'Can Anyone Stop Mahomes?', 'the old example shape is kept for the writer');
assert.deepEqual(normalizeCorpus(loaded.rows)[0].lines, ['Can Anyone Stop Mahomes?'], 'titles stand in for lines');

_test.reset();
globalThis.fetch = async () => { throw new Error('network down'); };
loaded = await loadCorpus('tok');
assert.equal(loaded.source, 'none');
assert.deepEqual(loaded.rows, []);
_test.reset();
assert.equal((await loadCorpus('')).source, 'none', 'no session: no corpus');

console.log('generate corpus checks passed');
