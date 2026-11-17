#!/usr/bin/env node
// FrameUp impact loop (frameup-impact.js, netlify/functions/impact-stats.js),
// no network:
//   1. platform detection from pasted links (and Meta ad ids)
//   2. UTM building (links and widget HTML; image src untouched)
//   3. ad names: build and parse {brand}_{style}_{angle}_{WxH}_{yyyymmdd}
//   4. CSV parsing, column mapping, numbers and dates
//   5. matching imported rows to designs (ad id, ad name, URL, name parts)
//   6. metrics: weekly exports, active users, per creator, time to export,
//      template leaderboard, Generate run → export, AI cost per export,
//      request on-time rate, posted rate
//   7. the env-gated stats endpoint (401, 403, configured flags, 503 / 501)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const I = require(path.resolve('frameup-impact.js'));

// ── 1. Platform detection ───────────────────────────────────────────────────
{
  const cases = [
    ['https://www.instagram.com/p/DAbc123xyz/?igsh=MWQ1ZGUxMzBkMA==', 'instagram', 'DAbc123xyz'],
    ['instagram.com/reel/C9zz_Q1/', 'instagram', 'C9zz_Q1'],
    ['https://x.com/essentiallysports/status/1858000000000000001?s=46&t=abc', 'x', '1858000000000000001'],
    ['https://twitter.com/es_sportsnews/status/1458761091195064325', 'x', '1458761091195064325'],
    ['https://www.threads.net/@essentiallysports/post/C9abcDEF', 'threads', 'C9abcDEF'],
    ['https://www.threads.com/@essentiallysports/post/DBxyz', 'threads', 'DBxyz'],
    ['https://www.facebook.com/essentiallysports/posts/pfbid02abcDEF', 'facebook', 'pfbid02abcDEF'],
    ['https://m.facebook.com/story.php?story_fbid=123456789&id=987', 'facebook', '123456789'],
    ['https://www.facebook.com/reel/1234567890123', 'facebook', '1234567890123'],
    ['https://fb.watch/abCDef12/', 'facebook', 'abCDef12'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=xyz', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abc123DEF45', 'youtube', 'abc123DEF45'],
    ['https://the-nfl-huddle.beehiiv.com/p/week-11-picks', 'newsletter', 'week-11-picks'],
    ['https://www.facebook.com/ads/library/?id=120210123456789012', 'meta_ad', '120210123456789012'],
    ['https://adsmanager.facebook.com/adsmanager/manage/ads?act=1&selected_ad_ids=120211111111111111', 'meta_ad', '120211111111111111'],
    ['120212222222222222', 'meta_ad', '120212222222222222'],
    ['https://www.essentiallysports.com/nfl-news-story/', 'other', ''],
  ];
  for (const [input, platform, externalId] of cases) {
    const result = I.detectPlatform(input);
    assert.equal(result.ok, true, input);
    assert.equal(result.platform, platform, input);
    assert.equal(result.externalId, externalId, input);
  }
  assert.equal(I.detectPlatform('').ok, false);
  assert.match(I.detectPlatform('').error, /Paste/);
  assert.equal(I.detectPlatform('not a link').ok, false);
  assert.equal(I.detectPlatform('javascript:alert(1)').ok, false);
  assert.equal(I.detectPlatform('ftp://example.com/file').ok, false);
  assert.equal(I.detectPlatform('12345').ok, false, 'too short for an ad id');
  // Normalised URL drops tracking, www/m, trailing slash and hash.
  assert.equal(I.normalizeUrl('https://www.Instagram.com/p/ABC/?igsh=x&utm_source=y#frag'), 'https://instagram.com/p/ABC');
  assert.equal(I.normalizeUrl('https://m.youtube.com/watch?v=abc&si=1'), 'https://youtube.com/watch?v=abc');
  assert.equal(I.detectPlatform('https://instagram.com/p/ABC/').normalizedUrl, I.detectPlatform('https://www.instagram.com/p/ABC?igsh=zz').normalizedUrl);
}

