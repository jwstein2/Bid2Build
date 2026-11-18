-- Team records: supplier directory, employee directory + time clock, subcontractor records.
--
--   1. pm_suppliers: the company's (or solo account's) suppliers. Supplier price imports
--      (price_imports) link to a supplier, so each supplier shows its price lists and the Saved Items
--      it prices. Older imports match by supplier name until they're linked.
--   2. pm_employee_profiles: job title, pay type, hourly cost rate (managers only), hire date and an
--      emergency contact for each Staff entry in Team & Subcontractors. Staff entries stay the one
--      list of employees (archive, never delete).
--   3. pm_time_entries (+ pm_time_entry_changes): clock in / clock out. A staff member linked to a
--      Built2Bid login clocks themselves; managers can add or fix entries (every edit is logged with a
--      reason) and approve them. Location is recorded only at the moment of a punch and only when the
--      person ticks "Include my location"; it is cleared after 90 days. There is no tracking between
--      punches. Approved hours x the hourly cost rate give labor cost per project. Built2Bid never
--      calculates payroll tax or pays anyone.
--   4. pm_sub_tax_profiles: W-9 details for a subcontractor. Only the last 4 digits of the SSN/EIN
--      are stored in the database; the full number lives only in the uploaded W-9 file, which is kept
--      in the private sub-records bucket and opened through a short-lived link after a permission check.
--   5. pm_sub_documents: W-9, insurance certificates (with expiry), licenses, agreements and lien
--      waivers. Recorded as "on file", never as "verified". Nothing blocks a payment automatically.
--   6. pm_sub_1099_totals: payments to each subcontractor in a calendar year from the Financials
--      books (bill payments + approved expenses), excluding card payments (the card company reports
--      those on 1099-K). Threshold: $600 through tax year 2025, $2,000 from tax year 2026.
--
-- Access: suppliers are visible to every active company member; employee profiles and time entries to
-- people who can manage Team & Subcontractors (staff see their own time); subcontractor tax details and
-- documents only to the owner and people with "Manage subcontractor compliance". Writes only through the
-- RPCs below. Safe to run more than once. Requires 20261118002000_team_assignments.sql and
-- 20261127001000_pricing_v5_supplier_import.sql. Rollback: docs/team-records/rollback_20261210001000.sql

-- 0. Helpers -----------------------------------------------------------------------------------------
-- The caller's own scope (company, or solo account when not in a company).
create or replace function public.team_in_my_scope(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and case
    when public.my_company_id() is not null then p_company = public.my_company_id()
    else p_company is null and p_owner = auth.uid() end, false)
$$;

-- Subcontractor tax details and documents: solo owner, company owner, or "Manage subcontractor compliance"
-- (company role or financial seat).
create or replace function public.sub_compliance_manageable(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and case
    when p_company is null then p_owner = auth.uid()
    else public.has_company_permission(p_company, 'manage_sub_compliance')
      or exists (select 1 from public.fin_books b where b.company_id = p_company and public.fin_has_permission(b.id, 'manage_sub_compliance', false))
  end, false)
$$;

-- Suppliers: anyone who manages the team, or who manages company pricing.
create or replace function public.supplier_manageable(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.pm_team_manageable(p_company, p_owner)
    or (p_company is not null and public.has_company_permission(p_company, 'manage_company_pricing')))
$$;

create or replace function public.team_is_company_owner(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_company is not null and exists (select 1 from public.companies c where c.id = p_company and c.owner_user_id = auth.uid())
$$;

revoke execute on function public.team_in_my_scope(uuid, uuid), public.sub_compliance_manageable(uuid, uuid),
  public.supplier_manageable(uuid, uuid), public.team_is_company_owner(uuid) from public, anon;
grant execute on function public.team_in_my_scope(uuid, uuid), public.sub_compliance_manageable(uuid, uuid),
  public.supplier_manageable(uuid, uuid), public.team_is_company_owner(uuid) to authenticated;

-- 1. Suppliers ---------------------------------------------------------------------------------------
create table if not exists public.pm_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  account_number text check (char_length(account_number) <= 80),
  rep_name text check (char_length(rep_name) <= 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  website text check (char_length(website) <= 300),
  address text check (char_length(address) <= 500),
  trades text[] not null default '{}' check (cardinality(trades) <= 20),
  notes text check (char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_suppliers_scope check ((company_id is null) <> (owner_id is null))
);
create unique index if not exists pm_suppliers_name_uq on public.pm_suppliers (coalesce(company_id, owner_id), lower(btrim(name)));
alter table public.pm_suppliers enable row level security;
drop policy if exists pm_suppliers_select on public.pm_suppliers;
create policy pm_suppliers_select on public.pm_suppliers for select to authenticated
  using ((company_id is not null and public.is_active_company_member(company_id)) or (company_id is null and owner_id = (select auth.uid())));
revoke all on public.pm_suppliers from anon, authenticated;
grant select on public.pm_suppliers to authenticated;

alter table public.price_imports add column if not exists supplier_id uuid references public.pm_suppliers (id) on delete set null;
create index if not exists price_imports_supplier_idx on public.price_imports (supplier_id) where supplier_id is not null;

-- The caller's supplier list, with their own import history and how many of their Saved Items each one prices.
create or replace function public.pm_suppliers_list() returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.pm_suppliers x where public.team_in_my_scope(x.company_id, x.owner_id)
  )
  select jsonb_build_object(
    'companyId', public.my_company_id(),
    'canManage', public.supplier_manageable(public.my_company_id(), case when public.my_company_id() is null then auth.uid() end),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'accountNumber', s.account_number, 'repName', s.rep_name, 'email', s.email,
        'phone', s.phone, 'website', s.website, 'address', s.address, 'trades', to_jsonb(s.trades), 'notes', s.notes,
        'status', s.status, 'updatedAt', s.updated_at,
        'imports', (select count(*) from public.price_imports i where i.user_id = auth.uid() and i.status = 'applied'
                     and (i.supplier_id = s.id or (i.supplier_id is null and lower(btrim(i.supplier_name)) = lower(btrim(s.name))))),
        'lastImportAt', (select max(i.created_at) from public.price_imports i where i.user_id = auth.uid() and i.status = 'applied'
                     and (i.supplier_id = s.id or (i.supplier_id is null and lower(btrim(i.supplier_name)) = lower(btrim(s.name))))),
        'pricedItems', (select count(*) from public.saved_items si where si.user_id = auth.uid() and lower(btrim(si.supplier_name)) = lower(btrim(s.name)))
      ) order by s.status, lower(s.name)) from s), '[]'::jsonb))
