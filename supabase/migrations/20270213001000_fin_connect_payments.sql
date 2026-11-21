-- Online invoice payments through Stripe Connect (2026-11-21).
--
-- Each contractor book gets its OWN Stripe account (a Standard-style connected account: the contractor is the
-- merchant of record, Stripe handles risk and losses, the contractor pays Stripe's fees). Customers pay an issued
-- invoice from a secure link; the charge is a DIRECT charge on the contractor's account, so customer money never
-- passes through Built2Bid's own Stripe balance. Built2Bid takes no fee (James, 2026-11-21).
--
-- Nothing here moves money by itself. Rows are written by the server (service role) after a signature-verified
-- Stripe webhook, or by the contractor through owner-only RPCs. Re-runnable.

-- 1. The contractor's payment account ------------------------------------------------------------------------
create table if not exists public.fin_payment_accounts (
  book_id            uuid primary key references public.fin_books (id) on delete restrict,
  provider           text not null default 'stripe' check (provider in ('stripe')),
  stripe_account_id  text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode           boolean not null,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  requirements_due   jsonb not null default '[]' check (jsonb_typeof(requirements_due) = 'array'),
  disabled_reason    text check (char_length(disabled_reason) <= 200),
  card_enabled       boolean not null default true,
  ach_enabled        boolean not null default true,
  -- Who pays the card processing fee. 'customer' (a disclosed credit-card surcharge) stays unavailable until counsel
  -- approves the surcharge rules (credit only, capped, banned states, disclosure); the server refuses it until then.
  card_fee_payer     text not null default 'contractor' check (card_fee_payer in ('contractor', 'customer')),
  status_synced_at   timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fin_payment_accounts_method check (card_enabled or ach_enabled)
);
drop trigger if exists fin_payment_accounts_updated on public.fin_payment_accounts;
create trigger fin_payment_accounts_updated before update on public.fin_payment_accounts for each row execute function public.set_updated_at();
alter table public.fin_payment_accounts enable row level security;
-- No client policies: the server reads it after checking Financials permissions.

-- 2. Secure pay links (one per invoice; only a hash of the token is stored) -----------------------------------------
create table if not exists public.fin_invoice_pay_links (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  invoice_id  uuid not null references public.fin_invoices (id) on delete restrict,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users (id) on delete set null,
  last_viewed_at timestamptz
);
create unique index if not exists fin_invoice_pay_links_active on public.fin_invoice_pay_links (invoice_id) where revoked_at is null;
alter table public.fin_invoice_pay_links enable row level security;

-- 3. Online payment attempts (one per Stripe Checkout session) --------------------------------------------------------
create table if not exists public.fin_online_payments (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.fin_books (id) on delete restrict,
  invoice_id          uuid not null references public.fin_invoices (id) on delete restrict,
  stripe_account_id   text not null,
  checkout_session_id text not null unique,
  payment_intent_id   text unique,
  livemode            boolean not null,
  method              text check (method in ('card', 'ach')),
  amount              numeric(14, 2) not null check (amount > 0),
  status              text not null default 'open'
                      check (status in ('open', 'processing', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded', 'disputed')),
  failure_reason      text check (char_length(failure_reason) <= 300),
  refunded_amount     numeric(14, 2) not null default 0 check (refunded_amount >= 0),
  payment_id          uuid references public.fin_payments (id) on delete restrict,   -- the recorded payment, once settled
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  settled_at          timestamptz
);
create index if not exists fin_online_payments_invoice_idx on public.fin_online_payments (invoice_id, status);
create index if not exists fin_online_payments_book_idx on public.fin_online_payments (book_id, created_at desc);
drop trigger if exists fin_online_payments_updated on public.fin_online_payments;
create trigger fin_online_payments_updated before update on public.fin_online_payments for each row execute function public.set_updated_at();
alter table public.fin_online_payments enable row level security;

-- 4. Payments can now come from the processor -------------------------------------------------------------------
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.fin_payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%manual%';
  if c is not null then execute format('alter table public.fin_payments drop constraint %I', c); end if;
  alter table public.fin_payments add constraint fin_payments_source_check check (source in ('manual', 'stripe'));
exception when duplicate_object then null; end $$;

-- 5. Settle a successful online payment (service role only; called from the verified Connect webhook) ---------------------
-- Records a verified payment (method card/ach, reference = PaymentIntent) and applies it to the invoice up to the
-- invoice's open balance. Anything over the balance stays unapplied (a customer credit the contractor can refund).
-- Idempotent on the checkout session.
create or replace function public.fin_online_payment_settle(p_checkout_session_id text, p_payment_intent_id text, p_method text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare op public.fin_online_payments; inv public.fin_invoices; n record; pay public.fin_payments; v_open numeric; v_apply numeric;
begin
  select * into op from public.fin_online_payments where checkout_session_id = p_checkout_session_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if op.payment_id is not null then
    return jsonb_build_object('paymentId', op.payment_id, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if p_method not in ('card', 'ach') then raise exception 'bad_method' using errcode = '22023'; end if;
  select * into inv from public.fin_invoices where id = op.invoice_id for update;
  select * into n from public.fin_next_number(op.book_id, 'payment');
  insert into public.fin_payments (book_id, customer_id, job_id, seq, number, received_on, method, reference, amount, memo, source, verified, verified_at)
  values (op.book_id, inv.customer_id, inv.job_id, n.seq, n.label, current_date, p_method, left(p_payment_intent_id, 120), p_amount,
          'Paid online' || coalesce(' for invoice ' || inv.number, ''), 'stripe', true, now())
  returning * into pay;
  v_open := case when inv.status = 'issued' then inv.total - public.fin_invoice_applied(inv.id) else 0 end;
  v_apply := least(v_open, p_amount);
  if v_apply > 0 then
    insert into public.fin_payment_allocations (book_id, payment_id, invoice_id, amount) values (op.book_id, pay.id, inv.id, v_apply);
  end if;
  update public.fin_online_payments
     set status = 'succeeded', payment_id = pay.id, payment_intent_id = coalesce(p_payment_intent_id, payment_intent_id),
         method = p_method, settled_at = now(), failure_reason = null
   where id = op.id;
  perform public.fin_audit(op.book_id, 'payment.online_received', 'payment', pay.id,
    jsonb_build_object('number', pay.number, 'amount', pay.amount::text, 'method', p_method, 'invoiceId', inv.id, 'applied', v_apply::text,
                       'checkoutSession', p_checkout_session_id));
  return jsonb_build_object('paymentId', pay.id, 'number', pay.number, 'applied', v_apply::text);
end $$;
revoke execute on function public.fin_online_payment_settle(text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.fin_online_payment_settle(text, text, text, numeric) to service_role;

-- 6. Contractor settings (owner / Financials config permission) ------------------------------------------------------
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
    card_fee_payer = coalesce(nullif(p ->> 'cardFeePayer', ''), card_fee_payer)
  where book_id = p_book_id returning * into a;
  perform public.fin_audit(p_book_id, 'payments.settings', 'book', p_book_id,
    jsonb_build_object('cardEnabled', a.card_enabled, 'achEnabled', a.ach_enabled, 'cardFeePayer', a.card_fee_payer));
  return jsonb_build_object('cardEnabled', a.card_enabled, 'achEnabled', a.ach_enabled, 'cardFeePayer', a.card_fee_payer);
end $$;
revoke execute on function public.fin_payment_account_settings(uuid, jsonb) from public, anon;
grant execute on function public.fin_payment_account_settings(uuid, jsonb) to authenticated;
