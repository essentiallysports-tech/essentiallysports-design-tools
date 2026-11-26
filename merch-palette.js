/* Merch Designs: the pill colour picker (merch5).
   window.MerchPalette renders the "Pill colours" controls in the Colours fold
   (Sport → Team selects, the team's pairs as swatches, ES colours, a custom
   colour with a #RRGGBB field and a contrast warning) and the same options in
   the per-pill popover. merch.js owns the design data; this file only draws
   the controls and reports picks.

   Colour helpers come from merch-print.js (kitSports, kitTeams, kitSwatches,
   paletteFromKit, pillInk, ES_SWATCHES, boxContrast, MIN_CONTRAST) when it has
   them; until then small fallbacks here use window.ES_BRAND_KIT and
   FrameUpRules.pillTextColor / contrastRatio, so the page works either way.

   API
     MerchPalette.helpers()            -> { kitSports, kitTeams, kitSwatches, paletteFromKit, pillInk, ES_SWATCHES, boxContrast, MIN_CONTRAST, colorName }
     MerchPalette.normHex(v)           -> '#RRGGBB' | ''
     MerchPalette.findTeam(name)       -> { sport, team, entry } | null   (ES_BRAND_KIT name match)
     MerchPalette.warnText(hex, garment, noun) -> '' | 'Low contrast on a Black tee. The pill may not stand out.'
     MerchPalette.picker(els, opts)    -> { render(model), focusFirst() }
       els:  { sport?, team?, swatches, es, custom?, hex?, warn? } (elements)
       opts: { onPick(pick), label? }  pick = { kind:'team'|'es'|'custom', hex, ink, sport?, team?, index?, entry? }
       model: { sport, team, current: { kind, hex, index? } | null, garment: '#RRGGBB', noun: 'tee' } */
