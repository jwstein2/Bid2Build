-- V8.4 QuickBooks Online hours sync.
-- A contractor connects their QuickBooks company, matches Built2Bid workers to QuickBooks employees (or vendors)
-- and projects to QuickBooks customers, then sends APPROVED time entries as QuickBooks time activities, which
-- QuickBooks Payroll picks up. Built2Bid never runs payroll or moves money here.
--
-- Writes happen only from server routes with the service role, after public.qb_my_scope() confirms the signed-in
-- user manages the team. Managers can read their own scope's rows; OAuth tokens are never readable from the browser.
-- Rollback: docs/quickbooks/rollback_20270214005000.sql

create table if not exists public.qb_connections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies (id) on delete cascade,
  owner_id        uuid references auth.users (id) on delete cascade,
  realm_id        text not null check (realm_id ~ '^[0-9]{1,32}$'),
  company_name    text check (char_length(company_name) <= 200),
  environment     text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  status          text not null default 'active' check (status in ('active', 'needs_reauth', 'disconnected')),
  last_sync_at    timestamptz,
  last_error      text check (char_length(last_error) <= 300),
  connected_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  disconnected_by uuid references auth.users (id) on delete set null,
  disconnected_at timestamptz,
  constraint qb_connections_scope check ((company_id is null) <> (owner_id is null)),
  constraint qb_connections_disc check ((status = 'disconnected') = (disconnected_at is not null))
);
create unique index if not exists qb_connections_one_live on public.qb_connections (coalesce(company_id, owner_id)) where status <> 'disconnected';

create table if not exists public.qb_connection_secrets (
  connection_id      uuid primary key references public.qb_connections (id) on delete cascade,
  access_ciphertext  text not null check (char_length(access_ciphertext) between 16 and 8000),
  refresh_ciphertext text not null check (char_length(refresh_ciphertext) between 16 and 8000),
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz,
  updated_at         timestamptz not null default now()
);

create table if not exists public.qb_worker_links (
  connection_id uuid not null references public.qb_connections (id) on delete cascade,
  resource_id   uuid not null references public.pm_resources (id) on delete cascade,
  qb_type       text not null check (qb_type in ('Employee', 'Vendor')),
  qb_id         text not null check (qb_id ~ '^[0-9]{1,32}$'),
  qb_name       text check (char_length(qb_name) <= 200),
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (connection_id, resource_id)
);

create table if not exists public.qb_job_links (
  connection_id  uuid not null references public.qb_connections (id) on delete cascade,
  schedule_id    uuid not null references public.project_schedules (id) on delete cascade,
  qb_customer_id text not null check (qb_customer_id ~ '^[0-9]{1,32}$'),
  qb_name        text check (char_length(qb_name) <= 200),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (connection_id, schedule_id)
);

-- One row per time entry sent. 'sending' is a claim taken before calling QuickBooks so two clicks never send twice.
create table if not exists public.qb_time_exports (
  connection_id       uuid not null references public.qb_connections (id) on delete cascade,
  entry_id            uuid not null references public.pm_time_entries (id) on delete cascade,
  status              text not null default 'sending' check (status in ('sending', 'sent', 'error')),
  qb_time_activity_id text check (qb_time_activity_id ~ '^[0-9]{1,32}$'),
  hours               numeric(7, 2) check (hours is null or hours between 0 and 24),
  txn_date            date,
  error               text check (char_length(error) <= 300),
  sent_by             uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (connection_id, entry_id),
  constraint qb_time_exports_sent check (status <> 'sent' or qb_time_activity_id is not null)
);
create index if not exists qb_time_exports_entry_idx on public.qb_time_exports (entry_id);

-- A link or export must belong to the same company (or solo owner) as its connection.
create or replace function public.qb_scope_guard() returns trigger
language plpgsql set search_path = public as $$
declare c public.qb_connections;
begin
  select * into c from public.qb_connections where id = new.connection_id;
  if c.id is null then raise exception 'qb_connection_missing' using errcode = '23503'; end if;
  if tg_table_name = 'qb_worker_links' then
    if not exists (select 1 from public.pm_resources r where r.id = new.resource_id
                   and r.company_id is not distinct from c.company_id and r.owner_id is not distinct from c.owner_id) then
      raise exception 'qb_scope_mismatch' using errcode = '42501';
    end if;
  elsif tg_table_name = 'qb_job_links' then
    if not exists (select 1 from public.project_schedules s where s.id = new.schedule_id
                   and ((c.company_id is not null and s.company_id = c.company_id) or (c.owner_id is not null and s.company_id is null and s.user_id = c.owner_id))) then
      raise exception 'qb_scope_mismatch' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.pm_time_entries e where e.id = new.entry_id
                   and e.company_id is not distinct from c.company_id and e.owner_id is not distinct from c.owner_id) then
      raise exception 'qb_scope_mismatch' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists qb_worker_links_scope on public.qb_worker_links;
