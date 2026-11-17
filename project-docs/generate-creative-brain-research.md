# Generate: Creative Direction Brain (research + build spec)

Status: research only, 2026-11-17. Nothing here is built yet. The builder agent follows section H literally.
Goal (Suhail): Generate gets "its own creative direction brain, which works on the guardrails of ES and the older posts that were made on FrameUp".

> **Pre-flight for the builder (must read).** A release is staged in git right now. `netlify/functions/es-generate.js`, `generate.html`, `dashboard.html`, `index.html`, `netlify/functions/_ai-gateway.js` and `scripts/test-es-generate-quality.mjs` are all in the staged index. Edit the working tree only. Never `git add`, commit, stash or push. Prefer to start after Suhail says the release is pushed. If you start before that, record every touched file in `project-docs/ai-edit-log.md` so the release can be rebuilt from `HEAD` plus its own edits. **`index.html` holds Suhail's uncommitted WIP: do not edit it** in Phase 1. Phase 2 needs one version-string bump there (see H).

---

## A. Current state

### A1. Pipeline, end to end (`POST /api/es-generate`, `netlify/functions/es-generate.js` → `generate()`)

```
generate.html  ──POST {brief, formats:[]|[type], count:4, avoid?}──►  handler
  verifyEsUser → weekly $ cap (frameup_my_ai_spend) → hourly cap (frameup_my_ai_calls_last_hour)
  │
  ├─ discover()             ES MCP tools (if configured), else none
  ├─ PARALLEL
  │    research()           ES WP tag lookup (≈3s) or full-text search (≈15s) / MCP query_articles
  │                         → digest (≤7.5k chars) for the prompt + corpus (≤80k chars) for fact checks
  │                         cached 10 min per name set (COVERAGE_CACHE)
  │    loadPastDesigns()    RPC list_frameup_examples (title, variant, exported_at, brief) ×4 pages of 96
  │                         → normalize() → selectExamples() (word overlap + newest per template, max 10)
  │                         cached 10 min per instance (team-wide)
  ├─ photoWork (parallel with writing): photoCandidates(person) → pickPhoto() [Haiku vision, ≤5 images]
  ├─ WRITE   buildPrompt() → chat(provider)          ONE call does understanding + template choice + copy + 2 alts
  │          provider = Gateway main tier (Claude Haiku 5.5, cached static system part)
  │                     → Groq gpt-oss-120b (+20b, qwen) on error/budget → OpenAI opt-in → rules "draft"
  ├─ CHECK   keepValid(): checkSpec (char limits, shapes) → lintSpec (pixel fit, banned, numbers, quotes,
  │          duplicate lead, team/sport) → auto re-split → promote passing alt → applyPatch
  ├─ REPAIR  one repairPrompt() round for failed designs (same provider); still failing → dropped
  ├─ TABLE   parseTableBrief() → forced listicle first if AI missed it
  ├─ DRAFT   draftPlan() rule fallback when no AI / AI failed / nothing returned for a real brief
  ├─ REVIEW  reviewDesigns()  [tier review = openai/gpt-6-luna]   scores hook/specific/voice/glance, picks best option
  ├─ ESCALATE escalateDesigns() [tier best = Claude Sonnet 5.5]   ≤2 cards scoring <3.5, one call, re-checked
  └─ PHOTO   assign picked ES photo / findPhoto() per spec; brandHints(); sources
  → { brain, designs[], research, connection, ai, photo, checks, quality, meta{ms,costUsd}, learning, notes }

Other modes: {mode:'rewrite', instruction: punchier|shorter|angle (Haiku) | best (Sonnet)} → one card,
re-linted; {mode:'trending'} → ES MCP trending tool.
Client: generate.html renders each spec in a hidden index.html frame via frameup-spec.js (renderToDataUrl).
```

### A2. Models (`_ai-gateway.js` MODELS / PRICES, USD per 1M tokens)

| Tier | Model | In / Out (cache read) | Used for |
|---|---|---|---|
| main | anthropic/claude-haiku-5.5 | 0.10 / 0.50 (0.01) | writer, repair, photo pick, quick rewrites |
| review | openai/gpt-6-luna | 0.10 / 0.50 | art-director score + pick |
| best | anthropic/claude-sonnet-5.5 | 2 / 10 (0.20) | escalation (≤2 cards), "Best version" rewrite |
| light | openai/gpt-oss-20b | 0.03 / 0.14 | not used by Generate |
| backup | Groq gpt-oss-120b / 20b / qwen | free tier | when Gateway errors or budget runs out (no review) |

### A3. Cost per run today (estimated from prompt sizes)

| Step | Tokens (in / out) | Cost |
|---|---|---|
| Writer (Haiku; ≈2.6k static cached + ≈2.6k request) | ≈5.2k / ≈1.5k | ≈$0.0012 |
| Photo pick (Haiku vision, 5 images) | ≈6k / ≈20 | ≈$0.0006 |
| Review (luna) | ≈0.7k / ≈0.12k | ≈$0.00013 |
| Repair round (sometimes) | ≈1.5k / ≈0.6k | ≈$0.0005 |
| Escalation (sometimes, Sonnet) | ≈1.8k / ≈0.3k | ≈$0.0066 |
| **Typical run** | | **≈$0.002 (no escalation) to ≈$0.009** |

The test `test-es-generate-fast.mjs` asserts that a run costs under $0.01. `test-es-generate-quality.mjs` asserts that a run with one escalation costs under $0.05.

### A4. Why outputs feel generic or off-brand

1. **No creative decision is made explicitly.** One Haiku call has to read the brief, pick templates, invent hooks and write copy, all at once. It falls back on the safest reading. `why` holds the template's rationale ("A hook."), never an angle. Nothing makes four cards take four different ideas.
2. **The memory of past posts is thin:**
   - `list_frameup_examples` returns only `title`. That is the canvas name, or the lines joined together. Slug titles are dropped for every format except rankings.
   - It never returns the real text fields in `metadata.design.state` (`lines`, `listicleData`), the sport and team, the palette, or the photo.
   - There is no quality signal at all: every export counts the same, and a test export counts as much as a great post.
   - Selection is word overlap plus newest. It ignores team and sport, and the examples' `team` is explicitly distrusted.
3. **There are only 3 hand-written gold examples**, and they never change.
4. **Diversity is weak.** It rests on one prompt line ("Vary the templates") plus the duplicate-lead lint, so two covers can say the same thing in other words.
5. **Critique happens after the fact and only on words.** The reviewer scores hook, specific, voice and glance on text. It never sees what each card was *meant* to do, so escalation polishes words, not direction.
6. **There is no photo direction.** There is one pick per main person and no shot type, so a celebration photo can land on a "heartbreak" angle.
7. **There is no colour decision.** The team sets the colours, and `pillPaletteIdx` is always 0, even though every team has 4 palette pairs.
8. **Generate learns nothing from what editors do in it.** Alt switches, rewrites (and which ones), team overrides, photo swaps, "Try again" and downloads are all lost. The only trace is `metadata.generated.brief` on an export, and only when it was opened via Edit/Download within 3 hours with the same postType.
9. **`RULES.STAT_LABELS` is defined but never enforced.** The "only real stat labels" rule is prompt-only (`frameup-rules.js:69`, unused in `_lint-spec.js`).
10. **"Auto + admin stars" does not exist yet.** There is no design rating anywhere in the repo:
    - `get_frameup_star_user` is "stars of the week", meaning the top exporters by count.
    - Exports do carry an admin `status` (Assigned/Doing/Review/Done) and `admin_notes`, but that is workflow, not quality.
    - `frameup_ad_ratings` applies to Video Ads only.

---

## B. Guardrails inventory

### B1. Enforced in code (the brain must keep all of these as hard gates)

