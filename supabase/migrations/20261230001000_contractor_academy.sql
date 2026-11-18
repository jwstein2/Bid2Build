-- ============================================================================
-- Built2Bid Contractor Academy & Community (V7.0)
--
-- One connected community (posts, threaded comments, reactions, bookmarks, reports, moderation),
-- a trade-organised classroom (trades -> courses -> modules -> lessons -> curated resources),
-- lesson progress, quality-weighted points / levels / badges, and an audit trail.
--
-- Security model
--   * Academy membership is explicit: a Built2Bid account is NOT a member until it calls academy_join().
--   * Community content (posts, comments, member directory, leaderboards) is readable only by active
--     members, through SECURITY DEFINER read functions that apply the privacy settings. The base tables
--     are readable only by their author (own rows) and Academy staff. Nothing community-side is readable
--     by anon, so private discussions never reach search engines.
--   * Every community write goes through a SECURITY DEFINER function that validates input, enforces
--     roles, rate limits and abuse rules. authenticated has no direct insert/update/delete grants.
--   * Classroom content: published/upcoming course cards and published, public-access lessons are
--     readable by anon (SEO). Member / premium lessons are filtered by RLS. Content edits are made by the
--     server (service role) only after an Academy staff role check, and are audited.
--   * Roles: platform super-admin (public.is_admin) > academy admin > moderator / instructor > member.
--     Enterprise company admins get no Academy role automatically.
--   * Premium is an Academy tier set by an Academy admin (or an owner-configured bundle). No Stripe
--     product, price or charge is involved, and software subscriptions are unchanged.
--
-- Presence: a member counts as "online" when they loaded an Academy page within
-- academy_settings.online_window_minutes (default 5). academy_touch() writes at most once a minute.
--
-- Reversible: docs/academy/rollback_20261230001000.sql drops everything this file creates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings (singleton row)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_settings (
  id boolean primary key default true check (id),
  name text not null default 'Built2Bid Contractor Academy' check (char_length(name) between 3 and 80),
  tagline text not null default 'Learn the business. Run the business. Grow the business.' check (char_length(tagline) <= 160),
  description text not null default 'A professional community for contractors to learn selling, estimating, project management, hiring and financials, organized by trade.' check (char_length(description) <= 600),
  rules text[] not null default array[
    'Be professional. Disagree with ideas, not people.',
    'Share real experience. Say when something is your opinion or depends on your state.',
    'No spam, cold pitches or lead selling. Self-promotion only where a category allows it.',
    'Protect privacy: never post customer names, addresses, phone numbers or documents.',
    'Licensing, tax, legal and safety rules vary by location. Confirm with the authority that covers your area.'
  ] check (cardinality(rules) <= 12),
  online_window_minutes integer not null default 5 check (online_window_minutes between 1 and 60),
  free_members_can_post boolean not null default true,
  premium_enabled boolean not null default false,
  -- Owner-configured bundles that also grant Academy premium: 'unlimited' (Built2Bid Unlimited subscribers).
  premium_bundles text[] not null default '{}' check (premium_bundles <@ array['unlimited']::text[]),
  points_reaction integer not null default 1 check (points_reaction between 0 and 10),
  points_helpful integer not null default 5 check (points_helpful between 0 and 50),
  points_course integer not null default 2 check (points_course between 0 and 20),
  daily_point_cap integer not null default 25 check (daily_point_cap between 1 and 500),
  pair_daily_cap integer not null default 3 check (pair_daily_cap between 1 and 50),
  updated_at timestamptz not null default now()
);
insert into public.academy_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Trades registry (seeded from the canonical code catalog, src/lib/trades/data.ts; admins can add more)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_trades (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  family text,
  icon text,
  intro text check (char_length(intro) <= 600),
  seo_title text check (char_length(seo_title) <= 70),
  seo_description text check (char_length(seo_description) <= 170),
  sales_challenge text check (char_length(sales_challenge) <= 400),
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Members, roles, tiers
-- ---------------------------------------------------------------------------
create table if not exists public.academy_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  headline text check (char_length(headline) <= 120),
  bio text check (char_length(bio) <= 1000),
  trades text[] not null default '{}' check (cardinality(trades) <= 10),
  primary_trade text,
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  company_name text check (char_length(company_name) <= 120),
  interests text[] not null default '{}' check (cardinality(interests) <= 8),
  show_company boolean not null default false,
  show_location boolean not null default true,
  show_trades boolean not null default true,
  directory_visible boolean not null default true,
  leaderboard_visible boolean not null default true,
  role text not null default 'member' check (role in ('member', 'instructor', 'moderator', 'admin')),
  tier text not null default 'free' check (tier in ('free', 'premium')),
  status text not null default 'active' check (status in ('active', 'suspended', 'banned', 'left')),
  suspended_until timestamptz,
  rules_accepted_at timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists academy_members_status_seen on public.academy_members (status, last_seen_at desc);
create index if not exists academy_members_trades on public.academy_members using gin (trades);
create index if not exists academy_members_role on public.academy_members (role) where role <> 'member';

-- ---------------------------------------------------------------------------
-- Community
-- ---------------------------------------------------------------------------
create table if not exists public.academy_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (char_length(description) <= 240),
  icon text,
  sort_order integer not null default 0,
  access text not null default 'members' check (access in ('members', 'premium')),
  staff_only_posting boolean not null default false,
  active boolean not null default true
);

create table if not exists public.academy_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  category_slug text not null references public.academy_categories (slug) on update cascade,
  trade_slug text references public.academy_trades (slug) on update cascade on delete set null,
  state_code text check (state_code ~ '^[A-Z]{2}$'),
  kind text not null default 'discussion' check (kind in ('discussion', 'question', 'announcement')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  link_url text check (link_url ~ '^https?://' and char_length(link_url) <= 500),
  image_path text check (image_path ~ '^posts/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  pinned boolean not null default false,
  locked boolean not null default false,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  comment_count integer not null default 0,
  reaction_count integer not null default 0,
  answered_comment_id uuid,
  last_activity_at timestamptz not null default now(),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored
);
create index if not exists academy_posts_feed on public.academy_posts (status, pinned desc, last_activity_at desc);
create index if not exists academy_posts_category on public.academy_posts (category_slug, last_activity_at desc) where status = 'visible';
create index if not exists academy_posts_trade on public.academy_posts (trade_slug, last_activity_at desc) where status = 'visible';
create index if not exists academy_posts_author on public.academy_posts (author_id, created_at desc);
create index if not exists academy_posts_search on public.academy_posts using gin (search);

create table if not exists public.academy_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.academy_posts (id) on delete cascade,
  parent_id uuid references public.academy_comments (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  helpful boolean not null default false,
  reaction_count integer not null default 0,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists academy_comments_post on public.academy_comments (post_id, created_at);
create index if not exists academy_comments_author on public.academy_comments (author_id, created_at desc);

create table if not exists public.academy_reactions (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index if not exists academy_reactions_target on public.academy_reactions (target_type, target_id);

create table if not exists public.academy_bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'course', 'lesson', 'resource')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists public.academy_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'member')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'off_topic', 'unsafe_advice', 'privacy', 'other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution_note text check (char_length(resolution_note) <= 1000),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index if not exists academy_reports_open on public.academy_reports (status, created_at desc);

-- Points ledger. Leaderboards and levels are computed from it, so every point is explainable.
create table if not exists public.academy_point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('reaction_received', 'helpful_answer', 'course_completed', 'moderator_award')),
  points integer not null check (points between -100 and 100),
  target_type text not null,
  target_id uuid not null,
  created_at timestamptz not null default now()
);
create unique index if not exists academy_point_events_dedupe on public.academy_point_events (user_id, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, target_type, target_id);
create index if not exists academy_point_events_time on public.academy_point_events (created_at desc, user_id);
create index if not exists academy_point_events_user on public.academy_point_events (user_id, created_at desc);

create table if not exists public.academy_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge text not null check (badge ~ '^[a-z0-9:_-]{2,120}$'),
  label text not null check (char_length(label) <= 120),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge)
);

