-- FrameUp Merch Designs: the shared Brainstorm boards.
--
-- One row per board: a trend (key = the trend id) or a person's own line
-- (key = 'line:' + a hash of the text). Everyone at ES sees the same board:
-- the lines (AI, code or a person's own words, with who added them and who
-- starred them), the chat turns (last 40) and the gathered context (trend
-- headlines, ES articles, the web fact check; re-gathered after 6 hours).
--
-- The merch server (netlify/functions/merch.js via
-- _merch-brainstorm-store.js) writes with the service role; signed-in ES
-- users may read. Nobody writes from the browser. Concurrent writes are
-- guarded in the server by updated_at (read, change, write if unchanged).
--
-- The app works before this runs: the server keeps boards in memory (one
-- instance only, not shared) and says so (session.storage = 'memory').
--
-- Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_merch_brainstorm;

create table if not exists public.frameup_merch_brainstorm (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (char_length(key) between 3 and 120),
  trend_id text check (char_length(trend_id) <= 80),
  title text not null default '' check (char_length(title) <= 300),
  sport text not null default '' check (char_length(sport) <= 20),
  team jsonb check (team is null or pg_column_size(team) <= 1024),
  -- { title, sport, team, colours, palette, headlines, esArticles, facts, factUrls,
  --   nicknames, corpus, gatheredAt, sources, notes, cost }
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 65536),
  -- [{ id, text, angle, why, by, at, starred: [emails], source, rights, designMode?, edited? }] (max 150)
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 131072),
  -- [{ id, by, at, prompt | action, note, lineIds, designMode, ai, fellBack?, cost }] (last 40)
  turns jsonb not null default '[]'::jsonb check (jsonb_typeof(turns) = 'array' and pg_column_size(turns) <= 65536),
  created_by text not null default '' check (char_length(created_by) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists frameup_merch_brainstorm_updated_idx on public.frameup_merch_brainstorm (updated_at desc);

-- ─── RLS: ES users read; the server writes with the service role ──────────
alter table public.frameup_merch_brainstorm enable row level security;

drop policy if exists "frameup merch brainstorm: es users read" on public.frameup_merch_brainstorm;
create policy "frameup merch brainstorm: es users read"
  on public.frameup_merch_brainstorm for select to authenticated
  using (public.is_es_designer_domain_user());

revoke all on table public.frameup_merch_brainstorm from anon, authenticated;
grant select on table public.frameup_merch_brainstorm to authenticated;
