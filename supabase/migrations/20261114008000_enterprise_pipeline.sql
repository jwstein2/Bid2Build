-- Enterprise Phase 4: bid pipeline stages, review history, optional approval rule, and Command Center aggregates.
-- Requires 20261114005000_enterprise_workspace.sql. Safe to run more than once.
--
-- Stages: draft -> ready_for_review -> approved -> sent -> pending -> won | lost.
-- A stage only changes through set_estimate_stage(); nothing (PDF export, finalize) moves a bid to "sent".

-- ---------------------------------------------------------------------------
-- 1. Columns, history table, indexes
-- ---------------------------------------------------------------------------
alter table public.estimates add column if not exists pipeline_stage text not null default 'draft';
alter table public.estimates add column if not exists stage_changed_at timestamptz;
alter table public.estimates add column if not exists lost_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'estimates_pipeline_stage_check') then
    alter table public.estimates add constraint estimates_pipeline_stage_check
      check (pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'estimates_lost_reason_len') then
    alter table public.estimates add constraint estimates_lost_reason_len check (char_length(lost_reason) <= 500);
  end if;
end $$;

-- Existing finalized bids start as "ready for review": finalizing never means the customer received it.
update public.estimates set pipeline_stage = 'ready_for_review', stage_changed_at = updated_at
where status = 'finalized' and pipeline_stage = 'draft' and stage_changed_at is null;

create index if not exists estimates_company_created_idx on public.estimates (company_id, created_at desc) where company_id is not null;
create index if not exists estimates_company_stage_idx on public.estimates (company_id, pipeline_stage) where company_id is not null;

create table if not exists public.estimate_stage_history (
  id bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  from_stage text not null,
  to_stage text not null,
  changed_by uuid references auth.users (id) on delete set null,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists estimate_stage_history_estimate_idx on public.estimate_stage_history (estimate_id, created_at desc);
alter table public.estimate_stage_history enable row level security;
drop policy if exists estimate_stage_history_select on public.estimate_stage_history;
-- Visible whenever the bid itself is visible (the estimates subquery is RLS-filtered).
create policy estimate_stage_history_select on public.estimate_stage_history for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_stage_history.estimate_id));
revoke all on public.estimate_stage_history from anon, authenticated;
grant select on public.estimate_stage_history to authenticated;

-- Stages change only through set_estimate_stage(): owners can otherwise update their own rows directly,
-- which would bypass the approval rule. New rows always start as drafts.
create or replace function public.guard_pipeline_stage() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.stage_change', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.pipeline_stage := 'draft'; new.stage_changed_at := null; new.lost_reason := null;
  elsif new.pipeline_stage is distinct from old.pipeline_stage or new.lost_reason is distinct from old.lost_reason then
    raise exception 'use_set_estimate_stage' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists estimates_guard_pipeline_stage on public.estimates;
create trigger estimates_guard_pipeline_stage before insert or update on public.estimates
  for each row execute function public.guard_pipeline_stage();

-- ---------------------------------------------------------------------------
-- 2. Approval rule (company setting)
-- ---------------------------------------------------------------------------
create or replace function public.company_requires_approval(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (c.settings ->> 'require_approval')::boolean from public.companies c where c.id = p_company), false)
$$;

