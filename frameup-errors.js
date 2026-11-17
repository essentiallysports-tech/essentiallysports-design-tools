// FrameUp error reporter: tells the team when something breaks in someone's
// browser, before they have to report it.
//
// Catches uncaught errors, unhandled promise rejections, failed page scripts
// and failed calls to FrameUp's own /api/* endpoints, and posts a scrubbed
// summary to /api/client-errors (signed-in people only; the server stores it
// for Dashboard → Errors and, when configured, forwards it to Sentry).
//
// Privacy: only the error message, the stack and the page path are sent.
// Never form contents, never request bodies. Emails, tokens, keys, passwords
// and every URL query string or #fragment are removed before sending.
//
// Noise: the same error is sent once per page load (repeats are counted), at
// most 5 reports a minute and 20 a page load. Reports wait for sign-in and
// are batched (up to 5 per request, under 8 KB).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const ENDPOINT = '/api/client-errors';
  const MAX_MESSAGE = 500;
  const MAX_STACK = 3000;
  const MAX_BODY = 7800; // the server refuses over 8 KB
  const BATCH_DELAY_MS = 2000;
  const PER_MINUTE = 5;
  const PER_PAGE = 20;
  const MAX_BATCH = 5;

  // ─── Scrubbing ────────────────────────────────────────────────────────────
  const SCRUBBERS = [
    // URLs: keep scheme, host and path, drop ?query and #fragment.
    [/\b((?:https?|wss?|blob):\/\/[^\s'"`<>()?#]*)[?#][^\s'"`<>()]*/gi, '$1'],
    [/\b(data:[a-z]+\/[a-z0-9.+-]+)[;,][^\s'"`<>()]*/gi, '$1,…'],
    // Bearer tokens, JWTs, API keys and other long secrets.
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, '[token]'],
    [/\b(?:sk|pk|rk|sb|sbp|ghp|gho|xox[abpr])[-_][A-Za-z0-9_-]{10,}/gi, '[key]'],
    [/\b(pass(?:word)?|pwd|secret|token|api[-_]?key|apikey|auth(?:orization)?|session|cookie|refresh_token|access_token)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[redacted]'],
    // Emails.
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
    // Long opaque strings (hashes, ids, base64 blobs).
    [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[long]'],
  ];

  function scrub(value, max = MAX_MESSAGE) {
    let text = String(value == null ? '' : value);
    SCRUBBERS.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  // A URL (or path) reduced to its path on this site, or origin + path elsewhere.
  function scrubUrl(value, origin = '') {
    const raw = String(value || '');
    if (!raw) return '';
    try {
      const url = new URL(raw, origin || 'https://frameup.invalid');
      if (url.protocol === 'blob:' || url.protocol === 'data:') return url.protocol;
      const sameSite = !origin ? url.origin === 'https://frameup.invalid' : url.origin === origin;
      return scrub(sameSite ? url.pathname : `${url.origin}${url.pathname}`, 300);
    } catch (error) {
      return scrub(raw.split(/[?#]/)[0], 300);
    }
  }

  function scrubStack(stack) {
    return scrub(String(stack || '').split('\n').slice(0, 15).join('\n'), MAX_STACK);
  }

  // Same error, same fingerprint: numbers and quoted values don't matter.
  function fingerprintOf(report) {
    const firstFrame = String(report.stack || '').split('\n').find(line => /:\d+/.test(line)) || '';
    const basis = [report.kind, report.message, report.source, firstFrame.replace(/:\d+:\d+\)?\s*$/, '')]
      .join('|')
      .replace(/\d+/g, 'N')
      .replace(/(["'`]).*?\1/g, '$1…$1');
    let hash = 2166136261;
    for (let index = 0; index < basis.length; index += 1) {
      hash ^= basis.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  // ─── Reporter (no browser globals, so it can be tested in Node) ───────────
  function createReporter({
    send,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    origin = '',
    page = () => '/',
    batchDelayMs = BATCH_DELAY_MS,
  } = {}) {
    const seen = new Map(); // fingerprint -> report waiting or sent
    const sentTimes = [];
    let sentThisPage = 0;
    let queue = [];
    let timer = null;
    let sending = false;

    function allowed() {
      const t = now();
      while (sentTimes.length && t - sentTimes[0] > 60000) sentTimes.shift();
      return sentTimes.length < PER_MINUTE && sentThisPage < PER_PAGE;
    }

    function normalize(input = {}) {
      const kind = ['error', 'rejection', 'api', 'resource'].includes(input.kind) ? input.kind : 'error';
      const report = {
        kind,
        message: scrub(input.message || 'Unknown error'),
        stack: scrubStack(input.stack),
        page: scrubUrl(input.page || page(), origin) || '/',
        source: scrubUrl(input.source, origin),
        line: Number.isFinite(input.line) ? Math.max(0, Math.round(input.line)) : null,
        col: Number.isFinite(input.col) ? Math.max(0, Math.round(input.col)) : null,
        status: Number.isFinite(input.status) ? Math.round(input.status) : null,
      };
      report.fingerprint = fingerprintOf(report);
      report.occurrences = 1;
      return report;
    }

    function capture(input) {
      const report = normalize(input);
      const existing = seen.get(report.fingerprint);
      if (existing) {
        // Repeats are counted on the waiting report; after it's sent, ignored.
        if (!existing.sent) existing.occurrences = Math.min(1000, existing.occurrences + 1);
        return false;
      }
      if (!allowed()) return false;
      seen.set(report.fingerprint, report);
      sentTimes.push(now());
      sentThisPage += 1;
      queue.push(report);
      schedule();
      return true;
    }

    function schedule() {
      if (timer || sending) return;
      timer = setTimer(() => { timer = null; flush(); }, batchDelayMs);
    }

    function bodyFor(batch) {
      let items = batch.slice(0, MAX_BATCH);
      let body = JSON.stringify({ errors: items });
      // Shrink until it fits: trim stacks first, then drop items.
      while (body.length > MAX_BODY && items.some(item => item.stack.length > 400)) {
        items = items.map(item => ({ ...item, stack: item.stack.slice(0, Math.max(400, Math.floor(item.stack.length / 2))) }));
        body = JSON.stringify({ errors: items });
      }
      while (body.length > MAX_BODY && items.length > 1) {
        items = items.slice(0, -1);
        body = JSON.stringify({ errors: items });
      }
      return { body, count: items.length };
    }

    async function flush() {
      if (sending || !queue.length) return;
      sending = true;
      const batch = queue.slice(0, MAX_BATCH);
      const { body, count } = bodyFor(batch);
      batch.slice(0, count).forEach(report => { report.sent = true; });
      queue = queue.slice(count);
      try {
        await send(body);
      } catch (error) {
        // Reporting must never cause more errors. Dropped.
      } finally {
        sending = false;
        if (queue.length) schedule();
      }
    }

    return { capture, flush, normalize, pending: () => queue.slice(), _seen: seen };
  }

  // ─── Browser wiring ───────────────────────────────────────────────────────
  function install(win) {
    if (!win || win.FrameUpErrors || win.top !== win) return;
    const nativeFetch = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
    if (!nativeFetch) return;
    const origin = win.location.origin;

    async function send(body) {
      const auth = win.ESAuth;
      if (!auth?.getSession) return;
      const session = await auth.getSession().catch(() => null);
      if (!session?.token) return; // signed out: the endpoint would refuse it
      await nativeFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body,
        keepalive: body.length < 60000,
        credentials: 'same-origin',
      }).catch(() => null);
    }

    const reporter = createReporter({ send, origin, page: () => win.location.pathname });

    win.addEventListener('error', event => {
      const target = event.target;
      if (target && target !== win && target.tagName) {
        // A page script or stylesheet failed to load (images are ignored).
        if (target.tagName !== 'SCRIPT' && !(target.tagName === 'LINK' && target.rel === 'stylesheet')) return;
        reporter.capture({ kind: 'resource', message: `${target.tagName === 'SCRIPT' ? 'Script' : 'Stylesheet'} failed to load`, source: target.src || target.href || '' });
        return;
      }
      const error = event.error;
      // Cross-origin scripts only say "Script error." with nothing to act on.
      if (!error && /^Script error\.?$/i.test(String(event.message || ''))) return;
      reporter.capture({
        kind: 'error',
        message: error?.message ? `${error.name || 'Error'}: ${error.message}` : event.message,
        stack: error?.stack,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
      });
    }, true);

    win.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      // A cancelled request (navigation, AbortController) is not a bug.
      if (reason?.name === 'AbortError') return;
      reporter.capture({
        kind: 'rejection',
        message: reason instanceof Error ? `${reason.name || 'Error'}: ${reason.message}` : `Unhandled rejection: ${typeof reason === 'string' ? reason : (() => { try { return JSON.stringify(reason); } catch (e) { return String(reason); } })()}`,
        stack: reason?.stack,
      });
    });

    // Failed calls to FrameUp's own API (5xx, 404, or no response at all).
    function apiPath(input) {
      try {
        const raw = typeof input === 'string' ? input : (input?.url || String(input));
        const url = new URL(raw, win.location.href);
        if (url.origin !== origin || !url.pathname.startsWith('/api/') || url.pathname === ENDPOINT) return '';
        return url.pathname;
      } catch (error) {
        return '';
      }
    }
    win.fetch = function frameupFetch(input, init) {
      const path = apiPath(input);
      const request = nativeFetch(input, init);
      if (!path) return request;
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      return request.then(response => {
        // 404 means a missing endpoint (a bad deploy), except /api/version,
        // which answers 404 on hosts without deploy info.
        if (response && (response.status >= 500 || (response.status === 404 && path !== '/api/version'))) {
          reporter.capture({ kind: 'api', message: `${method} ${path} returned ${response.status}`, source: path, status: response.status });
        }
        return response;
      }, error => {
        if (error?.name !== 'AbortError') {
          reporter.capture({ kind: 'api', message: `${method} ${path} failed: no response`, source: path, status: 0 });
        }
        throw error;
      });
    };

    win.addEventListener('pagehide', () => { reporter.flush(); });

    win.FrameUpErrors = Object.freeze({
      // For code that catches an error but still wants it seen.
      report(error, extra = {}) {
        return reporter.capture({
          kind: 'error',
          message: error?.message ? `${error.name || 'Error'}: ${error.message}` : String(error),
          stack: error?.stack,
          ...extra,
        });
      },
    });
  }

  return { createReporter, scrub, scrubUrl, scrubStack, fingerprintOf, install, ENDPOINT, MAX_BODY, PER_MINUTE, PER_PAGE };
}));
