-- Rollback for 20270213001000_fin_connect_payments.sql (Stripe Connect invoice payments).
-- Run in the Supabase SQL Editor only if you need to undo it. Payments already recorded from Stripe stay in
-- fin_payments (they're real money); only the Connect tables and functions are removed, and the source check is
-- widened back only when no 'stripe' payments exist.
drop function if exists public.fin_payment_account_settings(uuid, jsonb);
drop function if exists public.fin_online_payment_settle(text, text, text, numeric);
drop table if exists public.fin_online_payments;
drop table if exists public.fin_invoice_pay_links;
drop table if exists public.fin_payment_accounts;
do $$
begin
  if not exists (select 1 from public.fin_payments where source = 'stripe') then
    alter table public.fin_payments drop constraint if exists fin_payments_source_check;
    alter table public.fin_payments add constraint fin_payments_source_check check (source in ('manual'));
  end if;
end $$;
