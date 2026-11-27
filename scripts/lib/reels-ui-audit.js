// In-page UI audit used by scripts/check-reels-ui.mjs. This file is ONE function
// expression: the check reads it and evaluates `(<this>)(options)` in the page.
// options: { roots: [selector], ignore: [selector] }
// Returns { issues: [string], warns: [string] }. Issues fail the check; warns
// (off-grid spacing) are reported only.
(function reelsUiAudit(opts) {
  const roots = (opts.roots || ['body']).map(s => document.querySelector(s)).filter(Boolean);
  const ignoreSel = (opts.ignore || []).join(',');
  const issues = [];
  const warns = [];
  const vw = document.documentElement.clientWidth;
  const css = e => getComputedStyle(e);
  const ignored = e => Boolean(ignoreSel && e.closest(ignoreSel));
  const label = e => {
    const id = e.id ? `#${e.id}` : '';
    const cls = typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  function shown(e) {
    for (let a = e; a && a.nodeType === 1; a = a.parentElement) {
      const s = css(a);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
      if (Number(s.opacity) === 0) return false;
      if (a.hidden && s.display === 'none') return false;
      if (a.tagName === 'DETAILS' && !a.open && a !== e && !e.closest('summary')) {
        // inside a closed <details>: only the summary shows
        let inSummary = false; for (let b = e; b && b !== a; b = b.parentElement) if (b.tagName === 'SUMMARY' && b.parentElement === a) inSummary = true;
        if (!inSummary) return false;
      }
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  // Clipped away entirely by an overflow ancestor (e.g. a closed collapse) = not shown.
  function onScreenBox(e) {
    let r = e.getBoundingClientRect();
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = css(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        if (s.overflowX !== 'visible') { box.l = Math.max(box.l, ar.left); box.r = Math.min(box.r, ar.right); }
        if (s.overflowY !== 'visible') { box.t = Math.max(box.t, ar.top); box.b = Math.min(box.b, ar.bottom); }
      }
    }
    return box.r - box.l > 0.5 && box.b - box.t > 0.5;
  }
  const all = [];
  roots.forEach(root => { all.push(root); root.querySelectorAll('*').forEach(e => all.push(e)); });
  document.querySelectorAll('dialog[open]').forEach(d => { all.push(d); d.querySelectorAll('*').forEach(e => all.push(e)); });
  // Each element once (a root may sit inside an open dialog, or a dialog inside a root).
  const uniq = [...new Set(all)];
  const vis = uniq.filter(e => !ignored(e) && !['SCRIPT', 'STYLE', 'TEMPLATE', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g'].includes(e.tagName) && !(e instanceof SVGElement && e.tagName !== 'svg') && shown(e) && onScreenBox(e));
  const visSet = new Set(vis);
  const hasBorderBox = s => ['Top', 'Right', 'Bottom', 'Left'].every(k => parseFloat(s[`border${k}Width`]) >= 1 && s[`border${k}Style`] !== 'none' && !/rgba\(.*, 0\)$/.test(s[`border${k}Color`]));
  const ownText = e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  const isControl = e => e.matches('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=radio], [role=checkbox], [role=tab], [role=slider], [role=switch], [role=menuitem], [tabindex]:not([tabindex="-1"])');

  // 4. Horizontal page scroll.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push(`horizontal page scroll (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
  vis.forEach(e => { const r = e.getBoundingClientRect(); if (r.right > vw + 1 && css(e).position !== 'fixed' && !e.closest('[class*="strip"], [class*="scroll"]')) { let clipped = false; for (let a = e.parentElement; a; a = a.parentElement) { const s = css(a); if (s.overflowX !== 'visible' && a.getBoundingClientRect().right <= vw + 1) { clipped = true; break; } } if (!clipped) issues.push(`past the right edge: ${label(e)}`); } });

  // 3b. A box that sticks out of its parent's box (a control wider than its
  // column), unless the parent scrolls or the child is positioned.
  vis.forEach(e => {
    const p = e.parentElement;
    if (!p || !visSet.has(p) || e.matches('svg, img, canvas, video') || /(absolute|fixed|sticky)/.test(css(e).position)) return;
    const sp = css(p);
    if (/(auto|scroll)/.test(sp.overflowX) || sp.display === 'contents' || sp.display === 'inline') return;
    const sm = css(e);
    if (parseFloat(sm.marginLeft) < 0 || parseFloat(sm.marginRight) < 0) return; // a deliberate full-bleed
    const r = e.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    if (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) issues.push(`sticks out of its parent by ${Math.round(Math.max(r.right - pr.right, pr.left - r.left))}px: ${label(e)} in ${label(p).split(' ')[0]}`);
  });

  // 1. Doubled borders: a bordered control inside an equally sized bordered wrapper.
  vis.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea, button, .es-segmented, [role=radiogroup]')).forEach(i => {
    const si = css(i);
    if (!hasBorderBox(si)) return;
    const ri = i.getBoundingClientRect();
    let a = i.parentElement;
    for (let d = 0; d < 3 && a && !roots.includes(a); d++, a = a.parentElement) {
      if (!visSet.has(a)) continue;
      const sa = css(a);
      if (!hasBorderBox(sa)) continue;
      const ra = a.getBoundingClientRect();
      if (ra.height - ri.height < 12 && ra.width - ri.width < 24) { issues.push(`doubled border: ${label(i)} inside ${label(a)}`); break; }
    }
  });

  // 2. Empty bands: a visible box (section, card, list, fold body) with nothing
  // visible inside it, or a run of space between two dividers.
  const hasContent = e => {
    if (e.matches('img, canvas, video, svg, input, select, textarea, button, progress, hr, iframe, [role=img], [role=progressbar]')) return true;
    if (ownText(e)) return true;
    const s = css(e);
    if (s.backgroundImage !== 'none') return true;
    for (const k of e.children) {
      if (k.matches('canvas, img, video, svg') && shown(k)) return true;
      if ((shown(k) || css(k).display === 'contents') && hasContent(k)) return true; // a boxless wrapper: look through it
    }
    return false;
  };
  vis.forEach(e => {
    if (!e.matches('section, article, aside, div, ul, ol, li, p, details, fieldset, figure, footer, header, form')) return;
    if (e.querySelector('.es-skeleton') || e.matches('.is-skeleton')) return;
    if (css(e).position === 'fixed') return; // floating layers are checked below
    if (e.matches('[aria-hidden=true], [class*="progress"], [class*="spin"], [class*="dot"], [class*="swatch"], [class*="bar"], [class*="track"], [class*="fill"], [class*="safe"], [class*="playhead"], [class*="marker"], [class*="thumb"]')) return;
    const r = e.getBoundingClientRect();
    if (r.height < 12 || r.width < 24) return;
    const s = css(e);
    const painted = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || hasBorderBox(s) || parseFloat(s.borderTopWidth) || parseFloat(s.borderBottomWidth);
    if (!hasContent(e) && (painted || r.height >= 24)) issues.push(`empty band: ${label(e)} (${Math.round(r.width)}×${Math.round(r.height)})`);
  });
  // An empty (zero-size) item in a flex / grid container with a gap still takes
  // a gap: an invisible band of extra space between its neighbours.
  vis.forEach(p => {
    const s = css(p);
    if (!/(flex|grid)/.test(s.display)) return;
    const col = s.display.includes('grid') ? true : s.flexDirection.startsWith('column');
    const gap = parseFloat(col ? s.rowGap : s.columnGap) || 0;
    if (gap < 1) return;
    const kids = [...p.children].filter(k => { const sk = css(k); return sk.display !== 'none' && sk.display !== 'contents' && !/(absolute|fixed)/.test(sk.position) && !k.matches('script, style, template, input[type=file], dialog:not([open])'); });
    if (kids.length < 2) return;
    kids.forEach(k => {
      const r = k.getBoundingClientRect();
      const sk = css(k);
      const pulled = -(parseFloat(col ? sk.marginTop : sk.marginLeft) || 0) >= gap - 0.5; // collapsed on purpose, gap cancelled
      if ((col ? r.height : r.width) < 0.5 && !pulled && !k.matches('.es-sr-only, [class*="sr-only"]')) issues.push(`empty item takes a ${gap}px gap: ${label(k)} in ${label(p).split(' ')[0]}`);
    });
  });
  // A section whose visible children are only a heading = a band with a title and nothing under it.
  vis.filter(e => e.matches('.rm-sec, .rm-fold__body')).forEach(e => {
    const kids = [...e.children].filter(k => visSet.has(k));
    if (kids.length && kids.every(k => k.matches('h1,h2,h3,h4,.rm-sec__head,.rm-sec__title'))) issues.push(`section with only a heading: ${label(e)}`);
  });

  // 3. Clipped text.
  vis.forEach(e => {
    if (!ownText(e) || e.matches('input, textarea, select, option')) return;
    const s = css(e);
    const ell = s.textOverflow === 'ellipsis' || parseInt(s.webkitLineClamp, 10) > 0;
    if (s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && !ell && !/(auto|scroll)/.test(s.overflowX)) issues.push(`clipped text (x): ${label(e)}`);
    if (s.overflowY !== 'visible' && e.scrollHeight > e.clientHeight + 2 && !ell && !/(auto|scroll)/.test(s.overflowY)) issues.push(`clipped text (y): ${label(e)}`);
    // Overflows a clipping ancestor.
    const r = e.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect();
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const sa = css(a);
      if (sa.overflowX === 'visible' && sa.overflowY === 'visible') continue;
      if (/(auto|scroll)/.test(sa.overflowX + sa.overflowY)) break;
      const ar = a.getBoundingClientRect();
      if (tr.width && (tr.right > ar.right + 1.5 || tr.left < ar.left - 1.5) && !ell) issues.push(`text cut by ${label(a).split(' ')[0]}: ${label(e)}`);
      break;
    }
    void r;
  });

  // 5. Misaligned siblings: cards in one row with different heights; buttons in
  // one row with different heights.
  const rowsOf = kids => { const rows = []; kids.forEach(k => { const r = k.getBoundingClientRect(); const row = rows.find(x => Math.abs(x.top - r.top) < 3); if (row) row.items.push([k, r]); else rows.push({ top: r.top, items: [[k, r]] }); }); return rows.filter(x => x.items.length > 1); };
  vis.forEach(p => {
    const s = css(p);
    if (!/(flex|grid)/.test(s.display)) return;
    if (s.display.includes('flex') && s.flexDirection.startsWith('column')) return;
    // Layout columns (stage beside panel) are allowed to differ: only compare
    // items up to 480px tall.
    const kids = [...p.children].filter(k => visSet.has(k) && css(k).position !== 'absolute' && k.getBoundingClientRect().height <= 480);
    if (kids.length < 2) return;
    rowsOf(kids).forEach(row => {
      const cards = row.items.filter(([k]) => { const sk = css(k); return hasBorderBox(sk) || sk.backgroundColor !== 'rgba(0, 0, 0, 0)'; });
      const btns = row.items.filter(([k]) => k.matches('button, .es-btn, a.es-btn, label.es-btn') && !k.matches('[role=radio], [role=tab], .es-chip, .rm-icon-btn'));
      const spread = list => Math.max(...list.map(([, r]) => r.height)) - Math.min(...list.map(([, r]) => r.height));
      if (cards.length > 1 && cards.length === row.items.length && spread(cards) > 2 && !cards.every(([k]) => k.matches('button, a, label, .es-chip, .es-badge, [role=radio]'))) issues.push(`uneven cards in a row: ${label(p)} (${cards.map(([, r]) => Math.round(r.height)).join('/')})`);
      if (btns.length > 1 && spread(btns) > 1) issues.push(`uneven buttons in a row: ${label(p)} (${btns.map(([, r]) => Math.round(r.height)).join('/')})`);
    });
  });

  // 6. Off-grid spacing (report only): paddings and gaps not on the 4px grid.
  const off = v => { const n = parseFloat(v); return n > 2 && Math.abs(n / 4 - Math.round(n / 4)) > 0.01; };
  if (opts.warns !== false) vis.forEach(e => {
    const s = css(e);
    const bad = [];
    ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap'].forEach(k => { if (s[k] && s[k] !== 'normal' && off(s[k])) bad.push(`${k} ${s[k]}`); });
    if (bad.length) warns.push(`off-grid: ${label(e)} ${bad.join(', ')}`);
  });

  // 7. Fonts and purple.
  const ES_FONTS = /^("?)(Roboto|Roboto Condensed|Acumin|Acumin Pro|Acumin Variable Concept|acumin-pro|acumin-pro-condensed)\1$/i;
  const purple = c => { const m = String(c).match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); if (!m) return false; if (m[4] !== undefined && Number(m[4]) < 0.15) return false; const [r, g, b] = [m[1], m[2], m[3]].map(Number).map(x => x / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); const d = max - min; if (d < 0.12 || max < 0.2) return false; let h; if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h * 60 + 360) % 360; const sat = d / (1 - Math.abs(max + min - 1)); return h >= 255 && h <= 320 && sat > 0.25; };
  vis.forEach(e => {
    const s = css(e);
    if (ownText(e) || (e.matches('input, textarea, select, button') && (e.value || e.textContent || '').trim())) {
      const first = s.fontFamily.split(',')[0].trim();
      if (!ES_FONTS.test(first)) issues.push(`non-ES font "${first}": ${label(e)}`);
    }
    for (const k of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor']) if (purple(s[k]) && (k !== 'borderTopColor' || parseFloat(s.borderTopWidth)) && (k !== 'outlineColor' || s.outlineStyle !== 'none')) { issues.push(`purple ${k} ${s[k]}: ${label(e)}`); break; }
  });

  // 8. Unlabelled controls; one primary button per view.
  const nameOf = e => {
    if (e.getAttribute('aria-label')?.trim()) return true;
    const lb = e.getAttribute('aria-labelledby'); if (lb && lb.split(/\s+/).some(i => document.getElementById(i)?.textContent.trim())) return true;
    if (e.labels && [...e.labels].some(l => l.textContent.trim())) return true;
    if (e.closest('label') && e.closest('label').textContent.trim()) return true;
    if (e.getAttribute('title')?.trim()) return true;
    if (e.matches('input[type=submit], input[type=button]') && e.value) return true;
    if (!e.matches('input, select, textarea') && (e.textContent || '').trim()) return true;
    if ([...e.querySelectorAll('img[alt]')].some(i => i.alt.trim())) return true;
    return false;
  };
  vis.filter(isControl).forEach(e => { if (!e.matches('label') && !nameOf(e) && !e.matches('[aria-hidden=true] *')) issues.push(`no accessible name: ${label(e)}`); });
  // With a modal dialog open the page behind it is inert: only the dialog's primary counts.
  const modal = [...document.querySelectorAll('dialog[open]')].find(d => { try { return d.matches(':modal'); } catch { return false; } });
  const primaries = vis.filter(e => e.matches('.es-btn--primary, .is-primary, [data-variant=primary]') && !e.closest('[inert]') && (!modal || modal.contains(e)));
  if (primaries.length > 1) issues.push(`${primaries.length} primary buttons: ${primaries.map(label).join(', ')}`);

  // A floating layer (toast, popover) covering one of the view's key actions
  // (opts.keyActions: the step buttons). Covering a field for a few seconds is
  // what a toast does; covering Next / Export is not.
  // A modal dialog (showModal) covers the page on purpose: the page behind is inert.
  const isModal = e => { try { return e.matches(':modal'); } catch { return false; } };
  const floats = vis.filter(e => css(e).position === 'fixed' && e.children.length && e.getBoundingClientRect().height > 8 && !isModal(e));
  floats.forEach(f => {
    const fr = f.getBoundingClientRect();
    vis.filter(c => (opts.keyActions || []).some(k => c.matches(k))).forEach(c => {
      if (f.contains(c) || c.contains(f) || c.disabled) return;
      const cr = c.getBoundingClientRect();
      const ox = Math.min(fr.right, cr.right) - Math.max(fr.left, cr.left), oy = Math.min(fr.bottom, cr.bottom) - Math.max(fr.top, cr.top);
      if (ox > 4 && oy > 4) issues.push(`${label(f).split(' ')[0]} covers ${label(c)}`);
    });
  });

  // 10. Broken images.
  vis.filter(e => e.tagName === 'IMG').forEach(i => { if (i.complete && i.naturalWidth === 0 && i.getAttribute('src')) issues.push(`broken image: ${i.getAttribute('src').slice(0, 80)}`); });

  // 11. Contrast (text on a solid background; skipped over photos / canvases).
  const parse = c => { const m = String(c).match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1]; };
  function bgOf(e) {
    const layers = [];
    for (let a = e; a; a = a.parentElement) {
      const s = css(a);
      if (s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null;
      if (/gradient/.test(s.backgroundImage)) return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let out = [255, 255, 255, 1];
    if (!layers.length || layers[layers.length - 1][3] < 1) out = document.documentElement.getAttribute('data-theme') === 'dark' ? [0, 0, 0, 1] : [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  }
  vis.forEach(e => {
    const t = ownText(e);
    if (!t || e.matches('option, [disabled], [aria-disabled=true]') || e.closest('[disabled], [aria-disabled=true], .rm-device, .es-skeleton')) return;
    const s = css(e);
    let fg = parse(s.color);
    if (!fg) return;
    const bg = bgOf(e);
    if (!bg) return;
    if (fg[3] < 1) fg = blend(fg, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.05) issues.push(`contrast ${ratio.toFixed(2)}:1 < ${need}: ${label(e)}`);
  });

  return { issues: [...new Set(issues)], warns: [...new Set(warns)] };
})
