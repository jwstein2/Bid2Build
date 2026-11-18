-- V6.6 Personalized Dashboard Builder. Requires the Enterprise workspace migration (20261114005000).
--
-- Stores dashboard layouts only: which widgets a person shows, in what order, at what size, with which settings.
-- Design rules:
--   * Preferences live apart from business data. Nothing here references invoices, bids or projects, and saving a
--     layout never writes to an accounting or project table.
--   * A layout holds no figures. Widget data is always loaded fresh, under the viewer's own permissions, when the
--     dashboard renders, so a saved widget can never reveal data the viewer can no longer open.
--   * One row per person per mode (Contractor / Accountant). The mode only picks which saved layout to show; it
--     grants nothing.
--   * Company defaults (set by the primary Enterprise account holder) are a starting point: they are read only when
--     the person has no layout of their own for that mode, so they never overwrite personal choices.
--   * Saves carry the revision they were based on; a save from an older copy (another tab or device) is refused
--     with 'layout_conflict' instead of silently overwriting the newer layout.
-- Idempotent. Rollback: docs/dashboard-builder/rollback_20261221001000.sql

-- 1. Personal layouts ------------------------------------------------------------------------------------------
create table if not exists public.dashboard_layouts (
  user_id        uuid not null references auth.users (id) on delete cascade,
  mode           text not null check (mode in ('contractor', 'accountant')),
  schema_version integer not null default 1 check (schema_version between 1 and 1000),
  template       text check (template is null or template ~ '^[a-z0-9_]{1,40}$'),
  widgets        jsonb not null default '[]'
                 check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 40 and pg_column_size(widgets) <= 65536),
  revision       integer not null default 1,
  source         text not null default 'user' check (source in ('user', 'setup', 'template', 'company_default')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, mode)
);

-- 2. Company defaults (Enterprise) -----------------------------------------------------------------------------
-- role null = everyone in the company; otherwise one company role. Mode as above.
create table if not exists public.company_dashboard_defaults (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  role           text check (role is null or role in ('owner', 'manager', 'estimator', 'viewer')),
  mode           text not null check (mode in ('contractor', 'accountant')),
  schema_version integer not null default 1 check (schema_version between 1 and 1000),
  template       text check (template is null or template ~ '^[a-z0-9_]{1,40}$'),
  widgets        jsonb not null default '[]'
                 check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 40 and pg_column_size(widgets) <= 65536),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);
create unique index if not exists company_dashboard_defaults_one on public.company_dashboard_defaults (company_id, coalesce(role, ''), mode);