$$;
revoke execute on function public.pm_suppliers_list() from public, anon;
grant execute on function public.pm_suppliers_list() to authenticated;

-- One supplier's imports (the caller's own) and the Saved Items it prices.
create or replace function public.pm_supplier_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.pm_suppliers;
begin
  select * into s from public.pm_suppliers where id = p_id;
  if not found or not public.team_in_my_scope(s.company_id, s.owner_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fileName', i.file_name, 'effectiveOn', i.effective_on,
        'rows', i.rows_total, 'created', i.created_count, 'updated', i.updated_count, 'unchanged', i.unchanged_count,
        'status', i.status, 'createdAt', i.created_at, 'linked', i.supplier_id is not null) order by i.created_at desc)
      from (select * from public.price_imports i where i.user_id = auth.uid()
              and (i.supplier_id = s.id or (i.supplier_id is null and lower(btrim(i.supplier_name)) = lower(btrim(s.name))))
            order by i.created_at desc limit 50) i), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', si.id, 'name', si.name, 'unit', si.unit, 'unitCost', si.unit_cost,
        'sku', si.supplier_sku, 'priceSource', si.price_source, 'effectiveOn', si.price_effective_on) order by lower(si.name))
      from (select * from public.saved_items si where si.user_id = auth.uid() and lower(btrim(si.supplier_name)) = lower(btrim(s.name))
            order by lower(si.name) limit 500) si), '[]'::jsonb));
end $$;
revoke execute on function public.pm_supplier_detail(uuid) from public, anon;
grant execute on function public.pm_supplier_detail(uuid) to authenticated;

-- Create or update a supplier. Returns its id.
create or replace function public.pm_supplier_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_trades text[];
  r public.pm_suppliers;
begin
  if not public.supplier_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if v_id is not null then
    select * into r from public.pm_suppliers where id = v_id for update;
    if not found or r.company_id is distinct from v_company or r.owner_id is distinct from v_owner then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if exists (select 1 from public.pm_suppliers x where coalesce(x.company_id, x.owner_id) = coalesce(v_company, v_owner)
               and lower(btrim(x.name)) = lower(btrim(p ->> 'name')) and x.id is distinct from v_id) then
    raise exception 'duplicate_name' using errcode = '23505';
  end if;
  select coalesce(array_agg(distinct left(lower(btrim(x)), 40)) filter (where btrim(x) <> ''), '{}') into v_trades
    from jsonb_array_elements_text(coalesce(p -> 'trades', '[]'::jsonb)) x;
  if v_id is null then
    insert into public.pm_suppliers (company_id, owner_id, name, account_number, rep_name, email, phone, website, address, trades, notes, created_by)
    values (v_company, v_owner, left(btrim(p ->> 'name'), 200), left(nullif(btrim(p ->> 'accountNumber'), ''), 80), left(nullif(btrim(p ->> 'repName'), ''), 200),
            left(nullif(btrim(p ->> 'email'), ''), 320), left(nullif(btrim(p ->> 'phone'), ''), 40), left(nullif(btrim(p ->> 'website'), ''), 300),
            left(nullif(btrim(p ->> 'address'), ''), 500), v_trades, left(nullif(btrim(p ->> 'notes'), ''), 2000), auth.uid())
    returning id into v_id;
  else
    update public.pm_suppliers set name = left(btrim(p ->> 'name'), 200), account_number = left(nullif(btrim(p ->> 'accountNumber'), ''), 80),
      rep_name = left(nullif(btrim(p ->> 'repName'), ''), 200), email = left(nullif(btrim(p ->> 'email'), ''), 320),
      phone = left(nullif(btrim(p ->> 'phone'), ''), 40), website = left(nullif(btrim(p ->> 'website'), ''), 300),
      address = left(nullif(btrim(p ->> 'address'), ''), 500), trades = v_trades, notes = left(nullif(btrim(p ->> 'notes'), ''), 2000), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.pm_supplier_save(jsonb) from public, anon;
grant execute on function public.pm_supplier_save(jsonb) to authenticated;

create or replace function public.pm_supplier_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pm_suppliers;
begin
  if p_status not in ('active', 'archived') then raise exception 'bad_status' using errcode = '22023'; end if;
  select * into r from public.pm_suppliers where id = p_id for update;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.supplier_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pm_suppliers set status = p_status, updated_at = now() where id = p_id;
end $$;
revoke execute on function public.pm_supplier_set_status(uuid, text) from public, anon;
grant execute on function public.pm_supplier_set_status(uuid, text) to authenticated;

