-- Financial Command Center, Phase 1 (part 5): merging customers that have financial records.
--
-- customer_merge (20261122001000_customer_hub.sql) moves bids, photos and messages to the kept customer and
-- then deletes the other one. Financial rows reference customers with ON DELETE RESTRICT, so a merge of a
-- customer who already has a job, invoice, payment or credit memo used to fail. This re-points their
-- customer_id inside the same transaction:
--
--   * fin_jobs, fin_invoices, fin_payments and fin_credit_memos: customer_id moves to the kept customer.
--   * Nothing else changes. The frozen bill-to copy on each issued document (fin_invoices.bill_to) stays
--     exactly as it was issued, numbers / amounts / statuses are untouched, and voided rows keep their state.
--   * The immutability guards allow ONLY a customer_id change, and only while customer_merge has set the
--     transaction-local flag app.fin_customer_merge = 'on' (the same pattern as app.customer_link). Tables are
--     not writable by authenticated users (RLS read-only, no write grants), so the flag is reachable only
--     from this SECURITY DEFINER function.
--   * One fin_audit_log entry per affected book records the merge.
--
-- Safe to run more than once. Requires 20261123002000_fin_receivables.sql.
-- Rollback: docs/financials/rollback_20261123005000.sql

-- 1. Guards: let a merge change customer_id and nothing else ------------------------------------------------
create or replace function public.fin_merge_only_customer(p_new jsonb, p_old jsonb) returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('app.fin_customer_merge', true), '') = 'on' and (p_new - 'customer_id') = (p_old - 'customer_id')
$$;

-- Only status / closed_at change after a job is opened (and customer_id during a customer merge); never deleted.
create or replace function public.fin_jobs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and public.fin_merge_only_customer(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status' - 'closed_at') is distinct from (to_jsonb(old) - 'status' - 'closed_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Issued invoices are frozen: the only change allowed is issued -> void (with who/when/why), plus the
-- customer_id re-point of a customer merge (bill_to, the frozen copy, never changes).
create or replace function public.fin_invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and public.fin_merge_only_customer(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if old.status = 'issued' and not (new.status = 'void'
      and (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')
          = (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'void' then raise exception 'bad_state' using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $$;

-- Write-once rows: only the listed lifecycle columns may change (verify, void, reverse), plus the
-- customer_id re-point of a customer merge; never deleted.
create or replace function public.fin_guard_lifecycle() returns trigger
language plpgsql set search_path = public as $$
declare v_allowed text[] := tg_argv::text[]; v_new jsonb; v_old jsonb; k text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) ? 'customer_id' and public.fin_merge_only_customer(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  v_new := to_jsonb(new); v_old := to_jsonb(old);
  foreach k in array v_allowed loop v_new := v_new - k; v_old := v_old - k; end loop;
  if v_new is distinct from v_old then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if (to_jsonb(old) ->> 'status') = 'void' then
    raise exception 'record_immutable' using errcode = 'P0001';   -- a voided row never changes again
  end if;
  if to_jsonb(old) ? 'reversed_at' and (to_jsonb(old) ->> 'reversed_at') is not null then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- 2. customer_merge: same as 20261122001000 plus the financial re-point ---------------------------------------
/** Move everything from p_remove onto p_keep, fill p_keep's missing details, then delete p_remove. */
create or replace function public.customer_merge(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.customers%rowtype; r public.customers%rowtype; v_book uuid;
begin
  if auth.uid() is null or p_keep = p_remove or not public.can_edit_customer(p_keep) or not public.can_edit_customer(p_remove) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into k from public.customers where id = p_keep for update;
  select * into r from public.customers where id = p_remove for update;
  if k.company_id is distinct from r.company_id or (k.company_id is null and k.user_id <> r.user_id) then
    raise exception 'different_scope' using errcode = '42501';
  end if;
  perform set_config('app.customer_link', 'off', true);
  update public.estimates set customer_id = p_keep where customer_id = p_remove;
  perform set_config('app.customer_link', '', true);
  if to_regclass('public.project_photos') is not null then
    execute 'update public.project_photos set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
  end if;
  if to_regclass('public.comm_contacts') is not null then
    execute 'update public.comm_contacts set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
    execute 'update public.comm_messages set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
  end if;
  -- Financial records (bill-to snapshots on issued documents stay as issued).
  if to_regclass('public.fin_jobs') is not null then
    perform set_config('app.fin_customer_merge', 'on', true);
    for v_book in
      select book_id from public.fin_jobs where customer_id = p_remove
      union select book_id from public.fin_invoices where customer_id = p_remove
      union select book_id from public.fin_payments where customer_id = p_remove
      union select book_id from public.fin_credit_memos where customer_id = p_remove
    loop
      perform public.fin_audit(v_book, 'customer.merged', 'customer', p_keep, jsonb_build_object('removed', p_remove, 'removed_name', r.name));
    end loop;
    update public.fin_jobs set customer_id = p_keep where customer_id = p_remove;
    update public.fin_invoices set customer_id = p_keep where customer_id = p_remove;
    update public.fin_payments set customer_id = p_keep where customer_id = p_remove;
    update public.fin_credit_memos set customer_id = p_keep where customer_id = p_remove;
    perform set_config('app.fin_customer_merge', '', true);
  end if;
  update public.customers set
    email = coalesce(nullif(k.email, ''), r.email), phone = coalesce(nullif(k.phone, ''), r.phone),
    project_address = coalesce(nullif(k.project_address, ''), r.project_address),
    company_name = coalesce(nullif(k.company_name, ''), r.company_name),
    notes = nullif(left(concat_ws(E'\n', nullif(k.notes, ''), nullif(r.notes, '')), 4000), ''),
    source = 'manual'
  where id = p_keep;
  delete from public.customers where id = p_remove;
  if k.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (k.company_id, auth.uid(), 'customer.merged', 'customer', p_keep::text, jsonb_build_object('removed', p_remove, 'removed_name', r.name));
  end if;
end $$;
revoke execute on function public.customer_merge(uuid, uuid) from public, anon;
grant execute on function public.customer_merge(uuid, uuid) to authenticated;
