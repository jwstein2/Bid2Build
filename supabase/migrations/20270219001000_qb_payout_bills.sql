-- QuickBooks payouts (admin side): pay sales-rep commission statements and affiliate commissions through
-- Built2Bid's own QuickBooks Online company.
--
--   * One platform QuickBooks connection (Built2Bid's books), separate from the customer hours-sync connections.
--     Tokens are encrypted by the server (BANK_TOKEN_KEY) and only the service role can read this table.
--   * Each rep / affiliate becomes a 1099 vendor in QuickBooks (qb_payee_vendors keeps the match).
--   * Each approved statement / payable commission becomes one QuickBooks bill (qb_payout_bills). The owner pays the
--     bills in QuickBooks (Bill Pay). When QuickBooks shows a bill paid, qb_payout_bill_paid marks the statement or
--     commission paid, exactly like a settled automatic payout.
--
-- Duplicate-payment guards:
--   * one open or paid bill per statement / commission (unique index);
--   * a statement or commission already in an active LIVE automatic payout is never offered, and bills can't be
--     created while automatic payouts are live (qb_payout_candidates / qb_payout_bill_reserve refuse).
-- Compliance: the same prerequisites as automatic payouts (classification reviewed, not W-2, agreements, W-9), except
-- the bank-account checks, because QuickBooks pays from the owner's own bank. W-2 pay always goes through payroll.

create table if not exists public.qb_platform_connection (
  id                 boolean primary key default true check (id),
  realm_id           text not null check (realm_id ~ '^\d{1,32}$'),
  company_name       text check (char_length(company_name) <= 200),
  environment        text not null check (environment in ('sandbox', 'production')),
  status             text not null default 'active' check (status in ('active', 'needs_reauth')),
  expense_account_id   text check (expense_account_id ~ '^\d{1,32}$'),
  expense_account_name text check (char_length(expense_account_name) <= 200),
  access_ciphertext  text not null,
  refresh_ciphertext text not null,
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz,
  connected_by       uuid references auth.users (id) on delete set null,
  connected_at       timestamptz not null default now(),
  last_check_at      timestamptz,
  last_error         text check (char_length(last_error) <= 300),
  updated_at         timestamptz not null default now()
);

create table if not exists public.qb_payee_vendors (
  payee_kind   text not null check (payee_kind in ('sales_rep', 'affiliate')),
  payee_id     uuid not null,
  realm_id     text not null check (realm_id ~ '^\d{1,32}$'),
  qb_vendor_id text not null check (qb_vendor_id ~ '^\d{1,32}$'),
  qb_name      text check (char_length(qb_name) <= 200),
  created_at   timestamptz not null default now(),
  primary key (payee_kind, payee_id, realm_id)
);

create table if not exists public.qb_payout_bills (
  id            uuid primary key default gen_random_uuid(),
  source_kind   text not null check (source_kind in ('sales_statement', 'affiliate_commission')),
  source_id     uuid not null,
  payee_kind    text not null check (payee_kind in ('sales_rep', 'affiliate')),
  payee_id      uuid not null,
  payee_name    text check (char_length(payee_name) <= 200),
  realm_id      text not null check (realm_id ~ '^\d{1,32}$'),
  environment   text not null check (environment in ('sandbox', 'production')),
  amount_cents  integer not null check (amount_cents > 0),
  doc_number    text not null check (char_length(doc_number) between 1 and 21),
  description   text check (char_length(description) <= 300),
  status        text not null default 'sending' check (status in ('sending', 'open', 'paid', 'voided', 'failed')),
  qb_bill_id    text check (qb_bill_id ~ '^\d{1,32}$'),
  error         text check (char_length(error) <= 300),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  paid_at       timestamptz,
  last_check_at timestamptz,
  updated_at    timestamptz not null default now()
);
-- One live bill per statement / commission. A voided or failed bill releases it to be billed again.
-- Per QuickBooks environment, so sandbox practice bills never block the real ones.
create unique index if not exists qb_payout_bills_once on public.qb_payout_bills (source_kind, source_id, environment) where status in ('sending', 'open', 'paid');
create index if not exists qb_payout_bills_status on public.qb_payout_bills (status, created_at desc);

alter table public.qb_platform_connection enable row level security;
alter table public.qb_payee_vendors enable row level security;
alter table public.qb_payout_bills enable row level security;
revoke all on public.qb_platform_connection, public.qb_payee_vendors, public.qb_payout_bills from public, anon, authenticated;

-- Compliance blockers for paying through QuickBooks: the automatic-payout blockers minus the bank checks.
create or replace function public.qb_payee_blockers(p_kind text, p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v text[]; sid uuid;
begin
  if p_kind = 'sales_rep' then
    select id into sid from public.staff_members where sales_rep_id = p_id;
    if sid is null then return array['no_staff_record']; end if;
    v := public.payout_blockers(sid, 'live');
  else
    v := public.affiliate_payout_blockers(p_id, 'live');
  end if;
  return coalesce((select array_agg(x) from unnest(v) x where x not in ('no_bank', 'bank_unverified', 'bank_change_hold', 'pays_by_check', 'affiliate_payouts_off')), '{}');
end $$;

-- What can be billed now: approved, unpaid sales statements and payable affiliate commissions, with payee details.
create or replace function public.qb_payout_candidates(p_env text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_live boolean;
begin
  select coalesce(mode = 'live', false) into v_live from public.payout_settings where id;
  return jsonb_build_object(
    'automation_live', coalesce(v_live, false),
    'items', coalesce((
      select jsonb_agg(x order by x->>'payee_name', x->>'period') from (
        select jsonb_build_object(
          'source_kind', 'sales_statement', 'source_id', st.id, 'payee_kind', 'sales_rep', 'payee_id', r.id,
          'payee_name', coalesce(nullif(btrim(concat_ws(' ', sm.legal_first_name, sm.legal_last_name)), ''), r.full_name),
          'given_name', sm.legal_first_name, 'family_name', sm.legal_last_name, 'email', coalesce(sm.email, r.email), 'phone', coalesce(sm.phone, r.phone),
          'line1', sm.address_line1, 'line2', sm.address_line2, 'city', sm.city, 'state', sm.state, 'postal_code', sm.postal_code,
          'amount_cents', st.total_cents, 'period', to_char(st.period_month, 'YYYY-MM'),
          'description', 'Sales commission statement ' || to_char(st.period_month, 'Mon YYYY'),
          'blockers', to_jsonb(public.qb_payee_blockers('sales_rep', r.id))) as x
        from public.sales_statements st
        join public.sales_reps r on r.id = st.rep_id
        left join public.staff_members sm on sm.sales_rep_id = r.id
        where st.status = 'approved' and st.total_cents > 0
          and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
          and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
          and not exists (select 1 from public.qb_payout_bills b where b.source_kind = 'sales_statement' and b.source_id = st.id and b.environment = p_env and b.status in ('sending', 'open', 'paid'))
        union all
        select jsonb_build_object(
          'source_kind', 'affiliate_commission', 'source_id', c.id, 'payee_kind', 'affiliate', 'payee_id', a.id,
          'payee_name', coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.legal_name), ''), nullif(btrim(a.display_name), ''), a.email),
          'given_name', null, 'family_name', null, 'email', a.email, 'phone', a.phone,
          'line1', a.address_line1, 'line2', a.address_line2, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
          'amount_cents', c.amount_cents, 'period', to_char(c.anniversary_date, 'YYYY-MM'),
          'description', 'Affiliate commission, year ' || c.year_no || ' (' || to_char(c.anniversary_date, 'Mon YYYY') || ')',
          'blockers', to_jsonb(public.qb_payee_blockers('affiliate', a.id))) as x
        from public.affiliate_commissions c
        join public.affiliates a on a.id = c.affiliate_id
        where c.status = 'payable' and c.amount_cents > 0 and c.payout_id is null
          and (c.hold_until is null or c.hold_until <= now())
          and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
          and not exists (select 1 from public.qb_payout_bills b where b.source_kind = 'affiliate_commission' and b.source_id = c.id and b.environment = p_env and b.status in ('sending', 'open', 'paid'))
      ) q), '[]'::jsonb));
