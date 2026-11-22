-- Practice / Demo sample company: realistic job-cost and cash numbers (James 2026-11-22, onboarding video findings).
--
-- The 24-month sample posted its job costs (materials, permits, subcontractors, rework) without a cost code, so the job
-- budget could not net them against the estimate: forecast cost = full estimate + every dollar already spent. That made
-- the sample company show about -26% forecast profit and a large negative 30-day cash projection. Deposits matched to
-- the simulated bank were also left "not yet verified", so Home showed Collected $0.00.
--
-- demo_apply: copied from 20270219003000_practice_demo_24m.sql with these changes only (step 'bank_post'):
--   * a job expense is coded to the job's budget line for the post's costType (material / subcontractor / permit);
--   * a payment matched to its simulated bank deposit is verified (fin_payment_verify, as the demo login).
-- Real accounts are unaffected: this function only runs for demo / practice workspaces. Existing practice workspaces
-- start fresh on their next entry because the app's sample version changes (2026.11.22-1); owner demos keep their data
-- until Reset. No new tables. Safe to run more than once.
-- Rollback: re-run demo_apply from 20270219003000_practice_demo_24m.sql (and revert the app's DEMO_SEED_VERSION).

create or replace function public.demo_apply(p_workspace uuid, p_kind text, p_rows jsonb, p_seed_version text, p_step integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  w public.demo_workspaces; v_uid uuid; r jsonb; s jsonb; t jsonb; v_n integer := 0; v_id uuid; v_sid uuid; v_rev integer;
  v_items jsonb; v_task uuid; v_book uuid; v_job jsonb; v_inv uuid; v_pay jsonb; v_ver uuid; v_prev_sub text; v_prev_claims text;
  v_conn uuid; v_acct uuid; v_txn uuid; v_tgt uuid; v_jobid uuid; v_last integer; v_i integer; v_cc uuid;
begin
  select * into w from public.demo_workspaces where id = p_workspace for update;
  if not found or w.demo_user_id is null then raise exception 'not_a_demo_workspace' using errcode = '42501'; end if;
  v_uid := w.demo_user_id;
  -- Steps run in order exactly once: a repeated step (a retried request) is skipped, a skipped one refused.
  if p_step < w.seed_step then return 0; end if;
  if p_step > w.seed_step then raise exception 'out_of_order' using errcode = '40001', detail = w.seed_step::text; end if;
  if p_kind <> 'base' and w.seed_version is distinct from p_seed_version then raise exception 'seed_version_changed' using errcode = '40001'; end if;
  if public.is_demo_account(w.owner_user_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  v_prev_claims := current_setting('request.jwt.claims', true);
  perform public.demo_act_as(v_uid);
  perform set_config('app.demo_seed', 'on', true);

  if p_kind = 'base' then
    update public.demo_workspaces set status = 'seeding', seed_version = p_seed_version, last_error = null, updated_at = now() where id = w.id;
    insert into public.business_profiles (user_id, company_name, contact_name, email, phone, address, website, license_number, tagline, description, primary_color, secondary_color, primary_trade)
    values (v_uid, p_rows ->> 'company_name', p_rows ->> 'contact_name', p_rows ->> 'email', p_rows ->> 'phone', p_rows ->> 'address', p_rows ->> 'website',
            p_rows ->> 'license_number', p_rows ->> 'tagline', p_rows ->> 'description', coalesce(p_rows ->> 'primary_color', '#0B2D4D'), coalesce(p_rows ->> 'secondary_color', '#14B8A6'), p_rows ->> 'primary_trade')
    on conflict (user_id) do update set company_name = excluded.company_name, contact_name = excluded.contact_name, email = excluded.email, phone = excluded.phone,
      address = excluded.address, website = excluded.website, license_number = excluded.license_number, tagline = excluded.tagline, description = excluded.description,
      primary_trade = excluded.primary_trade;
    v_n := 1;

  elsif p_kind = 'resources' then
    for r in select * from jsonb_array_elements(p_rows) loop
      -- V7.3: company / individual subs, a worker's company, crews with members and stated capacity.
      insert into public.pm_resources (id, company_id, owner_id, kind, name, contact_name, trades, email, phone, notes, created_by,
        entity, parent_id, capacity, capacity_declared, crew_size, specialties)
      values ((r ->> 'id')::uuid, w.company_id, case when w.company_id is null then v_uid end, r ->> 'kind', r ->> 'name', r ->> 'contactName',
              array(select jsonb_array_elements_text(r -> 'trades')), nullif(r ->> 'email', ''), nullif(r ->> 'phone', ''), r ->> 'notes', v_uid,
              case when r ->> 'kind' = 'subcontractor' then r ->> 'entity' end, nullif(r ->> 'parentId', '')::uuid,
              greatest(1, least(50, coalesce((r ->> 'capacity')::int, 1))), coalesce((r ->> 'capacityDeclared')::boolean, r ->> 'kind' = 'crew'),
              nullif(r ->> 'crewSize', '')::int, coalesce(array(select jsonb_array_elements_text(coalesce(r -> 'specialties', '[]'::jsonb))), '{}'));
      if r ->> 'kind' = 'crew' and jsonb_typeof(r -> 'members') = 'array' then
        insert into public.pm_crew_members (crew_id, member_id)
        select (r ->> 'id')::uuid, m::uuid from jsonb_array_elements_text(r -> 'members') m
        where exists (select 1 from public.pm_resources q where q.id = m::uuid and q.kind <> 'crew'
                        and q.company_id is not distinct from w.company_id) on conflict do nothing;
      end if;
      if r ? 'employee' then
        perform public.pm_employee_profile_save((r ->> 'id')::uuid, jsonb_build_object('title', r -> 'employee' ->> 'title', 'payType', r -> 'employee' ->> 'payType',
          'hourlyCost', r -> 'employee' ->> 'hourlyCost', 'hireDate', r -> 'employee' ->> 'hireDate', 'clockEnabled', true));
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'customers' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.customers (id, user_id, company_id, created_by, name, email, phone, project_address, notes, source, customer_type, company_name, created_at, updated_at)
      values ((r ->> 'id')::uuid, v_uid, w.company_id, v_uid, r ->> 'name', r ->> 'email', r ->> 'phone', r ->> 'address', r ->> 'notes', 'manual',
              coalesce(r ->> 'customerType', 'person'), r ->> 'companyName', (r ->> 'createdAt')::timestamptz, (r ->> 'createdAt')::timestamptz);
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'estimates' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_id := public.save_estimate(r -> 'payload');
      update public.estimates set created_at = (r ->> 'createdAt')::timestamptz, updated_at = (r ->> 'createdAt')::timestamptz where id = v_id;
      if jsonb_typeof(r -> 'version') = 'object' then
        insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total, created_at)
        values (v_id, v_uid, 1, r -> 'version' ->> 'contentHash', r -> 'version' -> 'snapshot', r -> 'version' -> 'proposal',
                (r -> 'version' ->> 'totalCost')::numeric, (r -> 'version' ->> 'subtotal')::numeric, (r -> 'version' ->> 'tax')::numeric,
                (r -> 'version' ->> 'total')::numeric, (r -> 'version' ->> 'createdAt')::timestamptz);
      end if;
      for s in select * from jsonb_array_elements(coalesce(r -> 'stages', '[]')) loop
        perform public.set_estimate_stage(v_id, s ->> 'stage', s ->> 'note', least((s ->> 'at')::timestamptz, now()));
      end loop;
      update public.estimates set updated_at = coalesce((select max(effective_at) from public.estimate_stage_history where estimate_id = v_id), created_at),
        stage_changed_at = (select max(effective_at) from public.estimate_stage_history where estimate_id = v_id) where id = v_id;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'schedules' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_sid := public.schedule_create((r ->> 'estimateId')::uuid, false, jsonb_build_object(
        'name', r ->> 'name', 'startDate', r ->> 'startDate', 'targetEndDate', r ->> 'targetEndDate',
        'calendar', jsonb_build_object('workdays', jsonb_build_array(1, 2, 3, 4, 5), 'holidays', '[]'::jsonb, 'timezone', 'America/Chicago'),
        'tasks', r -> 'tasks'));
      perform public.schedule_set_people(v_sid, v_uid, v_uid);
      -- key -> task id (each source group/item appears once per schedule)
      v_items := '[]'::jsonb;
      for t in select * from jsonb_array_elements(r -> 'progress') loop
        select st.id into v_task from public.schedule_tasks st, jsonb_array_elements(r -> 'tasks') x
         where x ->> 'key' = t ->> 'key' and st.schedule_id = v_sid and st.source_group_id = (x ->> 'sourceGroupId')::uuid
           and st.source_item_id is not distinct from nullif(x ->> 'sourceItemId', '')::uuid and st.kind = x ->> 'kind' limit 1;
        select v_items || jsonb_build_array(jsonb_build_object('id', v_task, 'status', t ->> 'status', 'percentComplete', (t ->> 'percent')::int,
          'actualStart', t ->> 'actualStart', 'actualFinish', t ->> 'actualFinish', 'notes', t ->> 'notes',
          'plannedStart', st.planned_start, 'plannedEnd', st.planned_end, 'durationDays', st.duration_days, 'sortOrder', st.sort_order, 'name', st.name))
          into v_items from public.schedule_tasks st where st.id = v_task;
      end loop;
      select revision into v_rev from public.project_schedules where id = v_sid;
      v_rev := public.schedule_save(v_sid, v_rev, jsonb_build_object('schedule', jsonb_build_object('status', 'active'), 'tasks', v_items, 'summary', 'Sample progress'));
      v_items := '[]'::jsonb;
      for t in select * from jsonb_array_elements(r -> 'assign') loop
        select st.id into v_task from public.schedule_tasks st, jsonb_array_elements(r -> 'tasks') x
         where x ->> 'key' = t ->> 'key' and st.schedule_id = v_sid and st.source_group_id = (x ->> 'sourceGroupId')::uuid and st.kind = 'section' limit 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object('taskId', v_task, 'resourceId', t ->> 'resourceId', 'status', t ->> 'status'));
      end loop;
      select revision into v_rev from public.project_schedules where id = v_sid;
      if jsonb_array_length(v_items) > 0 then perform public.schedule_assign(v_sid, v_rev, v_items, 'Sample crew assignments'); end if;
      if jsonb_typeof(r -> 'closeout') = 'object' then
        select revision into v_rev from public.project_schedules where id = v_sid;
        perform public.schedule_closeout(v_sid, v_rev, (r -> 'closeout' ->> 'actualFinish')::date, 'Sample project closed out');
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'invoices' then
    v_book := public.fin_my_book();
    for r in select * from jsonb_array_elements(p_rows) loop
      select id into v_ver from public.estimate_versions where estimate_id = (r ->> 'estimateId')::uuid order by version_number desc limit 1;
      v_job := public.fin_job_open((r ->> 'estimateId')::uuid, v_ver);
      v_inv := (public.fin_invoice_save((v_job ->> 'jobId')::uuid, jsonb_build_object('kind', 'custom', 'dueDate', r ->> 'dueDate', 'memo', r ->> 'memo',
        'lines', (select jsonb_agg(jsonb_build_object('kind', 'custom', 'description', l ->> 'description', 'quantity', l ->> 'quantity', 'unitPrice', l ->> 'unitPrice', 'taxable', (l ->> 'taxable')::boolean))
                    from jsonb_array_elements(r -> 'lines') l)), 'demo-inv:' || p_workspace || ':' || (r ->> 'estimateId') || ':' || (r ->> 'kind')) ->> 'invoiceId')::uuid;
      perform public.fin_invoice_issue(v_inv, (r ->> 'issueDate')::date, 'Sample invoice (demo data)');
      if jsonb_typeof(r -> 'payment') = 'object' then
        v_pay := public.fin_payment_record(v_book, jsonb_build_object('customerId', (select customer_id from public.fin_invoices where id = v_inv),
          'amount', r -> 'payment' ->> 'amount', 'method', r -> 'payment' ->> 'method', 'receivedOn', r -> 'payment' ->> 'receivedOn',
          'reference', r -> 'payment' ->> 'reference', 'memo', 'Simulated payment (demo data, no money moved)',
          'allocations', jsonb_build_array(jsonb_build_object('invoiceId', v_inv, 'amount', coalesce(r -> 'payment' ->> 'allocate', r -> 'payment' ->> 'amount')))),
          'demo-pay:' || p_workspace || ':' || (r ->> 'estimateId') || ':' || (r ->> 'kind'));
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'comms' then
    if w.company_id is not null then v_book := public.fin_my_book(); end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.comm_messages (id, account_id, kind, trigger, customer_id, estimate_id, to_email, to_name, subject, body_text, status,
        automation, initiated_by, idempotency_key, fin_book_id, fin_invoice_id, fin_template_kind, fin_tone, fin_fields_hash, sent_at, delivered_at, replied_at, created_at, updated_at)
      values ((r ->> 'id')::uuid, coalesce(w.company_id, v_uid), r ->> 'kind', r ->> 'trigger', (r ->> 'customerId')::uuid, nullif(r ->> 'estimateId', '')::uuid,
        r ->> 'toEmail', r ->> 'toName', r ->> 'subject', r ->> 'body', r ->> 'status', false, v_uid, 'demo:' || (r ->> 'id'),
        case when r ->> 'kind' = 'financial' then v_book end,
        case when r ->> 'kind' = 'financial' then (select i.id from public.fin_invoices i join public.fin_jobs j on j.id = i.job_id
          where j.estimate_id = nullif(r ->> 'estimateId', '')::uuid and j.book_id = v_book and i.memo like (case r ->> 'finTemplate' when 'deposit' then 'Deposit%' else 'Balance%' end) limit 1) end,
        case when r ->> 'kind' = 'financial' then r ->> 'finTemplate' end, case when r ->> 'kind' = 'financial' then 'friendly' end,
        case when r ->> 'kind' = 'financial' then encode(sha256(convert_to(r ->> 'id', 'UTF8')), 'hex') end,
        (r ->> 'sentAt')::timestamptz, case when r ->> 'status' in ('delivered', 'replied') then (r ->> 'sentAt')::timestamptz + interval '2 minutes' end,
        case when r ->> 'status' = 'replied' then (r ->> 'sentAt')::timestamptz + interval '1 day' end, (r ->> 'sentAt')::timestamptz, (r ->> 'sentAt')::timestamptz);
      v_n := v_n + 1;
    end loop;

  -- Change orders on jobs underway (approved by the contractor on the customer's recorded word, waiting, declined).
  elsif p_kind = 'changes' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_tgt := public.change_order_save((r ->> 'estimateId')::uuid, jsonb_build_object('title', r ->> 'title', 'description', r ->> 'description',
        'lines', r -> 'lines', 'scheduleDays', r ->> 'scheduleDays', 'customerNotes', 'Sample change order (simulated, no real customer).'));
      perform public.change_order_send(v_tgt, '');
      if r ->> 'outcome' = 'approved' then perform public.change_order_decide(v_tgt, 'approve', r ->> 'note');
      elsif r ->> 'outcome' = 'declined' then perform public.change_order_decide(v_tgt, 'decline', r ->> 'note');
      end if;
      v_n := v_n + 1;
    end loop;

  -- The COMPLETELY FAKE connected bank (Will meeting 2026-11-21, item C). provider 'mock' + sandbox: no credentials,
  -- no token is stored (fin_bank_connection_secrets stays empty), next_sync_at is null so the daily sync never touches
  -- it, and the app refuses Refresh/Reconnect for it. One feed per month, so each month has its own import and month-end balance
  -- (bank imports and reconciliations are immutable records, so their timestamps are the seeding time).
  elsif p_kind = 'bank' then
    v_book := public.fin_my_book();
    v_conn := (public.fin_bank_connection_create(v_book, jsonb_build_object('provider', 'mock', 'itemRef', p_rows ->> 'itemRef',
      'institutionName', p_rows ->> 'institution', 'institutionRef', 'ins_simulated_demo', 'sandbox', true,
      'accounts', jsonb_build_array(jsonb_build_object('ref', 'sim-chk', 'name', p_rows ->> 'accountName', 'mask', p_rows ->> 'mask',
        'kind', 'checking', 'subtype', 'checking', 'currency', 'USD')))) ->> 'connectionId')::uuid;
    select id into v_acct from public.fin_bank_accounts where connection_id = v_conn;
    v_last := jsonb_array_length(p_rows -> 'statements');
    v_i := 0;
    for s in select * from jsonb_array_elements(p_rows -> 'statements') loop
      v_i := v_i + 1;
      perform public.fin_bank_feed_ingest(v_conn, jsonb_build_object('status', 'active',
        'balances', jsonb_build_array(jsonb_build_object('ref', 'sim-chk', 'current', s ->> 'closingBalance', 'currency', 'USD',
          'available', case when v_i = v_last then p_rows ->> 'availableBalance' else s ->> 'closingBalance' end,
          'asOf', case when v_i = v_last then p_rows ->> 'asOf' else (s ->> 'end') || 'T23:00:00Z' end)),
        'transactions', coalesce((select jsonb_agg(tx || jsonb_build_object('ref', 'sim-chk')) from jsonb_array_elements(s -> 'transactions') tx), '[]'::jsonb)));
      v_n := v_n + 1;
    end loop;
    update public.fin_bank_connections set next_sync_at = null, last_sync_at = least((p_rows ->> 'asOf')::timestamptz, now()),
      last_success_at = least((p_rows ->> 'asOf')::timestamptz, now()) where id = v_conn;

  -- Post the bank lines into the books: deposits match their payments, withdrawals become (job) expenses, one refund,
  -- owner draws excluded with a reason. Lines from the last few days are left for the user to match.
  elsif p_kind = 'bank_post' then
    v_book := public.fin_my_book();
    select a.id into v_acct from public.fin_bank_accounts a join public.fin_bank_connections c on c.id = a.connection_id
     where c.book_id = v_book and c.provider_item_ref like 'demo-sim:%' limit 1;
    for r in select * from jsonb_array_elements(p_rows) loop
      select id into v_txn from public.fin_bank_transactions where account_id = v_acct and fingerprint = md5('feed|' || (r ->> 'txnRef'));
      if v_txn is null then raise exception 'demo_bank_line_missing' using errcode = 'P0002', detail = r ->> 'txnRef'; end if;
      case r -> 'post' ->> 'type'
        when 'payment' then
          select id into v_tgt from public.fin_payments where book_id = v_book and reference = r -> 'post' ->> 'reference' and status = 'active' limit 1;
          if v_tgt is not null then
            perform public.fin_bank_match(v_txn, jsonb_build_object('targetType', 'payment', 'targetId', v_tgt));
            perform public.fin_payment_verify(v_tgt);   -- checked against the (simulated) bank, so it counts as verified
          end if;
        when 'expense' then
          v_jobid := null;
          if nullif(r -> 'post' ->> 'estimateId', '') is not null then
            select id into v_jobid from public.fin_jobs where book_id = v_book and estimate_id = (r -> 'post' ->> 'estimateId')::uuid limit 1;
          end if;
          -- Code the cost to this job's budget line for its cost type, so actual cost offsets the estimate.
          v_cc := null;
          if v_jobid is not null and nullif(r -> 'post' ->> 'costType', '') is not null then
            select b.cost_code_id into v_cc from public.fin_budget_lines b
             where b.job_id = v_jobid and b.cost_type = r -> 'post' ->> 'costType' and b.cost_code_id is not null
             order by b.amount desc, b.id limit 1;
          end if;
          perform public.fin_bank_create_expense(v_txn, jsonb_build_object('payee', r -> 'post' ->> 'payee', 'description', r -> 'post' ->> 'description',
            'jobId', v_jobid, 'costCodeId', v_cc));
        when 'refund' then
          select id into v_tgt from public.fin_payments where book_id = v_book and reference = r -> 'post' ->> 'paymentReference' and status = 'active' limit 1;
          v_tgt := (public.fin_refund_record(v_book, jsonb_build_object('paymentId', v_tgt, 'amount', r -> 'post' ->> 'amount',
            'refundedOn', (select posted_on from public.fin_bank_transactions where id = v_txn), 'method', 'check', 'reference', r -> 'post' ->> 'reference',
            'memo', 'Overpayment refunded (simulated, no money moved)'), 'demo-refund:' || p_workspace || ':' || (r ->> 'txnRef')) ->> 'refundId')::uuid;
          perform public.fin_bank_match(v_txn, jsonb_build_object('targetType', 'refund', 'targetId', v_tgt));
        when 'excluded' then
          perform public.fin_bank_match(v_txn, jsonb_build_object('targetType', 'excluded', 'excludeReason', r -> 'post' ->> 'reason', 'note', r -> 'post' ->> 'note'));
        else null;
      end case;
      v_n := v_n + 1;
    end loop;

  -- Month-end reconciliations (each balances to the cent), expenses approved, sample review queue trimmed, forward cash plan.
  elsif p_kind = 'bank_finish' then
    v_book := public.fin_my_book();
    select a.id into v_acct from public.fin_bank_accounts a join public.fin_bank_connections c on c.id = a.connection_id
     where c.book_id = v_book and c.provider_item_ref like 'demo-sim:%' limit 1;
    update public.fin_expenses set status = 'approved', approved_at = least((spent_on + 2)::timestamptz, now()), approved_by = v_uid
     where book_id = v_book and status = 'pending' and spent_on < current_date - 7;
    for r in select * from jsonb_array_elements(coalesce(p_rows -> 'reconcile', '[]'::jsonb)) loop
      perform public.fin_bank_reconcile(v_acct, jsonb_build_object('periodEnd', r ->> 'periodEnd', 'statementBalance', r ->> 'statementBalance',
        'note', 'Sample month-end reconciliation (simulated bank)'));
      v_n := v_n + 1;
    end loop;
    -- Keep a handful of receipt/cost-code reminders so the review queue shows what it does, not hundreds.
    update public.fin_review_items set status = 'dismissed', resolved_at = now()
     where book_id = v_book and status = 'open' and kind in ('missing_receipt', 'uncoded_cost')
       and id not in (select id from public.fin_review_items where book_id = v_book and status = 'open' and kind in ('missing_receipt', 'uncoded_cost') order by created_at desc, id limit 6);
    for r in select * from jsonb_array_elements(coalesce(p_rows -> 'cashPlan', '[]'::jsonb)) loop
      perform public.fin_cash_event_save(v_book, r || jsonb_build_object('accountId', v_acct));
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'finish' then
    update public.demo_workspaces set status = 'ready', seeded_at = now(), updated_at = now() where id = w.id;
    v_n := 1;
  else
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  update public.demo_workspaces set seed_step = p_step + 1, updated_at = now() where id = w.id;
  perform set_config('app.demo_seed', '', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  return v_n;
end $$;
revoke execute on function public.demo_apply(uuid, text, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.demo_apply(uuid, text, jsonb, text, integer) to service_role;
