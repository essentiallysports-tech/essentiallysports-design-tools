// Shared by test-reel-looks.mjs (golden parity) and the frame-sheet renderer:
// six sample stories (stat, quote, comparison, scale/dots, statement-led news,
// photo-led), a recording canvas stub, and a per-frame digest of every draw
// call. Not a test file (the suite runs scripts/test-*.mjs only).
import { createHash } from 'node:crypto';

const end = { kind: 'cta', block: { type: 'endcard' } };
export const STORIES = {
  stat: { format: 'stat', title: 'Kalshi bars', sourceLine: 'Source: Kalshi', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: 'THE CUBS LOST.', color: 'ink' }, { text: 'THIS BAR GOT PAID.', color: 'red', size: 110 }], stamp: { text: 'PAID' } }, vo: 'The Cubs lost. This bar got *paid.*' },
    { id: 'b2', kind: 'point', block: { type: 'statement', lines: [{ text: "IT WASN'T", color: 'ink' }, { text: 'INSURANCE.', color: 'blue' }] }, vo: "It wasn't insurance. It was a bet against its own team." },
    { id: 'b3', kind: 'stat', block: { type: 'number', kicker: 'KALSHI TRADES', value: 274000, label: 'CONTRACTS', color: 'blue' }, vo: 'On Kalshi, bars traded *274,000* contracts on the games.' },
    { id: 'b4', ...end },
  ] },
  quote: { format: 'explainer', title: 'Reid on the call', sourceLine: 'Source: ESPN', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: 'REID SAW' }, { text: 'NO FLAG.', color: 'blue' }] }, vo: 'Andy Reid says he saw *no* false start.' },
    { id: 'b2', kind: 'quote', block: { type: 'quote', text: "I didn't see a false start", who: 'ANDY REID' }, vo: 'I didn\'t see a false start, Reid said after the loss.' },
    { id: 'b3', kind: 'point', block: { type: 'statement', lines: [{ text: 'THE LEAGUE' }, { text: 'REVIEWED IT' }, { text: 'MONDAY.', color: 'red' }] }, vo: 'The league reviewed it on *Monday.*' },
    { id: 'b4', ...end },
  ] },
  comparison: { format: 'stat', title: 'How they bet', sourceLine: 'Source: Kalshi', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: 'BARS BET' }, { text: 'AGAINST', color: 'blue' }, { text: 'THEIR TEAM.' }] }, vo: 'Bars are betting against their own teams.' },
    { id: 'b2', kind: 'bars', block: { type: 'compare', kicker: 'HOW THEY BET', items: [{ label: 'ON THE GAMES', value: 692, display: '$692M', color: 'red' }, { label: 'AS INSURANCE', value: 0.3, display: '$0.3M', color: 'green' }] }, vo: 'That is $692M on the games, compared to $0.3M as insurance.' },
    { id: 'b3', kind: 'bars', block: { type: 'compare', kicker: 'BY LEAGUE', items: [{ label: 'NFL', value: 410, display: '$410M', color: 'blue' }, { label: 'MLB', value: 180, display: '$180M' }, { label: 'NBA', value: 102, display: '$102M' }] }, vo: 'The NFL took $410M, baseball $180M and the NBA $102M.' },
    { id: 'b4', ...end },
  ] },
  scale: { format: 'stat', title: 'Kalshi dots', sourceLine: 'Source: Kalshi', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: '2,521 BETS.' }, { text: 'ONE WAS' }, { text: 'INSURANCE.', color: 'green' }] }, vo: 'Of 2,521 bets, only *one* was insurance.' },
    { id: 'b2', kind: 'dotrank', block: { type: 'dots', label: 'EVERY BET ON GAMES', count: 2521, highlight: 1, note: '1 WAS INSURANCE' }, vo: 'Here is every bet on the games. Just 1 of them was insurance.' },
    { id: 'b3', kind: 'chips', block: { type: 'dots', label: 'FANS WHO BET', count: 5, highlight: 1, note: '1 IN 5' }, vo: 'About 1 in 5 fans placed a bet.' },
    { id: 'b4', ...end },
  ] },
  news: { format: 'explainer', title: 'Chiefs sign a receiver', sourceLine: 'Source: NFL Network', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: 'THE CHIEFS' }, { text: 'JUST GOT', color: 'blue' }, { text: 'FASTER.' }] }, vo: 'The Chiefs just got *faster.*' },
    { id: 'b2', kind: 'point', block: { type: 'statement', lines: [{ text: 'A NEW' }, { text: 'DEEP THREAT', color: 'blue' }, { text: 'FOR MAHOMES.' }] }, vo: 'Kansas City signed a new deep threat for Mahomes.' },
    { id: 'b3', kind: 'point', block: { type: 'statement', lines: [{ text: 'ONE YEAR.' }, { text: 'NO RISK.', color: 'green' }] }, vo: 'It is a one year deal with no risk.' },
    { id: 'b4', kind: 'stat', block: { type: 'number', kicker: 'TOP SPEED', value: 22.4, suffix: 'MPH', label: 'LAST SEASON', color: 'blue' }, vo: 'He hit 22.4 MPH last season.' },
    { id: 'b5', ...end },
  ] },
  photo: { format: 'explainer', title: 'Ohtani walks it off', sourceLine: 'Source: MLB.com', beats: [
    { id: 'b1', kind: 'hook', block: { type: 'hook', media: 'p1', pills: [{ text: 'OHTANI' }, { text: 'WALKS IT OFF.', color: 'blue' }] }, vo: 'Ohtani walks it *off.*' },
    { id: 'b2', kind: 'point', block: { type: 'statement', media: 'p2', lines: [{ text: 'BOTTOM NINE.' }, { text: 'TWO OUTS.', color: 'blue' }] }, vo: 'Bottom of the ninth, two outs.' },
    { id: 'b3', kind: 'point', block: { type: 'statement', media: 'p3', lines: [{ text: 'THE CROWD' }, { text: 'KNEW.', color: 'blue' }] }, vo: 'The crowd already knew.' },
    { id: 'b4', kind: 'quote', block: { type: 'quote', text: 'I was just looking for a pitch to drive', who: 'SHOHEI OHTANI' }, vo: 'I was just looking for a pitch to drive, he said.' },
    { id: 'b5', ...end },
  ] },
};
export const STORY_IDS = Object.keys(STORIES);
export const CORPUS = '2,521 1 5 274,000 $692M $0.3M 692 0.3 $410M $180M $102M 410 180 102 22.4';
// The photo story's assets (three photos, one per media beat).
export const PHOTO_OPTS = {
  photos: { b1: ['p1'], b2: ['p2'], b3: ['p3'] },
  assets: { p1: { id: 'p1', kind: 'photo', url: 'p1.jpg' }, p2: { id: 'p2', kind: 'photo', url: 'p2.jpg' }, p3: { id: 'p3', kind: 'photo', url: 'p3.jpg' } },
};
export const optsFor = (story, extra = {}) => ({ style: 'es', corpus: CORPUS, ...(story === 'photo' ? PHOTO_OPTS : {}), ...extra });

