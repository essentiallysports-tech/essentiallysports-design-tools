// Explainer recorder (scripts/explainers): the four walkthrough flows are
// well-formed, the stub server answers every tool from fixtures with no
// network, the edit (trims, chapters, camera, captions) and the voice pick
// behave. No Chrome, no `say`, no audio: the recording itself is run by hand with
//   node scripts/explainers/record.mjs generate|trends|video-ads|reels
import assert from 'node:assert/strict';
import { startServer } from './explainers/lib/server.mjs';
import { buildEdit, cameraPath, captionCues, chunkText, toOut, toSrc, IDLE_KEEP, HOLD } from './explainers/lib/edit.mjs';
import { pickVoice } from './explainers/lib/capture.mjs';

const flows = {
  generate: (await import('./explainers/flows/generate.mjs')).default,
  trends: (await import('./explainers/flows/trends.mjs')).default,
  'video-ads': (await import('./explainers/flows/video-ads.mjs')).default,
  reels: (await import('./explainers/flows/reels.mjs')).default,
};
for (const [tool, f] of Object.entries(flows)) {
  for (const k of ['title', 'tagline', 'titleVoice', 'endVoice', 'page', 'ready']) assert.ok(typeof f[k] === 'string' && f[k].length, `${tool}: ${k}`);
  assert.equal(typeof f.run, 'function', `${tool}: run`);
  assert.match(f.endVoice, /frameup\.essentiallysports\.com/, `${tool}: end card names the site`);
  const src = f.run.toString();
  const lines = [...src.matchAll(/rec\.say\((['"`])(.+?)\1\)/g)].map(m => m[2]);
  assert.ok(lines.length >= 8, `${tool}: at least 8 captions (got ${lines.length})`);
  for (const l of lines) {
    assert.ok(l.length <= 110, `${tool}: caption too long for one or two lines: ${l}`);
    assert.doesNotMatch(l, /\b(stub|test|lorem|qa)\b/i, `${tool}: caption reads like test copy: ${l}`);
  }
}

const post = async (base, p, body) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
{
  const { server, base } = await startServer({ tool: 'generate', opts: { genDelay: 0 } });
  try {
    const plan = await post(base, '/api/es-generate', { mode: 'creative', want: 4 });
    assert.ok(plan.directions?.length >= 2, 'generate: the composer plan has designs');
    assert.equal(plan.directions[0].critique.improvements[0].fix.op, 'fix', 'generate: the director note is a free local fix');
    const trends = await (await fetch(base + '/api/trend-design')).json();
    assert.ok(trends.items.length >= 3, 'generate: trends');
  } finally { server.close(); }
}
{
  const { server, base } = await startServer({ tool: 'video-ads' });
  try {
    const clips = await post(base, '/api/video-ads', { mode: 'find-clips', sport: 'cfb' });
    assert.ok(clips.clips.length >= 3 && clips.clips.every(c => /^https:\/\/fixtures\.test\//.test(c.variants[0].url)), 'video ads: clips point at local fixtures');
    const copy = await post(base, '/api/video-ads', { mode: 'copy' });
    assert.ok(copy.variants.length === 3, 'video ads: three copy options');
  } finally { server.close(); }
}
{
  const { server, base } = await startServer({ tool: 'reels' });
  try {
    const cfg = await post(base, '/api/reel-maker', { mode: 'config' });
    assert.ok(cfg.ok && cfg.dataFormats.includes('gameswing'), 'reels: config');
    const trends = await post(base, '/api/reel-maker', { mode: 'trends' });
    assert.ok(trends.items.length >= 3, 'reels: trends');
    const games = await post(base, '/api/reel-maker', { mode: 'games', sport: 'nfl', when: 'recent' });
    assert.ok(games.games.some(g => String(g.id) === '401873063'), 'reels: the fixture game is listed');
  } finally { server.close(); }
}
{
  const { server, base } = await startServer({ tool: 'trends' });
  try {
    const feed = await (await fetch(base + '/api/trend-design')).json();
    assert.ok(feed.ok && feed.items.length >= 8 && feed.aiEnrich, 'trends: the feed is built by the real server code');
    const ai = await post(base, '/api/trend-design', { mode: 'enrich', items: [{ id: feed.items[0].id, title: feed.items[0].title }] });
    const angle = ai.items[feed.items[0].id];
    assert.ok(angle.ai && angle.why && angle.titles.length >= 1, 'trends: AI angles are answered locally');
  } finally { server.close(); }
}

// Voice: Premium first, then Enhanced, then Samantha; an asked-for voice wins.
{
  const v = (name, locale = 'en_US') => ({ name, locale });
  assert.equal(pickVoice('', [v('Samantha'), v('Daniel (Enhanced)', 'en_GB'), v('Zoe (Premium)'), v('Ava (Premium)')]).name, 'Ava (Premium)');
  assert.equal(pickVoice('', [v('Samantha'), v('Daniel (Enhanced)', 'en_GB'), v('Amélie (Premium)', 'fr_CA')]).name, 'Daniel (Enhanced)');
  assert.equal(pickVoice('', [v('Samantha'), v('Fred')]).name, 'Samantha');
  assert.equal(pickVoice('Fred', [v('Samantha'), v('Fred')]).name, 'Fred');
  assert.equal(pickVoice('Nobody', [v('Samantha'), v('Zoe (Premium)')]).name, 'Zoe (Premium)');
}

// Edit: idle trimmed, voice kept whole, chapters hold, camera zooms and returns.
{
  const tl = {
    duration: 20000, frames: [],
    track: [{ t: 0, x: 700, y: 400 }, ...Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i * 16, x: 700 + i * 10, y: 400 }))],
    clicks: [{ t: 1600, x: 990, y: 400 }],
    captions: [{ t: 500, dur: 2, text: 'Click Find clips. It shows the most-watched recent plays, only from official accounts.' }, { t: 14000, dur: 2, text: 'Done.' }],
    focus: [{ t: 1000, kind: 'click', x: 960, y: 380, w: 80, h: 40, at: { x: 990, y: 400 } }],
    waits: [], chapters: [{ t: 9000, label: 'Export' }],
  };
  const edit = buildEdit(tl, [3000, 3100]);
  assert.ok(edit.duration < tl.duration, 'edit: dead time is trimmed');
  const hold = edit.segs.find(s => s.hold === 'Export');
  assert.ok(hold && hold.o1 - hold.o0 === HOLD, 'edit: a chapter gets a hold');
  assert.equal(Math.round(toOut(edit, 2500) - toOut(edit, 500)), 2000, 'edit: the voice plays at normal speed');
  assert.ok(toOut(edit, 13000) - toOut(edit, 4000) < 9000 - 3000 + HOLD, 'edit: a long idle stretch is shortened');
  assert.ok(Math.abs(toSrc(edit, toOut(edit, 1600)) - 1600) < 2, 'edit: source and output times round-trip');
  const cam = cameraPath(tl, edit);
  const at = o => cam.samples[Math.round(o / cam.step)][0];
  assert.ok(at(toOut(edit, 2200)) >= 1.3 && at(toOut(edit, 2200)) <= 1.81, 'camera: zooms in on the click');
  assert.ok(at(toOut(edit, 9000) + HOLD / 2) < 1.05, 'camera: wide for the chapter card');
  const steps = cam.samples.map(s => s[0]).slice(1).map((s, i) => Math.abs(s - cam.samples[i][0]));
  assert.ok(Math.max(...steps) < 0.06, 'camera: no jumps');
  const acc = steps.slice(1).map((d, i) => Math.abs(d - steps[i]));
  assert.ok(Math.max(...acc) < 0.01, 'camera: eases (no sudden speed changes)');
  const cues = captionCues(tl, edit, cam);
  assert.ok(cues.length >= 3 && cues.every(q => q.text.length <= 64 && q.to > q.from), 'captions: short timed chunks');
  assert.ok(cues.every(q => q.pos === 'bottom' || q.pos === 'top'), 'captions: placed');
  assert.deepEqual(chunkText('Done. The ad names for Meta are ready to copy.'), ['Done. The ad names for Meta are ready to copy.'], 'captions: tiny sentences join');
  assert.ok(IDLE_KEEP < 1200);
}
console.log('explainers: flows, stubs, voice pick and edit ok');