-- Every widget entry must be an object with a short id and type: the shape is checked again in the app.
create or replace function public.dashboard_widgets_valid(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 40 and not exists (
    select 1 from jsonb_array_elements(p) w
    where jsonb_typeof(w) <> 'object'
       or coalesce(w ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,40}$'
       or coalesce(w ->> 'type', '') !~ '^[a-z0-9_]{1,40}$'
       or (w ? 'settings' and jsonb_typeof(w -> 'settings') <> 'object'))
$$;

-- 3. Read: the caller's own layout for a mode, plus the company default that applies to them --------------------
create or replace function public.dashboard_layout_get(p_mode text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.company_members;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  select * into m from public.company_members where user_id = v_uid and status = 'active';
  return jsonb_build_object(
    'mine', (select jsonb_build_object('schemaVersion', d.schema_version, 'template', d.template, 'widgets', d.widgets,
                                       'revision', d.revision, 'source', d.source, 'updatedAt', d.updated_at)
             from public.dashboard_layouts d where d.user_id = v_uid and d.mode = p_mode),
    -- A role-specific default wins over the everyone default.
    'companyDefault', case when m.company_id is null then null else (
      select jsonb_build_object('schemaVersion', c.schema_version, 'template', c.template, 'widgets', c.widgets, 'role', c.role, 'updatedAt', c.updated_at)
      from public.company_dashboard_defaults c
      where c.company_id = m.company_id and c.mode = p_mode and (c.role = m.role or c.role is null)
      order by (c.role is null) limit 1) end,
    'isCompanyOwner', coalesce((select c.owner_user_id = v_uid from public.companies c where c.id = m.company_id), false));
end $$;

-- 4. Save the caller's own layout ------------------------------------------------------------------------------
-- p_expected_revision: the revision the editor started from (null = "I had no saved layout"). Returns the new revision.
create or replace function public.dashboard_layout_save(p_mode text, p_template text, p_widgets jsonb, p_schema_version integer,
  p_expected_revision integer, p_source text default 'user') returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rev integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if not public.dashboard_widgets_valid(p_widgets) then raise exception 'bad_layout' using errcode = '22023'; end if;
  if p_source not in ('user', 'setup', 'template', 'company_default') then raise exception 'bad_source' using errcode = '22023'; end if;
  select revision into v_rev from public.dashboard_layouts where user_id = v_uid and mode = p_mode for update;
  if found then
    if p_expected_revision is distinct from v_rev then raise exception 'layout_conflict' using errcode = '40001'; end if;
    update public.dashboard_layouts set template = p_template, widgets = p_widgets, schema_version = p_schema_version,
      revision = v_rev + 1, source = p_source, updated_at = now()
    where user_id = v_uid and mode = p_mode;
    return v_rev + 1;
  end if;
  if p_expected_revision is not null then raise exception 'layout_conflict' using errcode = '40001'; end if;
  insert into public.dashboard_layouts (user_id, mode, template, widgets, schema_version, revision, source)
  values (v_uid, p_mode, p_template, p_widgets, p_schema_version, 1, p_source);
  return 1;
end $$;

-- 5. Restore defaults: the caller's own layout for the mode goes; the company default or built-in template applies again.
create or replace function public.dashboard_layout_reset(p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.dashboard_layouts where user_id = auth.uid() and mode = p_mode;
end $$;

-- 6. Company defaults: primary Enterprise account holder only. p_widgets null removes the default. -----------------
create or replace function public.company_dashboard_default_save(p_role text, p_mode text, p_template text, p_widgets jsonb, p_schema_version integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select c.id into v_company from public.companies c
    join public.company_members m on m.company_id = c.id and m.user_id = auth.uid() and m.status = 'active'
    where c.owner_user_id = auth.uid();
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_role is not null and p_role not in ('owner', 'manager', 'estimator', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  delete from public.company_dashboard_defaults where company_id = v_company and role is not distinct from p_role and mode = p_mode;
  if p_widgets is not null then
    if not public.dashboard_widgets_valid(p_widgets) then raise exception 'bad_layout' using errcode = '22023'; end if;
    insert into public.company_dashboard_defaults (company_id, role, mode, template, widgets, schema_version, updated_by)
    values (v_company, p_role, p_mode, p_template, p_widgets, p_schema_version, auth.uid());
  end if;
  perform public.company_audit(v_company, case when p_widgets is null then 'dashboard_default.removed' else 'dashboard_default.saved' end,
    'dashboard_default', coalesce(p_role, 'everyone') || ':' || p_mode, jsonb_build_object('role', p_role, 'mode', p_mode, 'template', p_template));
end $$;

-- Which company defaults exist (owner's settings view).
create or replace function public.company_dashboard_defaults_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('role', d.role, 'mode', d.mode, 'template', d.template, 'count', jsonb_array_length(d.widgets), 'updatedAt', d.updated_at)
           order by d.mode, d.role nulls first), '[]'::jsonb)
  from public.company_dashboard_defaults d
  join public.companies c on c.id = d.company_id and c.owner_user_id = auth.uid()
$$;

-- 7. Row-level security: own rows only; writes only through the functions above. ------------------------------
alter table public.dashboard_layouts enable row level security;
alter table public.company_dashboard_defaults enable row level security;
drop policy if exists dashboard_layouts_select on public.dashboard_layouts;
create policy dashboard_layouts_select on public.dashboard_layouts for select to authenticated using (user_id = auth.uid());
drop policy if exists company_dashboard_defaults_select on public.company_dashboard_defaults;
create policy company_dashboard_defaults_select on public.company_dashboard_defaults for select to authenticated
  using (public.is_active_company_member(company_id));
revoke all on public.dashboard_layouts, public.company_dashboard_defaults from anon, authenticated;
grant select on public.dashboard_layouts, public.company_dashboard_defaults to authenticated;

revoke execute on function public.dashboard_layout_get(text), public.dashboard_layout_save(text, text, jsonb, integer, integer, text),
  public.dashboard_layout_reset(text), public.company_dashboard_default_save(text, text, text, jsonb, integer),
  public.company_dashboard_defaults_list(), public.dashboard_widgets_valid(jsonb) from public, anon;
grant execute on function public.dashboard_layout_get(text), public.dashboard_layout_save(text, text, jsonb, integer, integer, text),
  public.dashboard_layout_reset(text), public.company_dashboard_default_save(text, text, text, jsonb, integer),
  public.company_dashboard_defaults_list(), public.dashboard_widgets_valid(jsonb) to authenticated;

notify pgrst, 'reload schema';
