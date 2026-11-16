-- Project Operations V4.3 (part 1 of 4): permissions, the Newly Approved / Needs Review queue,
-- in-app task review notifications, Scheduled status sync and live-schedule safeguards.
--
--   * New company permissions (added to the existing role model, so Users & Permissions, grants,
--     revocations and the owner-only rule all apply). Defaults keep what each role can do today.
--   * project_reviews: an approved or signed bid enters "Needs PM Review" once. A reviewer with
--     "Review newly approved jobs" marks it reviewed (who + when). Nothing is scheduled automatically.
--   * user_notifications: in-app only. A task review notice is raised when an ACTIVE schedule's task
--     reaches its planned finish (project time zone) or reports 100%. One notice per task per planned
--     finish (dedupe key), so the finish date and 100% arriving together never make two. A moved
--     finish supersedes the old notice; verified completion resolves it. Customers are never notified.
--   * Publishing a schedule (draft -> active) moves the bid to Scheduled; In Progress / Completed bids
--     keep their stage. Draft schedules no longer move the bid.
--   * Database guards: confirming a task complete needs "Confirm task completion"; changing the dates
--     of a LIVE company schedule needs "Edit live schedules".
--
-- Safe to run more than once. Requires every earlier migration (through 20261118002000).
-- Rollback: docs/project-operations/rollback_20261119001000.sql

-- 1. Permission keys ---------------------------------------------------------------------------------
create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons',
    -- V4.3 project operations
    'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
    'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
    'view_subcontractor_costs', 'edit_project_costs',
    -- V4.4 proposal style
    'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy'
  ]
$$;

create or replace function public.company_role_permissions(p_role text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner' then public.company_permission_keys()
    when 'manager' then array['view_own_bids', 'view_team_bids', 'create_estimates', 'edit_team_estimates',
                              'view_costs', 'view_margin', 'approve_bids', 'view_analytics',
                              'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
                              'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
                              'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
                              'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
                              'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
                              'view_subcontractor_costs', 'edit_project_costs',
                              'view_proposal_style', 'customize_proposal_style']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs',
                                'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'manage_dependencies', 'update_progress', 'download_schedule_pdf',
                                'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion', 'create_change_orders', 'upload_photos',
                                'view_proposal_style', 'customize_proposal_style']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics', 'view_schedules', 'download_schedule_pdf', 'view_proposal_style']
    else array[]::text[]
  end
$$;

-- Changing the company-wide proposal policy can only be delegated by the owner.
create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons', 'change_proposal_policy']
$$;

-- 2. Shared helpers ----------------------------------------------------------------------------------
-- Same rule as the estimates RLS policies: own bid (in the caller's current company or personal), or a
-- company bid the caller may see. For SECURITY DEFINER functions that must not widen access.
create or replace function public.estimate_readable(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.estimates e where e.id = p_estimate_id and (
      (e.user_id = auth.uid() and (e.company_id is null or e.company_id = public.my_company_id()))
      or (e.company_id is not null and (e.company_id, e.user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v))))
$$;
revoke execute on function public.estimate_readable(uuid) from public, anon;
grant execute on function public.estimate_readable(uuid) to authenticated;

-- A solo bid's owner may do everything to it; a company bid needs the permission (and visibility).
create or replace function public.estimate_permission(p_estimate_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when e.company_id is null then e.user_id = auth.uid()
                               else public.estimate_readable(e.id) and public.has_company_permission(e.company_id, p_permission) end
                   from public.estimates e where e.id = p_estimate_id), false)
$$;
revoke execute on function public.estimate_permission(uuid, text) from public, anon;
grant execute on function public.estimate_permission(uuid, text) to authenticated;

