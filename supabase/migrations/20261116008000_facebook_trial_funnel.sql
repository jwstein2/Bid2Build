-- Facebook comment-to-trial funnel ("comment BID" -> Messenger -> email invite -> 7 days of Unlimited).
--
-- Purely additive: new tables and functions only. No existing table, row or function changes.
--
-- What the campaign can do, and nothing more:
--  * It can issue ONE kind of pass: Built2Bid Unlimited (individual) for 7 days. Plan and length are
--    constants inside trial_activate(); no caller can pass a plan, a duration, seats or a role.
--  * The pass is an ordinary row in public.complimentary_grants (plan 'unlimited', status 'active'),
--    so every existing entitlement check (user_entitlement / has_unlimited / credit_status /
--    finalize_bid / library_access) honours it and stops honouring it at expires_at, with no cron.
--    Platform admins see and can extend or revoke it on Admin -> Complimentary Access.
--  * It is inserted already 'active' (never 'pending'), so the existing "claim pending grants when an
--    email is verified" trigger never touches it.
--  * Activation needs a signed-in account whose VERIFIED email equals the invited email, and a POST
--    from that session (an email preview or link scanner only ever GETs, and isn't signed in).
--  * One pass per email and one per account, ever. Anyone who already has Unlimited, Enterprise or a
--    complimentary grant keeps it; the invite stays unused.
--  * No card, no Stripe customer, no subscription, no charge. At expiry the account falls back to its
--    normal entitlements; bids, customers, other grants and Free credits are never touched.
--
-- Access: service role only (RLS on, no policies, grants revoked), except my_campaign_trial(), which
-- a signed-in user calls for their own dashboard banner.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- A person who reached us in Messenger (page-scoped id) or through ManyChat (subscriber id).
-- No name, no profile data, no message text.
create table if not exists public.trial_campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('messenger', 'manychat')),
  page_id text not null check (char_length(page_id) between 1 and 64),
  psid text not null check (char_length(psid) between 1 and 128),
  state text not null default 'new' check (state in ('new', 'awaiting_email', 'invited', 'opted_out')),
  interacted_at timestamptz,
  -- Last message FROM the person: Messenger's standard 24-hour window is measured from here.
  last_inbound_at timestamptz,
  reminder_due_at timestamptz,
  reminder_sent_at timestamptz,
  opted_out_at timestamptz,
  invalid_email_prompts integer not null default 0,
  invite_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, page_id, psid)
);
create index if not exists trial_contacts_reminder_idx on public.trial_campaign_contacts (reminder_due_at)
  where state = 'awaiting_email' and reminder_sent_at is null;

-- Every webhook delivery we act on, keyed for idempotency (comment id, message id). Also the funnel's
-- record of qualifying comments and private replies. No comment or message text is stored.
create table if not exists public.trial_campaign_events (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  kind text not null check (kind in ('comment', 'message', 'postback')),
  page_id text check (char_length(page_id) <= 64),
  post_id text check (char_length(post_id) <= 128),
  -- For comments: the comment id, needed to retry the private reply. Null for messages.
  comment_id text check (char_length(comment_id) <= 128),
  contact_id uuid references public.trial_campaign_contacts (id) on delete set null,
  status text not null default 'received' check (status in ('received', 'sending', 'replied', 'failed', 'skipped', 'handled')),
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 300),
  -- 'quick_reply' or 'text_only': which private-reply format Meta accepted.
  reply_format text check (reply_format in ('quick_reply', 'text_only')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trial_events_kind_idx on public.trial_campaign_events (kind, status, occurred_at desc);
create index if not exists trial_events_post_idx on public.trial_campaign_events (post_id) where kind = 'comment';

-- One invite per email for this campaign, ever. The link token is never stored: it is an HMAC of
-- (id, token_version) under a server secret, so the server can re-create it for a retry and bumping
-- token_version kills old links.
create table if not exists public.trial_campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign text not null default 'fb_bid_7day' check (campaign = 'fb_bid_7day'),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  source text not null check (source in ('messenger', 'manychat', 'claim_page')),
  contact_id uuid references public.trial_campaign_contacts (id) on delete set null,
  token_version integer not null default 1 check (token_version between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'activated', 'already_used')),
  invite_expires_at timestamptz not null default now() + interval '14 days',
  send_count integer not null default 0,
  last_requested_at timestamptz not null default now(),
  checkins_opt_in boolean not null default false,
  checkins_opted_out_at timestamptz,
  user_id uuid references auth.users (id) on delete set null,
  grant_id uuid references public.complimentary_grants (id) on delete set null,
  activated_at timestamptz,
  -- Stripe subscriptions (any non-incomplete status) the account had at activation, so a later paid
  -- upgrade can be told apart from an old cancelled plan.
  subs_at_activation integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign, email)
);
create index if not exists trial_invites_user_idx on public.trial_campaign_invites (user_id) where user_id is not null;

