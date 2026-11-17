#!/usr/bin/env node
// Reels Studio Archive research (_reel-archive.js) and the Moment Replay
// frame pick (_reel-frame-pick.js). Archive: ES MCP query_articles year by
// year (pageview-ranked), ES-pool photos only, moments that cite a source
// (uncited or unsourced numbers dropped), the MCP-down fallback. Frame pick:
// the code fallback, the $0.02 cap, the 7-day cache, validation of the
// model's answer, the Haiku fallback and usage logging. No network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ARCH = require('../netlify/functions/_reel-archive.js');
const FP = require('../netlify/functions/_reel-frame-pick.js');
const G = require('../netlify/functions/_reel-games.js');
const D = require('../reel-data.js');
const T = require('../reel-timeline.js');
const DIR = require('../netlify/functions/_reel-director.js');
const FX = new URL('./fixtures/reels/', import.meta.url);
const fx = name => JSON.parse(readFileSync(new URL(name, FX), 'utf8'));

let passed = 0;
async function test(name, fn) {
  try { ARCH.CACHE.clear(); FP.CACHE.clear(); G._test._reset(); await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const A = fx('espn-athlete-3139477.min.json');
const espn = async url => {
  const u = String(url);
  if (u.includes('athletes/3139477/stats')) return json(A.stats);
  if (u.includes('athletes/3139477')) return json(A.info);
  return json({}, 404);
};
const NOW = () => Date.parse('2026-11-18T04:00:00Z');

// A fake ES MCP session: query_articles records per year window.
function fakeMcp({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    listTools: async () => [{ name: 'search_images' }, { name: 'query_articles' }],
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (fail) throw new Error('ES MCP request failed: 503');
      const year = Number(String(args.publish_date_start).slice(0, 4));
      const rec = (title, slug, date) => `**[${title}](https://www.essentiallysports.com/nfl-news-${slug}/)**\nSport: NFL | Writer: ES Desk | Published: ${date} | Entity: Patrick Mahomes,Chiefs | Type: news`;
      const rows = [rec(`Patrick Mahomes story of ${year}`, `story-${year}`, `${year}-10-0${(year % 9) + 1} 17:30`)];
      if (year === 2022) rows.unshift(rec('Looking back at Patrick Mahomes and his 2018 MVP season with 50 touchdowns', 'mvp-look-back', '2022-09-01 10:00'));
      if (year === 2023) rows.push('**[Not ES](https://example.com/x)**\nSport: NFL | Published: 2023-01-01');
      return { content: [{ type: 'text', text: rows.join('\n\n') }] };
    },
  };
}
const photoSearch = async query => [
  { sourceUrl: `https://image-cdn.essentiallysports.com/wp-content/uploads/${encodeURIComponent(query)}.jpg`, caption: `${query} on the field`, credit: 'Imagn', width: 1200 },
  { sourceUrl: 'https://a.espncdn.com/photo/2022/0101/x.jpg', caption: 'not ES', credit: 'ESPN' },
  { sourceUrl: 'https://essentiallysports-images-v2prod.s3.amazonaws.com/x.jpg', caption: 'bucket', credit: 'agency' },
];

await test('parseArticles: ES records with the publish date; other hosts dropped', () => {
  const text = '**[Brady wins again](https://www.essentiallysports.com/nfl-news-brady/)**\nSport: NFL | Published: Feb 7, 2021 | Entity: Tom Brady\n\n**[Elsewhere](https://example.com/a)**\nSport: NFL';
  const out = ARCH.parseArticles(text);
  assert.deepEqual(out.map(a => [a.title, a.date, a.entities[0]]), [['Brady wins again', '2021-02-07', 'Tom Brady']]);
  assert.equal(ARCH.publishedDate('Published: 17:30'), '');
});

await test('archive-research: year windows newest first (<= 8, pageview-ranked), ES photos only, every moment cited, $0', async () => {
  const mcp = fakeMcp();
  const out = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '3139477', name: 'Patrick Mahomes', angle: '5 best moments' }, { fetchImpl: espn, now: NOW, mcp, mcpConfigured: true, photoSearch });
  assert.equal(out.ok, true);
  assert.equal(out.cost, 0);
  const yearsAsked = mcp.calls.filter(c => c.name === 'query_articles').map(c => Number(c.args.publish_date_start.slice(0, 4)));
  assert.deepEqual(yearsAsked, [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]);
  mcp.calls.forEach(c => { assert.equal(c.args.order_by, 'total_pageviews'); assert.equal(c.args.order_dir, 'desc'); assert.equal(c.args.keyword, 'Patrick Mahomes'); });
  // Articles: ES only, ids a<n>, an ISO date in the window.
  assert.ok(out.articles.length >= 8 && out.articles.length <= 30);
  out.articles.forEach((a, i) => { assert.equal(a.id, `a${i + 1}`); assert.equal(a.type, 'es-article'); assert.match(a.url, /^https:\/\/www\.essentiallysports\.com\//); assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/); });
  assert.ok(!out.articles.some(a => a.url.includes('example.com')));
  // Photos: image-cdn only.
  assert.ok(out.photos.length >= 1 && out.photos.every(p => /^https:\/\/image-cdn\.essentiallysports\.com\//.test(p.url) && /^p\d+$/.test(p.id)));
  // Moments: every one cites; the title-named year wins over the publish year.
  assert.ok(out.candidates.length >= 3 && out.candidates.length <= 12);
  out.candidates.forEach(c => assert.ok(c.cite.length && c.cite.every(r => /^(src|stat):/.test(r))));
  const mvp = out.candidates.find(c => /MVP/.test(c.title));
  assert.equal(mvp.year, 2018);
  assert.ok(mvp.cite.includes('stat:s2018') && /^\d/.test(mvp.line), 'the season row joins the story');
  assert.deepEqual(out.coverage, { articles: out.articles.length, photos: out.photos.length, thin: false, mcp: 'ok', calls: 8 });
  // Contract shape (fixture keys) and the plan built from it validates.
  const shape = fx('archive-research-2330.response.json');
  Object.keys(shape).filter(k => k !== '_note').forEach(k => assert.ok(k in out, k));
  const plan = D.planFromArchive(out, out.athlete, { angle: out.angle });
  const v = T.validateTimeline(DIR.planTimeline(plan));
  assert.ok(v.ok, JSON.stringify(v.errors));
  const set = new Set([...require('../reel-formats.js').numberSet(D.archiveFacts(plan.data.archive, out.athlete))]);
  plan.beats.forEach(b => require('../reel-formats.js').unsourcedNumbers(b, set, 'archive').forEach(n => assert.fail(`unsourced ${n} in "${b.text}"`)));
  // Cached 6 h.
  const again = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '3139477', name: 'Patrick Mahomes', angle: '5 best moments' }, { fetchImpl: espn, now: NOW, mcp, mcpConfigured: true, photoSearch });
  assert.equal(again.cached, true);
  assert.equal(mcp.calls.length, 8);
});

await test('citation rule: uncited, unknown-source and unsourced-number moments are dropped', () => {
  const stats = fx('athlete-2330.response.json').athlete.stats;
  const articles = [{ id: 'a1', title: 'Tom Brady wins his 7th ring', date: '2021-02-08' }];
  const { kept, dropped } = ARCH.verifyCandidates([
    { id: 'm1', year: 2021, title: 'Tom Brady wins his 7th ring', line: '', cite: ['src:a1'] },
    { id: 'm2', year: 2001, title: '2001 season', line: '2,843 yards, 18 TD, 12 INT', cite: ['stat:s2001'] },
    { id: 'm3', year: 2001, title: 'No source', line: '', cite: [] },
    { id: 'm4', year: 2001, title: '2001 season', line: '3,000 yards', cite: ['stat:s2001'] },
    { id: 'm5', year: 2019, title: 'Tom Brady wins his 7th ring', line: '', cite: ['src:a1'] },
    { id: 'm6', year: 2021, title: 'x', line: '', cite: ['src:a9'] },
    { id: 'm7', year: 2001, title: '2001 season', stat: { value: '2,843', label: 'YDS' }, line: '', cite: ['stat:s2001'] },
  ], { articles, stats });
  assert.deepEqual(kept.map(c => c.id), ['m1', 'm2', 'm7']);
  assert.deepEqual(dropped.map(d => [d.id, d.why.split(' ')[0]]), [['m3', 'uncited'], ['m4', 'unsourced'], ['m5', 'unsourced'], ['m6', 'uncited']]);
});

await test('MCP down or off: stat rows only, thin coverage; nothing at all -> data-unavailable', async () => {
  const down = fakeMcp({ fail: true });
  const out = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '3139477', name: 'Patrick Mahomes' }, { fetchImpl: espn, now: NOW, mcp: down, mcpConfigured: true, photoSearch: async () => [] });
  assert.equal(out.ok, true);
  assert.deepEqual([out.articles.length, out.coverage.thin, out.coverage.mcp], [0, true, 'error']);
  assert.ok(out.candidates.length >= 3 && out.candidates.every(c => c.cite.every(r => r.startsWith('stat:'))));
  ARCH.CACHE.clear();
  const off = fakeMcp();
  const out2 = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '3139477', name: 'Patrick Mahomes' }, { fetchImpl: espn, now: NOW, mcp: off, mcpConfigured: false });
  assert.equal(off.calls.length, 0, 'no MCP calls when it is not configured');
  assert.equal(out2.coverage.mcp, 'off');
  ARCH.CACHE.clear(); G._test._reset();
  const none = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '999', name: 'Nobody' }, { fetchImpl: async () => json({}, 404), now: NOW, mcp: fakeMcp({ fail: true }), mcpConfigured: true, photoSearch: async () => [] });
  assert.deepEqual([none.ok, none.status, none.reason], [false, 502, 'data-unavailable']);
  assert.equal((await ARCH.archiveResearch({ sport: 'nba', name: 'x' }, {})).status, 400);
});

