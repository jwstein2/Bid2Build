-- Rollback for 20270109101000_sales_lead_import.sql. Deletes import batches, the weekly target and the
-- do-not-contact suppression list. Leads that were imported stay, relabeled as source 'import', but lose
-- their start date, verification sources and sales brief.
drop trigger if exists sales_leads_suppress on public.sales_leads;
drop function if exists public.sales_leads_suppress();
drop function if exists public.admin_sales_import_batches(uuid);
drop function if exists public.admin_sales_import_target_save(uuid, text, text, integer, integer, boolean);
drop function if exists public.sales_import_target();
drop function if exists public.sales_leads_missing_brief(integer);
drop function if exists public.sales_lead_brief_set(uuid, text);
drop function if exists public.sales_import_batch(text, text, jsonb, integer);
drop function if exists public.sales_import_batch(text, text, jsonb);
drop function if exists public.sales_suppression_keys(text, text, text);
drop table if exists public.sales_suppressions;
drop table if exists public.sales_lead_batches;
update public.sales_leads set source = 'import' where source = 'agent';
alter table public.sales_leads drop column if exists import_batch_id, drop column if exists business_started,
  drop column if exists verification, drop column if exists sales_brief, drop column if exists sales_brief_at;
alter table public.sales_settings drop column if exists lead_target_zip, drop column if exists lead_target_trade,
  drop column if exists lead_target_radius_miles, drop column if exists lead_target_count, drop column if exists lead_target_paused;
alter table public.sales_leads drop constraint if exists sales_leads_source_check;
alter table public.sales_leads add constraint sales_leads_source_check check (source in ('manual', 'import', 'places', 'link', 'owner'));
