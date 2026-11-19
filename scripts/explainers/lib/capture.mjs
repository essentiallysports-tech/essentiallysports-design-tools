// Drives the real page like a person would (a gliding cursor, real mouse and key
// events, smooth scrolls) while Chrome's screencast saves every painted frame.
// Records a timeline for the encoder: frames, cursor track, clicks, captions.
// Each caption has a voice line (macOS `say`); the next caption waits until the
// last one has been spoken, so voice, caption and action stay in step.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sleep } from './chrome.mjs';

// The voice: --voice / EXPLAINER_VOICE if set (and installed), otherwise the
// best installed English voice: any "(Premium)" voice (Ava, Zoe, Evan, Nathan
// first), then any "(Enhanced)" one, then Samantha. Installing a Premium voice
// in System Settings > Accessibility > Spoken Content is enough: no code change.
const RATE = Number(process.env.EXPLAINER_RATE || 178);
const PREFERRED = ['Ava', 'Zoe', 'Evan', 'Nathan', 'Allison', 'Susan', 'Tom', 'Samantha'];
export function installedVoices() {
  let out = '';
  try { out = execFileSync('say', ['-v', '?']).toString(); } catch { return []; }
  return out.split('\n').map(line => line.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Za-z0-9]+)\s+#/)).filter(Boolean).map(m => ({ name: m[1].trim(), locale: m[2] }));
}
export function pickVoice(want = '', voices = installedVoices()) {
  const english = voices.filter(v => /^en[_-]/i.test(v.locale));
  if (want) {
    const hit = voices.find(v => v.name.toLowerCase() === want.toLowerCase()) || voices.find(v => v.name.toLowerCase().startsWith(want.toLowerCase()));
    if (hit) return { name: hit.name, why: 'asked for' };
    console.warn(`[voice] "${want}" is not installed; picking the best installed voice instead.`);
  }
  const rank = v => {
    const base = v.name.replace(/\s*\(.*$/, '');
    const i = PREFERRED.indexOf(base);
    return (i < 0 ? 50 : i) + (/^en[_-]US$/i.test(v.locale) ? 0 : 20);
  };
  for (const [tag, why] of [[/\(Premium\)/i, 'best installed (Premium)'], [/\(Enhanced\)/i, 'best installed (Enhanced)']]) {
    const list = english.filter(v => tag.test(v.name)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    if (list.length) return { name: list[0].name, why };
  }
  return { name: 'Samantha', why: 'no Premium or Enhanced English voice installed' };
}
let VOICE = '';
export function setVoice(want = process.env.EXPLAINER_VOICE || '') {
  const v = pickVoice(want);
  VOICE = v.name;
  return v;
}
export const voiceName = () => VOICE || setVoice().name;

// Speech for a line: the caption text with a few words spelled for the voice.
const spoken = text => text
  .replace(/frameup\.essentiallysports\.com/gi, 'frameup dot essentially sports dot com')
  .replace(/FrameUp/g, 'Frame Up')
  .replace(/\bMP4s?\b/g, m => m.endsWith('s') ? 'M P 4s' : 'M P 4').replace(/\bPNG\b/g, 'P N G').replace(/\bAI\b/g, 'A.I.')
  .replace(/\b9:16\b/g, 'nine by sixteen').replace(/\b4:5\b/g, 'four by five').replace(/\b1:1\b/g, 'square')
  .replace(/\bES\b/g, 'E S').replace(/\bNFL\b/g, 'N F L').replace(/\+N/g, 'plus')
  .replace(/→/g, ', then ');

export function voiceLine(text, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const voice = voiceName();
  const key = crypto.createHash('sha1').update(`${voice}|${RATE}|${spoken(text)}`).digest('hex').slice(0, 16);
  const file = path.join(dir, `${key}.wav`);
  if (!fs.existsSync(file)) execFileSync('say', ['-v', voice, '-r', String(RATE), '-o', file, '--file-format=WAVE', '--data-format=LEI16@44100', spoken(text)]);
  const info = execFileSync('afinfo', [file]).toString();
  const dur = Number((info.match(/estimated duration: ([\d.]+)/) || [])[1] || 2);
  return { file: path.basename(file), dur };
}

export class Recorder {
  constructor(page, { workDir, width = 1440, height = 900, scale = Number(process.env.EXPLAINER_SCALE || 1.5) }) {
    this.scale = scale;
    this.page = page;
    this.workDir = workDir;
    this.frameDir = path.join(workDir, 'frames');
    this.voiceDir = path.join(path.dirname(workDir), 'voice');
    this.width = width; this.height = height;
    this.frames = []; this.track = []; this.clicks = []; this.captions = [];
    // For the edit: what the camera should look at, waits that can be sped
    // up, and chapter breaks.
    this.focus = []; this.waits = []; this.chapters = [];
    this.cursor = { x: width * 0.62, y: height * 0.55 };
    this.t0 = 0; this.recording = false; this.lastFrameAt = 0;
    this.voiceUntil = 0;
  }
  now() { return Date.now() - this.t0; }

  async start() {
    fs.rmSync(this.frameDir, { recursive: true, force: true });
    fs.mkdirSync(this.frameDir, { recursive: true });
    const { page } = this;
    let n = 0;
    page.on(m => {
      if (m.method !== 'Page.screencastFrame') return;
      const { data, metadata, sessionId } = m.params;
      page.send('Page.screencastFrameAck', { sessionId });
      if (!this.recording) return;
      const t = Math.round(metadata.timestamp * 1000) - this.t0;
      const f = `${String(++n).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(this.frameDir, f), Buffer.from(data, 'base64'));
      this.frames.push({ t, f });
    });
    this.t0 = Date.now();
    this.recording = true;
    await page.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: Math.round(this.width * this.scale), maxHeight: Math.round(this.height * this.scale), everyNthFrame: 1 });
    this.track.push({ t: 0, x: this.cursor.x, y: this.cursor.y });
    // A tiny repaint so the first frame arrives at t = 0.
    await this.page.evaluate(`(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none'; document.body.append(d); setTimeout(() => d.remove(), 60); return 1; })()`).catch(() => {});
  }

  async stop() {
    await this.waitVoice();
    await sleep(500);
    this.recording = false;
    await this.page.send('Page.stopScreencast');
    const duration = this.now();
    const manifest = { width: this.width, height: this.height, duration, frames: this.frames, track: this.track, clicks: this.clicks, captions: this.captions, focus: this.focus, waits: this.waits, chapters: this.chapters, voice: voiceName() };
    fs.writeFileSync(path.join(this.workDir, 'timeline.json'), JSON.stringify(manifest));
    return manifest;
  }

  // ── Captions + voice ──────────────────────────────────────────────────────
  async waitVoice(gap = 350) {
    const left = this.voiceUntil + gap - this.now();
    if (left > 0) await sleep(left);
  }
  async say(text, { wait = false } = {}) {
    await this.waitVoice();
    const v = voiceLine(text, this.voiceDir);
    const t = this.now();
    this.captions.push({ t, text, voice: v.file, dur: v.dur });
    this.voiceUntil = t + v.dur * 1000;
    if (wait) await this.waitVoice(150);
  }

  // A chapter break: the edit holds here for a short title (no voice over it).
  async chapter(label) {
    await this.waitVoice(150);
    this.chapters.push({ t: this.now(), label });
  }
  // Point the camera at an element without moving the cursor.
  async look(sel, { kind = 'look', pad = 24 } = {}) {
    const r = await this.rect(sel);
    if (r) this.focus.push({ t: this.now(), kind, ...this.box(r, pad) });
    return r;
  }
  box(r, pad = 24) { return { x: Math.round(r.x - pad), y: Math.round(r.y - pad), w: Math.round(r.w + pad * 2), h: Math.round(r.h + pad * 2) }; }
  // Back to the wide shot.
  wide() { this.focus.push({ t: this.now(), kind: 'wide' }); }

  // ── Cursor ────────────────────────────────────────────────────────────────
  async mouse(type, x, y, extra = {}) {
    await this.page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
  }
  async moveTo(x, y, ms) {
    const from = { ...this.cursor };
    const dist = Math.hypot(x - from.x, y - from.y);
    const dur = ms ?? Math.min(1100, Math.max(380, 260 + dist * 0.75));
    const start = Date.now();
    // Slight arc so the path feels hand-made.
    const bend = Math.min(60, dist * 0.08) * (x > from.x ? -1 : 1);
    for (;;) {
      const k = Math.min(1, (Date.now() - start) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const px = from.x + (x - from.x) * e;
      const py = from.y + (y - from.y) * e + Math.sin(Math.PI * e) * bend;
      this.cursor = { x: px, y: py };
      this.track.push({ t: this.now(), x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10 });
      await this.mouse('mouseMoved', px, py);
      if (k >= 1) break;
      await sleep(16);
    }
  }
  // Tag the element an expression finds, and return a selector for it.
  async mark(expr) {
    const id = `x${++this._marks || (this._marks = 1)}`;
    const ok = await this.page.evaluate(`(() => { const e = (${expr}); if (!e) return false; e.setAttribute('data-ex', '${id}'); return true; })()`);
    if (!ok) throw new Error(`mark: nothing for ${expr.slice(0, 100)}`);
    return `[data-ex="${id}"]`;
  }
  // The first visible element under `scope` whose text matches `re` (a string regex).
  byText(scope, re, tags = 'button,a,[role=button],[role=tab],[role=radio],summary,label,span,div,p,li') {
    return this.mark(`(() => { const m = [...document.querySelectorAll(${JSON.stringify(scope)})].flatMap(s => [...s.querySelectorAll(${JSON.stringify(tags)})]).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && new RegExp(${JSON.stringify(re)}, 'i').test((e.innerText || e.textContent || '').trim()); }); return m.find(e => !m.some(o => o !== e && e.contains(o))); })()`);
  }
  async rect(sel) {
    return this.page.evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(sel)})]; const e = all.find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== 'hidden'; }); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  }
  async waitFor(expr, ms = 20000) {
    const t = Date.now();
    const from = this.now();
    while (Date.now() - t < ms) {
      if (await this.page.evaluate(expr).catch(() => false)) { if (this.now() - from > 300) this.waits.push({ from, to: this.now() }); return true; }
      await sleep(120);
    }
    throw new Error(`timed out waiting for ${expr.slice(0, 120)}`);
  }
  // Scroll an element into view smoothly (only when it is not fully in view).
  async reveal(sel, block = 'center') {
    const moved = await this.page.evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); if (r.top >= 70 && r.bottom <= innerHeight - 24) return false; e.scrollIntoView({ behavior: 'smooth', block: ${JSON.stringify(block)} }); return true; })()`);
    if (moved) await sleep(750);
    return moved;
  }
  async hover(sel, { dx = 0.5, dy = 0.5, ms, kind = 'hover', pad = 24, zoom } = {}) {
    await this.waitFor(`Boolean([...document.querySelectorAll(${JSON.stringify(sel)})].find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }))`);
    await this.reveal(sel);
    const r = await this.rect(sel);
    if (!r) throw new Error(`not found: ${sel}`);
    if (zoom !== false) this.focus.push({ t: this.now(), kind, ...this.box(r, pad), at: { x: r.x + r.w * dx, y: r.y + r.h * dy }, ...(zoom ? { zoom } : {}) });
    await this.moveTo(r.x + r.w * dx, r.y + r.h * dy, ms);
    return r;
  }
  async click(sel, opts = {}) {
    await this.hover(sel, { kind: 'click', ...opts });
    await sleep(opts.pause ?? 140);
    await this.clickHere();
    await sleep(opts.after ?? 220);
  }
  async clickHere() {
    const { x, y } = this.cursor;
    this.clicks.push({ t: this.now(), x, y });
    await this.mouse('mousePressed', x, y);
    await sleep(70);
    await this.mouse('mouseReleased', x, y);
  }
  async type(text, { cps = 26 } = {}) {
    const f = await this.page.evaluate(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`).catch(() => null);
    if (f) this.focus.push({ t: this.now(), kind: 'type', ...this.box(f, 20), at: { ...this.cursor } });
    for (const ch of text) {
      if (ch === '\n') await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }).then(() => this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }));
      else await this.page.send('Input.insertText', { text: ch });
      await sleep(1000 / cps * (0.6 + Math.random() * 0.8));
    }
    if (f) this.focus.push({ t: this.now(), kind: 'type', ...this.box(f, 20), at: { ...this.cursor } });
  }
  async key(key, code = key, vk = 0) {
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  }
  async scrollBy(dy, { x, y, steps = 18 } = {}) {
    const px = x ?? this.cursor.x, py = y ?? this.cursor.y;
    for (let i = 0; i < steps; i++) { await this.mouse('mouseWheel', px, py, { deltaX: 0, deltaY: dy / steps }); await sleep(22); }
    await sleep(250);
  }
  pause(ms) { return sleep(ms); }
}
