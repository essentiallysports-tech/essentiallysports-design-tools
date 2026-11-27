-- Reels v4: the confirmed-clip library. One row per (subject key, clip url):
-- a clip the vision judge confirmed for a player, person, team or game
-- (relevance >= 7, and the moment when the scene named one), with the best
-- segment inside it and a rank people move by keeping (+1) or swapping (-1)
-- the clip in Reels Studio.
--
-- Read first by reel-maker scene-media (free, no judge call); written only by
-- the server (service role) from reel-maker clip-judge / clip-rank
-- (netlify/functions/_reel-clip-confirmed.js). Unlike frameup_clip_library
-- (one row per url, purged after 7 days), confirmed clips are kept 365 days:
-- an older moment stays findable.
--
-- key: '<type>:<normalised name>' e.g. 'player:george kittle',
--      'team:san francisco 49ers', 'game:san francisco 49ers|2026-11-23'.
-- kind: 'clip' (game footage) or 'presser' (press conference / interview).
--
-- The code works before this migration is applied: it keeps confirmed clips
-- in memory per server instance and retries the table every 10 minutes.
-- RLS: ES users read; there is no insert / update / delete policy (the
-- service role bypasses RLS). Idempotent: safe to run twice.
--
-- Undo:
--   drop table if exists public.frameup_reel_clip_confirmed;

create table if not exists public.frameup_reel_clip_confirmed (
  key text not null check (char_length(key) between 3 and 120),
  url text not null check (url ~ '^https://' and char_length(url) <= 400),
  kind text not null default 'clip' check (kind in ('clip', 'presser')),
  sport text not null default '' check (char_length(sport) <= 8),
  clip jsonb not null,
  relevance smallint not null check (relevance between 0 and 10),
  moment smallint check (moment between 0 and 10),
  segment jsonb,
  rank smallint not null default 0 check (rank between -20 and 50),
  kept integer not null default 0,
  swapped integer not null default 0,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (key, url)
);

create index if not exists frameup_reel_clip_confirmed_key_idx
  on public.frameup_reel_clip_confirmed (key, rank desc, confirmed_at desc);
create index if not exists frameup_reel_clip_confirmed_url_idx
  on public.frameup_reel_clip_confirmed (url);

alter table public.frameup_reel_clip_confirmed enable row level security;

drop policy if exists "frameup reel clip confirmed: es users read" on public.frameup_reel_clip_confirmed;
create policy "frameup reel clip confirmed: es users read"
  on public.frameup_reel_clip_confirmed for select
  to authenticated
  using (public.is_es_designer_domain_user());

revoke insert, update, delete on public.frameup_reel_clip_confirmed from anon, authenticated;

comment on table public.frameup_reel_clip_confirmed is
  'Reels v4: clips the vision judge confirmed per subject key (player/person/team/game), best segment, keep/swap rank. Server-written only.';