-- Link one of the caller's imports to a supplier. With no supplier id, finds the supplier by the import's
-- supplier name, and adds it to the directory when the caller may manage suppliers. Returns the supplier id
-- (null when nothing was linked).
create or replace function public.price_import_link_supplier(p_import_id uuid, p_supplier_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  imp public.price_imports;
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_sid uuid := p_supplier_id;
begin
  select * into imp from public.price_imports where id = p_import_id and user_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_sid is not null then
    if not exists (select 1 from public.pm_suppliers s where s.id = v_sid and public.team_in_my_scope(s.company_id, s.owner_id)) then
      raise exception 'bad_supplier' using errcode = '22023';
    end if;
  else
    select s.id into v_sid from public.pm_suppliers s
     where coalesce(s.company_id, s.owner_id) = coalesce(v_company, v_owner) and lower(btrim(s.name)) = lower(btrim(imp.supplier_name));
    if v_sid is null and public.supplier_manageable(v_company, v_owner) then
      insert into public.pm_suppliers (company_id, owner_id, name, created_by)
      values (v_company, v_owner, left(btrim(imp.supplier_name), 200), auth.uid())
      on conflict do nothing returning id into v_sid;
    end if;
  end if;
  if v_sid is not null then update public.price_imports set supplier_id = v_sid where id = imp.id; end if;
  return v_sid;
end $$;
revoke execute on function public.price_import_link_supplier(uuid, uuid) from public, anon;
grant execute on function public.price_import_link_supplier(uuid, uuid) to authenticated;

-- 2. Employee profiles -------------------------------------------------------------------------------
create table if not exists public.pm_employee_profiles (
  resource_id uuid primary key references public.pm_resources (id) on delete cascade,
  title text check (char_length(title) <= 120),
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'salary', 'owner', 'other')),
  hourly_cost numeric(10, 2) check (hourly_cost is null or hourly_cost between 0 and 10000),
  hire_date date,
  emergency_name text check (char_length(emergency_name) <= 200),
  emergency_phone text check (char_length(emergency_phone) <= 40),
  clock_enabled boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.pm_employee_profiles enable row level security;
drop policy if exists pm_employee_profiles_select on public.pm_employee_profiles;
create policy pm_employee_profiles_select on public.pm_employee_profiles for select to authenticated
  using (exists (select 1 from public.pm_resources r where r.id = resource_id and public.pm_team_manageable(r.company_id, r.owner_id)));
revoke all on public.pm_employee_profiles from anon, authenticated;
grant select on public.pm_employee_profiles to authenticated;

-- 3. Time clock --------------------------------------------------------------------------------------
create table if not exists public.pm_time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  schedule_id uuid references public.project_schedules (id) on delete set null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  break_minutes integer not null default 0 check (break_minutes between 0 and 720),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'pending', 'approved', 'rejected')),
  source text not null default 'clock' check (source in ('clock', 'manual')),
  in_lat numeric(9, 6), in_lng numeric(9, 6), in_accuracy_m integer check (in_accuracy_m is null or in_accuracy_m >= 0),
  out_lat numeric(9, 6), out_lng numeric(9, 6), out_accuracy_m integer check (out_accuracy_m is null or out_accuracy_m >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_by uuid references auth.users (id) on delete set null,
  edited_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  constraint pm_time_entries_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_time_entries_open check ((status = 'open') = (clock_out is null)),
  constraint pm_time_entries_order check (clock_out is null or clock_out > clock_in),
  constraint pm_time_entries_length check (clock_out is null or clock_out - clock_in <= interval '24 hours')
);
create unique index if not exists pm_time_entries_one_open on public.pm_time_entries (resource_id) where status = 'open';
create index if not exists pm_time_entries_scope_idx on public.pm_time_entries (coalesce(company_id, owner_id), clock_in desc);
create index if not exists pm_time_entries_resource_idx on public.pm_time_entries (resource_id, clock_in desc);
create index if not exists pm_time_entries_schedule_idx on public.pm_time_entries (schedule_id) where schedule_id is not null;

create table if not exists public.pm_time_entry_changes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.pm_time_entries (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  action text not null check (char_length(action) <= 40),
  reason text check (char_length(reason) <= 300),
  before jsonb,
  after jsonb
);
create index if not exists pm_time_entry_changes_entry_idx on public.pm_time_entry_changes (entry_id, changed_at);

-- A staff member sees their own time; managers see everyone's in their scope.
create or replace function public.pm_time_readable(p_resource uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pm_resources r where r.id = p_resource
    and (r.linked_user_id = auth.uid() or public.pm_team_manageable(r.company_id, r.owner_id)))
$$;
revoke execute on function public.pm_time_readable(uuid) from public, anon;
grant execute on function public.pm_time_readable(uuid) to authenticated;

alter table public.pm_time_entries enable row level security;
alter table public.pm_time_entry_changes enable row level security;
drop policy if exists pm_time_entries_select on public.pm_time_entries;
create policy pm_time_entries_select on public.pm_time_entries for select to authenticated using (public.pm_time_readable(resource_id));
drop policy if exists pm_time_entry_changes_select on public.pm_time_entry_changes;
create policy pm_time_entry_changes_select on public.pm_time_entry_changes for select to authenticated
  using (exists (select 1 from public.pm_time_entries e where e.id = entry_id));
revoke all on public.pm_time_entries, public.pm_time_entry_changes from anon, authenticated;
grant select on public.pm_time_entries, public.pm_time_entry_changes to authenticated;

create or replace function public.pm_time_entry_json(e public.pm_time_entries) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', e.id, 'resourceId', e.resource_id, 'scheduleId', e.schedule_id, 'clockIn', e.clock_in, 'clockOut', e.clock_out,
    'breakMinutes', e.break_minutes, 'note', e.note, 'status', e.status, 'source', e.source,
    'inLocation', case when e.in_lat is not null then jsonb_build_object('lat', e.in_lat, 'lng', e.in_lng, 'accuracyM', e.in_accuracy_m) end,
    'outLocation', case when e.out_lat is not null then jsonb_build_object('lat', e.out_lat, 'lng', e.out_lng, 'accuracyM', e.out_accuracy_m) end,
    'edited', e.edited_at is not null, 'decisionNote', e.decision_note, 'decidedAt', e.decided_at)
$$;
revoke execute on function public.pm_time_entry_json(public.pm_time_entries) from public, anon;
grant execute on function public.pm_time_entry_json(public.pm_time_entries) to authenticated;

