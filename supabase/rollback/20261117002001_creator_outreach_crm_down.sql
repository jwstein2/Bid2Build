-- Rollback for 20261117002001_creator_outreach_crm.sql. Run BEFORE the creator_partner_program rollback.
-- Deletes the Creator Partnerships CRM: prospects, cohort slots, outreach messages/events, suppressions
-- and settings. Export the CRM (Admin > Creator Partnerships > Export CSV) first if you need a record.
-- Nothing outside these objects is touched.
alter table if exists public.creator_programs drop column if exists prospect_id;
drop function if exists public.creator_outreach_reallocate(uuid);
drop table if exists public.creator_outreach_events;
drop table if exists public.creator_outreach_messages;
drop table if exists public.creator_cohort_slots;
drop table if exists public.creator_outreach_suppressions;
drop table if exists public.creator_outreach_settings;
drop table if exists public.creator_prospects;
drop function if exists public.creator_outreach_guard_message();
