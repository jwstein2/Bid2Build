-- Rollback for 20261119001000_project_operations.sql. Run the 004000, 003000 and 002000 rollbacks first,
-- and deploy the previous app version. Review records and notices are dropped; schedules, tasks and
-- pipeline stages are untouched. New permission keys are removed from member grants.
begin;
drop function if exists public.notification_act(uuid, text);
drop function if exists public.my_notifications();
drop trigger if exists project_schedules_review_sync on public.project_schedules;
drop function if exists public.project_schedules_review_sync();
drop trigger if exists schedule_tasks_review_sync on public.schedule_tasks;
drop function if exists public.schedule_tasks_review_sync();
drop function if exists public.pm_sync_task_reviews(uuid[]);
drop function if exists public.project_reviewer(uuid);
drop table if exists public.user_notifications;
drop trigger if exists schedule_tasks_guard on public.schedule_tasks;
drop function if exists public.schedule_tasks_guard();
drop function if exists public.can_edit_live_schedule(uuid);
drop function if exists public.can_confirm_task_completion(uuid);
drop trigger if exists project_schedules_sync_stage on public.project_schedules;
drop function if exists public.project_schedules_sync_stage();
drop function if exists public.project_mark_reviewed(uuid, text);
drop function if exists public.project_review_queue();
drop trigger if exists estimates_project_review on public.estimates;
drop function if exists public.project_review_on_won();
drop trigger if exists signatures_project_review on public.signatures;
drop function if exists public.project_review_on_signature();
drop function if exists public.project_review_enqueue(uuid, text, timestamptz, uuid);
drop table if exists public.project_reviews;
drop function if exists public.estimate_permission(uuid, text);
drop function if exists public.estimate_readable(uuid);

-- Remove the new keys from grants/revocations before narrowing the key list (the check constraint uses it).
update public.company_members set
  permissions_granted = array(select k from unnest(permissions_granted) k where k not in ('review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion', 'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos', 'view_subcontractor_costs', 'edit_project_costs', 'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy')),
  permissions_revoked = array(select k from unnest(permissions_revoked) k where k not in ('review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion', 'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos', 'view_subcontractor_costs', 'edit_project_costs', 'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy'));
-- Restore the V4 Phase 9 key lists (from 20261116006000_pm_permissions.sql).
create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons'
  ]
$$;

create or replace function public.company_role_permissions(p_role text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner' then public.company_permission_keys()
    when 'manager' then array['view_own_bids', 'view_team_bids', 'create_estimates', 'edit_team_estimates',
                              'view_costs', 'view_margin', 'approve_bids', 'view_analytics',
                              'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
                              'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
                              'view_internal_reports', 'download_internal_reports', 'send_internal_reports']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs',
                                'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'manage_dependencies', 'update_progress', 'download_schedule_pdf']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics', 'view_schedules', 'download_schedule_pdf']
    else array[]::text[]
  end
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$ select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons'] $$;
commit;