-- 3. Newly Approved / Needs Review --------------------------------------------------------------------
create table if not exists public.project_reviews (
  estimate_id uuid primary key references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,               -- bid owner
  company_id uuid references public.companies (id) on delete cascade,
  status text not null default 'needs_review' check (status in ('needs_review', 'reviewed')),
  approval_source text not null check (approval_source in ('signature', 'manual')),
  approved_at timestamptz not null,
  signature_id uuid references public.signatures (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_reviews_reviewed check (status = 'needs_review' or (reviewed_by is not null and reviewed_at is not null))
);
create index if not exists project_reviews_company_idx on public.project_reviews (company_id, status) where company_id is not null;
create index if not exists project_reviews_user_idx on public.project_reviews (user_id, status);
drop trigger if exists project_reviews_updated on public.project_reviews;
create trigger project_reviews_updated before update on public.project_reviews for each row execute function public.set_updated_at();

alter table public.project_reviews enable row level security;
drop policy if exists project_reviews_select on public.project_reviews;
create policy project_reviews_select on public.project_reviews for select to authenticated using (public.estimate_readable(estimate_id));
revoke insert, update, delete on public.project_reviews from anon, authenticated;
grant select on public.project_reviews to authenticated;

-- Enter the queue once, when the bid is approved (moved into Won) or signed. A bid that already has a
-- live schedule is past review and is not queued again.
create or replace function public.project_review_enqueue(p_estimate_id uuid, p_source text, p_at timestamptz, p_signature uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.project_schedules s where s.estimate_id = p_estimate_id and s.status <> 'archived') then return; end if;
  insert into public.project_reviews (estimate_id, user_id, company_id, approval_source, approved_at, signature_id)
  select e.id, e.user_id, e.company_id, p_source, coalesce(p_at, now()), p_signature from public.estimates e where e.id = p_estimate_id
  on conflict (estimate_id) do update set
    -- A signature arriving after a manual Won is the stronger evidence; the review state is kept.
    approval_source = case when excluded.approval_source = 'signature' then 'signature' else project_reviews.approval_source end,
    signature_id = coalesce(excluded.signature_id, project_reviews.signature_id);
end $$;
revoke execute on function public.project_review_enqueue(uuid, text, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.project_review_on_signature() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.project_review_enqueue(new.estimate_id, 'signature', new.signed_at, new.id);
  return new;
end $$;
drop trigger if exists signatures_project_review on public.signatures;
create trigger signatures_project_review after insert on public.signatures for each row execute function public.project_review_on_signature();

create or replace function public.project_review_on_won() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pipeline_stage = 'won' and old.pipeline_stage is distinct from new.pipeline_stage
     and old.pipeline_stage not in ('won', 'scheduled', 'in_progress', 'completed') then
    perform public.project_review_enqueue(new.id, 'manual', coalesce(new.won_at, now()), null);
  end if;
  return new;
end $$;
drop trigger if exists estimates_project_review on public.estimates;
create trigger estimates_project_review after update of pipeline_stage on public.estimates for each row execute function public.project_review_on_won();

-- Backfill: accepted bids that have no schedule yet start in the queue.
insert into public.project_reviews (estimate_id, user_id, company_id, approval_source, approved_at, signature_id)
select e.id, e.user_id, e.company_id,
       case when sg.id is not null then 'signature' else 'manual' end,
       coalesce(sg.signed_at, e.won_at, e.stage_changed_at, e.updated_at), sg.id
from public.estimates e
left join lateral (select s.id, s.signed_at from public.signatures s where s.estimate_id = e.id order by s.signed_at desc limit 1) sg on true
where (e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed') or sg.id is not null)
  and e.pipeline_stage <> 'lost' and e.status <> 'archived'
  and not exists (select 1 from public.project_schedules s where s.estimate_id = e.id and s.status <> 'archived')
on conflict (estimate_id) do nothing;

-- The queue: Needs PM Review and Ready to Schedule (reviewed, no live schedule yet). RLS-bound.
create or replace function public.project_review_queue() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'estimateId', r.estimate_id, 'status', r.status, 'approvalSource', r.approval_source, 'approvedAt', r.approved_at,
    'reviewedAt', r.reviewed_at, 'reviewedBy', r.reviewed_by, 'reviewNote', r.review_note, 'companyId', r.company_id, 'ownerId', r.user_id,
    'title', e.title, 'customerName', e.customer_name, 'number', e.estimate_number, 'trades', to_jsonb(e.trades), 'stage', e.pipeline_stage,
    'scheduleId', s.id, 'scheduleStatus', s.status,
    'canReview', public.estimate_permission(e.id, 'review_approved_jobs')
  ) order by (r.status = 'reviewed'), r.approved_at desc), '[]'::jsonb)
  from public.project_reviews r
  join public.estimates e on e.id = r.estimate_id
  left join public.project_schedules s on s.estimate_id = r.estimate_id and s.status <> 'archived'
  where e.pipeline_stage <> 'lost' and e.status <> 'archived'
    and (s.id is null or s.status = 'draft')
