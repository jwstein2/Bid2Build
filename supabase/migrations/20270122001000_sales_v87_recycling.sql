-- Sales Hub V8.7: "use it or lose it" lead recycling. Additive; safe to run more than once.
-- Requires 20270121001000_sales_v86_leads.sql (assignment history, allocation, notices).
--
--   * Every company lead gets a first-contact window (default 7 days from assignment). Only real work
--     counts: a call with an outcome, an email or text marked sent, a reply, or a meeting scheduled/held.
--     Notes, stage changes, viewing and failed or bounced emails never count.
--   * A worked lead is recycled only when a follow-up is overdue past the grace period (default 3 days)
--     with no qualifying activity since it came due.
--   * The owner is warned first (default 24 hours) with the business names and deadline. Nothing is
--     recycled unless that warning was recorded for that exact deadline, and the warning has run its course.
--   * Never recycled: customers, trials, paying or lost leads, do-not-contact or DNC-listed leads, leads
--     on an admin hold, leads with an upcoming appointment, leads under dispute, reps on time off (and the
--     two days after), reps in offboarding (handled by the offboarding wizard), rep-sourced and referral leads.
--   * A recycled lead keeps its record, history, source and attribution. It goes to the next eligible
--     rep by round robin, never back to the previous owner. With no alternative it waits in an exception
--     queue. After the configured number of cycles it goes to admin review instead of rotating forever.
--   * Nothing here touches sales_attributions or commissions.
--   * Clocks for leads assigned before this migration start when it runs (recycle_started_at).

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings and columns
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_settings add column if not exists recycle_enabled boolean not null default true;
alter table public.sales_settings add column if not exists recycle_first_contact_days integer not null default 7 check (recycle_first_contact_days between 3 and 30);
alter table public.sales_settings add column if not exists recycle_followup_grace_days integer not null default 3 check (recycle_followup_grace_days between 1 and 14);
alter table public.sales_settings add column if not exists recycle_warning_hours integer not null default 24 check (recycle_warning_hours between 12 and 72);
alter table public.sales_settings add column if not exists recycle_max_cycles integer not null default 3 check (recycle_max_cycles between 2 and 10);
alter table public.sales_settings add column if not exists recycle_started_at timestamptz not null default now();
alter table public.sales_settings add column if not exists recycle_last_run timestamptz;

alter table public.sales_leads add column if not exists recycle_count integer not null default 0;
alter table public.sales_leads add column if not exists recycle_hold_until timestamptz;
alter table public.sales_leads add column if not exists recycle_hold_note text check (recycle_hold_note is null or char_length(recycle_hold_note) <= 300);
alter table public.sales_leads drop constraint if exists sales_leads_hold;
alter table public.sales_leads add constraint sales_leads_hold check (hold_reason is null or hold_reason in
  ('no_eligible_rep', 'possible_duplicate', 'validation', 'admin_hold', 'needs_classification', 'manual', 'existing_customer',
   'recycle_no_alternative', 'recycle_review', 'dormant'));

-- The warning is tied to the deadline it warned about; a new deadline (extension, new rule) needs a new warning.
alter table public.sales_lead_assignments add column if not exists extended_until timestamptz;
alter table public.sales_lead_assignments add column if not exists warned_at timestamptz;
alter table public.sales_lead_assignments add column if not exists warned_for timestamptz;
create index if not exists sales_lead_assignments_open on public.sales_lead_assignments (lead_id) where ended_at is null;

