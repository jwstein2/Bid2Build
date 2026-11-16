-- Enterprise Bid Style Control V4.4: one company-wide proposal style, an "Allow team members to
-- customize bid style" policy (off by default for new companies), per-element locks, and an audit trail.
--
--   * company_proposal_styles holds the presentation settings only (template, colors, logo layout, header
--     style, what details show, grouping). It never holds prices, quantities or calculations.
--   * Changing the style needs "Manage company proposal templates". Changing the policy (the toggle and
--     the locks) needs "Change company-wide proposal policy", which only the company owner can grant.
--   * The app resolves the style when a proposal is previewed or generated: platform rules, then company
--     locks, then the company template, then the bid's own choices (only where allowed), then platform
--     defaults. Generated versions freeze the resolved style, so a later company change never alters a
--     sent, approved or signed proposal.
--   * Companies created before this migration have no row until the owner saves the style: nothing
--     changes for them until then. Companies created afterwards start with the toggle off.
--
-- Safe to run more than once. Requires 20261119001000_project_operations.sql (permission keys).
-- Rollback: docs/project-operations/rollback_20261119004000.sql

create table if not exists public.company_proposal_styles (
  company_id uuid primary key references public.companies (id) on delete cascade,
  style jsonb not null default '{}'::jsonb check (jsonb_typeof(style) = 'object'),
  locked text[] not null default '{}' check (cardinality(locked) <= 30),
  allow_member_customization boolean not null default false,
  revision integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.company_proposal_style_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  revision integer not null,
  style jsonb not null,
  locked text[] not null,
  allow_member_customization boolean not null,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_proposal_style_history_idx on public.company_proposal_style_history (company_id, revision desc);
drop trigger if exists company_proposal_style_history_write_once on public.company_proposal_style_history;
create trigger company_proposal_style_history_write_once before update or delete on public.company_proposal_style_history for each row execute function public.guard_write_once();

alter table public.company_proposal_styles enable row level security;
alter table public.company_proposal_style_history enable row level security;
drop policy if exists company_proposal_styles_select on public.company_proposal_styles;
create policy company_proposal_styles_select on public.company_proposal_styles for select to authenticated using (public.is_active_company_member(company_id));
drop policy if exists company_proposal_style_history_select on public.company_proposal_style_history;
create policy company_proposal_style_history_select on public.company_proposal_style_history for select to authenticated
  using (public.has_company_permission(company_id, 'manage_proposal_templates') or public.has_company_permission(company_id, 'change_proposal_policy'));
revoke all on public.company_proposal_styles, public.company_proposal_style_history from anon, authenticated;
grant select on public.company_proposal_styles, public.company_proposal_style_history to authenticated;

-- New companies start with the policy row (toggle off, no template yet = company branding + platform defaults).
create or replace function public.companies_default_proposal_style() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_proposal_styles (company_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists companies_default_proposal_style on public.companies;
create trigger companies_default_proposal_style after insert on public.companies for each row execute function public.companies_default_proposal_style();

create or replace function public.proposal_style_keys() returns text[]
language sql immutable as $$
  select array['template', 'primaryColor', 'secondaryColor', 'logoLayout', 'headerStyle', 'companyBranding',
               'show.phone', 'show.email', 'show.address', 'show.website', 'show.license',
               'show.itemDescriptions', 'show.itemPrices', 'show.groupPrices', 'show.quantities', 'show.notes',
               'displayMode', 'defaultGroupVisibility']
$$;

-- The policy that applies to one bid (any reader of the bid may see it: it decides how the bid renders).
create or replace function public.proposal_style_policy(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; c public.company_proposal_styles; v_owner uuid;
begin
  if auth.uid() is null or not public.estimate_readable(p_estimate_id) then return null; end if;
  select * into e from public.estimates where id = p_estimate_id;
  if e.company_id is null then return jsonb_build_object('managed', false); end if;
  select * into c from public.company_proposal_styles where company_id = e.company_id;
  select owner_user_id into v_owner from public.companies where id = e.company_id;
  if not found then return jsonb_build_object('managed', false); end if;
  return jsonb_build_object('managed', true, 'companyId', e.company_id, 'companyOwnerId', v_owner, 'style', c.style, 'locked', to_jsonb(c.locked),
    'allowCustomization', c.allow_member_customization, 'revision', c.revision, 'updatedAt', c.updated_at,
    'canCustomize', c.allow_member_customization and public.has_company_permission(e.company_id, 'customize_proposal_style'),
    'canOverride', public.has_company_permission(e.company_id, 'manage_proposal_templates'));
end $$;
revoke execute on function public.proposal_style_policy(uuid) from public, anon;
grant execute on function public.proposal_style_policy(uuid) to authenticated;

-- Company settings screen.
create or replace function public.company_proposal_style() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); c public.company_proposal_styles;
begin
  if v_company is null or not public.has_company_permission(v_company, 'view_proposal_style') then return null; end if;
  select * into c from public.company_proposal_styles where company_id = v_company;
  return jsonb_build_object('companyId', v_company, 'exists', c.company_id is not null, 'style', coalesce(c.style, '{}'::jsonb), 'locked', to_jsonb(coalesce(c.locked, '{}')),
    'allowCustomization', coalesce(c.allow_member_customization, false), 'revision', coalesce(c.revision, 0), 'updatedAt', c.updated_at,
    'isOwner', exists (select 1 from public.companies x where x.id = v_company and x.owner_user_id = auth.uid()),
    'canManageTemplate', public.has_company_permission(v_company, 'manage_proposal_templates'),
    'canChangePolicy', public.has_company_permission(v_company, 'change_proposal_policy'),
    'history', case when public.has_company_permission(v_company, 'manage_proposal_templates') or public.has_company_permission(v_company, 'change_proposal_policy')
      then coalesce((select jsonb_agg(jsonb_build_object('revision', h.revision, 'actorId', h.actor_id, 'at', h.created_at, 'allow', h.allow_member_customization,
             'locked', to_jsonb(h.locked)) order by h.revision desc) from (select * from public.company_proposal_style_history h where h.company_id = v_company order by h.revision desc limit 20) h), '[]'::jsonb)
      else '[]'::jsonb end);
end $$;
revoke execute on function public.company_proposal_style() from public, anon;
grant execute on function public.company_proposal_style() to authenticated;

-- Save. Style changes need the template permission; toggle / lock changes need the policy permission.
create or replace function public.company_proposal_style_save(p_base_revision integer, p_style jsonb, p_locked text[], p_allow boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); c public.company_proposal_styles; v_rev integer; v_locked text[];
begin
  if v_company is null or auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.company_proposal_styles (company_id, revision) values (v_company, 0) on conflict do nothing;
  select * into c from public.company_proposal_styles where company_id = v_company for update;
  if c.revision <> coalesce(p_base_revision, c.revision) then raise exception 'stale_revision' using errcode = '40001', detail = c.revision::text; end if;
  select coalesce(array_agg(distinct k order by k), '{}') into v_locked from unnest(coalesce(p_locked, '{}')) k;
  if exists (select 1 from unnest(v_locked) k where not (k = any (public.proposal_style_keys()))) then raise exception 'bad_key' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_style, '{}'::jsonb)) k where k not in ('template', 'primaryColor', 'secondaryColor', 'logoLayout', 'headerStyle', 'companyBranding', 'show', 'displayMode', 'defaultGroupVisibility')) then
    raise exception 'bad_key' using errcode = '22023';
  end if;
  if p_style is distinct from c.style and not public.has_company_permission(v_company, 'manage_proposal_templates') then raise exception 'forbidden_template' using errcode = '42501'; end if;
  if (v_locked is distinct from c.locked or coalesce(p_allow, false) is distinct from c.allow_member_customization)
     and not public.has_company_permission(v_company, 'change_proposal_policy') then
    raise exception 'forbidden_policy' using errcode = '42501';
  end if;
  if p_style is not distinct from c.style and v_locked is not distinct from c.locked and coalesce(p_allow, false) = c.allow_member_customization and c.revision > 0 then
    return c.revision;
  end if;
  v_rev := c.revision + 1;
  update public.company_proposal_styles set style = coalesce(p_style, '{}'::jsonb), locked = v_locked, allow_member_customization = coalesce(p_allow, false),
    revision = v_rev, updated_by = auth.uid(), updated_at = now() where company_id = v_company;
  insert into public.company_proposal_style_history (company_id, revision, style, locked, allow_member_customization, actor_id)
  values (v_company, v_rev, coalesce(p_style, '{}'::jsonb), v_locked, coalesce(p_allow, false), auth.uid());
  perform public.company_audit(v_company, 'proposal_style.saved', 'company', v_company::text,
    jsonb_build_object('revision', v_rev, 'allow', coalesce(p_allow, false), 'locked', to_jsonb(v_locked), 'styleChanged', p_style is distinct from c.style));
  return v_rev;
end $$;
revoke execute on function public.company_proposal_style_save(integer, jsonb, text[], boolean) from public, anon;
grant execute on function public.company_proposal_style_save(integer, jsonb, text[], boolean) to authenticated;

-- Reset one bid to the company style (clears the bid's own presentation choices only). The bid's author
-- may reset their own bid; template managers (and the owner) may reset any company bid they can see.
create or replace function public.proposal_style_reset(p_estimate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or auth.uid() is null or e.company_id is null or not public.estimate_readable(e.id)
     or not (e.user_id = auth.uid() or public.has_company_permission(e.company_id, 'manage_proposal_templates')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.estimates set proposal_config = (coalesce(proposal_config, '{}'::jsonb) - 'template' - 'show' - 'style')
    || jsonb_build_object('styleResetAt', now(), 'styleResetBy', auth.uid())
  where id = e.id;
  perform public.company_audit(e.company_id, 'proposal_style.bid_reset', 'estimate', e.id::text, '{}'::jsonb);
end $$;
revoke execute on function public.proposal_style_reset(uuid) from public, anon;
grant execute on function public.proposal_style_reset(uuid) to authenticated;
