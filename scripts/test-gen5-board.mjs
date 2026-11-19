// gen5 (agent B): Generate's looks rebuilt from the ES Figma board, the owner's
// live-test fixes (sport tag as a name, chopped story point, orphan rule,
// mid-phrase box breaks, team-like card titles, one look three times), and the
// AI side (Opus director, a judge that sees ES board references, a per-run cap).
// No network, no AI: the Gateway is mocked.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require(path.resolve('frameup-compose.js'));
const composer = require(path.resolve('netlify/functions/_composer.js'));
const REFS = require(path.resolve('netlify/functions/_board-refs.js'));

// ── 1. Phrase breaks: one idea a box line ─────────────────────────────────
{
  // A measuring stub: 10px a character (the renderer's canvas in the browser).
  const g = { measureText: t => ({ width: String(t).length * 10 }) };
  const wrapAt = (text, width, lines = 4, keep = []) => C._test.phraseWrap(g, text, width, 0, lines, keep);
  const sack = wrapAt('PERFECT TIMING TO SACK SANDERS!', 90);
  assert.ok(sack.lines.every(l => !/\b(?:TO|THE|A)$/.test(l)), `never ends a line on a joining word: ${sack.lines.join(' / ')}`);
  assert.ok(sack.lines.some(l => /^TO SACK/.test(l)), `breaks before "TO": ${sack.lines.join(' / ')}`);
  const liv = wrapAt('LIV GOLF PAID PLAYERS MILLIONS BEFORE BANKRUPTCY AS UK SUPPLIERS WENT UNPAID', 300, 4, ['LIV Golf', 'UK suppliers']);
  assert.ok(liv.lines.every(l => !/\bUK$/.test(l) && !/^SUPPLIERS/.test(l)), `"UK SUPPLIERS" stays together: ${liv.lines.join(' / ')}`);
  assert.ok(liv.lines.every(l => !/\b(?:BEFORE|AS)$/.test(l)), `breaks before "BEFORE" / "AS", not after: ${liv.lines.join(' / ')}`);
  assert.ok(liv.worst < 9, 'no phrase split');
  const name = wrapAt('STEVE KERR ON THE WARRIORS SLOW START', 120, 4, ['Steve Kerr']);
  assert.ok(name.lines.some(l => /STEVE KERR/.test(l)), 'a name never splits');
  // The board keeps one word alone only when it is a real line ("TEAM"), never a stray "WE".
  const we = wrapAt('WE HAVE TO BE BETTER, AND IT STARTS WITH ME.', 220);
  assert.notEqual(we.lines[0], 'WE', `no stray two-letter first line: ${we.lines.join(' / ')}`);
}