$$;
revoke execute on function public.project_review_queue() from public, anon;
grant execute on function public.project_review_queue() to authenticated;

create or replace function public.project_mark_reviewed(p_estimate_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.project_reviews; v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if auth.uid() is null or not public.estimate_permission(p_estimate_id, 'review_approved_jobs') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from public.project_reviews where estimate_id = p_estimate_id for update;
  if not found then
    -- An accepted bid that predates the queue: enqueue it, then review.
    if not public.estimate_is_accepted(p_estimate_id) then raise exception 'not_accepted' using errcode = '22023'; end if;
    perform public.project_review_enqueue(p_estimate_id, case when exists (select 1 from public.signatures s where s.estimate_id = p_estimate_id) then 'signature' else 'manual' end, now(), null);
    select * into r from public.project_reviews where estimate_id = p_estimate_id for update;
    if not found then raise exception 'already_scheduled' using errcode = '22023'; end if;
  end if;
  if r.status = 'reviewed' then
    return jsonb_build_object('status', 'reviewed', 'reviewedAt', r.reviewed_at, 'reviewedBy', r.reviewed_by, 'unchanged', true);
  end if;
  update public.project_reviews set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where estimate_id = p_estimate_id returning * into r;
  if r.company_id is not null then
    perform public.company_audit(r.company_id, 'project.reviewed', 'estimate', p_estimate_id::text, jsonb_build_object('note', v_note));
  end if;
  return jsonb_build_object('status', 'reviewed', 'reviewedAt', r.reviewed_at, 'reviewedBy', r.reviewed_by);
end $$;
revoke execute on function public.project_mark_reviewed(uuid, text) from public, anon;
grant execute on function public.project_mark_reviewed(uuid, text) to authenticated;

-- 4. Scheduled status sync ---------------------------------------------------------------------------
-- Publishing (draft -> active) is the moment a project counts as Scheduled. Only Won bids (or signed
-- bids still in an earlier column) move; In Progress and Completed are never moved back.
create or replace function public.project_schedules_sync_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_signed boolean;
begin
  if new.status = 'active' and old.status = 'draft' then
    select * into e from public.estimates where id = new.estimate_id for update;
    if not found then return new; end if;
    v_signed := exists (select 1 from public.signatures s where s.estimate_id = e.id);
    if e.pipeline_stage = 'won' or (v_signed and e.pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending')) then
      perform set_config('app.stage_change', 'on', true);
      update public.estimates set pipeline_stage = 'scheduled', stage_changed_at = now(), won_at = coalesce(won_at, now()) where id = e.id;
      perform set_config('app.stage_change', '', true);
      insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
      values (e.id, e.company_id, e.pipeline_stage, 'scheduled', auth.uid(), 'Schedule published', now());
    end if;
    update public.project_reviews set status = 'reviewed', reviewed_by = coalesce(reviewed_by, auth.uid(), new.created_by),
           reviewed_at = coalesce(reviewed_at, now()), review_note = coalesce(review_note, 'Reviewed when the schedule was published')
     where estimate_id = new.estimate_id and status = 'needs_review' and coalesce(auth.uid(), new.created_by) is not null;
  end if;
  return new;
end $$;
drop trigger if exists project_schedules_sync_stage on public.project_schedules;
create trigger project_schedules_sync_stage after update of status on public.project_schedules for each row execute function public.project_schedules_sync_stage();

-- 5. Task completion and live-schedule guards ---------------------------------------------------------
create or replace function public.can_confirm_task_completion(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (public.schedule_permissions(s.id) ->> 'progress')::boolean
                          and (s.company_id is null or public.has_company_permission(s.company_id, 'confirm_task_completion'))
                   from public.project_schedules s where s.id = p_schedule_id), false)
$$;
revoke execute on function public.can_confirm_task_completion(uuid) from public, anon;
grant execute on function public.can_confirm_task_completion(uuid) to authenticated;

create or replace function public.can_edit_live_schedule(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (public.schedule_permissions(s.id) ->> 'edit')::boolean
                          and (s.status <> 'active' or s.company_id is null or public.has_company_permission(s.company_id, 'edit_live_schedules'))
                   from public.project_schedules s where s.id = p_schedule_id), false)
