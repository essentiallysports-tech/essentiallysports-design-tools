// Reels Studio data formats, UI side (reels-fmt-ui, 2026-11-18): the format
// gallery, the source pickers, the briefs handed to the script writer and the
// page wiring. Contract: project-docs/reels-formats-contract.md (§2.1, §5, §6 C).
// No network: the contract's response fixtures stand in for the server, and a
// mocked fetch replays them through the request shapes the page sends.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const G = require(path.join(root, 'reel-gallery.js'));
const F = require(path.join(root, 'reel-formats.js'));
const FLOW = require(path.join(root, 'reel-flow.js'));
const TL = require(path.join(root, 'reel-timeline.js'));
const fx = name => JSON.parse(readFileSync(path.join(root, 'scripts/fixtures/reels', name), 'utf8'));
const html = readFileSync(path.join(root, 'reel-maker.html'), 'utf8');
const css = readFileSync(path.join(root, 'reel-maker.css'), 'utf8');
const js = readFileSync(path.join(root, 'reel-maker.js'), 'utf8');

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ─── Gallery ───────────────────────────────────────────────────────────────
const ALL_ON = { games: true, 'game-data': true, athlete: true, 'archive-research': true, 'frame-pick': true };
const ALL_OFF = { games: false, 'game-data': false, athlete: false, 'archive-research': false, 'frame-pick': false };

t('formatStatus: news formats always ready; data formats need their server modes', () => {
  F.FORMAT_IDS.forEach(id => assert.equal(G.formatStatus(id, {}), 'ready', id));
  assert.equal(G.formatStatus('gameswing', ALL_OFF), 'soon');
  assert.equal(G.formatStatus('gameswing', { games: true, 'game-data': false }), 'soon', 'both modes needed');
  assert.equal(G.formatStatus('gameswing', ALL_ON), 'ready');
  assert.equal(G.formatStatus('archive', { athlete: true }), 'soon');
  assert.equal(G.formatStatus('archive', ALL_ON), 'ready');
  // Replay's AI pick is optional: the code pick is always there.
  assert.equal(G.formatStatus('replay', ALL_OFF), 'ready');
  assert.equal(G.formatStatus('replay', undefined), 'ready');
});

t('galleryModel: two rows, every format once, outputs and a cost chip per tile', () => {
  const m = G.galleryModel(F, ALL_OFF);
  assert.deepEqual(m.news.map(x => x.id), F.FORMAT_IDS);
  assert.deepEqual(m.data.map(x => x.id), F.DATA_FORMAT_IDS);
  assert.equal(m.data.find(x => x.id === 'replay').outputsLabel, 'Reel + carousel');
  assert.equal(m.data.find(x => x.id === 'gameswing').outputsLabel, 'Reel');
  [...m.news, ...m.data].forEach(tile => {
    assert.match(tile.cost, /^≈ \$\d/, tile.id);
    assert.equal(tile.art, `assets/reels/formats/${tile.id}.svg`);
    assert.ok(readFileSync(path.join(root, tile.art), 'utf8').includes('<svg'), `${tile.art} exists`);
  });
  assert.deepEqual(m.data.map(x => x.status), ['soon', 'ready', 'soon']);
  // The AI frame pick adds its capped line only when that mode is on.
  const off = G.galleryModel(F, ALL_OFF).data.find(x => x.id === 'replay').cost;
  const on = G.galleryModel(F, ALL_ON).data.find(x => x.id === 'replay').cost;
  assert.notEqual(off, on);
});

t('preview art: ES palette only (no purple), no external references, no text to mis-render', () => {
  F.ALL_FORMAT_IDS.forEach(id => {
    const svg = readFileSync(path.join(root, `assets/reels/formats/${id}.svg`), 'utf8');
    assert.doesNotMatch(svg, /<text|href=|xlink|<script/i, id);
    const hexes = svg.match(/#[0-9a-f]{6}\b/gi) || [];
    hexes.forEach(hex => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const purple = r > 110 && b > 110 && g < Math.min(r, b) - 40;
      assert.ok(!purple, `${id}: ${hex} reads as purple`);
    });
    assert.match(svg, /<title>[^<]+<\/title>/, `${id} has a title`);
  });
});

