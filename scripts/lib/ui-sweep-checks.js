// In-page UI checks shared by the browser sweeps (scripts/check-*-ui.mjs).
// This file is a single function expression: the sweep reads it as text and
// runs `(<source>)()` in the page. It returns { issues: [...], offGrid: [...] }.
// Keep it dependency-free and side-effect-free.
function uiSweepChecks() {
  const issues = [];
  const offGrid = new Set();
  const W = window.innerWidth;
  const root = document.body;
  const css = e => getComputedStyle(e);
  const name = e => {
    if (!e || e === document.body) return 'body';
    const id = e.id ? `#${e.id}` : '';
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => `.${c}`).join('') : '';
    return `${e.tagName.toLowerCase()}${id}${cls}`;
  };
  const path2 = e => `${name(e.parentElement)} > ${name(e)}`;
  function opacityOf(e) { let o = 1; for (let a = e; a && a !== document.documentElement; a = a.parentElement) o *= parseFloat(css(a).opacity); return o; }
  function visible(e) {
    if (!e || !e.isConnected) return false;
    if (e.closest('[hidden], [aria-hidden="true"], template, noscript')) {
      // aria-hidden decorations still count visually, but are never checked
      if (e.closest('[hidden], template, noscript')) return false;
    }
    const s = css(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.contentVisibility === 'hidden') return false;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (opacityOf(e) < 0.15) return false;
    // Clipped to nothing (sr-only).
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const sa = css(a);
      if (sa.display === 'none' || sa.visibility === 'hidden') return false;
      if ((sa.overflow === 'hidden' || sa.overflow === 'clip') && (a.getBoundingClientRect().width < 2 || a.getBoundingClientRect().height < 2)) return false;
    }
    return true;
  }
  const decorative = e => Boolean(e.closest('[aria-hidden="true"]'));
  const directText = e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
  // A modal that covers the screen is the whole view (the page under it is
  // inert): check only inside it.
  const modal = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].find(m => {
    const r = m.getBoundingClientRect();
    return getComputedStyle(m).display !== 'none' && r.width >= W * 0.9 && r.height >= window.innerHeight * 0.9;
  });
  const scope = modal || root;
  const all = [...scope.querySelectorAll('*')].filter(e => !['SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'polygon', 'defs', 'use', 'SOURCE', 'TEMPLATE'].includes(e.tagName));
  const vis = all.filter(visible);
  const visSet = new Set(vis);

  // 3b. Cut placeholders / values: the text a field shows is wider than the
  // room it has (a "Search tasks, people, not" box).
  const ctx = document.createElement('canvas').getContext('2d');
  vis.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=date]):not([type=datetime-local]):not([type=time]):not([type=password]), textarea')).forEach(e => {
    const shown = e.value || e.getAttribute('placeholder') || '';
    if (!shown || e.matches('textarea')) return;
    const s = css(e);
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const room = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const width = ctx.measureText(shown).width;
    if (width > room + 1 && s.textOverflow !== 'ellipsis') issues.push(`clipped text: ${path2(e)} shows "${shown.slice(0, 40)}" in ${Math.round(room)}px (needs ${Math.round(width)}px)`);
  });

  // 4. Horizontal page scroll.
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > W + 1) {
    const culprits = vis.filter(e => e.getBoundingClientRect().right > W + 1 && !e.closest('[class*="scroll"], [style*="overflow"]'))
      .filter(e => ![...e.children].some(k => visSet.has(k) && k.getBoundingClientRect().right > W + 1)).slice(0, 3).map(path2);
    issues.push(`horizontal scroll: page is ${sw}px wide at ${W}px (${culprits.join(', ') || 'unknown'})`);
  }

  // Borders, including inset box-shadow rings used as borders.
  function boxed(e) {
    const s = css(e);
    const border = parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderBottomWidth) >= 1 && parseFloat(s.borderLeftWidth) >= 1 && s.borderTopStyle !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.borderTopColor);
    const ring = /inset/.test(s.boxShadow) && /0px 0px 0px [1-9]/.test(s.boxShadow);
    return border || ring;
  }

  // 1. Doubled borders: a bordered control inside a bordered wrapper of nearly its size.
  vis.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]), textarea, select, [role=combobox], [contenteditable=true]') && boxed(e)).forEach(i => {
    let a = i.parentElement;
    for (let d = 0; d < 3 && a && a !== document.body; d++, a = a.parentElement) {
      if (visSet.has(a) && boxed(a)) {
        const ri = i.getBoundingClientRect(); const ra = a.getBoundingClientRect();
        if (ra.height < ri.height + 24 && ra.width < ri.width + 60) { issues.push(`doubled border: ${path2(i)} inside ${name(a)}`); break; }
      }
    }
  });

  // 2. Empty bands: a visible card/section whose content is all hidden, or a
  // bordered band with nothing in it.
  const hasContent = e => {
    if (directText(e)) return true;
    return [...e.querySelectorAll('*')].some(k => visSet.has(k) && (directText(k) || k.matches('img, svg, canvas, video, input, select, textarea, button, iframe, picture, [role=img], hr, progress, meter') || (css(k).backgroundImage !== 'none' && k.getBoundingClientRect().height > 4)));
  };
  vis.filter(e => e.matches('section, article, aside, fieldset, details, li, [class*="card"], [class*="panel"], [class*="band"], [class*="section"], [class*="empty"]')
    && !e.matches('[class*="skeleton"], [aria-busy="true"], [class*="spacer"], [class*="divider"], [class*="backdrop"], [class*="overlay"]')
    && !e.closest('[aria-busy="true"]')).forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.height < 24) return;
    if (!hasContent(e) && css(e).backgroundImage === 'none') issues.push(`empty band: ${path2(e)} (${Math.round(r.width)}x${Math.round(r.height)})`);
  });

  // 2b. Empty message slots: a status / error / note line with nothing in
  // it that still takes room (a min-height kept "for later" leaves a gap).
  vis.filter(e => e.matches('p, [role=status], [role=alert], [aria-live], [class*="status"], [class*="error"], [class*="note"], [class*="help"], [class*="hint"]')
    && !e.matches('[class*="skeleton"], [class*="dot"], [class*="icon"], [class*="spinner"], input, textarea, select, button, img, svg, ul, ol')
    && !e.textContent.trim() && ![...e.querySelectorAll('*')].some(k => visSet.has(k))).forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.height >= 12) issues.push(`empty band: empty ${path2(e)} still takes ${Math.round(r.height)}px`);
  });

  // 3. Clipped text.
  vis.forEach(e => {
    const t = directText(e);
    if (!t || decorative(e)) return;
    const s = css(e);
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') return;
    if (s.textOverflow === 'ellipsis') return;
    if (e.matches('input, textarea, select, pre, code')) return;
    const clips = /hidden|clip|auto|scroll/.test(s.overflowX);
    if (clips && e.scrollWidth > e.clientWidth + 1 && !/auto|scroll/.test(s.overflowX)) issues.push(`clipped text: ${path2(e)} "${t.slice(0, 40)}" (${e.scrollWidth} > ${e.clientWidth})`);
    else if (clips && e.scrollHeight > e.clientHeight + 2 && /hidden|clip/.test(s.overflowY) && e.clientHeight > 0) issues.push(`clipped text: ${path2(e)} "${t.slice(0, 40)}" cut vertically (${e.scrollHeight} > ${e.clientHeight})`);
    // Text sticking out of a clipping ancestor or the viewport. Text inside
    // a scroller (a tab strip, a kanban board) is meant to scroll into view.
    let scroller = null;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (/auto|scroll/.test(css(a).overflowX)) { scroller = a; break; }
    }
    if (scroller) return;
    const range = document.createRange(); range.selectNodeContents(e);
    const tr = range.getBoundingClientRect();
    if (tr.width && (tr.right > W + 1 || tr.left < -1)) issues.push(`clipped text: ${path2(e)} "${t.slice(0, 40)}" runs off the screen`);
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const sa = css(a);
      if (/hidden|clip/.test(sa.overflowX) || /hidden|clip/.test(sa.overflowY)) {
        const ra = a.getBoundingClientRect();
        if (tr.width && (tr.right > ra.right + 2 || tr.bottom > ra.bottom + 2) && sa.textOverflow !== 'ellipsis' && !(sa.webkitLineClamp && sa.webkitLineClamp !== 'none') && !/auto|scroll/.test(sa.overflowX + sa.overflowY)) {
          issues.push(`clipped text: ${path2(e)} "${t.slice(0, 40)}" cut by ${name(a)}`);
        }
        break;
      }
    }
  });

  // 5. Misaligned siblings: cards in one row with different heights;
  // buttons in one row with different heights.
  const rows = new Map();
  vis.forEach(e => {
    const p = e.parentElement;
    if (!p || !visSet.has(p)) return;
    const ps = css(p);
    if (!/flex|grid/.test(ps.display)) return;
    if (/column/.test(ps.flexDirection) && /flex/.test(ps.display)) return;
    if (!rows.has(p)) rows.set(p, []);
    rows.get(p).push(e);
  });
  rows.forEach((kids, p) => {
    const isBtn = k => k.matches('button, .es-btn, a.es-btn, [role=button], input[type=submit]') && !k.matches('[class*="icon"], [class*="chip"], [role=tab], [role=option], [aria-haspopup]');
    const isCard = k => k.matches('[class*="card"], [class*="kpi"], [class*="tile"], article') && boxed(k);
    const byTop = new Map();
    kids.forEach(k => { const top = Math.round(k.getBoundingClientRect().top / 3); if (!byTop.has(top)) byTop.set(top, []); byTop.get(top).push(k); });
    byTop.forEach(row => {
      const cards = row.filter(isCard);
      if (cards.length >= 2) {
        const hs = cards.map(c => c.getBoundingClientRect().height);
        if (Math.max(...hs) - Math.min(...hs) > 2) issues.push(`misaligned: cards in ${name(p)} are ${hs.map(Math.round).join('/')}px tall`);
      }
      const btns = row.filter(isBtn);
      if (btns.length >= 2) {
        const hs = btns.map(c => c.getBoundingClientRect().height);
        if (Math.max(...hs) - Math.min(...hs) > 1.5) issues.push(`misaligned: buttons in ${name(p)} are ${hs.map(Math.round).join('/')}px tall`);
      }
    });
  });

  // 5b. Misaligned columns: rows of a list (siblings with the same class,
  // each laid out as a grid/flex row) whose matching cells start at
  // different x. Each row being its own grid makes this easy to break.
  const listParents = new Set(vis.map(e => e.parentElement).filter(p => p && visSet.has(p)));
  listParents.forEach(p => {
    const rowsOf = new Map();
    [...p.children].filter(k => visSet.has(k) && /grid|flex/.test(css(k).display) && typeof k.className === 'string' && k.className.trim()).forEach(k => {
      const key = k.className.trim().split(/\s+/)[0];
      if (!rowsOf.has(key)) rowsOf.set(key, []);
      rowsOf.get(key).push(k);
    });
    rowsOf.forEach((rowList, key) => {
      if (rowList.length < 2) return;
      const tops = rowList.map(r => r.getBoundingClientRect().top);
      if (new Set(tops.map(t => Math.round(t))).size < rowList.length) return; // not stacked rows
      const cellX = new Map();
      // Only classes that name one column: once per row.
      const repeated = new Set();
      rowList.forEach(r => {
        const seen = new Set();
        [...r.children].forEach(c => { const ck = typeof c.className === 'string' ? c.className.trim().split(/\s+/)[0] : ''; if (!ck) return; if (seen.has(ck)) repeated.add(ck); seen.add(ck); });
      });
      rowList.forEach(r => [...r.children].filter(c => visSet.has(c) && typeof c.className === 'string' && c.className.trim() && !repeated.has(c.className.trim().split(/\s+/)[0])).forEach(c => {
        const ck = c.className.trim().split(/\s+/)[0];
        if (!cellX.has(ck)) cellX.set(ck, []);
        const r = c.getBoundingClientRect();
        cellX.get(ck).push([Math.round(r.left), Math.round(r.right)]);
      }));
      // Aligned by their left edges or (right-aligned actions) their right edges.
      const spread = list => Math.max(...list) - Math.min(...list);
      cellX.forEach((xs, ck) => {
        if (xs.length >= 2 && spread(xs.map(x => x[0])) > 2 && spread(xs.map(x => x[1])) > 2) issues.push(`misaligned: .${ck} cells in .${key} rows start at ${[...new Set(xs.map(x => x[0]))].join('/')}px`);
      });
    });
  });

  // 6. Off-grid spacing (reported only).
  vis.forEach(e => {
    const s = css(e);
    const props = { gap: s.rowGap, 'column-gap': s.columnGap, 'padding-top': s.paddingTop, 'padding-right': s.paddingRight, 'padding-bottom': s.paddingBottom, 'padding-left': s.paddingLeft };
    Object.entries(props).forEach(([k, v]) => {
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 2) return;
      if ((k === 'gap' || k === 'column-gap') && !/flex|grid/.test(s.display)) return;
      if (Math.abs(n / 4 - Math.round(n / 4)) > 0.02) offGrid.add(`${name(e)} ${k}: ${v}`);
    });
  });

  // 7. Non-ES fonts and purple in UI chrome.
  const fontOk = /acumin|roboto/i;
  const seenFont = new Set();
  vis.forEach(e => {
    // Only elements that draw text (an icon-only button has no glyphs).
    if (!directText(e) && !(e.matches('input, textarea, select') && (e.value || e.placeholder))) return;
    const s = css(e);
    const first = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!fontOk.test(first) && !(e.closest('pre, code, kbd, samp') && /mono|menlo|courier|consolas/i.test(s.fontFamily))) {
      const key = `${name(e)}:${first}`;
      if (!seenFont.has(key)) { seenFont.add(key); issues.push(`font: ${path2(e)} uses "${first}"`); }
    }
  });
  const purple = c => {
    const m = String(c).match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!m) return false;
    const [r, g, b, a] = [m[1], m[2], m[3], m[4] ?? 1].map(Number);
    if (a < 0.2) return false;
    const mx = Math.max(r, g, b) / 255; const mn = Math.min(r, g, b) / 255; const l = (mx + mn) / 2; const d = mx - mn;
    if (d < 0.12) return false;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h; const R = r / 255, G = g / 255, B = b / 255;
    if (mx === R) h = 60 * (((G - B) / d) % 6); else if (mx === G) h = 60 * ((B - R) / d + 2); else h = 60 * ((R - G) / d + 4);
    if (h < 0) h += 360;
    return sat > 0.25 && h >= 255 && h <= 320 && l > 0.15 && l < 0.9;
  };
  const seenPurple = new Set();
  vis.forEach(e => {
    const s = css(e);
    [['color', s.color], ['background', s.backgroundColor], ['border', s.borderTopWidth !== '0px' ? s.borderTopColor : '']].forEach(([k, v]) => {
      if (v && purple(v)) { const key = `${name(e)}:${k}`; if (!seenPurple.has(key)) { seenPurple.add(key); issues.push(`purple: ${path2(e)} ${k} ${v}`); } }
    });
  });

  // 8. Unlabelled interactive elements; more than one primary button.
  const labelOf = e => {
    const by = e.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    if ((e.getAttribute('aria-label') || '').trim()) return 'aria';
    if (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent.trim()) return 'label';
    if (e.closest('label')?.textContent.trim()) return 'label';
    if ((e.getAttribute('title') || '').trim()) return 'title';
    if (e.matches('input, textarea') && (e.getAttribute('placeholder') || '').trim()) return 'placeholder';
    if (e.matches('input[type=submit], input[type=button]') && e.value) return 'value';
    if (e.textContent.trim()) return 'text';
    if ([...e.querySelectorAll('img[alt]')].some(i => i.alt.trim())) return 'alt';
    return '';
  };
  vis.filter(e => e.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [role=option], [tabindex]:not([tabindex="-1"])') && !decorative(e)).forEach(e => {
    if (e.matches('[tabindex]:not(a,button,input,select,textarea,[role])') && !e.matches('[role]')) {
      // A focusable region (scroll area, dialog) needs a name only with a role.
      return;
    }
    if (!labelOf(e)) issues.push(`unlabelled: ${path2(e)}`);
  });
  // Every class design-tokens.css paints as a primary button.
  const PRIMARY = '.es-btn--primary, .ais-btn, .frame-hero-cta.is-primary, .faq-cta-action.is-primary, .how-button--primary, .btn-primary, .primary-btn, .request-submit, .feedback-submit, .reels-btn.is-primary, .topbar-button.is-primary, .login-button, .auth-state-button.is-primary, .studio-export-btn, .mobile-editor-export, .va-btn--primary';
  const primaries = vis.filter(e => e.matches(PRIMARY) && !e.matches('.es-btn--static') && !decorative(e) && !e.closest('[role=menu], [role=listbox], [inert]'));
  // One primary per view. A floating layer (dialog, toast, popover: a fixed
  // ancestor) is its own view; the page is another. Only the first two
  // screenfuls count (what a person sees together).
  const layerOf = e => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.matches('[role=dialog], [role=alertdialog], dialog, [aria-modal=true]') || css(a).position === 'fixed') return a;
    }
    return document.body;
  };
  const layers = new Map();
  primaries.filter(e => e.getBoundingClientRect().top < window.innerHeight * 2).forEach(e => {
    const layer = layerOf(e);
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(e);
  });
  layers.forEach((list, layer) => {
    if (list.length > 1) issues.push(`primary buttons: ${list.length} visible in ${name(layer)} (${list.map(e => `${name(e)} "${e.textContent.trim().slice(0, 24)}"`).join(', ')})`);
  });

  // 8b. A focus ring drawn around a whole panel (script focus on a
  // tabindex="-1" container for screen readers).
  const active = document.activeElement;
  if (active && active !== document.body && visible(active)) {
    const r = active.getBoundingClientRect(); const s = css(active);
    if (r.width > 320 && r.height > 200 && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) issues.push(`focus ring: around the whole ${path2(active)} (${Math.round(r.width)}x${Math.round(r.height)})`);
  }

  // 10. Broken images.
  vis.filter(e => e.tagName === 'IMG').forEach(img => {
    if (img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src)) issues.push(`broken image: ${(img.currentSrc || img.src).replace(location.origin, '').slice(0, 100)}`);
  });

  // 11. Contrast.
  const parse = c => { const m = String(c).match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  function bgOf(e) {
    const layers = [];
    for (let a = e; a; a = a.parentElement) {
      const s = css(a);
      if (s.backgroundImage !== 'none' && !/^linear-gradient\(rgba\(0, 0, 0, 0\)/.test(s.backgroundImage)) return null; // image / gradient: unknown
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    if (!layers.length || layers[layers.length - 1][3] < 1) {
      const rootBg = parse(css(document.documentElement).backgroundColor);
      if (rootBg && rootBg[3] > 0) bg = rootBg; else if (document.documentElement.dataset.theme === 'dark') bg = [16, 17, 20, 1];
    }
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  }
  const seenContrast = new Set();
  vis.forEach(e => {
    const t = directText(e);
    if (!t || t.length < 2 || decorative(e) || e.closest('[disabled], [aria-disabled="true"], .is-disabled, [class*="skeleton"]')) return;
    if (e.matches('input, textarea, select, option')) return;
    const s = css(e);
    let fg = parse(s.color); if (!fg) return;
    const bg = bgOf(e); if (!bg) return;
    const op = opacityOf(e);
    fg = blend([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const L1 = lum(fg); const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize); const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need - 0.05) {
      const key = `${name(e)}:${s.color}`;
      if (!seenContrast.has(key)) { seenContrast.add(key); issues.push(`contrast: ${path2(e)} "${t.slice(0, 30)}" ${ratio.toFixed(2)}:1 (needs ${need})`); }
    }
  });

  return { issues: [...new Set(issues)], offGrid: [...offGrid] };
}
