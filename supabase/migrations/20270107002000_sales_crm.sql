-- Sales Portal, Phase 2: the sales CRM (leads, pipeline, activity history, tasks).
-- Requires 20270107001000_sales_portal.sql. Safe to re-run.
--
-- Security: RLS on, no direct grants. Reps work through sales_crm_* functions (auth.uid()) and only
-- see leads assigned to them (managers see every lead). The owner works through admin_sales_crm_*
-- functions (service role + is_admin). A lead is owned by one rep at a time, so two reps never work the
-- same business; duplicates are caught by a normalized key (website domain, phone, or name + ZIP).

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  email text check (email is null or (char_length(email) <= 320 and position('@' in email) > 1)),
  phone text check (phone is null or char_length(phone) <= 40),
  website text check (website is null or char_length(website) <= 300),
  city text check (city is null or char_length(city) <= 100),
  state text check (state is null or char_length(state) <= 40),
  zip text check (zip is null or zip ~ '^[0-9]{5}$'),
  trades text[] not null default '{}',
  -- Where the lead came from and when it was found.
  source text not null default 'manual' check (source in ('manual', 'import', 'places', 'link', 'owner')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 300),
  discovered_at timestamptz not null default now(),
  stage text not null default 'new' check (stage in ('new', 'contacted', 'engaged', 'demo', 'trial', 'paying', 'lost')),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 300),
  assigned_rep uuid references public.sales_reps (id) on delete set null,
  -- Linked when the business signs up (through the rep's link or matched by the owner).
  customer_user_id uuid references auth.users (id) on delete set null,
  do_not_contact boolean not null default false,
  next_action_at timestamptz,
  last_activity_at timestamptz,
  dedupe_keys text[] not null default '{}',
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_leads_rep on public.sales_leads (assigned_rep, stage);
create index if not exists sales_leads_keys on public.sales_leads using gin (dedupe_keys);
create index if not exists sales_leads_zip on public.sales_leads (zip);

create table if not exists public.sales_activities (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  rep_id uuid references public.sales_reps (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('call', 'email', 'text', 'meeting', 'note', 'stage', 'assignment', 'system')),
  body text check (body is null or char_length(body) <= 4000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists sales_activities_lead on public.sales_activities (lead_id, occurred_at desc);

create table if not exists public.sales_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_at timestamptz not null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sales_tasks_rep on public.sales_tasks (rep_id, done_at, due_at);

alter table public.sales_leads enable row level security;
alter table public.sales_activities enable row level security;
alter table public.sales_tasks enable row level security;
revoke all on public.sales_leads, public.sales_activities, public.sales_tasks from public, anon, authenticated;
grant all on public.sales_leads, public.sales_activities, public.sales_tasks to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Normalized identity keys: d:<domain>, p:<last 10 digits>, n:<name letters>|<zip>.
create or replace function public.sales_lead_keys(p_name text, p_website text, p_phone text, p_zip text) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when nullif(btrim(coalesce(p_website, '')), '') is null then null
      else 'd:' || regexp_replace(regexp_replace(lower(btrim(p_website)), '^(https?://)?(www\.)?', ''), '[/?#].*$', '') end,
    case when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
      then 'p:' || right(regexp_replace(p_phone, '\D', '', 'g'), 10) end,
    case when p_zip ~ '^[0-9]{5}$' and length(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g')) >= 3
      then 'n:' || regexp_replace(regexp_replace(lower(p_name), '\m(llc|inc|co|corp|company|ltd)\M', '', 'g'), '[^a-z0-9]', '', 'g') || '|' || p_zip end
  ], null)
$$;

create or replace function public.sales_my_rep() returns public.sales_reps
language sql stable security definer set search_path = public as $$
  select * from public.sales_reps where user_id = auth.uid() and status = 'active'
$$;

create or replace function public.sales_lead_json(l public.sales_leads) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(l) - 'dedupe_keys' - 'created_by' || jsonb_build_object(
    'rep_name', (select full_name from public.sales_reps r where r.id = l.assigned_rep),
    'open_tasks', (select count(*) from public.sales_tasks t where t.lead_id = l.id and t.done_at is null),
    'customer_tier', case when l.customer_user_id is null then null else public.sales_tier(l.customer_user_id) end)
$$;

-- Businesses already on file for these keys (for the duplicate warning and to block double outreach).
create or replace function public.sales_lead_duplicates(p_keys text[], p_except uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'zip', l.zip, 'rep_name', r.full_name, 'stage', l.stage)), '[]'::jsonb)
  from public.sales_leads l left join public.sales_reps r on r.id = l.assigned_rep
  where l.dedupe_keys && p_keys and (p_except is null or l.id <> p_except)
