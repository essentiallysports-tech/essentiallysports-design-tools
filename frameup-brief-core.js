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
    newsletter: {},
    youtube: {},
  };

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
  function shortlist(text, workspace = 'instagram', { tweets = 0, stats = null, limit = 5, available = null } = {}) {
    const raw = withoutLinks(text);
    const known = templatesFor(workspace);
    let list = [];
    if (workspace === 'instagram') list = socialRules(raw, { tweets });
    else if (typeof shortlist.rules?.[workspace] === 'function') list = shortlist.rules[workspace](raw, { tweets });
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
  function rulesFill(workspace, template, brief, { facts = '' } = {}) {
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
    if (typeof rulesFill.more?.[workspace] === 'function') return rulesFill.more[workspace](template, brief, { facts });
    return null;
  }
  rulesFill.more = {};

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
    clean, within, chunkWords, linksIn, withoutLinks,
    templatesFor, templateOf, labelOf, layoutsFor, pickLayout,
    checkFields, shortlist, acceptanceBonus, statsFromRows, outcome, rulesFill, promptTemplates,
  };
}));
