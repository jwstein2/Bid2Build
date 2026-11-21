-- Rollback for 20270212001000_worker_invites.sql. Logins already linked to staff records stay linked.
drop trigger if exists company_invitations_link_worker on public.company_invitations;
drop function if exists public.pm_worker_invite_link();
drop function if exists public.pm_worker_invite_create(uuid, text);
drop function if exists public.pm_worker_invite_status(uuid);
drop index if exists public.company_invitations_resource_idx;
alter table public.company_invitations drop column if exists resource_id;
