// FrameUp video explainers: records a walkthrough of a tool in real headless
// Chrome and encodes it to an MP4 with captions, a cursor and a voiceover.
//
//   node scripts/explainers/record.mjs generate|trends|video-ads|reels
//     [--out <dir>] [--voice "<name>"] [--music <file>|none] [--reuse] [--no-captions-only]
//
// --voice: a macOS voice (EXPLAINER_VOICE works too). Default: the best
//   installed English voice ("(Premium)", then "(Enhanced)", then Samantha).
// --music: the music bed, read at encode time and never copied into the repo.
//   Default: ~/Downloads/frameup-audio-upload/calm-lofi.m4a when it exists.
//
// 1. Capture: serves the worktree locally with every /api/* answered from QA
//    fixtures (no AI, no Supabase, no keys), opens the page at 1440x900 (light),
//    and drives it with real mouse / key events while Page.startScreencast saves
//    each painted frame. Captions are spoken with macOS `say`; the next step
//    waits for the voice, so picture, caption and voice stay in step.
// 2. Edit (lib/edit.mjs): frame diffs find dead time, which is trimmed; waits
//    that only show a spinner are sped up; chapters get a short title hold;
//    the camera path zooms in on each click / typed field and eases back out;
//    captions are split into short lower-third chunks.
// 3. Encode: a second Chrome tab (compose.html) plays the edit in real time on
//    a 1920x1080 canvas (camera, cursor, ripples, captions, animated title,
//    chapter and end cards; voice + ducked music bed) and records it with
//    MediaRecorder (H.264 + AAC MP4).
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
import { Recorder, voiceLine, setVoice } from './lib/capture.mjs';
import { buildEdit, cameraPath, captionCues, toOut } from './lib/edit.mjs';

const args = process.argv.slice(2);
const TOOL = args[0];
const FLOWS = { generate: './flows/generate.mjs', trends: './flows/trends.mjs', 'video-ads': './flows/video-ads.mjs', reels: './flows/reels.mjs' };
if (!FLOWS[TOOL]) { console.error('usage: node scripts/explainers/record.mjs generate|trends|video-ads|reels [--out <dir>] [--voice <name>] [--music <file>|none] [--reuse] [--no-captions-only]'); process.exit(2); }
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const OUT = path.resolve(opt('--out') || process.env.EXPLAINER_OUT || path.join(os.tmpdir(), 'frameup-explainers'));
const WORK = path.join(OUT, '.work', TOOL);
const REUSE = args.includes('--reuse'); // re-encode the last capture
const CAPTIONS_ONLY = !args.includes('--no-captions-only');
const DEFAULT_MUSIC = path.join(os.homedir(), 'Downloads/frameup-audio-upload/calm-lofi.m4a');
const MUSIC = (() => { const m = opt('--music') || process.env.EXPLAINER_MUSIC || ''; if (m === 'none') return ''; const f = path.resolve(m || DEFAULT_MUSIC); if (fs.existsSync(f)) return f; if (m) { console.error(`music not found: ${f}`); process.exit(2); } return ''; })();
fs.mkdirSync(WORK, { recursive: true });

const flow = (await import(FLOWS[TOOL])).default;
const stamp = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0').slice(0, 3)}`;
const log = (...a) => console.log(`[${TOOL}]`, ...a);

