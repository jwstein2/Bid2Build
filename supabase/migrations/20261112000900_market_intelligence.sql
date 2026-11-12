-- Market Pricing Intelligence: de-identified analytics layer (admin-only).
--
-- Non-destructive: creates new objects only. Nothing in the existing operational tables changes.
--
-- Separation of concerns
--   * Operational records (estimates, versions, customers) stay in `public` under per-user RLS.
--   * De-identified observations live in schema `market`, which is NOT exposed through the API and
--     has no grants to anon/authenticated. Contributors are pseudonymous keys; no names, emails,
--     phone numbers, addresses, notes, descriptions or proposal text are stored here.
--   * Admin reads go through SECURITY DEFINER functions in `public` that check is_admin(), apply
--     minimum-contributor suppression, and write an audit entry. Execute is revoked from
--     anon/authenticated; only the server (service role) can call them.
--   * Capture happens only when a proposal version is finalized, at most once per version, and
--     only with the contractor's opt-in consent. Internal costs need a separate opt-in.

create schema if not exists market;
revoke all on schema market from public;

-- ---------------------------------------------------------------------------
-- Consent (user-facing, RLS) and the per-estimate project profile used for benchmarking
-- ---------------------------------------------------------------------------
create table public.market_consent (
  user_id uuid primary key references auth.users (id) on delete cascade,
  share_prices boolean not null default false,
  share_costs boolean not null default false,
  commercial_use boolean not null default false,
  policy_version text not null check (char_length(policy_version) <= 40),
  updated_at timestamptz not null default now(),
  constraint market_consent_costs_need_prices check (not share_costs or share_prices),
  constraint market_consent_commercial_needs_prices check (not commercial_use or share_prices)
);
alter table public.market_consent enable row level security;
create policy market_consent_own_select on public.market_consent for select to authenticated using (user_id = (select auth.uid()));
create policy market_consent_own_insert on public.market_consent for insert to authenticated with check (user_id = (select auth.uid()));
create policy market_consent_own_update on public.market_consent for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.market_consent from anon, authenticated;
grant select, insert, update on public.market_consent to authenticated;

create table public.estimate_project_profiles (
  estimate_id uuid primary key references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sector text check (sector in ('residential', 'commercial')),
  work_type text check (work_type in ('new_construction', 'remodel', 'addition', 'replacement', 'repair')),
  project_type text check (char_length(project_type) <= 60),
  measurements jsonb not null default '{}' check (jsonb_typeof(measurements) = 'object' and pg_column_size(measurements) < 4000),
  outcome text check (outcome in ('quoted', 'accepted', 'declined', 'completed')),
  updated_at timestamptz not null default now()
);
create trigger estimate_project_profiles_updated before update on public.estimate_project_profiles for each row execute function public.set_updated_at();
alter table public.estimate_project_profiles enable row level security;
create policy estimate_project_profiles_own_all on public.estimate_project_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.estimates e where e.id = estimate_id and e.user_id = (select auth.uid())));
revoke all on public.estimate_project_profiles from anon, authenticated;
grant select, insert, update, delete on public.estimate_project_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Analytics tables (schema market)
-- ---------------------------------------------------------------------------
create table market.settings (
  id boolean primary key default true check (id),
  -- Shared market-price statistics require this many independent businesses. Floor of 20 is
  -- enforced here so lowering it is a deliberate, reviewed migration (privacy/legal review).
  min_contributors integer not null default 20 check (min_contributors >= 20),
  zip_min_contributors integer not null default 20 check (zip_min_contributors >= 20),
  precise_confidence numeric(4, 3) not null default 0.75 check (precise_confidence between 0.5 and 1),
  anomaly_z numeric(5, 2) not null default 3.5 check (anomaly_z > 0),
  iqr_k numeric(5, 2) not null default 3 check (iqr_k > 0),
  min_peer_observations integer not null default 8 check (min_peer_observations >= 3),
  min_peer_contributors integer not null default 5 check (min_peer_contributors >= 2),
  peer_window_months integer not null default 24 check (peer_window_months between 1 and 120),
  margin_high_pct numeric(5, 2) not null default 70,
  retention_months integer not null default 120 check (retention_months >= 12),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into market.settings default values;

-- Append-only consent history.
create table market.consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  share_prices boolean not null,
  share_costs boolean not null,
  commercial_use boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);

-- Pseudonymous contributor keys. Synthetic demo contributors have no user.
create table market.contributors (
  key uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete cascade,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  constraint contributors_synthetic_has_no_user check (is_synthetic = (user_id is null))
);

create table market.observations (
  id uuid primary key default gen_random_uuid(),
  contributor uuid not null references market.contributors (key) on delete cascade,
  -- Immutable references back to the operational record (never shown in reports).
  estimate_id uuid references public.estimates (id) on delete cascade,
  version_id uuid unique references public.estimate_versions (id) on delete cascade,
  version_number integer,
  is_synthetic boolean not null default false,
  -- Only the latest finalized version of an estimate counts, so revisions don't inflate statistics.
  is_latest boolean not null default true,
  excluded_reason text check (excluded_reason in ('data_entry_error', 'unit_conversion_error')),
  schema_version integer not null,
  captured_at timestamptz not null default now(),
  quote_date date not null,
  status text not null default 'quoted' check (status in ('draft', 'quoted', 'accepted', 'declined', 'completed', 'unknown')),
  trade text,
  trades text[] not null default '{}',
  project_type text,
  work_type text,
  sector text,
  complexity text check (complexity in ('standard', 'complex')),
  zip5 text check (zip5 ~ '^\d{5}$'),
  zip3 text check (zip3 ~ '^\d{3}$'),
  state text check (char_length(state) = 2),
  metro text,
  state_conflict boolean not null default false,
  price_subtotal numeric(14, 2) not null check (price_subtotal >= 0),
  tax_amount numeric(14, 2) not null default 0,
  price_total numeric(14, 2) not null,
  tax_rate numeric(7, 4),
  adjustment numeric(14, 2),
  costs_shared boolean not null default false,
  cost_total numeric(14, 2),
  gross_margin_pct numeric(9, 2),
  markup_pct numeric(12, 2),
  size_value numeric(14, 2),
  size_unit text,
  size_source text check (size_source in ('entered', 'inferred')),
  price_per_unit numeric(14, 4),
  measurements jsonb not null default '{}',
  group_count integer not null default 0,
  line_count integer not null default 0,
  constraint observations_synthetic_has_no_version check (is_synthetic = (version_id is null)),
  constraint observations_costs_need_consent check (costs_shared or (cost_total is null and gross_margin_pct is null and markup_pct is null))
);
create index observations_scan_idx on market.observations (is_synthetic, is_latest, quote_date);
create index observations_trade_idx on market.observations (trade, quote_date);
create index observations_geo_idx on market.observations (state, metro);
create index observations_estimate_idx on market.observations (estimate_id);
create index observations_contributor_idx on market.observations (contributor);

create table market.group_observations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references market.observations (id) on delete cascade,
  idx integer not null,
  name text not null default '',
  std_category text not null default 'unclassified',
  price numeric(14, 2) not null,
  cost numeric(14, 2),
  margin_pct numeric(9, 2),
  markup_pct numeric(12, 2),
  item_count integer not null default 0,
  unique (observation_id, idx)
);

create table market.line_observations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references market.observations (id) on delete cascade,
  group_id uuid references market.group_observations (id) on delete cascade,
  fingerprint text not null,
  original_name text not null,
  trade text,
  component text,
  material text,
  category text not null,
  brand text,
  product_line text,
  specs jsonb not null default '{}',
  install_type text,
  cost_class text not null check (cost_class in ('labor', 'material', 'equipment', 'subcontractor', 'other')),
  entered_cost_type text,
  material_key text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  class_method text not null default 'rule' check (class_method in ('rule', 'ai', 'admin')),
  class_conflict boolean not null default false,
  treatment text,
  taxable boolean,
  unit_raw text,
  unit_norm text not null,
  unit_family text not null,
  qty numeric(16, 4) not null,
  qty_norm numeric(18, 4) not null,
  unit_price numeric(16, 4) not null,
  unit_price_norm numeric(18, 6) not null,
  ext_price numeric(14, 2) not null,
  unit_cost numeric(16, 4),
  unit_cost_norm numeric(18, 6),
  markup_pct numeric(12, 2),
  excluded_reason text check (excluded_reason in ('data_entry_error', 'unit_conversion_error'))
);
create index line_observations_obs_idx on market.line_observations (observation_id);
create index line_observations_key_idx on market.line_observations (material_key, unit_norm);
create index line_observations_cat_idx on market.line_observations (category);
create index line_observations_fp_idx on market.line_observations (fingerprint);
create index line_observations_class_idx on market.line_observations (cost_class, unit_norm);