// ── 2. UTM ──────────────────────────────────────────────────────────────────
{
  const params = I.utmParams({ brand: 'The NFL Huddle', designId: 'task-design-DES-ABC123', platform: 'instagram', template: 'Cover Image' });
  assert.deepEqual(params, {
    utm_source: 'instagram',
    utm_medium: 'social',
    utm_campaign: 'the-nfl-huddle-task-design-des-abc123',
    utm_content: 'cover-image',
  });
  assert.equal(I.utmParams({}).utm_source, 'frameup');
  assert.equal(I.utmParams({}).utm_campaign, 'essentiallysports');
  assert.equal(I.utmParams({ workspace: 'newsletter' }).utm_medium, 'newsletter');
  assert.equal(I.utmParams({ platform: 'meta_ad' }).utm_medium, 'paid_social');
  assert.equal(I.utmParams({ platform: 'other' }).utm_source, 'frameup');

  const base = 'https://xtdusejokbhtjlmijdca.supabase.co/storage/v1/object/public/frameup-links/2026/11/bears-trivia.jpeg';
  const tagged = I.buildUtmUrl(base, { utm_source: 'frameup', utm_medium: 'newsletter', utm_campaign: 'es-bears-trivia' });
  const url = new URL(tagged);
  assert.equal(url.origin + url.pathname, base, 'the hosted image path never changes');
  assert.equal(url.searchParams.get('utm_campaign'), 'es-bears-trivia');
  // Existing params stay; utm_* are replaced, not duplicated.
  const again = I.buildUtmUrl('https://example.com/a?x=1&utm_source=old', { utm_source: 'new' });
  assert.equal(new URL(again).searchParams.get('x'), '1');
  assert.deepEqual(new URL(again).searchParams.getAll('utm_source'), ['new']);
  assert.equal(I.buildUtmUrl('mailto:hi@example.com', { utm_source: 'x' }), 'mailto:hi@example.com');
  assert.equal(I.buildUtmUrl('', { utm_source: 'x' }), '');
  assert.equal(I.stripUtm(tagged), base);

  const html = '<a href="https://essentiallysports.com/story?a=1&amp;b=2" style="x"><img src="https://cdn.example.com/w.png" alt=""></a><a href=\'mailto:x@y.z\'>mail</a>';
  const out = I.addUtmToHtml(html, { utm_source: 'frameup', utm_medium: 'newsletter', utm_campaign: 'c' });
  assert.match(out, /href="https:\/\/essentiallysports\.com\/story\?a=1&amp;b=2&amp;utm_source=frameup&amp;utm_medium=newsletter&amp;utm_campaign=c"/);
  assert.match(out, /src="https:\/\/cdn\.example\.com\/w\.png"/, 'img src untouched');
  assert.match(out, /href='mailto:x@y\.z'/);
}

// ── 3. Ad names ─────────────────────────────────────────────────────────────
{
  const name = I.adName({ brand: 'essentially-cfb', style: 'highlight', angle: 'moment', size: '1080x1920', date: '2026-11-18T15:00:00Z' });
  assert.equal(name, 'essentiallycfb_highlight_moment_1080x1920_20261118');
  assert.equal(I.adName({ brand: 'ES', style: 'Bold Quote', width: 1080, height: 1350, date: new Date(Date.UTC(2026, 0, 5)) }), 'es_boldquote_na_1080x1350_20260105');
  assert.deepEqual(I.parseAdName(name), { brand: 'essentiallycfb', style: 'highlight', angle: 'moment', size: '1080x1920', date: '20261118' });
  assert.deepEqual(I.parseAdName('Fall test essentiallycfb_highlight_moment_1080x1080_20261118 - Copy 2'), { brand: 'essentiallycfb', style: 'highlight', angle: 'moment', size: '1080x1080', date: '20261118' });
  assert.equal(I.parseAdName('Some ad without a convention'), null);
}

// ── 4. CSV ──────────────────────────────────────────────────────────────────
const META_CSV = '﻿Reporting starts,Reporting ends,Ad name,Ad ID,Impressions,Reach,Link clicks,"CTR (link click-through rate)",Amount spent (USD),Results\r\n'
  + '2026-11-10,2026-11-16,essentiallycfb_highlight_moment_1080x1920_20261110,120210000000000001,"12,345",9000,321,2.6%,$45.10,40\r\n'
  + '2026-11-10,2026-11-16,essentiallycfb_highlight_moment_1080x1080_20261111 - Copy,120210000000000002,5000,4100,80,1.6%,$12.00,9\r\n'
  + '2026-11-10,2026-11-16,"Brand ad, no convention",120210000000000003,100,90,1,1%,$1.00,\r\n'
  + '2026-11-10,2026-11-16,essentiallycfb_highlight_trend_1080x1350_20261112,120210000000000004,700,600,20,2.9%,$3.00,2\r\n';
