-- "What's slowing down your bids?" questionnaire (/bid-check) for contractors arriving from Facebook.
--
-- Purely additive except for two narrow widenings of the Facebook trial funnel (migration
-- 20261116008000) so the questionnaire can hand out the SAME 7-day pass through the SAME code:
--   * trial_campaign_invites.source may now also be 'questionnaire';
--   * trial_request_invite() accepts p_source = 'questionnaire'. Its body is otherwise unchanged:
--     one invite per email, duplicate/limit protection, sticky check-in consent.
-- Activation, the grant, its plan (Unlimited) and length (7 days) are untouched: trial_activate() is
-- not modified, so the pass is still verified-email-only, one per email and per account, never
-- replaces paid/Enterprise/complimentary access and never collects a card.
--
-- New: public.bid_check_sessions, one anonymous row per questionnaire run. It holds answer KEYS (for
-- example "decks", "stairs", "speed"), timestamps and the campaign/trade hint from the link. It never
-- holds an email address, name or IP. Two optional free-text answers (what they build, feedback) are
-- capped and scrubbed of emails/phone numbers by the app before they are stored. The invite (and so
-- activation, first finalized bid and paid upgrade) is reached through invite_id.
--
-- Access: service role only (RLS on, no policies, grants revoked). Admin counts via
-- bid_check_funnel(caller), which checks is_admin.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Allow 'questionnaire' as an invite source
-- ---------------------------------------------------------------------------
do $do$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.trial_campaign_invites'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%source%claim_page%'
  loop
    execute format('alter table public.trial_campaign_invites drop constraint %I', c);
  end loop;
end $do$;
alter table public.trial_campaign_invites drop constraint if exists trial_campaign_invites_source_check;
alter table public.trial_campaign_invites add constraint trial_campaign_invites_source_check
  check (source in ('messenger', 'manychat', 'claim_page', 'questionnaire'));

create or replace function public.trial_request_invite(p_email text, p_source text, p_contact_id uuid default null, p_checkins boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv public.trial_campaign_invites;
  v_email_id uuid;
  v_status text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_source not in ('messenger', 'manychat', 'claim_page', 'questionnaire') then raise exception 'invalid_source' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('trial:' || v_email));

  select * into inv from public.trial_campaign_invites where campaign = 'fb_bid_7day' and email = v_email for update;
  if not found then
    insert into public.trial_campaign_invites (email, source, contact_id, checkins_opt_in, send_count)
    values (v_email, p_source, p_contact_id, coalesce(p_checkins, false), 1)
    returning * into inv;
    insert into public.trial_campaign_emails (invite_id, kind, seq) values (inv.id, 'invite', 1) returning id into v_email_id;
    v_status := 'queued';
  elsif inv.status <> 'pending' then
    v_status := 'already_activated';
  elsif inv.last_requested_at > now() - interval '2 minutes' then
    v_status := 'duplicate';
  elsif inv.send_count >= 5 then
    v_status := 'limit';
  else
    update public.trial_campaign_invites set
      send_count = send_count + 1,
      last_requested_at = now(),
      token_version = case when invite_expires_at <= now() then token_version + 1 else token_version end,
      invite_expires_at = case when invite_expires_at <= now() then now() + interval '14 days' else invite_expires_at end,
      contact_id = coalesce(p_contact_id, contact_id)
    where id = inv.id returning * into inv;
    insert into public.trial_campaign_emails (invite_id, kind, seq) values (inv.id, 'invite', inv.send_count) returning id into v_email_id;
    v_status := 'resent';
  end if;

  if coalesce(p_checkins, false) and not inv.checkins_opt_in and inv.checkins_opted_out_at is null then
    update public.trial_campaign_invites set checkins_opt_in = true where id = inv.id returning * into inv;
  end if;

  if p_contact_id is not null and v_status in ('queued', 'resent', 'duplicate', 'limit') then
    update public.trial_campaign_contacts set state = 'invited', invite_id = inv.id, reminder_due_at = null
      where id = p_contact_id and state <> 'opted_out';
  end if;

  return jsonb_build_object('status', v_status, 'invite_id', inv.id, 'token_version', inv.token_version, 'email_id', v_email_id);
