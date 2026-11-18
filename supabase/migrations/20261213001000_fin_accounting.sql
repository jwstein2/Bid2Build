-- V6.3 Accountant Mode: bank statements, reconciliation, classification, exports log, audit trail viewer.
--
-- Same records as Contractor Mode: nothing here duplicates invoices, payments, bills or expenses, and there is
-- still no general ledger (that waits for the Phase 2 ledger + CPA review). What this adds:
--
--   1. Bank accounts + bank statement imports (CSV/OFX rows parsed in the app). Bank lines are AUTHORITATIVE
--      bank-source events: append-only, never edited or deleted, not even by an owner. Importing the same
--      statement twice skips lines already there (fingerprint per account). There is NO bank connection and
--      no money movement of any kind: an account is a name, a type and the last 4 digits.
--   2. Matching: a bank line is matched to a customer payment, refund, bill payment or expense of the same
--      amount (or excluded with a reason, e.g. a transfer between your own accounts or a duplicate line).
--      Matches can be undone with a reason unless the line falls in a confirmed reconciliation period.
--      Nothing is matched automatically: the app suggests, a person confirms.
--   3. Reconciliation periods: confirm an account through a statement date. The bank-side balance through
--      that date (opening balance + imported lines) is compared with the statement ending balance, and every
--      line in the period must be matched or excluded; differences can only be confirmed with a written note.
--      The latest period can be reopened with a reason (audited).
--   4. Classification: fin_cost_fill now also fills a missing project, vendor or scope section once (the
--      cost code already worked that way). Changing a classification that is already set stays a correction
--      (void + re-record), so history is never rewritten.
--   5. fin_export_log(): every CSV/PDF export is authorized here (export_financials) and audited.
--   6. fin_audit_list(): the audit trail with actor names, filters, and sensitive keys redacted.
--
-- Access: reads need "view company financials"; bank writes and reconciliation need "reconcile" with an active
-- add-on (read-only books can still read and export). Safe to run more than once. Requires 20261124001000 ..
-- 20261211001000. Rollback: docs/financials/rollback_20261213001000.sql

-- 1. Bank accounts --------------------------------------------------------------------------------------------
create table if not exists public.fin_bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  kind            text not null default 'checking' check (kind in ('checking', 'savings', 'credit_card', 'other')),
  last4           text check (last4 ~ '^[0-9]{4}$'),
  opening_balance numeric(14, 2) not null default 0,
  opening_date    date not null,
  source          text not null default 'statement_import' check (source in ('statement_import')),   -- provider feeds come later
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (book_id, id)
);
create index if not exists fin_bank_accounts_book_idx on public.fin_bank_accounts (book_id);

create table if not exists public.fin_bank_imports (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.fin_books (id) on delete restrict,
  account_id        uuid not null references public.fin_bank_accounts (id) on delete restrict,
  file_name         text not null check (char_length(file_name) between 1 and 200),
  file_hash         text not null check (file_hash ~ '^[0-9a-f]{16,128}$'),
  statement_start   date,
  statement_end     date,
  opening_balance   numeric(14, 2),
  ending_balance    numeric(14, 2),
  row_count         integer not null check (row_count between 0 and 5000),
  inserted_count    integer not null,
  skipped_count     integer not null,
  total_in          numeric(14, 2) not null,
  total_out         numeric(14, 2) not null,
  balanced          boolean,                 -- null when the statement balances weren't given
  imported_by       uuid references auth.users (id) on delete set null,
  imported_at       timestamptz not null default now(),
  constraint fin_bank_imports_dates check (statement_end is null or statement_start is null or statement_end >= statement_start)
);
create index if not exists fin_bank_imports_account_idx on public.fin_bank_imports (account_id, imported_at desc);

create table if not exists public.fin_bank_transactions (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  account_id   uuid not null references public.fin_bank_accounts (id) on delete restrict,
  import_id    uuid not null references public.fin_bank_imports (id) on delete restrict,
  posted_on    date not null,
  description  text not null check (char_length(description) between 1 and 300),
  amount       numeric(14, 2) not null check (amount <> 0),      -- + money in, - money out
  check_number text check (char_length(check_number) <= 20),
  bank_ref     text check (char_length(bank_ref) <= 80),
  fingerprint  text not null check (char_length(fingerprint) = 32),
  created_at   timestamptz not null default now(),
  unique (account_id, fingerprint)
);
create index if not exists fin_bank_txn_account_idx on public.fin_bank_transactions (account_id, posted_on);
create index if not exists fin_bank_txn_book_idx on public.fin_bank_transactions (book_id, posted_on desc);