end $$;

-- Reserves a bill row before QuickBooks is called (the row id is the QuickBooks requestid, so a retry can't create a
-- second bill). Re-checks every guard under a row lock. Returns the new bill id.
create or replace function public.qb_payout_bill_reserve(p_caller uuid, p_source_kind text, p_source_id uuid, p_realm text, p_env text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_amount integer; v_payee uuid; v_pkind text; v_name text; v_desc text; v_doc text; v_block text[]; v_live boolean;
begin
  perform public.staff_require_owner(p_caller);
  if p_env not in ('sandbox', 'production') then raise exception 'invalid_env'; end if;
  select coalesce(mode = 'live', false) into v_live from public.payout_settings where id;
  if coalesce(v_live, false) then raise exception 'automation_live'; end if;
  perform pg_advisory_xact_lock(hashtext('qb_bill:' || p_source_kind || ':' || p_source_id));
  if p_source_kind = 'sales_statement' then
    select st.total_cents, r.id, coalesce(nullif(btrim(concat_ws(' ', sm.legal_first_name, sm.legal_last_name)), ''), r.full_name),
           'Sales commission statement ' || to_char(st.period_month, 'Mon YYYY'), 'B2B-S' || to_char(st.period_month, 'YYMM') || '-' || upper(left(replace(st.id::text, '-', ''), 8))
      into v_amount, v_payee, v_name, v_desc, v_doc
    from public.sales_statements st join public.sales_reps r on r.id = st.rep_id left join public.staff_members sm on sm.sales_rep_id = r.id
    where st.id = p_source_id and st.status = 'approved' and st.total_cents > 0
      and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
      and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
    for update of st;
    v_pkind := 'sales_rep';
  elsif p_source_kind = 'affiliate_commission' then
    select c.amount_cents, a.id, coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.legal_name), ''), nullif(btrim(a.display_name), ''), a.email),
           'Affiliate commission, year ' || c.year_no || ' (' || to_char(c.anniversary_date, 'Mon YYYY') || ')',
           'B2B-A' || to_char(c.anniversary_date, 'YYMM') || '-' || upper(left(replace(c.id::text, '-', ''), 8))
      into v_amount, v_payee, v_name, v_desc, v_doc
    from public.affiliate_commissions c join public.affiliates a on a.id = c.affiliate_id
    where c.id = p_source_id and c.status = 'payable' and c.amount_cents > 0 and c.payout_id is null and (c.hold_until is null or c.hold_until <= now())
      and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
    for update of c;
    v_pkind := 'affiliate';
  else
    raise exception 'invalid_source';
  end if;
  if v_payee is null then raise exception 'not_payable'; end if;
  v_block := public.qb_payee_blockers(v_pkind, v_payee);
  if cardinality(v_block) > 0 then raise exception 'blocked:%', array_to_string(v_block, ','); end if;
  insert into public.qb_payout_bills (source_kind, source_id, payee_kind, payee_id, payee_name, realm_id, environment, amount_cents, doc_number, description, created_by)
  values (p_source_kind, p_source_id, v_pkind, v_payee, left(v_name, 200), p_realm, p_env, v_amount, v_doc, v_desc, p_caller)
  returning id into v_id;
  perform public.staff_audit(p_caller, 'qb_payout.bill_reserved', p_source_kind, p_source_id::text, jsonb_build_object('bill', v_id, 'amount_cents', v_amount));
  return v_id;
