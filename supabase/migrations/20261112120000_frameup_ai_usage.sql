-- AI spend tracking: one row per AI call made through the Vercel AI Gateway
-- (Trend Design headline ideas, Generate, and later photo picking / image
-- generation). The server writes each row with the signed-in user's own
-- session; only dashboard admins can read them (Dashboard → AI spend).
--
-- Undo:
--   drop table if exists public.frameup_ai_usage;

create table if not exists public.frameup_ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_email text not null,
  feature text not null,
  model text not null,
  ok boolean not null default true,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  images integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer,
  error text
);

create index if not exists frameup_ai_usage_created_at_idx on public.frameup_ai_usage (created_at desc);

alter table public.frameup_ai_usage enable row level security;

drop policy if exists "frameup ai usage: users log own calls" on public.frameup_ai_usage;
create policy "frameup ai usage: users log own calls"
  on public.frameup_ai_usage for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup ai usage: admins read" on public.frameup_ai_usage;
create policy "frameup ai usage: admins read"
  on public.frameup_ai_usage for select
  to authenticated
  using (public.is_es_designer_admin());
