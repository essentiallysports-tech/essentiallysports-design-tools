// Logo library (logo-library.js), picker helpers (logo-picker.js) and the
// wiring that uses them. No network: everything is local files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const L = require('../logo-library.js');
const picker = require('../logo-picker.js');
const listicle = require('../listicle-data.js');
const listicle2 = require('../listicle-type2-data.js');

// ── Data integrity ──
const all = L.all();
assert.ok(all.length > 700, `expected 700+ logos, got ${all.length}`);
const ids = new Set();
for (const entry of all) {
  assert.ok(entry.id && !ids.has(entry.id), `duplicate or empty id: ${entry.id}`);
  ids.add(entry.id);
  assert.ok(entry.name, `${entry.id} has no name`);
  assert.ok(entry.file || entry.url, `${entry.id} has neither a file nor a URL`);
  if (entry.file) assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `${entry.id}: missing file ${entry.file}`);
  if (entry.darkFile) assert.ok(fs.existsSync(path.join(ROOT, entry.darkFile)), `${entry.id}: missing dark file ${entry.darkFile}`);
  if (entry.url) assert.match(entry.url, /^https:\/\/a\.espncdn\.com\/i\/teamlogos\//, `${entry.id}: remote logos must be ESPN CDN (CORS-enabled)`);
  assert.ok(L.isLibrarySource(L.srcFor(entry)), `${entry.id}: its src must pass isLibrarySource`);
  assert.equal(entry.colors.length, 2, `${entry.id}: two colours`);
  entry.colors.forEach(color => assert.match(color, /^#[0-9A-F]{6}$/, `${entry.id}: colour ${color}`));
  assert.ok(L.LEAGUES.some(league => league.id === entry.league), `${entry.id}: unknown league ${entry.league}`);
}
const count = league => all.filter(entry => entry.league === league).length;
assert.equal(count('nfl'), 32);
assert.equal(count('nba'), 30);
assert.equal(count('mlb'), 30);
assert.equal(count('nhl'), 32);
assert.equal(count('epl'), 20);
assert.ok(count('wnba') >= 13);
assert.ok(count('mls') >= 29);
assert.ok(count('cfb') >= 130, 'all FBS programmes');
assert.ok(count('cbb') >= 300, 'D-I college basketball');
assert.ok(count('f1') >= 10);
assert.ok(count('leagues') >= 20);
// Every pro and FBS team is vendored (same origin, safe for the export canvas).
for (const league of ['nfl', 'nba', 'wnba', 'mlb', 'nhl', 'mls', 'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'cfb', 'f1', 'leagues']) {
  all.filter(entry => entry.league === league).forEach(entry => assert.ok(entry.file, `${entry.id} should be vendored`));
}
// Every alias key points at a real entry.
L.ALIAS_IDS.forEach(id => assert.ok(L.get(id), `alias key ${id} has no entry`));
// Vendored files stay small.
for (const dir of fs.readdirSync(path.join(ROOT, 'assets/logos'))) {
  for (const file of fs.readdirSync(path.join(ROOT, 'assets/logos', dir))) {
    assert.ok(fs.statSync(path.join(ROOT, 'assets/logos', dir, file)).size < 48 * 1024, `${dir}/${file} is over 48 KB`);
  }
}

// ── Search ranking ──
const top = (query, options) => L.search(query, options)[0]?.id;
assert.equal(top('niners'), 'nfl-sf');
assert.equal(top('Niners'), 'nfl-sf', 'case-insensitive');
assert.equal(top('bama'), 'cfb-333');
assert.equal(top('LAL'), 'nba-lal', 'abbreviation wins');
assert.equal(top('lakers'), 'nba-lal');
assert.equal(top('man city'), 'epl-382');
assert.equal(top('real madrid'), 'laliga-86');
assert.equal(top('inter miami'), 'mls-20232');
assert.equal(top('la lak'), 'nba-lal', 'every word of the query is a prefix');
assert.equal(top('Atletico'), 'laliga-1068', 'accents folded');
assert.equal(top('mclaren'), 'f1-mclaren');
assert.equal(top('premier league'), 'league-epl');
assert.equal(top('cardinals', { league: 'mlb' }), 'mlb-stl', 'league filter');
assert.ok(L.search('giants').slice(0, 2).every(entry => ['nfl-nyg', 'mlb-sf'].includes(entry.id)));
assert.equal(L.search('zzzz-no-team').length, 0);
// A school in CFB and CBB appears once without a league chip, twice-capable with one.
const alabama = L.search('alabama crimson tide');
assert.equal(alabama.filter(entry => entry.name === 'Alabama Crimson Tide').length, 1);
assert.equal(top('alabama crimson tide', { league: 'cbb' }), 'cbb-333');
assert.equal(L.get('cbb-333').file, L.get('cfb-333').file, 'CBB reuses the vendored CFB logo');
assert.ok(L.search('', { league: 'nba' }).length === 30);
assert.ok(L.search('', { limit: 5 }).length === 5);

// ── findTeam (Generate, Sport + Team) ──
assert.equal(L.findTeam('Los Angeles Lakers', 'NBA')?.id, 'nba-lal');
assert.equal(L.findTeam('Lakers', 'nba')?.id, 'nba-lal');
assert.equal(L.findTeam('BEARS', 'NFL')?.id, 'nfl-chi', 'editor team names are upper case');
assert.equal(L.findTeam('Utah Utes', 'CFB')?.id, 'cfb-254');
assert.equal(L.findTeam('Giants'), null, 'ambiguous without a league');
assert.equal(L.findTeam('Giants', 'MLB')?.id, 'mlb-sf');
assert.equal(L.findTeam('Houston Cougars', 'CBB Men')?.league, 'cbb');
assert.equal(L.findTeam(''), null);
assert.equal(L.leagueForSport('College Football'), 'cfb');

// ── Sources and colours ──
assert.equal(L.entryForSource('assets/logos/nba/lal.webp')?.id, 'nba-lal');
assert.equal(L.isLibrarySource('javascript:alert(1)'), false);
assert.equal(L.isLibrarySource('https://evil.example/logo.png'), false);
assert.equal(L.needsCors('https://a.espncdn.com/i/teamlogos/ncaa/500/2000.png'), true);
assert.equal(L.needsCors('assets/logos/nba/lal.webp'), false);
assert.deepEqual(L.teamColors(L.get('nba-lal')), { box: '#FDB927', text: '#552583' }, 'Lakers: gold box, purple text');
const lowContrast = L.teamColors({ colors: ['#FFFFFF', '#F5F5F5'] });
assert.ok(L.contrastRatio(lowContrast.box, lowContrast.text) >= 3, 'unreadable pairs fall back to black/white text');
const darkSrc = L.srcFor(L.get('nfl-dal'), { dark: true });
assert.ok(darkSrc.endsWith('-dark.webp') || darkSrc === L.get('nfl-dal').file);

// ── Picker helpers ──
const h = picker.helpers;
assert.deepEqual(h.pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
assert.equal(h.pushRecent(Array.from({ length: 20 }, (_, i) => String(i)), 'x', 12).length, 12);
assert.deepEqual(h.toggleFavorite(['a'], 'b'), ['a', 'b']);
assert.deepEqual(h.toggleFavorite(['a', 'b'], 'a'), ['b']);
assert.equal(h.validateUpload({ type: 'image/png', size: 1000 }), '');
assert.match(h.validateUpload({ type: 'image/gif', size: 1000 }), /PNG/);
assert.match(h.validateUpload({ type: 'image/png', size: 5 * 1024 * 1024 }), /4 MB/);
assert.match(h.validateUpload(null), /Choose/);
assert.equal(h.storageKey('favorites', 'Pat@ES.com'), 'frameup.logos.favorites.v1.pat@es.com', 'per user');
assert.equal(h.storageKey('recent', ''), 'frameup.logos.recent.v1.anon');
const chips = h.buildChips(L.LEAGUES, { recent: 0, favorites: 2 });
assert.deepEqual(chips.slice(0, 3).map(chip => chip.id), ['all', 'favorites', 'uploads']);
assert.ok(chips.some(chip => chip.id === 'nfl'));
assert.deepEqual(h.filterEntries(L, { chip: 'recent', recents: ['nba-lal', 'nope', 'nfl-sf'] }).map(e => e.id), ['nba-lal', 'nfl-sf']);
assert.deepEqual(h.filterEntries(L, { chip: 'favorites', favorites: ['nba-lal', 'nfl-sf'], query: 'niners' }).map(e => e.id), ['nfl-sf']);
assert.equal(h.filterEntries(L, { chip: 'all', favorites: ['f1-ferrari'] })[0].id, 'f1-ferrari', 'favourites lead the All grid');
assert.equal(h.filterEntries(L, { chip: 'nhl', query: '' }).length, 32);
assert.deepEqual(h.filterEntries(L, { chip: 'uploads' }), []);
assert.deepEqual(h.filterUploads([{ name: 'Bulls alt' }, { name: 'Other' }], 'bulls').map(u => u.name), ['Bulls alt']);
const choice = h.choiceFromEntry(L.get('nba-lal'), L, false);
assert.deepEqual([choice.source, choice.id, choice.src, choice.name], ['library', 'nba-lal', 'assets/logos/nba/lal.webp', 'Lakers']);

// ── Listicle templates accept library logos, still reject anything else ──
const lib = 'assets/logos/nfl/sf.webp';
const remote = 'https://a.espncdn.com/i/teamlogos/ncaa/500/2000.png';
for (const [api, update] of [[listicle, 'updateListicleRow'], [listicle2, 'updateListicleRow']]) {
  const base = api.createDefaultListicleData();
  assert.equal(api[update](base, 0, { logoSrc: lib }).rows[0].logoSrc, lib);
  assert.equal(api[update](base, 0, { logoSrc: remote }).rows[0].logoSrc, remote);
  assert.equal(api[update](base, 0, { logoSrc: 'https://evil.example/x.png' }).rows[0].logoSrc, '');
}

// ── Wiring ──
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const file of ['logo-library-data.js', 'logo-library.js', 'logo-picker.js', 'social-stat-templates.js', 'logo-picker.css']) {
  assert.ok(index.includes(`${file}?v=`), `index.html loads ${file}`);
}
assert.ok(index.indexOf('logo-library-data.js') < index.indexOf('logo-library.js?'), 'data loads before the library');
assert.match(index, /data-listicle-logo-button[\s\S]*openListicleLogoPicker\('listicle-type-1'/, 'Rankings Table opens the picker');
assert.match(index, /openListicleLogoPicker\('listicle-type-2'/, 'Ranked List opens the picker');
assert.match(index, /isLogoLayer \? pickLogo : pick/, 'newsletter infographic logo layers open the picker');
assert.match(fs.readFileSync(path.join(ROOT, 'frameup-spec.js'), 'utf8'), /logoSrc: teamLogo\(row\.team, spec\.sport\)/, 'Generate fills row logos');

console.log('logo library ok');
