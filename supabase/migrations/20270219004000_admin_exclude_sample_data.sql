-- Keep Demo and Practice sample data out of every owner/admin number (James 2026-11-22).
-- Practice now seeds a full 24-month company per user (20270219003000). The owner reports in the app already drop
-- demo logins; these five database reports counted them. Each is copied from its latest definition with one change:
-- rows owned by a demo or practice login (or its company) are left out, via public.is_demo_account().
--   admin_metrics, growth_funnel, growth_meaningful_estimates, admin_proposal_text_metrics, admin_comp_list.
-- Read-only reports only: no data is changed, deleted or moved. Safe to run more than once.
-- Rollback: re-run each function from its source migration (20261112000200, 20261112001000, 20261117001001,
-- 20261112000600, 20261114004000).

create or replace function public.admin_metrics(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users u where not public.is_demo_account(u.id)),
    'verified_accounts', (select count(*) from auth.users u where u.email_confirmed_at is not null and not public.is_demo_account(u.id)),
    'plans', jsonb_build_object(
      'monthly', (select count(distinct user_id) from public.subscriptions where plan = 'monthly' and status in ('active', 'trialing', 'past_due')),
      'annual', (select count(distinct user_id) from public.subscriptions where plan = 'annual' and status in ('active', 'trialing', 'past_due'))
    ),
    'exports_this_month', (select count(*) from public.usage_events where period_start = public.quota_period_start() and not public.is_demo_account(user_id)),
    'exports_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m)
       from (select period_start as m, count(*) as c from public.usage_events where not public.is_demo_account(user_id) group by 1 order by 1 desc limit 12) x), '[]'),
    'trade_popularity', coalesce((select jsonb_agg(jsonb_build_object('trade', t, 'count', c) order by c desc)
       from (select unnest(trades) as t, count(*) as c from public.estimates where not public.is_demo_account(user_id) group by 1 order by 2 desc limit 40) x), '[]'),
    'funnel_30d', coalesce((select jsonb_object_agg(event, c)
       from (select event, count(*) as c from public.analytics_events where created_at > now() - interval '30 days' and not public.is_demo_account(user_id) group by 1) x), '{}'),
    'import_failures_7d', (select count(*) from public.import_logs where status in ('failed', 'blocked') and created_at > now() - interval '7 days'),
    'pdf_errors_7d', (select count(*) from public.pdf_errors where created_at > now() - interval '7 days'),
    'api_usage_30d', coalesce((select jsonb_object_agg(provider, u)
       from (select provider, sum(units) as u from public.api_usage where created_at > now() - interval '30 days' group by 1) x), '{}')
  ) into result;
  return result;
end $$;

create or replace function public.growth_funnel(p_caller uuid, p_since timestamptz default now() - interval '30 days')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'since', p_since,
    'leads_total', (select count(*) from public.leads),
    'leads_new', (select count(*) from public.leads where created_at >= p_since),
    'leads_suppressed', (select count(*) from public.leads where suppressed_at is not null),
    'leads_by_stage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.leads group by stage) s), '{}'::jsonb),
    'signups_total', (select count(*) from auth.users u where not public.is_demo_account(u.id)),
    'signups_new', (select count(*) from auth.users u where u.created_at >= p_since and not public.is_demo_account(u.id)),
    'activated_total', (select count(distinct user_id) from public.estimate_versions where not public.is_demo_account(user_id)),
    'activated_new', (select count(*) from (select user_id, min(created_at) f from public.estimate_versions where not public.is_demo_account(user_id) group by user_id) a where a.f >= p_since),
    'paying_monthly', (select count(*) from public.subscriptions where plan = 'monthly' and status in ('active', 'trialing', 'past_due')),
    'paying_annual', (select count(*) from public.subscriptions where plan = 'annual' and status in ('active', 'trialing', 'past_due')),
    'churned_new', (select count(*) from public.subscriptions where status = 'canceled' and updated_at >= p_since),
    'campaigns', coalesce((
      select jsonb_agg(c order by c->>'leads' desc) from (
        select jsonb_build_object(
          'campaign', coalesce(l.first_campaign_name, l.first_campaign_id, l.utm_campaign, l.source, '(direct / unknown)'),
          'leads', count(*),
          'replied', count(*) filter (where exists (select 1 from public.lead_events e where e.lead_id = l.id and e.event = 'reply_received')),
          'signed_up', count(*) filter (where l.user_id is not null),
          'activated', count(*) filter (where l.user_id is not null and exists (select 1 from public.estimate_versions v where v.user_id = l.user_id)),
          'paid', count(*) filter (where l.user_id is not null and exists (select 1 from public.subscriptions s where s.user_id = l.user_id and s.status in ('active', 'trialing', 'past_due'))),
          'unsubscribed', count(*) filter (where l.unsubscribed_at is not null)
        ) c
        from public.leads l
        group by coalesce(l.first_campaign_name, l.first_campaign_id, l.utm_campaign, l.source, '(direct / unknown)')
      ) x), '[]'::jsonb),
    'costs_usd', (select coalesce(sum(amount_usd), 0) from public.marketing_costs where period_start >= p_since::date),
    'costs_total_usd', (select coalesce(sum(amount_usd), 0) from public.marketing_costs)
  ) into r;
  return r;
