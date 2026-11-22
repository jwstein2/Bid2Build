-- Sales Hub follow-up and nurture campaigns (2026-11-22).
--
-- After a call, the rep records the outcome. "Answered" opens a follow-up email, "No answer" opens a
-- nurture email. The rep reviews and sends that first email; the system then sends at most two
-- automated follow-ups (default day 3 and day 7), each chosen right before sending from the lead's
-- verified Built2Bid activity. Everything stops on a reply, a booked meeting, an opt-out, "not
-- interested", a paid subscription, a bounce, a manual stop, or after the last email.
--
-- Built on what exists: sales_leads / sales_activities (CRM), sales_suppressions + sales_bad_emails
-- (opt-outs and bounces), rep links /s/<code> (attribution, unchanged), /meet/<slug> booking pages
-- (a new "intro" walkthrough session), Resend (the app's email provider). Commissions are not touched.
--
-- Safety:
--   * OFF by default. Reps see nothing until an administrator turns the feature on, and nothing is
--     sent until send_mode is 'test' (only listed test addresses) or 'live' (platform owner only,
--     after templates are approved and the postal address is set). Nothing is enrolled automatically.
--   * One live campaign per lead and per email address (unique indexes), across all reps.
--   * Activity used for personalization comes only from an account linked to the lead
--     (sales_leads.customer_user_id, set when the business signed up through that rep's link). Reps
--     see milestone names only, never estimates, proposals or financial data.
--   * RLS on, no direct grants. Reps go through sales_campaign_* functions (auth.uid()); the
--     scheduler and admin pages use service-role functions that re-check the caller.
-- Safe to run twice.

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings (one row)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_nurture_settings (
  id boolean primary key default true check (id),
  -- Feature flag: reps see call-outcome campaign controls only when this is on.
  enabled boolean not null default false,
  -- off = nothing sends; test = only test_recipients can receive; live = real leads (owner only).
  send_mode text not null default 'off' check (send_mode in ('off', 'test', 'live')),
  test_recipients text[] not null default '{}',
  -- Emergency pause for automated follow-ups (first emails also wait while paused).
  paused boolean not null default false,
  follow_up_1_days integer not null default 3 check (follow_up_1_days between 1 and 14),
  follow_up_2_days integer not null default 7 check (follow_up_2_days between 2 and 30),
  send_start_hour integer not null default 9 check (send_start_hour between 6 and 20),
  send_end_hour integer not null default 17 check (send_end_hour between 7 and 21),
  weekdays_only boolean not null default true,
  daily_limit integer not null default 100 check (daily_limit between 1 and 1000),
  rep_daily_limit integer not null default 40 check (rep_daily_limit between 1 and 500),
  postal_address text check (postal_address is null or char_length(postal_address) <= 300),
  templates_approved_at timestamptz,
  templates_approved_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (follow_up_2_days > follow_up_1_days),
  check (send_end_hour > send_start_hour)
);
insert into public.sales_nurture_settings (id) values (true) on conflict (id) do nothing;
-- Each rep's own @built2bid.org mailbox: their follow-up emails come from (and replies go to) it.
-- None assigned = that rep's campaigns can't start and their scheduled follow-ups wait until one is.
alter table public.sales_reps add column if not exists nurture_from_email text
  check (nurture_from_email is null or nurture_from_email ~ '^[a-z0-9._+-]+@built2bid\.org$');
create unique index if not exists sales_reps_nurture_from_email_key on public.sales_reps (nurture_from_email) where nurture_from_email is not null;

-- Start from the postal address already approved for creator outreach (the admin can change it).
do $$ begin
  update public.sales_nurture_settings s set postal_address = c.postal_address
  from public.creator_outreach_settings c where s.postal_address is null and c.postal_address is not null and char_length(c.postal_address) <= 300;
exception when undefined_table or undefined_column then null; end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Campaigns, messages, events
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_campaigns (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  -- The rep who started it. Emails go out under this rep's name and link (attribution unchanged).
  rep_id uuid not null references public.sales_reps (id),
  kind text not null check (kind in ('answered', 'no_answer')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'replied', 'meeting_scheduled', 'converted',
    'unsubscribed', 'not_interested', 'stopped', 'failed_delivery')),
  to_email text not null check (to_email = lower(btrim(to_email)) and char_length(to_email) <= 320 and position('@' in to_email) > 1),
  steps_sent integer not null default 0 check (steps_sent between 0 and 3),
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_campaigns_live_lead on public.sales_campaigns (lead_id) where status in ('active', 'paused');
create unique index if not exists sales_campaigns_live_email on public.sales_campaigns (to_email) where status in ('active', 'paused');
create index if not exists sales_campaigns_rep on public.sales_campaigns (rep_id, status, started_at desc);
create index if not exists sales_campaigns_lead on public.sales_campaigns (lead_id, started_at desc);

create table if not exists public.sales_campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sales_campaigns (id) on delete cascade,
  step integer not null check (step between 0 and 2),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'canceled', 'skipped')),
  scheduled_for timestamptz not null,
  attempts integer not null default 0,
  locked_until timestamptz,
  -- Filled for the first email by the rep; for follow-ups only at the moment of sending.
  template_key text check (template_key is null or char_length(template_key) <= 60),
  milestone text check (milestone is null or char_length(milestone) <= 40),
  subject text check (subject is null or char_length(subject) <= 200),
  body_text text check (body_text is null or char_length(body_text) <= 8000),
  to_email text,
  reply_token text unique,
  rfc_message_id text unique,
  provider_message_id text unique,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  unique (campaign_id, step)
);
create index if not exists sales_campaign_messages_due on public.sales_campaign_messages (scheduled_for) where status in ('scheduled', 'failed');
create index if not exists sales_campaign_messages_sent on public.sales_campaign_messages (sent_at) where status = 'sent';

-- Audit trail: every start, send, skip, pause, stop, opt-out and setting change.
create table if not exists public.sales_campaign_events (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.sales_campaigns (id) on delete cascade,
  lead_id uuid references public.sales_leads (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (char_length(kind) between 1 and 40),
  details jsonb,
  at timestamptz not null default now()
);
create index if not exists sales_campaign_events_campaign on public.sales_campaign_events (campaign_id, at desc);
create index if not exists sales_campaign_events_at on public.sales_campaign_events (at desc);

-- Commercial email opt-out for the lead (calls follow the separate Do Not Contact / DNC rules).
alter table public.sales_leads add column if not exists email_opt_out_at timestamptz;

-- Walkthrough bookings that came from a campaign email.
alter table public.sales_bookings add column if not exists campaign_id uuid references public.sales_campaigns (id) on delete set null;

alter table public.sales_nurture_settings enable row level security;
alter table public.sales_campaigns enable row level security;
alter table public.sales_campaign_messages enable row level security;
alter table public.sales_campaign_events enable row level security;
revoke all on public.sales_nurture_settings, public.sales_campaigns, public.sales_campaign_messages, public.sales_campaign_events from public, anon, authenticated;
grant all on public.sales_nurture_settings, public.sales_campaigns, public.sales_campaign_messages, public.sales_campaign_events to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3. "Quick walkthrough" session on the existing /meet booking pages
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_bookings drop constraint if exists sales_bookings_session_check;
alter table public.sales_bookings add constraint sales_bookings_session_check check (session in ('win', 'run', 'grow', 'intro'));
do $$
declare src text;
begin
  select pg_get_functiondef('public.sales_booking_create(text, text, timestamptz, text, text, text, text, text, jsonb, timestamptz)'::regprocedure) into src;
  if src not like '%''grow'', ''intro''%' then
    src := replace(src, '(''win'', ''run'', ''grow'')', '(''win'', ''run'', ''grow'', ''intro'')');
    if src not like '%''grow'', ''intro''%' then raise exception 'sales_booking_create changed; add the intro session by hand'; end if;
    execute src;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------------------------------
-- Why an address must not get sales email (null = OK). Opt-outs and bounces apply to every rep.
create or replace function public.sales_nurture_suppressed(p_email text) returns text
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); v_domain text := split_part(lower(btrim(coalesce(p_email, ''))), '@', 2);
begin
  if position('@' in e) < 2 then return 'no_email'; end if;
  if exists (select 1 from public.sales_suppressions where key = 'e:' || e) then return 'opted_out'; end if;
  -- A business that opted out by website domain (never a shared mailbox provider).
  if v_domain not in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'me.com', 'protonmail.com', 'proton.me')
     and exists (select 1 from public.sales_suppressions where key = 'd:' || v_domain) then return 'opted_out'; end if;
  if exists (select 1 from public.sales_bad_emails where email = e) then return 'bounced'; end if;
  -- Hard bounces and spam complaints from the customer-communications system (all accounts).
  if exists (select 1 from public.comm_suppressions where email = e and account_id is null and scope = 'all') then return 'bounced'; end if;
  if exists (select 1 from public.sales_leads where lower(email) = e and (do_not_contact or email_opt_out_at is not null)) then return 'opted_out'; end if;
  return null;
