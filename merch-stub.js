/* Merch Designs: a thin stand-in for merch-print.js / merch-rules.js (the
   DESIGN branch owns the real ones). merch.js loads this only when
   window.MerchPrint is missing (or lacks a function it needs), so the whole
   flow works and can be tested before the real renderer lands. It draws
   simple stacked pills, nothing more. Same API as the contract:
     MerchStub.preview(concept, garmentColor, canvas, { logoSpot })  flat tee preview
     MerchStub.render(concept, printSpec, canvas)       transparent print PNG (pills only)
     MerchStub.renderLogo(spec, canvas)                 the ES wordmark pill for a logo area
     MerchStub.checks(concept, printSpec)               [] (no checks)
     MerchStub.fallbackConcepts(content)                code concepts, no AI */
(function (root) {
  'use strict';
  const FONT = '"Roboto Condensed", "Roboto", sans-serif';
  const COLLECTIONS = [
    { id: 'replay', label: 'Replay' },
    { id: 'nickname', label: 'Nickname' },
    { id: 'quote', label: 'In their own words' },
    { id: 'core', label: 'Core ES' },
    { id: 'current', label: 'Current' },
  ];
  const ES = { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' };

  const pick = (concept, key) => (key === 'white' ? '#FFFFFF' : (concept.palette || ES)[key] || '#0E1014');

  // Draw the stack inside a box (x, y, w, h); returns nothing.
  function drawStack(g, concept, box) {
    const rows = (concept.stack || []).filter(r => r && String(r.text || '').trim());
    if (!rows.length) return;
    const big = Math.min(box.h / (rows.length * 1.05 + 0.2), box.w / 5.2);
    const sizeOf = r => (r.size === 'small' ? big * 0.45 : r.size === 'mid' ? big * 0.62 : big);
    let total = rows.reduce((n, r) => n + sizeOf(r) * 1.12, 0);
    const shrink = total > box.h ? box.h / total : 1;
    let y = box.y + (box.h - total * shrink) / 2;
    rows.forEach(r => {
      const fs = sizeOf(r) * shrink;
      g.font = `800 ${fs}px ${FONT}`;
      const text = String(r.text).toUpperCase();
      let tw = g.measureText(text).width;
      const maxW = box.w - fs * 0.3;
      const squeeze = tw > maxW ? maxW / tw : 1;
      tw *= squeeze;
      const pad = fs * 0.12;
      const pw = tw + pad * 2;
      const ph = fs * 1.02;
      const x = concept.align === 'center' ? box.x + (box.w - pw) / 2 : box.x;
      g.fillStyle = pick(concept, r.fill || 'a');
      g.fillRect(x, y, pw, ph);
      g.fillStyle = pick(concept, r.ink || 'ink');
      g.textBaseline = 'alphabetic';
      g.save();
      g.translate(x + pad, y + ph * 0.84);
      g.scale(squeeze, 1);
      g.fillText(text, 0, 0);
      g.restore();
      y += ph + fs * 0.1 * shrink;
    });
  }

  function wordmark(g, cx, y, w) {
    const h = w * 0.13;
    g.fillStyle = '#0A7DFA';
    g.fillRect(cx - w / 2, y, w, h);
    g.fillStyle = '#FFFFFF';
    g.font = `800 ${h * 0.78}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ESSENTIALLYSPORTS', cx, y + h * 0.54, w * 0.94);
    g.textAlign = 'start';
  }

  function teePath(g, w, h) {
    const p = new Path2D();
    p.moveTo(w * 0.36, h * 0.08);
    p.quadraticCurveTo(w * 0.5, h * 0.15, w * 0.64, h * 0.08);
    p.lineTo(w * 0.9, h * 0.2);
    p.lineTo(w * 0.98, h * 0.38);
    p.lineTo(w * 0.82, h * 0.45);
    p.lineTo(w * 0.79, h * 0.38);
    p.lineTo(w * 0.79, h * 0.94);
    p.lineTo(w * 0.21, h * 0.94);
    p.lineTo(w * 0.21, h * 0.38);
    p.lineTo(w * 0.18, h * 0.45);
    p.lineTo(w * 0.02, h * 0.38);
    p.lineTo(w * 0.1, h * 0.2);
    p.closePath();
    return p;
  }

  async function preview(concept = {}, garmentColor, canvas, opts = {}) {
    const w = canvas.width || 480, h = canvas.height || 560;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const color = garmentColor || concept.garment?.color || '#FFFFFF';
    const tee = teePath(g, w, h);
    g.fillStyle = color;
    g.fill(tee);
    g.strokeStyle = 'rgba(14,16,20,.12)';
    g.lineWidth = Math.max(1, w / 320);
    g.stroke(tee);
    g.beginPath();
    g.moveTo(w * 0.38, h * 0.09);
    g.quadraticCurveTo(w * 0.5, h * 0.17, w * 0.62, h * 0.09);
    g.stroke();
    drawStack(g, concept, { x: w * 0.33, y: h * 0.25, w: w * 0.34, h: h * 0.3 });
    const spot = opts.logoSpot === undefined ? 'neck' : opts.logoSpot;
    if (spot === 'sleeve') wordmark(g, w * 0.86, h * 0.3, w * 0.09);
    else if (spot && spot !== 'none') wordmark(g, w * 0.5, h * 0.15, w * 0.1);
    return { width: w, height: h };
  }

  async function render(concept = {}, spec = {}, canvas) {
    const w = Math.max(1, Number(spec.pixelsWidth) || 3600);
    const h = Math.max(1, Number(spec.pixelsHeight) || 4800);
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    drawStack(g, concept, { x: w * 0.06, y: h * 0.1, w: w * 0.88, h: h * 0.5 });
    return { width: w, height: h, semiPixels: 0 };
  }

  // The ES wordmark pill for a logo area (sleeve, back neck, neck label).
  async function renderLogo(spec = {}, canvas) {
    const w = Math.max(1, Number(spec.pixelsWidth) || 1200);
    const h = Math.max(1, Number(spec.pixelsHeight) || 1200);
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const pw = Math.min(w * 0.9, h * 0.9 / 0.13);
    wordmark(g, w / 2, (h - pw * 0.13) / 2, pw);
    return { width: w, height: h, semiPixels: 0 };
  }

  const lines = text => String(text || '').replace(/https?:\/\/\S+/g, '').split(/[\n.!?]+/).map(s => s.trim()).filter(Boolean);
  function words(text, n) {
    const out = [];
    let row = '';
    String(text).split(/\s+/).filter(Boolean).forEach(word => {
      if ((row + ' ' + word).trim().length > n && row) { out.push(row); row = word; } else row = (row + ' ' + word).trim();
    });
    if (row) out.push(row);
    return out;
  }
  function fallbackConcepts(content = {}) {
    const text = typeof content === 'string' ? content : content.text || content.title || '';
    const first = lines(text)[0] || 'ESSENTIALLY SPORTS';
    const want = content.collection && content.collection !== 'auto' ? [content.collection] : ['current', 'quote', 'core'];
    const make = (collection, i) => {
      const base = collection === 'core' ? ['ESSENTIALLY', 'SPORTS'] : words(first.toUpperCase(), collection === 'nickname' ? 30 : 14).slice(0, 5);
      const stack = base.map((t, j) => ({ text: t, size: j === 0 || base.length < 3 ? 'big' : (j % 2 ? 'big' : 'small'), fill: j % 2 ? 'b' : 'a', ink: 'ink' }));
      return {
        id: `fb-${collection}-${i}`, collection, title: base.join(' ').slice(0, 60), team: null,
        palette: { ...ES }, garment: { color: '#FFFFFF', name: 'White' }, stack, align: i % 2 ? 'center' : 'left',
        blanks: ['tee', 'hoodie'], rights: collection === 'quote' ? [{ kind: 'quote', text: first }] : [], why: 'Made without AI from your words.',
      };
    };
    return want.map(make);
  }

  root.MerchStub = { stub: true, COLLECTIONS, preview, render, renderLogo, checks: () => [], fallbackConcepts };
  if (!root.MerchPrint) root.MerchPrint = root.MerchStub;
}(typeof self !== 'undefined' ? self : this));