create trigger qb_worker_links_scope before insert or update on public.qb_worker_links for each row execute function public.qb_scope_guard();
drop trigger if exists qb_job_links_scope on public.qb_job_links;
create trigger qb_job_links_scope before insert or update on public.qb_job_links for each row execute function public.qb_scope_guard();
drop trigger if exists qb_time_exports_scope on public.qb_time_exports;
create trigger qb_time_exports_scope before insert or update on public.qb_time_exports for each row execute function public.qb_scope_guard();

-- Read access: people who manage the team in that scope. No write grants at all; the server writes.
alter table public.qb_connections enable row level security;
alter table public.qb_connection_secrets enable row level security;
alter table public.qb_worker_links enable row level security;
alter table public.qb_job_links enable row level security;
alter table public.qb_time_exports enable row level security;
revoke all on public.qb_connections, public.qb_connection_secrets, public.qb_worker_links, public.qb_job_links, public.qb_time_exports from public, anon, authenticated;
grant select on public.qb_connections, public.qb_worker_links, public.qb_job_links, public.qb_time_exports to authenticated;

drop policy if exists qb_connections_select on public.qb_connections;
create policy qb_connections_select on public.qb_connections for select to authenticated
  using (public.pm_team_manageable(company_id, owner_id));
drop policy if exists qb_worker_links_select on public.qb_worker_links;
create policy qb_worker_links_select on public.qb_worker_links for select to authenticated
  using (exists (select 1 from public.qb_connections c where c.id = connection_id and public.pm_team_manageable(c.company_id, c.owner_id)));
drop policy if exists qb_job_links_select on public.qb_job_links;
create policy qb_job_links_select on public.qb_job_links for select to authenticated
  using (exists (select 1 from public.qb_connections c where c.id = connection_id and public.pm_team_manageable(c.company_id, c.owner_id)));
drop policy if exists qb_time_exports_select on public.qb_time_exports;
create policy qb_time_exports_select on public.qb_time_exports for select to authenticated
  using (exists (select 1 from public.qb_connections c where c.id = connection_id and public.pm_team_manageable(c.company_id, c.owner_id)));

-- Who the signed-in user is acting for, and whether they may manage the QuickBooks connection.
create or replace function public.qb_my_scope() returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o)
  select jsonb_build_object('companyId', s.c, 'ownerId', s.o,
    'canManage', auth.uid() is not null and public.pm_team_manageable(s.c, s.o)) from s
$$;
revoke execute on function public.qb_my_scope() from public, anon;
grant execute on function public.qb_my_scope() to authenticated;
-- Server-only claim before sending one entry: true when this call may send it. A failed send, or a claim stuck
-- in 'sending' for over 10 minutes (the server died mid-call), can be taken again; QuickBooks' requestid stops a
-- duplicate time activity in that case.
create or replace function public.qb_claim_export(p_connection uuid, p_entry uuid, p_user uuid, p_hours numeric, p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.qb_time_exports (connection_id, entry_id, status, hours, txn_date, sent_by)
  values (p_connection, p_entry, 'sending', p_hours, p_date, p_user)
  on conflict (connection_id, entry_id) do update
    set status = 'sending', hours = excluded.hours, txn_date = excluded.txn_date, sent_by = excluded.sent_by, error = null
    where public.qb_time_exports.status = 'error'
       or (public.qb_time_exports.status = 'sending' and public.qb_time_exports.updated_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function public.qb_claim_export(uuid, uuid, uuid, numeric, date) from public, anon, authenticated;
grant execute on function public.qb_claim_export(uuid, uuid, uuid, numeric, date) to service_role;
revoke execute on function public.qb_scope_guard() from public, anon, authenticated;