end $$;

-- Verified milestones for a lead. Full activity only from the account linked to this lead; an
-- account found only by email reveals just "has an account" and "is paying" (so nobody is sold to
-- twice or pointed at sign-up again). Never returns documents, amounts or customer details.
create or replace function public.sales_lead_milestones(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.sales_leads; v_user uuid; v_match text := 'none'; v_paid boolean := false;
  v_started boolean := false; v_completed boolean := false; v_sent boolean := false; v_approved boolean := false; v_top text;
begin
  select * into l from public.sales_leads where id = p_lead;
  if not found then return null; end if;
  if l.customer_user_id is not null then
    v_user := l.customer_user_id; v_match := 'linked';
  elsif l.email is not null then
    select id into v_user from auth.users where lower(email) = lower(btrim(l.email)) limit 1;
    if v_user is not null then v_match := 'email_account'; end if;
  end if;
  if v_user is not null then
    v_paid := exists (select 1 from public.subscriptions s where s.user_id = v_user and s.status in ('active', 'past_due'))
           or exists (select 1 from public.sales_attributions a where a.user_id = v_user and a.first_paid_at is not null and a.ended_at is null);
  end if;
  if v_match = 'linked' then
    v_started := exists (select 1 from public.estimates e where e.user_id = v_user);
    v_completed := exists (select 1 from public.estimates e where e.user_id = v_user and e.status = 'finalized')
                or exists (select 1 from public.analytics_events a where a.user_id = v_user and a.event = 'export_succeeded');
    v_sent := exists (select 1 from public.signing_requests r where r.user_id = v_user);
    v_approved := exists (select 1 from public.signatures s where s.user_id = v_user);
  end if;
  v_top := case when v_paid then 'paid' when v_approved then 'proposal_approved' when v_sent then 'proposal_sent'
    when v_completed then 'estimate_completed' when v_started then 'estimate_started'
    when v_match = 'linked' then 'account_created' when v_match = 'email_account' then 'account_exists' else 'none' end;
  return jsonb_build_object('match', v_match, 'top', v_top, 'paid', v_paid, 'account', v_user is not null,
    'estimate_started', v_started or v_completed, 'estimate_completed', v_completed, 'proposal_sent', v_sent or v_approved, 'proposal_approved', v_approved);
end $$;

-- The next moment inside the sending window (lead's local time, weekdays if set).
create or replace function public.sales_nurture_window(p_at timestamptz, p_tz text, p_start integer, p_end integer, p_weekdays boolean) returns timestamptz
language plpgsql stable set search_path = public as $$
declare loc timestamp := p_at at time zone p_tz; i integer := 0;
begin
  loop
    i := i + 1;
    if p_weekdays and extract(isodow from loc) in (6, 7) then loc := date_trunc('day', loc) + interval '1 day' + make_interval(hours => p_start);
    elsif extract(hour from loc) < p_start then loc := date_trunc('day', loc) + make_interval(hours => p_start);
    elsif extract(hour from loc) >= p_end then loc := date_trunc('day', loc) + interval '1 day' + make_interval(hours => p_start);
    else return loc at time zone p_tz;
    end if;
    exit when i > 10;
  end loop;
  return loc at time zone p_tz;
end $$;

-- What stops ANY send right now (empty = ready).
create or replace function public.sales_nurture_blockers(s public.sales_nurture_settings) returns text[]
language sql stable set search_path = public as $$
  select array_remove(array[
    case when not s.enabled then 'feature_off' end,
    case when s.send_mode = 'off' then 'sending_off' end,
    case when s.send_mode = 'test' and coalesce(array_length(s.test_recipients, 1), 0) = 0 then 'no_test_recipients' end,
    case when s.templates_approved_at is null then 'templates_not_approved' end,
    case when coalesce(char_length(btrim(s.postal_address)), 0) < 10 then 'no_postal_address' end
  ], null)
$$;

-- End a live campaign (any stop condition). Returns true when it was live.
create or replace function public.sales_campaign_end(p_campaign uuid, p_status text, p_reason text, p_actor uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c public.sales_campaigns;
begin
  update public.sales_campaigns set status = p_status, end_reason = left(p_reason, 200), ended_at = now(), ended_by = p_actor, next_send_at = null, updated_at = now()
  where id = p_campaign and status in ('active', 'paused') returning * into c;
  if not found then return false; end if;
  update public.sales_campaign_messages set status = 'canceled', last_error = left('campaign ended: ' || p_status, 300), locked_until = null
  where campaign_id = p_campaign and status in ('scheduled', 'failed');
  insert into public.sales_campaign_events (campaign_id, lead_id, actor_id, kind, details)
  values (c.id, c.lead_id, p_actor, 'ended', jsonb_build_object('status', p_status, 'reason', left(p_reason, 200)));
  return true;
end $$;

create or replace function public.sales_campaign_end_lead(p_lead uuid, p_status text, p_reason text, p_actor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in select id from public.sales_campaigns where lead_id = p_lead and status in ('active', 'paused') loop
    if public.sales_campaign_end(r.id, p_status, p_reason, p_actor) then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.sales_campaign_end_email(p_email text, p_status text, p_reason text, p_actor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in select id from public.sales_campaigns where to_email = lower(btrim(p_email)) and status in ('active', 'paused') loop
    if public.sales_campaign_end(r.id, p_status, p_reason, p_actor) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Automatic stop conditions (triggers)
-- ---------------------------------------------------------------------------------------------------
-- A logged reply or a booked/held meeting stops the campaign.
create or replace function public.sales_campaign_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'reply' then
    perform public.sales_campaign_end_lead(new.lead_id, 'replied', 'The lead replied', new.actor_id);
  elsif new.kind = 'meeting' and coalesce(new.disposition, '') in ('scheduled', 'held') then
    perform public.sales_campaign_end_lead(new.lead_id, 'meeting_scheduled', 'A meeting was scheduled', new.actor_id);
  end if;
  return new;
end $$;
drop trigger if exists sales_activities_campaign_stop on public.sales_activities;
create trigger sales_activities_campaign_stop after insert or update of disposition on public.sales_activities for each row execute function public.sales_campaign_on_activity();

-- Lead changes: opt-out, paying, lost, new email, bad email, new owner.
create or replace function public.sales_campaign_on_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.do_not_contact and not old.do_not_contact) or (new.email_opt_out_at is not null and old.email_opt_out_at is null) then
    perform public.sales_campaign_end_lead(new.id, 'unsubscribed', 'The lead opted out', null);
  elsif new.stage = 'paying' and old.stage <> 'paying' then
    perform public.sales_campaign_end_lead(new.id, 'converted', 'Became a paying customer', null);
  elsif new.stage = 'lost' and old.stage <> 'lost' then
    perform public.sales_campaign_end_lead(new.id, 'not_interested', coalesce('Marked lost: ' || nullif(btrim(new.lost_reason), ''), 'Marked lost'), null);
  elsif new.email_status in ('bounced', 'undeliverable') and old.email_status is distinct from new.email_status then
    perform public.sales_campaign_end_lead(new.id, 'failed_delivery', 'The email address can''t receive mail', null);
  elsif lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
    perform public.sales_campaign_end_lead(new.id, 'stopped', 'The lead''s email address changed', null);
  elsif new.assigned_rep is distinct from old.assigned_rep then
    perform public.sales_campaign_end_lead(new.id, 'stopped', 'The lead moved to another rep', null);
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_campaign_stop on public.sales_leads;
create trigger sales_leads_campaign_stop after update on public.sales_leads for each row execute function public.sales_campaign_on_lead();

-- Opt-outs and bounces apply to every campaign to that address, whichever rep owns it.
create or replace function public.sales_campaign_on_suppression() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.key like 'e:%' then perform public.sales_campaign_end_email(substr(new.key, 3), 'unsubscribed', 'Address is on the opt-out list', null); end if;
  return new;
end $$;
drop trigger if exists sales_suppressions_campaign_stop on public.sales_suppressions;
create trigger sales_suppressions_campaign_stop after insert on public.sales_suppressions for each row execute function public.sales_campaign_on_suppression();

create or replace function public.sales_campaign_on_bad_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_campaign_end_email(new.email, 'failed_delivery', 'The address bounced', null);
  return new;
end $$;
drop trigger if exists sales_bad_emails_campaign_stop on public.sales_bad_emails;
create trigger sales_bad_emails_campaign_stop after insert on public.sales_bad_emails for each row execute function public.sales_campaign_on_bad_email();

-- A booking from the lead's address (or through a campaign link) stops the campaign and is logged on
-- the lead as a scheduled meeting.
create or replace function public.sales_campaign_on_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.sales_campaigns;
begin
  if new.status <> 'booked' or new.rescheduled_from is not null then return new; end if;
  for c in select * from public.sales_campaigns where status in ('active', 'paused') and (to_email = new.customer_email or id = new.campaign_id) loop
    if public.sales_campaign_end(c.id, 'meeting_scheduled', 'Booked a meeting', null) then
      insert into public.sales_activities (lead_id, rep_id, kind, body, disposition, evidence, actor_label, occurred_at)
      values (c.lead_id, c.rep_id, 'meeting', 'Booked a ' || case new.session when 'intro' then 'walkthrough' else 'session' end || ' for '
        || to_char(new.starts_at at time zone 'America/Chicago', 'Mon DD, HH12:MI AM') || ' CT through the booking page.', 'scheduled', 'system', 'Booking page', now());
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists sales_bookings_campaign_stop on public.sales_bookings;
create trigger sales_bookings_campaign_stop after insert or update of campaign_id on public.sales_bookings for each row execute function public.sales_campaign_on_booking();

-- ---------------------------------------------------------------------------------------------------
-- 6. Rep functions (signed-in rep, auth.uid())
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_campaign_json(c public.sales_campaigns, p_bodies boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'to_email', c.to_email, 'steps_sent', c.steps_sent,
    'first_sent_at', c.first_sent_at, 'last_sent_at', c.last_sent_at, 'next_send_at', c.next_send_at, 'end_reason', c.end_reason,
    'started_at', c.started_at, 'paused_at', c.paused_at, 'ended_at', c.ended_at, 'rep_name', (select full_name from public.sales_reps where id = c.rep_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'step', m.step, 'status', m.status, 'scheduled_for', m.scheduled_for,
        'sent_at', m.sent_at, 'delivered_at', m.delivered_at, 'bounced_at', m.bounced_at, 'template_key', m.template_key, 'milestone', m.milestone,
        'subject', m.subject, 'body', case when p_bodies then m.body_text end, 'error', case when m.status in ('failed', 'canceled', 'skipped') then m.last_error end) order by m.step)
      from public.sales_campaign_messages m where m.campaign_id = c.id), '[]'::jsonb))
$$;

-- Everything the lead page's campaign panel needs.
create or replace function public.sales_campaign_lead(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; s public.sales_nurture_settings; v_live public.sales_campaigns; v_ms jsonb;
  v_sup text; v_slug text; v_answered text; v_no text; v_other boolean;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into l from public.sales_leads where id = p_lead;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into s from public.sales_nurture_settings where id;
  select * into v_live from public.sales_campaigns where lead_id = l.id and status in ('active', 'paused');
  v_ms := public.sales_lead_milestones(l.id);
  v_sup := case when l.email is null then 'no_email' when l.email_status in ('bounced', 'undeliverable') then 'bounced' else public.sales_nurture_suppressed(l.email) end;
  select booking_slug into v_slug from public.sales_rep_calendar where rep_id = rep.id and booking_enabled;
  v_other := l.email is not null and exists (select 1 from public.sales_campaigns c where c.to_email = lower(btrim(l.email)) and c.status in ('active', 'paused') and c.lead_id <> l.id);
  -- Can each campaign start now? (Server re-checks everything on send.)
  v_answered := case when array_length(public.sales_nurture_blockers(s), 1) > 0 then 'not_ready' when rep.nurture_from_email is null then 'no_sender' when l.assigned_rep is distinct from rep.id then 'not_your_lead'
    when v_sup is not null then v_sup when l.stage = 'paying' or (v_ms ->> 'paid')::boolean then 'customer' when v_other then 'other_campaign'
    when v_live.id is not null and v_live.kind = 'answered' then 'already_active'
    when exists (select 1 from public.sales_campaigns c where c.lead_id = l.id and c.kind = 'answered' and c.first_sent_at is not null and (v_live.id is null or c.id <> v_live.id)) then 'already_ran'
    else 'ok' end;
  v_no := case when v_answered in ('not_ready', 'no_sender', 'not_your_lead', 'no_email', 'bounced', 'opted_out', 'customer', 'other_campaign') then v_answered
    when v_live.id is not null then 'already_active'
    when exists (select 1 from public.sales_campaigns c where c.lead_id = l.id and c.first_sent_at is not null) then 'already_ran'
    else 'ok' end;
  return jsonb_build_object(
    'enabled', s.enabled, 'send_mode', s.send_mode, 'paused', s.paused, 'blockers', to_jsonb(public.sales_nurture_blockers(s)),
    'test_recipients', case when s.send_mode = 'test' then to_jsonb(s.test_recipients) else '[]'::jsonb end,
    'follow_up_days', jsonb_build_array(s.follow_up_1_days, s.follow_up_2_days),
    'suppressed', v_sup, 'milestones', v_ms - 'match' || jsonb_build_object('linked', v_ms ->> 'match' = 'linked'),
    'can_start', jsonb_build_object('answered', v_answered, 'no_answer', v_no),
    'live', case when v_live.id is null then null else public.sales_campaign_json(v_live, true) end,
    'history', coalesce((select jsonb_agg(public.sales_campaign_json(c, true) order by c.started_at desc) from public.sales_campaigns c where c.lead_id = l.id and (v_live.id is null or c.id <> v_live.id)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'details', e.details, 'at', e.at) order by e.at desc)
      from (select * from public.sales_campaign_events e where e.lead_id = l.id order by e.at desc limit 40) e), '[]'::jsonb),
    'rep', jsonb_build_object('full_name', rep.full_name, 'email', rep.email, 'phone', rep.phone, 'code', rep.code, 'booking_slug', v_slug, 'from_email', rep.nurture_from_email),
    'postal_address', s.postal_address);
