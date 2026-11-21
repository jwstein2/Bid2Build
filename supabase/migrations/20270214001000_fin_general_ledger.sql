-- General ledger (Financials Phase 2, 2026-11-21): a balanced double-entry book of record built FROM the existing
-- Financials records. Nothing about invoices, payments, bills or expenses changes; the ledger posts journal entries
-- for them (accrual basis) and adds manual journal entries, a contractor chart of accounts, a payroll journal shape
-- for the payroll partner, and Trial Balance / Balance Sheet / Income Statement / General Ledger reports.
--
-- Rules:
--   * Every entry balances (sum of debits = sum of credits), checked at commit.
--   * Entries are append-only. A correction is a reversing entry; the original is never edited.
--   * Automatic postings are idempotent: one entry per (book, source type, source, event). Re-running the sync
--     never double-posts. A voided source posts a reversal dated the day it was voided.
--   * Entries never land in a locked period (fin_books.locked_through): they post on the first open day instead.
--   * Accounting treatments that need a CPA's ruling (deposits, retainage, cash basis, WIP, sales-tax timing) are
--     listed in docs/financials/general-ledger.md. Until then deposits post as revenue when invoiced.
-- Re-runnable.

-- 1. Chart of accounts -------------------------------------------------------------------------------------------
create table if not exists public.fin_gl_accounts (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  code        text not null check (code ~ '^[0-9]{3,6}(\.[0-9]{1,3})?$'),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  type        text not null check (type in ('asset', 'liability', 'equity', 'income', 'cogs', 'expense')),
  system_key  text check (system_key ~ '^[a-z_]{2,40}$'),
  description text check (char_length(description) <= 300),
  active      boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (book_id, code)
);
create unique index if not exists fin_gl_accounts_system on public.fin_gl_accounts (book_id, system_key) where system_key is not null;
drop trigger if exists fin_gl_accounts_updated on public.fin_gl_accounts;
create trigger fin_gl_accounts_updated before update on public.fin_gl_accounts for each row execute function public.set_updated_at();

-- 2. Journal entries and lines -------------------------------------------------------------------------------------
create table if not exists public.fin_journal_entries (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  entry_date   date not null,
  memo         text not null check (char_length(memo) between 1 and 500),
  source_type  text not null check (source_type in ('invoice', 'payment', 'credit_memo', 'refund', 'bill', 'bill_payment', 'expense', 'manual', 'payroll', 'opening')),
  source_ref   text not null check (char_length(source_ref) between 1 and 120),
  event_kind   text not null check (event_kind in ('post', 'void', 'reversal')),
  reverses     uuid references public.fin_journal_entries (id) on delete restrict,
  posted_by    uuid references auth.users (id) on delete set null,
  posted_at    timestamptz not null default now(),
  unique (book_id, source_type, source_ref, event_kind)
);
create index if not exists fin_journal_entries_book_date on public.fin_journal_entries (book_id, entry_date);
create unique index if not exists fin_journal_entries_one_reversal on public.fin_journal_entries (reverses) where reverses is not null;

create table if not exists public.fin_journal_lines (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null references public.fin_journal_entries (id) on delete restrict,
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  account_id  uuid not null references public.fin_gl_accounts (id) on delete restrict,
  debit       numeric(14, 2) not null default 0 check (debit >= 0),
  credit      numeric(14, 2) not null default 0 check (credit >= 0),
  job_id      uuid references public.fin_jobs (id) on delete restrict,
  description text check (char_length(description) <= 300),
  constraint fin_journal_lines_one_side check ((debit > 0) <> (credit > 0))
);
create index if not exists fin_journal_lines_entry on public.fin_journal_lines (entry_id);
create index if not exists fin_journal_lines_account on public.fin_journal_lines (book_id, account_id);

-- Append-only.
drop trigger if exists fin_journal_entries_immutable on public.fin_journal_entries;
create trigger fin_journal_entries_immutable before update or delete on public.fin_journal_entries for each row execute function public.fin_guard_immutable();
drop trigger if exists fin_journal_lines_immutable on public.fin_journal_lines;
create trigger fin_journal_lines_immutable before update or delete on public.fin_journal_lines for each row execute function public.fin_guard_immutable();

