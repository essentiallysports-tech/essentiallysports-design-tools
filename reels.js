(function () {
  'use strict';

  var STAGE_W = 1080;
  var STAGE_H = 1920;
  var MAX_INLINE_UPLOAD_BYTES = 3 * 1024 * 1024;
  var TRANSCRIBE_SAMPLE_RATE = 16000;
  var TRANSCRIBE_CHUNK_SECONDS = 25;
  var CAPTION_MAX_WORDS = 5;
  var CAPTION_MIN_SECONDS = 0.7;
  var ES_BLUE = '#0a7dfa';
  var POST_FONT_FAMILY = 'Acumin Post';
  var PILL_H = 122;
  var PILL_FONT_SIZE = 130;
  var PILL_PAD_LEFT = 18.40;
  var PILL_PAD_RIGHT = 21.88;
  var POST_SAFE_AREA = 50;
  var PILL_EDGE_TO_TEXT_GAP = 1;
  var PILL_ROW_GAP = 1;
  var LIVE_API_ORIGIN = 'https://essentiallysports-design-tools.vercel.app';

  // Only one style for now, by design -- a single centered word at a time.
  // Position (top/middle/bottom) is a separate, independent control below.
  var CAPTION_STYLES = [
    { id: 'single-word', name: 'Single Word', note: 'One word at a time, centered', background: ES_BLUE, foreground: '#ffffff', mode: 'single-word', animation: 'single-word' },
  ];

  var LOWER_THIRD_TEMPLATES = [
    { id: 'name-title', name: 'Name Title', primary: 'PLAYER NAME', secondary: 'TEAM / ROLE' },
    { id: 'quote-source', name: 'Quote Source', primary: 'QUOTE CONTEXT', secondary: 'ESSENTIALLYSPORTS' },
    { id: 'score-bug', name: 'Score Bug', primary: 'TEAM 00 - 00 TEAM', secondary: 'FINAL' },
    { id: 'topic-tag', name: 'Topic Tag', primary: 'BREAKING', secondary: 'NFL' },
  ];

  var state = {
    videoLoaded: false,
    videoFile: null,
    captions: [],
    lowerThirds: [],
    selectedCaptionId: null,
    nextId: 1,
    style: CAPTION_STYLES[0],
    captionPosition: 'lower',
    sport: '',
    team: '',
    pillPalette: null,
    pillPaletteIdx: 0,
    transcriptSource: '',
    recording: false,
    renderedOnce: false,
    localWhisperWorker: null,
    localWhisperWorkerJobId: 0,
    localWhisperWorkerJobs: null,
    seekPending: false,
    timeline: {
      zoom: 1,
      minZoom: 1,
      maxZoom: 24,
      pps: 0,
      fitPps: 0,
      viewportW: 0,
      nodes: null,
      drag: null,
      followPlayhead: true,
      lastActiveId: null,
      lastTickStep: null,
      lastContentW: null,
      zoomInitialized: false,
    },
  };

  var MIN_SEG_PX = 22;
  var SNAP_PX = 7;
  var TICK_STEP_LADDER = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

  var els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    mapElements();
    els.canvas.width = STAGE_W;
    els.canvas.height = STAGE_H;
    state.ctx = els.canvas.getContext('2d');

    els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
    document.querySelectorAll('[data-reels-upload-trigger]').forEach(function (button) {
      button.addEventListener('click', function () { els.fileInput.click(); });
    });
    els.fileInput.addEventListener('change', onFileChosen);
    els.video.addEventListener('loadedmetadata', onVideoMetadata);
    els.video.addEventListener('seeked', onFirstFrameReady);
    els.video.addEventListener('seeked', function () { state.seekPending = false; });
    els.video.addEventListener('timeupdate', syncPlayback);
    els.video.addEventListener('play', startRenderLoop);
    els.video.addEventListener('pause', stopRenderLoop);
    els.video.addEventListener('ended', stopRenderLoop);
    els.video.addEventListener('error', onVideoError);
    els.playBtn.addEventListener('click', togglePlay);
    els.scrub.addEventListener('input', scrubVideo);
    initTimelineControls();
    els.transcribeBtn.addEventListener('click', transcribeVideo);
    els.addCaptionBtn.addEventListener('click', addCaptionAtPlayhead);
    els.downloadSrtBtn.addEventListener('click', downloadSrt);
    els.captionPosition.addEventListener('change', function () {
      state.captionPosition = els.captionPosition.value;
      setStep('style');
      syncCustomSelect('captionPosition');
      drawFrame();
    });
    els.styleSelect.addEventListener('change', function () {
      state.style = CAPTION_STYLES.find(function (style) { return style.id === els.styleSelect.value; }) || state.style;
      els.styleName.textContent = state.style.name;
      setStep('style');
      syncCustomSelect('styleSelect');
      drawFrame();
    });
    els.sportSelect.addEventListener('change', function () { onSportChange(els.sportSelect.value); });
    els.teamSelect.addEventListener('change', function () { onTeamChange(els.teamSelect.value); });
    els.intelBtn.addEventListener('click', applyIntelligence);
    els.exportBtn.addEventListener('click', function () {
      if (state.recording) stopExport(); else startExport();
    });

    initMobileShell();
    initToolRail();
    initBrandControls();
    initCustomSelects();
    renderStyleGrid();
    renderLowerThirdGrid();
    renderLowerThirdList();
    syncWorkspaceState();
    renderTranscript();
    renderTimeline();
    refreshSpeechBackendStatus();
  }

  function mapElements() {
    [
      'canvas', 'stageEmpty', 'fileInput', 'video', 'uploadBtn', 'playBtn', 'scrub',
      'currentTime', 'totalTime', 'exportBtn', 'exportStatus', 'transcribeBtn',
      'addCaptionBtn', 'downloadSrtBtn', 'transcribeStatus', 'captionTimeline',
      'playhead', 'captionCount', 'transcriptList', 'transcriptSource',
      'styleName', 'styleSelect', 'captionPosition', 'sportSelect', 'teamSelect', 'teamLabel',
      'paletteRow', 'toolSelect', 'intelPrompt', 'intelBtn', 'intelStatus', 'intelSource',
      'ltGrid', 'ltList', 'ltCount',
      'timelineViewport', 'timelineCanvas', 'timelineRuler', 'zoomIn', 'zoomOut', 'zoomLevel'
    ].forEach(function (key) {
      var id = 'reels-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
      els[key] = document.getElementById(id);
    });
  }

  function setStep(active) {
    var order = ['upload', 'transcribe', 'review', 'style'];
    document.querySelectorAll('.reels-step').forEach(function (step) {
      var idx = order.indexOf(step.dataset.step);
      var activeIdx = order.indexOf(active);
      step.classList.toggle('is-active', step.dataset.step === active);
      step.classList.toggle('is-done', idx < activeIdx);
    });
  }

  function initToolRail() {
    document.querySelectorAll('[data-reels-tool]').forEach(function (button) {
      button.addEventListener('click', function () {
        var tool = button.dataset.reelsTool || 'captions';
        toggleReelsMobileTool(tool, button);
      });
    });
    document.querySelectorAll('[data-reels-tool-select]').forEach(function (select) {
      select.addEventListener('change', function () {
        var tool = select.value || 'captions';
        setActiveTool(tool);
        openReelsMobileSheet(tool);
      });
    });
    setActiveTool('captions');
  }

  function setActiveTool(tool) {
    var active = ['captions', 'style', 'lower-thirds', 'rewrite'].indexOf(tool) >= 0 ? tool : 'captions';
    if (!state.captions.length && active !== 'captions') active = 'captions';
    document.body.classList.remove('reels-tool-captions', 'reels-tool-style', 'reels-tool-lower-thirds', 'reels-tool-rewrite');
    document.body.classList.add('reels-tool-' + active);
    document.querySelectorAll('[data-reels-tool]').forEach(function (button) {
      var isActive = button.dataset.reelsTool === active;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      if (isActive && document.body.classList.contains('is-reels-mobile-sheet-open')) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-reels-tool-select]').forEach(function (select) {
      select.value = active;
    });
    syncCustomSelect('toolSelect');
    document.querySelectorAll('[data-reels-panel]').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.dataset.reelsPanel === active);
    });
    syncReelsMobileSheetTitle(active);
  }

  function initMobileShell() {
    var taskPanel = document.querySelector('.reels-task-panel');
    var sidePanel = document.querySelector('.reels-side-panel');
    [taskPanel, sidePanel].forEach(function (panel) {
      if (!panel || panel.querySelector('[data-reels-mobile-sheet-head]')) return;
      var head = document.createElement('div');
      head.className = 'reels-mobile-sheet-head';
      head.dataset.reelsMobileSheetHead = 'true';
      head.innerHTML = '<button class="reels-mobile-sheet-grip" type="button" data-reels-mobile-detent aria-label="Expand editor panel" title="Expand editor panel"><span aria-hidden="true"></span></button><strong data-reels-mobile-sheet-title>Captions</strong><div class="reels-mobile-sheet-actions"><button type="button" data-reels-mobile-detent aria-label="Expand editor panel" title="Expand editor panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button><button type="button" data-reels-mobile-close aria-label="Close editor panel" title="Close editor panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
      panel.insertBefore(head, panel.firstElementChild);
      initReelsMobileSheetGestures(head);
    });
    document.querySelectorAll('[data-reels-mobile-close]').forEach(function (button) {
      button.addEventListener('click', closeReelsMobileSheet);
    });
    document.querySelectorAll('[data-reels-mobile-detent]').forEach(function (button) {
      button.addEventListener('click', toggleReelsMobileDetent);
    });
    document.querySelectorAll('[data-reels-mobile-export]').forEach(function (button) {
      button.addEventListener('click', function () {
        els.exportBtn.click();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeReelsMobileSheet();
    });
    initReelsMobileKeyboardTracking();
  }

  var lastReelsMobileTrigger = null;

  function toggleReelsMobileTool(tool, trigger) {
    var activeClass = 'reels-tool-' + tool;
    if (document.body.classList.contains('is-reels-mobile-sheet-open') && document.body.classList.contains(activeClass)) {
      closeReelsMobileSheet(false);
      return;
    }
    setActiveTool(tool);
    openReelsMobileSheet(tool, trigger);
  }

  function openReelsMobileSheet(tool, trigger) {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    if (!state.captions.length && tool !== 'captions') tool = 'captions';
    var wasOpen = document.body.classList.contains('is-reels-mobile-sheet-open');
    lastReelsMobileTrigger = trigger || document.querySelector('[data-reels-tool="' + tool + '"]');
    document.body.dataset.mobileEditorPanel = tool;
    if (!wasOpen) document.body.dataset.mobileSheetDetent = 'compact';
    document.body.classList.add('is-reels-mobile-sheet-open');
    syncReelsMobileSheetTitle(tool);
    syncReelsMobileDetentControls();
    document.querySelectorAll('[data-reels-tool]').forEach(function (button) {
      if (button.dataset.reelsTool === tool) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  function closeReelsMobileSheet(restoreFocus) {
    document.body.classList.remove('is-reels-mobile-sheet-open');
    document.querySelectorAll('[data-reels-tool]').forEach(function (button) {
      button.classList.remove('is-active');
      button.removeAttribute('aria-current');
    });
    if (restoreFocus !== false && lastReelsMobileTrigger && lastReelsMobileTrigger.isConnected) lastReelsMobileTrigger.focus();
  }

  function toggleReelsMobileDetent() {
    document.body.dataset.mobileSheetDetent = document.body.dataset.mobileSheetDetent === 'expanded' ? 'compact' : 'expanded';
    syncReelsMobileDetentControls();
  }

  function syncReelsMobileDetentControls() {
    var expanded = document.body.dataset.mobileSheetDetent === 'expanded';
    document.querySelectorAll('[data-reels-mobile-detent]').forEach(function (button) {
      button.setAttribute('aria-label', expanded ? 'Collapse editor panel' : 'Expand editor panel');
      button.setAttribute('title', expanded ? 'Collapse editor panel' : 'Expand editor panel');
      button.setAttribute('aria-expanded', String(expanded));
    });
  }

  function initReelsMobileSheetGestures(head) {
    var startY = null;
    head.addEventListener('pointerdown', function (event) {
      if (event.target.closest('button:not(.reels-mobile-sheet-grip)')) return;
      startY = event.clientY;
    });
    head.addEventListener('pointerup', function (event) {
      if (startY === null) return;
      var delta = event.clientY - startY;
      startY = null;
      if (delta < -42 && document.body.dataset.mobileSheetDetent !== 'expanded') toggleReelsMobileDetent();
      if (delta > 42 && document.body.dataset.mobileSheetDetent === 'expanded') toggleReelsMobileDetent();
      else if (delta > 72) closeReelsMobileSheet();
    });
    head.addEventListener('pointercancel', function () { startY = null; });
  }

  function initReelsMobileKeyboardTracking() {
    if (!window.visualViewport) return;
    var syncKeyboard = function () {
      document.body.classList.toggle('is-mobile-keyboard-open', window.innerHeight - window.visualViewport.height > 140);
    };
    window.visualViewport.addEventListener('resize', syncKeyboard);
    window.visualViewport.addEventListener('scroll', syncKeyboard);
  }

  function syncReelsMobileSheetTitle(tool) {
    var labels = {
      captions: 'Captions',
      style: 'Style',
      'lower-thirds': 'Lower Thirds',
      rewrite: 'Rewrite',
    };
    document.querySelectorAll('[data-reels-mobile-sheet-title]').forEach(function (title) {
      title.textContent = labels[tool] || 'Captions';
    });
  }

  function syncWorkspaceState() {
    document.body.classList.toggle('reels-has-clip', !!state.videoFile);
    document.body.classList.toggle('reels-has-captions', !!state.captions.length);
    document.querySelectorAll('[data-reels-tool]').forEach(function (button) {
      var locked = !state.captions.length && button.dataset.reelsTool !== 'captions';
      button.classList.toggle('is-locked', locked);
      button.setAttribute('aria-disabled', String(locked));
    });
    document.querySelectorAll('[data-reels-tool-select]').forEach(function (select) {
      Array.from(select.options).forEach(function (option) {
        option.disabled = !state.captions.length && option.value !== 'captions';
      });
    });
    syncCustomSelect('toolSelect');
    if (!state.captions.length && !document.body.classList.contains('reels-tool-captions')) {
      setActiveTool('captions');
    }
  }

  function initCustomSelects() {
    [
      { key: 'captionPosition', label: 'Position' },
      { key: 'sportSelect', label: 'Sport' },
      { key: 'teamSelect', label: 'Team' },
      { key: 'toolSelect', label: 'Tool' },
      { key: 'styleSelect', label: 'Style' },
    ].forEach(function (config) {
      enhanceSelect(config.key, config.label);
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.reels-choice')) closeCustomSelects();
    });
    syncAllCustomSelects();
  }

  function enhanceSelect(key, label) {
    var select = els[key];
    if (!select || select.dataset.enhanced === 'true') return;
    select.dataset.enhanced = 'true';
    select.classList.add('reels-native-select');
    var choice = document.createElement('div');
    choice.className = 'reels-choice';
    choice.dataset.selectKey = key;
    choice.innerHTML =
      '<button type="button" class="reels-choice-trigger" aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="reels-choice-label">' + escapeHtml(label) + '</span>' +
        '<span class="reels-choice-value"></span>' +
      '</button>' +
      '<div class="reels-choice-menu" role="listbox"></div>';
    select.insertAdjacentElement('afterend', choice);
    choice.querySelector('.reels-choice-trigger').addEventListener('click', function () {
      var isOpen = choice.classList.contains('is-open');
      closeCustomSelects();
      choice.classList.toggle('is-open', !isOpen);
      choice.querySelector('.reels-choice-trigger').setAttribute('aria-expanded', String(!isOpen));
    });
  }

  function closeCustomSelects() {
    document.querySelectorAll('.reels-choice.is-open').forEach(function (choice) {
      choice.classList.remove('is-open');
      choice.querySelector('.reels-choice-trigger')?.setAttribute('aria-expanded', 'false');
    });
  }

  function syncAllCustomSelects() {
    ['captionPosition', 'sportSelect', 'teamSelect', 'toolSelect', 'styleSelect'].forEach(syncCustomSelect);
  }

  function syncCustomSelect(key) {
    var select = els[key];
    var choice = document.querySelector('.reels-choice[data-select-key="' + key + '"]');
    if (!select || !choice) return;
    var selected = select.options[select.selectedIndex] || select.options[0];
    var valueNode = choice.querySelector('.reels-choice-value');
    var menu = choice.querySelector('.reels-choice-menu');
    valueNode.textContent = selected ? selected.textContent : 'Select';
    menu.innerHTML = Array.prototype.map.call(select.options, function (option) {
      var active = option.value === select.value;
      return '<button type="button" class="reels-choice-option' + (active ? ' is-selected' : '') + '" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-value="' + escapeHtml(option.value) + '"' + (option.disabled ? ' disabled' : '') + '>' + escapeHtml(option.textContent) + '</button>';
    }).join('');
    menu.querySelectorAll('.reels-choice-option').forEach(function (button) {
      button.addEventListener('click', function () {
        select.value = button.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeCustomSelects();
      });
    });
  }

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-good', kind === 'good');
  }

  function refreshSpeechBackendStatus() {
    fetch(videoIntelligenceUrl('?health=public-probe'), { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (config) {
        if (!config) return;
        els.intelSource.textContent = 'Caption helper';
        if (state.videoFile) return;
        setStatus(els.transcribeStatus, 'Upload a clip to begin.');
      })
      .catch(function () {
        if (!state.videoFile) setStatus(els.transcribeStatus, 'Upload a clip to begin.');
      });
  }

  function onFileChosen(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    state.videoLoaded = false;
    state.videoFile = file;
    state.captions = [];
    state.lowerThirds = [];
    state.selectedCaptionId = null;
    state.nextId = 1;
    state.transcriptSource = '';
    state.renderedOnce = false;
    state.timeline.zoom = 1;
    state.timeline.zoomInitialized = false;
    state.timeline.lastActiveId = null;
    state.timeline.lastTickStep = null;
    state.timeline.lastContentW = null;
    if (els.timelineViewport) els.timelineViewport.scrollLeft = 0;
    els.downloadSrtBtn.disabled = true;
    els.intelBtn.disabled = true;
    els.intelSource.textContent = 'Caption helper';
    els.stageEmpty.style.display = 'grid';
    els.stageEmpty.innerHTML = '<strong>Loading clip</strong><span>Preparing the first frame.</span>';
    els.uploadBtn.disabled = true;
    els.video.src = URL.createObjectURL(file);
    els.video.load();
    syncWorkspaceState();
    setStep('upload');
    setStatus(els.transcribeStatus, 'Clip selected. Generate captions when ready.');
    renderTranscript();
    renderTimeline();
    renderLowerThirdList();
    refreshSpeechBackendStatus();
  }

  function onVideoMetadata() {
    // Seeking to exactly 0 is a no-op in some browsers (currentTime is already
    // 0 on load) and never fires 'seeked' — that left state.videoLoaded false
    // forever and every control gated on it permanently disabled. A tiny
    // non-zero offset guarantees a real seek, and the timeout is a fallback in
    // case 'seeked' still doesn't fire for some other reason.
    els.video.currentTime = Math.min(0.03, (els.video.duration || 1) / 2);
    clearTimeout(state.firstFrameFallbackId);
    state.firstFrameFallbackId = setTimeout(onFirstFrameReady, 1200);
  }

  function onFirstFrameReady() {
    if (state.videoLoaded) return;
    clearTimeout(state.firstFrameFallbackId);
    state.videoLoaded = true;
    els.stageEmpty.style.display = 'none';
    els.uploadBtn.disabled = false;
    els.uploadBtn.textContent = 'Change Clip';
    els.playBtn.disabled = false;
    els.scrub.disabled = false;
    els.exportBtn.disabled = false;
    els.transcribeBtn.disabled = false;
    els.addCaptionBtn.disabled = false;
    els.totalTime.textContent = formatTime(els.video.duration || 0);
    setStatus(els.transcribeStatus, 'Ready for captions.');
    layoutTimeline();
    drawFrame();
  }

  function onVideoError() {
    els.stageEmpty.style.display = 'grid';
    els.stageEmpty.innerHTML = '<strong>Could not read this clip</strong><span>Try MP4, MOV, or WebM.</span>';
    els.uploadBtn.disabled = false;
    setStatus(els.transcribeStatus, 'The browser could not decode that video file.', 'error');
  }

  function togglePlay() {
    if (!state.videoLoaded) return;
    if (els.video.paused) els.video.play(); else els.video.pause();
  }

  function scrubVideo() {
    if (!els.video.duration) return;
    els.video.currentTime = (Number(els.scrub.value) / 1000) * els.video.duration;
  }

  function syncPlayback() {
    if (!els.video.duration) return;
    var ratio = els.video.currentTime / safeDuration();
    els.scrub.value = Math.round(ratio * 1000);
    els.currentTime.textContent = formatTime(els.video.currentTime);
    els.totalTime.textContent = formatTime(els.video.duration);
    updatePlayhead();
    highlightActiveCaption();
  }

  function startRenderLoop() {
    els.playBtn.classList.add('is-playing');
    function tick() {
      if (els.video.paused || els.video.ended) return;
      drawFrame();
      if (!state.timeline.drag) {
        updatePlayhead();
        highlightActiveCaption();
      }
      state.rafId = requestAnimationFrame(tick);
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    els.playBtn.classList.remove('is-playing');
    if (state.rafId) cancelAnimationFrame(state.rafId);
    drawFrame();
  }

  async function transcribeVideo() {
    if (!state.videoLoaded || !state.videoFile) return;

    setStep('transcribe');
    els.transcribeBtn.disabled = true;
    setStatus(els.transcribeStatus, 'Generating captions...');
    try {
      var result = await transcribeUploadedClip(state.videoFile);
      state.captions = normalizeSegments(formatCaptionBeats(result.segments || []));
      state.transcriptSource = result.provider || 'speech recognition';
      state.selectedCaptionId = state.captions[0] ? state.captions[0].id : null;
      els.downloadSrtBtn.disabled = !state.captions.length;
      els.intelBtn.disabled = !state.selectedCaptionId;
      syncWorkspaceState();
      setStep(state.captions.length ? 'review' : 'transcribe');
      setStatus(els.transcribeStatus, state.captions.length
        ? 'Captions ready. Review the transcript.'
        : 'No speech was detected. Add captions manually.', state.captions.length ? 'good' : 'error');
      renderTranscript();
      renderTimeline();
      drawFrame();
    } catch (error) {
      setStep('transcribe');
      setStatus(els.transcribeStatus, error.message || 'Could not generate captions. Try another clip or add captions manually.', 'error');
    } finally {
      els.transcribeBtn.disabled = false;
    }
  }

  async function transcribeUploadedClip(file) {
    if (window.AudioContext || window.webkitAudioContext) {
      var decoded = null;
      try {
        decoded = await decodeClipAudio(file);
      } catch (error) {
        try {
          setStatus(els.transcribeStatus, 'Audio decode was unavailable, recording the clip audio track for speech recognition...');
          return await transcribeCapturedAudio(file);
        } catch (captureError) {
          if (file.size <= MAX_INLINE_UPLOAD_BYTES) {
            setStatus(els.transcribeStatus, 'Audio extraction was unavailable, sending the original clip instead...');
          } else {
            throw new Error('The browser could not extract audio from this clip. Try exporting MP4/WebM with one standard audio track.');
          }
        }
        if (file.size > MAX_INLINE_UPLOAD_BYTES) {
          throw new Error('The browser could not extract audio from this clip. Try exporting MP4/WebM with one standard audio track.');
        }
      }
      if (decoded) return await transcribeAudioSamples(file, decoded.samples);
    }

    if (file.size > MAX_INLINE_UPLOAD_BYTES) {
      throw new Error('This clip needs browser audio extraction before upload. Try a standard MP4/WebM export with one audio track.');
    }

    return postJson(videoIntelligenceUrl(), {
      action: 'transcribe',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: await fileToBase64(file),
    });
  }

  async function transcribeDecodedAudio(file) {
    var decoded = await decodeClipAudio(file);
    return transcribeAudioSamples(file, decoded.samples);
  }

  async function transcribeAudioSamples(file, samples) {
    var chunks = sliceAudioSamples(samples, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_CHUNK_SECONDS);

    try {
      var serverResult = await transcribeServerAudioChunks(file, chunks);
      if (serverResult.segments.length) return serverResult;
      setStatus(els.transcribeStatus, 'Cloud speech returned no captions. Loading on-device Whisper...');
    } catch (error) {
      setStatus(els.transcribeStatus, 'Cloud speech failed. Loading on-device Whisper captions...');
    }

    try {
      return await transcribeLocalAudioChunks(chunks);
    } catch (error) {
      throw new Error('On-device Whisper could not generate captions: ' + (error.message || error));
    }
  }

  async function transcribeServerAudioChunks(file, chunks) {
    var merged = {
      provider: '',
      language: '',
      text: '',
      segments: [],
    };

    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      setStatus(els.transcribeStatus, 'Speech recognition chunk ' + (i + 1) + ' of ' + chunks.length + '...');
      var wav = encodeWav(chunk.samples, TRANSCRIBE_SAMPLE_RATE);
      var result = await postJson(videoIntelligenceUrl(), {
        action: 'transcribe',
        fileName: chunkFileName(file.name, i),
        mimeType: 'audio/wav',
        data: await blobToBase64(wav),
      });

      merged.provider = result.provider || merged.provider;
      merged.language = result.language || merged.language;
      merged.text = [merged.text, result.text || ''].filter(Boolean).join(' ').trim();
      (result.segments || []).forEach(function (segment) {
        merged.segments.push(offsetSegment(segment, chunk.start));
      });
    }

    merged.segments.sort(sortByStart);
    return merged;
  }

  async function transcribeLocalAudioChunks(chunks) {
    var merged = {
      provider: 'On-device Whisper',
      language: 'en',
      text: '',
      segments: [],
    };

    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      setStatus(els.transcribeStatus, 'On-device Whisper chunk ' + (i + 1) + ' of ' + chunks.length + '...');
      var result = await runLocalWhisperInWorker(chunk.samples);
      merged.text = [merged.text, result.text || ''].filter(Boolean).join(' ').trim();
      normalizeLocalWhisperSegments(result, chunk.start, chunk.samples.length / TRANSCRIBE_SAMPLE_RATE).forEach(function (segment) {
        merged.segments.push(segment);
      });
    }

    merged.segments.sort(sortByStart);
    return merged;
  }

  function getLocalWhisperWorker() {
    if (!state.localWhisperWorker) {
      state.localWhisperWorker = new Worker('reels-whisper-worker.js?v=20260817', { type: 'module' });
      state.localWhisperWorkerJobId = 0;
      state.localWhisperWorkerJobs = new Map();
      state.localWhisperWorker.onmessage = function (event) {
        var data = event.data || {};
        var job = state.localWhisperWorkerJobs.get(data.id);
        if (!job) return;
        if (data.type === 'progress') {
          setStatus(els.transcribeStatus, 'Loading on-device Whisper model ' + Math.round(data.progress) + '%...');
          return;
        }
        state.localWhisperWorkerJobs.delete(data.id);
        if (data.type === 'error') {
          job.reject(new Error(data.message || 'On-device Whisper failed.'));
        } else {
          job.resolve({ text: data.text, chunks: data.chunks });
        }
      };
      state.localWhisperWorker.onerror = function (event) {
        state.localWhisperWorkerJobs.forEach(function (job) {
          job.reject(new Error(event.message || 'On-device Whisper worker crashed.'));
        });
        state.localWhisperWorkerJobs.clear();
      };
    }
    return state.localWhisperWorker;
  }

  function runLocalWhisperInWorker(samples) {
    var worker = getLocalWhisperWorker();
    var id = ++state.localWhisperWorkerJobId;
    return new Promise(function (resolve, reject) {
      state.localWhisperWorkerJobs.set(id, { resolve: resolve, reject: reject });
      worker.postMessage({ id: id, samples: samples });
    });
  }

  function normalizeLocalWhisperSegments(result, offset, duration) {
    var chunks = Array.isArray(result?.chunks) ? result.chunks : [];
    var words = chunks.map(function (chunk) {
      var timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
      var start = Number(timestamp[0]);
      var end = Number(timestamp[1]);
      return {
        word: String(chunk.text || '').replace(/\s+/g, ' ').trim(),
        start: offset + (Number.isFinite(start) ? start : 0),
        end: offset + (Number.isFinite(end) ? end : (Number.isFinite(start) ? start + 0.34 : duration)),
      };
    }).filter(function (word) {
      return word.word;
    });

    if (words.length) {
      return [{
        start: words[0].start,
        end: Math.max(words[words.length - 1].end, words[0].start + CAPTION_MIN_SECONDS),
        text: words.map(function (word) { return word.word; }).join(' '),
        confidence: null,
        words: words,
      }];
    }

    var text = String(result?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [{
      start: offset,
      end: offset + Math.max(CAPTION_MIN_SECONDS, duration || text.split(/\s+/).length * 0.34),
      text: text,
      confidence: null,
      words: [],
    }];
  }

  async function transcribeCapturedAudio(file) {
    if (typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
      throw new Error('Browser media capture is not available.');
    }
    var blobs = await captureAudioBlobs(file);
    if (!blobs.length) throw new Error('No audio track was captured from the uploaded clip.');

    try {
      var serverResult = await transcribeCapturedAudioWithServer(file, blobs);
      if (serverResult.segments.length) return serverResult;
      setStatus(els.transcribeStatus, 'Cloud speech returned no captured captions. Loading on-device Whisper...');
    } catch (error) {
      setStatus(els.transcribeStatus, 'Cloud speech failed for captured audio. Loading on-device Whisper captions...');
    }

    return transcribeCapturedAudioLocally(blobs);
  }

  async function transcribeCapturedAudioWithServer(file, blobs) {
    var merged = {
      provider: '',
      language: '',
      text: '',
      segments: [],
    };

    for (var i = 0; i < blobs.length; i++) {
      var item = blobs[i];
      setStatus(els.transcribeStatus, 'Speech recognition captured audio chunk ' + (i + 1) + ' of ' + blobs.length + '...');
      var result = await postJson(videoIntelligenceUrl(), {
        action: 'transcribe',
        fileName: chunkFileName(file.name, i).replace(/\.wav$/, '.webm'),
        mimeType: item.blob.type || 'audio/webm',
        data: await blobToBase64(item.blob),
      });

      merged.provider = result.provider || merged.provider;
      merged.language = result.language || merged.language;
      merged.text = [merged.text, result.text || ''].filter(Boolean).join(' ').trim();
      (result.segments || []).forEach(function (segment) {
        merged.segments.push(offsetSegment(segment, item.start));
      });
    }

    merged.segments.sort(sortByStart);
    return merged;
  }

  async function transcribeCapturedAudioLocally(blobs) {
    var chunks = [];
    for (var i = 0; i < blobs.length; i++) {
      var item = blobs[i];
      setStatus(els.transcribeStatus, 'Preparing captured audio for on-device Whisper ' + (i + 1) + ' of ' + blobs.length + '...');
      var decoded = await decodeClipAudio(item.blob);
      sliceAudioSamples(decoded.samples, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_CHUNK_SECONDS).forEach(function (chunk) {
        chunks.push({
          start: item.start + chunk.start,
          samples: chunk.samples,
        });
      });
    }

    try {
      return await transcribeLocalAudioChunks(chunks);
    } catch (error) {
      throw new Error('On-device Whisper could not generate captured captions: ' + (error.message || error));
    }
  }

  function captureAudioBlobs(file) {
    return new Promise(function (resolve, reject) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      var audioContext = new AudioContextClass();
      var video = document.createElement('video');
      var url = URL.createObjectURL(file);
      var chunks = [];
      var recorder = null;
      var startedAt = 0;

      function cleanup() {
        URL.revokeObjectURL(url);
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (audioContext.close) audioContext.close().catch(function () {});
      }

      video.preload = 'auto';
      video.playsInline = true;
      video.src = url;
      video.addEventListener('loadedmetadata', function () {
        try {
          var source = audioContext.createMediaElementSource(video);
          var destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          recorder = new MediaRecorder(destination.stream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
          });
          recorder.ondataavailable = function (event) {
            if (event.data && event.data.size) {
              chunks.push({ start: startedAt, blob: event.data });
              startedAt += TRANSCRIBE_CHUNK_SECONDS;
            }
          };
          recorder.onerror = function () {
            cleanup();
            reject(new Error('Could not record the clip audio track.'));
          };
          recorder.onstop = function () {
            cleanup();
            resolve(chunks);
          };
          audioContext.resume().then(function () {
            recorder.start(TRANSCRIBE_CHUNK_SECONDS * 1000);
            return video.play();
          }).catch(function (error) {
            cleanup();
            reject(error);
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      }, { once: true });
      video.addEventListener('ended', function () {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      });
      video.addEventListener('error', function () {
        cleanup();
        reject(new Error('Could not play the uploaded clip for audio capture.'));
      }, { once: true });
    });
  }

  function offsetSegment(segment, offset) {
    return {
      start: (Number(segment.start) || 0) + offset,
      end: (Number(segment.end) || 0) + offset,
      text: segment.text,
      confidence: segment.confidence,
      words: Array.isArray(segment.words) ? segment.words.map(function (word) {
        return Object.assign({}, word, {
          start: word.start == null ? word.start : Number(word.start) + offset,
          end: word.end == null ? word.end : Number(word.end) + offset,
        });
      }) : [],
    };
  }

  async function decodeClipAudio(file) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    var audioContext = new AudioContextClass();
    try {
      var audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      var mono = mixToMono(audioBuffer);
      return {
        samples: resampleAudio(mono, audioBuffer.sampleRate, TRANSCRIBE_SAMPLE_RATE),
      };
    } finally {
      if (audioContext.close) audioContext.close().catch(function () {});
    }
  }

  function mixToMono(audioBuffer) {
    var samples = new Float32Array(audioBuffer.length);
    for (var channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      var data = audioBuffer.getChannelData(channel);
      for (var i = 0; i < data.length; i++) samples[i] += data[i] / audioBuffer.numberOfChannels;
    }
    return samples;
  }

  function resampleAudio(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    var ratio = fromRate / toRate;
    var length = Math.max(1, Math.round(samples.length / ratio));
    var output = new Float32Array(length);
    for (var i = 0; i < length; i++) {
      var position = i * ratio;
      var left = Math.floor(position);
      var right = Math.min(samples.length - 1, left + 1);
      var mix = position - left;
      output[i] = samples[left] * (1 - mix) + samples[right] * mix;
    }
    return output;
  }

  function sliceAudioSamples(samples, sampleRate, seconds) {
    var chunkLength = Math.max(sampleRate, Math.floor(sampleRate * seconds));
    var chunks = [];
    for (var start = 0; start < samples.length; start += chunkLength) {
      chunks.push({
        start: start / sampleRate,
        samples: samples.slice(start, Math.min(samples.length, start + chunkLength)),
      });
    }
    return chunks.length ? chunks : [{ start: 0, samples: samples }];
  }

  function encodeWav(samples, sampleRate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (var i = 0; i < samples.length; i++) {
      var sample = clamp(samples[i], -1, 1);
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function writeAscii(view, offset, text) {
    for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function chunkFileName(name, index) {
    return String(name || 'reels-upload').replace(/\.[^.]+$/, '') + '-audio-' + String(index + 1).padStart(2, '0') + '.wav';
  }

  function normalizeSegments(segments) {
    return segments.map(function (segment) {
      return {
        id: state.nextId++,
        start: clamp(Number(segment.start) || 0, 0, els.video.duration || 0),
        end: clamp(Number(segment.end) || 0, 0, els.video.duration || 0),
        text: String(segment.text || '').trim(),
        confidence: segment.confidence == null ? null : Number(segment.confidence),
        words: Array.isArray(segment.words) ? segment.words : [],
      };
    }).filter(function (segment) {
      if (!segment.text) return false;
      if (segment.end <= segment.start) segment.end = Math.min((els.video.duration || segment.start + 2), segment.start + 2);
      return segment.end > segment.start;
    });
  }

  function formatCaptionBeats(segments) {
    var beats = [];
    segments.forEach(function (segment) {
      var text = String(segment.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      var start = Math.max(0, Number(segment.start) || 0);
      var rawEnd = Number(segment.end);
      var timedWords = normalizeTimedWords(segment.words, start);

      if (timedWords.length) {
        for (var w = 0; w < timedWords.length; w += CAPTION_MAX_WORDS) {
          var wordChunk = timedWords.slice(w, w + CAPTION_MAX_WORDS);
          var wordStart = Number(wordChunk[0].start);
          var wordEnd = Number(wordChunk[wordChunk.length - 1].end);
          beats.push({
            start: Number.isFinite(wordStart) ? wordStart : start,
            end: Number.isFinite(wordEnd) && wordEnd > wordStart ? wordEnd : (Number.isFinite(wordStart) ? wordStart + CAPTION_MIN_SECONDS : start + CAPTION_MIN_SECONDS),
            text: wordChunk.map(function (word) { return word.text; }).join(' '),
            confidence: segment.confidence,
            words: wordChunk,
          });
        }
        return;
      }

      var words = text.split(' ').filter(Boolean);
      var end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + Math.max(CAPTION_MIN_SECONDS, words.length * 0.34);

      for (var i = 0; i < words.length; i += CAPTION_MAX_WORDS) {
        var chunk = words.slice(i, i + CAPTION_MAX_WORDS);
        var chunkStart = start + ((end - start) * (i / words.length));
        var chunkEnd = start + ((end - start) * (Math.min(words.length, i + CAPTION_MAX_WORDS) / words.length));
        if (chunkEnd - chunkStart < CAPTION_MIN_SECONDS) {
          chunkEnd = Math.min(end, chunkStart + CAPTION_MIN_SECONDS);
        }
        beats.push({
          start: chunkStart,
          end: chunkEnd,
          text: chunk.join(' '),
          confidence: segment.confidence,
          words: Array.isArray(segment.words) ? segment.words : [],
        });
      }
    });
    return beats;
  }

  function normalizeTimedWords(words, fallbackStart) {
    if (!Array.isArray(words)) return [];
    return words.map(function (word) {
      var text = String(word.word || word.text || '').replace(/\s+/g, ' ').trim();
      var start = Number(word.start == null ? word.startTime : word.start);
      var end = Number(word.end == null ? word.endTime : word.end);
      return {
        text: text,
        start: Number.isFinite(start) ? start : fallbackStart,
        end: Number.isFinite(end) ? end : NaN,
      };
    }).filter(function (word) {
      return word.text && Number.isFinite(word.start);
    });
  }

  function addCaptionAtPlayhead() {
    if (!state.videoLoaded) return;
    var start = els.video.currentTime || 0;
    var end = Math.min(start + 2.4, els.video.duration || start + 2.4);
    var caption = {
      id: state.nextId++,
      start: start,
      end: end,
      text: 'New caption',
      confidence: null,
      words: [],
    };
    state.captions.push(caption);
    state.captions.sort(sortByStart);
    state.selectedCaptionId = caption.id;
    els.downloadSrtBtn.disabled = false;
    els.intelBtn.disabled = false;
    renderTranscript();
    renderTimeline();
    drawFrame();
  }

  function renderTranscript() {
    syncWorkspaceState();
    els.transcriptSource.textContent = state.captions.length ? 'Editable draft' : '';
    els.transcriptList.classList.toggle('has-captions', !!state.captions.length);
    if (!state.captions.length) {
      els.transcriptList.innerHTML = '<button type="button" class="reels-btn is-secondary reels-empty-upload" id="reels-upload-btn" data-reels-upload-trigger>Upload Clip</button>';
      els.transcriptList.querySelector('[data-reels-upload-trigger]')?.addEventListener('click', function () { els.fileInput.click(); });
      els.captionCount.textContent = '0 segments';
      return;
    }

    els.captionCount.textContent = state.captions.length + (state.captions.length === 1 ? ' segment' : ' segments');
    els.transcriptList.innerHTML = state.captions.map(function (caption) {
      var selected = caption.id === state.selectedCaptionId;
      return '<div class="reels-caption-row' + (selected ? ' is-selected' : '') + '" data-id="' + caption.id + '">' +
        '<div class="reels-caption-time">' +
          '<input type="number" step="0.1" min="0" value="' + caption.start.toFixed(1) + '" data-field="start" aria-label="Caption start time">' +
          '<input type="number" step="0.1" min="0" value="' + caption.end.toFixed(1) + '" data-field="end" aria-label="Caption end time">' +
        '</div>' +
        '<textarea class="reels-caption-text" data-field="text" aria-label="Caption text">' + escapeHtml(caption.text) + '</textarea>' +
        '<button type="button" class="reels-row-delete" data-action="delete" aria-label="Delete caption">x</button>' +
      '</div>';
    }).join('');

    els.transcriptList.querySelectorAll('.reels-caption-row').forEach(function (row) {
      var id = Number(row.dataset.id);
      row.addEventListener('click', function (event) {
        if (event.target.dataset.action === 'delete') return;
        selectCaption(id, true);
      });
      row.querySelectorAll('[data-field]').forEach(function (input) {
        input.addEventListener('input', function () { editCaption(id, input.dataset.field, input.value); });
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', function () { deleteCaption(id); });
    });
  }

  function initTimelineControls() {
    if (!els.timelineViewport) return;

    if (els.zoomIn) els.zoomIn.addEventListener('click', function () { zoomBy(1.6); });
    if (els.zoomOut) els.zoomOut.addEventListener('click', function () { zoomBy(1 / 1.6); });
    if (els.zoomLevel) els.zoomLevel.addEventListener('click', function () { setZoom(1); });

    els.timelineViewport.addEventListener('wheel', function (event) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
      } else if (event.shiftKey && event.deltaX === 0) {
        els.timelineViewport.scrollLeft += event.deltaY;
      }
    }, { passive: false });

    // Clicking/dragging the ruler or empty track background scrubs the
    // playhead; segments and their resize handles keep their own handlers
    // (registered per-node in renderTimeline/beginTimingDrag) and are
    // excluded here since they're higher in the event path.
    els.timelineCanvas.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.reels-timeline-seg')) return;
      beginPlayheadDrag(event);
    });
    els.playhead.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
      beginPlayheadDrag(event);
    });

    // Keyboard seeking on the playhead (ARIA slider role).
    els.playhead.addEventListener('keydown', function (event) {
      if (!state.videoLoaded) return;
      var step = event.shiftKey ? 1 : 0.1;
      if (event.key === 'ArrowLeft') { els.video.currentTime = clamp(els.video.currentTime - step, 0, safeDuration()); event.preventDefault(); }
      else if (event.key === 'ArrowRight') { els.video.currentTime = clamp(els.video.currentTime + step, 0, safeDuration()); event.preventDefault(); }
      else if (event.key === 'Home') { els.video.currentTime = 0; event.preventDefault(); }
      else if (event.key === 'End') { els.video.currentTime = safeDuration(); event.preventDefault(); }
    });

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { layoutTimeline(); });
      ro.observe(els.timelineViewport);
    } else {
      window.addEventListener('resize', function () { layoutTimeline(); });
    }

    var mobileQuery = window.matchMedia('(max-width: 820px)');
    function syncMobileFloor() {
      els.timelineViewport.classList.toggle('is-mobile-floor', mobileQuery.matches);
      els.timelineViewport.classList.toggle('is-compact-ruler', mobileQuery.matches);
      layoutTimeline();
    }
    mobileQuery.addEventListener ? mobileQuery.addEventListener('change', syncMobileFloor) : mobileQuery.addListener(syncMobileFloor);
    syncMobileFloor();
  }

  // ─── Caption timeline: scale model ──────────────────────────────────
  // Everything below assumes "track width == full clip duration" ONLY at
  // zoom 1 (fitPps). Real px positioning on a horizontally-scrolled
  // canvas, not a CSS transform: scale — a transform would distort text,
  // borders, and the 9px resize handles, and complicate hit-testing.
  function safeDuration() {
    var d = els.video.duration;
    return (isFinite(d) && d > 0) ? d : 1;
  }

  function timeToPx(t) {
    return t * state.timeline.pps;
  }

  function clientXToTime(clientX) {
    var rect = els.timelineViewport.getBoundingClientRect();
    var x = clientX - rect.left + els.timelineViewport.scrollLeft;
    return state.timeline.pps > 0 ? x / state.timeline.pps : 0;
  }

  function densityZoom() {
    var vw = state.timeline.viewportW || 1;
    return Math.min(4, Math.max(1, (MIN_SEG_PX * state.captions.length) / vw));
  }

  function pickTickStep(pps, minLabelPx) {
    for (var i = 0; i < TICK_STEP_LADDER.length; i++) {
      var step = TICK_STEP_LADDER[i];
      if (step * pps >= minLabelPx) return step;
    }
    return TICK_STEP_LADDER[TICK_STEP_LADDER.length - 1];
  }

  function formatTick(seconds, step) {
    if (step < 1) {
      var whole = Math.floor(seconds);
      var tenths = Math.round((seconds - whole) * 10);
      if (tenths === 10) { whole += 1; tenths = 0; }
      var m = Math.floor(whole / 60);
      var s = whole % 60;
      return m + ':' + (s < 10 ? '0' : '') + s + '.' + tenths;
    }
    return formatTime(seconds);
  }

  // renderTimeline(): STRUCTURAL rebuild — only when the *set* of
  // captions changes. All prior call sites keep calling this unchanged;
  // the one hot path (mid-resize-drag) now calls updateSegmentGeometry()
  // instead, see beginTimingDrag().
  function renderTimeline() {
    var card = document.querySelector('.reels-timeline-card');
    if (card) card.classList.toggle('has-captions', !!state.captions.length);
    els.captionTimeline.innerHTML = state.captions.map(function (caption) {
      return '<button type="button" class="reels-timeline-seg' + (caption.id === state.selectedCaptionId ? ' is-selected' : '') + '" data-id="' + caption.id + '">' +
        '<i class="reels-seg-handle" data-edge="start"></i><span>' + escapeHtml(caption.text) + '</span><i class="reels-seg-handle" data-edge="end"></i>' +
      '</button>';
    }).join('');
    var nodes = new Map();
    els.captionTimeline.querySelectorAll('.reels-timeline-seg').forEach(function (segment) {
      var id = Number(segment.dataset.id);
      nodes.set(id, segment);
      segment.addEventListener('click', function (event) {
        if (event.target.dataset.edge) return;
        selectCaption(id, true);
      });
      segment.querySelectorAll('.reels-seg-handle').forEach(function (handle) {
        handle.addEventListener('pointerdown', function (event) {
          event.preventDefault();
          event.stopPropagation();
          beginTimingDrag(id, handle.dataset.edge, event.pointerId);
        });
      });
    });
    state.timeline.nodes = nodes;
    if (!state.timeline.zoomInitialized && state.captions.length) {
      state.timeline.zoom = Math.max(state.timeline.zoom, densityZoom());
      state.timeline.zoomInitialized = true;
    }
    layoutTimeline();
  }

  // layoutTimeline(): pure GEOMETRY — resize/zoom/pan/duration-change and
  // (via updateSegmentGeometry) the single hot spot during a resize drag.
  function layoutTimeline() {
    if (!els.timelineViewport) return;
    var duration = safeDuration();
    var viewportW = els.timelineViewport.clientWidth || 1;
    state.timeline.viewportW = viewportW;
    var minZoom = Math.max(1, els.timelineViewport.classList.contains('is-mobile-floor') ? densityZoom() : 1);
    state.timeline.minZoom = minZoom;
    if (state.timeline.zoom < minZoom) state.timeline.zoom = minZoom;
    if (state.timeline.zoom > state.timeline.maxZoom) state.timeline.zoom = state.timeline.maxZoom;
    state.timeline.fitPps = viewportW / duration;
    state.timeline.pps = state.timeline.fitPps * state.timeline.zoom;
    var contentW = Math.max(viewportW, duration * state.timeline.pps);
    els.timelineCanvas.style.width = contentW + 'px';

    var tickStep = pickTickStep(state.timeline.pps, els.timelineViewport.classList.contains('is-compact-ruler') ? 80 : 64);
    if (tickStep !== state.timeline.lastTickStep || Math.round(contentW) !== state.timeline.lastContentW) {
      state.timeline.lastTickStep = tickStep;
      state.timeline.lastContentW = Math.round(contentW);
      buildRuler(tickStep, duration, contentW);
      els.timelineCanvas.style.setProperty('--reels-tick-px', (tickStep * state.timeline.pps).toFixed(2) + 'px');
    }

    if (state.timeline.nodes) {
      state.timeline.nodes.forEach(function (node, id) {
        var caption = findCaption(id);
        if (!caption) return;
        var left = timeToPx(caption.start);
        var width = Math.max(2, timeToPx(caption.end - caption.start));
        node.style.left = left.toFixed(2) + 'px';
        node.style.width = width.toFixed(2) + 'px';
        node.classList.toggle('is-compact', width < 56 && width >= 20);
        node.classList.toggle('is-tiny', width < 20);
        node.title = caption.text;
      });
    }
    updateZoomUi();
    updatePlayhead();
  }

  function updateSegmentGeometry(id) {
    if (!state.timeline.nodes) return;
    var node = state.timeline.nodes.get(id);
    var caption = findCaption(id);
    if (!node || !caption) return;
    var left = timeToPx(caption.start);
    var width = Math.max(2, timeToPx(caption.end - caption.start));
    node.style.left = left.toFixed(2) + 'px';
    node.style.width = width.toFixed(2) + 'px';
    node.classList.toggle('is-compact', width < 56 && width >= 20);
    node.classList.toggle('is-tiny', width < 20);
  }

  function buildRuler(step, duration, contentW) {
    if (!els.timelineRuler) return;
    var html = '';
    var subdivisions = (step === 15 || step === 30 || step === 60) ? 4 : 5;
    var minorStep = step / subdivisions;
    for (var t = 0; t <= duration + 0.001; t += minorStep) {
      var isMajor = Math.abs(Math.round(t / step) * step - t) < minorStep / 2;
      var x = t * state.timeline.pps;
      if (isMajor) {
        html += '<i class="reels-tick reels-tick--major" style="left:' + x.toFixed(1) + 'px"><span>' + formatTick(t, step) + '</span></i>';
      } else if (minorStep * state.timeline.pps >= 8) {
        html += '<i class="reels-tick reels-tick--minor" style="left:' + x.toFixed(1) + 'px"></i>';
      }
    }
    // Always show the true end label, flush inside the right edge.
    html += '<span class="reels-tick-end">' + formatTime(duration) + '</span>';
    els.timelineRuler.innerHTML = html;
  }

  // ─── Zoom ────────────────────────────────────────────────────────────
  function setZoom(nextZoom, anchorClientX) {
    var vp = els.timelineViewport;
    if (!vp) return;
    var rect = vp.getBoundingClientRect();
    var anchorX = anchorClientX != null ? anchorClientX : (rect.left + vp.clientWidth / 2);
    var tAnchor = clientXToTime(anchorX);
    nextZoom = clamp(nextZoom, state.timeline.minZoom, state.timeline.maxZoom);
    state.timeline.zoom = nextZoom;
    state.timeline.pps = state.timeline.fitPps * nextZoom;
    var contentW = Math.max(vp.clientWidth, safeDuration() * state.timeline.pps);
    var targetScrollLeft = tAnchor * state.timeline.pps - (anchorX - rect.left);
    vp.scrollLeft = clamp(targetScrollLeft, 0, Math.max(0, contentW - vp.clientWidth));
    layoutTimeline();
  }

  function updateZoomUi() {
    if (!els.zoomLevel) return;
    var zoom = state.timeline.zoom;
    els.zoomLevel.textContent = zoom <= 1.001 ? 'Fit' : (zoom % 1 === 0 ? zoom + '×' : zoom.toFixed(1) + '×');
    if (els.zoomOut) els.zoomOut.disabled = zoom <= state.timeline.minZoom + 0.001;
    if (els.zoomIn) els.zoomIn.disabled = zoom >= state.timeline.maxZoom - 0.001;
  }

  function zoomBy(factor) {
    var vp = els.timelineViewport;
    var anchorX = null;
    if (state.videoLoaded && vp) {
      var rect = vp.getBoundingClientRect();
      var playheadX = rect.left - vp.scrollLeft + timeToPx(els.video.currentTime);
      if (playheadX >= rect.left && playheadX <= rect.right) anchorX = playheadX;
    }
    setZoom(state.timeline.zoom * factor, anchorX);
  }

  // ─── Snapping ────────────────────────────────────────────────────────
  function buildSnapCandidates(excludeId) {
    var candidates = [0, safeDuration()];
    state.captions.forEach(function (caption) {
      if (caption.id === excludeId) return;
      candidates.push(caption.start, caption.end);
    });
    return candidates.sort(function (a, b) { return a - b; });
  }

  function applySnap(time, candidates, suppress) {
    if (suppress || state.timeline.pps <= 0) return { time: time, snapped: false };
    var snapSec = SNAP_PX / state.timeline.pps;
    var best = null, bestDist = snapSec;
    for (var i = 0; i < candidates.length; i++) {
      var dist = Math.abs(candidates[i] - time);
      if (dist <= bestDist) { bestDist = dist; best = candidates[i]; }
    }
    return best != null ? { time: best, snapped: true } : { time: time, snapped: false };
  }

  function showSnapGuide(pxLeft) {
    var guide = document.getElementById('reels-snap-guide');
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'reels-snap-guide';
      guide.className = 'reels-snap-guide';
      els.timelineCanvas.appendChild(guide);
    }
    guide.style.left = pxLeft.toFixed(2) + 'px';
    guide.hidden = false;
  }

  function hideSnapGuide() {
    var guide = document.getElementById('reels-snap-guide');
    if (guide) guide.hidden = true;
  }

  // ─── Edge auto-scroll during any drag ───────────────────────────────
  function maybeAutoScroll(clientX) {
    var vp = els.timelineViewport;
    var rect = vp.getBoundingClientRect();
    var edge = 40;
    var distLeft = clientX - rect.left;
    var distRight = rect.right - clientX;
    if (distLeft < edge && distLeft >= -edge) {
      vp.scrollLeft -= (1 - Math.max(0, distLeft) / edge) * 14;
    } else if (distRight < edge && distRight >= -edge) {
      vp.scrollLeft += (1 - Math.max(0, distRight) / edge) * 14;
    }
  }

  function beginTimingDrag(id, edge, pointerId) {
    var handleEl = null;
    els.captionTimeline.querySelectorAll('.reels-seg-handle[data-edge="' + edge + '"]').forEach(function (h) {
      if (Number(h.closest('.reels-timeline-seg').dataset.id) === id) handleEl = h;
    });
    if (handleEl && handleEl.setPointerCapture && pointerId != null) {
      try { handleEl.setPointerCapture(pointerId); } catch (e) {}
    }
    var candidates = buildSnapCandidates(id);
    var autoScrollRaf = 0;
    var lastClientX = 0;

    function onMove(event) {
      lastClientX = event.clientX;
      var caption = findCaption(id);
      if (!caption) return;
      var time = clientXToTime(event.clientX);
      var snap = applySnap(time, candidates, event.altKey);
      time = snap.time;
      if (edge === 'start') caption.start = clamp(time, 0, caption.end - .2);
      else caption.end = clamp(time, caption.start + .2, safeDuration());
      if (snap.snapped) showSnapGuide(timeToPx(edge === 'start' ? caption.start : caption.end));
      else hideSnapGuide();
      updateSegmentGeometry(id);
      updateTranscriptRowTiming(id, caption);
      requestSeeklessDraw();
      maybeAutoScroll(event.clientX);
      if (!autoScrollRaf) {
        autoScrollRaf = requestAnimationFrame(function tickScroll() {
          autoScrollRaf = 0;
          if (state.timeline.drag) { maybeAutoScroll(lastClientX); autoScrollRaf = requestAnimationFrame(tickScroll); }
        });
      }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
      hideSnapGuide();
      state.timeline.drag = null;
      state.captions.sort(sortByStart);
      renderTranscript();
      renderTimeline();
      drawFrame();
    }
    state.timeline.drag = { kind: 'resize', id: id, edge: edge };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  // Cheap targeted update for the two number inputs in the matching
  // transcript row, so a resize-drag doesn't rebuild the whole transcript
  // list (which would also steal focus from any input the user is typing
  // in). Skips the write if that input currently has focus.
  function updateTranscriptRowTiming(id, caption) {
    var row = document.querySelector('.reels-caption-row[data-id="' + id + '"]');
    if (!row) return;
    var startInput = row.querySelector('[data-field="start"]');
    var endInput = row.querySelector('[data-field="end"]');
    if (startInput && document.activeElement !== startInput) startInput.value = caption.start.toFixed(1);
    if (endInput && document.activeElement !== endInput) endInput.value = caption.end.toFixed(1);
  }

  // rAF-coalesced canvas repaint used by both resize-drags and the
  // playhead drag, so a high-rate pointer (500-1000 events/sec) produces
  // at most one paint per animation frame instead of one per event.
  var drawRafId = 0;
  function requestSeeklessDraw() {
    if (drawRafId) return;
    drawRafId = requestAnimationFrame(function () {
      drawRafId = 0;
      drawFrame();
    });
  }

  // rAF-coalesced seek: at most one `video.currentTime` write + one
  // drawFrame() per animation frame, regardless of how fast pointermove
  // fires. Guarded by seekPending so a slow decoder degrades to "playhead
  // silky, frame a beat behind" instead of stalling.
  var seekRafId = 0;
  var pendingSeekTime = null;
  function requestSeek(t) {
    pendingSeekTime = t;
    if (seekRafId) return;
    seekRafId = requestAnimationFrame(function () {
      seekRafId = 0;
      if (pendingSeekTime == null) return;
      if (!state.seekPending) {
        state.seekPending = true;
        els.video.currentTime = pendingSeekTime;
        drawFrame();
      }
    });
  }

  function beginPlayheadDrag(event) {
    if (!state.videoLoaded) return;
    event.preventDefault();
    var wasPlaying = !els.video.paused;
    if (wasPlaying) els.video.pause();
    if (els.playhead.setPointerCapture) {
      try { els.playhead.setPointerCapture(event.pointerId); } catch (e) {}
    }
    var candidates = buildSnapCandidates(null);
    state.timeline.drag = { kind: 'playhead' };
    els.playhead.classList.add('is-dragging');
    document.querySelector('.reels-timeline-card').classList.add('is-scrubbing');

    // Land where clicked immediately, unless the press started on the cap
    // itself (in which case the first move event carries the real target).
    var startTime = clamp(clientXToTime(event.clientX), 0, safeDuration());
    var snap0 = applySnap(startTime, candidates, event.altKey);
    els.playhead.style.transform = 'translateX(' + timeToPx(snap0.time) + 'px)';
    requestSeek(snap0.time);

    function onMove(moveEvent) {
      var t = clamp(clientXToTime(moveEvent.clientX), 0, safeDuration());
      var snap = applySnap(t, candidates, moveEvent.altKey);
      t = snap.time;
      els.playhead.style.transform = 'translateX(' + timeToPx(t) + 'px)';
      if (snap.snapped) showSnapGuide(timeToPx(t)); else hideSnapGuide();
      els.currentTime.textContent = formatTime(t);
      els.scrub.value = Math.round((t / safeDuration()) * 1000);
      requestSeek(t);
      maybeAutoScroll(moveEvent.clientX);
    }
    function onUp(upEvent) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      hideSnapGuide();
      els.playhead.classList.remove('is-dragging');
      document.querySelector('.reels-timeline-card').classList.remove('is-scrubbing');
      state.timeline.drag = null;
      var finalT = upEvent ? clamp(clientXToTime(upEvent.clientX), 0, safeDuration()) : els.video.currentTime;
      var snap = applySnap(finalT, candidates, upEvent ? upEvent.altKey : false);
      els.video.currentTime = snap.time;
      drawFrame();
      highlightActiveCaption();
      updatePlayhead();
      if (wasPlaying) els.video.play();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function selectCaption(id, seek) {
    state.selectedCaptionId = id;
    els.intelBtn.disabled = !id;
    if (seek) {
      var caption = findCaption(id);
      if (caption && state.videoLoaded) els.video.currentTime = caption.start;
    }
    renderTranscript();
    renderTimeline();
    drawFrame();
    setStatus(els.intelStatus, id ? 'Caption selected.' : '');
  }

  function editCaption(id, field, value) {
    var caption = findCaption(id);
    if (!caption) return;
    if (field === 'text') caption.text = value;
    if (field === 'start') caption.start = clamp(Number(value) || 0, 0, caption.end - .1);
    if (field === 'end') caption.end = clamp(Number(value) || caption.end, caption.start + .1, safeDuration());
    state.captions.sort(sortByStart);
    renderTimeline();
    drawFrame();
  }

  function deleteCaption(id) {
    state.captions = state.captions.filter(function (caption) { return caption.id !== id; });
    if (state.selectedCaptionId === id) state.selectedCaptionId = state.captions[0] ? state.captions[0].id : null;
    els.downloadSrtBtn.disabled = !state.captions.length;
    els.intelBtn.disabled = !state.selectedCaptionId;
    renderTranscript();
    renderTimeline();
    drawFrame();
  }

  // Guarded so this (now running every animation frame during playback
  // via startRenderLoop's tick()) doesn't touch the DOM when the active
  // caption hasn't actually changed since the last call.
  function highlightActiveCaption() {
    var active = activeCaption();
    var activeId = active ? active.id : null;
    if (activeId === state.timeline.lastActiveId) return;
    state.timeline.lastActiveId = activeId;
    document.querySelectorAll('.reels-caption-row').forEach(function (row) {
      row.classList.toggle('is-active-now', activeId != null && Number(row.dataset.id) === activeId);
    });
    if (state.timeline.nodes) {
      state.timeline.nodes.forEach(function (node, id) {
        node.classList.toggle('is-playing-now', id === activeId);
      });
    }
  }

  function updatePlayhead() {
    if (!state.videoLoaded || !els.video.duration) {
      els.playhead.hidden = true;
      return;
    }
    if (state.timeline.drag && state.timeline.drag.kind === 'playhead') return;
    els.playhead.hidden = false;
    var x = timeToPx(els.video.currentTime);
    els.playhead.style.transform = 'translateX(' + x.toFixed(2) + 'px)';
    els.playhead.setAttribute('aria-valuenow', String(Math.round(els.video.currentTime)));
    els.playhead.setAttribute('aria-valuemax', String(Math.round(safeDuration())));
    els.playhead.setAttribute('aria-valuetext', formatTime(els.video.currentTime));

    // Auto-follow: keep the playhead roughly in view while zoomed, without
    // fighting a manual pan/zoom (which clears followPlayhead until the
    // playhead itself re-enters the viewport's middle 80%).
    var vp = els.timelineViewport;
    if (vp) {
      var visibleLeft = vp.scrollLeft + vp.clientWidth * 0.1;
      var visibleRight = vp.scrollLeft + vp.clientWidth * 0.9;
      var inMiddle = x >= visibleLeft && x <= visibleRight;
      if (inMiddle) state.timeline.followPlayhead = true;
      if (state.timeline.followPlayhead && !inMiddle) {
        vp.scrollLeft = clamp(x - vp.clientWidth * 0.25, 0, Math.max(0, els.timelineCanvas.clientWidth - vp.clientWidth));
      }
    }
  }

  function renderStyleGrid() {
    els.styleSelect.innerHTML = CAPTION_STYLES.map(function (style) {
      return '<option value="' + escapeHtml(style.id) + '">' + escapeHtml(style.name) + '</option>';
    }).join('');
    els.styleSelect.value = state.style.id;
    syncCustomSelect('styleSelect');
  }

  function initBrandControls() {
    var sports = getSports();
    els.sportSelect.innerHTML = sports.map(function (sport) {
      return '<option value="' + escapeHtml(sport) + '">' + escapeHtml(sport) + '</option>';
    }).join('');
    onSportChange(sports[0] || '');
  }

  function onSportChange(sport) {
    state.sport = sport;
    els.teamLabel.textContent = sport === 'Tennis' ? 'Variation' : 'Team';
    var teams = getTeams(sport);
    els.teamSelect.innerHTML = teams.map(function (team) {
      return '<option value="' + escapeHtml(team) + '">' + escapeHtml(formatTeamDisplayName(team)) + '</option>';
    }).join('');
    syncCustomSelect('sportSelect');
    syncCustomSelect('teamSelect');
    onTeamChange(teams[0] || '');
  }

  function onTeamChange(team) {
    state.team = team;
    state.pillPaletteIdx = 0;
    var entry = getActiveBrandEntry();
    var palette = getPaletteForWorkspace(entry);
    state.pillPalette = palette[0] || entry?.primary || { background: ES_BLUE, foreground: '#ffffff', mist: '#ffffff' };
    renderPaletteRow();
    els.styleName.textContent = state.style.name;
    setStatus(els.intelStatus, '');
    setStep('style');
    syncCustomSelect('teamSelect');
    renderStyleGrid();
    drawFrame();
  }

  function renderPaletteRow() {
    var entry = getActiveBrandEntry();
    var palette = getPaletteForWorkspace(entry);
    var pair = state.pillPalette || palette[state.pillPaletteIdx] || palette[0] || entry?.primary || { background: ES_BLUE, foreground: '#ffffff', mist: '#ffffff' };
    var textColor = getTextColorForPair(pair, entry);
    var pillLightClass = contrastRatio(pair.background, '#FFFFFF') < 1.2 ? ' is-light' : '';
    var textLightClass = contrastRatio(textColor, '#FFFFFF') < 1.2 ? ' is-light' : '';
    els.paletteRow.innerHTML =
      '<span class="reels-swatch' + pillLightClass + '" title="Pill ' + escapeHtml(pair.background) + '" aria-label="Pill color">' +
        '<span class="reels-swatch-inner" style="background:' + escapeHtml(pair.background) + '"></span></span>' +
      '<span class="reels-swatch' + textLightClass + '" title="Text ' + escapeHtml(textColor) + '" aria-label="Text color">' +
        '<span class="reels-swatch-inner" style="background:' + escapeHtml(textColor) + '"></span></span>';
  }

  async function applyIntelligence() {
    var caption = findCaption(state.selectedCaptionId);
    var prompt = els.intelPrompt.value.trim();
    if (!caption || !prompt) return;
    els.intelBtn.disabled = true;
    setStatus(els.intelStatus, 'Applying suggestion...');
    try {
      var result = await postJson(videoIntelligenceUrl(), {
        action: 'style',
        prompt: prompt,
        target: {
          kind: 'caption',
          text: caption.text,
          start: caption.start,
          end: caption.end,
          style: state.style,
          position: state.captionPosition,
        },
        brandKit: findBrandCandidates(prompt).slice(0, 8),
      });
      applyIntelligencePatch(result.patch || {});
      els.intelSource.textContent = result.provider || 'Intelligence';
      setStatus(els.intelStatus, result.summary || 'Updated selected caption.', 'good');
      els.intelPrompt.value = '';
    } catch (error) {
      setStatus(els.intelStatus, error.message || 'Could not apply that change.', 'error');
    } finally {
      els.intelBtn.disabled = !state.selectedCaptionId;
    }
  }

  function applyIntelligencePatch(patch) {
    var caption = findCaption(state.selectedCaptionId);
    if (caption && typeof patch.text === 'string') caption.text = patch.text;
    if (patch.position) {
      state.captionPosition = patch.position;
      els.captionPosition.value = patch.position;
      syncCustomSelect('captionPosition');
    }
    if (patch.style && typeof patch.style === 'object') {
      state.style = Object.assign({}, state.style, patch.style);
      state.pillPalette = Object.assign({}, getActivePalette(), {
        background: patch.style.background || getActivePalette().background,
        foreground: patch.style.foreground || getActivePalette().foreground,
        mist: patch.style.accent || patch.style.mist || getActivePalette().mist,
      });
    }
    els.styleName.textContent = patch.styleName || state.style.name;
    setStep('style');
    renderStyleGrid();
    renderTranscript();
    renderTimeline();
    drawFrame();
  }

  function renderLowerThirdGrid() {
    els.ltGrid.innerHTML = LOWER_THIRD_TEMPLATES.map(function (template) {
      return '<button type="button" class="reels-lt-card" data-template="' + template.id + '"><strong>' + escapeHtml(template.name) + '</strong></button>';
    }).join('');
    els.ltGrid.querySelectorAll('.reels-lt-card').forEach(function (button) {
      button.addEventListener('click', function () { addLowerThird(button.dataset.template); });
    });
  }

  function addLowerThird(templateId) {
    if (!state.videoLoaded) return;
    var template = LOWER_THIRD_TEMPLATES.find(function (item) { return item.id === templateId; });
    var start = els.video.currentTime || 0;
    state.lowerThirds.push({
      id: state.nextId++,
      templateId: templateId,
      primary: template.primary,
      secondary: template.secondary,
      start: start,
      end: Math.min(start + 4, els.video.duration || start + 4),
      background: state.style.background,
      foreground: state.style.foreground,
    });
    renderLowerThirdList();
    drawFrame();
  }

  function renderLowerThirdList() {
    els.ltCount.textContent = state.lowerThirds.length + ' placed';
    if (!state.lowerThirds.length) {
      els.ltList.innerHTML = '<p class="reels-empty-note">Place a lower third at the current playhead.</p>';
      return;
    }
    els.ltList.innerHTML = state.lowerThirds.map(function (item) {
      return '<div class="reels-lt-item"><span>' + escapeHtml(item.primary) + ' - ' + formatTime(item.start) + '-' + formatTime(item.end) + '</span><button type="button" class="reels-row-delete" data-id="' + item.id + '">x</button></div>';
    }).join('');
    els.ltList.querySelectorAll('button[data-id]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(button.dataset.id);
        state.lowerThirds = state.lowerThirds.filter(function (item) { return item.id !== id; });
        renderLowerThirdList();
        drawFrame();
      });
    });
  }

  function drawFrame() {
    var ctx = state.ctx;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (state.videoLoaded && els.video.videoWidth) drawCoverVideo(ctx);
    var current = els.video.currentTime || 0;
    state.lowerThirds.forEach(function (item) {
      if (current >= item.start && current < item.end) drawLowerThird(ctx, item);
    });
    var caption = activeCaption();
    if (caption) drawCaption(ctx, caption);
    state.renderedOnce = true;
  }

  function drawCoverVideo(ctx) {
    var vw = els.video.videoWidth;
    var vh = els.video.videoHeight;
    var scale = Math.max(STAGE_W / vw, STAGE_H / vh);
    var dw = vw * scale;
    var dh = vh * scale;
    ctx.drawImage(els.video, (STAGE_W - dw) / 2, (STAGE_H - dh) / 2, dw, dh);
  }

  // Single style, by design: one word at a time, centered, in whichever
  // vertical position (top/middle/bottom) the user picked. Position is a
  // fully independent control -- getCaptionBlockTop() is the only thing
  // that reads it, same as before.
  function drawCaption(ctx, caption) {
    var words = getCaptionWordBoxes(caption);
    if (!words.length) return;
    ctx.save();
    drawSingleWordCaption(ctx, words, caption);
    ctx.restore();
  }

  function getActiveCaptionWord(words, current) {
    var active = words[0];
    for (var i = 0; i < words.length; i += 1) {
      if (current >= words[i].start) active = words[i];
    }
    return active;
  }

  function drawSingleWordCaption(ctx, words, caption) {
    var current = els.video.currentTime || caption.start || 0;
    var word = getActiveCaptionWord(words, current);
    if (!word) return;

    var wordDuration = Math.max(0.001, word.end - word.start);
    var wordElapsed = clamp(current - word.start, 0, wordDuration);
    var introProgress = clamp(wordElapsed / Math.min(0.16, wordDuration * 0.6), 0, 1);
    var scale = 0.88 + 0.12 * easeOutBack(introProgress);
    var alpha = clamp(introProgress * 1.3, 0, 1);

    var safe = POST_SAFE_AREA;
    var fontSize = PILL_FONT_SIZE;
    var maxTextWidth = STAGE_W - safe * 2 - PILL_PAD_LEFT - PILL_PAD_RIGHT;
    var text = String(word.text || '').toUpperCase();

    ctx.font = '900 ' + fontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
    var textWidth = ctx.measureText(text).width;
    if (textWidth > maxTextWidth) {
      fontSize = Math.max(48, Math.floor(fontSize * (maxTextWidth / textWidth)));
      ctx.font = '900 ' + fontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
      textWidth = ctx.measureText(text).width;
    }

    var pillH = PILL_H;
    var pillW = Math.min(STAGE_W - safe * 2, textWidth + PILL_PAD_LEFT + PILL_PAD_RIGHT);
    var blockTopY = getCaptionBlockTop(pillH, safe);
    var palette = getActivePalette();
    var entry = getActiveBrandEntry();
    var bgColor = palette.background || ES_BLUE;
    var fgColor = getTextColorForPair(palette, entry);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(STAGE_W / 2, blockTopY + pillH / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = bgColor;
    roundRect(ctx, -pillW / 2, -pillH / 2, pillW, pillH, 0);
    ctx.fill();

    ctx.font = '900 ' + fontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var capMetrics = ctx.measureText('A');
    var capAscent = capMetrics.actualBoundingBoxAscent || Math.round(fontSize * 0.68);
    var capDescent = capMetrics.actualBoundingBoxDescent || 0;
    var textH = capAscent + capDescent;
    var topPad = Math.max(0, Math.round((pillH - textH) * 0.5));
    var baselineY = -pillH / 2 + Math.min(topPad + capAscent, pillH - capDescent - 2);
    ctx.fillText(text, 0, baselineY);
    ctx.restore();
  }

  function getCaptionWordBoxes(caption) {
    var captionText = String(caption.text || '').replace(/\s+/g, ' ').trim();
    if (!captionText) return [];
    var rawWords = normalizeTimedWords(caption.words, caption.start || 0);
    if (rawWords.length && wordTextKey(rawWords.map(function (word) { return word.text; }).join(' ')) === wordTextKey(captionText)) {
      return rawWords.map(function (word, index) {
        var start = Number(word.start);
        var end = Number(word.end);
        return {
          index: index,
          text: word.text,
          start: Number.isFinite(start) ? start : caption.start,
          end: Number.isFinite(end) && end > start ? end : (Number.isFinite(start) ? start + 0.28 : caption.start + (index + 1) * 0.28),
        };
      });
    }
    return synthesizeCaptionWords(captionText, caption);
  }

  function synthesizeCaptionWords(text, caption) {
    var pieces = text.split(/\s+/).filter(Boolean);
    var start = Number(caption.start) || 0;
    var end = Number(caption.end);
    if (!Number.isFinite(end) || end <= start) end = start + Math.max(CAPTION_MIN_SECONDS, pieces.length * 0.32);
    var duration = Math.max(0.2, end - start);
    return pieces.map(function (word, index) {
      var wordStart = start + duration * (index / pieces.length);
      var wordEnd = start + duration * ((index + 1) / pieces.length);
      return {
        index: index,
        text: word,
        start: wordStart,
        end: Math.max(wordStart + 0.08, wordEnd),
      };
    });
  }

  function wordTextKey(text) {
    return String(text || '').toLowerCase().replace(/[^\w']+/g, ' ').trim();
  }

  function easeOutBack(value) {
    var t = clamp(value, 0, 1) - 1;
    return 1 + t * t * ((1.70158 + 1) * t + 1.70158);
  }

  function getCaptionBlockTop(blockH, safe) {
    if (state.captionPosition === 'upper') return safe + 270;
    if (state.captionPosition === 'center') return Math.round((STAGE_H - blockH) / 2);
    return clamp(STAGE_H - 360 - blockH, safe, STAGE_H - safe - blockH);
  }

  function drawLowerThird(ctx, item) {
    ctx.save();
    var x = 72;
    var y = STAGE_H - 230;
    ctx.fillStyle = item.background || ES_BLUE;
    roundRect(ctx, x, y, 720, 118, 8);
    ctx.fill();
    ctx.fillStyle = item.foreground || '#fff';
    ctx.textAlign = 'left';
    ctx.font = '900 44px "Roboto Condensed", Arial, sans-serif';
    ctx.fillText(item.primary, x + 28, y + 48);
    ctx.font = '700 28px "Roboto Condensed", Arial, sans-serif';
    ctx.globalAlpha = .86;
    ctx.fillText(item.secondary, x + 28, y + 86);
    ctx.restore();
  }

  function activeCaption() {
    var current = els.video.currentTime || 0;
    return state.captions.find(function (caption) { return current >= caption.start && current < caption.end; }) || null;
  }

  function findCaption(id) {
    return state.captions.find(function (caption) { return caption.id === id; }) || null;
  }

  function getSports() {
    return Array.from(new Set((window.ES_BRAND_KIT || []).map(function (entry) { return entry.sport; }).filter(Boolean)));
  }

  function getTeams(sport) {
    return (window.ES_BRAND_KIT || [])
      .filter(function (entry) { return entry.sport === sport; })
      .map(function (entry) { return entry.variation || entry.team; })
      .filter(Boolean);
  }

  function getBrandEntry(sport, team) {
    return (window.ES_BRAND_KIT || []).find(function (entry) {
      return entry.sport === sport && (entry.variation || entry.team) === team;
    }) || null;
  }

  function getActiveBrandEntry() {
    return getBrandEntry(state.sport, state.team);
  }

  function getActivePalette() {
    return state.pillPalette || getActiveBrandEntry()?.primary || { background: ES_BLUE, foreground: '#ffffff', mist: '#ffffff' };
  }

  function getUniquePalette(entry) {
    var seen = {};
    return (entry?.palette || entry?.primary ? (entry.palette || [entry.primary]) : [{ background: ES_BLUE, foreground: '#ffffff', mist: '#ffffff' }])
      .filter(function (pair) {
        var key = [pair.background, pair.foreground, pair.mist].map(function (color) {
          return String(color || '').toLowerCase();
        }).join('|');
        if (!key || seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function getPaletteForWorkspace(entry) {
    return getUniquePalette(entry);
  }

  function getMistColorForPair(pair, entry) {
    if (pair?.mist && pair.mist.toLowerCase() !== String(pair.background || '').toLowerCase()) return pair.mist;
    var alternate = entry?.palette?.find(function (item) {
      return String(item.background || '').toLowerCase() !== String(pair?.background || '').toLowerCase();
    });
    if (alternate) return alternate.background;
    if (pair?.foreground && pair.foreground.toLowerCase() !== String(pair.background || '').toLowerCase()) return pair.foreground;
    return String(pair?.background || '').toLowerCase() === '#000000' ? '#ffffff' : '#000000';
  }

  function getTextColorForPair(pair, entry) {
    var bg = pair?.background || ES_BLUE;
    var mist = getMistColorForPair(pair, entry);
    if (mist && mist.toLowerCase() !== bg.toLowerCase() && contrastRatio(bg, mist) >= 2.4) return mist;
    return [mist, pair?.foreground, '#ffffff', '#000000']
      .filter(function (color, index, list) {
        return color && color.toLowerCase() !== bg.toLowerCase() &&
          list.findIndex(function (candidate) { return candidate?.toLowerCase() === color.toLowerCase(); }) === index;
      })
      .sort(function (a, b) { return contrastRatio(bg, b) - contrastRatio(bg, a); })[0] || '#ffffff';
  }

  function hexToRgb(hex) {
    var value = String(hex || '#000000').replace('#', '').trim();
    if (value.length === 3) value = value.split('').map(function (char) { return char + char; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function channelToLinear(value) {
    var channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var rgb = hexToRgb(hex);
    return 0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b);
  }

  function contrastRatio(a, b) {
    var light = Math.max(luminance(a), luminance(b));
    var dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  }

  function formatTeamDisplayName(team) {
    var keepUpper = { fc: true, cf: true, sc: true, usa: true, us: true, ny: true, la: true, dc: true, mlb: true, nba: true, nfl: true, nhl: true, wnba: true, ufc: true, cbb: true };
    return String(team || '').replace(/\S+/g, function (word) {
      var compact = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (keepUpper[compact]) return word.toUpperCase();
      return word.replace(/[A-Za-z]+/g, function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      });
    });
  }

  function findBrandCandidates(query) {
    var q = String(query || '').toLowerCase();
    if (!q) return [];
    return (window.ES_BRAND_KIT || []).filter(function (entry) {
      var haystack = [entry.sport, entry.team, entry.variation].join(' ').toLowerCase();
      return haystack && (haystack.indexOf(q) !== -1 || q.split(/\s+/).some(function (word) {
        return word.length > 2 && haystack.indexOf(word) !== -1;
      }));
    });
  }

  // MediaRecorder can only encode what the browser actually supports. Safari
  // supports real MP4 (H.264) output; Chrome/Firefox today generally don't —
  // a universal cross-browser MP4 guarantee would need an in-browser
  // transcode step (e.g. ffmpeg.wasm), which is new infrastructure beyond
  // "client-side canvas + MediaRecorder" and hasn't been signed off on. So:
  // use real MP4 wherever the browser can, and be honest about the
  // container/extension when it can't, rather than mislabeling WebM as .mp4.
  var MP4_CANDIDATES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=h264,aac', 'video/mp4'];
  var WEBM_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm'];

  function pickExportFormat() {
    var mp4 = MP4_CANDIDATES.find(function (t) { return MediaRecorder.isTypeSupported(t); });
    if (mp4) return { mimeType: mp4, ext: 'mp4' };
    var webm = WEBM_CANDIDATES.find(function (t) { return MediaRecorder.isTypeSupported(t); });
    return { mimeType: webm || 'video/webm', ext: 'webm' };
  }

  function startExport() {
    if (!state.videoLoaded || state.recording) return;
    var stream = createCaptionedExportStream();
    var format = pickExportFormat();
    state.exportFormat = format;
    state.recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    state.recordedChunks = [];
    state.recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) state.recordedChunks.push(event.data);
    };
    state.recorder.onstop = onExportStopped;
    state.recorder.start();
    state.recording = true;
    els.exportBtn.textContent = 'Stop & Download';
    setStatus(els.exportStatus, stream.getAudioTracks().length
      ? 'Recording captioned reel with original audio. The clip will play from the start.'
      : 'Recording captioned reel. This browser did not expose the original audio track.');
    els.video.currentTime = 0;
    els.video.play();
  }

  function createCaptionedExportStream() {
    var canvasStream = els.canvas.captureStream(30);
    var capture = els.video.captureStream || els.video.mozCaptureStream;
    if (!capture || typeof MediaStream === 'undefined') return canvasStream;
    try {
      var videoStream = capture.call(els.video);
      var output = new MediaStream(canvasStream.getVideoTracks());
      videoStream.getAudioTracks().forEach(function (track) {
        output.addTrack(track);
      });
      return output;
    } catch (error) {
      return canvasStream;
    }
  }

  function stopExport() {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    els.video.pause();
    state.recording = false;
    els.exportBtn.textContent = 'Export Captioned Reel';
  }

  function onExportStopped() {
    var format = state.exportFormat || { mimeType: 'video/webm', ext: 'webm' };
    var blob = new Blob(state.recordedChunks, { type: format.mimeType });
    var url = URL.createObjectURL(blob);
    var filename = 'es-captioned-reel.' + format.ext;
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setStatus(els.exportStatus, format.ext === 'mp4'
      ? 'Downloaded ' + filename
      : 'Downloaded ' + filename + ' — this browser can\'t encode MP4 directly, so it fell back to WebM.', 'good');
  }

  function downloadSrt() {
    var text = state.captions.map(function (caption, index) {
      return (index + 1) + '\n' + formatSrtTime(caption.start) + ' --> ' + formatSrtTime(caption.end) + '\n' + caption.text + '\n';
    }).join('\n');
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'es-reels-captions.srt';
    link.click();
  }

  function postJson(url, payload) {
    var fetcher = window.ESAuth && window.ESAuth.fetchWithAuth ? window.ESAuth.fetchWithAuth : fetch;
    return fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || data.detail || ('Request failed: ' + response.status));
        return data;
      });
    });
  }

  function videoIntelligenceUrl(search) {
    var path = '/api/es-video-intelligence' + (search || '');
    return isLocalPreviewHost() ? LIVE_API_ORIGIN + path : path;
  }

  function isLocalPreviewHost() {
    return ['localhost', '127.0.0.1', '::1'].indexOf(window.location.hostname) !== -1;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || '').split(',')[1] || '');
      };
      reader.onerror = function () { reject(new Error('Could not read the selected video file.')); };
      reader.readAsDataURL(file);
    });
  }

  function blobToBase64(blob) {
    return fileToBase64(blob);
  }

  function roundRect(ctx, x, y, width, height, radius) {
    // Clamp so a pill-style radius (e.g. height/2) on a narrow box (a
    // single short word) can't exceed half the box's own dimensions —
    // arcTo doesn't do this itself, and an over-large radius makes the
    // capsule ends overlap into a lens/eye shape instead of a clean pill.
    radius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function formatTime(time) {
    var safe = Math.max(0, Number(time) || 0);
    var minutes = Math.floor(safe / 60);
    var seconds = Math.floor(safe % 60);
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function formatSrtTime(time) {
    var safe = Math.max(0, Number(time) || 0);
    var hours = Math.floor(safe / 3600);
    var minutes = Math.floor((safe % 3600) / 60);
    var seconds = Math.floor(safe % 60);
    var ms = Math.floor((safe % 1) * 1000);
    return [hours, minutes, seconds].map(function (part) { return String(part).padStart(2, '0'); }).join(':') + ',' + String(ms).padStart(3, '0');
  }

  function sortByStart(a, b) {
    return a.start - b.start;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function varFallback(value, fallback) {
    return value || fallback;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
