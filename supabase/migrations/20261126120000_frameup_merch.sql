-- FrameUp Merch Designs: history, sales and the upload-relay bucket.
--
-- The merch server (netlify/functions/merch.js), the Fourthwall webhook
-- (fourthwall-webhook.js) and the daily sync (merch-sync.js) write these with
-- the service role. Signed-in ES users read them (the "Your merch" list and
-- sales); nobody writes from the browser. Fourthwall events are admin-read only.
--
-- No buyer personal data is stored: orders keep only id, status, dates, money
-- and per-product lines (product, variant, units, revenue). No email, name,
-- username, message or address.
--
-- The app works before this runs: the server keeps history in memory and
-- `list` falls back to Fourthwall's product list.
--
-- Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_merch_events;
--   drop table if exists public.frameup_merch_orders;
--   drop table if exists public.frameup_merch_products;
--   drop table if exists public.frameup_merch_designs;
--   delete from storage.buckets where id = 'merch-art';  -- after emptying it

-- ─── Designs: one row per design sent to the shop ─────────────────────────
create table if not exists public.frameup_merch_designs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null check (char_length(created_by) <= 200),
  blank text not null check (blank in ('tee', 'hoodie', 'poster', 'sticker', 'mug')),
  title text not null default '' check (char_length(title) <= 120),
  collection text not null default '' check (char_length(collection) <= 20),
  concept jsonb not null default '{}'::jsonb check (pg_column_size(concept) <= 16384),
  rights_ack jsonb not null default '{}'::jsonb check (pg_column_size(rights_ack) <= 8192),
  print_path text check (char_length(print_path) <= 300)
);
create index if not exists frameup_merch_designs_created_idx on public.frameup_merch_designs (created_at desc);
create index if not exists frameup_merch_designs_user_idx on public.frameup_merch_designs (lower(created_by), created_at desc);

-- ─── Products: one row per Fourthwall product FrameUp created ─────────────
create table if not exists public.frameup_merch_products (
  product_id text primary key check (char_length(product_id) between 3 and 80),
  design_id uuid references public.frameup_merch_designs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default '' check (char_length(created_by) <= 200),
  title text not null default '' check (char_length(title) <= 120),
  blank text not null default 'tee' check (blank in ('tee', 'hoodie', 'poster', 'sticker', 'mug')),
  template_id text not null default '',
  color text not null default '',
  regions text[] not null default '{}',
  -- Fourthwall `access`: HIDDEN / PUBLIC / PRIVATE / ARCHIVED (not `state`, which is stock).
  state text not null default 'HIDDEN' check (state in ('HIDDEN', 'PUBLIC', 'PRIVATE', 'ARCHIVED')),
  price jsonb not null default '{}'::jsonb,          -- { retail, base, margin }
  product_url text not null default '',
  slug text not null default '',
  thumb text not null default '',
  images jsonb not null default '[]'::jsonb check (pg_column_size(images) <= 16384),
  variants jsonb not null default '[]'::jsonb check (pg_column_size(variants) <= 32768),
  collection_ids text[] not null default '{}',
  ack jsonb not null default '{}'::jsonb check (pg_column_size(ack) <= 8192),
  published_at timestamptz,
  archived_at timestamptz,
  refreshed_at timestamptz
);
create index if not exists frameup_merch_products_created_idx on public.frameup_merch_products (created_at desc);
create index if not exists frameup_merch_products_user_idx on public.frameup_merch_products (lower(created_by), created_at desc);
create index if not exists frameup_merch_products_state_idx on public.frameup_merch_products (state, created_at desc);