-- One row per distinct item text (per trade + cost class). Admin corrections live here and are
-- applied to existing and future observations with the same fingerprint.
create table market.classifications (
  fingerprint text primary key,
  sample_name text not null,
  trade text,
  component text,
  material text,
  category text not null,
  brand text,
  product_line text,
  specs jsonb not null default '{}',
  cost_class text not null,
  material_key text not null,
  confidence numeric(4, 3) not null,
  method text not null default 'rule' check (method in ('rule', 'ai', 'admin')),
  status text not null default 'auto' check (status in ('auto', 'needs_review', 'reviewed')),
  observation_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create index classifications_status_idx on market.classifications (status, observation_count desc);

create table market.anomalies (
  id bigint generated always as identity primary key,
  observation_id uuid not null references market.observations (id) on delete cascade,
  line_observation_id uuid references market.line_observations (id) on delete cascade,
  is_synthetic boolean not null default false,
  kind text not null check (kind in ('high_price', 'low_price', 'unit_conversion', 'unusual_margin', 'duplicate', 'classification_mismatch')),
  metric text not null,
  value numeric,
  peer_key text,
  peer_level text,
  peer_median numeric,
  peer_mad numeric,
  peer_q1 numeric,
  peer_q3 numeric,
  robust_z numeric,
  peer_n integer,
  peer_contributors integer,
  detail jsonb,
  detected_at timestamptz not null default now(),
  review_status text not null default 'open' check (review_status in ('open', 'genuine_premium', 'complex_scope', 'data_entry_error', 'unit_conversion_error', 'insufficient_data', 'needs_investigation')),
  review_note text check (char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create unique index anomalies_target_uniq on market.anomalies (observation_id, coalesce(line_observation_id, observation_id), kind, metric);
create index anomalies_status_idx on market.anomalies (review_status, kind);

-- Scheduled aggregation: monthly project-price and price-per-unit distributions (raw, unsuppressed;
-- suppression is applied on every read).
create table market.segment_stats (
  dataset text not null check (dataset in ('real', 'synthetic')),
  period date not null,
  geo_level text not null check (geo_level in ('national', 'state')),
  geo_key text not null,
  trade text not null,
  metric text not null check (metric in ('project_price', 'price_per_unit')),
  n integer not null,
  contributors integer not null,
  p25 numeric, median numeric, p75 numeric, mean numeric, mad numeric,
  computed_at timestamptz not null default now(),
  primary key (dataset, period, geo_level, geo_key, trade, metric)
);

create table market.refresh_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  actor_id uuid references auth.users (id) on delete set null,
  result jsonb
);

alter table market.settings enable row level security;
alter table market.consent_events enable row level security;
alter table market.contributors enable row level security;
alter table market.observations enable row level security;
alter table market.group_observations enable row level security;
alter table market.line_observations enable row level security;
alter table market.classifications enable row level security;
alter table market.anomalies enable row level security;
alter table market.segment_stats enable row level security;
alter table market.refresh_runs enable row level security;
-- No policies and no grants: only SECURITY DEFINER functions (owned by the migration role) read these.
revoke all on all tables in schema market from public;
do $$ begin
  execute 'revoke all on all tables in schema market from anon, authenticated';
exception when undefined_object then null; end $$;

insert into public.feature_flags (key, enabled, description) values
  ('market_capture', true, 'Capture de-identified pricing observations at finalization (only for contractors who opted in).'),
  ('market_external_products', false, 'Market-derived recommendations or external data products. Do not enable before legal review.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Consent side effects: history, and withdrawal removes or strips contributed data
-- ---------------------------------------------------------------------------
create or replace function market.on_consent_change() returns trigger
language plpgsql security definer set search_path = market, public as $$
begin
  insert into market.consent_events (user_id, share_prices, share_costs, commercial_use, policy_version)
    values (new.user_id, new.share_prices, new.share_costs, new.commercial_use, new.policy_version);
  if not new.share_prices then
    delete from market.observations o using market.contributors c
      where o.contributor = c.key and c.user_id = new.user_id;
  elsif not new.share_costs then
    update market.line_observations l set unit_cost = null, unit_cost_norm = null, markup_pct = null
      from market.observations o join market.contributors c on c.key = o.contributor
      where l.observation_id = o.id and c.user_id = new.user_id and o.costs_shared;
    update market.group_observations g set cost = null, margin_pct = null, markup_pct = null
      from market.observations o join market.contributors c on c.key = o.contributor
      where g.observation_id = o.id and c.user_id = new.user_id and o.costs_shared;
    update market.observations o set costs_shared = false, cost_total = null, gross_margin_pct = null, markup_pct = null
      from market.contributors c where o.contributor = c.key and c.user_id = new.user_id and o.costs_shared;
  end if;
  return new;
end $$;
create trigger market_consent_changed after insert or update on public.market_consent
  for each row execute function market.on_consent_change();

-- Bid outcome (accepted/declined/completed) flows into the observations of that estimate.
create or replace function market.on_profile_outcome() returns trigger
language plpgsql security definer set search_path = market, public as $$
begin
  if tg_op = 'INSERT' or new.outcome is distinct from old.outcome then
    update market.observations set status = coalesce(new.outcome, 'quoted') where estimate_id = new.estimate_id;
  end if;
  return new;
end $$;
create trigger estimate_profile_outcome after insert or update on public.estimate_project_profiles
  for each row execute function market.on_profile_outcome();

-- ---------------------------------------------------------------------------
-- Statistics helpers
-- ---------------------------------------------------------------------------
create or replace function market.cfg() returns market.settings
language sql stable security definer set search_path = market, public as $$ select * from market.settings limit 1 $$;

-- Robust summary with minimum-contributor suppression. Values are suppressed (not just hidden in
-- the UI) when fewer than p_min independent contributors are behind them.
create or replace function market.summarize(p_vals numeric[], p_contributors integer, p_min integer)
returns jsonb language sql immutable set search_path = market, public as $$
  with v as (select x from unnest(p_vals) as t (x) where x is not null),
  s as (
    select count(*)::int as n,
      percentile_cont(0.25) within group (order by x) as p25,
      percentile_cont(0.5) within group (order by x) as med,
      percentile_cont(0.75) within group (order by x) as p75,
      avg(x) as mean
    from v
  ),
  m as (select percentile_cont(0.5) within group (order by abs(v.x - s.med)) as mad from v cross join s)
  select case
    when s.n = 0 then jsonb_build_object('n', 0, 'contributors', 0, 'suppressed', true, 'reason', 'no_data')
    when coalesce(p_contributors, 0) < p_min then
      jsonb_build_object('n', s.n, 'contributors', coalesce(p_contributors, 0), 'suppressed', true, 'reason', 'min_contributors')
    else jsonb_build_object(
      'n', s.n, 'contributors', p_contributors, 'suppressed', false,
      'p25', round(s.p25::numeric, 2), 'median', round(s.med::numeric, 2), 'p75', round(s.p75::numeric, 2),
      'mean', round(s.mean, 2), 'mad', round(m.mad::numeric, 2), 'iqr', round((s.p75 - s.p25)::numeric, 2))
  end
  from s cross join m
$$;

-- Ratio between two prices that matches a common unit mix-up (SF vs SY = 9, SF vs square = 100, ...).
create or replace function market.unit_ratio(p_value numeric, p_median numeric, p_tol numeric default 0.12)
returns integer language sql immutable set search_path = market, public as $$
  select f from unnest(array[9, 12, 27, 100, 144]) as f
  where p_value > 0 and p_median > 0
    and abs(greatest(p_value / p_median, p_median / p_value) - f) / f <= p_tol
  limit 1
$$;

-- Observation filter shared by every report. Only the latest version of each estimate, never
-- excluded rows, and never a mix of synthetic and real data.
create or replace function market.f_obs(p jsonb) returns setof market.observations
language sql stable security definer set search_path = market, public as $$
  select o.* from market.observations o
  where o.is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic')
    and o.is_latest and o.excluded_reason is null
    and (p ->> 'date_from' is null or o.quote_date >= (p ->> 'date_from')::date)
    and (p ->> 'date_to' is null or o.quote_date <= (p ->> 'date_to')::date)
    and (p ->> 'state' is null or o.state = p ->> 'state')
    and (p ->> 'metro' is null or o.metro = p ->> 'metro')
    and (p ->> 'trade' is null or o.trade = p ->> 'trade')
    and (p ->> 'project_type' is null or o.project_type = p ->> 'project_type')
    and (p ->> 'work_type' is null or o.work_type = p ->> 'work_type')
    and (p ->> 'sector' is null or o.sector = p ->> 'sector')
    and (p ->> 'complexity' is null or o.complexity = p ->> 'complexity')
    and (coalesce(p ->> 'status', 'all') = 'all'
         or (p ->> 'status' = 'accepted' and o.status in ('accepted', 'completed'))
         or o.status = p ->> 'status')
    and (p ->> 'price_min' is null or o.price_subtotal >= (p ->> 'price_min')::numeric)
    and (p ->> 'price_max' is null or o.price_subtotal <= (p ->> 'price_max')::numeric)
    and (p ->> 'size_min' is null or o.size_value >= (p ->> 'size_min')::numeric)
    and (p ->> 'size_max' is null or o.size_value <= (p ->> 'size_max')::numeric)
    and (p ->> 'material_category' is null or exists (
      select 1 from market.line_observations l where l.observation_id = o.id and l.excluded_reason is null
        and (l.category = p ->> 'material_category' or l.category like (p ->> 'material_category') || '.%')))
    and (p ->> 'brand' is null or exists (
      select 1 from market.line_observations l where l.observation_id = o.id and l.brand = p ->> 'brand'))
    and (p ->> 'material_key' is null or exists (
      select 1 from market.line_observations l where l.observation_id = o.id
        and (l.material_key = p ->> 'material_key' or l.material_key like (p ->> 'material_key') || '.%')))
$$;

-- The project value a report summarizes: customer price (pre-tax by default) or, when asked,
-- internal cost from contributors who shared costs.
create or replace function market.obs_value(o market.observations, p jsonb) returns numeric
language sql immutable set search_path = market, public as $$
  select case coalesce(p ->> 'basis', 'price')
    when 'cost' then case when o.costs_shared then o.cost_total end
    else case when coalesce(p ->> 'tax', 'excluded') = 'included' then o.price_total else o.price_subtotal end
  end
$$;

create or replace function market.monthly(p jsonb, p_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'stats', market.summarize(vals, c, p_min)) order by m), '[]')
  from (
    select date_trunc('month', o.quote_date)::date as m, array_agg(market.obs_value(o, p)) as vals,
      (count(distinct o.contributor) filter (where market.obs_value(o, p) is not null))::int as c
    from market.f_obs(p) o group by 1
  ) x
$$;

-- Trend from the scheduled aggregate when the filter is simple enough, else computed live.
create or replace function market.trend(p jsonb, p_min integer) returns jsonb
language plpgsql stable security definer set search_path = market, public as $$
declare v_simple boolean;
begin
  v_simple := not exists (select 1 from jsonb_object_keys(p) k where k not in ('dataset', 'trade', 'state', 'date_from', 'date_to'));
  if v_simple and exists (select 1 from market.segment_stats where dataset = coalesce(p ->> 'dataset', 'real')) then
    return (
      select coalesce(jsonb_agg(jsonb_build_object('month', s.period, 'stats',
        case when s.contributors < p_min
          then jsonb_build_object('n', s.n, 'contributors', s.contributors, 'suppressed', true, 'reason', 'min_contributors')
          else jsonb_build_object('n', s.n, 'contributors', s.contributors, 'suppressed', false, 'p25', round(s.p25, 2),
            'median', round(s.median, 2), 'p75', round(s.p75, 2), 'mean', round(s.mean, 2), 'mad', round(s.mad, 2)) end
      ) order by s.period), '[]')
      from market.segment_stats s
      where s.dataset = coalesce(p ->> 'dataset', 'real') and s.metric = 'project_price'
        and s.geo_level = case when p ? 'state' then 'state' else 'national' end
        and s.geo_key = coalesce(p ->> 'state', 'US') and s.trade = coalesce(p ->> 'trade', '*')
        and (p ->> 'date_from' is null or s.period >= date_trunc('month', (p ->> 'date_from')::date))
        and (p ->> 'date_to' is null or s.period <= (p ->> 'date_to')::date)
    );
  end if;
  return market.monthly(p, p_min);
end $$;

-- Change between the last 3 months and the 3 before, only when both windows clear suppression.
create or replace function market.trend_indicator(p_trend jsonb) returns jsonb
language sql immutable set search_path = market, public as $$
  with t as (
    select (e ->> 'month')::date as m, e -> 'stats' as s, row_number() over (order by (e ->> 'month')::date desc) as rn
    from jsonb_array_elements(p_trend) e
  ),
  w as (
    select
      percentile_cont(0.5) within group (order by (s ->> 'median')::numeric) filter (where rn <= 3) as recent,
      percentile_cont(0.5) within group (order by (s ->> 'median')::numeric) filter (where rn between 4 and 6) as prior,
      count(*) filter (where rn <= 6 and (s ->> 'suppressed')::boolean) as suppressed_months,
      count(*) filter (where rn <= 6) as months
    from t
  )
  select case when months < 6 or suppressed_months > 0 or prior is null or prior = 0
    then jsonb_build_object('available', false)
    else jsonb_build_object('available', true, 'recent_median', round(recent::numeric, 2), 'prior_median', round(prior::numeric, 2),
      'change_pct', round(((recent - prior) / prior * 100)::numeric, 1)) end
  from w
$$;

-- ---------------------------------------------------------------------------
-- Insert one observation (shared by real capture and synthetic demo seeding)
-- ---------------------------------------------------------------------------
create or replace function market.insert_observation(
  p_contributor uuid, p_estimate_id uuid, p_version_id uuid, p_version_number integer,
  p_synthetic boolean, p_costs boolean, p jsonb, p_captured_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = market, public as $$
declare
  v_obs uuid;
  v_min_conf numeric := (market.cfg()).precise_confidence;
begin
  insert into market.observations (
    contributor, estimate_id, version_id, version_number, is_synthetic, schema_version, captured_at, quote_date, status,
    trade, trades, project_type, work_type, sector, complexity, zip5, zip3, state, metro, state_conflict,
    price_subtotal, tax_amount, price_total, tax_rate, adjustment, costs_shared, cost_total, gross_margin_pct, markup_pct,
    size_value, size_unit, size_source, price_per_unit, measurements, group_count, line_count
  ) values (
    p_contributor, p_estimate_id, p_version_id, p_version_number, p_synthetic, (p ->> 'schema')::int, p_captured_at,
    (p ->> 'quote_date')::date,
    case when p ->> 'status' in ('draft', 'quoted', 'accepted', 'declined', 'completed', 'unknown') then p ->> 'status' else 'quoted' end,
    left(p ->> 'trade', 60), coalesce(array(select left(jsonb_array_elements_text(p -> 'trades'), 60)), '{}'),
    left(p ->> 'project_type', 60), left(p ->> 'work_type', 40), left(p ->> 'sector', 20),
    case when p ->> 'complexity' in ('standard', 'complex') then p ->> 'complexity' end,
    case when p ->> 'zip5' ~ '^\d{5}$' then p ->> 'zip5' end,
    case when p ->> 'zip3' ~ '^\d{3}$' then p ->> 'zip3' end,
    case when char_length(p ->> 'state') = 2 then upper(p ->> 'state') end,
    left(p ->> 'metro', 80), coalesce((p ->> 'state_conflict')::boolean, false),
    (p ->> 'price_subtotal')::numeric, coalesce((p ->> 'tax_amount')::numeric, 0), (p ->> 'price_total')::numeric,
    (p ->> 'tax_rate')::numeric, (p ->> 'adjustment')::numeric,
    p_costs,
    case when p_costs then (p ->> 'cost_total')::numeric end,
    case when p_costs then (p ->> 'gross_margin_pct')::numeric end,
    case when p_costs then (p ->> 'markup_pct')::numeric end,
    nullif((p ->> 'size_value')::numeric, 0), left(p ->> 'size_unit', 20),
    case when p ->> 'size_source' in ('entered', 'inferred') then p ->> 'size_source' end,
    (p ->> 'price_per_unit')::numeric,
    case when jsonb_typeof(p -> 'measurements') = 'object' then p -> 'measurements' else '{}' end,
    coalesce(jsonb_array_length(p -> 'groups'), 0), coalesce(jsonb_array_length(p -> 'lines'), 0)
  )
  on conflict (version_id) do nothing
  returning id into v_obs;
  if v_obs is null then return null; end if;

  insert into market.group_observations (observation_id, idx, name, std_category, price, cost, margin_pct, markup_pct, item_count)
  select v_obs, g.idx, left(coalesce(g.name, ''), 100), left(coalesce(g.std_category, 'unclassified'), 60), g.price,
    case when p_costs then g.cost end, case when p_costs then g.margin_pct end, case when p_costs then g.markup_pct end,
    coalesce(g.item_count, 0)
  from jsonb_to_recordset(coalesce(p -> 'groups', '[]')) as g (idx int, name text, std_category text, price numeric, cost numeric, margin_pct numeric, markup_pct numeric, item_count int);

  insert into market.line_observations (
    observation_id, group_id, fingerprint, original_name, trade, component, material, category, brand, product_line, specs,
    install_type, cost_class, entered_cost_type, material_key, confidence, class_method, class_conflict, treatment, taxable,
    unit_raw, unit_norm, unit_family, qty, qty_norm, unit_price, unit_price_norm, ext_price, unit_cost, unit_cost_norm, markup_pct
  )
  select v_obs, go.id, left(l.fingerprint, 240), left(coalesce(l.original_name, ''), 120), left(l.trade, 60), left(l.component, 40),
    left(l.material, 40), left(coalesce(l.category, 'unclassified'), 80), left(l.brand, 60), left(l.product_line, 60),
    case when jsonb_typeof(l.specs) = 'object' then l.specs else '{}' end,
    left(l.install_type, 20),
    case when l.cost_class in ('labor', 'material', 'equipment', 'subcontractor', 'other') then l.cost_class else 'other' end,
    left(l.entered_cost_type, 20), left(coalesce(l.material_key, 'unclassified'), 200),
    least(greatest(coalesce(l.confidence, 0), 0), 1), 'rule', coalesce(l.class_conflict, false), left(l.treatment, 20), l.taxable,
    left(l.unit_raw, 40), left(coalesce(l.unit_norm, 'each'), 40), left(coalesce(l.unit_family, 'unknown'), 20),
    l.qty, l.qty_norm, l.unit_price, l.unit_price_norm, l.ext_price,
    case when p_costs then l.unit_cost end, case when p_costs then l.unit_cost_norm end, case when p_costs then l.markup_pct end
  from jsonb_to_recordset(coalesce(p -> 'lines', '[]')) as l (
    group_idx int, fingerprint text, original_name text, trade text, component text, material text, category text, brand text,
    product_line text, specs jsonb, install_type text, cost_class text, entered_cost_type text, material_key text, confidence numeric,
    class_conflict boolean, treatment text, taxable boolean, unit_raw text, unit_norm text, unit_family text, qty numeric,
    qty_norm numeric, unit_price numeric, unit_price_norm numeric, ext_price numeric, unit_cost numeric, unit_cost_norm numeric, markup_pct numeric
  )
  left join market.group_observations go on go.observation_id = v_obs and go.idx = l.group_idx
  where l.fingerprint is not null and l.qty is not null and l.unit_price is not null;

  -- Reviewed classifications override the rule output, so admin corrections stick.
  update market.line_observations l set
    component = c.component, material = c.material, category = c.category, brand = c.brand, product_line = c.product_line,
    cost_class = c.cost_class, material_key = c.material_key, confidence = c.confidence, class_method = c.method, class_conflict = false
  from market.classifications c
  where l.observation_id = v_obs and c.fingerprint = l.fingerprint and c.status = 'reviewed';

  -- Register every distinct item text for review. Low-confidence ones are queued.
  insert into market.classifications as c (fingerprint, sample_name, trade, component, material, category, brand, product_line, specs,
    cost_class, material_key, confidence, method, status, observation_count)
  select distinct on (l.fingerprint) l.fingerprint, l.original_name, l.trade, l.component, l.material, l.category, l.brand, l.product_line,
    l.specs, l.cost_class, l.material_key, l.confidence, 'rule',
    case when l.confidence < v_min_conf or l.class_conflict then 'needs_review' else 'auto' end, 1
  from market.line_observations l where l.observation_id = v_obs
  order by l.fingerprint
  on conflict (fingerprint) do update set observation_count = c.observation_count + 1, last_seen_at = now();

  return v_obs;
end $$;

-- ---------------------------------------------------------------------------
-- Capture (server calls this right after record_export creates a finalized version)
-- ---------------------------------------------------------------------------
create or replace function public.market_capture(p_user_id uuid, p_version_id uuid, p_payload jsonb) returns text
language plpgsql security definer set search_path = market, public as $$
declare
  v_enabled boolean;
  v_consent public.market_consent;
  v_version record;
  v_contrib uuid;
  v_obs uuid;
begin
  select f.enabled into v_enabled from public.feature_flags f where f.key = 'market_capture';
  if not coalesce(v_enabled, false) then return 'disabled'; end if;

  select * into v_consent from public.market_consent where user_id = p_user_id;
  if not found or not v_consent.share_prices then return 'no_consent'; end if;

  select v.id, v.estimate_id, v.version_number, v.user_id into v_version from public.estimate_versions v where v.id = p_version_id;
  if not found or v_version.user_id <> p_user_id then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if (p_payload ->> 'schema') is distinct from '1' then
    raise exception 'unsupported_schema' using errcode = '22023';
  end if;
  if exists (select 1 from market.observations where version_id = p_version_id) then return 'duplicate'; end if;

  insert into market.contributors (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select key into v_contrib from market.contributors where user_id = p_user_id;

  v_obs := market.insert_observation(v_contrib, v_version.estimate_id, p_version_id, v_version.version_number, false,
    v_consent.share_costs and coalesce((p_payload ->> 'costs_shared')::boolean, false), p_payload);
  if v_obs is null then return 'duplicate'; end if;

  -- The newest finalized version of the estimate is the one that counts.
  update market.observations o set is_latest = (o.version_number = (
      select max(o2.version_number) from market.observations o2 where o2.estimate_id = v_version.estimate_id))
    where o.estimate_id = v_version.estimate_id;

  -- Keep the outcome the contractor already recorded.
  update market.observations o set status = pp.outcome
    from public.estimate_project_profiles pp
    where o.id = v_obs and pp.estimate_id = v_version.estimate_id and pp.outcome is not null;
  return 'captured';
end $$;
revoke all on function public.market_capture(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anomaly detection (robust z-score with MAD; IQR fences when MAD is zero)
-- ---------------------------------------------------------------------------
create or replace function market.detect_line_anomalies(p_metric text) returns integer
language plpgsql security definer set search_path = market, public as $$
declare s market.settings := market.cfg(); v_rows integer;
begin
  with base as (
    select l.id, l.observation_id, o.contributor, o.is_synthetic, coalesce(o.state, '?') as state,
      l.material_key || ' | ' || l.unit_norm || ' | ' || l.cost_class as peer_key,
      case p_metric when 'unit_price' then l.unit_price_norm else l.unit_cost_norm end as v
    from market.line_observations l join market.observations o on o.id = l.observation_id
    where o.is_latest and o.excluded_reason is null and l.excluded_reason is null
      and l.confidence >= s.precise_confidence and l.unit_family not in ('lump_sum', 'unknown')
      and o.quote_date >= current_date - make_interval(months => s.peer_window_months)
  ),
  b as (select * from base where v > 0),
  peers as (
    select is_synthetic, peer_key, coalesce(state, '*') as lvl_key, grouping(state) as is_national,
      count(*) as n, count(distinct contributor) as c,
      percentile_cont(0.5) within group (order by v) as med,
      percentile_cont(0.25) within group (order by v) as q1,
      percentile_cont(0.75) within group (order by v) as q3
    from b group by grouping sets ((is_synthetic, peer_key, state), (is_synthetic, peer_key))
  ),
  qualified as (select * from peers where n >= s.min_peer_observations and c >= s.min_peer_contributors),
  chosen as (
    -- Prefer the contractor's own state when it has enough peers; otherwise compare nationally.
    select distinct on (b.id) b.*, q.med, q.q1, q.q3, q.n, q.c, case when q.is_national = 1 then 'national' else 'state' end as lvl
    from b join qualified q on q.is_synthetic = b.is_synthetic and q.peer_key = b.peer_key
      and (q.is_national = 1 or q.lvl_key = b.state)
    order by b.id, q.is_national
  ),
  mads as (
    select c1.is_synthetic, c1.peer_key, c1.lvl, c1.state_key,
      percentile_cont(0.5) within group (order by abs(b2.v - c1.med)) as mad
    from (select distinct is_synthetic, peer_key, lvl, case when lvl = 'state' then state else '*' end as state_key, med from chosen) c1
    join b b2 on b2.is_synthetic = c1.is_synthetic and b2.peer_key = c1.peer_key and (c1.lvl = 'national' or b2.state = c1.state_key)
    group by 1, 2, 3, 4
  ),
  scored as (
    -- MAD is floored at 5% of the median so a very tight cluster doesn't turn small differences into "anomalies".
    select c.*, m.mad, case when greatest(m.mad, 0.05 * c.med) > 0 then 0.6745 * (c.v - c.med) / greatest(m.mad, 0.05 * c.med) end as z
    from chosen c join mads m on m.is_synthetic = c.is_synthetic and m.peer_key = c.peer_key and m.lvl = c.lvl
      and m.state_key = case when c.lvl = 'state' then c.state else '*' end
  )
  insert into market.anomalies (observation_id, line_observation_id, is_synthetic, kind, metric, value, peer_key, peer_level,
    peer_median, peer_mad, peer_q1, peer_q3, robust_z, peer_n, peer_contributors, detail)
  select observation_id, id, is_synthetic,
    case when market.unit_ratio(v, med::numeric) is not null then 'unit_conversion' when v > med then 'high_price' else 'low_price' end,
    p_metric, round(v, 4), peer_key, lvl, round(med::numeric, 4), round(mad::numeric, 4), round(q1::numeric, 4), round(q3::numeric, 4),
    round(z::numeric, 2), n, c, jsonb_build_object('unit_ratio', market.unit_ratio(v, med::numeric))
  from scored
  where (z is not null and abs(z) >= s.anomaly_z)
     or (z is null and q3 > q1 and (v > q3 + s.iqr_k * (q3 - q1) or v < q1 - s.iqr_k * (q3 - q1)))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create or replace function market.detect_anomalies() returns jsonb
language plpgsql security definer set search_path = market, public as $$
declare s market.settings := market.cfg(); v_price int; v_cost int; v_ppu int; v_margin int; v_dup int; v_class int;
begin
  -- Re-detect everything that has not been reviewed; reviewed findings keep their decision.
  delete from market.anomalies where review_status = 'open';
  v_price := market.detect_line_anomalies('unit_price');
  v_cost := market.detect_line_anomalies('unit_cost');

  -- Project price per standardized unit, compared within trade + project type + complexity + unit.
  with b as (
    select o.id, o.contributor, o.is_synthetic, o.price_per_unit as v,
      concat_ws(' | ', o.trade, coalesce(o.project_type, 'any type'), coalesce(o.complexity, 'any complexity'), o.size_unit) as peer_key
    from market.observations o
    where o.is_latest and o.excluded_reason is null and o.price_per_unit > 0
      and o.quote_date >= current_date - make_interval(months => s.peer_window_months)
  ),
  p as (
    select is_synthetic, peer_key, count(*) n, count(distinct contributor) c,
      percentile_cont(0.5) within group (order by v) med, percentile_cont(0.25) within group (order by v) q1,
      percentile_cont(0.75) within group (order by v) q3
    from b group by 1, 2
  ),
  m as (select b.is_synthetic, b.peer_key, percentile_cont(0.5) within group (order by abs(b.v - p.med)) mad from b join p using (is_synthetic, peer_key) group by 1, 2),
  sc as (
    select b.*, p.n, p.c, p.med, p.q1, p.q3, m.mad,
      case when greatest(m.mad, 0.05 * p.med) > 0 then 0.6745 * (b.v - p.med) / greatest(m.mad, 0.05 * p.med) end z
    from b join p using (is_synthetic, peer_key) join m using (is_synthetic, peer_key)
    where p.n >= s.min_peer_observations and p.c >= s.min_peer_contributors
  )
  insert into market.anomalies (observation_id, is_synthetic, kind, metric, value, peer_key, peer_level, peer_median, peer_mad, peer_q1, peer_q3, robust_z, peer_n, peer_contributors)
  select id, is_synthetic, case when market.unit_ratio(v, med::numeric) is not null then 'unit_conversion' when v > med then 'high_price' else 'low_price' end,
    'price_per_unit', round(v, 4), peer_key, 'national', round(med::numeric, 4), round(mad::numeric, 4), round(q1::numeric, 4), round(q3::numeric, 4), round(z::numeric, 2), n, c
  from sc where (z is not null and abs(z) >= s.anomaly_z) or (z is null and q3 > q1 and (v > q3 + s.iqr_k * (q3 - q1) or v < q1 - s.iqr_k * (q3 - q1)))
  on conflict do nothing;
  get diagnostics v_ppu = row_count;

  -- Gross margin: outside the trade's peer distribution, negative, or above the configured ceiling.
  with b as (
    select o.id, o.contributor, o.is_synthetic, o.gross_margin_pct as v, coalesce(o.trade, '?') as peer_key
    from market.observations o where o.is_latest and o.excluded_reason is null and o.costs_shared and o.gross_margin_pct is not null
  ),
  -- One value per business (its median margin), so a business with many bids doesn't define "normal".
  pc as (select is_synthetic, peer_key, contributor, percentile_cont(0.5) within group (order by v) as v from b group by 1, 2, 3),
  p as (select is_synthetic, peer_key, (select count(*) from b b2 where b2.is_synthetic = pc.is_synthetic and b2.peer_key = pc.peer_key) n,
          count(*) c, percentile_cont(0.5) within group (order by v) med from pc group by 1, 2),
  m as (select pc.is_synthetic, pc.peer_key, percentile_cont(0.5) within group (order by abs(pc.v - p.med)) mad from pc join p using (is_synthetic, peer_key) group by 1, 2),
  sc as (
    select b.*, p.n, p.c, p.med, m.mad,
      -- MAD floored at 2.5 percentage points.
      case when p.c >= s.min_peer_contributors then 0.6745 * (b.v - p.med) / greatest(m.mad, 2.5) end z
    from b join p using (is_synthetic, peer_key) join m using (is_synthetic, peer_key)
  )
  insert into market.anomalies (observation_id, is_synthetic, kind, metric, value, peer_key, peer_level, peer_median, peer_mad, robust_z, peer_n, peer_contributors, detail)
  select id, is_synthetic, 'unusual_margin', 'gross_margin_pct', v, peer_key, 'national', round(med::numeric, 2), round(mad::numeric, 2), round(z::numeric, 2), n, c,
    jsonb_build_object('rule', case when v < 0 then 'negative_margin' when v >= s.margin_high_pct then 'above_ceiling' else 'robust_z' end)
  from sc where v < 0 or v >= s.margin_high_pct or (z is not null and abs(z) >= s.anomaly_z)
  on conflict do nothing;
  get diagnostics v_margin = row_count;

  -- Suspected duplicates: the same business, trade, price and line count on different estimates within 30 days.
  insert into market.anomalies (observation_id, is_synthetic, kind, metric, value, detail)
  select o2.id, o2.is_synthetic, 'duplicate', 'price_subtotal', o2.price_subtotal,
    jsonb_build_object('matches_captured_at', o1.captured_at, 'days_apart', abs(o2.quote_date - o1.quote_date))
  from market.observations o1
  join market.observations o2 on o2.contributor = o1.contributor and o2.id <> o1.id
    and coalesce(o2.estimate_id, o2.id) <> coalesce(o1.estimate_id, o1.id)
    and o2.trade is not distinct from o1.trade and o2.price_subtotal = o1.price_subtotal and o2.line_count = o1.line_count
    and abs(o2.quote_date - o1.quote_date) <= 30
    and (o1.captured_at, o1.id) < (o2.captured_at, o2.id)
  where o1.is_latest and o2.is_latest and o1.excluded_reason is null and o2.excluded_reason is null
  on conflict do nothing;
  get diagnostics v_dup = row_count;

  -- The item text suggests a different cost class than the contractor chose.
  insert into market.anomalies (observation_id, line_observation_id, is_synthetic, kind, metric, detail)
  select l.observation_id, l.id, o.is_synthetic, 'classification_mismatch', 'cost_class',
    jsonb_build_object('entered', l.entered_cost_type, 'category', l.category, 'material_key', l.material_key)
  from market.line_observations l join market.observations o on o.id = l.observation_id
  where l.class_conflict and o.is_latest
  on conflict do nothing;
  get diagnostics v_class = row_count;

  return jsonb_build_object('unit_price', v_price, 'unit_cost', v_cost, 'price_per_unit', v_ppu, 'margin', v_margin, 'duplicate', v_dup, 'classification', v_class);
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled aggregation + retention
-- ---------------------------------------------------------------------------
create or replace function market.refresh_segment_stats() returns integer
language plpgsql security definer set search_path = market, public as $$
declare v_rows integer;
begin
  delete from market.segment_stats;
  insert into market.segment_stats (dataset, period, geo_level, geo_key, trade, metric, n, contributors, p25, median, p75, mean, mad)
  with base as (
    select case when o.is_synthetic then 'synthetic' else 'real' end as ds, date_trunc('month', o.quote_date)::date as period,
      o.state, o.trade, o.contributor, m.metric, m.v
    from market.observations o
    cross join lateral (values ('project_price', o.price_subtotal), ('price_per_unit', o.price_per_unit)) as m (metric, v)
    where o.is_latest and o.excluded_reason is null and m.v is not null
  ),
  e as (
    select ds, period, 'national' as lvl, 'US' as gk, '*' as tr, metric, contributor, v from base where metric = 'project_price'
    union all select ds, period, 'national', 'US', trade, metric, contributor, v from base where trade is not null
    union all select ds, period, 'state', state, '*', metric, contributor, v from base where state is not null and metric = 'project_price'
    union all select ds, period, 'state', state, trade, metric, contributor, v from base where state is not null and trade is not null
  ),
  a as (
    select ds, period, lvl, gk, tr, metric, count(*)::int as n, count(distinct contributor)::int as c,
      percentile_cont(0.25) within group (order by v) as p25, percentile_cont(0.5) within group (order by v) as med,
      percentile_cont(0.75) within group (order by v) as p75, avg(v) as mean
    from e group by 1, 2, 3, 4, 5, 6
  ),
  md as (
    select e.ds, e.period, e.lvl, e.gk, e.tr, e.metric, percentile_cont(0.5) within group (order by abs(e.v - a.med)) as mad
    from e join a using (ds, period, lvl, gk, tr, metric) group by 1, 2, 3, 4, 5, 6
  )
  select a.ds, a.period, a.lvl, a.gk, a.tr, a.metric, a.n, a.c, a.p25, a.med, a.p75, a.mean, md.mad
  from a join md using (ds, period, lvl, gk, tr, metric);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create or replace function market.purge_expired() returns integer
language plpgsql security definer set search_path = market, public as $$
declare v_rows integer;
begin
  delete from market.observations
    where not is_synthetic and captured_at < now() - make_interval(months => (market.cfg()).retention_months);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- Admin API (service role only; every call checks is_admin and is audited)
-- ---------------------------------------------------------------------------
create or replace function market.require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = market, public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function market.audit(p_caller uuid, p_action text, p_target text, p_details jsonb) returns void
language sql security definer set search_path = market, public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details) values (p_caller, p_action, 'market', p_target, p_details)
$$;

create or replace function market.report_overview(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.*, market.obs_value(o, p) as val from market.f_obs(p) o),
  agg as (
    select count(*)::int as bids, count(distinct contributor)::int as contributors,
      (count(distinct contributor) filter (where val is not null))::int as value_contributors,
      array_agg(val) as vals, sum(val) as volume, count(distinct trade)::int as trades,
      count(distinct state)::int as states, count(distinct metro)::int as metros,
      min(quote_date) as date_from, max(quote_date) as date_to, max(captured_at) as freshest
    from f
  ),
  buckets as (
    select b.label, b.lo, count(f.id)::int as n
    from (values ('Under $5k', 0, 5000), ('$5k to $10k', 5000, 10000), ('$10k to $25k', 10000, 25000), ('$25k to $50k', 25000, 50000),
                 ('$50k to $100k', 50000, 100000), ('$100k to $250k', 100000, 250000), ('$250k and up', 250000, 1e15)) as b (label, lo, hi)
    left join f on f.val >= b.lo and f.val < b.hi
    group by b.label, b.lo
  ),
  t as (select market.trend(p, v_min) as tr)
  select jsonb_build_object(
    'bids', agg.bids, 'contributors', agg.contributors,
    'observations', (select count(*) from market.line_observations l join f on f.id = l.observation_id where l.excluded_reason is null),
    'project_value', market.summarize(agg.vals, agg.value_contributors, v_min),
    'volume', case when agg.value_contributors >= v_min then round(agg.volume, 0) end,
    'trades', agg.trades, 'states', agg.states, 'metros', agg.metros,
    'date_range', jsonb_build_object('from', agg.date_from, 'to', agg.date_to), 'freshest', agg.freshest,
    'distribution', case when agg.value_contributors >= v_min
      then (select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by lo) from buckets) end,
    'trend', t.tr, 'trend_indicator', market.trend_indicator(t.tr),
    'stats_computed_at', (select max(computed_at) from market.segment_stats)
  )
  from agg, t
$$;

create or replace function market.report_trades(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.*, market.obs_value(o, p) as val from market.f_obs(p) o),
  per_trade as (
    select trade, count(*)::int as n,
      market.summarize(array_agg(val), (count(distinct contributor) filter (where val is not null))::int, v_min) as price,
      market.summarize(array_agg(gross_margin_pct) filter (where costs_shared), (count(distinct contributor) filter (where costs_shared and gross_margin_pct is not null))::int, v_min) as margin
    from f where trade is not null group by trade
  ),
  per_unit as (
    select trade, size_unit, coalesce(complexity, 'unspecified') as complexity, coalesce(project_type, 'unspecified') as project_type,
      market.summarize(array_agg(price_per_unit), count(distinct contributor)::int, v_min) as stats
    from f where price_per_unit is not null group by 1, 2, 3, 4
  ),
  groups as (
    select o.trade, g.std_category, count(distinct o.id)::int as bids, count(distinct o.contributor)::int as contributors,
      market.summarize(array_agg(g.price), count(distinct o.contributor)::int, v_min) as price
    from f o join market.group_observations g on g.observation_id = o.id group by 1, 2
  ),
  named_groups as (
    -- Group names are free text: only names used by at least v_min different businesses are shown.
    select o.trade, lower(trim(g.name)) as name, count(distinct o.contributor)::int as contributors, count(*)::int as uses
    from f o join market.group_observations g on g.observation_id = o.id
    where trim(g.name) <> '' group by 1, 2 having count(distinct o.contributor) >= v_min
  )
  select jsonb_build_object(
    'trades', coalesce((select jsonb_agg(jsonb_build_object('trade', trade, 'n', n, 'price', price, 'margin', margin) order by n desc) from per_trade), '[]'),
    'per_unit', coalesce((select jsonb_agg(jsonb_build_object('trade', trade, 'unit', size_unit, 'complexity', complexity, 'project_type', project_type, 'stats', stats) order by trade, complexity) from per_unit), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('trade', trade, 'category', std_category, 'bids', bids, 'contributors', contributors, 'price', price) order by trade, bids desc) from groups), '[]'),
    'named_groups', coalesce((select jsonb_agg(jsonb_build_object('trade', trade, 'name', name, 'contributors', contributors, 'uses', uses) order by trade, uses desc) from named_groups), '[]'),
    'trend', case when p ? 'trade' then market.trend(p, v_min) end
  )
