-- Scope of Work + Exclusions & Clarifications: AI usage log and admin feature analytics.
--
-- Non-destructive: adds one table and three functions. No existing table, column or function
-- is changed. The scope and exclusion text itself lives in estimates.proposal_config (already
-- saved by save_estimate and frozen into estimate_versions.snapshot on finalize), so the
-- feature works before this migration is applied; this only adds per-user limits, cost
-- tracking and the admin report.

-- One row per generation request. Never stores the bid, the prompt, or the generated text.
create table if not exists public.ai_generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete set null,
  kind text not null check (kind in ('scope', 'exclusions')),
  trade text check (char_length(trade) <= 60),
  style text check (style in ('simple', 'professional', 'detailed')),
  engine text not null check (engine in ('ai', 'rules')),
  status text not null check (status in ('ok', 'fallback', 'rejected', 'failed', 'limited')),
  model text check (char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_generations_user_time_idx on public.ai_generations (user_id, created_at desc);
create index if not exists ai_generations_time_idx on public.ai_generations (created_at);
create index if not exists ai_generations_estimate_idx on public.ai_generations (estimate_id);

-- Service role only (no policies, no grants), like the other log tables.
alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from anon, authenticated;

-- Total AI spend since a point in time (used for the monthly budget ceiling).
create or replace function public.ai_generation_spend_since(p_since timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.ai_generations where created_at >= p_since;
$$;
revoke all on function public.ai_generation_spend_since(timestamptz) from public, anon, authenticated;

-- Aggregate-only feature report for the admin dashboard. Returns counts, rates and costs.
-- Reads proposal_config only to classify (source, visibility, category, status); it never
-- returns scope or exclusion text, customer details, or per-user rows.
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
    where e.updated_at >= since
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
    where v.created_at >= since
  ),
  gen as (
    select * from public.ai_generations where created_at >= since
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
revoke all on function public.admin_proposal_text_metrics(uuid, integer) from public, anon, authenticated;