end $$;

-- Start a campaign with the rep-reviewed first email. The app sends it right after this returns.
create or replace function public.sales_campaign_start(p_lead uuid, p_kind text, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p_now timestamptz := now(); rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; s public.sales_nurture_settings; v_live public.sales_campaigns;
  v_email text; v_ms jsonb; v_sup text; c public.sales_campaigns; v_msg uuid; v_today integer;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if not ('send_own_outreach' = any (public.sales_capabilities(auth.uid()))) then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_kind not in ('answered', 'no_answer') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(p_subject)), 0) not between 3 and 200 or coalesce(char_length(btrim(p_body)), 0) not between 20 and 6000 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_subject ~ '\{\{|\}\}' or p_body ~ '\{\{|\}\}' then raise exception 'unfilled_placeholder' using errcode = '22023'; end if;
  select * into s from public.sales_nurture_settings where id;
  if array_length(public.sales_nurture_blockers(s), 1) > 0 then raise exception 'not_ready' using errcode = '22023'; end if;
  if s.paused then raise exception 'paused' using errcode = '22023'; end if;
  if rep.nurture_from_email is null then raise exception 'no_sender' using errcode = '22023'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Only the lead's own rep emails it, so two reps never write to the same business.
  if l.assigned_rep is distinct from rep.id then raise exception 'not_your_lead' using errcode = '42501'; end if;
  v_email := lower(btrim(coalesce(l.email, '')));
  if l.email_status in ('bounced', 'undeliverable') then raise exception 'bounced' using errcode = '22023'; end if;
  v_sup := public.sales_nurture_suppressed(v_email);
  if v_sup is not null then raise exception '%', v_sup using errcode = '22023'; end if;
  if s.send_mode = 'test' and not (v_email = any (s.test_recipients)) then raise exception 'not_test_recipient' using errcode = '22023'; end if;
  v_ms := public.sales_lead_milestones(l.id);
  if l.stage = 'paying' or (v_ms ->> 'paid')::boolean then raise exception 'customer' using errcode = '22023'; end if;
  select count(*) into v_today from public.sales_campaign_messages m join public.sales_campaigns c2 on c2.id = m.campaign_id
    where c2.rep_id = rep.id and m.status in ('sent', 'sending') and m.sent_at >= p_now - interval '24 hours';
  if v_today >= s.rep_daily_limit then raise exception 'rep_limit' using errcode = '22023'; end if;
  select * into v_live from public.sales_campaigns where lead_id = l.id and status in ('active', 'paused') for update;
  if found then
    -- They didn't answer before but talked now: the nurture stops and the follow-up starts. Never both.
    if p_kind = 'answered' and v_live.kind = 'no_answer' then
      perform public.sales_campaign_end(v_live.id, 'stopped', 'Talked to them: switched to the follow-up campaign', auth.uid());
    else
      raise exception 'already_active' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.sales_campaigns where to_email = v_email and status in ('active', 'paused')) then raise exception 'other_campaign' using errcode = '22023'; end if;
  -- Completed sequences never restart. A nurture can't follow any earlier campaign; a follow-up runs once.
  if exists (select 1 from public.sales_campaigns where lead_id = l.id and first_sent_at is not null and (p_kind = 'no_answer' or kind = 'answered')) then
    raise exception 'already_ran' using errcode = '22023';
  end if;
  insert into public.sales_campaigns (lead_id, rep_id, kind, to_email, started_by, started_at, next_send_at)
  values (l.id, rep.id, p_kind, v_email, auth.uid(), p_now, p_now) returning * into c;
  insert into public.sales_campaign_messages (campaign_id, step, status, scheduled_for, template_key, milestone, subject, body_text, to_email)
  values (c.id, 0, 'scheduled', p_now, p_kind || '_initial', v_ms ->> 'top', left(btrim(p_subject), 200), left(btrim(p_body), 8000), v_email) returning id into v_msg;
  insert into public.sales_campaign_events (campaign_id, lead_id, actor_id, kind, details)
  values (c.id, l.id, auth.uid(), 'started', jsonb_build_object('kind', p_kind, 'mode', s.send_mode));
  return jsonb_build_object('campaign_id', c.id, 'message_id', v_msg);
