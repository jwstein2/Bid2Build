-- Rollback for 20261210001000_team_records.sql. Removes suppliers, employee profiles, time entries and
-- subcontractor records (DATA IS LOST: export first). Team & Subcontractors (pm_resources) is untouched.
-- Files in the private sub-records bucket are not deleted by this script.
drop function if exists public.pm_sub_1099_totals(integer);
drop function if exists public.pm_sub_document_file(uuid);
drop function if exists public.pm_sub_document_remove(uuid);
drop function if exists public.pm_sub_document_add(uuid, jsonb);
drop function if exists public.pm_sub_tax_save(uuid, jsonb);
drop function if exists public.pm_sub_record(uuid);
drop function if exists public.pm_sub_compliance_summary();
drop function if exists public.pm_sub_doc_kind_insurance(text);
drop table if exists public.pm_sub_documents;
drop function if exists public.pm_sub_tracks_1099(public.pm_sub_tax_profiles);
drop table if exists public.pm_sub_tax_profiles;

drop function if exists public.pm_time_entry_history(uuid);
drop function if exists public.pm_timesheet(timestamptz, timestamptz);
drop function if exists public.pm_time_entries_decide(uuid[], text, text);
drop function if exists public.pm_time_entry_save(jsonb);
drop function if exists public.pm_clock_out(jsonb);
drop function if exists public.pm_clock_in(jsonb);
drop function if exists public.pm_time_check_project(uuid, public.pm_resources);
drop function if exists public.pm_time_punch_allowed(public.pm_resources);
drop function if exists public.pm_employee_profile_save(uuid, jsonb);
drop function if exists public.pm_employees();
drop function if exists public.pm_time_purge_locations(uuid, uuid);
drop function if exists public.pm_time_entry_json(public.pm_time_entries);
drop table if exists public.pm_time_entry_changes;
drop table if exists public.pm_time_entries;
drop function if exists public.pm_time_readable(uuid);
drop table if exists public.pm_employee_profiles;

drop function if exists public.price_import_link_supplier(uuid, uuid);
drop function if exists public.pm_supplier_set_status(uuid, text);
drop function if exists public.pm_supplier_save(jsonb);
drop function if exists public.pm_supplier_detail(uuid);
drop function if exists public.pm_suppliers_list();
drop index if exists public.price_imports_supplier_idx;
alter table public.price_imports drop column if exists supplier_id;
drop table if exists public.pm_suppliers;

drop function if exists public.team_is_company_owner(uuid);
drop function if exists public.supplier_manageable(uuid, uuid);
drop function if exists public.sub_compliance_manageable(uuid, uuid);
drop function if exists public.team_in_my_scope(uuid, uuid);
