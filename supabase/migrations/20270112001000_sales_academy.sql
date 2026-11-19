-- Sales Academy (James, 2026-11-19): topic quiz progress, "certified to sell", and AI starter-script usage
-- with a monthly per-rep cap. Requires 20270107001000 + 20270107002000. Safe to re-run.
-- Quizzes are graded on the server (src/lib/sales/academy.ts); only the service role records results, so a
-- rep can't mark their own quiz passed.

create table if not exists public.sales_academy_progress (
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  topic text not null check (topic ~ '^[a-z0-9-]{1,40}$'),
  best_score integer not null default 0 check (best_score between 0 and 100),
  total integer not null default 0 check (total between 0 and 100),
  attempts integer not null default 0,
  passed_at timestamptz,
  last_at timestamptz not null default now(),
  primary key (rep_id, topic)
);
alter table public.sales_academy_progress enable row level security;

create or replace function public.sales_academy_record(p_rep uuid, p_topic text, p_score integer, p_total integer, p_passed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.sales_academy_progress;
begin
  if not exists (select 1 from public.sales_reps where id = p_rep and status = 'active') then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  insert into public.sales_academy_progress as x (rep_id, topic, best_score, total, attempts, passed_at, last_at)
  values (p_rep, p_topic, p_score, p_total, 1, case when p_passed then now() end, now())
  on conflict (rep_id, topic) do update set best_score = greatest(x.best_score, excluded.best_score), total = excluded.total,
    attempts = x.attempts + 1, passed_at = coalesce(x.passed_at, excluded.passed_at), last_at = now()
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.sales_my_academy() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('topic', topic, 'best_score', best_score, 'total', total, 'attempts', attempts, 'passed_at', passed_at))
    from public.sales_academy_progress where rep_id = rep.id), '[]'::jsonb);
end $$;

create or replace function public.admin_sales_academy(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_object_agg(rep_id, topics) from (
    select rep_id, jsonb_agg(topic) filter (where passed_at is not null) as topics from public.sales_academy_progress group by rep_id) t), '{}'::jsonb);
end $$;

-- AI usage per rep (starter scripts now; call notes later). Monthly cap is owner policy.
alter table public.sales_settings add column if not exists ai_monthly_cap integer not null default 100 check (ai_monthly_cap between 0 and 10000);

create table if not exists public.sales_ai_usage (
  id bigint generated always as identity primary key,
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  kind text not null check (kind in ('script', 'call_notes')),
  lead_id uuid references public.sales_leads (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_ai_usage_rep on public.sales_ai_usage (rep_id, created_at);
alter table public.sales_ai_usage enable row level security;

-- Reserve one AI use for the caller's rep if under this month's cap. Returns remaining uses, or raises.
create or replace function public.sales_ai_reserve(p_rep uuid, p_kind text, p_lead uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_cap integer; v_used integer;
begin
  select ai_monthly_cap into v_cap from public.sales_settings where id;
  perform pg_advisory_xact_lock(hashtext('sales_ai:' || p_rep::text));
  select count(*) into v_used from public.sales_ai_usage where rep_id = p_rep and created_at >= public.sales_month_start(now());
  if v_used >= v_cap then raise exception 'ai_cap_reached' using errcode = '22023'; end if;
  insert into public.sales_ai_usage (rep_id, kind, lead_id) values (p_rep, p_kind, p_lead);
  return v_cap - v_used - 1;
end $$;

-- Start of the current sales month as a timestamp (sales time zone).
create or replace function public.sales_month_start(p_at timestamptz) returns timestamptz
language sql stable security definer set search_path = public as $$
  select (public.sales_month_of(p_at)::timestamp) at time zone coalesce((select time_zone from public.sales_settings where id), 'America/Chicago')
$$;

do $$
declare f text;
begin
  foreach f in array array['public.sales_academy_record(uuid, text, integer, integer, boolean)', 'public.admin_sales_academy(uuid)',
    'public.sales_ai_reserve(uuid, text, uuid)', 'public.sales_month_start(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.sales_my_academy() from public, anon';
  execute 'grant execute on function public.sales_my_academy() to authenticated, service_role';
end $$;
revoke all on public.sales_academy_progress, public.sales_ai_usage from anon, authenticated;
grant all on public.sales_academy_progress, public.sales_ai_usage to service_role;