t('tiles: coming-soon is aria-disabled with the reason; values are escaped', () => {
  const m = G.galleryModel(F, ALL_OFF);
  const tile = G.tileHtml(m.data[0]);
  assert.match(tile, /data-gformat="gameswing"[^>]*aria-disabled="true"/);
  assert.match(tile, /Coming soon/);
  assert.match(tile, /aria-describedby="rm-gt-gameswing-d"/);
  const ready = G.tileHtml(m.data[1], { selected: 'replay' });
  assert.doesNotMatch(ready, /aria-disabled/);
  assert.match(ready, /aria-current="true"/);
  const evil = G.tileHtml({ ...m.news[0], label: '<img src=x onerror=1>' });
  assert.doesNotMatch(evil, /<img src=x/);
  const all = G.galleryHtml(m);
  assert.equal((all.match(/data-gformat=/g) || []).length, F.ALL_FORMAT_IDS.length);
  assert.match(G.entryHtml(m), /data-gall/);
});

// ─── Games (fixture-backed) ────────────────────────────────────────────────
const gamesResp = fx('games-nfl.response.json');
const base = gamesResp.games[0];
const mk = (id, drama, state = 'post', startsAt = base.startsAt) => ({ ...base, id, drama, startsAt, status: { ...base.status, state } });

t('sortGames: live first, then the biggest swing, unknown drama last', () => {
  const list = [mk('a', null), mk('b', 0.2), mk('c', 0.7), mk('d', 0.1, 'in'), mk('e', null, 'post', '2026-11-20T00:00Z')];
  assert.deepEqual(G.sortGames(list).map(g => g.id), ['d', 'c', 'b', 'e', 'a']);
  assert.deepEqual(list.map(g => g.id), ['a', 'b', 'c', 'd', 'e'], 'never mutates');
});

t('drama badge, sparkline, labels and filters', () => {
  assert.equal(G.dramaBadge(null), null);
  assert.equal(G.dramaBadge(0.62).label, 'Big swing · 62%');
  assert.equal(G.dramaBadge(0.31).tone, 'warm');
  assert.equal(G.dramaBadge(0.05).tone, 'calm');
  assert.equal(G.sparkPath(null), '');
  assert.equal(G.sparkPath([0.5]), '', 'one point is not a line');
  assert.equal(G.sparkPath([0, 1], 10, 10), 'M0.0 10.0 L10.0 0.0');
  assert.equal(G.gameLabel(base), 'WSH 24 at NYG 21');
  assert.match(G.statusText(base, { now: Date.parse('2026-11-13T05:00Z') }), /^Final · 4h ago$/);
  assert.equal(G.filterGames(gamesResp.games, 'giants').length, 1);
  assert.equal(G.filterGames(gamesResp.games, 'wsh').length, 1);
  assert.equal(G.filterGames(gamesResp.games, 'bears').length, 0);
});

t('game rows: a radio per game with the score and status in its name; the fixture renders', () => {
  const row = G.gameRowHtml(base, { selected: base.id, tab: true, logo: () => ({ src: 'assets/logos/nfl/nyg.webp' }) });
  assert.match(row, /role="radio" aria-checked="true" tabindex="0" data-game="401873052"/);
  assert.match(row, /aria-label="Washington Commanders 24 at New York Giants 21\. Final/);
  assert.match(row, /Swing not measured yet/, 'drama null is said plainly');
  assert.doesNotMatch(row, /espncdn/, 'logos come from the logo library');
  const still = G.gameRowHtml(base, { still: true });
  assert.match(still, /^<div class="rm-game is-static" role="group"/);
  assert.doesNotMatch(still, /role="radio"/);
});

t('key plays: scoring plays and the biggest swings, at most n, in game order', () => {
  const digest = fx('game-data-401873063.response.json').digest;
  assert.deepEqual(G.keyPlays(digest, 5), ['401873063302', '401873063558']);
  const many = { plays: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, seq: i, scoring: false, swing: (i % 3) / 10, tags: [] })) };
  const picked = G.keyPlays(many, 3);
  assert.equal(picked.length, 3);
  assert.deepEqual(picked, [...picked].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))), 'game order');
  assert.equal(G.playWhen(digest.plays[0], 'nfl'), 'Q1 12:11');
  assert.equal(G.playWhen({ period: 9, half: 'bottom' }, 'mlb'), 'Bot 9');
});

t('briefFromGame: only the digest facts of the kept plays (every number is sourced)', () => {
  const digest = fx('game-data-401873063.response.json').digest;
  const all = G.briefFromGame(digest, [], TL);
  assert.equal(all, TL.digestFacts(digest));
  const one = G.briefFromGame(digest, ['401873063558'], TL);
  assert.match(one, /Deebo Samuel/);
  assert.doesNotMatch(one, /Aubrey/);
  // Provenance: every number in the brief is in the digest's own facts.
  const facts = F.numberSet(TL.digestFacts(digest));
  F.numbersIn(one).forEach(num => assert.ok(facts.has(F.normNumber(num)), `number ${num} is sourced`));
  assert.equal(G.briefFromGame(null, [], TL), '');
});