end $$;

-- Pause, resume or stop (the rep who owns it, or a sales administrator through the admin wrapper).
create or replace function public.sales_campaign_control_as(p_actor uuid, p_campaign uuid, p_action text, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.sales_campaigns; l public.sales_leads; s public.sales_nurture_settings;
begin
  select * into c from public.sales_campaigns where id = p_campaign for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action = 'pause' then
    if c.status <> 'active' then raise exception 'not_active' using errcode = '22023'; end if;
    update public.sales_campaigns set status = 'paused', paused_at = p_now, updated_at = now() where id = c.id;
  elsif p_action = 'resume' then
    if c.status <> 'paused' then raise exception 'not_paused' using errcode = '22023'; end if;
    select * into l from public.sales_leads where id = c.lead_id;
    select * into s from public.sales_nurture_settings where id;
    update public.sales_campaigns set status = 'active', paused_at = null, updated_at = now() where id = c.id;
    -- Anything that came due while paused goes out at the next good time, not in a burst.
    update public.sales_campaign_messages set scheduled_for = public.sales_nurture_window(greatest(scheduled_for, p_now), public.sales_state_tz(l.state), s.send_start_hour, s.send_end_hour, s.weekdays_only)
    where campaign_id = c.id and status in ('scheduled', 'failed') and scheduled_for < p_now;
    update public.sales_campaigns set next_send_at = (select min(scheduled_for) from public.sales_campaign_messages where campaign_id = c.id and status in ('scheduled', 'failed')) where id = c.id;
  elsif p_action = 'stop' then
    if not public.sales_campaign_end(c.id, 'stopped', 'Stopped by hand', p_actor) then raise exception 'not_active' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true);
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  insert into public.sales_campaign_events (campaign_id, lead_id, actor_id, kind, details) values (c.id, c.lead_id, p_actor, p_action || 'd', null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sales_campaign_control(p_campaign uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); c public.sales_campaigns; l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into c from public.sales_campaigns where id = p_campaign;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into l from public.sales_leads where id = c.lead_id;
  if c.rep_id <> rep.id and not public.sales_crm_can_see(rep, l) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return public.sales_campaign_control_as(auth.uid(), p_campaign, p_action);
end $$;

-- Campaign results for one rep (or the whole team when p_rep is null). Counts only, no lead data.
create or replace function public.sales_campaign_stats_for(p_rep uuid, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_acc integer := 0; v_start integer := 0; v_done integer := 0; m jsonb; x record;
begin
  for x in select distinct c.lead_id from public.sales_campaigns c where (p_rep is null or c.rep_id = p_rep) and c.started_at >= p_since and c.first_sent_at is not null loop
    m := public.sales_lead_milestones(x.lead_id);
    if m ->> 'match' = 'linked' then
      v_acc := v_acc + 1;
      if (m ->> 'estimate_started')::boolean then v_start := v_start + 1; end if;
      if (m ->> 'estimate_completed')::boolean then v_done := v_done + 1; end if;
    end if;
  end loop;
  select jsonb_build_object(
    'nurture_active', count(*) filter (where kind = 'no_answer' and status in ('active', 'paused')),
    'follow_up_active', count(*) filter (where kind = 'answered' and status in ('active', 'paused')),
    'paused', count(*) filter (where status = 'paused'),
    'replied', count(*) filter (where status = 'replied' and started_at >= p_since),
    'meetings', count(*) filter (where status = 'meeting_scheduled' and started_at >= p_since),
    'converted', count(*) filter (where status = 'converted' and started_at >= p_since),
    'completed', count(*) filter (where status = 'completed' and started_at >= p_since),
    'unsubscribed', count(*) filter (where status = 'unsubscribed' and started_at >= p_since),
    'failed', count(*) filter (where status = 'failed_delivery' and started_at >= p_since),
    'started', count(*) filter (where started_at >= p_since and first_sent_at is not null),
    -- Replies and meetings the rep hasn't followed up on since, bounces, and long pauses.
    'attention', count(*) filter (where (status in ('replied', 'meeting_scheduled') and ended_at >= p_since and not exists (
        select 1 from public.sales_activities a where a.lead_id = c.lead_id and a.evidence = 'manual' and a.kind in ('call', 'email', 'text', 'meeting', 'note') and a.occurred_at > c.ended_at))
      or (status = 'failed_delivery' and ended_at >= p_since) or (status = 'paused' and paused_at < now() - interval '7 days'))
  ) || jsonb_build_object('accounts_created', v_acc, 'estimates_started', v_start, 'estimates_completed', v_done,
      'emails_sent', (select count(*) from public.sales_campaign_messages m join public.sales_campaigns c2 on c2.id = m.campaign_id
        where (p_rep is null or c2.rep_id = p_rep) and m.status = 'sent' and m.sent_at >= p_since))
  into r from public.sales_campaigns c where p_rep is null or c.rep_id = p_rep;
  return r;
end $$;

create or replace function public.sales_my_campaign_stats(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); s public.sales_nurture_settings;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into s from public.sales_nurture_settings where id;
  return public.sales_campaign_stats_for(rep.id, now() - make_interval(days => greatest(1, least(p_days, 365))))
    || jsonb_build_object('enabled', s.enabled, 'needs_attention', coalesce((
      select jsonb_agg(jsonb_build_object('lead_id', c.lead_id, 'company_name', l.company_name, 'status', c.status, 'at', coalesce(c.ended_at, c.paused_at)) order by coalesce(c.ended_at, c.paused_at) desc)
      from public.sales_campaigns c join public.sales_leads l on l.id = c.lead_id
      where c.rep_id = rep.id and ((c.status in ('replied', 'meeting_scheduled') and c.ended_at > now() - interval '30 days' and not exists (
          select 1 from public.sales_activities a where a.lead_id = c.lead_id and a.evidence = 'manual' and a.kind in ('call', 'email', 'text', 'meeting', 'note') and a.occurred_at > c.ended_at))
        or (c.status = 'failed_delivery' and c.ended_at > now() - interval '30 days') or (c.status = 'paused' and c.paused_at < now() - interval '7 days'))), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Scheduler (service role only)
-- ---------------------------------------------------------------------------------------------------
-- Claim due messages, with everything needed to choose and render the email. Respects the pause
-- switch, send mode, sending window and daily limits. Claimed rows are locked for 2 minutes.
create or replace function public.sales_campaign_claim(p_now timestamptz default now(), p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_nurture_settings; v_left integer; v_out jsonb := '[]'::jsonb; m record; v_rep_sent integer; v_tz text; v_local timestamp;
begin
  select * into s from public.sales_nurture_settings where id;
  if s.paused or array_length(public.sales_nurture_blockers(s), 1) > 0 then
    return jsonb_build_object('blocked', true, 'paused', s.paused, 'blockers', to_jsonb(public.sales_nurture_blockers(s)), 'messages', '[]'::jsonb);
  end if;
  -- A worker that died mid-send: retry later (the provider idempotency key stops a double send).
  update public.sales_campaign_messages set status = 'failed', locked_until = null, last_error = 'interrupted'
  where status = 'sending' and locked_until < p_now;
  v_left := s.daily_limit - (select count(*) from public.sales_campaign_messages where status in ('sent', 'sending') and sent_at >= p_now - interval '24 hours');
  for m in
    select mm.*, c.kind, c.rep_id, c.lead_id, c.status as campaign_status, c.to_email as campaign_email, c.first_sent_at
    from public.sales_campaign_messages mm join public.sales_campaigns c on c.id = mm.campaign_id
    where mm.status in ('scheduled', 'failed') and mm.attempts < 3 and mm.scheduled_for <= p_now and c.status = 'active'
    order by mm.scheduled_for limit greatest(1, least(p_limit, 50)) * 3
    for update of mm skip locked
  loop
    exit when v_left <= 0 or jsonb_array_length(v_out) >= least(p_limit, 50);
    select count(*) into v_rep_sent from public.sales_campaign_messages x join public.sales_campaigns y on y.id = x.campaign_id
      where y.rep_id = m.rep_id and x.status in ('sent', 'sending') and x.sent_at >= p_now - interval '24 hours';
    continue when v_rep_sent >= s.rep_daily_limit;
    -- No @built2bid.org mailbox assigned to the rep: hold (it stays scheduled and goes once one is).
    continue when (select nurture_from_email from public.sales_reps where id = m.rep_id) is null;
    -- Follow-ups only inside the lead's sending window (the first email went out when the rep clicked Send).
    if m.step > 0 then
      select public.sales_state_tz(state) into v_tz from public.sales_leads where id = m.lead_id;
      v_local := p_now at time zone v_tz;
      if (s.weekdays_only and extract(isodow from v_local) in (6, 7)) or extract(hour from v_local) < s.send_start_hour or extract(hour from v_local) >= s.send_end_hour then
        update public.sales_campaign_messages set scheduled_for = public.sales_nurture_window(p_now, v_tz, s.send_start_hour, s.send_end_hour, s.weekdays_only) where id = m.id;
        continue;
      end if;
    end if;
    update public.sales_campaign_messages set status = 'sending', attempts = attempts + 1, locked_until = p_now + interval '2 minutes', sent_at = p_now where id = m.id;
    v_left := v_left - 1;
    v_out := v_out || jsonb_build_array(public.sales_campaign_context(m.id));
  end loop;
  return jsonb_build_object('blocked', false, 'send_mode', s.send_mode, 'messages', v_out);
end $$;

-- Claim one message (the rep's first email, sent right after they click Send).
create or replace function public.sales_campaign_claim_one(p_message uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_nurture_settings;
begin
  select * into s from public.sales_nurture_settings where id;
  if s.paused or array_length(public.sales_nurture_blockers(s), 1) > 0 then return null; end if;
  if (select count(*) from public.sales_campaign_messages where status in ('sent', 'sending') and sent_at >= p_now - interval '24 hours') >= s.daily_limit then return null; end if;
  update public.sales_campaign_messages m set status = 'sending', attempts = attempts + 1, locked_until = p_now + interval '2 minutes', sent_at = p_now
  where m.id = p_message and m.status in ('scheduled', 'failed') and m.attempts < 3
    and exists (select 1 from public.sales_campaigns c join public.sales_reps r on r.id = c.rep_id
      where c.id = m.campaign_id and c.status = 'active' and r.nurture_from_email is not null);
  if not found then return null; end if;
  return public.sales_campaign_context(p_message);
end $$;

-- One message with its campaign, lead, rep and verified milestones (also used to send the first
-- email right away and to preview the next one).
create or replace function public.sales_campaign_context(p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.sales_campaign_messages; c public.sales_campaigns; l public.sales_leads; r public.sales_reps; s public.sales_nurture_settings; v_slug text; v_first public.sales_campaign_messages;
begin
  select * into m from public.sales_campaign_messages where id = p_message;
  if not found then return null; end if;
  select * into c from public.sales_campaigns where id = m.campaign_id;
  select * into l from public.sales_leads where id = c.lead_id;
  select * into r from public.sales_reps where id = c.rep_id;
  select * into s from public.sales_nurture_settings where id;
  select booking_slug into v_slug from public.sales_rep_calendar where rep_id = r.id and booking_enabled;
  select * into v_first from public.sales_campaign_messages where campaign_id = c.id and step = 0;
  return jsonb_build_object(
    'message', jsonb_build_object('id', m.id, 'step', m.step, 'status', m.status, 'attempts', m.attempts, 'subject', m.subject, 'body', m.body_text, 'scheduled_for', m.scheduled_for),
    'campaign', jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'to_email', c.to_email, 'first_sent_at', c.first_sent_at,
      'first_subject', v_first.subject, 'first_rfc_message_id', v_first.rfc_message_id, 'first_reply_token', v_first.reply_token,
      'sent_templates', (select coalesce(jsonb_agg(template_key order by step), '[]'::jsonb) from public.sales_campaign_messages where campaign_id = c.id and status = 'sent')),
    'lead', jsonb_build_object('id', l.id, 'company_name', l.company_name, 'contact_name', l.contact_name, 'email', lower(btrim(l.email)), 'state', l.state,
      'trades', to_jsonb(l.trades), 'stage', l.stage, 'do_not_contact', l.do_not_contact, 'email_status', l.email_status, 'email_opt_out_at', l.email_opt_out_at,
      'assigned_rep', l.assigned_rep),
    'rep', jsonb_build_object('id', r.id, 'full_name', r.full_name, 'email', r.email, 'phone', r.phone, 'code', r.code, 'status', r.status, 'booking_slug', v_slug, 'from_email', r.nurture_from_email),
    'milestones', public.sales_lead_milestones(l.id),
    'suppressed', public.sales_nurture_suppressed(c.to_email),
    'settings', jsonb_build_object('send_mode', s.send_mode, 'test_recipients', to_jsonb(s.test_recipients),
      'postal_address', s.postal_address, 'paused', s.paused, 'blockers', to_jsonb(public.sales_nurture_blockers(s))));
end $$;

-- Record the outcome of one send attempt.
--   p_outcome: sent | retry | failed | skipped (skipped/failed may end the campaign with p_end_status)
create or replace function public.sales_campaign_mark(p_message uuid, p_outcome text, p jsonb default '{}'::jsonb, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.sales_campaign_messages; c public.sales_campaigns; l public.sales_leads; s public.sales_nurture_settings; v_next timestamptz; v_end text := nullif(p ->> 'end_status', '');
begin
  select * into m from public.sales_campaign_messages where id = p_message for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.sales_campaigns where id = m.campaign_id for update;
  select * into l from public.sales_leads where id = c.lead_id;
  select * into s from public.sales_nurture_settings where id;
  if p_outcome = 'sent' then
    if m.status = 'sent' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
    update public.sales_campaign_messages set status = 'sent', sent_at = p_now, locked_until = null, last_error = null,
      subject = left(coalesce(p ->> 'subject', subject), 200), body_text = left(coalesce(p ->> 'body', body_text), 8000),
      template_key = coalesce(p ->> 'template_key', template_key), milestone = coalesce(p ->> 'milestone', milestone), to_email = c.to_email,
      provider_message_id = nullif(p ->> 'provider_id', ''), rfc_message_id = nullif(p ->> 'rfc_message_id', ''), reply_token = nullif(p ->> 'reply_token', '')
    where id = m.id;
    update public.sales_campaigns set steps_sent = steps_sent + 1, first_sent_at = coalesce(first_sent_at, p_now), last_sent_at = p_now, updated_at = now() where id = c.id
    returning * into c;
    -- Counts as working the lead (recycling) and shows in the CRM history.
    insert into public.sales_activities (lead_id, rep_id, kind, body, disposition, evidence, actor_label, occurred_at)
    values (c.lead_id, c.rep_id, 'email', left(case m.step when 0 then 'Sent: ' else 'Automatic follow-up ' || m.step || ' sent: ' end || coalesce(p ->> 'subject', m.subject, ''), 4000),
      'sent', 'system', case when m.step = 0 then (select full_name from public.sales_reps where id = c.rep_id) else 'Follow-up campaign' end, p_now);
    update public.sales_leads set last_activity_at = greatest(coalesce(last_activity_at, p_now), p_now), stage = case when stage = 'new' then 'contacted' else stage end where id = c.lead_id;
    insert into public.sales_campaign_events (campaign_id, lead_id, kind, details)
    values (c.id, c.lead_id, 'sent', jsonb_build_object('step', m.step, 'template', coalesce(p ->> 'template_key', m.template_key), 'milestone', p ->> 'milestone', 'subject', left(coalesce(p ->> 'subject', m.subject), 200)));
    if m.step < 2 and c.status = 'active' then
      v_next := public.sales_nurture_window(c.first_sent_at + make_interval(days => case m.step when 0 then s.follow_up_1_days else s.follow_up_2_days end),
        public.sales_state_tz(l.state), s.send_start_hour, s.send_end_hour, s.weekdays_only);
      insert into public.sales_campaign_messages (campaign_id, step, status, scheduled_for) values (c.id, m.step + 1, 'scheduled', v_next) on conflict (campaign_id, step) do nothing;
      update public.sales_campaigns set next_send_at = v_next where id = c.id;
    elsif m.step >= 2 then
      -- One initial email + two follow-ups: the sequence is complete and never restarts by itself.
      perform public.sales_campaign_end(c.id, 'completed', 'All emails sent', null);
    end if;
    return jsonb_build_object('ok', true, 'next_send_at', v_next);
  elsif p_outcome = 'retry' then
    update public.sales_campaign_messages set status = case when attempts >= 3 then 'canceled' else 'failed' end, locked_until = null, sent_at = null,
      last_error = left(coalesce(p ->> 'error', 'temporary failure'), 300), scheduled_for = p_now + make_interval(mins => 30 * greatest(attempts, 1))
    where id = m.id returning * into m;
    insert into public.sales_campaign_events (campaign_id, lead_id, kind, details) values (c.id, c.lead_id, 'send_retry', jsonb_build_object('step', m.step, 'error', left(p ->> 'error', 200), 'attempts', m.attempts));
    if m.status = 'canceled' then perform public.sales_campaign_end(c.id, 'failed_delivery', 'Couldn''t be sent after 3 tries', null); end if;
    return jsonb_build_object('ok', true);
  elsif p_outcome in ('failed', 'skipped') then
    update public.sales_campaign_messages set status = case when p_outcome = 'failed' then 'canceled' else 'skipped' end, locked_until = null, sent_at = null,
      last_error = left(coalesce(p ->> 'error', p ->> 'reason', p_outcome), 300) where id = m.id;
    insert into public.sales_campaign_events (campaign_id, lead_id, kind, details)
    values (c.id, c.lead_id, case when p_outcome = 'failed' then 'send_failed' else 'skipped' end, jsonb_build_object('step', m.step, 'reason', left(coalesce(p ->> 'reason', p ->> 'error'), 200)));
    if v_end is not null then perform public.sales_campaign_end(c.id, v_end, coalesce(p ->> 'reason', p_outcome), null);
    elsif p_outcome = 'failed' then perform public.sales_campaign_end(c.id, 'failed_delivery', left(coalesce(p ->> 'error', 'Send failed'), 200), null);
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'invalid_outcome' using errcode = '22023';
end $$;

-- Provider events: delivered, bounced (hard -> bad address list), complained (-> opt-out).
create or replace function public.sales_campaign_delivery(p_provider_id text, p_event text) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.sales_campaign_messages; c public.sales_campaigns;
begin
  select * into m from public.sales_campaign_messages where provider_message_id = p_provider_id;
  if not found then return false; end if;
  select * into c from public.sales_campaigns where id = m.campaign_id;
  if p_event = 'delivered' then
    update public.sales_campaign_messages set delivered_at = coalesce(delivered_at, now()) where id = m.id;
  elsif p_event = 'bounced' then
    update public.sales_campaign_messages set bounced_at = coalesce(bounced_at, now()) where id = m.id;
    insert into public.sales_bad_emails (email, reason, note) values (m.to_email, 'bounced', 'Bounced a sales follow-up email') on conflict (email) do nothing;
    update public.sales_leads set email_status = 'bounced', email_checked_at = now(), email_check_note = 'A follow-up email bounced. Reach them by phone.' where id = c.lead_id;
  elsif p_event = 'complained' then
    insert into public.sales_suppressions (key, reason) values ('e:' || m.to_email, 'complained') on conflict (key) do nothing;
    update public.sales_leads set email_opt_out_at = coalesce(email_opt_out_at, now()) where id = c.lead_id;
  else
    return false;
  end if;
  insert into public.sales_campaign_events (campaign_id, lead_id, kind, details) values (c.id, c.lead_id, p_event, jsonb_build_object('step', m.step));
  return true;
end $$;

-- A reply that came back through the reply address (when reply routing is set up).
create or replace function public.sales_campaign_reply_in(p_token text, p_rfc_ids text[], p_class text, p_excerpt text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.sales_campaign_messages; c public.sales_campaigns; r public.sales_reps; l public.sales_leads;
begin
  if p_token is not null then select * into m from public.sales_campaign_messages where reply_token = p_token; end if;
  if m.id is null and p_rfc_ids is not null then select * into m from public.sales_campaign_messages where rfc_message_id = any (p_rfc_ids) limit 1; end if;
  if m.id is null then return null; end if;
  select * into c from public.sales_campaigns where id = m.campaign_id;
  select * into l from public.sales_leads where id = c.lead_id;
  select * into r from public.sales_reps where id = c.rep_id;
  insert into public.sales_campaign_events (campaign_id, lead_id, kind, details) values (c.id, c.lead_id, 'reply_received', jsonb_build_object('class', p_class));
  if p_class = 'bounce' then
    perform public.sales_campaign_delivery(m.provider_message_id, 'bounced');
  elsif p_class = 'opt_out' then
    insert into public.sales_suppressions (key, reason) values ('e:' || c.to_email, 'opted_out') on conflict (key) do nothing;
    update public.sales_leads set email_opt_out_at = coalesce(email_opt_out_at, now()) where id = c.lead_id;
    insert into public.sales_activities (lead_id, rep_id, kind, body, evidence, actor_label) values (c.lead_id, c.rep_id, 'reply', left('Asked to stop emails: ' || coalesce(p_excerpt, ''), 4000), 'provider', 'Email reply');
  elsif p_class <> 'auto_reply' then
    -- A person wrote back: logging the reply stops the campaign (trigger) and shows it to the rep.
    insert into public.sales_activities (lead_id, rep_id, kind, body, evidence, actor_label) values (c.lead_id, c.rep_id, 'reply', left(coalesce(nullif(p_excerpt, ''), '(no text)'), 4000), 'provider', 'Email reply');
  end if;
  return jsonb_build_object('campaign_id', c.id, 'lead_id', c.lead_id, 'company_name', l.company_name, 'rep_name', r.full_name, 'rep_email', r.email, 'to_email', c.to_email);
end $$;

-- One-click unsubscribe from the email footer (signed link checked by the app).
create or replace function public.sales_nurture_unsubscribe(p_email text) returns integer
language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); n integer;
begin
  if position('@' in e) < 2 then return 0; end if;
  insert into public.sales_suppressions (key, reason) values ('e:' || e, 'opted_out') on conflict (key) do nothing;
  update public.sales_leads set email_opt_out_at = coalesce(email_opt_out_at, now()) where lower(email) = e;
  get diagnostics n = row_count;
  insert into public.sales_activities (lead_id, kind, body, evidence, actor_label)
  select id, 'system', 'Unsubscribed from Built2Bid sales emails (email link).', 'provider', 'Unsubscribe link' from public.sales_leads where lower(email) = e;
  insert into public.sales_campaign_events (lead_id, kind, details) select id, 'unsubscribed', jsonb_build_object('source', 'link') from public.sales_leads where lower(email) = e;
  return n;
end $$;

-- A walkthrough booked through the link in a campaign email.
create or replace function public.sales_campaign_booking_link(p_campaign uuid, p_booking uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.sales_bookings set campaign_id = p_campaign where id = p_booking and campaign_id is null and exists (select 1 from public.sales_campaigns where id = p_campaign);
  return found;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Admin (service role + capability check)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_nurture(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sales_nurture_settings;
begin
  perform public.sales_require_admin(p_caller);
  select * into s from public.sales_nurture_settings where id;
  return jsonb_build_object(
    'settings', to_jsonb(s), 'blockers', to_jsonb(public.sales_nurture_blockers(s)), 'is_owner', public.is_admin(p_caller),
    'team', public.sales_campaign_stats_for(null, now() - interval '90 days'),
    'reps', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'full_name', r.full_name, 'status', r.status, 'email', r.email, 'from_email', r.nurture_from_email,
        'stats', public.sales_campaign_stats_for(r.id, now() - interval '90 days')) order by r.full_name)
      from public.sales_reps r where r.status = 'active' or exists (select 1 from public.sales_campaigns c where c.rep_id = r.id)), '[]'::jsonb),
    'live', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'lead_id', c.lead_id, 'company_name', l.company_name, 'rep_name', r.full_name, 'kind', c.kind,
        'status', c.status, 'steps_sent', c.steps_sent, 'next_send_at', c.next_send_at, 'started_at', c.started_at) order by c.next_send_at nulls last)
      from public.sales_campaigns c join public.sales_leads l on l.id = c.lead_id join public.sales_reps r on r.id = c.rep_id where c.status in ('active', 'paused')), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('company_name', l.company_name, 'rep_name', r.full_name, 'step', m.step, 'status', m.status, 'error', m.last_error,
        'bounced', m.bounced_at is not null, 'at', coalesce(m.bounced_at, m.created_at)) x
      from public.sales_campaign_messages m join public.sales_campaigns c on c.id = m.campaign_id join public.sales_leads l on l.id = c.lead_id join public.sales_reps r on r.id = c.rep_id
      where (m.status in ('failed', 'canceled') and m.last_error is not null and m.last_error not like 'campaign ended:%') or m.bounced_at is not null
      order by coalesce(m.bounced_at, m.created_at) desc limit 50) f), '[]'::jsonb),
    'suppressions', coalesce((select jsonb_agg(jsonb_build_object('key', regexp_replace(x.key, '^e:', ''), 'reason', x.reason, 'at', x.created_at) order by x.created_at desc)
      from (select * from public.sales_suppressions where key like 'e:%' order by created_at desc limit 50) x), '[]'::jsonb),
    'bad_emails', (select count(*) from public.sales_bad_emails),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'details', e.details, 'at', e.at, 'company_name', l.company_name,
        'actor', (select coalesce(r.full_name, u.email) from auth.users u left join public.sales_reps r on r.user_id = u.id where u.id = e.actor_id)) order by e.at desc)
      from (select * from public.sales_campaign_events order by at desc limit 100) e left join public.sales_leads l on l.id = e.lead_id), '[]'::jsonb));
