-- FrameUp Merch7: five more blanks (longsleeve, crewneck, tank, youth, tote).
--
-- 20261126120000_frameup_merch.sql limits `blank` to the first five kinds, so a
-- history write for a new blank is refused and the server falls back to memory
-- for that product (the Fourthwall product is still created). This widens the
-- two checks. Several colours in one product are stored in the existing `color`
-- column as "White, Black, Red" (no new column, so the server works before and
-- after this runs).
--
-- Safe to run more than once. Postgres names an inline column check
-- <table>_<column>_check, which is what 20261126120000 created.
--
-- Undo (only if no rows use the new kinds):
--   alter table public.frameup_merch_designs drop constraint if exists frameup_merch_designs_blank_check;
--   alter table public.frameup_merch_designs add constraint frameup_merch_designs_blank_check
--     check (blank in ('tee', 'hoodie', 'poster', 'sticker', 'mug'));
--   (same for frameup_merch_products)

alter table public.frameup_merch_designs drop constraint if exists frameup_merch_designs_blank_check;
alter table public.frameup_merch_designs add constraint frameup_merch_designs_blank_check
  check (blank in ('tee', 'hoodie', 'poster', 'sticker', 'mug', 'longsleeve', 'crewneck', 'tank', 'youth', 'tote'));

alter table public.frameup_merch_products drop constraint if exists frameup_merch_products_blank_check;
alter table public.frameup_merch_products add constraint frameup_merch_products_blank_check
  check (blank in ('tee', 'hoodie', 'poster', 'sticker', 'mug', 'longsleeve', 'crewneck', 'tank', 'youth', 'tote'));
