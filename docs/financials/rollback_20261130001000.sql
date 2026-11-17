-- Rollback for 20261130001000_fin_invoice_delete_mistake.sql. Deploy the previous app version first.
-- Restores the invoice guards from 20261124002000 / 20261124005000 (issued invoices can never be deleted). Deleted invoices stay
-- deleted; their full copies remain in fin_audit_log (action 'invoice.deleted').
begin;
drop function if exists public.fin_invoice_delete_mistake(uuid, text);
drop function if exists public.fin_invoice_delete_blocker(uuid);
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
create or replace function public.fin_invoice_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.fin_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
commit;