$$;

create or replace function market.report_materials(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.* from market.f_obs(p) o),
  l as (
    select ln.*, f.contributor, f.state, f.quote_date, f.captured_at
    from market.line_observations ln join f on f.id = ln.observation_id
    where ln.excluded_reason is null and ln.cost_class <> 'labor'
      and ln.confidence >= (market.cfg()).precise_confidence
      and ln.unit_family not in ('lump_sum', 'unknown')
      and (p ->> 'q' is null or ln.material_key ilike '%' || replace(lower(p ->> 'q'), ' ', '%') || '%'
           or ln.brand ilike '%' || (p ->> 'q') || '%' or ln.product_line ilike '%' || (p ->> 'q') || '%')
  ),
  keys as (
    select material_key, unit_norm, count(*)::int as n, count(distinct contributor)::int as contributors,
      market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) as price,
      market.summarize(array_agg(unit_cost_norm), (count(distinct contributor) filter (where unit_cost_norm is not null))::int, v_min) as cost,
      max(quote_date) as latest, min(quote_date) as earliest
    from l group by 1, 2 order by count(*) desc limit 60
  ),
  sel as (select * from l where p ->> 'detail_key' is not null and material_key = p ->> 'detail_key' and unit_norm = coalesce(p ->> 'detail_unit', unit_norm))
  select jsonb_build_object(
    'keys', coalesce((select jsonb_agg(to_jsonb(keys) order by n desc) from keys), '[]'),
    'detail', case when p ->> 'detail_key' is null then null else jsonb_build_object(
      'by_state', coalesce((select jsonb_agg(jsonb_build_object('state', state, 'price', s) order by state) from (
        select state, market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s from sel where state is not null group by state) x), '[]'),
      'history', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'price', s) order by m) from (
        select date_trunc('month', quote_date)::date m, market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s from sel group by 1) x), '[]')
    ) end,
    'brands', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'brand', brand, 'product_line', product_line, 'unit', unit_norm, 'price', s) order by category, brand, product_line) from (
        select category, coalesce(brand, '(unbranded)') brand, coalesce(product_line, '(line not stated)') product_line, unit_norm,
          market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s
        from l where p ->> 'material_category' is not null or p ->> 'q' is not null group by 1, 2, 3, 4) x), '[]')
  )
