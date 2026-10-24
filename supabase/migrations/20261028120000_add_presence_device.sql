-- Mobile web, Phase 1: know whether people use FrameUp on a phone.
-- Additive: one optional column on presence ("mobile" / "desktop"). Exports
-- record the same value in their metadata, which needs no schema change.
alter table public.es_designer_presence
  add column if not exists device text not null default '';

notify pgrst, 'reload schema';
