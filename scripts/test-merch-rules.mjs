// Merch Designs rules (merch-rules.js): rights policy and scan, acknowledgement,
// pricing, Fourthwall shapes, sample-mode hosts. No network.
// Run: node scripts/test-merch-rules.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const R = require('../merch-rules.js');
const index = R.buildRightsIndex({ brandKit: require('../brand-kit.js'), vaTeams: require('../video-ads-teams.js').TEAMS });

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); } }
const kinds = list => list.map(i => i.kind);
const concept = (stack, extra = {}) => ({ id: 'c', collection: 'current', team: null, stack: stack.map(t => (typeof t === 'string' ? { text: t, size: 'big', fill: 'a', ink: 'ink' } : t)), rights: [], ...extra });

test('default policy is acknowledge; env can switch to strict, junk is ignored', () => {
  assert.equal(R.RIGHTS_POLICY, 'acknowledge');
  assert.equal(R.policyFrom({}), 'acknowledge');
  assert.equal(R.policyFrom({ MERCH_RIGHTS_POLICY: 'STRICT' }), 'strict');
  assert.equal(R.policyFrom({ MERCH_RIGHTS_POLICY: 'anything' }), 'acknowledge');
});
test('contract ids: collections and rights kinds', () => {
  assert.deepEqual(R.COLLECTION_IDS, ['replay', 'nickname', 'quote', 'core', 'current']);
  assert.deepEqual(R.RIGHTS_KINDS, ['name', 'nickname', 'quote', 'team']);
  assert.deepEqual(R.COLOR_KEYS, ['a', 'b', 'ink', 'white']);
});
test('team index comes from the repo team lists', () => {
  assert.ok(index.teams.length > 150);
  const lakers = index.teams.find(t => t.name === 'Los Angeles Lakers');
  assert.equal(lakers.short, 'Lakers');
  assert.equal(R.teamsIn('LAKERS SHOWTIME', index)[0].name, 'Los Angeles Lakers');
  assert.equal(R.teamsIn('FEEL THE HEAT', index).length, 0, 'a common word alone is not a team');
  assert.equal(R.teamsIn('Miami Heat culture', index)[0].name, 'Miami Heat');
});
test('names in the source and on the design warn (acknowledge)', () => {
  const s = R.scanConcept(concept(['KOBE', 'SMUSH']), { source: 'The Kobe Bryant and Smush Parker Lakers', index });
  assert.ok(s.ok);
  assert.deepEqual(s.warnings.filter(w => w.kind === 'name').map(w => w.text), ['Kobe Bryant', 'Smush Parker']);
  assert.match(s.warnings[0].reason, /right of publicity/);
});
test('strict policy blocks names, teams, nicknames and quotes', () => {
  const s = R.scanConcept(concept(['LAKERS', 'KOBE']), { source: 'Kobe Bryant', index, policy: 'strict' });
  assert.equal(s.ok, false);
  assert.ok(kinds(s.blocked).includes('team') && kinds(s.blocked).includes('name'));
  const n = R.scanConcept(concept(['MEGATRON'], { collection: 'nickname', rights: [{ kind: 'nickname', text: 'Megatron' }] }), { index, policy: 'strict' });
  assert.deepEqual(kinds(n.blocked), ['nickname']);
});
test('league marks, official claims and logos are blocked under every policy', () => {
  for (const policy of ['acknowledge', 'strict']) {
    assert.ok(kinds(R.scanConcept(concept(['NFL', 'SUNDAYS']), { index, policy }).blocked).includes('league-mark'));
    assert.ok(kinds(R.scanConcept(concept(['SUPER BOWL', 'BOUND']), { index, policy }).blocked).includes('league-mark'));
    assert.ok(kinds(R.scanConcept(concept(['OFFICIAL', 'FAN GEAR']), { index, policy }).blocked).includes('official'));
    assert.ok(kinds(R.scanConcept(concept(['FANS™']), { index, policy }).blocked).includes('official'));
    assert.ok(kinds(R.scanConcept(concept(['ANY']), { index, policy, hasImage: true }).blocked).includes('logo'));
  }
});
test('banned words and invented numbers are blocked; core lines need no source', () => {
  assert.ok(kinds(R.scanConcept(concept(['SHOCKING', 'WIN']), { index }).blocked).includes('banned'));
  const n = R.scanConcept(concept(['81', 'POINTS']), { source: 'He scored 80 points', index });
  assert.ok(kinds(n.blocked).includes('number'));
  assert.ok(R.scanConcept(concept(['81', 'POINTS']), { source: 'He scored 81 points', index }).ok);
  assert.ok(R.scanConcept(concept(['WE CENTER', 'FANS'], { collection: 'core' }), { index }).ok);
});
test('quotes must be exact and attributed', () => {
  const src = 'After the game he said: "Today I am the greatest of all time." — A Player';
  const good = concept([{ text: 'TODAY I AM THE GREATEST OF ALL TIME', size: 'big', fill: 'a', ink: 'b' }, { text: '— A Player', size: 'small', fill: 'b', ink: 'a' }], { collection: 'quote' });
  const s = R.scanConcept(good, { source: src, index });
  assert.ok(s.ok, JSON.stringify(s.blocked));
  assert.ok(kinds(s.warnings).includes('quote'));
  const changed = concept([{ text: 'TODAY I AM THE BEST EVER', size: 'big' }, { text: '— A Player', size: 'small' }], { collection: 'quote' });
  assert.ok(kinds(R.scanConcept(changed, { source: src, index }).blocked).includes('quote-source'));
  const noBy = concept([{ text: 'TODAY I AM THE GREATEST', size: 'big' }], { collection: 'quote' });
  assert.match(R.scanConcept(noBy, { source: src, index }).blocked[0].reason, /who said it/);
});
test('acknowledgement must cover every warning', () => {
  const s = R.scanConcept(concept(['KOBE']), { source: 'Kobe Bryant', index });
  const ack = R.ackFor(s, { email: 'designer@example.com', accepted: true, at: '2026-11-25T00:00:00Z' });
  assert.equal(ack.by, 'designer@example.com');
  assert.equal(ack.policy, 'acknowledge');
  assert.match(ack.statement, /Legal should review/);
  assert.ok(R.ackCovers(ack, s));
  assert.equal(R.ackCovers({ ...ack, accepted: false }, s), false);
  assert.equal(R.ackCovers({ ...ack, items: [] }, s), false);
  assert.ok(R.ackCovers(null, R.scanConcept(concept(['WE CENTER']), { index })));
  assert.equal(R.ackCovers(ack, R.scanConcept(concept(['NBA']), { index })), false, 'nothing covers a block');
});
test('price -> profit margin', () => {
  const m = R.marginFor(29.99, 17.5);
  assert.equal(m.margin, 12.49);
  assert.match(m.earnText, /\$12\.49/);
  assert.equal(R.marginFor(18, 17.5).ok, false);
  assert.equal(R.marginFor(500, 17.5).ok, false);
  assert.equal(R.marginFor('x', 17.5).ok, false);
  assert.equal(R.suggestedPrice('tee', 17.5), 29.99);
});
test('templates: eligibility and shape', () => {
  const raw = { productId: 't1', name: 'Tee', priceFrom: { amount: 17.5, currency: 'USD' }, supportsBackendRendering: true, minimumOrdersNumber: 0, productionMethod: 'DTG',
    colorVariants: [{ color: { name: 'White', hex: '#ffffff' }, available: true, sizeVariants: [{ size: 'M', available: true, price: { amount: 17.5, currency: 'USD' } }] }],
    customizableAreas: [{ regionId: 'front', name: 'Front', available: true, supportsBackendRendering: true, productionMethod: 'DTG', dimensions: { dpi: 150, pixelsWidth: 1800, pixelsHeight: 2400 }, placements: [{ id: 'p1', name: 'Center' }] }] };
  const t = R.normalizeTemplate(raw);
  assert.equal(t.basePrice, 17.5);
  assert.equal(t.colors[0].hex, '#FFFFFF');
  assert.ok(R.templateEligible(t).ok);
  assert.equal(R.templateEligible({ ...t, supportsBackendRendering: false }).ok, false);
  assert.equal(R.templateEligible({ ...t, minimumOrdersNumber: 12 }).ok, false);
  assert.equal(R.templateEligible({ ...t, productionMethod: 'EMBROIDERY' }).ok, false);
  assert.equal(R.templateEligible({ ...t, areas: [] }).ok, false);
});
test('products: state, url, variants', () => {
  const p = R.normalizeProduct({ id: 'o1', name: 'X', slug: 'x-tee', access: { type: 'HIDDEN' }, variants: [{ id: 'v', sku: 'SKU1', unitPrice: { value: 29.99, currency: 'USD' }, attributes: { color: { name: 'White' }, size: { name: 'M' } }, stock: { type: 'UNLIMITED' } }] }, { publicDomain: 'shop.example.com' });
  assert.equal(p.state, 'hidden');
  assert.equal(p.url, 'https://shop.example.com/products/x-tee');
  assert.equal(p.variants[0].sku, 'SKU1');
  assert.equal(p.variants[0].stock, 'unlimited');
  assert.equal(R.normalizeProduct({ access: { type: 'PUBLIC' } }).state, 'public');
  assert.equal(R.normalizeProduct({ access: { type: 'ARCHIVED' } }).state, 'archived');
});
test('sample mode: local hosts and ?demo=merch off production only', () => {
  const loc = (hostname, search = '') => ({ hostname, search });
  assert.ok(R.isSampleMode(loc('localhost')));
  assert.ok(R.isSampleMode(loc('frameup.test')));
  assert.equal(R.isSampleMode(loc('localhost', '?demo=off')), false);
  assert.ok(R.isSampleMode(loc('preview-1.vercel.app', '?demo=merch')));
  assert.equal(R.isSampleMode(loc('frameup.essentiallysports.com', '?demo=merch')), false);
  assert.equal(R.isSampleMode(loc('preview-1.vercel.app')), false);
});

fails.forEach(f => console.log(`FAIL ${f}`));
console.log(`merch rules: ${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
