// ES pill rules: frameup-rules.js PILL must equal the editor's Cover pill
// (index.html PILL_*, PILL_EDGE_TO_TEXT_GAP / PILL_ROW_GAP, getPillFont,
// drawPills) and its text colour rule (getMistColorForPair /
// getTextColorForPair, Social), so Generate's pills can't drift from the
// editor's. frameup-compose.js carries an inline copy for pages that load only
// that file; it must equal the rulebook too. Pure Node, no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = require('../frameup-rules.js');
const C = require('../frameup-compose.js');
const KIT = require('../brand-kit.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── 1. The numbers equal index.html's constants ───────────────────────────
const constant = name => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)\\s*;`));
  assert.ok(m, `index.html defines ${name}`);
  return Number(m[1]);
};
const P = R.PILL;
assert.equal(P.height, constant('PILL_H'), 'pill height = PILL_H');
assert.equal(P.size, constant('PILL_FONT_SIZE'), 'type size = PILL_FONT_SIZE');
assert.equal(P.padLeft, constant('PILL_PAD_LEFT'), 'left padding = PILL_PAD_LEFT');
assert.equal(P.padRight, constant('PILL_PAD_RIGHT'), 'right padding = PILL_PAD_RIGHT');
assert.equal(P.edgeGap, constant('PILL_EDGE_TO_TEXT_GAP'), 'edge gap = PILL_EDGE_TO_TEXT_GAP');
assert.equal(P.rowGap, constant('PILL_ROW_GAP'), 'row gap = PILL_ROW_GAP');
assert.equal(P.heightRatio, P.height / P.size);
assert.equal(P.padLeftRatio, P.padLeft / P.size);
assert.equal(P.padRightRatio, P.padRight / P.size);
// Font: getPillFont = `900 …px "${POST_FONT_FAMILY}"`; the face is fonts/acumin-post-legacy.otf.
assert.match(html, /function getPillFont\(scale=1\) \{\s*return `900 \$\{Math\.round\(PILL_FONT_SIZE \* scale\)\}px "\$\{POST_FONT_FAMILY\}"/, 'editor pill font is 900 POST_FONT_FAMILY');
const family = html.match(/const POST_FONT_FAMILY\s*=\s*['"]([^'"]+)['"]/);
assert.ok(family, 'index.html names POST_FONT_FAMILY');
assert.equal(P.family, family[1], 'pill family = POST_FONT_FAMILY');
assert.equal(P.weight, 900);
assert.ok(new RegExp(`font-family: '${P.family}';\\s+src: url\\('${P.file}'\\)`).test(html), `index.html loads ${P.family} from ${P.file}`);
assert.ok(fs.existsSync(path.join(ROOT, P.file)), 'the pill font file exists');
assert.equal(P.upper, true);
assert.equal(P.letterSpacing, 0);
assert.equal(P.radius, 0);
assert.ok(/ctx\.fillRect\(p\.x, p\.y, p\.w, p\.h\)/.test(html), 'editor pills are sharp rectangles');
assert.equal(P.minSize, R.FIT.cover.pill.minSize, 'min size = the Cover pill rule');
assert.deepEqual(P.bestChars, [10, 16]);
assert.ok(R.VOICE.some(line => /10-16 characters/.test(line)), 'the voice rule names 10-16 characters');
// The row step formula (drawPills): max(0.55 H, H - topPad + edge gap) + row gap.
assert.ok(/Math\.round\(activePillH \* 0\.55\),\s+activePillH - topPad \+ edgeToTextGap\s+\) \+ Math\.round\(PILL_ROW_GAP \* scale\)/.test(html), 'editor row step formula unchanged');
{
  const m = R.pillMetrics(130, 92);
  assert.equal(m.h, 122);
  assert.equal(m.topPad, 15);
  assert.equal(m.baseline, 107);
  assert.equal(m.step, Math.max(Math.round(122 * 0.55), 122 - 15 + 1) + 1);
  assert.ok(m.step < m.h && m.step > m.baseline, 'stacked rows touch: the next row starts under the letters, inside the pill');
  assert.ok(Math.abs(m.padLeft - 18.4) < 1e-9 && Math.abs(m.padRight - 21.88) < 1e-9);
}

// ── 2. The text colour rule equals the editor's (every brand-kit pair) ────
const start = html.indexOf('function getMistColorForPair(');
const end = html.indexOf('function closeCustomSelects(');
assert.ok(start > 0 && end > start, 'editor colour functions found');
const editor = new Function(`const activeWorkspace = 'social'; const activeNewsletterAsset = ''; ${html.slice(start, end)}; return { getTextColorForPair, getMistColorForPair };`)();
let pairs = 0;
KIT.forEach(entry => [entry.primary, ...(entry.palette || [])].filter(Boolean).forEach(pair => {
  pairs += 1;
  assert.equal(R.pillTextColor(pair, entry.palette || []), editor.getTextColorForPair(pair, entry), `${entry.team || entry.variation}: ${JSON.stringify(pair)}`);
  assert.equal(R.pillMist(pair, entry.palette || []), editor.getMistColorForPair(pair, entry));
}));
assert.ok(pairs > 300, `checked every brand-kit pair (${pairs})`);
// Without an entry (Generate's one-off pills): mist, then foreground, then black / white.
assert.equal(R.pillTextColor({ background: '#FAB624', mist: '#542C81' }), '#542C81');
assert.equal(R.pillTextColor({ background: '#0B5D3B', mist: '#073F28' }), '#FFFFFF', 'a mist under 2.4:1 gives way to white / black');
assert.equal(R.pillTextColor({ background: '#FFFFFF', mist: '' }), '#000000');

// ── 3. Compose uses the rulebook, and its inline copy equals it ───────────
assert.equal(C.PILL, R.PILL, 'compose reads PILL from the rulebook under Node');
const sandbox = { self: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'frameup-compose.js'), 'utf8'), sandbox);
const lone = sandbox.self.FrameUpCompose;
assert.ok(lone && lone.PILL, 'compose loads on a page without the rulebook');
assert.deepEqual(JSON.parse(JSON.stringify(lone.PILL)), JSON.parse(JSON.stringify(R.PILL)), 'inline PILL = rulebook PILL');
[[130, 92], [128, 88.4], [84, 58], [49, 34], [40, 0]].forEach(([size, cap]) => {
  assert.deepEqual({ ...lone.pillMetrics(size, cap) }, R.pillMetrics(size, cap), `inline pillMetrics(${size})`);
});
KIT.forEach(entry => [entry.primary, ...(entry.palette || [])].filter(Boolean).forEach(pair => {
  assert.equal(lone.pillTextColor(pair, entry.palette || []), R.pillTextColor(pair, entry.palette || []), 'inline pillTextColor');
  assert.equal(lone.pillTextColor({ background: pair.background, mist: pair.foreground }), R.pillTextColor({ background: pair.background, mist: pair.foreground }));
}));

// ── 4. Pages that render Creative load the pill face ──────────────────────
const gen = fs.readFileSync(path.join(ROOT, 'generate.html'), 'utf8');
const rulesTag = gen.indexOf('<script src="frameup-rules.js');
const composeTag = gen.indexOf('<script src="frameup-compose.js');
assert.ok(rulesTag > 0 && rulesTag < composeTag, 'generate.html loads the rulebook before the composer');
assert.ok(/new FontFace\(family, `url\(\$\{SCRIPT_BASE\}\$\{file\}\)/.test(fs.readFileSync(path.join(ROOT, 'frameup-compose.js'), 'utf8')), 'ensureFonts registers the pill face next to the script');

console.log(`pill rules checks passed (${pairs} brand-kit pairs)`);
