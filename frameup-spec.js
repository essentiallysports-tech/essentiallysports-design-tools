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
  const SUPPORTED = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent'];
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

  // Team from the text about the person: full names count most, capitalised
  // nicknames ("Chiefs") count once, opponents ("against the Sky") don't count,
  // and mentions near the person's name ("Clark and the Indiana Fever") count
  // far more than other teams in the same stories.
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
    let best = null;
    sports.forEach(sport => getTeams(sport).forEach(team => {
      const full = team.trim();
      const nick = full.split(/\s+/).pop();
      if (nick.length < 3) return;
      let score = 0;
      const count = (words, weight) => {
        const re = new RegExp(`\\b${escapeRe(words)}s?\\b`, 'gi');
        let match;
        while ((match = re.exec(text))) {
          if (!/^[A-Z]/.test(match[0])) continue;
          if (OPPONENT.test(text.slice(Math.max(0, match.index - 24), match.index))) continue;
          score += nearPerson(match.index) ? weight * 4 : weight;
        }
      };
      if (full.includes(' ')) count(full, 3);
      count(nick, 1);
      if (score > (best?.score || 0)) best = { sport, team, score };
    }));
    return best;
  }

  // The AI's sport/team when it names a real one, else a guess from the ES
  // stories about the person. Unknown brands keep the current one.
  function resolveBrand(spec) {
    const sports = getSports();
    const sport = findOption(sports, spec.sport) || findOption(sports, spec.hints?.sport);
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

  function applyLines(spec) {
    const lines = spec.lines.map(line => String(line ?? ''));
    switch (spec.postType) {
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

  async function applySpec(spec) {
    if (!spec || !SUPPORTED.includes(spec.postType) || !Array.isArray(spec.lines)) {
      throw new Error('This design type cannot be opened in the editor yet.');
    }
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

  window.FrameUpSpec = Object.freeze({ PENDING_KEY, SUPPORTED, ready: whenReady, apply, renderToDataUrl, exportSpec });
  openPending();
})();
