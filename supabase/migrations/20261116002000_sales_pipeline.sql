-- V4 sales pipeline (contractor Bids dashboard). Requires 20261114008000_enterprise_pipeline.sql and
-- 20261115001000_e_signatures.sql. Safe to run more than once. Changes no billing and no existing data except
-- backfilling estimates.won_at for bids already marked Won.
--
-- Concepts stay separate:
--   * pipeline_stage   = where the contractor says the bid is (draft ... won, then job stages, or lost)
--   * signing status   = derived from signing_requests / signatures (never written here)
--   * won_at           = when the bid was approved (manual date, or the e-signature time shown by the app)
-- A manual move to Won never creates or implies a signature.

-- ---------------------------------------------------------------------------
-- 1. New job stages, won date, effective date on history
-- ---------------------------------------------------------------------------
alter table public.estimates drop constraint if exists estimates_pipeline_stage_check;
alter table public.estimates add constraint estimates_pipeline_stage_check
  check (pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'scheduled', 'in_progress', 'completed', 'lost'));
alter table public.estimates add column if not exists won_at timestamptz;
alter table public.estimate_stage_history add column if not exists effective_at timestamptz;

update public.estimates set won_at = coalesce(stage_changed_at, updated_at)
where pipeline_stage = 'won' and won_at is null;

create index if not exists estimate_stage_history_company_created_idx on public.estimate_stage_history (company_id, created_at desc);

-- won_at is protected exactly like pipeline_stage: only set_estimate_stage() writes it.
create or replace function public.guard_pipeline_stage() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.stage_change', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.pipeline_stage := 'draft'; new.stage_changed_at := null; new.lost_reason := null; new.won_at := null;
  elsif new.pipeline_stage is distinct from old.pipeline_stage or new.lost_reason is distinct from old.lost_reason
     or new.won_at is distinct from old.won_at then
    raise exception 'use_set_estimate_stage' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Stage changes (replaces the 3-argument version; same permission rules, plus transition rules)
-- ---------------------------------------------------------------------------
drop function if exists public.set_estimate_stage(uuid, text, text);
create or replace function public.set_estimate_stage(
  p_estimate_id uuid, p_stage text, p_note text default null, p_effective_at timestamptz default null
) returns void
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
  v_signed boolean;
  v_won_family constant text[] := array['won', 'scheduled', 'in_progress', 'completed'];
  v_effective timestamptz := coalesce(p_effective_at, now());
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_stage is null or p_stage not in ('draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'scheduled', 'in_progress', 'completed', 'lost') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  if p_effective_at is not null and p_effective_at > now() + interval '1 day' then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  v_author := e.user_id = v_uid;

  if e.company_id is null then
    if not v_author then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  else
    v_company := public.my_company_id();
    if v_company is distinct from e.company_id then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    v_visible := exists (select 1 from public.my_visible_bid_owners() v where v.company_id = e.company_id and v.user_id = e.user_id);
    if not (v_author or v_visible) then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    v_owner := exists (select 1 from public.companies c where c.id = v_company and c.owner_user_id = v_uid);
    v_can_edit := v_author or (v_visible and public.has_company_permission(v_company, 'edit_team_estimates'));
    v_can_approve := v_visible and public.has_company_permission(v_company, 'approve_bids')
      and (not v_author or v_owner or not public.company_requires_approval(v_company));

    if p_stage = 'approved' then
      if not v_can_approve then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif p_stage in ('draft', 'ready_for_review') then
      if not (v_can_edit or v_can_approve) then raise exception 'forbidden' using errcode = '42501'; end if;
    else
      if not v_can_edit then raise exception 'forbidden' using errcode = '42501'; end if;
      if p_stage in ('sent', 'pending') and public.company_requires_approval(v_company) and not v_can_approve
         and e.pipeline_stage not in ('approved', 'sent', 'pending', 'won', 'scheduled', 'in_progress', 'completed', 'lost') then
        raise exception 'approval_required' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Transition rules. A real signature is evidence: the bid can't be moved back before Won (Lost stays
  -- possible for a cancelled job), and job stages need an approved (won or signed) bid.
  v_signed := exists (select 1 from public.signatures s where s.estimate_id = e.id);
  if v_signed and p_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending') then
    raise exception 'bid_signed' using errcode = '42501';
  end if;
  if p_stage in ('scheduled', 'in_progress', 'completed') and not (e.pipeline_stage = any (v_won_family) or v_signed) then
    raise exception 'not_won' using errcode = '42501';
  end if;

  if e.pipeline_stage = p_stage and v_note is null and p_effective_at is null then return; end if;

  perform set_config('app.stage_change', 'on', true);
  update public.estimates set pipeline_stage = p_stage, stage_changed_at = now(),
    lost_reason = case when p_stage = 'lost' then v_note else null end,
    won_at = case
      when p_stage = 'won' and (p_effective_at is not null or not (e.pipeline_stage = any (v_won_family))) then v_effective
      when p_stage = any (v_won_family) then coalesce(e.won_at, v_effective)
      else null end
  where id = e.id;
  perform set_config('app.stage_change', '', true);

  insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
  values (e.id, e.company_id, e.pipeline_stage, p_stage, v_uid, v_note, v_effective);
  if e.company_id is not null then
    perform public.company_audit(e.company_id, 'bid.stage', 'estimate', e.id::text,
      jsonb_build_object('from', e.pipeline_stage, 'to', p_stage));
  end if;