create table if not exists public.academy_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  target_type text not null check (char_length(target_type) <= 40),
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_audit_time on public.academy_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Classroom
-- ---------------------------------------------------------------------------
create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,100}$'),
  trade_slug text references public.academy_trades (slug) on update cascade on delete set null, -- null = all trades
  pillar text not null check (pillar in ('getting_started', 'sales', 'estimating', 'project_management', 'accounting', 'hr', 'growth', 'safety')),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) <= 240),
  description text check (char_length(description) <= 4000),
  level text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  access text not null default 'public' check (access in ('public', 'members', 'premium')),
  status text not null default 'draft' check (status in ('draft', 'upcoming', 'in_review', 'published', 'archived')),
  content_class text not null default 'original' check (content_class in ('original', 'curated', 'licensed', 'mixed')),
  cover_path text check (cover_path ~ '^covers/[0-9a-f-]{36}\.webp$'),
  cover_theme text not null default 'navy' check (cover_theme in ('navy', 'cyan', 'amber', 'green', 'slate', 'rose')),
  featured boolean not null default false,
  sort_order integer not null default 0,
  planned_lessons text[] not null default '{}' check (cardinality(planned_lessons) <= 20),
  seo_title text check (char_length(seo_title) <= 70),
  seo_description text check (char_length(seo_description) <= 170),
  owner_id uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_courses_trade on public.academy_courses (trade_slug, sort_order);
create index if not exists academy_courses_status on public.academy_courses (status, pillar);

create table if not exists public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  sort_order integer not null default 0
);
create index if not exists academy_modules_course on public.academy_modules (course_id, sort_order);

create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  module_id uuid references public.academy_modules (id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9-]{3,100}$'),
  title text not null check (char_length(title) between 3 and 140),
  summary text check (char_length(summary) <= 300),
  body_md text check (char_length(body_md) <= 30000),
  takeaways text[] not null default '{}' check (cardinality(takeaways) <= 12),
  checklist text[] not null default '{}' check (cardinality(checklist) <= 20),
  trade_notes jsonb not null default '{}' check (jsonb_typeof(trade_notes) = 'object'),
  app_action jsonb check (app_action is null or jsonb_typeof(app_action) = 'object'),
  quiz jsonb check (quiz is null or jsonb_typeof(quiz) = 'array'),
  access text not null default 'public' check (access in ('public', 'members', 'premium')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  estimated_minutes integer check (estimated_minutes between 1 and 600),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, slug)
);
create index if not exists academy_lessons_course on public.academy_lessons (course_id, sort_order);

-- One canonical record per external or original resource, reused across lessons and trades.
create table if not exists public.academy_resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('youtube', 'skool_community', 'skool_course', 'article', 'template', 'download', 'official')),
  title text not null check (char_length(title) between 2 and 200),
  creator_name text check (char_length(creator_name) <= 120),
  creator_url text check (creator_url ~ '^https://' and char_length(creator_url) <= 500),
  community_name text check (char_length(community_name) <= 120),
  platform text check (char_length(platform) <= 60),
  source_url text not null unique check (source_url ~ '^https://' and char_length(source_url) <= 500),
  embed_id text check (embed_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  embed_allowed boolean not null default false,
  thumbnail_url text check (thumbnail_url ~ '^https://i\.ytimg\.com/' and char_length(thumbnail_url) <= 300),
  summary text check (char_length(summary) <= 800),
  why_it_matters text check (char_length(why_it_matters) <= 600),
  takeaways text[] not null default '{}' check (cardinality(takeaways) <= 8),
  trades text[] not null default '{}',
  skill text check (skill in ('getting_started', 'sales', 'estimating', 'project_management', 'accounting', 'hr', 'growth', 'safety', 'marketing')),
  access_note text check (char_length(access_note) <= 200),
  permission_status text not null default 'link_only' check (permission_status in ('link_only', 'licensed', 'original')),
  license_id uuid,
  views_at_verification bigint check (views_at_verification >= 0),
  verified_at date,
  verification_note text check (char_length(verification_note) <= 300),
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'broken', 'retired')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_resources_skill on public.academy_resources (status, skill);
create index if not exists academy_resources_trades on public.academy_resources using gin (trades);

