-- STAGING ONLY. Synthetic accounts and events (reserved .test domains; no real people). Safe to re-run.
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at)
values ('00000000-0000-4000-8000-000000000001', 'deck.builder@growth-staging.test', 'authenticated', 'authenticated', now(), now() - interval '20 days'),
       ('00000000-0000-4000-8000-000000000002', 'roofer@growth-staging.test', 'authenticated', 'authenticated', now(), now() - interval '9 days'),
       ('00000000-0000-4000-8000-000000000003', 'painter@growth-staging.test', 'authenticated', 'authenticated', now(), now() - interval '2 days'),
       ('00000000-0000-4000-8000-000000000004', 'staff@growth-staging.test', 'authenticated', 'authenticated', now(), now() - interval '30 days')
on conflict (id) do nothing;

insert into public.profiles (id, marketing_opt_in) values
  ('00000000-0000-4000-8000-000000000001', true), ('00000000-0000-4000-8000-000000000002', false),
  ('00000000-0000-4000-8000-000000000003', true), ('00000000-0000-4000-8000-000000000004', false)
on conflict (id) do nothing;
insert into public.admin_account_labels (user_id, label) values ('00000000-0000-4000-8000-000000000004', 'internal') on conflict do nothing;
insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan)
values ('sub_staging_1', '00000000-0000-4000-8000-000000000001', 'cus_staging_1', 'active', 'monthly') on conflict do nothing;

insert into public.leads (email_norm, user_id, stage, source, utm_source, utm_medium, utm_campaign, first_touch_at) values
  ('deck.builder@growth-staging.test', '00000000-0000-4000-8000-000000000001', 'paid', 'facebook', 'facebook', 'paid_social', 'decks_test', now() - interval '20 days'),
  ('roofer@growth-staging.test', '00000000-0000-4000-8000-000000000002', 'activated', 'google', 'google', 'cpc', 'roofing_test', now() - interval '9 days'),
  ('painter@growth-staging.test', '00000000-0000-4000-8000-000000000003', 'signed_up', 'direct', null, null, null, now() - interval '2 days')
on conflict (email_norm) do nothing;

insert into public.analytics_events (user_id, event, trade, event_id, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'account_created', 'decks', 'stg:ac:1', now() - interval '20 days'),
  ('00000000-0000-4000-8000-000000000001', 'bid_created', 'decks', 'stg:bc:1', now() - interval '19 days'),
  ('00000000-0000-4000-8000-000000000001', 'subscribed', 'decks', 'stg:sub:1', now() - interval '15 days'),
  ('00000000-0000-4000-8000-000000000002', 'account_created', 'roofing', 'stg:ac:2', now() - interval '9 days'),
  ('00000000-0000-4000-8000-000000000002', 'bid_activated', 'roofing', 'stg:ba:2', now() - interval '8 days'),
  ('00000000-0000-4000-8000-000000000003', 'account_created', 'painting', 'stg:ac:3', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000004', 'account_created', null, 'stg:ac:4', now() - interval '30 days')
on conflict (event_id) do nothing;

insert into public.sales_bad_emails (email) values ('bounced@growth-staging.test') on conflict do nothing;
