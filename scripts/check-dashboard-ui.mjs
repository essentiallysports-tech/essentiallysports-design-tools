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
const dashboardSystemIndex = html.indexOf('dashboard-ui-system.css?v=20260718-dashboard-system5');
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
  'body.dashboard-page:is([data-dashboard-view="board"], [data-dashboard-view="list"]) .task-view-toolbar',
  'dashboard request control toolbar is missing',
  'dashboard request control toolbar exists'
);

assertContains(
  html,
  '<body class="dashboard-page" data-dashboard-view="overview">',
  'dashboard must declare Overview before JavaScript boots',
  'dashboard declares Overview before JavaScript boots'
);

assertContains(
  system,
  'grid-auto-columns: clamp(288px, 22vw, 304px);',
  'dashboard board is not using the compact fixed-width column contract',
  'dashboard board uses the compact fixed-width column contract'
);

assertContains(
  system,
  'body.dashboard-page .task-card::before',
  'dashboard task priority stripe normalization is missing',
  'dashboard task priority stripe normalization exists'
);

assertContains(
  system,
  'body.dashboard-page .task-card-heading',
  'dashboard compact task heading is missing',
  'dashboard compact task heading exists'
);

assertContains(
  html,
  'data-card-due',
  'dashboard cards are missing direct due-date editing',
  'dashboard cards include direct due-date editing'
);

assertContains(
  html,
  'data-task-quick-filter="mine"',
  'dashboard My tasks quick filter is missing',
  'dashboard My tasks quick filter exists'
);

assertContains(
  system,
  'body.dashboard-page .task-card-quick-controls',
  'dashboard task cards are missing direct assignment and priority controls',
  'dashboard task cards include direct assignment and priority controls'
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
