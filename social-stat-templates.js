/*
 * Data models for two Social Media templates (4:5, 1080 x 1350):
 *
 *   ESStatTemplates.playerStatLine  "Player Stat Line": player photo, ES mark,
 *                                   team logo tile, name, opponent line and a
 *                                   grid of up to 7 stats.
 *   ESStatTemplates.teamRecord      "Team Record / Score": action photo, a
 *                                   round team logo badge, a huge record or
 *                                   score, the ESSENTIALLYSPORTS wordmark.
 *
 * Each model has createDefaultData(), normalizeData(value), updateField(data,
 * field, value) (and updateStat for the stat line). State lives on the
 * editor's `state.playerStatLineData` / `state.teamRecordData`; the photo is
 * the editor's main background photo (`state.photo`). Field reference:
 * project-docs/templates-player-stat-line.md.
 * UMD: window.ESStatTemplates in the browser, module.exports under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ESStatTemplates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  function cleanText(value, maxLength, fallback) {
    if (value == null) return String(fallback || '').slice(0, maxLength);
    return String(value).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, maxLength);
  }
  function cleanColor(value) {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : '';
  }
  // Logos: a library file/URL or an uploaded data URL. Anything else is dropped.
  const LOGO_SRC = /^(?:assets\/logos\/[a-z0-9-]+\/[a-z0-9-]+\.webp|assets\/league-logos\/[a-z0-9-]+\.svg|assets\/infographics\/logo-[a-z0-9-]+\.webp|https:\/\/a\.espncdn\.com\/i\/teamlogos\/[a-z0-9/-]+\.png|data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+)$/i;
  const LOGO_MODES = ['auto', 'library', 'upload', 'none'];
  // mode 'auto': the editor resolves the logo from the Sport + Team selects.
  function normalizeLogo(value) {
    const source = value && typeof value === 'object' ? value : {};
    const src = typeof source.src === 'string' && LOGO_SRC.test(source.src.trim()) ? source.src.trim() : '';
    let mode = LOGO_MODES.includes(source.mode) ? source.mode : (src ? 'library' : 'auto');
    if ((mode === 'library' || mode === 'upload') && !src) mode = 'auto';
    const colors = Array.isArray(source.colors) ? source.colors.map(cleanColor).filter(Boolean).slice(0, 2) : [];
    return {
      mode,
      src: mode === 'library' || mode === 'upload' ? src : '',
      id: mode === 'library' ? cleanText(source.id, 60, '') : '',
      name: cleanText(source.name, 80, ''),
      colors: mode === 'library' ? colors : [],
    };
  }
  function isLogoSource(src) { return LOGO_SRC.test(String(src || '')); }

  // ── Player Stat Line ──────────────────────────────────────────────────
  const STAT_SLOTS = 7;
  const STAT_LIMITS = Object.freeze({ firstName: 18, lastName: 24, opponent: 32, value: 7, label: 18 });
  // Sample stat line from the supplied reference design (labels and numbers
  // are placeholders people overwrite; Generate and the sports calendar fill
  // them from real data).
  const SAMPLE_STATS = Object.freeze([
    { value: '36', label: 'MINUTES PLAYED' },
    { value: '43', label: 'POINTS' },
    { value: '3', label: 'REBOUNDS' },
    { value: '9', label: 'ASSISTS' },
    { value: '1', label: 'STEALS' },
    { value: '0', label: 'BLOCKS' },
    { value: '13/28', label: 'FGM/FGA' },
  ]);
  const NUMBER_COLOR = '#F2E8D5'; // the cream of the reference numbers

  function normalizeStat(stat, index) {
    const source = stat && typeof stat === 'object' ? stat : {};
    return {
      id: 'stat-' + (index + 1),
      value: cleanText(source.value, STAT_LIMITS.value, ''),
      label: cleanText(source.label, STAT_LIMITS.label, '').toUpperCase(),
    };
  }

  function normalizePlayerStatLine(value) {
    const source = value && typeof value === 'object' ? value : {};
    const sourceStats = Array.isArray(source.stats) ? source.stats.slice(0, STAT_SLOTS) : [];
    const count = Math.round(Number(source.statCount));
    return {
      schemaVersion: SCHEMA_VERSION,
      firstName: cleanText(source.firstName, STAT_LIMITS.firstName, 'PLAYER').toUpperCase(),
      lastName: cleanText(source.lastName, STAT_LIMITS.lastName, 'NAME').toUpperCase(),
      opponent: cleanText(source.opponent, STAT_LIMITS.opponent, 'V/S OPPONENT').toUpperCase(),
      statCount: Number.isFinite(count) ? Math.max(1, Math.min(STAT_SLOTS, count)) : STAT_SLOTS,
      stats: Array.from({ length: STAT_SLOTS }, (_, index) => normalizeStat(sourceStats[index], index)),
      logo: normalizeLogo(source.logo),
      // '' = team colours (logo's team, else the Sport + Team selects).
      boxColor: cleanColor(source.boxColor),
      textColor: cleanColor(source.textColor),
      numberColor: cleanColor(source.numberColor) || NUMBER_COLOR,
    };
  }

  function createPlayerStatLine() {
    return normalizePlayerStatLine({ stats: SAMPLE_STATS.map(stat => Object.assign({}, stat)) });
  }

  function updatePlayerStatLine(data, field, value) {
    const current = normalizePlayerStatLine(data);
    if (!['firstName', 'lastName', 'opponent', 'statCount', 'boxColor', 'textColor', 'numberColor', 'logo'].includes(field)) return current;
    const patch = {};
    patch[field] = value;
    return normalizePlayerStatLine(Object.assign({}, current, patch));
  }

  function updateStat(data, index, patch) {
    const current = normalizePlayerStatLine(data);
    const at = Number(index);
    if (!Number.isInteger(at) || at < 0 || at >= STAT_SLOTS) return current;
    const stats = current.stats.map((stat, i) => (i === at ? Object.assign({}, stat, patch || {}) : stat));
    return normalizePlayerStatLine(Object.assign({}, current, { stats }));
  }

  // The visible stats: the first `statCount`, skipping slots with no value.
  function visibleStats(data) {
    const current = normalizePlayerStatLine(data);
    return current.stats.slice(0, current.statCount).filter(stat => stat.value || stat.label);
  }

  // Grid rows: the first stat alone, then rows of three (reference layout).
  function statRows(stats) {
    const list = Array.isArray(stats) ? stats : [];
    if (!list.length) return [];
    const rows = [list.slice(0, 1)];
    for (let i = 1; i < list.length; i += 3) rows.push(list.slice(i, i + 3));
    return rows;
  }

  // Box + text colours: explicit overrides win, else the team pair.
  function resolveLabelColors(data, teamPair) {
    const current = normalizePlayerStatLine(data);
    const pair = teamPair && typeof teamPair === 'object' ? teamPair : {};
    return {
      box: current.boxColor || cleanColor(pair.box) || '#FDB927',
      text: current.textColor || cleanColor(pair.text) || '#101114',
    };
  }

  // ── Team Record / Score ───────────────────────────────────────────────
  const RECORD_LIMITS = Object.freeze({ record: 12, subline: 40 });
  function normalizeTeamRecord(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      record: cleanText(source.record, RECORD_LIMITS.record, '10-0').toUpperCase(),
      subline: cleanText(source.subline, RECORD_LIMITS.subline, '').toUpperCase(),
      logo: normalizeLogo(source.logo),
      ringColor: cleanColor(source.ringColor), // '' = team primary colour
      recordColor: cleanColor(source.recordColor) || '#FFFFFF',
    };
  }
  function createTeamRecord() { return normalizeTeamRecord({}); }
  function updateTeamRecord(data, field, value) {
    const current = normalizeTeamRecord(data);
    if (!['record', 'subline', 'logo', 'ringColor', 'recordColor'].includes(field)) return current;
    const patch = {};
    patch[field] = value;
    return normalizeTeamRecord(Object.assign({}, current, patch));
  }

  return Object.freeze({
    SCHEMA_VERSION,
    isLogoSource,
    normalizeLogo,
    playerStatLine: Object.freeze({
      TYPE: 'player-stat-line',
      STAT_SLOTS,
      LIMITS: STAT_LIMITS,
      NUMBER_COLOR,
      createDefaultData: createPlayerStatLine,
      normalizeData: normalizePlayerStatLine,
      updateField: updatePlayerStatLine,
      updateStat,
      visibleStats,
      statRows,
      resolveLabelColors,
    }),
    teamRecord: Object.freeze({
      TYPE: 'team-record',
      LIMITS: RECORD_LIMITS,
      createDefaultData: createTeamRecord,
      normalizeData: normalizeTeamRecord,
      updateField: updateTeamRecord,
    }),
  });
});
