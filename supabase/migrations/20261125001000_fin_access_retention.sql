-- Financial Command Center: owner decisions of 2026-11-17 (Phase 1 follow-up).
--
--   1. A Financials seat on its own opens a job's financials. fin_job_header() returns the bid's basic
--      details (title, customer, stage) to anyone fin_job_visible() lets see the job, so a bookkeeper or
--      accountant does not also need the "view company bids" permission. It never exposes line items,
--      costs or margins; those stay behind the bid's own permissions.
--   2. Record retention. Issued financial records (jobs, invoices, payments, credits, refunds, bills,
--      expenses, commitments, documents) are kept for 7 years after the last financial activity in the
--      book, the longest common IRS lookback for business records. When someone deletes their account:
--        * a solo book with no records (only setup rows) is purged, so the account deletes normally;
--        * a solo book with records gets a retention hold; the app closes the account (sign-in blocked,
--          subscriptions canceled) instead of hard-deleting it, and the records stay read-only.
--      Company books belong to the company; a company owner already cannot delete their login while the
--      company exists (companies.owner_user_id is ON DELETE RESTRICT).
--
-- Safe to run more than once. Requires 20261124001000 through 20261124005000.

-- 1. Job header for Financials-only seats -------------------------------------------------------------------
create or replace function public.fin_job_header(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j public.fin_jobs; e record;
begin
  if auth.uid() is null then return null; end if;
  select * into j from public.fin_jobs where estimate_id = p_estimate_id;
  if not found or not public.fin_job_visible(j.id) then return null; end if;
  select id, title, customer_name, customer_email, customer_id, pipeline_stage, trades, company_id, user_id
    into e from public.estimates where id = p_estimate_id;
  if not found then return null; end if;
  return jsonb_build_object('id', e.id, 'title', e.title, 'customer_name', e.customer_name, 'customer_email', e.customer_email,
    'customer_id', e.customer_id, 'pipeline_stage', e.pipeline_stage, 'trades', to_jsonb(e.trades), 'company_id', e.company_id,
    'user_id', e.user_id, 'bid_readable', public.estimate_readable(p_estimate_id));
end $$;
revoke execute on function public.fin_job_header(uuid) from public, anon;
grant execute on function public.fin_job_header(uuid) to authenticated;

-- 2. Retention ----------------------------------------------------------------------------------------------
create or replace function public.fin_retention_years() returns integer
language sql immutable as $$ select 7 $$;

-- True while fin_purge_empty_book() is deleting this book's setup rows (transaction-local setting that only
-- that service-role function sets). Lets the append-only guards allow that one purge.
create or replace function public.fin_purging(p_book_id text) returns boolean
language sql stable as $$
  select p_book_id is not null and coalesce(current_setting('fin.purge_book', true), '') = p_book_id
$$;

create or replace function public.fin_guard_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and public.fin_purging(to_jsonb(old) ->> 'book_id') then return old; end if;
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;

create or replace function public.fin_cost_codes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and public.fin_purging(old.book_id::text) then return old; end if;
  if tg_op = 'DELETE' or (to_jsonb(new) - 'name' - 'active') is distinct from (to_jsonb(old) - 'name' - 'active') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Does the book hold financial records (anything beyond setup)? Vendors count: they cannot be deleted.
create or replace function public.fin_book_has_records(p_book_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t text; v boolean;
begin
  foreach t in array array['fin_jobs', 'fin_invoices', 'fin_payments', 'fin_credit_memos', 'fin_refunds', 'fin_vendor_bills',
                           'fin_expenses', 'fin_commitments', 'fin_documents', 'fin_vendors'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I where book_id = $1)', t) into v using p_book_id;
      if v then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function public.fin_book_has_records(uuid) from public, anon, authenticated;

-- The date the records can be deleted: 7 years after the last financial activity in the book.
create or replace function public.fin_book_retain_until(p_book_id uuid) returns date
language sql stable security definer set search_path = public as $$
  select ((greatest(coalesce((select max(created_at) from public.fin_audit_log where book_id = p_book_id), now()),
                    coalesce((select created_at from public.fin_books where id = p_book_id), now()))
          + make_interval(years => public.fin_retention_years()))::date)
$$;
revoke execute on function public.fin_book_retain_until(uuid) from public, anon, authenticated;

create table if not exists public.fin_retention_holds (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.fin_books (id) on delete restrict,
  user_id        uuid not null,                 -- no FK: the record outlives the login
  reason         text not null default 'account_closed' check (reason in ('account_closed')),
  retain_until   date not null,
  created_at     timestamptz not null default now(),
  released_at    timestamptz
);
create unique index if not exists fin_retention_holds_open on public.fin_retention_holds (book_id) where released_at is null;
alter table public.fin_retention_holds enable row level security;   -- service role only (no policies)
revoke all on public.fin_retention_holds from anon, authenticated;

-- Deletes an EMPTY book (no records) and its setup rows. Raises if it has records.
create or replace function public.fin_purge_empty_book(p_book_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_left integer; v_pass integer := 0; v_err text;
begin
  perform 1 from public.fin_books where id = p_book_id for update;
  if not found then return; end if;
  if public.fin_book_has_records(p_book_id) then raise exception 'book_has_records' using errcode = 'P0001'; end if;
  perform set_config('fin.purge_book', p_book_id::text, true);
  loop
    v_pass := v_pass + 1; v_left := 0;
    for r in
      select c.conrelid::regclass::text as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.fin_books'::regclass and array_length(c.conkey, 1) = 1
    loop
      begin
        execute format('delete from %s where %I = $1', r.tbl, r.col) using p_book_id;
      exception when foreign_key_violation then
        v_left := v_left + 1; v_err := r.tbl;
      end;
    end loop;
    exit when v_left = 0;
    if v_pass >= 6 then raise exception 'purge_blocked: %', v_err using errcode = 'P0001'; end if;
  end loop;
  delete from public.fin_books where id = p_book_id;
  perform set_config('fin.purge_book', '', true);
end $$;
revoke execute on function public.fin_purge_empty_book(uuid) from public, anon, authenticated;

-- Called by the account-deletion route (service role) before deleting a login.
-- Returns {action: 'delete'} when nothing must be kept (empty books are purged),
-- or {action: 'retain', retainUntil} after placing a hold: the app must then close, not delete, the login.
create or replace function public.fin_prepare_account_deletion(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.fin_books; v_until date;
begin
  select * into b from public.fin_books where owner_user_id = p_user_id for update;
  if not found then return jsonb_build_object('action', 'delete'); end if;
  if not public.fin_book_has_records(b.id) then
    perform public.fin_purge_empty_book(b.id);
    return jsonb_build_object('action', 'delete');
  end if;
  v_until := public.fin_book_retain_until(b.id);
  insert into public.fin_retention_holds (book_id, user_id, retain_until) values (b.id, p_user_id, v_until)
    on conflict (book_id) where released_at is null do update set retain_until = greatest(fin_retention_holds.retain_until, excluded.retain_until);
  perform public.fin_audit(b.id, 'retention.hold', 'user', p_user_id, jsonb_build_object('retain_until', v_until));
  return jsonb_build_object('action', 'retain', 'retainUntil', v_until);
end $$;
revoke execute on function public.fin_prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.fin_prepare_account_deletion(uuid) to service_role;