end $$;

revoke execute on function public.trial_request_invite(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.trial_request_invite(text, text, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Questionnaire sessions (anonymous)
-- ---------------------------------------------------------------------------
create table if not exists public.bid_check_sessions (
  -- Random id generated in the browser for this run (not tied to a person).
  id uuid primary key,
  campaign text check (char_length(campaign) <= 64),
  source text check (char_length(source) <= 32),
  content text check (char_length(content) <= 100),
  trade_hint text check (char_length(trade_hint) <= 64),
  -- Answers on the final path: { question id: option key }, plus the two capped free-text answers.
  answers jsonb not null default '{}'::jsonb check (pg_column_size(answers) <= 8192),
  goal text check (char_length(goal) <= 32),
  trade text check (char_length(trade) <= 64),
  pain text check (char_length(pain) <= 64),
  result_key text check (char_length(result_key) <= 160),
  primary_cta text check (primary_cta in ('pass', 'free_bid')),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result_shown_at timestamptz,
  deep_completed_at timestamptz,
  sample_opened_at timestamptz,
  free_bid_clicked_at timestamptz,
  invite_requested_at timestamptz,
  invite_id uuid references public.trial_campaign_invites (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bid_check_sessions_started_idx on public.bid_check_sessions (started_at desc);
create index if not exists bid_check_sessions_invite_idx on public.bid_check_sessions (invite_id) where invite_id is not null;

drop trigger if exists bid_check_sessions_updated_at on public.bid_check_sessions;
create trigger bid_check_sessions_updated_at before update on public.bid_check_sessions
  for each row execute function public.set_updated_at();
alter table public.bid_check_sessions enable row level security;
revoke all on public.bid_check_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Funnel for the admin dashboard (counts only; admins only)
-- ---------------------------------------------------------------------------
create or replace function public.bid_check_funnel(p_caller uuid, p_since timestamptz default now() - interval '90 days')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with s as (select * from public.bid_check_sessions where started_at >= p_since),
    inv as (select distinct i.* from s join public.trial_campaign_invites i on i.id = s.invite_id)
    select jsonb_build_object(
      'since', p_since,
      'started', (select count(*) from s),
      'completed', (select count(*) from s where completed_at is not null),
      'result_shown', (select count(*) from s where result_shown_at is not null),
      'deep_completed', (select count(*) from s where deep_completed_at is not null),
      'sample_opened', (select count(*) from s where sample_opened_at is not null),
      'free_bid_clicked', (select count(*) from s where free_bid_clicked_at is not null),
      'invite_requested', (select count(*) from s where invite_requested_at is not null),
      'pass_activated', (select count(*) from inv where status = 'activated'),
      'first_bid_finalized', (select count(*) from inv where status = 'activated'
          and exists (select 1 from public.estimate_versions v where v.user_id = inv.user_id and v.created_at >= inv.activated_at)),
      'paid_upgrade', (select count(*) from inv where status = 'activated'
          and (select count(*) from public.subscriptions x where x.user_id = inv.user_id
               and x.status not in ('incomplete', 'incomplete_expired')) > coalesce(inv.subs_at_activation, 0)),
      'by_goal', coalesce((select jsonb_object_agg(goal, n) from (select goal, count(*) n from s where goal is not null group by goal) g), '{}'::jsonb),
      'by_trade', coalesce((select jsonb_object_agg(trade, n) from (select trade, count(*) n from s where trade is not null group by trade) t), '{}'::jsonb),
      'by_campaign', coalesce((select jsonb_agg(jsonb_build_object('campaign', campaign, 'started', n, 'completed', c, 'invites', i) order by n desc) from (
          select coalesce(campaign, '(none)') campaign, count(*) n, count(completed_at) c, count(invite_requested_at) i from s group by 1) x), '[]'::jsonb),
      'recent_feedback', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('at', updated_at, 'trade', trade, 'goal', goal, 'text', answers->>'feedback') x
          from s where coalesce(answers->>'feedback', '') <> '' order by updated_at desc limit 10) f), '[]'::jsonb)
    )
  );
end $$;

revoke execute on function public.bid_check_funnel(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.bid_check_funnel(uuid, timestamptz) to service_role;
