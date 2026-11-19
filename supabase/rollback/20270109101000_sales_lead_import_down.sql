-- Rollback for 20270109101000_sales_lead_import.sql. Deletes import batches and the do-not-contact
-- suppression list. Leads that were imported stay, relabeled as source 'import'.
drop trigger if exists sales_leads_suppress on public.sales_leads;
drop function if exists public.sales_leads_suppress();
drop function if exists public.admin_sales_import_batches(uuid);
drop function if exists public.sales_import_batch(text, text, jsonb);
drop function if exists public.sales_suppression_keys(text, text, text);
drop table if exists public.sales_suppressions;
drop table if exists public.sales_lead_batches;
update public.sales_leads set source = 'import' where source = 'agent';
alter table public.sales_leads drop column if exists import_batch_id;
alter table public.sales_leads drop constraint if exists sales_leads_source_check;
alter table public.sales_leads add constraint sales_leads_source_check check (source in ('manual', 'import', 'places', 'link', 'owner'));
