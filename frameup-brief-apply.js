// Design from a brief: put an option into the editor (frameup-brief.js loads
// this file into the editor page and into its hidden renderer frame).
//
// An option is { template, fields, lines, listicle, layout, sport, team }
// from /api/brief-design. Generate's ten Social templates go through the
// spec bridge (frameup-spec.js FrameUpSpec.apply: post type -> brand -> text
// -> photo -> render), so they open exactly as Generate's designs do. The
// Timeline and the two X post templates are filled here with the editor's own
// data models and sync functions. Newsletter and YouTube register appliers in
// APPLIERS. Every apply ends with the layout and colour option, then one render.
//
// It reads and writes the editor's globals (state, activeWorkspace, render…)
// the same way frameup-spec.js does; nothing here changes template code.
(() => {
  'use strict';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextFrame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  // Editor helpers are top-level function declarations, so they live on window.
  const has = name => typeof window[name] === 'function';
  const call = (name, ...args) => { try { if (has(name)) return window[name](...args); } catch (error) { /* optional editor helper */ } return undefined; };

  // ─── Photos ───────────────────────────────────────────────────────────────
  async function setPhoto(photo) {
    let img = null;
    if (photo?.url) {
      try { img = await loadImageFromUrl(photo.url); } catch (error) { img = null; }
    }
    state.photo = img;
    state.photoName = img ? (photo.title || 'Photo') : '';
    state.photoOffsetX = 0;
    state.photoOffsetY = 0;
    state.photoScale = 1;
    call('saveMediaContext');
    call('syncPhotoControls');
    return img ? 'photo' : 'none';
  }

  // ─── Social ───────────────────────────────────────────────────────────────
  const tweetCard = tweet => ({
    url: tweet.url || '',
    authorName: tweet.authorName || 'X User',
    handle: String(tweet.handle || '').replace(/^@/, ''),
    text: tweet.text || '',
    dateLabel: tweet.dateLabel || '',
    // Never the template's sample numbers on a real post.
    metrics: tweet.metrics || '',
    avatarDataUrl: tweet.avatarDataUrl || '',
    avatarUrl: tweet.avatarUrl || '',
    verified: Boolean(tweet.verified),
  });

  function fillOwnSocial(option, ctx) {
    const f = option.fields || {};
    switch (option.template) {
      case 'asap-template-1':
        state.asapTemplate1Data = ESAsapTemplate1.normalizeData({ title: f.title, rows: (f.rows || []).map(text => ({ text })) });
        call('syncAsapTemplate1Controls');
        break;
      case 'twitter-quote': {
        const tweet = (ctx.tweets || [])[0] || {};
        state.tweetQuote = { ...createTweetQuoteDefaults(), ...tweetCard(tweet), headline: f.headline || '' };
        call('syncTweetQuoteFields');
        break;
      }
      case 'twitter-multi': {
        const list = (ctx.tweets || []).slice(0, 3).map(tweetCard);
        state.multiTweets = [0, 1, 2].map(i => list[i] || null);
        state.multiTweetHeadline = f.headline || '';
        call('syncMultiTweetFields');
        break;
      }
      default: break;
    }
  }

  const PHOTO_OWN = new Set(['asap-template-1', 'twitter-quote']);

  async function applySocial(option, ctx) {
    const api = window.FrameUpSpec;
    if (!api) throw new Error('The editor is still loading. Try again in a moment.');
    const spec = {
      postType: option.template,
      lines: Array.isArray(option.lines) ? option.lines : [],
      fields: option.fields || {},
      listicle: option.listicle || null,
      sport: option.sport || '',
      team: option.team || '',
      teamLocked: Boolean(ctx.teamLocked),
      brief: String(ctx.brief || '').slice(0, 600),
      hints: { person: ctx.subject || '', sport: option.sport || '', text: ctx.factsText || '' },
      photo: ctx.photo || null,
      photoFallback: true,
    };
    if (api.SUPPORTED.includes(option.template)) {
      await api.apply(spec);
      return;
    }
    await api.ready();
    if (activeWorkspace !== 'instagram') activateWorkspace('instagram');
    const select = document.getElementById('instagram-post-type-select');
    if (select) select.value = option.template;
    switchInstagramPostType(option.template);
    api.brand?.(spec);
    fillOwnSocial(option, ctx);
    if (PHOTO_OWN.has(option.template)) await setPhoto(ctx.photo);
    call('saveTextContext');
  }

  // ─── Layout and colour options ───────────────────────────────────────────
  const LAYOUTS = {
    instagram: {
      cover: {
        stagger: () => { state.randomOffsets = (state.lines || []).map((_, i) => (i % 2 ? 32 : -32)); state.textBlockX = null; },
        aligned: () => { state.randomOffsets = (state.lines || []).map(() => 0); state.textBlockX = null; },
      },
      quote: {
        'logo-bottom': () => { state.quoteLogoPlacement = 'bottom'; },
        'logo-top': () => { state.quoteLogoPlacement = 'top-right'; },
      },
    },
  };

  function brandPalette() {
    const entry = typeof getBrandEntry === 'function' ? getBrandEntry(state.sport, state.team) : null;
    const palette = entry && typeof getPaletteForWorkspace === 'function' ? getPaletteForWorkspace(entry) : [];
    return { entry, palette };
  }

  function setPalette(index) {
    const { entry, palette } = brandPalette();
    if (!entry || !palette.length) return false;
    const i = Math.max(0, Math.min(palette.length - 1, Number(index) || 0));
    state.pillPaletteIdx = i;
    state.pillPalette = palette[i];
    call('renderPaletteRow', entry);
    return true;
  }

  function applyVariant(workspace, option, ctx) {
    const fx = LAYOUTS[workspace]?.[option.template]?.[option.layout];
    if (fx) fx();
    if (workspace === 'instagram' && option.template === 'cover') call('renderPillPositionControls');
    if (workspace === 'instagram' && option.template === 'quote') {
      const select = document.getElementById('quote-logo-placement');
      if (select) select.value = state.quoteLogoPlacement || 'bottom';
    }
    if (Number.isInteger(ctx.palette)) setPalette(ctx.palette);
    call('syncAllCustomSelects');
  }

  // ─── Apply ────────────────────────────────────────────────────────────────
  // Newsletter / YouTube add theirs: APPLIERS[workspace] = async (option, ctx) => {}.
  const APPLIERS = { instagram: applySocial };
  let queue = Promise.resolve();
  const serial = task => { const run = queue.then(task, task); queue = run.catch(() => {}); return run; };

  async function applyNow(option, ctx = {}) {
    const workspace = ctx.workspace || 'instagram';
    const applier = APPLIERS[workspace];
    if (!applier) throw new Error('Design from a brief is not available in this editor yet.');
    await applier(option, ctx);
    applyVariant(workspace, option, ctx);
    call('saveTextContext');
    render();
    call('flushPendingRender');
    await nextFrame();
  }
  const apply = (option, ctx) => serial(() => applyNow(option, ctx));

  // A small picture of an option (the renderer frame calls this).
  const thumb = (option, ctx = {}, width = 360) => serial(async () => {
    await applyNow(option, ctx);
    // Logos and photos can land a moment later: give them a beat.
    await wait(60);
    render();
    call('flushPendingRender');
    const canvas = document.getElementById('preview');
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round(width * canvas.height / canvas.width);
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return { dataUrl: out.toDataURL('image/jpeg', 0.82), width: out.width, height: out.height };
  });

  // ─── What the design says now (kept or changed at export) ────────────────
  function currentText() {
    const out = [];
    const push = value => { const text = clean(value); if (text) out.push(text); };
    if (activeWorkspace === 'instagram') {
      switch (state.postType) {
        case 'player-stat-line': {
          const d = state.playerStatLineData || {};
          [d.firstName, d.lastName, d.opponent].forEach(push);
          (d.stats || []).slice(0, d.statCount || 7).forEach(stat => push(`${stat.value} ${stat.label}`));
          return out;
        }
        case 'team-record': push(state.teamRecordData?.record); push(state.teamRecordData?.subline); return out;
        case 'listicle-type-1':
        case 'listicle-type-2': {
          const d = state.postType === 'listicle-type-1' ? state.listicleData : state.listicleType2Data;
          push(d?.title);
          (d?.rows || []).filter(row => !row.hidden).forEach(row => [row.entity, row.metric1, row.metric2, row.subtitle].forEach(push));
          return out;
        }
        case 'asap-template-1': push(state.asapTemplate1Data?.title); (state.asapTemplate1Data?.rows || []).forEach(row => push(row.text)); return out;
        case 'twitter-quote': push(state.tweetQuote?.headline); push(state.tweetQuote?.url); return out;
        case 'twitter-multi': push(state.multiTweetHeadline); (state.multiTweets || []).forEach(t => push(t?.url)); return out;
        default: (state.lines || []).forEach(push); return out;
      }
    }
    if (typeof currentText.more?.[activeWorkspace] === 'function') return currentText.more[activeWorkspace]();
    (state.lines || []).forEach(push);
    return out;
  }
  currentText.more = {};

  // Where the design sits (a Social slide, a YouTube variation, a Newsletter asset).
  function placeKey() {
    if (activeWorkspace === 'instagram') return `instagram:${activeInstagramSlide}`;
    if (activeWorkspace === 'youtube') return `youtube:${activeYoutubeVariation}`;
    if (activeWorkspace === 'newsletter') return `newsletter:${activeNewsletterAsset}`;
    return activeWorkspace;
  }
  function currentTemplate() {
    if (activeWorkspace === 'instagram') return state.postType || 'cover';
    if (activeWorkspace === 'newsletter') return activeNewsletterAsset;
    if (activeWorkspace === 'youtube') return activeYoutubeVariation;
    return '';
  }

  // ─── Checks after apply ───────────────────────────────────────────────────
  // ES brand nudges (font, banned copy, Cover text fit: frameup-editor-assist),
  // pill contrast (the brand pair's text on its pill, 3:1 for large type) and
  // the text block inside the safe area. -> [{ rule, text, fix? }]
  const PILL_TEMPLATES = new Set(['cover', 'stats-single-ent']);
  function pillContrast() {
    const pair = state.pillPalette;
    const { entry } = brandPalette();
    if (!pair?.background || typeof getTextColorForPair !== 'function' || typeof contrastRatio !== 'function') return null;
    return contrastRatio(pair.background, getTextColorForPair(pair, entry));
  }
  function checks(workspace, option) {
    const issues = [];
    if (workspace === 'instagram') {
      const brand = window.FrameUpEditorAssist?.exportIssues?.({ workspace: activeWorkspace, state }) || [];
      brand.filter(issue => issue.rule === 'text-fit' || issue.rule === 'banned-words')
        .forEach(issue => issues.push({ rule: issue.rule, text: issue.text.replace(/^Brand check:\s*/, ''), fix: issue.rule === 'text-fit' && option.template === 'cover' ? 'rechunk' : '' }));
      if (PILL_TEMPLATES.has(option.template)) {
        const ratio = pillContrast();
        if (ratio != null && ratio < 3) issues.push({ rule: 'contrast', text: `The pill text is hard to read on this colour (${ratio.toFixed(1)}:1).`, fix: 'palette' });
      }
      const box = state.lastTextBounds;
      const W = typeof getWorkspace === 'function' ? getWorkspace().width : 1080;
      const H = typeof getWorkspace === 'function' ? getWorkspace().height : 1350;
      const safe = typeof POST_SAFE_AREA === 'number' ? POST_SAFE_AREA : 50;
      if (option.template === 'cover' && box && box.w > 0 && box.w <= W * 1.2) {
        if (box.x < safe - 2 || box.x + box.w > W - safe + 2 || box.y < 0 || box.y + box.h > H) {
          issues.push({ rule: 'safe-zone', text: 'The text runs into the edge of the post.', fix: 'aligned' });
        }
      }
    }
    if (typeof checks.more?.[workspace] === 'function') issues.push(...checks.more[workspace](option));
    return issues;
  }
  checks.more = {};

  // One automatic repair, then the leftovers become notes.
  //   rechunk: Cover pills re-split into shorter lines (same words, up to 4).
  //   palette: the brand pair whose text reads best on its pill.
  //   aligned: the pills lined up (no stagger), so none runs off the edge.
  function rechunk(lines, max = 14) {
    const words = lines.join(' ').split(/\s+/).filter(Boolean);
    const out = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= max || !line) line = next;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.length <= 4 ? out : null;
  }
  async function repair(workspace, option, issues, ctx) {
    const fixed = [];
    let next = option;
    for (const issue of issues) {
      if (issue.fix === 'rechunk') {
        const lines = rechunk(option.lines || []);
        if (lines && lines.join('|') !== (option.lines || []).join('|')) {
          next = { ...next, lines, fields: { ...next.fields, pills: lines } };
          fixed.push(issue.rule);
        }
      } else if (issue.fix === 'palette') {
        const { palette, entry } = brandPalette();
        if (palette.length > 1 && typeof contrastRatio === 'function') {
          let best = state.pillPaletteIdx || 0;
          let bestRatio = pillContrast() || 0;
          palette.forEach((pair, i) => {
            const ratio = contrastRatio(pair.background, getTextColorForPair(pair, entry));
            if (ratio > bestRatio + 0.2) { best = i; bestRatio = ratio; }
          });
          if (best !== state.pillPaletteIdx) { ctx = { ...ctx, palette: best }; fixed.push(issue.rule); }
        }
      } else if (issue.fix === 'aligned' && next.layout !== 'aligned') {
        next = { ...next, layout: 'aligned' };
        fixed.push(issue.rule);
      }
    }
    if (!fixed.length) return { option, ctx, fixed, left: issues };
    await applyNow(next, ctx);
    const left = checks(workspace, next);
    return { option: next, ctx, fixed, left };
  }

  window.FrameUpBriefApply = Object.freeze({
    APPLIERS, LAYOUTS, apply, applyNow, thumb, serial, setPhoto, setPalette, brandPalette,
    currentText, placeKey, currentTemplate, checks, repair, rechunk, has, call, wait, nextFrame,
  });
})();
