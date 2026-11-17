-- Rollback for 20261124005000_fin_customer_merge.sql (customer merge re-points financial records).
-- Deploy the previous app version first. Restores customer_merge as defined in 20261122001000_customer_hub.sql
-- (a merge of customers with financial records fails again with a foreign-key error) and the immutability
-- guards as defined in 20261124002000_fin_receivables.sql. Records already merged stay on the kept customer.
-- Rollbacks run newest first: 005, 004, 003, 002, 001.
begin;
create or replace function public.customer_merge(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.customers%rowtype; r public.customers%rowtype;
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

create or replace function public.fin_jobs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status' - 'closed_at') is distinct from (to_jsonb(old) - 'status' - 'closed_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.fin_invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
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

create or replace function public.fin_guard_lifecycle() returns trigger
language plpgsql set search_path = public as $$
declare v_allowed text[] := tg_argv::text[]; v_new jsonb; v_old jsonb; k text;
begin
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

drop function if exists public.fin_merge_only_customer(jsonb, jsonb);
commit;