// ─── Players and the archive ───────────────────────────────────────────────
t('player rows: name, position and years tell namesakes apart', () => {
  const c = fx('athlete-search.response.json').candidates[0];
  const row = G.playerRowHtml(c, { tab: true });
  assert.match(row, /data-athlete="2330"/);
  assert.match(row, /NFL · QB · 2000-2022/);
  assert.match(row, />TB</);
});

t('archive: sources list every cited article and stat row with its year and link', () => {
  const research = fx('archive-research-2330.response.json');
  const athlete = fx('athlete-2330.response.json').athlete;
  const moments = G.pickMoments(research.candidates, research.angle, 5);
  assert.deepEqual(moments.map(m => m.year), [2001, 2022]);
  const archive = { sources: [{ id: 'a1', type: 'es-article', title: 'T', url: 'https://www.essentiallysports.com/x/', date: '2017-02-06T00:00:00Z' }], photos: [], moments };
  const rows = G.archiveSources(archive, athlete, moments);
  assert.deepEqual(rows.map(r => [r.kind, r.year, r.cited]), [['article', 2017, false], ['stat', 2001, true], ['stat', 2022, true]]);
  assert.ok(rows.every(r => r.url), 'every row links somewhere');
  assert.match(G.coverageText(research.coverage), /^0 ES articles · 0 ES photos$/);
  // Uncited candidates never become moments.
  assert.equal(G.pickMoments([{ id: 'x', year: 2001, cite: [] }, { id: 'y', year: 1999, cite: ['stat:s1999'] }], '', 5).length, 1);
  const brief = G.briefFromArchive(athlete, archive, moments, research.angle);
  assert.match(brief, /Tom Brady, QB\. Angle: 5 best moments\./);
  assert.match(brief, /2001: 2001 season\. 2,843 yards/);
});

t('ESPN athlete id from a pasted player link or a bare id (search misses retired players)', () => {
  assert.equal(G.parseAthleteId('https://www.espn.com/nfl/player/_/id/2330/tom-brady'), '2330');
  assert.equal(G.parseAthleteId('espn.com/mlb/player/stats/_/id/33192/aaron-judge'), '33192');
  assert.equal(G.parseAthleteId(' 2330 '), '2330');
  ['', 'tom brady', 'https://example.com/id/2330', '12a'].forEach(bad => assert.equal(G.parseAthleteId(bad), '', bad));
  assert.match(G.coverageText({ articles: 3, photos: 1 }, 2), /3 ES articles · 1 ES photo · 2 unsourced moments dropped/);
  assert.match(js, /mode: 'athlete', sport: p\.sport, athleteId: id/);
});