-- Emails for the campaign: the invite (one row per send), and the two optional check-ins.
create table if not exists public.trial_campaign_emails (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.trial_campaign_invites (id) on delete cascade,
  kind text not null check (kind in ('invite', 'day2', 'day6')),
  seq integer not null default 1 check (seq between 1 and 50),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  send_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  sent_at timestamptz,
  provider_message_id text check (char_length(provider_message_id) <= 200),
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invite_id, kind, seq)
);
create index if not exists trial_emails_due_idx on public.trial_campaign_emails (send_after) where status in ('pending', 'failed');

do $do$
declare t text;
begin
  foreach t in array array['trial_campaign_contacts', 'trial_campaign_events', 'trial_campaign_invites', 'trial_campaign_emails'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $do$;

-- ---------------------------------------------------------------------------
-- 2. Request an invite (Messenger, ManyChat or the claim page)
-- ---------------------------------------------------------------------------
-- Idempotent and safe under concurrency (per-email advisory lock + unique keys). Returns:
--   status: 'queued'   new invite, email queued
--           'resent'   existing unused invite, another copy queued (same link)
--           'duplicate' asked again within 2 minutes: nothing new queued
--           'limit'    5 copies already sent: nothing new queued
--           'already_activated' this email already used its trial
--   invite_id, token_version, email_id (the queued email, if any)
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
  if p_source not in ('messenger', 'manychat', 'claim_page') then raise exception 'invalid_source' using errcode = '22023'; end if;
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
      -- An expired link gets a fresh one (old token stops working) and a new 14 days.
      token_version = case when invite_expires_at <= now() then token_version + 1 else token_version end,
      invite_expires_at = case when invite_expires_at <= now() then now() + interval '14 days' else invite_expires_at end,
      contact_id = coalesce(p_contact_id, contact_id)
    where id = inv.id returning * into inv;
    insert into public.trial_campaign_emails (invite_id, kind, seq) values (inv.id, 'invite', inv.send_count) returning id into v_email_id;
    v_status := 'resent';
  end if;

  -- Agreeing to check-ins is sticky; a later request never silently turns them off (opt-out does).
  if coalesce(p_checkins, false) and not inv.checkins_opt_in and inv.checkins_opted_out_at is null then
    update public.trial_campaign_invites set checkins_opt_in = true where id = inv.id returning * into inv;
  end if;

  if p_contact_id is not null and v_status in ('queued', 'resent', 'duplicate', 'limit') then
    update public.trial_campaign_contacts set state = 'invited', invite_id = inv.id, reminder_due_at = null
      where id = p_contact_id and state <> 'opted_out';
  end if;

  return jsonb_build_object('status', v_status, 'invite_id', inv.id, 'token_version', inv.token_version, 'email_id', v_email_id);
end $$;

-- Record the person's answer to "want two short check-ins?" (Messenger quick reply).
create or replace function public.trial_set_checkins(p_invite_id uuid, p_opt_in boolean) returns void
language sql security definer set search_path = public as $$
  update public.trial_campaign_invites set
    checkins_opt_in = p_opt_in and checkins_opted_out_at is null,
    checkins_opted_out_at = case when p_opt_in then checkins_opted_out_at else coalesce(checkins_opted_out_at, now()) end
  where id = p_invite_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Activate
-- ---------------------------------------------------------------------------
-- The server has already checked the link's HMAC; this checks everything else under a row lock.
-- Returns ok + expires_at, or ok=false with a reason:
--   invalid | invite_expired | email_unverified | email_mismatch (+hint) | already_has_access | already_used
create or replace function public.trial_activate(p_user_id uuid, p_invite_id uuid, p_token_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv public.trial_campaign_invites;
  g public.complimentary_grants;
  v_email text;
  -- The ONLY pass this campaign can issue.
  c_plan constant text := 'unlimited';
  c_days constant integer := 7;
begin
  if p_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into inv from public.trial_campaign_invites where id = p_invite_id for update;
  if not found or inv.token_version <> p_token_version then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  -- Second click, refresh, double submit, or a retry after a timeout: same answer, nothing new.
  if inv.status = 'activated' then
    if inv.user_id = p_user_id then
      select * into g from public.complimentary_grants where id = inv.grant_id;
      return jsonb_build_object('ok', true, 'state', 'active', 'expires_at', g.expires_at, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.status = 'already_used' then return jsonb_build_object('ok', false, 'reason', 'already_used'); end if;
  if inv.invite_expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'invite_expired'); end if;

  select lower(btrim(u.email)) into v_email from auth.users u
    where u.id = p_user_id and u.email is not null and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'email_unverified'); end if;
  if v_email <> inv.email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch',
      'hint', left(inv.email, 1) || '***' || substr(inv.email, position('@' in inv.email)));
  end if;

  -- Same lock the complimentary-access functions take for this email, plus one for the account.
  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  perform pg_advisory_xact_lock(hashtext('trial-user:' || p_user_id::text));

  -- One campaign pass per account, even across different emails.
  if exists (select 1 from public.trial_campaign_invites x where x.user_id = p_user_id and x.status = 'activated' and x.id <> inv.id) then
    update public.trial_campaign_invites set status = 'already_used', user_id = p_user_id where id = inv.id;
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  -- Paid, Enterprise or any complimentary access already in force wins. The invite stays unused.
  if public.has_unlimited(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_has_access');
  end if;

  insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, extra_seats, status,
                                           starts_at, expires_at, activated_at, had_paid_subscription, note)
  values (v_email, p_user_id, c_plan, c_days, 1, 0, 'active',
          now(), now() + make_interval(days => c_days), now(), false, 'Facebook BID trial (campaign fb_bid_7day)')
  returning * into g;

  update public.trial_campaign_invites set
    status = 'activated', user_id = p_user_id, grant_id = g.id, activated_at = now(),
    subs_at_activation = (select count(*) from public.subscriptions s where s.user_id = p_user_id
                          and s.status not in ('incomplete', 'incomplete_expired'))
  where id = inv.id;

  -- Optional check-ins (sent only if they agreed, haven't opted out and still qualify at send time).
  insert into public.trial_campaign_emails (invite_id, kind, seq, send_after) values
    (inv.id, 'day2', 1, now() + interval '1 day'),
    (inv.id, 'day6', 1, now() + interval '5 days')
  on conflict (invite_id, kind, seq) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_user_id, 'comp.campaign_activate', 'complimentary_grant', g.id::text,
          jsonb_build_object('campaign', 'fb_bid_7day', 'plan', c_plan, 'days', c_days, 'expires_at', g.expires_at, 'source', inv.source));

  return jsonb_build_object('ok', true, 'state', 'active', 'expires_at', g.expires_at);