const BEEHIIV_CSV = 'Post ID,Title,Web URL,Publish Date,Recipients,Unique Opens,Open Rate,Unique Clicks,Click Rate\n'
  + 'post_abc,"Week 11: ""Upset"" picks",https://the-nfl-huddle.beehiiv.com/p/week-11-picks?utm_source=x,11/15/2026,"20,000","9,100",45.5%,"1,200",6.0%\n'
  + 'post_def,Steelers notes,https://steelers-huddle.beehiiv.com/p/notes,2026-11-14,5000,2000,40%,150,3%\n';
{
  const meta = I.parseCsv(META_CSV);
  assert.equal(meta.headers[0], 'Reporting starts', 'BOM stripped');
  assert.equal(meta.rows.length, 4);
  assert.equal(meta.rows[0][4], '12,345');
  assert.equal(meta.rows[2][2], 'Brand ad, no convention', 'quoted comma');
  assert.equal(I.detectCsvKind(meta.headers), 'meta_ads');
  const mapping = I.guessMapping(meta.headers, 'meta_ads');
  assert.equal(mapping.ad_name, 2);
  assert.equal(mapping.ad_id, 3);
  assert.equal(mapping.clicks, 6);
  assert.equal(mapping.ctr, 7);
  assert.equal(mapping.spend, 8);

  const bee = I.parseCsv(BEEHIIV_CSV);
  assert.equal(bee.rows[0][1], 'Week 11: "Upset" picks', 'escaped quotes');
  assert.equal(I.detectCsvKind(bee.headers), 'beehiiv');
  const bmap = I.guessMapping(bee.headers, 'beehiiv');
  assert.equal(bmap.post_id, 0);
  assert.equal(bmap.url, 2);
  assert.equal(bmap.opens, 5);
  assert.equal(bmap.clicks, 7);

  // Semicolons and tabs, newlines inside quotes, blank lines.
  const semi = I.parseCsv('a;b\n"x\ny";2\n\n');
  assert.deepEqual(semi.headers, ['a', 'b']);
  assert.deepEqual(semi.rows, [['x\ny', '2']]);
  assert.deepEqual(I.parseCsv('a\tb\n1\t2').rows, [['1', '2']]);
  assert.deepEqual(I.parseCsv('').rows, []);
  assert.equal(I.detectCsvKind(['foo', 'bar']), '');

  assert.equal(I.parseNumber('12,345'), 12345);
  assert.equal(I.parseNumber('$45.10'), 45.1);
  assert.equal(I.parseNumber('2.6%'), 2.6);
  assert.equal(I.parseNumber('1.234,56'), 1234.56);
  assert.equal(I.parseNumber('(3.5)'), -3.5);
  assert.equal(I.parseNumber('—'), null);
  assert.equal(I.parseNumber(''), null);
  assert.equal(I.parseNumber('abc'), null);
  assert.equal(I.parseDate('11/15/2026'), '2026-11-15');
  assert.equal(I.parseDate('2026-11-14T10:00:00Z'), '2026-11-14');
  assert.equal(I.parseDate('20261118'), '2026-11-18');
  assert.equal(I.parseDate('nope'), '');

  const results = I.rowsToResults(meta.rows, mapping, 'meta_ads');
  assert.equal(results.length, 4);
  assert.equal(results[0].rowKey, '120210000000000001');
  assert.deepEqual(results[0].metrics, { impressions: 12345, reach: 9000, clicks: 321, ctr: 2.6, spend: 45.1, results: 40 });
  assert.equal(results[0].periodStart, '2026-11-10');
  assert.equal(results[0].periodEnd, '2026-11-16');
  assert.equal(results[2].metrics.results, undefined, 'empty cells are left out');
  assert.equal(results[0].parsedName.style, 'highlight');

  const bres = I.rowsToResults(bee.rows, bmap, 'beehiiv');
  assert.equal(bres[0].rowKey, 'post_abc');
  assert.equal(bres[0].normalizedUrl, 'https://the-nfl-huddle.beehiiv.com/p/week-11-picks');
  assert.equal(bres[0].metrics.opens, 9100);
  assert.equal(bres[0].periodStart, '2026-11-15');
}

