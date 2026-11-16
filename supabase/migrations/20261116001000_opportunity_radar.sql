-- Opportunity Radar: owner-only contractor discussion discovery, reply drafting and approval.
--
-- Purely additive: new radar_* tables and functions only. No existing table, row, subscription,
-- credit or attribution record is read or changed. Safe to run more than once.
-- Rollback: supabase/rollback/20261116001000_opportunity_radar_down.sql
--
-- Data minimization: only a public discussion reference (canonical URL), a short title and a capped
-- excerpt the owner pasted are stored. No author names, profile data, emails or phone numbers.
-- Excerpts are cleared when a discussion is removed by its author and by radar_purge_content().
--
-- The two-reply cap is enforced HERE (triggers on radar_drafts), not only in the app:
--   * a draft must be for reply owner_replies_used + 1;
--   * reply 3+ only after the owner explicitly reopens a completed conversation (one reply per reopen);
--   * nothing can be drafted for rejected/archived/completed discussions;
--   * a reply counts only when it moves approved -> posted_manual (owner confirms) or
--     publish_pending -> published (platform confirmed); posted records are immutable.
--
-- Access: service role only (RLS on, no policies, grants revoked), like the other internal tables.
-- The app reaches these tables only after requireAdmin() (platform admin) and audits every action.