-- Written permission from a creator to reproduce or import their material. Import is enabled only
-- for resources linked to an active, unexpired licence (enforced by academy_resources_license_guard).
create table if not exists public.academy_creator_licenses (
  id uuid primary key default gen_random_uuid(),
  creator_name text not null check (char_length(creator_name) between 2 and 120),
  creator_contact_note text check (char_length(creator_contact_note) <= 300),
  permission_date date not null,
  authorized_content text not null check (char_length(authorized_content) <= 2000),
  permitted_uses text not null check (char_length(permitted_uses) <= 2000),
  commercial_use boolean not null default false,
  attribution_requirements text check (char_length(attribution_requirements) <= 1000),
  expires_at date,
  source_documentation text check (char_length(source_documentation) <= 1000),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.academy_resources drop constraint if exists academy_resources_license_fk;
alter table public.academy_resources add constraint academy_resources_license_fk foreign key (license_id) references public.academy_creator_licenses (id) on delete set null;

create table if not exists public.academy_lesson_resources (
  lesson_id uuid not null references public.academy_lessons (id) on delete cascade,
  resource_id uuid not null references public.academy_resources (id) on delete cascade,
  sort_order integer not null default 0,
  note text check (char_length(note) <= 400),
  primary key (lesson_id, resource_id)
);
create index if not exists academy_lesson_resources_resource on public.academy_lesson_resources (resource_id);

create table if not exists public.academy_course_resources (
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  resource_id uuid not null references public.academy_resources (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (course_id, resource_id)
);

create table if not exists public.academy_lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons (id) on delete cascade,
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  completed_at timestamptz not null default now(),
  quiz_score integer check (quiz_score between 0 and 100),
  primary key (user_id, lesson_id)
);
create index if not exists academy_progress_course on public.academy_lesson_progress (user_id, course_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function public.academy_touch_updated() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['academy_settings', 'academy_trades', 'academy_members', 'academy_courses', 'academy_lessons', 'academy_resources'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.academy_touch_updated()', t || '_updated', t);
  end loop;
end $$;

-- A resource may only be marked licensed when it points at an active, unexpired licence.
create or replace function public.academy_resources_license_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.permission_status = 'licensed' and not exists (
    select 1 from public.academy_creator_licenses l
    where l.id = new.license_id and l.status = 'active' and (l.expires_at is null or l.expires_at >= current_date)
  ) then
    raise exception 'license_required' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists academy_resources_license on public.academy_resources;
create trigger academy_resources_license before insert or update on public.academy_resources for each row execute function public.academy_resources_license_guard();

-- Validate member trade lists against the registry.
create or replace function public.academy_members_guard() returns trigger language plpgsql set search_path = public as $$
begin
  new.display_name := btrim(new.display_name);
  if exists (select 1 from unnest(new.trades) s where not exists (select 1 from public.academy_trades t where t.slug = s)) then
    raise exception 'bad_trade' using errcode = '22023';
  end if;
  if new.primary_trade is not null and not (new.primary_trade = any (new.trades)) then
    new.trades := array_prepend(new.primary_trade, new.trades);
    if not exists (select 1 from public.academy_trades t where t.slug = new.primary_trade) then raise exception 'bad_trade' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from unnest(new.interests) s where s not in ('getting_started', 'sales', 'estimating', 'project_management', 'accounting', 'hr', 'growth', 'safety', 'marketing')) then
    raise exception 'bad_interest' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists academy_members_validate on public.academy_members;
create trigger academy_members_validate before insert or update on public.academy_members for each row execute function public.academy_members_guard();

-- ---------------------------------------------------------------------------
-- Role / access helpers
-- ---------------------------------------------------------------------------
-- Effective Academy role: platform super-admins are Academy admins; otherwise the member's role while active.
create or replace function public.academy_role(p_user_id uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_user_id is null then null
    when public.is_admin(p_user_id) then 'admin'
    else (select m.role from public.academy_members m
          where m.user_id = p_user_id
            and (m.status = 'active' or (m.status = 'suspended' and m.suspended_until is not null and m.suspended_until <= now())))
  end
$$;

create or replace function public.academy_is_member(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user_id is not null and (public.is_admin(p_user_id) or exists (
    select 1 from public.academy_members m where m.user_id = p_user_id
      and (m.status = 'active' or (m.status = 'suspended' and m.suspended_until is not null and m.suspended_until <= now()))))
$$;

-- Can read the community (suspended members can still read; banned/left cannot).
create or replace function public.academy_can_read(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user_id is not null and (public.is_admin(p_user_id) or exists (
    select 1 from public.academy_members m where m.user_id = p_user_id and m.status in ('active', 'suspended')))
$$;

create or replace function public.academy_has_role(p_roles text[], p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.academy_role(p_user_id) = any (p_roles), false)
$$;

create or replace function public.academy_is_premium(p_user_id uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role text := public.academy_role(p_user_id); v_tier text; v_bundles text[];
begin
  if v_role is null then return false; end if;
  if v_role in ('admin', 'moderator', 'instructor') then return true; end if;
  select tier into v_tier from public.academy_members where user_id = p_user_id;
  if v_tier = 'premium' then return true; end if;
  select premium_bundles into v_bundles from public.academy_settings where id;
  if 'unlimited' = any (coalesce(v_bundles, '{}')) and to_regprocedure('public.has_unlimited(uuid)') is not null then
    return coalesce(public.has_unlimited(p_user_id), false);
  end if;
  return false;
end $$;

create or replace function public.academy_lesson_readable(p_access text, p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_access
    when 'public' then true
    when 'members' then public.academy_is_member(p_user_id)
    when 'premium' then public.academy_is_premium(p_user_id)
    else false end
$$;

create or replace function public.academy_category_readable(p_slug text, p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.academy_categories c where c.slug = p_slug and c.active
    and (c.access = 'members' or public.academy_is_premium(p_user_id)))
$$;

create or replace function public.academy_level(p_points bigint) returns integer language sql immutable as $$
  select case
    when p_points >= 2500 then 9 when p_points >= 1200 then 8 when p_points >= 600 then 7
    when p_points >= 300 then 6 when p_points >= 150 then 5 when p_points >= 75 then 4
    when p_points >= 30 then 3 when p_points >= 10 then 2 else 1 end
$$;

create or replace function public.academy_audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.academy_audit_log (actor_id, action, target_type, target_id, details) values (auth.uid(), p_action, p_target_type, p_target_id, p_details)
$$;
revoke execute on function public.academy_audit(text, text, text, jsonb) from public, anon, authenticated;

-- Can this person write right now? Raises a readable error code otherwise.
create or replace function public.academy_require_writer() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.academy_members;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.is_admin(v_uid) then return v_uid; end if;
  select * into m from public.academy_members where user_id = v_uid;
  if not found or m.status = 'left' then raise exception 'not_member' using errcode = '42501'; end if;
  if m.status = 'banned' then raise exception 'banned' using errcode = '42501'; end if;
  if m.status = 'suspended' and (m.suspended_until is null or m.suspended_until > now()) then raise exception 'suspended' using errcode = '42501'; end if;
  return v_uid;
end $$;
revoke execute on function public.academy_require_writer() from public, anon;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.academy_settings enable row level security;
alter table public.academy_trades enable row level security;
alter table public.academy_members enable row level security;
alter table public.academy_categories enable row level security;
alter table public.academy_posts enable row level security;
alter table public.academy_comments enable row level security;
alter table public.academy_reactions enable row level security;
alter table public.academy_bookmarks enable row level security;
alter table public.academy_reports enable row level security;
alter table public.academy_point_events enable row level security;
alter table public.academy_badges enable row level security;
alter table public.academy_audit_log enable row level security;
alter table public.academy_courses enable row level security;
alter table public.academy_modules enable row level security;
alter table public.academy_lessons enable row level security;
alter table public.academy_resources enable row level security;
alter table public.academy_creator_licenses enable row level security;
alter table public.academy_lesson_resources enable row level security;
alter table public.academy_course_resources enable row level security;
alter table public.academy_lesson_progress enable row level security;

drop policy if exists academy_settings_read on public.academy_settings;
create policy academy_settings_read on public.academy_settings for select to anon, authenticated using (true);
drop policy if exists academy_trades_read on public.academy_trades;
create policy academy_trades_read on public.academy_trades for select to anon, authenticated using (active or public.academy_has_role(array['admin', 'instructor']));
drop policy if exists academy_categories_read on public.academy_categories;
create policy academy_categories_read on public.academy_categories for select to authenticated using (active and public.academy_can_read());

-- Members: own row, or staff. Everyone else reads the masked directory functions.
drop policy if exists academy_members_read on public.academy_members;
create policy academy_members_read on public.academy_members for select to authenticated
  using (user_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));

-- Community base tables: own rows or moderators. Feed reads go through academy_feed()/academy_post().
drop policy if exists academy_posts_read on public.academy_posts;
create policy academy_posts_read on public.academy_posts for select to authenticated
  using (author_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));
drop policy if exists academy_comments_read on public.academy_comments;
create policy academy_comments_read on public.academy_comments for select to authenticated
  using (author_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));
drop policy if exists academy_reactions_read on public.academy_reactions;
create policy academy_reactions_read on public.academy_reactions for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_bookmarks_read on public.academy_bookmarks;
create policy academy_bookmarks_read on public.academy_bookmarks for select to authenticated using (user_id = auth.uid());
drop policy if exists academy_reports_read on public.academy_reports;
create policy academy_reports_read on public.academy_reports for select to authenticated
  using (reporter_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));
drop policy if exists academy_points_read on public.academy_point_events;
create policy academy_points_read on public.academy_point_events for select to authenticated
  using (user_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));
drop policy if exists academy_badges_read on public.academy_badges;
create policy academy_badges_read on public.academy_badges for select to authenticated using (user_id = auth.uid() or public.academy_has_role(array['admin', 'moderator']));
drop policy if exists academy_audit_read on public.academy_audit_log;
create policy academy_audit_read on public.academy_audit_log for select to authenticated using (public.academy_has_role(array['admin']));

-- Classroom: cards that are published or announced as upcoming are public; drafts are staff-only.
drop policy if exists academy_courses_read on public.academy_courses;
create policy academy_courses_read on public.academy_courses for select to anon, authenticated
  using (status in ('published', 'upcoming') or public.academy_has_role(array['admin', 'instructor']));
drop policy if exists academy_modules_read on public.academy_modules;
create policy academy_modules_read on public.academy_modules for select to anon, authenticated
  using (exists (select 1 from public.academy_courses c where c.id = course_id and (c.status = 'published' or public.academy_has_role(array['admin', 'instructor']))));
-- Lesson bodies: published lesson in a published course, and the reader's access allows it.
drop policy if exists academy_lessons_read on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to anon, authenticated
  using (
    public.academy_has_role(array['admin', 'instructor'])
    or (status = 'published'
        and exists (select 1 from public.academy_courses c where c.id = course_id and c.status = 'published' and public.academy_lesson_readable(c.access))
        and public.academy_lesson_readable(access))
  );
drop policy if exists academy_resources_read on public.academy_resources;
create policy academy_resources_read on public.academy_resources for select to anon, authenticated
  using (status = 'verified' or public.academy_has_role(array['admin', 'instructor']));
drop policy if exists academy_lesson_resources_read on public.academy_lesson_resources;
create policy academy_lesson_resources_read on public.academy_lesson_resources for select to anon, authenticated using (true);
drop policy if exists academy_course_resources_read on public.academy_course_resources;
create policy academy_course_resources_read on public.academy_course_resources for select to anon, authenticated using (true);
drop policy if exists academy_licenses_read on public.academy_creator_licenses;
create policy academy_licenses_read on public.academy_creator_licenses for select to authenticated using (public.academy_has_role(array['admin', 'instructor']));
drop policy if exists academy_progress_read on public.academy_lesson_progress;
create policy academy_progress_read on public.academy_lesson_progress for select to authenticated using (user_id = auth.uid());

-- No direct writes from the browser roles: every write goes through the functions below (or the server's
-- service-role client after an Academy staff check, for classroom content).
revoke insert, update, delete on public.academy_settings, public.academy_trades, public.academy_members, public.academy_categories,
  public.academy_posts, public.academy_comments, public.academy_reactions, public.academy_bookmarks, public.academy_reports,
  public.academy_point_events, public.academy_badges, public.academy_audit_log, public.academy_courses, public.academy_modules,
  public.academy_lessons, public.academy_resources, public.academy_creator_licenses, public.academy_lesson_resources,
  public.academy_course_resources, public.academy_lesson_progress from anon, authenticated;
grant select on public.academy_settings, public.academy_trades, public.academy_courses, public.academy_modules, public.academy_lessons,
  public.academy_resources, public.academy_lesson_resources, public.academy_course_resources to anon, authenticated;
grant select on public.academy_members, public.academy_categories, public.academy_posts, public.academy_comments, public.academy_reactions,
  public.academy_bookmarks, public.academy_reports, public.academy_point_events, public.academy_badges, public.academy_audit_log,
  public.academy_creator_licenses, public.academy_lesson_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Public, aggregate-only statistics (real counts; zero when empty)
-- ---------------------------------------------------------------------------
create or replace function public.academy_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from public.academy_members where status in ('active', 'suspended')),
    'online', (select count(*) from public.academy_members m, public.academy_settings s
               where s.id and m.status in ('active', 'suspended') and m.last_seen_at >= now() - make_interval(mins => s.online_window_minutes)),
    'admins', (select count(*) from public.academy_members m where m.status = 'active' and (m.role = 'admin' or public.is_admin(m.user_id))),
    'moderators', (select count(*) from public.academy_members where status = 'active' and role = 'moderator'),
    'online_window_minutes', (select online_window_minutes from public.academy_settings where id),
    'published_courses', (select count(*) from public.academy_courses where status = 'published'),
    'published_lessons', (select count(*) from public.academy_lessons l join public.academy_courses c on c.id = l.course_id where l.status = 'published' and c.status = 'published')
  )