end $$;


create or replace function public.growth_meaningful_estimates()
returns table (estimate_id uuid, user_id uuid, reached_at timestamptz, from_event boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.user_id, coalesce(ev.at, e.updated_at), ev.at is not null
  from public.estimates e
  join (
    select i.estimate_id from public.estimate_items i
    where btrim(i.name) <> '' and i.quantity > 0 and i.unit_cost > 0
    group by i.estimate_id having count(*) >= 3
  ) m on m.estimate_id = e.id
  left join lateral (
    select min(a.created_at) as at from public.analytics_events a where a.event = 'bid_created' and a.estimate_id = e.id
  ) ev on true
  where not public.is_demo_account(e.user_id);
$$;

create or replace function public.admin_proposal_text_metrics(p_caller uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)));
begin
  if not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with est as (
    select
      e.id,
      coalesce(e.trades[1], 'other') as trade,
      coalesce(nullif(btrim(e.proposal_config ->> 'scopeOfWork'), ''), null) is not null as has_scope,
      coalesce(e.proposal_config -> 'scope' ->> 'source', 'manual') as scope_source,
      coalesce(e.proposal_config -> 'exclusionList' -> 'items', '[]'::jsonb) as ex_items
    from public.estimates e
    where e.updated_at >= since and not public.is_demo_account(e.user_id)
  ),
  ex as (
    select est.id, est.trade, i ->> 'category' as category, i ->> 'status' as status, i ->> 'source' as source
    from est, jsonb_array_elements(case when jsonb_typeof(est.ex_items) = 'array' then est.ex_items else '[]'::jsonb end) i
  ),
  ver as (
    select v.estimate_id,
      coalesce(nullif(btrim(v.proposal ->> 'scopeOfWork'), ''), null) is not null as shows_scope,
      coalesce(nullif(btrim(v.proposal ->> 'exclusions'), ''), null) is not null as shows_exclusions
    from public.estimate_versions v
    where v.created_at >= since and not public.is_demo_account(v.user_id)
  ),
  gen as (
    select * from public.ai_generations where created_at >= since and not public.is_demo_account(user_id)
  )
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 3650)),
    'estimates', (select count(*) from est),
    'scopes', jsonb_build_object(
      'with_scope', (select count(*) from est where has_scope),
      'manual', (select count(*) from est where has_scope and scope_source = 'manual'),
      'generated', (select count(*) from est where has_scope and scope_source = 'generated'),
      'edited', (select count(*) from est where has_scope and scope_source = 'edited')
    ),
    'exclusions', jsonb_build_object(
      'estimates_using', (select count(distinct id) from ex where status = 'approved'),
      'approved_items', (select count(*) from ex where status = 'approved'),
      'approved_generated', (select count(*) from ex where status = 'approved' and source in ('generated', 'edited')),
      'approved_manual', (select count(*) from ex where status = 'approved' and source = 'manual'),
      'suggestions_rejected', (select count(*) from ex where status = 'rejected'),
      'suggestions_pending', (select count(*) from ex where status = 'suggested'),
      'top_categories_by_trade', coalesce((
        select jsonb_agg(jsonb_build_object('trade', trade, 'category', category, 'count', c) order by trade, c desc)
        from (
          select trade, category, c, row_number() over (partition by trade order by c desc) as rn
          from (select trade, coalesce(category, 'custom') as category, count(*) as c from ex where status = 'approved' group by 1, 2) t
        ) r where rn <= 5
      ), '[]')
    ),
    'proposals', jsonb_build_object(
      'exported', (select count(*) from ver),
      'with_scope', (select count(*) from ver where shows_scope),
      'with_exclusions', (select count(*) from ver where shows_exclusions)
    ),
    'generation', jsonb_build_object(
      'total', (select count(*) from gen),
      'scope', (select count(*) from gen where kind = 'scope'),
      'exclusions', (select count(*) from gen where kind = 'exclusions'),
      'ai', (select count(*) from gen where engine = 'ai'),
      'rules', (select count(*) from gen where engine = 'rules'),
      'failed', (select count(*) from gen where status in ('failed', 'rejected')),
      'limited', (select count(*) from gen where status = 'limited'),
      'cost_usd', (select coalesce(sum(cost_usd), 0) from gen),
      'estimates', (select count(distinct estimate_id) from gen where estimate_id is not null),
      'per_estimate', (select case when count(distinct estimate_id) = 0 then 0 else round(count(*) filter (where estimate_id is not null)::numeric / count(distinct estimate_id), 2) end from gen),
      'by_trade', coalesce((
        select jsonb_agg(jsonb_build_object('trade', t, 'scope', s, 'exclusions', x, 'cost_usd', c) order by s + x desc)
        from (select coalesce(trade, 'other') as t, count(*) filter (where kind = 'scope') as s, count(*) filter (where kind = 'exclusions') as x, coalesce(sum(cost_usd), 0) as c from gen group by 1 limit 40) q
      ), '[]')
    )
  ) into result;
  return result;
