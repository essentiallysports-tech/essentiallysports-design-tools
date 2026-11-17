// Player Stat Line + Team Record: data models (social-stat-templates.js) and
// their registration in the editor, picker, thumbnails and release notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const T = require('../social-stat-templates.js');
const P = T.playerStatLine;
const R = T.teamRecord;

// ── Player Stat Line defaults ──
const d = P.createDefaultData();
assert.equal(d.schemaVersion, 1);
assert.equal(d.statCount, 7);
assert.equal(d.stats.length, P.STAT_SLOTS);
assert.deepEqual(d.stats.map(s => s.label), ['MINUTES PLAYED', 'POINTS', 'REBOUNDS', 'ASSISTS', 'STEALS', 'BLOCKS', 'FGM/FGA']);
assert.deepEqual([d.firstName, d.lastName, d.opponent], ['PLAYER', 'NAME', 'V/S OPPONENT']);
assert.deepEqual(d.logo, { mode: 'auto', src: '', id: '', name: '', colors: [] }, 'logo follows Sport + Team by default');
assert.deepEqual([d.boxColor, d.textColor], ['', ''], 'label colours default to the team');
assert.equal(d.numberColor, P.NUMBER_COLOR);

// ── Normalising ──
assert.equal(P.normalizeData({ statCount: 0 }).statCount, 1);
assert.equal(P.normalizeData({ statCount: 99 }).statCount, 7);
assert.equal(P.normalizeData({ statCount: 'x' }).statCount, 7);
assert.equal(P.normalizeData({ firstName: 'luka' }).firstName, 'LUKA', 'names are upper case');
assert.equal(P.normalizeData({ firstName: '' }).firstName, '', 'an emptied field stays empty');
assert.equal(P.normalizeData({ stats: [{ value: '1234567890', label: 'a'.repeat(40) }] }).stats[0].value.length, 7);
assert.equal(P.normalizeData({ stats: [{ label: 'a'.repeat(40) }] }).stats[0].label.length, 18);
assert.equal(P.normalizeData({ boxColor: 'red' }).boxColor, '');
assert.equal(P.normalizeData({ boxColor: '#fdb927' }).boxColor, '#FDB927');
assert.equal(P.normalizeData(null).stats.length, 7);

// Logos: library files, ESPN CDN and uploads only.
const lib = { mode: 'library', src: 'assets/logos/nba/lal.webp', id: 'nba-lal', name: 'Lakers', colors: ['#552583', '#FDB927'] };
assert.deepEqual(P.normalizeData({ logo: lib }).logo, lib);
assert.equal(P.normalizeData({ logo: { mode: 'library', src: 'javascript:alert(1)' } }).logo.mode, 'auto');
assert.equal(P.normalizeData({ logo: { mode: 'upload', src: 'https://evil.example/x.png' } }).logo.src, '');
assert.equal(P.normalizeData({ logo: { mode: 'upload', src: 'data:image/png;base64,AAAA', name: 'Mine' } }).logo.mode, 'upload');
assert.equal(P.normalizeData({ logo: { mode: 'none' } }).logo.mode, 'none');
assert.equal(T.isLogoSource('https://a.espncdn.com/i/teamlogos/ncaa/500/2000.png'), true);

// ── Updates ──
let next = P.updateField(d, 'statCount', 4);
assert.equal(next.statCount, 4);
next = P.updateStat(next, 2, { value: '12' });
assert.equal(next.stats[2].value, '12');
assert.deepEqual(P.updateStat(next, 9, { value: '1' }).stats, next.stats, 'out-of-range stat is ignored');
assert.deepEqual(P.updateField(d, 'nope', 'x'), d, 'unknown fields are ignored');

// ── Grid ──
assert.deepEqual(P.statRows(P.visibleStats(d)).map(row => row.length), [1, 3, 3], 'first alone, then rows of three');
assert.deepEqual(P.statRows(P.visibleStats(P.updateField(d, 'statCount', 5))).map(row => row.length), [1, 3, 1]);
assert.deepEqual(P.statRows(P.visibleStats(P.updateField(d, 'statCount', 1))).map(row => row.length), [1]);
assert.deepEqual(P.statRows([]), []);
const blanks = P.updateStat(P.updateStat(d, 1, { value: '', label: '' }), 0, { value: '9' });
assert.equal(P.visibleStats(blanks).length, 6, 'empty slots are skipped');

// ── Label colours ──
assert.deepEqual(P.resolveLabelColors(d, { box: '#FDB927', text: '#552583' }), { box: '#FDB927', text: '#552583' });
assert.deepEqual(P.resolveLabelColors({ ...d, boxColor: '#000000' }, { box: '#FDB927', text: '#552583' }), { box: '#000000', text: '#552583' }, 'override wins');
assert.deepEqual(P.resolveLabelColors(d, null), { box: '#FDB927', text: '#101114' }, 'safe fallback');

// ── Team Record ──
const r = R.createDefaultData();
assert.deepEqual([r.record, r.subline, r.ringColor, r.recordColor, r.logo.mode], ['10-0', '', '', '#FFFFFF', 'auto']);
assert.equal(R.updateField(r, 'record', '  12-1 ').record, '12-1');
assert.equal(R.updateField(r, 'record', 'x'.repeat(30)).record.length, R.LIMITS.record);
assert.equal(R.updateField(r, 'subline', 'undefeated').subline, 'UNDEFEATED');
assert.equal(R.updateField(r, 'ringColor', '#be0000').ringColor, '#BE0000');
assert.equal(R.updateField(r, 'nope', 'x').record, '10-0');

// ── Registration ──
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const [value, label, draw] of [['player-stat-line', 'Player Stat Line', 'drawPlayerStatLinePost'], ['team-record', 'Team Record / Score', 'drawTeamRecordPost']]) {
  assert.ok(index.includes(`<option value="${value}">${label}</option>`), `${value} in the Post Type dropdown`);
  assert.ok(index.includes(`'${value}': {\n    label: '${label}'`), `${value} in INSTAGRAM_POST_TYPES`);
  assert.ok(index.includes(`function ${draw}(ctx, W, H, scale)`), `${draw} exists`);
  assert.ok(index.includes(`id="${value}-fields"`), `${value} fields`);
  assert.ok(fs.existsSync(path.join(ROOT, `assets/template-thumbs/instagram-${value}.webp`)), `${value} thumbnail`);
}
assert.match(index, /playerStatLineData: ESStatTemplates\.playerStatLine\.createDefaultData\(\)/);
assert.match(index, /teamRecordData: ESStatTemplates\.teamRecord\.createDefaultData\(\)/);
assert.match(fs.readFileSync(path.join(ROOT, 'frameup-templates.js'), 'utf8'), /'player-stat-line', 'team-record'/);
const notes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours/updates.json'), 'utf8'));
const tagged = notes.entries.flatMap(entry => entry.templates || []).map(pair => pair.join(':'));
assert.ok(tagged.includes('instagram:player-stat-line') && tagged.includes('instagram:team-record'), 'tagged New');
assert.ok(fs.existsSync(path.join(ROOT, 'project-docs/templates-player-stat-line.md')), 'state fields documented');

console.log('stat templates ok');
