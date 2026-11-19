-- V6.8 / V6.8.1 Industry Intelligence: shared article metadata, per-user preferences and state,
-- company defaults, ingestion health. Free for every account.
--
-- Rights: rows hold permitted metadata only (headline, publisher, original link, original publication
-- date, a short publisher description) and, where the source's rights allow it, a short original
-- summary. Never full article text. Platform rules (which sources, what may be summarized) live in
-- src/lib/news/sources.ts, not here, so no database edit can loosen them.
--
-- Writes to articles, sources and runs are service-role only (the ingestion job). Readers get
-- published rows through RLS; preferences and saved/hidden/read state are private to each user.
-- Idempotent: safe to run twice.

-- 1. Articles (shared by everyone; ingested once per source, personalized at query time) -------------
-- array_to_string is only STABLE, so generated columns need an immutable wrapper (text arrays have no locale-dependent output).
create or replace function public.news_join(arr text[]) returns text language sql immutable parallel safe as $$ select coalesce(array_to_string(arr, ' '), '') $$;

create table if not exists public.news_articles (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null check (char_length(source_key) <= 60),
  url              text not null check (char_length(url) <= 1000 and url ~ '^https://'),
  url_key          text not null unique check (char_length(url_key) <= 1000),
  url_host         text not null check (char_length(url_host) <= 200),
  fingerprint      text not null default '' check (char_length(fingerprint) <= 400),
  headline         text not null check (char_length(headline) between 1 and 300),
  publisher        text not null check (char_length(publisher) <= 200),
  published_at     timestamptz not null,
  date_precision   text not null default 'time' check (date_precision in ('day', 'time')),
  first_seen_at    timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  categories       text[] not null default '{}' check (cardinality(categories) <= 8),
  trades           text[] not null default '{}' check (cardinality(trades) <= 12),
  trade_terms      jsonb not null default '{}'::jsonb check (pg_column_size(trade_terms) <= 4096),
  geo_level        text not null check (geo_level in ('local', 'state', 'regional', 'national')),
  states           text[] not null default '{}' check (cardinality(states) <= 10),
  counties         text[] not null default '{}' check (cardinality(counties) <= 400),
  places           text[] not null default '{}' check (cardinality(places) <= 400),
  regions          text[] not null default '{}' check (cardinality(regions) <= 5),
  article_type     text not null check (article_type in ('final_rule', 'proposed_rule', 'notice', 'enforcement', 'disaster_declaration', 'news', 'analysis', 'product', 'discussion')),
  authority        text not null check (authority in ('official', 'industry', 'local_news', 'community')),
  snippet          text check (char_length(snippet) <= 2100),   -- press: trimmed publisher description (~300 chars); official: agency abstract
  summary          text check (char_length(summary) <= 1000),
  summary_status   text not null default 'none' check (summary_status in ('generated', 'structured', 'not_permitted', 'insufficient_text', 'rejected', 'pending', 'none')),
  summary_model    text check (char_length(summary_model) <= 80),
  effective_on     date,
  jurisdiction     text check (char_length(jurisdiction) <= 200),
  image_url        text check (image_url is null or (char_length(image_url) <= 1000 and image_url ~ '^https://')),
  verified         boolean not null default true,
  status           text not null default 'published' check (status in ('published', 'hidden', 'excluded')),
  expires_at       timestamptz not null,
  search           tsvector generated always as (
                     setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
                     setweight(to_tsvector('english', coalesce(publisher, '') || ' ' || public.news_join(trades) || ' ' || public.news_join(states)), 'B') ||
                     setweight(to_tsvector('english', coalesce(snippet, '') || ' ' || coalesce(summary, '')), 'C')) stored
);
create index if not exists news_articles_published_idx on public.news_articles (published_at desc) where status = 'published';
create index if not exists news_articles_trades_idx on public.news_articles using gin (trades);
create index if not exists news_articles_states_idx on public.news_articles using gin (states);
create index if not exists news_articles_search_idx on public.news_articles using gin (search);
create index if not exists news_articles_fingerprint_idx on public.news_articles (fingerprint, published_at);
create index if not exists news_articles_source_idx on public.news_articles (source_key, published_at desc);
create index if not exists news_articles_summary_pending_idx on public.news_articles (first_seen_at) where summary_status = 'pending';
create index if not exists news_articles_expires_idx on public.news_articles (expires_at);