$$;

create or replace function market.report_labor(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.* from market.f_obs(p) o),
  l as (
    select ln.*, f.contributor, f.state, f.quote_date, f.trade as project_trade, f.price_subtotal
    from market.line_observations ln join f on f.id = ln.observation_id
    where ln.excluded_reason is null and ln.cost_class = 'labor'
  ),
  per_project as (
    select observation_id, contributor, project_trade, sum(ext_price) as labor_price, max(price_subtotal) as subtotal from l group by 1, 2, 3
  )
  select jsonb_build_object(
    'rates', coalesce((select jsonb_agg(jsonb_build_object('trade', project_trade, 'unit', unit_norm, 'stats', s) order by project_trade, unit_norm) from (
      select project_trade, unit_norm, market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s
      from l where unit_family not in ('lump_sum', 'unknown') group by 1, 2) x), '[]'),
    'hourly_by_state', coalesce((select jsonb_agg(jsonb_build_object('state', state, 'stats', s) order by state) from (
      select state, market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s
      from l where unit_norm = 'hour' and state is not null group by 1) x), '[]'),
    'hourly_trend', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'stats', s) order by m) from (
      select date_trunc('month', quote_date)::date m, market.summarize(array_agg(unit_price_norm), count(distinct contributor)::int, v_min) s
      from l where unit_norm = 'hour' group by 1) x), '[]'),
    'project_labor', coalesce((select jsonb_agg(jsonb_build_object('trade', project_trade, 'labor_price', lp, 'labor_share_pct', ls) order by project_trade) from (
      select project_trade,
        market.summarize(array_agg(labor_price), count(distinct contributor)::int, v_min) lp,
        market.summarize(array_agg(round(labor_price / nullif(subtotal, 0) * 100, 2)), count(distinct contributor)::int, v_min) ls
      from per_project group by 1) x), '[]'),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('key', material_key, 'unit', unit_norm, 'bids', bids, 'contributors', c, 'stats', s) order by bids desc) from (
      select material_key, unit_norm, count(distinct observation_id)::int bids, count(distinct contributor)::int c,
        market.summarize(array_agg(ext_price), count(distinct contributor)::int, v_min) s
      from l group by 1, 2 order by 3 desc limit 25) x), '[]')
  )
