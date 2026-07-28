(function () {
  'use strict';

  var STAGE_W = 1080;
  var STAGE_H = 1920;
  var MAX_INLINE_UPLOAD_BYTES = 28 * 1024 * 1024;
  var DEFAULT_STYLE_ID = 'broadcast';
  var ES_BLUE = '#0a7dfa';

  var CAPTION_STYLES = [
    { id: 'broadcast', name: 'Broadcast', note: 'Bold ES bar', background: ES_BLUE, foreground: '#ffffff', stroke: '#08111d', mode: 'bar' },
    { id: 'karaoke', name: 'Karaoke', note: 'Word focus', background: '#111316', foreground: '#ffffff', accent: '#ffd447', mode: 'karaoke' },
    { id: 'headline', name: 'Headline', note: 'Big center hit', background: '#ffffff', foreground: '#111316', stroke: ES_BLUE, mode: 'headline' },
    { id: 'clean', name: 'Clean', note: 'Subtle subtitle', background: 'rgba(0,0,0,.68)', foreground: '#ffffff', mode: 'clean' },
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
    transcriptSource: '',
    recording: false,
    renderedOnce: false,
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    mapElements();
    els.canvas.width = STAGE_W;
    els.canvas.height = STAGE_H;
    state.ctx = els.canvas.getContext('2d');

    els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', onFileChosen);
    els.video.addEventListener('loadedmetadata', onVideoMetadata);
    els.video.addEventListener('seeked', onFirstFrameReady);
    els.video.addEventListener('timeupdate', syncPlayback);
    els.video.addEventListener('play', startRenderLoop);
    els.video.addEventListener('pause', stopRenderLoop);
    els.video.addEventListener('ended', stopRenderLoop);
    els.video.addEventListener('error', onVideoError);
    els.playBtn.addEventListener('click', togglePlay);
    els.scrub.addEventListener('input', scrubVideo);
    els.transcribeBtn.addEventListener('click', transcribeVideo);
    els.addCaptionBtn.addEventListener('click', addCaptionAtPlayhead);
    els.downloadSrtBtn.addEventListener('click', downloadSrt);
    els.captionPosition.addEventListener('change', function () {
      state.captionPosition = els.captionPosition.value;
      setStep('style');
      drawFrame();
    });
    els.applyTeamBtn.addEventListener('click', applyTeamColorFromInput);
    els.intelBtn.addEventListener('click', applyIntelligence);
    els.exportBtn.addEventListener('click', function () {
      if (state.recording) stopExport(); else startExport();
    });

    renderStyleGrid();
    renderLowerThirdGrid();
    renderLowerThirdList();
    renderTranscript();
    renderTimeline();
  }

  function mapElements() {
    [
      'canvas', 'stageEmpty', 'fileInput', 'video', 'uploadBtn', 'playBtn', 'scrub',
      'currentTime', 'totalTime', 'exportBtn', 'exportStatus', 'transcribeBtn',
      'addCaptionBtn', 'downloadSrtBtn', 'transcribeStatus', 'captionTimeline',
      'playhead', 'captionCount', 'transcriptList', 'transcriptSource', 'styleGrid',
      'styleName', 'captionPosition', 'teamQuery', 'applyTeamBtn', 'intelPrompt',
      'intelBtn', 'intelStatus', 'intelSource', 'ltGrid', 'ltList', 'ltCount'
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

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-good', kind === 'good');
  }

  function onFileChosen(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    state.videoLoaded = false;
    state.videoFile = file;
    state.captions = [];
    state.lowerThirds = [];
    state.selectedCaptionId = null;
    state.transcriptSource = '';
    state.renderedOnce = false;
    els.stageEmpty.style.display = 'grid';
    els.stageEmpty.innerHTML = '<strong>Loading clip</strong><span>Preparing the first frame.</span>';
    els.uploadBtn.disabled = true;
    els.video.src = URL.createObjectURL(file);
    els.video.load();
    setStep('upload');
    setStatus(els.transcribeStatus, 'Clip selected. Speech recognition is ready when the video loads.');
    renderTranscript();
    renderTimeline();
    renderLowerThirdList();
  }

  function onVideoMetadata() {
    els.video.currentTime = 0;
  }

  function onFirstFrameReady() {
    if (state.videoLoaded) return;
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
    setStatus(els.transcribeStatus, 'Ready. Captions will be generated from the uploaded video audio.');
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
    var ratio = els.video.currentTime / els.video.duration;
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
    if (state.videoFile.size > MAX_INLINE_UPLOAD_BYTES) {
      setStatus(els.transcribeStatus, 'This local preview accepts clips up to 28 MB for speech recognition handoff.', 'error');
      return;
    }

    setStep('transcribe');
    els.transcribeBtn.disabled = true;
    setStatus(els.transcribeStatus, 'Extracting audio and sending it to the speech-recognition service...');
    try {
      var payload = {
        action: 'transcribe',
        fileName: state.videoFile.name,
        mimeType: state.videoFile.type || 'application/octet-stream',
        data: await fileToBase64(state.videoFile),
      };
      var result = await postJson('/api/es-video-intelligence', payload);
      state.captions = normalizeSegments(result.segments || []);
      state.transcriptSource = result.provider || 'speech recognition';
      state.selectedCaptionId = state.captions[0] ? state.captions[0].id : null;
      els.downloadSrtBtn.disabled = !state.captions.length;
      els.intelBtn.disabled = !state.selectedCaptionId;
      setStep(state.captions.length ? 'review' : 'transcribe');
      setStatus(els.transcribeStatus, state.captions.length
        ? 'Speech recognition complete. Review the transcript before export.'
        : 'Speech recognition finished, but no speech segments were returned.', state.captions.length ? 'good' : 'error');
      renderTranscript();
      renderTimeline();
      drawFrame();
    } catch (error) {
      setStep('transcribe');
      setStatus(els.transcribeStatus, error.message || 'Speech recognition failed.', 'error');
    } finally {
      els.transcribeBtn.disabled = false;
    }
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
    els.transcriptSource.textContent = state.transcriptSource || 'No speech recognition yet';
    if (!state.captions.length) {
      els.transcriptList.innerHTML = '<p class="reels-empty-note">Generated captions will appear here as editable transcript rows with start/end timings.</p>';
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

  function renderTimeline() {
    var duration = els.video.duration || 1;
    els.captionTimeline.innerHTML = state.captions.map(function (caption) {
      var left = clamp(caption.start / duration * 100, 0, 100);
      var width = clamp((caption.end - caption.start) / duration * 100, 1, 100 - left);
      return '<button type="button" class="reels-timeline-seg' + (caption.id === state.selectedCaptionId ? ' is-selected' : '') + '" data-id="' + caption.id + '" style="left:' + left.toFixed(3) + '%;width:' + width.toFixed(3) + '%">' +
        '<i class="reels-seg-handle" data-edge="start"></i><span>' + escapeHtml(caption.text) + '</span><i class="reels-seg-handle" data-edge="end"></i>' +
      '</button>';
    }).join('');
    els.captionTimeline.querySelectorAll('.reels-timeline-seg').forEach(function (segment) {
      var id = Number(segment.dataset.id);
      segment.addEventListener('click', function (event) {
        if (event.target.dataset.edge) return;
        selectCaption(id, true);
      });
      segment.querySelectorAll('.reels-seg-handle').forEach(function (handle) {
        handle.addEventListener('pointerdown', function (event) {
          event.preventDefault();
          event.stopPropagation();
          beginTimingDrag(id, handle.dataset.edge);
        });
      });
    });
    updatePlayhead();
  }

  function beginTimingDrag(id, edge) {
    var rect = els.captionTimeline.getBoundingClientRect();
    var duration = els.video.duration || 1;
    function onMove(event) {
      var caption = findCaption(id);
      if (!caption) return;
      var ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      var time = ratio * duration;
      if (edge === 'start') caption.start = clamp(time, 0, caption.end - .2);
      else caption.end = clamp(time, caption.start + .2, duration);
      state.captions.sort(sortByStart);
      renderTranscript();
      renderTimeline();
      drawFrame();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
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
    setStatus(els.intelStatus, id ? 'Ready for a caption-specific Intelligence pass.' : 'Select a caption row to use Intelligence.');
  }

  function editCaption(id, field, value) {
    var caption = findCaption(id);
    if (!caption) return;
    if (field === 'text') caption.text = value;
    if (field === 'start') caption.start = clamp(Number(value) || 0, 0, caption.end - .1);
    if (field === 'end') caption.end = clamp(Number(value) || caption.end, caption.start + .1, els.video.duration || caption.end);
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

  function highlightActiveCaption() {
    var active = activeCaption();
    document.querySelectorAll('.reels-caption-row').forEach(function (row) {
      row.classList.toggle('is-active-now', active && Number(row.dataset.id) === active.id);
    });
  }

  function updatePlayhead() {
    if (!state.videoLoaded || !els.video.duration) {
      els.playhead.hidden = true;
      return;
    }
    var cardRect = document.querySelector('.reels-timeline-card').getBoundingClientRect();
    var timelineRect = els.captionTimeline.getBoundingClientRect();
    var ratio = els.video.currentTime / els.video.duration;
    els.playhead.hidden = false;
    els.playhead.style.left = (timelineRect.left - cardRect.left + (timelineRect.width * ratio)) + 'px';
  }

  function renderStyleGrid() {
    els.styleGrid.innerHTML = CAPTION_STYLES.map(function (style) {
      return '<button type="button" class="reels-style-card' + (style.id === state.style.id ? ' is-selected' : '') + '" data-style="' + style.id + '">' +
        '<div class="reels-style-preview" style="background:' + style.background + ';color:' + style.foreground + '">' + escapeHtml(style.name.toUpperCase()) + '</div>' +
        '<strong>' + escapeHtml(style.name) + '</strong><span>' + escapeHtml(style.note) + '</span></button>';
    }).join('');
    els.styleGrid.querySelectorAll('.reels-style-card').forEach(function (button) {
      button.addEventListener('click', function () {
        state.style = CAPTION_STYLES.find(function (style) { return style.id === button.dataset.style; }) || state.style;
        els.styleName.textContent = state.style.name;
        setStep('style');
        renderStyleGrid();
        drawFrame();
      });
    });
  }

  function applyTeamColorFromInput() {
    var entry = findBrandEntry(els.teamQuery.value);
    if (!entry || !entry.primary) {
      setStatus(els.intelStatus, 'No team color match found in the ES brand kit.', 'error');
      return;
    }
    state.style = Object.assign({}, state.style, {
      background: entry.primary.background,
      foreground: entry.primary.foreground,
      accent: entry.primary.mist || entry.primary.background,
    });
    els.styleName.textContent = (entry.team || entry.variation || 'Brand') + ' ' + state.style.name;
    setStatus(els.intelStatus, 'Applied ' + (entry.team || entry.variation) + ' colors from the ES brand kit.', 'good');
    setStep('style');
    renderStyleGrid();
    drawFrame();
  }

  async function applyIntelligence() {
    var caption = findCaption(state.selectedCaptionId);
    var prompt = els.intelPrompt.value.trim();
    if (!caption || !prompt) return;
    els.intelBtn.disabled = true;
    setStatus(els.intelStatus, 'Sending caption context to the ES MCP intelligence path...');
    try {
      var result = await postJson('/api/es-video-intelligence', {
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
      setStatus(els.intelStatus, result.summary || 'Applied Intelligence update.', 'good');
      els.intelPrompt.value = '';
    } catch (error) {
      setStatus(els.intelStatus, error.message || 'Intelligence update failed.', 'error');
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
    }
    if (patch.style && typeof patch.style === 'object') state.style = Object.assign({}, state.style, patch.style);
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

  function drawCaption(ctx, caption) {
    var style = state.style;
    var text = caption.text.toUpperCase();
    var yMap = { upper: 330, center: 900, lower: 1450 };
    var centerY = yMap[state.captionPosition] || yMap.lower;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = (style.mode === 'headline' ? '900 86px ' : '900 64px ') + '"Roboto Condensed", Arial, sans-serif';
    var maxWidth = STAGE_W - 130;
    var lines = wrapText(ctx, text, maxWidth).slice(0, 3);
    var lineHeight = style.mode === 'headline' ? 92 : 74;
    var totalHeight = lines.length * lineHeight;
    lines.forEach(function (line, index) {
      var y = centerY - totalHeight / 2 + index * lineHeight + lineHeight / 2;
      var metrics = ctx.measureText(line);
      var boxWidth = Math.min(maxWidth + 42, metrics.width + 72);
      if (style.mode === 'bar' || style.mode === 'clean') {
        ctx.fillStyle = style.background;
        roundRect(ctx, (STAGE_W - boxWidth) / 2, y - lineHeight / 2 + 5, boxWidth, lineHeight - 10, 10);
        ctx.fill();
      }
      if (style.mode === 'headline') {
        ctx.lineWidth = 14;
        ctx.strokeStyle = style.stroke || style.background;
        ctx.strokeText(line, STAGE_W / 2, y);
      }
      if (style.mode === 'karaoke' && index === 0) {
        ctx.fillStyle = style.accent || varFallback(style.background, '#ffd447');
        roundRect(ctx, (STAGE_W - boxWidth) / 2, y - lineHeight / 2 + 5, boxWidth * .46, lineHeight - 10, 10);
        ctx.fill();
      }
      ctx.fillStyle = style.foreground;
      ctx.fillText(line, STAGE_W / 2, y);
    });
    ctx.restore();
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

  function findBrandEntry(query) {
    return findBrandCandidates(query)[0] || null;
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

  function startExport() {
    if (!state.videoLoaded || state.recording) return;
    var stream = els.canvas.captureStream(30);
    var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    state.recorder = new MediaRecorder(stream, { mimeType: mimeType });
    state.recordedChunks = [];
    state.recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) state.recordedChunks.push(event.data);
    };
    state.recorder.onstop = onExportStopped;
    state.recorder.start();
    state.recording = true;
    els.exportBtn.textContent = 'Stop & Download';
    setStatus(els.exportStatus, 'Recording the canvas. The clip will play from the start.');
    els.video.currentTime = 0;
    els.video.play();
  }

  function stopExport() {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    els.video.pause();
    state.recording = false;
    els.exportBtn.textContent = 'Export Captioned Reel';
  }

  function onExportStopped() {
    var blob = new Blob(state.recordedChunks, { type: 'video/webm' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'es-captioned-reel.webm';
    link.click();
    setStatus(els.exportStatus, 'Downloaded es-captioned-reel.webm', 'good');
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

  function wrapText(ctx, text, maxWidth) {
    var words = text.split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function roundRect(ctx, x, y, width, height, radius) {
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
