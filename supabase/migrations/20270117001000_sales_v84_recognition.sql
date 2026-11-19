-- Sales Hub V8.4 P1: work-preferences profile, dashboard layout, customer success celebrations, the
-- owner congratulations email workflow and the reward catalog.
--
-- Principles (James, V8.4 spec):
--   * The preferences survey is optional and changes presentation only. Answers never feed pay, ranking,
--     opportunities or any automated decision, and admins see only what recognition and rewards need.
--   * Customer success is recorded from verifiable product events (a real estimate with 3+ priced line
--     items, a proposal sent or exported, the 7-day activation rule), at most once per customer and kind.
--   * Congratulations emails are drafts until the owner approves each one, go out only while the owner
--     has switched the program on, and never go to a rep who opted out. One per onboarding, ever.
--   * Rewards are records. Nothing here buys or sends anything. Only an owner-authorized cash reward
--     becomes a ledger line (kind 'reward'), which then goes through the normal statement approval.

-- ---------------------------------------------------------------------------------------------------
-- 1. Work preferences (one row per rep, written only through the functions below)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_rep_preferences (
  rep_id uuid primary key references public.sales_reps (id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'skipped', 'partial', 'complete')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 16000),
  public_recognition boolean not null default false,
  congrats_email boolean not null default true,
  share_interests boolean not null default true,
  -- null = use the layout recommended from the answers; otherwise the rep's own choice.
  dashboard_layout text check (dashboard_layout in ('progress', 'earnings', 'team', 'portfolio')),
  animations boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.sales_rep_preferences enable row level security;
revoke all on public.sales_rep_preferences from public, anon, authenticated;
grant all on public.sales_rep_preferences to service_role;