-- ─── Orders (no buyer data) ───────────────────────────────────────────────
create table if not exists public.frameup_merch_orders (
  order_id text primary key check (char_length(order_id) between 3 and 80),
  friendly_id text,
  status text not null default 'CONFIRMED' check (char_length(status) <= 40),
  placed_at timestamptz not null,
  fw_updated_at timestamptz,
  currency text not null default 'USD' check (char_length(currency) <= 8),
  subtotal numeric(12, 2),
  -- [{ productId, variantId, name, variant, quantity, revenue, cost, currency }]
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 32768),
  product_ids text[] not null default '{}',
  test_mode boolean not null default false,
  source text not null default 'webhook' check (source in ('webhook', 'sync')),
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists frameup_merch_orders_placed_idx on public.frameup_merch_orders (placed_at desc);
create index if not exists frameup_merch_orders_updated_idx on public.frameup_merch_orders (fw_updated_at desc nulls last);
create index if not exists frameup_merch_orders_products_idx on public.frameup_merch_orders using gin (product_ids);

-- ─── Events: FrameUp actions, Fourthwall webhooks (id = event id, so a replay
-- is ignored), sync runs ─────────────────────────────────────────────────────
create table if not exists public.frameup_merch_events (
  id text primary key check (char_length(id) between 3 and 120),
  source text not null check (source in ('frameup', 'fourthwall', 'sync')),
  type text not null check (char_length(type) <= 40),
  product_id text,
  order_id text,
  actor text check (char_length(actor) <= 200),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 16384),
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index if not exists frameup_merch_events_type_idx on public.frameup_merch_events (type, created_at desc);
create index if not exists frameup_merch_events_product_idx on public.frameup_merch_events (product_id, created_at desc);

-- ─── RLS: ES users read; the server writes with the service role ──────────
alter table public.frameup_merch_designs enable row level security;
alter table public.frameup_merch_products enable row level security;
alter table public.frameup_merch_orders enable row level security;
alter table public.frameup_merch_events enable row level security;

drop policy if exists "frameup merch designs: es users read" on public.frameup_merch_designs;
create policy "frameup merch designs: es users read"
  on public.frameup_merch_designs for select to authenticated
  using (public.is_es_designer_domain_user());

drop policy if exists "frameup merch products: es users read" on public.frameup_merch_products;
create policy "frameup merch products: es users read"
  on public.frameup_merch_products for select to authenticated
  using (public.is_es_designer_domain_user());

drop policy if exists "frameup merch orders: es users read" on public.frameup_merch_orders;
create policy "frameup merch orders: es users read"
  on public.frameup_merch_orders for select to authenticated
  using (public.is_es_designer_domain_user());

drop policy if exists "frameup merch events: admins read" on public.frameup_merch_events;
create policy "frameup merch events: admins read"
  on public.frameup_merch_events for select to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_merch_designs from anon, authenticated;
revoke all on table public.frameup_merch_products from anon, authenticated;
revoke all on table public.frameup_merch_orders from anon, authenticated;
revoke all on table public.frameup_merch_events from anon, authenticated;
grant select on table public.frameup_merch_designs to authenticated;
grant select on table public.frameup_merch_products to authenticated;
grant select on table public.frameup_merch_orders to authenticated;
grant select on table public.frameup_merch_events to authenticated;

-- ─── Storage: merch-art (private), for the upload relay ───────────────────
-- The browser uploads the print PNG to merch-art/<auth user id>/<file>.png;
-- the server reads it with the service role, streams it to Fourthwall's signed
-- upload URL, then deletes it. Each person writes and reads only their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('merch-art', 'merch-art', false, 26214400, array['image/png'])
on conflict (id) do nothing;

drop policy if exists "merch art: es users upload own" on storage.objects;
create policy "merch art: es users upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'merch-art'
    and public.is_es_designer_domain_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "merch art: es users read own" on storage.objects;
create policy "merch art: es users read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'merch-art'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "merch art: es users replace own" on storage.objects;
create policy "merch art: es users replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'merch-art' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'merch-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "merch art: es users delete own" on storage.objects;
create policy "merch art: es users delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'merch-art' and (storage.foldername(name))[1] = (select auth.uid())::text);
