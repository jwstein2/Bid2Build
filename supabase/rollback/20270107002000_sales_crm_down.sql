-- Rollback for 20270107002000_sales_crm.sql. Deletes ALL sales leads, activity history and tasks.
drop trigger if exists sales_attributions_link_lead on public.sales_attributions;
drop trigger if exists sales_attributions_paying on public.sales_attributions;
drop function if exists public.sales_crm_link_customer(), public.sales_crm_mark_paying(), public.admin_sales_crm_import(uuid, jsonb, uuid),
  public.admin_sales_crm_assign(uuid, uuid[], uuid), public.admin_sales_crm(uuid), public.sales_crm_task_save(uuid, uuid, text, timestamptz, boolean),
  public.sales_crm_activity_add(uuid, text, text, timestamptz), public.sales_crm_lead_update(uuid, jsonb), public.sales_crm_lead_create(jsonb),
  public.sales_crm_lead(uuid), public.sales_crm_leads(), public.sales_crm_can_see(public.sales_reps, public.sales_leads),
  public.sales_lead_duplicates(text[], uuid), public.sales_lead_json(public.sales_leads), public.sales_my_rep(), public.sales_lead_keys(text, text, text, text);
drop table if exists public.sales_tasks, public.sales_activities, public.sales_leads;
