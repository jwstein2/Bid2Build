-- Rollback for 20270218009000_security_hardening.sql
begin;
alter function public.affiliate_guard_immutable() reset search_path;
alter function public.affiliate_today(timestamp with time zone) reset search_path;
alter function public.affiliate_invoice_value(public.affiliate_invoices, text) reset search_path;
alter function public.affiliate_invoice_qualifies(public.affiliate_invoices) reset search_path;
alter function public.sales_activity_qualifies(text, text, text) reset search_path;
alter function public.sales_rep_left_before(public.sales_reps, timestamp with time zone) reset search_path;
alter function public.sales_state_tz(text) reset search_path;
alter function public.sales_in_call_window(text, timestamp with time zone) reset search_path;
alter function public.sales_disposition_ok(text, text) reset search_path;
alter function public.staff_guard_immutable() reset search_path;
alter function public.payout_fee_cents(integer, text, public.payout_fee_policies) reset search_path;
alter function public.sales_guard_immutable() reset search_path;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop execute format('grant execute on function %s to public, anon, authenticated', f); end loop;
end $$;
commit;
