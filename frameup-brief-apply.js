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
    if ((workspace === 'instagram' && option.template === 'cover') || (workspace === 'youtube' && /^variation-/.test(option.template))) call('renderPillPositionControls');
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
    // HTML widgets have no canvas picture.
    if (isHtml(ctx.workspace, option.template)) return null;
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
    if (activeWorkspace === 'youtube') return state.youtubeQuote ? 'quote' : activeYoutubeVariation;
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

  // ─── Newsletter ───────────────────────────────────────────────────────────
  // Canvas assets (feature images, section headers) take their text through
  // the same path as typing in the editor; infographic FIs fill their own
  // layer fields and main photo; HTML widgets fill their builder and form.
  const INFOGRAPHIC_PREFIX = 'ig-';
  const TEXT_ASSETS = { 'tag-fi': 'tag', 'archive-page-fi': 'tag', 'section-header': 'title', 'section-header-2': 'title' };
  const PHOTO_ASSETS = new Set(['tag-fi', 'archive-page-fi', 'youtube-fi']);
  const HTML_ASSETS = new Set(['list', 'list2', 'ticker', 'trivia']);
  // The editor's own layer ids for each infographic field.
  const INFOGRAPHIC_FIELDS = { 'ig-headline-photo': ['line1', 'line2'], 'ig-player-quote': ['line1', 'line2'] };

  // Waits for the editor without switching editors (FrameUpSpec.ready opens Social).
  async function editorReady() {
    if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    try { await document.fonts.ready; } catch (error) { /* fonts optional */ }
    // postFontLoaded is the editor's own (script-scope) flag.
    const fontReady = () => { try { return Boolean(postFontLoaded); } catch (error) { return true; } };
    for (let i = 0; i < 200 && !(fontReady() && document.getElementById('preview')); i += 1) await wait(50);
  }

  function setLines(lines) {
    const box = document.getElementById('pill-text');
    if (box) box.value = lines.join('\n');
    call('onTextChange');
    call('flushPendingTextChange');
  }

  function syncBuilderFields(prefix, getValue) {
    document.querySelectorAll(`[data-${prefix}-field]`).forEach(field => {
      const value = getValue(field.dataset[`${prefix.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}Field`]);
      if (value != null && field.type !== 'file') field.value = value;
    });
  }

  function fillWidget(option, ctx) {
    const f = option.fields || {};
    switch (option.template) {
      case 'list':
      case 'list2': {
        const builder = option.template === 'list' ? listBuilderState : list2BuilderState;
        if (!builder) return;
        builder.items.forEach((item, i) => { item.text = f.items?.[i]?.text || ''; item.link = f.items?.[i]?.url || ''; });
        const prefix = option.template === 'list' ? 'list' : 'list2';
        document.querySelectorAll(`[data-${prefix}-field]`).forEach(field => {
          const [, index, key] = field.dataset[`${prefix}Field`].split('.');
          field.value = builder.items[Number(index)]?.[key] ?? '';
        });
        break;
      }
      case 'ticker': {
        if (!tickerBuilderState) return;
        Object.assign(tickerBuilderState, { label: f.label, category: f.category, headline: f.headline, summary: f.summary, link: f.url || tickerBuilderState.link });
        if (ctx.photo?.sourceUrl) tickerBuilderState.imageUrl = ctx.photo.sourceUrl;
        document.querySelectorAll('[data-ticker-field]').forEach(field => { if (field.type !== 'file') field.value = tickerBuilderState[field.dataset.tickerField] ?? ''; });
        const direction = document.querySelector(`[data-ticker-direction="${f.direction === 'down' ? 'down' : 'up'}"]`);
        if (direction && !direction.classList.contains('is-active')) direction.click();
        tickerBuilderState.direction = f.direction === 'down' ? 'down' : 'up';
        call('updateTickerThumb');
        break;
      }
      case 'trivia': {
        if (!triviaBuilderState) return;
        triviaBuilderState.question = f.question;
        triviaBuilderState.options = [...f.options];
        if (ctx.photo?.sourceUrl) triviaBuilderState.imageUrl = ctx.photo.sourceUrl;
        try { triviaContentEdited = true; } catch (error) { /* older editor */ }
        document.querySelectorAll('[data-trivia-field]').forEach(field => { if (field.dataset.triviaField !== 'headerImage' && has('getTriviaFieldValue')) field.value = window.getTriviaFieldValue(field.dataset.triviaField) ?? ''; });
        call('updateTriviaThumb');
        break;
      }
      default: break;
    }
    call('renderWidgetPreview');
  }

  async function applyNewsletter(option, ctx) {
    await editorReady();
    if (activeWorkspace !== 'newsletter') activateWorkspace('newsletter');
    const asset = option.template;
    const select = document.getElementById('newsletter-asset-select');
    if (!select || ![...select.options].some(o => o.value === asset)) throw new Error('That newsletter template is not in this editor.');
    select.value = asset;
    switchNewsletterAsset(asset);
    const f = option.fields || {};
    if (TEXT_ASSETS[asset]) setLines([f[TEXT_ASSETS[asset]] || '']);
    if (PHOTO_ASSETS.has(asset)) await setPhoto(ctx.photo);
    if (asset.startsWith(INFOGRAPHIC_PREFIX)) {
      const template = typeof getInfographicTemplate === 'function' ? getInfographicTemplate(asset) : null;
      if (!template) throw new Error('That feature image is not in this editor.');
      (INFOGRAPHIC_FIELDS[asset] || []).forEach(id => setInfographicText(template, id, f[id] || ''));
      const slot = (typeof getInfographicMainPhotoLayer === 'function' ? getInfographicMainPhotoLayer(template) : null) || template.layers.find(layer => layer.type === 'photo');
      if (slot) {
        let img = null;
        if (ctx.photo?.url) { try { img = await loadImageFromUrl(ctx.photo.url); } catch (error) { img = null; } }
        const store = getInfographicStore(template);
        if (img) store.photos[slot.id] = { img, url: ctx.photo.url };
        else delete store.photos[slot.id];
        store.adjust[slot.id] = { zoom: 1, dx: 0, dy: 0 };
      }
      call('syncInfographicAfterHistory');
    }
    if (HTML_ASSETS.has(asset)) fillWidget(option, ctx);
    call('syncWorkspaceControls');
    call('syncAllCustomSelects');
  }
  APPLIERS.newsletter = applyNewsletter;

  currentText.more.newsletter = () => {
    const out = [];
    const push = value => { const text = clean(value); if (text) out.push(text); };
    const asset = activeNewsletterAsset;
    if (asset === 'list' || asset === 'list2') (asset === 'list' ? listBuilderState : list2BuilderState)?.items?.forEach(item => { push(item.text); push(item.link); });
    else if (asset === 'ticker') ['label', 'category', 'headline', 'summary', 'link'].forEach(key => push(tickerBuilderState?.[key]));
    else if (asset === 'trivia') { push(triviaBuilderState?.question); (triviaBuilderState?.options || []).forEach(push); }
    else if (asset.startsWith(INFOGRAPHIC_PREFIX)) {
      const template = getInfographicTemplate(asset);
      (INFOGRAPHIC_FIELDS[asset] || []).forEach(id => push(getInfographicValues(template)?.[id]));
    } else (state.lines || []).forEach(push);
    return out;
  };

  // The previous widget content, for "Restore" (Undo covers canvas designs,
  // not the HTML widget forms).
  function widgetSnapshot(template) {
    const source = { list: () => listBuilderState, list2: () => list2BuilderState, ticker: () => tickerBuilderState, trivia: () => triviaBuilderState }[template];
    const value = source?.();
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  // ─── YouTube ──────────────────────────────────────────────────────────────
  // The three layouts are variations of one thumbnail: photo + up to two pills;
  // 2 and 3 add the player cut-outs (from the ES cut-out store) in front.
  // Quote thumbnails switch the variation into Quote Mode.
  async function loadOrNull(url) {
    if (!url) return null;
    try { return await loadImageFromUrl(url); } catch (error) { return null; }
  }
  async function applyYoutube(option, ctx) {
    await editorReady();
    if (activeWorkspace !== 'youtube') activateWorkspace('youtube');
    const variation = option.template === 'quote' ? (activeYoutubeVariation || 'variation-1') : option.template;
    const select = document.getElementById('youtube-variation-select');
    if (select) select.value = variation;
    switchYoutubeVariation(variation);
    const wantQuote = option.template === 'quote';
    if (Boolean(state.youtubeQuote) !== wantQuote) call('toggleYoutubeQuoteMode');
    window.FrameUpSpec?.brand?.({ sport: option.sport || '', team: option.team || '', brief: String(ctx.brief || '').slice(0, 600), hints: { person: ctx.subject || '', sport: option.sport || '' } });
    const f = option.fields || {};
    setLines(wantQuote ? (f.lines || []) : (f.pills || []));
    await setPhoto(ctx.photo);
    if (variation === 'variation-2' || variation === 'variation-3') {
      const cutouts = Array.isArray(ctx.cutouts) ? ctx.cutouts : [];
      const [one, two] = await Promise.all([loadOrNull(cutouts[0]?.url), variation === 'variation-3' ? loadOrNull(cutouts[1]?.url) : null]);
      state.entityPhoto = one;
      state.entityPhotoName = one ? (cutouts[0].person || 'Player') : '';
      state.entityOffsetX = 0; state.entityOffsetY = 0; state.entityScale = 1;
      if (variation === 'variation-3') {
        state.entityPhoto2 = two;
        state.entityPhoto2Name = two ? (cutouts[1].person || 'Player') : '';
        state.entityOffsetX2 = 0; state.entityOffsetY2 = 0; state.entityScale2 = 1;
      }
      call('saveMediaContext');
      call('syncEntityPhotoControls');
      call('syncEntityPhotoControls2');
    }
    call('syncWorkspaceControls');
    call('syncAllCustomSelects');
  }
  APPLIERS.youtube = applyYoutube;
  LAYOUTS.youtube = {
    'variation-1': LAYOUTS.instagram.cover,
    'variation-2': LAYOUTS.instagram.cover,
    'variation-3': LAYOUTS.instagram.cover,
  };

  // Swap the photo on the design on screen, wherever its template keeps it.
  async function swapPhoto(workspace, option, photo) {
    if (workspace === 'newsletter' && String(option.template).startsWith(INFOGRAPHIC_PREFIX)) {
      const template = getInfographicTemplate(option.template);
      const slot = (typeof getInfographicMainPhotoLayer === 'function' ? getInfographicMainPhotoLayer(template) : null) || template?.layers.find(layer => layer.type === 'photo');
      if (!template || !slot) return;
      let img = null;
      try { img = await loadImageFromUrl(photo.url); } catch (error) { img = null; }
      if (img) getInfographicStore(template).photos[slot.id] = { img, url: photo.url };
      return;
    }
    if (workspace === 'newsletter' && HTML_ASSETS.has(option.template)) {
      fillWidget(option, { photo });
      return;
    }
    await setPhoto(photo);
  }
  const isHtml = (workspace, template) => workspace === 'newsletter' && HTML_ASSETS.has(template);

  window.FrameUpBriefApply = Object.freeze({
    APPLIERS, LAYOUTS, apply, applyNow, thumb, serial, setPhoto, setPalette, brandPalette, swapPhoto, isHtml, widgetSnapshot, editorReady,
    currentText, placeKey, currentTemplate, checks, repair, rechunk, has, call, wait, nextFrame,
  });
})();
