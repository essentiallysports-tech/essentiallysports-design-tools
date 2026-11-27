/* Merch ads (merch.html "Make an ad"): static social ads for a merch product
   or a chosen design, in FrameUp's ES social look. The scenes are drawn by
   FrameUpCompose.render (Generate's Creative renderer: ES pills, ES fonts,
   team mist, the ES mark top-right), so ads match the rest of FrameUp.
   Formats: feed post 1080 x 1350, story 1080 x 1920, carousel of 3 to 5
   feed slides. Download: one PNG, or a .zip (frameup-zip.js) for the
   carousel / every size. Both renderer files load on first open.

     MerchAds.open({
       title, line, lineSource: 'ai'|'code', fallbackLine, words: [...],
       price, url, palette: { a, b }, collection,
       images: [{ src, label, kind: 'photo'|'live'|'flat'|'closeup', color }],
       check(line) -> '' | problem, onLine(line), track(data), name
     })
     MerchAds.qr(text) -> { size, modules } (QR code, byte mode, ECC M)
     MerchAds.scenes(state) -> [scene] (for tests)

   The ad line comes from the page (one cached AI copy call at most, else a
   code line). No AI call happens here. Nothing is uploaded: images stay in
   the browser and downloads are made locally. */
(function (root) {
  'use strict';
  const COMPOSE = 'frameup-compose.js?v=20261125-genq';
  const ZIP = 'frameup-zip.js?v=20261118-rel1';
  const SAFE = 50;
  const FORMATS = {
    feed: { label: 'Feed post', w: 1080, h: 1350, note: '1080 × 1350, Instagram and Facebook feed' },
    story: { label: 'Story', w: 1080, h: 1920, note: '1080 × 1920, stories and reels covers' },
    carousel: { label: 'Carousel', w: 1080, h: 1350, note: '3 to 5 slides, 1080 × 1350 each' },
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
  const upper = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const slug = s => String(s || 'es-merch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'es-merch';
  const loadScript = src => new Promise(resolve => { const s = document.createElement('script'); s.src = src; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.append(s); });

  // ─── QR code (ISO 18004; byte mode, error correction M, versions 1–10) ──
  // Ported from Project Nayuki's QR Code generator (MIT), trimmed to what an
  // ad needs: a product link of up to 213 bytes.
  const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const a = Math.floor(ver / 7) + 2; n -= (25 * a - 10) * a - 55; if (ver >= 7) n -= 36; }
    return n;
  }
  const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1;
    let root_ = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root_); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root_ = gfMul(root_, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  function qr(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text || '')));
    let ver = 0;
    for (let v = 1; v <= 10; v++) { const cap = dataCodewords(v) * 8; const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8; if (need <= cap) { ver = v; break; } }
    if (!ver) return null;
    // Data bits: mode 0100, count, bytes, terminator, pad.
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    // Error correction blocks, interleaved.
    const nBlocks = BLOCKS_M[ver]; const eccLen = ECC_PER_BLOCK_M[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks); const shortLen = Math.floor(raw / nBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]); });
    // Modules.
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2;
      const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach((x, i) => pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const format = mask => {
      const d = (0 << 3) | mask; // ECC M = 00
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      const bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1; const a = size - 11 + (i % 3); const c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? size - 1 - v : v;
        if (!fn[y][x] && i < words.length * 8) { m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const apply = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => {
      let p = 0; let dark = 0;
      const line = get => { let run = 1; for (let k = 1; k < size; k++) { if (get(k) === get(k - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } };
      for (let y = 0; y < size; y++) line(x => m[y][x]);
      for (let x = 0; x < size; x++) line(y => m[y][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
      const pat = [true, false, true, true, true, false, true];
      const finderLike = get => { for (let k = 0; k + 7 <= size; k++) { if (pat.every((v, n) => get(k + n) === v)) { const before = k >= 4 && [1, 2, 3, 4].every(n => !get(k - n)); const after = k + 11 <= size && [7, 8, 9, 10].every(n => !get(k + n)); if (before || after) p += 40; } } };
      for (let y = 0; y < size; y++) finderLike(x => m[y][x]);
      for (let x = 0; x < size; x++) finderLike(y => m[y][x]);
      m.forEach(r => r.forEach(c => { if (c) dark++; }));
      const total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let best = 0; let bestP = Infinity;
    for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(); if (p < bestP) { bestP = p; best = k; } apply(k); }
    apply(best); format(best);
    return { version: ver, size, mask: best, modules: m };
  }
  // A QR code as a data URL: dark modules on white, 4-module quiet zone.
  function qrDataUrl(text, px = 8) {
    const code = qr(text);
    if (!code) return '';
    const n = code.size + 8;
    const c = document.createElement('canvas');
    c.width = c.height = n * px;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#0E1014';
    code.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect((x + 4) * px, (y + 4) * px, px, px); }));
    return c.toDataURL('image/png');
  }

  // ─── Scenes ──────────────────────────────────────────────────────────────
  const C = () => root.FrameUpCompose;
  const hexOk = h => /^#[0-9a-f]{6}$/i.test(String(h || ''));
  function paletteOf(p) {
    const colors = [p?.a, p?.b].filter(hexOk);
    return C().makePalette(colors.length ? colors : ['#033162', '#0A7DFA'], { name: 'ES merch' });
  }
  const mistLayer = (W, H, P, from) => ({ type: 'shape', shape: 'gradient', mist: true, x: 0, y: Math.round(H * from), w: W, h: H - Math.round(H * from), color: P.bg, stops: [[0, 0], [0.42, 0.56], [0.7, 0.83], [1, 0.9]] });
  const grain = o => ({ type: 'shape', shape: 'grain', x: 0, y: 0, w: 0, h: 0, opacity: o });
  const fieldBg = P => ({ type: 'background', fill: { kind: 'radial', colors: [mixHex(P.bg, P.accent, 0.24), P.bg], at: { x: 0.5, y: 0.3 } }, texture: 'halftone', textureColor: P.accent, textureOpacity: 0.1 });
  function mixHex(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    if (!hexOk(a) || !hexOk(b)) return hexOk(a) ? a : '#033162';
    const [r, g, bl] = p(a); const [R, G, B] = p(b);
    const m = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return `#${m(r, R)}${m(g, G)}${m(bl, B)}`.toUpperCase();
  }
  const fullBleed = img => img && (img.kind === 'photo' || img.kind === 'live');
  // The ad's bottom block (headline pills, product label, Shop now, link, QR),
  // stacked up from the bottom safe line. Returns layers.
  function textBlock(st, P, W, H, { bottom, headH, head = true, cta = true }) {
    const out = [];
    const qrOn = cta && st.qr && st.qrSrc;
    const textW = W - SAFE * 2 - (qrOn ? 250 : 0);
    let y = H - bottom;
    if (qrOn) out.push({ type: 'photo', role: 'art', src: st.qrSrc, x: W - SAFE - 220, y: y - 220, w: 220, h: 220, mask: 'none', fit: 'contain' });
    if (cta && st.link && st.url) {
      y -= 36;
      out.push({ type: 'text', role: 'body', text: st.urlText, x: SAFE, y, w: textW, h: 36, font: 'condensed', size: 32, minSize: 22, maxLines: 1, color: P.inkSoft || P.ink, align: 'left', valign: 'top', tracking: 0.5 });
      y -= 16;
    }
    if (cta && st.shop) {
      y -= 76;
      out.push({ type: 'pill', role: 'label', text: 'SHOP NOW', x: SAFE, y, h: 76, color: P.onAccent, bg: P.accent, maxW: 520 });
      y -= 26;
    }
    const label = [st.title, st.priceOn && st.price ? money(st.price) : ''].filter(Boolean).join('  ·  ');
    if (label) {
      y -= 48;
      out.push({ type: 'text', role: 'label', text: upper(label), x: SAFE, y, w: textW, h: 48, font: 'condensed', size: 40, minSize: 24, maxLines: 1, color: P.ink, align: 'left', valign: 'top', tracking: 1.5 });
      y -= 22;
    }
    if (head && st.line) out.unshift({ type: 'text', role: 'headline', text: upper(st.line), x: SAFE, y: y - headH, w: W - SAFE * 2 - 60, h: headH, font: 'pill', size: 124, minSize: 60, maxLines: 3, color: P.pillInk || P.onAccent, align: 'left', valign: 'bottom', box: { color: P.pillBg || P.accent } });
    return out;
  }
  function heroScene(st, img, fmt, { cta = true, kicker = 'NEW DROP', swipeHint = false } = {}) {
    const P = st.P;
    const W = FORMATS[fmt].w; const H = FORMATS[fmt].h;
    const story = fmt === 'story';
    const bottom = story ? 300 : SAFE + 6;
    const top = story ? 230 : SAFE + 12;
    const layers = [];
    if (fullBleed(img)) {
      layers.push({ type: 'background', fill: { kind: 'solid', colors: [P.bg] } });
      layers.push({ type: 'photo', src: img.src, x: 0, y: 0, w: W, h: H, mask: 'rect', focus: { x: 0.5, y: 0.42 } });
      layers.push(mistLayer(W, H, P, story ? 0.5 : 0.44));
    } else {
      layers.push(fieldBg(P));
      if (img) {
        const boxH = Math.round(H * (story ? 0.5 : 0.52));
        layers.push({ type: 'photo', role: 'art', src: img.src, x: 110, y: top + 90, w: W - 220, h: boxH, mask: 'none', fit: 'contain', fx: { shadow: { color: '#000000', blur: 46, x: 0, y: 20, alpha: 0.45 } } });
      }
    }
    if (kicker) layers.push({ type: 'pill', role: 'kicker', text: kicker, x: SAFE, y: top, h: 58, color: P.bg, bg: P.ink, maxW: 640 });
    layers.push(...textBlock(st, P, W, H, { bottom, headH: story ? 520 : 400, cta }));
    if (swipeHint) layers.push({ type: 'pill', role: 'label', text: 'SWIPE', x: W - SAFE - 300, y: H - bottom - 58, h: 58, color: P.bg, bg: P.ink, maxW: 300, align: 'right' });
    layers.push(grain(0.04));
    return { size: { w: W, h: H }, layers, palette: P, swipe: false };
  }
  // Carousel middle slide: the design close-up, another colour or angle.
  function detailScene(st, img, label) {
    const P = st.P; const W = 1080; const H = 1350;
    const layers = [];
    if (fullBleed(img)) {
      layers.push({ type: 'background', fill: { kind: 'solid', colors: [P.bg] } });
      layers.push({ type: 'photo', src: img.src, x: 0, y: 0, w: W, h: H, mask: 'rect', focus: { x: 0.5, y: 0.42 } });
      layers.push(mistLayer(W, H, P, 0.7));
    } else {
      layers.push(fieldBg(P));
      layers.push({ type: 'photo', role: 'art', src: img.src, x: 90, y: 170, w: W - 180, h: H - 420, mask: 'none', fit: 'contain', fx: { shadow: { color: '#000000', blur: 46, x: 0, y: 20, alpha: 0.45 } } });
    }
    layers.push({ type: 'pill', role: 'kicker', text: upper(label), x: SAFE, y: SAFE + 12, h: 58, color: P.bg, bg: P.ink, maxW: 700 });
    if (st.title) layers.push({ type: 'text', role: 'label', text: upper(st.title), x: SAFE, y: H - SAFE - 6 - 48, w: W - SAFE * 2, h: 48, font: 'condensed', size: 40, minSize: 24, maxLines: 1, color: P.ink, align: 'left', valign: 'top', tracking: 1.5 });
    layers.push(grain(0.04));
    return { size: { w: W, h: H }, layers, palette: P, swipe: false };
  }
  // Carousel last slide: the product small, Shop now, price, link, QR.
  function ctaScene(st, img) {
    const P = st.P; const W = 1080; const H = 1350;
    const layers = [fieldBg(P)];
    if (img) layers.push({ type: 'photo', role: 'art', src: img.flatSrc || img.src, x: 190, y: 150, w: W - 380, h: 560, mask: 'none', fit: 'contain', fx: { shadow: { color: '#000000', blur: 40, x: 0, y: 18, alpha: 0.45 } } });
    const st2 = { ...st, line: st.shop ? 'Shop now' : (st.line || 'Get yours') };
    layers.push(...textBlock({ ...st2, shop: false }, P, W, H, { bottom: SAFE + 6, headH: 300, cta: true }));
    layers.push(grain(0.04));
    return { size: { w: W, h: H }, layers, palette: P, swipe: false };
  }
  const ANGLE_WORD = { front: 'Front', side: 'Side view', back: 'Back view', lifestyle: 'On the street', flat: 'Flat lay', detail: 'Close-up' };
  function slideLabel(img) {
    if (img.kind === 'closeup') return 'The design';
    if (img.color && img.angle && ANGLE_WORD[img.angle] && img.angle !== 'front') return `${ANGLE_WORD[img.angle]} · ${img.color}`;
    if (img.color) return `Also in ${img.color}`;
    return img.label || 'Up close';
  }
  // Every scene for the current choices (one for feed / story, 3–5 for a carousel).
  function scenes(st) {
    const hero = st.images[st.hero] || st.images[0] || null;
    if (st.format !== 'carousel') return [heroScene(st, hero, st.format)];
    const rest = st.images.filter(x => x !== hero);
    const close = rest.find(x => x.kind === 'closeup');
    const others = rest.filter(x => x !== close).slice(0, close ? 2 : 3);
    const middle = [close, ...others].filter(Boolean).slice(0, 3);
    while (middle.length < 1 && hero) middle.push({ ...hero, kind: hero.kind, label: 'Up close' });
    return [heroScene(st, hero, 'feed', { cta: false, swipeHint: true }), ...middle.map(img => detailScene(st, img, slideLabel(img))), ctaScene(st, st.images.find(x => x.kind === 'flat' || x.kind === 'closeup') || hero)];
  }

  // ─── Images: load once, keep the ones that draw ─────────────────────────
  function loadImg(src) {
    return new Promise(resolve => {
      const img = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  // Flat art gets rounded corners so the card look reads as a product shot.
  function rounded(img, r = 0.05) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d');
    const rad = Math.round(Math.min(c.width, c.height) * r);
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, c.width, c.height, rad); else g.rect(0, 0, c.width, c.height);
    g.clip();
    g.drawImage(img, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/png'); } catch { return ''; }
  }
  async function prepare(list) {
    const out = [];
    for (const x of list || []) {
      if (!x?.src) continue;
      const img = await loadImg(x.src);
      if (!img || !(img.naturalWidth > 0)) continue;
      const flat = x.kind === 'flat' || x.kind === 'closeup';
      const src = flat ? rounded(img) || x.src : x.src;
      out.push({ ...x, src, thumb: x.src, w: img.naturalWidth, h: img.naturalHeight });
    }
    return out;
  }

  // ─── Dialog ──────────────────────────────────────────────────────────────
  let st = null;
  let token = 0;
  let renderT = 0;
  const $ = id => document.getElementById(id);
  function dialog() { return $('mx-ad'); }
  function urlText(u) { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.length > 1 ? x.pathname : ''}`.slice(0, 64); } catch { return String(u || '').slice(0, 64); } }
  function shell() {
    const d = dialog();
    const fmtBtn = id => `<button class="es-segmented__item" type="button" role="radio" aria-checked="${st.format === id}" tabindex="${st.format === id ? 0 : -1}" data-ad-format="${id}">${esc(FORMATS[id].label)}</button>`;
    d.innerHTML = `
      <div class="mx-ad__head">
        <div class="mx-ad__titles">
          <p class="mx-ad__eyebrow"><span class="es-ai-mark" aria-hidden="true"></span>Make an ad</p>
          <h2 class="mx-h2" id="mx-ad-h">${esc(st.title || 'Your merch')}</h2>
        </div>
        <button class="es-icon-btn es-icon-btn--plain mx-ad__x" type="button" data-ad-close aria-label="Close"><svg class="mx-i" viewBox="0 0 24 24" aria-hidden="true"><use href="#mx-i-close"/></svg></button>
      </div>
      <div class="mx-ad__body">
        <section class="mx-ad__stage" aria-label="Ad preview">
          <div class="mx-ad__frames" id="mx-ad-frames" data-format="${st.format}" aria-busy="true"></div>
          <p class="mx-ad__cap" id="mx-ad-cap" aria-live="polite"></p>
        </section>
        <div class="mx-ad__side">
          <div class="mx-ad__field">
            <span class="mx-ad__key" id="mx-ad-format-label">Format</span>
            <div class="es-segmented es-segmented--sm mx-ad__formats" id="mx-ad-format" role="radiogroup" aria-labelledby="mx-ad-format-label">${Object.keys(FORMATS).map(fmtBtn).join('')}</div>
            <p class="mx-meta" id="mx-ad-format-note">${esc(FORMATS[st.format].note)}</p>
          </div>
          <div class="mx-ad__field">
            <label class="mx-ad__key" for="mx-ad-line">Ad line</label>
            <div class="mx-ad__line">
              <input class="mx-input" id="mx-ad-line" type="text" maxlength="48" autocomplete="off" spellcheck="true" value="${esc(st.line)}" aria-describedby="mx-ad-line-note">
              <button class="es-btn es-btn--ghost es-btn--sm" type="button" id="mx-ad-line-reset" title="Use the suggested line">Reset</button>
            </div>
            <p class="mx-ad__note" id="mx-ad-line-note" role="status" aria-live="polite"></p>
          </div>
          <div class="mx-ad__field">
            <span class="mx-ad__key" id="mx-ad-pics-label">Lead image</span>
            <div class="mx-ad__pics" id="mx-ad-pics" role="radiogroup" aria-labelledby="mx-ad-pics-label"></div>
          </div>
          <fieldset class="mx-ad__field mx-ad__opts">
            <legend class="mx-ad__key">On the ad</legend>
            <label class="mx-ad__opt"><input type="checkbox" data-ad-opt="priceOn"${st.priceOn ? ' checked' : ''}${st.price ? '' : ' disabled'}><span>Price${st.price ? ` <span class="mx-ad__opt-meta">${esc(money(st.price))}</span>` : ' <span class="mx-ad__opt-meta">set a price first</span>'}</span></label>
            <label class="mx-ad__opt"><input type="checkbox" data-ad-opt="shop"${st.shop ? ' checked' : ''}><span>Shop now button</span></label>
            <label class="mx-ad__opt"><input type="checkbox" data-ad-opt="link"${st.link ? ' checked' : ''}${st.url ? '' : ' disabled'}><span>Product link${st.url ? ` <span class="mx-ad__opt-meta">${esc(urlText(st.url))}</span>` : ' <span class="mx-ad__opt-meta">after it’s created</span>'}</span></label>
            <label class="mx-ad__opt"><input type="checkbox" data-ad-opt="qr"${st.qr ? ' checked' : ''}${st.url ? '' : ' disabled'}><span>QR code to the product</span></label>
          </fieldset>
          <div class="mx-ad__actions">
            <button class="es-btn es-btn--primary mx-ad__dl" type="button" id="mx-ad-download"><span id="mx-ad-download-label">Download PNG</span></button>
            <button class="es-btn es-btn--ghost es-btn--sm" type="button" id="mx-ad-all">All sizes (.zip)</button>
            <p class="mx-ad__note" id="mx-ad-status" role="status" aria-live="polite"></p>
            <p class="mx-ad__fine">ES mark top-right. No team logos or league marks. Check the line before posting.</p>
          </div>
        </div>
      </div>`;
  }
  function renderPics() {
    const box = $('mx-ad-pics');
    if (!box) return;
    box.innerHTML = st.images.map((x, i) => `<button class="mx-ad__pic" type="button" role="radio" aria-checked="${i === st.hero}" tabindex="${i === st.hero ? 0 : -1}" data-ad-pic="${i}" aria-label="${esc(x.label || `Image ${i + 1}`)}" title="${esc(x.label || '')}"><img src="${esc(x.thumb)}" alt="" loading="lazy"></button>`).join('') || '<p class="mx-meta">No product images yet.</p>';
  }
  function syncControls() {
    document.querySelectorAll('#mx-ad-format [data-ad-format]').forEach(b => { const on = b.dataset.adFormat === st.format; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    const note = $('mx-ad-format-note'); if (note) note.textContent = FORMATS[st.format].note;
    const frames = $('mx-ad-frames'); if (frames) frames.dataset.format = st.format;
    const n = st.format === 'carousel' ? scenes(st).length : 1;
    const lbl = $('mx-ad-download-label'); if (lbl) lbl.textContent = st.format === 'carousel' ? `Download ${n} slides (.zip)` : `Download ${FORMATS[st.format].label.toLowerCase()} PNG`;
    document.querySelectorAll('[data-ad-opt="qr"]').forEach(x => { x.disabled = !st.url; });
  }
  function lineNote() {
    const el = $('mx-ad-line-note');
    if (!el) return;
    const problem = st.problem;
    el.classList.toggle('is-bad', Boolean(problem));
    el.textContent = problem || (st.line === st.suggested ? (st.lineSource === 'ai' ? 'Written by AI from your design. Edit it if you like.' : 'A suggested line. Edit it if you like.') : 'Your line.');
  }
  async function draw() {
    const t = ++token;
    const frames = $('mx-ad-frames');
    if (!frames || !st) return;
    const list = scenes(st);
    frames.setAttribute('aria-busy', 'true');
    // One canvas per scene, reused while the count stays the same.
    if (frames.children.length !== list.length || frames.dataset.n !== String(list.length)) {
      frames.innerHTML = list.map((_, i) => `<figure class="mx-ad__frame"><canvas class="mx-ad__canvas" role="img" aria-label="${esc(st.format === 'carousel' ? `Slide ${i + 1} of ${list.length}` : `${FORMATS[st.format].label} preview`)}"></canvas>${st.format === 'carousel' ? `<figcaption aria-hidden="true">${i + 1} / ${list.length}</figcaption>` : ''}</figure>`).join('');
      frames.dataset.n = String(list.length);
    }
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const cssW = st.format === 'story' ? 300 : st.format === 'carousel' ? 250 : 400;
    let missing = 0;
    for (const [i, scene] of list.entries()) {
      const cv = frames.children[i]?.querySelector('canvas');
      if (!cv) continue;
      try {
        const off = document.createElement('canvas');
        const report = await C().render(scene, off, { scale: (cssW * dpr) / scene.size.w });
        missing += (report?.missing || []).length;
        if (t !== token) return;
        cv.width = off.width; cv.height = off.height;
        cv.getContext('2d').drawImage(off, 0, 0);
        cv.classList.add('is-drawn');
      } catch (error) { console.warn('merch ad draw', error); }
    }
    if (t !== token) return;
    frames.setAttribute('aria-busy', 'false');
    const cap = $('mx-ad-cap');
    if (cap) cap.textContent = missing ? 'One image couldn’t be drawn here, so the ad uses the others.' : st.format === 'carousel' ? `${list.length} slides. Swipe order left to right.` : FORMATS[st.format].note;
  }
  function schedule(ms = 120) { clearTimeout(renderT); renderT = setTimeout(draw, ms); syncControls(); }
  async function toBlob(scene) {
    const cv = document.createElement('canvas');
    await C().render(scene, cv, { scale: 1 });
    return new Promise((resolve, reject) => { try { cv.toBlob(b => (b ? resolve(b) : reject(new Error('empty'))), 'image/png'); } catch (error) { reject(error); } });
  }
  function save(blob, name, info = {}) {
    MerchAds.last = { name, type: blob.type, size: blob.size, blob };
    // A downloaded ad is an export: Dashboard -> Exports, like every other tool.
    try {
      const zip = /\.zip$/i.test(name);
      const f = FORMATS[st?.format] || null;
      root.FrameUpTrack?.exported?.({ tool: 'merch', format: zip ? 'zip' : 'png', dest: 'download', label: st?.title || st?.name || name, bytes: blob.size, count: info.count || 1, width: zip ? 0 : f?.w, height: zip ? 0 : f?.h, template: `Ad · ${info.all ? 'all sizes' : (f?.label || st?.format || '')}`, thumb: info.thumb || (zip ? '' : blob), meta: { file: name, kind: 'ad', format: info.all ? 'all' : st?.format || '' } });
    } catch { /* tracking never blocks a download */ }
    if (root.__mxAdSave) { root.__mxAdSave(blob, name); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function zipOf(files) {
    if (!root.FrameUpZip) await loadScript(ZIP);
    const entries = await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()), date: new Date() })));
    return new Blob([root.FrameUpZip.zip(entries)], { type: 'application/zip' });
  }
  async function download(all = false) {
    if (!st || st.busy) return;
    if (st.problem) { status(st.problem); $('mx-ad-line')?.focus(); return; }
    st.busy = true;
    const btn = $(all ? 'mx-ad-all' : 'mx-ad-download');
    btn?.setAttribute('aria-busy', 'true');
    status(all ? 'Drawing every size…' : 'Drawing at full size…');
    const base = slug(st.name || st.title);
    try {
      if (!all && st.format !== 'carousel') {
        const blob = await toBlob(scenes(st)[0]);
        save(blob, `${base}-${st.format}-${FORMATS[st.format].w}x${FORMATS[st.format].h}.png`);
        status(`Saved ${FORMATS[st.format].label.toLowerCase()} PNG.`);
      } else {
        const files = [];
        const formats = all ? ['feed', 'story', 'carousel'] : ['carousel'];
        for (const f of formats) {
          const list = scenes({ ...st, format: f });
          for (const [i, sc] of list.entries()) files.push({ name: f === 'carousel' ? `${base}-carousel-${i + 1}-of-${list.length}.png` : `${base}-${f}-${FORMATS[f].w}x${FORMATS[f].h}.png`, blob: await toBlob(sc) });
        }
        save(await zipOf(files), `${base}-${all ? 'ads' : 'carousel'}.zip`, { count: files.length, all, thumb: files[0]?.blob });
        status(`Saved ${files.length} PNG${files.length === 1 ? '' : 's'} in a .zip.`);
      }
      st.track?.({ action: 'ad-download', format: all ? 'all' : st.format, line: st.line === st.suggested ? st.lineSource : 'edited', price: st.priceOn, link: st.link, qr: st.qr });
    } catch (error) {
      console.warn('merch ad export', error);
      status('The ad couldn’t be saved: an image blocked the download. Pick another lead image and try again.');
    }
    btn?.removeAttribute('aria-busy');
    st.busy = false;
  }
  function status(text) { const el = $('mx-ad-status'); if (el) el.textContent = text || ''; }
  function setLine(v) {
    st.line = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    st.problem = st.line ? (st.check ? st.check(st.line) : '') : 'Add a short line for the ad.';
    lineNote();
    if (!st.problem) { st.onLine?.(st.line); schedule(250); }
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const d = dialog();
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-ad-close]')) { close(); return; }
      const f = e.target.closest('[data-ad-format]');
      if (f) { st.format = f.dataset.adFormat; status(''); schedule(0); st.track?.({ action: 'ad-format', format: st.format }); return; }
      const p = e.target.closest('[data-ad-pic]');
      if (p) { st.hero = Number(p.dataset.adPic) || 0; renderPics(); schedule(0); d.querySelector(`[data-ad-pic="${st.hero}"]`)?.focus(); return; }
      if (e.target.closest('#mx-ad-line-reset')) { const i = $('mx-ad-line'); if (i) i.value = st.suggested; setLine(st.suggested); return; }
      if (e.target.closest('#mx-ad-download')) { download(false); return; }
      if (e.target.closest('#mx-ad-all')) download(true);
    });
    d.addEventListener('keydown', e => {
      const group = e.target.closest('#mx-ad-format, #mx-ad-pics');
      const dlt = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!group || !dlt) return;
      e.preventDefault();
      const items = [...group.querySelectorAll('[role=radio]')];
      const i = items.findIndex(x => x.getAttribute('aria-checked') === 'true');
      const next = items[(i + dlt + items.length) % items.length];
      next?.click(); next?.focus();
    });
    d.addEventListener('input', e => { if (e.target.id === 'mx-ad-line') setLine(e.target.value); });
    d.addEventListener('change', e => {
      const o = e.target.closest('[data-ad-opt]');
      if (!o) return;
      st[o.dataset.adOpt] = o.checked;
      if (o.dataset.adOpt === 'qr' && o.checked && !st.qrSrc) st.qrSrc = qrDataUrl(st.url);
      schedule(0);
    });
    d.addEventListener('close', () => { token++; clearTimeout(renderT); st?.returnTo?.focus?.({ preventScroll: true }); });
  }
  function close() { const d = dialog(); if (d?.open) d.close(); }
  async function open(input = {}) {
    const d = dialog();
    if (!d) return false;
    const fresh = !st || st.key !== input.key;
    st = {
      key: input.key || '', name: input.name || input.title, title: String(input.title || '').slice(0, 80),
      suggested: String(input.line || input.fallbackLine || 'Wear the moment.').slice(0, 48), lineSource: input.lineSource || 'code',
      line: fresh || !st ? String(input.line || input.fallbackLine || 'Wear the moment.').slice(0, 48) : st.line,
      price: Number(input.price) > 0 ? Number(input.price) : 0, url: /^https?:\/\//.test(String(input.url || '')) ? String(input.url) : '',
      format: (!fresh && st?.format) || input.format || 'feed', hero: 0, images: [], palette: input.palette || null,
      check: input.check || null, onLine: input.onLine || null, track: input.track || null, returnTo: document.activeElement, busy: false, problem: '',
    };
    st.priceOn = st.price > 0; st.shop = true; st.link = Boolean(st.url); st.qr = false; st.qrSrc = ''; st.urlText = urlText(st.url);
    shell();
    wire();
    if (typeof d.showModal === 'function' && !d.open) d.showModal(); else d.setAttribute('open', '');
    lineNote();
    syncControls();
    status('Getting the images ready…');
    if (!C()) await loadScript(COMPOSE);
    if (!C()?.render) { status('The ad maker didn’t load. Reload the page and try again.'); return true; }
    st.P = paletteOf(st.palette);
    st.images = await prepare(input.images);
    if (!st.images.length) { status('No product images to use yet. Make the mockups first.'); renderPics(); return true; }
    st.hero = Math.max(0, st.images.findIndex(x => fullBleed(x)));
    st.problem = st.check ? st.check(st.line) : '';
    lineNote();
    renderPics();
    status('');
    await draw();
    syncControls();
    st.track?.({ action: 'ad-open', images: st.images.length, line: st.lineSource });
    return true;
  }

  const MerchAds = { open, close, qr, qrDataUrl, scenes: s => scenes(s), FORMATS, get state() { return st; }, last: null };
  root.MerchAds = MerchAds;
}(typeof self !== 'undefined' ? self : this));