// ── 2. Board looks: measured structure, team colours, texture ────────────
const shared = {
  headline: 'Josh Allen goes over 1000+ rushing yards', name: 'Josh Allen', kicker: '',
  number: { value: '1000', suffix: '+', label: 'RUSHING YARDS', factId: 'f1' }, numbers: [{ value: '1000', display: '1000+', label: 'RUSHING YARDS', factId: 'f1' }],
  photo: { src: '/p/allen.jpg', kind: 'action' }, photos: [{ src: '/p/allen-2.jpg', kind: 'portrait' }], cutout: { src: '/c/allen.png', fromPhoto: '/p/allen.jpg' },
  quote: { text: 'We have to be better.', by: 'Josh Allen' },
  teamColors: ['#00338D', '#C60C30'], palette: C.makePalette(['#00338D', '#C60C30']), facts: [{ id: 'f1', text: '1000+ rushing yards' }],
};
{
  const stats = C.build('stat-stack', shared, 0);
  const num = stats.layers.find(l => l.type === 'number');
  assert.ok(num.board && num.overlap > 0.3, 'the board number: full-size "+", the head may cover its foot');
  assert.ok(num.y >= C.SAFE + C.LOGO.h + C.SAFE, 'the number sits under the ES mark zone');
  const cut = stats.layers.find(l => l.type === 'cutout');
  assert.ok(cut.bleed && stats.layers.indexOf(cut) > stats.layers.indexOf(num), 'the player is cut out over the number and bleeds off the foot');
  const label = stats.layers.find(l => l.box?.style === 'board');
  assert.equal(label.box.color, '#FFFFFF', 'a white label box');
  assert.ok(stats.layers.some(l => l.shape === 'grain' && l.kind === 'grit'), 'print grit texture');
  assert.equal(stats.layers[0].fill.colors[0], '#00338D', 'the team colour is the field (ES blue stays the mark)');
  assert.ok(C.checkScene(stats).ok);

  const cover = C.build('cover-boxes', shared, 0);
  const head = cover.layers.find(l => l.role === 'headline');
  assert.equal(head.size, C.BOARD.head, 'cover headline at the board size (140px)');
  assert.equal(head.box.style, 'board');
  assert.ok(head.phrase && head.keep.includes('Josh Allen'), 'phrase breaks, names kept whole');
  assert.equal(cover.layers.find(l => l.type === 'photo').src, '/p/allen.jpg', 'a cover leads with the action photo');

  const quote = C.build('quote-boxes', shared, 0);
  assert.equal(quote.layers.find(l => l.type === 'photo').src, '/p/allen-2.jpg', 'a quote uses the speaker portrait when A marks one');
  assert.ok(quote.layers.find(l => l.role === 'quote').quoteMarks, 'board quote squares');

  // A photo agent A marks as not the person is never picked over the hero.
  assert.equal(C.pickPhoto({ photo: { src: 'a' }, photos: [{ src: 'b', kind: 'portrait', verified: false }] }, ['portrait']).src, 'a');

  // Browns: the darker team colour boxes the brighter one (board 2335:1869).
  const browns = C.boardColors({}, { teamColors: ['#311D00', '#FF3C00'] });
  assert.equal(browns.box, '#311D00');
  assert.equal(browns.boxInk, '#FF3C00');
  // Lakers: purple box, gold type.
  const lakers = C.boardColors({}, { teamColors: ['#552583', '#FDB927'] });
  assert.equal(lakers.box, '#552583');
  assert.equal(lakers.boxInk, '#FDB927');

  // Cascades are deliberate (cap heights), never a few stray pixels.
  C.CASCADES.filter(Boolean).forEach(c => assert.ok(c.filter(n => n > 0).every(n => n >= 0.25), 'steps of a quarter cap or more'));

  // Name behind the player: only a surname that fits.
  assert.ok(C.fits('name-stack', shared));
  assert.ok(!C.fits('name-stack', { ...shared, name: 'Shai Gilgeous-Alexander' }), 'a long surname does not get the giant name look');
  // Record alert needs a cut-out and a record story.
  assert.ok(!C.fits('record-alert', { ...shared, cutout: null, cutouts: [], headline: 'Allen breaks the record' }));
}

