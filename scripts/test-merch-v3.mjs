// Merch v3: the person's whole line, variations, size/position fit, all mockups.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../merch-print.js');
const FW = require('../netlify/functions/_fourthwall.js');
let n = 0; const ok = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const TEE = { pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 };
const line = 'We center fans in everything we make for the game';

ok('Your words keeps the whole sentence, word for word', () => {
  const c = P.yourWords(line);
  assert.ok(c);
  assert.equal(c.stack.map(r => r.text).join(' '), line.toUpperCase());
  assert.ok(P.hasLine(c, line));
  assert.ok(c.stack.every(r => r.text.length <= 60));
});
ok('fallback designs lead with Your words', () => {
  assert.equal(P.fallbackConcepts(line)[0].label, 'Your words');
});
ok('hasLine spots a shortened line', () => {
  assert.equal(P.hasLine({ stack: [{ text: 'WE CENTER' }, { text: 'FANS' }] }, line), false);
});
ok('a long article keeps only its first sentence, still whole', () => {
  const t = 'The Lakers won again tonight. ' + 'More words follow here and keep going for a long time. '.repeat(4);
  assert.equal(P.mainLine(t), 'The Lakers won again tonight');
});
ok('variations: different layouts of the same words', () => {
  const base = P.yourWords(line);
  const v = P.variations(base);
  assert.ok(v.length >= 5);
  assert.equal(new Set(v.map(x => x.id)).size, v.length);
  v.forEach(x => {
    assert.equal(x.stack.map(r => r.text).join(' ').replace(/\s+/g, ' '), line.toUpperCase(), x.variant);
    assert.ok(x.stack.length <= 9);
    assert.equal(x.variantOf, base.id);
    assert.equal(P.checks(x, TEE).filter(c => c.level === 'error').length, 0, x.variant);
  });
});
ok('variations keep a small attribution row last', () => {
  const q = { id: 'q', title: 'Q', collection: 'quote', team: null, palette: { a: '#0A7DFA', b: '#FFFFFF', ink: '#000000' }, garment: { color: '#FFFFFF' }, stack: [{ text: 'NOBODY BELIEVED IN US', size: 'big', fill: 'a', ink: 'white' }, { text: '— COACH', size: 'small', fill: 'b', ink: 'ink' }] };
  P.variations(q).forEach(x => assert.equal(x.stack[x.stack.length - 1].text, '— COACH'));
});
ok('fit: size scales the print, position moves it', () => {
  const c = P.yourWords(line);
  const a = P.layout(c, TEE);
  const big = P.layout({ ...c, fit: { scale: 1.4 } }, TEE);
  const small = P.layout({ ...c, fit: { scale: 0.7 } }, TEE);
  assert.ok(big.design.w > a.design.w && small.design.w < a.design.w);
  const low = P.layout({ ...c, fit: { topIn: 4 } }, TEE);
  assert.equal(low.design.y, 600);
  assert.ok(big.items.every(i => i.x >= 0 && i.x + i.w <= TEE.pixelsWidth));
});
ok('fit is clamped to safe values', () => {
  assert.deepEqual(P.fitOf({ fit: { scale: 9, topIn: -3 } }), { scale: 1.6, topIn: 0.5 });
  assert.deepEqual(P.fitOf({}), { scale: 1, topIn: null });
});
ok('splitWords modes', () => {
  assert.deepEqual(P.splitWords('the king of the court', 'word'), ['THE KING', 'OF THE COURT']);
  assert.ok(P.splitWords(line, 'line').every(r => r.length <= 24));
});
ok('Fourthwall product: every mockup, variant images labelled by colour, no repeats', () => {
  const p = FW.normalizeProduct({ id: 'p', images: [{ url: 'a' }, { url: 'b' }], variants: [
    { id: 'v1', attributes: { color: { name: 'White' }, size: { name: 'M' } }, images: [{ url: 'a' }, { url: 'w1' }] },
    { id: 'v2', attributes: { color: { name: 'Black' }, size: { name: 'L' } }, images: [{ url: 'k1' }, { url: 'k2' }] },
  ] });
  assert.deepEqual(p.images.map(i => i.url), ['a', 'b', 'w1', 'k1', 'k2']);
  assert.equal(p.images.find(i => i.url === 'k2').color, 'Black');
  assert.equal(p.variants[1].color, 'Black');
});
console.log(`merch v3: ${n} checks passed`);

// ─── merch4 engine ──────────────────────────────────────────────────────
ok('pills touch without overlapping (even padding)', () => {
  const c = P.yourWords(line);
  const pills = P.layout(c, TEE).items.filter(i => i.type === 'pill');
  for (let i = 1; i < pills.length; i++) assert.ok(Math.abs(pills[i].y - (pills[i - 1].y + pills[i - 1].h)) <= 1, 'touching, no overlap');
});
ok('navy second colour on a dark tee becomes a white pill with team-colour text', () => {
  const c = { palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, stack: [{ text: 'THEY', size: 'big', fill: 'a', ink: 'white' }, { text: 'DONT', size: 'big', fill: 'b', ink: 'white' }] };
  const pills = P.layout(c, { ...TEE, garmentColor: '#020718' }).items;
  assert.equal(pills[1].bg, '#FFFFFF'); assert.equal(pills[1].ink, '#0A7DFA');
  assert.equal(P.checks(c, { ...TEE, garmentColor: '#020718' }).find(x => x.id === 'garment').level, 'ok');
});
ok('Pro elements are laid out inside the area; Basic strips them', () => {
  const c = { mode: 'pro', ...P.yourWords(line), elements: [{ type: 'number', text: '23', style: 'outline', color: 'b', position: 'behind' }, { type: 'icon', name: 'crown', position: 'above', color: 'a' }, { type: 'rule', position: 'below', color: 'a', weight: 'thick' }, { type: 'block', position: 'behind', color: 'a' }] };
  const s = P.layout(c, TEE);
  assert.deepEqual(s.items.filter(i => i.type !== 'pill').map(i => i.type).sort(), ['icon', 'number', 'rect']);
  assert.equal(P.checks(c, TEE).filter(x => x.level === 'error').length, 0);
  assert.equal(P.layout({ ...c, mode: 'basic' }, TEE).items.filter(i => i.type !== 'pill').length, 0);
  assert.equal(P.elementsOf({ mode: 'pro', elements: [{ type: 'icon', name: 'nba-logo', position: 'above' }, { type: 'number', text: '123' }] }).length, 0);
  assert.ok(P.ICONS.includes('basketball') && P.ELEMENT_TYPES.rule.includes('between'));
});
ok('photoFor picks the nearest template colour with photos', () => {
  const colors = [{ name: 'White', hex: '#ffffff', photos: ['w.jpg'] }, { name: 'French Navy', hex: '#020718', photos: ['n.jpg'] }, { name: 'Red', hex: '#ed0739', photos: [] }];
  assert.equal(P.photoFor(colors, '#0C2340').url, 'n.jpg');
  assert.equal(P.photoFor(colors, '#C8102E').url, 'n.jpg'.replace('n', 'n')); // red has no photos -> nearest with photos
  assert.equal(P.photoFor([], '#fff'), null);
});
console.log(`merch v3 + merch4 engine: ${n} checks passed`);