end $$;

revoke execute on function public.set_estimate_stage(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.set_estimate_stage(uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enterprise Command Center summary: Won now includes the job stages (a scheduled job is still a won bid)
-- ---------------------------------------------------------------------------
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
      count(*) filter (where stage in ('sent', 'pending', 'won', 'lost', 'scheduled', 'in_progress', 'completed')) as sent,
      count(*) filter (where stage in ('won', 'scheduled', 'in_progress', 'completed')) as won,
      count(*) filter (where stage = 'lost') as lost,
      count(*) filter (where stage = 'ready_for_review') as awaiting_review,
      coalesce(sum(total) filter (where stage in ('won', 'scheduled', 'in_progress', 'completed')), 0) as won_value,
      coalesce(sum(total) filter (where stage in ('sent', 'pending')), 0) as open_value,
      avg(total) filter (where total is not null) as avg_bid,
      avg(margin) as avg_margin
    from b
  ),
  s as (
    select jsonb_object_agg(st, jsonb_build_object('count', coalesce(c, 0), 'value', coalesce(v, 0))) as stages
    from unnest(array['draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'scheduled', 'in_progress', 'completed', 'lost']) st
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
        count(*) filter (where stage in ('sent', 'pending', 'won', 'lost', 'scheduled', 'in_progress', 'completed')) sent,
        count(*) filter (where stage in ('won', 'scheduled', 'in_progress', 'completed')) won, count(*) filter (where stage = 'lost') lost,
        coalesce(sum(total) filter (where stage in ('won', 'scheduled', 'in_progress', 'completed')), 0) won_value,
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


-- ---------------------------------------------------------------------------
-- 4. Sales pay calculator settings: private to each user (teammates and company owners can't read them)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_pay_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  method text not null default 'percent_sale' check (method in ('percent_sale', 'percent_profit', 'percent_base', 'flat')),
  rate numeric(7, 3) not null default 0 check (rate >= 0 and rate <= 100),
  flat_fee numeric(12, 2) not null default 0 check (flat_fee >= 0 and flat_fee <= 1000000),
  base_salary numeric(12, 2) not null default 0 check (base_salary >= 0 and base_salary <= 10000000),
  base_exclusions numeric(7, 3) not null default 0 check (base_exclusions >= 0 and base_exclusions <= 100),
  updated_at timestamptz not null default now()
);
alter table public.sales_pay_settings enable row level security;
drop policy if exists sales_pay_settings_own on public.sales_pay_settings;
create policy sales_pay_settings_own on public.sales_pay_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.sales_pay_settings from anon, authenticated;
grant select, insert, update, delete on public.sales_pay_settings to authenticated;
