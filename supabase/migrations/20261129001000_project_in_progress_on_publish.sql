-- Project status rule (owner decision 2026-11-17): a project is In Progress as soon as scheduling is
-- complete (the schedule is published: draft -> active) and it has a start date. Every schedule has a
-- start_date (not null), so publishing is the moment.
--
-- 1. Publishing moves Won / Scheduled bids (and signed bids still in an earlier column) to In Progress.
--    Completed is never moved back. The stage history row is effective on the schedule's start date.
-- 2. Billing: a "project start confirmed" payment milestone triggers on that effective date, not when the
--    schedule was published, so a job published today that starts in three weeks isn't invoiced early.
-- 3. Backfill: live schedules still at Won/Scheduled move to In Progress; bids moved to In Progress by
--    hand while their only schedule is still a draft go back to Scheduled (scheduling isn't complete).
-- Rollback: docs/project-operations/rollback_20261129001000.sql

create or replace function public.project_schedules_sync_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_signed boolean;
begin
  if new.status = 'active' and old.status = 'draft' then
    select * into e from public.estimates where id = new.estimate_id for update;
    if not found then return new; end if;
    v_signed := exists (select 1 from public.signatures s where s.estimate_id = e.id);
    if e.pipeline_stage in ('won', 'scheduled') or (v_signed and e.pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending')) then
      perform set_config('app.stage_change', 'on', true);
      update public.estimates set pipeline_stage = 'in_progress', stage_changed_at = now(), won_at = coalesce(won_at, now()) where id = e.id;
      perform set_config('app.stage_change', '', true);
      insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
      values (e.id, e.company_id, e.pipeline_stage, 'in_progress', auth.uid(), 'Schedule published', new.start_date::timestamptz);
    end if;
    update public.project_reviews set status = 'reviewed', reviewed_by = coalesce(reviewed_by, auth.uid(), new.created_by),
           reviewed_at = coalesce(reviewed_at, now()), review_note = coalesce(review_note, 'Reviewed when the schedule was published')
     where estimate_id = new.estimate_id and status = 'needs_review' and coalesce(auth.uid(), new.created_by) is not null;
  end if;
  return new;
end $$;

create or replace function public.fin_milestone_triggered_at(p_milestone_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare m public.fin_payment_milestones; j public.fin_jobs; v timestamptz;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id;
  if not found or (auth.uid() is not null and not public.fin_job_visible(m.job_id)) then return null; end if;
  select * into j from public.fin_jobs where id = m.job_id;
  if m.trigger_kind = 'agreement_signed' then
    if m.source = 'change_order' then
      return (select decided_at from public.change_orders where id = m.change_order_id);
    end if;
    return coalesce((select signed_at from public.signatures where id = m.signature_id), (select created_at from public.fin_contract_snapshots where id = m.snapshot_id));
  elsif m.trigger_kind = 'calendar_date' then
    return case when m.due_date <= current_date then m.due_date::timestamptz end;
  elsif m.trigger_kind in ('phase_completed_verified', 'custom_approved') then
    return (select min(occurred_at) from public.fin_milestone_triggers t where t.milestone_id = m.id and t.trigger_kind = m.trigger_kind);
  end if;
  select min(occurred_at) into v from public.fin_milestone_triggers t
   where t.job_id = m.job_id and t.trigger_kind = m.trigger_kind and (t.milestone_id is null or t.milestone_id = m.id);
  return least(v, (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h
                    where h.estimate_id = j.estimate_id and coalesce(h.effective_at, h.created_at) <= now()
                      and h.to_stage = case m.trigger_kind when 'project_start_confirmed' then 'in_progress' else 'completed' end));
end $$;

-- Backfill (idempotent) --------------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform set_config('app.stage_change', 'on', true);
  for r in
    select e.id, e.company_id, e.pipeline_stage, s.start_date
      from public.estimates e
      join lateral (select start_date from public.project_schedules x where x.estimate_id = e.id and x.status = 'active' order by x.created_at desc limit 1) s on true
     where e.pipeline_stage in ('won', 'scheduled')
  loop
    update public.estimates set pipeline_stage = 'in_progress', stage_changed_at = now() where id = r.id;
    insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
    values (r.id, r.company_id, r.pipeline_stage, 'in_progress', null, 'Schedule published (status rule backfill)', r.start_date::timestamptz);
  end loop;
  for r in
    select e.id, e.company_id from public.estimates e
     where e.pipeline_stage = 'in_progress'
       and exists (select 1 from public.project_schedules x where x.estimate_id = e.id and x.status = 'draft')
       and not exists (select 1 from public.project_schedules x where x.estimate_id = e.id and x.status in ('active', 'completed'))
  loop
    update public.estimates set pipeline_stage = 'scheduled', stage_changed_at = now() where id = r.id;
    insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
    values (r.id, r.company_id, 'in_progress', 'scheduled', null, 'Schedule still a draft (status rule backfill)', now());
  end loop;
  perform set_config('app.stage_change', '', true);
end $$;