end $$;

-- What a check-in email needs to decide at send time (no email address returned).
create or replace function public.trial_checkin_context(p_invite_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'opted_in', i.checkins_opt_in and i.checkins_opted_out_at is null,
    'grant_active', g.id is not null and g.status = 'active' and g.expires_at > now(),
    'expires_at', g.expires_at,
    'finished_bid', exists (select 1 from public.estimate_versions v where v.user_id = i.user_id and v.created_at >= i.activated_at),
    'paid', i.user_id is not null and public.has_paid_subscription(i.user_id),
    'suppressed', exists (select 1 from public.leads l where l.email_norm = i.email and (l.unsubscribed_at is not null or l.suppressed_at is not null))
  )
  from public.trial_campaign_invites i
  left join public.complimentary_grants g on g.id = i.grant_id
  where i.id = p_invite_id
$$;

-- ---------------------------------------------------------------------------
-- 4. The signed-in user's own trial (dashboard banner)
-- ---------------------------------------------------------------------------
create or replace function public.my_campaign_trial()
returns table (state text, expires_at timestamptz, has_paid_subscription boolean)
language sql stable security definer set search_path = public as $$
  select public.comp_grant_state(g), g.expires_at, public.has_paid_subscription(auth.uid())
  from public.trial_campaign_invites i
  join public.complimentary_grants g on g.id = i.grant_id
  where auth.uid() is not null and i.user_id = auth.uid() and i.status = 'activated'
  order by i.activated_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 5. Funnel for the admin dashboard (counts only; admins only)
