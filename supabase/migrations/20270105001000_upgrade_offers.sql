-- V8 batch 4: upgrade offer log (frequency caps, suppression, attribution) and cancellation reasons.
--
--   * One row per time an in-app offer was shown, clicked or dismissed, plus the optional reason a
--     subscriber picked on the "Before you go" step before Stripe's cancellation page.
--   * No bid content, amounts, names or emails: only the offer id, the action and (for reasons and
--     clicks) a short code from a fixed list.
--   * Browsers can't read or write it. The API writes with the service role after checking the caps
--     in src/lib/offers/policy.ts, and the owner reads it on /admin/marketing.
--
-- Nothing here sends email, changes billing or touches existing data. Safe to run more than once.
-- Rollback: docs/v8-marketing/rollback_20270105001000.sql
create table if not exists public.upgrade_offers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_id text not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.upgrade_offers drop constraint if exists upgrade_offers_offer_id_check;
alter table public.upgrade_offers add constraint upgrade_offers_offer_id_check
  check (offer_id in ('t1_credits_low', 't5_annual', 't8_first_sent', 'ret1_cancel'));
alter table public.upgrade_offers drop constraint if exists upgrade_offers_action_check;
alter table public.upgrade_offers add constraint upgrade_offers_action_check
  check (action in ('shown', 'clicked', 'dismissed', 'answered'));
alter table public.upgrade_offers drop constraint if exists upgrade_offers_detail_check;
alter table public.upgrade_offers add constraint upgrade_offers_detail_check
  check (detail is null or detail ~ '^[a-z0-9_]{1,40}$');

create index if not exists upgrade_offers_user_time_idx on public.upgrade_offers (user_id, created_at desc);
create index if not exists upgrade_offers_offer_time_idx on public.upgrade_offers (offer_id, created_at desc);

-- Service role only: RLS on with no policies, and no table grants for browser roles.
alter table public.upgrade_offers enable row level security;
revoke all on public.upgrade_offers from anon, authenticated;
