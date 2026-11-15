-- Rollback for 20261116001000_opportunity_radar.sql. Drops ONLY the objects that migration created.
-- Deletes all Opportunity Radar discussions, drafts, usage records and settings. Nothing else is touched.
drop function if exists public.radar_reopen(uuid, text);
drop function if exists public.radar_purge_content(integer);
drop table if exists public.radar_drafts;
drop table if exists public.radar_opportunities;
drop table if exists public.radar_source_state;
drop table if exists public.radar_usage;
drop table if exists public.radar_settings;
drop function if exists public.radar_drafts_guard_insert();
drop function if exists public.radar_drafts_guard_update();
drop function if exists public.radar_drafts_no_delete();