// ── 3. Owner's live test (LIV brief) as classes ───────────────────────────
{
  // (3) An orphan accent rule never stays without its words.
  const mag = C.build('magazine-cover', { headline: 'LIV Golf paid players millions', kicker: '', photo: { src: '/p/liv.jpg' } }, 0);
  assert.ok(!mag.layers.some(l => l.type === 'shape' && l.shape === 'rect' && l.h <= 14 && l.w <= 300), 'no stray short rule');
  // A rule under real words stays.
  const kept = C.dropOrphanRules([{ type: 'text', text: 'HELLO', x: 50, y: 50, w: 400, h: 100 }, { type: 'shape', shape: 'rect', x: 50, y: 170, w: 200, h: 10 }]);
  assert.equal(kept.length, 2);

  const brief = 'LIV Golf paid players millions before bankruptcy as UK suppliers went unpaid.\nSport: Golf';
  const read = composer.readCreative(brief);
  // "UK suppliers" in a golf story is not Kentucky.
  assert.deepEqual(read.teams.map(t => t.name), ['LIV Golf']);
  // (2) The headline keeps the point (the suppliers), in short and long cuts.
  const st = read.stories[0];
  assert.match(composer.codeHeadline(st.text, st, read, { long: true }), /UNPAID/i);
  assert.match(composer.codeHeadline(st.text, st, read, {}), /UNPAID/i);
  // A cut that drops nothing important stays short.
  const allen = composer.readCreative('Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL');
  assert.equal(composer.codeHeadline(allen.stories[0].text, allen.stories[0], allen, { long: true }), 'Josh Allen goes over 1000+ rushing yards');
  const unc = composer.readCreative('Bill Belichick\'s North Carolina debut ends in a loss as the Tar Heels fall to TCU.\nSport: CFB');
  assert.match(composer.codeHeadline(unc.stories[0].text, unc.stories[0], unc, {}), /in a loss$/);
  // (1) A trading card needs a named person: the name strip is never a sport.
  const input = composer.inputsFor({ story: 's1', archetype: 'trading-card', name: 'GOLF', headline: 'LIV Golf paid players millions', photo: { src: '/p/x.jpg' } }, read, {});
  assert.equal(input.name, '', 'no person, no name (the card title is not a name)');
  assert.ok(!C.fits('trading-card', input), 'no trading card without a named person');
  // (5) Card titles never read as a team.
  assert.equal(composer.cardTitle('Unpaid Bills Cover', read, 'cover-boxes'), C.BY_ID['cover-boxes'].name);
  assert.equal(composer.cardTitle('NFL money post', read, 'cover-boxes'), C.BY_ID['cover-boxes'].name);
  assert.equal(composer.cardTitle('Suppliers left unpaid', read, 'cover-boxes'), 'Suppliers left unpaid');
  const bills = composer.readCreative('Josh Allen leads the Bills past the Chiefs.\nSport: NFL');
  assert.equal(composer.cardTitle('Bills night cover', bills, 'cover-boxes'), 'Bills night cover', 'the brief\'s own team may be named');
  // "72% from the field" is a fact (the headline keeps it), and a team ranking is no stats post.
  const jokic = composer.readCreative('Nikola Jokic shoots 72% from the field in a triple-double: 31 points, 14 rebounds and 11 assists.\nSport: NBA');
  assert.ok(jokic.facts.some(f => f.kind === 'pct' && f.value === '72'));
  assert.match(composer.codeHeadline(jokic.stories[0].text, jokic.stories[0], jokic, { long: true }), /72%/);
  assert.ok(!C.fits('stat-stack', { ...C.normalizeInput({ headline: 'Arch Manning faces his biggest test', cutout: { src: '/c.png' }, photo: { src: '/p.jpg' } }), number: { prefix: '#', value: '3', label: '' } }), 'No. 3 Texas is not a stats post');
  // A second reading never drops the subject ("UK suppliers went unpaid" alone).
  assert.ok(composer.codeHeadline(st.text, st, read, { all: true, long: true }).every(h => /LIV/.test(h)), 'every LIV reading names LIV Golf');
  // Quote speaker is the person, not the team.
  const kerr = composer.readCreative('Steve Kerr on the Warriors\' slow start: "We have to be better, and it starts with me."\nSport: NBA');
  assert.equal(kerr.quotes[0].by, 'Steve Kerr');
}

