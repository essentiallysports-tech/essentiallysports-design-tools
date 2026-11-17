#!/usr/bin/env node
// Video Ads styles without footage (Today's 3, Us vs Them; Stat Card and
// Quote Card were removed on 2026-11-18): layout per size, draw order, the motion timeline, the Meta safe
// zone, minimum type sizes, contrast, file names for the variant grid and
// the style suggestion. Text is measured with a stub (width = characters ×
// size × 0.5) so the test needs no canvas.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../video-ads-render.js');
const B = require('../video-ads-brands.js');
const S = require('../video-ads-styles.js');

const sizeOf = font => Number(String(font).match(/([\d.]+)px/)[1]);
const measure = (text, font) => [...String(text)].length * sizeOf(font) * 0.5;
const logo = { width: 270.45, height: 74.93 };
const NEW = ['today3', 'versus'];

assert.deepEqual(B.NEW_STYLES, NEW, 'two no-footage styles, in order');
assert.ok(!B.STYLES.stat && !B.STYLES.quote, 'Stat Card and Quote Card are gone');
assert.equal(B.styleOr('stat'), 'highlight', 'saved state naming a removed style falls back to Highlight');
assert.equal(B.styleOr('quote'), 'highlight');
assert.equal(B.styleOr('today3'), 'today3');
assert.deepEqual(B.CLASSIC_STYLES, ['simple', 'condensed', 'highlight']);
assert.deepEqual(R.STYLE_IDS, NEW, 'the renderer has a layout for each new style');
NEW.forEach(id => {
  assert.equal(B.STYLES[id].needsFootage, false, `${id} works without footage`);
  assert.ok(Object.keys(R.SPEC[id]).sort().join() === '1x1,4x5,9x16', `${id} has a spec per size`);
});

const copyFor = brand => ({
  cta: brand.cta, unsubscribe: true,
  offer: `Get the day’s news in ${brand.label}. Free.`,
  listTitle: 'What fans need to know today',
  items: ['Mahomes rallies the Chiefs late in Denver', 'Bears name a new offensive coordinator', 'Lions clinch the NFC North with two weeks left'],
  them: ['Endless hot takes', 'Rumours dressed as news', 'Too many apps'],
  us: brand.verifiedClaims.slice(0, 3),
});
const longCopy = brand => ({
  ...copyFor(brand),
  offer: `Get every number like this one in ${brand.label}, the free email for fans who want the real story.`,
  items: ['The Kansas City Chiefs rally late again in Denver to stay alive in the race for the top seed', 'Chicago names a brand new offensive coordinator after a long and difficult search', 'Detroit clinches the NFC North with two full weeks of the regular season still left'],
});