-- Location older than 90 days is cleared (the hours stay).
create or replace function public.pm_time_purge_locations(p_company uuid, p_owner uuid) returns void
language sql security definer set search_path = public as $$
  update public.pm_time_entries set in_lat = null, in_lng = null, in_accuracy_m = null, out_lat = null, out_lng = null, out_accuracy_m = null
   where company_id is not distinct from p_company and owner_id is not distinct from p_owner
     and clock_in < now() - interval '90 days' and (in_lat is not null or out_lat is not null)
$$;
revoke execute on function public.pm_time_purge_locations(uuid, uuid) from public, anon, authenticated;

-- Employees (Staff entries) with their profile. Pay rate only for managers.
create or replace function public.pm_employees() returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o),
  mgr as (select public.pm_team_manageable(scope.c, scope.o) as m from scope)
  select jsonb_build_object(
    'canManage', (select m from mgr),
    'employees', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'email', r.email, 'phone', r.phone, 'trades', to_jsonb(r.trades), 'status', r.status,
        'linkedUserId', r.linked_user_id,
        'title', p.title, 'payType', coalesce(p.pay_type, 'hourly'),
        'hourlyCost', case when (select m from mgr) then p.hourly_cost end,
        'hireDate', case when (select m from mgr) or r.linked_user_id = auth.uid() then p.hire_date end,
        'emergencyName', case when (select m from mgr) or r.linked_user_id = auth.uid() then p.emergency_name end,
        'emergencyPhone', case when (select m from mgr) or r.linked_user_id = auth.uid() then p.emergency_phone end,
        'clockEnabled', coalesce(p.clock_enabled, true),
        'clockedInAt', (select e.clock_in from public.pm_time_entries e where e.resource_id = r.id and e.status = 'open'
                         and ((select m from mgr) or r.linked_user_id = auth.uid()))
      ) order by r.status, lower(r.name))
      from public.pm_resources r left join public.pm_employee_profiles p on p.resource_id = r.id, scope
      where r.kind = 'staff' and r.company_id is not distinct from scope.c and r.owner_id is not distinct from scope.o
        and ((select m from mgr) or public.pm_resource_readable(r.company_id, r.owner_id) or r.linked_user_id = auth.uid())), '[]'::jsonb))
$$;
revoke execute on function public.pm_employees() from public, anon;
grant execute on function public.pm_employees() to authenticated;

create or replace function public.pm_employee_profile_save(p_resource_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'staff' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_team_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p ->> 'payType', 'hourly') not in ('hourly', 'salary', 'owner', 'other') then raise exception 'bad_pay_type' using errcode = '22023'; end if;
  insert into public.pm_employee_profiles (resource_id, title, pay_type, hourly_cost, hire_date, emergency_name, emergency_phone, clock_enabled, updated_by)
  values (r.id, left(nullif(btrim(p ->> 'title'), ''), 120), coalesce(nullif(p ->> 'payType', ''), 'hourly'), nullif(p ->> 'hourlyCost', '')::numeric,
          nullif(p ->> 'hireDate', '')::date, left(nullif(btrim(p ->> 'emergencyName'), ''), 200), left(nullif(btrim(p ->> 'emergencyPhone'), ''), 40),
          coalesce((p ->> 'clockEnabled')::boolean, true), auth.uid())
  on conflict (resource_id) do update set title = excluded.title, pay_type = excluded.pay_type, hourly_cost = excluded.hourly_cost,
    hire_date = excluded.hire_date, emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
    clock_enabled = excluded.clock_enabled, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function public.pm_employee_profile_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_employee_profile_save(uuid, jsonb) to authenticated;

-- Who may punch for a staff entry: the person linked to it, or a manager (for crew without a login).
create or replace function public.pm_time_punch_allowed(r public.pm_resources) returns boolean
language sql stable security definer set search_path = public as $$
  select r.kind = 'staff' and r.status = 'active' and public.team_in_my_scope(r.company_id, r.owner_id)
    and coalesce((select p.clock_enabled from public.pm_employee_profiles p where p.resource_id = r.id), true)
    and (r.linked_user_id = auth.uid() or public.pm_team_manageable(r.company_id, r.owner_id))
$$;
revoke execute on function public.pm_time_punch_allowed(public.pm_resources) from public, anon, authenticated;

create or replace function public.pm_time_check_project(p_schedule uuid, r public.pm_resources) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_schedule is null then return; end if;
  if not exists (select 1 from public.project_schedules s where s.id = p_schedule and s.status <> 'archived'
                   and ((r.company_id is not null and s.company_id = r.company_id) or (r.company_id is null and s.company_id is null and s.user_id = r.owner_id))) then
    raise exception 'bad_project' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.pm_time_check_project(uuid, public.pm_resources) from public, anon, authenticated;

-- p {resourceId, scheduleId?, note?, lat?, lng?, accuracyM?}. Location only when the person chose to include it.
create or replace function public.pm_clock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_time_entries; v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid;
begin
  select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
  if not found or not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.pm_time_check_project(v_sched, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open') then raise exception 'already_in' using errcode = '23505'; end if;
  perform public.pm_time_purge_locations(r.company_id, r.owner_id);
  insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, clock_in, note, status, source, in_lat, in_lng, in_accuracy_m, created_by)
  values (r.company_id, r.owner_id, r.id, v_sched, now(), left(nullif(btrim(p ->> 'note'), ''), 500), 'open', 'clock',
          round(nullif(p ->> 'lat', '')::numeric, 6), round(nullif(p ->> 'lng', '')::numeric, 6),
          case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end, auth.uid())
  returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_in(jsonb) from public, anon;
grant execute on function public.pm_clock_in(jsonb) to authenticated;

