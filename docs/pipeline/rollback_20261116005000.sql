-- Rollback for 20261116005000_schedule_publications.sql (V4 Phase 8 customer schedule updates).
-- WARNING: this permanently deletes every published customer update and turns off every customer
-- share link. Export anything you need first. Schedules themselves (Phases 6-7) are not touched.
begin;
drop function if exists public.schedule_publication_delivery(uuid, text);
drop function if exists public.schedule_publication_revoke_link(uuid);
drop function if exists public.schedule_publication_link(uuid, text, integer);
drop function if exists public.schedule_publish(uuid, integer, jsonb);
drop table if exists public.schedule_publications;
drop function if exists public.schedule_publications_freeze();
commit;