// ── 5. Matching ─────────────────────────────────────────────────────────────
{
  const meta = I.parseCsv(META_CSV);
  const results = I.rowsToResults(meta.rows, I.guessMapping(meta.headers, 'meta_ads'), 'meta_ads');
  const links = [
    { id: 'L1', task_id: 'vad-1', platform: 'meta_ad', external_id: '120210000000000001', url: '' },
    { id: 'L2', task_id: 'task-design-DES-2', platform: 'newsletter', url: 'https://the-nfl-huddle.beehiiv.com/p/week-11-picks', external_id: 'week-11-picks' },
  ];
  const exports = [
    // Exact ad name (the " - Copy" suffix is ignored by the parts matcher)
    { taskId: 'vad-2', adName: 'essentiallycfb_highlight_moment_1080x1080_20261111', brand: 'essentially-cfb', style: 'highlight', angle: 'moment', size: '1080x1080', exportedAt: '2026-11-11T12:00:00Z' },
    // Parts, one day off
    { taskId: 'vad-4', adName: '', brand: 'essentially-cfb', style: 'highlight', angle: 'trend', size: '1080x1350', exportedAt: '2026-11-13T01:00:00Z' },
  ];
  const matched = I.matchResults(results, { links, exports });
  assert.deepEqual(matched[0].match, { method: 'ad_id', postLinkId: 'L1', taskId: 'vad-1' });
  assert.equal(matched[1].match.method, 'ad_name_parts');
  assert.equal(matched[1].match.taskId, 'vad-2');
  assert.deepEqual(matched[2].match, { method: 'none', postLinkId: null, taskId: null });
  assert.equal(matched[3].match.method, 'ad_name_parts');
  assert.equal(matched[3].match.taskId, 'vad-4');

  // Exact ad name wins over parts.
  const exact = I.matchResults([{ ...results[1], adName: 'essentiallycfb_highlight_moment_1080x1080_20261111' }], { links: [], exports });
  assert.equal(exact[0].match.method, 'ad_name');
  // Too far apart in time: no parts match.
  const late = I.matchResults([results[3]], { links: [], exports: [{ ...exports[1], exportedAt: '2026-11-20T00:00:00Z' }] });
  assert.equal(late[0].match.method, 'none');

  const bee = I.parseCsv(BEEHIIV_CSV);
  const bres = I.matchResults(I.rowsToResults(bee.rows, I.guessMapping(bee.headers, 'beehiiv'), 'beehiiv'), { links });
  assert.deepEqual(bres[0].match, { method: 'url', postLinkId: 'L2', taskId: 'task-design-DES-2' });
  assert.equal(bres[1].match.method, 'none');
}