-- Bank-source events and import batches never change and are never deleted (not even by a purge: a book with
-- bank lines has records, so fin_purge_empty_book refuses it).
drop trigger if exists fin_bank_transactions_immutable on public.fin_bank_transactions;
create trigger fin_bank_transactions_immutable before update or delete on public.fin_bank_transactions
  for each row execute function public.fin_guard_immutable();
drop trigger if exists fin_bank_imports_immutable on public.fin_bank_imports;
create trigger fin_bank_imports_immutable before update or delete on public.fin_bank_imports
  for each row execute function public.fin_guard_immutable();

-- 2. Matches --------------------------------------------------------------------------------------------------
create table if not exists public.fin_bank_matches (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  bank_txn_id  uuid not null references public.fin_bank_transactions (id) on delete restrict,
  target_type  text not null check (target_type in ('payment', 'refund', 'bill_payment', 'expense', 'excluded')),
  target_id    uuid,
  exclude_reason text check (exclude_reason in ('transfer', 'duplicate', 'owner', 'not_business', 'other')),
  note         text check (char_length(note) <= 500),
  status       text not null default 'active' check (status in ('active', 'undone')),
  matched_by   uuid references auth.users (id) on delete set null,
  matched_at   timestamptz not null default now(),
  undone_by    uuid references auth.users (id) on delete set null,
  undone_at    timestamptz,
  undo_reason  text check (char_length(undo_reason) <= 500),
  constraint fin_bank_matches_target check ((target_type = 'excluded') = (target_id is null) and (target_type = 'excluded') = (exclude_reason is not null)),
  constraint fin_bank_matches_undo check ((status = 'undone') = (undone_at is not null))
);
create unique index if not exists fin_bank_matches_one_per_line on public.fin_bank_matches (bank_txn_id) where status = 'active';
create unique index if not exists fin_bank_matches_one_per_record on public.fin_bank_matches (target_type, target_id) where status = 'active' and target_id is not null;
create index if not exists fin_bank_matches_book_idx on public.fin_bank_matches (book_id, status);

-- Only the undo fields may change, once.
create or replace function public.fin_bank_matches_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.status <> 'active'
     or (to_jsonb(new) - 'status' - 'undone_by' - 'undone_at' - 'undo_reason') is distinct from (to_jsonb(old) - 'status' - 'undone_by' - 'undone_at' - 'undo_reason') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_bank_matches_guard on public.fin_bank_matches;
create trigger fin_bank_matches_guard before update or delete on public.fin_bank_matches for each row execute function public.fin_bank_matches_guard();

-- 3. Reconciliation periods -----------------------------------------------------------------------------------
create table if not exists public.fin_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.fin_books (id) on delete restrict,
  account_id        uuid not null references public.fin_bank_accounts (id) on delete restrict,
  period_end        date not null,
  statement_balance numeric(14, 2) not null,
  bank_balance      numeric(14, 2) not null,      -- opening + imported lines through period_end, at confirmation
  difference        numeric(14, 2) not null,      -- statement_balance - bank_balance
  unmatched_count   integer not null,
  status            text not null check (status in ('reconciled', 'confirmed_with_differences')),
  note              text check (char_length(note) <= 1000),
  confirmed_by      uuid references auth.users (id) on delete set null,
  confirmed_at      timestamptz not null default now(),
  reopened_by       uuid references auth.users (id) on delete set null,
  reopened_at       timestamptz,
  reopen_reason     text check (char_length(reopen_reason) <= 500),
  constraint fin_reconciliations_diff check (status = 'reconciled' and difference = 0 and unmatched_count = 0
                                             or status = 'confirmed_with_differences' and note is not null),
  constraint fin_reconciliations_reopen check ((reopened_at is null) = (reopen_reason is null))
);
create unique index if not exists fin_reconciliations_open on public.fin_reconciliations (account_id, period_end) where reopened_at is null;