$$;
revoke execute on function public.can_edit_live_schedule(uuid) from public, anon;
grant execute on function public.can_edit_live_schedule(uuid) to authenticated;

-- Applies to signed-in callers only (server jobs run without a user and are trusted).
create or replace function public.schedule_tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.project_schedules;
begin
  if auth.uid() is null then return new; end if;
  select * into s from public.project_schedules where id = new.schedule_id;
  if new.status = 'complete' and old.status is distinct from 'complete' and not public.can_confirm_task_completion(new.schedule_id) then
    raise exception 'forbidden_confirm' using errcode = '42501';
  end if;
  if s.status = 'active' and s.company_id is not null
     and (new.planned_start is distinct from old.planned_start or new.planned_end is distinct from old.planned_end or new.duration_days is distinct from old.duration_days)
     and not public.has_company_permission(s.company_id, 'edit_live_schedules') then
    raise exception 'forbidden_live_edit' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists schedule_tasks_guard on public.schedule_tasks;
create trigger schedule_tasks_guard before update on public.schedule_tasks for each row execute function public.schedule_tasks_guard();

-- 6. In-app notifications -----------------------------------------------------------------------------
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  kind text not null check (kind in ('task_review')),
  schedule_id uuid references public.project_schedules (id) on delete cascade,
  task_id uuid references public.schedule_tasks (id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) <= 200),
  reason text check (reason in ('end_date', 'progress_100', 'both')),
  title text not null check (char_length(title) <= 300),
  data jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'snoozed', 'resolved', 'superseded')),
  read_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution text check (resolution in ('confirmed', 'completed', 'moved', 'reassigned', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists user_notifications_inbox_idx on public.user_notifications (user_id, status, created_at desc);
create index if not exists user_notifications_task_idx on public.user_notifications (task_id) where status in ('open', 'snoozed');
drop trigger if exists user_notifications_updated on public.user_notifications;
create trigger user_notifications_updated before update on public.user_notifications for each row execute function public.set_updated_at();
alter table public.user_notifications enable row level security;
drop policy if exists user_notifications_own on public.user_notifications;
create policy user_notifications_own on public.user_notifications for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;

-- Who reviews a task: the project manager, else whoever created the schedule, else the bid owner.
create or replace function public.project_reviewer(p_schedule_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(s.project_manager_id, s.created_by, s.user_id) from public.project_schedules s where s.id = p_schedule_id
$$;
revoke execute on function public.project_reviewer(uuid) from public, anon, authenticated;

-- Raise / supersede / resolve task review notices for the given schedules (null = all live schedules).
-- Idempotent: running it again with nothing changed writes nothing.
create or replace function public.pm_sync_task_reviews(p_schedule_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_new integer := 0;
begin
  -- Candidates: leaf tasks of active schedules, not complete, at/after planned finish or at 100%.
  create temp table if not exists _tr_candidates (task_id uuid primary key, schedule_id uuid, user_id uuid, company_id uuid, dedupe_key text,
    reason text, title text, data jsonb) on commit drop;
  truncate _tr_candidates;
  insert into _tr_candidates
  select t.id, s.id, public.project_reviewer(s.id), s.company_id,
         'task_review:' || t.id || ':' || t.planned_end,
         case when t.percent_complete >= 100 and t.planned_end <= x.today then 'both' when t.percent_complete >= 100 then 'progress_100' else 'end_date' end,
         left('Review: ' || t.name || ' · ' || s.name, 300),
         jsonb_build_object('projectName', s.name, 'taskName', t.name,
           'sectionName', (select p.name from public.schedule_tasks p where p.id = coalesce(t.parent_id, t.split_from)),
           'assignee', t.assignee, 'plannedEnd', t.planned_end, 'percentComplete', t.percent_complete, 'today', x.today,
           'customerName', s.source_snapshot #>> '{estimate,customerName}', 'timezone', s.calendar ->> 'timezone')
  from public.project_schedules s
  cross join lateral (select (now() at time zone coalesce(nullif(s.calendar ->> 'timezone', ''), 'America/Chicago'))::date as today) x
  join public.schedule_tasks t on t.schedule_id = s.id
  where s.status = 'active' and (p_schedule_ids is null or s.id = any (p_schedule_ids))
    and t.status <> 'complete'
    and not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id)
    and (t.planned_end <= x.today or t.percent_complete >= 100);

  -- Verified complete: resolve.
  update public.user_notifications n set status = 'resolved', resolution = 'completed', resolved_at = now()
  from public.schedule_tasks t
  where n.task_id = t.id and n.kind = 'task_review' and n.status in ('open', 'snoozed') and t.status = 'complete'
    and (p_schedule_ids is null or n.schedule_id = any (p_schedule_ids));
  -- Moved finish, new reviewer, schedule no longer live, or no longer due: supersede.
  update public.user_notifications n set status = 'superseded', resolved_at = now(),
         resolution = case when exists (select 1 from public.project_schedules s where s.id = n.schedule_id and s.status <> 'active') then 'closed'
                           when exists (select 1 from _tr_candidates c where c.task_id = n.task_id and c.user_id <> n.user_id) then 'reassigned' else 'moved' end
  where n.kind = 'task_review' and n.status in ('open', 'snoozed')
    and (p_schedule_ids is null or n.schedule_id = any (p_schedule_ids))
    and not exists (select 1 from _tr_candidates c where c.task_id = n.task_id and c.dedupe_key = n.dedupe_key and c.user_id = n.user_id);

  -- New notices (the same task + finish date never notifies twice; reaching 100% later only refreshes it).
  with ins as (
    insert into public.user_notifications (user_id, company_id, kind, schedule_id, task_id, dedupe_key, reason, title, data)
    select c.user_id, c.company_id, 'task_review', c.schedule_id, c.task_id, c.dedupe_key, c.reason, c.title, c.data
    from _tr_candidates c where c.user_id is not null
    on conflict (user_id, dedupe_key) do update set
      data = excluded.data,
      reason = case when user_notifications.reason <> excluded.reason then 'both' else user_notifications.reason end
      where user_notifications.status in ('open', 'snoozed')
        and (user_notifications.data is distinct from excluded.data or user_notifications.reason is distinct from excluded.reason)
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted) into v_new from ins;
  return v_new;
end $$;
revoke execute on function public.pm_sync_task_reviews(uuid[]) from public, anon, authenticated;
grant execute on function public.pm_sync_task_reviews(uuid[]) to service_role;

-- Task / schedule changes resync just the schedules touched (statement-level: once per save).
create or replace function public.schedule_tasks_review_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select array_agg(distinct schedule_id) into v_ids from new_rows;
  if v_ids is not null then perform public.pm_sync_task_reviews(v_ids); end if;
  return null;
end $$;
drop trigger if exists schedule_tasks_review_sync on public.schedule_tasks;
create trigger schedule_tasks_review_sync after update on public.schedule_tasks referencing new table as new_rows
  for each statement execute function public.schedule_tasks_review_sync();

create or replace function public.project_schedules_review_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select array_agg(distinct n.id) into v_ids from new_rows n join old_rows o on o.id = n.id
   where n.status is distinct from o.status or n.project_manager_id is distinct from o.project_manager_id;
  if v_ids is not null then perform public.pm_sync_task_reviews(v_ids); end if;
  return null;
end $$;
drop trigger if exists project_schedules_review_sync on public.project_schedules;
create trigger project_schedules_review_sync after update on public.project_schedules referencing new table as new_rows old table as old_rows
  for each statement execute function public.project_schedules_review_sync();

-- Planned finishes pass with the calendar, not with an edit: the inbox syncs the caller's own projects
-- when it opens (in-app notices are only seen there). The server cron can sync everything.
create or replace function public.my_notifications() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select array_agg(s.id) into v_ids from public.project_schedules s
   where s.status = 'active' and public.project_reviewer(s.id) = auth.uid();
  if v_ids is not null then perform public.pm_sync_task_reviews(v_ids); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'scheduleId', n.schedule_id, 'taskId', n.task_id, 'reason', n.reason, 'title', n.title,
      'data', n.data, 'status', n.status, 'readAt', n.read_at, 'snoozedUntil', n.snoozed_until, 'createdAt', n.created_at,
      'canConfirm', public.can_confirm_task_completion(n.schedule_id)
    ) order by n.created_at desc)
    from (select * from public.user_notifications n where n.user_id = auth.uid()
            and (n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= now())) order by n.created_at desc limit 50) n), '[]'::jsonb);