const voice = setVoice(opt('--voice') || process.env.EXPLAINER_VOICE || '');
log(`voice: ${voice.name} (${voice.why})`);
log(MUSIC ? `music: ${MUSIC}` : 'music: none');
const voiceDir = path.join(OUT, '.work', 'voice');
const mediaDir = path.join(OUT, '.work', 'media');
const { server, base } = await startServer({ tool: TOOL, opts: flow.serverOpts || {}, uploadDir: WORK, mounts: { '/__frames/': path.join(WORK, 'frames'), '/__voice/': voiceDir, '/__work/': WORK, '/__media/': mediaDir, ...(MUSIC ? { '/__music/': path.dirname(MUSIC) } : {}) } });
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

  // ── 2. Edit ───────────────────────────────────────────────────────────────
  const changes = await enc.evaluate(`analyze(${JSON.stringify({ frames: timeline.frames, frameBase: '/__frames/' })})`);
  const edit = buildEdit(timeline, changes);
  const cam = cameraPath(timeline, edit);
  const cues = captionCues(timeline, edit, cam);
  log(`edit: ${(timeline.duration / 1000).toFixed(1)} s captured -> ${(edit.duration / 1000).toFixed(1)} s, ${cam.shots.length} zoom shots, ${edit.segs.filter(s => s.hold).length} chapters, ${cues.length} caption cues (${cues.filter(q => q.pos === 'top').length} at the top)`);
  fs.writeFileSync(path.join(WORK, 'edit.json'), JSON.stringify({ changes: changes.length, edit, shots: cam.shots, cues }, null, 1));

  // ── 3. Encode ─────────────────────────────────────────────────────────────
  const titleV = voiceLine(flow.titleVoice, voiceDir);
  const endV = voiceLine(flow.endVoice, voiceDir);
  const titleSec = Math.max(4.2, titleV.dur + 1.6);
  const endSec = Math.max(4.4, endV.dur + 1.8);
  const appSec = edit.duration / 1000;
  const totalSec = titleSec + appSec + endSec;
  const m = {
    ...timeline, title: flow.title, tagline: flow.tagline, endLine: flow.endLine, titleSec, endSec, totalSec,
    frameBase: '/__frames/', voiceBase: '/__voice/', musicUrl: MUSIC ? `/__music/${path.basename(MUSIC)}` : '',
    edit, cam, cues: cues.map(q => ({ ...q })),
    voiceLines: timeline.captions.map(c => ({ voice: c.voice, at: titleSec + toOut(edit, c.t) / 1000 })),
    extraVoice: [{ voice: titleV.file, at: 0.5 }, { voice: endV.file, at: titleSec + appSec + 0.55 }],
  };
  const name = `${TOOL}-explainer`;
  const encode = async (audio, file) => {
    const raw = path.join(WORK, `${file}.raw.mp4`);
    const r = await enc.evaluate(`renderVideo(${JSON.stringify({ ...m, audio, uploadUrl: `/__upload?name=${file}.raw.mp4` })})`);
    log(`${file}: ${(r.bytes / 1e6).toFixed(1)} MB, ${r.fps.toFixed(1)} fps drawn`);
    if (r.audio) log(`mix: voice ${r.audio.voiceDb} dBFS, music under voice ${r.audio.musicUnderVoiceDb} dBFS (${r.audio.voiceOverMusicDb} dB below), music between lines ${r.audio.musicInGapsDb} dBFS`);
    const final = path.join(OUT, `${file}.mp4`);
    try { execFileSync('avconvert', ['--source', raw, '--preset', 'PresetHighestQuality', '--output', final, '--replace'], { stdio: 'pipe' }); }
    catch { fs.copyFileSync(raw, final); log('avconvert failed; kept the MediaRecorder file'); }
    return final;
  };
  const main = await encode(true, name);
  if (CAPTIONS_ONLY) await encode(false, `${name}-captions-only`);

  // ── 3. Poster, captions file, contact sheet ──────────────────────────────
  await enc.evaluate(`renderPoster(${JSON.stringify(m)}, ${titleSec + Math.min(appSec - 1, flow.posterAt ?? appSec / 2)}, '/__upload?name=poster.png')`);
  fs.copyFileSync(path.join(WORK, 'poster.png'), path.join(OUT, `${name}-poster.png`));
  const srt = [
    { from: 0.5, to: titleSec - 0.2, text: flow.titleVoice },
    ...cues.map(q => ({ from: titleSec + q.from / 1000, to: titleSec + q.to / 1000, text: q.text })),
    { from: titleSec + appSec + 0.55, to: totalSec - 0.1, text: flow.endVoice },
  ];
  fs.writeFileSync(path.join(OUT, `${name}.srt`), srt.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join('\n'));
  fs.copyFileSync(main, path.join(WORK, 'final.mp4'));
  fs.rmSync(path.join(WORK, 'review'), { recursive: true, force: true });
  await enc.evaluate(`window.__sheetTitle = ${JSON.stringify(`FrameUp ${flow.title}`)}`);
  const info = await enc.evaluate(`inspect({ src: '/__work/final.mp4', cols: 4, rows: 5, sheetUrl: '/__upload?name=sheet.png', every: ${Number(process.env.EXPLAINER_STILL_EVERY || 2)}, stillUrl: '/__upload?sub=review' })`).catch(e => ({ error: e.message }));
  if (info.error) throw new Error('inspect: ' + info.error);
  fs.copyFileSync(path.join(WORK, 'sheet.png'), path.join(OUT, `${name}-contact-sheet.png`));
  // Loudness of the finished file: voice vs the music bed between lines.
  const lines = [titleV.dur, endV.dur, ...timeline.captions.map(c => c.dur)];
  const voiced = [...m.extraVoice, ...m.voiceLines].map((l, i) => [l.at, l.at + lines[i]]).sort((a, b) => a[0] - b[0]);
  const loud = await enc.evaluate(`loudness(${JSON.stringify({ src: '/__work/final.mp4', spans: voiced })})`).catch(e => ({ error: e.message }));
  log('loudness of the MP4:', JSON.stringify(loud));
  log(`done: ${info.dur.toFixed(1)} s, ${info.w}x${info.h}, ${info.stills} review stills in ${path.join(WORK, 'review')}`);
  for (const f of fs.readdirSync(WORK)) if (/\.raw\.mp4$/.test(f)) fs.rmSync(path.join(WORK, f));
  fs.writeFileSync(path.join(WORK, 'summary.json'), JSON.stringify({ tool: TOOL, voice: voice.name, music: MUSIC ? path.basename(MUSIC) : '', captured: timeline.duration / 1000, edited: appSec, total: totalSec, file: info.dur, loudness: loud }, null, 1));
} catch (error) {
  console.error(`[${TOOL}] failed:`, error);
  exit = 1;
} finally {
  chrome.close();
  server.close();
}
setTimeout(() => process.exit(exit), 800);
