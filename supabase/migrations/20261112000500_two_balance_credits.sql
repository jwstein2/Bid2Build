-- Two-balance free credits (replaces "3 free exports per calendar month").
--
--  * Starter credits: 3 per verified account, granted once, never expire, never replenish.
--  * Monthly credit: from the account's second monthly cycle on, 1 free credit per cycle.
--    Max balance 1, never rolls over, expires when its cycle ends.
--  * Cycles are anchored on the signup timestamp (UTC). Cycle n starts at signup + n months, using
--    Postgres month arithmetic: a signup on Jan 31 gives cycle starts Feb 28/29, Mar 31, Apr 30, ...
--    Each start is computed from the anchor (never from the previous start), so month-end dates
--    never drift.
--  * One credit per bid (estimate), charged when its FIRST finalized version is created.
--    Editing, re-finalizing, reopening or re-downloading a bid that already has a version is free.
--  * Monthly credit is always spent before a starter credit.
--
-- Non-destructive: only adds tables and functions. record_export() and quota_status() are left in
-- place so the currently deployed app keeps working until the new code ships; a later migration
-- can drop them.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Signup time. Monthly cycles start on its monthly anniversaries (UTC).
  cycle_anchor timestamptz not null,
  starter_balance integer not null default 0 check (starter_balance between 0 and 3),
  -- Set once when the starter grant has been decided (granted, or refused as a repeat signup).
  starter_granted_at timestamptz,
  -- Index of the cycle whose monthly credit has been spent (null = never spent).
  monthly_used_cycle integer check (monthly_used_cycle >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger credit_accounts_updated before update on public.credit_accounts for each row execute function public.set_updated_at();

-- One-way hashes of emails that have already received starter credits. Deliberately NOT linked to
-- auth.users, so deleting an account and signing up again with the same email does not grant a
-- second starter bonus.
create table public.starter_credit_claims (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default now()
);

-- Append-only record of every grant and spend.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('starter_grant', 'starter_spend', 'monthly_spend', 'unlimited_bid')),
  amount integer not null,
  estimate_id uuid references public.estimates (id) on delete set null,
  version_id uuid references public.estimate_versions (id) on delete set null,
  cycle_index integer,
  note text,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
-- Hard guarantees, independent of the function logic:
create unique index credit_ledger_one_starter_grant on public.credit_ledger (user_id) where kind = 'starter_grant';
create unique index credit_ledger_one_charge_per_bid on public.credit_ledger (estimate_id)
  where kind in ('starter_spend', 'monthly_spend', 'unlimited_bid');
create unique index credit_ledger_one_monthly_per_cycle on public.credit_ledger (user_id, cycle_index) where kind = 'monthly_spend';

alter table public.credit_accounts enable row level security;
alter table public.starter_credit_claims enable row level security;
alter table public.credit_ledger enable row level security;
create policy credit_accounts_own_select on public.credit_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy credit_ledger_own_select on public.credit_ledger for select to authenticated using (user_id = (select auth.uid()));
-- starter_credit_claims: no policies => service role only.

-- Supabase grants table privileges to anon/authenticated by default; reset them.
revoke all on public.credit_accounts, public.starter_credit_claims, public.credit_ledger from anon, authenticated;
grant select on public.credit_accounts, public.credit_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- Cycle math
-- ---------------------------------------------------------------------------
create or replace function public.starter_credit_amount() returns integer
language sql immutable set search_path = public as $$ select 3 $$;

-- Start of cycle n for an anchor (n = 0 is the signup cycle).
create or replace function public.credit_cycle_start(p_anchor timestamptz, p_cycle integer) returns timestamptz
language sql immutable set search_path = public as $$
  select ((p_anchor at time zone 'utc') + make_interval(months => p_cycle)) at time zone 'utc'
$$;

-- Index of the cycle containing p_at: the largest n with credit_cycle_start(anchor, n) <= p_at.
create or replace function public.credit_cycle_index(p_anchor timestamptz, p_at timestamptz default now()) returns integer
language plpgsql immutable set search_path = public as $$
declare
  a timestamp := p_anchor at time zone 'utc';
  t timestamp := p_at at time zone 'utc';
  n integer;
