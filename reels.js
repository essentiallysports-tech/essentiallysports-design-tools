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
  var CAPTION_PILL_OFFSETS = [0, -96, 84, -48];
  var LIVE_API_ORIGIN = 'https://essentiallysports-design-tools.vercel.app';

  var CAPTION_STYLES = [
    { id: 'social-pill', name: 'Social Pill', note: 'ES social media pill treatment', background: ES_BLUE, foreground: '#ffffff', mode: 'pill' },
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
    els.sportSelect.addEventListener('change', function () { onSportChange(els.sportSelect.value); });
    els.teamSelect.addEventListener('change', function () { onTeamChange(els.teamSelect.value); });
    els.intelBtn.addEventListener('click', applyIntelligence);
    els.exportBtn.addEventListener('click', function () {
      if (state.recording) stopExport(); else startExport();
    });

    initBrandControls();
    renderStyleGrid();
    renderLowerThirdGrid();
    renderLowerThirdList();
    renderTranscript();
    renderTimeline();
    refreshSpeechBackendStatus();
  }

  function mapElements() {
    [
      'canvas', 'stageEmpty', 'fileInput', 'video', 'uploadBtn', 'playBtn', 'scrub',
      'currentTime', 'totalTime', 'exportBtn', 'exportStatus', 'transcribeBtn',
      'addCaptionBtn', 'downloadSrtBtn', 'transcribeStatus', 'captionTimeline',
      'playhead', 'captionCount', 'transcriptList', 'transcriptSource', 'styleGrid',
      'styleName', 'captionPosition', 'sportSelect', 'teamSelect', 'teamLabel',
      'paletteRow', 'intelPrompt', 'intelBtn', 'intelStatus', 'intelSource',
      'ltGrid', 'ltList', 'ltCount'
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

  function refreshSpeechBackendStatus() {
    fetch(videoIntelligenceUrl('?health=public-probe'), { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (config) {
        if (!config) return;
        var probe = config.probe || {};
        if (probe.intelligenceToolFound) {
          els.intelSource.textContent = 'ES MCP Intelligence ready';
        } else if (config.mcpConfigured) {
          els.intelSource.textContent = 'Local rules until ES MCP adds Intelligence';
        } else {
          els.intelSource.textContent = 'Local rules fallback';
        }
        if (state.videoFile) return;
        if (config.groqFallbackConfigured) {
          setStatus(els.transcribeStatus, 'Speech backend ready: Groq Whisper captions. ES MCP is connected for available tools.', 'good');
        } else if (config.openAiFallbackConfigured) {
          setStatus(els.transcribeStatus, 'Speech backend ready: OpenAI captions. ES MCP is connected for available tools.', 'good');
        } else if (config.mcpConfigured && probe.transcribeToolFound) {
          setStatus(els.transcribeStatus, 'Speech backend ready: ES MCP speech recognition configured.', 'good');
        } else {
          setStatus(els.transcribeStatus, 'Speech backend needs a transcription provider before captions can generate.', 'error');
        }
      })
      .catch(function () {
        if (!state.videoFile) setStatus(els.transcribeStatus, 'Speech backend status could not be checked yet.');
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
    els.downloadSrtBtn.disabled = true;
    els.intelBtn.disabled = true;
    els.intelSource.textContent = 'Checking ES MCP';
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

    setStep('transcribe');
    els.transcribeBtn.disabled = true;
    setStatus(els.transcribeStatus, 'Extracting speech audio from the uploaded clip...');
    try {
      var result = await transcribeUploadedClip(state.videoFile);
      state.captions = normalizeSegments(formatCaptionBeats(result.segments || []));
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

  async function transcribeUploadedClip(file) {
    if (window.AudioContext || window.webkitAudioContext) {
      try {
        return await transcribeDecodedAudio(file);
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
    var chunks = sliceAudioSamples(decoded.samples, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_CHUNK_SECONDS);
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

  async function transcribeCapturedAudio(file) {
    if (typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
      throw new Error('Browser media capture is not available.');
    }
    var blobs = await captureAudioBlobs(file);
    if (!blobs.length) throw new Error('No audio track was captured from the uploaded clip.');
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
      var palette = getActivePalette();
      var background = palette.background || style.background;
      var foreground = getTextColorForPair(palette, getActiveBrandEntry()) || style.foreground;
      return '<button type="button" class="reels-style-card' + (style.id === state.style.id ? ' is-selected' : '') + '" data-style="' + style.id + '">' +
        '<div class="reels-style-preview" style="background:' + background + ';color:' + foreground + '">' + escapeHtml(style.name.toUpperCase()) + '</div>' +
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
    onTeamChange(teams[0] || '');
  }

  function onTeamChange(team) {
    state.team = team;
    state.pillPaletteIdx = 0;
    var entry = getActiveBrandEntry();
    var palette = getPaletteForWorkspace(entry);
    state.pillPalette = palette[0] || entry?.primary || { background: ES_BLUE, foreground: '#ffffff', mist: '#ffffff' };
    renderPaletteRow();
    els.styleName.textContent = formatTeamDisplayName(team || 'Social Pill') + ' Pill';
    setStatus(els.intelStatus, team ? 'Caption pills are using ' + formatTeamDisplayName(team) + ' colors.' : 'Caption pills are using the default ES color.', team ? 'good' : '');
    setStep('style');
    renderStyleGrid();
    drawFrame();
  }

  function renderPaletteRow() {
    var entry = getActiveBrandEntry();
    var palette = getPaletteForWorkspace(entry);
    els.paletteRow.innerHTML = palette.map(function (pair, index) {
      var active = index === state.pillPaletteIdx;
      var textColor = getTextColorForPair(pair, entry);
      var swatchBg = 'linear-gradient(135deg,' + escapeHtml(pair.background) + ' 0 62%,' + escapeHtml(textColor) + ' 62% 100%)';
      return '<button type="button" class="reels-swatch' + (active ? ' is-active' : '') + '" data-index="' + index + '" title="Pill ' + escapeHtml(pair.background) + ' / Text ' + escapeHtml(textColor) + '" aria-label="Caption color ' + (index + 1) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        '<span class="reels-swatch-inner" style="background:' + swatchBg + ';color:' + escapeHtml(textColor) + '"></span></button>';
    }).join('');
    els.paletteRow.querySelectorAll('.reels-swatch').forEach(function (button) {
      button.addEventListener('click', function () {
        var index = Number(button.dataset.index) || 0;
        state.pillPaletteIdx = index;
        state.pillPalette = palette[index] || palette[0] || state.pillPalette;
        renderPaletteRow();
        renderStyleGrid();
        drawFrame();
      });
    });
  }

  async function applyIntelligence() {
    var caption = findCaption(state.selectedCaptionId);
    var prompt = els.intelPrompt.value.trim();
    if (!caption || !prompt) return;
    els.intelBtn.disabled = true;
    setStatus(els.intelStatus, 'Sending caption context to the ES MCP intelligence path...');
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

  function drawCaption(ctx, caption) {
    var text = String(caption.text || '').toUpperCase();
    ctx.save();
    var scale = 1;
    var pillH = Math.round(PILL_H * scale);
    var padLeft = PILL_PAD_LEFT * scale;
    var padRight = PILL_PAD_RIGHT * scale;
    var fontSize = Math.round(PILL_FONT_SIZE * scale);
    ctx.font = '900 ' + fontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
    var maxTextWidth = STAGE_W - POST_SAFE_AREA * 2 - padLeft - padRight;
    var lines = wrapText(ctx, text, maxTextWidth).slice(0, 2);
    drawCaptionPills(ctx, lines, pillH, padLeft, padRight, fontSize);
    ctx.restore();
  }

  function drawCaptionPills(ctx, lines, pillH, padLeft, padRight, fontSize) {
    if (!lines.length) return;
    var safe = POST_SAFE_AREA;
    var maxCanvasW = STAGE_W - safe * 2;
    var activePillH = Math.min(pillH, Math.floor((STAGE_H - safe * 2) / Math.max(lines.length, 1)));
    activePillH = Math.max(28, activePillH);
    var activeFontSize = Math.round(fontSize * (activePillH / pillH));

    ctx.font = '900 ' + activeFontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    var maxTextW = 0;
    lines.forEach(function (line) {
      maxTextW = Math.max(maxTextW, ctx.measureText(line.toUpperCase()).width);
    });
    var maxTextAvailable = Math.max(1, maxCanvasW - padLeft - padRight);
    if (maxTextW > maxTextAvailable) {
      activeFontSize = Math.max(28, Math.floor(activeFontSize * (maxTextAvailable / maxTextW)));
      ctx.font = '900 ' + activeFontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
    }

    var capMetrics = ctx.measureText('A');
    var capAscent = capMetrics.actualBoundingBoxAscent || Math.round(activeFontSize * 0.68);
    var capDescent = capMetrics.actualBoundingBoxDescent || 0;
    var textH = capAscent + capDescent;
    var topPad = Math.max(0, Math.round((activePillH - textH) * 0.50));
    var textBaselineFromTop = Math.min(topPad + capAscent, activePillH - capDescent - 2);
    var activePillSpacing = Math.max(
      Math.round(activePillH * 0.55),
      activePillH - topPad + PILL_EDGE_TO_TEXT_GAP
    ) + PILL_ROW_GAP;

    var pillWidths = lines.map(function (line) {
      var textW = ctx.measureText(line.toUpperCase()).width;
      return Math.min(maxCanvasW, textW + padLeft + padRight);
    });
    var blockH = activePillH + (lines.length - 1) * activePillSpacing;
    var blockTopY = getCaptionBlockTop(blockH, safe);
    var blockCenterX = STAGE_W / 2;
    var palette = getActivePalette();
    var entry = getActiveBrandEntry();
    var bgColor = palette.background || ES_BLUE;
    var fgColor = getTextColorForPair(palette, entry);

    lines.forEach(function (line, index) {
      var pillW = pillWidths[index];
      var xOffset = getCaptionPillXOffset(index, lines.length);
      var pillX = clamp(blockCenterX + xOffset - pillW / 2, safe, STAGE_W - safe - pillW);
      var pillY = blockTopY + index * activePillSpacing;
      ctx.fillStyle = bgColor;
      ctx.fillRect(pillX, pillY, pillW, activePillH);
      ctx.fillStyle = fgColor;
      ctx.font = '900 ' + activeFontSize + 'px "' + POST_FONT_FAMILY + '", "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(line.toUpperCase(), pillX + padLeft, pillY + textBaselineFromTop);
    });
  }

  function getCaptionPillXOffset(index, total) {
    if (total <= 1) return 0;
    return CAPTION_PILL_OFFSETS[index % CAPTION_PILL_OFFSETS.length] || 0;
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
