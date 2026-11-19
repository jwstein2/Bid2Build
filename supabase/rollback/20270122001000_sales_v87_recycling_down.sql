-- Rollback for 20270122001000_sales_v87_recycling.sql. Leads keep their current owner; recycle history is dropped.
drop function if exists public.admin_sales_recycle_history(uuid, integer);
drop function if exists public.admin_sales_lead_recycle(uuid, uuid);
drop function if exists public.admin_sales_recycle_overview(uuid, jsonb);
drop function if exists public.admin_sales_recycle_dispute_decide(uuid, uuid, text, text);
drop function if exists public.admin_sales_recycle_review(uuid, uuid, text, uuid);
drop function if exists public.admin_sales_recycle_now(uuid, uuid[], text);
drop function if exists public.admin_sales_recycle_hold(uuid, uuid[], timestamptz, text);
drop function if exists public.admin_sales_recycle_extend(uuid, uuid[], integer, text);
drop function if exists public.admin_sales_recycle_settings(uuid, jsonb);
drop function if exists public.sales_recycle_dispute(uuid, text);
drop function if exists public.sales_crm_return_lead(uuid, text);
drop function if exists public.sales_my_attention();
drop function if exists public.sales_recycle_run(uuid, timestamptz);
drop function if exists public.sales_recycle_notify(jsonb);
drop function if exists public.sales_recycle_lead(uuid, text, uuid, text);
drop function if exists public.sales_recycle_eval(timestamptz);
drop function if exists public.sales_lead_contact_level(uuid);
drop function if exists public.sales_activity_qualifies(text, text, text);
drop table if exists public.sales_recycle_disputes;
drop table if exists public.sales_lead_recycles;

-- Leads parked by recycling go back to the plain "no eligible rep" queue.
update public.sales_leads set hold_reason = 'no_eligible_rep' where hold_reason in ('recycle_no_alternative', 'recycle_review', 'dormant');
alter table public.sales_leads drop constraint if exists sales_leads_hold;
alter table public.sales_leads add constraint sales_leads_hold check (hold_reason is null or hold_reason in
  ('no_eligible_rep', 'possible_duplicate', 'validation', 'admin_hold', 'needs_classification', 'manual', 'existing_customer'));
alter table public.sales_leads drop column if exists recycle_count;
alter table public.sales_leads drop column if exists recycle_hold_until;
alter table public.sales_leads drop column if exists recycle_hold_note;
drop index if exists public.sales_lead_assignments_open;
alter table public.sales_lead_assignments drop column if exists extended_until;
alter table public.sales_lead_assignments drop column if exists warned_at;
alter table public.sales_lead_assignments drop column if exists warned_for;
alter table public.sales_settings drop column if exists recycle_enabled;
alter table public.sales_settings drop column if exists recycle_first_contact_days;
alter table public.sales_settings drop column if exists recycle_followup_grace_days;
alter table public.sales_settings drop column if exists recycle_warning_hours;
alter table public.sales_settings drop column if exists recycle_max_cycles;
alter table public.sales_settings drop column if exists recycle_started_at;
alter table public.sales_settings drop column if exists recycle_last_run;