$$;

create or replace function market.report_geo(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.*, market.obs_value(o, p) as val from market.f_obs(p) o),
  lvl as (select coalesce(p ->> 'level', 'state') as level, (market.cfg()).zip_min_contributors as zmin),
  keyed as (
    select f.*, case lvl.level when 'national' then 'US' when 'metro' then f.metro when 'zip3' then f.zip3 when 'zip5' then f.zip5 else f.state end as k
    from f, lvl
  ),
  g as (
    select k, count(*)::int as n, (count(distinct contributor) filter (where val is not null))::int as c, array_agg(val) as vals,
      array_agg(price_per_unit) filter (where price_per_unit is not null) as ppu,
      (count(distinct contributor) filter (where price_per_unit is not null))::int as ppu_c
    from keyed where k is not null group by k
  )
  select jsonb_build_object(
    'level', (select level from lvl),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'n', n, 'contributors', c,
        'price', market.summarize(vals, c, case when (select level from lvl) in ('zip3', 'zip5') then greatest(v_min, (select zmin from lvl)) else v_min end),
        'per_unit', case when p ? 'trade' then market.summarize(ppu, ppu_c, v_min) end) order by n desc)
      -- ZIP-level rows are listed only when they clear the threshold; the rest are counted, never named.
      from g where (select level from lvl) not in ('zip3', 'zip5') or c >= greatest(v_min, (select zmin from lvl))), '[]'),
    'suppressed_segments', (select count(*) from g where c < v_min),
    'unmapped', (select count(*) from keyed where k is null),
    'trend', market.trend(p, v_min)
  )
