-- Academy monthly challenge: "Learn More. Build Better. Earn a Free Month." (James 2026-11-22)
--
-- In one calendar month (UTC), a signed-in learner who
--   * completes 4 distinct Academy courses ("training modules": every published lesson marked complete), and
--   * passes one 20-question challenge quiz with at least 16 correct (80%), graded here, never in the browser,
-- earns ONE free month of Individual Unlimited, once per account for life (also once per email identity).
--
-- Built on what already exists, nothing replaced:
--   * courses/lessons/academy_lesson_progress (Classroom) and academy_badges (achievements);
--   * academy_kb_items (the Study question bank) and academy_kb_attempts (attempt records) for the quiz;
--   * complimentary_grants (the same 30-day Unlimited grant the referral program uses) and, only when the owner
--     turns it on in the app, a Stripe customer balance credit for renewing monthly subscribers.
--
-- Additive only: new tables, new functions, one trigger on academy_lesson_progress (wrapped so a failure can never
-- block marking a lesson complete) and two nullable columns on academy_kb_attempts. No existing row is changed or
-- deleted, no existing function is replaced. Safe to run more than once.
--
-- Reward routing (academy_reward_decide):
--   suspicious activity (very fast course or quiz) ........... admin review
--   Enterprise seat / Enterprise grant ........................ admin review (never an Enterprise discount or seat)
--   past-due / unpaid subscription ............................ admin review
--   annual subscriber ......................................... admin review (no safe automatic annual extension)
--   renewing monthly subscriber ............................... Stripe credit of one month, ONLY if the app switch
--                                                                ACADEMY_REWARD_STRIPE_CREDITS=on, else admin review
--   cancelling subscriber ..................................... 30 days of Unlimited starting when the paid period ends
--   everyone else (free, complimentary Unlimited) ............. 30 days of Unlimited, after any open grant
-- Internal, test, demo and practice accounts never qualify.
--
-- Rollback: docs/academy/rewards/rollback_20270223001000.sql

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------

-- First completion of each course. Written once; un-marking and re-marking a lesson never moves it, so a course
-- finished in one month can never count toward a later month.
create table if not exists public.academy_course_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  completed_at timestamptz not null,
  first_lesson_at timestamptz not null,
  lessons integer not null check (lessons >= 1),
  estimated_minutes integer,
  fast boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);
create index if not exists academy_course_completions_time on public.academy_course_completions (user_id, completed_at);

-- Quiz topics for the challenge (the Study categories). Pools under 25 approved questions are not offered.
create table if not exists public.academy_challenge_topics (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null check (char_length(title) between 2 and 80),
  decks text[] not null check (cardinality(decks) >= 1),
  trades text[] not null default '{}',
  state_items boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);

-- Challenge quiz attempts reuse academy_kb_attempts. These columns are null for every ordinary study session.
alter table public.academy_kb_attempts add column if not exists challenge_topic text references public.academy_challenge_topics (slug) on delete set null;
alter table public.academy_kb_attempts add column if not exists challenge_passed boolean;
alter table public.academy_kb_attempts add column if not exists challenge_flags text[];
create index if not exists academy_kb_attempts_challenge on public.academy_kb_attempts (user_id, finished_at) where challenge_topic is not null;

-- One row per account, ever. The qualification facts are immutable; only the delivery fields move forward.
create table if not exists public.academy_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email_key text not null,
  month date not null,
  course_ids uuid[] not null check (cardinality(course_ids) = 4),
  attempt_id uuid not null,
  quiz_correct integer not null check (quiz_correct between 16 and 20),
  qualified_at timestamptz not null default now(),
  snapshot jsonb not null default '{}',
  flags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'applying', 'applied', 'review', 'failed', 'declined')),
  action text check (action in ('comp_days', 'stripe_credit')),
  review_reason text check (char_length(review_reason) <= 80),
  grant_id uuid,
  stripe_ref text check (char_length(stripe_ref) <= 255),
  credit_cents integer check (credit_cents is null or credit_cents between 1 and 5000),
  activates_at timestamptz,
  expires_at timestamptz,
  applied_at timestamptz,
  error text check (char_length(error) <= 500),
  tries integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists academy_rewards_user on public.academy_rewards (user_id) where user_id is not null;
create unique index if not exists academy_rewards_email on public.academy_rewards (email_key);
create index if not exists academy_rewards_status on public.academy_rewards (status, created_at desc);

