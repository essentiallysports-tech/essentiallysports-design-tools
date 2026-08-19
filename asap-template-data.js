(function initAsapTemplate1Data(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ESAsapTemplate1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAsapTemplate1DataApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const ROW_COUNT = 6;
  const LIMITS = Object.freeze({
    title: 140,
    row: 90,
  });
  const DEFAULT_ROWS = Object.freeze([
    '5th August - 1st workout with Rams',
    '7th August - 2nd workout with Rams',
  ]);

  function cleanText(value, maxLength, fallback) {
    const safeFallback = fallback || '';
    if (value == null) return safeFallback.slice(0, maxLength);
    const normalized = String(value)
      .split('\n').join(' ')
      .split('\r').join(' ')
      .split('\t').join(' ')
      .replace(/ {2,}/g, ' ')
      .trim();
    return normalized.slice(0, maxLength);
  }

  function normalizeRow(row, index) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      id: 'asap-row-' + (index + 1),
      text: cleanText(source.text, LIMITS.row, ''),
    };
  }

  function normalizeData(value) {
    const source = value && typeof value === 'object' ? value : {};
    const sourceRows = Array.isArray(source.rows) ? source.rows.slice(0, ROW_COUNT) : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      title: cleanText(source.title, LIMITS.title, 'Headline Goes Here'),
      rows: Array.from({ length: ROW_COUNT }, function (_, index) { return normalizeRow(sourceRows[index], index); }),
    };
  }

  function createDefaultData() {
    return normalizeData({
      title: 'Aaron Donald has already completed 2 workouts with Rams',
      rows: DEFAULT_ROWS.map(function (text) { return { text: text }; }),
    });
  }

  function updateField(data, field, value) {
    const current = normalizeData(data);
    if (field !== 'title') return current;
    const patch = {};
    patch[field] = value;
    return normalizeData(Object.assign({}, current, patch));
  }

  function updateRow(data, rowIndex, patch) {
    const current = normalizeData(data);
    const index = Number(rowIndex);
    if (!Number.isInteger(index) || index < 0 || index >= ROW_COUNT) return current;
    const rows = current.rows.map(function (row, currentIndex) {
      return currentIndex === index ? Object.assign({}, row, patch || {}) : row;
    });
    return normalizeData(Object.assign({}, current, { rows: rows }));
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    ROW_COUNT: ROW_COUNT,
    LIMITS: LIMITS,
    createDefaultData: createDefaultData,
    normalizeData: normalizeData,
    updateField: updateField,
    updateRow: updateRow,
  });
});
