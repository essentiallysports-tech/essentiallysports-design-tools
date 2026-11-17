-- Video Ads: the Us vs Them claims per newsletter, editable by an admin.
--
-- video-ads-brands.js ships placeholder claims (claimsApproved: false). An
-- admin can replace a brand's claims and mark them owner-approved from the
-- Video Ads page (POST /api/video-ads { mode: 'save-claims' }). Until a row
-- exists, or before this migration runs, the file's claims are used and the
-- "placeholder claims" warning stays on.
--
-- RLS: every signed-in user reads (the copy checks need the list); only
-- public.is_es_designer_admin() inserts or updates. No deletes from the app.
--
-- Undo:
--   drop table if exists public.frameup_video_ad_claims;   -- also drops its policies and trigger
--   drop function if exists public.frameup_video_ad_claims_touch();

create table if not exists public.frameup_video_ad_claims (
  brand_id text primary key check (char_length(brand_id) between 1 and 60),
  claims text[] not null check (cardinality(claims) between 2 and 6),
  approved boolean not null default false,
  updated_by text not null default '' check (char_length(updated_by) <= 200),
  updated_at timestamptz not null default now()
);

create or replace function public.frameup_video_ad_claims_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists frameup_video_ad_claims_touch on public.frameup_video_ad_claims;
create trigger frameup_video_ad_claims_touch
  before insert or update on public.frameup_video_ad_claims
  for each row execute function public.frameup_video_ad_claims_touch();

alter table public.frameup_video_ad_claims enable row level security;

drop policy if exists "video ad claims: signed in read" on public.frameup_video_ad_claims;
create policy "video ad claims: signed in read"
  on public.frameup_video_ad_claims for select
  to authenticated
  using (true);

drop policy if exists "video ad claims: admins insert" on public.frameup_video_ad_claims;
create policy "video ad claims: admins insert"
  on public.frameup_video_ad_claims for insert
  to authenticated
  with check (public.is_es_designer_admin());

drop policy if exists "video ad claims: admins update" on public.frameup_video_ad_claims;
create policy "video ad claims: admins update"
  on public.frameup_video_ad_claims for update
  to authenticated
  using (public.is_es_designer_admin())
  with check (public.is_es_designer_admin());

grant select, insert, update on public.frameup_video_ad_claims to authenticated;