$$;

-- ---------------------------------------------------------------------------
-- Rep functions (authenticated)
-- ---------------------------------------------------------------------------
create or replace function public.sales_crm_can_see(rep public.sales_reps, l public.sales_leads) returns boolean
language sql stable set search_path = public as $$
  select rep.id is not null and (rep.role = 'manager' or l.assigned_rep = rep.id)
$$;

create or replace function public.sales_crm_leads() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep();
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return jsonb_build_object(
    'role', rep.role,
    'leads', coalesce((select jsonb_agg(public.sales_lead_json(l) order by l.next_action_at nulls last, l.updated_at desc)
      from public.sales_leads l where public.sales_crm_can_see(rep, l)), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'lead_id', t.lead_id, 'company_name', l.company_name, 'title', t.title, 'due_at', t.due_at) order by t.due_at)
      from public.sales_tasks t join public.sales_leads l on l.id = t.lead_id where t.rep_id = rep.id and t.done_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.sales_crm_lead(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_id;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'lead', public.sales_lead_json(l),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body, 'occurred_at', a.occurred_at, 'rep_name', r.full_name) order by a.occurred_at desc)
      from public.sales_activities a left join public.sales_reps r on r.id = a.rep_id where a.lead_id = l.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'done_at', t.done_at) order by t.done_at nulls first, t.due_at)
      from public.sales_tasks t where t.lead_id = l.id), '[]'::jsonb),
    'duplicates', public.sales_lead_duplicates(l.dedupe_keys, l.id)
  );
end $$;

-- Add a lead (assigned to the caller). A business already on file is refused with who has it.
create or replace function public.sales_crm_lead_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); v_keys text[]; d jsonb; l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  v_keys := public.sales_lead_keys(p->>'company_name', p->>'website', p->>'phone', p->>'zip');
  d := public.sales_lead_duplicates(v_keys);
  if jsonb_array_length(d) > 0 and coalesce((p->>'allow_duplicate')::boolean, false) is false then
    return jsonb_build_object('ok', false, 'error', 'duplicate', 'duplicates', d);
  end if;
  if jsonb_array_length(d) > 0 then
    -- Allowed only when every match is a lead nobody is working (e.g. a different branch office).
    if exists (select 1 from jsonb_array_elements(d) x where x->>'rep_name' is not null) then
      return jsonb_build_object('ok', false, 'error', 'owned_by_other', 'duplicates', d);
    end if;
  end if;
  insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, source_ref, assigned_rep, notes, dedupe_keys, created_by, next_action_at)
  values (btrim(p->>'company_name'), nullif(btrim(p->>'contact_name'), ''), nullif(lower(btrim(p->>'email')), ''), nullif(btrim(p->>'phone'), ''),
          nullif(btrim(p->>'website'), ''), nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'zip'), ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'trades', '[]'::jsonb)) x), '{}'),
          case when p->>'source' in ('manual', 'import', 'places') then p->>'source' else 'manual' end, nullif(p->>'source_ref', ''),
          rep.id, nullif(btrim(p->>'notes'), ''), v_keys, auth.uid(), now())
  returning * into l;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body) values (l.id, rep.id, auth.uid(), 'system', 'Lead added');
  return jsonb_build_object('ok', true, 'lead', public.sales_lead_json(l));
end $$;

