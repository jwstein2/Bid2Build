-- Rollback for 20270119002000_sales_compliance.sql. Restores the earlier functions by re-running the
-- original definitions: run supabase/migrations/20270107001000_sales_portal.sql section for
-- sales_sync_billing and 20270107002000_sales_crm.sql section for sales_crm_activity_add, then:
drop function if exists public.sales_crm_dnc_record(uuid, text, text, boolean, text);
drop function if exists public.sales_in_call_window(text, timestamptz);
drop function if exists public.sales_state_tz(text);
drop trigger if exists sales_reps_removed_at on public.sales_reps;
drop function if exists public.sales_reps_removed_at();
-- Columns are left in place (harmless): sales_reps.removed_at, sales_leads.dnc_status, dnc_checked_at,
-- dnc_checked_by, phone_line, text_consent_at, text_consent_note. sales_rep_left_before stays because the
-- restored sales_sync_billing no longer uses it; drop it after restoring if you like.