$$;

create or replace function market.report_quality(p jsonb, v_min integer) returns jsonb
language sql stable security definer set search_path = market, public as $$
  with f as (select o.* from market.f_obs(p) o),
  l as (select ln.* from market.line_observations ln join f on f.id = ln.observation_id),
  conf as (select width_bucket(confidence, 0, 1.0001, 5) as b, count(*)::int as n from l group by 1),
  by_trade as (select trade, count(distinct contributor)::int as c from f group by 1),
  by_state as (select state, count(distinct contributor)::int as c from f where state is not null group by 1)
  select jsonb_build_object(
    'bids', (select count(*) from f), 'contributors', (select count(distinct contributor) from f),
    'lines', (select count(*) from l),
    'usable_precise_lines', (select count(*) from l where confidence >= (market.cfg()).precise_confidence and excluded_reason is null and unit_family not in ('lump_sum', 'unknown')),
    'unclassified_lines', (select count(*) from l where category = 'unclassified'),
    'review_queue', (select count(*) from market.classifications where status = 'needs_review'),
    'confidence_histogram', coalesce((select jsonb_agg(jsonb_build_object('bucket', b, 'n', n) order by b) from conf), '[]'),
    'missing_work_type', (select count(*) from f where work_type is null),
    'missing_project_type', (select count(*) from f where project_type is null),
    'missing_size', (select count(*) from f where size_value is null),
    'inferred_size', (select count(*) from f where size_source = 'inferred'),
    'missing_location', (select count(*) from f where state is null),
    'state_conflicts', (select count(*) from f where state_conflict),
    'costs_shared_bids', (select count(*) from f where costs_shared),
    'excluded', jsonb_build_object(
      'observations', (select count(*) from market.observations where excluded_reason is not null and is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic')),
      'lines', (select count(*) from market.line_observations ln join market.observations o on o.id = ln.observation_id where ln.excluded_reason is not null and o.is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic'))),
    'superseded_versions', (select count(*) from market.observations where not is_latest and is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic')),
    'freshness', jsonb_build_object('latest_capture', (select max(captured_at) from f), 'last_90_days', (select count(*) from f where captured_at > now() - interval '90 days')),
    'trades_meeting_threshold', (select count(*) from by_trade where c >= v_min), 'trades_below_threshold', (select count(*) from by_trade where c < v_min),
    'states_meeting_threshold', (select count(*) from by_state where c >= v_min), 'states_below_threshold', (select count(*) from by_state where c < v_min),
    'min_contributors', v_min,
    'last_refresh', (select to_jsonb(r) from (select started_at, finished_at, result from market.refresh_runs order by id desc limit 1) r)
  )
$$;

create or replace function public.market_report(p_caller uuid, p_view text, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = market, public as $$
declare v_min integer := (market.cfg()).min_contributors; p jsonb := coalesce(p_filters, '{}'); result jsonb;
begin
  perform market.require_admin(p_caller);
  -- Drop empty filter values so "no filter" is never confused with "match empty string".
  select coalesce(jsonb_object_agg(key, value), '{}') into p from jsonb_each(p) where value not in ('null'::jsonb, '""'::jsonb);
  result := case p_view
    when 'overview' then market.report_overview(p, v_min)
    when 'trades' then market.report_trades(p, v_min)
    when 'materials' then market.report_materials(p, v_min)
    when 'labor' then market.report_labor(p, v_min)
    when 'geo' then market.report_geo(p, v_min)
    when 'quality' then market.report_quality(p, v_min)
    else null end;
  if result is null then raise exception 'unknown_view' using errcode = '22023'; end if;
  return result || jsonb_build_object('coverage', (
    select jsonb_build_object('bids', count(*), 'contributors', count(distinct contributor), 'date_from', min(quote_date),
      'date_to', max(quote_date), 'freshest', max(captured_at)) from market.f_obs(p)
  )) || jsonb_build_object('meta', jsonb_build_object(
    'view', p_view, 'filters', p, 'dataset', coalesce(p ->> 'dataset', 'real'), 'min_contributors', v_min,
    'precise_confidence', (market.cfg()).precise_confidence, 'generated_at', now()));
end $$;

-- Not STABLE (writes an audit row), so it is a separate entry point the dashboard calls once per page view.
create or replace function public.market_log_view(p_caller uuid, p_view text, p_filters jsonb default '{}') returns void
language plpgsql security definer set search_path = market, public as $$
begin
  perform market.require_admin(p_caller);
  perform market.audit(p_caller, 'market.view', p_view, jsonb_build_object('filters', p_filters));
end $$;

create or replace function public.market_anomalies(p_caller uuid, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = market, public as $$
declare p jsonb := coalesce(p_filters, '{}');
begin
  perform market.require_admin(p_caller);
  return jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(kind, n) from (
      select a.kind, count(*) n from market.anomalies a
      where a.is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic') and a.review_status = coalesce(p ->> 'review_status', 'open') group by 1) x), '{}'),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.abs_z desc nulls last, x.detected_at desc) from (
      select a.id, a.kind, a.metric, a.value, a.peer_key, a.peer_level, a.peer_median, a.peer_mad, a.peer_q1, a.peer_q3, a.robust_z,
        abs(a.robust_z) as abs_z, a.peer_n, a.peer_contributors, a.detail, a.detected_at, a.review_status, a.review_note,
        o.trade, o.state, o.metro, o.quote_date, o.project_type, o.complexity, o.size_value, o.size_unit, o.price_subtotal,
        -- Pseudonymous: lets an admin see that two findings share a contributor without revealing who.
        left(md5(o.contributor::text), 8) as contributor_ref,
        l.original_name, l.material_key, l.unit_raw, l.unit_norm, l.qty, l.unit_price, l.confidence
      from market.anomalies a
      join market.observations o on o.id = a.observation_id
      left join market.line_observations l on l.id = a.line_observation_id
      where a.is_synthetic = (coalesce(p ->> 'dataset', 'real') = 'synthetic')
        and a.review_status = coalesce(p ->> 'review_status', 'open')
        and (p ->> 'kind' is null or a.kind = p ->> 'kind')
        and (p ->> 'trade' is null or o.trade = p ->> 'trade')
      order by abs(a.robust_z) desc nulls last, a.detected_at desc
      limit 200) x), '[]'));
end $$;

create or replace function public.market_review_anomaly(p_caller uuid, p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = market, public as $$
declare a market.anomalies; v_exclude text;
begin
  perform market.require_admin(p_caller);
  update market.anomalies set review_status = p_status, review_note = left(p_note, 1000), reviewed_by = p_caller, reviewed_at = now()
    where id = p_id returning * into a;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Confirmed entry/unit errors are excluded from statistics; any other decision keeps the data in.
  v_exclude := case when p_status in ('data_entry_error', 'unit_conversion_error') then p_status end;
  if a.line_observation_id is not null then
    update market.line_observations set excluded_reason = v_exclude where id = a.line_observation_id;
  else
    update market.observations set excluded_reason = v_exclude where id = a.observation_id;
  end if;
  perform market.audit(p_caller, 'market.anomaly.review', p_id::text, jsonb_build_object('status', p_status, 'kind', a.kind));
end $$;

create or replace function public.market_classifications(p_caller uuid, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = market, public as $$
declare p jsonb := coalesce(p_filters, '{}');
begin
  perform market.require_admin(p_caller);
  return jsonb_build_object(
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from market.classifications group by 1) x),
    'items', coalesce((select jsonb_agg(to_jsonb(c) order by c.observation_count desc, c.fingerprint) from (
      select fingerprint, sample_name, trade, component, material, category, brand, product_line, specs, cost_class, material_key,
        confidence, method, status, observation_count, last_seen_at, reviewed_at
      from market.classifications
      where (p ->> 'status' is null or status = p ->> 'status')
        and (p ->> 'q' is null or sample_name ilike '%' || (p ->> 'q') || '%' or material_key ilike '%' || (p ->> 'q') || '%')
      order by observation_count desc, fingerprint limit 200) c), '[]'));
end $$;

-- Correct one classification (also used to split a fingerprint away from a shared key).
create or replace function public.market_update_classification(p_caller uuid, p_fingerprint text, p_patch jsonb) returns void
language plpgsql security definer set search_path = market, public as $$
declare c market.classifications;
begin
  perform market.require_admin(p_caller);
  update market.classifications set
    component = coalesce(nullif(p_patch ->> 'component', ''), component),
    material = case when p_patch ? 'material' then nullif(p_patch ->> 'material', '') else material end,
    category = coalesce(nullif(p_patch ->> 'category', ''), category),
    brand = case when p_patch ? 'brand' then nullif(p_patch ->> 'brand', '') else brand end,
    product_line = case when p_patch ? 'product_line' then nullif(p_patch ->> 'product_line', '') else product_line end,
    cost_class = case when p_patch ->> 'cost_class' in ('labor', 'material', 'equipment', 'subcontractor', 'other') then p_patch ->> 'cost_class' else cost_class end,
    material_key = coalesce(nullif(left(p_patch ->> 'material_key', 200), ''), material_key),
    confidence = 1, method = 'admin', status = 'reviewed', reviewed_by = p_caller, reviewed_at = now()
  where fingerprint = p_fingerprint returning * into c;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update market.line_observations l set component = c.component, material = c.material, category = c.category, brand = c.brand,
    product_line = c.product_line, cost_class = c.cost_class, material_key = c.material_key, confidence = 1, class_method = 'admin', class_conflict = false
  where l.fingerprint = c.fingerprint;
  perform market.audit(p_caller, 'market.classification.update', left(p_fingerprint, 200), p_patch);
end $$;

-- Merge several item texts under one comparison key (only after confirming they price alike).
create or replace function public.market_merge_classifications(p_caller uuid, p_fingerprints text[], p_material_key text, p_category text) returns integer
language plpgsql security definer set search_path = market, public as $$
declare v_rows integer;
begin
  perform market.require_admin(p_caller);
  if coalesce(trim(p_material_key), '') = '' or coalesce(trim(p_category), '') = '' then raise exception 'key_required' using errcode = '22023'; end if;
  update market.classifications set material_key = left(p_material_key, 200), category = left(p_category, 80), confidence = 1,
    method = 'admin', status = 'reviewed', reviewed_by = p_caller, reviewed_at = now()
  where fingerprint = any (p_fingerprints);
  get diagnostics v_rows = row_count;
  update market.line_observations set material_key = left(p_material_key, 200), category = left(p_category, 80), confidence = 1, class_method = 'admin'
    where fingerprint = any (p_fingerprints);
  perform market.audit(p_caller, 'market.classification.merge', left(p_material_key, 200), jsonb_build_object('fingerprints', to_jsonb(p_fingerprints)));
  return v_rows;
end $$;

create or replace function public.market_refresh(p_caller uuid) returns jsonb
language plpgsql security definer set search_path = market, public as $$
declare v_run bigint; v_result jsonb;
begin
  perform market.require_admin(p_caller);
  insert into market.refresh_runs (actor_id) values (p_caller) returning id into v_run;
  v_result := jsonb_build_object('purged', market.purge_expired(), 'anomalies', market.detect_anomalies(), 'segments', market.refresh_segment_stats());
  update market.refresh_runs set finished_at = now(), result = v_result where id = v_run;
  perform market.audit(p_caller, 'market.refresh', v_run::text, v_result);
  return v_result;
end $$;

create or replace function public.market_settings(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = market, public as $$
begin
  perform market.require_admin(p_caller);
  return to_jsonb(market.cfg());
end $$;

create or replace function public.market_update_settings(p_caller uuid, p jsonb) returns void
language plpgsql security definer set search_path = market, public as $$
begin
  perform market.require_admin(p_caller);
  update market.settings set
    min_contributors = coalesce((p ->> 'min_contributors')::int, min_contributors),
    zip_min_contributors = coalesce((p ->> 'zip_min_contributors')::int, zip_min_contributors),
    precise_confidence = coalesce((p ->> 'precise_confidence')::numeric, precise_confidence),
    anomaly_z = coalesce((p ->> 'anomaly_z')::numeric, anomaly_z),
    iqr_k = coalesce((p ->> 'iqr_k')::numeric, iqr_k),
    min_peer_observations = coalesce((p ->> 'min_peer_observations')::int, min_peer_observations),
    min_peer_contributors = coalesce((p ->> 'min_peer_contributors')::int, min_peer_contributors),
    peer_window_months = coalesce((p ->> 'peer_window_months')::int, peer_window_months),
    margin_high_pct = coalesce((p ->> 'margin_high_pct')::numeric, margin_high_pct),
    retention_months = coalesce((p ->> 'retention_months')::int, retention_months),
    updated_at = now(), updated_by = p_caller;
  perform market.audit(p_caller, 'market.settings.update', 'settings', p);
end $$;

-- Synthetic demo data: clearly flagged, never mixed with real data, removable in one call.
create or replace function public.market_seed_synthetic(p_caller uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = market, public as $$
declare r jsonb; v_keys uuid[] := '{}'; v_key uuid; v_idx int; v_count int := 0; i int;
begin
  perform market.require_admin(p_caller);
  for i in 1 .. coalesce((select max((x ->> 'contributor')::int) from jsonb_array_elements(p_rows) x), 0) + 1 loop
    insert into market.contributors (is_synthetic) values (true) returning key into v_key;
    v_keys := v_keys || v_key;
  end loop;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := (r ->> 'contributor')::int + 1;
    if market.insert_observation(v_keys[v_idx], null, null, null, true, coalesce((r -> 'payload' ->> 'costs_shared')::boolean, false),
         r -> 'payload', coalesce((r ->> 'captured_at')::timestamptz, now())) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  perform market.audit(p_caller, 'market.synthetic.seed', 'synthetic', jsonb_build_object('observations', v_count));
  return v_count;
end $$;

create or replace function public.market_clear_synthetic(p_caller uuid) returns integer
language plpgsql security definer set search_path = market, public as $$
declare v_rows integer;
begin
  perform market.require_admin(p_caller);
  delete from market.contributors where is_synthetic; -- cascades to synthetic observations
  get diagnostics v_rows = row_count;
  delete from market.segment_stats where dataset = 'synthetic';
  delete from market.classifications c where not exists (select 1 from market.line_observations l where l.fingerprint = c.fingerprint);
  perform market.audit(p_caller, 'market.synthetic.clear', 'synthetic', jsonb_build_object('contributors', v_rows));
  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing here is callable from the browser.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema market from public;
do $$ begin
  execute 'revoke all on all functions in schema market from anon, authenticated';
exception when undefined_object then null; end $$;
revoke all on function public.market_report(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.market_log_view(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.market_anomalies(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.market_review_anomaly(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.market_classifications(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.market_update_classification(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.market_merge_classifications(uuid, text[], text, text) from public, anon, authenticated;
revoke all on function public.market_refresh(uuid) from public, anon, authenticated;
revoke all on function public.market_settings(uuid) from public, anon, authenticated;
revoke all on function public.market_update_settings(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.market_seed_synthetic(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.market_clear_synthetic(uuid) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.market_capture(uuid, uuid, jsonb), public.market_report(uuid, text, jsonb), public.market_log_view(uuid, text, jsonb),
    public.market_anomalies(uuid, jsonb), public.market_review_anomaly(uuid, bigint, text, text), public.market_classifications(uuid, jsonb),
    public.market_update_classification(uuid, text, jsonb), public.market_merge_classifications(uuid, text[], text, text), public.market_refresh(uuid),
    public.market_settings(uuid), public.market_update_settings(uuid, jsonb), public.market_seed_synthetic(uuid, jsonb), public.market_clear_synthetic(uuid)
    to service_role';
exception when undefined_object then null; end $$;

-- Optional: nightly refresh with pg_cron (enable the extension in the Supabase dashboard first):
--   select cron.schedule('market-refresh', '17 7 * * *', $$ select market.purge_expired(); select market.detect_anomalies(); select market.refresh_segment_stats(); $$);