create or replace function public.set_company_approval_rule(p_required boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not exists (select 1 from public.companies c where c.id = v_company and c.owner_user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.companies set settings = settings || jsonb_build_object('require_approval', coalesce(p_required, false)) where id = v_company;
  perform public.company_audit(v_company, 'company.approval_rule', 'company', v_company::text, jsonb_build_object('required', coalesce(p_required, false)));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Stage changes
-- ---------------------------------------------------------------------------
create or replace function public.set_estimate_stage(p_estimate_id uuid, p_stage text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
  v_uid uuid := auth.uid();
  v_company uuid;
  v_visible boolean;
  v_author boolean;
  v_owner boolean;
  v_can_edit boolean;
  v_can_approve boolean;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_stage is null or p_stage not in ('draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'lost') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  v_author := e.user_id = v_uid;

  if e.company_id is null then
    -- Personal bid: only its owner, no approval step.
    if not v_author then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  else
    v_company := public.my_company_id();
    if v_company is distinct from e.company_id then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    v_visible := exists (select 1 from public.my_visible_bid_owners() v where v.company_id = e.company_id and v.user_id = e.user_id);
    if not (v_author or v_visible) then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    v_owner := exists (select 1 from public.companies c where c.id = v_company and c.owner_user_id = v_uid);
    v_can_edit := v_author or (v_visible and public.has_company_permission(v_company, 'edit_team_estimates'));
    -- With the approval rule on, only the owner may approve their own bid.
    v_can_approve := v_visible and public.has_company_permission(v_company, 'approve_bids')
      and (not v_author or v_owner or not public.company_requires_approval(v_company));

    if p_stage = 'approved' then
      if not v_can_approve then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif p_stage in ('draft', 'ready_for_review') then
      -- Reviewers may send a bid back for changes.
      if not (v_can_edit or v_can_approve) then raise exception 'forbidden' using errcode = '42501'; end if;
    else
      if not v_can_edit then raise exception 'forbidden' using errcode = '42501'; end if;
      if p_stage = 'sent' and public.company_requires_approval(v_company) and not v_can_approve
         and e.pipeline_stage not in ('approved', 'sent', 'pending', 'won', 'lost') then
        raise exception 'approval_required' using errcode = '42501';
      end if;
    end if;
  end if;

  if e.pipeline_stage = p_stage and v_note is null then return; end if;

  perform set_config('app.stage_change', 'on', true);
  update public.estimates set pipeline_stage = p_stage, stage_changed_at = now(),
    lost_reason = case when p_stage = 'lost' then v_note else null end
  where id = e.id;
  perform set_config('app.stage_change', '', true);

  insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note)
  values (e.id, e.company_id, e.pipeline_stage, p_stage, v_uid, v_note);
  if e.company_id is not null then
    perform public.company_audit(e.company_id, 'bid.stage', 'estimate', e.id::text,
      jsonb_build_object('from', e.pipeline_stage, 'to', p_stage));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Command Center reads (scoped to the bids the caller may see; one pass each, fine at 200+ users)
-- ---------------------------------------------------------------------------
create or replace function public.company_pipeline_bids(
  p_stage text default null, p_user uuid default null, p_team uuid default null, p_q text default null,
  p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 50, p_offset integer default 0
) returns table (
  id uuid, title text, estimate_number text, customer_name text, trades text[], pipeline_stage text, status text,
  user_id uuid, owner_name text, total numeric, margin_pct numeric, created_at timestamptz, updated_at timestamptz,
  stage_changed_at timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_margin boolean;
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if v_company is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  v_margin := public.has_company_permission(v_company, 'view_margin');
  return query
    with vis as (select v.user_id from public.my_visible_bid_owners() v where v.company_id = v_company),
    base as (
      select e.* from public.estimates e
      where e.company_id = v_company and e.status <> 'archived'
        and e.user_id in (select vis.user_id from vis)
        and (p_stage is null or e.pipeline_stage = p_stage)
        and (p_user is null or e.user_id = p_user)
        and (p_team is null or e.user_id in (select tm.user_id from public.company_team_members tm where tm.team_id = p_team and tm.company_id = v_company))
        and (p_from is null or e.created_at >= p_from)
        and (p_to is null or e.created_at < p_to)
        and (v_q is null or e.title ilike '%' || v_q || '%' or e.customer_name ilike '%' || v_q || '%' or e.estimate_number ilike '%' || v_q || '%')
    )
    select b.id, b.title, b.estimate_number, b.customer_name, b.trades, b.pipeline_stage, b.status, b.user_id,
      coalesce(m.display_name, m.email, 'Team member'), lv.total,
      case when v_margin and lv.subtotal > 0 then round((lv.subtotal - lv.total_cost) / lv.subtotal * 100, 1) end,
      b.created_at, b.updated_at, b.stage_changed_at, count(*) over ()
    from base b
    left join public.company_members m on m.company_id = v_company and m.user_id = b.user_id
    left join lateral (select ev.total, ev.subtotal, ev.total_cost from public.estimate_versions ev
                       where ev.estimate_id = b.id order by ev.version_number desc limit 1) lv on true
    order by b.updated_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 5000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.company_pipeline_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_team uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_margin boolean;
  v_out jsonb;
begin
  if v_company is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not public.has_company_permission(v_company, 'view_analytics') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_margin := public.has_company_permission(v_company, 'view_margin');
  with vis as (select v.user_id from public.my_visible_bid_owners() v where v.company_id = v_company),
  b as (
    select e.id, e.user_id, e.pipeline_stage as stage, lv.total, lv.subtotal, lv.total_cost,
      case when lv.subtotal > 0 then (lv.subtotal - lv.total_cost) / lv.subtotal end as margin
    from public.estimates e
    left join lateral (select ev.total, ev.subtotal, ev.total_cost from public.estimate_versions ev
                       where ev.estimate_id = e.id order by ev.version_number desc limit 1) lv on true
    where e.company_id = v_company and e.status <> 'archived'
      and e.user_id in (select vis.user_id from vis)
      and (p_team is null or e.user_id in (select tm.user_id from public.company_team_members tm where tm.team_id = p_team and tm.company_id = v_company))
      and (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at < p_to)
  ),
  k as (
    select count(*) as bids,
      count(*) filter (where stage in ('sent', 'pending', 'won', 'lost')) as sent,
      count(*) filter (where stage = 'won') as won,
      count(*) filter (where stage = 'lost') as lost,
      count(*) filter (where stage = 'ready_for_review') as awaiting_review,
      coalesce(sum(total) filter (where stage = 'won'), 0) as won_value,
      coalesce(sum(total) filter (where stage in ('sent', 'pending')), 0) as open_value,
      avg(total) filter (where total is not null) as avg_bid,
      avg(margin) as avg_margin
    from b
  ),
  s as (
    select jsonb_object_agg(st, jsonb_build_object('count', coalesce(c, 0), 'value', coalesce(v, 0))) as stages
    from unnest(array['draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'lost']) st
    left join (select stage, count(*) c, sum(total) v from b group by stage) g on g.stage = st
  ),
  mem as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', x.user_id, 'name', coalesce(m.display_name, m.email, 'Team member'), 'status', m.status,
      'bids', x.bids, 'sent', x.sent, 'won', x.won, 'lost', x.lost, 'wonValue', x.won_value,
      'avgBid', round(x.avg_bid, 2), 'winRate', case when x.won + x.lost > 0 then round(x.won::numeric / (x.won + x.lost) * 100, 1) end,
      'avgMargin', case when v_margin then round(x.avg_margin * 100, 1) end
    ) order by x.won_value desc, x.bids desc), '[]'::jsonb) as members
    from (
      select user_id, count(*) bids,
        count(*) filter (where stage in ('sent', 'pending', 'won', 'lost')) sent,
        count(*) filter (where stage = 'won') won, count(*) filter (where stage = 'lost') lost,
        coalesce(sum(total) filter (where stage = 'won'), 0) won_value,
        avg(total) filter (where total is not null) avg_bid, avg(margin) avg_margin
      from b group by user_id
    ) x left join public.company_members m on m.company_id = v_company and m.user_id = x.user_id
  )
  select jsonb_build_object(
    'bids', k.bids, 'sent', k.sent, 'won', k.won, 'lost', k.lost, 'awaitingReview', k.awaiting_review,
    'winRate', case when k.won + k.lost > 0 then round(k.won::numeric / (k.won + k.lost) * 100, 1) end,
    'wonValue', k.won_value, 'openValue', k.open_value, 'avgBid', round(k.avg_bid, 2),
    'avgMargin', case when v_margin then round(k.avg_margin * 100, 1) end,
    'stages', s.stages, 'members', mem.members,
    'requireApproval', public.company_requires_approval(v_company)
  ) into v_out from k, s, mem;
  return v_out;
end $$;

-- Read-only review of one bid the caller may see: header, latest version totals (cost and margin only with
-- view_costs / view_margin), and the stage history with who made each change.
create or replace function public.company_bid_review(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  e public.estimates%rowtype;
  v_costs boolean; v_margin boolean;
  lv record;
begin
  if v_company is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate_id and company_id = v_company and status <> 'archived';
  if not found or not (e.user_id = auth.uid() or exists (select 1 from public.my_visible_bid_owners() v where v.company_id = v_company and v.user_id = e.user_id)) then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;
  v_costs := public.has_company_permission(v_company, 'view_costs');
  v_margin := public.has_company_permission(v_company, 'view_margin');
  select ev.version_number, ev.total, ev.subtotal, ev.tax, ev.total_cost, ev.created_at into lv
    from public.estimate_versions ev where ev.estimate_id = e.id order by ev.version_number desc limit 1;
  return jsonb_build_object(
    'id', e.id, 'title', e.title, 'estimateNumber', e.estimate_number, 'customerName', e.customer_name,
    'projectAddress', e.project_address, 'trades', to_jsonb(e.trades), 'stage', e.pipeline_stage, 'status', e.status,
    'lostReason', e.lost_reason, 'userId', e.user_id, 'isMine', e.user_id = auth.uid(),
    'ownerName', (select coalesce(m.display_name, m.email, 'Team member') from public.company_members m where m.company_id = v_company and m.user_id = e.user_id),
    'createdAt', e.created_at, 'updatedAt', e.updated_at,
    'version', case when lv.version_number is null then null else jsonb_build_object(
      'number', lv.version_number, 'total', lv.total, 'subtotal', lv.subtotal, 'tax', lv.tax, 'createdAt', lv.created_at,
      'cost', case when v_costs then lv.total_cost end,
      'marginPct', case when v_margin and lv.subtotal > 0 then round((lv.subtotal - lv.total_cost) / lv.subtotal * 100, 1) end) end,
    'canSeeCosts', v_costs,
    'history', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_stage, 'to', h.to_stage, 'note', h.note, 'at', h.created_at,
        'by', coalesce(m.display_name, m.email, 'Team member')) order by h.created_at desc, h.id desc)
      from public.estimate_stage_history h left join public.company_members m on m.company_id = v_company and m.user_id = h.changed_by
      where h.estimate_id = e.id), '[]'::jsonb)
  );
end $$;

revoke execute on function public.company_requires_approval(uuid), public.set_company_approval_rule(boolean),
  public.set_estimate_stage(uuid, text, text),
  public.company_pipeline_bids(text, uuid, uuid, text, timestamptz, timestamptz, integer, integer),
  public.company_pipeline_summary(timestamptz, timestamptz, uuid), public.company_bid_review(uuid) from public, anon;
grant execute on function public.company_requires_approval(uuid), public.set_company_approval_rule(boolean),
  public.set_estimate_stage(uuid, text, text),
  public.company_pipeline_bids(text, uuid, uuid, text, timestamptz, timestamptz, integer, integer),
  public.company_pipeline_summary(timestamptz, timestamptz, uuid), public.company_bid_review(uuid) to authenticated;
