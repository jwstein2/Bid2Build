-- Security hardening (due-diligence pass, 2026-11-21). Additive and reversible; no data changes.
--
-- 1. Pin search_path on 12 helper functions flagged by the Supabase Security Advisor
--    (lint 0011 function_search_path_mutable). None is SECURITY DEFINER, so the risk is low, but auditors
--    expect zero advisor warnings. Same pattern as 20270118001000.
-- 2. Revoke EXECUTE from anon/authenticated/PUBLIC on SECURITY DEFINER *trigger* functions. Postgres checks
--    EXECUTE on a trigger function only when the trigger is created, never when it fires, so the triggers keep
--    working; this only removes them from the public API surface (lint 0028/0029). Callable RPCs that the public
--    site needs (academy_*, legal_public_statuses, peek_company_invitation) are left alone on purpose.
-- 3. Location retention runs every day for every company. The Privacy Policy promises time-clock locations are
--    cleared after 90 days, but the existing purges only ran when that company next clocked in or sent a
--    geofence event, so an inactive company's old locations would stay. A daily pg_cron job now runs both
--    purges for everyone (hours are never touched, only coordinates and geofence events).
--
-- Rollback: docs/security/rollback_20270218009000.sql

begin;

alter function public.affiliate_guard_immutable() set search_path = public, pg_temp;
alter function public.affiliate_today(timestamp with time zone) set search_path = public, pg_temp;
alter function public.affiliate_invoice_value(public.affiliate_invoices, text) set search_path = public, pg_temp;
alter function public.affiliate_invoice_qualifies(public.affiliate_invoices) set search_path = public, pg_temp;
alter function public.sales_activity_qualifies(text, text, text) set search_path = public, pg_temp;
alter function public.sales_rep_left_before(public.sales_reps, timestamp with time zone) set search_path = public, pg_temp;
alter function public.sales_state_tz(text) set search_path = public, pg_temp;
alter function public.sales_in_call_window(text, timestamp with time zone) set search_path = public, pg_temp;
alter function public.sales_disposition_ok(text, text) set search_path = public, pg_temp;
alter function public.staff_guard_immutable() set search_path = public, pg_temp;
alter function public.payout_fee_cents(integer, text, public.payout_fee_policies) set search_path = public, pg_temp;
alter function public.sales_guard_immutable() set search_path = public, pg_temp;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

create schema if not exists private;

create or replace function private.purge_expired_locations() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entries integer; v_events integer := 0; v_n integer; r record;
begin
  update public.pm_time_entries set in_lat = null, in_lng = null, in_accuracy_m = null, out_lat = null, out_lng = null, out_accuracy_m = null
   where clock_in < now() - interval '90 days' and (in_lat is not null or out_lat is not null);
  get diagnostics v_entries = row_count;
  for r in select distinct company_id, owner_id from public.pm_geofence_events where recorded_at < now() - interval '30 days' loop
    delete from public.pm_geofence_events g
     where g.company_id is not distinct from r.company_id and g.owner_id is not distinct from r.owner_id
       and g.recorded_at < now() - make_interval(days => (public.pm_gps_settings_for(r.company_id, r.owner_id)).retention_days);
    get diagnostics v_n = row_count;
    v_events := v_events + v_n;
  end loop;
  return jsonb_build_object('time_entry_locations_cleared', v_entries, 'geofence_events_deleted', v_events);
end $$;
revoke execute on function private.purge_expired_locations() from public, anon, authenticated;

select cron.schedule('b2b-location-retention', '19 5 * * *', $job$select private.purge_expired_locations()$job$);

commit;

-- Verify (expect 0, 0, then one row for b2b-location-retention, then a small JSON result):
-- select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.prosecdef and p.prorettype='trigger'::regtype and has_function_privilege('anon', p.oid, 'execute');
-- select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.prokind='f' and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
--  and p.proname in ('affiliate_guard_immutable','affiliate_today','affiliate_invoice_value','affiliate_invoice_qualifies','sales_activity_qualifies','sales_rep_left_before','sales_state_tz','sales_in_call_window','sales_disposition_ok','staff_guard_immutable','payout_fee_cents','sales_guard_immutable');
-- select jobname, schedule, active from cron.job where jobname = 'b2b-location-retention';
-- select private.purge_expired_locations();
