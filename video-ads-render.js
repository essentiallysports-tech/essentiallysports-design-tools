// Video Ads renderer: lays out and draws one ad frame (logo, copy, CTA) over
// the video. Pure functions, no DOM: the page passes a canvas context and a
// measure(text, font) function, so the layout is testable in Node.
//
//   fitLayout(measure, layout, brand, size, logo) -> { ops, scale, fits, box }
//   drawFrame(ctx, { width, height, video, bg, ops, logoImage, blurCanvas, source })
//     bg: { zoom, panX, panY, fit: 'fill'|'fit', tint: { color, amount }, fade, … }
//     source: the background when there is no clip (a photo with a slow
//     zoom, or an animated gradient); see Background sources below
//   videoRect(...) / tintLayers(...): the framing and tint maths, for tests
//
// Sizes and spacing are taken from the live ES video ads in the ES Design Team
// Figma file (ADS page: the three 9:16 "NFL-ad-with-logo" frames and the three
// 9:16 CFB frames, one per copy style). Spacing is measured the way Figma
// draws it, from the cap top of a line to the baseline of the last line:
//   body       Roboto Medium 49.19px, line height 1.11, a blank line between
//              paragraphs (no gap for a single line break)
//   condensed  Acumin Pro Condensed Black 85px, line height 1.11, centred
//              (long headlines step down to ~73px to stay within 3 lines);
//              90px from its last baseline to the body's cap top
//   highlight  Acumin Black 97px UPPERCASE, line height 1.0, the phrase on a
//              flat brand box (cap top − 9px … baseline + 11px at 97px);
//              117px to the body
//   CTA        120px below the copy; white, 99px tall, radius 13.7, red mail
//              icon 50.7px, 28.3px gap, Acumin Black 51.7px label
//   unsub      "Unsubscribe anytime", Roboto SemiBold 24.9px white, cap top
//              23px under the button
//   logo       drawn at its Figma size (Huddle 270×75, CFB 252×35, Dugout
//              208×74), 107px from the top on 9:16
// The stack is centred on the frame (y 960 on 9:16, as in every Figma frame)
// and never grows past these sizes; long copy scales down to MIN_SCALE.
//
// Copy styles (the ES ad templates):
//   simple    — every paragraph in plain Roboto
//   condensed — headline in Acumin Pro Condensed, body in Roboto
//   highlight — condensed uppercase headline with one phrase on a coloured box
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoAdsRender = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const CONDENSED = '"Acumin Pro Condensed Local", "Roboto Condensed", sans-serif';
  const BODY = 'Roboto, sans-serif';
  const font = (weight, size, family) => `${weight} ${Math.round(size * 10) / 10}px ${family}`;

  // Cap heights (share of the font size): Figma trims text boxes to cap top /
  // baseline, so the gaps below are measured between those edges.
  const CAP = { condensed: 0.68, body: 0.711 };

  // Base sizes on the 1080-wide canvas (scaled down to fit long copy).
  const BASE = {
    logoBox: { w: 280, h: 80 }, // bigger logos are fitted into this box; the ES logos are drawn at their Figma size
    logoTop: 107, // fallback when a size has no logoTop
    gapLogo: 40, // between the pinned logo and the copy, at least
    headline: { condensed: 85.15, highlight: 97.04 },
    headlineMin: 0.76, // long headlines step down (97 → 73.7 in the CFB highlight ad) to stay within headlineLines
    headlineLines: 3,
    headlineLine: { condensed: 1.11, highlight: 1.0 },
    headlineWidth: 0.8775, // a centred condensed headline wraps in a narrower box (824 of 939px in the NFL ad)
    gapHead: { condensed: 90, highlight: 117 }, // headline baseline → body cap top
    body: 49.19,
    bodyLine: 1.11,
    gapCta: 120, // last baseline → CTA top
    cta: 51.73,
    unsubscribe: 24.89,
    gapUnsub: 23, // CTA bottom → unsubscribe cap top
    boost: 0.025, // × size: stroke that brings our Acumin Bold close to Figma's Acumin Black
  };

  // Text shadows from the templates (a little deeper: the ads run over video).
  const SHADOW = {
    headline: { color: 'rgba(0,0,0,0.32)', blur: 60, y: 6.1 },
    body: { color: 'rgba(0,0,0,0.32)', blur: 34.5, y: 3.5 },
  };

  // "Keep up **free**" -> runs [{text:'Keep up ', bold:false}, {text:'free', bold:true}]
  function parseRuns(text) {
    const runs = [];
    String(text || '').split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (!part) return;
      const bold = /^\*\*[^*]+\*\*$/.test(part);
      runs.push({ text: bold ? part.slice(2, -2) : part, bold });
    });
    return runs;
  }

  // Words of a paragraph, each with its font and whether it is highlighted.
  // A single line break in the copy becomes a { br: true } token.
  function tokensFor(text, { fontFor, highlight = '' }) {
    const tokens = [];
    const plain = parseRuns(text).map(run => run.text).join('');
    let range = null;
    if (highlight) {
      const at = plain.toLowerCase().indexOf(String(highlight).toLowerCase().trim());
      if (at >= 0) range = [at, at + String(highlight).trim().length];
    }
    let offset = 0;
    parseRuns(text).forEach(run => {
      run.text.split(/(\s+)/).forEach(piece => {
        if (piece && !/^\s+$/.test(piece)) {
          const start = offset;
          const end = offset + piece.length;
          tokens.push({ text: piece, font: fontFor(run.bold), lit: Boolean(range && start < range[1] && end > range[0]) });
        } else if (piece && piece.includes('\n') && tokens.length) {
          tokens.push({ br: true, text: '', lit: false });
        }
        offset += piece.length;
      });
    });
    return tokens;
  }

  // Greedy word wrap. Returns lines of positioned tokens.
  function wrapTokens(measure, tokens, maxWidth) {
    const lines = [];
    let line = [];
    let width = 0;
    tokens.forEach(token => {
      if (token.br) {
        lines.push({ tokens: line, width });
        line = [];
        width = 0;
        return;
      }
      const w = measure(token.text, token.font);
      const space = line.length ? measure(' ', token.font) : 0;
      if (line.length && width + space + w > maxWidth) {
        lines.push({ tokens: line, width });
        line = [];
        width = 0;
      }
      const gap = line.length ? measure(' ', token.font) : 0;
      line.push({ ...token, x: width + gap, w });
      width += gap + w;
    });
    if (line.length) lines.push({ tokens: line, width });
    return lines;
  }

  // Paragraphs of the body fields: a blank line inside a field starts a new paragraph.
  const paragraphsOf = list => (list || [])
    .flatMap(text => String(text || '').split(/\n[ \t]*\n/))
    .map(text => text.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean);

  // The whole stack at one scale: headline, body, CTA, unsubscribe. Heights are
  // cap-top to baseline, as in Figma.
  function stackAt(measure, layout, brand, size, logo, scale) {
    const style = layout.style || 'condensed';
    const maxWidth = size.width - 2 * size.safe.side;
    const centred = layout.align !== 'left';
    const blocks = [];
    let height = 0;

    const bodySize = BASE.body * scale;
    const bodyPitch = bodySize * BASE.bodyLine;
    const blankGap = bodyPitch * 2 - bodySize * CAP.body; // one empty line between paragraphs
    const paragraphs = [];
    const headline = String(layout.headline || '').trim();
    if (headline) {
      if (style === 'simple') {
        paragraphs.push({ role: 'body', size: bodySize, lineHeight: BASE.bodyLine, cap: CAP.body, tokens: tokensFor(headline, { fontFor: bold => font(bold ? 700 : 500, bodySize, BODY) }) });
      } else {
        const highlight = style === 'highlight';
        const upper = highlight || layout.upper === true;
        const text = upper ? headline.toUpperCase() : headline;
        const phrase = highlight ? (upper ? String(layout.highlight || '').toUpperCase() : layout.highlight) : '';
        const base = (highlight ? BASE.headline.highlight : BASE.headline.condensed) * scale;
        const wrap = tokens => wrapTokens(measure, tokens, centred && !highlight ? maxWidth * BASE.headlineWidth : maxWidth);
        let sizePx = base;
        let tokens = tokensFor(text, { fontFor: () => font(700, sizePx, CONDENSED), highlight: phrase });
        let lines = wrap(tokens);
        while (lines.length > BASE.headlineLines && sizePx > base * BASE.headlineMin + 0.01) {
          sizePx = Math.max(base * BASE.headlineMin, sizePx * 0.97);
          tokens = tokensFor(text, { fontFor: () => font(700, sizePx, CONDENSED), highlight: phrase });
          lines = wrap(tokens);
        }
        paragraphs.push({ role: 'headline', size: sizePx, lineHeight: highlight ? BASE.headlineLine.highlight : BASE.headlineLine.condensed, cap: CAP.condensed, tokens, lines, after: BASE.gapHead[highlight ? 'highlight' : 'condensed'] * scale });
      }
    }
    paragraphsOf(layout.body).forEach(text => {
      paragraphs.push({ role: 'body', size: bodySize, lineHeight: BASE.bodyLine, cap: CAP.body, tokens: tokensFor(text, { fontFor: bold => font(bold ? 700 : 500, bodySize, BODY) }) });
    });

    paragraphs.forEach((paragraph, index) => {
      if (!paragraph.lines) paragraph.lines = wrapTokens(measure, paragraph.tokens, maxWidth);
      const n = Math.max(1, paragraph.lines.length);
      paragraph.height = paragraph.size * paragraph.cap + (n - 1) * paragraph.size * paragraph.lineHeight;
      if (index > 0) {
        const prev = paragraphs[index - 1];
        paragraph.gapBefore = prev.after ?? blankGap;
        height += paragraph.gapBefore;
      }
      height += paragraph.height;
    });
    if (paragraphs.length) blocks.push({ kind: 'text', paragraphs });

    const ctaText = String(layout.cta || brand.cta || '').trim();
    if (ctaText) {
      const fontSize = BASE.cta * Math.max(0.82, scale);
      const ctaFont = font(700, fontSize, CONDENSED);
      const icon = fontSize * 0.98; // 50.7px mail icon beside a 51.7px label
      const iconGap = fontSize * 0.5475; // 28.32px
      const padX = fontSize * 0.764; // 39.5px (Sign up ES CFB button)
      const h = fontSize * 1.916; // 99.1px
      const labelW = measure(ctaText.toUpperCase(), ctaFont) + fontSize * BASE.boost;
      const w = Math.min(maxWidth, padX * 2 + icon + iconGap + labelW);
      const gapBefore = paragraphs.length ? BASE.gapCta * scale : 0;
      height += gapBefore + h;
      const unsub = layout.unsubscribe !== false;
      const unsubSize = BASE.unsubscribe * Math.max(0.85, scale);
      const unsubGap = BASE.gapUnsub * Math.max(0.85, scale);
      if (unsub) height += unsubGap + unsubSize * CAP.body;
      blocks.push({ kind: 'cta', text: ctaText.toUpperCase(), font: ctaFont, fontSize, icon, iconGap, labelW, w, h, gapBefore, unsub, unsubSize, unsubGap });
    }
    return { blocks, height, maxWidth };
  }

  // Finds the largest scale (≤ 1, the Figma sizes) at which the stack fits the
  // safe area, then turns it into draw operations. MIN_SCALE keeps body text at
  // ~33px on the 1080 canvas (readable on a phone); copy that needs less is
  // reported as not fitting rather than shrunk into unreadable text.
  const MIN_SCALE = 0.68;
  const MAX_SCALE = 1;
  function fitLayout(measure, layout, brand, size, logo = null) {
    // The logo is pinned near the top of the frame; the copy starts below it.
    let logoOp = null;
    let top = size.safe.top;
    if (logo && logo.width && logo.height) {
      // ES logos are drawn at their Figma size; large uploads are fitted to the box.
      const k = Math.min(BASE.logoBox.w / logo.width, BASE.logoBox.h / logo.height, 1);
      const w = logo.width * k;
      const h = logo.height * k;
      const logoTop = size.logoTop ?? BASE.logoTop;
      const x = layout.align === 'left' ? size.safe.side : (size.width - w) / 2;
      logoOp = { type: 'logo', x, y: logoTop, w, h };
      top = Math.max(top, logoTop + h + BASE.gapLogo);
    }
    const bottomEdge = size.height - size.safe.bottom;
    const available = bottomEdge - top;
    let lo = MIN_SCALE;
    let hi = MAX_SCALE;
    let best = stackAt(measure, layout, brand, size, logo, hi);
    let scale = hi;
    if (best.height > available) {
      best = stackAt(measure, layout, brand, size, logo, lo);
      scale = lo;
      if (best.height <= available) {
        for (let i = 0; i < 18; i += 1) {
          const mid = (lo + hi) / 2;
          const stack = stackAt(measure, layout, brand, size, logo, mid);
          if (stack.height <= available) { lo = mid; best = stack; scale = mid; } else { hi = mid; }
        }
      }
    }
    const fits = best.height <= available;
    const align = layout.align === 'left' ? 'left' : 'center';
    const left = size.safe.side;
    const anchor = layout.anchor || 'center';
    const spare = Math.max(0, available - best.height);
    let y;
    if (anchor === 'top') y = top;
    else if (anchor === 'bottom') y = top + spare;
    else if (size.centerY) y = top + Math.min(spare, Math.max(0, size.centerY - best.height / 2 - top)); // centred on the frame, kept inside the safe area
    else y = top + spare / 2;
    const xFor = width => (align === 'left' ? left : left + (best.maxWidth - width) / 2);
    const ops = [];
    if (logoOp) ops.push(logoOp);

    best.blocks.forEach(block => {
      if (block.kind === 'text') {
        block.paragraphs.forEach((paragraph, index) => {
          if (index > 0) y += paragraph.gapBefore;
          const headline = paragraph.role === 'headline';
          const pitch = paragraph.size * paragraph.lineHeight;
          paragraph.lines.forEach((line, i) => {
            const baseline = y + paragraph.size * paragraph.cap + i * pitch;
            const x0 = xFor(line.width);
            // Highlighted words on one line share one flat box (Figma: cap top − 9, baseline + 11 at 97px).
            let run = null;
            line.tokens.forEach((token, t) => {
              if (token.lit) {
                if (!run) run = { x: x0 + token.x, end: x0 + token.x + token.w };
                else run.end = x0 + token.x + token.w;
              }
              if ((!token.lit || t === line.tokens.length - 1) && run) {
                const pad = paragraph.size * 0.09;
                ops.push({ type: 'box', x: run.x - pad, y: baseline - paragraph.size * 0.79, w: run.end - run.x + pad * 2, h: paragraph.size * 0.9, r: 0, fill: brand.highlight.bg });
                run = null;
              }
            });
            line.tokens.forEach(token => {
              ops.push({
                type: 'text', text: token.text, x: x0 + token.x, y: baseline, font: token.font,
                fill: token.lit ? brand.highlight.fg : '#FFFFFF',
                shadow: token.lit ? false : (headline ? SHADOW.headline : SHADOW.body),
                boost: headline ? paragraph.size * BASE.boost : 0,
              });
            });
          });
          y += paragraph.height;
        });
      } else if (block.kind === 'cta') {
        y += block.gapBefore;
        const x = xFor(block.w);
        const content = block.icon + block.iconGap + block.labelW;
        const padX = (block.w - content) / 2;
        ops.push({ type: 'button', x, y, w: block.w, h: block.h, r: block.fontSize * 0.264, fill: '#FFFFFF' });
        ops.push({ type: 'mail', x: x + padX, y: y + (block.h - block.icon) / 2, w: block.icon, h: block.icon, fill: brand.accent });
        ops.push({ type: 'text', text: block.text, x: x + padX + block.icon + block.iconGap + block.fontSize * BASE.boost / 2, y: y + block.h / 2 + block.fontSize * CAP.condensed / 2, font: block.font, fill: '#000000', boost: block.fontSize * BASE.boost });
        y += block.h;
        if (block.unsub) {
          y += block.unsubGap;
          const unsubFont = font(600, block.unsubSize, BODY);
          const text = 'Unsubscribe anytime';
          const w = measure(text, unsubFont);
          ops.push({ type: 'text', text, x: align === 'left' ? x : x + (block.w - w) / 2, y: y + block.unsubSize * CAP.body, font: unsubFont, fill: '#FFFFFF', shadow: SHADOW.body });
          y += block.unsubSize * CAP.body;
        }
      }
    });
    return { ops, scale, fits, height: best.height, available };
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // Framing: where the clip lands on the frame.
  //   fit 'fill' (default) covers the frame; 'fit' shows the whole clip.
  //   zoom 1..ZOOM_MAX on top of that; pan −1..1 slides the clip across its
  //   spare room (+1 = clip moved fully right / down). Pure, so it is tested.
  const ZOOM_MAX = 2.5;
  function videoRect(sw, sh, width, height, { zoom = 1, panX = 0, panY = 0, fit = 'fill' } = {}) {
    if (!sw || !sh) return null;
    const z = Math.max(1, Math.min(ZOOM_MAX, Number(zoom) || 1));
    const base = fit === 'fit' ? Math.min(width / sw, height / sh) : Math.max(width / sw, height / sh);
    const w = sw * base * z;
    const h = sh * base * z;
    const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0));
    const x = (width - w) / 2 + (Math.abs(w - width) / 2) * clamp(panX);
    const y = (height - h) / 2 + (Math.abs(h - height) / 2) * clamp(panY);
    return { x, y, w, h, roomX: Math.abs(w - width) / 2, roomY: Math.abs(h - height) / 2 };
  }
  function drawVideo(ctx, source, width, height, frame = {}) {
    const r = videoRect(source.videoWidth || source.width, source.videoHeight || source.height, width, height, frame);
    if (r) ctx.drawImage(source, r.x, r.y, r.w, r.h);
  }

  // Tint: a colour wash over the clip, under the copy. amount 0..1.
  //   'color' blend: the clip takes the tint's hue, keeping its own light/dark;
  //   multiply (at 60%): darkens it towards the colour, so white copy reads;
  //   then a little black (more for bright tints) so the copy keeps its contrast.
  // Black is a plain alpha overlay (= the old scrim). The strength is capped
  // so the clip always shows (TINT_MAX), lower again under a bottom fade.
  const TINT_MAX = 0.85;
  const TINT_MAX_FADE = 0.7;
  const luminance = hex => {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const lin = c => { const v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  };
  function tintLayers(tint, { fade = false } = {}) {
    if (!tint) return [];
    const color = /^#[0-9a-f]{6}$/i.test(String(tint.color || '')) ? String(tint.color) : '#000000';
    const a = Math.max(0, Math.min(fade ? TINT_MAX_FADE : TINT_MAX, Number(tint.amount) || 0));
    if (a <= 0) return [];
    const L = luminance(color);
    if (L < 0.005) return [{ color, alpha: a, mode: 'source-over' }];
    const layers = [{ color, alpha: a, mode: 'color' }, { color, alpha: a * 0.6, mode: 'multiply' }];
    const dark = a * (0.3 + 0.5 * L);
    if (dark > 0.01) layers.push({ color: '#000000', alpha: dark, mode: 'source-over' });
    return layers;
  }
  function drawTint(ctx, width, height, layers) {
    layers.forEach(layer => {
      ctx.save();
      ctx.globalCompositeOperation = layer.mode;
      ctx.globalAlpha = layer.alpha;
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    });
  }

  const MAIL_D = [
    'M29.5868 31.0588C28.3255 31.8997 26.8604 32.3442 25.3499 32.3442C23.8394 32.3442 22.3743 31.8997 21.113 31.0588L0.338256 17.2085C0.222996 17.1317 0.110707 17.0516 0.000695835 16.9692V39.6643C0.000695835 42.2664 2.1123 44.3314 4.66781 44.3314H46.0318C48.6339 44.3314 50.6989 42.2198 50.6989 39.6643V16.9691C50.5887 17.0517 50.4762 17.132 50.3607 17.2089L29.5868 31.0588Z',
    'M1.98605 14.7425L22.7608 28.5929C23.5472 29.1172 24.4485 29.3793 25.3498 29.3793C26.2511 29.3793 27.1525 29.1171 27.9389 28.5929L48.7137 14.7425C49.9569 13.9142 50.699 12.5279 50.699 11.0318C50.699 8.45911 48.6061 6.36622 46.0335 6.36622H4.66623C2.09369 6.36631 0.000695835 8.45921 0.000695835 11.0342C0.000695835 12.5279 0.742951 13.9142 1.98605 14.7425Z',
  ];
  const MAIL_PATHS = typeof Path2D === 'function' ? MAIL_D.map(d => new Path2D(d)) : null;


  function drawOps(ctx, ops, logoImage) {
    ops.forEach(op => {
      if (op.type === 'logo' && logoImage) {
        ctx.drawImage(logoImage, op.x, op.y, op.w, op.h);
      } else if (op.type === 'box' || op.type === 'button') {
        ctx.fillStyle = op.fill;
        roundRect(ctx, op.x, op.y, op.w, op.h, op.r ?? 6);
        ctx.fill();
      } else if (op.type === 'mail' && MAIL_PATHS) {
        // The "email 1" icon from the ES ad templates (50.7 × 50.7 box).
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.scale(op.w / 50.6983, op.h / 50.6983);
        ctx.fillStyle = op.fill;
        MAIL_PATHS.forEach(path => ctx.fill(path));
        ctx.restore();
      } else if (op.type === 'mail') {
        // Fallback without Path2D: filled envelope with a white flap.
        ctx.fillStyle = op.fill;
        roundRect(ctx, op.x, op.y, op.w, op.h, op.h * 0.14);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(2, op.h * 0.12);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(op.x + op.w * 0.12, op.y + op.h * 0.2);
        ctx.lineTo(op.x + op.w / 2, op.y + op.h * 0.58);
        ctx.lineTo(op.x + op.w * 0.88, op.y + op.h * 0.2);
        ctx.stroke();
      } else if (op.type === 'text') {
        ctx.font = op.font;
        ctx.fillStyle = op.fill;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        if (op.shadow) {
          // Template shadows (0 3.5px 34.5px body, 0 6px 60px headline), a little deeper over video.
          const shadow = op.shadow === true ? { color: 'rgba(0,0,0,0.32)', blur: 34.5, y: 3.5 } : op.shadow;
          ctx.shadowColor = shadow.color;
          ctx.shadowBlur = shadow.blur;
          ctx.shadowOffsetY = shadow.y;
        }
        ctx.fillText(op.text, op.x, op.y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        if (op.boost) {
          // Thickens Acumin Bold towards the Black weight used in the templates.
          ctx.strokeStyle = op.fill;
          ctx.lineWidth = op.boost;
          ctx.lineJoin = 'round';
          ctx.strokeText(op.text, op.x, op.y);
        }
      }
    });
  }

  const hexRgb = hex => {
    const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : '0,0,0';
  };

  // Top of the copy (first text line's cap top), for the bottom fade.
  function copyTop(ops) {
    let best = Infinity;
    ops.forEach(op => {
      if (op.type === 'text') {
        const m = String(op.font).match(/([\d.]+)px/);
        best = Math.min(best, op.y - (m ? Number(m[1]) : 40) * 0.72);
      } else if (op.type === 'box' || op.type === 'button') {
        best = Math.min(best, op.y);
      }
    });
    return best;
  }

  // ─── Background sources (no footage) ────────────────────────────────────
  // drawFrame's `source` picks what sits under the tint and the copy:
  //   undefined or { kind: 'video' }  the clip in `video` (the original path)
  //   { kind: 'image', image, t, duration, motion? }
  //        a still photo with a slow push-in / pan (Ken Burns). It goes
  //        through the clip path, so Fill / Fit, zoom and pan still apply.
  //   { kind: 'generated', colors: [a, b], t, duration, grain? }
  //        an animated gradient in two colours: drifting light, a slow light
  //        sweep, vignette and grain. Every motion repeats once per
  //        `duration`, so it loops without a jump.
  const STILL = { minSeconds: 5, maxSeconds: 15, defaultSeconds: 8 };
  const KEN_BURNS = { from: 1, to: 1.14, panX: [-0.35, 0.35], panY: [0.15, -0.15] };
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const stillProgress = (t, duration) => clamp01((Number(t) || 0) / Math.max(0.1, Number(duration) || STILL.defaultSeconds));
  // The framing for a photo at time t: the editor's Frame settings times the slow move.
  function kenBurnsFrame(bg = {}, t = 0, duration = STILL.defaultSeconds, motion = KEN_BURNS) {
    const m = { ...KEN_BURNS, ...(motion || {}) };
    const e = 0.5 - 0.5 * Math.cos(Math.PI * stillProgress(t, duration)); // ease in-out
    const lerp = ([a, b]) => a + (b - a) * e;
    const clamp = v => Math.max(-1, Math.min(1, v));
    return {
      ...bg,
      zoom: Math.min(ZOOM_MAX, Math.max(1, Number(bg.zoom) || 1) * (m.from + (m.to - m.from) * e)),
      panX: clamp((Number(bg.panX) || 0) + lerp(m.panX)),
      panY: clamp((Number(bg.panY) || 0) + lerp(m.panY)),
    };
  }
  const HEX6 = /^#[0-9a-f]{6}$/i;
  // A hex colour mixed towards black (k 0..1), as rgba().
  const shade = (hex, k, alpha = 1) => {
    const [r, g, b] = hexRgb(hex).split(',').map(Number);
    const f = 1 - Math.max(0, Math.min(1, k));
    return `rgba(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)},${alpha})`;
  };
  function generatedColors(colors) {
    const list = (Array.isArray(colors) ? colors : []).filter(c => HEX6.test(String(c)));
    const a = list[0] || '#0A2342';
    const b = list[1] && list[1].toLowerCase() !== a.toLowerCase() ? list[1] : '#0A6FDE';
    // A near-black primary (Bears navy, Raiders black) would leave the frame
    // dark: let the brighter colour lead the light.
    return luminance(a) < 0.015 && luminance(b) > luminance(a) ? [b, a] : [a, b];
  }
  // Where the animated pieces are at time t (pure, so the loop is testable).
  function generatedState(t, duration) {
    const p = stillProgress(t, duration);
    const ph = 2 * Math.PI * p;
    return {
      blobA: { x: 0.3 + 0.14 * Math.sin(ph), y: 0.3 + 0.07 * Math.cos(ph), r: 0.78 },
      blobB: { x: 0.72 + 0.12 * Math.cos(ph), y: 0.72 + 0.08 * Math.sin(ph), r: 0.85 },
      sweep: -0.9 + 2.8 * p, // band centre across the width: off-screen at both ends
      grain: Math.floor((Number(t) || 0) * 24),
    };
  }
  function drawGenerated(ctx, width, height, source = {}) {
    const [a, b] = generatedColors(source.colors);
    const st = generatedState(source.t, source.duration);
    // Deep base in the team's colours.
    const base = ctx.createLinearGradient(0, 0, width * 0.35, height);
    base.addColorStop(0, shade(a, 0.35));
    base.addColorStop(0.55, shade(a, 0.62));
    base.addColorStop(1, shade(b, 0.7));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    // Two soft lights that drift on a loop.
    [[st.blobA, a, 0.85], [st.blobB, b, 0.6]].forEach(([blob, hex, alpha]) => {
      const x = blob.x * width;
      const y = blob.y * height;
      const r = blob.r * Math.max(width, height) * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, shade(hex, 0, alpha));
      g.addColorStop(1, shade(hex, 0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    });
    // A slow diagonal light sweep.
    const cx = st.sweep * width;
    const band = width * 0.45;
    const sweep = ctx.createLinearGradient(cx - band, -height * 0.15, cx + band, height * 0.15);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, width, height);
    // Vignette.
    const v = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.25, width / 2, height * 0.45, Math.max(width, height) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, width, height);
    // Film grain from a small noise tile, shifted every frame (24 a second).
    if (source.grain && typeof ctx.createPattern === 'function') {
      const pattern = ctx.createPattern(source.grain, 'repeat');
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.translate((st.grain * 37) % 128, (st.grain * 61) % 128);
        ctx.fillStyle = pattern;
        ctx.fillRect(-128, -128, width + 256, height + 256);
        ctx.restore();
      }
    }
  }

  // One full frame. `source` (above) picks the background; without it, or
  // with a video source, this is exactly the original clip path.
  function drawFrame(ctx, options) {
    const source = options && options.source;
    if (source && source.kind === 'image') {
      return drawClipFrame(ctx, { ...options, video: source.image || null, bg: kenBurnsFrame(options.bg, source.t, source.duration, source.motion) });
    }
    if (source && source.kind === 'generated') return drawClipFrame(ctx, { ...options, video: null, generated: source });
    return drawClipFrame(ctx, options);
  }

  // Video (optionally blurred), scrim, vignette, bottom fade, overlay.
  function drawClipFrame(ctx, { width, height, video, bg = {}, ops = [], logoImage = null, blurCanvas = null, generated = null }) {
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    if (generated) drawGenerated(ctx, width, height, generated);
    if (video && bg.fit === 'fit') {
      // Fit: the whole clip over a soft, dark copy of itself (no black bars).
      if (blurCanvas) {
        blurCanvas.width = Math.max(8, Math.round(width / 40));
        blurCanvas.height = Math.max(8, Math.round(height / 40));
        drawVideo(blurCanvas.getContext('2d'), video, blurCanvas.width, blurCanvas.height, { fit: 'fill' });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(blurCanvas, 0, 0, width, height);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, width, height);
      }
      drawVideo(ctx, video, width, height, bg);
    } else if (video) {
      const blur = Math.max(0, Math.min(1, bg.blur || 0));
      if (blur > 0 && blurCanvas) {
        // Cheap, Safari-safe blur: draw small, scale back up smoothly.
        const factor = 1 + blur * 23;
        blurCanvas.width = Math.max(8, Math.round(width / factor));
        blurCanvas.height = Math.max(8, Math.round(height / factor));
        const small = blurCanvas.getContext('2d');
        drawVideo(small, video, blurCanvas.width, blurCanvas.height, bg);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(blurCanvas, 0, 0, width, height);
      } else {
        drawVideo(ctx, video, width, height, bg);
      }
    }
    if (bg.tint) {
      // The tint replaces the old black scrim (black at 45% looks the same).
      drawTint(ctx, width, height, tintLayers(bg.tint, { fade: Boolean(bg.fade && bg.fade.color) }));
    } else {
      const scrim = Math.max(0, Math.min(0.9, bg.scrim ?? 0.45));
      if (scrim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${scrim})`;
        ctx.fillRect(0, 0, width, height);
      }
    }
    // Vignette from the rated ads (AD1 Brick Black Bottom): an ellipse centred
    // high on the frame, clear to 52% of its radius, then darkening to the edges.
    const vignette = Math.max(0, Math.min(1, bg.vignette || 0));
    if (vignette > 0) {
      const ry = height * 0.555;
      const rx = width * 1.09;
      ctx.save();
      ctx.translate(width / 2, height * 0.212);
      ctx.scale(rx / ry, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      g.addColorStop(0.518, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(-width * 4, -height * 4, width * 8, height * 8);
      ctx.restore();
    }
    // Bottom fade, like the "Black Bottom" / "Navy Bottom" ES ads: the clip
    // stays bright on top and melts into a solid colour behind the copy. In
    // the Figma ad the fade starts just above the headline (56% → copy at 60%)
    // and is solid from 83% down.
    if (bg.fade && bg.fade.color) {
      const share = Math.max(0.2, Math.min(0.9, bg.fade.height || 0.44));
      const textTop = copyTop(ops);
      const start = Math.max(0, Math.min(height * (1 - share), Number.isFinite(textTop) ? textTop - height * 0.04 : Infinity));
      const solid = start + (height - start) * 0.606;
      const rgb = hexRgb(bg.fade.color);
      const g = ctx.createLinearGradient(0, start, 0, height);
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(Math.max(0.01, (solid - start) / (height - start)), `rgba(${rgb},1)`);
      g.addColorStop(1, `rgba(${rgb},1)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, start, width, height - start);
    }
    drawOps(ctx, ops, logoImage);
    ctx.restore();
  }

  return { BASE, MIN_SCALE, MAX_SCALE, CAP, CONDENSED, BODY, ZOOM_MAX, TINT_MAX, TINT_MAX_FADE, STILL, KEN_BURNS, parseRuns, tokensFor, wrapTokens, fitLayout, drawFrame, drawOps, drawVideo, videoRect, tintLayers, luminance, roundRect, kenBurnsFrame, generatedState, generatedColors, drawGenerated };
}));
