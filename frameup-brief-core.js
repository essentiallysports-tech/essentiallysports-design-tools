// FrameUp "Design from a brief": the shared, pure part (browser + server).
//
//   * TEMPLATES: every template the brief can fill, per editor (Social Media,
//     Newsletter, YouTube): label, whether it takes a photo, its layout
//     options and, for templates Generate does not already know, the field
//     shape the AI writes to and the checker that holds it to its limits.
//     (Generate's own ten Social templates keep their shapes and checks in
//     netlify/functions/es-generate.js: TEMPLATES / checkFields.)
//   * shortlist(): the free rules matcher. Social reads the brief with
//     frameup-editor-assist.js suggestTemplates; every editor adds its own
//     rules, then the team's template acceptance (how often a brief design in
//     that template was exported unchanged) nudges the order a little.
//   * outcome(): what happened to an AI design by export time (kept or changed).
//
// No AI, no network, no DOM: tested in Node (scripts/test-brief-design.mjs).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.FrameUpBriefCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const assist = () => {
    if (root && root.FrameUpEditorAssist) return root.FrameUpEditorAssist;
    try { return typeof require === 'function' ? require('./frameup-editor-assist.js') : null; } catch (error) { return null; }
  };

  const VERSION = '2026-11-27';
  const WORKSPACES = Object.freeze({ instagram: 'Social Media', newsletter: 'Newsletter', youtube: 'YouTube' });

  // ─── Text helpers ─────────────────────────────────────────────────────────
  const clean = value => String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const within = (value, min, max) => {
    const text = clean(value);
    return text.length >= min && text.length <= max ? text : null;
  };
  // Words, in order, up to maxChars a line (never cutting a word).
  function chunkWords(text, maxChars, maxLines) {
    const words = clean(text).split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (word.length > maxChars) return [];
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxChars) line = next;
      else { lines.push(line); line = word; }
      if (lines.length >= maxLines) return [];
    }
    if (line) lines.push(line);
    return lines.length <= maxLines ? lines : [];
  }

  // ─── Templates ────────────────────────────────────────────────────────────
  // generate: true = es-generate.js TEMPLATES / checkFields hold the shape.
  // layouts: the template's layout options (first = default). Colour options
  // come from the brand kit at apply time (palette 0, 1, 2 …).
  const TEMPLATES = {
    instagram: {
      cover: { label: 'Cover Image', photo: true, generate: true, layouts: ['stagger', 'aligned'] },
      quote: { label: 'Quote', photo: true, generate: true, layouts: ['logo-bottom', 'logo-top'] },
      'long-quote': { label: 'Long Quote', photo: true, generate: true, layouts: ['default'] },
      'double-entity-quote': { label: 'Two-Person Quote', photo: false, generate: true, layouts: ['default'] },
      'stats-single-ent': { label: 'Player Stats', photo: true, generate: true, layouts: ['default'] },
      'stats-double-ent': { label: 'Head-to-Head Stats', photo: false, generate: true, layouts: ['default'] },
      'player-stat-line': { label: 'Player Stat Line', photo: true, generate: true, layouts: ['default'] },
      'team-record': { label: 'Team Record / Score', photo: true, generate: true, layouts: ['default'] },
      'listicle-type-1': { label: 'Rankings Table', photo: false, generate: true, layouts: ['default'] },
      'listicle-type-2': { label: 'Ranked List', photo: false, generate: true, layouts: ['default'] },
      'asap-template-1': {
        label: 'Timeline',
        photo: true,
        layouts: ['default'],
        use: 'Moments in time order: a headline plus 2-6 dated rows (a date or year, a dash, what happened). Only when the brief or the facts give the dates.',
        shape: '{"title": "10-90 chars, the headline", "rows": ["6-64 chars each: a date or year, a dash, what happened", 2 to 6 rows, oldest first]}',
      },
      'twitter-quote': {
        label: 'Tweet / X Post',
        photo: true,
        needs: 'tweet',
        layouts: ['default'],
        use: 'One X post shown as a card, with an optional headline pill above it. The post itself comes from the link: you write only the headline.',
        shape: '{"headline": "0-22 chars, a short hook above the post (empty is fine)"}',
      },
      'twitter-multi': {
        label: 'Multiple Tweets',
        photo: false,
        needs: 'tweets',
        layouts: ['default'],
        use: 'Two or three X posts stacked, with an optional headline pill. The posts come from the links: you write only the headline.',
        shape: '{"headline": "0-22 chars, a short hook above the posts (empty is fine)"}',
      },
    },
    newsletter: {
      'tag-fi': {
        label: 'Tag FI (Corner Label)',
        photo: true,
        layouts: ['default'],
        use: 'A newsletter feature image: the photo with a short corner label (a sport, a league or the topic).',
        shape: '{"tag": "2-16 chars, one or two words, e.g. TENNIS or TRADE TALK"}',
      },
      'ig-headline-photo': {
        label: 'Headline Photo FI',
        photo: true,
        infographic: 'headline-photo',
        layouts: ['default'],
        use: 'A newsletter feature image: the photo with a two-line boxed headline.',
        shape: '{"line1": "2-22 chars", "line2": "2-22 chars"}',
      },
      'ig-player-quote': {
        label: 'Player Quote FI',
        photo: true,
        infographic: 'player-quote',
        quote: true,
        layouts: ['default'],
        use: 'A newsletter feature image: the player\'s photo with their own words over two lines. Only for words they actually said.',
        shape: '{"line1": "2-30 chars, the start of the quote", "line2": "0-30 chars, the rest"}',
      },
      'archive-page-fi': {
        label: 'Archive Page FI',
        photo: true,
        layouts: ['default'],
        use: 'The archive page feature image: the photo with a lightning "Quick Read" tag.',
        shape: '{"tag": "2-14 chars, usually QUICK READ"}',
      },
      'youtube-fi': {
        label: 'Video FI (Play Button)',
        photo: true,
        layouts: ['default'],
        use: 'The photo with a play button, linking to a video. Only when the brief is about a video.',
        shape: '{} (no text: the photo is the design)',
      },
      'section-header': {
        label: 'Section Header (Left)',
        photo: false,
        layouts: ['default'],
        use: 'A section title strip, left aligned, e.g. NEWS or TRADE TALK.',
        shape: '{"title": "2-20 chars"}',
      },
      'section-header-2': {
        label: 'Section Header (Centred)',
        photo: false,
        layouts: ['default'],
        use: 'A centred section title between two lines, e.g. WEEKLY RECAP.',
        shape: '{"title": "2-24 chars"}',
      },
      list: {
        label: 'Headline List (Big Numbers)',
        html: true,
        needs: 'articles',
        layouts: ['default'],
        use: 'Five linked ES headlines with big numbers. Only the ES articles listed in the facts, with their own links.',
        shape: '{"items": [{"text": "20-100 chars, the headline", "url": "one of the ES article URLs given"}, exactly 5]}',
      },
      list2: {
        label: 'Headline List (Simple)',
        html: true,
        needs: 'articles',
        layouts: ['default'],
        use: 'Five linked ES headlines, numbered 1. to 5. Only the ES articles listed in the facts, with their own links.',
        shape: '{"items": [{"text": "20-100 chars, the headline", "url": "one of the ES article URLs given"}, exactly 5]}',
      },
      ticker: {
        label: 'Financial Ticker',
        html: true,
        layouts: ['default'],
        use: 'A business-of-sports story card (money, valuations, deals): a label, a headline, a one-line summary and whether it is up or down.',
        shape: '{"label": "2-16 chars, e.g. VALUATIONS", "category": "2-26 chars, e.g. BUSINESS OF SPORTS", "headline": "12-90 chars", "summary": "12-140 chars", "direction": "up or down", "url": "one of the ES article URLs given, or empty"}',
      },
      trivia: {
        label: 'Trivia',
        html: true,
        layouts: ['default'],
        use: 'A quiz question with four answers. Only when the brief asks for trivia or a quiz; the question and the right answer must come from the facts.',
        shape: '{"question": "20-160 chars", "options": ["1-40 chars", 4 answers], "answer": "1-4, which option is right"}',
      },
    },
    youtube: {
      'variation-1': {
        label: 'One image',
        photo: true,
        layouts: ['stagger', 'aligned'],
        use: 'A YouTube thumbnail: one big photo with one or two headline pills. The default.',
        shape: '{"pills": ["2-20 chars", "... 1 to 2 lines"]}',
      },
      'variation-2': {
        label: 'Player + background',
        photo: true,
        needs: 'cutout',
        layouts: ['stagger', 'aligned'],
        use: 'A YouTube thumbnail: the player cut out over a background photo, with one or two headline pills. When the story is about one player.',
        shape: '{"pills": ["2-20 chars", "... 1 to 2 lines"]}',
      },
      'variation-3': {
        label: 'Two players + background',
        photo: true,
        needs: 'cutouts',
        layouts: ['stagger', 'aligned'],
        use: 'A YouTube thumbnail: two players cut out over a background photo, with one or two headline pills. For a rivalry or a matchup.',
        shape: '{"pills": ["2-20 chars", "... 1 to 2 lines"]}',
      },
      quote: {
        label: 'Quote thumbnail',
        photo: true,
        quote: true,
        layouts: ['default'],
        use: 'A YouTube quote thumbnail: the person\'s exact words over 1-3 short lines, on their photo. Only for words they actually said.',
        shape: '{"lines": ["max 18 chars", "... 1 to 3 lines"]}',
      },
    },
  };

  // The opening words as up to n whole-word lines (the rest is left off):
  // for headline fills from a long brief.
  function leadLines(text, maxChars, n) {
    const out = [];
    let line = '';
    for (const word of clean(text).split(' ').filter(Boolean)) {
      if (word.length > maxChars) break;
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxChars) { line = next; continue; }
      out.push(line);
      line = word;
      if (out.length >= n) { line = ''; break; }
    }
    if (line && out.length < n) out.push(line);
    // A cut line never ends on a small joining word ("… game at").
    const last = out.length ? out[out.length - 1].replace(/(?:\s+(?:a|an|the|at|as|in|on|of|to|for|and|or|with|by|from))+$/i, '') : '';
    if (out.length) { if (last) out[out.length - 1] = last; else out.pop(); }
    return out;
  }

  const templatesFor = workspace => TEMPLATES[workspace] || {};
  const templateOf = (workspace, template) => templatesFor(workspace)[template] || null;
  const labelOf = (workspace, template) => templateOf(workspace, template)?.label || template;
  function layoutsFor(workspace, template) {
    return templateOf(workspace, template)?.layouts || ['default'];
  }
  // A requested layout when the template has it, else the n-th (so the three
  // options differ when they share a template), else the default.
  function pickLayout(workspace, template, requested, n = 0) {
    const list = layoutsFor(workspace, template);
    if (requested && list.includes(requested)) return requested;
    return list[n % list.length] || 'default';
  }

  // ─── Checkers for templates Generate does not know ───────────────────────
  // Return { fields, lines } (lines = every text on the design, for the
  // brand checker) or { error } naming the limit that broke.
  function checkFields(workspace, template, raw = {}) {
    const f = raw && typeof raw === 'object' ? raw : {};
    if (workspace === 'instagram') {
      switch (template) {
        case 'asap-template-1': {
          const title = within(f.title, 10, 90);
          const rows = (Array.isArray(f.rows) ? f.rows : []).map(row => within(typeof row === 'string' ? row : row?.text, 6, 64));
          if (!title) return { error: 'timeline title needs 10-90 chars' };
          if (rows.length < 2 || rows.length > 6 || rows.some(row => !row)) return { error: 'timeline needs 2-6 rows of 6-64 chars' };
          return { fields: { title, rows }, lines: [title, ...rows] };
        }
        case 'twitter-quote':
        case 'twitter-multi': {
          const headline = within(f.headline ?? '', 0, 22);
          if (headline === null) return { error: 'tweet headline is max 22 chars' };
          return { fields: { headline }, lines: headline ? [headline] : [] };
        }
        default: return { error: `unsupported template "${template}"` };
      }
    }
    if (workspace === 'newsletter') {
      switch (template) {
        case 'tag-fi': {
          const tag = within(f.tag, 2, 16);
          return tag ? { fields: { tag }, lines: [tag] } : { error: 'tag FI needs a tag of 2-16 chars' };
        }
        case 'archive-page-fi': {
          const tag = within(f.tag || 'QUICK READ', 2, 14);
          return tag ? { fields: { tag }, lines: [tag] } : { error: 'archive page FI tag is 2-14 chars' };
        }
        case 'youtube-fi': return { fields: {}, lines: [] };
        case 'section-header':
        case 'section-header-2': {
          const max = template === 'section-header' ? 20 : 24;
          const title = within(f.title, 2, max);
          return title ? { fields: { title }, lines: [title] } : { error: `section header needs a title of 2-${max} chars` };
        }
        case 'ig-headline-photo':
        case 'ig-player-quote': {
          const max = template === 'ig-headline-photo' ? 22 : 30;
          const line1 = within(String(f.line1 || '').replace(/^["“]|["”]$/g, ''), 2, max);
          const line2 = within(String(f.line2 ?? '').replace(/^["“]|["”]$/g, ''), 0, max);
          if (!line1 || line2 === null) return { error: `${template} needs line 1 (2-${max} chars) and line 2 (0-${max} chars)` };
          return { fields: { line1, line2 }, lines: [line1, line2].filter(Boolean) };
        }
        case 'list':
        case 'list2': {
          const items = (Array.isArray(f.items) ? f.items : []).map(item => ({ text: within(item?.text, 12, 100), url: clean(item?.url || item?.link) }));
          if (items.length !== 5 || items.some(item => !item.text || !/^https:\/\/(?:www\.)?essentiallysports\.com\//.test(item.url))) {
            return { error: `${template} needs exactly 5 ES headlines (12-100 chars) with their ES links` };
          }
          if (new Set(items.map(item => item.url)).size !== 5) return { error: `${template} repeats an article` };
          return { fields: { items }, lines: items.map(item => item.text), links: items.map(item => item.url) };
        }
        case 'ticker': {
          const out = {
            label: within(f.label, 2, 16),
            category: within(f.category, 2, 26),
            headline: within(f.headline, 12, 90),
            summary: within(f.summary, 12, 140),
            direction: f.direction === 'down' ? 'down' : 'up',
            url: clean(f.url || ''),
          };
          if (!out.label || !out.category || !out.headline || !out.summary) return { error: 'ticker needs a label (2-16), category (2-26), headline (12-90) and summary (12-140)' };
          if (out.url && !/^https:\/\/(?:www\.)?essentiallysports\.com\//.test(out.url)) return { error: 'ticker link must be an ES article' };
          return { fields: out, lines: [out.label, out.category, out.headline, out.summary], links: out.url ? [out.url] : [] };
        }
        case 'trivia': {
          const question = within(f.question, 20, 160);
          const options = (Array.isArray(f.options) ? f.options : []).map(option => within(option, 1, 40));
          const answer = Number(f.answer);
          if (!question || options.length !== 4 || options.some(option => !option)) return { error: 'trivia needs a question (20-160 chars) and 4 answers (1-40 chars)' };
          if (!(answer >= 1 && answer <= 4)) return { error: 'trivia needs the right answer (1-4)' };
          if (new Set(options.map(option => option.toLowerCase())).size !== 4) return { error: 'trivia answers must differ' };
          return { fields: { question, options, answer }, lines: [question, ...options] };
        }
        default: return { error: `unsupported template "${template}"` };
      }
    }
    if (workspace === 'youtube') {
      if (template === 'quote') {
        const lines = (Array.isArray(f.lines) ? f.lines : []).map(line => within(String(line || '').replace(/^["“]|["”]$/g, ''), 1, 18));
        if (!lines.length || lines.length > 3 || lines.some(line => !line)) return { error: 'quote thumbnail needs 1-3 lines of max 18 chars' };
        return { fields: { lines }, lines };
      }
      if (/^variation-[123]$/.test(template)) {
        const pills = (Array.isArray(f.pills) ? f.pills : []).map(pill => within(pill, 2, 20));
        if (!pills.length || pills.length > 2 || pills.some(pill => !pill)) return { error: 'YouTube thumbnail needs 1-2 pills of 2-20 chars' };
        return { fields: { pills }, lines: pills };
      }
      return { error: `unsupported template "${template}"` };
    }
    return { error: `unsupported template "${template}"` };
  }

  // ─── Links in a brief ─────────────────────────────────────────────────────
  const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (error) { return ''; }
  }
  const isEsHost = host => host === 'essentiallysports.com' || host.endsWith('.essentiallysports.com');
  const isTweet = url => /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(hostOf(url)) && /\/status(?:es)?\/\d+/.test(url);
  function linksIn(text) {
    const all = [...new Set(String(text || '').match(URL_RE) || [])].map(url => url.replace(/[.,;:!?]+$/, ''));
    return {
      es: all.filter(url => isEsHost(hostOf(url)) && !isTweet(url)).slice(0, 2),
      tweets: all.filter(isTweet).slice(0, 3),
      other: all.filter(url => !isEsHost(hostOf(url)) && !isTweet(url)).slice(0, 3),
    };
  }
  // The brief without its links (the words the person wrote).
  const withoutLinks = text => clean(String(text || '').replace(URL_RE, ' '));

  // ─── The rules matcher ────────────────────────────────────────────────────
  // stats: { [template]: { applied, exported, kept } } from the usage table.
  // A template needs 5 brief designs before its record counts, and the nudge is
  // at most ±0.75 (a rule hit is worth 2-3), so rules still lead.
  function acceptanceBonus(record) {
    const applied = Number(record?.applied) || 0;
    if (applied < 5) return 0;
    const exported = Math.min(applied, Number(record?.exported) || 0);
    const kept = Math.min(exported, Number(record?.kept) || 0);
    const rate = (exported + kept * 0.5 + 1) / (applied * 1.5 + 2);
    return Math.max(-0.75, Math.min(0.75, Math.round((rate - 0.4) * 200) / 100));
  }

  function socialRules(text, { tweets = 0 } = {}) {
    const helper = assist();
    const scores = new Map();
    const add = (value, score, why) => {
      const current = scores.get(value);
      if (!current) scores.set(value, { value, score, why });
      else { current.score += score; if (score >= 2 || !current.why) current.why = why; }
    };
    (helper?.suggestTemplates ? helper.suggestTemplates(text, { limit: 20 }) : []).forEach(item => add(item.value, item.score, item.why));
    // X posts come only from links (never written by the AI).
    scores.delete('twitter-quote');
    scores.delete('twitter-multi');
    if (tweets >= 2) add('twitter-multi', 4, `It links ${tweets} X posts`);
    if (tweets >= 1) add('twitter-quote', tweets >= 2 ? 2 : 4, 'It links an X post');
    if (!scores.has('cover')) add('cover', 1, 'A headline over a photo');
    return [...scores.values()];
  }

  // -> [{ value, label, score, why }] best first (limit 5).
  function shortlist(text, workspace = 'instagram', { tweets = 0, articles = 0, cutouts = 0, stats = null, limit = 5, available = null } = {}) {
    const raw = withoutLinks(text);
    const known = templatesFor(workspace);
    let list = [];
    if (workspace === 'instagram') list = socialRules(raw, { tweets });
    else if (typeof shortlist.rules?.[workspace] === 'function') list = shortlist.rules[workspace](raw, { tweets, articles, cutouts });
    return list
      .filter(item => known[item.value] && (!available || available.includes(item.value)))
      .map(item => {
        const bonus = acceptanceBonus(stats?.[item.value]);
        return { value: item.value, label: known[item.value].label, score: Math.round((item.score + bonus) * 100) / 100, why: item.why, ...(bonus ? { bonus } : {}) };
      })
      .sort((a, b) => b.score - a.score || (a.value === 'cover' ? 1 : b.value === 'cover' ? -1 : 0))
      .slice(0, limit);
  }
  // Newsletter / YouTube rules register here (same file, below).
  shortlist.rules = {};

  // ─── Stats from usage rows ────────────────────────────────────────────────
  // rows: frameup_usage_events rows (category generate) with action
  // 'brief-design' (a brief design was opened) or 'brief-export' (it was
  // exported; meta.kept = no text changed). -> { [workspace]: { [template]: {...} } }
  function statsFromRows(rows = []) {
    const out = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
      const template = String(meta.template || '').slice(0, 40);
      const workspace = String(meta.ws || 'instagram');
      if (!template || !WORKSPACES[workspace]) return;
      const bucket = (out[workspace] = out[workspace] || {});
      const record = (bucket[template] = bucket[template] || { applied: 0, exported: 0, kept: 0 });
      if (row.action === 'brief-design') record.applied += 1;
      else if (row.action === 'brief-export') {
        record.exported += 1;
        if (meta.kept === true || meta.kept === 'true') record.kept += 1;
      }
    });
    return out;
  }

  // ─── Kept or changed (the learning loop) ─────────────────────────────────
  const squash = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // aiText / nowText: the design's text lines when it opened and at export.
  function outcome(aiText = [], nowText = [], { template = '', nowTemplate = '' } = {}) {
    const before = (Array.isArray(aiText) ? aiText : []).map(squash).filter(Boolean);
    const after = (Array.isArray(nowText) ? nowText : []).map(squash).filter(Boolean);
    if (nowTemplate && template && nowTemplate !== template) return { kept: false, changed: before.length || 1, switched: true };
    const afterSet = new Set(after);
    const beforeSet = new Set(before);
    const changed = before.filter(line => !afterSet.has(line)).length + after.filter(line => !beforeSet.has(line)).length;
    return { kept: changed === 0, changed, switched: false };
  }

  // ─── Rewrites ─────────────────────────────────────────────────────────────
  const REWRITES = Object.freeze({
    shorter: 'Make every line shorter so the text sits bigger on the design. Keep the meaning and every fact.',
    punchier: 'Make it punchier and bolder: a stronger hook in fewer words. Same facts.',
    formal: 'Make it more formal and measured: plain newsroom wording, no slang. Same facts.',
  });

  // ─── Free-mode fills for templates Generate does not know ────────────────
  // Only words and dates from the brief; null when the brief can't fill it.
  function rulesFill(workspace, template, brief, opts = {}) {
    const text = withoutLinks(brief);
    if (workspace === 'instagram') {
      if (template === 'asap-template-1') {
        const rows = String(brief || '').split(/\n|;|•/).map(clean)
          .filter(line => /\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(line))
          .map(line => line.slice(0, 64)).filter(line => line.length >= 6).slice(0, 6);
        const title = clean(String(brief || '').replace(URL_RE, ' ').split(/[\n:]/)[0]).slice(0, 90);
        if (rows.length < 2 || title.length < 10) return null;
        return { title, rows };
      }
      if (template === 'twitter-quote' || template === 'twitter-multi') {
        const words = text.split(/[,.;:!?"“—\n]/)[0] || '';
        return { headline: chunkWords(words, 22, 1)[0] || '' };
      }
    }
    if (typeof rulesFill.more?.[workspace] === 'function') return rulesFill.more[workspace](template, brief, opts);
    return null;
  }
  rulesFill.more = {};

  // ─── Newsletter rules ─────────────────────────────────────────────────────
  // Feature images by default (Tag FI, Headline Photo FI); a section title, a
  // video, a quote, a roundup of ES stories, money news or a quiz each have
  // their own template. Headline lists need five ES articles (articles >= 5).
  shortlist.rules.newsletter = (text, { articles = 0 } = {}) => {
    const t = String(text || '').toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    const out = [];
    const add = (value, score, why) => out.push({ value, score, why });
    if (/\bsection\b|\bheader\b|\bdivider\b/.test(t) || (words.length <= 3 && !/[0-9]/.test(t))) {
      add('section-header', 3, 'A short section title');
      add('section-header-2', 2.5, 'A centred section title');
    }
    if (/\b(?:video|watch|youtube|clip|highlights?|podcast|episode)\b/.test(t)) add('youtube-fi', 3, 'It points to a video');
    if (/["“”]|\b(?:said|says|told|admits?|quote)\b/.test(t)) add('ig-player-quote', 3, 'Someone is quoted');
    if (/\b(?:trivia|quiz|guess|who am i)\b/.test(t)) add('trivia', 4, 'It asks for a quiz');
    if (/\b(?:valuations?|stocks?|shares|revenue|business|billion|million|deal|contract|sale|sold|money|worth|salary|net worth)\b/.test(t)) add('ticker', 2, 'It is money news');
    if (articles >= 5 && /\b(?:top|roundup|round-up|headlines|stories|news|list|week|today|must read|recap)\b/.test(t)) {
      add('list', 3, 'A roundup of ES stories');
      add('list2', 2.5, 'A simple list of ES stories');
    }
    if (/\b(?:archive|quick read)\b/.test(t)) add('archive-page-fi', 3, 'An archive page image');
    add('ig-headline-photo', 1.5, 'A headline over a photo');
    add('tag-fi', 1.2, 'A photo with a corner label');
    add('archive-page-fi', 0.4, 'A photo with a Quick Read tag');
    // One entry per template (highest score wins).
    const best = new Map();
    out.forEach(item => { const seen = best.get(item.value); if (!seen || item.score > seen.score) best.set(item.value, item); });
    return [...best.values()];
  };

  const SPORT_WORDS = ['NFL', 'NBA', 'WNBA', 'MLB', 'NHL', 'MLS', 'NCAA', 'CFB', 'Golf', 'Tennis', 'F1', 'NASCAR', 'UFC', 'Boxing', 'Soccer', 'Olympics', 'Cricket'];
  rulesFill.more.newsletter = (template, brief, { articles = [] } = {}) => {
    const words = withoutLinks(brief);
    const clause = words.split(/[,.;:!?"“—\n]/)[0] || words;
    switch (template) {
      case 'section-header': return chunkWords(words, 20, 1).length ? { title: chunkWords(words, 20, 1)[0] } : null;
      case 'section-header-2': return chunkWords(words, 24, 1).length ? { title: chunkWords(words, 24, 1)[0] } : null;
      case 'tag-fi': {
        const sport = SPORT_WORDS.find(word => new RegExp(`\\b${word}\\b`, 'i').test(words));
        return sport ? { tag: sport.toUpperCase() } : null;
      }
      case 'archive-page-fi': return { tag: 'QUICK READ' };
      case 'youtube-fi': return /\b(?:video|watch|youtube|clip|highlights?)\b/i.test(words) ? {} : null;
      case 'ig-headline-photo': {
        const lines = chunkWords(clause, 22, 2).length ? chunkWords(clause, 22, 2) : leadLines(clause, 22, 2);
        return lines.length && lines[0].length >= 2 ? { line1: lines[0], line2: lines[1] || '' } : null;
      }
      case 'list':
      case 'list2': {
        const items = (articles || []).filter(a => a && a.title && a.url).slice(0, 5).map(a => ({ text: clean(a.title).slice(0, 100), url: a.url }));
        return items.length === 5 ? { items } : null;
      }
      default: return null;
    }
  };

  // ─── YouTube rules ────────────────────────────────────────────────────────
  // One image by default; a player cut-out over a background when the ES
  // photo pool has one for the person (cutouts >= 1), two for a matchup
  // (cutouts >= 2); a quote thumbnail for someone's words.
  shortlist.rules.youtube = (text, { cutouts = 0 } = {}) => {
    const t = String(text || '').toLowerCase();
    const out = [{ value: 'variation-1', score: 2, why: 'One big photo with a headline' }];
    if (/["“”]|\b(?:said|says|told|admits?|quote|fires back|slams)\b/.test(t)) out.push({ value: 'quote', score: 3, why: 'Someone is quoted' });
    const matchup = /\b(?:vs\.?|versus|against|rivalry|head[- ]to[- ]head|or)\b/.test(t);
    if (cutouts >= 2 && matchup) out.push({ value: 'variation-3', score: 3, why: 'Two players, side by side' });
    if (cutouts >= 1) out.push({ value: 'variation-2', score: matchup ? 2.2 : 2.5, why: 'The player cut out over the scene' });
    return out;
  };
  rulesFill.more.youtube = (template, brief) => {
    if (template === 'quote') {
      const quote = (String(brief || '').match(/[“"]([^”"]{4,60})[”"]/) || [])[1];
      const lines = quote ? chunkWords(quote, 18, 3) : [];
      return lines.length ? { lines } : null;
    }
    const clause = withoutLinks(brief).split(/[,.;:!?"“—\n]/)[0] || '';
    const pills = chunkWords(clause, 20, 2).length ? chunkWords(clause, 20, 2) : leadLines(clause, 20, 2);
    return pills.length && pills.every(pill => pill.length >= 2) ? { pills } : null;
  };

  // ─── Filled without AI, in the browser ───────────────────────────────────
  // When the design service fails outright (a 500, a network error, a time
  // out), the page still opens a design from the person's own words: the
  // editor's simplest templates, each held to its limits. -> options (may be []).
  function localOptions(workspace, brief) {
    const words = withoutLinks(brief);
    const clause = (words.split(/[,.;:!?"“—\n]/)[0] || words).trim();
    const out = [];
    const add = (template, fields, lines, why) => {
      if (!lines.length || lines.some(line => !line)) return;
      out.push({ template, label: labelOf(workspace, template), why, layout: pickLayout(workspace, template, '', out.length), fields, lines, listicle: null, sport: '', team: '', warnings: [], source: 'local' });
    };
    if (workspace === 'instagram') {
      const pills = chunkWords(clause, 16, 4).length ? chunkWords(clause, 16, 4) : leadLines(clause, 20, 4);
      if (pills.every(pill => pill.length >= 2)) add('cover', { pills }, pills, 'Your words as headline pills');
      const quote = (String(brief || '').match(/[“"]([^”"]{4,54})[”"]/) || [])[1];
      const lines = quote ? chunkWords(quote, 18, 3) : [];
      if (lines.length) add('quote', { lines }, lines, 'Your quote, split into short lines');
      const timeline = rulesFill('instagram', 'asap-template-1', brief);
      if (timeline) add('asap-template-1', timeline, [timeline.title, ...timeline.rows], 'Your dates, in order');
    } else {
      Object.keys(templatesFor(workspace)).forEach(template => {
        const own = templateOf(workspace, template);
        if (own.html || own.quote || own.needs || out.length >= 3) return;
        const fields = rulesFill(workspace, template, brief);
        if (!fields) return;
        const checked = checkFields(workspace, template, fields);
        if (!checked.error && (checked.lines.length || template === 'youtube-fi')) add(template, checked.fields, checked.lines.length ? checked.lines : [''].filter(Boolean), 'Your words on the template');
      });
    }
    return out.slice(0, 3);
  }

  // ─── The prompt's template list ──────────────────────────────────────────
  // generateShapes: es-generate TEMPLATES (server only) for Generate's ten.
  function promptTemplates(workspace, values, generateShapes = {}) {
    return values.map(value => {
      const own = templateOf(workspace, value) || {};
      const gen = own.generate ? generateShapes[value] || {} : {};
      const shape = own.shape || gen.shape || '{}';
      const use = own.use || gen.use || own.label;
      const layouts = layoutsFor(workspace, value);
      return `- "${value}" (${own.label || value}): ${use}\n  fields: ${shape}${layouts.length > 1 ? `\n  layout: one of ${layouts.map(l => `"${l}"`).join(', ')}` : ''}`;
    }).join('\n');
  }

  return {
    VERSION, WORKSPACES, TEMPLATES, REWRITES,
    clean, within, chunkWords, leadLines, linksIn, withoutLinks,
    templatesFor, templateOf, labelOf, layoutsFor, pickLayout,
    checkFields, shortlist, acceptanceBonus, statsFromRows, outcome, rulesFill, promptTemplates, localOptions,
  };
}));