await test('retired before ES existed: no MCP year calls, career by the numbers', async () => {
  const old = { ...A.stats, categories: A.stats.categories.map(c => ({ ...c, statistics: c.statistics.map(r => ({ ...r, season: { year: r.season.year - 20, displayName: String(r.season.year - 20) } })) })) };
  const mcp = fakeMcp();
  const out = await ARCH.archiveResearch({ sport: 'nfl', athleteId: '3139477', name: 'Old Timer' }, { fetchImpl: async url => (String(url).includes('/stats') ? json(old) : json(A.info)), now: NOW, mcp, mcpConfigured: true, photoSearch: async () => [] });
  assert.equal(mcp.calls.length, 0);
  assert.equal(out.coverage.thin, true);
  assert.ok(out.candidates.every(c => c.year < 2016));
});

// ─── Frame pick ───────────────────────────────────────────────────────────
const FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const body = (extra = {}) => ({ mode: 'frame-pick', clipUrl: 'https://x.com/49ers/status/1', segment: { in: 3.2, out: 9.8 }, frames: Array.from({ length: 9 }, () => FRAME), times: [3.4, 4, 4.6, 5.6, 6.1, 6.7, 8, 8.8, 9.6], budgetUsd: 0.02, ...extra });
function fakeGateway({ on = true, off = false } = {}) {
  const logged = [];
  return { logged, gatewayConfigured: () => on, featureDisabled: f => off && f === FP.FEATURE, logUsage: async (track, row) => { logged.push({ track, row }); } };
}
function modelReply(content, usage = { prompt_tokens: 3300, completion_tokens: 240 }) {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return json({ choices: [{ message: { content: typeof content === 'function' ? content(calls.length) : content } }], usage }); };
  return { fetchImpl, calls };
}
const GOOD = JSON.stringify({ setup: 1, play: 4, reaction: 7, clarity: [6, 8, 7, 5, 9, 7, 6, 8, 4], captions: { setup: 'Purdy surveys the field', play: 'McCaffrey hauls it in', reaction: 'The sideline erupts' }, notes: 'clean peak' });

