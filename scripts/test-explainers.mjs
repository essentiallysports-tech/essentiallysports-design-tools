// Explainer recorder (scripts/explainers): the three walkthrough flows are
// well-formed and the stub server answers every tool from fixtures with no
// network. No Chrome, no `say`: the recording itself is run by hand with
//   node scripts/explainers/record.mjs generate|video-ads|reels
import assert from 'node:assert/strict';
import { startServer } from './explainers/lib/server.mjs';

const flows = {
  generate: (await import('./explainers/flows/generate.mjs')).default,
  'video-ads': (await import('./explainers/flows/video-ads.mjs')).default,
  reels: (await import('./explainers/flows/reels.mjs')).default,
};
for (const [tool, f] of Object.entries(flows)) {
  for (const k of ['title', 'tagline', 'titleVoice', 'endVoice', 'page', 'ready']) assert.ok(typeof f[k] === 'string' && f[k].length, `${tool}: ${k}`);
  assert.equal(typeof f.run, 'function', `${tool}: run`);
  assert.match(f.endVoice, /frameup\.essentiallysports\.com/, `${tool}: end card names the site`);
  const src = f.run.toString();
  const lines = [...src.matchAll(/rec\.say\((['"`])(.+?)\1/g)].map(m => m[2]);
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
console.log('explainers: flows and stubs ok');