// Roboto Condensed 800 runs about 0.47 em per capital.
export const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.47;

// A canvas stub that records every call and every property set, in order.
export function recorder() {
  const log = [];
  const round = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : (v && typeof v === 'object' ? '[obj]' : v));
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 20 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { log.push(['gradient']); return { addColorStop() {} }; };
      if (key === 'createPattern') return () => { log.push(['createPattern']); return { pattern: true }; };
      if (key === 'getImageData') return undefined;
      return (...args) => { log.push([String(key), ...args.map(round)]); };
    },
    set(target, key, value) { target[key] = value; log.push([`=${String(key)}`, round(value)]); return true; },
    has(target, key) { return key === 'letterSpacing' || key in target; },
  });
  return { ctx, log };
}
export const stubImages = { p1: { width: 1600, height: 1000 }, p2: { width: 1000, height: 1500 }, p3: { width: 1200, height: 1200 } };
export const envFor = () => ({ measure, images: stubImages, videos: {}, cutouts: {}, grain: { width: 128, height: 128 } });

// Every draw call of a timeline, sampled every `step` ms: one digest per frame.
export function frameDigests(R, timeline, step = 100) {
  const out = [];
  for (let t = 0; t < timeline.durationMs; t += step) {
    const { ctx, log } = recorder();
    R.drawFrame(ctx, timeline, t, envFor());
    out.push(createHash('sha256').update(JSON.stringify(log)).digest('hex').slice(0, 16));
  }
  return out;
}
export function frameLog(R, timeline, t) {
  const { ctx, log } = recorder();
  R.drawFrame(ctx, timeline, t, envFor());
  return log;
}
