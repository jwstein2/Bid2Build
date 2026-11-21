-- V8.3.1 Worker app invites: a company sends a staff member a link that creates their login, joins the company and
-- links the login to their existing Staff record (pm_resources), so they land in My work (/clock).
-- Reuses company invitations (same seat rules, same /company/join page, same one-time hashed token).
-- New: company_invitations.resource_id, pm_worker_invite_create / pm_worker_invite_status, and a trigger that links
-- the staff record when the invitation is accepted. Rollback: docs/worker-invites/rollback_20270212001000.sql.

alter table public.company_invitations add column if not exists resource_id uuid references public.pm_resources (id) on delete set null;
create index if not exists company_invitations_resource_idx on public.company_invitations (resource_id) where resource_id is not null;

-- Link status for one staff record: has a login, or a pending invitation (email + expiry, never the token).
create or replace function public.pm_worker_invite_status(p_resource_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; i public.company_invitations;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from public.company_invitations
    where resource_id = r.id and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc limit 1;
  return jsonb_build_object('resourceId', r.id, 'kind', r.kind, 'linked', r.linked_user_id is not null, 'email', r.email, 'phone', r.phone,
    'company', r.company_id is not null,
    'canInvite', r.company_id is not null and public.has_company_permission(r.company_id, 'manage_users'),
    'pending', case when i.id is not null then jsonb_build_object('id', i.id, 'email', i.email, 'expiresAt', i.expires_at) end);
end $$;
revoke execute on function public.pm_worker_invite_status(uuid) from public, anon;
grant execute on function public.pm_worker_invite_status(uuid) to authenticated;

-- Invite a staff member to the worker app. If someone with that email is already an active member of the company,
-- their login is linked right away (no seat used). Otherwise a company invitation (role viewer) is created that uses a
-- seat the company already pays for, exactly like inviting a teammate. Re-inviting replaces the old link.
create or replace function public.pm_worker_invite_create(p_resource_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.pm_resources; v_company uuid := public.my_company_id(); v_email text := lower(btrim(coalesce(p_email, '')));
  v_member uuid; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_id uuid; v_exp timestamptz; v_ent record;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.company_id is null or v_company is null or r.company_id <> v_company then raise exception 'company_required' using errcode = 'P0001'; end if;
  if not public.has_company_permission(v_company, 'manage_users') then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.kind <> 'staff' then raise exception 'staff_only' using errcode = '22023'; end if;
  if r.status <> 'active' then raise exception 'archived' using errcode = '22023'; end if;
  if r.linked_user_id is not null then raise exception 'already_linked' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  perform 1 from public.companies where id = v_company for update; -- serialize seat changes

  select m.user_id into v_member from public.company_members m where m.company_id = v_company and lower(m.email) = v_email and m.status = 'active' limit 1;
  if v_member is not null then
    if exists (select 1 from public.pm_resources x where x.company_id = v_company and x.linked_user_id = v_member) then
      raise exception 'login_in_use' using errcode = 'P0001';
    end if;
    update public.pm_resources set linked_user_id = v_member, email = coalesce(email, v_email), updated_at = now() where id = r.id;
    perform public.company_audit(v_company, 'worker.linked', 'resource', r.id::text, jsonb_build_object('email', v_email));
    return jsonb_build_object('status', 'linked');
  end if;

  update public.company_invitations set revoked_at = now()
    where company_id = v_company and accepted_at is null and revoked_at is null and (email = v_email or resource_id = r.id);
  select * into v_ent from public.company_entitlement(v_company);
  if not v_ent.active or public.company_seats_used(v_company) + 1 > v_ent.seat_limit then
    raise exception 'no_seats_available' using errcode = 'P0001';
  end if;
  insert into public.company_invitations (company_id, email, role, team_id, token_hash, invited_by, resource_id)
    values (v_company, v_email, 'viewer', null, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), r.id)
    returning id, expires_at into v_id, v_exp;
  update public.pm_resources set email = coalesce(email, v_email), updated_at = now() where id = r.id;
  perform public.company_audit(v_company, 'worker.invited', 'invitation', v_id::text, jsonb_build_object('email', v_email, 'resource', r.id));
  return jsonb_build_object('status', 'invited', 'id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;
revoke execute on function public.pm_worker_invite_create(uuid, text) from public, anon;
grant execute on function public.pm_worker_invite_create(uuid, text) to authenticated;

-- When a worker invitation is accepted, link the new member's login to the staff record (if still unlinked and the
-- login isn't already linked to another record in the company).
create or replace function public.pm_worker_invite_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resource_id is not null and new.accepted_at is not null and old.accepted_at is null and new.accepted_by is not null
     and not exists (select 1 from public.pm_resources x where x.company_id = new.company_id and x.linked_user_id = new.accepted_by) then
    update public.pm_resources set linked_user_id = new.accepted_by, updated_at = now()
      where id = new.resource_id and company_id = new.company_id and kind = 'staff' and linked_user_id is null;
  end if;
  return new;
end $$;
revoke execute on function public.pm_worker_invite_link() from public, anon, authenticated;
drop trigger if exists company_invitations_link_worker on public.company_invitations;
create trigger company_invitations_link_worker after update of accepted_at on public.company_invitations
  for each row execute function public.pm_worker_invite_link();
