-- Rollback for 20261116003000_pm_entitlements.sql (PM add-on entitlements).
-- Removes PM editor assignments and the PM billing mirror columns. Stripe subscriptions are not
-- touched: remove any PM add-on / editor items in Stripe first if billing was ever switched on.
drop function if exists public.admin_comp_set_pm_editors(uuid, uuid, integer);
drop function if exists public.company_pm_assign(uuid, boolean);
drop function if exists public.can_edit_schedules();
drop function if exists public.my_pm_access();
drop function if exists public.pm_entitlement(uuid);
drop function if exists public.apply_pm_update(text, boolean, integer, timestamptz);
drop table if exists public.pm_editors;
alter table public.complimentary_grants drop constraint if exists complimentary_grants_pm_editors_check;
alter table public.complimentary_grants drop column if exists pm_editors;
alter table public.subscriptions drop constraint if exists subscriptions_pm_extra_editors_check;
alter table public.subscriptions drop column if exists pm_extra_editors;
alter table public.subscriptions drop column if exists pm_addon_until;
alter table public.subscriptions drop column if exists pm_addon;
-- comp_admin_row keeps returning pm_editors only if the column exists; re-run the original definition
-- from 20261114004000_complimentary_access.sql to restore it exactly.
