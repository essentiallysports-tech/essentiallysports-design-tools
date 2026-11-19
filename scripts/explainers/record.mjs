// FrameUp video explainers: records a walkthrough of a tool in real headless
// Chrome and encodes it to an MP4 with captions, a cursor and a voiceover.
//
//   node scripts/explainers/record.mjs generate|video-ads|reels [--out <dir>] [--no-captions-only] [--reuse]
//
// 1. Capture: serves the worktree locally with every /api/* answered from QA
//    fixtures (no AI, no Supabase, no keys), opens the page at 1440x900 (light),
//    and drives it with real mouse / key events while Page.startScreencast saves
//    each painted frame. Captions are spoken with macOS `say`; the next step
//    waits for the voice, so picture, caption and voice stay in step.
// 2. Encode: a second Chrome tab (compose.html) replays the timeline in real
//    time on a 1920x1080 canvas (app centred, cursor, click ripples, captions,
//    title and end cards) and records it with MediaRecorder (H.264 + AAC MP4).
//    `avconvert` then rewrites it as a plain fast-start MP4.
// 3. Outputs: <tool>-explainer.mp4, <tool>-explainer-captions-only.mp4,
//    <tool>-explainer-poster.png, <tool>-explainer.srt,
//    <tool>-explainer-contact-sheet.png (+ review stills in .work/<tool>/review).
// Needs: Google Chrome, macOS (say, afinfo, avconvert). Nothing is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, sleep } from './lib/chrome.mjs';
import { startServer } from './lib/server.mjs';
import { setupPage, openApp } from './lib/app.mjs';
import { Recorder, voiceLine } from './lib/capture.mjs';

const args = process.argv.slice(2);
const TOOL = args[0];
const FLOWS = { generate: './flows/generate.mjs', 'video-ads': './flows/video-ads.mjs', reels: './flows/reels.mjs' };
if (!FLOWS[TOOL]) { console.error('usage: node scripts/explainers/record.mjs generate|video-ads|reels [--out <dir>] [--reuse] [--no-captions-only]'); process.exit(2); }
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const OUT = path.resolve(opt('--out') || process.env.EXPLAINER_OUT || path.join(os.tmpdir(), 'frameup-explainers'));
const WORK = path.join(OUT, '.work', TOOL);
const REUSE = args.includes('--reuse'); // re-encode the last capture
const CAPTIONS_ONLY = !args.includes('--no-captions-only');
fs.mkdirSync(WORK, { recursive: true });

const flow = (await import(FLOWS[TOOL])).default;
const stamp = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0').slice(0, 3)}`;
const log = (...a) => console.log(`[${TOOL}]`, ...a);