-- Balanced, at least two lines, accounts from the same book. Checked at commit.
create or replace function public.fin_journal_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dr numeric; v_cr numeric; v_n int; v_bad int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_dr, v_cr, v_n from public.fin_journal_lines where entry_id = new.entry_id;
  if v_n < 2 then raise exception 'journal_needs_two_lines' using errcode = '23514'; end if;
  if v_dr <> v_cr then raise exception 'journal_unbalanced' using errcode = '23514'; end if;
  select count(*) into v_bad from public.fin_journal_lines l join public.fin_gl_accounts a on a.id = l.account_id
   where l.entry_id = new.entry_id and (a.book_id <> l.book_id or l.book_id <> (select book_id from public.fin_journal_entries where id = new.entry_id));
  if v_bad > 0 then raise exception 'journal_cross_book' using errcode = '23514'; end if;
  return null;
end $$;
revoke execute on function public.fin_journal_check() from public, anon, authenticated;
drop trigger if exists fin_journal_lines_check on public.fin_journal_lines;
create constraint trigger fin_journal_lines_check after insert on public.fin_journal_lines
  deferrable initially deferred for each row execute function public.fin_journal_check();

-- RLS: read with company-financials access; writes only through the functions below.
alter table public.fin_gl_accounts enable row level security;
alter table public.fin_journal_entries enable row level security;
alter table public.fin_journal_lines enable row level security;
drop policy if exists fin_gl_accounts_read on public.fin_gl_accounts;
create policy fin_gl_accounts_read on public.fin_gl_accounts for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
drop policy if exists fin_journal_entries_read on public.fin_journal_entries;
create policy fin_journal_entries_read on public.fin_journal_entries for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
drop policy if exists fin_journal_lines_read on public.fin_journal_lines;
create policy fin_journal_lines_read on public.fin_journal_lines for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
revoke insert, update, delete on public.fin_gl_accounts, public.fin_journal_entries, public.fin_journal_lines from anon, authenticated;
grant select on public.fin_gl_accounts, public.fin_journal_entries, public.fin_journal_lines to authenticated;

