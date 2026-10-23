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
  const SUPPORTED = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2'];
  const PHOTO_TYPES = ['cover', 'quote', 'long-quote', 'stats-single-ent'];
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

  // Unknown sports/teams keep the current brand rather than failing.
  function applyBrand(spec) {
    const { sport, team } = resolveBrand(spec);
    if (!sport) return;
    if (sport !== state.sport) {
      document.getElementById('sport-select').value = sport;
      onSportChange(sport);
    }
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

  // Rankings Table / Ranked List: fill the template's own data model. Row
  // images stay empty (no placeholder logos); unused rows are hidden.
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
        logoSrc: '',
        logoName: '',
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

  function applyLines(spec) {
    const lines = spec.lines.map(line => String(line ?? ''));
    switch (spec.postType) {
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

  async function applyPhoto(spec) {
    if (!PHOTO_TYPES.includes(spec.postType)) return;
    let img = null;
    if (spec.photo?.url) {
      try {
        img = await loadImageFromUrl(spec.photo.url);
      } catch (error) {
        img = null;
      }
    }
    state.photo = img;
    state.photoName = img ? (spec.photo.title || 'ES image') : '';
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
    return { brief: lastApplied.brief, postType: lastApplied.postType };
  }

  async function applySpec(spec) {
    if (!spec || !SUPPORTED.includes(spec.postType) || !Array.isArray(spec.lines)) {
      throw new Error('This design type cannot be opened in the editor yet.');
    }
    lastApplied = { brief: String(spec.brief || '').slice(0, 600), postType: spec.postType, at: Date.now() };
    await whenReady();
    const select = document.getElementById('instagram-post-type-select');
    if (select) select.value = spec.postType;
    switchInstagramPostType(spec.postType);
    applyBrand(spec);
    applyLines(spec);
    await applyPhoto(spec);
    saveTextContext();
    render();
    flushPendingRender();
    await nextFrame();
  }

  const apply = spec => serial(() => applySpec(spec));

  const renderToDataUrl = (spec, type = 'image/jpeg', quality = 0.88) => serial(async () => {
    await applySpec(spec);
    return document.getElementById('preview').toDataURL(type, quality);
  });

  // Full-size export through the normal export path (also logs the export).
  const exportSpec = spec => serial(async () => {
    await applySpec(spec);
    downloadImage();
  });

  // "Edit" on the Generate page stores the spec, then opens the editor.
  function openPending() {
    let spec = null;
    try {
      spec = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      sessionStorage.removeItem(PENDING_KEY);
    } catch (error) {
      spec = null;
    }
    if (!spec) return;
    apply(spec)
      .then(() => setStatus('Opened from Generate. Edit anything, then export.', 'ok'))
      .catch(error => setStatus(error.message || 'This design could not be opened.', 'err'));
  }

  window.FrameUpSpec = Object.freeze({ PENDING_KEY, SUPPORTED, ready: whenReady, apply, renderToDataUrl, exportSpec, generatedFor });
  openPending();
})();