await test('frame pick: AI off / feature off -> the free code pick (one per third), ok', async () => {
  const out = await FP.framePick(body(), { gateway: fakeGateway({ on: false }) });
  assert.deepEqual([out.ok, out.picker, out.cost, out.setup, out.play, out.reaction], [true, 'code', 0, 1, 4, 7]);
  const scored = await FP.framePick(body({ scores: [1, 2, 9, 7, 3, 1, 0, 0, 8] }), { gateway: fakeGateway({ on: false }) });
  assert.deepEqual([scored.setup, scored.play, scored.reaction], [2, 3, 8], 'the best-scored frame of each third');
  const off = await FP.framePick(body(), { gateway: fakeGateway({ off: true }) });
  assert.equal(off.reason, 'feature-off');
  const shape = fx('frame-pick.response.json');
  Object.keys(shape).forEach(k => assert.ok(k in out, k));
});

await test('frame pick: bad input -> 400; never images back', async () => {
  assert.equal((await FP.framePick(body({ frames: [] }), { gateway: fakeGateway() })).status, 400);
  assert.equal((await FP.framePick(body({ frames: ['https://x.com/a.jpg', FRAME, FRAME] }), { gateway: fakeGateway() })).status, 400);
  assert.equal((await FP.framePick(body({ frames: [FRAME, FRAME] }), { gateway: fakeGateway() })).status, 400);
  assert.equal((await FP.framePick(body({ frames: [`data:image/jpeg;base64,${'A'.repeat(70000)}`, FRAME, FRAME] }), { gateway: fakeGateway() })).status, 400);
  const out = await FP.framePick(body(), { gateway: fakeGateway({ on: false }) });
  assert.ok(!JSON.stringify(out).includes('base64'));
});