$$;
grant execute on function public.academy_stats() to anon, authenticated;

-- The caller's own Academy state (membership, role, premium) for the app shell.
create or replace function public.academy_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.academy_members; v_points bigint;
begin
  if v_uid is null then return jsonb_build_object('signed_in', false); end if;
  select * into m from public.academy_members where user_id = v_uid;
  select coalesce(sum(points), 0) into v_points from public.academy_point_events where user_id = v_uid;
  return jsonb_build_object(
    'signed_in', true,
    'member', found and m.status in ('active', 'suspended'),
    'status', case when found then m.status end,
    'suspended_until', case when found then m.suspended_until end,
    'role', public.academy_role(v_uid),
    'platform_admin', public.is_admin(v_uid),
    'premium', public.academy_is_premium(v_uid),
    'display_name', case when found then m.display_name end,
    'primary_trade', case when found then m.primary_trade end,
    'trades', case when found then to_jsonb(m.trades) else '[]'::jsonb end,
    'points', v_points,
    'level', public.academy_level(v_points)
  );
end $$;
grant execute on function public.academy_me() to authenticated;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create or replace function public.academy_join(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.academy_members; v_trades text[];
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if coalesce((p ->> 'accept_rules')::boolean, false) is not true then raise exception 'rules_required' using errcode = '22023'; end if;
  select * into m from public.academy_members where user_id = v_uid;
  if found and m.status = 'banned' then raise exception 'banned' using errcode = '42501'; end if;
  v_trades := array(select distinct t from jsonb_array_elements_text(coalesce(p -> 'trades', '[]')) t limit 10);
  insert into public.academy_members (user_id, display_name, trades, primary_trade, state_code, company_name, show_company, rules_accepted_at, status, joined_at)
  values (v_uid, coalesce(nullif(btrim(p ->> 'display_name'), ''), 'Member'), v_trades, nullif(p ->> 'primary_trade', ''),
          nullif(upper(p ->> 'state_code'), ''), nullif(btrim(p ->> 'company_name'), ''), coalesce((p ->> 'show_company')::boolean, false), now(), 'active', now())
  on conflict (user_id) do update set
    display_name = excluded.display_name, trades = excluded.trades, primary_trade = excluded.primary_trade,
    state_code = excluded.state_code, company_name = excluded.company_name, show_company = excluded.show_company,
    rules_accepted_at = now(),
    -- Rejoining after leaving restores membership; a suspension stays in force.
    status = case when academy_members.status = 'left' then 'active' else academy_members.status end;
  perform public.academy_audit('member.join', 'member', v_uid::text, null);
  return public.academy_me();
end $$;

create or replace function public.academy_update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.academy_members where user_id = v_uid and status in ('active', 'suspended')) then raise exception 'not_member' using errcode = '42501'; end if;
  update public.academy_members set
    display_name = coalesce(nullif(btrim(p ->> 'display_name'), ''), display_name),
    headline = case when p ? 'headline' then nullif(btrim(p ->> 'headline'), '') else headline end,
    bio = case when p ? 'bio' then nullif(btrim(p ->> 'bio'), '') else bio end,
    trades = case when p ? 'trades' then array(select distinct t from jsonb_array_elements_text(p -> 'trades') t limit 10) else trades end,
    primary_trade = case when p ? 'primary_trade' then nullif(p ->> 'primary_trade', '') else primary_trade end,
    state_code = case when p ? 'state_code' then nullif(upper(p ->> 'state_code'), '') else state_code end,
    company_name = case when p ? 'company_name' then nullif(btrim(p ->> 'company_name'), '') else company_name end,
    interests = case when p ? 'interests' then array(select distinct t from jsonb_array_elements_text(p -> 'interests') t limit 8) else interests end,
    show_company = coalesce((p ->> 'show_company')::boolean, show_company),
    show_location = coalesce((p ->> 'show_location')::boolean, show_location),
    show_trades = coalesce((p ->> 'show_trades')::boolean, show_trades),
    directory_visible = coalesce((p ->> 'directory_visible')::boolean, directory_visible),
    leaderboard_visible = coalesce((p ->> 'leaderboard_visible')::boolean, leaderboard_visible)
  where user_id = v_uid;
  return public.academy_me();
end $$;

create or replace function public.academy_leave() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.academy_members set status = 'left', role = 'member' where user_id = v_uid and status = 'active';
  perform public.academy_audit('member.leave', 'member', v_uid::text, null);
end $$;

-- Presence heartbeat: at most one write per minute per member.
create or replace function public.academy_touch() returns void
language sql security definer set search_path = public as $$
  update public.academy_members set last_seen_at = now()
  where user_id = auth.uid() and status in ('active', 'suspended') and (last_seen_at is null or last_seen_at < now() - interval '60 seconds')
$$;

-- ---------------------------------------------------------------------------
-- Community reads (masked, member-only)
-- ---------------------------------------------------------------------------
create or replace function public.academy_feed(
  p_category text default null, p_trade text default null, p_q text default null, p_sort text default 'activity',
  p_kind text default null, p_saved boolean default false, p_author uuid default null, p_limit integer default 20, p_offset integer default 0
) returns table (
  id uuid, category_slug text, category_name text, trade_slug text, state_code text, kind text, title text, excerpt text,
  link_url text, image_path text, pinned boolean, locked boolean, answered boolean, comment_count integer, reaction_count integer,
  last_activity_at timestamptz, created_at timestamptz, author_id uuid, author_name text, author_level integer, author_role text,
  reacted boolean, saved boolean, total bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_premium boolean; v_tsq tsquery; v_staff boolean;
begin
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  v_premium := public.academy_is_premium(v_uid);
  v_staff := public.academy_has_role(array['admin', 'moderator'], v_uid);
  if nullif(btrim(p_q), '') is not null then v_tsq := websearch_to_tsquery('english', left(p_q, 200)); end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 50);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 5000);
  return query
  with base as (
    select p.*, c.name as cname
    from public.academy_posts p
    join public.academy_categories c on c.slug = p.category_slug and c.active and (c.access = 'members' or v_premium)
    where p.status = 'visible'
      and (p_category is null or p.category_slug = p_category)
      and (p_trade is null or p.trade_slug = p_trade)
      and (p_kind is null or p.kind = p_kind)
      and (p_author is null or p.author_id = p_author)
      and (v_tsq is null or p.search @@ v_tsq)
      and (not coalesce(p_saved, false) or exists (select 1 from public.academy_bookmarks b where b.user_id = v_uid and b.target_type = 'post' and b.target_id = p.id))
  ), counted as (select count(*) as n from base)
  select b.id, b.category_slug, b.cname, b.trade_slug, b.state_code, b.kind, b.title,
         left(regexp_replace(b.body, '\s+', ' ', 'g'), 280), b.link_url, b.image_path, b.pinned, b.locked, b.answered_comment_id is not null,
         b.comment_count, b.reaction_count, b.last_activity_at, b.created_at, b.author_id,
         coalesce(m.display_name, 'Member'),
         public.academy_level((select coalesce(sum(pe.points), 0) from public.academy_point_events pe where pe.user_id = b.author_id)),
         case when public.is_admin(b.author_id) then 'admin' else coalesce(m.role, 'member') end,
         exists (select 1 from public.academy_reactions r where r.user_id = v_uid and r.target_type = 'post' and r.target_id = b.id),
         exists (select 1 from public.academy_bookmarks bk where bk.user_id = v_uid and bk.target_type = 'post' and bk.target_id = b.id),
         (select n from counted)
  from base b
  left join public.academy_members m on m.user_id = b.author_id
  order by
    case when p_sort = 'activity' and v_tsq is null and p_category is null and not coalesce(p_saved, false) then b.pinned else false end desc,
    case when p_sort = 'top' then b.reaction_count + 2 * b.comment_count end desc nulls last,
    case when p_sort = 'new' then b.created_at end desc nulls last,
    case when v_tsq is not null and p_sort = 'relevance' then ts_rank(b.search, v_tsq) end desc nulls last,
    b.last_activity_at desc, b.id
  limit p_limit offset p_offset;