end $$;

create or replace function public.admin_comp_list(p_caller uuid, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(p_filters ->> 'q'), '');
  v_plan text := nullif(p_filters ->> 'plan', '');
  v_state text := nullif(p_filters ->> 'state', '');
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_rows jsonb;
  v_metrics jsonb;
begin
  perform public.comp_require_admin(p_caller);
  with base as (
    select g, public.comp_grant_state(g) as st from public.complimentary_grants g
    where (v_plan is null or g.plan = v_plan)
      and not public.is_demo_account(g.user_id) and not public.is_demo_account(g.company_id)
      and (v_from is null or g.created_at >= v_from)
      and (v_to is null or g.created_at < v_to + interval '1 day')
  ), picked as (
    select b.g from base b
    where (v_state is null or b.st = v_state
           or (v_state = 'expiring_soon' and b.st = 'active' and (b.g).expires_at < now() + interval '7 days'))
      and (v_q is null or (b.g).email ilike '%' || v_q || '%'
           or exists (select 1 from public.business_profiles bp where bp.user_id = (b.g).user_id and bp.company_name ilike '%' || v_q || '%'))
    order by (b.g).created_at desc
    limit 500
  )
  select coalesce(jsonb_agg(public.comp_admin_row(p.g) order by (p.g).created_at desc), '[]') into v_rows from picked p;

  with base as (
    select g.*, public.comp_grant_state(g) as st from public.complimentary_grants g
    where (v_plan is null or g.plan = v_plan)
      and not public.is_demo_account(g.user_id) and not public.is_demo_account(g.company_id)
      and (v_from is null or g.created_at >= v_from)
      and (v_to is null or g.created_at < v_to + interval '1 day')
  )
  select jsonb_build_object(
    'active', count(*) filter (where st = 'active'),
    'pending', count(*) filter (where st = 'pending'),
    'expiring_soon', count(*) filter (where st = 'active' and expires_at < now() + interval '7 days'),
    'expired', count(*) filter (where st = 'expired'),
    'invite_expired', count(*) filter (where st = 'invite_expired'),
    'revoked', count(*) filter (where st = 'revoked'),
    'paused', count(*) filter (where st = 'paused'),
    'unlimited', count(*) filter (where plan = 'unlimited'),
    'enterprise', count(*) filter (where plan = 'enterprise'),
    'converted', count(*) filter (where user_id is not null and not had_paid_subscription and exists (
      select 1 from public.subscriptions s where s.user_id = base.user_id
        and s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'))),
    'total', count(*)
  ) into v_metrics from base;

  return jsonb_build_object('rows', v_rows, 'metrics', v_metrics);
end $$;