// ── 6. Metrics ──────────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-11-18T12:00:00Z'); // a Wednesday
  assert.equal(I.weekStart(now), '2026-11-16');
  assert.equal(I.weekStart('2026-11-16T00:00:00Z'), '2026-11-16');
  assert.equal(I.weekStart('2026-11-15T23:59:59Z'), '2026-11-09');
  assert.equal(I.median([]), null);
  assert.equal(I.median([5, 1, 3]), 3);
  assert.equal(I.median([4, 1, 3, 2]), 2.5);

  const day = 86400000;
  const at = offsetDays => new Date(now - offsetDays * day).toISOString();
  const exports = [
    { at: at(0), email: 'a@es.com', name: 'Ann', source: 'editor', workspace: 'Social Media', template: 'Cover Image', taskId: 't1', durationMs: 120000 },
    { at: at(1), email: 'a@es.com', name: 'Ann', source: 'editor', workspace: 'Social Media', template: 'Cover Image', taskId: 't2', durationMs: 900000, aiMade: 'generate' },
    { at: at(2), email: 'b@es.com', name: 'Bo', source: 'generate', workspace: 'Generate', template: 'Quote', taskId: 'gen-1', aiMade: 'generate' },
    { at: at(3), email: 'b@es.com', name: 'Bo', source: 'video-ads', workspace: 'Video Ads', template: 'highlight', taskId: 'vad-1', aiMade: 'video-ads' },
    { at: at(9), email: 'c@es.com', name: 'Cy', source: 'editor', workspace: 'Social Media', template: 'Quote Post', taskId: 't3', durationMs: 300000 },
    { at: at(40), email: 'c@es.com', name: 'Cy', source: 'editor', workspace: 'Social Media', template: 'Quote Post', taskId: 't4' },
  ];
  const weekly = I.weeklyCounts(exports, { weeks: 3, now });
  assert.deepEqual(weekly, [
    { week: '2026-11-02', count: 0 },
    { week: '2026-11-09', count: 2 }, // 9 days ago (Nov 9), 3 days ago (Nov 15)
    { week: '2026-11-16', count: 3 },
  ]);

  const since7 = now - 7 * day;
  assert.equal(I.activeUsers(exports, since7), 2);
  assert.equal(I.activeUsers(exports, now - 30 * day), 3);

  const creators = I.exportsPerCreator(exports, since7);
  assert.deepEqual(creators.map(row => [row.email, row.exports]), [['a@es.com', 2], ['b@es.com', 2]]);
  assert.deepEqual(creators[1].sources, { generate: 1, 'video-ads': 1 });

  // Time to export: events with elapsed_ms win; otherwise first editor export per person per day.
  const events = [
    { event: 'export_done', at: at(0), meta: { elapsed_ms: 60000 } },
    { event: 'export_done', at: at(1), meta: { elapsed_ms: 180000 } },
    { event: 'export_done', at: at(1), meta: { elapsed_ms: 999999999 } }, // > 6h, ignored
    { event: 'export_done', at: at(2), meta: {} },
    { event: 'generate_run', at: at(2), meta: {} },
    { event: 'generate_run', at: at(2), meta: {} },
    { event: 'generate_run', at: at(20), meta: {} },
  ];
  assert.deepEqual(I.timeToExport({ events, tasks: exports }, since7), { medianMs: 120000, samples: 2, method: 'events' });
  const fallback = I.timeToExport({ events: [], tasks: exports.filter(e => e.source === 'editor') }, now - 30 * day);
  assert.equal(fallback.method, 'tasks');
  assert.equal(fallback.samples, 3); // t1, t2, t3 (t4 has no duration and is outside 30d)
  assert.equal(fallback.medianMs, 300000);
  assert.deepEqual(I.timeToExport({}, since7), { medianMs: null, samples: 0, method: 'none' });

  const links = [{ task_id: 't1', created_at: at(0) }, { task_id: 'gen-1', created_at: at(1) }, { task_id: 'gen-1', created_at: at(1) }];
  const results = [
    { task_id: 't1', metrics: { clicks: 10, impressions: 1000, ctr: 1 } },
    { task_id: 't1', metrics: { clicks: 5, impressions: 500 } },
    { task_id: null, metrics: { clicks: 99 } },
  ];
  const board = I.templateLeaderboard({ exports, links, results }, since7);
  const cover = board.find(row => row.template === 'Cover Image');
  assert.equal(board[0].template, 'Cover Image', 'most exports first');
  assert.equal(cover.exports, 2);
  assert.equal(cover.creators, 1);
  assert.equal(cover.posted, 1);
  assert.equal(cover.postedRate, 0.5);
  assert.equal(cover.withResults, 1);
  assert.deepEqual(cover.results, { clicks: 15, impressions: 1500 }, 'rates are not summed');
  assert.equal(cover.clicksPerPost, 15);
  assert.equal(board.find(row => row.template === 'Quote').postedRate, 1);
  assert.equal(board.some(row => row.template === 'Quote Post'), false, 'outside 7 days');

  const posted = I.postedRate({ exports, links }, since7);
  assert.deepEqual({ ...posted }, { posted: 2, exports: 4, rate: 0.5, links: 3 });

  // Generate runs: events first, else AI usage grouped into runs (90s gaps).
  assert.deepEqual(I.generateRunToExport({ events, usage: [], exports }, since7), { runs: 2, exports: 2, rate: 1, method: 'events' });
  const usage = [
    { feature: 'generate', user_email: 'b@es.com', created_at: at(2), cost_usd: 0.02 },
    { feature: 'generate', user_email: 'b@es.com', created_at: new Date(now - 2 * day + 30000).toISOString(), cost_usd: 0.03 },
    { feature: 'generate', user_email: 'b@es.com', created_at: new Date(now - 2 * day + 600000).toISOString(), cost_usd: 0.01 },
    { feature: 'generate-director', user_email: 'b@es.com', created_at: at(2), cost_usd: 0.04 },
    { feature: 'trend-headlines', user_email: 'a@es.com', created_at: at(20), cost_usd: 1 },
  ];
  const fromUsage = I.generateRunToExport({ events: [], usage, exports }, since7);
  assert.deepEqual(fromUsage, { runs: 2, exports: 2, rate: 1, method: 'usage' });
  assert.equal(I.generateRunToExport({}, since7).rate, null);

  const cost = I.aiCostPerExport({ usage, exports }, since7);
  assert.equal(Number(cost.spend.toFixed(4)), 0.1);
  assert.equal(cost.exports, 4);
  assert.equal(cost.aiExports, 3);
  assert.equal(Number(cost.perExport.toFixed(4)), 0.025);
  assert.equal(Number(cost.perAiExport.toFixed(4)), 0.0333);
  assert.equal(I.aiCostPerExport({}, since7).perExport, null);

  const requests = [
    { dueAt: at(5), completedAt: at(6), createdAt: at(8), status: 'Done' }, // on time
    { dueAt: at(4), completedAt: at(3), createdAt: at(6), status: 'Done' }, // late
    { dueAt: at(2), completedAt: '', createdAt: at(4), status: 'Doing' }, // overdue
    { dueAt: new Date(now + day).toISOString(), completedAt: '', createdAt: at(1), status: 'Doing' }, // not due yet
    { dueAt: '', completedAt: at(1), createdAt: at(2), status: 'Done' }, // no due date
    { dueAt: at(60), completedAt: at(61), createdAt: at(62), status: 'Done' }, // outside range
  ];
  const sla = I.requestOnTimeRate(requests, now - 30 * day, Infinity, now);
  assert.equal(sla.due, 3);
  assert.equal(sla.onTime, 1);
  assert.equal(sla.late, 1);
  assert.equal(sla.overdue, 1);
  assert.equal(Number(sla.rate.toFixed(3)), 0.333);
  assert.equal(sla.medianTurnaroundMs, 2.5 * day);
}