create table if not exists public.sales_lead_recycles (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  from_rep uuid references public.sales_reps (id) on delete set null,
  to_rep uuid references public.sales_reps (id) on delete set null,
  reason text not null check (reason in ('first_contact', 'overdue_followup', 'owner_inactive', 'admin', 'returned')),
  outcome text not null check (outcome in ('reassigned', 'no_alternative', 'review')),
  cycle integer not null,
  note text check (note is null or char_length(note) <= 300),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_lead_recycles_lead on public.sales_lead_recycles (lead_id, created_at desc);
create index if not exists sales_lead_recycles_at on public.sales_lead_recycles (created_at desc);

create table if not exists public.sales_recycle_disputes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  -- One dispute per assignment, so a lead can't be kept forever by disputing again and again.
  assignment_id bigint not null unique references public.sales_lead_assignments (id) on delete cascade,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sales_recycle_disputes_open on public.sales_recycle_disputes (status) where status = 'open';

alter table public.sales_lead_recycles enable row level security;
alter table public.sales_recycle_disputes enable row level security;
revoke all on public.sales_lead_recycles, public.sales_recycle_disputes from public, anon, authenticated;
grant all on public.sales_lead_recycles, public.sales_recycle_disputes to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. What counts as working a lead
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_activity_qualifies(p_kind text, p_disposition text, p_evidence text) returns boolean
language sql immutable as $$
  select coalesce(p_evidence, 'manual') <> 'system' and case p_kind
    when 'call' then p_disposition is not null
    when 'email' then p_disposition = 'sent'
    when 'text' then p_disposition = 'sent'
    when 'meeting' then p_disposition in ('scheduled', 'held')
    when 'reply' then true
    else false end
$$;

-- none / attempted (tried) / delivered (provider confirmed) / two_way (they answered) / opportunity.
create or replace function public.sales_lead_contact_level(p_lead uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.stage in ('demo', 'trial', 'paying') then 'opportunity'
    when exists (select 1 from public.sales_activities a where a.lead_id = l.id and (a.kind = 'reply' or (a.kind = 'call' and a.disposition = 'connected') or (a.kind = 'meeting' and a.disposition = 'held'))) then 'two_way'
    when exists (select 1 from public.sales_activities a where a.lead_id = l.id and a.kind = 'email' and a.evidence = 'provider' and a.disposition = 'sent') then 'delivered'
    when exists (select 1 from public.sales_activities a where a.lead_id = l.id and public.sales_activity_qualifies(a.kind, a.disposition, a.evidence)) then 'attempted'
    else 'none' end
  from public.sales_leads l where l.id = p_lead
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Evaluation: one row per assigned company lead with its rule, deadline and any protection
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_recycle_eval(p_at timestamptz default now())
returns table (lead_id uuid, rep_id uuid, assignment_id bigint, assigned_at timestamptz, rule text, deadline timestamptz,
               warned_for timestamptz, warned_at timestamptz, protected text, first_qualifying timestamptz, next_due timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.sales_settings where id),
  b as (
    select l.id, l.assigned_rep, l.stage, l.customer_user_id, l.do_not_contact, l.dnc_status, l.recycle_hold_until,
      a.id as a_id, a.created_at as a_start, a.extended_until, a.warned_for as a_warned_for, a.warned_at as a_warned_at, r.status as r_status,
      exists (select 1 from public.sales_rep_offboardings o where o.rep_id = r.id and o.status = 'in_progress') as r_offboarding,
      exists (select 1 from public.sales_time_off t where t.rep_id = r.id and t.status = 'active' and p_at >= t.starts_at and p_at < t.ends_at + interval '2 days') as r_away,
      exists (select 1 from public.sales_calendar_events e where e.lead_id = l.id and e.ends_at > p_at and e.kind <> 'personal') as has_appt,
      exists (select 1 from public.sales_recycle_disputes d where d.assignment_id = a.id and d.status = 'open') as disputed,
      (select min(x.occurred_at) from public.sales_activities x where x.lead_id = l.id and x.occurred_at >= a.created_at
         and public.sales_activity_qualifies(x.kind, x.disposition, x.evidence)) as first_q,
      (select max(x.occurred_at) from public.sales_activities x where x.lead_id = l.id and x.occurred_at >= a.created_at
         and public.sales_activity_qualifies(x.kind, x.disposition, x.evidence)) as last_q,
      (select min(t.due_at) from public.sales_tasks t where t.lead_id = l.id and t.done_at is null) as next_due
    from public.sales_leads l
    join public.sales_reps r on r.id = l.assigned_rep
    join lateral (select * from public.sales_lead_assignments a where a.lead_id = l.id and a.ended_at is null order by a.created_at desc, a.id desc limit 1) a on true
    where l.lead_origin = 'company'
  ),
  c as (
    select b.*,
      case when b.r_status <> 'active' then 'owner_inactive'
           when b.first_q is null then 'first_contact'
           when b.next_due is not null and b.next_due < p_at and b.last_q < b.next_due then 'overdue_followup' end as v_rule
    from b
  )
  select c.id, c.assigned_rep, c.a_id, c.a_start, c.v_rule,
    case c.v_rule
      when 'owner_inactive' then p_at
      when 'first_contact' then greatest(greatest(c.a_start, s.recycle_started_at) + make_interval(days => s.recycle_first_contact_days), coalesce(c.extended_until, '-infinity'))
      when 'overdue_followup' then greatest(c.next_due + make_interval(days => s.recycle_followup_grace_days), coalesce(c.extended_until, '-infinity'))
    end,
    c.a_warned_for, c.a_warned_at,
    case when c.customer_user_id is not null or c.stage in ('trial', 'paying', 'lost') then 'customer_or_closed'
         when c.do_not_contact or c.dnc_status = 'listed' then 'contact_restricted'
         when c.recycle_hold_until > p_at then 'admin_hold'
         when c.has_appt then 'appointment'
         when c.r_offboarding then 'offboarding'
         when c.r_away and c.r_status = 'active' then 'time_off'
         when c.disputed then 'disputed' end,
    c.first_q, c.next_due
  from c cross join s
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Recycling one lead
-- ---------------------------------------------------------------------------------------------------
-- Returns {lead, name, from, to, outcome} or {skipped}. The caller sends notices (so a run sends one per rep).
create or replace function public.sales_recycle_lead(p_lead uuid, p_reason text, p_actor uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.sales_leads; s public.sales_settings; v_prev uuid; v_to uuid; v_cycle integer; v_outcome text; v_label text;
begin
  select * into s from public.sales_settings where id;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or l.assigned_rep is null then return jsonb_build_object('skipped', true); end if;
  v_prev := l.assigned_rep;
  v_cycle := l.recycle_count + 1;
  v_label := case p_reason
    when 'first_contact' then 'no qualifying contact within ' || s.recycle_first_contact_days || ' days of assignment'
    when 'overdue_followup' then 'follow-up overdue more than ' || s.recycle_followup_grace_days || ' days'
    when 'owner_inactive' then 'owner no longer active'
    when 'returned' then 'returned to the team by its owner'
    else 'recycled by an administrator' end;
  perform public.sales_assign_ctx('recycle', p_actor, left(v_label || coalesce(': ' || nullif(btrim(p_note), ''), ''), 300), null, 'rr-lra-1');
  if v_cycle >= s.recycle_max_cycles then
    update public.sales_leads set assigned_rep = null, hold_reason = 'recycle_review', hold_note = left('Recycled ' || v_cycle || ' times', 300), recycle_count = v_cycle, updated_at = now() where id = p_lead;
    v_outcome := 'review';
  else
    v_to := public.sales_allocate_pick(l.state, l.trades, array[v_prev]);
    if v_to is null then
      update public.sales_leads set assigned_rep = null, hold_reason = 'recycle_no_alternative', recycle_count = v_cycle, updated_at = now() where id = p_lead;
      v_outcome := 'no_alternative';
    else
      update public.sales_leads set assigned_rep = v_to, recycle_count = v_cycle, updated_at = now() where id = p_lead;
      v_outcome := 'reassigned';
    end if;
  end if;
  insert into public.sales_lead_recycles (lead_id, from_rep, to_rep, reason, outcome, cycle, note, actor_id)
  values (p_lead, v_prev, v_to, p_reason, v_outcome, v_cycle, left(nullif(btrim(p_note), ''), 300), p_actor);
  insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
  values (p_lead, p_actor, 'system', 'Returned to the team (' || v_label || ')' || case v_outcome
      when 'reassigned' then '. Now with ' || (select full_name from public.sales_reps where id = v_to) || '.'
      when 'review' then '. Waiting for an administrator to review.'
      else '. Waiting for another rep to become available.' end, 'system');
  return jsonb_build_object('lead', p_lead, 'name', l.company_name, 'from', v_prev, 'to', v_to, 'outcome', v_outcome);
end $$;

-- Notices for a set of recycle results: one to each previous owner, one to each new owner.
create or replace function public.sales_recycle_notify(p_results jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare rec record;
begin
  for rec in
    select (x->>'from')::uuid as rep, count(*) as n, string_agg(x->>'name', ', ' order by x->>'name') as names, array_agg((x->>'lead')::uuid) as ids
    from jsonb_array_elements(p_results) x where x->>'from' is not null group by 1
  loop
    insert into public.sales_rep_notices (rep_id, kind, body, lead_ids)
    values (rec.rep, 'leads_recycled', left(case when rec.n = 1 then 'One lead went back to the team: ' else rec.n || ' leads went back to the team: ' end
      || rec.names || '. Keep an eye on "Needs your attention" so the next ones stay with you.', 500), rec.ids);
  end loop;
  for rec in
    select (x->>'to')::uuid as rep, count(*) as n, array_agg((x->>'lead')::uuid) as ids
    from jsonb_array_elements(p_results) x where x->>'to' is not null group by 1
  loop
    insert into public.sales_rep_notices (rep_id, kind, body, lead_ids)
    values (rec.rep, 'leads_assigned', case when rec.n = 1 then '1 lead from the team pool was' else rec.n || ' leads from the team pool were' end
      || ' assigned to you. Reach out within ' || (select recycle_first_contact_days from public.sales_settings where id) || ' days.', rec.ids);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. The scheduled run (daily from the close job). Serialized by a lock, so overlapping runs are safe.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_recycle_run(p_actor uuid default null, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_settings; rec record; res jsonb; results jsonb := '[]'::jsonb; v_warned integer := 0; v_retried integer := 0; v_prev uuid; v_to uuid;
begin
  perform pg_advisory_xact_lock(hashtext('sales_recycle_run'));
  select * into s from public.sales_settings where id;
  if s.id is null then return jsonb_build_object('skipped', 'no_settings'); end if;
  if not s.recycle_enabled then return jsonb_build_object('skipped', 'paused'); end if;

  -- 1. Warnings: due within the warning window and not yet warned for this deadline.
  for rec in
    select e.rep_id, count(*) as n, min(e.deadline) as first_deadline,
      string_agg(l.company_name, ', ' order by e.deadline, l.company_name) as names, array_agg(e.lead_id) as ids, array_agg(e.assignment_id) as aids,
      array_agg(e.deadline) as deadlines
    from public.sales_recycle_eval(p_at) e join public.sales_leads l on l.id = e.lead_id
    where e.protected is null and e.rule in ('first_contact', 'overdue_followup')
      and e.deadline - make_interval(hours => s.recycle_warning_hours) <= p_at and e.warned_for is distinct from e.deadline
    group by e.rep_id
  loop
    update public.sales_lead_assignments a set warned_at = p_at, warned_for = d.deadline
    from unnest(rec.aids, rec.deadlines) as d(aid, deadline) where a.id = d.aid;
    insert into public.sales_rep_notices (rep_id, kind, body, lead_ids)
    values (rec.rep_id, 'recycle_warning', left(case when rec.n = 1 then 'One of your leads hasn''t' else rec.n || ' of your leads haven''t' end
      || ' had a call, sent email, reply or scheduled meeting yet. They go back to the team pool in about ' || s.recycle_warning_hours
      || ' hours unless you reach out or record a next step: ' || rec.names, 500), rec.ids);
    v_warned := v_warned + rec.n;
  end loop;

  -- 2. Recycle: past the deadline and warned for this deadline at least the warning window ago, or owner inactive.
  for rec in
    select e.lead_id, e.rule from public.sales_recycle_eval(p_at) e
    where e.protected is null and (e.rule = 'owner_inactive'
      or (e.rule in ('first_contact', 'overdue_followup') and e.deadline <= p_at and e.warned_for = e.deadline
          and e.warned_at <= p_at - make_interval(hours => s.recycle_warning_hours)))
    order by e.deadline limit 1000
  loop
    res := public.sales_recycle_lead(rec.lead_id, rec.rule, p_actor);
    if not (res ? 'skipped') then results := results || jsonb_build_array(res); end if;
  end loop;

  -- 3. Leads waiting for another rep: try again, still never the previous owner.
  for rec in select l.id, l.state, l.trades from public.sales_leads l
    where l.assigned_rep is null and l.hold_reason = 'recycle_no_alternative' and not l.do_not_contact and l.customer_user_id is null order by l.updated_at limit 500
  loop
    select from_rep into v_prev from public.sales_lead_recycles where lead_id = rec.id order by created_at desc, id desc limit 1;
    v_to := public.sales_allocate_pick(rec.state, rec.trades, array_remove(array[v_prev], null));
    if v_to is not null then
      perform public.sales_assign_ctx('recycle', p_actor, 'Shared out from the recycle queue', null, 'rr-lra-1');
      update public.sales_leads set assigned_rep = v_to, updated_at = now() where id = rec.id;
      results := results || jsonb_build_array(jsonb_build_object('lead', rec.id, 'to', v_to, 'outcome', 'reassigned'));
      v_retried := v_retried + 1;
    end if;
  end loop;

  perform public.sales_recycle_notify(results);
  update public.sales_settings set recycle_last_run = p_at where id;
  return jsonb_build_object('warned', v_warned,
    'recycled', (select count(*) from jsonb_array_elements(results) x where x ? 'from'),
    'to_review', (select count(*) from jsonb_array_elements(results) x where x->>'outcome' = 'review'),
    'no_alternative', (select count(*) from jsonb_array_elements(results) x where x->>'outcome' = 'no_alternative'),
    'requeued', v_retried);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Rep: what needs attention, give a lead back, dispute a warning
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_my_attention() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); s public.sales_settings; v_tz text; v_today date;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into s from public.sales_settings where id;
  select coalesce((select time_zone from public.sales_rep_calendar where rep_id = rep.id), 'America/Chicago') into v_tz;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'settings', jsonb_build_object('enabled', s.recycle_enabled, 'days', s.recycle_first_contact_days, 'grace', s.recycle_followup_grace_days, 'warning_hours', s.recycle_warning_hours),
    'away', exists (select 1 from public.sales_time_off t where t.rep_id = rep.id and t.status = 'active' and now() >= t.starts_at and now() < t.ends_at),
    'new', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'city', l.city, 'state', l.state, 'assigned_at', e.assigned_at,
        'deadline', e.deadline, 'warned', e.warned_for = e.deadline, 'protected', e.protected) order by e.deadline)
      from public.sales_recycle_eval(now()) e join public.sales_leads l on l.id = e.lead_id where e.rep_id = rep.id and e.rule = 'first_contact'), '[]'::jsonb),
    'approaching', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'rule', e.rule, 'deadline', e.deadline) order by e.deadline)
      from public.sales_recycle_eval(now()) e join public.sales_leads l on l.id = e.lead_id
      where e.rep_id = rep.id and e.protected is null and e.rule in ('first_contact', 'overdue_followup') and e.warned_for = e.deadline), '[]'::jsonb),
    'due_today', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'lead_id', t.lead_id, 'company_name', l.company_name, 'title', t.title, 'due_at', t.due_at) order by t.due_at)
      from public.sales_tasks t join public.sales_leads l on l.id = t.lead_id
      where t.rep_id = rep.id and t.done_at is null and (t.due_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'lead_id', t.lead_id, 'company_name', l.company_name, 'title', t.title, 'due_at', t.due_at) order by t.due_at)
      from public.sales_tasks t join public.sales_leads l on l.id = t.lead_id
      where t.rep_id = rep.id and t.done_at is null and (t.due_at at time zone v_tz)::date < v_today), '[]'::jsonb),
    -- A reply newer than anything we did after it.
    'replies', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'at', r.at) order by r.at desc)
      from public.sales_leads l
      join lateral (select max(a.occurred_at) as at from public.sales_activities a where a.lead_id = l.id and a.kind = 'reply') r on r.at is not null
      where l.assigned_rep = rep.id and l.stage not in ('paying', 'lost')
        and not exists (select 1 from public.sales_activities a where a.lead_id = l.id and a.kind in ('call', 'email', 'text', 'meeting') and a.occurred_at > r.at)), '[]'::jsonb)
  );
