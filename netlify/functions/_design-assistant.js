'use strict';
// Generate "Creative": the AI design assistant's server half (mode
// 'creative-assist' in es-generate.js). One instruction on ONE composed design
// -> a scene patch (JSON ops, see generate-assistant.js), never pixels.
//
//   1. Local intents first ("brighten the photo", "bigger number", "swap to the
//      versus layout"): applied in code, no AI call, $0.
//   2. Otherwise one AI call: Haiku (tier main) for copy and small edits,
//      Sonnet (tier best) for layout changes. Feature 'generate-assistant'
//      (logged by aiText with logUsage; es-generate.js runs aiSpendGate first).
//   3. Never trusts the model: unknown ops / props are dropped, photos only
//      from this design's ES photos, logos only from the story's teams,
//      palettes only from the team kits / ES, and every op is re-checked by
//      FrameUpCompose.checkScene with the brief's facts (an op that adds a
//      number that is not a fact is skipped, the rest still apply).
const COMPOSE = require('../../frameup-compose.js');
const ENGINE = require('../../generate-assistant.js');
const LOGOS = require('../../logo-library.js');
const BRAND_KIT = require('../../brand-kit.js');
const RULES = require('../../frameup-rules.js');

const gateway = () => require('./_ai-gateway.js');
const clean = (value, max = 300) => String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/[{}`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const MAX_SCENE_CHARS = 120 * 1000;
const COMPLEX = /\b(?:layout|composition|versus|split|rearrange|re-?arrange|redesign|restructure|re-?compose|swap to|switch to|turn (?:it )?into|grid|stack(?:ed)?|collage|story size|square)\b/i;

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    if (raw[end - 1] !== '}') continue;
    try { return JSON.parse(raw.slice(start, end)); } catch (error) { /* shrink */ }
  }
  return null;
}

// Is this a scene we can work on? (Shape only; checkScene does the rest.)
function sceneError(scene) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return 'Missing design.';
  if (scene.kind !== 'composed' || !Array.isArray(scene.layers) || !scene.size) return 'Not a composed design.';
  if (scene.layers.length > 40) return 'The design has too many layers.';
  let size = 0;
  try { size = JSON.stringify(scene).length; } catch (error) { return 'Invalid design.'; }
  if (size > MAX_SCENE_CHARS) return 'The design is too large.';
  return '';
}

// The page's context, cleaned: photos (ES only), logos (library or the
// page's team logos), facts, sport. Palettes come from the logo library.
function cleanContext(context = {}, scene) {
  const http = src => /^(?:https?:\/\/|\/|data:image\/(?:png|jpeg|webp);base64,)/.test(String(src || '')) && String(src).length < 2000;
  const photos = (Array.isArray(context.photos) ? context.photos : []).slice(0, 8).filter(p => http(p?.src)).map((p, i) => ({ id: `p${i + 1}`, src: p.src, cutout: http(p.cutout) ? p.cutout : '', person: clean(p.person, 40) }));
  const logos = (Array.isArray(context.logos) ? context.logos : []).slice(0, 4).filter(l => http(l?.src)).map((l, i) => ({ id: `l${i + 1}`, src: l.src, name: clean(l.name, 40) }));
  const facts = (Array.isArray(context.facts) ? context.facts : []).slice(0, 24).map(f => ({ id: clean(f?.id, 12), text: clean(f?.text, 200) })).filter(f => f.text);
  // Palettes: the teams' brand kit / library colours, ES, and the flip.
  const palettes = [{ id: 'es', name: 'ES navy and blue', colors: ['#033162', '#0A7DFA', '#FFFFFF'] }];
  logos.forEach(l => {
    const team = l.name ? LOGOS.findTeam(l.name) : null;
    const kit = team ? BRAND_KIT.find(e => (e.team || '').toLowerCase() === String(team.name || '').toLowerCase()) : null;
    const colors = [...new Set([...(kit ? [kit.primary?.background, kit.primary?.foreground] : []), ...(team?.colors || [])].filter(c => /^#[0-9a-f]{6}$/i.test(String(c || ''))))].slice(0, 3);
    if (colors.length >= 2) palettes.push({ id: `team:${l.name}`, name: l.name, colors });
  });
  return { sport: clean(context.sport, 20), photos, logos, facts, palettes, critique: (context.critique?.improvements || []).slice(0, 4).map(t => clean(t, 160)), compose: COMPOSE, scene };
}

// What the model sees of the scene: one line per layer.
function describe(scene) {
  return (scene.layers || []).map((l, i) => {
    const bits = [`#${i}`, l.type, l.role ? `role=${l.role}` : '', l.shape ? `shape=${l.shape}` : ''];
    if (l.type === 'number') bits.push(`value="${l.prefix || ''}${l.value || ''}${l.suffix || ''}" label="${clean(l.label, 40)}"`);
    else if (l.text) bits.push(`text="${clean(l.text, 80)}"`);
    ['x', 'y', 'w', 'h', 'size', 'maxLines', 'align'].forEach(k => { if (l[k] != null && l[k] !== '') bits.push(`${k}=${typeof l[k] === 'number' ? Math.round(l[k]) : l[k]}`); });
    if (l.color) bits.push(`color=${l.color}`);
    if (l.bg) bits.push(`bg=${l.bg}`);
    if (l.fx && Object.keys(l.fx).length) bits.push(`fx=${JSON.stringify(l.fx).slice(0, 80)}`);
    if (l.duotone) bits.push('duotone');
    if (l.type === 'photo' || l.type === 'cutout' || l.type === 'logo') bits.push(l.role === 'art' ? 'concept-art' : 'image');
    return bits.filter(Boolean).join(' ');
  }).join('\n');
}

