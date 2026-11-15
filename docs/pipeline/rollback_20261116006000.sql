-- Rollback for 20261116006000_pm_permissions.sql (V4 Phase 9).
-- Restores the Phase 5-8 rules: then re-run, in order, 20261114005000_enterprise_workspace.sql section 1
-- (company_permission_keys / company_role_permissions / company_owner_only_permissions),
-- 20261116003000_pm_entitlements.sql (company_pm_assign), 20261116004000_project_schedules.sql
-- (can_schedule_estimate, schedule_can_edit, policies, schedule_save, schedule_get) and
-- 20261116005000_schedule_publications.sql (publication functions). No schedule data is deleted.
begin;
drop function if exists public.company_pm_seats();
drop function if exists public.company_pm_reassign(uuid, uuid);
alter table public.pm_editors drop column if exists changed_by;
alter table public.pm_editors drop column if exists changed_at;
commit;