// ── 4. Code plan: board looks first, varied families (no AI) ──────────────
{
  const photos = person => [1, 2, 3].map(i => ({ url: `https://img/${encodeURIComponent(person)}-${i}.jpg`, kind: i === 1 ? 'action' : 'portrait', person, score: 1 }));
  composer.setAssetService({ findPhotos: async a => (a.person ? { ok: true, photos: photos(a.person), cutouts: [{ url: `https://img/${encodeURIComponent(a.person)}-1.png`, fromPhoto: `https://img/${encodeURIComponent(a.person)}-1.jpg`, person: a.person }] } : { ok: true, photos: [] }) });
  composer.PLAN_CACHE?.clear?.();
  const run = async brief => (await composer.plan({ brief, found: { articles: [] }, want: 4, director: false, lessons: [], cacheKey: `t5|${brief}` })).directions;
  const allenSet = await run('Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL');
  assert.equal(allenSet.length, 4);
  assert.ok(allenSet.some(d => d.archetype === 'stat-stack'), `a board stats post: ${allenSet.map(d => d.archetype)}`);
  assert.ok(allenSet.some(d => d.archetype === 'cover-boxes'), 'a board cover');
  assert.ok(new Set(allenSet.map(d => composer.familyOf(d.archetype))).size >= 3, 'three ES families or more');
  assert.ok(allenSet.every(d => composer.tierOf(d.archetype) <= 2), 'no tier-3 looks when the board looks fit');
  const kerrSet = await run('Steve Kerr on the Warriors\' slow start: "We have to be better, and it starts with me."\nSport: NBA');
  assert.ok(kerrSet.some(d => d.archetype === 'quote-boxes'), 'a quote story gets the board quote');
  assert.equal(composer.tierOf('trading-card'), 3, 'trading cards are a last resort');
  assert.equal(composer.tierOf('stat-stack'), 1);
}

// ── 5. AI: Opus director, judge with board references, the run cap ───────
{
  assert.equal(composer.artDirectorTier(''), 'top');
  assert.ok(composer.RUN_CAP_USD <= 0.25);
  // Director spent ~$0.07: the Sonnet judge (and its second look) fit the cap.
  assert.equal(composer.judgeTierFor(0.07), 'best');
  // A run that already spent most of its cap judges on Haiku.
  assert.equal(composer.judgeTierFor(0.22), 'main');
  assert.ok(composer.judgeEstimate('best', 12, 3, 4) < 0.06, 'a Sonnet judge pass is a few cents');
  // References: one per family first, real board posts only.
  const refs = REFS.refsFor(['stats', 'cover', 'quote', 'stats'], 3);
  assert.deepEqual(refs.map(r => r.family), ['stats', 'cover', 'quote']);
  assert.ok(refs.every(r => /^2335:\d+$/.test(r.node) && r.data.length > 4000), 'board node ids and image data');

  // The judge sends the references with the designs (mocked Gateway).
  const gw = require(path.resolve('netlify/functions/_ai-gateway.js'));
  const keep = { aiText: gw.aiText, gatewayConfigured: gw.gatewayConfigured };
  let sent = null;
  gw.gatewayConfigured = () => true;
  gw.aiText = async req => { sent = req; return { text: JSON.stringify({ directions: [{ id: 'd1', best: 'd1c1', scores: { d1c1: { hierarchy: 4, focal: 4, readability: 5, brand: 4, originality: 4, image: 4, labels: 5, stats: 5, board: 4 } }, repairs: [] }] }), cost: 0.031, model: 'anthropic/claude-sonnet-5.5' }; };
  const img = `data:image/jpeg;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
  const verdict = await composer.judge({ brief: 'x', sets: [{ direction: 'd1', archetype: 'stat-stack', items: [{ id: 'd1c1', image: img }] }], spent: 0.06 });
  gw.aiText = keep.aiText; gw.gatewayConfigured = keep.gatewayConfigured;
  assert.equal(verdict.source, 'vision');
  assert.equal(sent.tier, 'best');
  const texts = sent.messages[0].content.filter(c => c.type === 'text').map(c => c.text);
  assert.ok(texts.some(t => /^ref-stats \(ES board 2335:/.test(t)), 'a board stats post goes with a stats design');
  assert.ok(/REAL ES posts/.test(texts[0]) && /"board" 1-5/.test(texts[0]), 'the prompt judges against the board');
  assert.ok(verdict.directions[0].scores.d1c1.board === 4, 'the board score is read');
  assert.equal(verdict.refs[0], refs[0].id);
  assert.ok(verdict.refs.length <= 3, 'at most 3 references a judge call');
}

console.log('gen5 board: phrase breaks, board looks, owner fixes, varied plan, board-referenced judge - ok');
