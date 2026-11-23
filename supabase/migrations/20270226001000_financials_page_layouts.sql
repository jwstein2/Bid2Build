-- Financials page layouts: the V6.6 dashboard builder storage now holds one layout per person per PAGE per mode.
-- Requires 20261221001000_dashboard_layouts.sql.
--
--   page 'home'       the Home dashboard (unchanged: every existing row becomes page 'home')
--   page 'financials' the Financials page (Know Your Numbers)
--
-- Contractor Mode and Accountant Mode keep separate layouts on each page. Like before, a layout holds no figures
-- and grants nothing: widget data is loaded fresh under the viewer's own permissions when the page renders.
-- Every function keeps its old arguments and adds p_page (default 'home') at the end, so code that doesn't pass
-- a page keeps reading and writing the Home layout.
-- Idempotent. Rollback: docs/dashboard-builder/rollback_20270226001000.sql

-- 1. Page column on personal layouts and company defaults --------------------------------------------------------
alter table public.dashboard_layouts add column if not exists page text not null default 'home';
alter table public.company_dashboard_defaults add column if not exists page text not null default 'home';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dashboard_layouts_page_check') then
    alter table public.dashboard_layouts add constraint dashboard_layouts_page_check check (page in ('home', 'financials'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_dashboard_defaults_page_check') then
    alter table public.company_dashboard_defaults add constraint company_dashboard_defaults_page_check check (page in ('home', 'financials'));
  end if;
  -- One row per person per page per mode.
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
             where c.conname = 'dashboard_layouts_pkey' group by c.conname having not bool_or(a.attname = 'page')) then
    alter table public.dashboard_layouts drop constraint dashboard_layouts_pkey;
    alter table public.dashboard_layouts add constraint dashboard_layouts_pkey primary key (user_id, page, mode);
  end if;
end $$;
drop index if exists public.company_dashboard_defaults_one;
create unique index if not exists company_dashboard_defaults_one_page on public.company_dashboard_defaults (company_id, page, coalesce(role, ''), mode);

-- 2. Functions: same behavior, now per page. The old signatures go so calls without p_page are never ambiguous. ---
drop function if exists public.dashboard_layout_get(text);
drop function if exists public.dashboard_layout_save(text, text, jsonb, integer, integer, text);
drop function if exists public.dashboard_layout_reset(text);
drop function if exists public.company_dashboard_default_save(text, text, text, jsonb, integer);

create or replace function public.dashboard_layout_get(p_mode text, p_page text default 'home') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.company_members;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_page not in ('home', 'financials') then raise exception 'bad_page' using errcode = '22023'; end if;
  select * into m from public.company_members where user_id = v_uid and status = 'active';
  return jsonb_build_object(
    'mine', (select jsonb_build_object('schemaVersion', d.schema_version, 'template', d.template, 'widgets', d.widgets,
                                       'revision', d.revision, 'source', d.source, 'updatedAt', d.updated_at)
             from public.dashboard_layouts d where d.user_id = v_uid and d.page = p_page and d.mode = p_mode),
    'companyDefault', case when m.company_id is null then null else (
      select jsonb_build_object('schemaVersion', c.schema_version, 'template', c.template, 'widgets', c.widgets, 'role', c.role, 'updatedAt', c.updated_at)
      from public.company_dashboard_defaults c
      where c.company_id = m.company_id and c.page = p_page and c.mode = p_mode and (c.role = m.role or c.role is null)
      order by (c.role is null) limit 1) end,
    'isCompanyOwner', coalesce((select c.owner_user_id = v_uid from public.companies c where c.id = m.company_id), false));
end $$;

create or replace function public.dashboard_layout_save(p_mode text, p_template text, p_widgets jsonb, p_schema_version integer,
  p_expected_revision integer, p_source text default 'user', p_page text default 'home') returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rev integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_page not in ('home', 'financials') then raise exception 'bad_page' using errcode = '22023'; end if;
  if not public.dashboard_widgets_valid(p_widgets) then raise exception 'bad_layout' using errcode = '22023'; end if;
  if p_source not in ('user', 'setup', 'template', 'company_default') then raise exception 'bad_source' using errcode = '22023'; end if;
  select revision into v_rev from public.dashboard_layouts where user_id = v_uid and page = p_page and mode = p_mode for update;
  if found then
    if p_expected_revision is distinct from v_rev then raise exception 'layout_conflict' using errcode = '40001'; end if;
    update public.dashboard_layouts set template = p_template, widgets = p_widgets, schema_version = p_schema_version,
      revision = v_rev + 1, source = p_source, updated_at = now()
    where user_id = v_uid and page = p_page and mode = p_mode;
    return v_rev + 1;
  end if;
  if p_expected_revision is not null then raise exception 'layout_conflict' using errcode = '40001'; end if;
  insert into public.dashboard_layouts (user_id, page, mode, template, widgets, schema_version, revision, source)
  values (v_uid, p_page, p_mode, p_template, p_widgets, p_schema_version, 1, p_source);
  return 1;
end $$;

create or replace function public.dashboard_layout_reset(p_mode text, p_page text default 'home') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_page not in ('home', 'financials') then raise exception 'bad_page' using errcode = '22023'; end if;
  delete from public.dashboard_layouts where user_id = auth.uid() and page = p_page and mode = p_mode;
end $$;

create or replace function public.company_dashboard_default_save(p_role text, p_mode text, p_template text, p_widgets jsonb, p_schema_version integer,
  p_page text default 'home')
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select c.id into v_company from public.companies c
    join public.company_members m on m.company_id = c.id and m.user_id = auth.uid() and m.status = 'active'
    where c.owner_user_id = auth.uid();
  if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_page not in ('home', 'financials') then raise exception 'bad_page' using errcode = '22023'; end if;
  if p_role is not null and p_role not in ('owner', 'manager', 'estimator', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  delete from public.company_dashboard_defaults where company_id = v_company and page = p_page and role is not distinct from p_role and mode = p_mode;
  if p_widgets is not null then
    if not public.dashboard_widgets_valid(p_widgets) then raise exception 'bad_layout' using errcode = '22023'; end if;
    insert into public.company_dashboard_defaults (company_id, page, role, mode, template, widgets, schema_version, updated_by)
    values (v_company, p_page, p_role, p_mode, p_template, p_widgets, p_schema_version, auth.uid());
  end if;
  perform public.company_audit(v_company, case when p_widgets is null then 'dashboard_default.removed' else 'dashboard_default.saved' end,
    'dashboard_default', p_page || ':' || coalesce(p_role, 'everyone') || ':' || p_mode, jsonb_build_object('page', p_page, 'role', p_role, 'mode', p_mode, 'template', p_template));
end $$;

create or replace function public.company_dashboard_defaults_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('page', d.page, 'role', d.role, 'mode', d.mode, 'template', d.template, 'count', jsonb_array_length(d.widgets), 'updatedAt', d.updated_at)
           order by d.page, d.mode, d.role nulls first), '[]'::jsonb)
  from public.company_dashboard_defaults d
  join public.companies c on c.id = d.company_id and c.owner_user_id = auth.uid()
$$;

revoke execute on function public.dashboard_layout_get(text, text), public.dashboard_layout_save(text, text, jsonb, integer, integer, text, text),
  public.dashboard_layout_reset(text, text), public.company_dashboard_default_save(text, text, text, jsonb, integer, text),
  public.company_dashboard_defaults_list() from public, anon;
grant execute on function public.dashboard_layout_get(text, text), public.dashboard_layout_save(text, text, jsonb, integer, integer, text, text),
  public.dashboard_layout_reset(text, text), public.company_dashboard_default_save(text, text, text, jsonb, integer, text),
  public.company_dashboard_defaults_list() to authenticated;

notify pgrst, 'reload schema';
