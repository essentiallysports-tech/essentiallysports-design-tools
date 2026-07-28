(function () {
  'use strict';

  var STAGE_W = 1080;
  var STAGE_H = 1920;
  var SEGMENT_LENGTH = 2.6;
  var DEFAULT_COLOR = { background: '#0a7dfa', foreground: '#ffffff' };

  var LOWER_THIRD_TEMPLATES = [
    { id: 'name-title', name: 'Name & Title', render: renderNameTitle },
    { id: 'score-bug', name: 'Score Bug', render: renderScoreBug },
    { id: 'quote-strip', name: 'Quote Strip', render: renderQuoteStrip },
    { id: 'matchup', name: 'Team Matchup', render: renderMatchup },
    { id: 'location', name: 'Location Tag', render: renderLocationTag },
    { id: 'handle', name: 'Social Handle', render: renderSocialHandle },
  ];

  var state = {
    videoLoaded: false,
    captions: [],
    lowerThirds: [],
    selected: null, // { kind: 'caption' | 'lowerThird', id }
    nextId: 1,
    recording: false,
    recordedChunks: [],
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.video = document.getElementById('reels-video');
    els.canvas = document.getElementById('reels-canvas');
    els.stageEmpty = document.getElementById('reels-stage-empty');
    els.fileInput = document.getElementById('reels-file-input');
    els.uploadBtn = document.getElementById('reels-upload-btn');
    els.playBtn = document.getElementById('reels-play-btn');
    els.scrub = document.getElementById('reels-scrub');
    els.time = document.getElementById('reels-time');
    els.exportBtn = document.getElementById('reels-export-btn');
    els.exportStatus = document.getElementById('reels-export-status');

    els.generateBtn = document.getElementById('reels-generate-btn');
    els.generateNote = document.getElementById('reels-generate-note');
    els.timelineWrap = document.getElementById('reels-caption-timeline-wrap');
    els.timeline = document.getElementById('reels-caption-timeline');
    els.timelineDuration = document.getElementById('reels-timeline-duration');
    els.regenerateBtn = document.getElementById('reels-regenerate-btn');

    els.captionDetail = document.getElementById('reels-caption-detail');
    els.captionEditText = document.getElementById('reels-caption-edit-text');
    els.captionEditStart = document.getElementById('reels-caption-edit-start');
    els.captionEditEnd = document.getElementById('reels-caption-edit-end');
    els.captionDeleteBtn = document.getElementById('reels-caption-delete-btn');
    els.captionPromptInput = document.getElementById('reels-caption-prompt-input');
    els.captionPromptApplyBtn = document.getElementById('reels-caption-prompt-apply-btn');
    els.captionPromptLog = document.getElementById('reels-caption-prompt-log');

    els.ltGrid = document.getElementById('reels-lt-grid');
    els.ltList = document.getElementById('reels-lt-list');
    els.ltDetail = document.getElementById('reels-lt-detail');
    els.ltPromptInput = document.getElementById('reels-lt-prompt-input');
    els.ltPromptApplyBtn = document.getElementById('reels-lt-prompt-apply-btn');
    els.ltPromptLog = document.getElementById('reels-lt-prompt-log');

    els.canvas.width = STAGE_W;
    els.canvas.height = STAGE_H;
    state.ctx = els.canvas.getContext('2d');

    els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', onFileChosen);
    els.playBtn.addEventListener('click', togglePlay);
    els.scrub.addEventListener('input', function () {
      els.video.currentTime = (Number(els.scrub.value) / 1000) * els.video.duration;
    });
    els.video.addEventListener('loadedmetadata', onVideoReady);
    els.video.addEventListener('seeked', onFirstFrameReady);
    els.video.addEventListener('error', onVideoError);
    els.video.addEventListener('timeupdate', syncScrub);
    els.video.addEventListener('play', startRenderLoop);
    els.video.addEventListener('pause', stopRenderLoop);
    els.video.addEventListener('ended', function () {
      stopRenderLoop();
      if (state.recording) stopExport();
    });

    els.generateBtn.addEventListener('click', generateCaptions);
    els.regenerateBtn.addEventListener('click', generateCaptions);
    els.captionEditText.addEventListener('input', onCaptionFieldEdit);
    els.captionEditStart.addEventListener('input', onCaptionFieldEdit);
    els.captionEditEnd.addEventListener('input', onCaptionFieldEdit);
    els.captionDeleteBtn.addEventListener('click', function () { deleteSelected('caption'); });
    els.captionPromptApplyBtn.addEventListener('click', function () {
      applyPrompt(els.captionPromptInput, els.captionPromptLog);
    });
    els.ltPromptApplyBtn.addEventListener('click', function () {
      applyPrompt(els.ltPromptInput, els.ltPromptLog);
    });

    els.exportBtn.addEventListener('click', function () {
      if (state.recording) stopExport(); else startExport();
    });

    initTabs();
    renderLowerThirdGrid();
    renderLowerThirdList();
  }

  // --- Tabs -----------------------------------------------------------

  function initTabs() {
    var tabs = document.querySelectorAll('.reels-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-active'); });
        document.querySelectorAll('.reels-tabpanel').forEach(function (p) { p.classList.remove('is-active'); });
        tab.classList.add('is-active');
        document.getElementById(tab.dataset.panel).classList.add('is-active');
      });
    });
  }

  // --- Brand kit (team colors, looked up only via the prompt) ---------------

  function getBrandKit() { return window.ES_BRAND_KIT || []; }
  function findBrandEntryByTeamName(query) {
    var q = query.toLowerCase();
    return getBrandKit().find(function (t) {
      var name = (t.team || t.variation || '').toLowerCase();
      return name && (name.indexOf(q) !== -1 || q.indexOf(name) !== -1);
    });
  }

  // --- Video loading -----------------------------------------------------

  function onFileChosen(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.videoLoaded = false;
    els.stageEmpty.style.display = 'grid';
    els.stageEmpty.innerHTML = '<span class="reels-spinner" aria-hidden="true"></span>Loading clip…';
    els.uploadBtn.disabled = true;
    var url = URL.createObjectURL(file);
    els.video.src = url;
    els.video.load();
  }

  function onVideoReady() {
    // loadedmetadata only guarantees dimensions, not a decoded frame — without
    // forcing a seek, drawImage can paint nothing and the canvas just looks
    // like the empty placeholder with no obvious feedback that anything loaded.
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
    els.generateBtn.disabled = false;
    els.generateNote.textContent = 'Ready — click Auto-Generate Captions to transcribe this clip.';
    drawFrame();
  }

  function onVideoError() {
    if (state.videoLoaded) return;
    els.stageEmpty.style.display = 'grid';
    els.stageEmpty.textContent = 'Couldn\'t load that clip — try a different file or format (MP4/WebM).';
    els.uploadBtn.disabled = false;
  }

  function togglePlay() {
    if (!state.videoLoaded) return;
    if (els.video.paused) els.video.play(); else els.video.pause();
  }

  function syncScrub() {
    if (!els.video.duration) return;
    els.scrub.value = Math.round((els.video.currentTime / els.video.duration) * 1000);
    els.time.textContent = formatTime(els.video.currentTime) + ' / ' + formatTime(els.video.duration);
  }

  function formatTime(t) {
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // --- Caption generation (stub — real transcription is a follow-up) --------

  function generateCaptions() {
    if (!state.videoLoaded) return;
    els.generateBtn.disabled = true;
    els.regenerateBtn.disabled = true;
    els.generateNote.hidden = false;
    els.generateNote.textContent = 'Generating captions…';
    setTimeout(function () {
      var duration = els.video.duration || 0;
      var segments = [];
      var t = 0;
      var n = 1;
      while (t < duration) {
        var end = Math.min(t + SEGMENT_LENGTH, duration);
        segments.push({
          id: state.nextId++,
          text: 'Caption ' + n + ' — tap to edit',
          start: t,
          end: end,
          background: DEFAULT_COLOR.background,
          foreground: DEFAULT_COLOR.foreground,
        });
        t = end;
        n++;
      }
      state.captions = segments;
      state.selected = null;
      els.generateNote.hidden = true;
      els.generateBtn.hidden = true;
      els.regenerateBtn.disabled = false;
      els.timelineWrap.hidden = false;
      els.timelineDuration.textContent = formatTime(duration);
      renderCaptionTimeline();
      hideCaptionDetail();
      drawFrame();
    }, 700);
  }

  // --- Render loop --------------------------------------------------------

  function startRenderLoop() {
    els.playBtn.textContent = '⏸';
    function tick() {
      if (els.video.paused || els.video.ended) return;
      drawFrame();
      state.rafId = requestAnimationFrame(tick);
    }
    state.rafId = requestAnimationFrame(tick);
  }
  function stopRenderLoop() {
    els.playBtn.textContent = '▶';
    if (state.rafId) cancelAnimationFrame(state.rafId);
    drawFrame();
  }

  function drawFrame() {
    var ctx = state.ctx;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (state.videoLoaded && els.video.videoWidth) drawCoverVideo(ctx);
    var t = els.video.currentTime || 0;
    state.lowerThirds.forEach(function (lt) { if (t >= lt.start && t < lt.end) drawLowerThird(ctx, lt); });
    state.captions.forEach(function (c) { if (t >= c.start && t < c.end) drawCaption(ctx, c); });
  }

  function drawCoverVideo(ctx) {
    var vw = els.video.videoWidth, vh = els.video.videoHeight;
    var scale = Math.max(STAGE_W / vw, STAGE_H / vh);
    var dw = vw * scale, dh = vh * scale;
    var dx = (STAGE_W - dw) / 2, dy = (STAGE_H - dh) / 2;
    ctx.drawImage(els.video, dx, dy, dw, dh);
  }

  function drawCaption(ctx, c) {
    ctx.save();
    ctx.font = '700 54px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'center';
    var maxWidth = STAGE_W - 120;
    var lines = wrapText(ctx, c.text.toUpperCase(), maxWidth);
    var lineHeight = 64;
    var blockHeight = lines.length * lineHeight + 40;
    var y = STAGE_H - 340 - blockHeight;
    lines.forEach(function (line, i) {
      var ty = y + i * lineHeight + lineHeight;
      var w = ctx.measureText(line).width + 48;
      ctx.fillStyle = c.background;
      roundRect(ctx, STAGE_W / 2 - w / 2, ty - lineHeight + 14, w, lineHeight - 12, 10);
      ctx.fill();
      ctx.fillStyle = c.foreground;
      ctx.fillText(line, STAGE_W / 2, ty);
    });
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    var words = text.split(' ');
    var lines = [];
    var current = '';
    words.forEach(function (w) {
      var test = current ? current + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLowerThird(ctx, lt) {
    var tpl = LOWER_THIRD_TEMPLATES.find(function (t) { return t.id === lt.template; });
    if (tpl) tpl.render(ctx, lt);
  }

  function renderNameTitle(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    roundRect(ctx, x, y, 560, 116, 8);
    ctx.fill();
    ctx.fillStyle = lt.foreground;
    ctx.font = '700 40px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(lt.primaryText || 'Name', x + 24, y + 52);
    ctx.font = '500 26px "Roboto Condensed", Arial, sans-serif';
    ctx.globalAlpha = .85;
    ctx.fillText(lt.secondaryText || 'Title', x + 24, y + 88);
    ctx.restore();
  }

  function renderScoreBug(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    roundRect(ctx, x, y, 320, 84, 8);
    ctx.fill();
    ctx.fillStyle = lt.foreground;
    ctx.font = '700 34px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(lt.primaryText || 'TEAM 00 - 00 TEAM', x + 20, y + 52);
    ctx.restore();
  }

  function renderQuoteStrip(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    ctx.fillRect(x, y, 680, 8);
    ctx.font = '500 32px "Roboto Condensed", Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText('"' + (lt.primaryText || 'Quote goes here') + '"', x, y + 48);
    ctx.restore();
  }

  function renderMatchup(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    roundRect(ctx, x, y, 620, 96, 8);
    ctx.fill();
    ctx.fillStyle = lt.foreground;
    ctx.font = '700 38px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lt.primaryText || 'TEAM A  vs  TEAM B', x + 310, y + 58);
    ctx.restore();
  }

  function renderLocationTag(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    roundRect(ctx, x, y, 380, 64, 32);
    ctx.fill();
    ctx.fillStyle = lt.foreground;
    ctx.font = '600 28px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('📍 ' + (lt.primaryText || 'Location'), x + 24, y + 42);
    ctx.restore();
  }

  function renderSocialHandle(ctx, lt) {
    var x = lt.x, y = lt.y;
    ctx.save();
    ctx.fillStyle = lt.background;
    roundRect(ctx, x, y, 340, 60, 30);
    ctx.fill();
    ctx.fillStyle = lt.foreground;
    ctx.font = '600 26px "Roboto Condensed", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('@' + (lt.primaryText || 'essentiallysports'), x + 24, y + 40);
    ctx.restore();
  }

  // --- Caption timeline (Instagram-style: tap a segment, drag its edges) ----

  function renderCaptionTimeline() {
    var duration = els.video.duration || 1;
    els.timeline.innerHTML = state.captions.map(function (c) {
      var left = (c.start / duration * 100).toFixed(2);
      var width = Math.max(1.5, (c.end - c.start) / duration * 100).toFixed(2);
      var isSel = state.selected && state.selected.kind === 'caption' && state.selected.id === c.id;
      return '<div class="reels-seg' + (isSel ? ' is-selected' : '') + '" data-id="' + c.id + '" ' +
        'style="left:' + left + '%;width:' + width + '%;background:' + c.background + ';color:' + c.foreground + '">' +
        '<span class="reels-seg-handle" data-handle="start"></span>' +
        '<span class="reels-seg-label">' + escapeHtml(c.text) + '</span>' +
        '<span class="reels-seg-handle" data-handle="end"></span></div>';
    }).join('');
    els.timeline.querySelectorAll('.reels-seg').forEach(function (segEl) {
      var id = Number(segEl.dataset.id);
      segEl.addEventListener('click', function (e) {
        if (e.target.dataset.handle) return;
        selectCaption(id);
      });
      segEl.querySelectorAll('.reels-seg-handle').forEach(function (handle) {
        handle.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          beginSegmentDrag(id, handle.dataset.handle);
        });
      });
    });
  }

  function beginSegmentDrag(id, edge) {
    var duration = els.video.duration || 1;
    var rect = els.timeline.getBoundingClientRect();
    function onMove(e) {
      var caption = state.captions.find(function (c) { return c.id === id; });
      if (!caption) return;
      var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      var time = ratio * duration;
      if (edge === 'start') caption.start = Math.min(time, caption.end - 0.2);
      else caption.end = Math.max(time, caption.start + 0.2);
      caption.start = Math.max(0, caption.start);
      caption.end = Math.min(duration, caption.end);
      renderCaptionTimeline();
      if (state.selected && state.selected.kind === 'caption' && state.selected.id === id) fillCaptionDetail(caption);
      drawFrame();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function selectCaption(id) {
    state.selected = { kind: 'caption', id: id };
    renderCaptionTimeline();
    var caption = state.captions.find(function (c) { return c.id === id; });
    if (caption) {
      els.captionDetail.hidden = false;
      fillCaptionDetail(caption);
    }
  }

  function fillCaptionDetail(caption) {
    els.captionEditText.value = caption.text;
    els.captionEditStart.value = caption.start.toFixed(1);
    els.captionEditEnd.value = caption.end.toFixed(1);
  }

  function hideCaptionDetail() {
    els.captionDetail.hidden = true;
  }

  function onCaptionFieldEdit() {
    if (!state.selected || state.selected.kind !== 'caption') return;
    var caption = state.captions.find(function (c) { return c.id === state.selected.id; });
    if (!caption) return;
    caption.text = els.captionEditText.value;
    var start = Number(els.captionEditStart.value);
    var end = Number(els.captionEditEnd.value);
    if (!isNaN(start)) caption.start = Math.max(0, start);
    if (!isNaN(end)) caption.end = Math.max(caption.start + 0.1, end);
    renderCaptionTimeline();
    drawFrame();
  }

  // --- Lower thirds ----------------------------------------------------------

  function renderLowerThirdGrid() {
    els.ltGrid.innerHTML = LOWER_THIRD_TEMPLATES.map(function (tpl) {
      return '<button type="button" class="reels-lt-card" data-template="' + tpl.id + '">' +
        '<div class="reels-lt-preview"><span>' + escapeHtml(tpl.name) + '</span></div>' +
        '<div class="reels-lt-name">' + escapeHtml(tpl.name) + '</div></button>';
    }).join('');
    els.ltGrid.querySelectorAll('.reels-lt-card').forEach(function (btn) {
      btn.addEventListener('click', function () { addLowerThird(btn.dataset.template); });
    });
  }

  function addLowerThird(templateId) {
    if (!state.videoLoaded) return;
    var start = els.video.currentTime || 0;
    var end = Math.min(start + 4, els.video.duration || start + 4);
    var id = state.nextId++;
    state.lowerThirds.push({
      id: id,
      template: templateId,
      start: start,
      end: end,
      x: 60,
      y: STAGE_H - 300,
      background: DEFAULT_COLOR.background,
      foreground: DEFAULT_COLOR.foreground,
      primaryText: 'Name',
      secondaryText: 'Title',
    });
    state.selected = { kind: 'lowerThird', id: id };
    renderLowerThirdList();
    drawFrame();
  }

  function renderLowerThirdList() {
    if (!state.lowerThirds.length) {
      els.ltList.innerHTML = '<p class="reels-empty-note">No lower thirds placed yet — pick a template above.</p>';
      els.ltDetail.hidden = true;
      return;
    }
    els.ltList.innerHTML = state.lowerThirds.map(function (lt) {
      var isSel = state.selected && state.selected.kind === 'lowerThird' && state.selected.id === lt.id;
      var tpl = LOWER_THIRD_TEMPLATES.find(function (t) { return t.id === lt.template; });
      return '<div class="reels-item' + (isSel ? ' is-selected' : '') + '" data-id="' + lt.id + '">' +
        '<span class="reels-item-swatch" style="background:' + lt.background + '"></span>' +
        '<div class="reels-item-body"><div class="reels-item-title">' + escapeHtml(tpl ? tpl.name : lt.template) + '</div>' +
        '<div class="reels-item-meta">' + formatTime(lt.start) + '–' + formatTime(lt.end) + '</div></div>' +
        '<div class="reels-item-actions"><button type="button" data-action="delete">✕</button></div></div>';
    }).join('');
    els.ltList.querySelectorAll('.reels-item').forEach(function (row) {
      var id = Number(row.dataset.id);
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-action="delete"]')) {
          var idx = state.lowerThirds.findIndex(function (item) { return item.id === id; });
          if (idx !== -1) state.lowerThirds.splice(idx, 1);
          if (state.selected && state.selected.kind === 'lowerThird' && state.selected.id === id) state.selected = null;
          renderLowerThirdList();
          drawFrame();
          return;
        }
        state.selected = { kind: 'lowerThird', id: id };
        renderLowerThirdList();
      });
    });
    var stillSelected = state.selected && state.selected.kind === 'lowerThird' &&
      state.lowerThirds.some(function (lt) { return lt.id === state.selected.id; });
    els.ltDetail.hidden = !stillSelected;
  }

  function deleteSelected(kind) {
    if (!state.selected || state.selected.kind !== kind) return;
    var collection = kind === 'caption' ? state.captions : state.lowerThirds;
    var idx = collection.findIndex(function (item) { return item.id === state.selected.id; });
    if (idx !== -1) collection.splice(idx, 1);
    state.selected = null;
    if (kind === 'caption') { renderCaptionTimeline(); hideCaptionDetail(); }
    else renderLowerThirdList();
    drawFrame();
  }

  // --- Contextual prompt (local heuristic — Claude/MCP-backed version is next) --

  function applyPrompt(inputEl, logEl) {
    var prompt = inputEl.value.trim();
    if (!prompt || !state.selected) return;
    var collection = state.selected.kind === 'caption' ? state.captions : state.lowerThirds;
    var item = collection.find(function (i) { return i.id === state.selected.id; });
    if (!item) return;

    var applied = [];
    var brandMatch = findBrandEntryByTeamName(prompt);
    if (brandMatch) {
      item.background = brandMatch.primary.background;
      item.foreground = brandMatch.primary.foreground;
      applied.push('recolored to ' + (brandMatch.team || brandMatch.variation));
    }
    var lower = prompt.toLowerCase();
    if (state.selected.kind === 'lowerThird') {
      if (lower.indexOf('top') !== -1) { item.y = 140; applied.push('moved to top'); }
      else if (lower.indexOf('bottom') !== -1) { item.y = STAGE_H - 300; applied.push('moved to bottom'); }
      if (lower.indexOf('left') !== -1) { item.x = 60; applied.push('aligned left'); }
      else if (lower.indexOf('right') !== -1) { item.x = STAGE_W - 680; applied.push('aligned right'); }
      else if (lower.indexOf('center') !== -1 || lower.indexOf('centre') !== -1) { item.x = STAGE_W / 2 - 300; applied.push('centered'); }
    }

    if (!applied.length) applied.push('no recognized instruction — try a team name' + (state.selected.kind === 'lowerThird' ? ' or a position (top/bottom/left/right)' : ''));
    logPrompt(logEl, prompt, applied.join(', '));
    inputEl.value = '';
    if (state.selected.kind === 'caption') renderCaptionTimeline(); else renderLowerThirdList();
    drawFrame();
  }

  function logPrompt(logEl, prompt, result) {
    var entry = document.createElement('div');
    entry.className = 'reels-prompt-entry';
    entry.innerHTML = '<strong>"' + escapeHtml(prompt) + '"</strong><br>' + escapeHtml(result);
    logEl.prepend(entry);
  }

  // --- Export (client-side, canvas + MediaRecorder) -------------------------

  function startExport() {
    if (!state.videoLoaded) return;
    var stream = els.canvas.captureStream(30);
    var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    state.recorder = new MediaRecorder(stream, { mimeType: mimeType });
    state.recordedChunks = [];
    state.recorder.ondataavailable = function (e) { if (e.data.size) state.recordedChunks.push(e.data); };
    state.recorder.onstop = onExportStopped;
    state.recorder.start();
    state.recording = true;
    els.exportBtn.textContent = 'Stop & Download';
    els.exportStatus.textContent = 'Recording — play through the clip, then stop.';
    els.video.currentTime = 0;
    els.video.play();
  }

  function stopExport() {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    els.video.pause();
    state.recording = false;
    els.exportBtn.textContent = 'Export Reel';
  }

  function onExportStopped() {
    var blob = new Blob(state.recordedChunks, { type: 'video/webm' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'reel-export.webm';
    a.click();
    els.exportStatus.textContent = 'Downloaded reel-export.webm';
  }

  // --- Utils ---------------------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
