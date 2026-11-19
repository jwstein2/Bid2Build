-- Referral program: "Refer a contractor, get a month free."
--
-- Every account gets a short referral code (created the first time they open the dashboard).
-- A visitor who arrives through https://built2bid.org/r/<code> and creates an account is recorded
-- here as that member's referral. When the referred account pays its first non-zero invoice, the
-- referrer earns one free month, once per referred account:
--   * referrer has an active, renewing paid subscription -> a Stripe customer balance credit worth
--     one month of their plan (applied by the app server to their next invoice; prices are never
--     changed), or
--   * otherwise -> 30 days of complimentary Unlimited (a complimentary_grants row, or 30 more days
--     on the open grant they already have), starting when any paid period ends.
--
-- Abuse guards (enforced here, not only in the app):
--   * no self-referral (same account, or same email ignoring case, dots-in-gmail and +tags)
--   * only brand-new accounts (created within 14 days) that have never had a subscription
--   * internal, test and demo accounts (admin role, owner label, reserved test domains) are
--     recorded as ineligible and never rewarded, on either side
--   * one referral per referred account, one reward per referral (row-locked state machine)
--   * at most 12 rewards per referrer per rolling 365 days
--
-- Purely additive. Safe to run more than once. Requires the complimentary access (20261114004000)
-- and admin reporting (20261115002000) migrations, which are already applied in production.
-- Access: service role only (RLS on, no policies, grants revoked), except my_referral(), which a
-- signed-in member calls for their own code and counts.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  -- Kept (set null) if either account is deleted so reward history survives.
  referrer_id uuid references auth.users (id) on delete set null,
  referee_id uuid unique references auth.users (id) on delete set null,
  code text not null check (char_length(code) <= 12),
  status text not null default 'signed_up' check (status in ('signed_up', 'rewarding', 'rewarded', 'reward_failed', 'ineligible')),
  ineligible_reason text check (char_length(ineligible_reason) <= 64),
  signed_up_at timestamptz not null default now(),
  converted_at timestamptz,
  invoice_id text unique check (char_length(invoice_id) <= 255),
  reward_kind text check (reward_kind in ('stripe_credit', 'comp_days')),
  reward_ref text check (char_length(reward_ref) <= 255),
  reward_cents integer check (reward_cents is null or reward_cents between 0 and 100000),
  rewarded_at timestamptz,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, status);
create index if not exists referrals_created_idx on public.referrals (created_at desc);

