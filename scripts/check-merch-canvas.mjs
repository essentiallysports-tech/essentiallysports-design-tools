// Merch Designs: on-canvas move/resize (merch-canvas.js) in real headless Chrome.
//
//   node scripts/check-merch-canvas.mjs <harness.html> <tee-photo.jpg> [<merch-print-with-xIn.js>]
//   (or MERCH_CANVAS_HARNESS / MERCH_TEE_PHOTO / MERCH_PRINT_XIN)
//
// The harness page is kept out of the repo (scratch): it loads frameup-rules.js,
// brand-kit.js, merch-rules.js, merch-print.js and merch-canvas.js, draws the
// design on a real Fourthwall tee photo (Stanley/Stella, photo 0) or the close-up,
// attaches MerchCanvas and exposes window.H. The photo is served as /__qa/tee.jpg.
// The optional third file is a merch-print.js that understands fit.xIn (the
// engine lane's change), served as /merch-print-xin.js for ?engine=xin.
//
// Checks: overlay matches the drawn design within 3 canvas px (photo + close-up),
// hover cursor + outline, move / resize / Shift centre snap / clamping with live
// (final:false) and one final:true per gesture, keyboard (arrows, Shift, +/-, 0,
// aria-live), nothing on an uncalibrated photo, the canvas pixels untouched by
// the overlay, pinch on touch, dark-mode outline colour.
import fs from 'node:fs';
import { startServer, startChrome, findChrome, sleep } from './_qa-chrome.mjs';

const [harness, photo, xin] = [process.argv[2] || process.env.MERCH_CANVAS_HARNESS, process.argv[3] || process.env.MERCH_TEE_PHOTO, process.argv[4] || process.env.MERCH_PRINT_XIN];
if (!harness || !fs.existsSync(harness) || !photo || !fs.existsSync(photo)) { console.log('skip: pass the harness page and a Fourthwall tee photo (see the header)'); process.exit(0); }
const chromePath = findChrome();
if (!chromePath) { console.log('skip: no Chrome'); process.exit(0); }

const { server, base } = await startServer({
  extra: url => {
    if (url.pathname === '/__qa/harness.html') return { type: 'text/html', body: fs.readFileSync(harness) };
    if (url.pathname === '/__qa/tee.jpg') return { type: 'image/jpeg', body: fs.readFileSync(photo) };
    if (url.pathname === '/merch-print-xin.js' && xin && fs.existsSync(xin)) return { type: 'text/javascript', body: fs.readFileSync(xin) };
    return null;
  },
});
// One fresh Chrome per engine run (CDP touch input misbehaves on a second page load).
let chrome = null;
const send = (...a) => chrome.send(...a);
const ev = (...a) => chrome.evaluate(...a);
let fails = 0;
let passes = 0;
const ok = (cond, msg) => { if (cond) { passes += 1; console.log('ok', msg); } else { fails += 1; console.log('FAIL', msg); } };
const until = async (expr, label, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(60); } throw new Error(`timeout: ${label}`); };

const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : (extra.down ? 1 : type === 'mousePressed' ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1, modifiers: extra.shift ? 8 : 0, pointerType: 'mouse' });
async function dragBy(from, dx, dy, { shift = false, steps = 8, midCheck = null } = {}) {
  await mouse('mouseMoved', from.x, from.y);
  await mouse('mousePressed', from.x, from.y, { shift });
  let mid = null;
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + (dx * i) / steps, from.y + (dy * i) / steps, { down: true, shift });
    await sleep(20);
    if (midCheck && i === Math.ceil(steps / 2)) mid = await ev(midCheck);
  }
  await sleep(40);
  await mouse('mouseReleased', from.x + dx, from.y + dy, { shift });
  await sleep(60);
  await ev('H.settle()');
  await sleep(40);
  return mid;
}
const key = async (k, { shift = false } = {}) => {
  const codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, '+': 187, '-': 189, '0': 48 };
  const base_ = { key: k, code: { '+': 'Equal', '-': 'Minus', '0': 'Digit0' }[k] || k, windowsVirtualKeyCode: codes[k], modifiers: shift || k === '+' ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base_, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base_ });
  await sleep(60);
  await ev('H.settle()');
};
const box = () => ev('H.overlayBox()');
const fit = () => ev('JSON.parse(JSON.stringify(H.S.concept.fit))');
const lastLog = n => ev(`H.S.log.slice(-${n})`);
async function matchCheck(label) {
  await ev('H.settle()');
  await sleep(50);
  const o = await box();
  const d = await ev('H.designBBox()');
  if (!o || !d) { ok(false, `${label}: overlay ${JSON.stringify(o)} / drawn ${JSON.stringify(d)}`); return; }
  const err = Math.max(Math.abs(o.x - d.x), Math.abs(o.y - d.y), Math.abs(o.x + o.w - d.x - d.w), Math.abs(o.y + o.h - d.y - d.h));
  ok(err <= 3, `${label}: overlay matches the drawn design (worst edge ${err.toFixed(2)} canvas px; drawn ${d.w}×${d.h} at ${d.x},${d.y})`);
}
const centre = o => ({ x: o.client.x + o.client.w / 2, y: o.client.y + o.client.h / 2 });