| Rule | Where | On failure |
|---|---|---|
| Template shapes and char limits (cover 1–4 pills of 2–20; quote 1–3 lines ≤18; long quote 20–220; stats 3 / 4+4 with value ≤7, label ≤8; listicles 3–10 rows, title ≤2×30, entity ≤26, metric ≤14, subtitle ≤28) | `es-generate.js checkFields` | design rejected → repair |
| Pixel fit on the 1080×1350 canvas (Acumin post font, min sizes: pill 84px, quote 90px, long quote 50px, stat value 110px…) | `frameup-rules.js FIT` + `_glyph-widths.js` + `_lint-spec.js fitIssues` | `too-long` → auto re-split → repair |
| Banned words/patterns (clickbait, hype words, CTAs, "Breaking", slang, `!!`/`??`, hashtags, links, emoji, profanity) | `frameup-rules.js BANNED` | error |
| Filler words (very, really, just…) | `WEAK_WORDS` | warning |
| Every number appears in the brief or ES research (team-name numbers allowed; "Top 5" = row count) | `_lint-spec.js` §3 | `unsourced-number` error |
| Quotes are verbatim in the brief or research | `_lint-spec.js` §4, `fakeQuote` | `unsourced-quote` error |
| Quote/Long Quote words are BY the subject, not about them (he/his without I/we) | `readsAsAbout` | error |
| No two cards lead with the same line | `_lint-spec.js` §5 | `duplicate` |
| Cover ≤10 words | §6 | warning |
| Sport/team are real brand-kit entries (181 entries: NFL 32, NBA 30, MLB 30, CBB W 25, CFB 14, WNBA 13, CBB M 12, Unrivaled 8, Tennis 8, Golf 4, Neutral 5); unknown team cleared (never guess colours) | `_lint-spec.js` §7, `brand-kit.js` | patch + warning |
| Sources are only ES URLs that research actually returned | `checkSpec` | dropped |
| Photos only from ES hosts via the proxy allowlist; AI never draws people; photo pick may reject all | `PROXY_IMAGE_HOSTS`, `pickPhoto` | no photo + "pick one" hint |
| Scene prompt: no capitalised words (names, teams, logos) | `sceneText` | stripped |
| A pasted table always becomes a listicle | `parseTableBrief/tableDesign` | forced |
| Spend caps: $20/user/week, 120 calls/user/hour, Gateway weekly cap | `_ai-gateway.js` | 429 / Groq |

### B2. Prompt-only today (the brain should move these into code where it can)

| Rule | Proposal |
|---|---|
| Covers are hooks (claim/question), not summaries | Director assigns a `hook` type per concept; reviewer scores "on-angle". Stays soft. |
| Stats only real performance labels (no ages, money, years) | **Enforce `RULES.STAT_LABELS` in lint** (Phase 1, error `bad-stat-label`). |
| Current team, never the opponent | Deterministic read + learned team memory (Phase 2), plus the existing brand-kit check |
| One story, don't switch to another story from research | Director `factsUsed` must be found in the brief or corpus (validated) |
| Exact words from the brief kept (only split/recase) | Already partly guarded by quote/number lint; keep the prompt rule |
| Title Case | Cosmetic (the canvas uppercases); keep prompt-only |
| ES voice (punchy, plain American sports English) | `RULES.VOICE` in every prompt; house-style lines from data (D2) |
| Vary templates / give ≥2 options | Director + `validateConcepts` distinctness (code) |

### B3. Brand facts the brain may rely on (from the project docs)

- Posts are bold, high-contrast, dark photo with white text, and use strong team-colour pills.
- Acumin Condensed Bold, uppercased. Shorter lines read bigger (a pill is best at 10–16 chars).
- The ES logo position is fixed. The brain does not control layout, fonts or logo; only the template, line splits, pill count, palette pair and photo.

---

## C. Past-posts data

### C1. Where it lives

- Table `public.es_designer_tasks`: one row per export (`task_type='exported_design'`). Relevant columns:
  - `id` (text PK, `DES…`/`EXP…`), `created_at`, `workspace` ('Social Media'), `workspace_variant` ('Cover Image', 'Player Stats'…), `title` (canvas name or joined lines), `sport`, `team_or_league` (often the editor default, unreliable), `status` (admin workflow), `admin_notes`, `creator_name`, `creator_email`.
  - `metadata` (jsonb):
    - `exportedAt`, `outputSize`, `previewDataUrl` (hundreds of KB to MB);
    - `previewPath` (Storage `frameup-previews/previews/<id>`);
    - `generated: {brief, postType}` when it came from Generate;
    - **`design`** (since about 2026-11-11, about 8 KB) = `{format, workspace, canvasName, state:{postType, lines[], sport, team, pillPaletteIdx, listicleData{title, entityHeader, metric1Header, metric2Header, rows[{rank, entity, metric1, metric2, hidden}]}, listicleType2Data{title, rows[{entity, subtitle, hidden}]}, photo:{__img:{url}}|null, …}}`.
- Storage: thumbnails `frameup-previews/thumbs/<id>.webp` (approved users), full previews `previews/<id>` (`can_read_frameup_preview`).

### C2. Read paths and RLS today

| Reader | Path | What it sees |
|---|---|---|
| Table select | RLS: admin all; ES-domain user own rows | full rows |
| `list_frameup_gallery(p_limit≤96, p_before)` | security definer, approved users | id, title, variant, sport, team, creator_name, filename, output_size, exported_at (no emails) |
| `get_frameup_gallery_preview(p_id)` | approved users | previewDataUrl |
| `list_frameup_examples(p_limit≤200, p_before)` | approved users, used by `_generate-examples.js` with the caller's token | title, variant, exported_at, brief |
| `get_frameup_gallery_design` | called by `dashboard-data.js fetchGalleryDesign` but **not in any migration** (draft SQL kept outside the repo, per `editor-basics.md`) | — |
| `gallery.html` / `dashboard-data.js fetchGalleryExports` | `list_frameup_gallery`, admin fallback to the table | as above |

The server calls Supabase **with the signed-in user's own token** (publishable key + `Authorization: Bearer`), the same as `logUsage`. There is no service key on the server. Keep it that way: the new read is one more security-definer RPC.

### C3. Best signal of "good past posts" (ranked)

1. **Admin stars**: a new `frameup_design_ratings` table, 1–5, admins only (Phase 1 creates the table; Phase 3 adds the UI).
2. **Exported from Generate without edits**: `metadata.generated.aiText` equals the exported `design.state.lines`. This needs Phase 3 export linkage. Until then, an export with `generated.brief` counts as a confirmed brief → design pair.
3. **Auto score**: the reviewer's score at generation, stored in `metadata.generated.score` (Phase 3) and in `generated` events (Phase 2).
4. **Admin status `Done`**: a weak positive.
5. **Recency**: decays after about 45 days (voice drifts, teams change).

Today only signals 4 and 5, plus the `generated.brief` part of signal 2, exist. That is why Phase 1 ships the ratings table empty: the scorer is written to use the stars as soon as they exist.

### C4. New SQL (Phase 1 migration): `supabase/migrations/20261118120000_frameup_generate_corpus.sql`

Idempotent, additive. Revoked from anon. Granted to authenticated. Never returns emails, creator names or user ids.

