// Final QA (generate, 2026-11-21): the composer's reading of numbers and
// headlines, no network. The renderer's head / face guard and the page's UI
// are covered in real Chrome by check-generate-designs.mjs and
// check-generate-ui.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.fetch = async () => { throw new Error('no network in tests'); };
const K = require('../netlify/functions/_composer.js');

// "1000+ rushing yards" is a fact (the plus stays with the number), so the
// designs can use it and the headline is not cut before it.
{
  const read = K.readCreative('Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL');
  const f = read.facts.find(x => x.value === '1000');
  assert.ok(f, 'the 1000+ count is read');
  assert.equal(f.kind, 'count');
  assert.equal(f.suffix, '+');
  assert.equal(f.display, '1000+');
  assert.equal(f.label, 'rushing yards');
  // A percentage is still a percentage.
  const pct = K.readCreative('Caitlin Clark made 45% shots in the win.\nSport: WNBA').facts.find(x => x.value === '45');
  assert.equal(pct?.kind, 'pct');
}
// A headline never ends on a word that pointed at a number ("GOES OVER").
{
  const briefs = [
    'Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL',
    'Aaron Judge passes 300 home runs in the Yankees win.\nSport: MLB',
    'Max Verstappen reaches 63 Formula 1 wins in Brazil.\nSport: F1',
  ];
  for (const b of briefs) {
    const read = K.readCreative(b);
    K.planDeterministic(read, {}, { want: 4 }).forEach(d => assert.doesNotMatch(d.headline, /\b(over|past|passes|reaches|hits)$/i, `${d.archetype}: ${d.headline}`));
  }
}
// The renderer keeps heads and faces clear (a second pass moves the figure,
// or sets the number smaller above the head).
{
  const src = fs.readFileSync('frameup-compose.js', 'utf8');
  assert.match(src, /function headZone\(/);
  assert.match(src, /function planHeadroom\(/);
  assert.match(src, /pass === 1 && report\.cutouts\?\.length \? planHeadroom\(scene, report\)/);
}
console.log('generate qa: composer facts, headlines and the head guard wiring ok');