-- p {entryId, breakMinutes?, note?, scheduleId?, lat?, lng?, accuracyM?}
create or replace function public.pm_clock_out(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_out timestamptz := now();
begin
  select * into e from public.pm_time_entries where id = nullif(p ->> 'entryId', '')::uuid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.pm_resources where id = e.resource_id;
  if not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  if e.status <> 'open' then raise exception 'not_open' using errcode = '22023'; end if;
  if p ? 'scheduleId' then perform public.pm_time_check_project(nullif(p ->> 'scheduleId', '')::uuid, r); end if;
  -- A forgotten punch is capped at 24 hours; a manager can fix the time afterwards.
  if v_out - e.clock_in > interval '24 hours' then v_out := e.clock_in + interval '24 hours'; end if;
  if v_out <= e.clock_in then v_out := e.clock_in + interval '1 second'; end if;
  update public.pm_time_entries set clock_out = v_out, status = 'pending',
    break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
    note = coalesce(left(nullif(btrim(p ->> 'note'), ''), 500), note),
    schedule_id = case when p ? 'scheduleId' then nullif(p ->> 'scheduleId', '')::uuid else schedule_id end,
    out_lat = round(nullif(p ->> 'lat', '')::numeric, 6), out_lng = round(nullif(p ->> 'lng', '')::numeric, 6),
    out_accuracy_m = case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end,
    updated_at = now()
  where id = e.id returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_out(jsonb) from public, anon;
grant execute on function public.pm_clock_out(jsonb) to authenticated;

-- Managers add or fix an entry. p {id?, resourceId, scheduleId?, clockIn, clockOut, breakMinutes?, note?, reason?}
-- An edit needs a reason and is logged with the before/after values. Approved entries must be reopened first.
create or replace function public.pm_time_entry_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.pm_time_entries; r public.pm_resources; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_in timestamptz := nullif(p ->> 'clockIn', '')::timestamptz; v_out timestamptz := nullif(p ->> 'clockOut', '')::timestamptz;
  v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_reason text := left(nullif(btrim(p ->> 'reason'), ''), 300); v_before jsonb;
begin
  if v_in is null or v_out is null then raise exception 'times_required' using errcode = '22023'; end if;
  if v_out <= v_in then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_out - v_in > interval '24 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if v_in > now() + interval '1 day' then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_id is not null then
    select * into e from public.pm_time_entries where id = v_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    select * into r from public.pm_resources where id = e.resource_id;
  else
    select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if r.kind <> 'staff' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_team_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.pm_time_check_project(v_sched, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.id is distinct from v_id and x.status <> 'rejected'
               and tstzrange(x.clock_in, coalesce(x.clock_out, now()), '[)') && tstzrange(v_in, v_out, '[)')) then
    raise exception 'overlap' using errcode = '23P01';
  end if;
  if v_id is null then
    insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, clock_in, clock_out, break_minutes, note, status, source, created_by)
    values (r.company_id, r.owner_id, r.id, v_sched, v_in, v_out, greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))),
            left(nullif(btrim(p ->> 'note'), ''), 500), 'pending', 'manual', auth.uid())
    returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, after) values (e.id, auth.uid(), 'added', v_reason, public.pm_time_entry_json(e));
  else
    if e.status = 'approved' then raise exception 'approved_locked' using errcode = '22023'; end if;
    if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set schedule_id = v_sched, clock_in = v_in, clock_out = v_out,
      break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
      note = left(nullif(btrim(p ->> 'note'), ''), 500), status = case when status in ('open', 'rejected') then 'pending' else status end,
      edited_by = auth.uid(), edited_at = now(), updated_at = now()
    where id = e.id returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, before, after) values (e.id, auth.uid(), 'edited', v_reason, v_before, public.pm_time_entry_json(e));
  end if;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_time_entry_save(jsonb) from public, anon;
grant execute on function public.pm_time_entry_save(jsonb) to authenticated;

-- Approve / reject / reopen. Managers only; in a company, people don't approve their own time unless
-- they are the owner. Returns how many entries changed.
create or replace function public.pm_time_entries_decide(p_ids uuid[], p_action text, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_n integer := 0; v_before jsonb;
begin
  if p_action not in ('approve', 'reject', 'reopen') then raise exception 'bad_action' using errcode = '22023'; end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then raise exception 'bad_items' using errcode = '22023'; end if;
  if p_action = 'reject' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  for e in select * from public.pm_time_entries where id = any (p_ids) order by clock_in for update loop
    select * into r from public.pm_resources where id = e.resource_id;
    if not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_team_manageable(r.company_id, r.owner_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if r.company_id is not null and r.linked_user_id = auth.uid() and not public.team_is_company_owner(r.company_id) then
      raise exception 'forbidden_own' using errcode = '42501';
    end if;
    if e.status = 'open' then continue; end if;
    if (p_action = 'approve' and e.status = 'approved') or (p_action = 'reject' and e.status = 'rejected') or (p_action = 'reopen' and e.status = 'pending') then continue; end if;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set
      status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end,
      decided_by = case when p_action = 'reopen' then null else auth.uid() end,
      decided_at = case when p_action = 'reopen' then null else now() end,
      decision_note = case when p_action = 'reopen' then null else left(nullif(btrim(p_note), ''), 300) end,
      updated_at = now()
    where id = e.id returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, before, after)
    values (e.id, auth.uid(), p_action, left(nullif(btrim(p_note), ''), 300), v_before, public.pm_time_entry_json(e));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.pm_time_entries_decide(uuid[], text, text) from public, anon;
grant execute on function public.pm_time_entries_decide(uuid[], text, text) to authenticated;

-- Time entries that overlap [p_from, p_to): managers see everyone's, staff see their own. Hourly cost rates
-- come back only for managers (for labor cost); project names for every entry the caller can see.
create or replace function public.pm_timesheet(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o),
  mgr as (select public.pm_team_manageable(scope.c, scope.o) as m from scope),
  ents as (
    select e as ent, e.clock_in, e.schedule_id, e.resource_id from public.pm_time_entries e join public.pm_resources r on r.id = e.resource_id, scope
     where e.company_id is not distinct from scope.c and e.owner_id is not distinct from scope.o
       and e.clock_in < p_to and coalesce(e.clock_out, now()) >= p_from
       and ((select m from mgr) or r.linked_user_id = auth.uid())
     order by e.clock_in desc limit 5000)
  select jsonb_build_object(
    'canManage', (select m from mgr),
    'entries', coalesce((select jsonb_agg(public.pm_time_entry_json(ents.ent) order by ents.clock_in desc) from ents), '[]'::jsonb),
    'projects', coalesce((select jsonb_object_agg(s.id, s.name) from public.project_schedules s where s.id in (select schedule_id from ents)), '{}'::jsonb),
    'rates', case when (select m from mgr) then coalesce((select jsonb_object_agg(p.resource_id, p.hourly_cost) from public.pm_employee_profiles p
                 where p.hourly_cost is not null and p.resource_id in (select resource_id from ents)), '{}'::jsonb) else '{}'::jsonb end)
$$;
revoke execute on function public.pm_timesheet(timestamptz, timestamptz) from public, anon;
grant execute on function public.pm_timesheet(timestamptz, timestamptz) to authenticated;

-- One entry's change history (managers and the person themselves).
create or replace function public.pm_time_entry_history(p_entry_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', c.action, 'reason', c.reason, 'at', c.changed_at,
           'by', coalesce(nullif(btrim(m.display_name), ''), split_part(coalesce(m.email, u.email, ''), '@', 1)), 'before', c.before, 'after', c.after) order by c.changed_at), '[]'::jsonb)
  from public.pm_time_entry_changes c
  join public.pm_time_entries e on e.id = c.entry_id
  left join auth.users u on u.id = c.changed_by
  left join public.company_members m on m.user_id = c.changed_by and m.company_id = e.company_id
  where c.entry_id = p_entry_id and public.pm_time_readable(e.resource_id) and public.team_in_my_scope(e.company_id, e.owner_id)