create or replace function public.sales_crm_lead_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; v_old text;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_id for update;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  v_old := l.stage;
  if p ? 'stage' and p->>'stage' not in ('new', 'contacted', 'engaged', 'demo', 'trial', 'paying', 'lost') then raise exception 'invalid_stage'; end if;
  update public.sales_leads set
    company_name = coalesce(nullif(btrim(p->>'company_name'), ''), company_name),
    contact_name = case when p ? 'contact_name' then nullif(btrim(p->>'contact_name'), '') else contact_name end,
    email = case when p ? 'email' then nullif(lower(btrim(p->>'email')), '') else email end,
    phone = case when p ? 'phone' then nullif(btrim(p->>'phone'), '') else phone end,
    website = case when p ? 'website' then nullif(btrim(p->>'website'), '') else website end,
    city = case when p ? 'city' then nullif(btrim(p->>'city'), '') else city end,
    state = case when p ? 'state' then nullif(btrim(p->>'state'), '') else state end,
    zip = case when p ? 'zip' then nullif(btrim(p->>'zip'), '') else zip end,
    stage = coalesce(p->>'stage', stage),
    lost_reason = case when coalesce(p->>'stage', stage) = 'lost' then coalesce(nullif(btrim(p->>'lost_reason'), ''), lost_reason) else null end,
    do_not_contact = coalesce((p->>'do_not_contact')::boolean, do_not_contact),
    next_action_at = case when p ? 'next_action_at' then nullif(p->>'next_action_at', '')::timestamptz else next_action_at end,
    notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
    updated_at = now()
  where id = p_id returning * into l;
  update public.sales_leads set dedupe_keys = public.sales_lead_keys(l.company_name, l.website, l.phone, l.zip) where id = p_id returning * into l;
  if l.stage <> v_old then
    insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body) values (l.id, rep.id, auth.uid(), 'stage', v_old || ' → ' || l.stage || coalesce(': ' || l.lost_reason, ''));
  end if;
  return public.sales_lead_json(l);
end $$;

create or replace function public.sales_crm_activity_add(p_lead uuid, p_kind text, p_body text, p_occurred_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if p_kind not in ('call', 'email', 'text', 'meeting', 'note') then raise exception 'invalid_kind'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body, occurred_at)
  values (p_lead, rep.id, auth.uid(), p_kind, left(btrim(coalesce(p_body, '')), 4000), least(coalesce(p_occurred_at, now()), now()));
  update public.sales_leads set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'), least(coalesce(p_occurred_at, now()), now())),
    stage = case when stage = 'new' and p_kind in ('call', 'email', 'text', 'meeting') then 'contacted' else stage end, updated_at = now()
  where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sales_crm_task_save(p_lead uuid, p_task uuid, p_title text, p_due_at timestamptz, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; t public.sales_tasks;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_lead;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  if p_task is null then
    insert into public.sales_tasks (lead_id, rep_id, title, due_at) values (p_lead, rep.id, btrim(p_title), p_due_at) returning * into t;
  else
    update public.sales_tasks set title = coalesce(nullif(btrim(p_title), ''), title), due_at = coalesce(p_due_at, due_at),
      done_at = case when p_done then coalesce(done_at, now()) else null end
    where id = p_task and lead_id = p_lead and rep_id = rep.id returning * into t;
    if not found then raise exception 'not_found'; end if;
  end if;
  update public.sales_leads set next_action_at = (select min(due_at) from public.sales_tasks where lead_id = p_lead and done_at is null), updated_at = now() where id = p_lead;
  return to_jsonb(t);
end $$;

-- ---------------------------------------------------------------------------
-- Owner functions (service role + is_admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_sales_crm(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return jsonb_build_object('leads', coalesce((select jsonb_agg(public.sales_lead_json(l) order by l.updated_at desc) from public.sales_leads l), '[]'::jsonb));
end $$;

-- Assign (or unassign with p_rep null) one or many leads. Logged on each lead and in the audit log.
create or replace function public.admin_sales_crm_assign(p_caller uuid, p_leads uuid[], p_rep uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; rep_name text;
begin
  perform public.sales_require_admin(p_caller);
  if p_rep is not null then
    select full_name into rep_name from public.sales_reps where id = p_rep and status in ('active', 'invited');
    if rep_name is null then raise exception 'rep_not_found'; end if;
  end if;
  update public.sales_leads set assigned_rep = p_rep, updated_at = now() where id = any (p_leads) and assigned_rep is distinct from p_rep;
  get diagnostics n = row_count;
  insert into public.sales_activities (lead_id, actor_id, kind, body)
  select id, p_caller, 'assignment', coalesce('Assigned to ' || rep_name, 'Unassigned') from public.sales_leads where id = any (p_leads);
  perform public.sales_audit(p_caller, 'sales.leads_assigned', 'sales_rep', coalesce(p_rep::text, 'none'), jsonb_build_object('count', n));
  return n;
end $$;

-- Owner adds leads (one or a pasted batch). Duplicates are skipped and counted.
create or replace function public.admin_sales_crm_import(p_caller uuid, p_rows jsonb, p_rep uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_keys text[]; added integer := 0; skipped integer := 0;
begin
  perform public.sales_require_admin(p_caller);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    continue when char_length(btrim(coalesce(r->>'company_name', ''))) = 0;
    v_keys := public.sales_lead_keys(r->>'company_name', r->>'website', r->>'phone', r->>'zip');
    if exists (select 1 from public.sales_leads l where l.dedupe_keys && v_keys) then skipped := skipped + 1; continue; end if;
    insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, assigned_rep, dedupe_keys, created_by)
    values (left(btrim(r->>'company_name'), 200), nullif(btrim(r->>'contact_name'), ''), nullif(lower(btrim(r->>'email')), ''), nullif(left(btrim(r->>'phone'), 40), ''),
            nullif(left(btrim(r->>'website'), 300), ''), nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'state'), ''),
            case when r->>'zip' ~ '^[0-9]{5}$' then r->>'zip' end,
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'trades', '[]'::jsonb)) x), '{}'), 'owner', p_rep, v_keys, p_caller);
    added := added + 1;
  end loop;
  perform public.sales_audit(p_caller, 'sales.leads_imported', 'sales_rep', coalesce(p_rep::text, 'none'), jsonb_build_object('added', added, 'skipped', skipped));
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- When an attributed account signs up, link a matching lead of the same rep and move it to "trial".
create or replace function public.sales_crm_link_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = new.user_id;
  update public.sales_leads set customer_user_id = new.user_id, stage = case when stage in ('paying', 'lost') then stage else 'trial' end, updated_at = now()
  where id = (select id from public.sales_leads where assigned_rep = new.rep_id and customer_user_id is null and email = v_email order by created_at limit 1);
  return new;
