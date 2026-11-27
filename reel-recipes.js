// Reels Studio recipes (Reels 2.0, lane D). A recipe is a story shape built
// only from the ES Reels blocks (reel-es.js): a block sequence, a look and a
// one-line steer for the script writer.
//
//   AI on   : directorSteer(recipe) goes to /api/reel-maker mode "plan" as
//             `steer` (the server's EDITOR NOTE, 300 characters at most). The
//             director still checks every number and quote against the sources.
//   Script / free mode : applyRecipe(plan, id) reshapes a plan by code, at $0.
//             It never writes or rewrites a word: a beat only changes block
//             when its own line already holds what the block needs (a number,
//             two numbers and a comparison, "1 in 2,500", a quoted line).
//
// Pure: loads in the browser (window.ReelRecipes) and in Node (tests).
//
// Reels Studio v3 (2026-11-27): recipes are RETIRED. The four styles
// (ReelES.STYLES: Game Tape, Stat Card, Receipts, Hype Cut) are the only
// story shapes offered. Each recipe now names the style it opens in
// (RECIPES[id].style, styleFor), and applyStyle(plan, styleId) reshapes a
// plan to a style's block order by the same honest code ($0, no word
// changed). The recipe API stays for saved reels and older callers.
(function (root, factory) {
  const ES = typeof module === 'object' && module.exports ? require('./reel-es.js') : root.ReelES;
  const api = factory(ES);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelRecipes = api;
}(typeof self !== 'undefined' ? self : this, ES => {
  'use strict';

  // The eight ES looks (reel-es-themes.js). Listed here too so this file
  // checks itself before that one is merged.
  const LOOK_IDS = ['paper', 'ink', 'blue', 'team', 'photo', 'data', 'minimal', 'bold'];
  const BLOCK_TYPES = ES ? ES.BLOCK_TYPES : ['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard'];
  // The director's formats (reel-formats.js): what the recipe asks it to write.
  const FORMATS = ['explainer', 'stat', 'top5', 'quote'];

  const RECIPES = {
    'stat-drop': {
      id: 'stat-drop', label: 'Stat drop', blurb: 'One number that stops the scroll, then why it matters.',
      format: 'stat', look: 'data', blocks: ['hook', 'number', 'statement', 'compare', 'statement', 'endcard'], beats: { min: 4, max: 6 }, stamp: true,
      steer: 'Stat drop: open on the single biggest number from the sources, show it as a number block straight after the hook, then say why it matters.',
    },
    'quote-reaction': {
      id: 'quote-reaction', label: 'Quote reaction', blurb: 'What they said, word for word, and what it set off.',
      format: 'quote', look: 'ink', blocks: ['hook', 'quote', 'statement', 'statement', 'endcard'], beats: { min: 4, max: 6 }, stamp: true,
      steer: 'Quote reaction: lead with the exact quote from the sources and who said it, then the reaction to it. Never paraphrase inside a quote block.',
    },
    explainer: {
      id: 'explainer', label: 'Explainer', blurb: 'What happened, why, and what comes next.',
      format: 'explainer', look: 'paper', blocks: ['hook', 'statement', 'number', 'statement', 'statement', 'endcard'], beats: { min: 5, max: 7 },
      steer: 'Explainer: what happened, why it happened, what it changes. One idea a beat, the key figure in the middle.',
    },
    countdown: {
      id: 'countdown', label: 'Countdown', blurb: 'A ranked list, saved best for last.',
      format: 'top5', look: 'bold', blocks: ['hook', 'statement', 'statement', 'statement', 'statement', 'statement', 'endcard'], beats: { min: 5, max: 8 },
      steer: 'Countdown: a ranked list from the sources, counting down to number one. Each entry is a statement that starts with its rank, like "#3".',
    },
    versus: {
      id: 'versus', label: 'Versus', blurb: 'Two sides, side by side, on the numbers.',
      format: 'stat', look: 'blue', blocks: ['hook', 'compare', 'statement', 'compare', 'statement', 'endcard'], beats: { min: 4, max: 6 },
      steer: 'Versus: two players or teams head to head. Use compare blocks with the same measure for both sides, then say who the numbers favour.',
    },
    'fan-pulse': {
      id: 'fan-pulse', label: 'Fan pulse', blurb: 'What fans are saying, and a question for them.',
      format: 'explainer', look: 'team', blocks: ['hook', 'quote', 'dots', 'statement', 'endcard'], beats: { min: 4, max: 6 }, cta: ['YOUR CALL.', 'TELL US BELOW.'],
      steer: 'Fan pulse: fan-first. Lead with how fans reacted, use a sourced fan or player quote, and end by asking fans a clear question.',
    },
    verdict: {
      id: 'verdict', label: 'Verdict', blurb: 'A legend or insider gives the call on a named star.',
      format: 'quote', look: 'minimal', blocks: ['hook', 'quote', 'statement', 'number', 'statement', 'endcard'], beats: { min: 4, max: 6 }, stamp: true,
      steer: 'Verdict: a legend or insider judges a named star. Name both in the hook, quote the verdict exactly, then give the one fact behind it.',
    },
    'money-story': {
      id: 'money-story', label: 'Money story', blurb: 'The contract, the fine or the payout, in figures.',
      format: 'stat', look: 'data', blocks: ['hook', 'number', 'compare', 'statement', 'endcard'], beats: { min: 4, max: 6 },
      steer: 'Money story: put the money figure in the hook and as a number block with its currency, compare it with one other sourced figure, then say what it means.',
    },
  };
  const RECIPE_IDS = Object.keys(RECIPES);
  // Every retired recipe on its v3 style (ReelES.legacyStyle says the same).
  Object.values(RECIPES).forEach(r => { r.style = ES && ES.legacyStyle ? ES.legacyStyle('', r.id, {}) : 'receipts'; r.retired = true; });
  const styleFor = (recipeId, plan = {}) => (ES && ES.legacyStyle ? ES.legacyStyle('', recipeId, plan) : 'receipts');
  const get = id => RECIPES[id] || null;
  const list = () => RECIPE_IDS.map(id => RECIPES[id]);

  // A recipe is valid when it uses only the ES blocks, opens on a hook, ends
  // on the end card (once each), names a real look and fits the steer limit.
  function validate(recipe, { looks = (ES && ES.LOOK_IDS) || LOOK_IDS } = {}) {
    const problems = [];
    const r = recipe || {};
    const blocks = Array.isArray(r.blocks) ? r.blocks : [];
    if (!r.id || !r.label || !r.blurb) problems.push('needs an id, a label and a blurb');
    if (blocks.some(b => !BLOCK_TYPES.includes(b))) problems.push(`unknown block: ${blocks.filter(b => !BLOCK_TYPES.includes(b)).join(', ')}`);
    if (blocks[0] !== 'hook' || blocks.filter(b => b === 'hook').length !== 1) problems.push('must open on one hook');
    if (blocks[blocks.length - 1] !== 'endcard' || blocks.filter(b => b === 'endcard').length !== 1) problems.push('must end on the end card');
    if (!looks.includes(r.look)) problems.push(`unknown look: ${r.look}`);
    if (!FORMATS.includes(r.format)) problems.push(`unknown format: ${r.format}`);
    const min = r.beats && r.beats.min;
    const max = r.beats && r.beats.max;
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 3 && max >= min && max <= 9)) problems.push('beats need a whole min and max between 3 and 9');
    if (!r.steer || hintOf(r).length > 300) problems.push('steer and block list must fit 300 characters');
    if (r.cta && !(Array.isArray(r.cta) && r.cta.length === 2 && r.cta.every(c => typeof c === 'string' && c.length <= 30))) problems.push('cta is two lines of 30 characters or fewer');
    return problems;
  }

  // What the script writer is told: the steer, the block order and the length.
  const hintOf = r => `${r.steer} Blocks in order: ${(r.blocks || []).join(', ')}. ${r.beats ? r.beats.min : ''} to ${r.beats ? r.beats.max : ''} beats.`;
  function directorSteer(recipe, extra = '') {
    const r = typeof recipe === 'string' ? get(recipe) : recipe;
    if (!r) return String(extra || '').slice(0, 300);
    const hint = hintOf(r);
    const note = String(extra || '').trim();
    return (note ? `${note} ${hint}` : hint).slice(0, 300);
  }
  // The request fields a recipe adds to mode "plan" (never overrides a format the person picked).
  function planRequest(recipeId, { format = 'auto', steer = '' } = {}) {
    const r = get(recipeId);
    if (!r) return { format, steer };
    return { format: format && format !== 'auto' ? format : r.format, steer: directorSteer(r, steer), recipe: r.id };
  }

  // Which recipe fits a story, from its words alone (free, instant).
  function suggest(text) {
    const t = String(text || '');
    if (t.trim().length < 12) return '';
    if (/\$\s?\d|\b(?:contract|salary|fined?|payout|million|billion|extension|cap space|prize money)\b/i.test(t)) return 'money-story';
    if (/\b(?:vs\.?|versus|head to head|compared (?:to|with))\b/i.test(t)) return 'versus';
    if (/\b(?:top (?:\d+|five|ten)|ranked|ranking|best \d+|\d+ best|countdown)\b/i.test(t)) return 'countdown';
    if (/\b(?:fans?|supporters|crowd|booed|cheered|poll)\b/i.test(t) && /\b(?:react|turn|blast|slam|divided|split|furious|love|boo|vote|poll|say)/i.test(t)) return 'fan-pulse';
    if (/[“"][^”"]{8,}[”"]/.test(t)) return /\b(?:legend|hall of famer|former|ex-|insider|analyst|coach)\b/i.test(t) ? 'verdict' : 'quote-reaction';
    if (/\b(?:legend|hall of famer|insider|analyst)\b.*\b(?:says?|calls?|blasts?|slams?|backs?|warns?)\b/i.test(t)) return 'verdict';
    if ((t.match(/\d[\d,.]*/g) || []).length >= 2) return 'stat-drop';
    return 'explainer';
  }

  // ─── Reshape by code (script and free mode) ───────────────────────────────
  const clone = v => JSON.parse(JSON.stringify(v));
  const typeOf = beat => (ES ? ES.blockOf(beat).type : 'statement');
  // The blocks a beat can honestly be, from its own block and its own line.
  function candidates(beat, first) {
    const out = {};
    const base = ES.blockOf(beat);
    out[base.type] = base;
    const line = String(beat.vo || beat.text || '').trim();
    if (line) {
      const alt = ES.cleanBlock(ES.blockForLine(line, { first }));
      if (!out[alt.type]) out[alt.type] = alt;
    }
    const compare = out.compare;
    // A comparison can also show its first figure alone.
    if (compare && !out.number && compare.items && compare.items[0]) {
      const it = compare.items[0];
      const m = String(it.display || '').match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
      out.number = ES.cleanBlock({ type: 'number', value: it.value, prefix: m ? m[1].trim() : '', suffix: m ? m[3].trim() : '', label: it.label, kicker: compare.kicker || '', color: 'blue', display: it.display });
    }
    // Any line can be a statement (its own headline words).
    if (!out.statement && line) out.statement = ES.cleanBlock(ES.blockOf({ kind: 'point', text: ES.headline(line, 8) }));
    return out;
  }
  // "#3 ..." / "Number 3," / "3." at the start of a line -> the rank.
  function rankOf(line) {
    const m = String(line || '').replace(/\*/g, '').match(/^\s*(?:#|no\.?\s*|number\s+)?(\d{1,2})\s*[.:,)\-–—]\s+\S/i) || String(line || '').match(/^\s*(?:#|no\.?\s*|number\s+)(\d{1,2})\b/i);
    return m ? Number(m[1]) : 0;
  }
  // The word the person marked with *asterisks* in a line (their own emphasis).
  function markedWord(vo) {
    if (!ES) return '';
    const e = ES.parseEmphasis(vo);
    const i = e.flags.lastIndexOf(true);
    return i >= 0 ? e.words[i].replace(/[^\w$%'’-]/g, '').toUpperCase() : '';
  }
  function setBlock(beat, block) {
    const legacy = ES.legacyFields(block);
    ['stat', 'bars', 'dotrank', 'quote', 'chips', 'versus', 'roles'].forEach(k => { delete beat[k]; });
    Object.assign(beat, legacy);
  }

  // -> { plan, notes: [plain-English lines], changed: [beat ids] }
  // The plan comes back as a copy; the words of every voiceover line are the
  // same, in the same order.
  function applyRecipe(plan, recipeId, { keepLook = false } = {}) {
    const r = get(recipeId);
    if (!r || !ES || !plan || !Array.isArray(plan.beats)) return { plan, notes: [], changed: [] };
    const out = clone(plan);
    const notes = [];
    const changed = [];
    const beats = out.beats;
    const last = beats.length - 1;
    const endIsCard = last > 0 && typeOf(beats[last]) === 'endcard';
    const body = r.blocks.slice(1, -1);
    // How many of each block the recipe still has room for. The order of the
    // scenes is the order of the person's words, so slots are counted, not placed.
    const left = {};
    body.forEach(t => { left[t] = (left[t] || 0) + 1; });
    const take = t => { if (left[t] > 0) { left[t] -= 1; return true; } return false; };
    beats.forEach((beat, i) => {
      const was = typeOf(beat);
      // A draft beat with no block yet gets the block its own fields make (no words change).
      if (!beat.block) setBlock(beat, ES.blockOf(beat));
      if (i === 0) {
        // The hook stays a hook; the person's own emphasised word can stamp it.
        const hook = was === 'hook' ? ES.blockOf(beat) : candidates(beat, true).hook;
        if (!hook) return;
        const word = r.stamp ? markedWord(beat.vo) : '';
        if (word && !hook.stamp) hook.stamp = { text: word };
        setBlock(beat, hook);
        if (was !== 'hook' || word) changed.push(beat.id);
        return;
      }
      if (i === last && endIsCard) {
        if (r.cta) { const card = ES.blockOf(beat); card.cta = r.cta.slice(); setBlock(beat, card); changed.push(beat.id); }
        return;
      }
      const can = candidates(beat, false);
      // A scene keeps its block when the recipe has room for it. Otherwise it
      // becomes another block the recipe wants, but only one its own line can
      // fill. A number, a comparison, dots or a quote is never flattened into a statement.
      let want = was;
      const other = Object.keys(can).find(t => t !== 'statement' && t !== was && left[t] > 0);
      if (was === 'statement') { if (other) { take(other); want = other; } else take('statement'); }
      else if (!take(was) && other) { take(other); want = other; }
      let block = can[want] || can[was] || can.statement;
      if (!block) return;
      if (r.id === 'countdown' && block.type === 'statement') {
        const rank = rankOf(beat.vo || beat.text);
        if (rank && block.lines && block.lines.length && !/^#\d/.test(block.lines[0].text)) {
          const rest = ES.cleanBlock(ES.blockOf({ kind: 'point', text: ES.headline(String(beat.vo || beat.text).replace(/^\s*(?:#|no\.?\s*|number\s+)?\d{1,2}\s*[.:,)\-–—]?\s*/i, ''), 6) })).lines || [];
          block = ES.cleanBlock({ type: 'statement', lines: [{ text: `#${rank}`, color: 'blue' }, ...rest.slice(0, 2).map(l => ({ text: l.text, color: 'ink' }))] });
        }
      }
      if (block.type !== was || r.id === 'countdown') { setBlock(beat, block); if (block.type !== was) changed.push(beat.id); }
    });
    out.recipe = r.id;
    if (!keepLook || !out.look) out.look = r.look;
    const n = beats.length;
    if (n < r.beats.min) notes.push(`${r.label} works best with ${r.beats.min} to ${r.beats.max} scenes. This reel has ${n}: add a line or two.`);
    if (n > r.beats.max + 1) notes.push(`${r.label} works best with ${r.beats.min} to ${r.beats.max} scenes. This reel has ${n}: it may run long.`);
    const missing = [...new Set(body)].filter(t => t !== 'statement' && !beats.some(b => typeOf(b) === t));
    if (missing.length) notes.push(`No line had what a ${missing.map(t => ES.BLOCKS[t].label.toLowerCase()).join(' or ')} block needs, so those scenes stay as statements. Nothing was made up.`);
    return { plan: out, notes, changed };
  }

  // ─── v3: a style as a preset (code only, $0) ─────────────────────────────
  // The style's blocks become the slots a scene may move into: a scene keeps
  // its block when the style allows it, else takes the first block the style
  // allows that its own line can honestly fill, else a statement. Words never
  // change. Blocks the style cannot use are noted.
  function applyStyle(plan, styleId) {
    if (!ES || !ES.getStyle || !plan || !Array.isArray(plan.beats)) return { plan, notes: [], changed: [] };
    const style = ES.getStyle(styleId);
    const out = clone(plan);
    const notes = [];
    const changed = [];
    const allowed = new Set(style.blocks);
    const last = out.beats.length - 1;
    out.beats.forEach((beat, i) => {
      if (!beat.block) setBlock(beat, ES.blockOf(beat));
      const was = typeOf(beat);
      if (allowed.has(was) || (i === last && was === 'endcard')) return;
      const can = candidates(beat, i === 0);
      const pick = Object.keys(can).find(t => allowed.has(t) && t !== was) || (allowed.has('statement') ? 'statement' : null);
      if (pick && can[pick]) { setBlock(beat, can[pick]); changed.push(beat.id); } else notes.push(`Scene ${i + 1} (${ES.BLOCKS[was].label}) is not a ${style.label} block; it is kept as it is.`);
    });
    out.esStyle = style.id;
    delete out.recipe;
    return { plan: out, notes, changed };
  }

  return { RECIPES, RECIPE_IDS, LOOK_IDS, get, list, validate, directorSteer, planRequest, suggest, applyRecipe, candidates, rankOf, markedWord, styleFor, applyStyle };
}));
