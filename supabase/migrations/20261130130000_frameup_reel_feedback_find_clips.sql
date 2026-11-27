-- Reels v4: allow the 'find_clips' feedback event (the Review page's "Find
-- clips" action) in frameup_reel_feedback. Until this runs the API saves the
-- other events of a batch and skips find_clips (no error).
-- Safe to run more than once. Needs 20261130120000_frameup_reel_feedback.sql.
--
-- Undo (only when no find_clips rows exist):
--   alter table public.frameup_reel_feedback drop constraint if exists frameup_reel_feedback_event_check;
--   alter table public.frameup_reel_feedback add constraint frameup_reel_feedback_event_check
--     check (event in ('swap_media', 'edit_text', 'change_module', 'regenerate', 'delete_beat', 'export', 'posted'));

alter table public.frameup_reel_feedback
  drop constraint if exists frameup_reel_feedback_event_check;

alter table public.frameup_reel_feedback
  add constraint frameup_reel_feedback_event_check
  check (event in ('swap_media', 'edit_text', 'change_module', 'regenerate', 'delete_beat', 'export', 'posted', 'find_clips'));
