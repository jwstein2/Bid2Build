-- Rollback for 20261121001000_customer_communications.sql (V4.6 Customer Nurture & Automated Communications).
-- Deploy the previous app version first (or keep COMM_EMAIL_MODE unset so nothing sends).
-- WARNING: this drops the communications history, suppressions (opt-outs) and replies. Export
-- public.comm_suppressions first if you may turn this back on: opt-outs must be honored again.
begin;
-- Customer communication notices go away with the feature.
delete from public.user_notifications where kind in ('customer_update', 'customer_reply');
update public.user_notifications set resolution = 'closed' where resolution in ('sent', 'skipped', 'handled');
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in ('task_review'));
alter table public.user_notifications drop constraint if exists user_notifications_resolution_check;
alter table public.user_notifications add constraint user_notifications_resolution_check
  check (resolution in ('confirmed', 'completed', 'moved', 'reassigned', 'closed'));

drop table if exists public.project_comm_settings;
drop table if exists public.comm_events;
drop table if exists public.comm_messages;
drop table if exists public.comm_offers;
drop table if exists public.comm_suppressions;
drop table if exists public.comm_contacts;
drop table if exists public.comm_settings;
drop table if exists public.comm_global;
drop function if exists public.project_comm_settings_guard();
drop function if exists public.comm_messages_freeze();
drop function if exists public.comm_suppressions_keep();
drop function if exists public.comm_access();
drop function if exists public.comm_can(uuid, text);
drop function if exists public.comm_my_account();
drop function if exists public.comm_permission_keys();

-- Permissions back to the V4.4 set. Custom grants/revokes of the removed keys are stripped first.
update public.company_members set
  permissions_granted = array(select k from unnest(permissions_granted) k where k <> all(array['view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach', 'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates', 'view_customer_replies', 'manage_opt_outs'])),
  permissions_revoked = array(select k from unnest(permissions_revoked) k where k <> all(array['view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach', 'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates', 'view_customer_replies', 'manage_opt_outs']));

create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons',
    'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
    'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
    'view_subcontractor_costs', 'edit_project_costs',
    'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy'
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
                              'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
                              'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
                              'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
                              'view_subcontractor_costs', 'edit_project_costs',
                              'view_proposal_style', 'customize_proposal_style']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs',
                                'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'manage_dependencies', 'update_progress', 'download_schedule_pdf',
                                'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion', 'create_change_orders', 'upload_photos',
                                'view_proposal_style', 'customize_proposal_style']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics', 'view_schedules', 'download_schedule_pdf', 'view_proposal_style']
    else array[]::text[]
  end
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons', 'change_proposal_policy']
$$;
commit;