-- 3. Default contractor chart of accounts (created once per book) -----------------------------------------------------
create or replace function public.fin_gl_ensure_chart(p_book_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.fin_gl_accounts (book_id, code, name, type, system_key, description)
  select p_book_id, c.code, c.name, c.type, c.key, c.descr from (values
    ('1000', 'Cash and bank', 'asset', 'cash', 'Money received and paid. Split by bank account with your own accounts if you like.'),
    ('1100', 'Accounts receivable', 'asset', 'ar', 'What customers owe on issued invoices. A negative balance means customer credit.'),
    ('1200', 'Retainage receivable', 'asset', 'retainage_receivable', 'Retainage withheld by customers (CPA review).'),
    ('1500', 'Equipment and vehicles', 'asset', null, null),
    ('2000', 'Accounts payable', 'liability', 'ap', 'What you owe on approved vendor and sub bills.'),
    ('2100', 'Customer deposits', 'liability', 'customer_deposits', 'Deposits received before the work is earned (used once your CPA confirms the treatment).'),
    ('2200', 'Sales tax payable', 'liability', 'sales_tax', 'Sales tax charged on invoices, owed to the state.'),
    ('2300', 'Credit card payable', 'liability', null, null),
    ('2400', 'Payroll liabilities', 'liability', 'payroll_liabilities', 'Withholding and employer payroll taxes owed.'),
    ('2700', 'Loans payable', 'liability', null, null),
    ('3000', 'Owner''s equity', 'equity', 'owner_equity', null),
    ('3100', 'Opening balance equity', 'equity', 'opening_equity', 'Offset for opening balances entered when you start.'),
    ('3200', 'Owner draws', 'equity', 'owner_draws', null),
    ('4000', 'Contract revenue', 'income', 'revenue', 'Invoiced contract work.'),
    ('4900', 'Credits and allowances', 'income', 'returns', 'Credit memos issued to customers (reduces revenue).'),
    ('5000', 'Job costs', 'cogs', 'job_costs', 'Materials, subs and other costs charged to a job.'),
    ('5100', 'Job labor', 'cogs', 'job_labor', null),
    ('6000', 'Overhead', 'expense', 'overhead', 'Company costs not charged to a job.'),
    ('6100', 'Wages', 'expense', 'wages', 'Gross wages from payroll.'),
    ('6110', 'Payroll taxes', 'expense', 'payroll_taxes', 'Employer payroll taxes.'),
    ('6200', 'Merchant and bank fees', 'expense', 'merchant_fees', null),
    ('6300', 'Insurance', 'expense', null, null),
    ('6400', 'Vehicle and fuel', 'expense', null, null),
    ('6500', 'Software and subscriptions', 'expense', null, null)
  ) as c(code, name, type, key, descr)
  on conflict do nothing;
end $$;
revoke execute on function public.fin_gl_ensure_chart(uuid) from public, anon, authenticated;

create or replace function public.fin_gl_account(p_book_id uuid, p_key text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.fin_gl_accounts where book_id = p_book_id and system_key = p_key
$$;
revoke execute on function public.fin_gl_account(uuid, text) from public, anon, authenticated;

-- 4. Posting primitive --------------------------------------------------------------------------------------------
-- p_lines: [{account: uuid | systemKey: text, debit?, credit?, jobId?, description?}]. Amounts may be given as a
-- signed "amount" (positive = debit) too. Zero lines are skipped. Returns the entry id, or the existing one.
create or replace function public.fin_gl_post(p_book_id uuid, p_date date, p_memo text, p_source_type text, p_source_ref text, p_event text,
                                              p_lines jsonb, p_reverses uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lock date; l jsonb; v_acct uuid; v_amt numeric; v_norm jsonb := '[]';
begin
  select id into v_id from public.fin_journal_entries where book_id = p_book_id and source_type = p_source_type and source_ref = p_source_ref and event_kind = p_event;
  if v_id is not null then return v_id; end if;
  -- Normalize first: resolve accounts, round, drop zero lines. Nothing to post (e.g. a $0 record) -> no entry.
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    v_acct := coalesce(nullif(l ->> 'account', '')::uuid, public.fin_gl_account(p_book_id, l ->> 'systemKey'));
    if v_acct is null then raise exception 'unknown_account' using errcode = '22023'; end if;
    v_amt := round(coalesce((l ->> 'amount')::numeric, coalesce((l ->> 'debit')::numeric, 0) - coalesce((l ->> 'credit')::numeric, 0)), 2);
    if v_amt = 0 then continue; end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('a', v_acct, 'v', v_amt, 'j', nullif(l ->> 'jobId', ''), 'd', nullif(left(l ->> 'description', 300), '')));
  end loop;
  if jsonb_array_length(v_norm) = 0 then return null; end if;
  select locked_through into v_lock from public.fin_books where id = p_book_id;
  insert into public.fin_journal_entries (book_id, entry_date, memo, source_type, source_ref, event_kind, reverses, posted_by)
  values (p_book_id, case when v_lock is not null and p_date <= v_lock then v_lock + 1 else p_date end, left(p_memo, 500), p_source_type, p_source_ref, p_event, p_reverses, auth.uid())
  on conflict (book_id, source_type, source_ref, event_kind) do nothing
  returning id into v_id;
  if v_id is null then
    return (select id from public.fin_journal_entries where book_id = p_book_id and source_type = p_source_type and source_ref = p_source_ref and event_kind = p_event);
  end if;
  insert into public.fin_journal_lines (entry_id, book_id, account_id, debit, credit, job_id, description)
  select v_id, p_book_id, (x ->> 'a')::uuid, greatest((x ->> 'v')::numeric, 0), greatest(-(x ->> 'v')::numeric, 0), (x ->> 'j')::uuid, x ->> 'd'
    from jsonb_array_elements(v_norm) x;
  return v_id;
end $$;
revoke execute on function public.fin_gl_post(uuid, date, text, text, text, text, jsonb, uuid) from public, anon, authenticated;

-- Reversal of a posted entry (same lines, sides swapped).
create or replace function public.fin_gl_reverse_internal(p_entry_id uuid, p_date date, p_event text, p_memo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.fin_journal_entries; v_lines jsonb;
begin
  if p_entry_id is null then return null; end if;
  select * into e from public.fin_journal_entries where id = p_entry_id;
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('account', account_id, 'amount', credit - debit, 'jobId', job_id, 'description', description)) into v_lines
    from public.fin_journal_lines where entry_id = p_entry_id;
  return public.fin_gl_post(e.book_id, p_date, p_memo, e.source_type, e.source_ref, p_event, v_lines, e.id);
end $$;
revoke execute on function public.fin_gl_reverse_internal(uuid, date, text, text) from public, anon, authenticated;

-- 5. Sync: post every Financials record that isn't in the ledger yet (idempotent) ----------------------------------
create or replace function public.fin_gl_sync_internal(p_book_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_before int; v_entry uuid; v_lines jsonb;
begin
  perform public.fin_gl_ensure_chart(p_book_id);
  select count(*) into v_before from public.fin_journal_entries where book_id = p_book_id;

  -- Invoices: Dr AR total / Cr revenue subtotal / Cr sales tax. Voided after issue: reversal.
  for r in select * from public.fin_invoices where book_id = p_book_id and issued_at is not null order by issue_date, seq loop
    v_entry := public.fin_gl_post(p_book_id, r.issue_date, 'Invoice ' || r.number, 'invoice', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', 'ar', 'debit', r.total, 'jobId', r.job_id),
      jsonb_build_object('systemKey', 'revenue', 'credit', r.subtotal, 'jobId', r.job_id),
      jsonb_build_object('systemKey', 'sales_tax', 'credit', r.tax, 'jobId', r.job_id)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void invoice ' || r.number); end if;
  end loop;

  -- Payments received: Dr cash / Cr AR (unapplied money stays as a credit in AR).
  for r in select * from public.fin_payments where book_id = p_book_id order by received_on, seq loop
    v_entry := public.fin_gl_post(p_book_id, r.received_on, 'Payment ' || r.number || ' (' || r.method || ')', 'payment', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', 'cash', 'debit', r.amount, 'jobId', r.job_id),
      jsonb_build_object('systemKey', 'ar', 'credit', r.amount, 'jobId', r.job_id)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void payment ' || r.number); end if;
  end loop;

  -- Credit memos: Dr credits & allowances / Cr AR.
  for r in select * from public.fin_credit_memos where book_id = p_book_id order by issue_date, seq loop
    v_entry := public.fin_gl_post(p_book_id, r.issue_date, 'Credit memo ' || r.number, 'credit_memo', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', 'returns', 'debit', r.amount, 'jobId', r.job_id),
      jsonb_build_object('systemKey', 'ar', 'credit', r.amount, 'jobId', r.job_id)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void credit memo ' || r.number); end if;
  end loop;

  -- Refunds to customers: Dr AR / Cr cash.
  for r in select * from public.fin_refunds where book_id = p_book_id order by refunded_on, seq loop
    v_entry := public.fin_gl_post(p_book_id, r.refunded_on, 'Refund ' || r.number, 'refund', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', 'ar', 'debit', r.amount), jsonb_build_object('systemKey', 'cash', 'credit', r.amount)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void refund ' || r.number); end if;
  end loop;

  -- Vendor and sub bills, once approved: Dr job costs (job lines) / overhead (company lines) / Cr AP.
  for r in select b.* from public.fin_vendor_bills b where b.book_id = p_book_id and b.approved_at is not null order by b.bill_date, b.seq loop
    select jsonb_agg(jsonb_build_object('systemKey', case when l.job_id is null then 'overhead' else 'job_costs' end, 'amount', l.amount, 'jobId', l.job_id, 'description', left(l.description, 300)) order by l.line_no)
           || jsonb_build_array(jsonb_build_object('systemKey', 'ap', 'amount', -sum(l.amount)))
      into v_lines from public.fin_vendor_bill_lines l where l.bill_id = r.id;
    if v_lines is null then
      v_lines := jsonb_build_array(jsonb_build_object('systemKey', 'overhead', 'debit', r.total), jsonb_build_object('systemKey', 'ap', 'credit', r.total));
    end if;
    v_entry := public.fin_gl_post(p_book_id, r.bill_date, 'Bill ' || r.number || ' (' || r.vendor_invoice_number || ')', 'bill', r.id::text, 'post', v_lines);
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void bill ' || r.number); end if;
  end loop;

  -- Bill payments: Dr AP / Cr cash.
  for r in select p.*, b.number as bill_number from public.fin_bill_payments p join public.fin_vendor_bills b on b.id = p.bill_id where p.book_id = p_book_id order by p.paid_on, p.created_at loop
    v_entry := public.fin_gl_post(p_book_id, r.paid_on, 'Paid bill ' || r.bill_number || ' (' || r.method || ')', 'bill_payment', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', 'ap', 'debit', r.amount), jsonb_build_object('systemKey', 'cash', 'credit', r.amount)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void bill payment for ' || r.bill_number); end if;
  end loop;

  -- Expenses (paid when entered), once approved: Dr job costs or overhead / Cr cash.
  for r in select * from public.fin_expenses where book_id = p_book_id and approved_at is not null order by spent_on, seq loop
    v_entry := public.fin_gl_post(p_book_id, r.spent_on, 'Expense ' || r.number || ': ' || left(r.description, 200), 'expense', r.id::text, 'post', jsonb_build_array(
      jsonb_build_object('systemKey', case when r.job_id is null then 'overhead' else 'job_costs' end, 'debit', r.amount, 'jobId', r.job_id),
      jsonb_build_object('systemKey', 'cash', 'credit', r.amount)));
    if r.status = 'void' then perform public.fin_gl_reverse_internal(v_entry, r.voided_at::date, 'void', 'Void expense ' || r.number); end if;
  end loop;

  select count(*) - v_before into v_n from public.fin_journal_entries where book_id = p_book_id;
  return v_n;
end $$;
revoke execute on function public.fin_gl_sync_internal(uuid) from public, anon, authenticated;
grant execute on function public.fin_gl_sync_internal(uuid) to service_role;

-- Anyone who can see company financials can bring the ledger up to date (it only derives from existing records).
create or replace function public.fin_gl_sync(p_book_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'view_company_financials', false);
  return public.fin_gl_sync_internal(p_book_id);
end $$;
revoke execute on function public.fin_gl_sync(uuid) from public, anon;
grant execute on function public.fin_gl_sync(uuid) to authenticated;

-- 6. Manual journal entries, reversals, accounts, payroll ------------------------------------------------------------
create or replace function public.fin_gl_journal_post(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; v_id uuid; v_date date := nullif(p ->> 'date', '')::date; v_lock date; l jsonb;
begin
  perform public.fin_require(p_book_id, 'post_journal_entries', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'journal.post');
  if v_prior is not null then return v_prior; end if;
  perform public.fin_gl_ensure_chart(p_book_id);
  if v_date is null then raise exception 'gl_bad_date' using errcode = '22023'; end if;
  select locked_through into v_lock from public.fin_books where id = p_book_id;
  if v_lock is not null and v_date <= v_lock then raise exception 'gl_period_closed' using errcode = '22023'; end if;
  if coalesce(btrim(p ->> 'memo'), '') = '' then raise exception 'memo_required' using errcode = '22023'; end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    if not exists (select 1 from public.fin_gl_accounts where id = (l ->> 'account')::uuid and book_id = p_book_id and active) then
      raise exception 'unknown_account' using errcode = '22023';
    end if;
    if nullif(l ->> 'jobId', '') is not null and not exists (select 1 from public.fin_jobs where id = (l ->> 'jobId')::uuid and book_id = p_book_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end loop;
  v_id := public.fin_gl_post(p_book_id, v_date, p ->> 'memo', case when (p ->> 'opening')::boolean then 'opening' else 'manual' end, gen_random_uuid()::text, 'post', coalesce(p -> 'lines', '[]'));
  if v_id is null then raise exception 'journal_needs_two_lines' using errcode = '23514'; end if;
  perform public.fin_audit(p_book_id, 'journal.posted', 'journal_entry', v_id, jsonb_build_object('date', v_date, 'memo', p ->> 'memo', 'lines', p -> 'lines'));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('entryId', v_id));
end $$;
revoke execute on function public.fin_gl_journal_post(uuid, jsonb, text) from public, anon;
grant execute on function public.fin_gl_journal_post(uuid, jsonb, text) to authenticated;

-- Reverse a manual, payroll or opening entry (automatic entries follow their source record: void the record instead).
create or replace function public.fin_gl_journal_reverse(p_entry_id uuid, p_date date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.fin_journal_entries; v_lock date; v_id uuid;
begin
  select * into e from public.fin_journal_entries where id = p_entry_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(e.book_id, 'post_journal_entries', true);
  if e.source_type not in ('manual', 'payroll', 'opening') or e.event_kind <> 'post' then raise exception 'reverse_source_instead' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_journal_entries where reverses = e.id) then raise exception 'already_reversed' using errcode = '22023'; end if;
  select locked_through into v_lock from public.fin_books where id = e.book_id;
  if v_lock is not null and coalesce(p_date, current_date) <= v_lock then raise exception 'gl_period_closed' using errcode = '22023'; end if;
  v_id := public.fin_gl_reverse_internal(e.id, coalesce(p_date, current_date), 'reversal', 'Reversal: ' || left(p_reason, 400));
  perform public.fin_audit(e.book_id, 'journal.reversed', 'journal_entry', e.id, jsonb_build_object('reversal', v_id, 'reason', p_reason));
  return jsonb_build_object('entryId', v_id);
end $$;
revoke execute on function public.fin_gl_journal_reverse(uuid, date, text) from public, anon;
grant execute on function public.fin_gl_journal_reverse(uuid, date, text) to authenticated;

create or replace function public.fin_gl_account_save(p_book_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.fin_gl_accounts; v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.fin_require(p_book_id, 'manage_accounts', true);
  perform public.fin_gl_ensure_chart(p_book_id);
  if v_id is null then
    insert into public.fin_gl_accounts (book_id, code, name, type, description, created_by)
    values (p_book_id, btrim(p ->> 'code'), btrim(p ->> 'name'), p ->> 'type', nullif(left(p ->> 'description', 300), ''), auth.uid())
    returning * into a;
  else
    select * into a from public.fin_gl_accounts where id = v_id and book_id = p_book_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if a.system_key is not null and (coalesce(p ->> 'type', a.type) <> a.type or (p ->> 'active')::boolean is false) then
      raise exception 'system_account' using errcode = '22023';
    end if;
    if (p ->> 'type') is not null and p ->> 'type' <> a.type and exists (select 1 from public.fin_journal_lines where account_id = a.id) then
      raise exception 'account_in_use' using errcode = '22023';
    end if;
    update public.fin_gl_accounts set code = coalesce(nullif(btrim(p ->> 'code'), ''), code), name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
      type = coalesce(nullif(p ->> 'type', ''), type), description = coalesce(p ->> 'description', description), active = coalesce((p ->> 'active')::boolean, active)
    where id = a.id returning * into a;
  end if;
  perform public.fin_audit(p_book_id, 'account.saved', 'gl_account', a.id, jsonb_build_object('code', a.code, 'name', a.name, 'type', a.type, 'active', a.active));
  return jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.type, 'active', a.active);
end $$;
revoke execute on function public.fin_gl_account_save(uuid, jsonb) from public, anon;
grant execute on function public.fin_gl_account_save(uuid, jsonb) to authenticated;

-- Payroll journal (the shape the payroll partner's pay-run results post into). p {payDate, reference, gross,
-- employerTaxes, withholding, net, jobAllocations?: [{jobId, amount}]}. gross = withholding + net. Job-allocated wages
-- go to Job labor; the rest to Wages. Idempotent per reference.
create or replace function public.fin_gl_payroll_post(p_book_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_gross numeric := (p ->> 'gross')::numeric; v_er numeric := coalesce((p ->> 'employerTaxes')::numeric, 0);
        v_wh numeric := coalesce((p ->> 'withholding')::numeric, 0); v_net numeric := (p ->> 'net')::numeric; v_ref text := btrim(p ->> 'reference');
        v_jobs numeric := 0; v_lines jsonb := '[]'; a jsonb; v_id uuid;
begin
  perform public.fin_require(p_book_id, 'post_journal_entries', true);
  perform public.fin_gl_ensure_chart(p_book_id);
  if coalesce(v_ref, '') = '' then raise exception 'reference_required' using errcode = '22023'; end if;
  if v_gross is null or v_net is null or v_gross <= 0 or v_net < 0 or v_er < 0 or v_wh < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_gross <> v_wh + v_net then raise exception 'payroll_unbalanced' using errcode = '22023'; end if;
  for a in select * from jsonb_array_elements(coalesce(p -> 'jobAllocations', '[]')) loop
    if not exists (select 1 from public.fin_jobs where id = (a ->> 'jobId')::uuid and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('systemKey', 'job_labor', 'debit', (a ->> 'amount')::numeric, 'jobId', a ->> 'jobId'));
    v_jobs := v_jobs + (a ->> 'amount')::numeric;
  end loop;
  if v_jobs > v_gross then raise exception 'bad_amount' using errcode = '22023'; end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('systemKey', 'wages', 'debit', v_gross - v_jobs),
    jsonb_build_object('systemKey', 'payroll_taxes', 'debit', v_er),
    jsonb_build_object('systemKey', 'payroll_liabilities', 'credit', v_wh + v_er),
    jsonb_build_object('systemKey', 'cash', 'credit', v_net));
  v_id := public.fin_gl_post(p_book_id, coalesce(nullif(p ->> 'payDate', '')::date, current_date), 'Payroll ' || v_ref, 'payroll', v_ref, 'post', v_lines);
  perform public.fin_audit(p_book_id, 'journal.payroll', 'journal_entry', v_id, jsonb_build_object('reference', v_ref, 'gross', v_gross::text));
  return jsonb_build_object('entryId', v_id);
end $$;
revoke execute on function public.fin_gl_payroll_post(uuid, jsonb) from public, anon;
grant execute on function public.fin_gl_payroll_post(uuid, jsonb) to authenticated, service_role;

-- Close (lock) the books through a date. Nothing posts on or before it afterwards; automatic postings for late
-- records land on the first open day. Reopening (moving the date back) needs a reason. Both are audited.
create or replace function public.fin_gl_lock_period(p_book_id uuid, p_through date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old date;
begin
  perform public.fin_require(p_book_id, 'close_periods', true);
  select locked_through into v_old from public.fin_books where id = p_book_id for update;
  if p_through is not null and p_through > current_date then raise exception 'gl_bad_date' using errcode = '22023'; end if;
  if (p_through is null or (v_old is not null and p_through < v_old)) and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  -- Bring the ledger up to date first so records dated in the period post inside it.
  perform public.fin_gl_sync_internal(p_book_id);
  update public.fin_books set locked_through = p_through where id = p_book_id;
  perform public.fin_audit(p_book_id, case when p_through is null or p_through < coalesce(v_old, p_through) then 'period.reopened' else 'period.closed' end,
    'book', p_book_id, jsonb_build_object('from', v_old, 'to', p_through, 'reason', nullif(btrim(p_reason), '')));
  return jsonb_build_object('lockedThrough', p_through, 'previous', v_old);
end $$;
revoke execute on function public.fin_gl_lock_period(uuid, date, text) from public, anon;
grant execute on function public.fin_gl_lock_period(uuid, date, text) to authenticated;

-- 7. Reports (read: company financials) -----------------------------------------------------------------------------
-- Balance per account through a date (and, for the income statement, from a date). Debit-normal accounts (asset,
-- cogs, expense) show debit - credit; the rest credit - debit.
create or replace function public.fin_gl_balances(p_book_id uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type text, system_key text, debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'view_company_financials', false);
  return query
  select a.id, a.code, a.name, a.type, a.system_key,
         coalesce(sum(l.debit), 0)::numeric, coalesce(sum(l.credit), 0)::numeric,
         (case when a.type in ('asset', 'cogs', 'expense') then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
               else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) end)::numeric
    from public.fin_gl_accounts a
    left join public.fin_journal_lines l on l.account_id = a.id
     and exists (select 1 from public.fin_journal_entries e where e.id = l.entry_id
                  and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to))
   where a.book_id = p_book_id
   group by a.id
   order by a.code;
end $$;
revoke execute on function public.fin_gl_balances(uuid, date, date) from public, anon;
grant execute on function public.fin_gl_balances(uuid, date, date) to authenticated;

-- Account activity with a running balance (General Ledger detail).
create or replace function public.fin_gl_activity(p_book_id uuid, p_account_id uuid, p_from date, p_to date)
returns table (entry_id uuid, entry_date date, memo text, source_type text, event_kind text, debit numeric, credit numeric, job_id uuid, description text, running numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_type text; v_open numeric;
begin
  perform public.fin_require(p_book_id, 'view_company_financials', false);
  select type into v_type from public.fin_gl_accounts where id = p_account_id and book_id = p_book_id;
  if v_type is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select coalesce(sum(case when v_type in ('asset', 'cogs', 'expense') then l.debit - l.credit else l.credit - l.debit end), 0) into v_open
    from public.fin_journal_lines l join public.fin_journal_entries e on e.id = l.entry_id
   where l.account_id = p_account_id and p_from is not null and e.entry_date < p_from;
  return query
  select e.id, e.entry_date, e.memo, e.source_type, e.event_kind, l.debit, l.credit, l.job_id, l.description,
         (v_open + sum(case when v_type in ('asset', 'cogs', 'expense') then l.debit - l.credit else l.credit - l.debit end)
                   over (order by e.entry_date, e.posted_at, l.id))::numeric
    from public.fin_journal_lines l join public.fin_journal_entries e on e.id = l.entry_id
   where l.account_id = p_account_id and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
   order by e.entry_date, e.posted_at, l.id;
end $$;
revoke execute on function public.fin_gl_activity(uuid, uuid, date, date) from public, anon;
grant execute on function public.fin_gl_activity(uuid, uuid, date, date) to authenticated;
