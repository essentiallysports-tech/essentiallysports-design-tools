// FrameUp impact: the pure logic behind "Posted it? Paste the link", UTM
// tags on copied links, the Meta Ads / Beehiiv CSV import and the admin
// Impact view. No DOM and no network here, so scripts/test-impact.mjs can run
// every function in Node.
//
// Browser: window.FrameUpImpact. Node: module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpImpact = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Platforms ─────────────────────────────────────────────────────────────
  const PLATFORMS = Object.freeze({
    instagram: 'Instagram',
    x: 'X',
    facebook: 'Facebook',
    threads: 'Threads',
    youtube: 'YouTube',
    newsletter: 'Newsletter',
    meta_ad: 'Meta ad',
    other: 'Link',
  });

  // Tracking parameters that never identify the post itself.
  const TRACKING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|igshid|igsh|mibextid|si|ref_src|ref_url|s|t|feature|rdid|share_id)$/i;

  function cleanText(value, max = 200) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function slug(value, max = 40) {
    return String(value || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '');
  }

  function parseUrl(input) {
    let text = cleanText(input, 2000);
    if (!text) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      // "instagram.com/p/abc" pasted without the scheme.
      if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text)) text = `https://${text}`;
      else return null;
    }
    try {
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function bareHost(url) {
    return url.hostname.toLowerCase().replace(/^(www|m|mobile|mbasic|web)\./, '');
  }

  // Same post, same key: lowercase host without www/m, no tracking params,
  // no hash, no trailing slash. Used to match imported rows to pasted links.
  function normalizeUrl(input) {
    const url = input instanceof URL ? new URL(input.href) : parseUrl(input);
    if (!url) return '';
    const host = bareHost(url);
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    const path = url.pathname.replace(/\/+$/, '') || '';
    return `https://${host}${path}${query}`;
  }

  const hostIs = (host, ...domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));

  // Works out where a pasted link points. Returns
  //   { ok: true, platform, label, externalId, url, normalizedUrl }
  // or { ok: false, error } with a sentence that says how to fix it.
  function detectPlatform(input) {
    const raw = cleanText(input, 2000);
    if (!raw) return { ok: false, error: 'Paste the link to the post.' };

    // A bare Meta ad id (Ads Manager shows these), e.g. 120210000000000000.
    if (/^\d{6,25}$/.test(raw)) {
      return { ok: true, platform: 'meta_ad', label: PLATFORMS.meta_ad, externalId: raw, url: '', normalizedUrl: '' };
    }

    const url = parseUrl(raw);
    if (!url) return { ok: false, error: 'That doesn’t look like a link. Copy it from the post’s Share menu.' };
    const host = bareHost(url);
    const parts = url.pathname.split('/').filter(Boolean);
    const result = (platform, externalId = '') => ({
      ok: true,
      platform,
      label: PLATFORMS[platform],
      externalId: cleanText(externalId, 200),
      url: url.href,
      normalizedUrl: normalizeUrl(url),
    });

    if (hostIs(host, 'instagram.com', 'instagr.am')) {
      const at = parts.findIndex(part => /^(p|reel|reels|tv)$/i.test(part));
      return result('instagram', at >= 0 ? parts[at + 1] || '' : '');
    }
    if (hostIs(host, 'x.com', 'twitter.com')) {
      const at = parts.findIndex(part => part === 'status' || part === 'statuses');
      return result('x', at >= 0 ? (parts[at + 1] || '').replace(/\D.*$/, '') : '');
    }
    if (hostIs(host, 'threads.net', 'threads.com')) {
      const at = parts.indexOf('post');
      return result('threads', at >= 0 ? parts[at + 1] || '' : '');
    }
    if (hostIs(host, 'youtube.com', 'youtu.be', 'youtube-nocookie.com')) {
      let id = '';
      if (host === 'youtu.be') id = parts[0] || '';
      else if (url.searchParams.get('v')) id = url.searchParams.get('v');
      else {
        const at = parts.findIndex(part => /^(shorts|live|embed)$/i.test(part));
        if (at >= 0) id = parts[at + 1] || '';
      }
      return result('youtube', id);
    }
    if (hostIs(host, 'facebook.com', 'fb.com', 'fb.watch')) {
      // Ad Library / Ads Manager links carry the ad id.
      const adId = url.searchParams.get('id') && parts[0] === 'ads'
        ? url.searchParams.get('id')
        : (url.searchParams.get('selected_ad_ids') || '').split(',')[0];
      if (adId && /^\d{6,25}$/.test(adId)) return result('meta_ad', adId);
      if (hostIs(host, 'business.facebook.com') || parts[0] === 'adsmanager') return result('meta_ad', '');
      const storyId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid') || url.searchParams.get('v');
      if (storyId) return result('facebook', storyId);
      const at = parts.findIndex(part => /^(posts|videos|reel|photos|permalink)$/i.test(part));
      const id = at >= 0 ? parts.slice(at + 1).reverse().find(part => /^[\w-]{5,}$/.test(part)) || '' : '';
      return result('facebook', host === 'fb.watch' ? parts[0] || '' : id);
    }
    if (hostIs(host, 'beehiiv.com') || /^(newsletter|newsletters)\./.test(host)) {
      const at = parts.indexOf('p');
      return result('newsletter', at >= 0 ? parts[at + 1] || '' : '');
    }
    return result('other', '');
  }

  // ── UTM ───────────────────────────────────────────────────────────────────
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // source/medium/campaign for a FrameUp design. campaign = brand + design id
  // (both slugged), so web analytics can attribute traffic to one design.
  function utmParams({ brand = '', designId = '', platform = '', medium = '', workspace = '', template = '' } = {}) {
    const brandSlug = slug(brand, 40) || 'essentiallysports';
    const idSlug = slug(designId, 60);
    const ws = String(workspace || '').toLowerCase();
    const resolvedMedium = medium
      || (platform === 'newsletter' || ws === 'newsletter' ? 'newsletter'
        : platform === 'meta_ad' || ws === 'video-ads' ? 'paid_social'
          : 'social');
    const params = {
      utm_source: slug(platform, 30) && platform !== 'other' ? slug(platform, 30) : 'frameup',
      utm_medium: resolvedMedium,
      utm_campaign: idSlug ? `${brandSlug}-${idSlug}` : brandSlug,
    };
    const content = slug(template, 60);
    if (content) params.utm_content = content;
    return params;
  }

  // Adds (or replaces) utm_* on an http(s) link and keeps everything else.
  // Anything that isn't an http(s) link comes back unchanged.
  function buildUtmUrl(input, params = {}) {
    const url = parseUrl(input);
    if (!url || !/^https?:\/\//i.test(String(input || '').trim())) return String(input || '');
    UTM_KEYS.forEach(key => {
      const value = cleanText(params[key], 200);
      if (value) url.searchParams.set(key, value);
    });
    return url.href;
  }

  // UTM tags on every http(s) <a href> in copied HTML (newsletter widgets).
  // Image src attributes are never touched, so hosted image links stay as
  // they are.
  function addUtmToHtml(html, params = {}) {
    return String(html || '').replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (match, before, quote, href) => {
      const decoded = href.replace(/&amp;/g, '&');
      const tagged = buildUtmUrl(decoded, params).replace(/&/g, '&amp;');
      return `${before}${quote}${tagged}${quote}`;
    });
  }

  function stripUtm(input) {
    const url = parseUrl(input);
    if (!url || !/^https?:\/\//i.test(String(input || '').trim())) return String(input || '');
    UTM_KEYS.forEach(key => url.searchParams.delete(key));
    return url.href;
  }

  // ── Ad naming: {brand}_{style}_{angle}_{WxH}_{yyyymmdd} ───────────────────
  const namePart = value => slug(value, 40).replace(/-/g, '') || 'na';

  function ymd(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    if (!Number.isFinite(d.getTime())) return '';
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function adName({ brand, style, angle, width, height, size, date } = {}) {
    const dims = size && /^\d+x\d+$/i.test(String(size)) ? String(size).toLowerCase() : (width && height ? `${Math.round(width)}x${Math.round(height)}` : 'na');
    return [namePart(brand), namePart(style), namePart(angle), dims, ymd(date) || 'na'].join('_');
  }

  // Reads an ad name back. Extra words in Ads Manager ("… - Copy", a prefix)
  // are tolerated: it looks for the WxH and yyyymmdd parts and takes the
  // three parts before WxH as brand, style, angle.
  function parseAdName(name) {
    const text = cleanText(name, 400).toLowerCase().replace(/\s+-\s+copy(\s+\d+)?$/, '');
    const parts = text.split('_').map(part => part.trim()).filter(Boolean);
    const sizeAt = parts.findIndex(part => /^\d{2,5}x\d{2,5}$/.test(part));
    if (sizeAt < 3) return null;
    const date = parts[sizeAt + 1] && /^\d{8}$/.test(parts[sizeAt + 1].slice(0, 8)) ? parts[sizeAt + 1].slice(0, 8) : '';
    const [brand, style, angle] = parts.slice(sizeAt - 3, sizeAt).map(part => part.split(/\s+/).pop());
    return { brand, style, angle, size: parts[sizeAt], date };
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  function sniffDelimiter(text) {
    const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
    const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  }

  // RFC 4180: quoted fields, "" escapes, CRLF or LF, a BOM, newlines inside
  // quotes. Returns { headers, rows } (rows are arrays of strings).
  function parseCsv(input, { delimiter } = {}) {
    const text = String(input || '').replace(/^﻿/, '');
    const sep = delimiter || sniffDelimiter(text);
    const records = [];
    let field = '';
    let record = [];
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === sep) { record.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        record.push(field); field = '';
        records.push(record); record = [];
      } else field += ch;
    }
    if (field !== '' || record.length) { record.push(field); records.push(record); }
    const nonEmpty = records.filter(row => row.some(cell => String(cell).trim() !== ''));
    const headers = (nonEmpty.shift() || []).map(cell => cleanText(cell, 120));
    return { headers, rows: nonEmpty.map(row => headers.map((_, index) => String(row[index] ?? '').trim())) };
  }

  // Column names from Meta Ads Manager and Beehiiv exports (2026), plus
  // common variants. Matching ignores case, punctuation and "(USD)"-style
  // suffixes.
  const IMPORT_FIELDS = Object.freeze({
    meta_ads: [
      ['ad_id', 'Ad ID', ['ad id']],
      ['ad_name', 'Ad name', ['ad name']],
      ['url', 'Destination URL', ['website url', 'link ad settings', 'destination url', 'link']],
      ['start', 'Reporting starts', ['reporting starts', 'day', 'date start', 'starts']],
      ['end', 'Reporting ends', ['reporting ends', 'date stop', 'ends']],
      ['impressions', 'Impressions', ['impressions']],
      ['reach', 'Reach', ['reach']],
      ['views', 'Views', ['views', 'video plays', '3 second video plays']],
      ['clicks', 'Link clicks', ['link clicks', 'clicks all', 'clicks', 'outbound clicks']],
      ['ctr', 'CTR', ['ctr link click through rate', 'ctr all', 'ctr', 'outbound ctr click through rate']],
      ['spend', 'Amount spent', ['amount spent', 'amount spent usd', 'spend']],
      ['results', 'Results', ['results', 'leads', 'subscriptions', 'purchases']],
      ['cost_per_result', 'Cost per result', ['cost per result', 'cost per results', 'cost per lead']],
    ],
    beehiiv: [
      ['post_id', 'Post ID', ['post id', 'id']],
      ['title', 'Title', ['title', 'post title', 'subject', 'subject line', 'name']],
      ['url', 'Post URL', ['web url', 'post url', 'url', 'link', 'web link']],
      ['start', 'Sent', ['publish date', 'published at', 'sent at', 'send date', 'date', 'created at', 'published']],
      ['recipients', 'Recipients', ['recipients', 'delivered', 'total sent', 'sent', 'email recipients']],
      ['opens', 'Unique opens', ['unique opens', 'opens', 'total opens', 'email opens']],
      ['open_rate', 'Open rate', ['open rate', 'email open rate']],
      ['clicks', 'Unique clicks', ['unique clicks', 'clicks', 'total clicks', 'email clicks']],
      ['ctr', 'Click rate', ['click rate', 'ctr', 'click through rate', 'email click rate']],
      ['web_views', 'Web views', ['web views', 'views']],
      ['unsubscribes', 'Unsubscribes', ['unsubscribes', 'unsubscribed']],
    ],
  });
  const NUMERIC_FIELDS = new Set(['impressions', 'reach', 'views', 'clicks', 'ctr', 'spend', 'results', 'cost_per_result', 'recipients', 'opens', 'open_rate', 'web_views', 'unsubscribes']);

  const headerKey = header => String(header || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  function detectCsvKind(headers = []) {
    const keys = headers.map(headerKey);
    const has = name => keys.includes(name);
    if (has('ad name') || has('ad id') || has('amount spent') || has('reporting starts')) return 'meta_ads';
    if (has('open rate') || has('unique opens') || has('recipients') || has('web url') || has('click rate')) return 'beehiiv';
    return '';
  }

  // { field: columnIndex } using the alias lists; first alias that matches wins.
  function guessMapping(headers = [], kind) {
    const keys = headers.map(headerKey);
    const used = new Set();
    const mapping = {};
    (IMPORT_FIELDS[kind] || []).forEach(([field, , aliases]) => {
      for (const alias of aliases) {
        const index = keys.findIndex((key, i) => !used.has(i) && key === alias);
        if (index >= 0) { mapping[field] = index; used.add(index); return; }
      }
    });
    return mapping;
  }

  // "1,234" → 1234 · "$12.50" → 12.5 · "3.4%" → 3.4 · "—" → null.
  function parseNumber(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || /^[-–—]$/.test(text) || /^n\/?a$/i.test(text)) return null;
    let cleaned = text.replace(/[\s$\u20ac\u00a3%]/g, '').replace(/^\((.*)\)$/, '-$1');
    // 1.234,56 (European) → 1234.56; 1,234.56 → 1234.56.
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    else cleaned = cleaned.replace(/,/g, '');
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  // Any reasonable date → "yyyy-mm-dd" (UTC), or "".
  function parseDate(value) {
    const text = cleanText(value, 60);
    if (!text) return '';
    let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const d = new Date(text);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  }

  // Mapped rows → result records ready to store and match.
  function rowsToResults(rows = [], mapping = {}, kind) {
    const pick = (row, field) => (mapping[field] == null ? '' : String(row[mapping[field]] ?? '').trim());
    return rows.map((row, index) => {
      const metrics = {};
      NUMERIC_FIELDS.forEach(field => {
        if (mapping[field] == null) return;
        const number = parseNumber(pick(row, field));
        if (number != null) metrics[field] = number;
      });
      const url = pick(row, 'url');
      const normalizedUrl = normalizeUrl(url);
      const adId = kind === 'meta_ads' ? pick(row, 'ad_id').replace(/\D/g, '') : '';
      const name = kind === 'meta_ads' ? pick(row, 'ad_name') : '';
      const postId = kind === 'beehiiv' ? pick(row, 'post_id') : '';
      const start = parseDate(pick(row, 'start'));
      const end = parseDate(pick(row, 'end')) || (kind === 'beehiiv' ? '' : start);
      const rowKey = kind === 'meta_ads'
        ? (adId || name || normalizedUrl)
        : (postId || normalizedUrl || pick(row, 'title'));
      const raw = {};
      Object.entries(mapping).forEach(([field, column]) => { raw[field] = row[column] ?? ''; });
      return {
        index,
        source: kind,
        rowKey: cleanText(rowKey, 400),
        adId,
        adName: cleanText(name, 400),
        parsedName: name ? parseAdName(name) : null,
        title: cleanText(pick(row, 'title') || name, 400),
        url: cleanText(url, 2000),
        normalizedUrl,
        externalId: kind === 'beehiiv' ? (postId || detectPlatform(url).externalId || '') : adId,
        periodStart: start || null,
        periodEnd: end || null,
        metrics,
        raw,
      };
    }).filter(result => result.rowKey);
  }

  // Matches imported rows to designs. Order: ad id → exact ad name → posted
  // URL → ad name parts (brand, style, angle, size, date within a day).
  //   links:   frameup_post_links rows ({ id, task_id, url, platform, external_id, ad_name, brand, style, angle, size, posted_at })
  //   exports: designs with an ad name or its parts ({ taskId, adName, brand, style, angle, size, exportedAt })
  function matchResults(results = [], { links = [], exports = [] } = {}) {
    const byExternal = new Map();
    const byAdName = new Map();
    const byUrl = new Map();
    links.forEach(link => {
      const ext = cleanText(link.external_id || link.externalId, 200);
      if (ext) byExternal.set(`${link.platform}:${ext}`, link);
      const name = cleanText(link.ad_name || link.adName, 400).toLowerCase();
      if (name) byAdName.set(name, link);
      const norm = normalizeUrl(link.url);
      if (norm) byUrl.set(norm, link);
    });
    const exportsByName = new Map();
    exports.forEach(item => {
      const name = cleanText(item.adName || item.ad_name, 400).toLowerCase();
      if (name) exportsByName.set(name, item);
    });
    const dayDiff = (a, b) => {
      if (!a || !b) return Infinity;
      const toDate = v => (/^\d{8}$/.test(v) ? Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) : Date.parse(v));
      return Math.abs(toDate(a) - toDate(b)) / 86400000;
    };
    const sameParts = (parts, item) => parts
      && namePart(item.brand) === parts.brand
      && namePart(item.style) === parts.style
      && namePart(item.angle) === parts.angle
      && String(item.size || '').toLowerCase() === parts.size
      && dayDiff(parts.date, ymd(item.exportedAt || item.posted_at || item.postedAt)) <= 1;

    return results.map(result => {
      const found = (method, link, taskId) => ({
        ...result,
        match: { method, postLinkId: link?.id || null, taskId: taskId || link?.task_id || link?.taskId || null },
      });
      if (result.source === 'meta_ads' && result.adId && byExternal.has(`meta_ad:${result.adId}`)) {
        return found('ad_id', byExternal.get(`meta_ad:${result.adId}`));
      }
      const name = result.adName.toLowerCase();
      if (name && byAdName.has(name)) return found('ad_name', byAdName.get(name));
      if (name && exportsByName.has(name)) return found('ad_name', null, exportsByName.get(name).taskId);
      if (result.normalizedUrl && byUrl.has(result.normalizedUrl)) return found('url', byUrl.get(result.normalizedUrl));
      if (result.source === 'beehiiv' && result.externalId && byExternal.has(`newsletter:${result.externalId}`)) {
        return found('url', byExternal.get(`newsletter:${result.externalId}`));
      }
      if (result.parsedName) {
        const link = links.find(item => sameParts(result.parsedName, item));
        if (link) return found('ad_name_parts', link);
        const item = exports.find(entry => sameParts(result.parsedName, entry));
        if (item) return found('ad_name_parts', null, item.taskId);
      }
      return { ...result, match: { method: 'none', postLinkId: null, taskId: null } };
    });
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const DAY = 86400000;

  function toTime(value) {
    const t = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(t) ? t : NaN;
  }

  // Monday 00:00 UTC of the week holding `value`, as "yyyy-mm-dd".
  function weekStart(value) {
    const t = toTime(value);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const day = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
  }

  function median(values = []) {
    const list = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  const ratio = (part, whole) => (whole > 0 ? part / whole : null);

  // exports: [{ at, email, source, template, taskId, aiMade }]
  // Returns the last `weeks` weeks (oldest first), zero-filled.
  function weeklyCounts(items = [], { weeks = 8, now = Date.now(), at = item => item.at } = {}) {
    const current = weekStart(now);
    const keys = [];
    for (let i = weeks - 1; i >= 0; i -= 1) keys.push(new Date(Date.parse(current) - i * 7 * DAY).toISOString().slice(0, 10));
    const counts = new Map(keys.map(key => [key, 0]));
    items.forEach(item => {
      const key = weekStart(at(item));
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    });
    return keys.map(week => ({ week, count: counts.get(week) }));
  }

  const inRange = (item, since, until = Infinity) => {
    const t = toTime(item.at);
    return Number.isFinite(t) && t >= since && t < until;
  };

  function activeUsers(items = [], since, until = Infinity) {
    return new Set(items.filter(item => inRange(item, since, until)).map(item => String(item.email || '').toLowerCase()).filter(Boolean)).size;
  }

  function exportsPerCreator(exports = [], since, until = Infinity) {
    const map = new Map();
    exports.filter(item => inRange(item, since, until)).forEach(item => {
      const key = String(item.email || item.name || '').toLowerCase();
      if (!key) return;
      const row = map.get(key) || { email: String(item.email || '').toLowerCase(), name: item.name || '', exports: 0, sources: {} };
      row.exports += 1;
      if (!row.name && item.name) row.name = item.name;
      row.sources[item.source || 'editor'] = (row.sources[item.source || 'editor'] || 0) + 1;
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.exports - a.exports || a.name.localeCompare(b.name));
  }

  // Minutes from "design started" to export. Prefers export_done events that
  // carry elapsed_ms; falls back to editor task durationMs (time since the
  // editor tab opened), which over-counts later exports in the same tab, so
  // only the first export per creator per day is used for the fallback.
  function timeToExport({ events = [], tasks = [] } = {}, since, until = Infinity) {
    const MAX = 6 * 60 * 60 * 1000;
    const measured = events
      .filter(event => event.event === 'export_done' && inRange(event, since, until))
      .map(event => Number(event.meta?.elapsed_ms))
      .filter(ms => Number.isFinite(ms) && ms > 0 && ms <= MAX);
    if (measured.length) return { medianMs: median(measured), samples: measured.length, method: 'events' };
    const seen = new Set();
    const fallback = tasks
      .filter(task => inRange(task, since, until))
      .sort((a, b) => toTime(a.at) - toTime(b.at))
      .filter(task => {
        const key = `${String(task.email || '').toLowerCase()}|${String(task.at).slice(0, 10)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(task => Number(task.durationMs))
      .filter(ms => Number.isFinite(ms) && ms > 0 && ms <= MAX);
    return fallback.length
      ? { medianMs: median(fallback), samples: fallback.length, method: 'tasks' }
      : { medianMs: null, samples: 0, method: 'none' };
  }

  // exports: [{ template, workspace, taskId, at }] · links: post-link rows ·
  // results: post-result rows with task_id + metrics.
  function templateLeaderboard({ exports = [], links = [], results = [] } = {}, since, until = Infinity) {
    const postedTasks = new Set(links.map(link => link.task_id || link.taskId).filter(Boolean));
    const resultsByTask = new Map();
    results.forEach(result => {
      const taskId = result.task_id || result.taskId;
      if (!taskId) return;
      const sum = resultsByTask.get(taskId) || {};
      Object.entries(result.metrics || {}).forEach(([key, value]) => {
        if (['ctr', 'open_rate', 'cost_per_result'].includes(key)) return; // rates don't add up
        if (Number.isFinite(Number(value))) sum[key] = (sum[key] || 0) + Number(value);
      });
      resultsByTask.set(taskId, sum);
    });
    const rows = new Map();
    exports.filter(item => inRange(item, since, until)).forEach(item => {
      const template = cleanText(item.template, 80) || 'Other';
      const key = `${item.workspace || ''}|${template}`;
      const row = rows.get(key) || { template, workspace: item.workspace || '', exports: 0, posted: 0, creators: new Set(), results: {}, withResults: 0 };
      row.exports += 1;
      if (item.email) row.creators.add(String(item.email).toLowerCase());
      if (item.taskId && postedTasks.has(item.taskId)) row.posted += 1;
      const sum = item.taskId ? resultsByTask.get(item.taskId) : null;
      if (sum) {
        row.withResults += 1;
        Object.entries(sum).forEach(([metric, value]) => { row.results[metric] = (row.results[metric] || 0) + value; });
      }
      rows.set(key, row);
    });
    return [...rows.values()]
      .map(row => ({
        template: row.template,
        workspace: row.workspace,
        exports: row.exports,
        creators: row.creators.size,
        posted: row.posted,
        postedRate: ratio(row.posted, row.exports),
        withResults: row.withResults,
        results: row.results,
        clicksPerPost: row.withResults && row.results.clicks != null ? row.results.clicks / row.withResults : null,
      }))
      .sort((a, b) => b.exports - a.exports || a.template.localeCompare(b.template));
  }

  // Generate runs: generate_run events when there are any; otherwise
  // frameup_ai_usage rows for feature "generate" grouped into runs (one
  // person's calls less than 90s apart are one run).
  function countGenerateRuns({ events = [], usage = [] } = {}, since, until = Infinity) {
    const fromEvents = events.filter(event => event.event === 'generate_run' && inRange(event, since, until)).length;
    if (fromEvents) return { runs: fromEvents, method: 'events' };
    const calls = usage
      .filter(row => /^generate$/.test(String(row.feature || '')) && inRange({ at: row.created_at || row.at }, since, until))
      .map(row => ({ email: String(row.user_email || row.email || '').toLowerCase(), t: toTime(row.created_at || row.at) }))
      .sort((a, b) => a.email.localeCompare(b.email) || a.t - b.t);
    let runs = 0;
    let last = null;
    calls.forEach(call => {
      if (!last || last.email !== call.email || call.t - last.t > 90000) runs += 1;
      last = call;
    });
    return { runs, method: runs ? 'usage' : 'none' };
  }

  function generateRunToExport({ events = [], usage = [], exports = [] } = {}, since, until = Infinity) {
    const { runs, method } = countGenerateRuns({ events, usage }, since, until);
    const exported = exports.filter(item => item.aiMade === 'generate' && inRange(item, since, until)).length;
    return { runs, exports: exported, rate: ratio(exported, runs), method };
  }

  function aiCostPerExport({ usage = [], exports = [] } = {}, since, until = Infinity) {
    const spend = usage
      .filter(row => inRange({ at: row.created_at || row.at }, since, until))
      .reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
    const inWindow = exports.filter(item => inRange(item, since, until));
    const aiMade = inWindow.filter(item => item.aiMade).length;
    return {
      spend,
      exports: inWindow.length,
      aiExports: aiMade,
      perExport: ratio(spend, inWindow.length),
      perAiExport: ratio(spend, aiMade),
    };
  }

  // requests: [{ dueAt, completedAt, createdAt, status }]. On time = done
  // no later than its due time. Requests without a due date don't count.
  function requestOnTimeRate(requests = [], since, until = Infinity, now = Date.now()) {
    let due = 0;
    let onTime = 0;
    let late = 0;
    let open = 0;
    const turnaround = [];
    requests.forEach(request => {
      const dueAt = toTime(request.dueAt);
      if (!Number.isFinite(dueAt) || dueAt < since || dueAt >= until) return;
      const doneAt = toTime(request.completedAt);
      const done = Number.isFinite(doneAt) && String(request.status || 'Done') === 'Done';
      if (!done && dueAt > now) return; // not due yet
      due += 1;
      if (done && doneAt <= dueAt) onTime += 1;
      else if (done) late += 1;
      else open += 1;
      const created = toTime(request.createdAt);
      if (done && Number.isFinite(created) && doneAt > created) turnaround.push(doneAt - created);
    });
    return { due, onTime, late, overdue: open, rate: ratio(onTime, due), medianTurnaroundMs: median(turnaround) };
  }

  function postedRate({ exports = [], links = [] } = {}, since, until = Infinity) {
    const postedTasks = new Set(links.map(link => link.task_id || link.taskId).filter(Boolean));
    const withTask = exports.filter(item => item.taskId && inRange(item, since, until));
    const posted = withTask.filter(item => postedTasks.has(item.taskId)).length;
    const linksInWindow = links.filter(link => inRange({ at: link.created_at || link.posted_at || link.at }, since, until)).length;
    return { posted, exports: withTask.length, rate: ratio(posted, withTask.length), links: linksInWindow };
  }

  return Object.freeze({
    PLATFORMS,
    IMPORT_FIELDS,
    UTM_KEYS,
    slug,
    normalizeUrl,
    detectPlatform,
    utmParams,
    buildUtmUrl,
    addUtmToHtml,
    stripUtm,
    adName,
    parseAdName,
    ymd,
    parseCsv,
    detectCsvKind,
    guessMapping,
    parseNumber,
    parseDate,
    rowsToResults,
    matchResults,
    weekStart,
    median,
    weeklyCounts,
    activeUsers,
    exportsPerCreator,
    timeToExport,
    templateLeaderboard,
    countGenerateRuns,
    generateRunToExport,
    aiCostPerExport,
    requestOnTimeRate,
    postedRate,
  });
}));
