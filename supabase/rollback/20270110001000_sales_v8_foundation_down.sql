-- Rollback for 20270110001000_sales_v8_foundation.sql. Removes policy versions and rep invites.
-- Does not change the commission settings back (edit them in the Policy tab if needed).
drop trigger if exists sales_settings_version on public.sales_settings;
drop trigger if exists sales_commission_stamp_version on public.sales_commissions;
drop trigger if exists sales_reps_invite_accepted on public.sales_reps;
drop trigger if exists sales_attribution_canceled on public.sales_attributions;
drop function if exists public.sales_attribution_canceled();
drop function if exists public.sales_customer_canceled(uuid, timestamptz);
drop function if exists public.sales_settings_version();
drop function if exists public.sales_commission_stamp_version();
drop function if exists public.sales_reps_invite_accepted();
drop function if exists public.admin_sales_policy_versions(uuid);
drop function if exists public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean, text, boolean);
drop function if exists public.admin_sales_invite_create(uuid, uuid, text, integer);
drop function if exists public.sales_invite_lookup(text);
drop function if exists public.admin_sales_invites(uuid);
drop function if exists public.sales_policy_current_version();
drop function if exists public.sales_policy_snapshot(public.sales_settings);
drop table if exists public.sales_rep_invites;
drop table if exists public.sales_policy_versions;
alter table public.sales_commissions drop column if exists policy_version;
alter table public.sales_settings drop column if exists first_month_cancel_voids;
alter table public.sales_attributions drop column if exists cancel_requested_at;
alter table public.sales_settings alter column refund_policy set default 'month_end_clawback';
alter table public.sales_settings alter column attribution_window_days set default 30;