alter table public.news_articles enable row level security;
revoke all on public.news_articles from anon, authenticated;
grant select on public.news_articles to authenticated;
drop policy if exists news_articles_read on public.news_articles;
create policy news_articles_read on public.news_articles for select to authenticated using (status = 'published');

-- 2. Source operational state (owner controls; the rules themselves stay in code) ------------------------
create table if not exists public.news_source_state (
  source_key           text primary key check (char_length(source_key) <= 60),
  enabled              boolean not null default true,
  excluded             boolean not null default false,            -- low quality: hide its items everywhere
  trades_override      text[] check (trades_override is null or cardinality(trades_override) <= 40),
  categories_override  text[] check (categories_override is null or cardinality(categories_override) <= 8),
  geo_override         text check (geo_override in ('local', 'state', 'regional', 'national')),
  note                 text check (char_length(note) <= 500),
  last_run_at          timestamptz,
  last_ok_at           timestamptz,
  last_error           text check (char_length(last_error) <= 500),
  last_error_at        timestamptz,
  consecutive_failures integer not null default 0,
  etag                 text check (char_length(etag) <= 300),
  last_modified        text check (char_length(last_modified) <= 100),
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);
alter table public.news_source_state enable row level security;
revoke all on public.news_source_state from anon, authenticated;

-- 3. Ingestion runs (health, volume and cost) -----------------------------------------------------------
create table if not exists public.news_ingest_runs (
  id            bigint generated always as identity primary key,
  source_key    text not null check (char_length(source_key) <= 60),
  phase         text not null default 'fetch' check (phase in ('fetch', 'summarize', 'purge')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'not_modified', 'skipped', 'failed')),
  http_status   integer,
  bytes         integer not null default 0,
  fetched       integer not null default 0,
  inserted      integer not null default 0,
  updated       integer not null default 0,
  duplicates    integer not null default 0,
  rejected      integer not null default 0,
  reject_reasons jsonb not null default '{}'::jsonb check (pg_column_size(reject_reasons) <= 2048),
  ai_summaries  integer not null default 0,
  ai_rejected   integer not null default 0,
  ai_cost_usd   numeric(12, 6) not null default 0 check (ai_cost_usd >= 0),
  api_cost_usd  numeric(12, 6) not null default 0 check (api_cost_usd >= 0),   -- free feeds: always 0 unless a paid API is approved
  error         text check (char_length(error) <= 500)
);
create index if not exists news_ingest_runs_source_idx on public.news_ingest_runs (source_key, started_at desc);
create index if not exists news_ingest_runs_time_idx on public.news_ingest_runs (started_at desc);
alter table public.news_ingest_runs enable row level security;
revoke all on public.news_ingest_runs from anon, authenticated;