end $$;
revoke execute on function public.my_notifications() from public, anon;
grant execute on function public.my_notifications() to authenticated;

-- Notice actions. "confirm" marks the task complete (needs "Confirm task completion"), "later" snoozes
-- it to the next morning in the project's time zone, "read" marks it seen.
create or replace function public.notification_act(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n public.user_notifications; t public.schedule_tasks; s public.project_schedules; v_today date; v_rev integer;
begin
  select * into n from public.user_notifications where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = '42501'; end if;
  if p_action = 'read' then
    update public.user_notifications set read_at = coalesce(read_at, now()) where id = p_id;
    return jsonb_build_object('status', n.status);
  elsif p_action = 'later' then
    select * into s from public.project_schedules where id = n.schedule_id;
    v_today := (now() at time zone coalesce(nullif(s.calendar ->> 'timezone', ''), 'America/Chicago'))::date;
    update public.user_notifications set status = 'snoozed', read_at = coalesce(read_at, now()),
      snoozed_until = ((v_today + 1)::timestamp + interval '7 hours') at time zone coalesce(nullif(s.calendar ->> 'timezone', ''), 'America/Chicago')
     where id = p_id;
    return jsonb_build_object('status', 'snoozed');
  elsif p_action = 'confirm' then
    if n.status not in ('open', 'snoozed') then return jsonb_build_object('status', n.status, 'unchanged', true); end if;
    if not public.can_confirm_task_completion(n.schedule_id) then raise exception 'forbidden_confirm' using errcode = '42501'; end if;
    select * into s from public.project_schedules where id = n.schedule_id for update;
    select * into t from public.schedule_tasks where id = n.task_id for update;
    if not found then raise exception 'not_found' using errcode = '42501'; end if;
    v_today := (now() at time zone coalesce(nullif(s.calendar ->> 'timezone', ''), 'America/Chicago'))::date;
    if t.status <> 'complete' then
      update public.schedule_tasks set status = 'complete', percent_complete = 100,
        actual_finish = coalesce(actual_finish, greatest(v_today, coalesce(actual_start, t.planned_start))),
        actual_start = coalesce(actual_start, least(t.planned_start, v_today))
       where id = t.id;
      v_rev := s.revision + 1;
      update public.project_schedules set revision = v_rev, updated_at = now() where id = s.id;
      insert into public.schedule_revisions (schedule_id, revision, actor_id, summary)
      values (s.id, v_rev, auth.uid(), left('Confirmed complete after review: ' || t.name, 500));
    end if;
    update public.user_notifications set status = 'resolved', resolution = 'confirmed', resolved_at = now(), resolved_by = auth.uid(), read_at = coalesce(read_at, now())
     where id = p_id;
    return jsonb_build_object('status', 'resolved', 'revision', coalesce(v_rev, s.revision));
  end if;
  raise exception 'bad_action' using errcode = '22023';
end $$;
revoke execute on function public.notification_act(uuid, text) from public, anon;
grant execute on function public.notification_act(uuid, text) to authenticated;
