-- Rollback for 20261213001000_fin_accounting.sql (V6.3 Accountant Mode).
-- Drops bank accounts, statement imports, bank lines, matches and reconciliation periods, the export log and
-- audit-trail functions, and puts fin_cost_fill / fin_cost_rows_guard / fin_book_has_records back to their
-- earlier versions. Expenses and bills keep any project/vendor filled in through the new fill-once path;
-- the scope_section_id columns are dropped. Audit log entries written by these functions stay (append-only).

drop function if exists public.fin_audit_list(uuid, jsonb);
drop function if exists public.fin_redact(jsonb);
drop function if exists public.fin_export_log(uuid, text, jsonb);
drop function if exists public.fin_bank_reconcile_reopen(uuid, text);
drop function if exists public.fin_bank_reconcile(uuid, jsonb);
drop function if exists public.fin_bank_balance(uuid, date);
drop function if exists public.fin_bank_create_expense(uuid, jsonb);
drop function if exists public.fin_bank_unmatch(uuid, text);
drop function if exists public.fin_bank_match(uuid, jsonb);
drop function if exists public.fin_bank_line_locked(uuid);
drop function if exists public.fin_bank_import(uuid, jsonb);
drop function if exists public.fin_bank_account_save(uuid, jsonb);

drop table if exists public.fin_reconciliations;
drop function if exists public.fin_reconciliations_guard();
drop table if exists public.fin_bank_matches;
drop function if exists public.fin_bank_matches_guard();
drop table if exists public.fin_bank_transactions;
drop table if exists public.fin_bank_imports;
drop table if exists public.fin_bank_accounts;

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

create or replace function public.fin_cost_rows_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_new jsonb; v_old jsonb; k text;
begin
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if (to_jsonb(old) ->> 'status') = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  v_new := to_jsonb(new); v_old := to_jsonb(old);
  foreach k in array tg_argv::text[] loop v_new := v_new - k; v_old := v_old - k; end loop;
  foreach k in array array['cost_code_id', 'receipt_document_id'] loop
    if v_old ? k and (v_old ->> k) is null then v_new := v_new - k; v_old := v_old - k; end if;
  end loop;
  if v_new is distinct from v_old then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function public.fin_cost_fill(p_entity_type text, p_entity_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_book uuid; v_code uuid := nullif(p ->> 'costCodeId', '')::uuid; v_doc uuid := nullif(p ->> 'receiptDocumentId', '')::uuid;
begin
  if p_entity_type = 'bill_line' then
    select book_id into v_book from public.fin_vendor_bill_lines where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_bills', true);
  elsif p_entity_type = 'expense' then
    select book_id into v_book from public.fin_expenses where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_expenses', true);
  else
    raise exception 'bad_entity' using errcode = '22023';
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
  perform public.fin_audit(v_book, 'cost.filled', p_entity_type, p_entity_id, p);
end $$;
revoke execute on function public.fin_cost_fill(text, uuid, jsonb) from public, anon;
grant execute on function public.fin_cost_fill(text, uuid, jsonb) to authenticated;

alter table public.fin_expenses drop column if exists scope_section_id;
alter table public.fin_vendor_bill_lines drop column if exists scope_section_id;
