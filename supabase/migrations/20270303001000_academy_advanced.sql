-- Academy Advanced (V10.0): paid advanced subjects inside the existing Academy.
--
-- Strictly additive. One Academy, one auth system, one Stripe account and one webhook. What this adds:
--   * academy_adv_subjects        paid subjects (each maps to one or more existing academy_courses rows)
--   * academy_lessons.access      gains 'advanced' (lesson readable only with that subject's entitlement)
--   * academy_adv_price_stages    founding-member price ladder (5 stages, owner-approved prices)
--   * academy_adv_prices          plan + stage + interval + mode -> Stripe price id (no ids in source code)
--   * academy_adv_quotes          server quotes = time-limited founding-slot reservations
--   * academy_adv_memberships     mirror of Academy Stripe subscriptions (never written to public.subscriptions)
--   * academy_adv_founding        one founding position per customer (shared across all packages)
--   * academy_adv_payments        paid / failed / refunded / disputed Academy invoices (counting + analytics)
--   * academy_adv_grants          complimentary educational access (never grants software)
--   * academy_adv_issues          reconciliation problems for admins
--   * academy_edu_*               schema only, for future school / trade-program groups (no billing link)
--   * user_entitlement()          an active All Access membership counts as Individual Unlimited
--
-- Nothing here creates Stripe objects or charges anyone. Live checkout also needs the Netlify switches
-- ACADEMY_ADVANCED_BILLING_ENABLED=on and ACADEMY_ADVANCED_BILLING_LIVE=true plus live price ids in academy_adv_prices.
-- Rollback: docs/academy/rollback_20270303001000.sql

-- ---------------------------------------------------------------------------
-- 1. Settings (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_settings (
  id boolean primary key default true check (id),
  -- Show Advanced Learning to everyone. Staff always see it. The Netlify flag ACADEMY_ADVANCED_ENABLED must also be on.
  enabled boolean not null default false,
  -- Pause new Academy enrollments (existing members keep access; upgrades still work).
  enrollment_open boolean not null default true,
  -- The pricing stage an administrator approved for new members.
  current_stage integer not null default 1,
  -- Automatic threshold-based advancement. Also needs ACADEMY_PRICE_AUTO_ADVANCE_ENABLED=on in Netlify.
  auto_advance boolean not null default false,
  -- How qualifying members are counted for the ladder: lifetime (default, see docs) or currently active.
  count_basis text not null default 'lifetime' check (count_basis in ('lifetime', 'active')),
  -- How long a quoted founding price is held. Stripe Checkout sessions must live at least 30 minutes.
  reservation_minutes integer not null default 35 check (reservation_minutes between 31 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.academy_adv_settings (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Founding-member price ladder
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_price_stages (
  stage integer primary key check (stage between 1 and 20),
  min_members integer not null check (min_members >= 1),   -- first qualifying member number in this stage
  max_members integer check (max_members is null or max_members >= min_members), -- last one (null = no cap)
  one_subject_cents integer not null check (one_subject_cents > 0),
  two_subjects_cents integer not null check (two_subjects_cents > 0),
  all_access_cents integer not null check (all_access_cents > 0),
  -- Library value an administrator wants published before this stage may start (automatic advance checks it too).
  min_published_lessons integer not null default 0 check (min_published_lessons >= 0),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.academy_adv_price_stages (stage, min_members, max_members, one_subject_cents, two_subjects_cents, all_access_cents, min_published_lessons, approved_at) values
  (1, 1, 10, 999, 1499, 2999, 12, now()),
  (2, 11, 25, 1299, 1799, 3499, 24, null),
  (3, 26, 50, 1499, 2099, 3999, 36, null),
  (4, 51, 100, 1799, 2499, 4499, 48, null),
  (5, 101, null, 1999, 2999, 4999, 60, null)
on conflict (stage) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Subjects
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_subjects (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null check (char_length(title) between 3 and 80),
  summary text not null check (char_length(summary) <= 240),
  description text check (char_length(description) <= 4000),
  outcomes text[] not null default '{}' check (cardinality(outcomes) <= 10),
  icon text check (char_length(icon) <= 40),
  cover_theme text not null default 'navy' check (cover_theme in ('navy', 'cyan', 'amber', 'green', 'slate', 'rose')),
  -- draft: staff only. upcoming: shown as "Coming soon", never sold. published: sold once it has real lessons. retired: hidden, existing access kept.
  status text not null default 'draft' check (status in ('draft', 'upcoming', 'published', 'retired')),
  -- Deterministic, admin-configurable "Learn + Expand" pairing (no AI call at checkout).
  recommended_next text references public.academy_adv_subjects (slug) on update cascade on delete set null,
  recommend_reason text check (char_length(recommend_reason) <= 240),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recommended_next is null or recommended_next <> slug)
);

alter table public.academy_courses add column if not exists adv_subject text references public.academy_adv_subjects (slug) on update cascade on delete set null;
create index if not exists academy_courses_adv_subject on public.academy_courses (adv_subject) where adv_subject is not null;

-- Lessons gain the 'advanced' access level (readable with that subject's entitlement only).
do $$ declare r record; begin
  for r in select conname from pg_constraint where conrelid = 'public.academy_lessons'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%access%' loop
    execute format('alter table public.academy_lessons drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.academy_lessons add constraint academy_lessons_access_check check (access in ('public', 'members', 'premium', 'advanced'));

-- ---------------------------------------------------------------------------
-- 4. Stripe price map (mode + plan + stage + interval -> price). Admin-managed, audited, never in source code.
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_prices (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('test', 'live')),
  plan text not null check (plan in ('one_subject', 'two_subjects', 'all_access')),
  stage integer not null references public.academy_adv_price_stages (stage),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  stripe_product_id text not null check (stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
  stripe_price_id text not null unique check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create unique index if not exists academy_adv_prices_one_active on public.academy_adv_prices (mode, plan, stage, billing_interval) where active;

-- A monthly price must charge exactly the stage price for its plan (annual prices are not sold yet).
create or replace function public.academy_adv_prices_guard() returns trigger language plpgsql set search_path = public as $$
declare s public.academy_adv_price_stages;
begin
  select * into s from public.academy_adv_price_stages where stage = new.stage;
  if new.billing_interval = 'month' and new.amount_cents <> (case new.plan when 'one_subject' then s.one_subject_cents when 'two_subjects' then s.two_subjects_cents else s.all_access_cents end) then
    raise exception 'price_amount_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists academy_adv_prices_guard on public.academy_adv_prices;
create trigger academy_adv_prices_guard before insert or update on public.academy_adv_prices for each row execute function public.academy_adv_prices_guard();

-- ---------------------------------------------------------------------------
-- 5. Quotes (= founding-slot reservations)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  kind text not null default 'new' check (kind in ('new', 'upgrade', 'convert')),
  plan text not null check (plan in ('one_subject', 'two_subjects', 'all_access')),
  subjects text[] not null default '{}',
  stage integer not null references public.academy_adv_price_stages (stage),
  amount_cents integer not null check (amount_cents > 0),
  stripe_price_id text not null,
  -- True when this person is not a founding member yet, so the quote holds one slot of the stage.
  holds_slot boolean not null default false,
  status text not null default 'quoted' check (status in ('quoted', 'checkout_open', 'paid', 'expired', 'cancelled', 'superseded', 'failed')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  membership_id uuid,
  convert_subscription_id text check (convert_subscription_id is null or convert_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_checkout_session_id text unique,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_adv_quotes_open on public.academy_adv_quotes (mode, status, expires_at) where status in ('quoted', 'checkout_open');
create unique index if not exists academy_adv_quotes_one_open on public.academy_adv_quotes (user_id) where status in ('quoted', 'checkout_open');

-- ---------------------------------------------------------------------------
-- 6. Memberships (mirror of Academy Stripe subscriptions)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  plan text not null check (plan in ('one_subject', 'two_subjects', 'all_access')),
  subjects text[] not null default '{}',
  stage integer,
  amount_cents integer,
  stripe_price_id text,
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  quote_id uuid references public.academy_adv_quotes (id) on delete set null,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_adv_memberships_user on public.academy_adv_memberships (user_id, status);

-- ---------------------------------------------------------------------------
-- 7. Founding members, payments, grants, issues
-- ---------------------------------------------------------------------------
create table if not exists public.academy_adv_founding (
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  position integer not null check (position >= 1),
  stage_at_join integer not null,
  first_invoice_id text not null,
  first_paid_at timestamptz not null,
  status text not null default 'qualifying' check (status in ('qualifying', 'disqualified')),
  disqualified_reason text check (disqualified_reason in ('refunded', 'dispute_lost', 'fraud', 'duplicate', 'test', 'admin')),
  disqualified_at timestamptz,
  note text check (char_length(note) <= 500),
  primary key (user_id, mode),
  unique (mode, position)
);

create table if not exists public.academy_adv_payments (
  stripe_invoice_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  stripe_subscription_id text,
  status text not null check (status in ('paid', 'failed')),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  amount_due_cents integer not null default 0 check (amount_due_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  dispute_status text check (dispute_status in ('open', 'won', 'lost')),
  billing_reason text,
  occurred_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_adv_payments_user on public.academy_adv_payments (user_id, occurred_at);

create table if not exists public.academy_adv_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null check (scope in ('subjects', 'all_access')),
  subjects text[] not null default '{}',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  reason text not null check (char_length(reason) between 3 and 300),
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (scope = 'all_access' or cardinality(subjects) >= 1)
);
create index if not exists academy_adv_grants_user on public.academy_adv_grants (user_id);

create table if not exists public.academy_adv_issues (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) <= 60),
  ref text check (char_length(ref) <= 200),
  user_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index if not exists academy_adv_issues_open on public.academy_adv_issues (created_at desc) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- 8. Future school / trade-program groups (schema only; no UI, no billing, staff-only)
-- ---------------------------------------------------------------------------
create table if not exists public.academy_edu_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  organization text check (char_length(organization) <= 160),
  instructor_id uuid references auth.users (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  -- Institutional access never creates a commercial subscription and never enrolls students in recurring billing.
  grants_advanced boolean not null default false,
  ends_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.academy_edu_group_members (
  group_id uuid not null references public.academy_edu_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'instructor')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table if not exists public.academy_edu_assignments (
  group_id uuid not null references public.academy_edu_groups (id) on delete cascade,
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  due_on date,
  primary key (group_id, course_id)
);

-- ---------------------------------------------------------------------------
-- 9. RLS: browser roles read only their own billing rows and the public catalog. No browser writes.
-- ---------------------------------------------------------------------------
alter table public.academy_adv_settings enable row level security;
alter table public.academy_adv_price_stages enable row level security;
alter table public.academy_adv_subjects enable row level security;
alter table public.academy_adv_prices enable row level security;
alter table public.academy_adv_quotes enable row level security;
alter table public.academy_adv_memberships enable row level security;
alter table public.academy_adv_founding enable row level security;
alter table public.academy_adv_payments enable row level security;
alter table public.academy_adv_grants enable row level security;
alter table public.academy_adv_issues enable row level security;
alter table public.academy_edu_groups enable row level security;
alter table public.academy_edu_group_members enable row level security;
alter table public.academy_edu_assignments enable row level security;

revoke all on public.academy_adv_settings, public.academy_adv_price_stages, public.academy_adv_subjects, public.academy_adv_prices,
  public.academy_adv_quotes, public.academy_adv_memberships, public.academy_adv_founding, public.academy_adv_payments,
  public.academy_adv_grants, public.academy_adv_issues, public.academy_edu_groups, public.academy_edu_group_members,
  public.academy_edu_assignments from anon, authenticated;
grant select on public.academy_adv_subjects to anon, authenticated;
grant select on public.academy_adv_memberships, public.academy_adv_grants, public.academy_adv_quotes to authenticated;

drop policy if exists academy_adv_subjects_read on public.academy_adv_subjects;
create policy academy_adv_subjects_read on public.academy_adv_subjects for select to anon, authenticated
  using (status in ('upcoming', 'published') or public.academy_has_role(array['admin', 'instructor']));
drop policy if exists academy_adv_memberships_own on public.academy_adv_memberships;
create policy academy_adv_memberships_own on public.academy_adv_memberships for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists academy_adv_grants_own on public.academy_adv_grants;
create policy academy_adv_grants_own on public.academy_adv_grants for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists academy_adv_quotes_own on public.academy_adv_quotes;
create policy academy_adv_quotes_own on public.academy_adv_quotes for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. Entitlements
-- ---------------------------------------------------------------------------
-- Statuses that keep paid access (same rule as Individual Unlimited: past_due keeps access during Stripe retries).
create or replace function public.academy_adv_membership_live(p_status text, p_period_end timestamptz) returns boolean
language sql stable as $$ select p_status in ('active', 'trialing', 'past_due') and (p_period_end is null or p_period_end > now()) $$;

-- What a person may read in Advanced Learning: all_access, the subjects they own, and where it comes from.
create or replace function public.academy_adv_access(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean := false; v_staff boolean := false; v_subjects text[] := '{}'; v_software boolean := false; v_plan text; v_sources text[] := '{}';
begin
  if p_user_id is null then return jsonb_build_object('all_access', false, 'subjects', '[]'::jsonb, 'software', false, 'plan', null, 'sources', '[]'::jsonb, 'staff', false); end if;
  -- Academy admins and instructors can read everything (to review and publish). Moderators cannot.
  if public.is_admin(p_user_id) or public.academy_has_role(array['admin', 'instructor'], p_user_id) then v_staff := true; v_all := true; v_sources := array_append(v_sources, 'staff'); end if;
  -- Paid memberships.
  select bool_or(m.plan = 'all_access'), coalesce(array_agg(distinct s) filter (where s is not null), '{}'),
         (array_agg(m.plan order by case m.plan when 'all_access' then 0 when 'two_subjects' then 1 else 2 end))[1]
    into v_software, v_subjects, v_plan
  from public.academy_adv_memberships m left join lateral unnest(m.subjects) s on true
  where m.user_id = p_user_id and public.academy_adv_membership_live(m.status, m.current_period_end);
  v_software := coalesce(v_software, false);
  if v_plan is not null then v_sources := array_append(v_sources, 'membership'); end if;
  if v_software then v_all := true; end if;
  -- Complimentary educational grants (never software).
  if exists (select 1 from public.academy_adv_grants g where g.user_id = p_user_id and g.revoked_at is null and g.starts_at <= now()
             and (g.expires_at is null or g.expires_at > now()) and g.scope = 'all_access') then v_all := true; v_sources := array_append(v_sources, 'grant'); end if;
  select v_subjects || coalesce(array_agg(distinct s), '{}') into v_subjects from public.academy_adv_grants g, unnest(g.subjects) s
  where g.user_id = p_user_id and g.revoked_at is null and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now()) and g.scope = 'subjects';
  if exists (select 1 from public.academy_adv_grants g where g.user_id = p_user_id and g.revoked_at is null and g.starts_at <= now()
             and (g.expires_at is null or g.expires_at > now()) and g.scope = 'subjects') then v_sources := array_append(v_sources, 'grant'); end if;
  -- Future institutional groups that an admin set to include Advanced Learning.
  if exists (select 1 from public.academy_edu_group_members gm join public.academy_edu_groups g on g.id = gm.group_id
             where gm.user_id = p_user_id and g.status = 'active' and g.grants_advanced and (g.ends_on is null or g.ends_on >= current_date)) then
    v_all := true; v_sources := array_append(v_sources, 'school');
  end if;
  return jsonb_build_object(
    'all_access', v_all, 'subjects', to_jsonb(coalesce((select array_agg(distinct x order by x) from unnest(v_subjects) x), '{}')),
    'software', v_software, 'plan', v_plan, 'sources', to_jsonb(coalesce((select array_agg(distinct x) from unnest(v_sources) x), '{}')), 'staff', v_staff);
end $$;
revoke execute on function public.academy_adv_access(uuid) from public, anon, authenticated;

-- The caller's own access (browser-safe, no argument).
create or replace function public.academy_adv_my_access() returns jsonb
language sql stable security definer set search_path = public as $$ select public.academy_adv_access(auth.uid()) $$;
revoke execute on function public.academy_adv_my_access() from public, anon;
grant execute on function public.academy_adv_my_access() to authenticated;

create or replace function public.academy_adv_has_subject(p_subject text, p_user_id uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare a jsonb;
begin
  if p_subject is null or p_user_id is null then return false; end if;
  a := public.academy_adv_access(p_user_id);
  return coalesce((a->>'all_access')::boolean, false) or (a->'subjects') ? p_subject;
end $$;
grant execute on function public.academy_adv_has_subject(text, uuid) to anon, authenticated;

-- Lesson readability with course context: 'advanced' needs the course's subject; everything else is unchanged.
create or replace function public.academy_lesson_readable_in(p_access text, p_course_id uuid, p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_access = 'advanced'
    then public.academy_adv_has_subject((select c.adv_subject from public.academy_courses c where c.id = p_course_id), p_user_id)
    else public.academy_lesson_readable(p_access, p_user_id) end
$$;
grant execute on function public.academy_lesson_readable_in(text, uuid, uuid) to anon, authenticated;

-- academy_lesson_readable() itself never opens an 'advanced' lesson (its else branch returns false), so any
-- older caller without course context fails closed.

drop policy if exists academy_lessons_read on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to anon, authenticated
  using (
    public.academy_has_role(array['admin', 'instructor'])
    or (status = 'published'
        and exists (select 1 from public.academy_courses c where c.id = course_id and c.status = 'published' and public.academy_lesson_readable(c.access))
        and public.academy_lesson_readable_in(access, course_id))
  );

create or replace function public.academy_course_outline(p_course_id uuid) returns table (
  id uuid, slug text, title text, summary text, module_id uuid, module_title text, access text, locked boolean,
  estimated_minutes integer, sort_order integer, completed boolean
)
language sql stable security definer set search_path = public as $$
  select l.id, l.slug, l.title, l.summary, l.module_id, mo.title, l.access, not public.academy_lesson_readable_in(l.access, l.course_id),
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
  if l.status <> 'published' or c.status <> 'published' or not public.academy_lesson_readable_in(l.access, l.course_id, v_uid) or not public.academy_lesson_readable(c.access, v_uid) then
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

-- ---------------------------------------------------------------------------
-- 11. Catalog helpers
-- ---------------------------------------------------------------------------
-- A subject can be sold only when it is published and has real content: at least one published paid lesson
-- and one published free preview lesson in a published course.
create or replace function public.academy_adv_purchasable(p_subject text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.academy_adv_subjects s where s.slug = p_subject and s.status = 'published')
     and exists (select 1 from public.academy_lessons l join public.academy_courses c on c.id = l.course_id
                 where c.adv_subject = p_subject and c.status = 'published' and l.status = 'published' and l.access = 'advanced')
     and exists (select 1 from public.academy_lessons l join public.academy_courses c on c.id = l.course_id
                 where c.adv_subject = p_subject and c.status = 'published' and l.status = 'published' and l.access in ('public', 'members'))
$$;
grant execute on function public.academy_adv_purchasable(text) to anon, authenticated;

-- Published Advanced library size (for the price-stage value check).
create or replace function public.academy_adv_library() returns table (subjects integer, lessons integer, paid_lessons integer)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.academy_adv_subjects s where public.academy_adv_purchasable(s.slug))::integer,
         count(l.id)::integer, count(l.id) filter (where l.access = 'advanced')::integer
  from public.academy_lessons l join public.academy_courses c on c.id = l.course_id
  join public.academy_adv_subjects s on s.slug = c.adv_subject and s.status = 'published'
  where c.status = 'published' and l.status = 'published'
$$;
grant execute on function public.academy_adv_library() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Founding-member counting and pricing stage
-- ---------------------------------------------------------------------------
-- Qualifying paid Academy members (one per customer, shared across every package). See docs for the policy.
create or replace function public.academy_adv_qualifying_count(p_mode text) returns integer
language plpgsql stable security definer set search_path = public as $$
declare v_basis text;
begin
  select count_basis into v_basis from public.academy_adv_settings where id;
  if v_basis = 'active' then
    return (select count(distinct f.user_id) from public.academy_adv_founding f
            where f.mode = p_mode and f.status = 'qualifying'
              and exists (select 1 from public.academy_adv_memberships m where m.user_id = f.user_id and m.mode = p_mode and public.academy_adv_membership_live(m.status, m.current_period_end)))::integer;
  end if;
  return (select count(*) from public.academy_adv_founding f where f.mode = p_mode and f.status = 'qualifying')::integer;
end $$;
revoke execute on function public.academy_adv_qualifying_count(text) from public, anon, authenticated;

-- The stage a NEW member would get right now. p_extra = slots already held by open reservations.
-- Manual mode (default): always the administrator-approved stage. Automatic mode (setting + Netlify flag): moves up
-- while the approved stage is full AND the next stage's library threshold is met; never past an unapproved stage
-- whose prices are missing from the price map.
create or replace function public.academy_adv_effective_stage(p_mode text, p_extra integer default 0, p_auto_allowed boolean default false) returns integer
language plpgsql stable security definer set search_path = public as $$
declare st public.academy_adv_settings; v_stage integer; v_occupied integer; v_lessons integer; s public.academy_adv_price_stages; n public.academy_adv_price_stages;
begin
  select * into st from public.academy_adv_settings where id;
  v_stage := st.current_stage;
  if not (st.auto_advance and p_auto_allowed) then return v_stage; end if;
  v_occupied := public.academy_adv_qualifying_count(p_mode) + greatest(coalesce(p_extra, 0), 0);
  select lessons into v_lessons from public.academy_adv_library();
  loop
    select * into s from public.academy_adv_price_stages where stage = v_stage;
    exit when s.max_members is null or v_occupied < s.max_members;
    select * into n from public.academy_adv_price_stages where stage = v_stage + 1;
    exit when not found or v_lessons < n.min_published_lessons;
    exit when not exists (select 1 from public.academy_adv_prices p where p.mode = p_mode and p.stage = n.stage and p.active and p.billing_interval = 'month');
    v_stage := n.stage;
  end loop;
  return v_stage;
end $$;
revoke execute on function public.academy_adv_effective_stage(text, integer, boolean) from public, anon, authenticated;

-- Expire stale reservations (called before every quote and by the dashboard).
create or replace function public.academy_adv_expire_quotes() returns integer
language sql security definer set search_path = public as $$
  with x as (update public.academy_adv_quotes set status = 'expired', updated_at = now()
             where status in ('quoted', 'checkout_open') and expires_at <= now() returning 1)
  select count(*)::integer from x
$$;
revoke execute on function public.academy_adv_expire_quotes() from public, anon, authenticated;

-- Server-only: create a quote that reserves a founding slot at the stage a new member gets right now.
-- Serialized per mode with a transaction advisory lock, so two buyers can't both take the last slot of a stage.
create or replace function public.academy_adv_quote(
  p_user_id uuid, p_mode text, p_plan text, p_subjects text[], p_kind text default 'new',
  p_membership_id uuid default null, p_convert_subscription_id text default null, p_auto_allowed boolean default false
) returns public.academy_adv_quotes
language plpgsql security definer set search_path = public as $$
declare st public.academy_adv_settings; q public.academy_adv_quotes; v_holds boolean; v_held integer; v_stage integer; s public.academy_adv_price_stages;
        v_amount integer; v_price text; v_subjects text[]; x text;
begin
  if p_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('test', 'live') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_plan not in ('one_subject', 'two_subjects', 'all_access') then raise exception 'bad_plan' using errcode = '22023'; end if;
  if p_kind not in ('new', 'upgrade', 'convert') then raise exception 'bad_kind' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('academy_adv_quote:' || p_mode));
  select * into st from public.academy_adv_settings where id;
  if not st.enrollment_open and p_kind <> 'upgrade' then raise exception 'enrollment_paused' using errcode = '42501'; end if;

  -- Subjects: exactly 1 / 2 distinct purchasable subjects, or none for All Access.
  v_subjects := coalesce((select array_agg(distinct t) from unnest(coalesce(p_subjects, '{}')) t where t is not null), '{}');
  if p_plan = 'all_access' then v_subjects := '{}';
  elsif cardinality(v_subjects) <> (case p_plan when 'one_subject' then 1 else 2 end) then raise exception 'bad_subjects' using errcode = '22023';
  end if;
  foreach x in array v_subjects loop
    if not public.academy_adv_purchasable(x) then raise exception 'subject_unavailable' using errcode = '22023'; end if;
  end loop;

  perform public.academy_adv_expire_quotes();
  update public.academy_adv_quotes set status = 'superseded', updated_at = now() where user_id = p_user_id and status in ('quoted', 'checkout_open');

  v_holds := not exists (select 1 from public.academy_adv_founding f where f.user_id = p_user_id and f.mode = p_mode);
  select count(*) into v_held from public.academy_adv_quotes where mode = p_mode and status in ('quoted', 'checkout_open') and holds_slot and expires_at > now();
  v_stage := public.academy_adv_effective_stage(p_mode, v_held, p_auto_allowed);
  select * into s from public.academy_adv_price_stages where stage = v_stage;
  v_amount := case p_plan when 'one_subject' then s.one_subject_cents when 'two_subjects' then s.two_subjects_cents else s.all_access_cents end;
  select stripe_price_id into v_price from public.academy_adv_prices
    where mode = p_mode and plan = p_plan and stage = v_stage and billing_interval = 'month' and active and amount_cents = v_amount;
  if v_price is null then raise exception 'price_not_configured' using errcode = 'P0002'; end if;

  insert into public.academy_adv_quotes (user_id, mode, kind, plan, subjects, stage, amount_cents, stripe_price_id, holds_slot, expires_at, membership_id, convert_subscription_id)
  values (p_user_id, p_mode, p_kind, p_plan, v_subjects, v_stage, v_amount, v_price, v_holds, now() + make_interval(mins => st.reservation_minutes), p_membership_id, p_convert_subscription_id)
  returning * into q;
  return q;
end $$;
revoke execute on function public.academy_adv_quote(uuid, text, text, text[], text, uuid, text, boolean) from public, anon, authenticated;

-- Server-only: the customer accepted the shown price. Refuses an expired or replaced quote (the UI then asks again).
create or replace function public.academy_adv_quote_accept(p_quote_id uuid, p_user_id uuid) returns public.academy_adv_quotes
language plpgsql security definer set search_path = public as $$
declare q public.academy_adv_quotes;
begin
  select * into q from public.academy_adv_quotes where id = p_quote_id and user_id = p_user_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if q.status not in ('quoted', 'checkout_open') or q.expires_at <= now() + interval '2 minutes' then raise exception 'quote_expired' using errcode = '22023'; end if;
  -- Accepting holds the price long enough for Stripe Checkout (which needs at least 30 minutes).
  update public.academy_adv_quotes set accepted_at = coalesce(accepted_at, now()), expires_at = greatest(expires_at, now() + interval '31 minutes'), updated_at = now()
  where id = q.id returning * into q;
  return q;
end $$;
revoke execute on function public.academy_adv_quote_accept(uuid, uuid) from public, anon, authenticated;

-- Server-only: quote state from Checkout / subscription events. Paid quotes never move back.
create or replace function public.academy_adv_quote_mark(p_quote_id uuid, p_status text, p_session_id text default null, p_subscription_id text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('checkout_open', 'paid', 'expired', 'cancelled', 'failed') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.academy_adv_quotes set
    status = case when status = 'paid' then 'paid' when p_status = 'checkout_open' and status <> 'quoted' then status else p_status end,
    stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
    stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
    updated_at = now()
  where id = p_quote_id;
end $$;
revoke execute on function public.academy_adv_quote_mark(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Webhook mirrors (service role only)
-- ---------------------------------------------------------------------------
-- Upsert from a Stripe subscription. Out-of-order safe: older events never overwrite newer state.
-- plan/stage/amount come from the price map when the price is known (authoritative), else from metadata.
create or replace function public.academy_adv_apply_subscription(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_price public.academy_adv_prices; v_plan text; v_stage integer; v_amount integer; v_subjects text[]; v_quote uuid; m public.academy_adv_memberships; v_event timestamptz := (p->>'event_created')::timestamptz;
begin
  select * into v_price from public.academy_adv_prices where stripe_price_id = p->>'price_id';
  v_plan := coalesce(v_price.plan, p->>'plan');
  v_stage := coalesce(v_price.stage, nullif(p->>'stage', '')::integer);
  v_amount := coalesce(v_price.amount_cents, nullif(p->>'amount_cents', '')::integer);
  if v_plan is null or v_plan not in ('one_subject', 'two_subjects', 'all_access') then
    insert into public.academy_adv_issues (kind, ref, user_id, details) values ('unknown_plan', p->>'subscription_id', (p->>'user_id')::uuid, p);
    return jsonb_build_object('applied', false, 'reason', 'unknown_plan');
  end if;
  v_subjects := case when v_plan = 'all_access' then '{}'::text[] else coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'subjects', '[]'::jsonb)) x), '{}') end;
  v_quote := nullif(p->>'quote_id', '')::uuid;
  if v_quote is not null and not exists (select 1 from public.academy_adv_quotes where id = v_quote) then v_quote := null; end if;
  if v_plan <> 'all_access' and cardinality(v_subjects) <> (case v_plan when 'one_subject' then 1 else 2 end) then
    insert into public.academy_adv_issues (kind, ref, user_id, details) values ('subject_mismatch', p->>'subscription_id', (p->>'user_id')::uuid, p);
  end if;

  select * into m from public.academy_adv_memberships where stripe_subscription_id = p->>'subscription_id' for update;
  if found and m.last_event_at > v_event then return jsonb_build_object('applied', false, 'reason', 'stale', 'membership_id', m.id); end if;
  insert into public.academy_adv_memberships as t (user_id, mode, stripe_customer_id, stripe_subscription_id, plan, subjects, stage, amount_cents, stripe_price_id, status,
    current_period_end, cancel_at_period_end, canceled_at, ended_at, quote_id, last_event_at)
  values ((p->>'user_id')::uuid, p->>'mode', p->>'customer_id', p->>'subscription_id', v_plan, v_subjects, v_stage, v_amount, p->>'price_id', p->>'status',
    (p->>'current_period_end')::timestamptz, coalesce((p->>'cancel_at_period_end')::boolean, false), (p->>'canceled_at')::timestamptz, (p->>'ended_at')::timestamptz, v_quote, v_event)
  on conflict (stripe_subscription_id) do update set
    plan = excluded.plan, subjects = excluded.subjects, stage = excluded.stage, amount_cents = excluded.amount_cents, stripe_price_id = excluded.stripe_price_id,
    status = excluded.status, current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at, ended_at = excluded.ended_at, quote_id = coalesce(t.quote_id, excluded.quote_id), last_event_at = excluded.last_event_at, updated_at = now()
  returning * into m;
  if v_quote is not null and p->>'status' in ('active', 'trialing') then
    perform public.academy_adv_quote_mark(v_quote, 'paid', null, p->>'subscription_id');
  end if;
  return jsonb_build_object('applied', true, 'membership_id', m.id, 'plan', m.plan, 'live', public.academy_adv_membership_live(m.status, m.current_period_end));
end $$;
revoke execute on function public.academy_adv_apply_subscription(jsonb) from public, anon, authenticated;

-- Record an Academy invoice. The first paid (non-zero) invoice makes the customer a founding member: one position
-- per customer per mode, allocated under a lock so positions are unique and gap-free at allocation time.
create or replace function public.academy_adv_record_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := (p->>'user_id')::uuid; v_mode text := p->>'mode'; v_status text := p->>'status'; v_paid integer := coalesce((p->>'amount_paid')::integer, 0);
        v_pos integer; v_stage integer; f public.academy_adv_founding;
begin
  if v_status not in ('paid', 'failed') then raise exception 'bad_status' using errcode = '22023'; end if;
  insert into public.academy_adv_payments as t (stripe_invoice_id, user_id, mode, stripe_subscription_id, status, amount_paid_cents, amount_due_cents, billing_reason, occurred_at)
  values (p->>'invoice_id', v_user, v_mode, p->>'subscription_id', v_status, v_paid, coalesce((p->>'amount_due')::integer, 0), p->>'billing_reason', coalesce((p->>'occurred_at')::timestamptz, now()))
  on conflict (stripe_invoice_id) do update set
    status = case when t.status = 'paid' then 'paid' else excluded.status end,
    amount_paid_cents = greatest(t.amount_paid_cents, excluded.amount_paid_cents), updated_at = now();
  if v_status <> 'paid' or v_paid <= 0 then return jsonb_build_object('founding', null); end if;

  select * into f from public.academy_adv_founding where user_id = v_user and mode = v_mode;
  if found then return jsonb_build_object('founding', f.position, 'new', false); end if;
  perform pg_advisory_xact_lock(hashtext('academy_adv_founding:' || v_mode));
  select * into f from public.academy_adv_founding where user_id = v_user and mode = v_mode;
  if found then return jsonb_build_object('founding', f.position, 'new', false); end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.academy_adv_founding where mode = v_mode;
  select coalesce(m.stage, (select current_stage from public.academy_adv_settings where id)) into v_stage
    from public.academy_adv_memberships m where m.stripe_subscription_id = p->>'subscription_id';
  v_stage := coalesce(v_stage, (select current_stage from public.academy_adv_settings where id));
  insert into public.academy_adv_founding (user_id, mode, position, stage_at_join, first_invoice_id, first_paid_at)
  values (v_user, v_mode, v_pos, v_stage, p->>'invoice_id', coalesce((p->>'occurred_at')::timestamptz, now()));
  return jsonb_build_object('founding', v_pos, 'new', true);
end $$;
revoke execute on function public.academy_adv_record_invoice(jsonb) from public, anon, authenticated;

-- Refund / dispute evidence for an Academy invoice, then re-check the customer's founding status:
-- disqualified when every paid Academy invoice is fully refunded, or a dispute is lost. A won dispute restores it.
create or replace function public.academy_adv_payment_event(p_invoice text, p_refunded_cents integer default null, p_dispute text default null) returns text
language plpgsql security definer set search_path = public as $$
declare pay public.academy_adv_payments; v_all_refunded boolean; v_lost boolean;
begin
  update public.academy_adv_payments set
    refunded_cents = greatest(refunded_cents, coalesce(p_refunded_cents, refunded_cents)),
    dispute_status = coalesce(p_dispute, dispute_status), updated_at = now()
  where stripe_invoice_id = p_invoice returning * into pay;
  if not found then return 'unknown'; end if;
  select bool_and(refunded_cents >= amount_paid_cents), bool_or(dispute_status = 'lost') into v_all_refunded, v_lost
    from public.academy_adv_payments where user_id = pay.user_id and mode = pay.mode and status = 'paid' and amount_paid_cents > 0;
  if coalesce(v_lost, false) then
    update public.academy_adv_founding set status = 'disqualified', disqualified_reason = 'dispute_lost', disqualified_at = now()
      where user_id = pay.user_id and mode = pay.mode and status = 'qualifying';
  elsif coalesce(v_all_refunded, false) then
    update public.academy_adv_founding set status = 'disqualified', disqualified_reason = 'refunded', disqualified_at = now()
      where user_id = pay.user_id and mode = pay.mode and status = 'qualifying';
  else
    update public.academy_adv_founding set status = 'qualifying', disqualified_reason = null, disqualified_at = null
      where user_id = pay.user_id and mode = pay.mode and status = 'disqualified' and disqualified_reason in ('refunded', 'dispute_lost');
  end if;
  return 'ok';
end $$;
revoke execute on function public.academy_adv_payment_event(text, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Admin: approve a pricing stage (server checks Academy admin first; audited)
-- ---------------------------------------------------------------------------
create or replace function public.academy_adv_set_stage(p_stage integer, p_actor uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_from integer;
begin
  if not exists (select 1 from public.academy_adv_price_stages where stage = p_stage) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select current_stage into v_from from public.academy_adv_settings where id for update;
  update public.academy_adv_settings set current_stage = p_stage, updated_at = now(), updated_by = p_actor where id;
  update public.academy_adv_price_stages set approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, p_actor), updated_at = now() where stage = p_stage;
  insert into public.academy_audit_log (actor_id, action, target_type, target_id, details)
  values (p_actor, 'advanced.stage_set', 'academy_adv_settings', p_stage::text, jsonb_build_object('from', v_from, 'to', p_stage, 'note', left(p_note, 500),
    'qualifying_live', public.academy_adv_qualifying_count('live'), 'library', (select to_jsonb(l) from public.academy_adv_library() l)));
end $$;
revoke execute on function public.academy_adv_set_stage(integer, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15. Individual Unlimited for All Access members (one seat, only while the membership is live)
-- ---------------------------------------------------------------------------
-- Same function as 20261114005000 with one added branch after the Individual Unlimited subscription check.
-- Enterprise seats still win first; complimentary grants still apply after. has_unlimited() and every caller
-- (credits, finalize_bid, library_access, AI quotas) see it unchanged. No Enterprise, Team seats or add-ons.
create or replace function public.user_entitlement(p_user_id uuid)
returns table (tier text, source text, company_id uuid, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid; v_ent record; v_sub_end timestamptz; v_has_sub boolean;
  v_comp_plan text; v_comp_end timestamptz; v_aa boolean; v_aa_end timestamptz;
begin
  if p_user_id is null then return query select 'free'::text, null::text, null::uuid, null::timestamptz; return; end if;

  select m.company_id into v_company from public.company_members m where m.user_id = p_user_id and m.status = 'active';
  if v_company is not null then
    select * into v_ent from public.company_entitlement(v_company);
    if v_ent.active then
      return query select 'enterprise'::text, 'company_seat'::text, v_company, v_ent.expires_at; return;
    end if;
  end if;

  select count(*) > 0, max(s.current_period_end) into v_has_sub, v_sub_end from public.subscriptions s
  where s.user_id = p_user_id and coalesce(s.plan, '') <> 'enterprise'
    and s.status in ('active', 'trialing', 'past_due')
    and (s.current_period_end is null or s.current_period_end > now());
  if v_has_sub then
    return query select 'unlimited'::text, 'subscription'::text, null::uuid, v_sub_end; return;
  end if;

  -- Academy All Access + Estimator: one Individual Unlimited entitlement while the paid membership is live.
  select count(*) > 0, max(a.current_period_end) into v_aa, v_aa_end from public.academy_adv_memberships a
  where a.user_id = p_user_id and a.plan = 'all_access' and public.academy_adv_membership_live(a.status, a.current_period_end);
  if v_aa then
    return query select 'unlimited'::text, 'academy_all_access'::text, null::uuid, v_aa_end; return;
  end if;

  if to_regclass('public.complimentary_grants') is not null then
    execute $q$
      select g.plan, g.expires_at from public.complimentary_grants g
      where g.user_id = $1 and g.status = 'active' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first limit 1
    $q$ into v_comp_plan, v_comp_end using p_user_id;
    if v_comp_plan is not null then
      return query select 'unlimited'::text, 'complimentary'::text, null::uuid, v_comp_end; return;
    end if;
  end if;

  return query select 'free'::text, null::text, null::uuid, null::timestamptz;
end $$;
revoke execute on function public.user_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.user_entitlement(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Grants for the service role (server) and housekeeping
-- ---------------------------------------------------------------------------
grant all on public.academy_adv_settings, public.academy_adv_price_stages, public.academy_adv_subjects, public.academy_adv_prices,
  public.academy_adv_quotes, public.academy_adv_memberships, public.academy_adv_founding, public.academy_adv_payments,
  public.academy_adv_grants, public.academy_adv_issues, public.academy_edu_groups, public.academy_edu_group_members,
  public.academy_edu_assignments to service_role;
grant execute on function public.academy_adv_access(uuid), public.academy_adv_qualifying_count(text), public.academy_adv_effective_stage(text, integer, boolean),
  public.academy_adv_expire_quotes(), public.academy_adv_quote(uuid, text, text, text[], text, uuid, text, boolean), public.academy_adv_quote_accept(uuid, uuid),
  public.academy_adv_quote_mark(uuid, text, text, text), public.academy_adv_apply_subscription(jsonb), public.academy_adv_record_invoice(jsonb),
  public.academy_adv_payment_event(text, integer, text), public.academy_adv_set_stage(integer, uuid, text) to service_role;

drop trigger if exists academy_adv_subjects_updated on public.academy_adv_subjects;
create trigger academy_adv_subjects_updated before update on public.academy_adv_subjects for each row execute function public.academy_touch_updated();

-- ---------------------------------------------------------------------------
-- 17. Admin dashboard helpers (service role only; the admin page re-checks the Academy admin role first)
-- ---------------------------------------------------------------------------
create or replace function public.academy_adv_find_user(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;

create or replace function public.academy_adv_admin_summary(p_mode text) returns jsonb
language sql stable security definer set search_path = public as $$
  with m as (select * from public.academy_adv_memberships where mode = p_mode),
       live as (select * from m where status in ('active', 'trialing', 'past_due')),
       pay as (select * from public.academy_adv_payments where mode = p_mode),
       adv_courses as (select id from public.academy_courses where adv_subject is not null),
       prog as (select p.* from public.academy_lesson_progress p where p.course_id in (select id from adv_courses))
  select jsonb_build_object(
    'qualifying', public.academy_adv_qualifying_count(p_mode),
    'founding_total', (select count(*) from public.academy_adv_founding where mode = p_mode),
    'founding_disqualified', (select count(*) from public.academy_adv_founding where mode = p_mode and status = 'disqualified'),
    'members', (select count(distinct user_id) from live),
    'by_plan', coalesce((select jsonb_object_agg(plan, n) from (select plan, count(*) n from live group by plan) x), '{}'::jsonb),
    'by_stage', coalesce((select jsonb_object_agg(coalesce(stage, 0)::text, n) from (select stage, count(*) n from live group by stage) x), '{}'::jsonb),
    'mrr_cents', coalesce((select sum(amount_cents) from live where status in ('active', 'trialing')), 0),
    'past_due', (select count(*) from live where status = 'past_due'),
    'canceling', (select count(*) from live where cancel_at_period_end),
    'churned_30d', (select count(*) from m where status in ('canceled', 'unpaid', 'incomplete_expired') and coalesce(ended_at, canceled_at, updated_at) > now() - interval '30 days'),
    'paid_30d_cents', coalesce((select sum(amount_paid_cents) from pay where status = 'paid' and occurred_at > now() - interval '30 days'), 0),
    'paid_invoices_30d', (select count(*) from pay where status = 'paid' and amount_paid_cents > 0 and occurred_at > now() - interval '30 days'),
    'failed_30d', (select count(*) from pay where status = 'failed' and occurred_at > now() - interval '30 days'),
    'refunded_cents', coalesce((select sum(refunded_cents) from pay), 0),
    'disputes_open', (select count(*) from pay where dispute_status = 'open'),
    'disputes_lost', (select count(*) from pay where dispute_status = 'lost'),
    'all_access_members', (select count(distinct user_id) from live where plan = 'all_access'),
    'conversions', (select count(*) from public.academy_adv_quotes where kind = 'convert' and status = 'paid' and mode = p_mode),
    'upgrades', (select count(*) from public.academy_adv_quotes where kind = 'upgrade' and status = 'paid' and mode = p_mode),
    'open_quotes', (select count(*) from public.academy_adv_quotes where status in ('quoted', 'checkout_open') and expires_at > now() and mode = p_mode),
    'learners_30d', (select count(distinct user_id) from prog where completed_at > now() - interval '30 days'),
    'completions_30d', (select count(*) from prog where completed_at > now() - interval '30 days'),
    'grants_active', (select count(*) from public.academy_adv_grants where revoked_at is null and starts_at <= now() and (expires_at is null or expires_at > now())),
    'issues_open', (select count(*) from public.academy_adv_issues where resolved_at is null)
  )
$$;
revoke execute on function public.academy_adv_find_user(text), public.academy_adv_admin_summary(text) from public, anon, authenticated;
grant execute on function public.academy_adv_find_user(text), public.academy_adv_admin_summary(text) to service_role;