```sql
-- FrameUp Generate: the creative brain's memory of past Social Media posts.
--
-- 1. frameup_design_ratings: admin star ratings (1-5) on exported designs.
--    One row per export (the latest admin rating wins). Admins read/write;
--    nobody else reads the table directly.
-- 2. list_frameup_generate_corpus(): read-only, SECURITY DEFINER, for approved
--    ES users (Generate calls it with the user's own session). Returns only the
--    small text fields of each export's shareable design copy, the brief it was
--    generated from, admin status and stars. No emails, names or user ids.
-- 3. An index for "recent Social Media exports".
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.list_frameup_generate_corpus(integer, timestamptz);
--   drop table if exists public.frameup_design_ratings;
--   drop index if exists public.es_designer_tasks_exports_recent_idx;

create table if not exists public.frameup_design_ratings (
  task_id text primary key references public.es_designer_tasks (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  note text check (note is null or char_length(note) <= 280),
  rated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.frameup_design_ratings enable row level security;

drop policy if exists "frameup design ratings: admins read" on public.frameup_design_ratings;
create policy "frameup design ratings: admins read"
  on public.frameup_design_ratings for select
  to authenticated
  using (public.is_es_designer_admin());

drop policy if exists "frameup design ratings: admins insert" on public.frameup_design_ratings;
create policy "frameup design ratings: admins insert"
  on public.frameup_design_ratings for insert
  to authenticated
  with check (public.is_es_designer_admin() and rated_by = (select auth.uid()));

drop policy if exists "frameup design ratings: admins update" on public.frameup_design_ratings;
create policy "frameup design ratings: admins update"
  on public.frameup_design_ratings for update
  to authenticated
  using (public.is_es_designer_admin())
  with check (public.is_es_designer_admin() and rated_by = (select auth.uid()));

revoke all on table public.frameup_design_ratings from anon;
grant select, insert, update on table public.frameup_design_ratings to authenticated;

create index if not exists es_designer_tasks_exports_recent_idx
  on public.es_designer_tasks (workspace, created_at desc)
  where task_type = 'exported_design';

create or replace function public.list_frameup_generate_corpus(
  p_limit integer default 200,
  p_before timestamptz default null
)
returns table (
  id text,
  exported_at timestamptz,
  workspace_variant text,
  post_type text,
  sport text,
  team text,
  title text,
  lines jsonb,
  listicle jsonb,
  palette_idx integer,
  photo_url text,
  brief text,
  generated jsonb,
  status text,
  stars smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.created_at as exported_at,
    t.workspace_variant,
    coalesce(d.s ->> 'postType', '') as post_type,
    coalesce(nullif(d.s ->> 'sport', ''), t.sport) as sport,
    coalesce(nullif(d.s ->> 'team', ''), t.team_or_league) as team,
    left(t.title, 200) as title,
    case when jsonb_typeof(d.s -> 'lines') = 'array' then d.s -> 'lines' else '[]'::jsonb end as lines,
    case when jsonb_typeof(d.l) = 'object' then jsonb_build_object(
      'title', left(coalesce(d.l ->> 'title', ''), 80),
      'headers', jsonb_build_array(coalesce(d.l ->> 'entityHeader', ''), coalesce(d.l ->> 'metric1Header', ''), coalesce(d.l ->> 'metric2Header', '')),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entity', left(coalesce(x.r ->> 'entity', ''), 40),
          'metric1', left(coalesce(x.r ->> 'metric1', ''), 20),
          'metric2', left(coalesce(x.r ->> 'metric2', ''), 20),
          'subtitle', left(coalesce(x.r ->> 'subtitle', ''), 40)
        ) order by x.ord)
        from jsonb_array_elements(case when jsonb_typeof(d.l -> 'rows') = 'array' then d.l -> 'rows' else '[]'::jsonb end) with ordinality as x(r, ord)
        where coalesce(x.r ->> 'hidden', 'false') <> 'true' and x.ord <= 10
      ), '[]'::jsonb)
    ) end as listicle,
    case when (d.s ->> 'pillPaletteIdx') ~ '^[0-9]{1,2}$' then (d.s ->> 'pillPaletteIdx')::integer end as palette_idx,
    nullif(left(coalesce(d.s -> 'photo' -> '__img' ->> 'url', ''), 600), '') as photo_url,
    left(coalesce(t.metadata -> 'generated' ->> 'brief', ''), 600) as brief,
    jsonb_strip_nulls(jsonb_build_object(
      'postType', t.metadata -> 'generated' ->> 'postType',
      'specId', t.metadata -> 'generated' ->> 'specId',
      'runId', t.metadata -> 'generated' ->> 'runId',
      'angle', left(t.metadata -> 'generated' ->> 'angle', 120),
      'hook', t.metadata -> 'generated' ->> 'hook',
      'aiText', case when jsonb_typeof(t.metadata -> 'generated' -> 'aiText') = 'array' then t.metadata -> 'generated' -> 'aiText' end,
      'score', t.metadata -> 'generated' -> 'score'
    )) as generated,
    t.status,
    (select r.stars from public.frameup_design_ratings r where r.task_id = t.id) as stars
  from public.es_designer_tasks t
  cross join lateral (
    select
      t.metadata -> 'design' -> 'state' as s,
      case t.metadata -> 'design' -> 'state' ->> 'postType'
        when 'listicle-type-1' then t.metadata -> 'design' -> 'state' -> 'listicleData'
        when 'listicle-type-2' then t.metadata -> 'design' -> 'state' -> 'listicleType2Data'
      end as l
  ) d
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 300);
$$;

revoke all on function public.list_frameup_generate_corpus(integer, timestamptz) from public, anon;
grant execute on function public.list_frameup_generate_corpus(integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';
```

**Performance note:** reading any key of `metadata` detoasts the whole jsonb, including `previewDataUrl`. The existing `list_frameup_examples` already pays this cost (4×96 rows per load). Keep the corpus at **at most 2 pages of 150** with a 10-minute per-instance cache and a 6s timeout. A slim side table (C5) is the Phase 3 fix if it proves slow.

### C5. Optional Phase 3: slim copy

Add a trigger on `es_designer_tasks` (insert/update when `task_type='exported_design'`) that writes the small fields above into `public.frameup_design_texts`, plus a one-off backfill. `list_frameup_generate_corpus` then reads that table. Only do this if the RPC p95 is above 1.5s.

### C6. Relevance scoring per brief (server, deterministic, no embeddings)

For each corpus row `p` against brief read `R` (D1):

```
entity   = 4 if any of R.subjects' surnames / R.team nickname appear in p's text (lines/listicle/title/brief), else 0
team     = 2 if findTeam(p.team) === R.team (brand-kit names)
sport    = 1.5 if p.sport === R.sport
format   = 1.5 if p.post_type ∈ (allowedTypes or the director's concept types), 0.5 if same family
briefSim = min(3, 10 × jaccard(keyWords(R.brief), keyWords(p.brief || p.text)))
quality  = (p.stars ? (p.stars - 3) × 1.5 : 0)
         + (p.generated.aiText && unedited(p) ? 1.5 : 0) + (p.brief ? 0.8 : 0) + (p.status === 'Done' ? 0.5 : 0)
recency  = 1.5 × exp(-ageDays / 45)
score    = entity + team + sport + format + briefSim + quality + recency
```

Exclude rows with no usable text (no lines, no listicle, and a slug title), and rows with `stars <= 2`.
Select **top 6 with MMR**: at most 2 per post_type; skip a row whose text has token Jaccard ≥ 0.6 with an already-picked one; always include ≥1 row with `stars >= 4` when one exists for the sport.
Format for prompts with **digits masked** (`/\d[\d,.]*/g → "#"`) so facts are never copied (the lint would reject them anyway):
`- [Cover · NFL · Kansas City Chiefs · ★5] "Can Anyone | Stop Mahomes?" (brief: "mahomes after chiefs win")`

---

## D. The Creative Direction Brain

```
brief ─► D1 Read (code) ─┐
          research ──────┤
          D2 Retrieve ───┼─► D3 Direct (Sonnet, 1 call) ─► D4 Write per concept (Haiku, existing writer)
          lessons ───────┘        │ fail/timeout → legacy single-call path (today's behaviour)
                                   ▼
                     D5 Check + critique + fix (lint → repair → review w/ angle → escalate)
                                   ▼
                     designs (each with direction) ─► client ─► D6 learning events ─► rules + examples
```

New module `netlify/functions/_creative-director.js` (pure functions plus one AI call). `es-generate.js` orchestrates. All stages fail soft: **if the director fails, the output must be byte-identical in shape to today's.**

### D1. Brief understanding (code only, $0, under 5ms)

`readBrief(brief, found, allowedTypes) → BriefRead`

```json
{
  "subjects": ["Caitlin Clark"],
  "team": "Indiana Fever",
  "sport": "WNBA",
  "kind": "stats",
  "quote": null,
  "quotes": [],
  "stats": [{ "value": "30", "label": "PTS" }, { "value": "9", "label": "AST" }, { "value": "6", "label": "REB" }],
  "table": false,
  "trendHeadline": null,
  "instruction": false,
  "has": { "quote": false, "stats": true, "statsCount": 3, "list": false, "headline": false },
  "fits": { "cover": true, "quote": false, "long-quote": false, "double-entity-quote": false,
            "stats-single-ent": true, "stats-double-ent": false, "listicle-type-1": false, "listicle-type-2": false },
  "teamHint": null
}
```