function SYSTEM() {
  return [
    'You are the senior designer at EssentiallySports (ES), editing ONE composed Instagram design for an editor.',
    'You never draw pixels: you reply with a scene patch, a list of JSON ops on the design\'s layers.',
    '',
    'Ops (target = a layer index, or {"role":"headline"} / {"type":"number","nth":0}):',
    '- {"op":"text","target":T,"text":"..."}  rewrite copy (headline 2-6 words; uppercase is applied). On a number layer it sets the label.',
    '- {"op":"set","target":T,"props":{...}}  props: x, y, w, h, size, minSize, maxLines, lineHeight, tracking, align (left/center/right), valign, color, bg (hex from the palette), duotone ([hex,hex] or null), focus ({x,y} 0-1), stops (gradient [[at,alpha]]), texture (grain/halftone/rays/grid/lines/none), textureOpacity.',
    '- {"op":"fx","target":T,"fx":{"opacity":0-1,"blend":"multiply|screen|overlay|soft-light|normal","rotate":-8..8,"shadow":{"color":"#000000","blur":20,"y":6,"alpha":0.5},"glow":{...}}}',
    '- {"op":"move","target":T,"dx":0,"dy":0}  {"op":"scale","target":T,"by":1.2}  {"op":"remove","target":T}  {"op":"order","target":T,"to":"front|back|up|down"}',
    '- {"op":"add","layer":{"type":"shape|pill|text","role":"kicker|label|body","text":"...","x":..,"y":..,"w":..,"h":..,"color":"#hex","bg":"#hex"}}',
    '- {"op":"fix","name":"bigger-number|bigger-headline|shorter-headline|darker-mist|more-contrast|less-clutter|swap-palette|move-headline-up|brighten-photo|darken-photo|more-drama|add-logo|bigger-logo","logo":"l1"}',
    '- {"op":"photo","photo":"p2"}  another of this design\'s ES photos (by id).',
    '- {"op":"palette","palette":"es|team:<name>"} or {"op":"palette","flip":true}',
    '- {"op":"archetype","id":"<composition id>"}  rebuild as another composition (only ids listed as fitting).',
    '- {"op":"size","size":"portrait|story|square"}',
    '',
    'ES rules (a change that breaks them is rejected):',
    '- Canvas 1080 wide; keep text 50px inside every edge and clear of the ES logo (top-right 122x104, 50px in). Never add or move the ES logo.',
    '- ES fonts only (display / condensed / body). No outlined or stroked text. Colours from the design\'s palette only. No purple.',
    '- NEVER add, change or invent a number. Digits may only come from the facts listed. Do not invent names, results or quotes.',
    '- Keep one focal point; small, purposeful changes. Prefer 1-4 ops.',
    ...RULES.VOICE.map(line => `- ${line}`),
    '',
    'Reply with JSON only: {"reply":"one short sentence saying what you changed (or why you could not)","ops":[...],"suggestions":["2-4 short next asks"]}',
  ].join('\n');
}

function request({ instruction, scene, history, ctx }) {
  const fitting = COMPOSE.ARCHETYPES.filter(a => a.id !== scene.archetype && COMPOSE.fits(a.id, ENGINE.inputsFromScene(scene, ctx))).map(a => `${a.id} (${a.name})`);
  return [
    `Design: ${scene.archetypeName || scene.archetype} (${scene.archetype}), ${scene.size.w}x${scene.size.h}. Palette: ${JSON.stringify({ bg: scene.palette?.bg, ink: scene.palette?.ink, accent: scene.palette?.accent, allowed: (scene.palette?.allowed || []).slice(0, 10) })}`,
    `Layers (index first; #0 is the back):\n${describe(scene)}`,
    `Facts (the only numbers allowed): ${JSON.stringify([...(scene.facts || []), ...ctx.facts].map(f => f.text).filter((t, i, a) => a.indexOf(t) === i).slice(0, 24))}`,
    ctx.photos.length ? `ES photos: ${JSON.stringify(ctx.photos.map(p => ({ id: p.id, person: p.person, cutout: Boolean(p.cutout) })))}` : 'ES photos: none',
    ctx.logos.length ? `Logos: ${JSON.stringify(ctx.logos.map(l => ({ id: l.id, name: l.name })))}` : 'Logos: none',
    `Palettes: ${JSON.stringify(ctx.palettes.map(p => p.id))}`,
    `Compositions that fit: ${fitting.join(', ') || 'none'}`,
    ctx.critique.length ? `Art director's open notes: ${JSON.stringify(ctx.critique)}` : '',
    history.length ? `Conversation so far:\n${history.map(t => `${t.role === 'user' ? 'Editor' : 'You'}: ${t.text}`).join('\n')}` : '',
    `Editor: ${instruction}`,
  ].filter(Boolean).join('\n\n');
}