// ── 7. Stats endpoint (env-gated) ───────────────────────────────────────────
{
  let admin = true;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'u1', email: 'admin@essentiallysports.com' }) };
    if (href.endsWith('/rest/v1/rpc/is_es_designer_admin')) return { ok: true, status: 200, json: async () => admin };
    throw new Error(`unexpected fetch ${href}`);
  };
  delete process.env.BEEHIIV_API_KEY;
  delete process.env.META_ACCESS_TOKEN;
  const { handler } = require(path.resolve('netlify/functions/impact-stats.js'));
  const headers = { authorization: 'Bearer t' };
  const body = res => JSON.parse(res.body);

  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  assert.equal((await handler({ httpMethod: 'DELETE', headers })).statusCode, 405);
  let res = await handler({ httpMethod: 'GET', headers });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(body(res).sources.beehiiv, { configured: false, label: 'Beehiiv' });
  assert.equal(body(res).sources.meta.configured, false);
  res = await handler({ httpMethod: 'POST', headers, body: JSON.stringify({ source: 'beehiiv' }) });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(body(res)).includes('BEEHIIV'), false, 'no env names or secrets in replies');
  process.env.META_ACCESS_TOKEN = 'secret-token';
  res = await handler({ httpMethod: 'POST', headers, body: JSON.stringify({ source: 'meta' }) });
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.includes('secret-token'), false);
  assert.equal(body((await handler({ httpMethod: 'GET', headers }))).sources.meta.configured, true);
  assert.equal((await handler({ httpMethod: 'POST', headers, body: JSON.stringify({ source: 'tiktok' }) })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', headers, body: '{bad' })).statusCode, 400);
  admin = false;
  assert.equal((await handler({ httpMethod: 'GET', headers })).statusCode, 403);
  delete process.env.META_ACCESS_TOKEN;
}

console.log('test-impact: all checks passed');