$$;
revoke execute on function public.pm_time_entry_history(uuid) from public, anon;
grant execute on function public.pm_time_entry_history(uuid) to authenticated;

-- 4. Subcontractor tax profile (W-9) ------------------------------------------------------------------
create table if not exists public.pm_sub_tax_profiles (
  resource_id uuid primary key references public.pm_resources (id) on delete cascade,
  legal_name text check (char_length(legal_name) <= 200),
  business_name text check (char_length(business_name) <= 200),
  tax_classification text check (tax_classification in ('individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc_c', 'llc_s', 'llc_p', 'other')),
  tin_type text check (tin_type in ('ssn', 'ein')),
  tin_last4 text check (tin_last4 ~ '^[0-9]{4}$'),
  address text check (char_length(address) <= 500),
  w9_signed_on date,
  track_1099 boolean,               -- null = automatic from the tax classification
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.pm_sub_tax_profiles enable row level security;
drop policy if exists pm_sub_tax_profiles_select on public.pm_sub_tax_profiles;
create policy pm_sub_tax_profiles_select on public.pm_sub_tax_profiles for select to authenticated
  using (exists (select 1 from public.pm_resources r where r.id = resource_id and public.sub_compliance_manageable(r.company_id, r.owner_id)));
revoke all on public.pm_sub_tax_profiles from anon, authenticated;
grant select on public.pm_sub_tax_profiles to authenticated;

-- 1099s are generally not required for corporations (C or S, or an LLC taxed as one).
create or replace function public.pm_sub_tracks_1099(t public.pm_sub_tax_profiles) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(t.track_1099, t.tax_classification is null or t.tax_classification not in ('c_corp', 's_corp', 'llc_c', 'llc_s'))
$$;

-- 5. Subcontractor documents -------------------------------------------------------------------------
create table if not exists public.pm_sub_documents (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  doc_type text not null check (doc_type in ('w9', 'coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license',
                                             'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other')),
  title text check (char_length(title) <= 200),
  issuer text check (char_length(issuer) <= 200),
  policy_number text check (char_length(policy_number) <= 80),
  coverage_amount numeric(14, 2) check (coverage_amount is null or coverage_amount >= 0),
  effective_on date,
  expires_on date,
  signed_on date,
  file_path text check (char_length(file_path) <= 400),
  file_name text check (char_length(file_name) <= 200),
  note text check (char_length(note) <= 1000),
  status text not null default 'on_file' check (status in ('on_file', 'replaced', 'removed')),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  constraint pm_sub_documents_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_sub_documents_dates check (expires_on is null or effective_on is null or expires_on >= effective_on)
);
create index if not exists pm_sub_documents_resource_idx on public.pm_sub_documents (resource_id, status, doc_type);
create index if not exists pm_sub_documents_expiry_idx on public.pm_sub_documents (coalesce(company_id, owner_id), expires_on) where status = 'on_file' and expires_on is not null;
alter table public.pm_sub_documents enable row level security;
drop policy if exists pm_sub_documents_select on public.pm_sub_documents;
create policy pm_sub_documents_select on public.pm_sub_documents for select to authenticated
  using (public.sub_compliance_manageable(company_id, owner_id));
revoke all on public.pm_sub_documents from anon, authenticated;
grant select on public.pm_sub_documents to authenticated;

-- Private bucket: files are uploaded by the server (service role) after a permission check and opened
-- through short-lived signed links. No storage policies, so no signed-in client can list or read them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sub-records', 'sub-records', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.pm_sub_doc_kind_insurance(p text) returns boolean
language sql immutable set search_path = public as $$
  select p in ('coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella')
$$;

-- Compliance at a glance for every subcontractor in the caller's directory: safe for anyone who can see the
-- directory (no numbers, no files).
create or replace function public.pm_sub_compliance_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o)
  select jsonb_build_object(
    'canManage', (select public.sub_compliance_manageable(scope.c, scope.o) from scope),
    'subs', coalesce((select jsonb_object_agg(r.id, jsonb_build_object(
        'w9OnFile', exists (select 1 from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and d.doc_type = 'w9')
                    or exists (select 1 from public.pm_sub_tax_profiles t where t.resource_id = r.id and t.w9_signed_on is not null),
        'insuranceOnFile', exists (select 1 from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and public.pm_sub_doc_kind_insurance(d.doc_type)),
        'agreementOnFile', exists (select 1 from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and d.doc_type in ('subcontract_agreement', 'master_agreement')),
        'nextExpiry', (select min(d.expires_on) from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and d.expires_on >= current_date),
        'expired', (select count(*) from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and d.expires_on < current_date),
        'expiringSoon', (select count(*) from public.pm_sub_documents d where d.resource_id = r.id and d.status = 'on_file' and d.expires_on between current_date and current_date + 30)))
      from public.pm_resources r, scope
      where r.kind = 'subcontractor' and r.company_id is not distinct from scope.c and r.owner_id is not distinct from scope.o
        and public.pm_resource_readable(r.company_id, r.owner_id)), '{}'::jsonb))