// ── 1. Layout: every style, size, brand; short and long copy ─────────────
const hue = hex => {
  const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return null; // grey
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const opBottom = op => (op.type === 'text' ? op.y : op.y + (op.h || 0)); // baseline, as Figma measures
const opTop = op => (op.type === 'text' ? op.y - sizeOf(op.font) * (/Acumin/.test(op.font) ? R.CAP.condensed : R.CAP.body) : op.y); // cap top
for (const brand of B.AD_BRANDS) {
  for (const style of NEW) {
    for (const size of Object.values(B.SIZES)) {
      for (const [kind, copy] of [['short', copyFor(brand)], ['long', longCopy(brand)]]) {
        const tag = `${brand.id} ${style} ${size.id} ${kind}`;
        const r = R.fitLayout(measure, { ...copy, style }, brand, size, logo);
        assert.equal(r.zone, 'meta', `${tag}: new styles always use the Meta safe zone`);
        if (kind === 'short') assert.equal(r.fits, true, `${tag} fits`);
        const texts = r.ops.filter(op => op.type === 'text');
        // Fonts: Acumin / Roboto / Roboto Condensed only. No purple anywhere.
        texts.forEach(op => assert.match(op.font, /Acumin|Roboto/, `${tag} font ${op.font}`));
        r.ops.forEach(op => { const h = hue(op.fill); assert.ok(h == null || h < 255 || h > 315, `${tag}: no purple (${op.fill})`); });
        // Minimum sizes on the 1080 canvas: body 44, labels 38, unsubscribe 34.
        texts.forEach(op => {
          const px = sizeOf(op.font);
          const floor = op.role === 'unsub' ? 34 : (op.role === 'label' || op.role === 'cta') ? 38 : op.role === 'deco' ? 0 : 44;
          assert.ok(px >= floor - 0.05, `${tag}: ${op.role} "${op.text}" is ${px}px (min ${floor})`);
        });
        assert.ok(texts.some(op => op.role === 'unsub' && sizeOf(op.font) >= 34), `${tag}: unsubscribe at 34px+`);
        if (!r.fits) continue;
        // Inside the content band (9:16: y 270–1250) and the side margins.
        const zone = B.safeFor(size, 'meta');
        const band = { top: zone.safe.top, bottom: size.height - zone.safe.bottom };
        r.ops.filter(op => op.type !== 'logo' && op.role !== 'deco').forEach(op => {
          assert.ok(opTop(op) >= band.top - 1, `${tag}: "${op.text || op.type}" below the top of the band (${opTop(op)})`);
          assert.ok(opBottom(op) <= band.bottom + 1, `${tag}: "${op.text || op.type}" above the bottom of the band (${opBottom(op)})`);
          if (op.type === 'text') {
            assert.ok(op.x >= zone.safe.side - 1, `${tag}: text inside the left margin`);
            assert.ok(op.x + measure(op.text, op.font) <= size.width - zone.safe.side + 1, `${tag}: "${op.text}" inside the right margin`);
          }
        });
        // The CTA: its bottom (the unsubscribe line) at y ≤ 1250 on 9:16, and
        // the button clear of the Reels action rail.
        const unsub = r.ops.find(op => op.role === 'unsub');
        const button = r.ops.find(op => op.type === 'button');
        assert.ok(unsub.y <= band.bottom + 0.5, `${tag}: CTA bottom ${unsub.y} ≤ ${band.bottom}`);
        if (size.id === '9x16') {
          assert.ok(band.bottom === 1250, '9:16 band ends at y 1250');
          assert.ok(S.insideSafe({ x: button.x, y: button.y, w: button.w, h: button.h }, size, 'meta'), `${tag}: the button is clear of Meta's UI and the action rail`);
        }
      }
    }
  }
}

// ── 2. Draw order ─────────────────────────────────────────────────────────
const huddle = B.byId('the-huddle');
const cfb = B.byId('essentially-cfb');
const L = (style, brand = huddle, size = B.SIZES['9x16'], extra = {}) => R.fitLayout(measure, { ...copyFor(brand), ...extra, style }, brand, size, logo);
for (const style of NEW) {
  const { ops } = L(style, cfb);
  // The logo first; the CTA last: button, mail icon, label, unsubscribe.
  assert.equal(ops[0].type, 'logo', `${style}: logo first`);
  const tail = ops.slice(-4).map(op => op.type === 'text' ? op.role : op.type);
  assert.deepEqual(tail, ['button', 'mail', 'cta', 'unsub'], `${style}: CTA drawn last`);
  // Text in the highlight colours always sits on a highlight box drawn before it.
  ops.forEach((op, i) => {
    if (op.type !== 'text' || op.fill !== cfb.highlight.fg || op.role === 'cta') return;
    const under = ops.slice(0, i).reverse().find(b => b.type === 'box' && b.fill === cfb.highlight.bg && b.x <= op.x + 1 && b.x + b.w >= op.x + measure(op.text, op.font) - 1 && b.y <= op.y && b.y + b.h >= op.y - sizeOf(op.font) * 0.7);
    assert.ok(under, `${style}: "${op.text}" sits on its highlight box`);
  });
}
{
  const { ops } = L('versus');
  const cards = ops.filter(op => op.type === 'box' && op.w > 900);
  assert.equal(cards.length, 2, 'two stacked cards');
  assert.ok(cards[0].y < cards[1].y, '"Your feed" on top, the newsletter below');
  assert.equal(cards[1].fill, huddle.wordmark.bg, 'the newsletter card is in the brand colour');
  const feed = ops.find(op => op.text === 'YOUR FEED');
  assert.ok(ops.indexOf(cards[0]) < ops.indexOf(feed), 'card before its label');
  const strikes = ops.filter(op => op.type === 'box' && op.anim?.kind === 'wipe' && op.fill === huddle.highlight.bg);
  assert.equal(strikes.length, 3, 'one strike per "your feed" line');
  strikes.forEach(strike => {
    const item = ops.filter(op => op.type === 'text' && op.y > strike.y && op.y - strike.y < 40).pop();
    assert.ok(item && ops.indexOf(item) < ops.indexOf(strike), 'the strike is drawn over its line');
  });
  const ticks = ops.filter(op => op.type === 'tick');
  assert.equal(ticks.length, 3, 'one tick per claim');
  const claims = ops.filter(op => op.type === 'text' && op.role !== 'unsub' && huddle.verifiedClaims.includes(op.text));
  assert.equal(claims.length, 3, 'the claims are the approved ones, word for word');
  ticks.forEach((tick, i) => assert.ok(ops.indexOf(tick) < ops.indexOf(claims[i]), 'tick before its claim'));
}
{
  const { ops } = L('today3');
  const discs = ops.filter(op => op.type === 'box' && Math.abs(op.r - op.w / 2) < 0.01);
  assert.equal(discs.length, 3, 'three numbered discs');
  ['1', '2', '3'].forEach((digit, i) => {
    const d = ops.find(op => op.text === digit);
    assert.ok(ops.indexOf(discs[i]) < ops.indexOf(d), `disc ${digit} under its digit`);
  });
  const square = R.fitLayout(measure, { ...copyFor(huddle), style: 'today3' }, huddle, B.SIZES['1x1'], logo);
  assert.equal(square.ops.filter(op => op.type === 'box' && Math.abs(op.r - op.w / 2) < 0.01).length, 2, '1:1: two rows');
  assert.ok(square.ops.some(op => op.text === '+1 MORE IN THE NEWSLETTER'), '1:1: "+1 more" for the third');
}

// ── 3. Motion timeline ────────────────────────────────────────────────────
const D = 8;
const visible = st => st.alpha >= 0.999 && Math.abs(st.dy) < 0.01 && Math.abs(st.scale - 1) < 0.001 && st.wipe >= 0.999;
for (const style of NEW) {
  for (const duration of [8, 5, 3]) {
    const { ops } = L(style);
    const ctaOps = ops.filter(op => ['button', 'mail'].includes(op.type) || op.role === 'cta' || op.role === 'unsub');
    // Frame 0 shows the hook (the logo and the display text) fully.
    const at0 = R.frameState(ops, 0, duration);
    ops.forEach((op, i) => { if (op.type === 'logo' || op.role === 'display') assert.ok(at0[i].alpha === 1, `${style}: "${op.text || op.type}" visible at t 0`); });
    // The CTA is in by 40% of the duration and holds to the last frame.
    [R.CTA_BY * duration, duration * 0.7, duration].forEach(t => {
      const st = R.frameState(ops, t, duration);
      ctaOps.forEach(op => assert.ok(visible(st[ops.indexOf(op)]), `${style} ${duration}s: CTA fully in at ${t.toFixed(2)}s`));
      // By 40% everything has arrived.
      ops.forEach((op, i) => assert.ok(visible(st[i]), `${style} ${duration}s: "${op.text || op.type}" settled at ${t.toFixed(2)}s`));
    });
    // Before it arrives, the CTA is not fully there.
    const early = R.frameState(ops, 0, duration);
    assert.ok(ctaOps.every(op => early[ops.indexOf(op)].alpha < 1), `${style}: the CTA enters, it is not there at t 0`);
  }
}
{
  // Short ads: times scale so the last entrance ends at 40%.
  const { ops } = L('today3');
  const last = R.lastEntrance(ops);
  assert.ok(Math.abs(last - (R.TIMING.today3.cta + 0.35)) < 1e-9);
  assert.equal(R.animScale(ops, 10), 1, 'long enough: real-time entrances');
  assert.ok(Math.abs(R.animScale(ops, 3) * last - 1.2) < 1e-9, '3 s ad: all in by 1.2 s');
  assert.equal(R.animScale(ops, 0), 1);
  // Rows arrive one after another (8 s ad).
  const rows = R.TIMING.today3.rows;
  const rowText = ops.filter(op => op.type === 'text' && op.role === 'body' && op.anim?.kind === 'rise' && rows.includes(op.anim.at));
  rows.forEach(at => {
    const mine = rowText.filter(op => op.anim.at === at);
    assert.ok(mine.length >= 1);
    mine.forEach(op => {
      assert.equal(R.animAt(op, at - 0.01, 1).alpha, 0, 'not yet');
      const mid = R.animAt(op, at + 0.12, 1);
      assert.ok(mid.alpha > 0 && mid.alpha < 1 && mid.dy > 0, 'rising');
      assert.ok(visible(R.animAt(op, at + 0.36, 1)), 'in');
    });
  });
}
{
  // Us vs Them: the strikes wipe, the ticks pop.
  const v = L('versus').ops;
  const strike = v.find(op => op.anim?.kind === 'wipe');
  assert.equal(R.animAt(strike, strike.anim.at, 1).alpha, 0, 'no strike before its time');
  const half = R.animAt(strike, strike.anim.at + 0.1, 1);
  assert.ok(half.wipe > 0 && half.wipe < 1 && half.alpha === 1);
  const tick = v.find(op => op.type === 'tick');
  assert.ok(R.animAt(tick, tick.anim.at + 0.05, 1).scale < 1, 'the tick pops');
}
{
  // Exit: an op with `out` holds, then fades out.
  const op = { type: 'text', text: 'x', anim: { at: 1, dur: 0.5, kind: 'fade', out: { at: 3, dur: 0.5 } } };
  assert.equal(R.animAt(op, 0.5).alpha, 0);
  assert.equal(R.animAt(op, 2).alpha, 1, 'holds');
  assert.ok(R.animAt(op, 3.25).alpha < 1 && R.animAt(op, 3.25).alpha > 0, 'leaving');
  assert.equal(R.animAt(op, 4).alpha, 0, 'gone');
  // No clock: settled.
  assert.deepEqual(R.animAt(op, undefined), { alpha: 1, dy: 0, scale: 1, wipe: 1 });
}

// ── 4. Drawing: a recording context ───────────────────────────────────────
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { calls.push([key, ...args.map(a => (typeof a === 'number' ? Math.round(a * 100) / 100 : typeof a === 'object' ? 'obj' : a))]); return { addColorStop() {} }; };
    },
    set(target, key, value) { calls.push([`=${String(key)}`, typeof value === 'number' ? Math.round(value * 1000) / 1000 : value]); return true; },
  });
  return { ctx, calls };
}
{
  // The classic styles have no anim: a clock changes nothing, frame for frame.
  const classic = R.fitLayout(measure, { style: 'highlight', headline: 'The NFL moves too fast to keep up with.', highlight: 'too fast', body: ['Never miss a move. And it’s free!'], cta: 'SIGN UP THE HUDDLE', unsubscribe: true, align: 'left' }, huddle, B.SIZES['9x16'], logo);
  assert.ok(classic.ops.every(op => !op.anim), 'classic ops carry no anim');
  const a = recorder();
  const b = recorder();
  R.drawOps(a.ctx, classic.ops, {});
  R.drawOps(b.ctx, classic.ops, {}, { t: 0.2, duration: 6 });
  assert.deepEqual(b.calls, a.calls, 'classic styles draw the same with or without the timeline');
  // New styles: nothing animated is drawn before it enters…
  const v = L('versus').ops;
  const early = recorder();
  R.drawOps(early.ctx, v, {}, { t: 0, duration: 8 });
  const drawnText = calls => calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(drawnText(early.calls).includes('YOUR FEED') && drawnText(early.calls).includes('Endless hot takes'), 'the hook at t 0');
  assert.ok(!drawnText(early.calls).includes(huddle.verifiedClaims[0]), 'claims arrive later');
  assert.ok(!drawnText(early.calls).includes('SIGN UP THE HUDDLE'), 'the CTA arrives later');
  // …and the last frame matches the settled (no clock) frame.
  const settled = recorder();
  const last = recorder();
  R.drawOps(settled.ctx, v, {});
  R.drawOps(last.ctx, v, {}, { t: 8, duration: 8 });
  assert.deepEqual(drawnText(last.calls), drawnText(settled.calls), 'the last frame shows the whole ad');
}