// Model ops -> engine ops (ids to sources, palette keys to colours). Unknown
// shapes are dropped here; the engine and checkScene check the rest.
function normalizeOps(raw, ctx) {
  const list = Array.isArray(raw) ? raw.slice(0, 8) : [];
  const out = [];
  list.forEach(op => {
    if (!op || typeof op !== 'object' || !ENGINE.OPS.includes(op.op) || op.op === 'replace') return;
    const next = { ...op };
    if (op.op === 'photo') {
      const p = ctx.photos.find(x => x.id === op.photo || x.src === op.src);
      if (!p) return;
      next.src = p.src;
      delete next.photo;
    }
    if (op.op === 'fix' && op.name === 'add-logo') {
      const l = ctx.logos.find(x => x.id === op.logo || x.name === op.logo) || ctx.logos[0];
      if (!l) return;
      next.src = l.src;
      delete next.logo;
    }
    if (op.op === 'add' && op.layer?.type === 'logo') {
      const l = ctx.logos.find(x => x.id === op.layer.logo || x.src === op.layer.src);
      if (!l) return;
      next.layer = { ...op.layer, src: l.src };
    }
    if (op.op === 'palette') {
      if (op.flip) out.push({ op: 'palette', flip: true });
      else {
        const p = ctx.palettes.find(x => x.id === op.palette);
        if (p) out.push({ op: 'palette', colors: p.colors, name: p.name });
      }
      return;
    }
    out.push(next);
  });
  return out;
}

const suggestionsFrom = list => (Array.isArray(list) ? list : []).map(s => clean(s, 60)).filter(s => s.length >= 4 && !/\d/.test(s)).slice(0, 4);

// assist(...) -> { status, body }
async function assist({ instruction, scene, history = [], context = {}, track = null, timeoutMs = 22000 } = {}) {
  const text = clean(instruction, 300);
  if (text.length < 2) return { status: 400, body: { error: 'Type what to change.' } };
  const bad = sceneError(scene);
  if (bad) return { status: 400, body: { error: bad } };
  const ctx = cleanContext(context, scene);
  const turns = (Array.isArray(history) ? history : []).slice(-6).map(t => ({ role: t?.role === 'user' ? 'user' : 'assistant', text: clean(t?.text, 200) })).filter(t => t.text);

  // 1. Free: a local intent.
  const local = ENGINE.localIntent(text, scene, ctx);
  if (local) {
    const res = ENGINE.applyPatch(scene, local.ops, ctx);
    if (res.ok) return { status: 200, body: { ok: true, reply: local.reply, ops: res.applied, scene: res.scene, skipped: res.skipped, fixes: res.fixes, suggestions: [], model: 'rules', tier: 'free', costUsd: 0 } };
  }

  // 2. One AI call.
  const { aiText, gatewayConfigured, isBudgetError } = gateway();
  if (gatewayConfigured && !gatewayConfigured()) return { status: 503, body: { error: 'The AI assistant is not available right now. Simple asks (brighten the photo, bigger number, more drama) still work.', reason: 'off' } };
  const tier = COMPLEX.test(text) || text.split(/\band\b/i).length > 2 ? 'best' : 'main';
  let reply;
  try {
    reply = await aiText({
      tier,
      system: SYSTEM(),
      cacheSystem: true,
      messages: [{ role: 'user', content: request({ instruction: text, scene, history: turns, ctx }) }],
      effort: 'low',
      maxTokens: tier === 'best' ? 1400 : 900,
      timeoutMs,
      track: track ? { ...track, feature: 'generate-assistant' } : undefined,
    });
  } catch (error) {
    if (isBudgetError?.(error)) return { status: 503, body: { error: "This week's AI budget is used up, so the assistant is paused until it resets.", reason: 'budget' } };
    if (error?.code === 'feature-off') return { status: 503, body: { error: error.message, reason: 'feature-off' } };
    return { status: 502, body: { error: 'The assistant did not answer. Try again in a moment.' } };
  }
  const parsed = extractJson(reply.text) || {};
  const ops = normalizeOps(parsed.ops, ctx);
  const res = ops.length ? ENGINE.applyPatch(scene, ops, ctx) : { ok: false, applied: [], skipped: [], fixes: [], scene };
  const costUsd = Number((Number(reply.cost) || 0).toFixed(5));
  return {
    status: 200,
    body: {
      ok: res.ok,
      reply: clean(parsed.reply, 300) || (res.ok ? 'Done.' : 'I could not make that change within the ES rules.'),
      ops: res.applied,
      scene: res.ok ? res.scene : undefined,
      skipped: res.skipped,
      fixes: res.fixes,
      suggestions: suggestionsFrom(parsed.suggestions),
      model: reply.model || '',
      tier,
      costUsd,
    },
  };
}

module.exports = { assist, normalizeOps, cleanContext, describe, SYSTEM, request, sceneError, COMPLEX };