begin
  if t <= a then return 0; end if;
  n := (extract(year from t)::integer - extract(year from a)::integer) * 12
     + (extract(month from t)::integer - extract(month from a)::integer);
  if a + make_interval(months => n) > t then n := n - 1; end if;
  return greatest(n, 0);
end $$;

-- ---------------------------------------------------------------------------
-- ensure_credit_account: create the account row and, once the email is verified, decide the
-- starter grant exactly once. Safe to call repeatedly and concurrently.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_credit_account(p_user_id uuid) returns public.credit_accounts
language plpgsql security definer set search_path = public as $$
declare
  v_acct public.credit_accounts;
  v_email text;
  v_verified boolean;
  v_created timestamptz;
  v_hash text;
  v_claimed integer;
begin
  select u.email, u.email_confirmed_at is not null, u.created_at into v_email, v_verified, v_created
    from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.credit_accounts (user_id, cycle_anchor) values (p_user_id, coalesce(v_created, now()))
    on conflict (user_id) do nothing;
  select * into v_acct from public.credit_accounts where user_id = p_user_id;

  if v_acct.starter_granted_at is null and v_verified then
    select * into v_acct from public.credit_accounts where user_id = p_user_id for update;
    if v_acct.starter_granted_at is null then
      v_claimed := 0;
      if v_email is not null and v_email <> '' then
        v_hash := encode(sha256(convert_to(lower(trim(v_email)), 'UTF8')), 'hex');
        insert into public.starter_credit_claims (email_hash) values (v_hash) on conflict do nothing;
        get diagnostics v_claimed = row_count;
      end if;
      if v_claimed > 0 then
        insert into public.credit_ledger (user_id, kind, amount, note) values (p_user_id, 'starter_grant', public.starter_credit_amount(), 'signup');
        update public.credit_accounts set starter_balance = public.starter_credit_amount(), starter_granted_at = now()
          where user_id = p_user_id returning * into v_acct;
      else
        insert into public.credit_ledger (user_id, kind, amount, note) values (p_user_id, 'starter_grant', 0, 'email_already_claimed');
        update public.credit_accounts set starter_granted_at = now() where user_id = p_user_id returning * into v_acct;
      end if;
    end if;
  end if;
  return v_acct;
end $$;

-- ---------------------------------------------------------------------------
-- credit_status: balances for the signed-in user (safe to call from the browser).
--   next_cycle_at = when the current monthly credit expires AND when the next one arrives.
-- ---------------------------------------------------------------------------
create or replace function public.credit_status()
returns table (
  starter_balance integer, starter_total integer, monthly_balance integer, monthly_eligible boolean,
  cycle_index integer, next_cycle_at timestamptz, unlimited boolean, email_verified boolean, starter_granted boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_acct public.credit_accounts;
  v_idx integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_acct := public.ensure_credit_account(v_uid);
  v_idx := public.credit_cycle_index(v_acct.cycle_anchor, now());
  return query select
    v_acct.starter_balance,
    public.starter_credit_amount(),
    case when v_idx >= 1 and v_acct.monthly_used_cycle is distinct from v_idx then 1 else 0 end,
    v_idx >= 1,
    v_idx,
    public.credit_cycle_start(v_acct.cycle_anchor, v_idx + 1),
    public.has_unlimited(v_uid),
    exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null),
    v_acct.starter_granted_at is not null;
end $$;

