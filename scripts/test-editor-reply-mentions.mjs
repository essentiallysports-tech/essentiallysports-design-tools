#!/usr/bin/env node
// Multiple Tweets "Hide reply @mentions" (index.html): the pure strip helper,
// getMultiTweets with the switch on / off, and the wiring (switch markup,
// localStorage key in try/catch). Plus the cover text-drag wiring: the photo
// crop handler steps aside for a press on the text (2026-11-13 regression).
// The real-browser behaviour is in scripts/check-editor-text-drag.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');

const strip = html.match(/\nfunction stripLeadingReplyMentions\(text\) \{[\s\S]*?\n\}\n/)[0];
const getter = html.match(/\nfunction getMultiTweets\(\) \{[\s\S]*?\n\}\n/)[0];
const sandbox = { state: { multiTweets: [] }, MULTI_TWEET_SAMPLES: [{ text: 'sample' }], multiTweetHideMentions: true };
vm.runInNewContext(`${strip}${getter}; this.strip = stripLeadingReplyMentions; this.get = getMultiTweets;`, sandbox);
const { strip: s, get } = sandbox;

assert.equal(s('@AdamSchefter Awfully convenient'), 'Awfully convenient');
assert.equal(s('@AdamSchefter @ESPNNFL Oddly convenient.'), 'Oddly convenient.');
assert.equal(s('  @a_b1  @C2\nNew line text'), 'New line text', 'leading spaces / newline after the handles');
assert.equal(s('Great call by @AdamSchefter today'), 'Great call by @AdamSchefter today', 'middle mention kept');
assert.equal(s('@AdamSchefter told @NFL first'), 'told @NFL first', 'only the leading run goes');
assert.equal(s('@AdamSchefter'), '@AdamSchefter', 'only handles: keep the original');
assert.equal(s('@AdamSchefter @ESPNNFL   '), '@AdamSchefter @ESPNNFL   ', 'only handles + spaces: keep the original');
assert.equal(s('@AdamSchefter, nice'), '@AdamSchefter, nice', 'handle followed by punctuation is not a reply prefix');
assert.equal(s('email me@site.com'), 'email me@site.com');
assert.equal(s(''), '');
assert.equal(s(null), '');

const raw = { text: '@AdamSchefter @ESPNNFL Oddly convenient', handle: 'fan' };
sandbox.state.multiTweets = [raw, null, { text: 'No reply here' }];
sandbox.multiTweetHideMentions = true;
let out = get();
assert.deepEqual(out.map(t => t.text), ['Oddly convenient', 'No reply here']);
assert.equal(out[0].handle, 'fan', 'other fields kept');
assert.equal(raw.text, '@AdamSchefter @ESPNNFL Oddly convenient', 'stored text untouched');
assert.equal(out[1], sandbox.state.multiTweets[2], 'unchanged tweets are the same object');
sandbox.multiTweetHideMentions = false;
out = get();
assert.deepEqual(out.map(t => t.text), ['@AdamSchefter @ESPNNFL Oddly convenient', 'No reply here'], 'switch off keeps the handles');
sandbox.state.multiTweets = [null, null, null];
assert.equal(get()[0].text, 'sample', 'no tweets: samples');

// Wiring.
assert.match(html, /id="multi-tweet-hide-mentions" type="button" role="switch" aria-checked="true"[\s\S]{0,300}Hide reply @mentions/);
assert.ok(html.indexOf('id="multi-tweet-hide-mentions"') > html.indexOf('data-multi-tweet-status="2"') && html.indexOf('id="multi-tweet-hide-mentions"') < html.indexOf('id="multi-tweet-headline"'), 'switch sits with the multi-tweet inputs');
assert.match(html, /const MULTI_TWEET_HIDE_MENTIONS_KEY = 'frameup\.multiTweet\.hideReplyMentions';/);
assert.match(html, /try \{ return localStorage\.getItem\(MULTI_TWEET_HIDE_MENTIONS_KEY\) !== '0'; \} catch \(error\) \{ return true; \}/, 'default on, read in try/catch');
assert.match(html, /try \{ localStorage\.setItem\(MULTI_TWEET_HIDE_MENTIONS_KEY,[^\n]*\} catch \(error\) \{\}/, 'saved in try/catch');
assert.match(html, /function getTwitterMultiPayload\(\) \{[\s\S]{0,300}tweets: getMultiTweets\(\)/, 'payload goes through getMultiTweets');
assert.match(html, /const tweets = getMultiTweets\(\);\n  const cardW = W - sx\(96\);/, 'render goes through getMultiTweets');

// Cover text drag wiring.
assert.match(html, /function textDragTakesPriority\(point\) \{\n  if \(document\.body\.dataset\.studioInspector === 'image'\) return false;\n  return canStartTextDragAt\(point\);/);
assert.match(html, /const point = getCanvasPoint\(event\);\n    \/\/ A press on the text block drags the text[^\n]*\n    if \(textDragTakesPriority\(point\)\) return;\n    const bounds = getSelectedImageEditBounds\(\);\n    event\.stopImmediatePropagation\(\);/, 'crop handler yields before swallowing the press');
assert.match(html, /if \(isCanvasImageEditMode\(\) && !textDragTakesPriority\(point\)\) return;/);
assert.match(html, /\.canvas-wrap\.is-text-hover canvas#preview \{\n    cursor: grab;/);

console.log('editor reply mentions + text drag wiring tests passed.');
