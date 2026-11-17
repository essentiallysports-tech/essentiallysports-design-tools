// FrameUp spec bridge, loaded last on index.html.
//
// A "spec" is a design planned by Generate: post type, sport/team, text lines
// and an optional photo. This file applies a spec through the editor's own
// functions (the same ones its controls call), so the template code and its
// output are untouched. Generate uses it to render previews in a hidden frame,
// and "Edit" uses it to open a spec in the real editor.
(() => {
  'use strict';

  const PENDING_KEY = 'frameup.openSpec.v1';
  const PENDING_SET_KEY = 'frameup.openSpecSet.v1';
  const SUPPORTED = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2', 'player-stat-line', 'team-record'];
  const PHOTO_TYPES = ['cover', 'quote', 'long-quote', 'stats-single-ent', 'player-stat-line', 'team-record'];
  const STAT_TEMPLATE_TYPES = ['player-stat-line', 'team-record'];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Animation frames pause in background tabs; the timer keeps work moving.
  const nextFrame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });

  let readyPromise = null;
  function whenReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
        await document.fonts.ready;
        for (let i = 0; i < 200 && !(postFontLoaded && document.getElementById('preview')); i += 1) await wait(50);
        if (activeWorkspace !== 'instagram') activateWorkspace('instagram');
        await nextFrame();
      })();
    }
    return readyPromise;
  }

  const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWords = (text, words) => new RegExp(`\\b${escapeRe(words)}s?\\b`, 'i').test(text);

  // Exact name first, then whole-word matches ("Kansas City Chiefs" -> "Chiefs").
  const findOption = (options, value) => {
    const wanted = String(value || '').trim().toLowerCase();
    if (!wanted) return '';
    return options.find(option => option.toLowerCase() === wanted)
      || options.find(option => hasWords(wanted, option.toLowerCase()) || hasWords(option.toLowerCase(), wanted))
      || '';
  };

  // Team from the text about the person. Each capitalised mention of a team's
  // nickname ("Chiefs", also inside "Kansas City Chiefs") counts once; mentions
  // near the person's name ("Clark and the Indiana Fever") count ten times
  // more than other teams in the same stories; opponents ("against the Sky")
  // don't count.
  const OPPONENT = /\b(?:against|vs\.?|versus|over|beat|beats|beating|defeat|defeats|defeated|faces?|facing|to)\s+(?:the\s+)?$/i;
  const NEAR = 60;
  function guessTeam(text, sports, person = '') {
    const personAt = [];
    if (person) {
      const re = new RegExp(`\\b${escapeRe(person)}\\b`, 'gi');
      let match;
      while ((match = re.exec(text))) personAt.push(match.index);
    }
    const nearPerson = index => !personAt.length || personAt.some(at => Math.abs(at - index) <= NEAR);
    const found = [];
    let best = null;
    sports.forEach(sport => getTeams(sport).forEach(team => {
      const full = team.trim();
      const nick = full.split(/\s+/).pop();
      if (nick.length < 3) return;
      let score = 0;
      const re = new RegExp(`\\b${escapeRe(nick)}s?\\b`, 'gi');
      let match;
      while ((match = re.exec(text))) {
        if (!/^[A-Z0-9]/.test(match[0])) continue;
        // "against the [New York] Knicks": look before the whole team name.
        const fullStart = text.slice(0, match.index + match[0].length).toLowerCase().endsWith(full.toLowerCase())
          ? match.index + match[0].length - full.length
          : match.index;
        const start = Math.min(match.index, Math.max(0, fullStart));
        // Also skip a city in front ("beat the Dallas Cowboys").
        const before = text.slice(Math.max(0, start - 48), start).replace(/(?:[A-Z][\w.'’-]*\s+){1,2}$/, '');
        if (OPPONENT.test(before)) continue;
        score += nearPerson(match.index) ? 10 : 1;
      }
      if (score > 0) found.push({ sport, team, score });
      if (score > (best?.score || 0)) best = { sport, team, score };
    }));
    return best ? { ...best, teams: found.length } : null;
  }

  // The AI's sport/team when it names a real one, else a guess from the ES
  // stories about the person. Unknown brands keep the current one.
  function resolveBrand(spec) {
    const sports = getSports();
    // A team the designer picked on the Generate card wins over every guess.
    if (spec.teamLocked) {
      const lockedSport = findOption(sports, spec.sport);
      const lockedTeam = lockedSport ? findOption(getTeams(lockedSport), spec.team) : '';
      if (lockedSport && lockedTeam) return { sport: lockedSport, team: lockedTeam };
    }
    // A single team named in the brief itself ("Dream duo", "after the Chiefs
    // win") wins over the AI, whose memory of rosters can be out of date.
    // Opponents ("against the Sky") never count.
    const briefSport = findOption(sports, spec.sport) || findOption(sports, spec.hints?.sport);
    const named = spec.brief ? guessTeam(spec.brief, briefSport ? [briefSport] : sports) : null;
    if (named && named.teams === 1) return { sport: named.sport, team: named.team };
    const sport = briefSport;
    const team = sport ? findOption(getTeams(sport), spec.team) : '';
    if (sport && team) return { sport, team };
    const text = [spec.team, spec.title, ...(spec.lines || []), spec.hints?.text].filter(Boolean).join(' ');
    const guess = guessTeam(text, sport ? [sport] : sports, spec.hints?.person);
    return guess ? { sport: guess.sport, team: guess.team } : { sport, team: '' };
  }

  // Every design gets a definite brand. Previews render one after another in
  // the same editor, so "keep the current brand" used to hand a card the
  // previous card's team colours. Now: a known team -> that team's colours;
  // anything less (no team, or only a league) -> the neutral ES brand, never
  // a team picked at random (a generic NFL post must not wear Bears colours).
  function neutralSport() {
    return getSports().find(sport => /^neutral$/i.test(sport)) || '';
  }

  function applyBrand(spec) {
    const resolved = resolveBrand(spec);
    const known = Boolean(resolved.sport && resolved.team);
    const sport = known ? resolved.sport : neutralSport();
    const team = known ? resolved.team : '';
    if (!sport) return;
    document.getElementById('sport-select').value = sport;
    onSportChange(sport); // resets team + palette to the sport's default
    if (team && team !== state.team) {
      document.getElementById('team-select').value = team;
      onTeamChange(team);
    }
    syncAllCustomSelects();
  }

  // A row's accent is its team's brand colour when the team is known.
  function teamAccent(teamName, sportHint) {
    if (!teamName) return '';
    const sports = getSports();
    const preferred = findOption(sports, sportHint);
    for (const sport of preferred ? [preferred, ...sports.filter(s => s !== preferred)] : sports) {
      const team = findOption(getTeams(sport), teamName);
      if (team) return getBrandEntry(sport, team)?.primary?.background || '';
    }
    return '';
  }

  // A row's team logo from the logo library (logo-library.js), or ''.
  function teamLogo(teamName, sportHint) {
    const library = window.FrameUpLogos;
    if (!teamName || !library) return null;
    const entry = library.findTeam(teamName, sportHint) || library.findTeam(teamName);
    return entry ? { src: library.srcFor(entry), name: entry.name } : null;
  }

  // Rankings Table / Ranked List: fill the template's own data model. A row
  // that names a team gets that team's library logo; other row images stay
  // empty (no placeholder logos); unused rows are hidden.
  function applyListicle(spec) {
    const data = spec.listicle || {};
    const table = spec.postType === 'listicle-type-1';
    const api = table ? ESListicle : ESListicleType2;
    const current = table ? getListicleData() : getListicleType2Data();
    const rows = Array.from({ length: api.ROW_COUNT }, (_, index) => {
      const row = data.rows?.[index];
      if (!row) return { ...current.rows[index], hidden: true };
      return {
        rank: row.rank,
        entity: row.entity,
        ...(table ? { metric1: row.metric1, metric2: row.metric2 } : { subtitle: row.subtitle || '' }),
        accent: teamAccent(row.team, spec.sport) || api.DEFAULT_ACCENTS[index],
        logoSrc: teamLogo(row.team, spec.sport)?.src || '',
        logoName: teamLogo(row.team, spec.sport)?.name || '',
        ...(table ? {} : { playerSrc: '', playerName: '' }),
        hidden: false,
      };
    });
    const next = api.normalizeListicleData({
      ...current,
      title: data.title,
      ...(table ? { entityHeader: data.entityHeader, metric1Header: data.metric1Header, metric2Header: data.metric2Header } : {}),
      rows,
    });
    if (table) {
      state.listicleData = next;
      buildListicleRowControls();
      syncListicleControls();
    } else {
      state.listicleType2Data = next;
      buildListicleType2RowControls();
      syncListicleType2Controls();
    }
  }

  // Player Stat Line / Team Record: the template's own data model
  // (social-stat-templates.js), built whole and normalised, never partial.
  // The logo follows the Sport + Team selects ('auto'), set by applyBrand.
  function applyStatTemplate(spec) {
    const f = spec.fields || {};
    if (spec.postType === 'player-stat-line') {
      const stats = (Array.isArray(f.stats) ? f.stats : []).slice(0, 7);
      state.playerStatLineData = ESStatTemplates.playerStatLine.normalizeData({
        firstName: f.firstName, lastName: f.lastName, opponent: f.opponent || '',
        statCount: Math.max(1, stats.length),
        stats: stats.map(stat => ({ value: stat.value, label: stat.label })),
        logo: { mode: 'auto' },
      });
    } else {
      state.teamRecordData = ESStatTemplates.teamRecord.normalizeData({ record: f.record, subline: f.subline || '', logo: { mode: 'auto' } });
    }
    if (typeof syncStatTemplateControls === 'function') syncStatTemplateControls(spec.postType);
  }

  function applyLines(spec) {
    const lines = spec.lines.map(line => String(line ?? ''));
    switch (spec.postType) {
      case 'player-stat-line':
      case 'team-record':
        applyStatTemplate(spec);
        break;
      case 'listicle-type-1':
      case 'listicle-type-2':
        applyListicle(spec);
        break;
      case 'stats-single-ent':
        state.lines = lines;
        syncStatsPostFieldsFromLines();
        syncStatsPostLinesFromFields(false);
        break;
      case 'stats-double-ent':
        state.lines = lines;
        syncStatsDoubleEntFieldsFromLines();
        syncStatsDoubleEntLinesFromFields(false);
        break;
      case 'double-entity-quote':
        state.lines = lines;
        syncDoubleEntityFieldsFromLines();
        syncDoubleEntityLinesFromFields(false);
        break;
      default: {
        // Same path as typing into the text box (pill layout included).
        document.getElementById('pill-text').value = lines.join('\n');
        onTextChange();
        // Random pill offsets can push long cover pills off the canvas; use a
        // gentle stagger instead (still adjustable with the pill sliders).
        if (spec.postType === 'cover') {
          state.randomOffsets = state.lines.map((_, index) => (index % 2 ? 32 : -32));
          state.textBlockX = null;
          renderPillPositionControls();
        }
      }
    }
  }

  // ── Team graphic: the photo slot is never blank ──────────────────────
  // A design with no usable ES photo gets its team's graphic instead: the
  // team's primary colour with its library logo, large and centred. Built
  // once per team and reused. Returns an <img> or null (no team, no logo
  // library, or a logo that will not load cross-origin).
  const graphicCache = new Map();
  function loadLogo(src) {
    return new Promise(resolve => {
      const img = new Image();
      if (window.FrameUpLogos?.needsCors?.(src)) img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }
  const shade = (hex, amount) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (!Number.isFinite(n)) return '#101114';
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * (1 - amount)))));
    return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  };
  async function teamGraphic(teamName, sport) {
    const library = window.FrameUpLogos;
    if (!teamName || !library) return null;
    const entry = library.findTeam(teamName, sport) || library.findTeam(teamName);
    if (!entry) return null;
    if (graphicCache.has(entry.id)) return graphicCache.get(entry.id);
    const work = (async () => {
      const logo = await loadLogo(library.srcFor(entry));
      if (!logo) return null;
      const W = 1080;
      const H = 1350;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const primary = /^#[0-9a-f]{6}$/i.test(entry.colors?.[0] || '') ? entry.colors[0] : '#1F2126';
      const base = ctx.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, shade(primary, -0.08));
      base.addColorStop(0.55, primary);
      base.addColorStop(1, shade(primary, 0.55));
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      // A soft light behind the badge, then the badge itself.
      const glow = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, W * 0.62);
      glow.addColorStop(0, 'rgba(255,255,255,0.22)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      const box = 600;
      const ratio = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
      const w = logo.naturalWidth * ratio;
      const h = logo.naturalHeight * ratio;
      ctx.drawImage(logo, (W - w) / 2, H * 0.4 - h / 2, w, h);
      try {
        const img = new Image();
        img.src = canvas.toDataURL('image/jpeg', 0.92);
        await img.decode();
        return img;
      } catch (error) {
        return null; // a tainted canvas: no graphic
      }
    })();
    graphicCache.set(entry.id, work);
    return work;
  }

  // What the last applied spec showed in its photo slot: 'photo' (an ES
  // photo), 'team-graphic', 'none' (no photo, no team graphic) or '' (a
  // template without a photo).
  let lastPhotoKind = '';
  async function applyPhoto(spec) {
    lastPhotoKind = '';
    if (!PHOTO_TYPES.includes(spec.postType)) return;
    let img = null;
    if (spec.photo?.url) {
      try {
        img = await loadImageFromUrl(spec.photo.url);
      } catch (error) {
        img = null;
      }
    }
    let graphic = false;
    if (!img && spec.photoFallback !== false) {
      img = await teamGraphic(state.team, state.sport).catch(() => null);
      graphic = Boolean(img);
    }
    lastPhotoKind = img ? (graphic ? 'team-graphic' : 'photo') : 'none';
    state.photo = img;
    state.photoName = img ? (graphic ? `${state.team} team graphic` : (spec.photo.title || 'ES image')) : '';
    state.photoOffsetX = 0;
    state.photoOffsetY = 0;
    state.photoScale = 1;
    saveMediaContext();
    syncPhotoControls();
  }

  // Specs are applied one at a time; each waits for the previous one.
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // The last design opened from Generate, so its export can be remembered as a
  // confirmed brief -> design example (Generate learns from what gets used).
  let lastApplied = null;
  const GENERATED_WINDOW_MS = 3 * 60 * 60 * 1000;
  function generatedFor() {
    if (!lastApplied?.brief || state.postType !== lastApplied.postType) return null;
    if (Date.now() - lastApplied.at > GENERATED_WINDOW_MS) return null;
    // The director's direction travels with the export, so Generate's corpus
    // (list_frameup_generate_corpus reads these keys) learns which angles ship.
    const { brief, postType, runId, specId, angle, hook, aiText, score } = lastApplied;
    return {
      brief, postType,
      ...(runId ? { runId } : {}), ...(specId ? { specId } : {}), ...(angle ? { angle } : {}), ...(hook ? { hook } : {}),
      ...(aiText?.length ? { aiText } : {}), ...(Number.isFinite(score) ? { score } : {}),
    };
  }

  async function applySpec(spec) {
    if (!spec || !SUPPORTED.includes(spec.postType) || !Array.isArray(spec.lines)) {
      throw new Error('This design type cannot be opened in the editor yet.');
    }
    const short = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    lastApplied = {
      brief: String(spec.brief || '').slice(0, 600),
      postType: spec.postType,
      at: Date.now(),
      runId: short(spec.runId, 64),
      specId: short(spec.id, 64),
      angle: short(spec.direction?.angle, 120),
      hook: short(spec.direction?.hook, 20),
      // What the AI wrote, so an unedited export can be told apart from an edited one.
      // (Listicles keep their copy in rows, which the corpus compares differently: none.)
      aiText: spec.listicle ? [] : spec.lines.slice(0, 6).map(line => short(line, 120)),
      score: Number(spec.review?.score),
    };
    await whenReady();
    const select = document.getElementById('instagram-post-type-select');
    if (select) select.value = spec.postType;
    switchInstagramPostType(spec.postType);
    applyBrand(spec);
    applyLines(spec);
    await applyPhoto(spec);
    saveTextContext();
    render();
    // Stat templates draw the team logo; wait for it (as export does) so the
    // preview never shows the "LOGO" placeholder.
    if (STAT_TEMPLATE_TYPES.includes(spec.postType) && typeof isStatTemplateLogoLoading === 'function') {
      for (let i = 0; i < 50 && isStatTemplateLogoLoading(); i += 1) await wait(80);
      render();
    }
    flushPendingRender();
    await nextFrame();
  }

  const apply = spec => serial(() => applySpec(spec));

  const renderToDataUrl = (spec, type = 'image/jpeg', quality = 0.88) => serial(async () => {
    await applySpec(spec);
    return document.getElementById('preview').toDataURL(type, quality);
  });

  // The preview plus what filled its photo slot (see lastPhotoKind).
  const renderWithInfo = (spec, type = 'image/jpeg', quality = 0.88) => serial(async () => {
    await applySpec(spec);
    return { dataUrl: document.getElementById('preview').toDataURL(type, quality), photo: lastPhotoKind };
  });

  // Full-size export through the normal export path (also logs the export).
  const exportSpec = spec => serial(async () => {
    await applySpec(spec);
    downloadImage();
  });

  // A set (a carousel): every design rendered by the same export path as a
  // single download (same size, type and quality, so each file's bytes match
  // its own download), named 01-..., 02-... in order, saved as one ZIP.
  // Returns { filename, count, files }.
  const exportSet = (specs, name = 'frameup-set') => serial(async () => {
    if (!window.FrameUpZip) throw new Error('The ZIP writer did not load. Reload and try again.');
    const list = (Array.isArray(specs) ? specs : []).filter(spec => spec && SUPPORTED.includes(spec.postType)).slice(0, 10);
    if (!list.length) throw new Error('Nothing to export.');
    const files = [];
    for (const [index, spec] of list.entries()) {
      await applySpec(spec);
      const { offscreen, filename, workspace, exportQuality } = renderExportImage();
      const blob = await new Promise((resolve, reject) => offscreen.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed.'))), workspace.exportType, exportQuality));
      const clean = filename.replace(/-slide-\d+/, '');
      files.push({ name: `${String(index + 1).padStart(2, '0')}-${clean}`, data: new Uint8Array(await blob.arrayBuffer()), date: new Date() });
    }
    const bytes = window.FrameUpZip.zip(files);
    const slug = String(name || 'frameup-set').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'frameup-set';
    const filename = `${slug}.zip`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { filename, count: files.length, files: files.map(file => file.name) };
  });

  // "Open as carousel" on Generate: several specs fill the empty carousel
  // slides in order (slides with work in them are never overwritten).
  function openPendingSet() {
    let specs = null;
    try {
      specs = JSON.parse(sessionStorage.getItem(PENDING_SET_KEY) || 'null');
      sessionStorage.removeItem(PENDING_SET_KEY);
    } catch (error) {
      specs = null;
    }
    if (!Array.isArray(specs) || !specs.length) return false;
    const restored = window.FrameUpAutosave?.restored || Promise.resolve(null);
    restored.catch(() => null).then(async () => {
      await whenReady();
      if (activeWorkspace !== 'instagram') activateWorkspace('instagram');
      const empty = instagramSlideStates.map((slide, index) => (slideHasContent(slide) ? -1 : index)).filter(index => index >= 0);
      const placed = specs.slice(0, empty.length);
      for (const [i, spec] of placed.entries()) {
        await serial(async () => {
          switchInstagramSlide(empty[i]);
          await applySpec(spec);
        });
      }
      if (placed.length) await serial(async () => { switchInstagramSlide(empty[0]); render(); });
      if (typeof updateCarouselContentDots === 'function') updateCarouselContentDots();
      const left = specs.length - placed.length;
      if (!placed.length) setStatus('Your carousel slides are full. Clear a slide, then open the set again from Generate.', 'err');
      else setStatus(left ? `Opened ${placed.length} slides from Generate. ${left} didn't fit: clear a slide for the rest.` : `Opened ${placed.length} slides from Generate. Edit any, then export.`, left ? 'err' : 'ok');
    }).catch(error => setStatus(error.message || 'The set could not be opened.', 'err'));
    return true;
  }

  // "Edit" on the Generate page stores the spec, then opens the editor.
  function openPending() {
    if (openPendingSet()) return;
    let spec = null;
    try {
      spec = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      sessionStorage.removeItem(PENDING_KEY);
    } catch (error) {
      spec = null;
    }
    if (!spec) return;
    const restored = window.FrameUpAutosave?.restored || Promise.resolve(null);
    restored
      .then(record => {
        if (!record) return;
        const empty = instagramSlideStates.findIndex(slide => !slideHasContent(slide));
        if (activeWorkspace !== 'instagram') activateWorkspace('instagram');
        if (empty > 0 && empty !== activeInstagramSlide) switchInstagramSlide(empty);
      })
      .catch(() => {})
      .then(() => apply(spec))
      .then(() => setStatus('Opened from Generate. Edit anything, then export.', 'ok'))
      .catch(error => setStatus(error.message || 'This design could not be opened.', 'err'));
  }

  // The brand kit's leagues and teams, for Generate's per-card team picker.
  const brandOptions = () => getSports().map(sport => ({ sport, teams: getTeams(sport) }));

  window.FrameUpSpec = Object.freeze({ PENDING_KEY, PENDING_SET_KEY, SUPPORTED, ready: whenReady, apply, renderToDataUrl, renderWithInfo, exportSpec, exportSet, generatedFor, brandOptions });
  openPending();
})();
