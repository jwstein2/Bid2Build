-- STAGING ONLY. Acceptance checks for the Growth OS database layer on the real Supabase staging project.
-- Run in the SQL editor (as postgres = operator). It plays the worker's part by calling the same growth_api
-- functions the Edge Function calls, so it exercises the queue, approvals, CRM writes, revert, stop, budgets
-- and recovery on Supabase itself. Test rows use idempotency keys starting with 'stgtest:' and stay as evidence.
-- Ends with the system STOPPED again. Re-runnable: each run uses a fresh run tag.
create temp table if not exists stg_results (n int, check_name text, pass boolean, detail text);
truncate stg_results;

do $chk$
declare
  tag text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  painter uuid := '00000000-0000-4000-8000-000000000003';
  v_lead uuid; v_stage text; j1 bigint; j2 bigint; s text; r record; ok boolean; v int; v_change bigint; v_appr bigint;
  i int := 0;
begin
  -- Fresh starting point for the lead used by the CRM checks.
  update public.leads set stage = 'signed_up' where user_id = painter;
  select id into v_lead from public.leads where user_id = painter;

  -- 1. Environment
  i := i + 1; insert into stg_results values (i, 'control.env is staging', (select env = 'staging' from growth.control), (select env from growth.control));

  -- 2-3. Ingest: authorized acquisition events only (internal account excluded), idempotent
  perform growth_api.ingest();
  select count(*) into v from growth.events_inbox where source = 'analytics_events';
  i := i + 1; insert into stg_results values (i, 'ingest reads 6 events, skips the internal account', v = 6
    and not exists (select 1 from growth.events_inbox where subject_ref = '00000000-0000-4000-8000-000000000004'), v || ' rows');
  perform growth_api.ingest();
  i := i + 1; insert into stg_results values (i, 'ingest is idempotent', (select count(*) from growth.events_inbox where source = 'analytics_events') = v, null);

  perform growth_api.resume('staging checks ' || tag);

  -- 4. Enqueue is idempotent
  j1 := growth_api.enqueue('system.noop', '{}', 'stgtest:' || tag || ':noop', 'stgtest', now(), 1);
  j2 := growth_api.enqueue('system.noop', '{}', 'stgtest:' || tag || ':noop', 'stgtest', now(), 1);
  i := i + 1; insert into stg_results values (i, 'enqueue with the same key returns the same job', j1 = j2, j1::text);

  -- 5. Claim + complete
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w1', true, true, '{"ok":true}', null, null, null);
  i := i + 1; insert into stg_results values (i, 'durable job runs to succeeded', r.job_id = j1 and s = 'succeeded', s);

  -- 6. Transient failure -> retry with backoff
  j1 := growth_api.enqueue('system.echo', '{"fail_times":1}', 'stgtest:' || tag || ':retry', 'stgtest', now(), 1);
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w1', false, true, null, 'transient', null, null);
  i := i + 1; insert into stg_results values (i, 'transient failure goes to retry with backoff', s = 'retry'
    and (select run_after >= now() + interval '25 seconds' from growth.jobs where id = j1), s);

  -- 7. Permanent failure -> dead (dead-letter + audit)
  j1 := growth_api.enqueue('system.echo', '{"permanent":true}', 'stgtest:' || tag || ':dead', 'stgtest', now(), 1);
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w1', false, false, null, 'permanent', null, null);
  i := i + 1; insert into stg_results values (i, 'permanent failure goes to dead and is audited', s = 'dead'
    and exists (select 1 from growth.audit where action = 'job_dead' and (detail->>'job')::bigint = j1), s);

  -- 8. Fencing: another worker cannot complete a run it does not hold
  j1 := growth_api.enqueue('system.noop', '{}', 'stgtest:' || tag || ':fence', 'stgtest', now(), 1);
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w2', true, true, null, null, null, null);
  i := i + 1; insert into stg_results values (i, 'completion by the wrong worker is fenced', s = 'fenced', s);

  -- 9. Crash recovery: the lease expires (worker died), the job returns to the queue, the run is marked lost
  update growth.jobs set lease_expires_at = now() - interval '1 second' where id = j1;
  perform growth_api.recover_stale();
  i := i + 1; insert into stg_results values (i, 'expired lease is recovered (job retry, run lost)',
    (select state = 'retry' from growth.jobs where id = j1) and (select status = 'lost' from growth.runs where id = r.run_id),
    (select state from growth.jobs where id = j1));
  update growth.jobs set run_after = now() where id = j1;
  select * into r from growth_api.claim('stgtest-w3', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w3', true, true, null, null, null, null);
  i := i + 1; insert into stg_results values (i, 'recovered job completes on another worker', r.job_id = j1 and s = 'succeeded', s);

  -- 10-13. Approved CRM update: waits for approval, applies once, logged, revertible
  j1 := growth_api.enqueue('crm.apply_update', jsonb_build_object('action', 'lead.set_stage', 'lead_id', v_lead, 'stage', 'activated'),
                           'stgtest:' || tag || ':crm', 'stgtest', now(), 1);
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  i := i + 1; insert into stg_results values (i, 'CRM job is not claimable before approval', r.job_id is null
    and (select state = 'awaiting_approval' from growth.jobs where id = j1), (select state from growth.jobs where id = j1));
  select approval_id into v_appr from growth.jobs where id = j1;
  perform growth_api.decide_approval(v_appr, true, 'staging check');
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  ok := (growth_api.crm_apply(r.job_id, 'stgtest-w1')->>'status') = 'applied';
  s := growth_api.complete(r.run_id, 'stgtest-w1', true, true, null, null, null, null);
  select stage into v_stage from public.leads where id = v_lead;
  select id into v_change from growth.change_log where approval_id = v_appr;
  i := i + 1; insert into stg_results values (i, 'approved CRM update is written and change-logged', ok and v_stage = 'activated' and v_change is not null, v_stage);
  i := i + 1; insert into stg_results values (i, 'approval is single use', (select status = 'used' from growth.approvals where id = v_appr), null);
  perform growth_api.revert_change(v_change);
  select stage into v_stage from public.leads where id = v_lead;
  i := i + 1; insert into stg_results values (i, 'CRM change reverts', v_stage = 'signed_up', v_stage);

  -- 14. Payload changed after approval -> refused
  j1 := growth_api.enqueue('crm.apply_update', jsonb_build_object('action', 'lead.set_stage', 'lead_id', v_lead, 'stage', 'paid'),
                           'stgtest:' || tag || ':tamper', 'stgtest', now(), 1);
  select approval_id into v_appr from growth.jobs where id = j1;
  perform growth_api.decide_approval(v_appr, true, 'staging check');
  update growth.jobs set payload = jsonb_set(payload, '{stage}', '"churned"') where id = j1;
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  i := i + 1; insert into stg_results values (i, 'payload tampered after approval is refused', r.job_id is null
    and (select state = 'dead' from growth.jobs where id = j1), (select last_error from growth.jobs where id = j1));

  -- 15. Tier 3 (money) is never automated
  insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, enabled)
  values ('stgtest.money', 1, 'system.noop', 'staging check: tier 3', 3, true, true) on conflict do nothing;
  begin
    perform growth_api.enqueue('stgtest.money', '{}', 'stgtest:' || tag || ':money', 'stgtest');
    ok := false;
  exception when others then ok := sqlerrm like '%never automated%';
  end;
  i := i + 1; insert into stg_results values (i, 'tier 3 task is refused at enqueue', ok, null);

  -- 16. Emergency stop: nothing is claimed while stopped
  j1 := growth_api.enqueue('system.noop', '{}', 'stgtest:' || tag || ':stop', 'stgtest', now(), 1);
  perform growth_api.stop('staging check');
  select * into r from growth_api.claim('stgtest-w1', 5, 60);
  i := i + 1; insert into stg_results values (i, 'emergency stop blocks all claims', r.job_id is null and growth_api.is_stopped(), null);
  perform growth_api.resume('staging check');
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  s := growth_api.complete(r.run_id, 'stgtest-w1', true, true, null, null, null, null);

  -- 17. Budget: a task whose estimate breaks the $5/day ceiling waits
  insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, est_cost_usd, enabled)
  values ('stgtest.costly', 1, 'system.noop', 'staging check: over budget', 0, false, 6, true) on conflict do nothing;
  j1 := growth_api.enqueue('stgtest.costly', '{}', 'stgtest:' || tag || ':budget', 'stgtest', now(), 1);
  select * into r from growth_api.claim('stgtest-w1', 1, 60);
  i := i + 1; insert into stg_results values (i, 'job over the daily budget is held', r.job_id is null
    and (select last_error like 'waiting for budget%' from growth.jobs where id = j1), (select last_error from growth.jobs where id = j1));
  update growth.jobs set state = 'canceled', finished_at = now() where id = j1;
  update growth.agent_tasks set enabled = false where key in ('stgtest.costly', 'stgtest.money');

  -- 18. Suppression check combines every source
  i := i + 1; insert into stg_results values (i, 'contact_eligibility: bounced, customer and consent rules',
    (select reason from growth_api.contact_eligibility('bounced@growth-staging.test', 'marketing')) = 'bad_email'
    and (select reason from growth_api.contact_eligibility('deck.builder@growth-staging.test', 'sales_outreach')) = 'existing_customer'
    and (select reason from growth_api.contact_eligibility('roofer@growth-staging.test', 'marketing')) = 'no_marketing_consent'
    and (select allowed from growth_api.contact_eligibility('painter@growth-staging.test', 'marketing')), null);

  -- 19. Vault access limited to growth_ secrets
  begin perform growth_api.secret('service_role_key'); ok := false; exception when others then ok := true; end;
  i := i + 1; insert into stg_results values (i, 'secret() refuses names outside growth_', ok and growth_api.secret('growth_cron_secret') is not null, null);

  -- 20. Least privilege on Supabase roles
  i := i + 1; insert into stg_results values (i, 'anon/authenticated cannot use growth schemas or functions',
    not has_schema_privilege('anon', 'growth', 'usage') and not has_schema_privilege('authenticated', 'growth_api', 'usage')
    and not has_function_privilege('anon', 'growth_api.crm_apply(bigint,text)', 'execute')
    and not has_function_privilege('authenticated', 'growth_api.resume(text)', 'execute')
    and not has_table_privilege('growth_worker', 'public.leads', 'select')
    and not has_function_privilege('growth_worker', 'growth_api.resume(text)', 'execute'), null);

  -- 21. Scheduler: one job per slot
  v := growth_api.enqueue_due_schedules();
  i := i + 1; insert into stg_results values (i, 'schedules enqueue at most once per slot', growth_api.enqueue_due_schedules() = 0, v || ' enqueued');

  -- 22. pg_cron -> pg_net path reaches the worker URL
  i := i + 1; insert into stg_results values (i, 'cron_tick queues an HTTP call to the worker', growth.cron_tick() is not null, null);

  perform growth_api.stop('staging checks finished; waiting for go-live of the tick');
end $chk$;

select * from stg_results order by n;