await test('frame pick: cap $0.02 (budget may only lower it); a call it cannot cover is never made', async () => {
  const gw = fakeGateway();
  const { fetchImpl, calls } = modelReply(GOOD);
  const out = await FP.framePick(body({ budgetUsd: 0.0005 }), { gateway: gw, fetchImpl });
  assert.deepEqual([out.picker, out.capped, calls.length], ['code', true, 0]);
  const zero = await FP.framePick(body({ budgetUsd: 0 }), { gateway: gw, fetchImpl });
  assert.equal(zero.capped, true);
  assert.ok(FP.estimate(FP.DEFAULT_MODEL, 9) < FP.CAP_USD);
  assert.ok(FP.estimate(FP.DEFAULT_MODEL, 9) < 0.003, 'about $0.002 a run');
});

await test('frame pick: one Flash-Lite call, validated, logged as reels-frame-pick, cached 7 days', async () => {
  const gw = fakeGateway();
  const { fetchImpl, calls } = modelReply(GOOD);
  let t = NOW();
  const now = () => t;
  const track = { email: 'a@essentiallysports.com', token: 'tok' };
  const out = await FP.framePick(body(), { gateway: gw, fetchImpl, track, now, env: {} });
  assert.deepEqual([out.ok, out.picker, out.setup, out.play, out.reaction, out.model], [true, 'ai', 1, 4, 7, 'google/gemini-3.5-flash-lite']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'google/gemini-3.5-flash-lite');
  assert.equal(calls[0].body.messages[1].content.filter(p => p.type === 'image_url').length, 9);
  assert.ok(out.cost > 0 && out.cost <= 0.02);
  assert.equal(out.cost, Number(((3300 * 0.30 + 240 * 2.50) / 1e6).toFixed(6)));
  assert.equal(gw.logged.length, 1);
  assert.equal(gw.logged[0].track.feature, 'reels-frame-pick');
  assert.equal(gw.logged[0].row.ok, true);
  assert.equal(out.captions.play, 'McCaffrey hauls it in');
  t += 6 * 86400e3;
  const hit = await FP.framePick(body(), { gateway: gw, fetchImpl, track, now, env: {} });
  assert.deepEqual([hit.cached, hit.cost, calls.length], [true, 0, 1]);
  t += 2 * 86400e3;
  await FP.framePick(body(), { gateway: gw, fetchImpl, track, now, env: {} });
  assert.equal(calls.length, 2, 'expired after 7 days');
  // A different segment is a different pick.
  await FP.framePick(body({ segment: { in: 1, out: 4 } }), { gateway: gw, fetchImpl, track, now, env: {} });
  assert.equal(calls.length, 3);
});

await test('frame pick: env model override; an invalid answer falls back to Haiku, then to the code pick', async () => {
  const gw = fakeGateway();
  const first = modelReply(n => (n === 1 ? JSON.stringify({ setup: 5, play: 4, reaction: 7 }) : GOOD));
  const out = await FP.framePick(body(), { gateway: gw, fetchImpl: first.fetchImpl, env: { REELS_FRAME_PICK_MODEL: 'google/gemini-3.8-flash' } });
  assert.deepEqual(first.calls.map(c => c.body.model), ['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5']);
  assert.deepEqual([out.picker, out.model], ['ai', 'anthropic/claude-haiku-5.5']);
  assert.deepEqual(gw.logged.map(l => l.row.ok), [false, true]);
  FP.CACHE.clear();
  const bad = modelReply('not json at all');
  const out2 = await FP.framePick(body(), { gateway: fakeGateway(), fetchImpl: bad.fetchImpl, env: {} });
  assert.deepEqual([out2.ok, out2.picker, out2.reason], [true, 'code', 'error']);
  assert.ok(out2.cost > 0 && out2.cost < 0.02, 'what was spent is reported');
});

await test('frame pick: captions are short, number-free and quote-free', () => {
  const v = FP.validatePick({ setup: 0, play: 1, reaction: 2, clarity: [99, -3], captions: { setup: '"Wow!"', play: 'Number 87 makes the grab', reaction: 'one two three four five six seven' } }, 3);
  assert.deepEqual(v.captions, { setup: 'Wow', play: 'The play', reaction: 'one two three four five six' });
  assert.deepEqual(v.clarity, [10, 0, 0]);
  assert.equal(FP.validatePick({ setup: 0, play: 0, reaction: 2 }, 3), null);
  assert.equal(FP.validatePick({ setup: 0, play: 1, reaction: 9 }, 3), null);
});

console.log(`\n${passed} passed`);
