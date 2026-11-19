-- Rollback for 20270113001000_sales_v83_roles.sql. Sales Administrators become plain reps again and the
-- owner-only wrappers are removed (the original V8.2 functions get their names back).
drop function if exists public.sales_my_notifications();
drop function if exists public.admin_sales_members(uuid);
drop function if exists public.admin_sales_rep_detail(uuid, uuid, timestamptz, timestamptz);
drop function if exists public.admin_sales_analytics(uuid, timestamptz, timestamptz);
drop function if exists public.sales_rep_metrics(uuid, timestamptz, timestamptz);

drop function if exists public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean, text, boolean);
alter function public.admin_sales_settings_save_v82(uuid, text, text, text, integer, integer, boolean, text, boolean) rename to admin_sales_settings_save;
alter function public.admin_sales_settings_save_v1(uuid, text, text, text, integer, integer, boolean) rename to admin_sales_settings_save;
grant execute on function public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean) to service_role;
drop function if exists public.admin_sales_milestone_rules_save(uuid, integer, jsonb, integer, jsonb, text);
alter function public.admin_sales_milestone_rules_save_v82(uuid, integer, jsonb, integer, jsonb, text) rename to admin_sales_milestone_rules_save;
drop function if exists public.admin_sales_payout_record(uuid, uuid, text, text, date);
alter function public.admin_sales_payout_record_v82(uuid, uuid, text, text, date) rename to admin_sales_payout_record;
drop function if exists public.admin_sales_commission_set(uuid, uuid, text, integer, text);
alter function public.admin_sales_commission_set_v82(uuid, uuid, text, integer, text) rename to admin_sales_commission_set;
drop function if exists public.admin_sales_statement_approve(uuid, uuid);
alter function public.admin_sales_statement_approve_v82(uuid, uuid) rename to admin_sales_statement_approve;
drop function if exists public.admin_sales_milestone_approve(uuid, uuid);
alter function public.admin_sales_milestone_approve_v82(uuid, uuid) rename to admin_sales_milestone_approve;
drop function if exists public.admin_sales_milestone_void(uuid, uuid, text);
alter function public.admin_sales_milestone_void_v82(uuid, uuid, text) rename to admin_sales_milestone_void;
drop function if exists public.sales_is_own_rep(uuid, uuid);

-- Restore the V8.2 rep save (owner emails can't be reps; roles rep|manager).
drop function if exists public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text);
-- Add or update a sales staff member. Email identifies the person; a new person gets a permanent code.
create or replace function public.admin_sales_rep_save(
  p_caller uuid, p_id uuid, p_email text, p_full_name text, p_phone text, p_role text, p_status text, p_payout_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.sales_require_admin(p_caller);
  if p_role not in ('rep', 'manager') then raise exception 'invalid_role'; end if;
  if p_status not in ('invited', 'active', 'suspended', 'removed') then raise exception 'invalid_status'; end if;
  if exists (select 1 from public.admin_roles a join auth.users u on u.id = a.user_id where lower(u.email) = v_email) then
    raise exception 'owner_cannot_be_rep';
  end if;
  if p_id is null then
    insert into public.sales_reps (email, full_name, phone, role, status, code, payout_note, invited_by, user_id, activated_at)
    values (v_email, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), p_role, 'invited', public.sales_new_code(), nullif(btrim(coalesce(p_payout_note, '')), ''), p_caller, null, null)
    returning * into rep;
    perform public.sales_audit(p_caller, 'sales.rep_invited', 'sales_rep', rep.id::text, jsonb_build_object('email', v_email, 'role', p_role));
  else
    select * into rep from public.sales_reps where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update public.sales_reps set
      email = case when user_id is null then v_email else email end,
      full_name = btrim(p_full_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), role = p_role,
      -- An invited person becomes active only by signing in; the owner can suspend, remove or restore.
      status = case when p_status = 'active' and user_id is null then 'invited' when p_status = 'invited' and user_id is not null then 'active' else p_status end,
      payout_note = nullif(btrim(coalesce(p_payout_note, '')), ''), updated_at = now()
    where id = p_id returning * into rep;
    perform public.sales_audit(p_caller, 'sales.rep_updated', 'sales_rep', rep.id::text, jsonb_build_object('role', rep.role, 'status', rep.status));
  end if;
  return to_jsonb(rep);
end $$;

-- Assign (or reassign) a customer account to a rep by hand. A reason is required and recorded.
revoke execute on function public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text) to service_role;
drop function if exists public.admin_sales_member_save(uuid, uuid, text, text, text, text, text, text, boolean);

create or replace function public.sales_require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then raise exception 'not_authorized' using errcode = '42501'; end if;
end $$;
drop function if exists public.sales_require_cap(uuid, text);
drop function if exists public.sales_my_capabilities();
drop function if exists public.sales_capabilities(uuid);

-- The caller's sales staff record. Links an invited record on first sign-in with the same verified email.
create or replace function public.sales_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select * into rep from public.sales_reps where user_id = auth.uid();
  if not found then
    select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
    if v_email is null or v_confirmed is null then return null; end if;
    update public.sales_reps set user_id = auth.uid(), status = case when status = 'invited' then 'active' else status end,
      activated_at = coalesce(activated_at, now()), updated_at = now()
    where email = v_email and user_id is null and status in ('invited', 'active')
    returning * into rep;
    if not found then return null; end if;
  end if;
  if rep.status not in ('active') then return jsonb_build_object('status', rep.status); end if;
  return jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status, 'code', rep.code);
end $$;

update public.sales_reps set role = 'rep', sells = true where role = 'admin';
alter table public.sales_reps drop constraint if exists sales_reps_sells_role;
alter table public.sales_reps drop column if exists sells;
alter table public.sales_reps drop constraint if exists sales_reps_role_check;
alter table public.sales_reps add constraint sales_reps_role_check check (role in ('rep', 'manager'));
