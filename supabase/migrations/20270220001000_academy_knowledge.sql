-- ============================================================================
-- Contractor Academy: construction knowledge engine (codes, regulations, study tools).
--
-- One shared, source-grounded knowledge layer behind code search, lessons, flashcards, quizzes, practice exams and
-- future estimate integrations (docs/academy/expansion/README.md). Additive only: no existing table, column or
-- policy is changed except two new academy_settings columns and one new ai_generations kind.
--
--   Geography      academy_kb_jurisdictions (US + 50 states + DC seeded; counties/cities added as verified)
--   Sources        academy_kb_families, academy_kb_sources (publication + edition + usage rights + status)
--   Adoption       academy_kb_adoptions (which jurisdiction enforces which edition, from when, with what scope)
--   Content        academy_kb_sections (citable units: full text only where rights allow, else excerpt/summary/title)
--   Provenance     academy_kb_verifications (every check, its evidence and content hash), academy_kb_documents
--   Workflow       academy_kb_review_queue, academy_kb_feedback (user correction reports)
--   Search aids    academy_kb_terms (approved terminology dictionary), academy_kb_search_stats (aggregate, no user id),
--                  academy_kb_answer_cache (AI explanations keyed to the exact sections they cite)
--   Learning       academy_kb_items (flashcards + quiz questions), academy_kb_exams, academy_kb_attempts,
--                  academy_kb_item_progress, academy_kb_paths, academy_kb_path_progress
--
-- Rules enforced here, not only in the app:
--   * "verified" can only be set inside academy_kb_verify(), which writes a verification record with evidence.
--     A direct UPDATE to verified (even by the service role) is rejected by trigger.
--   * Full text is stored only for sources whose rights allow it (public domain / government edict). Licensed or
--     link-only sources may hold titles, citations, short approved excerpts and summaries.
--   * When a source, adoption or section stops being current, dependent flashcards/questions are flagged, cached
--     AI answers are invalidated and a review-queue item is opened. Nothing is overwritten.
--   * Like the rest of the Academy, anon/authenticated get no INSERT/UPDATE/DELETE on these tables. Staff writes use
--     the service role after requireAcademyStaff(); learner writes go through SECURITY DEFINER functions.
--
-- Off by default: academy_settings.kb_enabled = false (staff always see it). Rollback:
-- docs/academy/rollback_20270220001000.sql (tested in tests/db/academy-knowledge.test.ts).
-- ============================================================================

alter table public.academy_settings add column if not exists kb_enabled boolean not null default false;
alter table public.academy_settings add column if not exists kb_ai_explain boolean not null default false;
alter table public.academy_settings add column if not exists kb_ai_daily_cap integer not null default 200;
do $$ begin
  alter table public.academy_settings add constraint academy_settings_kb_ai_daily_cap_check check (kb_ai_daily_cap between 0 and 5000);
exception when duplicate_object then null; end $$;

-- Content status shared by sources, adoptions and sections.
-- draft: staff only. pending_review: shown with "Source Review Needed". verified: documented verification on file.
-- superseded: kept for history, never shown as current. source_unavailable: official source could not be reached.
-- archived/rejected: hidden.
create or replace function public.academy_kb_status_ok(p text) returns boolean language sql immutable set search_path = public as $$
  select p in ('draft', 'pending_review', 'verified', 'superseded', 'source_unavailable', 'archived', 'rejected')
$$;

-- ---------------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_jurisdictions (
  id text primary key check (id ~ '^(US|[A-Z]{2})(:[a-z0-9-]{2,60})*$'),
  level text not null check (level in ('federal', 'state', 'county', 'municipal', 'other')),
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  parent_id text references public.academy_kb_jurisdictions (id),
  name text not null check (char_length(name) between 2 and 120),
  coverage text not null default 'awaiting_verification' check (coverage in ('awaiting_verification', 'partial', 'verified')),
  building_dept_url text check (building_dept_url is null or building_dept_url ~ '^https://'),
  notes text check (char_length(notes) <= 2000),
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((level = 'federal') = (state_code is null))
);
create index if not exists academy_kb_jurisdictions_state on public.academy_kb_jurisdictions (state_code, level);

-- ---------------------------------------------------------------------------
-- Code families and sources (publication + edition)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_families (
  slug text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  short_name text not null,
  kind text not null check (kind in ('model_code', 'standard', 'state_code', 'state_rule', 'state_statute', 'federal_regulation', 'local_ordinance', 'licensing')),
  publisher text,
  about text check (char_length(about) <= 1000),
  sort_order integer not null default 0
);

create table if not exists public.academy_kb_sources (
  id uuid primary key default gen_random_uuid(),
  family_slug text not null references public.academy_kb_families (slug),
  title text not null check (char_length(title) between 3 and 200),
  short_title text not null check (char_length(short_title) between 2 and 60),
  edition text not null check (char_length(edition) between 1 and 40),
  edition_year integer check (edition_year between 1900 and 2100),
  publisher text not null check (char_length(publisher) <= 160),
  -- Issuing jurisdiction for state/local/federal law; null for national model codes and standards.
  jurisdiction_id text references public.academy_kb_jurisdictions (id),
  official_url text check (official_url is null or official_url ~ '^https://'),
  -- A free, lawful place to read the text when Built2Bid can't host it (e.g. a publisher's free read-only view).
  read_url text check (read_url is null or read_url ~ '^https://'),
  rights text not null check (rights in ('public_domain', 'government_edict', 'licensed', 'free_read_only', 'metadata_only')),
  fulltext_allowed boolean not null default false,
  excerpt_allowed boolean not null default false,
  rights_note text not null check (char_length(rights_note) between 10 and 1000),
  pagination_note text check (char_length(pagination_note) <= 300),
  status text not null default 'draft' check (public.academy_kb_status_ok(status)),
  supersedes_id uuid references public.academy_kb_sources (id),
  published_on date,
  check_url text check (check_url is null or check_url ~ '^https://'),
  content_hash text,
  last_verified_at timestamptz,
  last_checked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Full text needs a rights basis that allows it.
  check (not fulltext_allowed or rights in ('public_domain', 'government_edict'))
);
create unique index if not exists academy_kb_sources_edition on public.academy_kb_sources (family_slug, short_title, edition, coalesce(jurisdiction_id, '-'));
create index if not exists academy_kb_sources_status on public.academy_kb_sources (status);

-- ---------------------------------------------------------------------------
-- Adoptions: which jurisdiction enforces which source edition
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_adoptions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id text not null references public.academy_kb_jurisdictions (id),
  source_id uuid not null references public.academy_kb_sources (id),
  -- adopts: enforces the source; amends: changes parts of it; replaces: the jurisdiction substitutes its own rules
  -- for this family (e.g. an OSHA-approved State Plan); administers: the source is the jurisdiction's own law.
  kind text not null default 'adopts' check (kind in ('adopts', 'amends', 'replaces', 'administers')),
  -- For kind = 'replaces': the code family whose federal/model text the jurisdiction's own program governs instead.
  replaces_family text references public.academy_kb_families (slug),
  scope_note text check (char_length(scope_note) <= 2000),
  authority_citation text not null check (char_length(authority_citation) between 3 and 200),
  official_url text not null check (official_url ~ '^https://'),
  effective_date date,
  expiration_date date,
  -- Whether the adopting text itself shows the rule applies everywhere in the jurisdiction. When true, results
  -- still need the user to confirm the local permitting authority (a ZIP code never settles that).
  local_confirmation_required boolean not null default true,
  trades text[] not null default '{}',
  status text not null default 'draft' check (public.academy_kb_status_ok(status)),
  last_verified_at timestamptz,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiration_date is null or effective_date is null or expiration_date > effective_date),
  check ((kind = 'replaces') = (replaces_family is not null))
);
create index if not exists academy_kb_adoptions_lookup on public.academy_kb_adoptions (jurisdiction_id, status);
create index if not exists academy_kb_adoptions_source on public.academy_kb_adoptions (source_id);

