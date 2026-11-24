-- Growth OS Phase 3 staging checks. Synthetic rows only (syn-p3 ids, @example.test emails), removed at the end.
-- Run after 01_standins.sql and the migration. Any failed check raises, so the whole run rolls back.
create temp table if not exists p3_results (n serial, check_name text, pass boolean, detail text) on commit preserve rows;
truncate p3_results;
do $$
declare
  u1 uuid := 'a3a3a3a3-0000-4000-8000-000000000001'; u2 uuid := 'a3a3a3a3-0000-4000-8000-000000000002';
  v1 uuid := 'b3b3b3b3-0000-4000-8000-000000000001'; v2 uuid := 'b3b3b3b3-0000-4000-8000-000000000002';
  n integer; s bigint; ok boolean;
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at) values
    (u1, 'syn-p3-1@example.test', 'authenticated', 'authenticated', now(), now()),
    (u2, 'syn-p3-2@example.test', 'authenticated', 'authenticated', now(), now());

  -- Touches: three visits by one browser before sign-in, one by another.
  insert into public.marketing_touches (visitor_id, touch_at, channel, utm_source, utm_medium, utm_campaign, landing_path, click_id_type, device_type, dedupe_key) values
    (v1, now() - interval '10 days', 'google_ads', 'google', 'cpc', 'b2b-google-signup-202611', '/bids/roofing', 'gclid', 'mobile', repeat('1', 64)),
    (v1, now() - interval '7 days', 'organic_social', null, null, null, '/pricing', null, 'mobile', repeat('2', 64)),
    (v1, now() - interval '5 days', 'email_outreach', 'instantly', 'email', 'cold_outreach', '/pricing', null, 'mobile', repeat('3', 64)),
    (v2, now() - interval '4 days', 'google_ads', 'google', 'cpc', 'b2b-google-signup-202611', '/bids/painting', 'gclid', 'desktop', repeat('4', 64));
  -- Replayed cookie: same dedupe key stores nothing new.
  insert into public.marketing_touches (visitor_id, touch_at, channel, dedupe_key) values (v1, now() - interval '10 days', 'google_ads', repeat('1', 64)) on conflict (dedupe_key) do nothing;
  select count(*) into n from public.marketing_touches where visitor_id in (v1, v2);
  insert into p3_results (check_name, pass, detail) values ('touch dedupe: replayed touch stored once', n = 4, n || ' rows');

  n := public.mkt_link_visitor(v1, u1);
  insert into p3_results (check_name, pass, detail) values ('sign-in links the visitor''s 3 earlier touches', n = 3, n || ' attached');
  n := public.mkt_link_visitor(v1, u2);
  insert into p3_results (check_name, pass, detail) values ('shared browser: a second account gets nothing', n = 0 and (select user_id from public.marketing_identity_links where visitor_id = v1) = u1, n || ' attached');
  n := public.mkt_link_visitor(v1, u1);
  insert into p3_results (check_name, pass, detail) values ('linking again is a no-op', n = 0, n || ' attached');
  n := public.mkt_link_visitor(v2, u2);
  insert into p3_results (check_name, pass, detail) values ('second visitor linked to second account', n = 1, n || ' attached');

  -- Revenue: one row per invoice, net of refunds and lost disputes, live USD only.
  insert into public.billing_invoice_facts (invoice_id, livemode, user_id, subscription_id, status, billing_reason, currency, amount_due_cents, amount_paid_cents, pretax_paid_cents, refunded_cents, dispute_status, paid_at, first_source, last_source) values
    ('in_synp3_1', true,  u1, 'sub_synp3_1', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    null,   now() - interval '4 days', 'webhook', 'webhook'),
    ('in_synp3_2', true,  u1, 'sub_synp3_1', 'paid', 'subscription_cycle',  'usd', 1999, 1999, 1999, 500,  null,   now() - interval '1 day',  'webhook', 'webhook'),
    ('in_synp3_3', false, u1, 'sub_synp3_1', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    null,   now(),                     'webhook', 'webhook'),
    ('in_synp3_4', true,  u2, 'sub_synp3_2', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    'lost', now() - interval '2 days', 'webhook', 'webhook'),
    ('in_synp3_5', true,  u2, 'sub_synp3_2', 'paid', 'subscription_create', 'usd', 2179, 2179, 1999, 2179, null,   now() - interval '2 days', 'webhook', 'webhook'),
    ('in_synp3_6', true,  u2, 'sub_synp3_2', 'open', 'subscription_cycle',  'usd', 1999, 0,    0,    0,    null,   null,                      'webhook', 'webhook');
  insert into public.billing_invoice_facts (invoice_id, livemode, status, first_source, last_source) values ('in_synp3_1', true, 'paid', 'webhook', 'webhook') on conflict (invoice_id) do nothing;
  select count(*), coalesce(sum(net_cents), 0) into n, s from public.mkt_revenue_facts where invoice_id like 'in_synp3_%';
  insert into p3_results (check_name, pass, detail) values ('revenue view: live paid invoices only (test mode and unpaid excluded)', n = 4, n || ' invoices');
  insert into p3_results (check_name, pass, detail) values ('net revenue $19.99 + $19.99 - $5.00 refund, lost dispute and full refund = $0', s = 3498, '$' || to_char(s / 100.0, 'FM999990.00'));
  select (net_cents = 0 and refund_cents = 1999) into ok from public.mkt_revenue_facts where invoice_id = 'in_synp3_5';
  insert into p3_results (check_name, pass, detail) values ('refund is pre-tax and in proportion', coalesce(ok, false), 'full refund of a taxed invoice');

  -- Events: the new event name is accepted, and the event id keeps it to one row.
  insert into public.analytics_events (user_id, event, event_id) values (u1, 'subscription_cancel_scheduled', 'subscription_cancel_scheduled:sub_synp3_1:1');
  insert into public.analytics_events (user_id, event, event_id) values (u1, 'subscription_cancel_scheduled', 'subscription_cancel_scheduled:sub_synp3_1:1') on conflict (event_id) do nothing;
  select count(*) into n from public.analytics_events where event_id = 'subscription_cancel_scheduled:sub_synp3_1:1';
  insert into p3_results (check_name, pass, detail) values ('subscription_cancel_scheduled accepted and deduplicated', n = 1, n || ' row');

  -- Privileges: service role only.
  ok := not has_table_privilege('anon', 'public.marketing_touches', 'select') and not has_table_privilege('authenticated', 'public.marketing_touches', 'select')
    and not has_table_privilege('anon', 'public.marketing_identity_links', 'select') and not has_table_privilege('authenticated', 'public.marketing_identity_links', 'select')
    and not has_table_privilege('anon', 'public.mkt_revenue_facts', 'select') and not has_table_privilege('authenticated', 'public.mkt_revenue_facts', 'select')
    and not has_function_privilege('anon', 'public.mkt_link_visitor(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.mkt_link_visitor(uuid, uuid)', 'execute')
    and has_table_privilege('service_role', 'public.marketing_touches', 'insert') and has_function_privilege('service_role', 'public.mkt_link_visitor(uuid, uuid)', 'execute');
  insert into p3_results (check_name, pass, detail) values ('anon and signed-in users can''t read touches, links or revenue', ok, 'service_role only');
  select bool_and(relrowsecurity) into ok from pg_class where oid in ('public.marketing_touches'::regclass, 'public.marketing_identity_links'::regclass);
  insert into p3_results (check_name, pass, detail) values ('row level security on', ok, '');

  -- Cleanup: remove every synthetic row.
  delete from public.analytics_events where user_id in (u1, u2);
  delete from public.billing_invoice_facts where invoice_id like 'in_synp3_%';
  delete from public.marketing_touches where visitor_id in (v1, v2);
  delete from auth.users where id in (u1, u2);
  select (select count(*) from public.marketing_touches where visitor_id in (v1, v2)) + (select count(*) from public.marketing_identity_links where user_id in (u1, u2))
       + (select count(*) from public.billing_invoice_facts where invoice_id like 'in_synp3_%') + (select count(*) from auth.users where id in (u1, u2)) into n;
  insert into p3_results (check_name, pass, detail) values ('synthetic rows removed', n = 0, n || ' left');

  if exists (select 1 from p3_results where not pass) then
    raise exception 'Phase 3 staging check failed: %', (select string_agg(check_name || ' (' || detail || ')', '; ') from p3_results where not pass);
  end if;
end $$;
