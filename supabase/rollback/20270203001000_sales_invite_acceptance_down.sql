-- Rollback for 20270203001000_sales_invite_acceptance.sql (V8.9/V8.10).
-- Removes the new functions and table; restores sales_me's earlier email-only linking. Linked reps stay linked.
drop function if exists public.sales_invite_accept(text);
drop function if exists public.set_my_workspace(text, text, text);
drop function if exists public.my_workspaces();
drop table if exists public.account_preferences;
alter table public.sales_rep_invites drop column if exists accepted_by, drop column if exists accepted_email;
create or replace function public.sales_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; v_email text; v_confirmed timestamptz;
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
  return jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status, 'code', rep.code, 'sells', rep.sells);
end $$;
