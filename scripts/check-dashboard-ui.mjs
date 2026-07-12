#!/usr/bin/env node

import fs from 'node:fs';

const files = {
  html: 'dashboard.html',
  system: 'dashboard-ui-system.css',
  theme: 'theme.css',
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function assertContains(source, needle, failureMessage, successMessage) {
  if (!source.includes(needle)) fail(failureMessage);
  else pass(successMessage || failureMessage);
}

function assertBalancedCss(file, source) {
  let depth = 0;
  let minDepth = 0;
  for (const char of source) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    minDepth = Math.min(minDepth, depth);
  }
  if (depth !== 0 || minDepth < 0) fail(`${file} has unbalanced CSS braces`);
  else pass(`${file} has balanced CSS braces`);
}

const html = read(files.html);
const system = read(files.system);
const theme = read(files.theme);

const dashboardV2Index = html.indexOf('dashboard-v2.css');
const dashboardSystemIndex = html.indexOf('dashboard-ui-system.css?v=20260712-dashboard-system4');
const themeIndex = html.indexOf('theme.css');

if (dashboardV2Index === -1 || dashboardSystemIndex === -1 || themeIndex === -1) {
  fail('dashboard stylesheet links are missing or dashboard-ui-system cache key is stale');
} else if (!(dashboardV2Index < dashboardSystemIndex && dashboardSystemIndex < themeIndex)) {
  fail('dashboard stylesheet order is wrong; dashboard-ui-system must load after dashboard-v2 and before theme');
} else {
  pass('dashboard stylesheet order is correct');
}

assertBalancedCss(files.system, system);
assertBalancedCss(files.theme, theme);

assertContains(
  system,
  'Canonical dashboard component contract',
  'dashboard-ui-system.css is missing the canonical dashboard component contract',
  'canonical dashboard component contract exists'
);

assertContains(
  system,
  'body.dashboard-page .dashboard-app :where(',
  'dashboard-ui-system.css is missing the final dashboard font-size guard',
  'final dashboard font-size guard exists'
);

assertContains(
  system,
  'font-size: 14px !important;',
  'dashboard-ui-system.css does not enforce the 14px dashboard text minimum',
  'dashboard 14px text minimum is enforced'
);

assertContains(
  system,
  'body.dashboard-page .task-card-top',
  'dashboard task chip row normalization is missing',
  'dashboard task chip row normalization exists'
);

assertContains(
  system,
  'grid-template-columns: minmax(0, 1fr) max-content;',
  'dashboard task chip row is not using the fixed kanban grid contract',
  'dashboard task chip row uses the fixed kanban grid contract'
);

assertContains(
  system,
  'body.dashboard-page .task-card::before',
  'dashboard task priority stripe normalization is missing',
  'dashboard task priority stripe normalization exists'
);

assertContains(
  system,
  'body.dashboard-page .task-type',
  'dashboard task type chip normalization is missing',
  'dashboard task type chip normalization exists'
);

assertContains(
  system,
  'width: 100%;',
  'dashboard task type chip is not fluid inside the kanban grid',
  'dashboard task type chip is fluid inside the kanban grid'
);

assertContains(
  system,
  'width: 76px;',
  'dashboard priority chip compact fixed width is missing',
  'dashboard priority chip compact fixed width exists'
);

assertContains(
  system,
  'margin-top: auto;',
  'dashboard card metadata is not pinned consistently',
  'dashboard card metadata is pinned consistently'
);

assertContains(
  system,
  'body.dashboard-page .person-role-tools > .role-badge',
  'dashboard role badge normalization is missing',
  'dashboard role badge normalization exists'
);

assertContains(
  system,
  'width: min(100%, 260px) !important;',
  'dashboard role controls do not share one width contract',
  'dashboard role controls share one width contract'
);

assertContains(
  theme,
  'html[data-theme="dark"] body.dashboard-page .presence-state.is-online',
  'dark dashboard online color override is missing',
  'dark dashboard online color override exists'
);

assertContains(
  theme,
  'html[data-theme="dark"] body.dashboard-page .presence-state.is-offline',
  'dark dashboard offline color override is missing',
  'dark dashboard offline color override exists'
);

const finalLayerSources = [
  [files.html, html],
  [files.system, system],
  [files.theme, theme],
];

const tooSmall = [];
for (const [file, source] of finalLayerSources) {
  const matches = source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g);
  for (const match of matches) {
    const value = Number(match[1]);
    if (value < 14) {
      const line = source.slice(0, match.index).split('\n').length;
      tooSmall.push(`${file}:${line} uses ${value}px`);
    }
  }
}

if (tooSmall.length) {
  tooSmall.forEach(item => console.error(`❌ ${item}`));
  process.exitCode = 1;
} else {
  pass('final dashboard CSS/HTML layers contain no font-size below 14px');
}

if (process.exitCode) {
  console.error('\nDashboard UI guard failed.');
  process.exit(process.exitCode);
}

console.log('\nDashboard UI guard passed.');