-- array_to_string() is only STABLE; generated columns need an IMMUTABLE expression.
create or replace function public.academy_kb_arr_text(p text[]) returns text language sql immutable parallel safe set search_path = public as $$
  select coalesce(array_to_string(p, ' '), '')
$$;

-- ---------------------------------------------------------------------------
-- Sections: the citable units search, lessons and study tools share
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_sections (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.academy_kb_sources (id) on delete cascade,
  section_number text not null check (char_length(section_number) between 1 and 60),
  citation text not null check (char_length(citation) between 3 and 200),
  title text not null check (char_length(title) between 2 and 300),
  heading_path text check (char_length(heading_path) <= 400),
  kind text not null default 'requirement' check (kind in ('requirement', 'definition', 'amendment', 'administrative', 'scope', 'title_only')),
  -- full_text only when the source allows it (enforced by trigger); title_only rows carry no requirement text.
  body_kind text not null check (body_kind in ('full_text', 'excerpt', 'summary', 'title_only')),
  body text check (char_length(body) <= 20000),
  -- Plain-language explanation written or reviewed by staff (never a substitute for the cited text).
  summary text check (char_length(summary) <= 2000),
  exceptions text check (char_length(exceptions) <= 4000),
  -- Page in the referenced edition, only when verified for that exact format. Null = no page (online regulation)
  -- or not verified. Never estimated.
  page text check (page is null or char_length(page) <= 20),
  amends_source_id uuid references public.academy_kb_sources (id),
  amends_section text check (char_length(amends_section) <= 60),
  amend_action text check (amend_action in ('amended', 'deleted', 'replaced', 'added')),
  trades text[] not null default '{}',
  topics text[] not null default '{}',
  effective_date date,
  official_url text check (official_url is null or official_url ~ '^https://'),
  status text not null default 'draft' check (public.academy_kb_status_ok(status)),
  last_verified_at timestamptz,
  content_hash text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(section_number, '') || ' ' || coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', public.academy_kb_arr_text(topics) || ' ' || coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '') || ' ' || coalesce(exceptions, '')), 'C')
  ) stored,
  unique (source_id, section_number),
  check ((body_kind = 'title_only') = (body is null)),
  check (amend_action is null or amends_section is not null)
);
create index if not exists academy_kb_sections_tsv on public.academy_kb_sections using gin (search_tsv);
create index if not exists academy_kb_sections_trades on public.academy_kb_sections using gin (trades);
create index if not exists academy_kb_sections_topics on public.academy_kb_sections using gin (topics);
create index if not exists academy_kb_sections_number on public.academy_kb_sections (lower(section_number));
create index if not exists academy_kb_sections_amends on public.academy_kb_sections (amends_source_id, lower(amends_section)) where amends_section is not null;

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_verifications (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('source', 'adoption', 'section', 'jurisdiction', 'document', 'item', 'exam')),
  target_id text not null,
  checked_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  -- official_text: the claim was read in the official publication. url_check / hash_check: automated monitoring.
  -- manual_review: an Academy admin reviewed and approved. research: staff research with a recorded official URL.
  method text not null check (method in ('official_text', 'url_check', 'hash_check', 'manual_review', 'research')),
  result text not null check (result in ('verified', 'unchanged', 'changed', 'unreachable', 'rejected', 'superseded')),
  change_kind text check (change_kind in ('new_publication', 'new_adoption', 'local_amendment', 'effective_date_change', 'administrative_correction', 'superseded_edition', 'unchanged', 'unknown')),
  source_url text check (source_url is null or source_url ~ '^https://'),
  http_status integer,
  content_hash text,
  evidence text check (char_length(evidence) <= 4000),
  notes text check (char_length(notes) <= 2000)
);
create index if not exists academy_kb_verifications_target on public.academy_kb_verifications (target_type, target_id, checked_at desc);

create table if not exists public.academy_kb_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.academy_kb_sources (id) on delete set null,
  title text not null check (char_length(title) between 3 and 200),
  kind text not null check (kind in ('pdf', 'url')),
  storage_path text,
  url text check (url is null or url ~ '^https://'),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint check (bytes is null or bytes between 1 and 104857600),
  -- Required: why Built2Bid may hold this (public domain, government edict, written licence, ...).
  rights_basis text not null check (char_length(rights_basis) between 10 and 1000),
  rights_confirmed_by uuid references auth.users (id) on delete set null,
  status text not null default 'uploaded' check (status in ('uploaded', 'extracting', 'review', 'approved', 'rejected', 'archived')),
  extracted_count integer not null default 0,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'pdf') = (storage_path is not null)),
  check (kind <> 'url' or url is not null)
);
-- Duplicate uploads are refused (no repeated indexing or token spend).
create unique index if not exists academy_kb_documents_sha on public.academy_kb_documents (sha256) where sha256 is not null;
create unique index if not exists academy_kb_documents_url on public.academy_kb_documents (url) where kind = 'url';

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_review_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('source_change', 'new_document', 'user_feedback', 'stale_content', 'scheduled_review', 'coverage_gap')),
  title text not null check (char_length(title) between 3 and 200),
  detail text check (char_length(detail) <= 4000),
  target_type text,
  target_id text,
  affected jsonb not null default '{}',
  priority integer not null default 3 check (priority between 1 and 5),
  status text not null default 'open' check (status in ('open', 'in_review', 'approved', 'rejected', 'deferred', 'done')),
  dedupe_key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 2000)
);
create unique index if not exists academy_kb_review_open_dedupe on public.academy_kb_review_queue (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null;
create index if not exists academy_kb_review_status on public.academy_kb_review_queue (status, priority, created_at);

create table if not exists public.academy_kb_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  target_type text not null check (target_type in ('section', 'lesson', 'answer', 'item', 'search')),
  target_id text not null check (char_length(target_id) <= 120),
  reason text not null check (reason in ('incorrect_requirement', 'outdated_code', 'wrong_jurisdiction', 'broken_citation', 'unclear_explanation', 'missing_local_amendment')),
  note text check (char_length(note) <= 1000),
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 2000)
);
create index if not exists academy_kb_feedback_status on public.academy_kb_feedback (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Search aids
-- ---------------------------------------------------------------------------
-- Approved terminology: everyday words -> topics used on sections. Never asserts that two requirements are the same.
create table if not exists public.academy_kb_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique check (term ~ '^[a-z0-9 /&.-]{2,60}$'),
  synonyms text[] not null default '{}',
  topics text[] not null default '{}',
  related text[] not null default '{}',
  trades text[] not null default '{}',
  note text check (char_length(note) <= 500),
  status text not null default 'approved' check (status in ('approved', 'draft'))
);

-- Aggregate search trends only: no user id, no IP, no session. Queries are normalized and truncated.
create table if not exists public.academy_kb_search_stats (
  day date not null default current_date,
  query_norm text not null check (char_length(query_norm) between 1 and 120),
  state_code text not null default '',
  trade text not null default '',
  answered boolean not null,
  n integer not null default 1,
  primary key (day, query_norm, state_code, trade, answered)
);

