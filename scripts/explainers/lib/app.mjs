// Opens a FrameUp page in the app tab: fake signed-in session, every external
// host blocked, media for stubbed clips answered locally, light theme.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './chrome.mjs';
import { FAKE_SESSION } from './server.mjs';

export async function setupPage(page, { base, mediaDir, width = 1440, height = 900 }) {
  const CLIP_BYTES = () => fs.readFileSync(path.join(mediaDir, 'broll.mp4'));
  const THUMBS = [0, 1, 2].map(i => fs.readFileSync(path.join(mediaDir, `broll-thumb-${i}.webp`)));
  const errors = [];
  page.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && (!m.params.entry.url || m.params.entry.url.startsWith(base))) errors.push('log: ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || '').replace(base, ''));
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const u = request.url;
      const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
      const ok = (type, buf) => page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: type }, { name: 'Content-Length', value: String(buf.length) }], body: buf.toString('base64') });
      if (/^https:\/\/fixtures\.test\/clip/.test(u)) ok('video/mp4', CLIP_BYTES());
      else if (/^https:\/\/fixtures\.test\/thumb-(\d)/.test(u)) ok('image/webp', THUMBS[Number(u.match(/thumb-(\d)/)[1]) % THUMBS.length]);
      else if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/.test(u)) page.send('Fetch.continueRequest', { requestId });
      else if (request.method === 'OPTIONS') page.send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [...cors, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' }], body: '' });
      else page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('null').toString('base64') });
    }
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await page.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  await page.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  // Anything not on the local server (Supabase, ES hosts, analytics) is answered locally.
  await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }, { urlPattern: 'http://*.supabase.co/*' }] });
  return errors;
}

export async function openApp(page, { base, path: pagePath, ready, local = {} }) {
  await page.send('Page.navigate', { url: `${base}/__blank` });
  for (let i = 0; i < 60 && (await page.evaluate('location.href').catch(() => '')) !== `${base}/__blank`; i++) await sleep(100);
  await page.evaluate(FAKE_SESSION);
  await page.evaluate(`(() => { localStorage.setItem('frameup-theme', 'light'); localStorage.setItem('frameup.theme', 'light'); const l = ${JSON.stringify(local)}; for (const k in l) { if (l[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, l[k]); } return 1; })()`);
  await page.send('Page.navigate', { url: `${base}${pagePath}` });
  const t = Date.now();
  while (Date.now() - t < 30000) {
    if (await page.evaluate(`(${ready}) && document.readyState === 'complete' && document.documentElement.style.visibility !== 'hidden'`).catch(() => false)) break;
    await sleep(150);
  }
  const where = await page.evaluate('location.pathname');
  if (/login/.test(where)) throw new Error('sign-in gate: ' + where);
  await page.evaluate(`(() => { document.documentElement.dataset.theme = 'light'; window.FrameUpTheme?.apply?.('light'); return 1; })()`).catch(() => {});
  // Hide the text caret blink and any corner promos that are not part of the walkthrough.
  await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '.frameup-tour-offer,.fu-tour-offer,[data-tour-offer],.tour-offer{display:none!important}'; document.head.append(s); return 1; })()`);
  await sleep(600);
}

// Debug helper: a screenshot plus the visible controls and their text.
export async function snapshot(page, file) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  return page.evaluate(`[...document.querySelectorAll('button,a,[role=radio],[role=tab],input,textarea,select,summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; }).map(e => { const r = e.getBoundingClientRect(); return [e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.dataset && Object.keys(e.dataset).length ? '[' + Object.entries(e.dataset).map(([k, v]) => k + '=' + v).join(',').slice(0, 60) + ']' : ''), (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 50), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(' | '); }).join('\\n')`);
}