-- ---------------------------------------------------------------------------
create or replace function public.trial_campaign_funnel(p_caller uuid, p_since timestamptz default now() - interval '90 days')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'since', p_since,
    'qualifying_comments', (select count(*) from public.trial_campaign_events where kind = 'comment' and occurred_at >= p_since),
    'private_replies_sent', (select count(*) from public.trial_campaign_events where kind = 'comment' and status = 'replied' and occurred_at >= p_since),
    'private_replies_failed', (select count(*) from public.trial_campaign_events where kind = 'comment' and status in ('failed', 'skipped') and occurred_at >= p_since),
    'messenger_interactions', (select count(*) from public.trial_campaign_contacts where interacted_at >= p_since),
    'reminders_sent', (select count(*) from public.trial_campaign_contacts where reminder_sent_at >= p_since),
    'opt_outs', (select count(*) from public.trial_campaign_contacts where opted_out_at >= p_since),
    'invites_requested', (select count(*) from public.trial_campaign_invites where created_at >= p_since),
    'invites_sent', (select count(distinct e.invite_id) from public.trial_campaign_emails e join public.trial_campaign_invites i on i.id = e.invite_id
                     where e.kind = 'invite' and e.status = 'sent' and i.created_at >= p_since),
    'invite_emails_failed', (select count(*) from public.trial_campaign_emails e join public.trial_campaign_invites i on i.id = e.invite_id
                     where e.kind = 'invite' and e.status in ('failed', 'skipped') and i.created_at >= p_since),
    'trials_activated', (select count(*) from public.trial_campaign_invites where status = 'activated' and activated_at >= p_since),
    'trials_active_now', (select count(*) from public.trial_campaign_invites i join public.complimentary_grants g on g.id = i.grant_id
                          where i.status = 'activated' and g.status = 'active' and g.expires_at > now()),
    'first_bid_finalized', (select count(*) from public.trial_campaign_invites i where i.status = 'activated' and i.activated_at >= p_since
                            and exists (select 1 from public.estimate_versions v where v.user_id = i.user_id and v.created_at >= i.activated_at)),
    'first_paid_upgrade', (select count(*) from public.trial_campaign_invites i where i.status = 'activated' and i.activated_at >= p_since
                           and (select count(*) from public.subscriptions s where s.user_id = i.user_id
                                and s.status not in ('incomplete', 'incomplete_expired')) > coalesce(i.subs_at_activation, 0)),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from public.trial_campaign_invites where created_at >= p_since group by source) s), '{}'::jsonb),
    'by_post', coalesce((select jsonb_agg(jsonb_build_object('post_id', post_id, 'comments', n, 'replied', r, 'last_at', last_at) order by n desc) from (
        select post_id, count(*) n, count(*) filter (where status = 'replied') r, max(occurred_at) last_at
        from public.trial_campaign_events where kind = 'comment' group by post_id) p), '[]'::jsonb),
    'reply_formats', coalesce((select jsonb_object_agg(reply_format, n) from (select reply_format, count(*) n from public.trial_campaign_events
        where kind = 'comment' and reply_format is not null group by reply_format) f), '{}'::jsonb),
    'last_errors', coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind', kind, 'error', last_error, 'at', updated_at) x
        from public.trial_campaign_events where last_error is not null order by updated_at desc limit 5) e), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.trial_request_invite(text, text, uuid, boolean)',
    'public.trial_set_checkins(uuid, boolean)',
    'public.trial_activate(uuid, uuid, integer)',
    'public.trial_checkin_context(uuid)',
    'public.trial_campaign_funnel(uuid, timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

revoke execute on function public.my_campaign_trial() from public, anon;
grant execute on function public.my_campaign_trial() to authenticated;