end $$;
drop trigger if exists sales_attributions_link_lead on public.sales_attributions;
create trigger sales_attributions_link_lead after insert on public.sales_attributions for each row execute function public.sales_crm_link_customer();

-- First payment: the linked lead becomes "paying".
create or replace function public.sales_crm_mark_paying() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.first_paid_at is not null and old.first_paid_at is null then
    update public.sales_leads set stage = 'paying', updated_at = now() where customer_user_id = new.user_id and stage <> 'paying';
  end if;
  return new;
end $$;
drop trigger if exists sales_attributions_paying on public.sales_attributions;
create trigger sales_attributions_paying after update of first_paid_at on public.sales_attributions for each row execute function public.sales_crm_mark_paying();

do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_lead_keys(text, text, text, text)', 'public.sales_my_rep()', 'public.sales_lead_json(public.sales_leads)',
    'public.sales_lead_duplicates(text[], uuid)', 'public.sales_crm_can_see(public.sales_reps, public.sales_leads)',
    'public.admin_sales_crm(uuid)', 'public.admin_sales_crm_assign(uuid, uuid[], uuid)', 'public.admin_sales_crm_import(uuid, jsonb, uuid)',
    'public.sales_crm_link_customer()', 'public.sales_crm_mark_paying()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function public.sales_crm_leads(), public.sales_crm_lead(uuid), public.sales_crm_lead_create(jsonb),
  public.sales_crm_lead_update(uuid, jsonb), public.sales_crm_activity_add(uuid, text, text, timestamptz),
  public.sales_crm_task_save(uuid, uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.sales_crm_leads(), public.sales_crm_lead(uuid), public.sales_crm_lead_create(jsonb),
  public.sales_crm_lead_update(uuid, jsonb), public.sales_crm_activity_add(uuid, text, text, timestamptz),
  public.sales_crm_task_save(uuid, uuid, text, timestamptz, boolean) to authenticated;