end $$;

create or replace function public.sales_crm_return_lead(p_lead uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; res jsonb;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or l.assigned_rep is distinct from rep.id then raise exception 'not_found'; end if;
  if l.lead_origin <> 'company' or l.customer_user_id is not null or l.stage in ('trial', 'paying') then raise exception 'cannot_return'; end if;
  res := public.sales_recycle_lead(p_lead, 'returned', auth.uid(), p_note);
  perform public.sales_recycle_notify(jsonb_build_array(res - 'from'));
  return res - 'from' - 'to';
end $$;

create or replace function public.sales_recycle_dispute(p_lead uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; v_aid bigint;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_lead;
  if not found or l.assigned_rep is distinct from rep.id then raise exception 'not_found'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'note_required'; end if;
  select id into v_aid from public.sales_lead_assignments where lead_id = p_lead and ended_at is null order by created_at desc, id desc limit 1;
  if v_aid is null then raise exception 'not_found'; end if;
  begin
    insert into public.sales_recycle_disputes (lead_id, rep_id, assignment_id, note) values (p_lead, rep.id, v_aid, left(btrim(p_note), 1000));
  exception when unique_violation then raise exception 'already_disputed';
  end;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body, evidence, actor_label)
  values (p_lead, rep.id, auth.uid(), 'system', 'Recycling paused for review: ' || left(btrim(p_note), 300), 'system', rep.full_name);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Admin controls
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_recycle_settings(p_caller uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_settings;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  update public.sales_settings set
    recycle_enabled = coalesce((p->>'enabled')::boolean, recycle_enabled),
    recycle_first_contact_days = coalesce((p->>'days')::int, recycle_first_contact_days),
    recycle_followup_grace_days = coalesce((p->>'grace')::int, recycle_followup_grace_days),
    recycle_warning_hours = coalesce((p->>'warning_hours')::int, recycle_warning_hours),
    recycle_max_cycles = coalesce((p->>'max_cycles')::int, recycle_max_cycles)
  where id returning * into s;
  perform public.sales_audit(p_caller, 'sales.recycle_settings', 'sales_settings', 'recycle', p);
  return jsonb_build_object('enabled', s.recycle_enabled, 'days', s.recycle_first_contact_days, 'grace', s.recycle_followup_grace_days,
    'warning_hours', s.recycle_warning_hours, 'max_cycles', s.recycle_max_cycles);
end $$;

create or replace function public.admin_sales_recycle_extend(p_caller uuid, p_leads uuid[], p_days integer, p_reason text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_days is null or p_days not between 1 and 30 then raise exception 'invalid'; end if;
  update public.sales_lead_assignments a set extended_until = now() + make_interval(days => p_days), warned_for = null, warned_at = null
  where a.ended_at is null and a.lead_id = any (coalesce(p_leads, '{}'));
  get diagnostics n = row_count;
  insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
  select unnest(p_leads), p_caller, 'system', 'Recycling deadline extended ' || p_days || ' day' || case when p_days = 1 then '' else 's' end
    || coalesce(' by an administrator: ' || nullif(left(btrim(p_reason), 200), ''), ' by an administrator'), 'system';
  perform public.sales_audit(p_caller, 'sales.recycle_extended', 'sales_lead', array_to_string(p_leads, ','), jsonb_build_object('days', p_days, 'reason', p_reason));
  return n;
end $$;

-- p_until null releases the hold.
create or replace function public.admin_sales_recycle_hold(p_caller uuid, p_leads uuid[], p_until timestamptz, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_until is not null and (p_until <= now() or p_until > now() + interval '180 days') then raise exception 'invalid'; end if;
  update public.sales_leads set recycle_hold_until = p_until, recycle_hold_note = case when p_until is null then null else left(nullif(btrim(p_note), ''), 300) end, updated_at = now()
  where id = any (coalesce(p_leads, '{}'));
  get diagnostics n = row_count;
  perform public.sales_audit(p_caller, case when p_until is null then 'sales.recycle_hold_released' else 'sales.recycle_hold' end, 'sales_lead', array_to_string(p_leads, ','),
    jsonb_build_object('until', p_until, 'note', p_note));
  return n;
end $$;

create or replace function public.admin_sales_recycle_now(p_caller uuid, p_leads uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid uuid; res jsonb; results jsonb := '[]'::jsonb;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  foreach lid in array coalesce(p_leads, '{}') loop
    res := public.sales_recycle_lead(lid, 'admin', p_caller, p_note);
    if not (res ? 'skipped') then results := results || jsonb_build_array(res); end if;
  end loop;
  perform public.sales_recycle_notify(results);
  perform public.sales_audit(p_caller, 'sales.recycle_now', 'sales_lead', array_to_string(p_leads, ','), jsonb_build_object('count', jsonb_array_length(results), 'note', p_note));
  return jsonb_build_object('recycled', jsonb_array_length(results),
    'reassigned', (select count(*) from jsonb_array_elements(results) x where x->>'outcome' = 'reassigned'));
end $$;

-- A lead that hit the cycle limit (or is waiting with no alternative): share out again, give to a rep, or park as dormant.
create or replace function public.admin_sales_recycle_review(p_caller uuid, p_lead uuid, p_decision text, p_rep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.sales_leads; v_prev uuid; v_to uuid;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_decision not in ('reassign', 'dormant') then raise exception 'invalid'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or l.assigned_rep is not null or l.hold_reason not in ('recycle_review', 'recycle_no_alternative', 'dormant') then raise exception 'not_found'; end if;
  if p_decision = 'dormant' then
    update public.sales_leads set hold_reason = 'dormant', hold_note = 'Parked after repeated recycling', updated_at = now() where id = p_lead;
    insert into public.sales_activities (lead_id, actor_id, kind, body, evidence) values (p_lead, p_caller, 'system', 'Parked as dormant by an administrator after repeated recycling.', 'system');
  else
    if p_rep is not null then
      if not exists (select 1 from public.sales_reps where id = p_rep and status = 'active' and sells) then raise exception 'rep_not_eligible'; end if;
      v_to := p_rep;
    else
      select from_rep into v_prev from public.sales_lead_recycles where lead_id = p_lead order by created_at desc, id desc limit 1;
      v_to := public.sales_allocate_pick(l.state, l.trades, array_remove(array[v_prev], null));
      if v_to is null then raise exception 'no_eligible_rep'; end if;
    end if;
    perform public.sales_assign_ctx(case when p_rep is null then 'auto' else 'manual' end, p_caller, 'After recycle review', null, case when p_rep is null then 'rr-lra-1' end);
    update public.sales_leads set assigned_rep = v_to, recycle_count = 0, updated_at = now() where id = p_lead;
    perform public.sales_recycle_notify(jsonb_build_array(jsonb_build_object('lead', p_lead, 'to', v_to)));
  end if;
  perform public.sales_audit(p_caller, 'sales.recycle_review', 'sales_lead', p_lead::text, jsonb_build_object('decision', p_decision, 'rep', v_to));
  return jsonb_build_object('ok', true, 'rep', v_to);
end $$;

create or replace function public.admin_sales_recycle_dispute_decide(p_caller uuid, p_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.sales_recycle_disputes; s public.sales_settings;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_decision not in ('upheld', 'rejected') then raise exception 'invalid'; end if;
  select * into s from public.sales_settings where id;
  update public.sales_recycle_disputes set status = p_decision, decision_note = left(nullif(btrim(p_note), ''), 300), decided_by = p_caller, decided_at = now()
  where id = p_id and status = 'open' returning * into d;
  if d.id is null then raise exception 'not_found'; end if;
  if p_decision = 'upheld' then
    -- The rep was right: a fresh window from today, and a new warning before any recycling.
    update public.sales_lead_assignments set extended_until = now() + make_interval(days => s.recycle_first_contact_days), warned_for = null, warned_at = null
    where id = d.assignment_id and ended_at is null;
  end if;
  insert into public.sales_rep_notices (rep_id, kind, body, lead_ids)
  values (d.rep_id, 'info', left(case when p_decision = 'upheld' then 'Your review request was accepted. The lead has a fresh ' || s.recycle_first_contact_days || '-day window.'
    else 'Your review request wasn''t accepted, so the normal recycling timeline applies.' end || coalesce(' Note: ' || nullif(btrim(p_note), ''), ''), 500), array[d.lead_id]);
  perform public.sales_audit(p_caller, 'sales.recycle_dispute', 'sales_lead', d.lead_id::text, jsonb_build_object('decision', p_decision, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- Lead Recycling dashboard. Filters: rep, trade, source, days (look-back window, default 7).
create or replace function public.admin_sales_recycle_overview(p_caller uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sales_settings; v_days integer := least(greatest(coalesce((p->>'days')::int, 7), 1), 365); v_since timestamptz; v_rep uuid; v_trade text; v_source text;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  select * into s from public.sales_settings where id;
  v_since := now() - make_interval(days => v_days);
  v_rep := case when coalesce(p->>'rep', '') ~ '^[0-9a-f-]{36}$' then (p->>'rep')::uuid end;
  v_trade := nullif(lower(btrim(coalesce(p->>'trade', ''))), '');
  v_source := nullif(btrim(coalesce(p->>'source', '')), '');
  return (
    with ev as (
      select e.*, l.company_name, l.trades, l.source, l.city, l.state from public.sales_recycle_eval(now()) e join public.sales_leads l on l.id = e.lead_id
      where (v_rep is null or e.rep_id = v_rep) and (v_trade is null or v_trade = any (l.trades)) and (v_source is null or l.source = v_source)
    ),
    asg as (
      select a.*, l.trades, l.source, l.stage,
        (select min(x.occurred_at) from public.sales_activities x where x.lead_id = a.lead_id and x.occurred_at >= a.created_at
           and (a.ended_at is null or x.occurred_at < a.ended_at) and public.sales_activity_qualifies(x.kind, x.disposition, x.evidence)) as first_q
      from public.sales_lead_assignments a join public.sales_leads l on l.id = a.lead_id
      where a.created_at >= v_since and a.rep_id is not null and l.lead_origin = 'company'
        and (v_rep is null or a.rep_id = v_rep) and (v_trade is null or v_trade = any (l.trades)) and (v_source is null or l.source = v_source)
    ),
    rc as (
      select r.*, l.company_name, l.stage, l.trades, l.source from public.sales_lead_recycles r join public.sales_leads l on l.id = r.lead_id
      where r.created_at >= v_since and (v_rep is null or r.from_rep = v_rep or r.to_rep = v_rep)
        and (v_trade is null or v_trade = any (l.trades)) and (v_source is null or l.source = v_source)
    )
    select jsonb_build_object(
      'settings', jsonb_build_object('enabled', s.recycle_enabled, 'days', s.recycle_first_contact_days, 'grace', s.recycle_followup_grace_days,
        'warning_hours', s.recycle_warning_hours, 'max_cycles', s.recycle_max_cycles, 'last_run', s.recycle_last_run, 'started_at', s.recycle_started_at),
      'window_days', v_days,
      'trades', coalesce((select jsonb_agg(t order by t) from (select distinct unnest(trades) t from public.sales_leads where assigned_rep is not null) x), '[]'::jsonb),
      'metrics', jsonb_build_object(
        'assigned', (select count(*) from asg),
        'contacted', (select count(*) from asg where first_q is not null),
        'untouched', (select count(*) from ev where rule = 'first_contact'),
        'approaching', (select count(*) from ev where protected is null and rule in ('first_contact', 'overdue_followup') and warned_for = deadline),
        'recycled', (select count(*) from rc),
        'contacted_after', (select count(*) from rc where rc.to_rep is not null and exists (select 1 from public.sales_activities x where x.lead_id = rc.lead_id and x.occurred_at > rc.created_at
            and public.sales_activity_qualifies(x.kind, x.disposition, x.evidence))),
        'converted_after', (select count(distinct rc.lead_id) from rc where rc.stage in ('trial', 'paying')),
        'reps_overdue', (select count(distinct rep_id) from ev where rule in ('first_contact', 'overdue_followup') and deadline <= now()),
        'repeat', (select count(*) from public.sales_leads l where l.recycle_count >= 2 and (v_trade is null or v_trade = any (l.trades)) and (v_source is null or l.source = v_source)),
        'avg_first_hours', (select round((avg(extract(epoch from (first_q - created_at))) / 3600)::numeric, 1) from asg where first_q is not null)
      ),
      'approaching', coalesce((select jsonb_agg(jsonb_build_object('lead_id', ev.lead_id, 'company_name', ev.company_name, 'rep_id', ev.rep_id,
          'rep_name', (select full_name from public.sales_reps where id = ev.rep_id), 'rule', ev.rule, 'deadline', ev.deadline,
          'warned', ev.warned_for = ev.deadline, 'protected', ev.protected) order by ev.deadline)
        from (select * from ev where rule is not null order by deadline limit 150) ev), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('id', rc.id, 'lead_id', rc.lead_id, 'company_name', rc.company_name, 'reason', rc.reason, 'outcome', rc.outcome,
          'cycle', rc.cycle, 'at', rc.created_at, 'from', (select full_name from public.sales_reps where id = rc.from_rep), 'to', (select full_name from public.sales_reps where id = rc.to_rep))
          order by rc.created_at desc) from (select * from rc order by created_at desc limit 100) rc), '[]'::jsonb),
      'review', coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'company_name', l.company_name, 'hold_reason', l.hold_reason, 'cycles', l.recycle_count,
          'city', l.city, 'state', l.state, 'updated_at', l.updated_at) order by l.updated_at)
        from public.sales_leads l where l.assigned_rep is null and l.hold_reason in ('recycle_review', 'recycle_no_alternative')), '[]'::jsonb),
      'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'lead_id', d.lead_id, 'company_name', l.company_name, 'rep_name', r.full_name, 'note', d.note, 'at', d.created_at) order by d.created_at)
        from public.sales_recycle_disputes d join public.sales_leads l on l.id = d.lead_id join public.sales_reps r on r.id = d.rep_id where d.status = 'open'), '[]'::jsonb),
      'reps', coalesce((select jsonb_agg(x order by x->>'name') from (
          select jsonb_build_object('id', r.id, 'name', r.full_name,
            'open', (select count(*) from ev where ev.rep_id = r.id),
            'untouched', (select count(*) from ev where ev.rep_id = r.id and ev.rule = 'first_contact'),
            'approaching', (select count(*) from ev where ev.rep_id = r.id and ev.protected is null and ev.rule in ('first_contact', 'overdue_followup') and ev.warned_for = ev.deadline),
            'overdue', (select count(*) from ev where ev.rep_id = r.id and ev.rule in ('first_contact', 'overdue_followup') and ev.deadline <= now()),
            'recycled_away', (select count(*) from rc where rc.from_rep = r.id),
            'away', exists (select 1 from public.sales_time_off t where t.rep_id = r.id and t.status = 'active' and now() >= t.starts_at and now() < t.ends_at),
            'paused', r.allocation_paused) as x
          from public.sales_reps r where r.status = 'active' and r.sells and (v_rep is null or r.id = v_rep)) q), '[]'::jsonb),
      -- Reps away now, with the follow-ups that come due while they're out (candidates for coverage).
      'coverage', coalesce((select jsonb_agg(jsonb_build_object('rep_id', r.id, 'rep_name', r.full_name, 'until', t.ends_at,
          'urgent', coalesce((select jsonb_agg(jsonb_build_object('lead_id', k.lead_id, 'company_name', l.company_name, 'title', k.title, 'due_at', k.due_at) order by k.due_at)
            from public.sales_tasks k join public.sales_leads l on l.id = k.lead_id where k.rep_id = r.id and k.done_at is null and k.due_at < t.ends_at), '[]'::jsonb)))
        from public.sales_time_off t join public.sales_reps r on r.id = t.rep_id
        where t.status = 'active' and now() >= t.starts_at and now() < t.ends_at), '[]'::jsonb)
    )
  );
end $$;

-- Recycling state and history for one lead (admin lead page).
create or replace function public.admin_sales_lead_recycle(p_caller uuid, p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.sales_leads;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  select * into l from public.sales_leads where id = p_lead;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'state', (select jsonb_build_object('rule', e.rule, 'deadline', e.deadline, 'warned', e.warned_for = e.deadline, 'protected', e.protected, 'first_qualifying', e.first_qualifying)
      from public.sales_recycle_eval(now()) e where e.lead_id = p_lead),
    'contact_level', public.sales_lead_contact_level(p_lead),
    'count', l.recycle_count, 'hold_until', l.recycle_hold_until, 'hold_note', l.recycle_hold_note, 'origin', l.lead_origin,
    'history', coalesce((select jsonb_agg(jsonb_build_object('reason', r.reason, 'outcome', r.outcome, 'cycle', r.cycle, 'at', r.created_at, 'note', r.note,
        'from', (select full_name from public.sales_reps where id = r.from_rep), 'to', (select full_name from public.sales_reps where id = r.to_rep)) order by r.created_at desc)
      from public.sales_lead_recycles r where r.lead_id = p_lead), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status, 'note', d.note, 'at', d.created_at, 'decision_note', d.decision_note) order by d.created_at desc)
      from public.sales_recycle_disputes d where d.lead_id = p_lead), '[]'::jsonb)
  );