create or replace function public.fin_reconciliations_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.reopened_at is not null
     or (to_jsonb(new) - 'reopened_by' - 'reopened_at' - 'reopen_reason') is distinct from (to_jsonb(old) - 'reopened_by' - 'reopened_at' - 'reopen_reason') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_reconciliations_guard on public.fin_reconciliations;
create trigger fin_reconciliations_guard before update or delete on public.fin_reconciliations for each row execute function public.fin_reconciliations_guard();

-- Books with bank lines hold records (retention + purge rules).
create or replace function public.fin_book_has_records(p_book_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t text; v boolean;
begin
  foreach t in array array['fin_jobs', 'fin_invoices', 'fin_payments', 'fin_credit_memos', 'fin_refunds', 'fin_vendor_bills',
                           'fin_expenses', 'fin_commitments', 'fin_documents', 'fin_vendors', 'fin_bank_transactions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I where book_id = $1)', t) into v using p_book_id;
      if v then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function public.fin_book_has_records(uuid) from public, anon, authenticated;

-- RLS: reads for company-financials viewers; writes only through the functions below.
alter table public.fin_bank_accounts enable row level security;
alter table public.fin_bank_imports enable row level security;
alter table public.fin_bank_transactions enable row level security;
alter table public.fin_bank_matches enable row level security;
alter table public.fin_reconciliations enable row level security;
do $$ declare t text; begin
  foreach t in array array['fin_bank_accounts', 'fin_bank_imports', 'fin_bank_transactions', 'fin_bank_matches', 'fin_reconciliations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.fin_has_permission(book_id, ''view_company_financials''))', t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 4. Bank functions ---------------------------------------------------------------------------------------------
create or replace function public.fin_bank_account_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_open numeric := coalesce(nullif(p ->> 'openingBalance', '')::numeric, 0);
begin
  perform public.fin_require(p_book_id, 'reconcile', true);
  if v_open <> round(v_open, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if nullif(p ->> 'last4', '') is not null and (p ->> 'last4') !~ '^[0-9]{4}$' then raise exception 'bad_last4' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.fin_bank_accounts (book_id, name, kind, last4, opening_balance, opening_date, created_by)
    values (p_book_id, left(btrim(p ->> 'name'), 120), coalesce(nullif(p ->> 'kind', ''), 'checking'), nullif(p ->> 'last4', ''), v_open,
            coalesce(nullif(p ->> 'openingDate', '')::date, current_date), auth.uid())
    returning id into v_id;
    perform public.fin_audit(p_book_id, 'bank.account_added', 'bank_account', v_id, jsonb_build_object('name', p ->> 'name', 'kind', p ->> 'kind'));
  else
    -- Name and status only: the opening balance is part of every reconciliation, so it never changes once lines exist.
    update public.fin_bank_accounts set name = coalesce(left(nullif(btrim(p ->> 'name'), ''), 120), name),
      status = coalesce(nullif(p ->> 'status', ''), status),
      opening_balance = case when exists (select 1 from public.fin_bank_transactions t where t.account_id = v_id) then opening_balance else v_open end,
      opening_date = case when exists (select 1 from public.fin_bank_transactions t where t.account_id = v_id) then opening_date else coalesce(nullif(p ->> 'openingDate', '')::date, opening_date) end
    where id = v_id and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_audit(p_book_id, 'bank.account_updated', 'bank_account', v_id, jsonb_build_object('name', p ->> 'name', 'status', p ->> 'status'));
  end if;
  return v_id;
end $$;

-- Import parsed statement rows. Lines already imported for this account (same fingerprint) are skipped.
-- Identical lines inside one file (same day, amount and description) get an occurrence number so both import.
create or replace function public.fin_bank_import(p_account_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.fin_bank_accounts; v_import uuid; v_rows jsonb := coalesce(p -> 'rows', '[]'::jsonb); v_n integer; v_ins integer;
        v_in numeric; v_out numeric; v_open numeric := nullif(p ->> 'openingBalance', '')::numeric; v_end numeric := nullif(p ->> 'endingBalance', '')::numeric;
        v_bal boolean; v_bad integer;
begin
  select * into a from public.fin_bank_accounts where id = p_account_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'reconcile', true);
  if a.status <> 'active' then raise exception 'account_archived' using errcode = '22023'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'bad_rows' using errcode = '22023'; end if;
  v_n := jsonb_array_length(v_rows);
  if v_n = 0 or v_n > 5000 then raise exception 'bad_rows' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(v_rows) x
   where nullif(x ->> 'date', '') is null or nullif(btrim(x ->> 'description'), '') is null or nullif(x ->> 'amount', '') is null
      or (x ->> 'amount')::numeric = 0 or (x ->> 'amount')::numeric <> round((x ->> 'amount')::numeric, 2);
  if v_bad > 0 then raise exception 'bad_rows' using errcode = '22023'; end if;
  select coalesce(sum(greatest((x ->> 'amount')::numeric, 0)), 0), coalesce(sum(greatest(-(x ->> 'amount')::numeric, 0)), 0) into v_in, v_out
    from jsonb_array_elements(v_rows) x;
  v_bal := case when v_open is not null and v_end is not null then v_open + v_in - v_out = v_end end;

  -- Lines already on file for this account (same fingerprint) are skipped; count them first so the import row,
  -- which is append-only, records the real inserted/skipped counts.
  create temp table if not exists fin_bank_import_rows (d date, descr text, amt numeric, chk text, ref text, fp text) on commit drop;
  truncate fin_bank_import_rows;
  insert into fin_bank_import_rows
  select d, descr, amt, chk, ref, md5(d::text || '|' || amt::text || '|' || lower(descr) || '|' || coalesce(ref, '') || '|' || occ)
    from (select *, row_number() over (partition by d, amt, lower(descr) order by ord) as occ
            from (select (x ->> 'date')::date as d, left(btrim(x ->> 'description'), 300) as descr, (x ->> 'amount')::numeric as amt,
                         nullif(left(btrim(x ->> 'checkNumber'), 20), '') as chk, nullif(left(btrim(x ->> 'ref'), 80), '') as ref, ord
                    from jsonb_array_elements(v_rows) with ordinality t(x, ord)) src) numbered;
  select count(*) into v_ins from fin_bank_import_rows r
   where not exists (select 1 from public.fin_bank_transactions t where t.account_id = a.id and t.fingerprint = r.fp);

  insert into public.fin_bank_imports (book_id, account_id, file_name, file_hash, statement_start, statement_end, opening_balance, ending_balance,
                                       row_count, inserted_count, skipped_count, total_in, total_out, balanced, imported_by)
  select a.book_id, a.id, left(coalesce(nullif(btrim(p ->> 'fileName'), ''), 'statement.csv'), 200), lower(p ->> 'fileHash'),
         nullif(p ->> 'statementStart', '')::date, nullif(p ->> 'statementEnd', '')::date, v_open, v_end, v_n, v_ins, v_n - v_ins, v_in, v_out, v_bal, auth.uid()
  returning id into v_import;
  insert into public.fin_bank_transactions (book_id, account_id, import_id, posted_on, description, amount, check_number, bank_ref, fingerprint)
  select a.book_id, a.id, v_import, d, descr, amt, chk, ref, fp from fin_bank_import_rows
  on conflict (account_id, fingerprint) do nothing;
  perform public.fin_audit(a.book_id, 'bank.imported', 'bank_import', v_import, jsonb_build_object('account', a.name, 'file', p ->> 'fileName',
    'rows', v_n, 'inserted', v_ins, 'skipped', v_n - v_ins, 'balanced', v_bal));
  return jsonb_build_object('importId', v_import, 'rows', v_n, 'inserted', v_ins, 'skipped', v_n - v_ins, 'balanced', v_bal);
end $$;

-- A bank line inside a confirmed (not reopened) reconciliation period is locked.
create or replace function public.fin_bank_line_locked(p_txn_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fin_bank_transactions t join public.fin_reconciliations r on r.account_id = t.account_id
                  where t.id = p_txn_id and r.reopened_at is null and t.posted_on <= r.period_end)
$$;

create or replace function public.fin_bank_match(p_txn_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.fin_bank_transactions; v_type text := p ->> 'targetType'; v_target uuid := nullif(p ->> 'targetId', '')::uuid;
        v_amt numeric; v_ok boolean; v_id uuid; v_reason text := nullif(p ->> 'excludeReason', '');
begin
  select * into t from public.fin_bank_transactions where id = p_txn_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(t.book_id, 'reconcile', true);
  if public.fin_bank_line_locked(t.id) then raise exception 'period_locked' using errcode = '22023'; end if;
  if v_type = 'excluded' then
    if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
    v_target := null;
  else
    if v_target is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    -- Same book, active, same amount, right direction.
    case v_type
      when 'payment' then select amount, status = 'active' into v_amt, v_ok from public.fin_payments where id = v_target and book_id = t.book_id;
      when 'refund' then select -amount, status = 'active' into v_amt, v_ok from public.fin_refunds where id = v_target and book_id = t.book_id;
      when 'bill_payment' then select -amount, status = 'active' into v_amt, v_ok from public.fin_bill_payments where id = v_target and book_id = t.book_id;
      when 'expense' then select -amount, status in ('pending', 'approved') into v_amt, v_ok from public.fin_expenses where id = v_target and book_id = t.book_id;
      else raise exception 'bad_target' using errcode = '22023';
    end case;
    if v_amt is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    if not v_ok then raise exception 'bad_state' using errcode = '22023'; end if;
    if v_amt <> t.amount then raise exception 'amount_mismatch' using errcode = '22023'; end if;
  end if;
  begin
    insert into public.fin_bank_matches (book_id, bank_txn_id, target_type, target_id, exclude_reason, note, matched_by)
    values (t.book_id, t.id, v_type, v_target, case when v_type = 'excluded' then v_reason end, nullif(left(p ->> 'note', 500), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_matched' using errcode = '22023';
  end;
  perform public.fin_audit(t.book_id, 'bank.matched', 'bank_txn', t.id, jsonb_build_object('target', v_type, 'targetId', v_target, 'reason', v_reason,
    'amount', t.amount::text, 'date', t.posted_on));
  return v_id;
end $$;

create or replace function public.fin_bank_unmatch(p_match_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.fin_bank_matches;
begin
  select * into m from public.fin_bank_matches where id = p_match_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'reconcile', true);
  if m.status <> 'active' then raise exception 'bad_state' using errcode = '22023'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if public.fin_bank_line_locked(m.bank_txn_id) then raise exception 'period_locked' using errcode = '22023'; end if;
  update public.fin_bank_matches set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = left(btrim(p_reason), 500) where id = m.id;
  perform public.fin_audit(m.book_id, 'bank.unmatched', 'bank_txn', m.bank_txn_id, jsonb_build_object('target', m.target_type, 'targetId', m.target_id, 'reason', p_reason));
end $$;

-- Record an expense straight from a bank withdrawal (pending approval like any expense) and match it.
create or replace function public.fin_bank_create_expense(p_txn_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.fin_bank_transactions; a public.fin_bank_accounts; r jsonb; v_match uuid;
begin
  select * into t from public.fin_bank_transactions where id = p_txn_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(t.book_id, 'reconcile', true);
  perform public.fin_require(t.book_id, 'record_expenses', true);
  if t.amount >= 0 then raise exception 'not_withdrawal' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_bank_matches where bank_txn_id = t.id and status = 'active') then raise exception 'already_matched' using errcode = '22023'; end if;
  if public.fin_bank_line_locked(t.id) then raise exception 'period_locked' using errcode = '22023'; end if;
  select * into a from public.fin_bank_accounts where id = t.account_id;
  r := public.fin_expense_record(t.book_id, jsonb_build_object(
    'amount', (-t.amount)::text, 'spentOn', t.posted_on, 'description', coalesce(nullif(btrim(p ->> 'description'), ''), t.description),
    'jobId', p ->> 'jobId', 'costCodeId', p ->> 'costCodeId', 'vendorId', p ->> 'vendorId', 'payee', coalesce(nullif(p ->> 'payee', ''), left(t.description, 200)),
    'method', case a.kind when 'credit_card' then 'card' else case when t.check_number is not null then 'check' else 'ach' end end), 'bank:' || t.id::text);
  v_match := public.fin_bank_match(t.id, jsonb_build_object('targetType', 'expense', 'targetId', r ->> 'expenseId'));
  return r || jsonb_build_object('matchId', v_match);
end $$;

-- Bank-side balance of an account through a date (opening balance + imported lines).
create or replace function public.fin_bank_balance(p_account_id uuid, p_through date) returns numeric
language sql stable security definer set search_path = public as $$
  select a.opening_balance + coalesce((select sum(t.amount) from public.fin_bank_transactions t where t.account_id = a.id and t.posted_on <= p_through and t.posted_on >= a.opening_date), 0)
    from public.fin_bank_accounts a where a.id = p_account_id and public.fin_has_permission(a.book_id, 'view_company_financials')
$$;

create or replace function public.fin_bank_reconcile(p_account_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.fin_bank_accounts; v_end date := (p ->> 'periodEnd')::date; v_stmt numeric := (p ->> 'statementBalance')::numeric;
        v_bank numeric; v_unmatched integer; v_diff numeric; v_status text; v_id uuid; v_note text := nullif(btrim(p ->> 'note'), '');
begin
  select * into a from public.fin_bank_accounts where id = p_account_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'reconcile', true);
  if v_end is null or v_stmt is null or v_stmt <> round(v_stmt, 2) then raise exception 'bad_input' using errcode = '22023'; end if;
  if v_end < a.opening_date then raise exception 'before_opening' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_reconciliations where account_id = a.id and reopened_at is null and period_end >= v_end) then
    raise exception 'period_already_confirmed' using errcode = '22023';
  end if;
  v_bank := public.fin_bank_balance(a.id, v_end);
  select count(*) into v_unmatched from public.fin_bank_transactions t
   where t.account_id = a.id and t.posted_on <= v_end and t.posted_on >= a.opening_date
     and not exists (select 1 from public.fin_bank_matches m where m.bank_txn_id = t.id and m.status = 'active');
  v_diff := v_stmt - v_bank;
  v_status := case when v_diff = 0 and v_unmatched = 0 then 'reconciled' else 'confirmed_with_differences' end;
  if v_status = 'confirmed_with_differences' and v_note is null then
    raise exception 'differences_need_note' using errcode = '22023', detail = jsonb_build_object('difference', v_diff::text, 'unmatched', v_unmatched)::text;
  end if;
  insert into public.fin_reconciliations (book_id, account_id, period_end, statement_balance, bank_balance, difference, unmatched_count, status, note, confirmed_by)
  values (a.book_id, a.id, v_end, v_stmt, v_bank, v_diff, v_unmatched, v_status, left(v_note, 1000), auth.uid())
  returning id into v_id;
  perform public.fin_audit(a.book_id, 'bank.reconciled', 'reconciliation', v_id, jsonb_build_object('account', a.name, 'periodEnd', v_end,
    'statement', v_stmt::text, 'bank', v_bank::text, 'difference', v_diff::text, 'unmatched', v_unmatched, 'status', v_status));
  return jsonb_build_object('id', v_id, 'status', v_status, 'bankBalance', v_bank::text, 'difference', v_diff::text, 'unmatched', v_unmatched);
end $$;

create or replace function public.fin_bank_reconcile_reopen(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fin_reconciliations;
begin
  select * into r from public.fin_reconciliations where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(r.book_id, 'reconcile', true);
  if r.reopened_at is not null then raise exception 'bad_state' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_reconciliations x where x.account_id = r.account_id and x.reopened_at is null and x.period_end > r.period_end) then
    raise exception 'not_latest' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.fin_reconciliations set reopened_by = auth.uid(), reopened_at = now(), reopen_reason = left(btrim(p_reason), 500) where id = r.id;
  perform public.fin_audit(r.book_id, 'bank.reconciliation_reopened', 'reconciliation', r.id, jsonb_build_object('periodEnd', r.period_end, 'reason', p_reason));
end $$;

-- 5. Classification: fill a missing project / vendor / scope section once ---------------------------------------
alter table public.fin_expenses add column if not exists scope_section_id uuid;          -- project_scope_sections.id (validated on write)
alter table public.fin_vendor_bill_lines add column if not exists scope_section_id uuid;

create or replace function public.fin_cost_rows_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_new jsonb; v_old jsonb; k text;
begin
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if (to_jsonb(old) ->> 'status') = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  v_new := to_jsonb(new); v_old := to_jsonb(old);
  foreach k in array tg_argv::text[] loop v_new := v_new - k; v_old := v_old - k; end loop;
  -- Classification fields may be filled in once while empty; once set they only change through void + re-record.
  foreach k in array array['cost_code_id', 'receipt_document_id', 'job_id', 'vendor_id', 'scope_section_id'] loop
    if v_old ? k and (v_old ->> k) is null then v_new := v_new - k; v_old := v_old - k; end if;
  end loop;
  if v_new is distinct from v_old then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function public.fin_cost_fill(p_entity_type text, p_entity_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_book uuid; v_code uuid := nullif(p ->> 'costCodeId', '')::uuid; v_doc uuid := nullif(p ->> 'receiptDocumentId', '')::uuid;
        v_job uuid := nullif(p ->> 'jobId', '')::uuid; v_vendor uuid := nullif(p ->> 'vendorId', '')::uuid; v_scope uuid := nullif(p ->> 'scopeSectionId', '')::uuid;
        v_cur_job uuid; v_old jsonb;
begin
  if p_entity_type = 'bill_line' then
    select book_id, job_id, to_jsonb(l) into v_book, v_cur_job, v_old from public.fin_vendor_bill_lines l where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_bills', true);
    if v_vendor is not null then raise exception 'bad_field' using errcode = '22023'; end if;   -- a bill's vendor is on the bill
  elsif p_entity_type = 'expense' then
    select book_id, job_id, to_jsonb(x) into v_book, v_cur_job, v_old from public.fin_expenses x where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_expenses', true);
  else
    raise exception 'bad_entity' using errcode = '22023';
  end if;
  if v_job is not null then
    if not exists (select 1 from public.fin_jobs where id = v_job and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_entity_type = 'bill_line' then
      update public.fin_vendor_bill_lines set job_id = v_job where id = p_entity_id and job_id is null;
    else
      update public.fin_expenses set job_id = v_job where id = p_entity_id and job_id is null;
    end if;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
    v_cur_job := v_job;
    -- A project cost with no cost code goes to the review queue, same as when it is recorded that way.
    if v_code is null and (v_old ->> 'cost_code_id') is null then
      perform public.fin_review_add(v_book, 'uncoded_cost', p_entity_type, p_entity_id, v_job, jsonb_build_object('amount', v_old ->> 'amount'));
    end if;
  end if;
  if v_vendor is not null then
    if not exists (select 1 from public.fin_vendors where id = v_vendor and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.fin_expenses set vendor_id = v_vendor where id = p_entity_id and vendor_id is null;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
  end if;
  if v_scope is not null then
    if v_cur_job is null or not exists (select 1 from public.project_scope_sections s join public.fin_jobs j on j.estimate_id = s.estimate_id
                                         where s.id = v_scope and j.id = v_cur_job) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if p_entity_type = 'bill_line' then
      update public.fin_vendor_bill_lines set scope_section_id = v_scope where id = p_entity_id and scope_section_id is null;
    else
      update public.fin_expenses set scope_section_id = v_scope where id = p_entity_id and scope_section_id is null;
    end if;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
  end if;
  if v_code is not null then
    if not exists (select 1 from public.fin_cost_codes where id = v_code and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_entity_type = 'bill_line' then
      update public.fin_vendor_bill_lines set cost_code_id = v_code where id = p_entity_id and cost_code_id is null;
    else
      update public.fin_expenses set cost_code_id = v_code where id = p_entity_id and cost_code_id is null;
    end if;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
    perform public.fin_review_autoresolve('uncoded_cost', p_entity_type, p_entity_id, 'Cost code assigned');
  end if;
  if v_doc is not null and p_entity_type = 'expense' then
    if not exists (select 1 from public.fin_documents where id = v_doc and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.fin_expenses set receipt_document_id = v_doc where id = p_entity_id and receipt_document_id is null;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
    perform public.fin_review_autoresolve('missing_receipt', 'expense', p_entity_id, 'Receipt attached');
  end if;
  -- Previous values (all empty, by rule) and new values, for the audit trail.
  perform public.fin_audit(v_book, 'cost.filled', p_entity_type, p_entity_id, jsonb_build_object('new', p,
    'previous', jsonb_build_object('jobId', v_old ->> 'job_id', 'vendorId', v_old ->> 'vendor_id', 'costCodeId', v_old ->> 'cost_code_id', 'scopeSectionId', v_old ->> 'scope_section_id')));
end $$;
revoke execute on function public.fin_cost_fill(text, uuid, jsonb) from public, anon;
grant execute on function public.fin_cost_fill(text, uuid, jsonb) to authenticated;

-- 6. Exports: authorize + audit every export ------------------------------------------------------------------
create or replace function public.fin_export_log(p_book_id uuid, p_kind text, p_filters jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'export_financials', false);   -- exporting stays open on a read-only book
  if p_kind !~ '^[a-z_]{2,40}$' then raise exception 'bad_kind' using errcode = '22023'; end if;
  perform public.fin_audit(p_book_id, 'export.' || p_kind, 'book', p_book_id, p_filters);
end $$;

-- 7. Audit trail -------------------------------------------------------------------------------------------------
-- Removes keys that could carry sensitive values (tax ids, account numbers, tokens) at any depth.
create or replace function public.fin_redact(p jsonb) returns jsonb
language sql immutable as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((select jsonb_object_agg(k, case when k ~* '(ssn|tin|ein|tax_?id|account_?number|routing|token|secret|password|card_?number|cvv|iban)'
                                                            then to_jsonb('[hidden]'::text) else public.fin_redact(v) end)
                                  from jsonb_each(p) e(k, v)), '{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(public.fin_redact(v)) from jsonb_array_elements(p) a(v)), '[]'::jsonb)
    else p end
$$;

create or replace function public.fin_audit_list(p_book_id uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := least(greatest(coalesce(nullif(p ->> 'limit', '')::int, 100), 1), 500);
begin
  perform public.fin_require(p_book_id, 'view_company_financials', false);
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.id desc) from (
      select l.id, l.created_at, l.action, l.entity_type, l.entity_id, public.fin_redact(l.details) as details, l.actor_id,
             coalesce(nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'full_name', ''), nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'name', ''), u.email, case when l.actor_id is null then 'System' else 'Former user' end) as actor_name
        from public.fin_audit_log l left join auth.users u on u.id = l.actor_id
       where l.book_id = p_book_id
         and (nullif(p ->> 'entityType', '') is null or l.entity_type = p ->> 'entityType')
         and (nullif(p ->> 'entityId', '') is null or l.entity_id = (p ->> 'entityId')::uuid)
         and (nullif(p ->> 'actorId', '') is null or l.actor_id = (p ->> 'actorId')::uuid)
         and (nullif(p ->> 'action', '') is null or l.action like (p ->> 'action') || '%')
         and (nullif(p ->> 'q', '') is null or l.action ilike '%' || (p ->> 'q') || '%' or l.entity_type ilike '%' || (p ->> 'q') || '%' or l.details::text ilike '%' || (p ->> 'q') || '%')
         and (nullif(p ->> 'from', '') is null or l.created_at >= (p ->> 'from')::date)
         and (nullif(p ->> 'to', '') is null or l.created_at < (p ->> 'to')::date + 1)
         and (nullif(p ->> 'before', '') is null or l.id < (p ->> 'before')::bigint)
       order by l.id desc limit v_limit) x), '[]'::jsonb);
end $$;

-- 8. Grants ---------------------------------------------------------------------------------------------------
revoke execute on function public.fin_bank_account_save(uuid, jsonb), public.fin_bank_import(uuid, jsonb), public.fin_bank_match(uuid, jsonb),
  public.fin_bank_unmatch(uuid, text), public.fin_bank_create_expense(uuid, jsonb), public.fin_bank_balance(uuid, date),
  public.fin_bank_reconcile(uuid, jsonb), public.fin_bank_reconcile_reopen(uuid, text), public.fin_bank_line_locked(uuid),
  public.fin_export_log(uuid, text, jsonb), public.fin_audit_list(uuid, jsonb) from public, anon;
grant execute on function public.fin_bank_account_save(uuid, jsonb), public.fin_bank_import(uuid, jsonb), public.fin_bank_match(uuid, jsonb),
  public.fin_bank_unmatch(uuid, text), public.fin_bank_create_expense(uuid, jsonb), public.fin_bank_balance(uuid, date),
  public.fin_bank_reconcile(uuid, jsonb), public.fin_bank_reconcile_reopen(uuid, text), public.fin_bank_line_locked(uuid),
  public.fin_export_log(uuid, text, jsonb), public.fin_audit_list(uuid, jsonb) to authenticated;
