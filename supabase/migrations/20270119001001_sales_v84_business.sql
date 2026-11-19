-- Sales Hub V8.4 P3: My Business (customer portfolio), voluntary goals, opt-in team recognition and the
-- owner's weekly recognition digest.
--
--   * Goals are chosen by the rep, are never compulsory, and are never used to rank, penalize or decide
--     anything about a rep. A lower goal is as valid as a higher one.
--   * Team recognition shows only reps who turned on public recognition in My preferences. No ranking.
--   * The weekly digest goes only to the owner, and only after the owner turns it on.

create table if not exists public.sales_rep_goals (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  kind text not null check (kind in ('new_sales', 'onboardings', 'follow_ups', 'prospects', 'earnings')),
  target integer not null check (target between 1 and 10000000),
  created_at timestamptz not null default now(),
  unique (rep_id, period_month, kind)
);
alter table public.sales_rep_goals enable row level security;
revoke all on public.sales_rep_goals from public, anon, authenticated;
grant all on public.sales_rep_goals to service_role;

alter table public.sales_settings add column if not exists digest_enabled boolean not null default false;
alter table public.sales_settings add column if not exists digest_last_sent date;

-- Progress for one rep and month. Earnings are commission dollars dated that month (any status but canceled).
create or replace function public.sales_goal_progress(p_rep uuid, p_month date, p_kind text) returns integer
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'new_sales' then (select count(*)::int from public.sales_commissions c where c.rep_id = p_rep and c.kind = 'commission' and c.year_no = 1
                             and c.period_month = p_month and c.status in ('pending', 'earned', 'approved', 'paid'))
    when 'onboardings' then (select count(*)::int from public.sales_customer_successes s where s.rep_id = p_rep and s.kind = 'onboarding_complete'
                               and public.sales_month_of(s.occurred_at) = p_month)
    when 'follow_ups' then (select count(*)::int from public.sales_tasks t where t.rep_id = p_rep and public.sales_month_of(t.done_at) = p_month)
    when 'prospects' then (select count(distinct a.lead_id)::int from public.sales_activities a where a.rep_id = p_rep and a.lead_id is not null
                             and a.kind in ('call', 'text', 'email', 'meeting') and public.sales_month_of(a.occurred_at) = p_month)
    when 'earnings' then (select coalesce(sum(c.amount_cents), 0)::int from public.sales_commissions c where c.rep_id = p_rep and c.period_month = p_month
                            and c.status in ('pending', 'earned', 'approved', 'paid'))
  end
$$;

create or replace function public.sales_my_goals(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); v_month date := public.sales_month_of(p_now);
begin
  return jsonb_build_object('month', v_month,
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'target', g.target, 'month', g.period_month,
        'progress', public.sales_goal_progress(rep.id, g.period_month, g.kind)) order by g.period_month desc, g.kind)
      from public.sales_rep_goals g where g.rep_id = rep.id and g.period_month >= (v_month - interval '5 months')::date), '[]'::jsonb),
    -- Last month's actuals, as a reference point when choosing (never a requirement).
    'last_month', (select jsonb_object_agg(k, public.sales_goal_progress(rep.id, (v_month - interval '1 month')::date, k))
      from unnest(array['new_sales', 'onboardings', 'follow_ups', 'prospects', 'earnings']) k));
end $$;