// ── 5. Contrast (WCAG 4.5:1) for text on the style's own colours ──────────
const contrast = (a, b) => { const [x, y] = [R.luminance(a), R.luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
for (const brand of B.AD_BRANDS) {
  assert.ok(contrast(brand.highlight.fg, brand.highlight.bg) >= 4.5, `${brand.id}: pill / disc text on the highlight colour`);
  assert.ok(contrast('#FFFFFF', brand.wordmark.bg) >= 4.5, `${brand.id}: claims on the brand card`);
  assert.ok(contrast(brand.wordmark.fg, brand.wordmark.bg) >= 4.5, `${brand.id}: brand label on the brand card`);
}
assert.ok(contrast('#FFFFFF', '#2A2F3A') >= 4.5, '"Your feed" card');
assert.ok(contrast('#FFFFFF', '#000000') >= 4.5, 'white copy over the default black tint');

// ── 6. Safe zones ─────────────────────────────────────────────────────────
{
  const reel = B.SIZES['9x16'];
  const z = S.safeZoneRects(reel, 'meta');
  assert.equal(z.band.top, 270);
  assert.equal(z.band.bottom, 1250);
  assert.ok(Math.abs(z.share.bottom - 0.35) < 0.002, `bottom ≈ 35% (${z.share.bottom})`);
  assert.ok(Math.abs(z.share.top - 0.14) < 0.002, `top ≈ 14% (${z.share.top})`);
  assert.ok(Math.abs(z.share.side - 0.06) < 0.001, `sides ≈ 6% (${z.share.side})`);
  assert.deepEqual(z.rects.rail, { x: 960, y: 1000, w: 120, h: 250 }, 'the action rail');
  assert.equal(z.rects.bottom.y + z.rects.bottom.h, 1920);
  const classic = S.safeZoneRects(reel, 'classic');
  assert.equal(classic.band.bottom, 1500, 'classic: the original 420px bottom margin');
  assert.equal(classic.rects.rail, undefined);
  // Feed sizes: the same in both modes.
  ['4x5', '1x1'].forEach(id => assert.deepEqual(S.safeZoneRects(B.SIZES[id], 'meta'), S.safeZoneRects(B.SIZES[id], 'classic')));
  assert.equal(B.safeFor(reel, 'meta').centerY, 760, 'copy centred in the band');
  assert.equal(B.safeFor(reel, 'classic'), reel);
  assert.ok(S.insideSafe({ x: 200, y: 1100, w: 600, h: 100 }, reel, 'meta'));
  assert.ok(!S.insideSafe({ x: 200, y: 1200, w: 600, h: 100 }, reel, 'meta'), 'under the caption area');
  assert.ok(!S.insideSafe({ x: 700, y: 1100, w: 300, h: 100 }, reel, 'meta'), 'on the action rail');
  assert.ok(S.insideSafe({ x: 700, y: 900, w: 300, h: 80 }, reel, 'meta'), 'beside the rail is fine above y 1000');
  assert.ok(S.insideSafe({ x: 200, y: 1300, w: 600, h: 100 }, reel, 'classic'));
  // The renderer and the brands file agree.
  assert.deepEqual(R.zoneSize(reel, 'meta'), B.safeFor(reel, 'meta'));

  // Classic styles: 'meta' keeps the whole stack inside y 270–1250.
  const ad = { style: 'condensed', headline: 'The NFL moves too fast to keep up with.', body: ['Injuries, trades, benchings: miss one day and you’re lost in your group chat.', 'Never miss a move. And it’s free!'], cta: 'SIGN UP THE HUDDLE', unsubscribe: true, align: 'center' };
  const meta = R.fitLayout(measure, { ...ad, safeZone: 'meta' }, huddle, reel, logo);
  const old = R.fitLayout(measure, { ...ad, safeZone: 'classic' }, huddle, reel, logo);
  const oldDefault = R.fitLayout(measure, ad, huddle, reel, logo);
  assert.deepEqual(old.ops, oldDefault.ops, 'no safeZone = classic, as before');
  assert.equal(meta.zone, 'meta');
  assert.equal(meta.fits, true);
  const metaUnsub = meta.ops.find(op => op.text === 'Unsubscribe anytime');
  assert.ok(metaUnsub.y <= 1250 + 0.01, `classic style in the Meta zone ends by y 1250 (${metaUnsub.y})`);
  assert.ok(old.ops.find(op => op.text === 'Unsubscribe anytime').y > 1250, 'the classic layout runs lower');
  meta.ops.filter(op => op.type !== 'logo').forEach(op => assert.ok(opTop(op) >= 269, 'and below y 270'));
}

// ── 7. Variant grid file names ────────────────────────────────────────────
{
  const date = new Date(2026, 10, 18);
  assert.equal(S.fileName({ brand: huddle, style: 'versus', angle: 1, size: B.SIZES['9x16'], date }), 'huddle_versus_a1_1080x1920_20261118.mp4');
  assert.equal(S.fileName({ brand: cfb, style: 'today3', angle: 2, size: B.SIZES['4x5'], date }), 'cfb_today3_a2_1080x1350_20261118.mp4');
  assert.equal(S.fileName({ brand: B.byId('es-dugout'), style: 'highlight', angle: 0, size: B.SIZES['1x1'], date, ext: 'webm' }), 'dugout_highlight_a0_1080x1080_20261118.webm');
  const slugs = B.AD_BRANDS.map(S.brandSlug);
  assert.equal(new Set(slugs).size, slugs.length, 'brand slugs are unique');
  const styleSlugs = Object.keys(B.STYLES).map(S.styleSlug);
  assert.equal(new Set(styleSlugs).size, styleSlugs.length, 'style slugs are unique');
  styleSlugs.forEach(slug => assert.match(slug, /^[a-z0-9]+$/, 'no underscores inside a part'));
  for (const brand of B.AD_BRANDS) {
    for (const style of Object.keys(B.STYLES)) {
      for (const size of Object.values(B.SIZES)) {
        const name = S.fileName({ brand, style, angle: 3, size, date });
        assert.deepEqual(S.parseFileName(name), { brand: S.brandSlug(brand), style, angle: 3, width: size.width, height: size.height, date: '20261118', ext: 'mp4' }, `round trip ${name}`);
      }
    }
  }
  assert.equal(S.parseFileName('random.mp4'), null);
}

// ── 8. Style readiness and the fact helpers ───────────────────────────────
{
  assert.equal(S.styleReady('today3', { items: ['a', ''] }).ok, false);
  assert.equal(S.styleReady('today3', { items: ['a', 'b'] }).ok, true);
  assert.equal(S.styleReady('versus', { them: ['a', 'b'], us: ['c'] }).ok, false);
  assert.equal(S.styleReady('condensed', { headline: 'Hi' }).ok, true);
  assert.ok(S.groundedIn('Mahomes rallies Chiefs in Denver', ['Mahomes rallies the Chiefs late in Denver']));
  assert.ok(!S.groundedIn('Aliens land at Arrowhead', ['Mahomes rallies the Chiefs late in Denver']));
  assert.ok(S.namesSomeone('Hot takes from ESPN'));
  assert.ok(!S.namesSomeone('Endless hot takes'));
  assert.equal(S.approvedClaim('unsubscribe anytime.', huddle.verifiedClaims), 'Unsubscribe anytime');
  assert.equal(S.approvedClaim('Read by 2 million fans', huddle.verifiedClaims), '');
  B.AD_BRANDS.forEach(brand => {
    assert.ok(brand.verifiedClaims.length >= 2, `${brand.id}: approved claims for Us vs Them`);
    assert.equal(brand.claimsApproved, false, `${brand.id}: placeholder claims stay flagged until the owner approves them`);
    brand.verifiedClaims.forEach(claim => assert.equal(S.numberTokens(claim).length, 0, 'no unverified numbers in the placeholder claims'));
    const d = S.defaultsFor(brand, 'versus');
    assert.match(d.offer, /free/i, 'the default offer says free');
    [d.offer, d.listTitle, ...d.them].forEach(text => assert.equal(S.numberTokens(text).length, 0, `defaults carry no numbers: ${text}`));
  });
}

// ── 9. Style suggestion: rules first, learning and AI only break ties ─────
{
  const approved = { ...huddle, claimsApproved: true };
  const base = { brand: approved, hasClip: false };
  // Approved claims, no clip: Us vs Them leads (it needs no footage).
  let facts = S.briefFacts({ ...base, notes: 'The Chiefs keep winning close games.' });
  let s = S.suggestStyles(facts, { brand: approved });
  assert.equal(s.style, 'versus', 'approved claims make Us vs Them the default with no clip');
  assert.equal(s.alternatives.length, 2);
  assert.ok(!s.scores.some(x => x.style === 'stat' || x.style === 'quote'), 'removed styles are never suggested');
  // Placeholder claims (not owner-approved): never suggested first.
  facts = S.briefFacts({ brand: huddle, hasClip: false, notes: 'The Chiefs keep winning close games.' });
  assert.equal(facts.claimsApproved, false);
  s = S.suggestStyles(facts, { brand: huddle });
  assert.equal(s.style, 'highlight', 'unapproved claims lose to a classic layout');
  assert.ok(s.scores.some(x => x.style === 'versus'), 'Us vs Them stays available');
  // Three related headlines unlock Today's 3.
  facts = S.briefFacts({ ...base, trendTitle: 'Chiefs win', related: ['Mahomes rallies the Chiefs', 'Bears fire their coordinator', 'Lions clinch the North'] });
  assert.ok(S.suggestStyles(facts, { brand: approved }).scores.some(x => x.style === 'today3'));
  // Today's 3 and Us vs Them tie on the prior; the brand's exports break it.
  const tie = S.suggestStyles(facts, { brand: approved, ranking: [{ style: 'today3', score: 1 }, { style: 'versus', score: 0.2 }] });
  assert.equal(tie.style, 'today3');
  assert.match(tie.text, /Huddle’s most-used style/);
  const tie2 = S.suggestStyles(facts, { brand: approved, ranking: [{ style: 'versus', score: 1 }] });
  assert.equal(tie2.style, 'versus');
  // Learning + the AI pick never overturn a clear rule-based lead.
  const lead = S.suggestStyles(facts, { brand: approved, ranking: [{ style: 'simple', score: 1 }], aiPick: 'simple' });
  assert.notEqual(lead.style, 'simple', 'a clear lead stands');
  assert.ok(S.LEARNED_WEIGHT + S.AI_WEIGHT < 0.1);
  // With a clip the classic styles lose their no-footage penalty.
  const withClip = S.suggestStyles(S.briefFacts({ brand: { ...huddle, verifiedClaims: [] }, hasClip: true, notes: 'Big win.' }), { brand: huddle });
  assert.equal(withClip.style, 'highlight');
}

// ── 10. Copy checks (the rating rubric, free) ─────────────────────────────
{
  const good = S.copyChecks({ style: 'condensed', headline: 'Your team. Your Sunday. Your inbox.', body: ['Get The Huddle, one free email with the NFL news that matters.'], cta: 'SIGN UP THE HUDDLE' }, huddle);
  assert.equal(good.passed, 4, JSON.stringify(good.checks));
  const bad = S.copyChecks({ style: 'condensed', headline: 'You won’t believe this INSANE comeback!!', body: ['The Chiefs did something last night that absolutely nobody who has watched this league for decades could have predicted at all.'], cta: 'CLICK' }, huddle);
  const failed = bad.checks.filter(c => !c.ok).map(c => c.id).sort();
  assert.deepEqual(failed, ['cta', 'offer', 'readable', 'trust']);
  bad.checks.forEach(c => assert.ok(c.tip.length > 5, 'each check has a tip'));
  // Us vs Them on placeholder claims is flagged for trust.
  const vs = S.copyChecks({ style: 'versus', them: ['Endless hot takes', 'Too many apps'], us: huddle.verifiedClaims.slice(0, 2), offer: 'Switch to The Huddle. It’s free.' }, huddle);
  assert.equal(vs.checks.find(c => c.id === 'trust').ok, false);
  assert.equal(S.copyChecks({ ...vs, style: 'versus', them: ['Endless hot takes', 'Too many apps'], us: huddle.verifiedClaims.slice(0, 2), offer: 'Switch to The Huddle. It’s free.' }, { ...huddle, claimsApproved: true }).checks.find(c => c.id === 'trust').ok, true);
}

// ── 11. Daily set planning ────────────────────────────────────────────────
{
  const plan = S.planDailySet([
    { style: 'highlight', headline: 'One free email has it all', highlight: 'one free email', body: ['x'] },
    { style: 'highlight', headline: 'No box here', highlight: 'missing words', body: ['x'] },
    { style: 'today3', headline: 'h', body: [], items: ['only one'] },
    { style: 'stat', headline: 'Old style', body: ['x'] },
    { style: 'condensed', headline: 'one free email has it all!', body: ['dupe'] },
  ]);
  assert.equal(plan.length, 3, 'three angles at most');
  assert.equal(plan[0].style, 'highlight', 'a ready style is kept');
  assert.equal(plan[1].style, 'condensed', 'a highlight without its phrase becomes Condensed');
  assert.equal(plan[2].style, 'condensed', 'Today’s 3 without headlines falls back to a classic style');
  assert.ok(!plan.some(a => a.copy.headline === 'Old style'), 'only three, in order');
  assert.equal(S.planDailySet([{ style: 'stat', headline: 'Old style', body: ['x'] }])[0].style, 'condensed', 'a removed style becomes a classic one');
  assert.deepEqual(S.planDailySet(null), []);
}

// ── 12. Pre-export check ──────────────────────────────────────────────────
{
  const copy = { style: 'condensed', headline: 'Your team. Your inbox.', body: ['Get The Huddle, one free email.'], cta: 'SIGN UP THE HUDDLE' };
  assert.deepEqual(S.preflight({ copy, brand: huddle, sizes: [{ id: '9x16', fits: true, scale: 1 }], hasMedia: true }), [], 'a clean ad has nothing to fix');
  const issues = S.preflight({ copy: { ...copy, body: [] }, brand: huddle, sizes: [{ id: '9x16', fits: false, scale: 0.68 }, { id: '4x5', fits: true, scale: 0.7 }], hasMedia: false, safeZone: 'classic', unsubscribe: false });
  const ids = issues.map(i => i.id);
  ['media', 'fit', 'small', 'zone', 'unsub', 'copy-offer'].forEach(id => assert.ok(ids.includes(id), `flags ${id}`));
  assert.equal(issues.find(i => i.id === 'media').fix, 'make-animated');
  assert.equal(issues.find(i => i.id === 'fit').text, 'Too much copy for 9:16.');
  assert.equal(issues.find(i => i.id === 'small').text.includes('4:5'), true);
  assert.equal(issues.find(i => i.id === 'copy-offer').fix, 'add-free');
  issues.forEach(i => assert.ok(['bad', 'warn'].includes(i.level)));
}

console.log('Video Ads styles tests passed.');