drop trigger if exists referrals_updated_at on public.referrals;
create trigger referrals_updated_at before update on public.referrals
  for each row execute function public.set_updated_at();

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
revoke all on public.referral_codes from public, anon, authenticated;
revoke all on public.referrals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Email identity for self-referral checks: lower case, +tag removed, dots removed for Gmail.
create or replace function public.referral_email_key(p_email text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else (
      with e as (select lower(btrim(p_email)) as v),
           parts as (select split_part(v, '@', 1) as local, split_part(v, '@', 2) as domain from e)
      select case when domain in ('gmail.com', 'googlemail.com')
                  then replace(split_part(local, '+', 1), '.', '') || '@gmail.com'
                  else split_part(local, '+', 1) || '@' || domain end
      from parts)
  end
$$;

-- Internal, test or demo account: never earns or counts as a referral. Mirrors src/lib/admin/classify.ts.
create or replace function public.referral_excluded(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.label in ('internal', 'test', 'demo') then 'excluded_' || l.label
    when l.label = 'genuine' then null
    when exists (select 1 from public.admin_roles r where r.user_id = p_user) then 'excluded_internal'
    when lower(u.email) ~ '\.(test|example|invalid|localhost)$'
      or split_part(lower(u.email), '@', 2) in ('example.com', 'example.net', 'example.org')
      or lower(u.email) like 'stripe-test-%' then 'excluded_test'
    else null
  end
  from auth.users u
  left join public.admin_account_labels l on l.user_id = u.id
  where u.id = p_user
$$;

create or replace function public.referral_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  -- No 0/O/1/I/L so codes read cleanly out loud and in a text message.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  v text := '';
begin
  for i in 0..7 loop
    v := v || substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1);
  end loop;
  return v;
end $$;

-- The member's code (created on first use). Service role passes the user id.
create or replace function public.referral_code_for(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if p_user is null then return null; end if;
  select code into v from public.referral_codes where user_id = p_user;
  if v is not null then return v; end if;
  for attempt in 1..5 loop
    begin
      insert into public.referral_codes (user_id, code) values (p_user, public.referral_new_code())
        on conflict (user_id) do nothing;
      select code into v from public.referral_codes where user_id = p_user;
      return v;
    exception when unique_violation then
      -- code collision (another user has it): try a new one
    end;
  end loop;
  raise exception 'code_unavailable';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Member view: own code + counts (never other people's emails)
-- ---------------------------------------------------------------------------
create or replace function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then return null; end if;
  v_code := public.referral_code_for(v_user);
  return jsonb_build_object(
    'code', v_code,
    'eligible', public.referral_excluded(v_user) is null,
    'signed_up', (select count(*) from public.referrals r where r.referrer_id = v_user and r.status <> 'ineligible'),
    'paying', (select count(*) from public.referrals r where r.referrer_id = v_user and r.converted_at is not null and r.status <> 'ineligible'),
    'months_earned', (select count(*) from public.referrals r where r.referrer_id = v_user and r.status = 'rewarded'),
    'pending_rewards', (select count(*) from public.referrals r where r.referrer_id = v_user and r.status in ('rewarding', 'reward_failed'))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Record a referral when the referred person's account is created
-- ---------------------------------------------------------------------------
-- Returns 'recorded', 'already_recorded', 'unknown_code', 'existing_account' or 'ineligible:<reason>'.
create or replace function public.record_referral(p_referee uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
  v_ref_email text; v_new_email text; v_created timestamptz;
  v_reason text;
begin
  if p_referee is null or v_code !~ '^[A-Z0-9]{6,12}$' then return 'unknown_code'; end if;
  if exists (select 1 from public.referrals where referee_id = p_referee) then return 'already_recorded'; end if;
  select user_id into v_referrer from public.referral_codes where code = v_code;
  if v_referrer is null then return 'unknown_code'; end if;
  -- Opening your own link is common and harmless: not recorded, so it never blocks a real referral.
  if v_referrer = p_referee then return 'ineligible:self_referral'; end if;
  select email, created_at into v_new_email, v_created from auth.users where id = p_referee;
  if not found then return 'unknown_code'; end if;
  -- Only brand-new accounts that never paid count; older accounts are not "referred".
  if v_created < now() - interval '14 days' or exists (select 1 from public.subscriptions s where s.user_id = p_referee) then
    return 'existing_account';
  end if;
  select email into v_ref_email from auth.users where id = v_referrer;

  v_reason := case
    when public.referral_email_key(v_ref_email) = public.referral_email_key(v_new_email) then 'self_referral'
    when public.referral_excluded(v_referrer) is not null then 'referrer_' || public.referral_excluded(v_referrer)
    when public.referral_excluded(p_referee) is not null then 'referee_' || public.referral_excluded(p_referee)
    else null
  end;

  insert into public.referrals (referrer_id, referee_id, code, status, ineligible_reason)
  values (v_referrer, p_referee, v_code, case when v_reason is null then 'signed_up' else 'ineligible' end, v_reason)
  on conflict (referee_id) do nothing;
  if not found then return 'already_recorded'; end if;
  return coalesce('ineligible:' || v_reason, 'recorded');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reward: claim on the referred account's first non-zero paid invoice
-- ---------------------------------------------------------------------------
-- Moves the referral signed_up -> rewarding exactly once and tells the app how to reward:
--   {"action":"none"}                                       nothing to do
--   {"action":"stripe_credit","id","customer","subscription"} paying referrer: credit one month
--   {"action":"comp_days","id"}                              anyone else: call referral_grant_comp_days
create or replace function public.referral_claim_reward(p_referee uuid, p_invoice_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.referrals;
  v_reason text;
  s record;
begin
  select * into r from public.referrals where referee_id = p_referee for update;
  if not found or r.status <> 'signed_up' then return jsonb_build_object('action', 'none'); end if;

  -- Re-check at reward time: labels can change after signup.
  v_reason := case
    when r.referrer_id is null then 'referrer_deleted'
    when public.referral_excluded(r.referrer_id) is not null then 'referrer_' || public.referral_excluded(r.referrer_id)
    when public.referral_excluded(p_referee) is not null then 'referee_' || public.referral_excluded(p_referee)
    when (select count(*) from public.referrals x where x.referrer_id = r.referrer_id
          and (x.status = 'rewarding' or (x.status = 'rewarded' and x.rewarded_at > now() - interval '365 days'))) >= 12 then 'yearly_cap_reached'
    else null
  end;
  if v_reason is not null then
    update public.referrals set status = 'ineligible', ineligible_reason = v_reason, converted_at = now(),
      invoice_id = left(p_invoice_id, 255) where id = r.id;
    return jsonb_build_object('action', 'none', 'reason', v_reason);
  end if;

  update public.referrals set status = 'rewarding', converted_at = now(), invoice_id = left(p_invoice_id, 255) where id = r.id;

  -- A renewing paid subscription gets a Stripe credit toward the next bill.
  select sub.stripe_customer_id, sub.stripe_subscription_id into s
  from public.subscriptions sub
  where sub.user_id = r.referrer_id and sub.status in ('active', 'trialing', 'past_due')
    and not sub.cancel_at_period_end
    and (sub.current_period_end is null or sub.current_period_end > now())
  order by sub.current_period_end desc nulls last
  limit 1;
  if found then
    return jsonb_build_object('action', 'stripe_credit', 'id', r.id, 'customer', s.stripe_customer_id, 'subscription', s.stripe_subscription_id);
  end if;
  return jsonb_build_object('action', 'comp_days', 'id', r.id);
end $$;

-- Non-paying (or cancelling) referrer: 30 days of complimentary Unlimited. Adds 30 days to an open
-- grant if they have one; otherwise creates one that starts when any remaining paid period ends.
create or replace function public.referral_grant_comp_days(p_id uuid, p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.referrals;
  v_email text;
  v_start timestamptz;
  g public.complimentary_grants;
begin
  select * into r from public.referrals where id = p_id for update;
  if not found or r.status <> 'rewarding' then return jsonb_build_object('ok', false, 'error', 'not_rewarding'); end if;
  select lower(btrim(email)) into v_email from auth.users where id = r.referrer_id;
  if v_email is null or position('@' in v_email) < 2 then
    update public.referrals set status = 'reward_failed', error = 'Referrer has no email address for a complimentary grant' where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'no_email');
  end if;

  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  select * into g from public.complimentary_grants x
    where (x.user_id = r.referrer_id or x.email = v_email) and public.comp_grant_state(x) in ('active', 'scheduled', 'paused')
    order by x.expires_at desc limit 1 for update;

  if found then
    update public.complimentary_grants
      set expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
          duration_days = least(730, duration_days + p_days),
          note = left(coalesce(note || ' · ', '') || 'Referral reward +' || p_days || ' days', 500)
      where id = g.id returning * into g;
  else
    select greatest(now(), coalesce(max(s.current_period_end), now())) into v_start
      from public.subscriptions s
      where s.user_id = r.referrer_id and s.status in ('active', 'trialing', 'past_due');
    insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, extra_seats, status,
                                             starts_at, expires_at, activated_at, had_paid_subscription, note)
    values (v_email, r.referrer_id, 'unlimited', p_days, 1, 0, 'active',
            v_start, v_start + make_interval(days => p_days), now(), public.has_paid_subscription(r.referrer_id),
            'Referral reward (1 free month)')
    returning * into g;
  end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (null, 'referral.reward', 'complimentary_grant', g.id::text,
          jsonb_build_object('referral_id', r.id, 'days', p_days, 'expires_at', g.expires_at));
  update public.referrals set status = 'rewarded', reward_kind = 'comp_days', reward_ref = g.id::text,
    rewarded_at = now(), error = null where id = p_id;
  return jsonb_build_object('ok', true, 'grant_id', g.id, 'expires_at', g.expires_at);
end $$;

-- Record the outcome of a Stripe credit attempt made by the app.
create or replace function public.referral_finish_reward(p_id uuid, p_ok boolean, p_ref text default null, p_cents integer default null, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.referrals set
    status = case when p_ok then 'rewarded' else 'reward_failed' end,
    reward_kind = case when p_ok then 'stripe_credit' else reward_kind end,
    reward_ref = case when p_ok then left(p_ref, 255) else reward_ref end,
    reward_cents = case when p_ok then p_cents else reward_cents end,
    rewarded_at = case when p_ok then now() else rewarded_at end,
    error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and status = 'rewarding'
$$;

-- ---------------------------------------------------------------------------
-- 6. Owner report
-- ---------------------------------------------------------------------------
create or replace function public.admin_referrals(p_caller uuid, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'referrers', count(distinct referrer_id) filter (where status <> 'ineligible'),
        'signed_up', count(*) filter (where status <> 'ineligible'),
        'paying', count(*) filter (where converted_at is not null and status <> 'ineligible'),
        'rewarded', count(*) filter (where status = 'rewarded'),
        'failed', count(*) filter (where status = 'reward_failed'),
        'ineligible', count(*) filter (where status = 'ineligible'),
        'credit_cents', coalesce(sum(reward_cents) filter (where status = 'rewarded'), 0),
        'codes', (select count(*) from public.referral_codes))
      from public.referrals),
    'rows', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select r.id, r.created_at, r.code, r.status, r.ineligible_reason, r.converted_at, r.reward_kind, r.reward_cents,
               r.rewarded_at, r.error, r.invoice_id, r.reward_ref,
               ur.email as referrer_email, ue.email as referee_email
        from public.referrals r
        left join auth.users ur on ur.id = r.referrer_id
        left join auth.users ue on ue.id = r.referee_id
        order by r.created_at desc
        limit greatest(1, least(coalesce(p_limit, 200), 1000))) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.referral_email_key(text) from public, anon, authenticated;
revoke execute on function public.referral_excluded(uuid) from public, anon, authenticated;
revoke execute on function public.referral_new_code() from public, anon, authenticated;
revoke execute on function public.referral_code_for(uuid) from public, anon, authenticated;
revoke execute on function public.record_referral(uuid, text) from public, anon, authenticated;
revoke execute on function public.referral_claim_reward(uuid, text) from public, anon, authenticated;
revoke execute on function public.referral_grant_comp_days(uuid, integer) from public, anon, authenticated;
revoke execute on function public.referral_finish_reward(uuid, boolean, text, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_referrals(uuid, integer) from public, anon, authenticated;
revoke execute on function public.my_referral() from public, anon;
grant execute on function public.my_referral() to authenticated;
grant execute on function public.referral_code_for(uuid), public.record_referral(uuid, text),
  public.referral_claim_reward(uuid, text), public.referral_grant_comp_days(uuid, integer),
  public.referral_finish_reward(uuid, boolean, text, integer, text), public.admin_referrals(uuid, integer)
  to service_role;
