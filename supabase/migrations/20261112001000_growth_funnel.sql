-- Growth funnel: lead identity, campaign attribution, lifecycle events, suppression and ad costs.
--
-- Purely additive (new tables + one admin function). No existing table, row or function is changed.
-- Rollback: supabase/rollback/20261112001000_growth_funnel_down.sql (drops only these objects).
--
-- Identity: one row per normalized email in public.leads. A prospect imported from Instantly and the
-- account that later signs up with the same email are the same lead (user_id is filled in on signup).
-- Suppression survives account deletion on purpose (user_id -> null, email kept) so a deleted or
-- unsubscribed person is never re-prospected. Only the email and campaign ids are stored; email
-- bodies and reply text from Instantly are NOT stored.
--
-- Access: service role only (RLS on, no policies, grants revoked), like the other internal tables.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  email_norm text not null unique check (email_norm = lower(btrim(email_norm)) and position('@' in email_norm) > 1 and char_length(email_norm) <= 320),
  user_id uuid unique references auth.users (id) on delete set null,
  stage text not null default 'prospect' check (stage in ('prospect', 'contacted', 'engaged', 'replied', 'interested', 'signed_up', 'activated', 'paid', 'churned')),
  stage_changed_at timestamptz not null default now(),
  -- First touch (never overwritten once set)
  source text check (char_length(source) <= 64),
  first_campaign_id text check (char_length(first_campaign_id) <= 128),
  first_campaign_name text check (char_length(first_campaign_name) <= 200),
  utm_source text check (char_length(utm_source) <= 200),
  utm_medium text check (char_length(utm_medium) <= 200),
  utm_campaign text check (char_length(utm_campaign) <= 200),
  utm_content text check (char_length(utm_content) <= 200),
  utm_term text check (char_length(utm_term) <= 200),
  landing_path text check (char_length(landing_path) <= 500),
  first_touch_at timestamptz,
  -- Last touch
  last_campaign_id text check (char_length(last_campaign_id) <= 128),
  last_campaign_name text check (char_length(last_campaign_name) <= 200),
  -- Suppression: any non-null value stops all prospecting and promotional email.
  unsubscribed_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text check (suppression_reason in ('unsubscribed', 'bounced', 'customer', 'complaint', 'manual', 'deleted_account')),
  -- Set once the email is on the Instantly workspace block list (null = not pushed yet).
  instantly_blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger leads_updated before update on public.leads for each row execute function public.set_updated_at();
create index leads_stage_idx on public.leads (stage);
create index leads_first_campaign_idx on public.leads (first_campaign_id);
create index leads_suppressed_idx on public.leads (suppressed_at) where suppressed_at is not null;

create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event text not null check (char_length(event) <= 64),
  source text not null check (source in ('instantly', 'app', 'stripe', 'admin')),
  campaign_id text check (char_length(campaign_id) <= 128),
  -- Idempotency: the same delivery (e.g. an Instantly webhook retry) is stored once.
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  meta jsonb check (meta is null or pg_column_size(meta) <= 4096),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, occurred_at desc);
create index lead_events_event_idx on public.lead_events (event, occurred_at desc);

-- Manually entered spend, so CAC is only ever computed from real costs.
create table public.marketing_costs (
  id bigint generated always as identity primary key,
  period_start date not null,
  channel text not null check (char_length(channel) between 1 and 64),
  campaign_id text check (char_length(campaign_id) <= 128),
  amount_usd numeric(12, 2) not null check (amount_usd >= 0),
  note text check (char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index marketing_costs_period_idx on public.marketing_costs (period_start);

alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.marketing_costs enable row level security;
revoke all on public.leads, public.lead_events, public.marketing_costs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- growth_funnel: aggregate numbers for the admin Sales dashboard. Admins only.
-- Revenue is "run-rate from active plans at list price", not collected cash (Stripe is the source
-- of truth for actual revenue).
-- ---------------------------------------------------------------------------
create or replace function public.growth_funnel(p_caller uuid, p_since timestamptz default now() - interval '30 days')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'since', p_since,
    'leads_total', (select count(*) from public.leads),
    'leads_new', (select count(*) from public.leads where created_at >= p_since),
    'leads_suppressed', (select count(*) from public.leads where suppressed_at is not null),
    'leads_by_stage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.leads group by stage) s), '{}'::jsonb),
    'signups_total', (select count(*) from auth.users),
    'signups_new', (select count(*) from auth.users where created_at >= p_since),
    'activated_total', (select count(distinct user_id) from public.estimate_versions),
    'activated_new', (select count(*) from (select user_id, min(created_at) f from public.estimate_versions group by user_id) a where a.f >= p_since),
    'paying_monthly', (select count(*) from public.subscriptions where plan = 'monthly' and status in ('active', 'trialing', 'past_due')),
    'paying_annual', (select count(*) from public.subscriptions where plan = 'annual' and status in ('active', 'trialing', 'past_due')),
    'churned_new', (select count(*) from public.subscriptions where status = 'canceled' and updated_at >= p_since),
    'campaigns', coalesce((
      select jsonb_agg(c order by c->>'leads' desc) from (
        select jsonb_build_object(
          'campaign', coalesce(l.first_campaign_name, l.first_campaign_id, l.utm_campaign, l.source, '(direct / unknown)'),
          'leads', count(*),
          'replied', count(*) filter (where exists (select 1 from public.lead_events e where e.lead_id = l.id and e.event = 'reply_received')),
          'signed_up', count(*) filter (where l.user_id is not null),
          'activated', count(*) filter (where l.user_id is not null and exists (select 1 from public.estimate_versions v where v.user_id = l.user_id)),
          'paid', count(*) filter (where l.user_id is not null and exists (select 1 from public.subscriptions s where s.user_id = l.user_id and s.status in ('active', 'trialing', 'past_due'))),
          'unsubscribed', count(*) filter (where l.unsubscribed_at is not null)
        ) c
        from public.leads l
        group by coalesce(l.first_campaign_name, l.first_campaign_id, l.utm_campaign, l.source, '(direct / unknown)')
      ) x), '[]'::jsonb),
    'costs_usd', (select coalesce(sum(amount_usd), 0) from public.marketing_costs where period_start >= p_since::date),
    'costs_total_usd', (select coalesce(sum(amount_usd), 0) from public.marketing_costs)
  ) into r;
  return r;
end $$;

revoke all on function public.growth_funnel(uuid, timestamptz) from public, anon, authenticated;