create table if not exists public.academy_kb_answer_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  question_norm text not null check (char_length(question_norm) <= 300),
  jurisdiction_id text,
  trade text,
  section_ids uuid[] not null,
  answer jsonb not null,
  model text,
  cost_usd numeric(10, 6) not null default 0,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz
);
create index if not exists academy_kb_answer_cache_sections on public.academy_kb_answer_cache using gin (section_ids);

-- ---------------------------------------------------------------------------
-- Learning: flashcards, questions, exams, progress, paths
-- ---------------------------------------------------------------------------
create table if not exists public.academy_kb_items (
  id uuid primary key default gen_random_uuid(),
  key text unique check (key ~ '^[a-z0-9-]{3,80}$'),
  kind text not null check (kind in ('flashcard', 'question')),
  deck text not null check (deck ~ '^[a-z0-9-]{2,60}$'),
  trades text[] not null default '{}',
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  prompt text not null check (char_length(prompt) between 5 and 1000),
  answer text not null check (char_length(answer) between 1 and 2000),
  options text[] check (options is null or cardinality(options) between 2 and 6),
  correct integer,
  explanation text check (char_length(explanation) <= 2000),
  section_id uuid references public.academy_kb_sections (id) on delete set null,
  citation text check (char_length(citation) <= 200),
  -- regulatory: states a requirement, so it must cite a section; concept: definitions/navigation/business basics.
  basis text not null default 'concept' check (basis in ('regulatory', 'concept')),
  origin text not null default 'original' check (origin in ('original', 'ai_reviewed', 'official_sample')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  needs_review boolean not null default false,
  exam_tags text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'question') = (options is not null and correct is not null)),
  check (correct is null or (correct >= 0 and correct < cardinality(options))),
  check (basis <> 'regulatory' or section_id is not null)
);
create index if not exists academy_kb_items_deck on public.academy_kb_items (deck, kind, status);
create index if not exists academy_kb_items_section on public.academy_kb_items (section_id) where section_id is not null;
create unique index if not exists academy_kb_items_dedupe on public.academy_kb_items (kind, md5(lower(prompt)));

create table if not exists public.academy_kb_exams (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,80}$'),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) <= 1000),
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  license_kind text not null check (license_kind in ('general', 'residential', 'trade', 'safety', 'business_law', 'navigation')),
  trades text[] not null default '{}',
  decks text[] not null,
  default_count integer not null default 25 check (default_count between 5 and 100),
  minutes integer check (minutes between 5 and 480),
  -- Only open_book/closed_book when verified from the official exam provider (book_policy_source_url).
  book_policy text not null default 'unverified' check (book_policy in ('open_book', 'closed_book', 'unverified')),
  book_policy_source_url text check (book_policy_source_url is null or book_policy_source_url ~ '^https://'),
  official_info_url text check (official_info_url is null or official_info_url ~ '^https://'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  check (book_policy = 'unverified' or book_policy_source_url is not null)
);

create table if not exists public.academy_kb_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('flashcards', 'quiz', 'exam', 'five_minute')),
  exam_slug text references public.academy_kb_exams (slug) on delete set null,
  filters jsonb not null default '{}',
  item_ids uuid[] not null check (cardinality(item_ids) between 1 and 100),
  answers jsonb not null default '{}',
  position integer not null default 0,
  correct integer not null default 0,
  timed boolean not null default false,
  time_limit_seconds integer,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists academy_kb_attempts_user on public.academy_kb_attempts (user_id, started_at desc);

create table if not exists public.academy_kb_item_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.academy_kb_items (id) on delete cascade,
  box integer not null default 1 check (box between 1 and 5),
  right_count integer not null default 0,
  wrong_count integer not null default 0,
  last_correct boolean,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.academy_kb_paths (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) <= 600),
  audience text not null check (char_length(audience) <= 200),
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0
);

create table if not exists public.academy_kb_path_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  path_slug text not null references public.academy_kb_paths (slug) on delete cascade,
  step_key text not null check (step_key ~ '^[a-z0-9-]{2,60}$'),
  done_at timestamptz not null default now(),
  primary key (user_id, path_slug, step_key)
);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create or replace function public.academy_kb_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['academy_kb_jurisdictions', 'academy_kb_sources', 'academy_kb_adoptions', 'academy_kb_sections', 'academy_kb_documents', 'academy_kb_items', 'academy_kb_exams', 'academy_kb_attempts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.academy_kb_touch()', t || '_touch', t);
  end loop;
end $$;

