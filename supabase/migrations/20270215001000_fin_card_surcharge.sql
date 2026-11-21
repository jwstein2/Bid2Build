-- Card surcharges on online invoice payments ("customer pays the card fee"), state-aware (2026-11-21).
--
-- The server decides per payment, from the contractor's business state, the customer's state, the card's funding
-- type and billing address, whether a credit card surcharge may be charged (see src/lib/financials/surcharge*.ts).
-- The database stores the contractor's settings and what was actually collected. Payments are still recorded at
-- the INVOICE amount; any surcharge is kept separately in fin_online_payments.surcharge_amount (the ledger posts
-- it as surcharge income, never as a customer credit). Re-runnable.

-- 1. Contractor settings --------------------------------------------------------------------------------------
alter table public.fin_payment_accounts add column if not exists surcharge_pct          numeric(4, 2) not null default 0;
alter table public.fin_payment_accounts add column if not exists card_cost_pct          numeric(4, 2) not null default 2.90;
alter table public.fin_payment_accounts add column if not exists card_cost_fixed_cents  integer not null default 30;
alter table public.fin_payment_accounts add column if not exists surcharge_notice_date  date;
alter table public.fin_payment_accounts add column if not exists surcharge_attested_at  timestamptz;
alter table public.fin_payment_accounts add column if not exists surcharge_attested_by  uuid references auth.users (id) on delete set null;
do $$ begin
  alter table public.fin_payment_accounts add constraint fin_payment_accounts_surcharge_pct check (surcharge_pct between 0 and 3);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.fin_payment_accounts add constraint fin_payment_accounts_card_cost check (card_cost_pct between 0 and 10 and card_cost_fixed_cents between 0 and 500);
exception when duplicate_object then null; end $$;

-- 2. What each online payment collected --------------------------------------------------------------------------
alter table public.fin_online_payments add column if not exists surcharge_offered numeric(14, 2) not null default 0;   -- authorized
alter table public.fin_online_payments add column if not exists surcharge_amount  numeric(14, 2) not null default 0;   -- captured
alter table public.fin_online_payments add column if not exists surcharge_pct     numeric(4, 2);
alter table public.fin_online_payments add column if not exists card_funding      text;
alter table public.fin_online_payments add column if not exists payer_state       text;
alter table public.fin_online_payments add column if not exists surcharge_note    text;
do $$ begin
  alter table public.fin_online_payments add constraint fin_online_payments_surcharge check (
    surcharge_offered >= 0 and surcharge_amount >= 0 and surcharge_amount <= surcharge_offered
    and (surcharge_pct is null or surcharge_pct between 0 and 3)
    and (card_funding is null or card_funding in ('credit', 'debit', 'prepaid', 'unknown'))
    and (payer_state is null or payer_state ~ '^[A-Z]{2}$')
    and (surcharge_note is null or char_length(surcharge_note) <= 300));
exception when duplicate_object then null; end $$;

-- 3. Settings RPC: same signature, now with the surcharge fields --------------------------------------------------
-- The API route checks state rules and the 30-day notice before it lets cardFeePayer = 'customer' through; this
-- function repeats the hard limits so nothing else can bypass them.
create or replace function public.fin_payment_account_settings(p_book_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.fin_payment_accounts;
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', true);
  select * into a from public.fin_payment_accounts where book_id = p_book_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.fin_payment_accounts set
    card_enabled = coalesce((p ->> 'cardEnabled')::boolean, card_enabled),
    ach_enabled  = coalesce((p ->> 'achEnabled')::boolean, ach_enabled),
    card_fee_payer = coalesce(nullif(p ->> 'cardFeePayer', ''), card_fee_payer),
    surcharge_pct = coalesce((p ->> 'surchargePct')::numeric, surcharge_pct),
    card_cost_pct = coalesce((p ->> 'cardCostPct')::numeric, card_cost_pct),
    card_cost_fixed_cents = coalesce((p ->> 'cardCostFixedCents')::integer, card_cost_fixed_cents),
    surcharge_notice_date = case when p ? 'surchargeNoticeDate' then nullif(p ->> 'surchargeNoticeDate', '')::date else surcharge_notice_date end,
    surcharge_attested_at = case when (p ->> 'surchargeAttest')::boolean is true then now()
                                 when (p ->> 'surchargeAttest')::boolean is false then null else surcharge_attested_at end,
    surcharge_attested_by = case when (p ->> 'surchargeAttest')::boolean is true then auth.uid()
                                 when (p ->> 'surchargeAttest')::boolean is false then null else surcharge_attested_by end
  where book_id = p_book_id returning * into a;
  if a.card_fee_payer = 'customer' and (a.surcharge_pct <= 0 or a.surcharge_attested_at is null or a.surcharge_notice_date is null
                                        or a.surcharge_notice_date + 30 > current_date) then
    raise exception 'surcharge_not_ready' using errcode = '22023';
  end if;
  perform public.fin_audit(p_book_id, 'payments.settings', 'book', p_book_id,
    jsonb_build_object('cardEnabled', a.card_enabled, 'achEnabled', a.ach_enabled, 'cardFeePayer', a.card_fee_payer,
                       'surchargePct', a.surcharge_pct::text, 'cardCostPct', a.card_cost_pct::text, 'cardCostFixedCents', a.card_cost_fixed_cents,
                       'surchargeNoticeDate', a.surcharge_notice_date, 'surchargeAttested', a.surcharge_attested_at is not null));
  return jsonb_build_object('cardEnabled', a.card_enabled, 'achEnabled', a.ach_enabled, 'cardFeePayer', a.card_fee_payer,
    'surchargePct', a.surcharge_pct, 'cardCostPct', a.card_cost_pct, 'cardCostFixedCents', a.card_cost_fixed_cents,
    'surchargeNoticeDate', a.surcharge_notice_date, 'surchargeAttested', a.surcharge_attested_at is not null);
end $$;
revoke execute on function public.fin_payment_account_settings(uuid, jsonb) from public, anon;
grant execute on function public.fin_payment_account_settings(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
