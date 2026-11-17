// Video Ads sound: what the exported MP4 (and the preview) hears.
//
// The clip's own audio is MUTED by default. The editor can choose:
//   muted     no audio track at all in the MP4
//   original  the clip's own sound
//   library   a track from the shared FrameUp audio library (audio-library.json)
//   upload    an mp3 / m4a / wav the editor uploads (this tab only, 15 MB cap)
// Music (library or upload) can also keep the clip's sound underneath: the
// clip is ducked to -12 dB under music at -6 dB, both adjustable.
//
// Pure maths and validation, plus createMixer(ac, …), which builds the Web
// Audio graph from whatever AudioContext it is given, so Node tests can pass
// a mock. No DOM. Shared with Reels Studio through audio-library.json only.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VideoAdsAudio = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const LIBRARY_URL = 'audio-library.json';
  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
  const EMPTY_LIBRARY = 'No tracks yet. Upload your own, or ask an admin to add library tracks.';
  const MODES = ['muted', 'original', 'library', 'upload'];
  const DEFAULTS = Object.freeze({
    mode: 'muted', // the clip's sound is off unless someone turns it on
    keepOriginal: false, // with music: the clip's sound underneath
    trackId: '',
    musicDb: -6,
    originalDb: 0, // the clip on its own
    duckDb: -12, // the clip under music
    fade: 0.5, // seconds in and out
    loop: true, // loop the track to the ad's length
    offset: 0, // seconds into the track where the ad starts
  });
  const DB_MIN = -40; // the slider floor: treated as silence
  const DB_MAX = 6;
  const FADE_MAX = 3;
  const UPLOAD_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'];
  const UPLOAD_EXT = /\.(mp3|m4a|wav)$/i;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);

  // Decibels to a gain multiplier; the slider floor is silence.
  function dbToGain(db) {
    const d = Number(db);
    if (!Number.isFinite(d) || d <= DB_MIN) return 0;
    return Math.pow(10, Math.min(DB_MAX, d) / 20);
  }

  // ─── Library ──────────────────────────────────────────────────────────────
  // audio-library.json: { version, about, tracks: [{ id, title, mood, bpm?,
  // durationSec, file: 'assets/audio/<id>.mp3', licence: { organic, paid, note },
  // addedBy, addedAt }] }. Bad entries are skipped (and listed), never fatal.
  function parseLibrary(json) {
    const out = { version: 1, about: '', tracks: [], skipped: [], empty: true, emptyMessage: EMPTY_LIBRARY };
    if (!json || typeof json !== 'object' || Array.isArray(json)) { out.skipped.push({ id: '', reason: 'not a library object' }); return out; }
    out.version = num(json.version, 1);
    out.about = typeof json.about === 'string' ? json.about : '';
    const seen = new Set();
    (Array.isArray(json.tracks) ? json.tracks : []).forEach((t, i) => {
      const skip = reason => out.skipped.push({ id: (t && t.id) || `#${i}`, reason });
      if (!t || typeof t !== 'object') return skip('not an object');
      const id = String(t.id || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return skip('id must be a lowercase slug');
      if (seen.has(id)) return skip('duplicate id');
      const title = String(t.title || '').trim();
      if (!title) return skip('missing title');
      const file = String(t.file || '').trim();
      // Same origin only, inside assets/audio/, so the browser can mix it (no CORS).
      if (!/^assets\/audio\/[A-Za-z0-9._-]+\.(mp3|m4a|wav)$/i.test(file) || file.includes('..')) return skip('file must be assets/audio/<name>.mp3|m4a|wav');
      const lic = t.licence && typeof t.licence === 'object' ? t.licence : null;
      if (!lic || typeof lic.organic !== 'boolean' || typeof lic.paid !== 'boolean') return skip('licence needs organic and paid true/false');
      if (!lic.organic && !lic.paid) return skip('licence clears neither organic nor paid use');
      const durationSec = num(t.durationSec, 0);
      seen.add(id);
      out.tracks.push({
        id, title, file,
        mood: String(t.mood || '').trim(),
        bpm: Number.isFinite(Number(t.bpm)) && Number(t.bpm) > 0 ? Math.round(Number(t.bpm)) : null,
        durationSec: durationSec > 0 ? durationSec : 0,
        licence: { organic: lic.organic, paid: lic.paid, note: String(lic.note || '').trim() },
        addedBy: String(t.addedBy || '').trim(),
        addedAt: String(t.addedAt || '').trim(),
      });
    });
    out.empty = out.tracks.length === 0;
    return out;
  }
  async function loadLibrary(fetcher, url = LIBRARY_URL) {
    try {
      const res = await fetcher(url, { cache: 'no-cache', credentials: 'same-origin' });
      if (!res || !res.ok) return { ...parseLibrary({ tracks: [] }), error: `Library unavailable (${res ? res.status : 'no response'})` };
      return parseLibrary(await res.json());
    } catch (error) {
      return { ...parseLibrary({ tracks: [] }), error: 'Library unavailable' };
    }
  }
  const licenceLabel = lic => (lic.paid && lic.organic ? 'Organic + paid' : lic.paid ? 'Paid ads only' : 'Organic only');

  // ─── Upload ───────────────────────────────────────────────────────────────
  function validateUpload(file) {
    if (!file) return { ok: false, error: 'Choose an audio file.' };
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '');
    const typeOk = UPLOAD_TYPES.includes(type);
    const extOk = UPLOAD_EXT.test(name);
    // Some systems send no type (or octet-stream) for .m4a: the extension decides then.
    if (!(typeOk || (extOk && (!type || type === 'application/octet-stream')))) return { ok: false, error: 'Use an MP3, M4A or WAV file.' };
    if (type.startsWith('video/')) return { ok: false, error: 'Use an MP3, M4A or WAV file.' };
    const size = Number(file.size) || 0;
    if (size <= 0) return { ok: false, error: 'That file is empty.' };
    if (size > MAX_UPLOAD_BYTES) return { ok: false, error: `That file is ${(size / 1048576).toFixed(1)} MB. The limit is 15 MB.` };
    return { ok: true, error: '' };
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  // Cleans a saved or edited sound choice. An upload never survives a reload
  // (the file lives in this tab only) and a library track must still exist.
  function normalize(raw, { library = null, hasUpload = false } = {}) {
    const s = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return s;
    if (MODES.includes(raw.mode)) s.mode = raw.mode;
    s.keepOriginal = raw.keepOriginal === true;
    s.trackId = typeof raw.trackId === 'string' ? raw.trackId.slice(0, 64) : '';
    s.musicDb = clamp(num(raw.musicDb, DEFAULTS.musicDb), DB_MIN, DB_MAX);
    s.originalDb = clamp(num(raw.originalDb, DEFAULTS.originalDb), DB_MIN, DB_MAX);
    s.duckDb = clamp(num(raw.duckDb, DEFAULTS.duckDb), DB_MIN, DB_MAX);
    s.fade = clamp(num(raw.fade, DEFAULTS.fade), 0, FADE_MAX);
    s.loop = raw.loop !== false;
    s.offset = Math.max(0, num(raw.offset, 0));
    if (s.mode === 'upload' && !hasUpload) s.mode = 'muted';
    if (s.mode === 'library' && library && !library.tracks.some(t => t.id === s.trackId)) s.mode = 'muted';
    return s;
  }
  // What persists per brand: the choice and the levels, never the file.
  function persistable(s) {
    const n = normalize(s, { hasUpload: true });
    return { mode: n.mode === 'upload' ? 'muted' : n.mode, keepOriginal: n.keepOriginal, trackId: n.trackId, musicDb: n.musicDb, originalDb: n.originalDb, duckDb: n.duckDb, fade: n.fade, loop: n.loop, offset: n.offset };
  }
  const usesMusic = s => s.mode === 'library' || s.mode === 'upload';
  const usesOriginal = s => s.mode === 'original' || (usesMusic(s) && s.keepOriginal);

  // Gain for each bus. Muted: both zero. Music + original: the clip is ducked.
  function levels(s, { clipHasAudio = true, hasMusic = true } = {}) {
    const music = usesMusic(s) && hasMusic ? dbToGain(s.musicDb) : 0;
    let original = 0;
    if (clipHasAudio && usesOriginal(s)) original = dbToGain(usesMusic(s) && hasMusic ? s.duckDb : s.originalDb);
    return { original, music };
  }
  // True when the MP4 should carry an audio track at all.
  function audible(s, opts = {}) {
    const l = levels(s, opts);
    return l.original > 0 || l.music > 0;
  }

  // ─── Fade / loop / offset maths ───────────────────────────────────────────
  // The fade can't be longer than half the ad.
  const fadeFor = (fade, duration) => clamp(Number(fade) || 0, 0, Math.max(0, duration / 2));
  // Envelope 0..1 at time t (seconds into the ad): linear fade in, hold, fade out.
  function envelope(t, duration, fade) {
    const d = Math.max(0, Number(duration) || 0);
    if (t < 0 || t > d || d === 0) return 0;
    if (t === d) return 0;
    const f = fadeFor(fade, d);
    if (f === 0) return 1;
    return clamp(Math.min(t / f, (d - t) / f), 0, 1);
  }
  // Ramp points to schedule from ad time `at`: [{ in: seconds from now, value }].
  // The first point is the current value (set immediately).
  function envelopeRamps(at, duration, fade) {
    const d = Math.max(0, Number(duration) || 0);
    const f = fadeFor(fade, d);
    const pts = [{ in: 0, value: envelope(at, d, fade) }];
    if (f > at) pts.push({ in: f - at, value: 1 }); // fade-in done
    if (d - f > at) pts.push({ in: d - f - at, value: 1 }); // hold until the fade-out
    if (d > at) pts.push({ in: d - at, value: 0 }); // silent at the end (instant with no fade)
    return pts;
  }
  // Where in the track ad time t falls. The track starts at `offset`; with
  // loop on it repeats the [offset, trackDuration) region; off, it ends.
  // Returns null once a non-looping track has run out.
  function trackPosition(t, { offset = 0, trackDuration = 0, loop = true } = {}) {
    const dur = Math.max(0, Number(trackDuration) || 0);
    if (dur <= 0) return null;
    const start = clampOffset(offset, dur);
    const span = dur - start;
    const raw = start + Math.max(0, t);
    if (raw < dur) return raw;
    if (!loop || span <= 0) return null;
    return start + ((raw - start) % span);
  }
  // The trim start must leave at least half a second of track to play.
  function clampOffset(offset, trackDuration) {
    const dur = Math.max(0, Number(trackDuration) || 0);
    return clamp(Number(offset) || 0, 0, Math.max(0, dur - 0.5));
  }
  // Plain words for the summary line.
  function describe(s, { track = null, upload = null, clipHasAudio = true } = {}) {
    if (s.mode === 'muted') return 'Muted';
    if (s.mode === 'original') return clipHasAudio ? 'Original clip audio' : 'Original (this clip has no sound)';
    const name = s.mode === 'library' ? (track ? track.title : 'Pick a track') : (upload ? upload.name : 'Upload a file');
    const chosen = s.mode === 'library' ? Boolean(track) : Boolean(upload);
    return chosen && s.keepOriginal && clipHasAudio ? `${name} + clip sound` : name;
  }

  // ─── Rights record (learning event, export log) ──────────────────────────
  function record(s, { track = null, upload = null, clip = null, rightsTicked = false, clipHasAudio = true } = {}) {
    const lv = levels(s, { clipHasAudio, hasMusic: s.mode === 'library' ? Boolean(track) : s.mode === 'upload' ? Boolean(upload) : false });
    const round = x => Math.round(x * 100) / 100;
    const base = { mode: s.mode, audible: lv.original > 0 || lv.music > 0 };
    if (s.mode === 'muted') return base;
    const original = usesOriginal(s) ? { original: { clipSource: (clip && clip.source) || '', clipUrl: (clip && clip.url) || '', db: usesMusic(s) ? s.duckDb : s.originalDb } } : {};
    if (s.mode === 'original') return { ...base, ...original };
    const music = { db: s.musicDb, fade: round(s.fade), loop: s.loop, offset: round(s.offset) };
    if (s.mode === 'library') return { ...base, ...original, track: track ? { id: track.id, title: track.title, licence: { ...track.licence } } : { id: s.trackId }, music };
    return { ...base, ...original, upload: { name: upload ? String(upload.name || '').slice(0, 120) : '', bytes: upload ? upload.size || 0 : 0, rightsConfirmed: Boolean(rightsTicked) }, music };
  }

  // ─── Web Audio graph ──────────────────────────────────────────────────────
  //   clip element ─► original gain ─┐
  //   track buffer ─► envelope ─► music gain ─┴─► bus ─► monitor ─► speakers
  //                                                └─► recorder (export)
  // sync(adTime, playing, duration) follows the video: it starts the track at
  // the right place, restarts it after a seek or a trim loop, and stops it on
  // pause. The preview and the export go through the same bus.
  function createMixer(ac, { mediaSource = null } = {}) {
    const bus = ac.createGain();
    const original = ac.createGain();
    const music = ac.createGain();
    const env = ac.createGain();
    original.gain.value = 0;
    music.gain.value = 0;
    env.gain.value = 0;
    if (mediaSource) mediaSource.connect(original);
    original.connect(bus);
    env.connect(music);
    music.connect(bus);
    let settings = { ...DEFAULTS };
    let buffer = null;
    let clipHasAudio = true;
    let node = null;
    let run = null; // { adStart, ctxStart, duration }

    function stopNode() {
      if (node) { try { node.stop(); } catch (error) { /* already stopped */ } try { node.disconnect(); } catch (error) { /* gone */ } }
      node = null;
      run = null;
      const p = env.gain;
      if (p.cancelScheduledValues) p.cancelScheduledValues(ac.currentTime);
      p.value = 0;
    }
    function startAt(adTime, duration) {
      stopNode();
      run = { adStart: adTime, ctxStart: ac.currentTime, duration };
      if (!buffer || !usesMusic(settings)) return;
      const pos = trackPosition(adTime, { offset: settings.offset, trackDuration: buffer.duration, loop: settings.loop });
      if (pos == null) return; // the track has run out: silence
      node = ac.createBufferSource();
      node.buffer = buffer;
      if (settings.loop) {
        node.loop = true;
        node.loopStart = clampOffset(settings.offset, buffer.duration);
        node.loopEnd = buffer.duration;
      }
      node.connect(env);
      const now = ac.currentTime;
      const p = env.gain;
      if (p.cancelScheduledValues) p.cancelScheduledValues(now);
      envelopeRamps(adTime, duration, settings.fade).forEach((pt, i) => {
        if (i === 0) p.setValueAtTime(pt.value, now);
        else p.linearRampToValueAtTime(pt.value, now + pt.in);
      });
      node.start(now, pos);
    }
    const api = {
      bus,
      nodes: { original, music, env },
      apply(next, { buffer: nextBuffer = buffer, clipHasAudio: has = clipHasAudio } = {}) {
        const restart = nextBuffer !== buffer || next.offset !== settings.offset || next.loop !== settings.loop || next.fade !== settings.fade || next.mode !== settings.mode;
        settings = { ...DEFAULTS, ...next };
        buffer = nextBuffer || null;
        clipHasAudio = has;
        const lv = levels(settings, { clipHasAudio, hasMusic: Boolean(buffer) });
        original.gain.value = lv.original;
        music.gain.value = lv.music;
        if (restart && run) { const r = run; const at = r.adStart + (ac.currentTime - r.ctxStart); startAt(at, r.duration); }
        return lv;
      },
      // Call on every frame while playing, and on play / pause / seek.
      sync(adTime, playing, duration) {
        if (!playing) { if (run) stopNode(); return; }
        if (!usesMusic(settings) || !buffer) { run = run || { adStart: adTime, ctxStart: ac.currentTime, duration }; return; }
        if (!run) { startAt(adTime, duration); return; }
        const expected = run.adStart + (ac.currentTime - run.ctxStart);
        if (Math.abs(expected - adTime) > 0.25 || Math.abs((run.duration || 0) - duration) > 0.05) startAt(adTime, duration);
      },
      stop: stopNode,
      audible: () => audible(settings, { clipHasAudio, hasMusic: Boolean(buffer) }),
      levels: () => ({ original: original.gain.value, music: music.gain.value }),
      playing: () => Boolean(node),
    };
    return api;
  }

  return {
    LIBRARY_URL, MAX_UPLOAD_BYTES, EMPTY_LIBRARY, MODES, DEFAULTS, DB_MIN, DB_MAX, FADE_MAX,
    dbToGain, parseLibrary, loadLibrary, licenceLabel, validateUpload,
    normalize, persistable, usesMusic, usesOriginal, levels, audible,
    envelope, envelopeRamps, trackPosition, clampOffset, describe, record, createMixer,
  };
}));