end $$;
grant execute on function public.academy_feed(text, text, text, text, text, boolean, uuid, integer, integer) to authenticated;

-- One post with its visible comments (one level of replies).
create or replace function public.academy_post(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p public.academy_posts; v_staff boolean; v_out jsonb;
begin
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  v_staff := public.academy_has_role(array['admin', 'moderator'], v_uid);
  select * into p from public.academy_posts where id = p_id;
  if not found or not public.academy_category_readable(p.category_slug, v_uid) or (p.status <> 'visible' and not v_staff and p.author_id <> v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', p.id, 'category_slug', p.category_slug, 'category_name', (select name from public.academy_categories where slug = p.category_slug),
    'trade_slug', p.trade_slug, 'state_code', p.state_code, 'kind', p.kind, 'title', p.title, 'body', p.body, 'link_url', p.link_url,
    'image_path', p.image_path, 'pinned', p.pinned, 'locked', p.locked, 'status', p.status, 'answered_comment_id', p.answered_comment_id,
    'comment_count', p.comment_count, 'reaction_count', p.reaction_count, 'created_at', p.created_at, 'edited_at', p.edited_at,
    'author_id', p.author_id, 'author_name', coalesce(m.display_name, 'Member'),
    'author_role', case when public.is_admin(p.author_id) then 'admin' else coalesce(m.role, 'member') end,
    'author_level', public.academy_level((select coalesce(sum(points), 0) from public.academy_point_events where user_id = p.author_id)),
    'reacted', exists (select 1 from public.academy_reactions r where r.user_id = v_uid and r.target_type = 'post' and r.target_id = p.id),
    'saved', exists (select 1 from public.academy_bookmarks b where b.user_id = v_uid and b.target_type = 'post' and b.target_id = p.id),
    'mine', p.author_id = v_uid,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'parent_id', c.parent_id, 'body', case when c.status = 'visible' then c.body else null end, 'status', c.status,
        'helpful', c.helpful, 'reaction_count', c.reaction_count, 'created_at', c.created_at, 'edited_at', c.edited_at,
        'author_id', c.author_id, 'author_name', coalesce(cm.display_name, 'Member'),
        'author_role', case when public.is_admin(c.author_id) then 'admin' else coalesce(cm.role, 'member') end,
        'mine', c.author_id = v_uid,
        'reacted', exists (select 1 from public.academy_reactions r where r.user_id = v_uid and r.target_type = 'comment' and r.target_id = c.id)
      ) order by c.created_at)
      from public.academy_comments c left join public.academy_members cm on cm.user_id = c.author_id
      where c.post_id = p.id and (c.status = 'visible' or v_staff
        -- keep a removed parent as a placeholder so its replies stay threaded
        or exists (select 1 from public.academy_comments r where r.parent_id = c.id and r.status = 'visible'))
    ), '[]'::jsonb)
  ) into v_out
  from (select 1) x left join public.academy_members m on m.user_id = p.author_id;
  return v_out;
end $$;
grant execute on function public.academy_post(uuid) to authenticated;

-- Member directory with privacy masking.
create or replace function public.academy_directory(
  p_q text default null, p_trade text default null, p_state text default null, p_role text default null, p_tier text default null,
  p_interest text default null, p_limit integer default 24, p_offset integer default 0
) returns table (
  user_id uuid, display_name text, headline text, trades text[], state_code text, company_name text, role text, tier text,
  level integer, points bigint, joined_at timestamptz, online boolean, total bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_window integer;
begin
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  select online_window_minutes into v_window from public.academy_settings where id;
  p_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 10000);
  return query
  with base as (
    select m.*, case when public.is_admin(m.user_id) then 'admin' else m.role end as eff_role,
           (select coalesce(sum(pe.points), 0) from public.academy_point_events pe where pe.user_id = m.user_id) as pts
    from public.academy_members m
    where m.status = 'active' and (m.directory_visible or m.user_id = v_uid)
      and (p_q is null or m.display_name ilike '%' || replace(replace(left(p_q, 60), '%', ''), '_', '') || '%'
           or (m.show_company and m.company_name ilike '%' || replace(replace(left(p_q, 60), '%', ''), '_', '') || '%'))
      and (p_trade is null or (m.show_trades and p_trade = any (m.trades)))
      and (p_state is null or (m.show_location and m.state_code = upper(p_state)))
      and (p_tier is null or m.tier = p_tier)
      and (p_interest is null or p_interest = any (m.interests))
  ), filtered as (select * from base where p_role is null or eff_role = p_role),
  counted as (select count(*) as n from filtered)
  select f.user_id, f.display_name, f.headline,
         case when f.show_trades then f.trades else '{}'::text[] end,
         case when f.show_location then f.state_code end,
         case when f.show_company then f.company_name end,
         f.eff_role, f.tier, public.academy_level(f.pts), f.pts, f.joined_at,
         f.last_seen_at >= now() - make_interval(mins => v_window),
         (select n from counted)
  from filtered f
  order by (f.eff_role <> 'member') desc, f.pts desc, f.joined_at
  limit p_limit offset p_offset;
end $$;
grant execute on function public.academy_directory(text, text, text, text, text, text, integer, integer) to authenticated;

create or replace function public.academy_profile(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.academy_members; v_pts bigint;
begin
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  select * into m from public.academy_members where user_id = p_user_id;
  if not found or m.status <> 'active' or (not m.directory_visible and p_user_id <> v_uid and not public.academy_has_role(array['admin', 'moderator'], v_uid)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(sum(points), 0) into v_pts from public.academy_point_events where user_id = p_user_id;
  return jsonb_build_object(
    'user_id', m.user_id, 'display_name', m.display_name, 'headline', m.headline, 'bio', m.bio,
    'trades', case when m.show_trades then to_jsonb(m.trades) else '[]'::jsonb end,
    'state_code', case when m.show_location then m.state_code end,
    'company_name', case when m.show_company then m.company_name end,
    'role', case when public.is_admin(m.user_id) then 'admin' else m.role end, 'tier', m.tier,
    'joined_at', m.joined_at, 'points', v_pts, 'level', public.academy_level(v_pts),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.badge, 'label', b.label, 'awarded_at', b.awarded_at) order by b.awarded_at) from public.academy_badges b where b.user_id = m.user_id), '[]'::jsonb),
    'post_count', (select count(*) from public.academy_posts where author_id = m.user_id and status = 'visible'),
    'helpful_count', (select count(*) from public.academy_comments where author_id = m.user_id and helpful and status = 'visible')
  );
end $$;
grant execute on function public.academy_profile(uuid) to authenticated;

