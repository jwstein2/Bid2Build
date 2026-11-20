-- Rollback for 20270207001000_staff_payouts.sql (Owner Administration, Staff Onboarding, Payouts & Banking).
-- Only run this if you need to remove the feature. It deletes the staff directory, onboarding records, agreement
-- acceptances, sealed W-9 TINs, payout history and banking settings created by that migration. Existing Sales Hub
-- tables (sales_reps, sales_statements, sales_commissions, sales_payouts) are left in place; any sales_payouts rows that
-- live automated payouts recorded stay as the record of money that was actually paid.
begin;

drop trigger if exists sales_reps_staff_sync on public.sales_reps;
drop trigger if exists sales_reps_staff_link on public.sales_reps;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'admin_banking_designate','admin_banking_overview','admin_fee_policy_approve','admin_funding_approve','admin_payout_activate_live','admin_payout_approve',
      'admin_payout_cancel','admin_payout_cost_report','admin_payout_pause','admin_payout_reconcile','admin_payout_settings_save','admin_payout_simulate',
      'admin_payout_tax_year','admin_payouts_overview','admin_staff_banking_grant','admin_staff_get','admin_staff_invite_create','admin_staff_list',
      'admin_staff_save','admin_staff_set_status','admin_staff_tax_verify','admin_tax_threshold_save','payout_apply_event','payout_blockers',
      'payout_claim_due','payout_fee_bearer','payout_fee_cents','payout_json','payout_mark_submit_error','payout_mark_submitted','payout_plan',
      'staff_audit','staff_capabilities','staff_destination_record','staff_from_sales_rep','staff_from_sales_rep_backfill','staff_guard_immutable',
      'staff_invite_accept','staff_invite_lookup','staff_link_from_sales_rep','staff_me','staff_member_json','staff_my_agreement_accept',
      'staff_my_capabilities','staff_my_employment_item','staff_my_finish','staff_my_payment_method','staff_my_payouts','staff_my_profile_save',
      'staff_my_role_confirm','staff_onboarding_status','staff_require_cap','staff_require_owner','staff_required_agreements','staff_security_confirm',
      'staff_self','staff_w9_store'])
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists public.payout_events, public.payout_items, public.payouts, public.owner_finance_settings, public.tax_reporting_thresholds,
  public.payout_settings, public.payout_fee_policies, public.staff_payout_destinations, public.staff_tin_secrets, public.staff_tax_profiles,
  public.staff_agreement_acceptances, public.staff_agreement_templates, public.staff_invites, public.staff_roles, public.staff_members cascade;
drop sequence if exists public.payout_ref_seq;

commit;