$$;
revoke execute on function public.pm_sub_compliance_summary() from public, anon;
grant execute on function public.pm_sub_compliance_summary() to authenticated;

-- Full record for one subcontractor (tax profile + documents). Managers of compliance only.
create or replace function public.pm_sub_record(p_resource_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; t public.pm_sub_tax_profiles;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.sub_compliance_manageable(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.pm_sub_tax_profiles where resource_id = r.id;
  return jsonb_build_object(
    'resourceId', r.id, 'name', r.name, 'folder', coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text,
    'tax', case when t.resource_id is null then null else jsonb_build_object('legalName', t.legal_name, 'businessName', t.business_name,
      'taxClassification', t.tax_classification, 'tinType', t.tin_type, 'tinLast4', t.tin_last4, 'address', t.address,
      'w9SignedOn', t.w9_signed_on, 'track1099', t.track_1099, 'tracks1099', public.pm_sub_tracks_1099(t), 'updatedAt', t.updated_at) end,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'docType', d.doc_type, 'title', d.title, 'issuer', d.issuer,
        'policyNumber', d.policy_number, 'coverageAmount', d.coverage_amount, 'effectiveOn', d.effective_on, 'expiresOn', d.expires_on,
        'signedOn', d.signed_on, 'fileName', d.file_name, 'hasFile', d.file_path is not null, 'note', d.note, 'status', d.status,
        'recordedAt', d.recorded_at) order by d.status, d.doc_type, d.expires_on nulls last, d.recorded_at desc)
      from public.pm_sub_documents d where d.resource_id = r.id and d.status <> 'removed'), '[]'::jsonb));
end $$;
revoke execute on function public.pm_sub_record(uuid) from public, anon;
grant execute on function public.pm_sub_record(uuid) to authenticated;