async function run(engine) {
  chrome = await startChrome(chromePath, { width: 1000, height: 800 });
  await send('Page.enable');
  await send('Runtime.enable');
  try { await runIn(engine); } finally { chrome.close(); }
}
async function runIn(engine) {
  const tag = engine === 'xin' ? '[xIn engine]' : '[current engine]';
  await send('Page.navigate', { url: `${base}/__qa/harness.html${engine === 'xin' ? '?engine=xin' : ''}` });
  await until("window.H && document.getElementById('cv').height === 960 && !document.querySelector('.mx-cv').hidden", 'harness ready', 15000);
  await sleep(300);
  await ev('H.settle()');
  const hasX = await ev("Object.prototype.hasOwnProperty.call(MerchPrint.fitOf({ fit: { xIn: 1 } }), 'xIn')");
  console.log(`\n${tag} engine has xIn: ${hasX}`);

  // 1. Photo: overlay over the drawn design; DOM only.
  ok(await ev("document.querySelector('.mx-cv__box').getAttribute('role') === 'group' && document.querySelector('.mx-cv__box').tabIndex === 0 && document.querySelector('.mx-cv__box').getAttribute('aria-label') === 'Design position'"), `${tag} overlay is a focusable group named "Design position"`);
  ok(await ev("document.querySelectorAll('.mx-cv__h').length === 4 && document.querySelector('.mx-cv [role=status][aria-live=polite]') !== null && document.querySelectorAll('#mx-canvas-css').length === 1"), `${tag} 4 corner handles, a live region, CSS injected once`);
  await matchCheck(`${tag} tee photo 0`);

  // 2. Hover: move cursor + outline (DOM, not canvas pixels).
  const pixelsBefore = await ev("document.getElementById('cv').toDataURL()");
  let o = await box();
  await mouse('mouseMoved', centre(o).x, centre(o).y);
  await sleep(250);
  ok(await ev("getComputedStyle(document.querySelector('.mx-cv__box')).cursor === 'move' && getComputedStyle(document.querySelector('.mx-cv__box'), '::before').opacity === '1' && getComputedStyle(document.querySelector('.mx-cv__h')).opacity === '1'"), `${tag} hover: move cursor, outline and handles show`);
  ok(await ev("getComputedStyle(document.querySelector('.mx-cv__h[data-corner=se]')).cursor === 'nwse-resize' && getComputedStyle(document.querySelector('.mx-cv__h[data-corner=ne]')).cursor === 'nesw-resize'"), `${tag} corner handles have resize cursors`);
  ok(pixelsBefore === await ev("document.getElementById('cv').toDataURL()"), `${tag} hover/outline leaves the canvas pixels untouched (downloads unaffected)`);

  // 3. Move down 40 CSS px: topIn grows, live updates then one final.
  const f0 = await fit();
  const d0 = await ev('H.designBBox()');
  await ev('H.S.log = []');
  o = await box();
  await dragBy(centre(o), 0, 40);
  const f1 = await fit();
  const log = await ev('H.S.log');
  ok(log.filter(l => l.final).length === 1 && log[log.length - 1].final === true && log.some(l => !l.final), `${tag} move: ${log.filter(l => !l.final).length} live updates, then one final (one undo step)`);
  const d1 = await ev('H.designBBox()');
  const s = o.scale;
  ok(Number.isFinite(f1.topIn) && Math.abs((d1.y - d0.y) * s - 40) <= 3, `${tag} move: drawn design followed the pointer (${((d1.y - d0.y) * s).toFixed(1)} CSS px for 40; topIn ${f0.topIn} -> ${f1.topIn} in)`);
  ok(Math.abs(f1.scale - f0.scale) < 1e-9, `${tag} move keeps the size`);
  await matchCheck(`${tag} after move`);
  ok(await ev("H.S.selects >= 1 && document.activeElement === document.querySelector('.mx-cv__box')"), `${tag} press selects (onSelect) and focuses the design`);

  // 4. Sideways + Shift snap.
  o = await box();
  await dragBy(centre(o), 50, 0);
  const fx = await fit();
  if (hasX) {
    ok(fx.xIn > 1, `${tag} sideways move sets xIn (${fx.xIn} in)`);
    await matchCheck(`${tag} after sideways move`);
    o = await box();
    const guideMid = await dragBy(centre(o), -10, 0, { shift: true, midCheck: "!document.querySelector('.mx-cv__guide').hidden" });
    ok((await fit()).xIn === 0 && guideMid === true, `${tag} Shift snaps to the centre line and shows the guide while dragging`);
    ok(await ev("document.querySelector('.mx-cv__guide').hidden"), `${tag} guide hides on release`);
  } else ok(!fx.xIn, `${tag} engine without xIn: the design stays centred (xIn ${fx.xIn})`);

  // 5. Clamping: far up / far down stays inside the print area.
  o = await box();
  await dragBy(centre(o), 0, -(centre(o).y - 8)); // to the top of the window (CDP drops events outside it)
  const fu = await fit();
  ok(fu.topIn >= 0.5 - 1e-9, `${tag} dragged far up: topIn clamps at ${fu.topIn} in (min 0.5)`);
  o = await box();
  await dragBy(centre(o), 0, 780 - centre(o).y);
  const fd = await fit();
  const inside = await ev("(() => { const m = MerchCanvas._measure(H.S.concept, { ...MerchPrint.DEFAULT_AREAS.tee, pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, kind: 'tee' }); return { bottom: m.box.y + m.box.h, inH: m.area.inH }; })()");
  ok(fd.topIn <= 10 && inside.bottom <= inside.inH + 0.01, `${tag} dragged far down: topIn ${fd.topIn} in, design bottom ${inside.bottom.toFixed(2)} of ${inside.inH} in`);
  await matchCheck(`${tag} after clamped move`);
  // Back to a mid-chest spot for the resize.
  await key('0');
  ok(JSON.stringify(await fit()) === JSON.stringify({ scale: 1, topIn: null, xIn: 0 }), `${tag} 0 resets the fit`);

  // 6. Corner resize: se outward grows; the anchor holds.
  const r0 = await ev('H.designBBox()');
  o = await box();
  await ev('H.S.log = []');
  // A modest pull, so the anchored left edge doesn't push the right edge out of the area.
  const midTag = await dragBy({ x: o.client.x + o.client.w, y: o.client.y + o.client.h }, 8, 3, { midCheck: "!document.querySelector('.mx-cv__tag').hidden && /in$/.test(document.querySelector('.mx-cv__tag').textContent)" });
  const fr = await fit();
  const r1 = await ev('H.designBBox()');
  ok(fr.scale > 1.03 && fr.scale <= 1.6, `${tag} se corner drag grows the design (scale ${fr.scale})`);
  ok(midTag === true, `${tag} size tag (W × H in) shows while resizing`);
  ok((await ev('H.S.log')).filter(l => l.final).length === 1, `${tag} resize commits once`);
  ok(Math.abs(r1.y - r0.y) <= 3, `${tag} resize from se keeps the top edge (${r0.y} -> ${r1.y})`);
  if (hasX) ok(Math.abs(r1.x - r0.x) <= 3, `${tag} resize from se keeps the left edge (${r0.x} -> ${r1.x})`);
  else ok(Math.abs((r1.x + r1.w / 2) - (r0.x + r0.w / 2)) <= 3, `${tag} no xIn: resize keeps the centre line (${(r0.x + r0.w / 2).toFixed(1)} -> ${(r1.x + r1.w / 2).toFixed(1)})`);
  await matchCheck(`${tag} after resize`);
  // nw inward shrinks; bottom edge holds.
  const q0 = await ev('H.designBBox()');
  o = await box();
  await dragBy({ x: o.client.x, y: o.client.y }, 60, 18);
  const fq = await fit();
  const q1 = await ev('H.designBBox()');
  ok(fq.scale < fr.scale && fq.scale >= 0.6, `${tag} nw corner drag inward shrinks (scale ${fr.scale} -> ${fq.scale})`);
  ok(Math.abs((q1.y + q1.h) - (q0.y + q0.h)) <= 3, `${tag} resize from nw keeps the bottom edge (${q0.y + q0.h} -> ${q1.y + q1.h})`);
  await matchCheck(`${tag} after shrink`);

  // 7. Keyboard.
  await key('0');
  await ev("document.querySelector('.mx-cv__box').focus()");
  await key('ArrowDown');
  const k1 = await fit();
  const kd = await ev("(() => { const m = MerchCanvas._measure({ ...H.S.concept, fit: { scale: 1, topIn: null } }, { ...MerchPrint.DEFAULT_AREAS.tee, pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, kind: 'tee' }); return m.box.y; })()");
  ok(Math.abs(k1.topIn - (kd + 0.1)) < 0.011, `${tag} ArrowDown moves 0.1 in (design top ${kd.toFixed(2)} -> topIn ${k1.topIn})`);
  await key('ArrowDown', { shift: true });
  ok(Math.abs((await fit()).topIn - k1.topIn - 0.5) < 0.011, `${tag} Shift+ArrowDown moves 0.5 in`);
  await key('ArrowUp');
  ok(Math.abs((await fit()).topIn - k1.topIn - 0.4) < 0.011, `${tag} ArrowUp moves back 0.1 in`);
  await key('+');
  ok(Math.abs((await fit()).scale - 1.05) < 1e-9, `${tag} + grows 5%`);
  await key('-'); await key('-');
  ok(Math.abs((await fit()).scale - 0.95) < 1e-9, `${tag} − shrinks 5%`);
  await sleep(120);
  const said = await ev("document.querySelector('.mx-cv [role=status]').textContent");
  ok(/95% size/.test(said) && /in from the top/.test(said), `${tag} aria-live says "${said}"`);
  await key('ArrowRight');
  if (hasX) ok(Math.abs((await fit()).xIn - 0.1) < 0.011, `${tag} ArrowRight moves 0.1 in right`);
  else ok(!(await fit()).xIn, `${tag} ArrowRight: stays centred on this engine`);
  ok((await ev('H.S.log.slice(-1)[0].final')) === true, `${tag} key changes commit (final: true)`);
  await key('0');
  await matchCheck(`${tag} after keyboard reset`);

  // 8. Uncalibrated photo: nothing.
  await ev('H.set({ calibrated: false, photoIndex: 2 })');
  await sleep(100);
  ok(await ev("document.querySelector('.mx-cv').hidden && H.ctl.box() === null"), `${tag} uncalibrated photo: no outline or handles`);
  await ev('H.set({ calibrated: true, photoIndex: 0 })');
  await sleep(100);
  ok(await ev("!document.querySelector('.mx-cv').hidden"), `${tag} back on a calibrated photo: overlay returns`);

  // 9. Close-up.
  await ev("H.set({ view: 'closeup' })");
  await until("document.getElementById('cv').height === 840", 'close-up drawn');
  await sleep(100);
  await matchCheck(`${tag} close-up`);
  o = await box();
  const ghostMid = await dragBy({ x: o.client.x + o.client.w, y: o.client.y + o.client.h }, -50, -10, { midCheck: "!document.querySelector('.mx-cv__ghost').hidden" });
  const fc = await fit();
  ok(fc.scale < 1 && ghostMid === true, `${tag} close-up resize: scale ${fc.scale}, ghost preview follows the pointer`);
  ok(await ev("document.querySelector('.mx-cv__ghost').hidden"), `${tag} close-up ghost hides on release`);
  await matchCheck(`${tag} close-up after resize (re-centred)`);
  o = await box();
  await dragBy(centre(o), 0, 30);
  ok((await fit()).topIn !== null, `${tag} close-up move maps to topIn (${(await fit()).topIn} in)`);
  await key('0');

  // 10. Pinch (touch).
  await ev("H.set({ view: 'tee' })");
  await until("document.getElementById('cv').height === 960", 'tee drawn');
  await sleep(150);
  o = await box();
  const c = centre(o);
  const tp = (x, y, id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(c.x - 20, c.y, 1)] });
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(c.x - 20, c.y, 1), tp(c.x + 20, c.y, 2)] });
  for (let i = 1; i <= 6; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(c.x - 20 - i * 4, c.y, 1), tp(c.x + 20 + i * 4, c.y, 2)] }); await sleep(30); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(100);
  await ev('H.settle()');
  const fp = await fit();
  ok(fp.scale > 1.2, `${tag} pinch out on touch grows the design (scale ${fp.scale})`);
  await key('0');

  // 11. Dark mode outline colour.
  const blue = await ev("(() => { document.documentElement.dataset.theme = 'dark'; return getComputedStyle(document.querySelector('.mx-cv')).getPropertyValue('--mx-cv-blue').trim(); })()");
  ok(/3D96FB/i.test(blue), `${tag} dark mode: brand blue outline (${blue})`);
  await ev("delete document.documentElement.dataset.theme");

  // 12. detach removes everything.
  await ev('H.ctl.detach()');
  ok(await ev("!document.querySelector('.mx-cv')"), `${tag} detach removes the overlay`);
}

try {
  const order = process.env.MERCH_CANVAS_ORDER === 'xin-first' ? ['xin', 'current'] : ['current', 'xin'];
  for (const engine of order) {
    if (engine === 'xin' && !(xin && fs.existsSync(xin))) continue;
    await run(engine);
  }
  if (!(xin && fs.existsSync(xin))) console.log('\n(skipped the xIn engine run: no third file)');
} catch (error) {
  fails += 1;
  console.log('FAIL', error.message);
} finally {
  server.close();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
