-- Rollback for 20270105001000_hr_files.sql (employee HR files). WARNING: deletes HR files, HR documents records
-- (files stay in the hr-records bucket), certifications, time off, the HR audit trail and encrypted SSNs.
-- Safe to run more than once. Run before rolling back 20270104001000.
drop function if exists public.pm_hr_overview();
drop function if exists public.pm_employee_hr_get(uuid, integer);
drop function if exists public.pm_pto_set_status(uuid, text);
drop function if exists public.pm_pto_save(uuid, jsonb);
drop table if exists public.pm_pto_entries;
drop function if exists public.pm_employee_cert_remove(uuid);
drop function if exists public.pm_employee_cert_save(uuid, jsonb);
drop table if exists public.pm_employee_certifications;
drop function if exists public.pm_employee_document_remove(uuid);
drop function if exists public.pm_employee_document_file(uuid);
drop function if exists public.pm_employee_document_add(uuid, jsonb);
drop table if exists public.pm_employee_documents;
drop function if exists public.pm_employee_hr_save(uuid, jsonb);
drop function if exists public.pm_hr_resource(uuid);
drop table if exists public.pm_employee_hr;
do $$ begin
  if to_regclass('public.pm_sensitive_ids') is not null then
    delete from public.pm_sensitive_ids where kind = 'ssn';
    -- Back to the 20270104001000 definition: TINs only.
    execute $f$
      create or replace function public.pm_sensitive_can(p_resource_id uuid, p_kind text) returns boolean
      language sql stable security definer set search_path = public as $b$
        select coalesce((
          select case p_kind
            when 'tin' then r.kind = 'subcontractor' and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
            else false end
            from public.pm_resources r where r.id = p_resource_id), false)
      $b$ $f$;
  end if;
end $$;
drop function if exists public.pm_hr_manager_set(uuid, boolean);
drop table if exists public.pm_hr_audit;
drop table if exists public.pm_hr_managers;
drop function if exists public.pm_hr_can(uuid, uuid);