exception when unique_violation then raise exception 'already_billed';
end $$;

-- QuickBooks shows the bill paid: mark the statement / commission paid (same records as a settled automatic payout).
create or replace function public.qb_payout_bill_paid(p_bill uuid, p_paid_at timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare b public.qb_payout_bills; st public.sales_statements;
begin
  select * into b from public.qb_payout_bills where id = p_bill for update;
  if not found or b.status <> 'open' then return 'skipped'; end if;
  if b.environment = 'production' then
    if b.source_kind = 'sales_statement' then
      select * into st from public.sales_statements where id = b.source_id for update;
      if found and st.status = 'approved' then
        insert into public.sales_payouts (rep_id, statement_id, amount_cents, method, reference, paid_on, recorded_by)
        values (st.rep_id, st.id, b.amount_cents, 'other', 'QuickBooks bill ' || b.doc_number, (p_paid_at at time zone 'America/Chicago')::date, b.created_by)
        on conflict (statement_id) do nothing;
        update public.sales_commissions set status = 'paid', paid_at = p_paid_at, updated_at = now() where statement_id = st.id and status = 'approved';
        update public.sales_statements set status = 'paid', paid_at = p_paid_at where id = st.id;
      end if;
    else
      update public.affiliate_commissions set status = 'paid', paid_at = p_paid_at where id = b.source_id and status = 'payable';
    end if;
  end if;
  -- Sandbox bills are practice: the bill is marked paid but the real statement / commission stays unpaid.
  update public.qb_payout_bills set status = 'paid', paid_at = p_paid_at, last_check_at = now(), updated_at = now() where id = b.id;
  perform public.staff_audit(b.created_by, 'qb_payout.bill_paid', b.source_kind, b.source_id::text, jsonb_build_object('bill', b.id, 'doc', b.doc_number, 'environment', b.environment));
  return 'paid';
end $$;

revoke execute on function public.qb_payee_blockers(text, uuid) from public, anon, authenticated;
revoke execute on function public.qb_payout_candidates(text) from public, anon, authenticated;
revoke execute on function public.qb_payout_bill_reserve(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.qb_payout_bill_paid(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.qb_payee_blockers(text, uuid), public.qb_payout_candidates(text), public.qb_payout_bill_reserve(uuid, text, uuid, text, text),
  public.qb_payout_bill_paid(uuid, timestamptz) to service_role;
