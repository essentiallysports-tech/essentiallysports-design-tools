(function initListicleData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ESListicle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createListicleDataApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const ROW_COUNT = 5;
  const LIMITS = Object.freeze({
    title: 80,
    entityHeader: 18,
    metricHeader: 18,
    rank: 3,
    entity: 34,
    metric: 18,
    logoName: 120,
  });
  const DEFAULT_ACCENTS = Object.freeze(['#003278', '#C6011F', '#9C2130', '#DF4601', '#021540']);
  const DEFAULT_LOGO_SOURCES = Object.freeze([
    'assets/listicle-placeholders/clemson.png',
    'assets/listicle-placeholders/auburn.png',
    'assets/listicle-placeholders/oklahoma.png',
    'assets/listicle-placeholders/colorado.png',
    'assets/listicle-placeholders/georgia.png',
  ]);
  const DEFAULT_ROWS = Object.freeze([
    { rank: '1', entity: 'Texas Rangers', metric1: '716-808', metric2: '.470' },
    { rank: '2', entity: 'Cincinnati Reds', metric1: '705-821', metric2: '.462' },
    { rank: '3', entity: 'Los Angeles Angels', metric1: '690-836', metric2: '.452' },
    { rank: '4', entity: 'Baltimore Orioles', metric1: '689-838', metric2: '.451' },
    { rank: '5', entity: 'Detroit Tigers', metric1: '682-840', metric2: '.448' },
  ]);

  function cleanText(value, maxLength, fallback = '') {
    if (value == null) return fallback.slice(0, maxLength);
    const normalized = String(value)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/ {2,}/g, ' ');
    return normalized.slice(0, maxLength);
  }

  function cleanTitle(value, maxLength, fallback = '') {
    if (value == null) return fallback.slice(0, maxLength);
    const source = String(value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
    const sourceLines = source.split('\n');
    const lines = [
      sourceLines.shift() || '',
      sourceLines.join(' '),
    ].map(line => line.replace(/[ \t]+/g, ' '));
    const normalized = lines[1] || source.includes('\n')
      ? `${lines[0]}\n${lines[1]}`
      : lines[0];
    return normalized.slice(0, maxLength);
  }

  function cleanHex(value, fallback) {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : fallback;
  }

  function cleanLogoSource(value) {
    if (typeof value !== 'string') return '';
    const source = value.trim();
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(source)) return source;
    if (/^assets\/listicle-placeholders\/[a-z0-9-]+\.png$/i.test(source)) return source;
    return '';
  }

  function normalizeRow(row, index) {
    const source = row && typeof row === 'object' ? row : {};
    const fallback = { rank: String(index + 1), entity: 'Entity', metric1: '—', metric2: '—' };
    return {
      id: `listicle-row-${index + 1}`,
      rank: cleanText(source.rank, LIMITS.rank, fallback.rank),
      entity: cleanText(source.entity, LIMITS.entity, fallback.entity),
      metric1: cleanText(source.metric1, LIMITS.metric, fallback.metric1),
      metric2: cleanText(source.metric2, LIMITS.metric, fallback.metric2),
      accent: cleanHex(source.accent, DEFAULT_ACCENTS[index]),
      logoSrc: cleanLogoSource(source.logoSrc),
      logoName: cleanText(source.logoName, LIMITS.logoName),
    };
  }

  function normalizeListicleData(value) {
    const source = value && typeof value === 'object' ? value : {};
    const sourceRows = Array.isArray(source.rows) ? source.rows.slice(0, ROW_COUNT) : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      title: cleanTitle(source.title, LIMITS.title, 'Worst MLB Record in Last Decade'),
      entityHeader: cleanText(source.entityHeader, LIMITS.entityHeader, 'Team'),
      metric1Header: cleanText(source.metric1Header, LIMITS.metricHeader, 'Record'),
      metric2Header: cleanText(source.metric2Header, LIMITS.metricHeader, 'Win %'),
      rows: Array.from({ length: ROW_COUNT }, (_, index) => normalizeRow(sourceRows[index], index)),
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
    if (!['title', 'entityHeader', 'metric1Header', 'metric2Header'].includes(field)) return current;
    return normalizeListicleData({ ...current, [field]: value });
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
