#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const startIndex = html.indexOf('function cleanAiImageSearchText');
const endIndex = html.indexOf('function onEntityPhotoUpload');
assert.ok(startIndex >= 0 && endIndex > startIndex, 'AI image functions not found');
const aiImageCode = html.slice(startIndex, endIndex);
const match = aiImageCode.match(/function cleanAiImageSearchText\([\s\S]*?\nfunction setAiImageButtonLoading/);
assert.ok(match, 'AI image query builder functions not found');
const queryBuilderCode = match[0].replace(/\nfunction setAiImageButtonLoading$/, '');

const values = new Map();
const sandbox = {
  activeWorkspace: 'instagram',
  state: {
    postType: 'cover',
    team: 'Los Angeles Lakers',
    sport: 'NBA',
    lines: ['BY ES STAFF'],
  },
  document: {
    getElementById(id) {
      return values.has(id) ? { value: values.get(id) } : null;
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(`
${queryBuilderCode}
this.extractEntityQueriesFromHeadline = extractEntityQueriesFromHeadline;
this.getActiveImageSearchQueries = getActiveImageSearchQueries;
this.getActiveHeadlineForImageSearch = getActiveHeadlineForImageSearch;
`, sandbox);

function setValues(entries = {}) {
  values.clear();
  Object.entries(entries).forEach(([key, value]) => values.set(key, value));
}

function asPlainArray(value) {
  return Array.from(value);
}

setValues({
  'pill-text': 'lebron james',
  'long-quote-name': 'BY ES STAFF',
});
assert.deepEqual(asPlainArray(sandbox.getActiveImageSearchQueries().slice(0, 4)), [
  'lebron james',
  'Los Angeles Lakers',
  'NBA',
]);
assert.equal(sandbox.getActiveHeadlineForImageSearch(), 'lebron james');

for (const entityName of [
  'serena williams',
  'max verstappen',
  'coco gauff',
  'patrick mahomes',
  'ronaldo',
]) {
  setValues({
    'pill-text': entityName,
    'long-quote-name': 'BY ES STAFF',
  });
  assert.equal(
    sandbox.getActiveImageSearchQueries()[0],
    entityName,
    `${entityName} should outrank hidden/default workspace values`
  );
}

sandbox.state.postType = 'stats-double-ent';
sandbox.state.sport = 'NBA';
sandbox.state.team = 'Houston Cougars';
sandbox.state.lines = ['Who won the trade?'];
setValues({
  'stats-double-first-name-primary': 'Luka',
  'stats-double-last-name-primary': 'Doncic',
  'stats-double-first-name-secondary': 'Victor',
  'stats-double-last-name-secondary': 'Wembanyama',
  'stats-double-headline': 'Who won the trade?',
  'pill-text': 'Who won the trade?',
});
assert.deepEqual(asPlainArray(sandbox.getActiveImageSearchQueries().slice(0, 5)), [
  'Luka Doncic',
  'Victor Wembanyama',
  'Who won the trade',
  'NBA',
]);

sandbox.state.postType = 'double-entity-quote';
sandbox.state.sport = 'Tennis';
sandbox.state.lines = ['A rivalry renewed'];
setValues({
  'double-name-primary': 'Serena Williams',
  'double-name-secondary': 'Venus Williams',
  'pill-text': 'A rivalry renewed',
});
assert.deepEqual(asPlainArray(sandbox.getActiveImageSearchQueries().slice(0, 4)), [
  'Serena Williams',
  'Venus Williams',
  'A rivalry renewed',
  'Tennis',
]);

sandbox.state.postType = 'long-quote';
sandbox.state.team = '';
sandbox.state.sport = 'Formula 1';
sandbox.state.lines = ['Speed, pressure, and legacy'];
setValues({
  'long-quote-name': 'Lewis Hamilton',
  'pill-text': 'Speed, pressure, and legacy',
});
assert.deepEqual(asPlainArray(sandbox.getActiveImageSearchQueries().slice(0, 4)), [
  'Lewis Hamilton',
  'Speed pressure and legacy',
  'Formula 1',
]);

assert.deepEqual(
  asPlainArray(sandbox.extractEntityQueriesFromHeadline('LeBron James makes history after Lakers win')),
  ['LeBron James']
);
assert.deepEqual(
  asPlainArray(sandbox.extractEntityQueriesFromHeadline('SERENA WILLIAMS STUNS TENNIS WORLD')),
  ['SERENA WILLIAMS']
);

console.log('AI image query builder regression test passed.');

const behaviorValues = new Map([
  ['pill-text', 'lebron james'],
  ['long-quote-name', 'BY ES STAFF'],
]);
const searchedQueries = [];
const statusMessages = [];
const behaviorSandbox = {
  activeWorkspace: 'instagram',
  state: {
    postType: 'cover',
    team: 'Los Angeles Lakers',
    sport: 'NBA',
    lines: ['BY ES STAFF'],
  },
  searchedQueries,
  statusMessages,
  aiImageSearchResults: [],
  aiImageLastQuery: '',
  aiImageLastSource: '',
  document: {
    getElementById(id) {
      return behaviorValues.has(id) ? { value: behaviorValues.get(id) } : null;
    },
  },
};

vm.createContext(behaviorSandbox);
vm.runInContext(`
${aiImageCode}
this.searchEsStorageImages = async query => {
  searchedQueries.push(query);
  return query.toLowerCase() === 'lebron james'
    ? {
        source: 'mcp-agency',
        results: [{ title: 'LeBron agency image', sourceUrl: 'https://image-cdn.essentiallysports.com/lebron.webp' }],
      }
    : { source: 'mcp-agency', results: [] };
};
this.renderAiImagePicker = (results, query) => {
  this.renderedResults = results;
  this.renderedQuery = query;
};
this.setStatus = message => statusMessages.push(message);
this.setAiImageButtonLoading = isLoading => {
  this.loadingState = isLoading;
};
`, behaviorSandbox);

await vm.runInContext('applyAiImageFromEsStorage()', behaviorSandbox);

assert.deepEqual(searchedQueries.slice(0, 3), [
  'lebron james',
]);
assert.equal(behaviorSandbox.renderedQuery, 'lebron james');
assert.equal(behaviorSandbox.aiImageLastSource, 'mcp-agency');
assert.deepEqual(JSON.parse(JSON.stringify(behaviorSandbox.renderedResults)), [
  { title: 'LeBron agency image', sourceUrl: 'https://image-cdn.essentiallysports.com/lebron.webp' },
]);
assert.equal(statusMessages.at(-1), '');
assert.equal(behaviorSandbox.loadingState, false);

console.log('AI image sequential entity fallback regression test passed.');

const pickerGrid = {
  innerHTML: '',
  children: [],
  appendChild(node) {
    this.children.push(node);
  },
};
const pickerQueryLabel = { textContent: '' };
const pickerSourceBadge = {
  textContent: '',
  fallbackClassApplied: false,
  classList: {
    toggle(className, isApplied) {
      if (className === 'is-fallback') pickerSourceBadge.fallbackClassApplied = Boolean(isApplied);
    },
  },
};
const pickerSandbox = {
  aiImageSearchResults: [],
  aiImageLastQuery: '',
  aiImageLastSource: 'wordpress-media',
  aiImageLastFallbackReason: 'Missing or invalid token.',
  document: {
    querySelector(selector) {
      if (selector === '[data-ai-image-picker-grid]') return pickerGrid;
      if (selector === '[data-ai-image-picker-query]') return pickerQueryLabel;
      if (selector === '[data-ai-image-picker-source]') return pickerSourceBadge;
      return null;
    },
    createElement(tagName) {
      return {
        tagName,
        className: '',
        type: '',
        dataset: {},
        children: [],
        setAttribute(name, value) {
          this[name] = value;
        },
        appendChild(node) {
          this.children.push(node);
        },
      };
    },
  },
};

vm.createContext(pickerSandbox);
vm.runInContext(`
${aiImageCode}
this.setAiImagePickerOpen = () => {};
renderAiImagePicker([
  { title: 'Fallback athlete', sourceUrl: 'https://www.essentiallysports.com/fallback.jpg' },
], 'LeBron James');
`, pickerSandbox);

assert.equal(pickerQueryLabel.textContent, '');
assert.equal(pickerSourceBadge.textContent, '');
assert.equal(pickerSourceBadge.fallbackClassApplied, false);

console.log('AI image picker metadata-hiding regression test passed.');