-- Answers are keyed q1..q20; each value is a short string or a short list of strings.
create or replace function public.sales_preferences_valid(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
    where e.key !~ '^q([1-9]|1[0-9]|20)$'
       or not case jsonb_typeof(e.value)
         when 'string' then char_length(e.value #>> '{}') <= 500
         when 'array' then jsonb_array_length(e.value) <= 12 and not exists (
           select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 100)
         else false end)
$$;

create or replace function public.sales_my_preferences() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; p public.sales_rep_preferences;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into p from public.sales_rep_preferences where rep_id = rep.id;
  return jsonb_build_object('status', coalesce(p.status, 'not_started'), 'answers', coalesce(p.answers, '{}'::jsonb),
    'public_recognition', coalesce(p.public_recognition, false), 'congrats_email', coalesce(p.congrats_email, true),
    'share_interests', coalesce(p.share_interests, true), 'dashboard_layout', p.dashboard_layout,
    'animations', coalesce(p.animations, true), 'updated_at', p.updated_at);
end $$;

create or replace function public.sales_my_preferences_save(
  p_answers jsonb, p_status text, p_public_recognition boolean, p_congrats_email boolean, p_share_interests boolean,
  p_dashboard_layout text, p_animations boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if not public.sales_preferences_valid(coalesce(p_answers, '{}'::jsonb)) then raise exception 'invalid_answers' using errcode = '22023'; end if;
  if p_status not in ('not_started', 'skipped', 'partial', 'complete') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_dashboard_layout is not null and p_dashboard_layout not in ('progress', 'earnings', 'team', 'portfolio') then
    raise exception 'invalid_layout' using errcode = '22023';
  end if;
  insert into public.sales_rep_preferences as t (rep_id, status, answers, public_recognition, congrats_email, share_interests, dashboard_layout, animations, updated_at)
  values (rep.id, p_status, coalesce(p_answers, '{}'::jsonb), coalesce(p_public_recognition, false), coalesce(p_congrats_email, true),
          coalesce(p_share_interests, true), p_dashboard_layout, coalesce(p_animations, true), now())
  on conflict (rep_id) do update set status = excluded.status, answers = excluded.answers, public_recognition = excluded.public_recognition,
    congrats_email = excluded.congrats_email, share_interests = excluded.share_interests, dashboard_layout = excluded.dashboard_layout,
    animations = excluded.animations, updated_at = now();
  -- Opting out also withdraws any congratulations email still waiting for approval.
  if p_congrats_email is false then
    update public.sales_congrats_emails set status = 'skipped', last_error = 'rep opted out'
    where rep_id = rep.id and status in ('draft', 'failed');
  end if;
  return public.sales_my_preferences();
end $$;

-- "Delete my answers": removes every survey answer; visibility and email choices are kept.
create or replace function public.sales_my_preferences_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  update public.sales_rep_preferences set answers = '{}'::jsonb, status = 'not_started', updated_at = now() where rep_id = rep.id;
  return public.sales_my_preferences();
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Customer success celebrations
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_customer_successes (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('first_estimate', 'first_proposal', 'activated', 'onboarding_complete')),
  occurred_at timestamptz not null,
  detected_at timestamptz not null default now(),
  celebrated_at timestamptz,
  congratulated_at timestamptz,
  congratulated_by uuid references auth.users (id) on delete set null,
  admin_note text check (char_length(admin_note) <= 1000),
  unique (user_id, kind)
);
create index if not exists sales_customer_successes_rep on public.sales_customer_successes (rep_id, occurred_at desc);
alter table public.sales_customer_successes enable row level security;
revoke all on public.sales_customer_successes from public, anon, authenticated;
grant all on public.sales_customer_successes to service_role;

-- Private admin notes on achievements too.
alter table public.sales_achievements add column if not exists admin_note text check (char_length(admin_note) <= 1000);

-- Owner congratulations settings (not compensation, so not part of the versioned policy).
alter table public.sales_settings add column if not exists congrats_enabled boolean not null default false;
alter table public.sales_settings add column if not exists congrats_subject text not null default 'Congratulations on Your Customer Onboarding!'
  check (char_length(congrats_subject) between 1 and 200);
alter table public.sales_settings add column if not exists congrats_body text not null default
  E'Hey {first_name},\n\nCongratulations on getting another customer through onboarding!\n\nI really appreciate you being part of the Built2Bid team and the work you''re putting into helping contractors succeed.\n\nThanks for all the hard work, as always.\n\nCarry on, soldier.\n\nJames\nBuilt2Bid'
  check (char_length(congrats_body) between 1 and 5000);

create table if not exists public.sales_congrats_emails (
  id uuid primary key default gen_random_uuid(),
  success_id uuid not null unique references public.sales_customer_successes (id) on delete cascade,
  rep_id uuid not null references public.sales_reps (id),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  locked_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now()
);
alter table public.sales_congrats_emails enable row level security;
revoke all on public.sales_congrats_emails from public, anon, authenticated;
grant all on public.sales_congrats_emails to service_role;

-- Records each attributed, paying customer's verifiable milestones once, then queues a congratulations
-- draft for each new completed onboarding (only while the owner has the program on and the rep hasn't
-- opted out). Safe to run any number of times.
create or replace function public.sales_customer_successes_evaluate(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_new integer := 0; v_queued integer := 0; cfg public.sales_settings;
begin
  select * into cfg from public.sales_settings where id;
  with cust as (
    select a.user_id, a.rep_id from public.sales_attributions a
    join public.sales_reps r on r.id = a.rep_id
    where a.first_paid_at is not null and a.first_paid_at <= p_now and a.ended_at is null
  ), est as (
    select g.user_id, min(g.reached_at) at from public.growth_meaningful_estimates() g
    join cust c on c.user_id = g.user_id where g.reached_at <= p_now group by 1
  ), prop as (
    select e.user_id, min(e.created_at) at from public.analytics_events e join cust c on c.user_id = e.user_id
    where e.event in ('proposal_sent', 'export_succeeded') and e.created_at <= p_now group by 1
  ), act as (
    select e.user_id, min(e.created_at) at from public.analytics_events e join cust c on c.user_id = e.user_id
    where e.event = 'bid_activated' and e.created_at <= p_now group by 1
  ), hits as (
    select c.rep_id, c.user_id, 'first_estimate' kind, est.at from cust c join est using (user_id)
    union all select c.rep_id, c.user_id, 'first_proposal', prop.at from cust c join prop using (user_id)
    union all select c.rep_id, c.user_id, 'activated', act.at from cust c join act using (user_id)
    -- Onboarding is complete once the customer has built a real estimate AND sent or exported a proposal.
    union all select c.rep_id, c.user_id, 'onboarding_complete', greatest(est.at, prop.at) from cust c join est using (user_id) join prop using (user_id)
  ), ins as (
    insert into public.sales_customer_successes (rep_id, user_id, kind, occurred_at, detected_at)
    select rep_id, user_id, kind, at, p_now from hits
    on conflict (user_id, kind) do nothing
    returning id, rep_id, kind
  ), q as (
    insert into public.sales_congrats_emails (success_id, rep_id, subject, body)
    select i.id, i.rep_id, cfg.congrats_subject,
      replace(cfg.congrats_body, '{first_name}', split_part(btrim(r.full_name), ' ', 1))
    from ins i join public.sales_reps r on r.id = i.rep_id
    left join public.sales_rep_preferences p on p.rep_id = i.rep_id
    where i.kind = 'onboarding_complete' and cfg.congrats_enabled and coalesce(p.congrats_email, true) and r.status = 'active'
    on conflict (success_id) do nothing
    returning 1
  )
  select (select count(*) from ins), (select count(*) from q) into v_new, v_queued;
  return jsonb_build_object('new', v_new, 'queued', v_queued);
end $$;

create or replace function public.sales_my_successes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'occurred_at', s.occurred_at,
      'celebrated', s.celebrated_at is not null, 'congratulated', s.congratulated_at is not null,
      'customer', coalesce(nullif(btrim(b.company_name), ''), 'Your customer')) order by s.occurred_at desc)
    from (select * from public.sales_customer_successes where rep_id = rep.id order by occurred_at desc limit 60) s
    left join public.business_profiles b on b.user_id = s.user_id), '[]'::jsonb);
