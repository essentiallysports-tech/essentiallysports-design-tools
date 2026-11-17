#!/usr/bin/env node
// Editor assist (frameup-editor-assist.js): template suggestions, recent
// templates, ES guideline nudges before export and the save chip's words.
// Plus the wiring: index.html loads it and asks it for export issues, the
// autosave / cloud drafts announce their state, the picker uses it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Assist = require('../frameup-editor-assist.js');
const Rules = require('../frameup-rules.js');
const Guidelines = require('../es-guidelines.js');

// ─── suggestTemplates ────────────────────────────────────────────────────
const top = text => Assist.suggestTemplates(text)[0]?.value;
const values = text => Assist.suggestTemplates(text).map(item => item.value);

assert.deepEqual(Assist.suggestTemplates(''), [], 'nothing to read, nothing suggested');
assert.deepEqual(Assist.suggestTemplates('hi'), []);
assert.equal(top('LeBron drops 41 points and 12 assists in the win'), 'player-stat-line');
assert.equal(top('Wembanyama blocks 10 shots in one night'), 'stats-single-ent', 'one big number');
assert.equal(top('Chiefs beat Bills 27-24 in overtime'), 'team-record');
assert.equal(top('Thunder improve to 12-1 with another blowout'), 'team-record');
assert.equal(top('Mahomes vs Allen: who is better in the clutch?'), 'stats-double-ent');
assert.equal(top('Kelce on retirement: "I still love this game and I want to keep going"'), 'quote');
assert.equal(top(`Coach said: "${'We played hard, we played together, and we never stopped believing in each other all season long.'}"`), 'long-quote');
assert.equal(top('Fans react to the Cowboys collapse'), 'twitter-multi');
assert.equal(top('Steph Curry posted on X after the game'), 'twitter-quote');
assert.equal(top('Top 10 quarterbacks heading into Week 12'), 'listicle-type-2');
assert.ok(values('Top 10 quarterbacks heading into Week 12').includes('listicle-type-1'));
assert.equal(top('Tom Brady career: from 2000 draft pick to 2021 Super Bowl'), 'asap-template-1');
assert.equal(top('Caitlin Clark is changing the WNBA forever'), 'cover', 'a plain headline is a Cover');
assert.ok(Assist.suggestTemplates('LeBron drops 41 points and 12 assists').every(item => item.why), 'every pick says why');
assert.ok(Assist.suggestTemplates('LeBron drops 41 points and 12 assists').length <= 3, 'three at most');
assert.deepEqual(
  Assist.suggestTemplates('LeBron drops 41 points and 12 assists', { available: ['cover', 'quote'] }).map(item => item.value),
  ['cover'],
  'only templates that exist on the page',
);
assert.notEqual(top('Game on 11-18-2026 at 8pm'), 'team-record', 'a date is not a record');

// ─── pushRecent ──────────────────────────────────────────────────────────
assert.deepEqual(Assist.pushRecent([], 'quote'), ['quote']);
assert.deepEqual(Assist.pushRecent(['cover', 'quote'], 'quote'), ['quote', 'cover'], 'moves to the front, no duplicates');
assert.deepEqual(Assist.pushRecent(['a', 'b', 'c', 'd'], 'e'), ['e', 'a', 'b', 'c'], 'keeps four');
assert.deepEqual(Assist.pushRecent('junk', 'cover'), ['cover'], 'bad storage is ignored');
assert.deepEqual(Assist.pushRecent([1, null, 'quote'], 'cover'), ['cover', 'quote']);

