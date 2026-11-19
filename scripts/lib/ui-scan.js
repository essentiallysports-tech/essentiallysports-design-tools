// In-page UI scan used by scripts/check-pages-ui.mjs (evaluated in the page as
// `(<this function>)()`). Returns { issues: [{ kind, sel, detail }], warnings }.
// Kinds: doubled-border, empty-band, clipped-text, overflow-text, page-scroll,
// card-heights, action-rows, button-heights, font, purple, unlabelled,
// primary-buttons, broken-image, contrast. Warnings: off-grid spacing.
// Opt out for a deliberate case with data-qa-allow="<kind> <kind>" on the
// element or an ancestor.
function uiScan() {
  const issues = [];
  const warnings = [];
  const seen = new Set();
  const W = innerWidth;
  const H = innerHeight;
  const cs = e => getComputedStyle(e);
  const allowed = (e, kind) => { const a = e.closest?.('[data-qa-allow]'); return Boolean(a && a.dataset.qaAllow.split(/\s+/).includes(kind)); };
  const sel = e => {
    if (!e || !e.tagName) return '';
    let s = e.tagName.toLowerCase();
    if (e.id) return s + '#' + e.id;
    const cls = [...e.classList].filter(c => !/^(is-|has-)/.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    const p = e.parentElement;
    if (p && p !== document.body) {
      const ps = p.id ? '#' + p.id : p.classList[0] ? '.' + p.classList[0] : p.tagName.toLowerCase();
      s = ps + ' > ' + s;
    }
    return s;
  };
  const add = (kind, e, detail) => {
    if (e && allowed(e, kind)) return;
    const key = kind + '|' + sel(e) + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, sel: sel(e), detail });
  };
  const visible = e => {
    if (!e || !e.isConnected) return false;
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const srOnly = e => { const r = e.getBoundingClientRect(); return r.width <= 2 || r.height <= 2 || /rect\(0|inset\(50%/.test(cs(e).clip + cs(e).clipPath); };
  const inertHidden = e => Boolean(e.closest('[inert], [aria-hidden="true"]'));
  const px = v => parseFloat(v) || 0;
  const all = [...document.body.querySelectorAll('*')].filter(e => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'svg', 'path'].includes(e.tagName) && !(e instanceof SVGElement && e.tagName !== 'svg'));
  const vis = all.filter(visible);
  const visSet = new Set(vis);
  const directText = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const textEls = vis.filter(e => directText(e) && !srOnly(e) && !inertHidden(e));

  // ── 4. Horizontal page scroll ───────────────────────────────────────────
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > W + 1) {
    const wide = vis.filter(e => e.getBoundingClientRect().right > W + 1 && !e.closest('[class*=scroll], [style*=overflow]'))
      .filter(e => ![...e.children].some(k => visSet.has(k) && k.getBoundingClientRect().right > W + 1)).slice(0, 3);
    add('page-scroll', document.documentElement, `page is ${sw}px wide in a ${W}px window; widest: ${wide.map(sel).join(', ') || '?'}`);
  }

  // ── 1. Doubled borders ──────────────────────────────────────────────────
  const borderBox = e => { const s = cs(e); const on = side => px(s[`border${side}Width`]) >= 1 && s[`border${side}Style`] !== 'none' && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(s[`border${side}Color`]); return on('Top') && on('Bottom') && on('Left') && on('Right'); };
  const controls = vis.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=color]), textarea, select, button, .es-btn, [role=button], [role=searchbox], [role=combobox]'));
  for (const c of controls) {
    if (!borderBox(c)) continue;
    let a = c.parentElement;
    for (let d = 0; d < 3 && a && a !== document.body; d++, a = a.parentElement) {
      if (!visSet.has(a) || !borderBox(a)) continue;
      const rc = c.getBoundingClientRect(); const ra = a.getBoundingClientRect();
      const tight = c.matches('input, textarea, select, [role=searchbox], [role=combobox]') ? (ra.height < rc.height + 24 && ra.width < rc.width + 60) : (ra.height <= rc.height + 6 && ra.width <= rc.width + 6);
      if (tight) { add('doubled-border', c, `bordered box inside bordered ${sel(a)}`); break; }
    }
  }

  // ── 2. Empty bands ──────────────────────────────────────────────────────
  const MEDIA = 'img, svg, canvas, video, iframe, picture, input, select, textarea, button, progress, meter, [role=img], [role=progressbar]';
  const pseudo = e => ['::before', '::after'].some(p => { const ps = getComputedStyle(e, p); return ps.content !== 'none' && ps.content !== 'normal' && (ps.content !== '""' || ps.backgroundImage !== 'none'); });
  const hasContent = e => {
    if (cs(e).backgroundImage !== 'none' || pseudo(e)) return true;
    if (e.matches(MEDIA)) return true;
    for (const k of e.querySelectorAll('*')) {
      if (!visSet.has(k)) continue;
      if (k.matches(MEDIA) || k.matches('.es-skeleton, [class*=skeleton]') || (directText(k) && !srOnly(k))) return true;
      const ks = cs(k); const kr = k.getBoundingClientRect();
      // Drawn controls (a switch track, a swatch, a dot) are content too.
      if (kr.width >= 6 && kr.height >= 6 && (ks.backgroundImage !== 'none' || !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(ks.backgroundColor))) return true;
    }
    return directText(e);
  };
  const bands = vis.filter(e => e.matches('section, article, aside, fieldset, li, [class*=card], [class*=panel], [class*=section], [class*=band], [class*=group], [class*=row], [role=region], [role=group]'));
  for (const b of bands) {
    const r = b.getBoundingClientRect();
    if (r.height < 24 || r.width < 40 || inertHidden(b) || b.closest('.es-skeleton, .is-skeleton, [aria-busy=true], [class*=skeleton]')) continue;
    if (!hasContent(b)) add('empty-band', b, `${Math.round(r.width)}×${Math.round(r.height)} box with nothing visible in it`);
  }
  // Two dividers with nothing between them.
  for (const e of vis) {
    const s = cs(e);
    const isDivider = e.tagName === 'HR' || e.getAttribute('role') === 'separator';
    if (!isDivider) continue;
    let n = e.nextElementSibling;
    while (n && !visSet.has(n)) n = n.nextElementSibling;
    if (n && (n.tagName === 'HR' || n.getAttribute('role') === 'separator')) add('empty-band', e, 'two dividers with nothing between them');
    void s;
  }

  // ── 3. Clipped and overflowing text ─────────────────────────────────────
  const clampOrEllipsis = e => { const s = cs(e); return s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none'); };
  for (const e of textEls) {
    const s = cs(e);
    if (e.matches('input, textarea, select, option')) continue;
    if (s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && !clampOrEllipsis(e) && !/auto|scroll/.test(s.overflowX)) add('clipped-text', e, `text cut off (${e.scrollWidth} > ${e.clientWidth}px): "${e.textContent.trim().slice(0, 40)}"`);
    else if (s.overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 3 && !clampOrEllipsis(e) && e.clientHeight > 0) add('clipped-text', e, `text cut off vertically (${e.scrollHeight} > ${e.clientHeight}px): "${e.textContent.trim().slice(0, 40)}"`);
    // Text spilling past its own box, or past a clipping ancestor.
    const range = document.createRange();
    for (const n of e.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      if (!tr.width) continue;
      const er = e.getBoundingClientRect();
      if (s.display !== 'inline' && s.overflowX === 'visible' && (tr.right > er.right + 2 || tr.left < er.left - 2) && !allowed(e, 'overflow-text')) add('overflow-text', e, `text runs ${Math.round(Math.max(tr.right - er.right, er.left - tr.left))}px outside its box: "${n.textContent.trim().slice(0, 40)}"`);
      for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const as = cs(a);
        // A scrolling row or list (chips, palette results, wide tables) is meant to scroll.
        if (/auto|scroll/.test(as.overflowX + as.overflowY) && (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1)) break;
        const clipX = /hidden|clip/.test(as.overflowX); const clipY = /hidden|clip/.test(as.overflowY);
        if (!clipX && !clipY) continue;
        if (srOnly(a)) break;
        // Inside a moving track (carousel, slider): a slide in transit is not a cut label.
        let moved = false; for (let m = e; m && m !== a; m = m.parentElement) if (cs(m).transform !== 'none') { moved = true; break; }
        if (moved) break;
        const ar = a.getBoundingClientRect();
        const l = ar.left + px(as.borderLeftWidth), rgt = ar.right - px(as.borderRightWidth), t = ar.top + px(as.borderTopWidth), btm = ar.bottom - px(as.borderBottomWidth);
        const outX = clipX && (tr.right > rgt + 1.5 || tr.left < l - 1.5) && !clampOrEllipsis(e);
        const outY = clipY && (tr.bottom > btm + 2 || tr.top < t - 2) && !clampOrEllipsis(e) && !clampOrEllipsis(a);
        if ((outX || outY) && tr.top < btm && tr.bottom > t) { add('clipped-text', e, `text cut by ${sel(a)}: "${n.textContent.trim().slice(0, 40)}"`); break; }
        if (outX || outY) break; // fully scrolled out of a clipped area (carousel): not a cut label
      }
    }
  }

  // Short labels cut with an ellipsis or a line clamp ("Brief to on-bran…"):
  // a truncated title is fine, a cut 1-5 word label is not.
  for (const e of textEls) {
    if (!clampOrEllipsis(e) || e.matches('input, textarea, select, option')) continue;
    const t = e.textContent.trim();
    const cut = e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2;
    if (cut && t.length <= 32 && t.split(/\s+/).length <= 5 && !/@|:\/\//.test(t)) add('clipped-text', e, `short label truncated: "${t}"`);
  }
  // Placeholders wider than their field.
  const ctx = document.createElement('canvas').getContext('2d');
  for (const i of vis.filter(e => e.matches('input[placeholder], textarea[placeholder]') && !e.value)) {
    if (i.tagName === 'TEXTAREA') continue;
    const s = cs(i); ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const room = i.clientWidth - px(s.paddingLeft) - px(s.paddingRight);
    const need = ctx.measureText(i.placeholder).width;
    if (need > room + 1) add('clipped-text', i, `placeholder cut (${Math.round(need)} > ${Math.round(room)}px): "${i.placeholder}"`);
  }

  // Same role, different type: elements with the same classes (row titles,
  // card titles) drawn at different sizes or weights on one screen.
  const typeGroups = new Map();
  for (const e of textEls) {
    const own = [...e.classList].sort().join('.'); // state classes (is-over, is-active) make their own group
    if (!own) continue;
    // Peers only: same classes inside the same kind of parent (a demo of sizes, or
    // a deliberately accented group with its own modifier, is not a mismatch).
    const stateOf = n => n ? ['aria-current', 'aria-pressed', 'aria-checked', 'aria-selected', 'data-state'].map(a => n.getAttribute(a) || '').join(',') : '';
    const key = own + ' in ' + [...(e.parentElement?.classList || [])].filter(c => !/^(is-|has-)/.test(c)).sort().join('.') + ' @' + stateOf(e) + stateOf(e.parentElement);
    const st = cs(e); const sig = `${st.fontSize}/${st.fontWeight}`;
    if (!typeGroups.has(key)) typeGroups.set(key, new Map());
    const g = typeGroups.get(key); if (!g.has(sig)) g.set(sig, e);
  }
  for (const [key, g] of typeGroups) if (g.size > 1) add('inconsistent-type', [...g.values()][1], `.${key.split(' in ')[0]} is drawn as ${[...g.keys()].join(' and ')}`);

  // ── 5. Misaligned siblings ──────────────────────────────────────────────
  const rows = list => {
    const out = [];
    for (const k of list) { const r = k.getBoundingClientRect(); const row = out.find(o => Math.abs(o.top - r.top) < 3); if (row) row.items.push(k); else out.push({ top: r.top, items: [k] }); }
    return out.filter(o => o.items.length > 1);
  };
  const containers = vis.filter(e => /flex|grid/.test(cs(e).display) && e.children.length > 1);
  const isCard = e => /(^|[-_])card(?!__)/.test(e.className && typeof e.className === 'string' ? e.className : '') || e.matches('article');
  const isBtn = e => e.matches('button, .es-btn, a[class*=btn], a[class*=button], [role=button]') && !e.matches('[role=tab], [role=radio], [role=menuitem], .es-chip, [class*=chip]');
  for (const c of containers) {
    const kids = [...c.children].filter(k => visSet.has(k) && cs(k).position !== 'absolute' && cs(k).position !== 'fixed');
    const s = cs(c);
    const rowFlow = s.display.includes('grid') || !s.flexDirection.startsWith('column');
    if (!rowFlow) continue;
    const cards = kids.filter(isCard);
    // Only peers: cards of the same kind (same classes) are meant to line up.
    const kinds = new Map(); cards.forEach(k => { const key = [...k.classList].filter(c => !/^(is-|has-)/.test(c)).sort().join('.') || k.tagName; kinds.set(key, [...(kinds.get(key) || []), k]); });
    for (const row of [...kinds.values()].flatMap(rows)) {
      const hs = row.items.map(k => Math.round(k.getBoundingClientRect().height));
      if (Math.max(...hs) - Math.min(...hs) > 2 && s.alignItems !== 'start' && s.alignItems !== 'flex-start') add('card-heights', c, `cards in one row are ${[...new Set(hs)].join(' / ')}px tall`);
      const acts = row.items.map(k => [...k.querySelectorAll('button, .es-btn, a[class*=btn]')].filter(b => visSet.has(b)).pop()).filter(Boolean);
      if (acts.length === row.items.length) {
        const ys = acts.map(b => Math.round(b.getBoundingClientRect().bottom));
        if (Math.max(...ys) - Math.min(...ys) > 2) add('action-rows', c, `card actions sit at different heights (${[...new Set(ys)].join(' / ')})`);
      }
    }
    const btns = kids.filter(isBtn);
    for (const row of rows(btns)) {
      const hs = row.items.map(k => Math.round(k.getBoundingClientRect().height));
      if (Math.max(...hs) - Math.min(...hs) > 1) add('button-heights', c, `buttons in one row are ${[...new Set(hs)].join(' / ')}px tall (${row.items.map(sel).join(', ')})`);
    }
  }

  // ── 6. Off-grid spacing (warning) ───────────────────────────────────────
  const offGrid = v => { const n = px(v); return n > 0 && Math.abs(n / 4 - Math.round(n / 4)) > 0.05; };
  for (const e of vis) {
    if (inertHidden(e) || e.closest('#infographic-fields, #listicle-type2-fields')) continue;
    const s = cs(e);
    const bad = [];
    if (/flex|grid/.test(s.display)) { if (offGrid(s.rowGap)) bad.push(`row-gap ${s.rowGap}`); if (offGrid(s.columnGap)) bad.push(`column-gap ${s.columnGap}`); }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (offGrid(s[`padding${side}`])) bad.push(`padding-${side.toLowerCase()} ${s[`padding${side}`]}`);
    if (bad.length) warnings.push({ sel: sel(e), detail: bad.join(', ') });
  }

  // ── 7. Fonts and purple ─────────────────────────────────────────────────
  const ES_FONT = /^(acumin|roboto|es-)/i;
  const MONO_OK = 'kbd, code, pre, samp';
  for (const e of textEls) {
    const first = cs(e).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!ES_FONT.test(first) && !(e.closest(MONO_OK) && /mono|menlo|consolas|courier/i.test(first)) && !e.closest('.fu-preview, [data-qa-content], .gallery-card__thumb, canvas')) add('font', e, `font "${first}" is not an ES font`);
  }
  const rgb = v => { const m = String(v).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const isPurple = c => {
    if (!c || c[3] < 0.15) return false;
    const [r, g, b] = c.map((x, i) => i < 3 ? x / 255 : x);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d < 0.12) return false;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
    return sat > 0.3 && h >= 262 && h <= 320 && l > 0.15 && l < 0.92;
  };
  for (const e of vis) {
    if (e.closest('[data-qa-content], .gallery-card__thumb, .td-photo, img')) continue;
    const s = cs(e);
    const props = [['color', s.color, directText(e)], ['background', s.backgroundColor, true], ['border', s.borderTopColor, px(s.borderTopWidth) > 0], ['fill', s.fill, e.tagName === 'svg'], ['stroke', s.stroke, e.tagName === 'svg' && s.stroke !== 'none']];
    for (const [name, val, on] of props) if (on && isPurple(rgb(val))) { add('purple', e, `purple ${name} ${val}`); break; }
  }

  // ── 8. Labels and primary buttons ───────────────────────────────────────
  const nameOf = e => {
    const label = e.getAttribute('aria-label'); if (label && label.trim()) return label;
    const by = e.getAttribute('aria-labelledby'); if (by) { const t = by.split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (e.matches('input, select, textarea')) {
      if (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent.trim()) return 'label';
      if (e.closest('label')?.textContent.trim()) return 'label';
      if (/^(submit|button|reset)$/.test(e.type) && e.value) return e.value;
      if (e.title) return e.title;
      return '';
    }
    const text = (e.innerText || e.textContent || '').trim(); if (text) return text;
    const img = e.querySelector('img[alt]:not([alt=""])'); if (img) return img.alt;
    if (e.title) return e.title;
    return '';
  };
  const inter = vis.filter(e => e.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [tabindex]:not([tabindex="-1"])') && !inertHidden(e));
  for (const e of inter) if (!nameOf(e) && !e.matches('dialog, [role=dialog], main, section, [role=region], [role=group], [role=list], [role=listbox], [role=tabpanel], [role=grid]')) add('unlabelled', e, `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[role=' + e.getAttribute('role') + ']' : ''} has no accessible name`);
  const PRIMARY = '.es-btn--primary, .btn-primary, .primary-btn, .how-button--primary, .auth-state-button.is-primary, .va-btn--primary';
  // Counted per layer: the page, and each open dialog, popover or toast.
  const LAYER = 'dialog, [role=dialog], [role=alertdialog], [role=menu], [popover], [class*=toast], [class*=popover]';
  const layers = new Map();
  vis.filter(e => e.matches(PRIMARY) && !inertHidden(e) && !e.disabled)
    .filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; })
    .forEach(e => { const l = e.parentElement.closest(LAYER) || document.body; layers.set(l, [...(layers.get(l) || []), e]); });
  for (const [, list] of layers) if (list.length > 1) add('primary-buttons', list[1], `${list.length} primary buttons in view: ${list.map(e => `"${(e.innerText || '').trim().slice(0, 24)}"`).join(', ')}`);

  // ── 10. Broken images ───────────────────────────────────────────────────
  for (const img of vis.filter(e => e.tagName === 'IMG')) if (img.complete && img.getAttribute('src') && img.naturalWidth === 0) add('broken-image', img, `image did not load: ${img.getAttribute('src').slice(0, 80)}`);

  // ── 11. Contrast ────────────────────────────────────────────────────────
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  const bgOf = e => {
    const stack = [];
    for (let a = e; a; a = a.parentElement) {
      const s = cs(a);
      if (s.backgroundImage !== 'none' || a.matches('img, video, canvas, picture')) return null; // over a picture or gradient: unknown
      if (s.filter !== 'none' || s.mixBlendMode !== 'normal' || s.backdropFilter !== 'none' && s.backdropFilter) { /* still usable */ }
      const c = rgb(s.backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    if (!stack.length || stack[stack.length - 1][3] < 1) base = rgb(cs(document.documentElement).backgroundColor) || base;
    if (base[3] < 1) base = document.documentElement.dataset.theme === 'dark' ? [18, 18, 18, 1] : [255, 255, 255, 1];
    return stack.reverse().reduce((under, top) => blend(top, under), base);
  };
  for (const e of textEls) {
    if (e.closest(':disabled, [aria-disabled=true], [data-qa-content], .gallery-card__thumb') || e.matches('option')) continue;
    if (e.closest('[class*=placeholder]')) continue;
    const s = cs(e);
    if (px(s.opacity) < 1 && s.opacity !== '') { /* opacity below 1 is folded in below */ }
    let fg = rgb(s.color); if (!fg) continue;
    const bg = bgOf(e); if (!bg) continue;
    let op = 1; for (let a = e; a; a = a.parentElement) op *= parseFloat(cs(a).opacity);
    fg = blend([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = px(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.05) add('contrast', e, `${ratio.toFixed(2)}:1 (needs ${need}) "${e.textContent.trim().slice(0, 30)}" ${s.color} on rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`);
  }

  return { issues, warnings };
}