-- 4. Per-user preferences (company defaults apply until a user saves their own) ----------------------------
create table if not exists public.news_user_prefs (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  followed_trades   text[] not null default '{}' check (cardinality(followed_trades) <= 12),
  radius_miles      integer not null default 50 check (radius_miles in (25, 50, 100, 250)),
  geo_emphasis      text not null default 'balanced' check (geo_emphasis in ('balanced', 'local', 'state', 'national')),
  topics            text[] not null default '{}' check (cardinality(topics) <= 14),
  muted_topics      text[] not null default '{}' check (cardinality(muted_topics) <= 14),
  source_types      text[] not null default '{}' check (cardinality(source_types) <= 4),
  hidden_publishers text[] not null default '{}' check (cardinality(hidden_publishers) <= 50),
  service_counties  text[] not null default '{}' check (cardinality(service_counties) <= 20),
  -- Opt-in only, all off by default. Stored preferences; nothing is emailed until the owner approves a digest.
  notify_official_rules  boolean not null default false,
  notify_local_disasters boolean not null default false,
  notify_material_prices boolean not null default false,
  email_digest           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists news_user_prefs_updated on public.news_user_prefs;
create trigger news_user_prefs_updated before update on public.news_user_prefs for each row execute function public.set_updated_at();
alter table public.news_user_prefs enable row level security;
revoke all on public.news_user_prefs from anon;
grant select, insert, update, delete on public.news_user_prefs to authenticated;
drop policy if exists news_user_prefs_own on public.news_user_prefs;
create policy news_user_prefs_own on public.news_user_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 5. Company defaults (Enterprise): readable by members, saved by owners/managers --------------------------
create table if not exists public.news_company_defaults (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  followed_trades text[] not null default '{}' check (cardinality(followed_trades) <= 12),
  topics          text[] not null default '{}' check (cardinality(topics) <= 14),
  muted_topics    text[] not null default '{}' check (cardinality(muted_topics) <= 14),
  geo_emphasis    text not null default 'balanced' check (geo_emphasis in ('balanced', 'local', 'state', 'national')),
  radius_miles    integer not null default 50 check (radius_miles in (25, 50, 100, 250)),
  service_counties text[] not null default '{}' check (cardinality(service_counties) <= 20),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.news_company_defaults enable row level security;
revoke all on public.news_company_defaults from anon, authenticated;
grant select on public.news_company_defaults to authenticated;
drop policy if exists news_company_defaults_read on public.news_company_defaults;
create policy news_company_defaults_read on public.news_company_defaults for select to authenticated
  using (public.is_active_company_member(company_id));

create or replace function public.news_company_defaults_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
  arr text[];
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.news_company_defaults as d (company_id, followed_trades, topics, muted_topics, geo_emphasis, radius_miles, service_counties, updated_by, updated_at)
  values (v_company,
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'followedTrades', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'topics', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'mutedTopics', '[]'::jsonb))), '{}'),
    coalesce(nullif(p ->> 'geoEmphasis', ''), 'balanced'),
    coalesce((p ->> 'radiusMiles')::integer, 50),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'serviceCounties', '[]'::jsonb))), '{}'),
    auth.uid(), now())
  on conflict (company_id) do update set followed_trades = excluded.followed_trades, topics = excluded.topics, muted_topics = excluded.muted_topics,
    geo_emphasis = excluded.geo_emphasis, radius_miles = excluded.radius_miles, service_counties = excluded.service_counties,
    updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke execute on function public.news_company_defaults_save(jsonb) from public, anon;
grant execute on function public.news_company_defaults_save(jsonb) to authenticated;

-- 6. Per-user article state: saved / hidden / read / clicked -----------------------------------------------
create table if not exists public.news_user_articles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.news_articles (id) on delete cascade,
  saved      boolean not null default false,
  hidden     boolean not null default false,
  saved_at   timestamptz,
  read_at    timestamptz,
  clicked_at timestamptz,
  clicks     integer not null default 0 check (clicks >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create index if not exists news_user_articles_article_idx on public.news_user_articles (article_id);
create index if not exists news_user_articles_saved_idx on public.news_user_articles (user_id) where saved;
alter table public.news_user_articles enable row level security;
revoke all on public.news_user_articles from anon;
grant select, insert, update, delete on public.news_user_articles to authenticated;
drop policy if exists news_user_articles_own on public.news_user_articles;
create policy news_user_articles_own on public.news_user_articles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 7. Search (Universal Search integration). Articles are public, non-tenant metadata; a definer
-- function lets the GIN index work (the @@ operator isn't leakproof under RLS) and returns
-- published rows only. It never touches company records.
create or replace function public.news_search(p_q text, p_limit integer default 5, p_trades text[] default null)
returns table (id uuid, headline text, publisher text, url text, published_at timestamptz, date_precision text, trades text[], states text[],
               geo_level text, authority text, categories text[], article_type text, rank real)
language sql stable security definer set search_path = public as $$
  with q as (select websearch_to_tsquery('english', left(coalesce(p_q, ''), 100)) as tsq)
  select a.id, a.headline, a.publisher, a.url, a.published_at, a.date_precision, a.trades, a.states, a.geo_level, a.authority, a.categories, a.article_type,
         ts_rank(a.search, q.tsq) + case when p_trades is not null and a.trades && p_trades then 0.3 else 0 end as rank
  from public.news_articles a, q
  where auth.uid() is not null and a.status = 'published' and q.tsq <> ''::tsquery and a.search @@ q.tsq
    and not exists (select 1 from public.news_source_state s where s.source_key = a.source_key and s.excluded)
  order by rank desc, a.published_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.news_search(text, integer, text[]) from public, anon;
grant execute on function public.news_search(text, integer, text[]) to authenticated;

-- 8. Retention: delete metadata past each source's retention window (called by the ingestion job).
create or replace function public.news_purge_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.news_articles where expires_at < now();
  get diagnostics n = row_count;
  delete from public.news_ingest_runs where started_at < now() - interval '180 days';
  return n;
end $$;
revoke execute on function public.news_purge_expired() from public, anon, authenticated;
grant execute on function public.news_purge_expired() to service_role;
