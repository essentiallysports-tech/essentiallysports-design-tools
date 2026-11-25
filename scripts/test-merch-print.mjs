// Merch Designs print engine (merch-print.js): print sizing from the template's
// area and DPI, the checks, the ES wordmark placement, colours on the garment,
// the phone canvas cap and the no-AI concepts. Pure layout (no browser).
// Run: node scripts/test-merch-print.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const P = require('../merch-print.js');
const R = require('../merch-rules.js');

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); } }
const TEE = { templateId: 't1', region: 'front', pixelsWidth: 3600, pixelsHeight: 4800, dpi: 300, garmentColor: '#FFFFFF' };
const roster = (extra = {}) => ({ id: 'r', collection: 'replay', title: 'Roll call', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#000000' }, garment: { color: '#FFFFFF', name: 'White' }, align: 'left', blanks: ['tee'], rights: [],
  stack: ['KOBE', 'SMUSH', 'LUKE', 'KWAME', 'MIHM'].map((t, i) => ({ text: t, size: 'big', fill: i % 2 ? 'b' : 'a', ink: i % 2 ? 'ink' : 'white' })), ...extra });
const ids = list => Object.fromEntries(list.map(c => [c.id, c]));

test('the canvas is the print area at its own pixels and DPI', () => {
  const s = P.layout(roster(), TEE);
  assert.equal(s.w, 3600); assert.equal(s.h, 4800); assert.equal(s.dpi, 300);
  assert.equal(s.inW, 12); assert.equal(s.inH, 16);
  const s2 = P.layout(roster(), { ...TEE, pixelsWidth: 1800, pixelsHeight: 2400, dpi: 150 });
  assert.equal(s2.w, 1800);
  // Same inches -> same physical design size at either DPI (within a pixel).
  assert.ok(Math.abs(s.design.w / s.dpi - s2.design.w / s2.dpi) < 0.02);
});
test('missing spec falls back to the blank default area', () => {
  const s = P.layout(roster(), {});
  assert.deepEqual([s.w, s.h, s.dpi], [1800, 2400, 150]);
});
test('design is compact mid-chest, inside the area', () => {
  const s = P.layout(roster(), TEE);
  const c = ids(P.checksFor(s));
  assert.equal(c.area.ok, true);
  assert.ok(s.design.w / s.w <= 0.56 && s.design.w / s.w >= 0.3, `width ratio ${s.design.w / s.w}`);
  assert.ok(Math.abs(s.design.x + s.design.w / 2 - s.w / 2) < 2, 'centred');
  assert.ok(s.design.y > s.dpi, 'below the collar wordmark');
});
test('pills only: the design has no wordmark, blocks or shapes', () => {
  const s = P.layout(roster(), TEE);
  assert.ok(s.items.every(i => i.type === 'pill'));
  assert.equal(P.checks(roster(), TEE).find(c => c.id === 'logo'), undefined);
});
test('ES wordmark is its own print, fitted to the chosen area', () => {
  const sleeve = P.logoLayout({ templateId: 't1', region: 'sleeve', pixelsWidth: 600, pixelsHeight: 450, dpi: 150, garmentColor: '#FFFFFF' });
  const l = sleeve.items[0];
  assert.equal(sleeve.items.length, 1);
  assert.equal(l.type, 'logo'); assert.equal(l.variant, 'blue');
  assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= 600 && l.y + l.h <= 450);
  assert.ok(Math.abs(l.w / l.h - 258 / 31) < 0.1, 'keeps the wordmark proportions');
  assert.equal(Math.round(l.x + l.w / 2), 300, 'centred');
  assert.ok(l.w <= 3 * 150, 'never wider than 3 in');
  assert.equal(P.logoLayout({ pixelsWidth: 600, pixelsHeight: 450, dpi: 150, garmentColor: '#0A7DFA' }).items[0].variant, 'white', 'white wordmark on ES blue');
  const tall = P.logoLayout({ pixelsWidth: 300, pixelsHeight: 1200, dpi: 300 }).items[0];
  assert.ok(tall.w <= 300 && tall.h < 60, 'fits a narrow label');
  assert.deepEqual(P.blocking(P.logoChecks(sleeve)), []);
  assert.equal(P.blocking(P.logoChecks(P.logoLayout({ pixelsWidth: 40, pixelsHeight: 10, dpi: 150 }))).length, 1, 'too small to print');
  assert.equal(P.blocking(P.logoChecks(sleeve, { semiPixels: 3 }))[0].id, 'pixels');
});
test('pills: one row per word, rows touch, alternating the team pair', () => {
  const s = P.layout(roster(), TEE);
  const pills = s.items.filter(i => i.type === 'pill');
  assert.equal(pills.length, 5);
  assert.equal(pills[0].bg, '#552583'); assert.equal(pills[1].bg, '#FDB927');
  assert.equal(pills[0].ink, '#FFFFFF'); assert.equal(pills[1].ink, '#000000');
  for (let i = 1; i < pills.length; i++) assert.ok(pills[i].y <= pills[i - 1].y + pills[i - 1].h + 2, 'touching rows');
  assert.ok(pills.every(p => p.x === pills[0].x), 'left aligned');
  const centred = P.layout(roster({ align: 'center' }), TEE).items.filter(i => i.type === 'pill');
  assert.ok(new Set(centred.map(p => Math.round(p.x + p.w / 2))).size <= 2, 'centred stack');
});
test('small name lines are smaller; long big rows wrap', () => {
  const c = roster({ stack: [{ text: 'THE DOME PATROL WAS THE BEST', size: 'big', fill: 'a', ink: 'b' }, { text: 'SAM MILLS', size: 'small', fill: 'b', ink: 'ink' }] });
  const pills = P.layout(c, TEE).items.filter(i => i.type === 'pill');
  assert.ok(pills.length >= 3, 'wrapped');
  const small = pills.find(p => p.small);
  assert.ok(small.size < pills[0].size * 0.5);
});
test('colours on the garment: lost boxes are swapped, shirt-colour type is knocked out', () => {
  const navy = '#041E42';
  const c = roster({ palette: { a: navy, b: '#D9DCE1', ink: navy }, garment: { color: navy }, stack: [{ text: 'PRIME', size: 'big', fill: 'b', ink: 'a' }, { text: 'TIME', size: 'big', fill: 'a', ink: 'white' }] });
  const s = P.layout(c, { ...TEE, garmentColor: navy });
  const [p1, p2] = s.items.filter(i => i.type === 'pill');
  assert.equal(p1.knockout, true, 'navy type on a navy shirt = knockout');
  assert.notEqual(p2.bg, navy, 'navy box on a navy shirt is swapped');
  assert.ok(ids(P.checksFor(s)).garment.ok);
});
test('white art on a white shirt fails the garment check', () => {
  const s = P.layout(roster(), TEE);
  const bad = { ...s, items: s.items.map(i => (i.type === 'pill' ? { ...i, bg: '#FFFFFF' } : i)) };
  const c = ids(P.checksFor(bad));
  assert.equal(c.garment.level, 'error');
  assert.match(c.garment.text, /disappears/);
});
test('a number is a pill like any other word (no blocks)', () => {
  const c = roster({ stack: [{ text: '3', size: 'big', fill: 'b', ink: 'a' }], palette: { a: '#041E42', b: '#D9DCE1', ink: '#041E42' } });
  const s = P.layout(c, { ...TEE, garmentColor: '#041E42' });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].type, 'pill');
  assert.equal(s.items[0].knockout, true);
  assert.ok(ids(P.checksFor(s)).area.ok);
});
test('min text size, effects, DPI and see-through pixel checks', () => {
  const tiny = roster({ stack: [{ text: 'BIG', size: 'big' }, ...Array.from({ length: 11 }, (_, i) => ({ text: `NAME NUMBER ${i} LONG LINE`, size: 'small' }))] });
  const c1 = ids(P.checks(tiny, { ...TEE, pixelsWidth: 450, pixelsHeight: 450, dpi: 150 })); // a 3 in pocket print
  assert.equal(c1['text-size'].level, 'error');
  const s = P.layout(roster(), TEE);
  assert.equal(ids(P.checksFor({ ...s, items: [...s.items, { type: 'pill', x: 0, y: 0, w: 10, h: 10, bg: '#552583', ink: '#FFFFFF', size: 200, opacity: 0.5 }] })).effects.level, 'error');
  assert.equal(ids(P.checksFor(s, { semiPixels: 12 })).pixels.level, 'error');
  assert.ok(ids(P.checksFor(s, { semiPixels: 0 })).pixels.ok);
  const lowDpi = ids(P.checks(roster(), { ...TEE, dpi: 100, pixelsWidth: 1200, pixelsHeight: 1600 }));
  assert.equal(lowDpi.dpi.level, 'error');
  assert.ok(ids(P.checks(roster(), TEE)).dpi.ok);
  assert.equal(P.blocking(P.checks(roster(), TEE)).length, 0);
});
test('outside the print area is an error', () => {
  const s = P.layout(roster(), TEE);
  const out = { ...s, items: s.items.map((i, n) => (n === 0 ? { ...i, x: s.w - 10 } : i)) };
  assert.equal(ids(P.checksFor(out)).area.level, 'error');
});
test('phone canvas cap (16.7 MP) shrinks only on phones', () => {
  const big = { pixelsWidth: 5400, pixelsHeight: 7200, dpi: 300 };
  assert.equal(P.canvasPlan(big, { phone: false }).scale, 1);
  const ph = P.canvasPlan(big, { phone: true });
  assert.ok(ph.scale < 1 && ph.w * ph.h <= P.PHONE_MAX_PIXELS && !ph.full && /desktop/.test(ph.note));
  assert.equal(P.canvasPlan({ pixelsWidth: 1800, pixelsHeight: 2400, dpi: 150 }, { phone: true }).scale, 1);
  assert.equal(ids(P.checksFor(P.layout(roster(), big), { renderScale: 0.4 })).dpi.level, 'warn');
});
test('team palettes come from the repo team lists', () => {
  const lal = P.teamPalette('Los Angeles Lakers');
  assert.match(lal.a, /^#[0-9A-F]{6}$/);
  assert.notEqual(lal.a, lal.b);
  assert.deepEqual(P.teamPalette(null), R.ES_PALETTE);
  assert.deepEqual(P.teamPalette('No Such Team'), R.ES_PALETTE);
  assert.equal(P.colorName('#FFFFFF'), 'White');
  assert.equal(P.colorName('#0B2240'), 'Navy');
});
test('fallback concepts: contract shape, collections, rights, all print-ready', () => {
  const text = 'Remember the 2005 Los Angeles Lakers: Kobe Bryant, Smush Parker, Luke Walton, Kwame Brown and Brian Cook. "Ball don\'t lie," said Rasheed Wallace. Calvin Johnson, known as Megatron, wore 81.';
  const list = P.fallbackConcepts(text);
  assert.equal(list.length, 4);
  const cols = list.map(c => c.collection);
  assert.ok(cols.includes('replay') && cols.includes('quote') && cols.includes('nickname'), cols.join(','));
  for (const c of list) {
    assert.ok(c.id && c.title && Array.isArray(c.stack) && c.stack.length, 'shape');
    assert.ok(R.COLLECTION_IDS.includes(c.collection));
    assert.ok(['left', 'center'].includes(c.align));
    assert.ok(c.garment && /^#[0-9A-F]{6}$/.test(c.garment.color) && c.garment.name);
    assert.ok(['a', 'b', 'ink'].every(k => /^#[0-9A-F]{6}$/i.test(c.palette[k])));
    c.stack.forEach(r => { assert.ok(['big', 'small'].includes(r.size)); assert.ok(R.COLOR_KEYS.includes(r.fill) && R.COLOR_KEYS.includes(r.ink)); });
    c.rights.forEach(r => assert.ok(R.RIGHTS_KINDS.includes(r.kind)));
    assert.deepEqual(P.blocking(P.checks(c, { ...TEE, garmentColor: c.garment.color })), [], `${c.title} fails print checks`);
  }
  const q = list.find(c => c.collection === 'quote');
  assert.equal(q.stack[1].text, '— Rasheed Wallace');
  assert.ok(R.scanConcept(q, { source: text }).ok, 'the quote is exact and attributed');
  assert.ok(list.find(c => c.collection === 'replay').rights.some(r => r.kind === 'name' && r.text === 'Kobe Bryant'));
});
test('fallback concepts: no team, no names -> ES core lines still come back', () => {
  const list = P.fallbackConcepts('');
  assert.ok(list.length >= 2);
  assert.ok(list.every(c => c.collection === 'core' && c.team === null));
  assert.equal(P.fallbackConcepts({ text: 'Big win tonight', team: 'Detroit Pistons' })[0].team.name, 'Detroit Pistons');
});

fails.forEach(f => console.log(`FAIL ${f}`));
console.log(`merch print: ${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