const voiceDir = path.join(OUT, '.work', 'voice');
const mediaDir = path.join(OUT, '.work', 'media');
const { server, base } = await startServer({ tool: TOOL, opts: flow.serverOpts || {}, uploadDir: WORK, mounts: { '/__frames/': path.join(WORK, 'frames'), '/__voice/': voiceDir, '/__work/': WORK, '/__media/': mediaDir } });
const chrome = await launch({ audio: true });
let exit = 0;
try {
  // ── 0. Stand-in clip (night stadium b-roll) for the stubbed clip sources ──
  const enc = await chrome.page(`${base}/__explainer/compose.html`);
  await enc.send('Page.enable'); await enc.send('Runtime.enable');
  for (let i = 0; i < 100 && !(await enc.evaluate('typeof window.renderVideo === "function"').catch(() => false)); i++) await sleep(100);
  if (!fs.existsSync(path.join(mediaDir, 'broll.mp4'))) {
    fs.mkdirSync(mediaDir, { recursive: true });
    await enc.evaluate(`makeBroll({ seconds: 9, url: '/__upload?sub=media&name=broll.raw.mp4', thumbUrl: '/__upload?sub=media' })`);
    for (const f of fs.readdirSync(path.join(WORK, 'media'))) fs.renameSync(path.join(WORK, 'media', f), path.join(mediaDir, f));
    execFileSync('avconvert', ['--source', path.join(mediaDir, 'broll.raw.mp4'), '--preset', 'PresetHighestQuality', '--output', path.join(mediaDir, 'broll.mp4'), '--replace'], { stdio: 'pipe' });
    log('made the stand-in stadium clip');
  }

  // ── 1. Capture ────────────────────────────────────────────────────────────
  let timeline;
  if (REUSE && fs.existsSync(path.join(WORK, 'timeline.json'))) {
    timeline = JSON.parse(fs.readFileSync(path.join(WORK, 'timeline.json'), 'utf8'));
    log('reusing capture', (timeline.duration / 1000).toFixed(1) + 's');
  } else {
    const page = await chrome.page();
    await page.send('Page.bringToFront');
    const errors = await setupPage(page, { base, mediaDir });
    await openApp(page, { base, path: flow.page, ready: flow.ready, local: flow.local || {} });
    if (flow.prepare) await flow.prepare(page);
    const rec = new Recorder(page, { workDir: WORK });
    rec.voiceDir = voiceDir;
    await rec.start();
    await flow.run(rec, page);
    timeline = await rec.stop();
    log('captured', timeline.frames.length, 'frames,', (timeline.duration / 1000).toFixed(1) + 's,', timeline.captions.length, 'captions');
    if (errors.length) { log('console errors during capture:'); errors.forEach(e => log('  ' + e)); }
    fs.writeFileSync(path.join(WORK, 'console-errors.txt'), errors.join('\n'));
    await page.send('Page.navigate', { url: `${base}/__blank` });
    await page.send('Page.close').catch(() => {});
  }
  // A hidden tab gets no animation frames: the encoder must be the front tab.
  await enc.send('Page.bringToFront');

  // ── 2. Encode ─────────────────────────────────────────────────────────────
  const titleV = voiceLine(flow.titleVoice, voiceDir);
  const endV = voiceLine(flow.endVoice, voiceDir);
  const titleSec = Math.max(3.6, titleV.dur + 1.1);
  const endSec = Math.max(4, endV.dur + 1.4);
  const totalSec = titleSec + timeline.duration / 1000 + endSec;
  const m = {
    ...timeline, title: flow.title, tagline: flow.tagline, endLine: flow.endLine, titleSec, endSec, totalSec,
    frameBase: '/__frames/', voiceBase: '/__voice/',
    extraVoice: [{ voice: titleV.file, at: 0.45 }, { voice: endV.file, at: titleSec + timeline.duration / 1000 + 0.45 }],
  };
  const name = `${TOOL}-explainer`;
  const encode = async (audio, file) => {
    const raw = path.join(WORK, `${file}.raw.mp4`);
    const r = await enc.evaluate(`renderVideo(${JSON.stringify({ ...m, audio, uploadUrl: `/__upload?name=${file}.raw.mp4` })})`);
    log(`${file}: ${(r.bytes / 1e6).toFixed(1)} MB, ${r.fps.toFixed(1)} fps drawn`);
    const final = path.join(OUT, `${file}.mp4`);
    try { execFileSync('avconvert', ['--source', raw, '--preset', 'PresetHighestQuality', '--output', final, '--replace'], { stdio: 'pipe' }); }
    catch { fs.copyFileSync(raw, final); log('avconvert failed; kept the MediaRecorder file'); }
    return final;
  };
  const main = await encode(true, name);
  if (CAPTIONS_ONLY) await encode(false, `${name}-captions-only`);

  // ── 3. Poster, captions file, contact sheet ──────────────────────────────
  await enc.evaluate(`renderPoster(${JSON.stringify(m)}, ${titleSec + (flow.posterAt ?? timeline.duration / 2000)}, '/__upload?name=poster.png')`);
  fs.copyFileSync(path.join(WORK, 'poster.png'), path.join(OUT, `${name}-poster.png`));
  const cues = [
    { from: 0.45, to: titleSec - 0.1, text: flow.titleVoice },
    ...timeline.captions.map((c, i) => {
      const next = timeline.captions[i + 1];
      return { from: titleSec + c.t / 1000, to: titleSec + (next ? next.t : timeline.duration) / 1000 - 0.05, text: c.text };
    }),
    { from: titleSec + timeline.duration / 1000 + 0.45, to: totalSec, text: flow.endVoice },
  ];
  fs.writeFileSync(path.join(OUT, `${name}.srt`), cues.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join('\n'));
  fs.copyFileSync(main, path.join(WORK, 'final.mp4'));
  fs.rmSync(path.join(WORK, 'review'), { recursive: true, force: true });
  await enc.evaluate(`window.__sheetTitle = ${JSON.stringify(`FrameUp ${flow.title}`)}`);
  const info = await enc.evaluate(`inspect({ src: '/__work/final.mp4', cols: 4, rows: 5, sheetUrl: '/__upload?name=sheet.png', every: ${Number(process.env.EXPLAINER_STILL_EVERY || 2)}, stillUrl: '/__upload?sub=review' })`).catch(e => ({ error: e.message }));
  if (info.error) throw new Error('inspect: ' + info.error);
  fs.copyFileSync(path.join(WORK, 'sheet.png'), path.join(OUT, `${name}-contact-sheet.png`));
  log(`done: ${info.dur.toFixed(1)} s, ${info.w}x${info.h}, ${info.stills} review stills in ${path.join(WORK, 'review')}`);
  for (const f of fs.readdirSync(WORK)) if (/\.raw\.mp4$/.test(f)) fs.rmSync(path.join(WORK, f));
} catch (error) {
  console.error(`[${TOOL}] failed:`, error);
  exit = 1;
} finally {
  chrome.close();
  server.close();
}
setTimeout(() => process.exit(exit), 800);