-- Append-only audit trail for every reward change.
create table if not exists public.academy_reward_events (
  id bigint generated always as identity primary key,
  reward_id uuid references public.academy_rewards (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_reward_events_reward on public.academy_reward_events (reward_id, created_at);
create index if not exists academy_reward_events_time on public.academy_reward_events (created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Guards
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_completions_guard() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'academy_completion_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists academy_course_completions_guard on public.academy_course_completions;
create trigger academy_course_completions_guard before update on public.academy_course_completions
  for each row execute function public.academy_completions_guard();

create or replace function public.academy_rewards_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'academy_reward_immutable' using errcode = 'P0001'; end if;
  -- Account deletion sets user_id null (history survives); nothing else about the qualification may change.
  if new.user_id is distinct from old.user_id and new.user_id is not null then raise exception 'academy_reward_immutable' using errcode = 'P0001'; end if;
  if new.email_key <> old.email_key or new.month <> old.month or new.course_ids <> old.course_ids or new.attempt_id <> old.attempt_id
     or new.quiz_correct <> old.quiz_correct or new.qualified_at <> old.qualified_at or new.snapshot <> old.snapshot or new.flags <> old.flags then
    raise exception 'academy_reward_immutable' using errcode = 'P0001';
  end if;
  -- A delivered (or declined) reward is final, so it can never be applied twice.
  if old.status in ('applied', 'declined') and (new.status <> old.status or new.grant_id is distinct from old.grant_id
     or new.stripe_ref is distinct from old.stripe_ref or new.credit_cents is distinct from old.credit_cents) then
    raise exception 'academy_reward_final' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists academy_rewards_guard on public.academy_rewards;
create trigger academy_rewards_guard before update or delete on public.academy_rewards
  for each row execute function public.academy_rewards_guard();

create or replace function public.academy_reward_events_guard() returns trigger language plpgsql set search_path = public as $$
begin
  -- Only the "account deleted" set-null cascades may touch a logged event.
  if tg_op = 'UPDATE' and new.action = old.action and new.details is not distinct from old.details and new.created_at = old.created_at
     and (new.reward_id is null or new.reward_id = old.reward_id) and (new.user_id is null or new.user_id = old.user_id)
     and (new.actor_id is null or new.actor_id = old.actor_id) then
    return new;
  end if;
  raise exception 'academy_reward_event_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists academy_reward_events_guard on public.academy_reward_events;
create trigger academy_reward_events_guard before update or delete on public.academy_reward_events
  for each row execute function public.academy_reward_events_guard();

-- Challenge attempts can only be created or changed by the challenge functions (which set academy.challenge=on),
-- so the ordinary study save cannot be used to re-grade or probe a challenge quiz.
create or replace function public.academy_kb_attempts_challenge_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if (new.challenge_topic is not null or new.challenge_passed is not null or new.challenge_flags is not null
      or (tg_op = 'UPDATE' and (old.challenge_topic is not null or old.challenge_passed is not null)))
     and coalesce(current_setting('academy.challenge', true), '') <> 'on' then
    raise exception 'challenge_attempt_locked' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists academy_kb_attempts_challenge_guard on public.academy_kb_attempts;
create trigger academy_kb_attempts_challenge_guard before insert or update on public.academy_kb_attempts
  for each row execute function public.academy_kb_attempts_challenge_guard();

-- RLS: learners read only their own completions and reward; topics are public; events are service-only.
alter table public.academy_course_completions enable row level security;
alter table public.academy_challenge_topics enable row level security;
alter table public.academy_rewards enable row level security;
alter table public.academy_reward_events enable row level security;
revoke all on public.academy_course_completions, public.academy_challenge_topics, public.academy_rewards, public.academy_reward_events from public, anon, authenticated;
grant select on public.academy_course_completions, public.academy_rewards to authenticated;
grant select on public.academy_challenge_topics to anon, authenticated;
drop policy if exists academy_course_completions_read on public.academy_course_completions;
create policy academy_course_completions_read on public.academy_course_completions for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_rewards_read on public.academy_rewards;
create policy academy_rewards_read on public.academy_rewards for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_challenge_topics_read on public.academy_challenge_topics;
create policy academy_challenge_topics_read on public.academy_challenge_topics for select to anon, authenticated using (active);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Settings and helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_challenge_rules() returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('trainings', 4, 'questions', 20, 'pass_correct', 16, 'min_pool', 25, 'daily_attempts', 5,
    'minutes', 60, 'reward_days', 30, 'fast_quiz_seconds', 60, 'value_cents', 1999)
$$;

create or replace function public.academy_month_start(p_at timestamptz default now()) returns date language sql stable set search_path = public as $$
  select date_trunc('month', p_at at time zone 'utc')::date
$$;

create or replace function public.academy_reward_log(p_reward uuid, p_user uuid, p_actor uuid, p_action text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.academy_reward_events (reward_id, user_id, actor_id, action, details) values (p_reward, p_user, p_actor, left(p_action, 60), p_details)
$$;

-- Why an account cannot earn the reward (null = it can): reuses the referral rules plus demo/practice logins.
create or replace function public.academy_reward_excluded(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_user is null then return 'no_account'; end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then return 'email_not_verified'; end if;
  if to_regprocedure('public.is_demo_account(uuid)') is not null then
    execute 'select public.is_demo_account($1)' into v using p_user;
    if v::boolean then return 'excluded_demo'; end if;
  end if;
  if to_regprocedure('public.referral_excluded(uuid)') is not null then
    execute 'select public.referral_excluded($1)' into v using p_user;
    return v;
  end if;
  return null;
end $$;

-- Email identity (Gmail dots and +tags ignored) so one person can't collect twice by re-creating an account.
create or replace function public.academy_reward_email_key(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare e text;
begin
  select lower(btrim(email)) into e from auth.users where id = p_user;
  if e is null then return 'user:' || p_user::text; end if;
  if to_regprocedure('public.referral_email_key(text)') is not null then
    execute 'select public.referral_email_key($1)' into e using e;
  end if;
  return coalesce(e, 'user:' || p_user::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Course completion (first time only)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_record_course_completion(p_user uuid, p_course uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_total integer; v_minutes integer; v_done integer; v_first timestamptz; v_last timestamptz; v_rows integer;
begin
  if p_user is null or p_course is null then return false; end if;
  if exists (select 1 from public.academy_course_completions where user_id = p_user and course_id = p_course) then return false; end if;
  select count(*), sum(l.estimated_minutes) into v_total, v_minutes
    from public.academy_lessons l join public.academy_courses c on c.id = l.course_id
   where l.course_id = p_course and l.status = 'published' and c.status = 'published';
  if coalesce(v_total, 0) = 0 then return false; end if;
  select count(*), min(pr.completed_at), max(pr.completed_at) into v_done, v_first, v_last
    from public.academy_lesson_progress pr join public.academy_lessons l on l.id = pr.lesson_id and l.status = 'published'
   where pr.user_id = p_user and pr.course_id = p_course;
  if v_done < v_total then return false; end if;
  insert into public.academy_course_completions (user_id, course_id, completed_at, first_lesson_at, lessons, estimated_minutes, fast)
  values (p_user, p_course, v_last, v_first, v_total, v_minutes,
          -- Three or more lessons all marked within 20 seconds of each other: clicked through, not read.
          v_total >= 3 and v_last - v_first < make_interval(secs => 20 * (v_total - 1)))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

create or replace function public.academy_lesson_progress_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if public.academy_record_course_completion(new.user_id, new.course_id) then
      perform public.academy_challenge_claim_for(new.user_id);
    end if;
  exception when others then
    -- Never block marking a lesson complete because of the challenge.
    raise warning 'academy challenge: %', sqlerrm;
  end;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Monthly progress (pure read of the records above)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_challenge_progress(p_user uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m date := coalesce(date_trunc('month', p_month)::date, public.academy_month_start());
  m_from timestamptz := (m::timestamp at time zone 'utc');
  m_to timestamptz := ((m + interval '1 month')::timestamp at time zone 'utc');
  v_courses jsonb; v_ids uuid[]; v_pass record; v_last record; v_open record;
begin
  select coalesce(jsonb_agg(jsonb_build_object('course_id', x.course_id, 'title', c.title, 'slug', c.slug, 'completed_at', x.completed_at, 'fast', x.fast) order by x.completed_at), '[]'),
         (array_agg(x.course_id order by x.completed_at))[1:4]
    into v_courses, v_ids
    from public.academy_course_completions x join public.academy_courses c on c.id = x.course_id
   where x.user_id = p_user and x.completed_at >= m_from and x.completed_at < m_to;

  select a.id, a.correct, a.finished_at, a.challenge_topic, a.challenge_flags into v_pass
    from public.academy_kb_attempts a
   where a.user_id = p_user and a.challenge_topic is not null and a.challenge_passed and a.finished_at >= m_from and a.finished_at < m_to
   order by a.correct desc, a.finished_at limit 1;
  select a.id, a.correct, a.finished_at, a.challenge_passed into v_last
    from public.academy_kb_attempts a
   where a.user_id = p_user and a.challenge_topic is not null and a.finished_at >= m_from and a.finished_at < m_to
   order by a.finished_at desc limit 1;
  select a.id, a.started_at into v_open
    from public.academy_kb_attempts a
   where a.user_id = p_user and a.challenge_topic is not null and a.finished_at is null and a.started_at >= m_from and a.started_at < m_to
     and a.started_at > now() - interval '60 minutes'
   order by a.started_at desc limit 1;

  return jsonb_build_object(
    'month', m,
    'trainings', v_courses,
    'trainings_done', least(jsonb_array_length(v_courses), 4),
    'course_ids', to_jsonb(coalesce(v_ids, '{}')),
    'quiz_status', case when v_pass.id is not null then 'passed' when v_open.id is not null then 'in_progress'
                        when v_last.id is not null then 'failed' else 'not_started' end,
    'quiz_pass', case when v_pass.id is null then null else jsonb_build_object('attempt_id', v_pass.id, 'correct', v_pass.correct, 'finished_at', v_pass.finished_at,
                        'topic', v_pass.challenge_topic, 'flags', to_jsonb(coalesce(v_pass.challenge_flags, '{}'))) end,
    'quiz_latest', case when v_last.id is null then null else jsonb_build_object('correct', v_last.correct, 'finished_at', v_last.finished_at, 'passed', v_last.challenge_passed) end,
    'open_attempt', case when v_open.id is null then null else v_open.id end,
    'qualified', jsonb_array_length(v_courses) >= 4 and v_pass.id is not null
  );
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Routing: how a reward would be delivered right now
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_reward_decide(p_user uuid, p_flags text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; v_ent record; v_start timestamptz; v_grant_plan text;
begin
  if coalesce(cardinality(p_flags), 0) > 0 then return jsonb_build_object('action', 'review', 'reason', 'suspicious_activity'); end if;

  if to_regprocedure('public.user_entitlement(uuid)') is not null then
    select * into v_ent from public.user_entitlement(p_user);
    if v_ent.tier = 'enterprise' then return jsonb_build_object('action', 'review', 'reason', 'enterprise_member'); end if;
  end if;
  if exists (select 1 from public.subscriptions x where x.user_id = p_user and x.plan = 'enterprise' and x.status in ('active', 'trialing', 'past_due', 'unpaid')) then
    return jsonb_build_object('action', 'review', 'reason', 'enterprise_member');
  end if;
  select g.plan into v_grant_plan from public.complimentary_grants g
   where g.user_id = p_user and g.plan = 'enterprise' and public.comp_grant_state(g) in ('active', 'scheduled', 'paused') limit 1;
  if v_grant_plan is not null then return jsonb_build_object('action', 'review', 'reason', 'enterprise_member'); end if;

  if exists (select 1 from public.subscriptions x where x.user_id = p_user and x.status in ('past_due', 'unpaid', 'incomplete', 'paused')) then
    return jsonb_build_object('action', 'review', 'reason', 'billing_issue');
  end if;

  select x.plan, x.stripe_customer_id, x.stripe_subscription_id, x.cancel_at_period_end, x.current_period_end into s
    from public.subscriptions x
   where x.user_id = p_user and x.status in ('active', 'trialing') and (x.current_period_end is null or x.current_period_end > now())
   order by x.cancel_at_period_end, x.current_period_end desc nulls last limit 1;
  if found and not s.cancel_at_period_end then
    if s.plan = 'annual' then return jsonb_build_object('action', 'review', 'reason', 'annual_subscriber'); end if;
    if s.plan = 'monthly' then
      return jsonb_build_object('action', 'stripe_credit', 'customer', s.stripe_customer_id, 'subscription', s.stripe_subscription_id);
    end if;
    return jsonb_build_object('action', 'review', 'reason', 'unknown_plan');
  end if;

  -- Free, cancelling or complimentary: 30 days that start after any paid period and any open Unlimited grant.
  select greatest(now(),
           coalesce((select max(x.current_period_end) from public.subscriptions x where x.user_id = p_user and x.status in ('active', 'trialing')), now()),
           coalesce((select max(g.expires_at) from public.complimentary_grants g where g.user_id = p_user and public.comp_grant_state(g) in ('active', 'scheduled')), now()))
    into v_start;
  return jsonb_build_object('action', 'comp_days', 'starts_at', v_start);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Claim: record eligibility exactly once (called by the quiz, by course completion and by the dashboard)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_challenge_claim_for(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards; v_reason text; v_key text; p jsonb; v_flags text[] := '{}'; d jsonb; v_month date;
begin
  if p_user is null then return jsonb_build_object('state', 'none'); end if;
  perform pg_advisory_xact_lock(hashtext('academy-reward:' || p_user::text));
  select * into r from public.academy_rewards where user_id = p_user;
  if found then return jsonb_build_object('state', 'claimed', 'id', r.id, 'status', r.status); end if;

  v_month := public.academy_month_start();
  p := public.academy_challenge_progress(p_user, v_month);
  if not (p ->> 'qualified')::boolean then return jsonb_build_object('state', 'in_progress'); end if;

  v_reason := public.academy_reward_excluded(p_user);
  if v_reason is not null then return jsonb_build_object('state', 'ineligible', 'reason', v_reason); end if;
  v_key := public.academy_reward_email_key(p_user);
  perform pg_advisory_xact_lock(hashtext('academy-reward-email:' || v_key));
  if exists (select 1 from public.academy_rewards where email_key = v_key) then
    return jsonb_build_object('state', 'ineligible', 'reason', 'email_already_rewarded');
  end if;

  if exists (select 1 from public.academy_course_completions x where x.user_id = p_user and x.fast and x.course_id in (select (jsonb_array_elements_text(p -> 'course_ids'))::uuid)) then
    v_flags := v_flags || 'fast_course'::text;
  end if;
  if coalesce(cardinality(array(select jsonb_array_elements_text(p #> '{quiz_pass,flags}'))), 0) > 0 then
    v_flags := v_flags || 'fast_quiz'::text;
  end if;
  d := public.academy_reward_decide(p_user, v_flags);

  insert into public.academy_rewards (user_id, email_key, month, course_ids, attempt_id, quiz_correct, snapshot, flags, status, action, review_reason, activates_at, expires_at)
  values (p_user, v_key, v_month, array(select (jsonb_array_elements_text(p -> 'course_ids'))::uuid),
          (p #>> '{quiz_pass,attempt_id}')::uuid, (p #>> '{quiz_pass,correct}')::int,
          jsonb_build_object('progress', p, 'route', d,
            'entitlement', (select to_jsonb(e) from public.user_entitlement(p_user) e)),
          v_flags,
          case when d ->> 'action' = 'review' then 'review' else 'pending' end,
          case when d ->> 'action' in ('comp_days', 'stripe_credit') then d ->> 'action' end,
          d ->> 'reason',
          case when d ->> 'action' = 'comp_days' then (d ->> 'starts_at')::timestamptz end,
          case when d ->> 'action' = 'comp_days' then (d ->> 'starts_at')::timestamptz + make_interval(days => 30) end)
  returning * into r;

  insert into public.academy_badges (user_id, badge, label) values (p_user, 'challenge:free-month', 'Earned the Academy free month')
  on conflict do nothing;
  perform public.academy_reward_log(r.id, p_user, null, 'qualified', jsonb_build_object('month', v_month, 'route', d, 'flags', v_flags));
  return jsonb_build_object('state', 'qualified', 'id', r.id, 'status', r.status, 'action', r.action);
end $$;

-- Signed-in learner's own claim.
create or replace function public.academy_challenge_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  return public.academy_challenge_claim_for(auth.uid());
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. The 20-question challenge quiz (extends academy_kb_attempts; questions from academy_kb_items)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_challenge_pool(p_topic text) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.academy_kb_items i join public.academy_challenge_topics t on t.slug = p_topic and t.active
   where i.kind = 'question' and i.status = 'approved' and i.deck = any (t.decks)
     and (t.state_items or i.state_code is null)
     and (cardinality(t.trades) = 0 or cardinality(i.trades) = 0 or i.trades && t.trades)
$$;

create or replace function public.academy_challenge_questions(p_attempt uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'prompt', i.prompt, 'options', to_jsonb(i.options)) order by o.n), '[]')
    from public.academy_kb_attempts a, unnest(a.item_ids) with ordinality o(item_id, n)
    join public.academy_kb_items i on i.id = o.item_id
   where a.id = p_attempt
$$;

-- Start (or resume) a challenge quiz. Questions are drawn here at random, preferring ones not in the learner's last
-- attempt; the browser never chooses them and never receives the answers before submitting.
create or replace function public.academy_challenge_quiz_start(p_topic text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.academy_kb_attempts; v_last uuid[]; v_ids uuid[]; v_rules jsonb := public.academy_challenge_rules();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('academy-quiz:' || v_uid::text));
  select * into a from public.academy_kb_attempts where user_id = v_uid and challenge_topic is not null and finished_at is null
     and started_at > now() - interval '60 minutes' order by started_at desc limit 1;
  if found then
    return jsonb_build_object('attempt_id', a.id, 'topic', a.challenge_topic, 'started_at', a.started_at,
      'expires_at', a.started_at + interval '60 minutes', 'questions', public.academy_challenge_questions(a.id), 'resumed', true);
  end if;
  if not exists (select 1 from public.academy_challenge_topics where slug = p_topic and active) then raise exception 'bad_topic' using errcode = 'P0001'; end if;
  if public.academy_challenge_pool(p_topic) < (v_rules ->> 'min_pool')::int then raise exception 'topic_too_small' using errcode = 'P0001'; end if;
  if (select count(*) from public.academy_kb_attempts where user_id = v_uid and challenge_topic is not null and started_at > now() - interval '24 hours')
     >= (v_rules ->> 'daily_attempts')::int then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  select item_ids into v_last from public.academy_kb_attempts where user_id = v_uid and challenge_topic is not null order by started_at desc limit 1;
  select array_agg(x.id) into v_ids from (
    select i.id from public.academy_kb_items i join public.academy_challenge_topics t on t.slug = p_topic
     where i.kind = 'question' and i.status = 'approved' and i.deck = any (t.decks) and (t.state_items or i.state_code is null)
       and (cardinality(t.trades) = 0 or cardinality(i.trades) = 0 or i.trades && t.trades)
     order by (i.id = any (coalesce(v_last, '{}'))), random() limit (v_rules ->> 'questions')::int) x;

  perform set_config('academy.challenge', 'on', true);
  insert into public.academy_kb_attempts (user_id, mode, filters, item_ids, timed, time_limit_seconds, challenge_topic)
  values (v_uid, 'quiz', jsonb_build_object('challenge', true, 'topic', p_topic), v_ids, true, 3600, p_topic)
  returning * into a;
  perform set_config('academy.challenge', 'off', true);
  return jsonb_build_object('attempt_id', a.id, 'topic', p_topic, 'started_at', a.started_at, 'expires_at', a.started_at + interval '60 minutes',
    'questions', public.academy_challenge_questions(a.id), 'resumed', false);
end $$;

-- Submit once. Graded here; 16 of 20 or better passes. Then the reward claim runs in the same transaction.
create or replace function public.academy_challenge_quiz_submit(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.academy_kb_attempts; v_correct integer := 0; it record; v_total integer; v_passed boolean;
  v_flags text[] := '{}'; v_expired boolean; v_review jsonb := '[]'; v_claim jsonb; v_rules jsonb := public.academy_challenge_rules(); v_pick text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into a from public.academy_kb_attempts where id = p_attempt and user_id = v_uid and challenge_topic is not null for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if a.finished_at is not null then raise exception 'already_submitted' using errcode = 'P0001'; end if;
  v_total := cardinality(a.item_ids);
  -- 5 minutes of grace past the 60-minute limit for slow connections.
  v_expired := now() > a.started_at + interval '65 minutes';
  for it in select i.id, i.correct, i.explanation, i.citation, i.options from public.academy_kb_items i where i.id = any (a.item_ids) loop
    v_pick := case when jsonb_typeof(coalesce(p_answers, '{}') -> it.id::text) = 'number' then p_answers ->> it.id::text end;
    if not v_expired and v_pick ~ '^\d+$' and v_pick::int = it.correct then v_correct := v_correct + 1; end if;
    v_review := v_review || jsonb_build_array(jsonb_build_object('id', it.id, 'picked', case when v_pick ~ '^\d+$' then v_pick::int end,
      'correct', it.correct, 'explanation', it.explanation, 'citation', it.citation));
  end loop;
  v_passed := not v_expired and v_total = (v_rules ->> 'questions')::int and v_correct >= (v_rules ->> 'pass_correct')::int;
  if now() - a.started_at < make_interval(secs => (v_rules ->> 'fast_quiz_seconds')::int) then v_flags := v_flags || 'fast_quiz'::text; end if;
  if v_expired then v_flags := v_flags || 'expired'::text; end if;

  perform set_config('academy.challenge', 'on', true);
  update public.academy_kb_attempts set answers = case when v_expired then '{}'::jsonb else coalesce(p_answers, '{}') end, position = v_total, correct = v_correct,
    finished_at = now(), challenge_passed = v_passed, challenge_flags = case when cardinality(v_flags) > 0 then v_flags end
   where id = a.id;
  perform set_config('academy.challenge', 'off', true);

  if v_passed then
    insert into public.academy_badges (user_id, badge, label) values (v_uid, 'challenge:quiz-passed', 'Passed an Academy challenge quiz') on conflict do nothing;
    if v_correct = v_total then
      insert into public.academy_badges (user_id, badge, label) values (v_uid, 'challenge:perfect', 'Perfect score on a challenge quiz') on conflict do nothing;
    end if;
    v_claim := public.academy_challenge_claim_for(v_uid);
  end if;
  return jsonb_build_object('correct', v_correct, 'total', v_total, 'passed', v_passed, 'expired', v_expired,
    'pass_correct', (v_rules ->> 'pass_correct')::int, 'review', v_review, 'claim', v_claim);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Learner status (Academy card, challenge page, profile)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.academy_challenge_status_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.academy_rewards; v_total_courses integer; v_done_courses integer;
begin
  select * into r from public.academy_rewards where user_id = p_user;
  select count(*) into v_total_courses from public.academy_courses c
   where c.status = 'published' and exists (select 1 from public.academy_lessons l where l.course_id = c.id and l.status = 'published');
  select count(*) into v_done_courses from public.academy_course_completions where user_id = p_user;
  return jsonb_build_object(
    'rules', public.academy_challenge_rules(),
    'month', public.academy_challenge_progress(p_user, public.academy_month_start()),
    'total_trainings', v_done_courses,
    'available_trainings', v_total_courses,
    'quizzes_passed', (select count(*) from public.academy_kb_attempts where user_id = p_user and challenge_topic is not null and challenge_passed),
    'excluded', public.academy_reward_excluded(p_user),
    'reward', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'action', r.action, 'month', r.month,
       'qualified_at', r.qualified_at, 'activates_at', r.activates_at, 'expires_at', r.expires_at, 'applied_at', r.applied_at,
       'credit_cents', r.credit_cents) end,
    'email_used', r.id is null and exists (select 1 from public.academy_rewards x where x.email_key = public.academy_reward_email_key(p_user)),
    'milestones', (select coalesce(jsonb_agg(jsonb_build_object('badge', b.badge, 'label', b.label, 'awarded_at', b.awarded_at) order by b.awarded_at), '[]')
                     from public.academy_badges b where b.user_id = p_user and (b.badge like 'challenge:%' or b.badge like 'course:%' or b.badge like 'trainings:%')),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'trainings', n) order by m desc), '[]') from (
                  select date_trunc('month', completed_at at time zone 'utc')::date m, count(*)::int n from public.academy_course_completions
                   where user_id = p_user group by 1 order by 1 desc limit 12) h),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'pool', public.academy_challenge_pool(t.slug)) order by t.sort_order), '[]')
                 from public.academy_challenge_topics t where t.active)
  );
end $$;

create or replace function public.academy_challenge_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  return public.academy_challenge_status_for(auth.uid());
end $$;

-- Training-count milestones (5, 10, 25 courses) as badges, alongside the existing per-course badges.
create or replace function public.academy_completion_milestones() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.academy_course_completions where user_id = new.user_id;
  if n in (1, 5, 10, 25) then
    insert into public.academy_badges (user_id, badge, label)
    values (new.user_id, 'trainings:' || n, case when n = 1 then 'First Academy training completed' else n || ' Academy trainings completed' end)
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists academy_course_completions_milestones on public.academy_course_completions;
create trigger academy_course_completions_milestones after insert on public.academy_course_completions
  for each row execute function public.academy_completion_milestones();

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Delivery (service role only; the app server calls these, admins retry from Admin → Academy rewards)
-- ---------------------------------------------------------------------------------------------------------------
-- Move a reward to "applying" exactly once and say how to deliver it. p_force: an admin's explicit choice
-- ('comp_days' | 'stripe_credit') after review. Returns {"action": "none"|"review"|"comp_days"|"stripe_credit", ...}.
create or replace function public.academy_reward_begin(p_id uuid, p_actor uuid default null, p_force text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards; d jsonb;
begin
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.user_id is null then return jsonb_build_object('action', 'none', 'reason', 'not_found'); end if;
  if r.status in ('applied', 'declined') then return jsonb_build_object('action', 'none', 'reason', r.status); end if;
  if r.status = 'applying' and r.updated_at > now() - interval '10 minutes' then return jsonb_build_object('action', 'none', 'reason', 'in_progress'); end if;
  if r.status = 'review' and p_actor is null then return jsonb_build_object('action', 'none', 'reason', 'review'); end if;
  if p_actor is not null and not public.is_admin(p_actor) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_force is not null and p_force not in ('comp_days', 'stripe_credit') then raise exception 'bad_action' using errcode = 'P0001'; end if;

  -- Re-check at delivery time: plans change between qualifying and delivery.
  d := public.academy_reward_decide(r.user_id, case when p_actor is null then r.flags else '{}'::text[] end);
  if p_force = 'comp_days' then
    d := jsonb_build_object('action', 'comp_days', 'starts_at', coalesce(d ->> 'starts_at', now()::text));
    if exists (select 1 from public.subscriptions x where x.user_id = r.user_id and x.status in ('active', 'trialing', 'past_due') and not x.cancel_at_period_end
               and (x.current_period_end is null or x.current_period_end > now())) then
      -- A renewing subscriber's free days start after the paid period, like the referral reward.
      d := jsonb_build_object('action', 'comp_days', 'starts_at', greatest(now(), (select max(x.current_period_end) from public.subscriptions x where x.user_id = r.user_id and x.status in ('active', 'trialing', 'past_due'))));
    end if;
  elsif p_force = 'stripe_credit' then
    if d ->> 'action' <> 'stripe_credit' then
      select jsonb_build_object('action', 'stripe_credit', 'customer', x.stripe_customer_id, 'subscription', x.stripe_subscription_id) into d
        from public.subscriptions x where x.user_id = r.user_id and x.status in ('active', 'trialing', 'past_due') and coalesce(x.plan, '') in ('monthly', 'annual')
       order by x.current_period_end desc nulls last limit 1;
      if d is null then return jsonb_build_object('action', 'none', 'reason', 'no_subscription'); end if;
    end if;
  end if;

  if d ->> 'action' = 'review' then
    update public.academy_rewards set status = 'review', review_reason = left(d ->> 'reason', 80) where id = r.id;
    perform public.academy_reward_log(r.id, r.user_id, p_actor, 'review', d);
    return d;
  end if;
  update public.academy_rewards set status = 'applying', action = d ->> 'action', tries = tries + 1, error = null where id = r.id;
  perform public.academy_reward_log(r.id, r.user_id, p_actor, 'applying', d);
  return d || jsonb_build_object('id', r.id);
end $$;

-- 30 days of complimentary Individual Unlimited as its own grant row (no PM Hub, no seats, nothing billed).
create or replace function public.academy_reward_grant_comp(p_id uuid, p_starts timestamptz default null, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards; v_email text; v_start timestamptz; g public.complimentary_grants;
begin
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.status <> 'applying' or r.action <> 'comp_days' then return jsonb_build_object('ok', false, 'error', 'not_applying'); end if;
  select lower(btrim(email)) into v_email from auth.users where id = r.user_id;
  if v_email is null or position('@' in v_email) < 2 then
    update public.academy_rewards set status = 'failed', error = 'Account has no email address for a complimentary grant' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'no_email');
  end if;
  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  v_start := greatest(now(), coalesce(p_starts, now()));
  insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, extra_seats, status,
                                           starts_at, expires_at, activated_at, had_paid_subscription, note, granted_by)
  values (v_email, r.user_id, 'unlimited', 30, 1, 0, 'active', v_start, v_start + interval '30 days', now(),
          public.has_paid_subscription(r.user_id), 'Academy challenge reward (1 free month, lifetime)', p_actor)
  returning * into g;
  update public.academy_rewards set status = 'applied', grant_id = g.id, activates_at = g.starts_at, expires_at = g.expires_at,
    applied_at = now(), error = null where id = r.id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_actor, 'academy.reward', 'complimentary_grant', g.id::text, jsonb_build_object('reward_id', r.id, 'days', 30, 'expires_at', g.expires_at));
  perform public.academy_reward_log(r.id, r.user_id, p_actor, 'applied', jsonb_build_object('kind', 'comp_days', 'grant_id', g.id, 'starts_at', g.starts_at, 'expires_at', g.expires_at));
  return jsonb_build_object('ok', true, 'grant_id', g.id, 'starts_at', g.starts_at, 'expires_at', g.expires_at);
end $$;

-- Outcome of a Stripe credit attempt made by the app server.
create or replace function public.academy_reward_finish(p_id uuid, p_ok boolean, p_ref text default null, p_cents integer default null, p_error text default null, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards;
begin
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.status <> 'applying' then return; end if;
  if p_ok then
    update public.academy_rewards set status = 'applied', stripe_ref = left(p_ref, 255), credit_cents = p_cents, applied_at = now(), activates_at = now(), error = null where id = p_id;
    perform public.academy_reward_log(p_id, r.user_id, p_actor, 'applied', jsonb_build_object('kind', 'stripe_credit', 'ref', p_ref, 'cents', p_cents));
  else
    update public.academy_rewards set status = 'failed', error = left(p_error, 500) where id = p_id;
    perform public.academy_reward_log(p_id, r.user_id, p_actor, 'failed', jsonb_build_object('error', left(p_error, 500)));
  end if;
end $$;

-- Send to admin review (e.g. the Stripe credit switch is off).
create or replace function public.academy_reward_set_review(p_id uuid, p_reason text, p_actor uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards;
begin
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.status in ('applied', 'declined') then return; end if;
  update public.academy_rewards set status = 'review', review_reason = left(p_reason, 80) where id = p_id;
  perform public.academy_reward_log(p_id, r.user_id, p_actor, 'review', jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.academy_reward_decline(p_caller uuid, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards;
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.status in ('applied', 'declined', 'applying') then raise exception 'not_declinable' using errcode = 'P0001'; end if;
  update public.academy_rewards set status = 'declined', error = left(nullif(btrim(p_note), ''), 500) where id = p_id;
  perform public.academy_reward_log(p_id, r.user_id, p_caller, 'declined', jsonb_build_object('note', left(p_note, 500)));
end $$;

-- Admin note, and the "applied by hand" record (e.g. annual extension done in Stripe by the owner).
create or replace function public.academy_reward_mark_manual(p_caller uuid, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.academy_rewards;
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'note_required' using errcode = 'P0001'; end if;
  select * into r from public.academy_rewards where id = p_id for update;
  if not found or r.status not in ('review', 'failed') then raise exception 'not_manual' using errcode = 'P0001'; end if;
  update public.academy_rewards set status = 'applied', stripe_ref = left('manual: ' || btrim(p_note), 255), applied_at = now(), error = null where id = p_id;
  perform public.academy_reward_log(p_id, r.user_id, p_caller, 'applied_manually', jsonb_build_object('note', left(p_note, 500)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Admin report (demo and practice logins left out)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_academy_rewards(p_caller uuid, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m date := public.academy_month_start();
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'month', m,
    'totals', jsonb_build_object(
      'qualified', (select count(*) from public.academy_rewards),
      'applied', (select count(*) from public.academy_rewards where status = 'applied'),
      'review', (select count(*) from public.academy_rewards where status = 'review'),
      'failed', (select count(*) from public.academy_rewards where status in ('failed', 'pending', 'applying')),
      'learners_month', (select count(distinct user_id) from public.academy_course_completions x where x.completed_at >= (m::timestamp at time zone 'utc') and not public.is_demo_account(x.user_id)),
      'trainings_month', (select count(*) from public.academy_course_completions x where x.completed_at >= (m::timestamp at time zone 'utc') and not public.is_demo_account(x.user_id)),
      'quizzes_month', (select count(*) from public.academy_kb_attempts a where a.challenge_topic is not null and a.finished_at >= (m::timestamp at time zone 'utc') and not public.is_demo_account(a.user_id)),
      'passed_month', (select count(*) from public.academy_kb_attempts a where a.challenge_passed and a.finished_at >= (m::timestamp at time zone 'utc') and not public.is_demo_account(a.user_id))),
    'rewards', (select coalesce(jsonb_agg(x order by x.qualified_at desc), '[]') from (
        select r.id, r.status, r.action, r.review_reason, r.flags, r.month, r.qualified_at, r.applied_at, r.activates_at, r.expires_at,
               r.credit_cents, r.stripe_ref, r.grant_id, r.error, r.tries, r.quiz_correct, u.email,
               r.snapshot #>> '{entitlement,tier}' as tier
          from public.academy_rewards r left join auth.users u on u.id = r.user_id
         where r.user_id is null or not public.is_demo_account(r.user_id)
         order by r.qualified_at desc limit greatest(1, least(p_limit, 500))) x),
    'close', (select coalesce(jsonb_agg(x order by x.trainings desc), '[]') from (
        select u.email, count(*)::int as trainings,
               exists (select 1 from public.academy_kb_attempts a where a.user_id = c.user_id and a.challenge_passed and a.finished_at >= (m::timestamp at time zone 'utc')) as quiz_passed
          from public.academy_course_completions c join auth.users u on u.id = c.user_id
         where c.completed_at >= (m::timestamp at time zone 'utc') and not public.is_demo_account(c.user_id)
           and not exists (select 1 from public.academy_rewards r where r.user_id = c.user_id)
         group by c.user_id, u.email order by 2 desc limit 50) x),
    'suspicious', (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
        select 'course' as kind, u.email, co.title as what, c.completed_at as at, c.lessons, extract(epoch from c.completed_at - c.first_lesson_at)::int as seconds
          from public.academy_course_completions c join auth.users u on u.id = c.user_id join public.academy_courses co on co.id = c.course_id
         where c.fast and not public.is_demo_account(c.user_id)
        union all
        select 'quiz', u.email, t.title || ' (' || a.correct || '/20)', a.finished_at, null, extract(epoch from a.finished_at - a.started_at)::int
          from public.academy_kb_attempts a join auth.users u on u.id = a.user_id left join public.academy_challenge_topics t on t.slug = a.challenge_topic
         where a.challenge_flags is not null and not public.is_demo_account(a.user_id)
         order by 4 desc limit 100) x),
    'events', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select e.id, e.reward_id, e.action, e.details, e.created_at, u.email, a.email as actor
          from public.academy_reward_events e left join auth.users u on u.id = e.user_id left join auth.users a on a.id = e.actor_id
         order by e.created_at desc limit 200) x)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. Triggers, topics, backfill, grants
-- ---------------------------------------------------------------------------------------------------------------
drop trigger if exists academy_lesson_progress_challenge on public.academy_lesson_progress;
create trigger academy_lesson_progress_challenge after insert or update on public.academy_lesson_progress
  for each row execute function public.academy_lesson_progress_challenge();

insert into public.academy_challenge_topics (slug, title, decks, trades, state_items, sort_order) values
  ('general-contracting', 'General Contracting', array['osha-general', 'osha-fall-protection', 'mn-permits', 'mn-residential-code', 'codebook-navigation', 'business-setup'], '{}', false, 10),
  ('safety', 'Jobsite Safety (OSHA and EPA)', array['osha-fall-protection', 'osha-excavation', 'osha-ladders-stairs', 'osha-general', 'osha-health-hazards', 'osha-recordkeeping', 'epa-lead-rrp'], '{}', false, 20),
  ('business-setup', 'Business Setup', array['business-setup', 'insurance-terms', 'dot-basics'], '{}', false, 30),
  ('decks', 'Decks', array['mn-residential-code', 'mn-permits', 'construction-terms', 'osha-fall-protection'], array['decks'], false, 40),
  ('concrete', 'Concrete', array['osha-excavation', 'osha-health-hazards', 'mn-residential-code', 'construction-terms'], array['concrete', 'foundations'], false, 50),
  ('roofing', 'Roofing', array['osha-fall-protection', 'mn-residential-code', 'construction-terms', 'osha-health-hazards'], array['roofing'], false, 60),
  ('plumbing', 'Plumbing', array['osha-excavation', 'mn-residential-code', 'construction-terms'], array['plumbing'], false, 70),
  ('electrical', 'Electrical', array['osha-general', 'mn-residential-code', 'construction-terms'], array['electrical'], false, 80),
  ('hvac', 'HVAC', array['mn-residential-code', 'construction-terms'], array['hvac'], false, 90),
  ('licensing', 'Licensing', array['licensing-basics', 'epa-lead-rrp'], '{}', false, 100),
  ('codebook-navigation', 'Codebook Navigation', array['codebook-navigation'], '{}', false, 110),
  ('minnesota', 'Minnesota Permits and Residential Code', array['mn-permits', 'mn-residential-code'], '{}', true, 120)
on conflict (slug) do nothing;

-- Courses already finished before this release keep their original completion date, so they never count toward a
-- future month. (No reward is created by the backfill: rewards are claimed only by a learner's own new activity.)
insert into public.academy_course_completions (user_id, course_id, completed_at, first_lesson_at, lessons, estimated_minutes, fast)
select pr.user_id, pr.course_id, max(pr.completed_at), min(pr.completed_at), t.n, t.mins, false
  from public.academy_lesson_progress pr
  join public.academy_lessons l on l.id = pr.lesson_id and l.status = 'published'
  join (select l2.course_id, count(*)::int n, sum(l2.estimated_minutes)::int mins from public.academy_lessons l2
          join public.academy_courses c on c.id = l2.course_id and c.status = 'published' where l2.status = 'published' group by l2.course_id) t on t.course_id = pr.course_id
 group by pr.user_id, pr.course_id, t.n, t.mins
having count(*) >= t.n
on conflict do nothing;

revoke execute on function
  public.academy_completions_guard(), public.academy_rewards_guard(), public.academy_reward_events_guard(), public.academy_kb_attempts_challenge_guard(),
  public.academy_reward_log(uuid, uuid, uuid, text, jsonb), public.academy_reward_excluded(uuid), public.academy_reward_email_key(uuid),
  public.academy_record_course_completion(uuid, uuid), public.academy_lesson_progress_challenge(), public.academy_challenge_progress(uuid, date),
  public.academy_reward_decide(uuid, text[]), public.academy_challenge_claim_for(uuid), public.academy_challenge_claim(),
  public.academy_challenge_pool(text), public.academy_challenge_questions(uuid), public.academy_challenge_quiz_start(text),
  public.academy_challenge_quiz_submit(uuid, jsonb), public.academy_challenge_status_for(uuid), public.academy_challenge_status(),
  public.academy_completion_milestones(), public.academy_reward_begin(uuid, uuid, text), public.academy_reward_grant_comp(uuid, timestamptz, uuid),
  public.academy_reward_finish(uuid, boolean, text, integer, text, uuid), public.academy_reward_set_review(uuid, text, uuid),
  public.academy_reward_decline(uuid, uuid, text), public.academy_reward_mark_manual(uuid, uuid, text), public.admin_academy_rewards(uuid, integer)
from public, anon, authenticated;

grant execute on function public.academy_challenge_rules(), public.academy_month_start(timestamptz), public.academy_challenge_pool(text) to anon, authenticated;
grant execute on function public.academy_challenge_claim(), public.academy_challenge_quiz_start(text), public.academy_challenge_quiz_submit(uuid, jsonb),
  public.academy_challenge_status() to authenticated;
grant execute on function
  public.academy_challenge_claim_for(uuid), public.academy_challenge_status_for(uuid), public.academy_challenge_progress(uuid, date),
  public.academy_reward_decide(uuid, text[]), public.academy_reward_begin(uuid, uuid, text), public.academy_reward_grant_comp(uuid, timestamptz, uuid),
  public.academy_reward_finish(uuid, boolean, text, integer, text, uuid), public.academy_reward_set_review(uuid, text, uuid),
  public.academy_reward_decline(uuid, uuid, text), public.academy_reward_mark_manual(uuid, uuid, text), public.admin_academy_rewards(uuid, integer)
to service_role;
grant select on public.academy_course_completions, public.academy_challenge_topics, public.academy_rewards, public.academy_reward_events to service_role;
