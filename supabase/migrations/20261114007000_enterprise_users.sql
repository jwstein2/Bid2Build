-- Enterprise Phase 3: invitation preview for the join page, team listing, and member recovery lookup.
-- Requires 20261114005000_enterprise_workspace.sql. Safe to run more than once.

-- What the invite link is for, without accepting it. Reveals only the company name, role and the
-- invited address's domain-masked form, and only for a valid, unexpired token.
create or replace function public.peek_company_invitation(p_token text)
returns table (company_name text, role text, email_hint text, expires_at timestamptz, email_matches boolean)
language sql stable security definer set search_path = public as $$
  select c.name, i.role,
    left(i.email, 1) || '•••@' || split_part(i.email, '@', 2),
    i.expires_at,
    coalesce((select lower(u.email) = i.email and u.email_confirmed_at is not null from auth.users u where u.id = auth.uid()), false)
  from public.company_invitations i join public.companies c on c.id = i.company_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;
revoke execute on function public.peek_company_invitation(text) from public;
grant execute on function public.peek_company_invitation(text) to anon, authenticated;

-- Teams with member counts for the Users & Permissions page.
create or replace function public.company_teams_overview()
returns table (id uuid, name text, trade text, member_count integer, manager_count integer)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return query select t.id, t.name, t.trade,
      count(tm.user_id)::integer, count(tm.user_id) filter (where tm.is_manager)::integer
    from public.company_teams t left join public.company_team_members tm on tm.team_id = t.id
    where t.company_id = v_company group by t.id order by lower(t.name);
end $$;

-- Email of a member, for a user admin starting secure account recovery (the sign-in link goes to the
-- member's own verified address; the admin never sees a password or code).
create or replace function public.company_member_recovery_email(p_user_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_email text;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from public.company_members m join auth.users u on u.id = m.user_id
  where m.company_id = v_company and m.user_id = p_user_id and m.status = 'active' and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'no_verified_email' using errcode = 'P0002'; end if;
  perform public.company_audit(v_company, 'member.recovery_sent', 'user', p_user_id::text, null);
  return v_email;
end $$;

-- Custom grants/revocations per member, so the access editor starts from what each person really has
-- (company_roster only returns the role). User admins only.
create or replace function public.company_member_access()
returns table (user_id uuid, permissions_granted text[], permissions_revoked text[])
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select m.user_id, m.permissions_granted, m.permissions_revoked
    from public.company_members m where m.company_id = v_company;
end $$;

revoke execute on function public.company_teams_overview(), public.company_member_recovery_email(uuid), public.company_member_access() from public, anon;
grant execute on function public.company_teams_overview(), public.company_member_recovery_email(uuid), public.company_member_access() to authenticated;