Rules (reuse the existing helpers):

| Field | How it is set |
|---|---|
| `subjects` | `found.tags[].name`, then `nameCandidates(brief)`; max 3 |
| `team` | `findTeam('', x)` (from `_lint-spec.js`) over the team words in the brief; else the team from `brandHints` text of the newest tagged article mentioning the subject; else `''` |
| `sport` | `findSport` of the brief `Sport:` label; else the team's kit sport; else `sportFromUrl` majority |
| `kind` | `ranking` if `parseTableBrief` hit or /top \d+\|ranked/; `quote` if quoted text ≥2 words; `stats` if ≥3 number+label pairs; `headline` if a Trend `Headline:` line; `instruction` if the existing `isInstruction` regex; else `topic` |
| `stats` | pairs `(\d[\d,.]*%?)\s*(LABEL)` where LABEL matches `RULES.STAT_LABELS`, or the words points/rebounds/assists/yards/touchdowns/interceptions/home runs/RBIs/goals (mapped to PTS/REB/AST/YDS/TD/INT/HR/RBI/G). Searched in the brief first, then in `found.digest` if `instruction`. |
| `fits` | `cover` always. `quote`/`long-quote` need `has.quote` (brief quote, or a “…” segment ≥4 words in corpus near the subject's surname). `double-entity-quote` needs 2 quotes from 2 speakers. `stats-single-ent` needs `statsCount>=3`. `stats-double-ent` needs ≥2 subjects and ≥8 stats. Listicles need a table/ranking. All of this is then ANDed with `allowedTypes`. |
| `teamHint` | from D6 team memory (Phase 2) |

### D2. Retrieval (code + 1 Supabase RPC, $0, cached)

`_generate-examples.js` v2. Keep the old exports working; `test-generate-examples.mjs` must still pass.

- `loadCorpus(token)`:
  - Calls RPC `list_frameup_generate_corpus` (2 pages of 150, timeout 6s, cache 10 min per instance, team-wide).
  - On 404/PGRST202/error it falls back to the existing `fetchGallery` (`list_frameup_examples`) and maps each row to the same record shape, with `lines` derived from the title.
  - Returns `{ rows, source: 'rich'|'legacy'|'none' }`.
- `normalizeCorpus(rows)` → `PastPost[]`:

```json
{ "id": "DES…", "postType": "cover", "sport": "NFL", "team": "Kansas City Chiefs",
  "text": "Can Anyone | Stop Mahomes?", "lines": ["Can Anyone", "Stop Mahomes?"],
  "listicle": null, "paletteIdx": 0, "photoUrl": "", "brief": "mahomes after chiefs win",
  "generated": { "angle": "", "hook": "", "aiText": null, "score": null },
  "edited": null, "stars": null, "status": "Assigned", "at": "2026-11-12T…" }
```

  - `postType` comes from `post_type`, else `VARIANT_TYPES[workspace_variant]`.
  - `edited`: `null` when unknown; `false` when `generated.aiText` deep-equals `lines`; otherwise `true`.
  - Dedupe by `postType|text`.
- `scorePastPost(post, read, ctx)` and `pickPastPosts(posts, read, { allowedTypes, max: 6 })`, as in C6.
- `formatPastPosts(posts)`: one line each, digits masked, as in C6.
- `houseStyle(posts, read)` returns at most 5 lines of ≤120 chars, computed only from posts with `stars >= 4`, or `edited === false`, or the newest 120 when neither exists. A line is emitted only when backed by at least 8 samples:
  - "ES Covers here run {median pills} pills of about {median chars} characters."
  - "{pct}% of recent ES Covers are questions." (when pct ≥ 25)
  - "Player Stats headlines are {median words} words, e.g. reactions like the examples."
  - "For {team}, editors use palette {primary|inverted} {pct}% of the time." (only when `read.team` is set; at least 3 samples)
  - "Rankings titles average {n} characters over 2 lines."

### D3. Direction (one AI call)

- **Model tier:** env `GENERATE_DIRECTOR_TIER`, default `'best'` (Sonnet 5.5). If the Sonnet call fails for a non-budget reason and elapsed time is under 12s, retry once on `'main'` (Haiku). A budget error goes straight to the legacy path and sets `provider.fallback='budget'`, so the writer skips the Gateway. **Do not edit `_ai-gateway.js`**: reuse the existing tiers.
- **When it runs:** only if `provider.name === 'gateway' && !provider.fallback && want >= 2 && !body.pinned && body.directions !== false`, and research finished in under 9s (time budget, below).
- **Call:**
  - `aiText({ tier, system: DIRECTOR_SYSTEM, cacheSystem: true, messages:[{role:'user', content: request}], effort: 'low', maxTokens: 1400, timeoutMs: 12000, track: {feature:'generate-direction', email, token} })`.
  - Never `json: true` on Anthropic. Parse with `extractJson`.
- **Token budget:** static system ≈1.3k tokens (cached), request ≤2.6k (brief 400, read 200, research digest **≤2,500 chars**, past posts 6 lines, house style 5, lessons 6, steer). Output ≤700.
- **No caching of results** (users press Generate again to get new ideas). Corpus, lessons and research stay cached.

`DIRECTOR_SYSTEM` (static; build the catalog from `TEMPLATES` so it stays in sync):

```
You are the creative director of EssentiallySports (ES), a US sports media brand with a bold, editorial Instagram voice.
You do not write the final post. You decide the creative direction for Instagram designs that a writer then fills into fixed ES templates.
Per design you choose only: the template (postType), the angle (the one idea the post sells), the hook type, the emotion, a headline idea, the true facts it uses, the photo direction and the colour treatment. Layout, fonts and logo are fixed by the template.

Templates:
<one line per template: id (label): use. photo: yes|no>

Rules:
- Every concept is about the brief's own story. Use only facts that appear in the brief or the ES research, and copy them into factsUsed exactly as written there.
- Concepts must be clearly different: a different template or a different hook type, and a different angle. Never two concepts that say the same thing in other words.
- Covers are hooks: a bold claim or a curious question in 2-8 words, never a summary of facts.
- Quote and Long Quote only for words the main person said. Words said about them need the Two-Person Quote, or no quote.
- Player Stats needs 3 real game or season numbers with standard labels; Head-to-Head needs 4 per player. Never ages, years, money or rankings as stats.
- A ranking or table in the brief is ONE Rankings Table (number columns) or Ranked List concept with all rows, plus at most one Cover.
- Use only templates listed under "Allowed" and marked true under "Fits".
- team is the person's CURRENT team (newest coverage wins; a team named in the brief wins), full brand name. Empty if unsure. It sets the brand colours.
- <RULES.VOICE lines>
- Match the ES house style and the editors' lessons when given.

Enums: hook = question | claim | reaction | quote | numbers | ranking. emotion = hype | awe | tension | debate | celebration | heartbreak | respect | humor.
photo.shot = action | celebration | portrait | dejection | duo | any. palette = auto | primary | inverted.

Reply with JSON only:
{"read":{"subject":"","team":"","sport":"","moment":"one line: what happened"},
 "concepts":[{"postType":"","angle":"","hook":"","emotion":"","headlineIdea":"","layout":"","factsUsed":[""],
   "photo":{"query":"2-5 words: person + current team","shot":""},"team":"","palette":"auto","rationale":""}]}
```

Request (after the cache break), in this order:
1. `Brief: …`
2. `What the brief gives you (code-checked): <compact BriefRead: subjects, team, sport, kind, has, stats, quote>`
3. `Allowed: […]` `Fits: {…}`
4. `Steer from the editor: <claim|question|stats|emotion|debate>` (omitted when none). Steer → hard preference: "at least 2 concepts use this hook/approach when it fits".
5. `Past ES posts the team shipped (style and template choice only, never their facts):` 6 lines from D2.
6. `ES house style:` D2 lines.
7. `Editors' lessons:` D6 rules (Phase 2). `Team hints:` (Phase 2).
8. `ES research:` digest ≤2,500 chars.
9. `Return {want} concepts (fewer only if fewer genuinely fit).`

`validateConcepts(parsed, { read, allowedTypes, want, brief, corpus })` returns `Concept[]` (code, never trust the model):

- Take `parsed.concepts` (an array), `slice(0, want)`.
- `postType` must be in `TEMPLATES`, allowed (or `allowedTypes` empty) and `read.fits[postType] === true`. Otherwise drop the concept.
- `angle` = `clean`, 6–90 chars, else drop. `hook`/`emotion`/`shot`/`palette` not in the enums → `'claim'`/`''`/`'any'`/`'auto'`.
- `headlineIdea` ≤60, `layout` ≤140, `rationale` ≤160 chars (clean, truncate).
- `photo.query`: `within(…, 2, 80)`, and only when `TEMPLATES[postType].photo`; otherwise `''`.
- `team` → `findTeam(findSport(read.sport), team) || findTeam('', team) || read.team || ''`.
- `factsUsed`: keep the items whose `squash(item)` is in `squash(brief + ' ' + corpus)`, max 6. A stats concept needs ≥3 kept items containing digits, else drop it.
- **Distinctness:**
  - Drop a concept whose `postType|hook` equals an earlier one's.
  - Drop a concept whose angle token Jaccard is ≥0.6 with an earlier angle.
  - When only `cover` fits, up to 3 covers are allowed (their hooks then differ by construction).
- Reassign `id = 'c1'…'cN'` in order.
- Return `[]` if nothing survives. **`[]` means the legacy path.**

`Concept` schema (output of D3, input of D4):

```json
{ "id": "c1", "postType": "stats-single-ent", "angle": "Clark is simply unguardable right now",
  "hook": "reaction", "emotion": "awe", "headlineIdea": "No One Can Stop Her",
  "layout": "PTS / AST / REB, 2-3 word headline", "factsUsed": ["30 PTS", "9 AST", "6 REB"],
  "photo": { "query": "Caitlin Clark Fever", "shot": "celebration" }, "team": "Indiana Fever",
  "palette": "auto", "rationale": "Three real numbers carry the awe." }
```

**Time budget** (constants in `es-generate.js`):
- `DIRECTOR_START_BY_MS = 9000`: skip the director if research plus corpus took longer than this.
- `ESCALATE_START_BY_MS = 20000`: skip escalation after this.
- Netlify synchronous functions default to 10s and can be raised to 26s; `vercel.json` gives 60s. Confirm the host limit (section I).

### D4. Spec generation per concept (the existing writer)

- `buildPrompt(brief, found, allowedTypes, count, pastExamples, avoid, direction = null)`:
  - Add the new optional last argument `direction = { concepts, houseStyle }`.
  - **The static part before `PROMPT_CACHE_BREAK` must stay byte-identical**, to keep the Haiku cache.
  - When `direction?.concepts?.length`, insert after the past examples:

```
Creative direction from the ES creative director. Write exactly one design per concept, in this order, using its postType.
Keep its angle and hook type; sharpen the headline idea if you can, within the limits. Use its team and photo query.
Put the concept id in "conceptId". Put the angle in "why".
- c1 [stats-single-ent · reaction · awe] angle: "…" headline idea: "…" facts: 30 PTS, 9 AST, 6 REB | photo: Caitlin Clark Fever | team: Indiana Fever
- c2 …
<if concepts.length < count:> Then add up to {count - n} more designs with clearly different angles.
ES house style: <lines>
```

  - The reply schema line adds `"conceptId": "c1"`.
- `pastExamples` now comes from `formatPastPosts(pickPastPosts(...))`. It also feeds the legacy path, so the legacy path improves too.
- `checkSpec` carries `conceptId` (accepted only when it matches `/^c[1-4]$/`). After `keepValid`, `es-generate.js` attaches the following to each spec, matched by `conceptId`, falling back to array index for designs without one:
  - `spec.direction = { conceptId, angle, hook, emotion, shot, palette }`.
  - If `spec.team` is empty and `concept.team` is set, it uses `concept.team` (still passes `applyPatch` / lint team checks).
- Order of designs = concept order. The existing table-first rule still wins for rankings.

### D5. Critique and auto-fix (reuse, small extensions)

1. `keepValid` → `lintSpec` unchanged, plus a **new lint error** in `_lint-spec.js`:
   - For `stats-single-ent` / `stats-double-ent`, every stat label must match `RULES.STAT_LABELS`.
   - Else: `{code:'bad-stat-label', msg:'"AGE" is not a game or season stat label', fix:'use real stat labels (PTS, YDS, HR…) or another template'}`.
   - Add a case to `scripts/test-lint-spec.mjs`.
2. The repair round is unchanged. `repairPrompt` adds `Angle to keep: "<angle>"` per broken design that has a concept.
3. `reviewDesigns`:
   - Each card line gets `  intended angle: "<angle>" (<hook>)` when present.
   - Add a fifth criterion: `angle (does it land the intended angle, distinct from the other cards)`. Score = average of 5.
   - The JSON reply shape is unchanged. Keep tier `review` (a different family from the writer and director).
4. `escalateDesigns`: per design, add `Intended angle: "<angle>"`. Unchanged otherwise. Skipped past `ESCALATE_START_BY_MS`.
5. Deterministic diversity guard, after review:
   - Two cards with the same `postType` **and** the same `direction.hook` both get a `same-angle` warning.
   - Only cards whose review is under 3.5 are eligible for escalation with the note "too close to card N; take a different angle".
6. **Photo direction (Phase 2):**
   - `pickPhoto(person, candidates, track, shot)` adds "Prefer a {shot} photo (e.g. celebrating / dejected / action / portrait)" when the main concept's `shot !== 'any'`.
   - The main concept is the first concept whose photo query contains the main person.
7. **Palette (Phase 2):** `concept.palette` maps to `spec.paletteIdx`: `primary` → 0, `inverted` → 2, `auto` → the house-style team preference or none. It applies to `cover`, `quote`, `long-quote` and `stats-single-ent` only, through frameup-spec.js (H, Phase 2).

### D6. Learning loop (Phase 2 events, Phase 3 export linkage and stars)

The pattern mirrors `_ad-learning.js` + `20261117120000_video_ad_learning.sql`. **Create new files. Do not edit the Video Ads ones** (they are staged in the release).

**Signals stored:**

| Event `type` | Written by | Payload (no emails/ids beyond runId/specId) |
|---|---|---|
| `generated` | server, end of `generate()` | `{runId, brief(≤600), steer, directorModel, concepts:[{id,angle,hook,postType}], designs:[{specId, postType, conceptId, hook, text(≤200), score, escalated}], lintCodes:{code:count}, dropped:[codes], costUsd}` |
| `alt_switched` | client | `{runId, specId, postType, hook, fromText, toText}` |
| `rewrite_applied` | client | `{runId, specId, postType, instruction, beforeText, afterText}` |
| `team_changed` | client | `{runId, specId, person, sport, fromTeam, toTeam}` |
| `photo_changed` | client | `{runId, specId, postType, shot, toIndex, ai:boolean}` |
| `opened_in_editor` | client | `{runId, specId, postType, hook, conceptId, text}` |
| `downloaded` | client | same as opened |
| `more_like_this` | client | `{runId, specId, postType, hook}` |
| `steer_used` | client | `{runId, steer}` |
| `retry` | client | `{runId, specId, postType, hook}` |

`text` = `designText(postType, option)` from the server (exported in `_test`), or the client's `versionText`.

**Derived lessons** (`_generate-learning.js → lessonsFor({ sport, token }) → { rules: string[≤6], teamHints: [{person, team, sport}≤8], hookStats }`). These are deterministic, with no model and a 10-minute cache. Window: the last 300 events via RPC `frameup_generate_lessons`; fall back to the caller's own rows.

1. **Lint failures:** count each code once per `generated` event. A code that appears in at least 3 runs and at least 25% of runs produces a rule:
   - `too-long` → "Lines often run long: Cover pills ≤ 14 characters, Quote lines ≤ 12."
   - `unsourced-number` → "Use only numbers from the brief or research: invented numbers get rejected."
   - `unsourced-quote` → "Quotes must be word for word from the brief or research."
   - `bad-stat-label` → "Stats need real stat labels (PTS, YDS, HR…), never ages or money."
   - `banned` with a word → `Never use "<word>".` (reuse `classifyIssue` logic: copy it, don't import from `_ad-learning.js`).
2. **Rewrites:** each instruction with at least 3 events and at least 40% of rewrites in the window produces a rule:
   - `shorter` → "Editors keep asking for shorter copy: Cover pills about {median chars of afterText lines} characters."
   - `punchier` → "Editors keep asking for punchier hooks: lead with a strong verb or a bold claim, 2-6 words."
   - `angle` → "Editors often want a different angle: make the concepts more distinct."
3. **Alt switches:** when at least 4 switches exist and 60% of them go to a shorter `toText` → "Editors prefer the shorter wording: lead with it."
4. **Hook win rates:**
   - shown = hooks in `generated.designs`; picked = `downloaded` + `opened_in_editor` by hook.
   - A hook with at least 6 shown and pick-rate ≥ 1.5× the average → "ES editors pick <hook> hooks most{ for <sport>}."
   - The full table is also passed to the director as `hookStats`.
5. **Team memory:**
   - `team_changed` events where `toTeam` is not empty, grouped by normalized `person`.
   - When at least 2 events agree and none disagree in the last 60 days, the result is `teamHints`. It goes into the director ("Team hints: editors set Caitlin Clark → Indiana Fever") and into `readBrief.teamHint`, which wins over the research guess.
6. **Export edits (Phase 3, from the corpus once `generated.aiText` exists):**
   - Treat `edited` rows like `_ad-learning` `copy_edited`.
   - Consistent shortening → "Editors shorten …".
   - Words removed in at least 2 edits and 40% of edits → `Avoid "<term>": editors keep removing it.`

**Examples** = D2's top past posts. The scorer's quality term makes starred and unedited posts float up automatically, with no extra code.

**SQL (Phase 2 migration): `supabase/migrations/20261119120000_frameup_generate_events.sql`**

```sql
-- FrameUp Generate learning loop: an append-only log of what happens to
-- Generate's designs (netlify/functions/_generate-learning.js). The creative
-- director reads team-wide lessons through frameup_generate_lessons()
-- (security definer, no user ids or emails). Rules are derived
-- deterministically on the server; no model reads this table.
-- Rows are written with the signed-in user's own session. People read their
-- own events; dashboard admins read all. No updates or deletes.
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.frameup_generate_lessons(text, int);
--   drop table if exists public.frameup_generate_events;

create table if not exists public.frameup_generate_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  run_id text check (run_id is null or char_length(run_id) <= 64),
  post_type text check (post_type is null or post_type in ('cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2')),
  sport text check (sport is null or char_length(sport) <= 20),
  type text not null check (type in ('generated', 'alt_switched', 'rewrite_applied', 'team_changed', 'photo_changed', 'opened_in_editor', 'downloaded', 'more_like_this', 'steer_used', 'retry')),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 20000)
);

create index if not exists frameup_generate_events_created_idx
  on public.frameup_generate_events (created_at desc);
create index if not exists frameup_generate_events_sport_created_idx
  on public.frameup_generate_events (sport, created_at desc);
create index if not exists frameup_generate_events_user_created_idx
  on public.frameup_generate_events (user_id, created_at desc);

alter table public.frameup_generate_events enable row level security;

drop policy if exists "frameup generate events: users save own" on public.frameup_generate_events;
create policy "frameup generate events: users save own"
  on public.frameup_generate_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup generate events: users read own" on public.frameup_generate_events;
create policy "frameup generate events: users read own"
  on public.frameup_generate_events for select
  to authenticated
  using (public.is_es_designer_domain_user() and user_id = (select auth.uid()));

drop policy if exists "frameup generate events: admins read" on public.frameup_generate_events;
create policy "frameup generate events: admins read"
  on public.frameup_generate_events for select
  to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_generate_events from anon;
grant select, insert on table public.frameup_generate_events to authenticated;

create or replace function public.frameup_generate_lessons(
  p_sport text default null,
  p_limit int default 300
)
returns table (created_at timestamptz, type text, post_type text, sport text, payload jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select e.created_at, e.type, e.post_type, e.sport, e.payload
  from public.frameup_generate_events e
  where public.is_es_designer_domain_user()
    and (p_sport is null or e.sport = p_sport)
    and e.type in ('generated', 'alt_switched', 'rewrite_applied', 'team_changed', 'opened_in_editor', 'downloaded', 'more_like_this')
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 300), 0), 500);
$$;

revoke all on function public.frameup_generate_lessons(text, int) from public, anon;
grant execute on function public.frameup_generate_lessons(text, int) to authenticated;
notify pgrst, 'reload schema';
```

---

## E. UX surface in `generate.html` (minimal; no explainer text)

1. **Angle line (Phase 1).**
   - In `fillCard`: `.gen-card__why` shows `Angle: <angle>` when `spec.direction?.angle` exists, else `spec.why || spec.title` (today's behaviour).
   - "Angle:" goes in a `<strong>`. Set it with `textContent`/DOM nodes, never `innerHTML`.
   - CSS: clamp `.gen-card__why` to 2 lines (`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden`).
2. **Direction chips (Phase 2).**
   - One row inside `#gen-form` after `.gen-format`, built like the format radiogroup (roving tabindex, arrows/Home/End):
     `<div class="gen-steer"><span class="gen-row__label" id="gen-steer-label">Angle</span><div id="gen-steer" role="radiogroup" aria-labelledby="gen-steer-label">` with chips **Auto** (default) · **Bold claim** · **Question** · **Stats-led** · **Emotion** · **Debate** (`.es-chip`, `aria-checked`).
   - Values: `''|claim|question|stats|emotion|debate`. Sent as `steer` (omitted for Auto). No caption or helper text.
   - Remember the choice in `sessionStorage` (wrapped in try/catch).
3. **"More like this" (Phase 2).**
   - A new icon button in `.gen-card__actions`, placed before "again": Lucide `copy-plus`, `aria-label="More like this"`, `title="More like this"`.
   - On click: insert 2 `skeletonCard()`s right after the card, then POST `{mode:'more', brief:lastBrief, like:{postType, fields, lines, listicle, direction, sport, team}, runId}`.
   - Replace the skeletons with the returned cards (`buildCard` + `paint`). On none or error, remove them and show a notice with "Try again".
   - Disable the button while in flight.
   - Visual QA at 375/768/1024/1440 (6 controls in the action row must not overflow; if they do at 375, let `.gen-card__actions` wrap).
4. **Learning events (Phase 2).**
   - A helper `track(type, payload)` that calls `window.ESAuth?.fetchWithAuth?.('/api/generate-learning', {method:'POST', keepalive:true, headers:{'Content-Type':'application/json'}, body: JSON.stringify({event:{type, runId: lastRunId, postType, sport, payload}})}).catch(()=>{})`.
   - Fire-and-forget, wrapped in try/catch.
   - Call sites: `alt`, `rewrite` (success), team `change`, `pick`/`scene` (photo_changed), `edit`, `download` (success), `more`, `again`, and once per Generate when a steer is set.
5. Nothing else changes: no new panels, no new copy.

---

## F. API contract (`/api/es-generate`, backward compatible)

**Request** (all new fields optional):

```json
{ "brief": "…", "formats": [], "count": 4, "avoid": [],
  "steer": "question",
  "directions": true,
  "mode": "more",
  "like": { "postType": "cover", "fields": {}, "lines": [], "listicle": null,
            "direction": { "angle": "…", "hook": "question", "emotion": "debate", "shot": "portrait" },
            "sport": "NFL", "team": "Kansas City Chiefs" },
  "runId": "run-…" }
```

- `steer` must be one of `claim|question|stats|emotion|debate`. Anything else is ignored.
- `directions: false` forces the legacy path (for evals and A/B).
- `mode: 'more'` is handled by `generate({ ..., formats:[like.postType], count:2, avoid: like text, pinned: like })`:
  - The director is skipped. The writer gets one pinned concept built from `like.direction`, or from `{postType, angle: designText(like)}`, plus the instruction "2 designs, same concept and template, each a clearly different wording".
  - Review runs. Escalation does not.
  - `like` is validated with `checkSpec` (bad input → 400 `Missing design.`).

**Response** (existing fields unchanged; additions marked +):

```json
{ "brain": "gateway:anthropic/claude-haiku-5.5",
  "+runId": "run-m3x9k-4f2a",
  "+direction": { "source": "director|haiku-fallback|none|pinned", "model": "anthropic/claude-sonnet-5.5",
                  "read": { "subject": "", "team": "", "sport": "", "moment": "" },
                  "concepts": [ { "id": "c1", "postType": "", "angle": "", "hook": "", "emotion": "" } ] },
  "designs": [ { "…existing spec fields…": "",
                 "+direction": { "conceptId": "c1", "angle": "", "hook": "", "emotion": "", "shot": "", "palette": "auto" },
                 "+paletteIdx": 0 } ],
  "learning": { "pastDesigns": 0, "examplesUsed": 0, "+corpus": "rich|legacy|none", "+rules": 0 },
  "meta": { "ms": { "research": 0, "+direction": 0, "ai": 0, "total": 0 }, "costUsd": 0 } }
```

- `+paletteIdx` is Phase 2, and only present when not `auto`.
- `meta.costUsd` adds the director cost.
- **New endpoint (Phase 2):** `POST /api/generate-learning` with body `{ event: { type, runId?, postType?, sport?, payload } }`, returning `{ ok }`. It uses `verifyEsUser`, an hourly cap and a 20 KB body cap, the same as `ad-learning.js`.

---

## G. Cost model (per Generate run, 4 designs)

| Step | Before | After (default: Sonnet director) | After (economy: `GENERATE_DIRECTOR_TIER=main`) |
|---|---|---|---|
| Corpus/lessons (Supabase, cached) | $0 | $0 | $0 |
| Director | — | ≈$0.012 (2.6k in @2 + 1.3k cached @0.2 + 0.7k out @10) | ≈$0.0006 |
| Writer (Haiku) | ≈$0.0012 | ≈$0.0014 (+concepts ≈0.4k tokens) | ≈$0.0014 |
| Photo pick | ≈$0.0006 | ≈$0.0006 | ≈$0.0006 |
| Review (luna) | ≈$0.00013 | ≈$0.00016 | ≈$0.00016 |
| Repair (≈30% of runs) | ≈$0.00015 avg | ≈$0.0001 avg (fewer misses) | same |
| Escalation (Sonnet) | ≈$0.0066 × p≈0.4 = $0.0026 | ≈$0.0066 × p≈0.2 = $0.0013 | same |
| **Expected per run** | **≈$0.005** | **≈$0.016 (1.6¢)** | **≈$0.004** |
| Worst case | ≈$0.010 | ≈$0.024 | ≈$0.011 |

- "More like this" costs ≈$0.002. A rewrite is unchanged.
- At a 1.6¢ average, the $20/week/user cap allows about 1,200 runs per person per week. Affordable.
- If the eval (H, Phase 1 acceptance) shows Haiku directing nearly as well, flip the env var to economy.

---

## H. Phased build plan (builder follows in order)

Conventions:
- Plain JS (CommonJS in `netlify/functions`), matching the existing style and comments.
- Tests are Node `.mjs` with mocked `globalThis.fetch`, the same pattern as `scripts/test-es-generate-quality.mjs`. Unexpected fetches throw, so every new network call must be caught.
- No new npm deps.
- Run `npm run test:generate` plus the new tests. The 7 known baseline failures stay unchanged.
- Add an entry to `project-docs/ai-edit-log.md`. Never commit or push.

### Phase 1: the brain (biggest quality jump on its own)

1. **Migration** `supabase/migrations/20261118120000_frameup_generate_corpus.sql`: exactly the SQL in C4. Suhail applies it. The code must work before and after it.
2. **`netlify/functions/_generate-examples.js`** (modify):
   - Add `loadCorpus`, `normalizeCorpus`, `scorePastPost`, `pickPastPosts`, `formatPastPosts` and `houseStyle` (D2/C6).
   - Keep `loadPastDesigns`, `selectExamples`, `formatExamples` and `_test.normalize` exported and working.
   - Export the new functions on `module.exports` and `_test`.
3. **`netlify/functions/_creative-director.js`** (new). Exports:
   - `readBrief`
   - `DIRECTOR_SYSTEM(templates)`
   - `directorRequest({brief, read, allowedTypes, steer, pastPosts, houseStyle, lessons, teamHints, digest, want})`
   - `runDirector({…, tier, track})` → `{ concepts, read, model, cost, source }`. It never throws; it returns `{concepts:[]}` on any failure and reports a budget error as `source:'budget'`.
   - `validateConcepts`
   - `conceptsBlock(concepts, count, houseStyleLines)`
   - Constants: the enums.
   - Requires `../../frameup-rules.js` and `./_lint-spec.js` (`findTeam`, `findSport`), and `./_ai-gateway.js` (`aiText`, `isBudgetError`).
   - `TEMPLATES` is passed in from `es-generate.js` (no circular require).
4. **`netlify/functions/es-generate.js`** (modify):
   - Load the corpus in the same `Promise.all` as research (replacing `loadPastDesigns`; legacy fallback inside `loadCorpus`).
   - `read = readBrief(...)`. `pastPosts = pickPastPosts(...)`. `pastExamples = formatPastPosts(pastPosts)`.
   - The director runs under the D3 conditions and time budget. On `source === 'budget'`, set `provider.fallback = 'budget'` before the writer runs.
   - `buildPrompt(..., direction)` (D4). `checkSpec` passes `conceptId`. Attach `spec.direction` after `keepValid`, plus the team fill.
   - Pass the angle to `repairPrompt`, `reviewDesigns` and `escalateDesigns` (D5). Add the diversity guard. Add the escalation time guard.
   - Skip the director when `want < 2` (Try again stays one cheap call).
   - Response: add `runId`, `direction`, `learning.corpus` and `meta.ms.direction`. Include the director cost in `meta.costUsd`.
   - Accept `body.steer` (enum) and `body.directions`.
   - Export `readBrief`/`validateConcepts` via `_test` only if needed by tests.
5. **`netlify/functions/_lint-spec.js`** (modify): the `bad-stat-label` error (D5.1).
6. **`generate.html`** (modify, Generate script and CSS only): the Angle line (E1).
7. **Tests:**
   - `scripts/test-creative-director.mjs` (new):
     - `readBrief` covers a quote brief, a stats brief, a pasted table, a Trend `Headline:` brief, an instruction brief, a team-in-brief override and the fits gating.
     - `validateConcepts` drops a disallowed type, a not-fitting stats concept, a duplicate `postType|hook`, a near-duplicate angle and invented `factsUsed`; caps at `want`; reassigns ids; maps bad enums to defaults; resolves the team to the brand-kit name.
     - `runDirector` returns `{concepts:[]}` when fetch throws, on unparsable JSON, and on a 402 (`source:'budget'`).
   - `scripts/test-generate-corpus.mjs` (new):
     - `normalizeCorpus` reads `lines` and `listicle` and computes `edited`.
     - Scoring: entity > team > sport; stars raise, ≤2 stars excluded; recency decays.
     - MMR: ≤2 per type and no near-duplicates.
     - `formatPastPosts` masks digits.
     - `houseStyle` only emits with ≥8 samples.
     - `loadCorpus` falls back to `list_frameup_examples` on 404, and returns `none` on throw.
   - `scripts/test-es-generate-direction.mjs` (new, full handler with mocked fetch):
     - Mocks: the corpus RPC returns 3 rows; Sonnet (`/v1/messages`, `model === 'anthropic/claude-sonnet-5.5'` and the system contains "creative director") returns 3 concepts; the Haiku writer asserts its prompt contains "Creative direction from the ES creative director", `c1` and a masked past post, and replies with `conceptId`s; luna review asserts "intended angle".
     - Expect: 3 designs in concept order, each with `direction.angle`; `res.body.direction.source === 'director'`; `meta.costUsd < 0.03`; usage features include `generate-direction`.
     - The director returns garbage → designs still returned, `direction.source === 'none'`, and the writer prompt has no direction block.
     - The director gets 402 → the writer goes to Groq, and the count of `/v1/messages` calls = director + photo pick.
     - `directions:false` → no director call.
     - `count:1` → no director call.
     - `steer:'question'` appears in the director request.
   - Update `scripts/test-es-generate-fast.mjs` §4:
     - Allow `'generate-direction'` in the usage features (filter it like `generate-escalate`).
     - Relax the cost bound to `< 0.03`.
     - §6 must still see exactly 2 `/v1/messages` calls (director + photo pick) because of the budget handoff above.
   - Add a `bad-stat-label` case to `scripts/test-lint-spec.mjs`.
   - `package.json` `test:generate`: append `&& node scripts/test-creative-director.mjs && node scripts/test-generate-corpus.mjs && node scripts/test-es-generate-direction.mjs && node scripts/test-es-generate-quality.mjs && node scripts/test-lint-spec.mjs`.
8. **Acceptance (Phase 1):**
   - All generate tests pass. The 7 known baseline failures are unchanged.
   - With `directions:false`, the response matches today's shape and behaviour. The existing tests prove this.
   - Mocked typical run under $0.03. Director skipped when research takes over 9s (unit-test the guard with a fake clock or an injected `now`).
   - Live, manual (Suhail's preview): `npm run eval:generate` passes at least as many cases as before. Then 10 real briefs, run side by side with `directions:false`. Suhail picks the better set blind; the target is that the brain wins at least 7 of 10.
   - Generate view visual QA (per CLAUDE.md) for the Angle line in light and dark at 375 and 1440.

### Phase 2: steering, More like this, learning events

1. Migration `supabase/migrations/20261119120000_frameup_generate_events.sql` (D6 SQL).
2. `netlify/functions/_generate-learning.js` (new): `EVENT_TYPES`, `normalizeEvent` (post_type/sport validation, payload ≤16 KB, drop any key matching `/email|user_?id/i`), `recordEvent({token,email,event})` (never throws; table-missing back-off like `_ad-learning.js`), `deriveRules(rows)`, `deriveTeamHints(rows)`, `hookStats(rows)`, `lessonsFor({sport, token})` (RPC, then own-rows fallback; 10-minute cache; never throws).
3. `netlify/functions/generate-learning.js` (new) plus `api/generate-learning.js` (copy the Vercel adapter pattern of `api/es-generate.js`). Add `"api/generate-learning.js": { "maxDuration": 15 }` to `vercel.json` only after the release is pushed (the file is staged).
4. `es-generate.js`:
   - `lessonsFor` runs in the research `Promise.all`. Its rules and team hints go to the director; `readBrief` uses `teamHint`.
   - Record a `generated` event at the end (awaited, 2s timeout, never throws).
   - `mode:'more'` (F). `pickPhoto` gets the `shot` hint. Emit `spec.paletteIdx` from `concept.palette` / house style.
5. `frameup-spec.js`:
   - In `applyBrand`, after the team is applied, when `Number.isInteger(spec.paletteIdx)` and `PHOTO_TYPES.includes(spec.postType)`:
     ```js
     const entry = getBrandEntry(state.sport, state.team);
     const palette = entry && getPaletteForWorkspace(entry);
     if (palette?.[spec.paletteIdx]) {
       state.pillPaletteIdx = spec.paletteIdx;
       state.pillPalette = palette[spec.paletteIdx];
       renderPaletteRow(entry);
     }
     ```
   - This needs the `frameup-spec.js?v=` bump in `index.html`. Edit only that one version string, and log it, because `index.html` holds Suhail's WIP.
6. `generate.html`: steer chips (E2), More like this (E3), `track()` events (E4). Store `lastRunId` from `data.runId`.
7. Tests:
   - `scripts/test-generate-learning.mjs` (new):
     - `normalizeEvent` accept/reject; email keys stripped.
     - `deriveRules`:
       - lint code in 3 of 10 runs → rule;
       - `shorter` in 40% of rewrites → rule with the median;
       - hook win-rate rule;
       - ≤6 rules, each ≤120 chars.
     - `deriveTeamHints`: 2 agree → hint; a conflict → no hint.
     - `lessonsFor` falls back to own rows when the RPC fails, and returns empties when the table is missing.
   - Extend `test-es-generate-direction.mjs`:
     - `mode:'more'` returns 2 designs of the same postType, with no director call;
     - lessons rules appear in the director request;
     - the `generated` event is posted;
     - `paletteIdx` = 2 for an `inverted` concept.
8. Acceptance:
   - Events land in Supabase from a real session (check as admin).
   - Rules appear in the director request after seeded events.
   - Chips change the concepts: "Question" gives at least 2 question hooks on 5 test briefs.
   - More like this returns 2 cards in under 12s.
   - Visual QA of the chips and the action row at 4 widths, light and dark.

### Phase 3: stars, export linkage, edits

1. **Export linkage:**
   - `frameup-spec.js`: `applySpec` stores `lastApplied = {brief, postType, at, specId: spec.id, runId: spec.runId, angle: spec.direction?.angle, hook: spec.direction?.hook, aiText: spec.lines.slice(0, 6) or [listicle title], score: spec.review?.score}`, and `generatedFor()` returns these fields.
   - The server must put `runId` on every spec.
   - `dashboard-data.js` `generatedFrom()` passes them through. Keep `metadata.generated` under 2 KB.
   - The corpus RPC already whitelists these keys.
   - This needs the `index.html` version bumps for `frameup-spec.js` and `dashboard-data.js`.
2. **Admin stars** in `dashboard.html` Review Exports rows:
   - Admin-only: a 5-star radiogroup (`role="radiogroup"`, 24px targets, keyboard).
   - `dashboard-data.js` adds `rateExport(taskId, stars)`, an upsert into `frameup_design_ratings` with `updated_at: new Date().toISOString()` and `rated_by` = the session user id.
   - `fetchExportRatings(ids)` uses `select task_id,stars` with `in` filtered ids.
3. Edit-diff rules in `_generate-learning.js` from corpus rows where `edited === true` (D6 item 6).
4. Optional: the C5 slim table if the corpus RPC is slow. Embeddings (pgvector) only if lexical retrieval misses obvious matches in the eval.
5. Acceptance:
   - A starred post shows up in the director's past posts for a matching brief (mocked test plus one live check).
   - An unedited Generate export is detected as `edited:false`.
   - Rules from edits appear after 2 or more consistent edits.

---

## I. Risks and open questions for Suhail

1. **Function time limit.** Is production Netlify (10s default, 26s max) or Vercel (60s in `vercel.json`)? The director adds about 3–5s. The time guards keep runs safe either way, but on Netlify at 26s escalation will be skipped more often.
2. **Director model.** Sonnet (≈1.6¢/run) or Haiku (≈0.4¢)? The plan defaults to Sonnet, settled by the Phase 1 blind test.
3. **Migrations.** Two new migrations: corpus + ratings in Phase 1, events in Phase 2. You apply them; until then the code falls back silently.
4. **Data volume.** `metadata.design` only exists on exports since about 11 Nov, so older posts give titles only. Retrieval quality grows as the team exports and stars posts.
5. **Corpus read cost.** Each corpus read detoasts `previewDataUrl`, the same as `list_frameup_examples` today. It is fine at 300 rows with a cache; the slim table is the fix if it gets slow.
6. **Staged release overlap.** Phase 1 edits staged files (`es-generate.js`, `generate.html`). Best to build after the release is pushed.
7. **Who may star?** The plan says dashboard admins only. Should senior designers star too?
