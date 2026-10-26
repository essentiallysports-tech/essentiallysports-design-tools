-- NFL Pick'em is being discontinued -- the product is not shipping it, and
-- the codebase (pickem.html/pickem.js/pickem.css, the "NFL Pick'em" nav
-- entries) has been removed. This migration drops the entire pickem_*
-- schema from the database so it isn't carried forward into the AWS
-- migration or left behind as dead weight on this project.
--
-- Historical migrations that created this schema
-- (20260918120000_add_pickem_nfl_core_schema.sql,
-- 20260919120000_add_pickem_nfl_write_rpcs.sql,
-- 20260919130000_seed_pickem_nfl_teams.sql) are intentionally left in place
-- as the historical record of what was applied and when -- this migration
-- is the down-migration, not a rewrite of history.
--
-- No FrameUp table or function depends on anything pickem_* (confirmed:
-- the only shared dependency in either direction was pickem's own tables
-- joining auth.users, which this drop does not touch). Safe to run
-- independently of the FrameUp schema.

-- =====================================================================
-- 1) Functions (drop before tables so overload/signature lookups don't
--    fail partway through; CASCADE handles any that outlive their table).
-- =====================================================================

drop function if exists public.pickem_get_season_leaderboard(uuid, int) cascade;
drop function if exists public.pickem_get_weekly_leaderboard(uuid, int) cascade;
drop function if exists public.pickem_get_week_payload(uuid) cascade;
drop function if exists public.pickem_admin_log(text, text, text, jsonb, jsonb, text) cascade;
drop function if exists public.pickem_admin_void_game(uuid, text) cascade;
drop function if exists public.pickem_admin_set_final_score(uuid, int, int, text, text) cascade;
drop function if exists public.pickem_admin_set_tiebreak_games(uuid, uuid, uuid) cascade;
drop function if exists public.pickem_admin_create_game(uuid, uuid, uuid, timestamptz) cascade;
drop function if exists public.pickem_admin_create_week(uuid, int, text, timestamptz) cascade;
drop function if exists public.pickem_admin_create_season(int, text) cascade;
drop function if exists public.pickem_recalculate_week(uuid) cascade;
drop function if exists public.pickem_finalize_game(uuid) cascade;
drop function if exists public.pickem_enforce_pick_lock() cascade;
drop function if exists public.pickem_complete_week(uuid) cascade;
drop function if exists public.pickem_set_tiebreaker(uuid, int, int, int, int) cascade;
drop function if exists public.pickem_set_pick(uuid, uuid) cascade;
drop function if exists public.pickem_get_entry_progress(uuid, uuid) cascade;
drop function if exists public.is_pickem_admin() cascade;

-- =====================================================================
-- 2) Tables (CASCADE drops their policies, triggers, indexes, and FKs
--    along with them -- nothing outside pickem_* references these).
-- =====================================================================

drop table if exists public.pickem_notification_preferences cascade;
drop table if exists public.pickem_referrals cascade;
drop table if exists public.pickem_provider_events cascade;
drop table if exists public.pickem_provider_sync_runs cascade;
drop table if exists public.pickem_admin_audit_log cascade;
drop table if exists public.pickem_admins cascade;
drop table if exists public.pickem_season_stats cascade;
drop table if exists public.pickem_weekly_stats cascade;
drop table if exists public.pickem_pick_history cascade;
drop table if exists public.pickem_picks cascade;
drop table if exists public.pickem_entries cascade;
drop table if exists public.pickem_games cascade;
drop table if exists public.pickem_weeks cascade;
drop table if exists public.pickem_teams cascade;
drop table if exists public.pickem_seasons cascade;

notify pgrst, 'reload schema';