t('data plan hand-off: digest / archive + athlete / replay + captions go to mode plan; frames stay small', () => {
  assert.match(js, /if \(fmt === 'gameswing'\) return \{ digest: state\.data\.game/);
  assert.match(js, /athlete: state\.data\.athlete, archive: \{/);
  assert.match(js, /replay: \{ origin: state\.replay\.origin[^}]*\}, captions:/);
  assert.match(js, /const FRAME_B64_MAX = 23000;/);
  assert.match(js, /if \(data\.picker === 'code'\)/);
  // B's replay helpers when loaded: sampling, request under the cap, apply, scrubbers, full frames.
  for (const fn of ['RP.sampleSegment', 'RP.candidateFrames', 'RP.pickRequest', 'RP.applyPick', 'RP.scrubberModel', 'RP.scrub', 'RP.grabFrames']) assert.ok(js.includes(fn), fn);
  assert.match(js, /R\.buildSlides\(state\.timeline, \{ style: styleId\(\) \}\)/);
  assert.match(js, /id: `photo:\$\{photo\.id\}`/, 'archive photos are photo:<id> assets');
});

// ─── Clips (Moment Replay) ─────────────────────────────────────────────────
t('parseClipLink: x.com and twitter.com status links only', () => {
  assert.deepEqual(G.parseClipLink('https://twitter.com/NFL/status/1855000000000000000?s=20'), { ok: true, url: 'https://x.com/NFL/status/1855000000000000000', handle: 'NFL', id: '1855000000000000000' });
  assert.equal(G.parseClipLink('x.com/49ers/status/123456789').ok, true);
  ['', 'not a link', 'https://youtube.com/watch?v=1', 'https://x.com/NFL', 'https://x.com.evil.io/NFL/status/123456789'].forEach(bad => assert.equal(G.parseClipLink(bad).ok, false, bad));
});

t('frames: code pick in thirds of the segment; AI indices validated', () => {
  const seg = { in: 2, out: 8 };
  const code = G.codeFrames(seg);
  assert.deepEqual(code.map(f => f.role), ['setup', 'play', 'reaction']);
  code.forEach(f => assert.ok(f.t >= seg.in && f.t <= seg.out));
  assert.ok(code[0].t < code[1].t && code[1].t < code[2].t);
  const times = G.sampleTimes(seg, 9);
  assert.equal(times.length, 9);
  assert.ok(times.every(x => x > seg.in && x < seg.out));
  const pick = fx('frame-pick.response.json');
  assert.deepEqual(G.framesFromPick(pick, times).map(f => f.t), [times[1], times[4], times[7]].map(x => Math.round(x * 10) / 10));
  assert.equal(G.framesFromPick({ ...pick, play: 9 }, times), null, 'out of range');
  assert.equal(G.framesFromPick({ ...pick, setup: 1.5 }, times), null, 'not an index');
  assert.equal(G.fmtSec(63.25), '1:03.3');
});

// ─── Flow + page wiring ────────────────────────────────────────────────────
t('flow: the page source objects satisfy reel-flow; a news pick returns to the old story state', () => {
  let s = FLOW.reduce(FLOW.initial(), { type: 'pick-format', format: 'gameswing' });
  assert.equal(s.step, 'source');
  s = FLOW.reduce(s, { type: 'set-source', source: { kind: 'game', sport: 'nfl', eventId: '401873063', label: G.gameLabel(base) } });
  assert.equal(s.step, 'story');
  assert.ok(FLOW.sourceReady('replay', { kind: 'clip', origin: 'library', url: 'https://x.com/NFL/status/1', assetId: 'clip:replay-1', segment: { in: 0.4, out: 6 } }));
  assert.ok(FLOW.sourceReady('replay', { kind: 'clip', origin: 'upload', assetId: 'clip:replay-up-1', segment: { in: 0, out: 3 } }));
  assert.ok(FLOW.sourceReady('archive', { kind: 'player', sport: 'nfl', athleteId: '2330', name: 'Tom Brady', angle: '5 best moments' }));
  const news = FLOW.reduce(s, { type: 'pick-format', format: 'top5' });
  assert.deepEqual(news, FLOW.initial(), 'news format: exactly the old story state');
});

t('projects: v1 snapshots load through normalizeTimeline unchanged', () => {
  const v1 = { v: 1, plan: { format: 'stat', beats: [{ id: 'b1', kind: 'hook', text: 'x' }] }, corpus: 'c', photos: {}, spent: { director: 0.01 } };
  const v2 = TL.normalizeTimeline(v1);
  assert.deepEqual(v2.plan, v1.plan);
  assert.equal(v2.corpus, 'c');
  assert.deepEqual(v2.data, { game: null, athlete: null, archive: null });
  assert.match(js, /const t = \(TL \? TL\.normalizeTimeline\(p\.timeline \|\| \{\}\) : p\.timeline\) \|\| \{\};/);
});

t('page: script tags, panes, steps and tour targets', () => {
  // B: timeline, replay and data load before the renderer; the zip writer before the exporter.
  const order = ['reel-timeline.js?v=20261118-reels-fmt-ui', 'reel-replay.js?v=20261118-reels-fmt-ui', 'reel-data.js?v=20261118-reels-fmt-ui', 'reel-render.js', 'frameup-zip.js', 'reel-export.js', 'reel-flow.js', 'reel-gallery.js?v=20261118-reels-fmt-ui', 'reel-maker.js?v=20261118-reels-fmt-ui'].map(s => html.indexOf(`src="${s}`));
  order.forEach(i => assert.ok(i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'script load order');
  assert.match(html, /reel-maker\.css\?v=20261118-reels-fmt-ui/);
  for (const id of ['rm-pane-format', 'rm-pane-source', 'rm-gallery', 'rm-fmt-entry', 'rm-data-story', 'rm-data-review', 'rm-view', 'rm-slidenav', 'rm-carousel-out', 'rm-export-carousel']) assert.ok(html.includes(`id="${id}"`), id);
  assert.equal((html.match(/<li data-dataflow hidden>/g) || []).length, 2, 'Format and Source steps, hidden for the news flow');
  assert.match(html, /<nav class="rm-steps" id="rm-steps"/, 'existing tour target stays');
  const notes = JSON.parse(readFileSync(path.join(root, 'tours/updates.json'), 'utf8'));
  const entry = notes.entries.find(e => e.id === '2026-11-19-reels-fmt-ui');
  assert.ok(entry && !entry.draft, 'release note');
  entry.items.filter(i => i.target).forEach(i => assert.ok(html.includes(`id="${i.target.slice(1)}"`), i.target));
});

t('page: news flow untouched; data flow reads formatModes and falls back gracefully', () => {
  assert.match(js, /if \(G && TL && dataFmt\(\)\) \{ await makeDataReel\(\); return; \}/, 'Make delegates only for data formats');
  assert.match(js, /extraSources: facts \? \[els\.extraSource\.value, facts\]\.filter\(Boolean\)\.join\('\\n'\) : els\.extraSource\.value/, 'news lint input is unchanged');
  assert.match(js, /formatModes: data\.formatModes \|\| \{\}/);
  assert.match(js, /const isSoon = error => error && \(error\.status === 501 \|\| error\.reason === 'coming-soon'\)/);
  assert.match(js, /clipAudioBox\.checked = false;/, 'clip audio stays muted by default');
  assert.match(js, /logEvent\('carousel_export'/);
  assert.match(js, /logEvent\('data'/);
  assert.match(js, /logEvent\('frames'/);
  assert.doesNotMatch(js, /espncdn/, 'no ESPN image hosts in the page');
  assert.match(css, /\.rm-work\.is-gallery \.rm-stage \{ display: none; \}/);
  assert.doesNotMatch(css.slice(css.indexOf('/* ── Data formats (reels-fmt-ui)')), /#(?:[89a-f][0-9a-f]){1}[0-6][0-9a-f][89a-f][0-9a-f]\b/i, 'no purple hex in the new CSS');
});

// ─── Mocked fetch: the request shapes the page sends get fixture answers ───
t('mocked fetch: games -> game-data -> plan brief, all from the contract fixtures', async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = { games: fx('games-nfl.response.json'), 'game-data': fx('game-data-401873063.response.json'), athlete: body.athleteId ? fx('athlete-2330.response.json') : fx('athlete-search.response.json'), 'archive-research': fx('archive-research-2330.response.json'), 'frame-pick': fx('frame-pick.response.json') }[body.mode];
    return { ok: Boolean(answer), status: answer ? 200 : 501, json: async () => answer || { ok: false, reason: 'coming-soon', mode: body.mode } };
  };
  const api = async body => { const r = await fetchMock('/api/reel-maker', { method: 'POST', body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw Object.assign(new Error('x'), { status: r.status, reason: d.reason }); return d; };
  const games = await api({ mode: 'games', sport: 'nfl', when: 'recent' });
  assert.ok(G.sortGames(games.games).every(g => G.gameRowHtml(g).includes('role="radio"')));
  const { digest } = await api({ mode: 'game-data', sport: 'nfl', eventId: '401873063' });
  assert.equal(TL.validateDigest(digest).ok, true);
  const brief = G.briefFromGame(digest, G.keyPlays(digest), TL);
  assert.ok(brief.length > 40 && brief.length <= 2400);
  const search = await api({ mode: 'athlete', sport: 'nfl', query: 'tom brady' });
  const athlete = (await api({ mode: 'athlete', sport: 'nfl', athleteId: search.candidates[0].athleteId })).athlete;
  const research = await api({ mode: 'archive-research', sport: 'nfl', athleteId: '2330', name: 'Tom Brady', angle: '5 best moments' });
  const moments = G.pickMoments(research.candidates, research.angle, 5);
  const tl = TL.normalizeTimeline({ v: 1, size: [1080, 1920], format: 'archive', beats: [{ id: 'b1', kind: 'point', refs: moments[0].cite }], outputs: ['reel', 'carousel'], data: { game: null, athlete, archive: { athleteId: '2330', angle: research.angle, sources: [], photos: [], moments, thin: true } } });
  assert.deepEqual(TL.validateTimeline(tl).errors, [], 'the page-shaped archive timeline validates');
  const pick = await api({ mode: 'frame-pick', clipUrl: '', segment: { in: 0, out: 6 }, frames: [], times: G.sampleTimes({ in: 0, out: 6 }), budgetUsd: F.PRICES.framePickCap });
  assert.ok(G.framesFromPick(pick, G.sampleTimes({ in: 0, out: 6 })));
  await assert.rejects(() => api({ mode: 'nope' }), e => e.status === 501);
  assert.deepEqual(calls.map(c => c.mode), ['games', 'game-data', 'athlete', 'athlete', 'archive-research', 'frame-pick', 'nope']);
});

for (const [name, fn] of tests) {
  try { await fn(); n += 1; } catch (error) { console.error(`FAIL ${name}\n`, error); process.exitCode = 1; }
}
console.log(`reels gallery ui: ${n}/${tests.length} passed`);