end $$;

-- The celebration plays once; replaying it never creates anything.
create or replace function public.sales_my_successes_seen(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; n integer;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  update public.sales_customer_successes set celebrated_at = now()
  where rep_id = rep.id and id = any (p_ids) and celebrated_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Congratulations workflow (owner only: the email goes out in the owner's name)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_congrats_settings_save(p_caller uuid, p_enabled boolean, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if coalesce(btrim(p_subject), '') = '' or coalesce(btrim(p_body), '') = '' then raise exception 'text_required' using errcode = '22023'; end if;
  update public.sales_settings set congrats_enabled = coalesce(p_enabled, false), congrats_subject = left(btrim(p_subject), 200),
    congrats_body = left(btrim(p_body), 5000) where id;
  perform public.sales_audit(p_caller, 'sales.congrats_settings_saved', 'sales_settings', 'singleton', jsonb_build_object('enabled', coalesce(p_enabled, false)));
  return jsonb_build_object('enabled', coalesce(p_enabled, false));
end $$;

-- Approve (with any edits) and claim one draft for sending. Returns the address to send to. A claim
-- left behind by an interrupted send can be taken again after 5 minutes; the sender passes this row's
-- id as the provider idempotency key, so a retry never sends twice.
create or replace function public.admin_sales_congrats_claim(p_caller uuid, p_id uuid, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.sales_congrats_emails; r public.sales_reps; cfg public.sales_settings; p public.sales_rep_preferences;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  select * into cfg from public.sales_settings where id;
  if not cfg.congrats_enabled then raise exception 'congrats_disabled' using errcode = '22023'; end if;
  select * into m from public.sales_congrats_emails where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (m.status in ('draft', 'failed') or (m.status = 'sending' and m.locked_at < now() - interval '5 minutes')) then
    raise exception 'not_sendable' using errcode = '22023';
  end if;
  if m.attempts >= 5 then raise exception 'too_many_attempts' using errcode = '22023'; end if;
  select * into r from public.sales_reps where id = m.rep_id;
  select * into p from public.sales_rep_preferences where rep_id = m.rep_id;
  if r.status <> 'active' or coalesce(p.congrats_email, true) = false then
    -- Returned rather than raised so the skip is kept.
    update public.sales_congrats_emails set status = 'skipped', last_error = 'rep opted out or inactive' where id = m.id;
    return jsonb_build_object('id', m.id, 'skipped', true);
  end if;
  if coalesce(btrim(p_subject), '') = '' or coalesce(btrim(p_body), '') = '' then raise exception 'text_required' using errcode = '22023'; end if;
  update public.sales_congrats_emails set status = 'sending', locked_at = now(), attempts = attempts + 1,
    subject = left(btrim(p_subject), 200), body = left(btrim(p_body), 5000), approved_by = p_caller, approved_at = now()
  where id = m.id returning * into m;
  perform public.sales_audit(p_caller, 'sales.congrats_approved', 'sales_congrats_emails', m.id::text, jsonb_build_object('rep_id', m.rep_id));
  return jsonb_build_object('id', m.id, 'to', r.email, 'subject', m.subject, 'body', m.body);
end $$;

create or replace function public.admin_sales_congrats_result(p_caller uuid, p_id uuid, p_ok boolean, p_message_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_congrats_emails;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  select * into m from public.sales_congrats_emails where id = p_id for update;
  if not found or m.status <> 'sending' then raise exception 'not_sending' using errcode = '22023'; end if;
  if p_ok then
    update public.sales_congrats_emails set status = 'sent', sent_at = now(), provider_message_id = left(p_message_id, 200), last_error = null, locked_at = null where id = m.id;
    update public.sales_customer_successes set congratulated_at = coalesce(congratulated_at, now()), congratulated_by = coalesce(congratulated_by, p_caller) where id = m.success_id;
  else
    update public.sales_congrats_emails set status = 'failed', last_error = left(coalesce(p_error, 'send failed'), 500), locked_at = null where id = m.id;
  end if;
end $$;

create or replace function public.admin_sales_congrats_skip(p_caller uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  update public.sales_congrats_emails set status = 'skipped', last_error = 'skipped by owner' where id = p_id and status in ('draft', 'failed');
  if not found then raise exception 'not_skippable' using errcode = '22023'; end if;
end $$;

-- Congratulated in person or another way (no email).
create or replace function public.admin_sales_success_congratulate(p_caller uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  update public.sales_customer_successes set congratulated_at = now(), congratulated_by = p_caller where id = p_id and congratulated_at is null;
end $$;

create or replace function public.admin_sales_recognition_note(p_caller uuid, p_kind text, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  perform public.sales_require_admin(p_caller);
  if p_kind = 'success' then update public.sales_customer_successes set admin_note = v where id = p_id;
  elsif p_kind = 'achievement' then update public.sales_achievements set admin_note = v where id = p_id;
  else raise exception 'invalid_kind' using errcode = '22023'; end if;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Reward catalog and award records
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback', 'bonus', 'accelerator', 'reward'));
alter table public.sales_commissions drop constraint if exists sales_commissions_check;
alter table public.sales_commissions add constraint sales_commissions_check
  check ((kind in ('commission', 'bonus', 'accelerator', 'reward') and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));

create table if not exists public.sales_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 1000),
  category text not null check (category in ('gift_card', 'experience', 'restaurant', 'outdoor_hobby', 'training', 'conference', 'equipment', 'cash')),
  eligibility text check (char_length(eligibility) <= 500),
  value_cents integer not null check (value_cents between 0 and 1000000),
  cost_cents integer not null check (cost_cents between 0 and 1000000),
  redemption_method text check (char_length(redemption_method) <= 200),
  tax_treatment text not null check (tax_treatment in ('taxable_cash', 'taxable_cash_equivalent', 'taxable_noncash', 'de_minimis', 'working_condition')),
  requires_approval boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'retired')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cash is always taxable cash; gift cards are always cash equivalents.
  check (category <> 'cash' or tax_treatment = 'taxable_cash'),
  check (category <> 'gift_card' or tax_treatment = 'taxable_cash_equivalent')
);
alter table public.sales_rewards enable row level security;
revoke all on public.sales_rewards from public, anon, authenticated;
grant all on public.sales_rewards to service_role;

create table if not exists public.sales_reward_awards (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid references public.sales_rewards (id),
  rep_id uuid not null references public.sales_reps (id),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  achievement_id uuid references public.sales_achievements (id) on delete set null,
  success_id uuid references public.sales_customer_successes (id) on delete set null,
  value_cents integer not null check (value_cents between 0 and 1000000),
  tax_category text not null check (tax_category in ('taxable_cash', 'taxable_cash_equivalent', 'taxable_noncash', 'de_minimis', 'working_condition')),
  status text not null default 'proposed' check (status in ('proposed', 'authorized', 'ordered', 'delivered', 'canceled')),
  proposed_by uuid references auth.users (id) on delete set null,
  proposed_at timestamptz not null default now(),
  authorized_by uuid references auth.users (id) on delete set null,
  authorized_at timestamptz,
  delivered_at timestamptz,
  commission_id uuid references public.sales_commissions (id),
  note text check (char_length(note) <= 1000)
);
-- One live award per achievement or customer success: a replayed celebration can't award twice.
create unique index if not exists sales_reward_awards_achievement on public.sales_reward_awards (achievement_id) where achievement_id is not null and status <> 'canceled';
create unique index if not exists sales_reward_awards_success on public.sales_reward_awards (success_id) where success_id is not null and status <> 'canceled';
create index if not exists sales_reward_awards_rep on public.sales_reward_awards (rep_id, proposed_at desc);
alter table public.sales_reward_awards enable row level security;
revoke all on public.sales_reward_awards from public, anon, authenticated;
grant all on public.sales_reward_awards to service_role;

create or replace function public.admin_sales_reward_save(
  p_caller uuid, p_id uuid, p_name text, p_description text, p_category text, p_eligibility text, p_value_cents integer,
  p_cost_cents integer, p_redemption text, p_tax text, p_requires_approval boolean, p_status text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if p_id is null then
    insert into public.sales_rewards (name, description, category, eligibility, value_cents, cost_cents, redemption_method, tax_treatment, requires_approval, status, created_by)
    values (btrim(p_name), nullif(btrim(p_description), ''), p_category, nullif(btrim(p_eligibility), ''), p_value_cents, p_cost_cents,
            nullif(btrim(p_redemption), ''), p_tax, coalesce(p_requires_approval, true), coalesce(p_status, 'draft'), p_caller)
    returning id into v;
  else
    update public.sales_rewards set name = btrim(p_name), description = nullif(btrim(p_description), ''), category = p_category,
      eligibility = nullif(btrim(p_eligibility), ''), value_cents = p_value_cents, cost_cents = p_cost_cents,
      redemption_method = nullif(btrim(p_redemption), ''), tax_treatment = p_tax, requires_approval = coalesce(p_requires_approval, true),
      status = coalesce(p_status, status), updated_at = now()
    where id = p_id returning id into v;
    if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  perform public.sales_audit(p_caller, 'sales.reward_saved', 'sales_rewards', v::text, jsonb_build_object('name', p_name, 'value_cents', p_value_cents, 'status', p_status));
  return v;
end $$;

-- A Sales Admin (or the owner) proposes an award; never for their own rep record.
create or replace function public.admin_sales_award_propose(
  p_caller uuid, p_rep uuid, p_reward uuid, p_reason text, p_achievement uuid, p_success uuid, p_value_cents integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rw public.sales_rewards; v uuid;
begin
  perform public.sales_require_cap(p_caller, 'approve_commissions');
  if public.sales_is_own_rep(p_caller, p_rep) then raise exception 'cannot_approve_own' using errcode = '42501'; end if;
  select * into rw from public.sales_rewards where id = p_reward;
  if not found or rw.status <> 'active' then raise exception 'reward_unavailable' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_achievement is not null and not exists (select 1 from public.sales_achievements where id = p_achievement and rep_id = p_rep) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_success is not null and not exists (select 1 from public.sales_customer_successes where id = p_success and rep_id = p_rep) then raise exception 'not_found' using errcode = 'P0002'; end if;
  begin
    insert into public.sales_reward_awards (reward_id, rep_id, reason, achievement_id, success_id, value_cents, tax_category, proposed_by)
    values (rw.id, p_rep, left(btrim(p_reason), 300), p_achievement, p_success, coalesce(p_value_cents, rw.value_cents), rw.tax_treatment, p_caller)
    returning id into v;
  exception when unique_violation then raise exception 'already_awarded' using errcode = '23505';
  end;
  perform public.sales_audit(p_caller, 'sales.reward_proposed', 'sales_reward_awards', v::text, jsonb_build_object('rep_id', p_rep, 'reward_id', rw.id, 'value_cents', coalesce(p_value_cents, rw.value_cents)));
  return v;
end $$;

-- Owner-only status changes. Authorizing a cash reward adds one earned 'reward' ledger line, which goes
-- on the next statement through the normal approval; other rewards stay records the owner fulfils by hand.
create or replace function public.admin_sales_award_set(p_caller uuid, p_id uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.sales_reward_awards; v_line uuid; v_line_status text;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  select * into a from public.sales_reward_awards where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if public.sales_is_own_rep(p_caller, a.rep_id) then raise exception 'cannot_approve_own' using errcode = '42501'; end if;
  if not (
    (a.status = 'proposed' and p_status in ('authorized', 'canceled')) or
    (a.status = 'authorized' and p_status in ('ordered', 'delivered', 'canceled')) or
    (a.status = 'ordered' and p_status in ('delivered', 'canceled'))
  ) then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if p_status = 'canceled' and a.commission_id is not null then
    select status into v_line_status from public.sales_commissions where id = a.commission_id for update;
    if v_line_status not in ('earned', 'pending') then raise exception 'already_paid' using errcode = '22023'; end if;
    update public.sales_commissions set status = 'canceled', reason = 'reward canceled' where id = a.commission_id;
  end if;
  if p_status = 'authorized' and a.tax_category = 'taxable_cash' and a.value_cents > 0 then
    insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at)
    values (a.rep_id, null, 1, 'reward', public.sales_month_of(now()), a.value_cents,
      jsonb_build_object('award_id', a.id, 'reward_id', a.reward_id, 'reason', a.reason), 'earned', 'reward', now())
    returning id into v_line;
  end if;
  update public.sales_reward_awards set status = p_status,
    authorized_by = case when p_status = 'authorized' then p_caller else authorized_by end,
    authorized_at = case when p_status = 'authorized' then now() else authorized_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    commission_id = coalesce(v_line, commission_id),
    note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), note)
  where id = a.id;
  perform public.sales_audit(p_caller, 'sales.reward_' || p_status, 'sales_reward_awards', a.id::text, jsonb_build_object('rep_id', a.rep_id, 'value_cents', a.value_cents, 'commission_id', v_line));
  return jsonb_build_object('status', p_status, 'commission_id', v_line);
end $$;

create or replace function public.sales_my_rewards() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return jsonb_build_object(
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'description', w.description, 'category', w.category,
        'eligibility', w.eligibility, 'value_cents', w.value_cents) order by w.category, w.value_cents) from public.sales_rewards w where w.status = 'active'), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', w.name, 'reason', a.reason, 'value_cents', a.value_cents,
        'tax_category', a.tax_category, 'status', a.status, 'proposed_at', a.proposed_at, 'delivered_at', a.delivered_at) order by a.proposed_at desc)
      from public.sales_reward_awards a left join public.sales_rewards w on w.id = a.reward_id where a.rep_id = rep.id and a.status <> 'canceled'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Admin view. Preferences are limited to what recognition and rewards need: how each rep likes to be