// ─── templateInfo ────────────────────────────────────────────────────────
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const socialSelect = indexHtml.match(/<select id="instagram-post-type-select"[\s\S]*?<\/select>/)[0];
const socialValues = [...socialSelect.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
socialValues.forEach(value => assert.ok(Assist.templateInfo('instagram', value)?.best, `"best for" line for ${value}`));
assert.equal(Assist.templateInfo('instagram', 'nope'), null);

// ─── brandCheck ──────────────────────────────────────────────────────────
// A fake font: every character is 0.5em wide.
const measure = (text, size) => text.length * size * 0.5;
const check = input => Assist.brandCheck({ rules: Rules, guidelines: Guidelines, measure, fontStatus: 'loaded', ...input });

assert.deepEqual(check({ template: 'cover', lines: ['CHIEFS WIN'] }), [], 'a clean Cover passes');
assert.deepEqual(check({ template: 'cover', lines: [] }), [], 'no text, no nudges');

const hashtag = check({ template: 'cover', lines: ['CHIEFS WIN', '#CHIEFSKINGDOM'] });
assert.equal(hashtag.length, 1);
assert.equal(hashtag[0].rule, 'banned-words');
assert.match(hashtag[0].text, /“#CHIEFSKINGDOM”: no hashtags/, 'names the whole word');
assert.ok(hashtag[0].source, 'cites the guideline source');

const hype = check({ template: 'cover', lines: ['SHOCKING TRADE'] });
assert.match(hype[0].text, /hype word/);
assert.deepEqual(check({ template: 'quote', lines: ['THAT WAS INSANE'] }), [], 'quotes are verbatim: no voice rules');
assert.equal(check({ template: 'quote', lines: ['GREAT WIN #BLESSED'] })[0].rule, 'banned-words', 'but no hashtags, even in quotes');
assert.deepEqual(check({ template: 'twitter-quote', lines: ['#GOAT 🐐'] }), [], 'tweets are shown as posted');
assert.ok(check({ template: 'cover', lines: ['A #B', 'C!!', 'SHOCKING', 'www.x.com'] }).length <= 2, 'at most two copy nudges');

const long = check({ template: 'cover', lines: ['THIS LINE IS FAR TOO LONG FOR ONE PILL'] });
assert.equal(long.length, 1);
assert.equal(long[0].rule, 'text-fit');
assert.match(long[0].text, /shrinks to \d+px/);
assert.match(long[0].text, /84px/, 'quotes the rule size from frameup-rules.js');
assert.deepEqual(check({ template: 'stats-single-ent', lines: ['THIS LINE IS FAR TOO LONG FOR ONE PILL'] }), [], 'size check is for Covers only');
assert.deepEqual(check({ template: 'cover', lines: ['THIS LINE IS FAR TOO LONG'], measure: null }), [], 'no measuring, no size check');

const fontError = check({ template: 'cover', lines: ['CHIEFS WIN'], fontStatus: 'error' });
assert.equal(fontError[0].rule, 'font-family');
assert.equal(fontError[0].fix, 'reload-font');
assert.equal(check({ fontStatus: 'loading' })[0].rule, 'font-family', 'font nudge even without text');
assert.deepEqual(Assist.brandCheck(), [], 'no input, no crash');
assert.deepEqual(Assist.brandCheck({ template: 'cover', lines: ['#X'] }), [], 'no rules loaded, no copy nudges');

// ─── saveChipState ───────────────────────────────────────────────────────
const now = Date.parse('2026-11-18T12:00:00Z');
const chip = input => Assist.saveChipState({ now, ...input });
assert.equal(chip({ local: 'idle' }).label, '', 'quiet before autosave starts');
assert.equal(chip({ local: 'ready' }).label, '', 'quiet until the first change');
assert.equal(chip({ local: 'pending' }).label, 'Saving…');
assert.equal(chip({ local: 'saving' }).tone, 'busy');
assert.equal(chip({ local: 'saved', savedAt: now - 5000 }).label, 'Saved');
assert.match(chip({ local: 'saved', savedAt: now - 5000 }).detail, /just now/);
assert.match(chip({ local: 'saved', savedAt: now - 3 * 60000 }).detail, /3 min ago/);
assert.equal(chip({ local: 'saved', cloud: 'synced' }).label, 'Synced');
assert.equal(chip({ local: 'saved', cloud: 'saving' }).label, 'Syncing…');
assert.match(chip({ local: 'saved', cloud: 'pending' }).detail, /Syncing to your account soon/);
assert.equal(chip({ local: 'saved', online: false }).label, 'Offline');
assert.equal(chip({ local: 'saved', cloud: 'offline' }).tone, 'warn');
assert.equal(chip({ local: 'saved', cloud: 'error' }).label, 'Saved here');
assert.equal(chip({ local: 'saved', cloud: 'too-large' }).tone, 'warn');
assert.equal(chip({ local: 'saved', cloud: 'off' }).label, 'Saved', 'no table yet: plain "Saved"');
assert.equal(chip({ local: 'failed', cloud: 'synced' }).tone, 'error', 'a failed local save always shows');
assert.equal(Assist.timeAgo(now - 2 * 3600000, now), '2 h ago');

// ─── Wiring ──────────────────────────────────────────────────────────────
assert.match(indexHtml, /<script src="frameup-rules\.js\?v=[^"]+"><\/script>\s*<script src="es-guidelines\.js\?v=[^"]+"><\/script>\s*<script src="frameup-editor-assist\.js\?v=[^"]+"><\/script>/, 'rules, then guidelines, then assist');
assert.match(indexHtml, /<link rel="stylesheet" href="frameup-editor-assist\.css\?v=/);
assert.match(indexHtml, /FrameUpEditorAssist\?\.exportIssues\?\.\(\{ workspace: activeWorkspace, state \}\)/, 'getExportIssues asks for nudges');
const autosave = fs.readFileSync(path.join(root, 'frameup-autosave.js'), 'utf8');
assert.match(autosave, /frameup:autosave-state/);
assert.match(autosave, /status: \(\) => \(\{ enabled, dirty/);
const cloud = fs.readFileSync(path.join(root, 'frameup-cloud-drafts.js'), 'utf8');
assert.match(cloud, /frameup:cloud-status/);
const templates = fs.readFileSync(path.join(root, 'frameup-templates.js'), 'utf8');
assert.match(templates, /Best for this story/);
assert.match(templates, /frameup\.templates\.recent\./);
const extras = fs.readFileSync(path.join(root, 'frameup-extras.js'), 'utf8');
assert.match(extras, /\['Save now', \[MOD, 'S'\]\]/);
assert.match(extras, /\['Browse templates', \['T'\]\]/);
const assistSource = fs.readFileSync(path.join(root, 'frameup-editor-assist.js'), 'utf8');
assert.doesNotMatch(assistSource, /\beval\(/, 'no eval (CSP)');

console.log('editor assist: all checks passed');