end $$;

-- Recycling history for export (CSV built by the app).
create or replace function public.admin_sales_recycle_history(p_caller uuid, p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  return coalesce((select jsonb_agg(jsonb_build_object('at', r.created_at, 'lead_id', r.lead_id, 'company_name', l.company_name, 'reason', r.reason, 'outcome', r.outcome,
      'cycle', r.cycle, 'from', fr.full_name, 'to', tr.full_name, 'note', r.note) order by r.created_at desc)
    from public.sales_lead_recycles r join public.sales_leads l on l.id = r.lead_id
    left join public.sales_reps fr on fr.id = r.from_rep left join public.sales_reps tr on tr.id = r.to_rep
    where r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 730))), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_lead_contact_level(uuid)', 'public.sales_recycle_eval(timestamptz)', 'public.sales_recycle_lead(uuid, text, uuid, text)',
    'public.sales_recycle_notify(jsonb)', 'public.sales_recycle_run(uuid, timestamptz)',
    'public.admin_sales_recycle_settings(uuid, jsonb)', 'public.admin_sales_recycle_extend(uuid, uuid[], integer, text)',
    'public.admin_sales_recycle_hold(uuid, uuid[], timestamptz, text)', 'public.admin_sales_recycle_now(uuid, uuid[], text)',
    'public.admin_sales_recycle_review(uuid, uuid, text, uuid)', 'public.admin_sales_recycle_dispute_decide(uuid, uuid, text, text)',
    'public.admin_sales_recycle_overview(uuid, jsonb)', 'public.admin_sales_lead_recycle(uuid, uuid)', 'public.admin_sales_recycle_history(uuid, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.sales_my_attention()', 'public.sales_crm_return_lead(uuid, text)', 'public.sales_recycle_dispute(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'grant execute on function public.sales_activity_qualifies(text, text, text) to authenticated, service_role';
end $$;
