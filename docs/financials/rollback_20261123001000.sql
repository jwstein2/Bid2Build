-- Rollback for 20261123001000_fin_foundation.sql (books, seats, financial permissions, audit log, numbering,
-- financial-documents bucket, configuration, AI preferences, dashboard preferences, mode).
-- Deploy the previous app version first. WARNING: drops the financial audit log and document register.
-- Stored files in the financial-documents bucket are NOT deleted here: export / remove them with the
-- storage API first (the bucket row is removed only when it is empty). Run 004, 003 and 002 first.
begin;
drop policy if exists financial_documents_read on storage.objects;
delete from storage.buckets b where b.id = 'financial-documents' and not exists (select 1 from storage.objects o where o.bucket_id = b.id);

drop table if exists public.fin_user_preferences;
drop table if exists public.fin_dashboard_prefs;
drop table if exists public.fin_ai_preferences;
drop table if exists public.fin_project_profiles;
drop table if exists public.fin_business_config;
drop table if exists public.fin_documents;
drop table if exists public.fin_number_sequences;
drop table if exists public.fin_audit_log;
drop table if exists public.fin_seats;
drop table if exists public.fin_books;

alter table public.subscriptions drop constraint if exists subscriptions_fin_extra_seats_check;
alter table public.subscriptions drop column if exists fin_addon, drop column if exists fin_addon_until, drop column if exists fin_extra_seats;
alter table public.complimentary_grants drop constraint if exists complimentary_grants_fin_seats_check;
alter table public.complimentary_grants drop column if exists fin_seats;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['apply_fin_update', 'fin_access', 'fin_accountant_seat_assign', 'fin_ai_enabled', 'fin_ai_preferences_save', 'fin_audit', 'fin_book_for_estimate', 'fin_business_config_save', 'fin_can_view_book', 'fin_dashboard_layout', 'fin_dashboard_prefs_guard', 'fin_dashboard_reset', 'fin_dashboard_save', 'fin_document_register', 'fin_documents_guard', 'fin_ensure_book', 'fin_entitlement', 'fin_essential_alert_keys', 'fin_guard_immutable', 'fin_has_permission', 'fin_my_book', 'fin_next_number', 'fin_permission_keys', 'fin_project_profile_save', 'fin_require', 'fin_role_permissions', 'fin_seat_assign', 'fin_seat_covered', 'fin_seat_remove', 'fin_set_mode', 'fin_trade_slugs_valid']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

-- Permissions back to the V4.6 set. Custom grants/revokes of the removed keys are stripped first.
update public.company_members set
  permissions_granted = array(select k from unnest(permissions_granted) k where k <> all(array['view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments', 'record_expenses', 'approve_expenses', 'record_bills', 'approve_vendor_bills', 'manage_accounts', 'post_journal_entries', 'reconcile', 'close_periods', 'export_financials', 'manage_financial_config', 'manage_sub_compliance', 'manage_payment_connections', 'manage_financial_seats'])),
  permissions_revoked = array(select k from unnest(permissions_revoked) k where k <> all(array['view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments', 'record_expenses', 'approve_expenses', 'record_bills', 'approve_vendor_bills', 'manage_accounts', 'post_journal_entries', 'reconcile', 'close_periods', 'export_financials', 'manage_financial_config', 'manage_sub_compliance', 'manage_payment_connections', 'manage_financial_seats']));

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
    'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy',
    -- V4.6 customer communications
    'view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach',
    'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates',
    'view_customer_replies', 'manage_opt_outs'
  ]
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons', 'change_proposal_policy',
               'enable_customer_nurture', 'enable_auto_project_updates']
$$;
commit;