-- "verified" only through academy_kb_verify() (which records evidence) or a migration run as the owner role.
create or replace function public.academy_kb_verified_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified')
     and coalesce(current_setting('academy.kb_verifying', true), '') <> 'on' then
    raise exception 'verify_via_rpc: use academy_kb_verify() so the verification is recorded' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['academy_kb_sources', 'academy_kb_adoptions', 'academy_kb_sections'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_verified_guard', t);
    execute format('create trigger %I before insert or update of status on public.%I for each row execute function public.academy_kb_verified_guard()', t || '_verified_guard', t);
  end loop;
end $$;

-- Full text only where the source's rights allow it; excerpts only where excerpts are allowed.
create or replace function public.academy_kb_section_rights() returns trigger language plpgsql set search_path = public as $$
declare s public.academy_kb_sources;
begin
  select * into s from public.academy_kb_sources where id = new.source_id;
  if new.body_kind = 'full_text' and not s.fulltext_allowed then
    raise exception 'rights_fulltext: % does not allow storing full text', s.short_title using errcode = 'P0001';
  end if;
  if new.body_kind = 'excerpt' and not (s.excerpt_allowed or s.fulltext_allowed) then
    raise exception 'rights_excerpt: % does not allow storing excerpts', s.short_title using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists academy_kb_sections_rights on public.academy_kb_sections;
create trigger academy_kb_sections_rights before insert or update of body_kind, body, source_id on public.academy_kb_sections
  for each row execute function public.academy_kb_section_rights();

-- A documents row can only reach "approved" with a rights confirmer on file.
create or replace function public.academy_kb_document_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'approved' and new.rights_confirmed_by is null then
    raise exception 'rights_unconfirmed: an Academy admin must confirm usage rights first' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists academy_kb_documents_guard on public.academy_kb_documents;
create trigger academy_kb_documents_guard before insert or update on public.academy_kb_documents
  for each row execute function public.academy_kb_document_guard();

-- When cited material stops being current or its text changes: flag dependents, invalidate cached answers, queue.
create or replace function public.academy_kb_invalidate(p_section_ids uuid[], p_reason text, p_target_type text, p_target_id text) returns void
language plpgsql security definer set search_path = public as $$
declare n_items integer; n_cache integer;
begin
  if p_section_ids is null or cardinality(p_section_ids) = 0 then return; end if;
  update public.academy_kb_items set needs_review = true where section_id = any (p_section_ids) and not needs_review;
  get diagnostics n_items = row_count;
  update public.academy_kb_answer_cache set invalidated_at = now() where invalidated_at is null and section_ids && p_section_ids;
  get diagnostics n_cache = row_count;
  insert into public.academy_kb_review_queue (kind, title, detail, target_type, target_id, affected, priority, dedupe_key)
  values ('stale_content', left('Review content that cites a changed ' || p_target_type, 200), p_reason, p_target_type, p_target_id,
          jsonb_build_object('sections', to_jsonb(p_section_ids), 'items_flagged', n_items, 'answers_invalidated', n_cache), 2,
          'stale:' || p_target_type || ':' || p_target_id)
  on conflict (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null do update
    set affected = public.academy_kb_review_queue.affected || excluded.affected, detail = excluded.detail;
end $$;
revoke execute on function public.academy_kb_invalidate(uuid[], text, text, text) from public, anon, authenticated;

create or replace function public.academy_kb_after_change() returns trigger language plpgsql security definer set search_path = public as $$
declare ids uuid[]; was_current boolean; now_current boolean;
begin
  was_current := old.status in ('verified', 'pending_review');
  now_current := new.status in ('verified', 'pending_review');
  if tg_table_name = 'academy_kb_sections' then
    if (was_current and not now_current) or new.body is distinct from old.body or new.section_number is distinct from old.section_number
       or new.exceptions is distinct from old.exceptions then
      perform public.academy_kb_invalidate(array[new.id], 'Section ' || new.citation || ' changed (' || old.status || ' -> ' || new.status || ').', 'section', new.id::text);
    end if;
  elsif tg_table_name = 'academy_kb_sources' then
    if (was_current and not now_current) or new.edition is distinct from old.edition then
      select array_agg(id) into ids from public.academy_kb_sections where source_id = new.id or amends_source_id = new.id;
      perform public.academy_kb_invalidate(ids, 'Source ' || new.short_title || ' ' || new.edition || ' changed (' || old.status || ' -> ' || new.status || ').', 'source', new.id::text);
    end if;
  elsif tg_table_name = 'academy_kb_adoptions' then
    if (was_current and not now_current) or new.effective_date is distinct from old.effective_date or new.expiration_date is distinct from old.expiration_date
       or new.source_id is distinct from old.source_id then
      select array_agg(id) into ids from public.academy_kb_sections where source_id in (old.source_id, new.source_id) or amends_source_id in (old.source_id, new.source_id);
      perform public.academy_kb_invalidate(ids, 'Adoption ' || new.authority_citation || ' changed.', 'adoption', new.id::text);
    end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['academy_kb_sources', 'academy_kb_adoptions', 'academy_kb_sections'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_after_change', t);
    execute format('create trigger %I after update on public.%I for each row execute function public.academy_kb_after_change()', t || '_after_change', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.academy_kb_editor(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.academy_has_role(array['admin', 'instructor'], p_user_id)
$$;

-- True for the service role (server jobs) and direct database sessions (migrations); false for any signed-in or
-- anonymous API caller. Used by functions that both admins and server jobs may call.
create or replace function public.academy_kb_is_service() returns boolean language sql stable set search_path = public as $$
  select auth.uid() is null and coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''), '') in ('service_role', '')
$$;

-- Visible to learners: current or historical material. Body text of a section only once verified, except
-- title-only rows (which state no requirement) that may show while "Source Review Needed".
create or replace function public.academy_kb_public_status(p_status text) returns boolean language sql immutable set search_path = public as $$
  select p_status in ('verified', 'pending_review', 'superseded', 'source_unavailable')
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.academy_kb_jurisdictions enable row level security;
alter table public.academy_kb_families enable row level security;
alter table public.academy_kb_sources enable row level security;
alter table public.academy_kb_adoptions enable row level security;
alter table public.academy_kb_sections enable row level security;
alter table public.academy_kb_verifications enable row level security;
alter table public.academy_kb_documents enable row level security;
alter table public.academy_kb_review_queue enable row level security;
alter table public.academy_kb_feedback enable row level security;
alter table public.academy_kb_terms enable row level security;
alter table public.academy_kb_search_stats enable row level security;
alter table public.academy_kb_answer_cache enable row level security;
alter table public.academy_kb_items enable row level security;
alter table public.academy_kb_exams enable row level security;
alter table public.academy_kb_attempts enable row level security;
alter table public.academy_kb_item_progress enable row level security;
alter table public.academy_kb_paths enable row level security;
alter table public.academy_kb_path_progress enable row level security;

drop policy if exists academy_kb_jurisdictions_read on public.academy_kb_jurisdictions;
create policy academy_kb_jurisdictions_read on public.academy_kb_jurisdictions for select to anon, authenticated using (active or public.academy_kb_editor());
drop policy if exists academy_kb_families_read on public.academy_kb_families;
create policy academy_kb_families_read on public.academy_kb_families for select to anon, authenticated using (true);
drop policy if exists academy_kb_sources_read on public.academy_kb_sources;
create policy academy_kb_sources_read on public.academy_kb_sources for select to anon, authenticated using (public.academy_kb_public_status(status) or public.academy_kb_editor());
drop policy if exists academy_kb_adoptions_read on public.academy_kb_adoptions;
create policy academy_kb_adoptions_read on public.academy_kb_adoptions for select to anon, authenticated using (public.academy_kb_public_status(status) or public.academy_kb_editor());
drop policy if exists academy_kb_sections_read on public.academy_kb_sections;
create policy academy_kb_sections_read on public.academy_kb_sections for select to anon, authenticated
  using (status in ('verified', 'superseded') or (status = 'pending_review' and body_kind = 'title_only') or public.academy_kb_editor());
drop policy if exists academy_kb_verifications_read on public.academy_kb_verifications;
-- Staff read the full trail; learners get dates, method, result and URL through academy_kb_trail().
create policy academy_kb_verifications_read on public.academy_kb_verifications for select to authenticated using (public.academy_kb_editor());
drop policy if exists academy_kb_documents_read on public.academy_kb_documents;
create policy academy_kb_documents_read on public.academy_kb_documents for select to authenticated using (public.academy_kb_editor());
drop policy if exists academy_kb_review_read on public.academy_kb_review_queue;
create policy academy_kb_review_read on public.academy_kb_review_queue for select to authenticated using (public.academy_kb_editor());
drop policy if exists academy_kb_feedback_read on public.academy_kb_feedback;
create policy academy_kb_feedback_read on public.academy_kb_feedback for select to authenticated using (user_id = auth.uid() or public.academy_kb_editor());
drop policy if exists academy_kb_terms_read on public.academy_kb_terms;
create policy academy_kb_terms_read on public.academy_kb_terms for select to anon, authenticated using (status = 'approved' or public.academy_kb_editor());
drop policy if exists academy_kb_search_stats_read on public.academy_kb_search_stats;
create policy academy_kb_search_stats_read on public.academy_kb_search_stats for select to authenticated using (public.academy_kb_editor());
-- answer cache: service role only (no policy for anon/authenticated).
drop policy if exists academy_kb_items_read on public.academy_kb_items;
create policy academy_kb_items_read on public.academy_kb_items for select to anon, authenticated using ((status = 'approved' and not needs_review) or public.academy_kb_editor());
drop policy if exists academy_kb_exams_read on public.academy_kb_exams;
create policy academy_kb_exams_read on public.academy_kb_exams for select to anon, authenticated using (status = 'published' or public.academy_kb_editor());
drop policy if exists academy_kb_attempts_read on public.academy_kb_attempts;
create policy academy_kb_attempts_read on public.academy_kb_attempts for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_kb_item_progress_read on public.academy_kb_item_progress;
create policy academy_kb_item_progress_read on public.academy_kb_item_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_kb_paths_read on public.academy_kb_paths;
create policy academy_kb_paths_read on public.academy_kb_paths for select to anon, authenticated using (status = 'published' or public.academy_kb_editor());
drop policy if exists academy_kb_path_progress_read on public.academy_kb_path_progress;
create policy academy_kb_path_progress_read on public.academy_kb_path_progress for select to authenticated using (user_id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['academy_kb_jurisdictions', 'academy_kb_families', 'academy_kb_sources', 'academy_kb_adoptions', 'academy_kb_sections',
    'academy_kb_verifications', 'academy_kb_documents', 'academy_kb_review_queue', 'academy_kb_feedback', 'academy_kb_terms', 'academy_kb_search_stats',
    'academy_kb_answer_cache', 'academy_kb_items', 'academy_kb_exams', 'academy_kb_attempts', 'academy_kb_item_progress', 'academy_kb_paths', 'academy_kb_path_progress'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke select on public.academy_kb_answer_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Applicability: documented status, never a model's confidence score
-- ---------------------------------------------------------------------------
-- Returns { status, reason, adoption_id, authority, effective_date, jurisdiction_id } where status is one of:
--   verified_applicable              verified section + verified current adoption that needs no further local step
--   jurisdiction_confirmation_needed verified at state level, but local adoption/amendment must be confirmed
--   source_review_needed             material exists but its text, edition or adoption isn't verified (or not yet effective)
--   not_adopted                      verified: this jurisdiction enforces a different edition of this code family
--   superseded                       an older edition that is no longer in force here
--   unavailable                      no supporting material for this jurisdiction
create or replace function public.academy_kb_applicability(p_section_id uuid, p_state text default null, p_local text default null, p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sec public.academy_kb_sections; src public.academy_kb_sources; base public.academy_kb_sources; a public.academy_kb_adoptions;
  fam text; other_edition text; replaced public.academy_kb_adoptions; state text := upper(nullif(btrim(p_state), ''));
  loc text := nullif(btrim(p_local), '');
begin
  select * into sec from public.academy_kb_sections where id = p_section_id;
  if not found then return jsonb_build_object('status', 'unavailable', 'reason', 'not_found'); end if;
  select * into src from public.academy_kb_sources where id = sec.source_id;
  if loc is not null and (state is null or split_part(loc, ':', 1) <> state) then loc := null; end if;

  if sec.status in ('archived', 'rejected', 'draft') or src.status in ('archived', 'rejected', 'draft') then
    return jsonb_build_object('status', 'unavailable', 'reason', 'not_published');
  end if;
  if src.status = 'source_unavailable' or sec.status = 'source_unavailable' then
    return jsonb_build_object('status', 'source_review_needed', 'reason', 'official_source_unreachable');
  end if;

  -- A source issued by another state never applies to this state.
  if state is not null and src.jurisdiction_id is not null and src.jurisdiction_id <> 'US' and split_part(src.jurisdiction_id, ':', 1) <> state then
    return jsonb_build_object('status', 'unavailable', 'reason', 'other_jurisdiction', 'jurisdiction_id', src.jurisdiction_id);
  end if;

  -- Amendments: applicability follows the amending source's own adoption (it is the jurisdiction's law).
  base := src;
  fam := src.family_slug;

  -- Most specific current adoption of this exact source: local, then state, then federal.
  select * into a from public.academy_kb_adoptions x
   where x.source_id = src.id and x.kind in ('adopts', 'amends', 'administers') and x.status in ('verified', 'pending_review')
     and x.jurisdiction_id in (coalesce(loc, '-'), coalesce(state, '-'), 'US')
     and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
   order by (x.status = 'verified') desc,
            case when x.jurisdiction_id = loc then 0 when x.jurisdiction_id = state then 1 else 2 end
   limit 1;

  if not found then
    -- Future adoption on file?
    if exists (select 1 from public.academy_kb_adoptions x where x.source_id = src.id and x.status in ('verified', 'pending_review')
               and x.jurisdiction_id in (coalesce(loc, '-'), coalesce(state, '-'), 'US') and x.effective_date > p_on) then
      return jsonb_build_object('status', 'source_review_needed', 'reason', 'not_yet_effective');
    end if;
    if state is null then
      return jsonb_build_object('status', 'jurisdiction_confirmation_needed', 'reason', 'no_location');
    end if;
    -- Does this state enforce a different edition of the same family (verified)?
    select s2.edition into other_edition from public.academy_kb_adoptions x join public.academy_kb_sources s2 on s2.id = x.source_id
     where s2.family_slug = fam and s2.id <> src.id and x.jurisdiction_id = state and x.status = 'verified' and x.kind in ('adopts', 'administers')
       and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
     order by x.effective_date desc nulls last limit 1;
    if other_edition is not null then
      return jsonb_build_object('status', case when src.status = 'superseded' then 'superseded' else 'not_adopted' end,
                                'reason', 'state_enforces_other_edition', 'other_edition', other_edition);
    end if;
    if src.status = 'superseded' then return jsonb_build_object('status', 'superseded', 'reason', 'superseded'); end if;
    return jsonb_build_object('status', 'source_review_needed', 'reason', 'adoption_not_verified');
  end if;

  -- Federal rules: a verified State Plan (or other replacement) for this family means the state's rules govern.
  if a.jurisdiction_id = 'US' and state is not null then
    select x.* into replaced from public.academy_kb_adoptions x
     where x.kind = 'replaces' and x.jurisdiction_id = state and x.replaces_family = fam and x.status in ('verified', 'pending_review')
       and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
     limit 1;
    if found then
      return jsonb_build_object('status', 'source_review_needed', 'reason', 'state_plan', 'authority', replaced.authority_citation, 'official_url', replaced.official_url,
                                'adoption_id', a.id);
    end if;
  end if;

  if sec.status <> 'verified' or src.status not in ('verified', 'superseded') or a.status <> 'verified' then
    return jsonb_build_object('status', 'source_review_needed', 'reason', case when sec.status <> 'verified' then 'section_not_verified' when a.status <> 'verified' then 'adoption_not_verified' else 'source_not_verified' end,
                              'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id);
  end if;

  if a.jurisdiction_id = coalesce(loc, '-') or not a.local_confirmation_required then
    return jsonb_build_object('status', 'verified_applicable', 'reason', 'verified', 'adoption_id', a.id, 'authority', a.authority_citation,
                              'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id, 'official_url', a.official_url);
  end if;
  return jsonb_build_object('status', 'jurisdiction_confirmation_needed',
                            'reason', case when a.jurisdiction_id = 'US' then 'state_rules_may_differ' when loc is null then 'local_not_selected' else 'local_not_verified' end,
                            'scope_note', a.scope_note,
                            'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id,
                            'official_url', a.official_url);
end $$;
grant execute on function public.academy_kb_applicability(uuid, text, text, date) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Search: exact section match, approved terminology, full-text; jurisdiction / trade / family / edition filters
-- ---------------------------------------------------------------------------
create or replace function public.academy_kb_norm_section(p text) returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(regexp_replace(coalesce(p, ''), '(?i)^\s*(sec(tion)?\.?|§+)\s*', ''), '\s+', '', 'g'))
$$;

create or replace function public.academy_kb_search(
  p_q text default null, p_state text default null, p_local text default null, p_trades text[] default null,
  p_family text default null, p_edition text default null, p_section text default null, p_include_history boolean default false,
  p_limit integer default 20
) returns table (
  section_id uuid, source_id uuid, citation text, section_number text, title text, kind text, body_kind text, body text, summary text,
  exceptions text, page text, trades text[], topics text[], official_url text, section_status text, last_verified_at timestamptz,
  source_title text, source_short text, edition text, family_slug text, family_name text, publisher text, rights text, read_url text,
  source_jurisdiction text, pagination_note text, amends_section text, amend_action text, applicability jsonb, match text, rank real
)
language plpgsql stable security invoker set search_path = public set jit = off as $$
#variable_conflict use_column
declare
  q text := left(btrim(coalesce(p_q, '')), 300);
  st text := upper(nullif(btrim(p_state), ''));
  sec_norm text := public.academy_kb_norm_section(coalesce(nullif(btrim(p_section), ''), (regexp_match(q, '(?i)\m([A-Z]{0,3}\d{2,4}(\.\d+)+[a-z]?(\([a-z0-9]+\))*)'))[1]));
  tsq tsquery;
  term_topics text[];
  term_ids uuid[];
  term_q text;
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_trades text[] := case when p_trades is null or cardinality(p_trades) = 0 or 'general-contracting' = any (p_trades) then null else p_trades end;
begin
  if q = '' and coalesce(sec_norm, '') = '' and p_family is null then return; end if;
  if q <> '' then
    -- Any-word match (ranked by how many words and how well they match), not all-words: questions carry filler words.
    tsq := nullif(replace(plainto_tsquery('english', q)::text, ' & ', ' | '), '')::tsquery;
    -- Approved terminology: a term or synonym found in the question adds its topics (and the term itself) to the match.
    select array_agg(distinct tp), string_agg(distinct t.term, ' '), array_agg(distinct t.id) into term_topics, term_q, term_ids
      from public.academy_kb_terms t left join lateral unnest(t.topics) tp on true
     where t.status = 'approved' and (lower(q) like '%' || t.term || '%' or exists (select 1 from unnest(t.synonyms) s where lower(q) like '%' || lower(s) || '%'));
    if term_q is not null then tsq := coalesce(tsq || plainto_tsquery('english', replace(term_q, ' ', ' | ')), tsq); end if;
  end if;
  if coalesce(sec_norm, '') = '' then sec_norm := null; end if;

  return query
  with cand as (
    select s.*, src.title as src_title, src.short_title as src_short, src.edition as src_edition, src.family_slug as src_family, f.name as fam_name,
           src.publisher as src_publisher, src.rights as src_rights, src.read_url as src_read, src.jurisdiction_id as src_jur, src.pagination_note as src_pag,
           src.status as src_status,
           case
             when sec_norm is not null and (public.academy_kb_norm_section(s.section_number) = sec_norm or public.academy_kb_norm_section(s.amends_section) = sec_norm) then 'exact_section'
             when sec_norm is not null and (public.academy_kb_norm_section(s.section_number) like sec_norm || '%' or public.academy_kb_norm_section(s.amends_section) like sec_norm || '%') then 'section_prefix'
             when sec_norm is not null and public.academy_kb_norm_section(s.section_number) <> '' and sec_norm like public.academy_kb_norm_section(s.section_number) || '.%' then 'parent_section'
             when term_topics is not null and s.topics && term_topics then 'terminology'
             when tsq is not null and s.search_tsv @@ tsq then 'keyword'
             else null end as m
      from public.academy_kb_sections s
      join public.academy_kb_sources src on src.id = s.source_id
      join public.academy_kb_families f on f.slug = src.family_slug
     where (p_family is null or src.family_slug = p_family)
       and (p_edition is null or src.edition = p_edition)
       and (v_trades is null or s.trades = '{}' or s.trades && v_trades)
       and (st is null or src.jurisdiction_id is null or src.jurisdiction_id = 'US' or split_part(src.jurisdiction_id, ':', 1) = st)
       and (p_include_history or src.status <> 'superseded')
  )
  select c.id, c.source_id, c.citation, c.section_number, c.title, c.kind, c.body_kind,
         case when c.status = 'verified' then c.body else null end, c.summary, case when c.status = 'verified' then c.exceptions else null end,
         c.page, c.trades, c.topics, c.official_url, c.status, c.last_verified_at,
         c.src_title, c.src_short, c.src_edition, c.src_family, c.fam_name, c.src_publisher, c.src_rights, c.src_read, c.src_jur, c.src_pag,
         c.amends_section, c.amend_action,
         public.academy_kb_applicability(c.id, st, p_local),
         c.m,
         (case c.m when 'exact_section' then 10 when 'section_prefix' then 6 when 'parent_section' then 4 when 'terminology' then 1 else 0 end
           -- One point per approved term in the question that this section's topics cover (a stair question favors stair rules).
           + case when term_ids is not null then (select count(*) from public.academy_kb_terms t where t.id = any (term_ids) and t.topics && c.topics) else 0 end
           + case when term_topics is not null then 0.1 * cardinality(array(select unnest(c.topics) intersect select unnest(term_topics))) else 0 end
           + case when tsq is not null then ts_rank(c.search_tsv, tsq) * 4 else 0 end
           + case when c.status = 'verified' then 0.5 else 0 end
           + case when v_trades is not null and c.trades && v_trades then 0.5 else 0 end
           + case when st is not null and split_part(coalesce(c.src_jur, ''), ':', 1) = st then 0.75 else 0 end)::real as r
    from cand c
   where c.m is not null or (q = '' and sec_norm is null and p_family is not null)
   order by r desc, c.src_family, c.sort_order, c.section_number
   limit lim;
end $$;
grant execute on function public.academy_kb_search(text, text, text, text[], text, text, text, boolean, integer) to anon, authenticated, service_role;

-- Related suggestions from the terminology dictionary (for "did you mean / related topics").
create or replace function public.academy_kb_suggest(p_q text) returns table (term text, related text[], topics text[], note text)
language sql stable security invoker set search_path = public as $$
  select t.term, t.related, t.topics, t.note from public.academy_kb_terms t
   where t.status = 'approved' and length(btrim(coalesce(p_q, ''))) >= 2
     and (lower(p_q) like '%' || t.term || '%' or t.term like '%' || lower(btrim(p_q)) || '%'
          or exists (select 1 from unnest(t.synonyms) s where lower(p_q) like '%' || lower(s) || '%'))
   order by length(t.term) desc limit 8
$$;
grant execute on function public.academy_kb_suggest(text) to anon, authenticated, service_role;

-- Aggregate search trend (no user id). Called by the server after each search.
create or replace function public.academy_kb_log_search(p_q text, p_state text, p_trade text, p_answered boolean) returns void
language plpgsql security definer set search_path = public as $$
declare q text := left(regexp_replace(lower(btrim(coalesce(p_q, ''))), '\s+', ' ', 'g'), 120);
begin
  -- Drop anything that looks like contact details or a street address before storing a trend.
  q := regexp_replace(q, '[\w.+-]+@[\w-]+\.[\w.]+', '[email]', 'g');
  q := regexp_replace(q, '\m\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\M', '[phone]', 'g');
  q := regexp_replace(q, '\m\d{3,6}\s+[a-z]+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way)\M', '[address]', 'g');
  if q = '' then return; end if;
  insert into public.academy_kb_search_stats (day, query_norm, state_code, trade, answered, n)
  values (current_date, q, coalesce(upper(left(p_state, 2)), ''), coalesce(left(p_trade, 40), ''), coalesce(p_answered, false), 1)
  on conflict (day, query_norm, state_code, trade, answered) do update set n = public.academy_kb_search_stats.n + 1;
end $$;
revoke execute on function public.academy_kb_log_search(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.academy_kb_log_search(text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Verification: the only way to mark something verified (or record a check)
-- ---------------------------------------------------------------------------
-- p_result: verified | unchanged | changed | unreachable | rejected | superseded. Staff (admin) or the service role.
create or replace function public.academy_kb_verify(p_target_type text, p_target_id text, p_method text, p_result text,
  p_source_url text default null, p_evidence text default null, p_content_hash text default null, p_http_status integer default null,
  p_change_kind text default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_actor uuid := auth.uid(); v_status text; is_service boolean := public.academy_kb_is_service();
begin
  if not is_service and not public.academy_has_role(array['admin']) then raise exception 'admin_only' using errcode = 'P0001'; end if;
  if p_result = 'verified' and (p_source_url is null or coalesce(btrim(p_evidence), '') = '') and p_method <> 'manual_review' then
    raise exception 'evidence_required: a verified result needs the official URL and the quoted evidence' using errcode = 'P0001';
  end if;
  if p_result = 'verified' and p_method = 'manual_review' and v_actor is null then
    raise exception 'reviewer_required' using errcode = 'P0001';
  end if;
  insert into public.academy_kb_verifications (target_type, target_id, actor_id, method, result, change_kind, source_url, http_status, content_hash, evidence, notes)
  values (p_target_type, p_target_id, v_actor, p_method, p_result, p_change_kind, p_source_url, p_http_status, p_content_hash, left(p_evidence, 4000), left(p_notes, 2000))
  returning id into v_id;

  v_status := case p_result when 'verified' then 'verified' when 'unreachable' then 'source_unavailable' when 'rejected' then 'rejected'
                            when 'superseded' then 'superseded' else null end;
  perform set_config('academy.kb_verifying', 'on', true);
  if p_target_type = 'source' then
    update public.academy_kb_sources set last_checked_at = now(),
      last_verified_at = case when p_result in ('verified', 'unchanged') then now() else last_verified_at end,
      content_hash = coalesce(p_content_hash, content_hash),
      status = coalesce(v_status, status)
     where id = p_target_id::uuid;
  elsif p_target_type = 'adoption' then
    update public.academy_kb_adoptions set last_verified_at = case when p_result in ('verified', 'unchanged') then now() else last_verified_at end,
      status = coalesce(v_status, status) where id = p_target_id::uuid;
  elsif p_target_type = 'section' then
    update public.academy_kb_sections set last_verified_at = case when p_result in ('verified', 'unchanged') then now() else last_verified_at end,
      content_hash = coalesce(p_content_hash, content_hash), status = coalesce(v_status, status) where id = p_target_id::uuid;
  end if;
  perform set_config('academy.kb_verifying', 'off', true);

  if p_result = 'changed' then
    insert into public.academy_kb_review_queue (kind, title, detail, target_type, target_id, affected, priority, dedupe_key)
    values ('source_change', left('Official source changed: ' || p_target_type, 200), coalesce(p_notes, 'The monitored page changed. Classify the change before updating content.'),
            p_target_type, p_target_id, jsonb_build_object('url', p_source_url, 'hash', p_content_hash, 'change_kind', coalesce(p_change_kind, 'unknown')), 2,
            'change:' || p_target_type || ':' || p_target_id)
    on conflict (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null do update set affected = excluded.affected, detail = excluded.detail;
  elsif p_result = 'unreachable' then
    insert into public.academy_kb_review_queue (kind, title, detail, target_type, target_id, priority, dedupe_key)
    values ('source_change', 'Official source unreachable', coalesce(p_notes, 'Broken or unreachable official link.'), p_target_type, p_target_id, 2, 'unreachable:' || p_target_type || ':' || p_target_id)
    on conflict (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null do nothing;
  end if;
  if v_actor is not null then
    perform public.academy_audit('kb_verify', p_target_type, p_target_id, jsonb_build_object('method', p_method, 'result', p_result));
  end if;
  return v_id;
end $$;
revoke execute on function public.academy_kb_verify(text, text, text, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.academy_kb_verify(text, text, text, text, text, text, text, integer, text, text) to authenticated, service_role;

-- Public verification trail for one item (no actor ids, no staff notes).
create or replace function public.academy_kb_trail(p_target_type text, p_target_id text) returns table (checked_at timestamptz, method text, result text, source_url text)
language sql stable security definer set search_path = public as $$
  select v.checked_at, v.method, v.result, v.source_url from public.academy_kb_verifications v
   where v.target_type = p_target_type and v.target_id = p_target_id and p_target_type in ('source', 'adoption', 'section')
   order by v.checked_at desc limit 10
$$;
grant execute on function public.academy_kb_trail(text, text) to anon, authenticated, service_role;

-- Sources due for automated monitoring: monthly by default; the six-month review queues every source.
create or replace function public.academy_kb_due_checks(p_limit integer default 20) returns table (id uuid, check_url text, content_hash text, short_title text, edition text)
language sql stable security definer set search_path = public as $$
  select s.id, coalesce(s.check_url, s.official_url), s.content_hash, s.short_title, s.edition from public.academy_kb_sources s
   where s.status in ('verified', 'pending_review', 'source_unavailable') and coalesce(s.check_url, s.official_url) is not null
     and (s.last_checked_at is null or s.last_checked_at < now() - interval '28 days')
   order by s.last_checked_at nulls first limit least(greatest(p_limit, 1), 100)
$$;
revoke execute on function public.academy_kb_due_checks(integer) from public, anon, authenticated;
grant execute on function public.academy_kb_due_checks(integer) to service_role;

create or replace function public.academy_kb_queue_semiannual() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.academy_kb_review_queue (kind, title, detail, target_type, target_id, priority, dedupe_key)
  select 'scheduled_review', left('Six-month review: ' || s.short_title || ' ' || s.edition, 200),
         'Confirm edition, adoption, effective dates, amendments and trade coverage are still current.', 'source', s.id::text, 3,
         'semiannual:' || s.id || ':' || to_char(now(), 'YYYY') || (case when extract(month from now()) <= 6 then 'H1' else 'H2' end)
    from public.academy_kb_sources s where s.status in ('verified', 'pending_review', 'source_unavailable')
  on conflict (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.academy_kb_queue_semiannual() from public, anon, authenticated;
grant execute on function public.academy_kb_queue_semiannual() to service_role;

-- ---------------------------------------------------------------------------
-- Learner actions
-- ---------------------------------------------------------------------------
-- Correction report from a result, lesson or card. Anonymous reports allowed with a global hourly cap.
create or replace function public.academy_kb_report(p_target_type text, p_target_id text, p_reason text, p_note text default null, p_state text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    if (select count(*) from public.academy_kb_feedback where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.academy_kb_feedback where user_id is null and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.academy_kb_feedback (user_id, target_type, target_id, reason, note, state_code)
  values (v_uid, p_target_type, left(p_target_id, 120), p_reason, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), upper(nullif(left(p_state, 2), '')));
  insert into public.academy_kb_review_queue (kind, title, detail, target_type, target_id, priority, dedupe_key, affected)
  values ('user_feedback', left('Reader report: ' || replace(p_reason, '_', ' '), 200), nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_target_type, left(p_target_id, 120),
          case when p_reason in ('incorrect_requirement', 'outdated_code', 'wrong_jurisdiction') then 2 else 3 end,
          'feedback:' || p_target_type || ':' || left(p_target_id, 120) || ':' || p_reason, jsonb_build_object('reports', 1))
  on conflict (dedupe_key) where status in ('open', 'in_review') and dedupe_key is not null do update
    set affected = jsonb_set(public.academy_kb_review_queue.affected, '{reports}', to_jsonb(coalesce((public.academy_kb_review_queue.affected->>'reports')::int, 0) + 1));
end $$;
grant execute on function public.academy_kb_report(text, text, text, text, text) to anon, authenticated;

-- Record one flashcard/question answer for the signed-in learner (Leitner box 1-5).
create or replace function public.academy_kb_answer(p_item_id uuid, p_correct boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.academy_kb_items where id = p_item_id and status = 'approved') then raise exception 'not_found' using errcode = 'P0001'; end if;
  insert into public.academy_kb_item_progress (user_id, item_id, box, right_count, wrong_count, last_correct, last_seen_at)
  values (v_uid, p_item_id, case when p_correct then 2 else 1 end, case when p_correct then 1 else 0 end, case when p_correct then 0 else 1 end, p_correct, now())
  on conflict (user_id, item_id) do update set
    box = case when p_correct then least(public.academy_kb_item_progress.box + 1, 5) else 1 end,
    right_count = public.academy_kb_item_progress.right_count + case when p_correct then 1 else 0 end,
    wrong_count = public.academy_kb_item_progress.wrong_count + case when p_correct then 0 else 1 end,
    last_correct = p_correct, last_seen_at = now();
end $$;
grant execute on function public.academy_kb_answer(uuid, boolean) to authenticated;

-- Start a study session (quiz, exam, flashcards, five-minute) for the signed-in learner. Items must be approved.
create or replace function public.academy_kb_start(p_mode text, p_item_ids uuid[], p_filters jsonb default '{}', p_exam text default null, p_time_limit integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; n integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select count(*) into n from public.academy_kb_items where id = any (p_item_ids) and status = 'approved';
  if n <> cardinality(p_item_ids) or n = 0 then raise exception 'bad_items' using errcode = 'P0001'; end if;
  if (select count(*) from public.academy_kb_attempts where user_id = v_uid and started_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.academy_kb_attempts (user_id, mode, exam_slug, filters, item_ids, timed, time_limit_seconds)
  values (v_uid, p_mode, p_exam, coalesce(p_filters, '{}'), p_item_ids, p_time_limit is not null, p_time_limit)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.academy_kb_start(text, uuid[], jsonb, text, integer) to authenticated;

-- Save progress on a session: answers map item id -> chosen option index (or true/false for flashcards).
create or replace function public.academy_kb_save(p_attempt uuid, p_answers jsonb, p_position integer, p_finish boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.academy_kb_attempts; v_correct integer := 0; it record;
begin
  select * into a from public.academy_kb_attempts where id = p_attempt and user_id = v_uid for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if a.finished_at is not null then return jsonb_build_object('correct', a.correct, 'total', cardinality(a.item_ids), 'finished', true); end if;
  for it in select i.id, i.kind, i.correct from public.academy_kb_items i where i.id = any (a.item_ids) loop
    if it.kind = 'question' and (p_answers ->> it.id::text) ~ '^\d+$' and (p_answers ->> it.id::text)::int = it.correct then v_correct := v_correct + 1;
    elsif it.kind = 'flashcard' and (p_answers ->> it.id::text) = 'true' then v_correct := v_correct + 1; end if;
  end loop;
  update public.academy_kb_attempts set answers = coalesce(p_answers, '{}'), position = greatest(0, least(coalesce(p_position, 0), cardinality(item_ids))),
    correct = v_correct, finished_at = case when p_finish then now() else null end where id = a.id;
  return jsonb_build_object('correct', v_correct, 'total', cardinality(a.item_ids), 'finished', p_finish);
end $$;
grant execute on function public.academy_kb_save(uuid, jsonb, integer, boolean) to authenticated;

create or replace function public.academy_kb_step(p_path text, p_step text, p_done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.academy_kb_paths p where p.slug = p_path and p.status = 'published' and p.steps @> jsonb_build_array(jsonb_build_object('key', p_step))) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_done then
    insert into public.academy_kb_path_progress (user_id, path_slug, step_key) values (v_uid, p_path, p_step) on conflict do nothing;
  else
    delete from public.academy_kb_path_progress where user_id = v_uid and path_slug = p_path and step_key = p_step;
  end if;
end $$;
grant execute on function public.academy_kb_step(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Content health (admin dashboard)
-- ---------------------------------------------------------------------------
create or replace function public.academy_kb_health() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.academy_kb_editor() and not public.academy_kb_is_service() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'states_verified', (select coalesce(jsonb_agg(distinct a.jurisdiction_id order by a.jurisdiction_id), '[]') from public.academy_kb_adoptions a
                         join public.academy_kb_jurisdictions j on j.id = a.jurisdiction_id where a.status = 'verified' and j.level = 'state'),
    'jurisdictions', (select jsonb_build_object('total', count(*), 'awaiting', count(*) filter (where coverage = 'awaiting_verification'),
                         'partial', count(*) filter (where coverage = 'partial'), 'verified', count(*) filter (where coverage = 'verified')) from public.academy_kb_jurisdictions where level in ('state', 'federal')),
    'sources', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.academy_kb_sources group by status) x),
    'adoptions', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.academy_kb_adoptions group by status) x),
    'sections', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.academy_kb_sections group by status) x),
    'trades_verified', (select coalesce(jsonb_agg(distinct t order by t), '[]') from public.academy_kb_sections s, unnest(s.trades) t where s.status = 'verified'),
    'oldest_verification', (select min(last_verified_at) from public.academy_kb_sources where status = 'verified'),
    'unreachable', (select count(*) from public.academy_kb_sources where status = 'source_unavailable'),
    'superseded', (select count(*) from public.academy_kb_sources where status = 'superseded'),
    'items', (select jsonb_build_object('approved', count(*) filter (where status = 'approved'), 'needs_review', count(*) filter (where needs_review),
                       'draft', count(*) filter (where status = 'draft')) from public.academy_kb_items),
    'queue_open', (select count(*) from public.academy_kb_review_queue where status in ('open', 'in_review')),
    'feedback_new', (select count(*) from public.academy_kb_feedback where status = 'new'),
    'no_answer_30d', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select query_norm as q, state_code as state, trade, sum(n)::int as n from public.academy_kb_search_stats
                         where not answered and day > current_date - 30 group by 1, 2, 3 order by 4 desc limit 25) x),
    'top_searches_30d', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select query_norm as q, sum(n)::int as n from public.academy_kb_search_stats
                         where day > current_date - 30 group by 1 order by 2 desc limit 15) x),
    'missed_topics_30d', (select coalesce(jsonb_agg(x order by x.miss_rate desc), '[]') from (
                         select i.deck, count(*)::int as answered, round(avg(case when p.last_correct then 0 else 1 end)::numeric, 2) as miss_rate
                           from public.academy_kb_item_progress p join public.academy_kb_items i on i.id = p.item_id
                          where p.last_seen_at > now() - interval '30 days' group by i.deck having count(*) >= 10 order by 3 desc limit 10) x),
    'ai_30d', (select jsonb_build_object('calls', count(*), 'cost_usd', coalesce(sum(cost_usd), 0)) from public.ai_generations
                where kind = 'academy_code_explain' and created_at > now() - interval '30 days'),
    'cache', (select jsonb_build_object('answers', count(*) filter (where invalidated_at is null), 'hits', coalesce(sum(hits), 0)) from public.academy_kb_answer_cache)
  );
end $$;
revoke execute on function public.academy_kb_health() from public, anon;
grant execute on function public.academy_kb_health() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private bucket for permitted source PDFs (admins upload through the server with the service role)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy-kb', 'academy-kb', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- AI generation log kind for grounded code explanations
-- ---------------------------------------------------------------------------
do $$
declare d text; vals text[];
begin
  if to_regclass('public.ai_generations') is null then return; end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'ai_generations_kind_check' and conrelid = 'public.ai_generations'::regclass;
  if d is null or d like '%academy_code_explain%' then return; end if;
  if d ~ '''\{[a-z_,]*\}''' then
    vals := string_to_array((regexp_match(d, '''\{([a-z_,]*)\}'''))[1], ',');
  else
    select array_agg(m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') as m;
  end if;
  if vals is null or cardinality(vals) = 0 then return; end if;
  vals := vals || array['academy_code_explain'];
  alter table public.ai_generations drop constraint ai_generations_kind_check;
  execute format('alter table public.ai_generations add constraint ai_generations_kind_check check (kind = any (%L::text[]))', vals);
end $$;