end $$;

create or replace function public.admin_sales_nurture_save(p_caller uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_nurture_settings; v_mode text := coalesce(p ->> 'send_mode', 'off'); v_recips text[]; v_owner boolean := public.is_admin(p_caller);
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  select * into s from public.sales_nurture_settings where id for update;
  if v_mode not in ('off', 'test', 'live') then raise exception 'invalid_mode' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into v_recips
  from jsonb_array_elements_text(coalesce(p -> 'test_recipients', '[]'::jsonb)) x where lower(btrim(x)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if array_length(v_recips, 1) > 20 then raise exception 'too_many_test_recipients' using errcode = '22023'; end if;
  -- Live outreach: only the platform owner, and only once templates and the postal address are in place.
  if v_mode = 'live' and s.send_mode <> 'live' then
    if not v_owner then raise exception 'owner_only' using errcode = '42501'; end if;
    if coalesce((p ->> 'approve_templates')::boolean, false) = false and s.templates_approved_at is null then raise exception 'templates_not_approved' using errcode = '22023'; end if;
    if coalesce(char_length(btrim(coalesce(p ->> 'postal_address', s.postal_address))), 0) < 10 then raise exception 'no_postal_address' using errcode = '22023'; end if;
    if coalesce((p ->> 'confirm_live')::boolean, false) = false then raise exception 'confirm_live' using errcode = '22023'; end if;
  end if;
  update public.sales_nurture_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    send_mode = v_mode,
    test_recipients = case when p ? 'test_recipients' then v_recips else test_recipients end,
    paused = coalesce((p ->> 'paused')::boolean, paused),
    follow_up_1_days = coalesce((p ->> 'follow_up_1_days')::integer, follow_up_1_days),
    follow_up_2_days = coalesce((p ->> 'follow_up_2_days')::integer, follow_up_2_days),
    send_start_hour = coalesce((p ->> 'send_start_hour')::integer, send_start_hour),
    send_end_hour = coalesce((p ->> 'send_end_hour')::integer, send_end_hour),
    weekdays_only = coalesce((p ->> 'weekdays_only')::boolean, weekdays_only),
    daily_limit = coalesce((p ->> 'daily_limit')::integer, daily_limit),
    rep_daily_limit = coalesce((p ->> 'rep_daily_limit')::integer, rep_daily_limit),
    postal_address = case when p ? 'postal_address' then nullif(left(btrim(p ->> 'postal_address'), 300), '') else postal_address end,
    templates_approved_at = case when coalesce((p ->> 'approve_templates')::boolean, false) then coalesce(templates_approved_at, now())
      when coalesce((p ->> 'revoke_templates')::boolean, false) then null else templates_approved_at end,
    templates_approved_by = case when coalesce((p ->> 'approve_templates')::boolean, false) then coalesce(templates_approved_by, p_caller)
      when coalesce((p ->> 'revoke_templates')::boolean, false) then null else templates_approved_by end,
    updated_at = now(), updated_by = p_caller
  where id returning * into s;
  insert into public.sales_campaign_events (actor_id, kind, details) values (p_caller, 'settings', p - 'confirm_live');
  perform public.sales_audit(p_caller, 'sales.nurture_settings', 'sales_nurture_settings', 'singleton', p - 'confirm_live');
  return to_jsonb(s);
end $$;

-- Assign (or clear) a rep's @built2bid.org sending mailbox.
create or replace function public.admin_sales_rep_sender(p_caller uuid, p_rep uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text := nullif(lower(btrim(coalesce(p_email, ''))), ''); r public.sales_reps;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  if v is not null and v !~ '^[a-z0-9._+-]+@built2bid\.org$' then raise exception 'not_built2bid_address' using errcode = '22023'; end if;
  if v is not null and exists (select 1 from public.sales_reps where nurture_from_email = v and id <> p_rep) then raise exception 'address_in_use' using errcode = '23505'; end if;
  update public.sales_reps set nurture_from_email = v where id = p_rep returning * into r;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.sales_campaign_events (actor_id, kind, details) values (p_caller, 'sender', jsonb_build_object('rep', r.full_name, 'address', v));
  perform public.sales_audit(p_caller, 'sales.nurture_sender', 'sales_reps', r.id::text, jsonb_build_object('address', v));
  return jsonb_build_object('id', r.id, 'from_email', r.nurture_from_email);
end $$;

create or replace function public.admin_sales_campaign_control(p_caller uuid, p_campaign uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  return public.sales_campaign_control_as(p_caller, p_campaign, p_action);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Service role only.
  foreach f in array array[
    'public.sales_nurture_suppressed(text)', 'public.sales_lead_milestones(uuid)', 'public.sales_nurture_window(timestamptz, text, integer, integer, boolean)',
    'public.sales_nurture_blockers(public.sales_nurture_settings)', 'public.sales_campaign_end(uuid, text, text, uuid)', 'public.sales_campaign_end_lead(uuid, text, text, uuid)',
    'public.sales_campaign_end_email(text, text, text, uuid)', 'public.sales_campaign_on_activity()', 'public.sales_campaign_on_lead()', 'public.sales_campaign_on_suppression()',
    'public.sales_campaign_on_bad_email()', 'public.sales_campaign_on_booking()', 'public.sales_campaign_json(public.sales_campaigns, boolean)',
    'public.sales_campaign_control_as(uuid, uuid, text, timestamptz)', 'public.sales_campaign_stats_for(uuid, timestamptz)',
    'public.sales_campaign_claim(timestamptz, integer)', 'public.sales_campaign_claim_one(uuid, timestamptz)', 'public.sales_campaign_context(uuid)', 'public.sales_campaign_mark(uuid, text, jsonb, timestamptz)',
    'public.sales_campaign_delivery(text, text)', 'public.sales_campaign_reply_in(text, text[], text, text)', 'public.sales_nurture_unsubscribe(text)',
    'public.sales_campaign_booking_link(uuid, uuid)', 'public.admin_sales_nurture(uuid)', 'public.admin_sales_nurture_save(uuid, jsonb)',
    'public.admin_sales_campaign_control(uuid, uuid, text)', 'public.admin_sales_rep_sender(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Signed-in sales staff (each re-checks the caller).
  foreach f in array array[
    'public.sales_campaign_lead(uuid)', 'public.sales_campaign_start(uuid, text, text, text)', 'public.sales_campaign_control(uuid, text)',
    'public.sales_my_campaign_stats(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