(function (root) {
  'use strict';
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';
  const HEX = /^#[0-9a-f]{6}$/i;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function normHex(v) {
    let s = String(v || '').trim();
    if (!s) return '';
    if (s[0] !== '#') s = `#${s}`;
    if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${s.slice(1).split('').map(ch => ch + ch).join('')}`;
    return HEX.test(s) ? s.toUpperCase() : '';
  }
  // WCAG contrast; FrameUpRules' when loaded.
  function lum(hex) {
    const h = normHex(hex) || WHITE;
    return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(a, b) {
    const R = root.FrameUpRules;
    if (typeof R?.contrastRatio === 'function') { try { const r = R.contrastRatio(normHex(a) || WHITE, normHex(b) || WHITE); if (Number.isFinite(r)) return r; } catch { /* fall through */ } }
    const x = lum(a); const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const kit = () => (Array.isArray(root.ES_BRAND_KIT) ? root.ES_BRAND_KIT : []).filter(e => e && e.sport && (e.team || e.variation));
  const entryName = e => String(e?.team || e?.variation || '');

  // ── Fallbacks (used only when merch-print.js lacks the helper) ──
  const fb = {
    kitSports: () => [...new Set(kit().map(e => e.sport))],
    kitTeams(sport) {
      const list = kit().filter(e => e.sport === sport);
      const teams = list.filter(e => e.team).sort((x, y) => entryName(x).localeCompare(entryName(y)));
      const vars = list.filter(e => !e.team); // variations keep their order
      return [...teams, ...vars].map(entry => ({ name: entryName(entry), entry }));
    },
    pillInk(hex, others = []) {
      const bg = normHex(hex) || BLACK;
      const R = root.FrameUpRules;
      if (typeof R?.pillTextColor === 'function') {
        try { const ink = normHex(R.pillTextColor({ background: bg }, (others || []).map(o => (typeof o === 'string' ? { background: normHex(o) } : o)).filter(o => o && o.background))); if (ink) return ink; } catch { /* fall through */ }
      }
      return contrast(bg, WHITE) >= contrast(bg, BLACK) ? WHITE : BLACK;
    },
    kitSwatches(entry) {
      if (!entry) return [];
      const pairs = [entry.primary, ...(entry.palette || [])].filter(p => p && normHex(p.background));
      const seen = new Set();
      const out = [];
      pairs.forEach(p => {
        const bg = normHex(p.background);
        if (seen.has(bg)) return;
        seen.add(bg);
        const others = pairs.filter(o => normHex(o.background) !== bg);
        let ink = '';
        const R = root.FrameUpRules;
        if (typeof R?.pillTextColor === 'function') { try { ink = normHex(R.pillTextColor(p, others)); } catch { ink = ''; } }
        out.push({ bg, ink: ink || fb.pillInk(bg), label: colorName(bg), index: out.length });
      });
      return out;
    },
    paletteFromKit(entry, index = 0) {
      const sw = helpers().kitSwatches(entry);
      const first = sw[index] || sw[0];
      if (!first) return null;
      const a = first.bg;
      let b = (sw.find(s => s.bg !== a && contrast(s.bg, a) >= 1.6) || {}).bg;
      if (!b) b = contrast(a, WHITE) >= contrast(a, BLACK) ? WHITE : BLACK;
      return { a, b, ink: helpers().pillInk(b, [a]) };
    },
    ES_SWATCHES: [
      { bg: '#0A7DFA', ink: WHITE, label: 'ES Blue' },
      { bg: '#033162', ink: WHITE, label: 'Navy' },
      { bg: WHITE, ink: '#033162', label: 'White' },
      { bg: BLACK, ink: WHITE, label: 'Black' },
    ],
    boxContrast: (hex, garment) => contrast(hex, garment),
    MIN_CONTRAST: 1.7,
  };
  function colorName(hex) {
    const MP = root.MerchPrint;
    if (typeof MP?.colorName === 'function') { try { return MP.colorName(hex); } catch { /* fall through */ } }
    return normHex(hex) || 'Colour';
  }
  // Engine helper when present, else the fallback.
  function helpers() {
    const MP = root.MerchPrint || {};
    const fn = name => (typeof MP[name] === 'function' ? MP[name].bind(MP) : fb[name]);
    return {
      kitSports: fn('kitSports'),
      kitTeams: fn('kitTeams'),
      kitSwatches: fn('kitSwatches'),
      paletteFromKit: fn('paletteFromKit'),
      pillInk: fn('pillInk'),
      boxContrast: fn('boxContrast'),
      ES_SWATCHES: Array.isArray(MP.ES_SWATCHES) && MP.ES_SWATCHES.length ? MP.ES_SWATCHES : fb.ES_SWATCHES,
      MIN_CONTRAST: Number(MP.MIN_CONTRAST) > 0 ? Number(MP.MIN_CONTRAST) : fb.MIN_CONTRAST,
      colorName,
    };
  }
  function findTeam(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const entry = kit().find(e => entryName(e).toLowerCase() === n) || kit().find(e => e.team && String(e.team).toLowerCase().endsWith(` ${n}`));
    return entry ? { sport: entry.sport, team: entryName(entry), entry } : null;
  }
  function entryFor(sport, team) {
    if (!sport || !team) return null;
    const hit = helpers().kitTeams(sport).find(t => t.name === team);
    return hit ? hit.entry : null;
  }
  const isLight = hex => contrast(hex, WHITE) < 1.35;
  function warnText(hex, garment, noun = 'tee') {
    const h = normHex(hex);
    const g = normHex(garment);
    if (!h || !g) return '';
    const H = helpers();
    let r = 99;
    try { r = Number(H.boxContrast(h, g)); } catch { r = contrast(h, g); }
    if (!(r < H.MIN_CONTRAST)) return '';
    return `Low contrast on a ${colorName(g)} ${noun}. The pill may not stand out.`;
  }

  const swatchBtn = (s, on, attrs) => `<button class="mx-swatch mx-swatch--aa${isLight(s.bg) ? ' is-light' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="-1" style="--sw:${esc(s.bg)};--sw-ink:${esc(s.ink)};background:${esc(s.bg)};color:${esc(s.ink)}" ${attrs} aria-label="${esc(s.label || s.bg)}, text ${esc(colorName(s.ink))}" title="${esc(s.label || s.bg)}"><span aria-hidden="true">Aa</span></button>`;

  // Arrow keys move the pick inside one radiogroup (roving tabindex).
  function rove(group, pickBtn) {
    if (!group || group.dataset.mpRove) return;
    group.dataset.mpRove = '1';
    group.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d && !['Home', 'End'].includes(e.key)) return;
      const all = [...group.querySelectorAll('[role=radio]')];
      if (!all.length) return;
      e.preventDefault();
      const i = Math.max(0, all.indexOf(document.activeElement));
      const next = all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + d + all.length) % all.length];
      pickBtn(next);
      next.focus();
    });
  }
  function fixTabStops(group) {
    if (!group) return;
    const all = [...group.querySelectorAll('[role=radio]')];
    const on = all.find(b => b.getAttribute('aria-checked') === 'true') || all[0];
    all.forEach(b => { b.tabIndex = b === on ? 0 : -1; });
  }

  function picker(els = {}, opts = {}) {
    const H = () => helpers();
    let model = { sport: '', team: '', current: null, garment: WHITE, noun: 'tee' };
    let teams = [];
    let swatches = [];
    const emit = pick => { try { opts.onPick?.(pick); } catch (error) { console.warn('merch palette pick', error); } };

    function renderSelects() {
      if (els.sport) {
        const sports = H().kitSports();
        els.sport.innerHTML = `<option value="">Pick a sport</option>${sports.map(s => `<option value="${esc(s)}"${s === model.sport ? ' selected' : ''}>${esc(s)}</option>`).join('')}`;
        els.sport.value = model.sport || '';
      }
      teams = model.sport ? H().kitTeams(model.sport) : [];
      if (els.team) {
        els.team.innerHTML = `<option value="">${model.sport ? 'Pick a team' : 'Pick a sport first'}</option>${teams.map(t => `<option value="${esc(t.name)}"${t.name === model.team ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}`;
        els.team.value = teams.some(t => t.name === model.team) ? model.team : '';
        els.team.disabled = !model.sport;
      }
    }
    function renderSwatches() {
      if (!els.swatches) return;
      const entry = entryFor(model.sport, model.team);
      swatches = entry ? H().kitSwatches(entry) : [];
      const cur = model.current;
      els.swatches.setAttribute('role', 'radiogroup');
      if (!els.swatches.getAttribute('aria-label')) els.swatches.setAttribute('aria-label', `${model.team || 'Team'} colours`);
      els.swatches.innerHTML = swatches.length
        ? swatches.map((s, i) => swatchBtn(s, Boolean(cur && cur.kind === 'team' && cur.team === model.team && (cur.index === (s.index ?? i) || (cur.index == null && normHex(cur.hex) === s.bg))), `data-pal-team="${s.index ?? i}"`)).join('')
        : `<span class="mx-meta">${model.team ? 'No colours for this team.' : 'Pick a team to see its colours.'}</span>`;
      fixTabStops(els.swatches);
    }
    function renderEs() {
      if (!els.es) return;
      const cur = model.current;
      els.es.setAttribute('role', 'radiogroup');
      if (!els.es.getAttribute('aria-label')) els.es.setAttribute('aria-label', 'ES colours');
      els.es.innerHTML = H().ES_SWATCHES.map((s, i) => swatchBtn({ ...s, bg: normHex(s.bg), ink: normHex(s.ink) || H().pillInk(s.bg) }, Boolean(cur && cur.kind === 'es' && normHex(cur.hex) === normHex(s.bg)), `data-pal-es="${i}"`)).join('');
      fixTabStops(els.es);
    }
    function renderCustom() {
      const cur = model.current;
      const hex = cur && cur.kind === 'custom' ? normHex(cur.hex) : '';
      if (els.custom && hex) els.custom.value = hex.toLowerCase();
      if (els.hex && document.activeElement !== els.hex) { els.hex.value = hex; els.hex.removeAttribute('aria-invalid'); }
    }
    function renderWarn(hex) {
      if (!els.warn) return;
      const text = warnText(hex ?? model.current?.hex, model.garment, model.noun);
      els.warn.textContent = text;
      els.warn.hidden = !text;
    }
    function render(next = {}) {
      model = { ...model, ...next };
      if (model.sport && !H().kitSports().includes(model.sport)) model.sport = '';
      renderSelects();
      renderSwatches();
      renderEs();
      renderCustom();
      renderWarn();
    }

    function pickTeam(btn) {
      const i = Number(btn.dataset.palTeam);
      const s = swatches.find(x => (x.index ?? swatches.indexOf(x)) === i) || swatches[i];
      if (!s) return;
      model.current = { kind: 'team', hex: s.bg, index: i, team: model.team };
      emit({ kind: 'team', hex: s.bg, ink: s.ink, index: i, sport: model.sport, team: model.team, entry: entryFor(model.sport, model.team) });
      renderSwatches(); renderEs(); renderWarn(s.bg);
      els.swatches.querySelector(`[data-pal-team="${i}"]`)?.focus();
    }
    function pickEs(btn) {
      const s = H().ES_SWATCHES[Number(btn.dataset.palEs)];
      if (!s) return;
      const hex = normHex(s.bg);
      model.current = { kind: 'es', hex };
      emit({ kind: 'es', hex, ink: normHex(s.ink) || H().pillInk(hex), label: s.label });
      renderSwatches(); renderEs(); renderWarn(hex);
      els.es.querySelector(`[data-pal-es="${btn.dataset.palEs}"]`)?.focus();
    }
    function pickCustom(raw, from) {
      const hex = normHex(raw);
      if (!hex) {
        if (els.hex && from === 'hex') els.hex.setAttribute('aria-invalid', 'true');
        if (els.warn && from === 'hex' && String(raw || '').trim().length >= 4) { els.warn.textContent = 'Use a colour like #0A7DFA.'; els.warn.hidden = false; }
        return;
      }
      els.hex?.removeAttribute('aria-invalid');
      if (els.custom && from !== 'custom') els.custom.value = hex.toLowerCase();
      if (els.hex && from !== 'hex') els.hex.value = hex;
      model.current = { kind: 'custom', hex };
      emit({ kind: 'custom', hex, ink: H().pillInk(hex) });
      renderSwatches(); renderEs(); renderWarn(hex);
    }

    els.sport?.addEventListener('change', () => {
      model.sport = els.sport.value;
      const list = model.sport ? H().kitTeams(model.sport) : [];
      model.team = list[0]?.name || '';
      renderSelects(); renderSwatches();
      opts.onTeam?.({ sport: model.sport, team: model.team });
    });
    els.team?.addEventListener('change', () => {
      model.team = els.team.value;
      renderSwatches();
      opts.onTeam?.({ sport: model.sport, team: model.team });
    });
    els.swatches?.addEventListener('click', e => { const b = e.target.closest('[data-pal-team]'); if (b) pickTeam(b); });
    els.es?.addEventListener('click', e => { const b = e.target.closest('[data-pal-es]'); if (b) pickEs(b); });
    rove(els.swatches, pickTeam);
    rove(els.es, pickEs);
    els.custom?.addEventListener('input', () => pickCustom(els.custom.value, 'custom'));
    els.hex?.addEventListener('change', () => pickCustom(els.hex.value, 'hex'));
    els.hex?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pickCustom(els.hex.value, 'hex'); } });
    els.hex?.addEventListener('input', () => { if (normHex(els.hex.value) && els.hex.value.replace('#', '').length === 6) pickCustom(els.hex.value, 'hex'); });

    return {
      render,
      get model() { return model; },
      focusFirst() {
        const t = els.swatches?.querySelector('[role=radio][tabindex="0"]') || els.es?.querySelector('[role=radio][tabindex="0"]') || els.hex || els.custom;
        t?.focus();
      },
    };
  }

  root.MerchPalette = { helpers, normHex, findTeam, entryFor, warnText, contrast, isLight, picker, VERSION: '2026-11-26-merch5' };
}(typeof self !== 'undefined' ? self : this));