--    recognized, reward categories, public consent, and interests only if the rep chose to share them.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_recognition(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.sales_settings;
begin
  perform public.sales_require_admin(p_caller);
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('congrats_enabled', cfg.congrats_enabled, 'congrats_subject', cfg.congrats_subject, 'congrats_body', cfg.congrats_body),
    'successes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rep_id', s.rep_id, 'rep', r.full_name, 'kind', s.kind, 'occurred_at', s.occurred_at,
        'customer', coalesce(nullif(btrim(b.company_name), ''), 'Customer'), 'customer_id', s.user_id, 'congratulated_at', s.congratulated_at, 'admin_note', s.admin_note,
        'award', (select a.status from public.sales_reward_awards a where a.success_id = s.id and a.status <> 'canceled' limit 1)) order by s.occurred_at desc)
      from (select * from public.sales_customer_successes order by occurred_at desc limit 100) s
      join public.sales_reps r on r.id = s.rep_id left join public.business_profiles b on b.user_id = s.user_id), '[]'::jsonb),
    'congrats', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'rep', r.full_name, 'rep_id', m.rep_id, 'subject', m.subject, 'body', m.body,
        'status', m.status, 'attempts', m.attempts, 'last_error', m.last_error, 'sent_at', m.sent_at, 'created_at', m.created_at,
        'customer', coalesce(nullif(btrim(b.company_name), ''), 'Customer')) order by m.created_at desc)
      from (select * from public.sales_congrats_emails where status in ('draft', 'sending', 'failed') or created_at > now() - interval '60 days' order by created_at desc limit 100) m
      join public.sales_reps r on r.id = m.rep_id join public.sales_customer_successes s on s.id = m.success_id
      left join public.business_profiles b on b.user_id = s.user_id), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(to_jsonb(w) - 'created_by' order by w.status, w.name) from public.sales_rewards w where w.status <> 'retired'), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'rep_id', a.rep_id, 'rep', r.full_name, 'reward', w.name, 'reason', a.reason,
        'value_cents', a.value_cents, 'tax_category', a.tax_category, 'status', a.status, 'proposed_at', a.proposed_at, 'authorized_at', a.authorized_at,
        'delivered_at', a.delivered_at, 'commission_status', c.status, 'note', a.note) order by a.proposed_at desc)
      from (select * from public.sales_reward_awards order by proposed_at desc limit 100) a join public.sales_reps r on r.id = a.rep_id
      left join public.sales_rewards w on w.id = a.reward_id left join public.sales_commissions c on c.id = a.commission_id), '[]'::jsonb),
    'preferences', coalesce((select jsonb_agg(jsonb_build_object('rep_id', r.id, 'rep', r.full_name, 'status', coalesce(p.status, 'not_started'),
        'public_recognition', coalesce(p.public_recognition, false), 'congrats_email', coalesce(p.congrats_email, true),
        'recognition', jsonb_strip_nulls(jsonb_build_object('celebrate', p.answers -> 'q3', 'visibility', p.answers -> 'q4', 'owner_congrats', p.answers -> 'q16',
          'rewards', p.answers -> 'q11', 'reward_type', p.answers -> 'q12', 'gift_category', p.answers -> 'q15', 'team_celebrations', p.answers -> 'q17')),
        'interests', case when coalesce(p.share_interests, true) then jsonb_strip_nulls(jsonb_build_object('hobbies', p.answers -> 'q13', 'experiences', p.answers -> 'q14')) end)
        order by r.full_name)
      from public.sales_reps r left join public.sales_rep_preferences p on p.rep_id = r.id
      where r.status = 'active' and (r.role <> 'admin' or r.sells)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_customer_successes_evaluate(timestamptz)', 'public.admin_sales_congrats_settings_save(uuid, boolean, text, text)',
    'public.admin_sales_congrats_claim(uuid, uuid, text, text)', 'public.admin_sales_congrats_result(uuid, uuid, boolean, text, text)',
    'public.admin_sales_congrats_skip(uuid, uuid)', 'public.admin_sales_success_congratulate(uuid, uuid)',
    'public.admin_sales_recognition_note(uuid, text, uuid, text)',
    'public.admin_sales_reward_save(uuid, uuid, text, text, text, text, integer, integer, text, text, boolean, text)',
    'public.admin_sales_award_propose(uuid, uuid, uuid, text, uuid, uuid, integer)', 'public.admin_sales_award_set(uuid, uuid, text, text)',
    'public.admin_sales_recognition(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.sales_my_preferences()', 'public.sales_my_preferences_save(jsonb, text, boolean, boolean, boolean, text, boolean)',
    'public.sales_my_preferences_clear()', 'public.sales_my_successes()', 'public.sales_my_successes_seen(uuid[])', 'public.sales_my_rewards()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
