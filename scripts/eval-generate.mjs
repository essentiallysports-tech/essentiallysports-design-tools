#!/usr/bin/env node
// Scores Generate against the test bank (scripts/generate-eval-cases.mjs).
// Developer tool, not part of npm test: it calls the real AI.
//
//   npm run eval:generate                    (local preview on :8935)
//   EVAL_URL=http://localhost:8935 EVAL_ONLY=quote-verbatim,birthday npm run eval:generate
//
// Paces requests (EVAL_GAP_MS, default 12s) to stay inside free-tier limits.
import { CASES } from './generate-eval-cases.mjs';

const base = process.env.EVAL_URL || 'http://localhost:8935';
const gap = Number(process.env.EVAL_GAP_MS || 12000);
const only = new Set(String(process.env.EVAL_ONLY || '').split(',').filter(Boolean));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(testCase) {
  const response = await fetch(`${base}/api/es-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: testCase.brief, formats: testCase.formats || [] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  return response.json();
}

let passed = 0;
let total = 0;
const rows = [];
for (const testCase of CASES.filter(c => !only.size || only.has(c.id))) {
  let result = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await run(testCase).catch(error => ({ error: error.message, designs: [], notes: [] }));
    // Rate-limited: the AI did not run, so the result would not measure it.
    if (!result.notes?.some(note => /rate limit|429|tokens per minute/i.test(note))) break;
    await wait(gap * 3);
  }
  const outcomes = Object.entries(testCase.checks).map(([name, check]) => {
    let ok = false;
    try { ok = Boolean(check(result)); } catch (error) { ok = false; }
    return { name, ok };
  });
  passed += outcomes.filter(o => o.ok).length;
  total += outcomes.length;
  rows.push({ id: testCase.id, brain: result.brain || 'error', outcomes, result });
  const mark = outcomes.every(o => o.ok) ? 'PASS' : 'FAIL';
  console.log(`\n${mark}  ${testCase.id}  [${result.brain || result.error}]  past examples: ${result.learning?.examplesUsed ?? '-'}`);
  outcomes.forEach(o => console.log(`   ${o.ok ? 'ok ' : 'NO '} ${o.name}`));
  (result.designs || []).forEach(d => console.log(`   - ${d.postType} ${d.sport || ''}/${d.team || ''}: ${JSON.stringify(d.listicle ? d.listicle.rows.map(r => r.entity) : d.lines).slice(0, 140)}`));
  const notes = (result.notes || []).filter(n => !/post type ""/.test(n));
  if (notes.length) console.log(`   notes: ${notes.join(' | ').slice(0, 300)}`);
  await wait(gap);
}
console.log(`\nScore: ${passed}/${total} checks (${Math.round((passed / Math.max(total, 1)) * 100)}%), ${rows.filter(r => r.outcomes.every(o => o.ok)).length}/${rows.length} briefs fully passed`);