-- ---------------------------------------------------------------------------------------------
-- Source operational state (the compliance rules themselves live in code: src/lib/radar/sources.ts)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.radar_source_state (
  source_key text primary key check (source_key ~ '^[a-z0-9_]{2,40}$'),
  enabled boolean not null default true,
  discovery_authorized boolean not null default false,
  publish_authorized boolean not null default false,
  links_allowed boolean,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists radar_source_state_updated on public.radar_source_state;
create trigger radar_source_state_updated before update on public.radar_source_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Discussions (opportunities)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.radar_opportunities (
  id uuid primary key default gen_random_uuid(),
  source_key text not null check (source_key ~ '^[a-z0-9_]{2,40}$'),
  canonical_url text not null check (char_length(canonical_url) between 10 and 2000 and canonical_url ~ '^https://'),
  url_hash text not null unique check (url_hash ~ '^[0-9a-f]{64}$'),
  platform_thread_id text check (char_length(platform_thread_id) <= 200),
  title text not null check (char_length(title) between 1 and 300),
  excerpt text check (char_length(excerpt) <= 1500),
  posted_at timestamptz,
  reply_count integer check (reply_count >= 0),
  reply_allowed boolean not null default true,
  priority text not null check (priority in ('A', 'B', 'C', 'D', 'X')),
  trade text check (char_length(trade) <= 60),
  topics text[] not null default '{}',
  pain_points text[] not null default '{}',
  score smallint not null check (score between 0 and 100),
  score_factors jsonb,
  status text not null default 'new' check (status in ('new', 'awaiting_review', 'approved', 'active', 'followup_pending', 'completed', 'rejected', 'archived')),
  owner_replies_used smallint not null default 0 check (owner_replies_used between 0 and 10),
  reopened boolean not null default false,
  reopened_reason text check (char_length(reopened_reason) <= 500),
  reopened_at timestamptz,
  allow_product_mention boolean not null default false,
  injection_suspected boolean not null default false,
  flagged_unsupported boolean not null default false,
  content_removed_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Reply 3+ is only possible through an explicit reopen.
  constraint radar_opps_cap check (owner_replies_used <= 2 or reopened or status = 'completed')
);
create unique index if not exists radar_opps_thread_uq on public.radar_opportunities (source_key, platform_thread_id) where platform_thread_id is not null;
create index if not exists radar_opps_status_idx on public.radar_opportunities (status, score desc);
create index if not exists radar_opps_created_idx on public.radar_opportunities (created_at desc);
drop trigger if exists radar_opportunities_updated on public.radar_opportunities;
create trigger radar_opportunities_updated before update on public.radar_opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Reply drafts and their publication outcome
-- ---------------------------------------------------------------------------------------------
create table if not exists public.radar_drafts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  reply_number smallint not null check (reply_number between 1 and 10),
  follow_up_text text check (char_length(follow_up_text) <= 2000),
  parent_reply_ref text check (char_length(parent_reply_ref) <= 2000),
  body text not null check (char_length(body) between 1 and 5000),
  engine text not null check (engine in ('rules', 'ai', 'owner')),
  flags jsonb not null default '[]'::jsonb,
  flags_acknowledged boolean not null default false,
  similarity_max numeric(4, 3),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'superseded', 'posted_manual', 'publish_pending', 'published', 'publish_failed')),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  posted_at timestamptz,
  posted_url text check (char_length(posted_url) <= 2000 and posted_url ~ '^https://'),
  platform_reply_id text check (char_length(platform_reply_id) <= 200),
  publish_error text check (char_length(publish_error) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_drafts_opp_idx on public.radar_drafts (opportunity_id, created_at desc);
-- At most one live draft per discussion, and one posted reply per reply number.
create unique index if not exists radar_drafts_live_uq on public.radar_drafts (opportunity_id) where status in ('draft', 'approved', 'publish_pending');
create unique index if not exists radar_drafts_posted_uq on public.radar_drafts (opportunity_id, reply_number) where status in ('posted_manual', 'published');
drop trigger if exists radar_drafts_updated on public.radar_drafts;
create trigger radar_drafts_updated before update on public.radar_drafts
  for each row execute function public.set_updated_at();

create or replace function public.radar_drafts_guard_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.radar_opportunities%rowtype;
begin
  select * into o from public.radar_opportunities where id = new.opportunity_id for update;
  if not found then raise exception 'radar_not_found'; end if;
  if o.status in ('rejected', 'archived') then raise exception 'radar_closed: discussion is %', o.status; end if;
  if o.status = 'completed' and not o.reopened then raise exception 'radar_reply_cap: conversation is complete'; end if;
  if new.reply_number <> o.owner_replies_used + 1 then raise exception 'radar_reply_order: next reply is %', o.owner_replies_used + 1; end if;
  if new.reply_number > 2 and not o.reopened then raise exception 'radar_reply_cap: two-reply limit reached'; end if;
  if new.status <> 'draft' then raise exception 'radar_bad_transition: drafts start as draft'; end if;
  update public.radar_opportunities
     set status = case when new.reply_number = 1 then 'awaiting_review' else 'followup_pending' end
   where id = o.id and status not in ('completed');
  return new;
end $$;
drop trigger if exists radar_drafts_insert_guard on public.radar_drafts;
create trigger radar_drafts_insert_guard before insert on public.radar_drafts
  for each row execute function public.radar_drafts_guard_insert();

create or replace function public.radar_drafts_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.radar_opportunities%rowtype; used smallint;
begin
  if new.opportunity_id <> old.opportunity_id or new.reply_number <> old.reply_number then
    raise exception 'radar_immutable: draft identity cannot change';
  end if;
  -- Posted records are history: never edited, never moved back. The only permitted change is clearing
  -- the stored third-party follow-up text (author removal or retention purge).
  if old.status in ('posted_manual', 'published') then
    if new.follow_up_text is null and new.status = old.status and new.body = old.body
       and new.posted_at is not distinct from old.posted_at and new.posted_url is not distinct from old.posted_url
       and new.platform_reply_id is not distinct from old.platform_reply_id then
      return new;
    end if;
    raise exception 'radar_immutable: posted replies cannot change';
  end if;
  if new.body is distinct from old.body and new.status <> 'draft' then
    raise exception 'radar_bad_transition: edit a draft only while it is a draft';
  end if;
  if new.status <> old.status then
    if not (
      (old.status = 'draft' and new.status in ('approved', 'rejected', 'superseded')) or
      (old.status = 'approved' and new.status in ('draft', 'posted_manual', 'publish_pending', 'rejected', 'superseded')) or
      (old.status = 'publish_pending' and new.status in ('published', 'publish_failed')) or
      (old.status = 'publish_failed' and new.status in ('approved', 'rejected', 'superseded'))
    ) then
      raise exception 'radar_bad_transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'approved' and (new.approved_by is null) then raise exception 'radar_approval_required'; end if;
    if new.status in ('posted_manual', 'publish_pending') and old.status <> 'approved' then raise exception 'radar_approval_required'; end if;
    if new.status = 'published' and new.platform_reply_id is null then raise exception 'radar_unconfirmed: platform confirmation id required'; end if;

    if new.status in ('posted_manual', 'published') then
      new.posted_at := coalesce(new.posted_at, now());
      select * into o from public.radar_opportunities where id = new.opportunity_id for update;
      if o.status in ('rejected', 'archived') then raise exception 'radar_closed: discussion is %', o.status; end if;
      if o.status = 'completed' and not o.reopened then raise exception 'radar_reply_cap: conversation is complete'; end if;
      if new.reply_number <> o.owner_replies_used + 1 then raise exception 'radar_reply_order: next reply is %', o.owner_replies_used + 1; end if;
      used := o.owner_replies_used + 1;
      update public.radar_opportunities
         set owner_replies_used = used,
             status = case when o.reopened or used >= 2 then 'completed' else 'active' end,
             reopened = false
       where id = o.id;
    elsif new.status = 'approved' then
      update public.radar_opportunities set status = 'approved' where id = new.opportunity_id and status in ('awaiting_review', 'followup_pending');
    elsif new.status = 'draft' then
      update public.radar_opportunities
         set status = case when new.reply_number = 1 then 'awaiting_review' else 'followup_pending' end
       where id = new.opportunity_id and status = 'approved';
    elsif new.status in ('rejected', 'superseded') and old.status in ('draft', 'approved', 'publish_failed') then
      -- Back to the state before this draft existed.
      update public.radar_opportunities
         set status = case when owner_replies_used = 0 then 'new' else 'active' end
       where id = new.opportunity_id and status in ('awaiting_review', 'followup_pending', 'approved');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists radar_drafts_update_guard on public.radar_drafts;
create trigger radar_drafts_update_guard before update on public.radar_drafts
  for each row execute function public.radar_drafts_guard_update();

create or replace function public.radar_drafts_no_delete() returns trigger
language plpgsql as $$
begin
  if old.status in ('posted_manual', 'published') and exists (select 1 from public.radar_opportunities where id = old.opportunity_id) then
    raise exception 'radar_immutable: posted replies cannot be deleted';
  end if;
  return old;
end $$;
drop trigger if exists radar_drafts_delete_guard on public.radar_drafts;
create trigger radar_drafts_delete_guard before delete on public.radar_drafts
  for each row execute function public.radar_drafts_no_delete();

-- Reopen: owner-only (enforced in the app), records why. One extra reply per reopen.
create or replace function public.radar_reopen(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'radar_reason_required'; end if;
  update public.radar_opportunities
     set reopened = true, reopened_reason = left(trim(p_reason), 500), reopened_at = now()
   where id = p_id and status = 'completed' and not reopened;
  if not found then raise exception 'radar_bad_transition: only completed conversations can be reopened'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Cost and usage ledger, settings, retention
-- ---------------------------------------------------------------------------------------------
create table if not exists public.radar_usage (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ai_draft', 'ai_classify', 'source_api', 'import')),
  source_key text check (source_key ~ '^[a-z0-9_]{2,40}$'),
  model text check (char_length(model) <= 80),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  quota_units integer check (quota_units >= 0),
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists radar_usage_created_idx on public.radar_usage (created_at desc);

create table if not exists public.radar_settings (
  id boolean primary key default true check (id),
  monthly_budget_usd numeric(8, 2) not null default 5 check (monthly_budget_usd between 0 and 1000),
  ai_drafting_enabled boolean not null default false,
  max_imports_per_day integer not null default 50 check (max_imports_per_day between 1 and 500),
  retention_days integer not null default 90 check (retention_days between 7 and 730),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.radar_settings (id) values (true) on conflict (id) do nothing;
drop trigger if exists radar_settings_updated on public.radar_settings;
create trigger radar_settings_updated before update on public.radar_settings
  for each row execute function public.set_updated_at();

-- Clears stored third-party text that is no longer needed. Keeps the link, scores and counts.
create or replace function public.radar_purge_content(p_days integer default null) returns integer
language plpgsql security definer set search_path = public as $$
declare d integer; n integer; m integer;
begin
  d := coalesce(p_days, (select retention_days from public.radar_settings where id), 90);
  update public.radar_opportunities set excerpt = null
   where excerpt is not null and status in ('rejected', 'archived', 'completed') and updated_at < now() - make_interval(days => d);
  get diagnostics n = row_count;
  update public.radar_drafts d2 set follow_up_text = null
    from public.radar_opportunities o
   where d2.opportunity_id = o.id and d2.follow_up_text is not null and o.status in ('rejected', 'archived', 'completed')
     and o.updated_at < now() - make_interval(days => d);
  get diagnostics m = row_count;
  return n + m;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lock down: service role only
-- ---------------------------------------------------------------------------------------------
alter table public.radar_source_state enable row level security;
alter table public.radar_opportunities enable row level security;
alter table public.radar_drafts enable row level security;
alter table public.radar_usage enable row level security;
alter table public.radar_settings enable row level security;
revoke all on public.radar_source_state, public.radar_opportunities, public.radar_drafts, public.radar_usage, public.radar_settings from anon, authenticated;
grant all on public.radar_source_state, public.radar_opportunities, public.radar_drafts, public.radar_usage, public.radar_settings to service_role;
revoke execute on function public.radar_reopen(uuid, text), public.radar_purge_content(integer),
  public.radar_drafts_guard_insert(), public.radar_drafts_guard_update(), public.radar_drafts_no_delete() from public, anon, authenticated;
grant execute on function public.radar_reopen(uuid, text), public.radar_purge_content(integer) to service_role;
