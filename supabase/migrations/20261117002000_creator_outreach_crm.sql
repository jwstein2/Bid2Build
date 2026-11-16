-- Creator Partnerships CRM + outreach queue (platform owner only).
--
-- * creator_prospects        Researched YouTube creators, traceable to sources (research jsonb + sources).
-- * creator_cohort_slots     The real partnership capacity of a cohort. A slot is reserved by at most one
--                            prospect at a time (unique), so two creators can never hold the same allocation.
-- * creator_outreach_messages  Drafts -> owner approval -> queued -> sent. At most ONE initial email and ONE
--                            follow-up per prospect, ever (unique index), so the scheduler can't double-send.
-- * creator_outreach_events  Timeline (sent, follow-up scheduled, reply, deadline, disposition, notes).
-- * creator_outreach_suppressions  Permanent do-not-email list (unsubscribe, bounce, owner).
-- * creator_outreach_settings      Singleton. Sending is OFF by default and also requires the server env
--                            CREATOR_OUTREACH_SEND_ENABLED=true. Nothing is ever sent by this migration.
--
-- Service role only (RLS on, no policies). The admin pages call these after requireAdmin(); the scheduler
-- (/api/cron/creator-outreach) uses the service role. Safe to run more than once.

create table if not exists public.creator_prospects (
  id uuid primary key default gen_random_uuid(),
  channel_id text unique check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  channel_name text not null check (char_length(btrim(channel_name)) between 1 and 200),
  handle text check (char_length(handle) <= 100),
  channel_url text check (channel_url is null or (channel_url ~ '^https://' and char_length(channel_url) <= 500)),
  creator_name text check (char_length(creator_name) <= 200),
  first_name text check (char_length(first_name) <= 80),
  company text check (char_length(company) <= 300),
  trade text not null default 'General' check (char_length(trade) <= 120),
  rank integer check (rank between 1 and 1000),
  score integer check (score between 0 and 100),
  score_breakdown jsonb,
  subscribers_text text check (char_length(subscribers_text) <= 40),
  lifetime_views bigint check (lifetime_views >= 0),
  website text check (char_length(website) <= 500),
  contact_email text check (contact_email is null or (contact_email = lower(btrim(contact_email)) and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_source_url text check (contact_source_url is null or (contact_source_url ~ '^https://' and char_length(contact_source_url) <= 1000)),
  contact_status text check (char_length(contact_status) <= 1000),
  contact_verified_at date,
  gift_tier integer not null default 5 check (gift_tier in (5, 10)),
  personalization text check (char_length(personalization) <= 2000),
  research jsonb not null default '{}'::jsonb check (pg_column_size(research) <= 32768),
  sources text[] not null default '{}',
  verification_date date,
  confidence text check (confidence in ('High', 'Medium', 'Low')),
  gaps text check (char_length(gaps) <= 2000),
  first_wave boolean not null default false,
  waitlist boolean not null default false,
  stage text not null default 'researched' check (stage in (
    'researched', 'qualified', 'draft_ready', 'approved', 'initial_sent', 'follow_up_scheduled', 'follow_up_sent',
    'awaiting_response', 'interested', 'questions', 'accepted', 'no_response_first_cohort', 'opportunity_reallocated',
    'declined', 'unsubscribed', 'bounced', 'needs_review')),
  cohort text check (char_length(cohort) <= 80),
  initial_sent_at timestamptz,
  follow_up_due_at timestamptz,
  follow_up_sent_at timestamptz,
  response_deadline_at timestamptz,
  replied_at timestamptz,
  replied_after text check (replied_after in ('initial', 'follow_up')),
  reply_classification text check (reply_classification in ('interested', 'questions', 'not_interested', 'unsubscribe', 'out_of_office', 'bounce', 'ambiguous')),
  postponed_until timestamptz,
  program_id uuid references public.creator_programs (id) on delete set null,
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creator_prospects_stage_idx on public.creator_prospects (stage, trade, rank);
create unique index if not exists creator_prospects_email_idx on public.creator_prospects (contact_email) where contact_email is not null;
create unique index if not exists creator_prospects_name_idx on public.creator_prospects (lower(channel_name)) where channel_id is null;

-- creator_programs.prospect_id (from the program migration) now has its target.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_programs_prospect_fk') then
    alter table public.creator_programs add constraint creator_programs_prospect_fk foreign key (prospect_id) references public.creator_prospects (id) on delete set null;
  end if;
end $$;

create table if not exists public.creator_cohort_slots (
  id uuid primary key default gen_random_uuid(),
  cohort text not null check (char_length(btrim(cohort)) between 1 and 80),
  trade text not null check (char_length(trade) <= 120),
  gift_tier integer not null default 5 check (gift_tier in (5, 10)),
  reserved_prospect_id uuid unique references public.creator_prospects (id) on delete set null,
  reserved_at timestamptz,
  filled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_cohort_slots_reserved check ((reserved_prospect_id is null) = (reserved_at is null))
);

create table if not exists public.creator_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.creator_prospects (id) on delete cascade,
  kind text not null check (kind in ('initial', 'follow_up')),
  to_email text check (to_email is null or to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body_text text not null check (char_length(btrim(body_text)) between 1 and 6000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled')),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  scheduled_for timestamptz,
  attempts integer not null default 0,
  locked_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  rfc_message_id text check (char_length(rfc_message_id) <= 300),
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_outreach_messages_approved check (status in ('draft', 'cancelled') or approved_at is not null)
);
create unique index if not exists creator_outreach_messages_one_idx on public.creator_outreach_messages (prospect_id, kind) where status <> 'cancelled';
create index if not exists creator_outreach_messages_queue_idx on public.creator_outreach_messages (status, scheduled_for);

create table if not exists public.creator_outreach_events (
  id bigint generated always as identity primary key,
  prospect_id uuid not null references public.creator_prospects (id) on delete cascade,
  kind text not null check (kind in ('stage', 'initial_sent', 'follow_up_scheduled', 'follow_up_sent', 'reply', 'deadline_set',
    'no_response', 'reallocated', 'slot_reserved', 'slot_released', 'suppressed', 'bounce', 'send_failed', 'note', 'draft', 'approved')),
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  details jsonb check (details is null or pg_column_size(details) <= 8192)
);
create index if not exists creator_outreach_events_prospect_idx on public.creator_outreach_events (prospect_id, at desc);

create table if not exists public.creator_outreach_suppressions (
  email text primary key check (email = lower(btrim(email))),
  reason text not null check (reason in ('unsubscribe', 'bounce', 'declined', 'owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.creator_outreach_settings (
  id boolean primary key default true check (id),
  -- Owner switch. The server ALSO requires CREATOR_OUTREACH_SEND_ENABLED=true and a provider key.
  sending_enabled boolean not null default false,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  -- The follow-up template text the owner approved (follow-ups use only this text).
  follow_up_subject text not null default 'Re: [original subject]' check (char_length(follow_up_subject) <= 200),
  follow_up_body text check (char_length(follow_up_body) <= 6000),
  follow_up_approved_at timestamptz,
  follow_up_hours integer not null default 72 check (follow_up_hours between 24 and 336),
  daily_send_limit integer not null default 10 check (daily_send_limit between 1 and 100),
  business_hour_start integer not null default 9 check (business_hour_start between 0 and 23),
  business_hour_end integer not null default 17 check (business_hour_end between 1 and 24),
  sender_name text check (char_length(sender_name) <= 120),
  sender_email text check (sender_email is null or sender_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  reply_to text check (reply_to is null or reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- CAN-SPAM: a valid physical postal address in every commercial email.
  postal_address text check (char_length(postal_address) <= 300),
  -- Only mention a cohort deadline when it reflects a real enrollment schedule (owner sets this).
  cohort_label text check (char_length(cohort_label) <= 80),
  cohort_deadline_is_real boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.creator_outreach_settings (id) values (true) on conflict (id) do nothing;

do $do$
declare t text;
begin
  foreach t in array array['creator_prospects', 'creator_cohort_slots', 'creator_outreach_messages', 'creator_outreach_events', 'creator_outreach_suppressions', 'creator_outreach_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['creator_prospects', 'creator_cohort_slots', 'creator_outreach_messages', 'creator_outreach_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $do$;

-- Suppressed emails can never be (re)queued or sent: enforced in the database, not only the app.
create or replace function public.creator_outreach_guard_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'sending', 'sent') and new.to_email is not null
     and exists (select 1 from public.creator_outreach_suppressions s where s.email = lower(new.to_email)) then
    raise exception 'suppressed' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists creator_outreach_messages_guard on public.creator_outreach_messages;
create trigger creator_outreach_messages_guard before insert or update of status, to_email on public.creator_outreach_messages
  for each row execute function public.creator_outreach_guard_message();

-- Release a prospect's slot and reserve it for the next-best eligible creator in the same trade (falling
-- back to any trade). Atomic: the slot row is locked. The successor is moved to 'qualified' so the owner
-- can draft and approve their email: nothing is sent and no subscription is issued here.
-- Returns the successor prospect id, or null if nobody is eligible.
create or replace function public.creator_outreach_reallocate(p_prospect_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_slot public.creator_cohort_slots; v_next uuid;
begin
  select * into v_slot from public.creator_cohort_slots where reserved_prospect_id = p_prospect_id for update;
  if not found then return null; end if;
  update public.creator_cohort_slots set reserved_prospect_id = null, reserved_at = null where id = v_slot.id;
  insert into public.creator_outreach_events (prospect_id, kind, details) values (p_prospect_id, 'slot_released', jsonb_build_object('slot_id', v_slot.id, 'cohort', v_slot.cohort));

  select p.id into v_next from public.creator_prospects p
  where p.stage in ('researched', 'qualified') and p.contact_email is not null
    and not exists (select 1 from public.creator_outreach_suppressions s where s.email = p.contact_email)
    and not exists (select 1 from public.creator_cohort_slots x where x.reserved_prospect_id = p.id)
    and not exists (select 1 from public.creator_outreach_messages m where m.prospect_id = p.id and m.status = 'sent')
  order by (p.trade = v_slot.trade) desc, p.waitlist asc, p.rank asc nulls last, p.score desc nulls last
  limit 1
  for update skip locked;

  if v_next is not null then
    update public.creator_cohort_slots set reserved_prospect_id = v_next, reserved_at = now() where id = v_slot.id;
    update public.creator_prospects set stage = 'qualified', cohort = v_slot.cohort, gift_tier = v_slot.gift_tier where id = v_next;
    insert into public.creator_outreach_events (prospect_id, kind, details) values
      (v_next, 'slot_reserved', jsonb_build_object('slot_id', v_slot.id, 'cohort', v_slot.cohort, 'from_prospect', p_prospect_id, 'reason', 'reallocated')),
      (p_prospect_id, 'reallocated', jsonb_build_object('to_prospect', v_next, 'slot_id', v_slot.id));
    update public.creator_prospects set stage = 'opportunity_reallocated' where id = p_prospect_id and stage = 'no_response_first_cohort';
  end if;
  return v_next;
end $$;

revoke execute on function public.creator_outreach_guard_message(), public.creator_outreach_reallocate(uuid) from public, anon, authenticated;
grant execute on function public.creator_outreach_reallocate(uuid) to service_role;