-- ---------------------------------------------------------------------------
-- finalize_bid: the ONLY way a finalized version is created (replaces record_export).
-- Called by the server (service role) after it authenticated the user and rendered the PDF, so a
-- failed render never reaches this point. Everything below runs in one transaction: if any step
-- fails, no credit is spent and no version exists.
--  * The user's credit_accounts row is locked FOR UPDATE, so concurrent requests serialize.
--  * Same content hash for the same estimate -> returns the existing version (re-download).
--  * Estimate already has a version (or a charge) -> new version, no credit (edit/reopen).
--  * Otherwise: unlimited -> free; else monthly credit; else starter credit; else credits_exhausted.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_bid(
  p_user_id uuid,
  p_estimate_id uuid,
  p_content_hash text,
  p_snapshot jsonb,
  p_proposal jsonb,
  p_total_cost numeric,
  p_subtotal numeric,
  p_tax numeric,
  p_total numeric
)
returns table (
  version_id uuid, version_number integer, new_version boolean, charged boolean, credit_source text,
  starter_balance integer, monthly_balance integer, unlimited boolean, next_cycle_at timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_acct public.credit_accounts;
  v_idx integer;
  v_unlimited boolean;
  v_monthly integer;
  v_existing record;
  v_source text;
  v_charged boolean := false;
  v_version_id uuid;
  v_version_number integer;
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified' using errcode = 'P0001', hint = 'verify_email';
  end if;
  if not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = p_user_id) then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;

  perform public.ensure_credit_account(p_user_id);
  select * into v_acct from public.credit_accounts a where a.user_id = p_user_id for update;
  v_idx := public.credit_cycle_index(v_acct.cycle_anchor, now());
  v_unlimited := public.has_unlimited(p_user_id);
  v_monthly := case when v_idx >= 1 and v_acct.monthly_used_cycle is distinct from v_idx then 1 else 0 end;

  -- Re-download of an identical version: nothing to do.
  select v.id, v.version_number into v_existing from public.estimate_versions v
    where v.estimate_id = p_estimate_id and v.content_hash = p_content_hash;
  if found then
    return query select v_existing.id, v_existing.version_number, false, false, 'existing_version'::text,
      v_acct.starter_balance, v_monthly, v_unlimited, public.credit_cycle_start(v_acct.cycle_anchor, v_idx + 1);
    return;
  end if;

  if exists (select 1 from public.estimate_versions v where v.estimate_id = p_estimate_id)
     or exists (select 1 from public.credit_ledger l where l.estimate_id = p_estimate_id
                and l.kind in ('starter_spend', 'monthly_spend', 'unlimited_bid')) then
    v_source := 'already_counted';
  elsif v_unlimited then
    v_source := 'unlimited';
  elsif v_monthly = 1 then
    v_source := 'monthly';
    v_charged := true;
    update public.credit_accounts set monthly_used_cycle = v_idx where user_id = p_user_id;
    v_monthly := 0;
  elsif v_acct.starter_balance > 0 then
    v_source := 'starter';
    v_charged := true;
    update public.credit_accounts set starter_balance = starter_balance - 1 where user_id = p_user_id
      returning * into v_acct;
  else
    raise exception 'credits_exhausted' using errcode = 'P0001', hint = 'upgrade';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
    from public.estimate_versions v where v.estimate_id = p_estimate_id;

  insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
    values (p_estimate_id, p_user_id, v_version_number, p_content_hash, p_snapshot, p_proposal, p_total_cost, p_subtotal, p_tax, p_total)
    returning id into v_version_id;

  if v_source in ('monthly', 'starter', 'unlimited') then
    insert into public.credit_ledger (user_id, kind, amount, estimate_id, version_id, cycle_index)
      values (p_user_id,
              case v_source when 'monthly' then 'monthly_spend' when 'starter' then 'starter_spend' else 'unlimited_bid' end,
              case when v_charged then -1 else 0 end,
              p_estimate_id, v_version_id, case when v_source = 'monthly' then v_idx end);
  end if;

  -- Keep the admin export metrics working.
  insert into public.usage_events (user_id, version_id, period_start, counted_against_quota)
    values (p_user_id, v_version_id, public.quota_period_start(), v_charged);

  update public.estimates set status = 'finalized' where id = p_estimate_id and status = 'draft';

  return query select v_version_id, v_version_number, true, v_charged, v_source,
    v_acct.starter_balance, v_monthly, v_unlimited, public.credit_cycle_start(v_acct.cycle_anchor, v_idx + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: only credit_status is callable by signed-in users.
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_credit_account(uuid) from public, anon, authenticated;
revoke all on function public.finalize_bid(uuid, uuid, text, jsonb, jsonb, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.credit_status() from public, anon;
grant execute on function public.credit_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing accounts. Idempotent: the starter grant is decided once per account
-- (credit_accounts.starter_granted_at + the unique ledger index) and once per email
-- (starter_credit_claims). Existing finalized bids already have versions, so editing or
-- re-downloading them stays free. Unverified accounts get their grant when they verify.
-- ---------------------------------------------------------------------------
select public.ensure_credit_account(u.id) from auth.users u;
