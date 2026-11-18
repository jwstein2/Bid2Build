-- Rollback for 20270104001000_sub_compliance.sql (subcontractor compliance). Drops the request links, notices,
-- payer details and encrypted tax ids. WARNING: full TINs (and SSNs, if 20270105001000 was applied and rolled back
-- first) stored in pm_sensitive_ids are deleted; last 4 stay in pm_sub_tax_profiles. Safe to run more than once.
drop function if exists public.pm_payer_profile_save(jsonb);
drop table if exists public.pm_payer_profiles;
drop function if exists public.fin_vendor_compliance(uuid);
drop function if exists public.pm_compliance_due(date);
drop table if exists public.pm_compliance_notices;
drop function if exists public.pm_sub_request_submit(text, jsonb);
drop function if exists public.pm_sub_request_lookup(text);
drop function if exists public.pm_sub_request_revoke(uuid);
drop function if exists public.pm_sub_request_create(uuid, jsonb);
alter table public.pm_sub_tax_profiles drop column if exists request_id;
alter table public.pm_sub_tax_profiles drop column if exists signed_at;
alter table public.pm_sub_tax_profiles drop column if exists signed_name;
alter table public.pm_sub_documents drop column if exists request_id;
drop table if exists public.pm_sub_doc_requests;
drop function if exists public.pm_sensitive_status(uuid, text);
drop function if exists public.pm_sensitive_log(uuid, text, text, text);
drop policy if exists pm_sensitive_access_log_select on public.pm_sensitive_access_log;
drop function if exists public.pm_sensitive_can(uuid, text);
drop table if exists public.pm_sensitive_access_log;
drop table if exists public.pm_sensitive_ids;