create or replace function public.sales_my_goal_save(p_kind text, p_target integer, p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep();
begin
  insert into public.sales_rep_goals (rep_id, period_month, kind, target) values (rep.id, public.sales_month_of(p_now), p_kind, p_target)
  on conflict (rep_id, period_month, kind) do update set target = excluded.target;
end $$;

create or replace function public.sales_my_goal_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep();
begin
  delete from public.sales_rep_goals where id = p_id and rep_id = rep.id;
end $$;

-- Opt-in team wins: first names and what happened, for reps who chose public recognition. No amounts.
create or replace function public.sales_team_wins(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep();
begin
  return coalesce((select jsonb_agg(w order by w ->> 'at' desc) from (
    select jsonb_build_object('rep', split_part(btrim(r.full_name), ' ', 1), 'kind', s.kind, 'at', s.occurred_at, 'mine', r.id = rep.id) w
    from public.sales_customer_successes s join public.sales_reps r on r.id = s.rep_id and r.status = 'active'
    join public.sales_rep_preferences p on p.rep_id = r.id and p.public_recognition
    where s.kind = 'onboarding_complete' and s.occurred_at > p_now - interval '14 days'
    union all
    select jsonb_build_object('rep', split_part(btrim(r.full_name), ' ', 1), 'kind', a.kind, 'at', a.created_at, 'mine', r.id = rep.id)
    from public.sales_achievements a join public.sales_reps r on r.id = a.rep_id and r.status = 'active'
    join public.sales_rep_preferences p on p.rep_id = r.id and p.public_recognition
    where a.kind in ('first_sale', 'record_sales') and a.created_at > p_now - interval '14 days'
    order by 1 desc limit 20) x), '[]'::jsonb);
end $$;

-- The owner's weekly digest (service role): last 7 days of recognition activity.
create or replace function public.sales_recognition_digest(p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'since', p_now - interval '7 days',
    'sales', (select count(*) from public.sales_attributions where first_paid_at > p_now - interval '7 days' and first_paid_at <= p_now),
    'successes', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'kind', s.kind, 'customer', coalesce(nullif(btrim(b.company_name), ''), 'a customer')) order by s.occurred_at)
      from public.sales_customer_successes s join public.sales_reps r on r.id = s.rep_id left join public.business_profiles b on b.user_id = s.user_id
      where s.kind = 'onboarding_complete' and s.detected_at > p_now - interval '7 days'), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'kind', a.kind, 'value', a.value) order by a.created_at)
      from public.sales_achievements a join public.sales_reps r on r.id = a.rep_id where a.created_at > p_now - interval '7 days'), '[]'::jsonb),
    'awaiting', jsonb_build_object(
      'congrats', (select count(*) from public.sales_congrats_emails where status in ('draft', 'failed')),
      'rewards', (select count(*) from public.sales_reward_awards where status = 'proposed'),
      'boxes', (select count(*) from public.sales_milestone_awards where status = 'ready'),
      'not_congratulated', (select count(*) from public.sales_customer_successes where kind = 'onboarding_complete' and congratulated_at is null and detected_at > p_now - interval '30 days')))
$$;

-- Claims this week's digest (Monday or later, once per ISO week). Returns null when not due or turned off.
create or replace function public.sales_digest_claim(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.sales_settings; v_week date := date_trunc('week', p_now at time zone 'America/Chicago')::date;
begin
  select * into cfg from public.sales_settings where id for update;
  if not cfg.digest_enabled or (cfg.digest_last_sent is not null and cfg.digest_last_sent >= v_week) then return null; end if;
  update public.sales_settings set digest_last_sent = v_week where id;
  return public.sales_recognition_digest(p_now);
end $$;

create or replace function public.admin_sales_digest_settings_save(p_caller uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  update public.sales_settings set digest_enabled = coalesce(p_enabled, false) where id;
  perform public.sales_audit(p_caller, 'sales.digest_settings_saved', 'sales_settings', 'singleton', jsonb_build_object('enabled', coalesce(p_enabled, false)));
end $$;

create or replace function public.admin_sales_digest_preview(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return public.sales_recognition_digest(now()) || jsonb_build_object('enabled', (select digest_enabled from public.sales_settings where id));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_goal_progress(uuid, date, text)', 'public.sales_recognition_digest(timestamptz)', 'public.sales_digest_claim(timestamptz)',
    'public.admin_sales_digest_settings_save(uuid, boolean)', 'public.admin_sales_digest_preview(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.sales_my_goals(timestamptz)', 'public.sales_my_goal_save(text, integer, timestamptz)', 'public.sales_my_goal_delete(uuid)', 'public.sales_team_wins(timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
