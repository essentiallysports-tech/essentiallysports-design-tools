#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const chromeCss = readFileSync(new URL('../site-chrome.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

async function renderFor(email) {
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <nav class="navbar-menu" aria-label="Primary">
          <a href="index.html">Home</a>
          <a href="dashboard.html" data-admin-only hidden aria-hidden="true">Dashboard</a>
          <a href="faq.html">FAQ</a>
        </nav>
      </body>
    </html>
  `);
  await page.addStyleTag({ content: chromeCss });
  await page.evaluate(currentEmail => {
    window.ESAuth = {
      getSession: async () => ({
        token: 'verified-render-test-token',
        user: { email: currentEmail, name: 'Render Test' },
      }),
      getSupabaseClient: () => null,
    };
  }, email);
  await page.addScriptTag({ content: dashboardSource });
  await page.evaluate(() => window.ESDashboardData.showAdminNavigation());
  return page.locator('[data-admin-only]').evaluate(element => ({
    hidden: element.hidden,
    ariaHidden: element.getAttribute('aria-hidden'),
    display: getComputedStyle(element).display,
    visibleClass: element.classList.contains('is-admin-visible'),
    rootAdminClass: document.documentElement.classList.contains('has-dashboard-admin'),
  }));
}

for (const email of [
  'designer@essentiallysports.com',
  'designteam@essentiallysports.com',
  'someone@gmail.com',
]) {
  const state = await renderFor(email);
  assert.deepEqual(state, {
    hidden: true,
    ariaHidden: 'true',
    display: 'none',
    visibleClass: false,
    rootAdminClass: false,
  }, `${email} must not see the Dashboard navigation option`);
}

for (const email of [
  'suhail.quraishi@essentiallysports.com',
  'manish.kalsi@essentiallysports.com',
]) {
  const state = await renderFor(email);
  assert.deepEqual(state, {
    hidden: false,
    ariaHidden: 'false',
    display: 'flex',
    visibleClass: true,
    rootAdminClass: true,
  }, `${email} must see the Dashboard navigation option`);
}

await browser.close();
console.log('Rendered dashboard navigation authorization tests passed.');
