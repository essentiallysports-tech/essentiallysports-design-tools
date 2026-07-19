(function initListicleType2Data(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ESListicleType2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createListicleType2DataApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const ROW_COUNT = 5;
  const LIMITS = Object.freeze({
    title: 80,
    rank: 3,
    entity: 34,
    subtitle: 40,
    assetName: 120,
  });
  const DEFAULT_ACCENTS = Object.freeze(['#990000', '#007AC1', '#542C81', '#00471B', '#1D428A']);
  const DEFAULT_LOGO_SOURCES = Object.freeze([
    'assets/listicle-placeholders/clemson.png',
    'assets/listicle-placeholders/auburn.png',
    'assets/listicle-placeholders/oklahoma.png',
    'assets/listicle-placeholders/colorado.png',
    'assets/listicle-placeholders/georgia.png',
  ]);
  const DEFAULT_ROWS = Object.freeze([
    { rank: '1', entity: 'Nikola Jokic', subtitle: 'Denver Nuggets' },
    { rank: '2', entity: 'Shai Gilgeous', subtitle: 'Oklahoma City Thunder' },
    { rank: '3', entity: 'Luka Doncic', subtitle: 'Lakers' },
    { rank: '4', entity: 'Antetokounmpo', subtitle: 'Milwaukee Bucks' },
    { rank: '5', entity: 'Cade Cunningham', subtitle: 'Detroit Pistons' },
  ]);

  function cleanText(value, maxLength, fallback = '') {
    if (value == null) return fallback.slice(0, maxLength);
    return String(value)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/ {2,}/g, ' ')
      .slice(0, maxLength);
  }

  function cleanTitle(value, maxLength, fallback = '') {
    if (value == null) return fallback.slice(0, maxLength);
    const source = String(value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
    const sourceLines = source.split('\n');
    const lines = [sourceLines.shift() || '', sourceLines.join(' ')]
      .map(line => line.replace(/[ \t]+/g, ' '));
    const normalized = (lines[1] || source.includes('\n')) ? `${lines[0]}\n${lines[1]}` : lines[0];
    return normalized.slice(0, maxLength);
  }

  function cleanHex(value, fallback) {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : fallback;
  }

  function cleanImageSource(value) {
    if (typeof value !== 'string') return '';
    const source = value.trim();
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(source)) return source;
    if (/^assets\/listicle-placeholders\/[a-z0-9-]+\.png$/i.test(source)) return source;
    return '';
  }

  function normalizeRow(row, index) {
    const source = row && typeof row === 'object' ? row : {};
    const fallback = { rank: String(index + 1), entity: 'Player', subtitle: 'Team' };
    return {
      id: `listicle-type2-row-${index + 1}`,
      rank: cleanText(source.rank, LIMITS.rank, fallback.rank),
      entity: cleanText(source.entity, LIMITS.entity, fallback.entity),
      subtitle: cleanText(source.subtitle, LIMITS.subtitle, fallback.subtitle),
      accent: cleanHex(source.accent, DEFAULT_ACCENTS[index]),
      logoSrc: cleanImageSource(source.logoSrc),
      logoName: cleanText(source.logoName, LIMITS.assetName),
      playerSrc: cleanImageSource(source.playerSrc),
      playerName: cleanText(source.playerName, LIMITS.assetName),
    };
  }

  function normalizeListicleData(value) {
    const source = value && typeof value === 'object' ? value : {};
    const rows = Array.isArray(source.rows) ? source.rows.slice(0, ROW_COUNT) : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      title: cleanTitle(source.title, LIMITS.title, 'MVP Ladder\nUpdate'),
      rows: Array.from({ length: ROW_COUNT }, (_, index) => normalizeRow(rows[index], index)),
    };
  }

  function createDefaultListicleData() {
    return normalizeListicleData({
      rows: DEFAULT_ROWS.map((row, index) => ({
        ...row,
        accent: DEFAULT_ACCENTS[index],
        logoSrc: DEFAULT_LOGO_SOURCES[index],
        logoName: `Placeholder logo ${index + 1}`,
      })),
    });
  }

  function updateListicleField(data, field, value) {
    const current = normalizeListicleData(data);
    if (field !== 'title') return current;
    return normalizeListicleData({ ...current, title: value });
  }

  function updateListicleRow(data, rowIndex, patch) {
    const current = normalizeListicleData(data);
    const index = Number(rowIndex);
    if (!Number.isInteger(index) || index < 0 || index >= ROW_COUNT) return current;
    const rows = current.rows.map((row, currentIndex) => (
      currentIndex === index ? { ...row, ...(patch || {}) } : row
    ));
    return normalizeListicleData({ ...current, rows });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    ROW_COUNT,
    LIMITS,
    DEFAULT_ACCENTS,
    DEFAULT_LOGO_SOURCES,
    createDefaultListicleData,
    normalizeListicleData,
    updateListicleField,
    updateListicleRow,
  });
});