-- p {legalName?, businessName?, taxClassification?, tinType?, tinLast4?, address?, w9SignedOn?, track1099? (true/false/null)}
create or replace function public.pm_sub_tax_save(p_resource_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_last4 text := nullif(regexp_replace(coalesce(p ->> 'tinLast4', ''), '[^0-9]', '', 'g'), '');
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_last4 is not null and v_last4 !~ '^[0-9]{4}$' then raise exception 'bad_tin' using errcode = '22023'; end if;
  insert into public.pm_sub_tax_profiles (resource_id, legal_name, business_name, tax_classification, tin_type, tin_last4, address, w9_signed_on, track_1099, updated_by)
  values (r.id, left(nullif(btrim(p ->> 'legalName'), ''), 200), left(nullif(btrim(p ->> 'businessName'), ''), 200), nullif(p ->> 'taxClassification', ''),
          nullif(p ->> 'tinType', ''), v_last4, left(nullif(btrim(p ->> 'address'), ''), 500), nullif(p ->> 'w9SignedOn', '')::date,
          case when jsonb_typeof(p -> 'track1099') = 'boolean' then (p ->> 'track1099')::boolean end, auth.uid())
  on conflict (resource_id) do update set legal_name = excluded.legal_name, business_name = excluded.business_name,
    tax_classification = excluded.tax_classification, tin_type = excluded.tin_type, tin_last4 = excluded.tin_last4, address = excluded.address,
    w9_signed_on = excluded.w9_signed_on, track_1099 = excluded.track_1099, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function public.pm_sub_tax_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_sub_tax_save(uuid, jsonb) to authenticated;

-- Record a document (the server stores the file first and passes filePath). Recording a new W-9 or the same
-- insurance type marks the older one "replaced" (kept for history). Returns the document id.
create or replace function public.pm_sub_document_add(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_type text := p ->> 'docType'; v_id uuid; v_path text := nullif(p ->> 'filePath', '');
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('w9', 'coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license',
                                      'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other') then
    raise exception 'bad_type' using errcode = '22023';
  end if;
  -- Files must sit under this subcontractor's own folder.
  if v_path is not null and v_path not like coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text || '/%' then raise exception 'bad_path' using errcode = '22023'; end if;
  if v_type = 'w9' or public.pm_sub_doc_kind_insurance(v_type) then
    update public.pm_sub_documents set status = 'replaced' where resource_id = r.id and doc_type = v_type and status = 'on_file';
  end if;
  insert into public.pm_sub_documents (resource_id, company_id, owner_id, doc_type, title, issuer, policy_number, coverage_amount,
    effective_on, expires_on, signed_on, file_path, file_name, note, recorded_by)
  values (r.id, r.company_id, r.owner_id, v_type, left(nullif(btrim(p ->> 'title'), ''), 200), left(nullif(btrim(p ->> 'issuer'), ''), 200),
          left(nullif(btrim(p ->> 'policyNumber'), ''), 80), nullif(p ->> 'coverageAmount', '')::numeric,
          nullif(p ->> 'effectiveOn', '')::date, nullif(p ->> 'expiresOn', '')::date, nullif(p ->> 'signedOn', '')::date,
          v_path, left(nullif(p ->> 'fileName', ''), 200), left(nullif(btrim(p ->> 'note'), ''), 1000), auth.uid())
  returning id into v_id;
  if v_type = 'w9' and nullif(p ->> 'signedOn', '') is not null then
    insert into public.pm_sub_tax_profiles (resource_id, w9_signed_on, updated_by) values (r.id, (p ->> 'signedOn')::date, auth.uid())
    on conflict (resource_id) do update set w9_signed_on = excluded.w9_signed_on, updated_by = auth.uid(), updated_at = now();
  end if;
  return v_id;
end $$;
revoke execute on function public.pm_sub_document_add(uuid, jsonb) from public, anon;
grant execute on function public.pm_sub_document_add(uuid, jsonb) to authenticated;

-- Remove a document recorded by mistake (kept as "removed" for the record; the file stays private).
create or replace function public.pm_sub_document_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.pm_sub_documents;
begin
  select * into d from public.pm_sub_documents where id = p_id for update;
  if not found or not public.team_in_my_scope(d.company_id, d.owner_id) or not public.sub_compliance_manageable(d.company_id, d.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pm_sub_documents set status = 'removed', removed_by = auth.uid(), removed_at = now() where id = p_id;
end $$;
revoke execute on function public.pm_sub_document_remove(uuid) from public, anon;
grant execute on function public.pm_sub_document_remove(uuid) to authenticated;

-- The stored path of a document's file, for the server to sign a short-lived link. Managers only.
create or replace function public.pm_sub_document_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.pm_sub_documents;
begin
  select * into d from public.pm_sub_documents where id = p_id;
  if not found or d.file_path is null or not public.team_in_my_scope(d.company_id, d.owner_id) or not public.sub_compliance_manageable(d.company_id, d.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('path', d.file_path, 'fileName', d.file_name);
end $$;
revoke execute on function public.pm_sub_document_file(uuid) from public, anon;
grant execute on function public.pm_sub_document_file(uuid) to authenticated;

-- 6. 1099 totals -------------------------------------------------------------------------------------
-- Payments in calendar year p_year from the caller's live Financials book, per vendor. Card payments are
-- listed separately and not counted. Vendors linked to a Team & Subcontractors entry carry its W-9 details.
create or replace function public.pm_sub_1099_totals(p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_book uuid;
  v_from date; v_to date;
  v_threshold numeric := case when p_year >= 2026 then 2000 else 600 end;
begin
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'bad_year' using errcode = '22023'; end if;
  if not public.sub_compliance_manageable(v_company, v_owner) then
    -- Bookkeepers and accountants with financial reporting access may also see the totals.
    select b.id into v_book from public.fin_books b
     where b.company_id is not distinct from v_company and b.owner_user_id is not distinct from v_owner
       and coalesce(to_jsonb(b) ->> 'is_sandbox', 'false') <> 'true' and coalesce(to_jsonb(b) ->> 'mode', 'live') <> 'sandbox'
     limit 1;
    if v_book is null or not (public.fin_has_permission(v_book, 'export_financials', false) or public.fin_has_permission(v_book, 'view_company_financials', false)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  v_from := make_date(p_year, 1, 1); v_to := make_date(p_year, 12, 31);
  return jsonb_build_object('year', p_year, 'threshold', v_threshold, 'rows', coalesce((
    with books as (
      select b.id from public.fin_books b
       where b.company_id is not distinct from v_company and b.owner_user_id is not distinct from v_owner
         and coalesce(to_jsonb(b) ->> 'is_sandbox', 'false') <> 'true' and coalesce(to_jsonb(b) ->> 'mode', 'live') <> 'sandbox'),
    pay as (
      select bl.vendor_id, bp.amount, bp.method from public.fin_bill_payments bp
        join public.fin_vendor_bills bl on bl.id = bp.bill_id
       where bp.book_id in (select id from books) and bp.status = 'active' and bl.status <> 'void' and bp.paid_on between v_from and v_to
      union all
      select x.vendor_id, x.amount, x.method from public.fin_expenses x
       where x.book_id in (select id from books) and x.vendor_id is not null and x.status = 'approved' and x.method <> 'reimbursement'
         and x.spent_on between v_from and v_to),
    per as (
      select vendor_id, sum(amount) filter (where method <> 'card') as counted, sum(amount) filter (where method = 'card') as card
        from pay group by vendor_id)
    select jsonb_agg(jsonb_build_object(
        'vendorId', v.id, 'vendorName', v.name, 'vendorKind', v.kind, 'resourceId', v.resource_id,
        'legalName', t.legal_name, 'tinType', t.tin_type, 'tinLast4', t.tin_last4, 'taxClassification', t.tax_classification,
        'w9OnFile', t.w9_signed_on is not null or exists (select 1 from public.pm_sub_documents d where d.resource_id = v.resource_id and d.doc_type = 'w9' and d.status = 'on_file'),
        'tracks1099', case when t.resource_id is null then v.kind = 'subcontractor' else public.pm_sub_tracks_1099(t) end,
        'paid', coalesce(per.counted, 0), 'cardPaid', coalesce(per.card, 0),
        'needs1099', coalesce(per.counted, 0) >= v_threshold and (case when t.resource_id is null then v.kind = 'subcontractor' else public.pm_sub_tracks_1099(t) end))
      order by coalesce(per.counted, 0) desc, lower(v.name))
    from per join public.fin_vendors v on v.id = per.vendor_id
    left join public.pm_sub_tax_profiles t on t.resource_id = v.resource_id
    where v.kind <> 'supplier'
  ), '[]'::jsonb));
end $$;
revoke execute on function public.pm_sub_1099_totals(integer) from public, anon;
grant execute on function public.pm_sub_1099_totals(integer) to authenticated;