create or replace function public.academy_leaderboard(p_period text default 'week', p_limit integer default 25) returns table (
  rank bigint, user_id uuid, display_name text, primary_trade text, points bigint, level integer, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_since timestamptz;
begin
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  v_since := case p_period when 'week' then now() - interval '7 days' when 'month' then now() - interval '30 days' else '-infinity'::timestamptz end;
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  return query
  with pts as (
    select pe.user_id, sum(pe.points)::bigint as p from public.academy_point_events pe where pe.created_at >= v_since group by pe.user_id having sum(pe.points) > 0
  ), alltime as (
    select pe.user_id, sum(pe.points)::bigint as p from public.academy_point_events pe group by pe.user_id
  )
  select rank() over (order by pts.p desc), m.user_id, m.display_name, case when m.show_trades then m.primary_trade end, pts.p,
         public.academy_level(coalesce(a.p, 0)), m.user_id = v_uid
  from pts join public.academy_members m on m.user_id = pts.user_id and m.status = 'active' and (m.leaderboard_visible or m.user_id = v_uid)
  left join alltime a on a.user_id = m.user_id
  order by pts.p desc, m.joined_at
  limit p_limit;
end $$;
grant execute on function public.academy_leaderboard(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Community writes
-- ---------------------------------------------------------------------------
create or replace function public.academy_create_post(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.academy_require_writer(); c public.academy_categories; v_kind text := coalesce(p ->> 'kind', 'discussion');
  v_title text := btrim(coalesce(p ->> 'title', '')); v_body text := btrim(coalesce(p ->> 'body', '')); v_id uuid; v_staff boolean;
  v_trade text := nullif(p ->> 'trade_slug', ''); v_link text := nullif(btrim(p ->> 'link_url'), ''); v_image text := nullif(p ->> 'image_path', '');
begin
  v_staff := public.academy_has_role(array['admin', 'moderator'], v_uid);
  select * into c from public.academy_categories where slug = p ->> 'category_slug' and active;
  if not found then raise exception 'bad_category' using errcode = '22023'; end if;
  if c.access = 'premium' and not public.academy_is_premium(v_uid) then raise exception 'premium_required' using errcode = '42501'; end if;
  if (c.staff_only_posting or v_kind = 'announcement') and not v_staff then raise exception 'staff_only' using errcode = '42501'; end if;
  if v_kind not in ('discussion', 'question', 'announcement') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if not v_staff and not public.academy_is_premium(v_uid) and not (select free_members_can_post from public.academy_settings where id) then
    raise exception 'premium_required' using errcode = '42501';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 160 then raise exception 'bad_title' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 10000 then raise exception 'bad_body' using errcode = '22023'; end if;
  if v_trade is not null and not exists (select 1 from public.academy_trades where slug = v_trade and active) then raise exception 'bad_trade' using errcode = '22023'; end if;
  if v_link is not null and (v_link !~ '^https?://[^\s<>"]+$' or char_length(v_link) > 500) then raise exception 'bad_link' using errcode = '22023'; end if;
  if v_image is not null and v_image !~ ('^posts/' || v_uid::text || '/[0-9a-f-]{36}\.webp$') then raise exception 'bad_image' using errcode = '22023'; end if;
  -- Abuse limits: 5 posts per hour, 15 per day, no identical title from the same member within a day.
  if not v_staff then
    if (select count(*) from public.academy_posts where author_id = v_uid and created_at > now() - interval '1 hour') >= 5
       or (select count(*) from public.academy_posts where author_id = v_uid and created_at > now() - interval '1 day') >= 15 then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
    if exists (select 1 from public.academy_posts where author_id = v_uid and lower(title) = lower(v_title) and created_at > now() - interval '1 day') then
      raise exception 'duplicate' using errcode = '23505';
    end if;
  end if;
  insert into public.academy_posts (author_id, category_slug, trade_slug, state_code, kind, title, body, link_url, image_path)
  values (v_uid, c.slug, v_trade, nullif(upper(p ->> 'state_code'), ''), v_kind, v_title, v_body, v_link, v_image)
  returning id into v_id;
  insert into public.academy_badges (user_id, badge, label) values (v_uid, 'first-post', 'First post') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.academy_edit_post(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.academy_require_writer(); v_title text := btrim(coalesce(p ->> 'title', '')); v_body text := btrim(coalesce(p ->> 'body', ''));
  v_link text := nullif(btrim(p ->> 'link_url'), '');
begin
  if char_length(v_title) < 3 or char_length(v_title) > 160 then raise exception 'bad_title' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 10000 then raise exception 'bad_body' using errcode = '22023'; end if;
  if v_link is not null and (v_link !~ '^https?://[^\s<>"]+$' or char_length(v_link) > 500) then raise exception 'bad_link' using errcode = '22023'; end if;
  update public.academy_posts set title = v_title, body = v_body, link_url = v_link, edited_at = now()
  where id = p_id and author_id = v_uid and status = 'visible' and not locked;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.academy_delete_post(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.academy_posts set status = 'removed' where id = p_id and author_id = v_uid and status <> 'removed';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Points earned on removed content are withdrawn.
  delete from public.academy_point_events where target_type = 'post' and target_id = p_id;
  delete from public.academy_point_events where target_type = 'comment' and target_id in (select id from public.academy_comments where post_id = p_id);
end $$;

create or replace function public.academy_comment(p_post_id uuid, p_body text, p_parent_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.academy_require_writer(); p public.academy_posts; v_parent public.academy_comments; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into p from public.academy_posts where id = p_post_id;
  if not found or p.status <> 'visible' or not public.academy_category_readable(p.category_slug, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.locked and not public.academy_has_role(array['admin', 'moderator'], v_uid) then raise exception 'locked' using errcode = '42501'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then raise exception 'bad_body' using errcode = '22023'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.academy_comments where id = p_parent_id;
    if not found or v_parent.post_id <> p_post_id then raise exception 'bad_parent' using errcode = '22023'; end if;
    -- Replies to a reply attach to the top-level comment (one level of threading).
    if v_parent.parent_id is not null then p_parent_id := v_parent.parent_id; end if;
  end if;
  if not public.academy_has_role(array['admin', 'moderator'], v_uid)
     and (select count(*) from public.academy_comments where author_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.academy_comments (post_id, parent_id, author_id, body) values (p_post_id, p_parent_id, v_uid, v_body) returning id into v_id;
  update public.academy_posts set comment_count = comment_count + 1, last_activity_at = now() where id = p_post_id;
  return v_id;
end $$;

create or replace function public.academy_delete_comment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_post uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.academy_comments set status = 'removed', helpful = false where id = p_id and author_id = v_uid and status = 'visible' returning post_id into v_post;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.academy_posts set comment_count = greatest(comment_count - 1, 0), answered_comment_id = nullif(answered_comment_id, p_id) where id = v_post;
  delete from public.academy_point_events where target_type = 'comment' and target_id = p_id;
end $$;

-- Award points with abuse limits: no self-awards, per-pair daily cap, per-earner daily cap.
create or replace function public.academy_award(p_user uuid, p_actor uuid, p_kind text, p_points integer, p_target_type text, p_target_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.academy_settings; v_points integer := p_points; v_today integer; v_pair integer;
begin
  if p_user is null or p_points = 0 or p_user = p_actor then return; end if;
  select * into s from public.academy_settings where id;
  if p_kind = 'reaction_received' then
    select count(*) into v_pair from public.academy_point_events
      where user_id = p_user and actor_id = p_actor and kind = 'reaction_received' and points > 0 and created_at > now() - interval '1 day';
    if v_pair >= s.pair_daily_cap then v_points := 0; end if;
  end if;
  select coalesce(sum(points), 0) into v_today from public.academy_point_events where user_id = p_user and created_at > now() - interval '1 day' and kind <> 'moderator_award';
  if p_kind <> 'moderator_award' and v_today + v_points > s.daily_point_cap then v_points := greatest(s.daily_point_cap - v_today, 0); end if;
  insert into public.academy_point_events (user_id, actor_id, kind, points, target_type, target_id)
  values (p_user, p_actor, p_kind, v_points, p_target_type, p_target_id)
  on conflict do nothing;
end $$;
revoke execute on function public.academy_award(uuid, uuid, text, integer, text, uuid) from public, anon, authenticated;

create or replace function public.academy_react(p_target_type text, p_target_id uuid, p_on boolean default true) returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.academy_require_writer(); v_author uuid; v_post uuid; v_cat text; v_status text; v_count integer; v_new_member boolean;
begin
  if p_target_type = 'post' then
    select author_id, id, category_slug, status into v_author, v_post, v_cat, v_status from public.academy_posts where id = p_target_id;
  elsif p_target_type = 'comment' then
    select c.author_id, c.post_id, p.category_slug, case when c.status = 'visible' and p.status = 'visible' then 'visible' else 'hidden' end
      into v_author, v_post, v_cat, v_status from public.academy_comments c join public.academy_posts p on p.id = c.post_id where c.id = p_target_id;
  else raise exception 'bad_target' using errcode = '22023'; end if;
  if v_author is null or v_status <> 'visible' or not public.academy_category_readable(v_cat, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_author = v_uid then raise exception 'own_content' using errcode = '22023'; end if;
  if p_on then
    insert into public.academy_reactions (user_id, target_type, target_id) values (v_uid, p_target_type, p_target_id) on conflict do nothing;
    if found then
      -- Brand-new accounts (under 24h in the Academy) can react, but their reactions don't award points.
      select joined_at > now() - interval '24 hours' into v_new_member from public.academy_members where user_id = v_uid;
      if not coalesce(v_new_member, false) then
        perform public.academy_award(v_author, v_uid, 'reaction_received', (select points_reaction from public.academy_settings where id), p_target_type, p_target_id);
      end if;
    end if;
  else
    delete from public.academy_reactions where user_id = v_uid and target_type = p_target_type and target_id = p_target_id;
    -- Un-reacting withdraws the point, so toggling can't farm points.
    delete from public.academy_point_events where actor_id = v_uid and kind = 'reaction_received' and target_type = p_target_type and target_id = p_target_id;
  end if;
  select count(*) into v_count from public.academy_reactions where target_type = p_target_type and target_id = p_target_id;
  if p_target_type = 'post' then update public.academy_posts set reaction_count = v_count where id = p_target_id;
  else update public.academy_comments set reaction_count = v_count where id = p_target_id; end if;
  return v_count;
end $$;

create or replace function public.academy_bookmark(p_target_type text, p_target_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.academy_is_member(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  if p_target_type not in ('post', 'course', 'lesson', 'resource') then raise exception 'bad_target' using errcode = '22023'; end if;
  if p_on then
    if (select count(*) from public.academy_bookmarks where user_id = v_uid) >= 1000 then raise exception 'rate_limited' using errcode = '54000'; end if;
    insert into public.academy_bookmarks (user_id, target_type, target_id) values (v_uid, p_target_type, p_target_id) on conflict do nothing;
  else
    delete from public.academy_bookmarks where user_id = v_uid and target_type = p_target_type and target_id = p_target_id;
  end if;
end $$;

create or replace function public.academy_report(p_target_type text, p_target_id uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.academy_can_read(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  if (select count(*) from public.academy_reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.academy_reports (reporter_id, target_type, target_id, reason, details)
  values (v_uid, p_target_type, p_target_id, p_reason, nullif(btrim(left(p_details, 1000)), ''))
  on conflict (reporter_id, target_type, target_id) do update set reason = excluded.reason, details = excluded.details, status = 'open', created_at = now();
end $$;

-- The question's author (or a moderator) marks a reply as the helpful answer.
create or replace function public.academy_mark_helpful(p_comment_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.academy_require_writer(); c public.academy_comments; p public.academy_posts;
begin
  select * into c from public.academy_comments where id = p_comment_id;
  if not found or c.status <> 'visible' then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into p from public.academy_posts where id = c.post_id;
  if p.author_id <> v_uid and not public.academy_has_role(array['admin', 'moderator'], v_uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.academy_comments set helpful = p_on where id = p_comment_id;
  if p_on then
    update public.academy_posts set answered_comment_id = p_comment_id where id = p.id;
    if c.author_id <> p.author_id then
      perform public.academy_award(c.author_id, v_uid, 'helpful_answer', (select points_helpful from public.academy_settings where id), 'comment', p_comment_id);
      insert into public.academy_badges (user_id, badge, label) values (c.author_id, 'helpful-answer', 'Gave a helpful answer') on conflict do nothing;
    end if;
  else
    update public.academy_posts set answered_comment_id = null where id = p.id and answered_comment_id = p_comment_id;
    delete from public.academy_point_events where kind = 'helpful_answer' and target_type = 'comment' and target_id = p_comment_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Moderation (moderators and admins; every action audited)
-- ---------------------------------------------------------------------------
create or replace function public.academy_moderate(p_target_type text, p_target_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_post uuid;
begin
  if not public.academy_has_role(array['admin', 'moderator'], v_uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_target_type = 'post' then
    case p_action
      when 'pin' then update public.academy_posts set pinned = true where id = p_target_id;
      when 'unpin' then update public.academy_posts set pinned = false where id = p_target_id;
      when 'lock' then update public.academy_posts set locked = true where id = p_target_id;
      when 'unlock' then update public.academy_posts set locked = false where id = p_target_id;
      when 'hide' then update public.academy_posts set status = 'hidden' where id = p_target_id;
      when 'remove' then update public.academy_posts set status = 'removed', pinned = false where id = p_target_id;
      when 'restore' then update public.academy_posts set status = 'visible' where id = p_target_id;
      else raise exception 'bad_action' using errcode = '22023';
    end case;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_action in ('hide', 'remove') then
      delete from public.academy_point_events where target_type = 'post' and target_id = p_target_id;
    end if;
  elsif p_target_type = 'comment' then
    if p_action not in ('hide', 'remove', 'restore') then raise exception 'bad_action' using errcode = '22023'; end if;
    update public.academy_comments set status = case p_action when 'restore' then 'visible' when 'hide' then 'hidden' else 'removed' end,
      helpful = case when p_action = 'restore' then helpful else false end
    where id = p_target_id returning post_id into v_post;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.academy_posts set comment_count = (select count(*) from public.academy_comments where post_id = v_post and status = 'visible'),
      answered_comment_id = case when p_action = 'restore' then answered_comment_id else nullif(answered_comment_id, p_target_id) end where id = v_post;
    if p_action in ('hide', 'remove') then delete from public.academy_point_events where target_type = 'comment' and target_id = p_target_id; end if;
  else raise exception 'bad_target' using errcode = '22023'; end if;
  perform public.academy_audit('moderate.' || p_target_type || '.' || p_action, p_target_type, p_target_id::text, jsonb_build_object('note', left(p_note, 500)));
end $$;

create or replace function public.academy_resolve_report(p_report_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.academy_has_role(array['admin', 'moderator'], v_uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('actioned', 'dismissed', 'open') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.academy_reports set status = p_status, resolution_note = nullif(left(p_note, 1000), ''), handled_by = v_uid, handled_at = now() where id = p_report_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.academy_audit('report.' || p_status, 'report', p_report_id::text, null);
end $$;

-- Suspend / ban / restore (moderators may suspend; only admins ban or change roles and tiers).
create or replace function public.academy_set_member(p_user_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_admin boolean := public.academy_has_role(array['admin'], v_uid); v_mod boolean := public.academy_has_role(array['admin', 'moderator'], v_uid);
  v_status text := p ->> 'status'; v_role text := p ->> 'role'; v_tier text := p ->> 'tier';
begin
  if not v_mod then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user_id = v_uid then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  if public.is_admin(p_user_id) and not public.is_admin(v_uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.academy_members where user_id = p_user_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (v_role is not null or v_tier is not null or v_status = 'banned') and not v_admin then raise exception 'admin_only' using errcode = '42501'; end if;
  -- Moderators can't act on other moderators/admins.
  if not v_admin and exists (select 1 from public.academy_members where user_id = p_user_id and role in ('moderator', 'admin')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status is not null and v_status not in ('active', 'suspended', 'banned') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.academy_members set
    status = coalesce(v_status, status),
    suspended_until = case when v_status = 'suspended' then coalesce((p ->> 'suspended_until')::timestamptz, now() + interval '7 days') when v_status is not null then null else suspended_until end,
    role = coalesce(v_role, role),
    tier = coalesce(v_tier, tier)
  where user_id = p_user_id;
  perform public.academy_audit('member.update', 'member', p_user_id::text, (p - 'note') || jsonb_build_object('note', left(p ->> 'note', 500)));
end $$;

-- ---------------------------------------------------------------------------
-- Classroom reads and progress
-- ---------------------------------------------------------------------------
-- Course outline: every published lesson's title with a lock flag, without exposing locked lesson bodies.
create or replace function public.academy_course_outline(p_course_id uuid) returns table (
  id uuid, slug text, title text, summary text, module_id uuid, module_title text, access text, locked boolean,
  estimated_minutes integer, sort_order integer, completed boolean
)
language sql stable security definer set search_path = public as $$
  select l.id, l.slug, l.title, l.summary, l.module_id, mo.title, l.access, not public.academy_lesson_readable(l.access),
         l.estimated_minutes, l.sort_order,
         exists (select 1 from public.academy_lesson_progress pr where pr.user_id = auth.uid() and pr.lesson_id = l.id)
  from public.academy_lessons l
  join public.academy_courses c on c.id = l.course_id
  left join public.academy_modules mo on mo.id = l.module_id
  where l.course_id = p_course_id and (
    (l.status = 'published' and c.status = 'published') or public.academy_has_role(array['admin', 'instructor']))
  order by coalesce(mo.sort_order, 0), l.sort_order, l.title
$$;
grant execute on function public.academy_course_outline(uuid) to anon, authenticated;

create or replace function public.academy_complete_lesson(p_lesson_id uuid, p_done boolean default true, p_quiz_score integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l public.academy_lessons; c public.academy_courses; v_total integer; v_done integer; v_complete boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.academy_is_member(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  select * into l from public.academy_lessons where id = p_lesson_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.academy_courses where id = l.course_id;
  if l.status <> 'published' or c.status <> 'published' or not public.academy_lesson_readable(l.access, v_uid) or not public.academy_lesson_readable(c.access, v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_done then
    insert into public.academy_lesson_progress (user_id, lesson_id, course_id, quiz_score)
    values (v_uid, l.id, l.course_id, case when p_quiz_score between 0 and 100 then p_quiz_score end)
    on conflict (user_id, lesson_id) do update set quiz_score = coalesce(excluded.quiz_score, academy_lesson_progress.quiz_score);
  else
    delete from public.academy_lesson_progress where user_id = v_uid and lesson_id = l.id;
  end if;
  select count(*) into v_total from public.academy_lessons where course_id = c.id and status = 'published';
  select count(*) into v_done from public.academy_lesson_progress pr join public.academy_lessons x on x.id = pr.lesson_id and x.status = 'published' where pr.user_id = v_uid and pr.course_id = c.id;
  if v_total > 0 and v_done >= v_total then
    v_complete := true;
    insert into public.academy_badges (user_id, badge, label) values (v_uid, 'course:' || c.slug, 'Completed ' || left(c.title, 100)) on conflict do nothing;
    perform public.academy_award(v_uid, null, 'course_completed', (select points_course from public.academy_settings where id), 'course', c.id);
  end if;
  return jsonb_build_object('completed_lessons', v_done, 'total_lessons', v_total, 'course_complete', v_complete);
end $$;

-- Progress per course for the signed-in member (course cards).
create or replace function public.academy_my_progress() returns table (course_id uuid, completed integer, total integer)
language sql stable security definer set search_path = public as $$
  select c.id, count(pr.lesson_id)::integer, (select count(*) from public.academy_lessons x where x.course_id = c.id and x.status = 'published')::integer
  from public.academy_courses c
  join public.academy_lesson_progress pr on pr.course_id = c.id and pr.user_id = auth.uid()
  join public.academy_lessons l on l.id = pr.lesson_id and l.status = 'published'
  group by c.id
$$;
grant execute on function public.academy_my_progress() to authenticated;

-- ---------------------------------------------------------------------------
-- Function grants (writes: authenticated only; definer functions check membership/roles inside)
-- ---------------------------------------------------------------------------
revoke execute on function public.academy_join(jsonb), public.academy_update_profile(jsonb), public.academy_leave(), public.academy_touch(),
  public.academy_create_post(jsonb), public.academy_edit_post(uuid, jsonb), public.academy_delete_post(uuid), public.academy_comment(uuid, text, uuid),
  public.academy_delete_comment(uuid), public.academy_react(text, uuid, boolean), public.academy_bookmark(text, uuid, boolean),
  public.academy_report(text, uuid, text, text), public.academy_mark_helpful(uuid, boolean), public.academy_moderate(text, uuid, text, text),
  public.academy_resolve_report(uuid, text, text), public.academy_set_member(uuid, jsonb), public.academy_complete_lesson(uuid, boolean, integer)
  from public, anon;
grant execute on function public.academy_join(jsonb), public.academy_update_profile(jsonb), public.academy_leave(), public.academy_touch(),
  public.academy_create_post(jsonb), public.academy_edit_post(uuid, jsonb), public.academy_delete_post(uuid), public.academy_comment(uuid, text, uuid),
  public.academy_delete_comment(uuid), public.academy_react(text, uuid, boolean), public.academy_bookmark(text, uuid, boolean),
  public.academy_report(text, uuid, text, text), public.academy_mark_helpful(uuid, boolean), public.academy_moderate(text, uuid, text, text),
  public.academy_resolve_report(uuid, text, text), public.academy_set_member(uuid, jsonb), public.academy_complete_lesson(uuid, boolean, integer)
  to authenticated;
grant execute on function public.academy_role(uuid), public.academy_is_member(uuid), public.academy_can_read(uuid), public.academy_has_role(text[], uuid),
  public.academy_is_premium(uuid), public.academy_lesson_readable(text, uuid), public.academy_category_readable(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private media bucket (post images, course covers). Files are written by the server after validation
-- and served through short-lived signed URLs; no browser role can read or write storage objects directly.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy-media', 'academy-media', false, 5242880, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Community categories (shared across trades; trade is a filter on every post)
-- ---------------------------------------------------------------------------
insert into public.academy_categories (slug, name, description, icon, sort_order, access, staff_only_posting) values
  ('announcements', 'Announcements', 'Updates from the Academy team.', 'Megaphone', 0, 'members', true),
  ('general', 'General Contractor Discussion', 'Running a contracting business, across every trade.', 'MessagesSquare', 10, 'members', false),
  ('sales', 'Sales & Closing', 'Leads, appointments, presenting estimates, follow-up and closing.', 'Handshake', 20, 'members', false),
  ('estimating', 'Estimating & Pricing', 'Takeoffs, unit pricing, markup, margin and change orders.', 'Calculator', 30, 'members', false),
  ('project-management', 'Project Management', 'Scheduling, crews, subs, materials and customer updates.', 'CalendarCheck', 40, 'members', false),
  ('accounting', 'Accounting & Finance', 'Job costing, cash flow, invoicing and working with your accountant.', 'Landmark', 50, 'members', false),
  ('hr', 'HR & Hiring', 'Finding, training, paying and keeping good people.', 'Users', 60, 'members', false),
  ('recurring-revenue', 'Recurring Revenue', 'Maintenance plans, service agreements, repeat and referral work.', 'Repeat', 70, 'members', false),
  ('marketing', 'Marketing & Lead Generation', 'Reviews, local search, referrals, ads and your website.', 'Megaphone', 80, 'members', false),
  ('operations', 'Operations', 'Systems, equipment, vehicles, suppliers and day-to-day running.', 'Settings', 90, 'members', false),
  ('trade-advice', 'Trade-Specific Advice', 'Technical and business questions for your trade.', 'Hammer', 100, 'members', false),
  ('software', 'Software Questions', 'Getting the most out of Built2Bid and other tools.', 'Laptop', 110, 'members', false),
  ('industry-news', 'Industry News', 'Material prices, codes, regulations and market changes. Cite your source.', 'Newspaper', 120, 'members', false),
  ('premium-roundtable', 'Premium Roundtable', 'Deeper business conversations for premium members.', 'Crown', 130, 'premium', false)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- AI usage logging: allow kind 'academy_summary' (staff "Draft summary" button, claude-haiku-5-5) in
-- ai_generations so it counts toward the AI budget and admin cost reports. Keeps every value already allowed.
-- ---------------------------------------------------------------------------
do $$
declare d text; vals text[];
begin
  if to_regclass('public.ai_generations') is null then return; end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'ai_generations_kind_check' and conrelid = 'public.ai_generations'::regclass;
  if d is null or d like '%academy_summary%' then return; end if;
  select array_agg(m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') as m;
  vals := coalesce(vals, '{}') || array['academy_summary'];
  alter table public.ai_generations drop constraint ai_generations_kind_check;
  execute format('alter table public.ai_generations add constraint ai_generations_kind_check check (kind = any (%L::text[]))', vals);
end $$;
