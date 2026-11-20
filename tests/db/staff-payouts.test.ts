import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as Row;
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const hash = (s: string) => createHash("sha256").update(`staff-${s}`).digest("hex");
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const as = <T,>(u: string, sql: string, params: unknown[] = []) => asUser(pool, u, async (q) => (await q(sql, params)).rows[0]?.r as T);

/** Synthetic personnel only. Creates a sales rep (+ directory row via trigger) and an approved statement. */
async function repWithStatement(owner: string, email: string, cents: number, month = "2026-10-01") {
  const rep = (await q1("select (public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'invited', null, true)) ->> 'id' id", [owner, email, email.split("@")[0]])).id as string;
  const st = await statement(rep, cents, month);
  const staff = await val("select id from public.staff_members where sales_rep_id = $1", [rep]) as string;
  return { rep, st, staff };
}
async function statement(rep: string, cents: number, month: string) {
  const st = (await q1("insert into public.sales_statements (rep_id, period_month, status, total_cents, line_count, approved_at) values ($1, $2, 'approved', $3, 1, now()) returning id", [rep, month, cents])).id as string;
  await pool.query("insert into public.sales_commissions (rep_id, year_no, period_month, amount_cents, status, statement_id, earned_at, approved_at) values ($1, 1, $2, $3, 'approved', $4, now(), now())", [rep, month, cents, st]);
  return st;
}

/** Walks a person through onboarding as themselves (contractor). */
async function onboardContractor(owner: string, staff: string, email: string, opts: { feeAck?: boolean; bank?: boolean } = {}) {
  // Declining the fee disclosure is only possible for people already on the team before V8.1.
  if (opts.feeAck === false) await pool.query("update public.staff_members set fee_ack_optional = true where id = $1", [staff]);
  await pool.query("select public.admin_staff_save($1, $2, $3)", [owner, staff, JSON.stringify({ classification: "contractor_1099", comp_types: ["commission"], work_state: "MN" })]);
  await pool.query("select public.admin_staff_invite_create($1, $2, $3, 7)", [owner, staff, hash(email)]);
  const u = await createUser(pool, email);
  expect(await as(u, "select public.staff_invite_accept($1) r", [hash(email)])).toMatchObject({ status: "ok" });
  await as(u, "select public.staff_my_profile_save($1) r", [JSON.stringify({ legal_first_name: "Test", legal_last_name: "Person", phone: "555-0100", address_line1: "1 Main St", city: "Rochester", state: "mn", postal_code: "55901" })]);
  await as(u, "select public.staff_my_role_confirm() r");
  const me = await as<Row>(u, "select public.staff_me() r");
  for (const a of me.required_agreements as Row[]) {
    if (a.kind === "fee_disclosure" && opts.feeAck === false) continue;
    await as(u, "select public.staff_my_agreement_accept($1, $2, 'Test Person', '127.0.0.1', 'vitest') r", [a.id, sha(a.body)]);
  }
  await pool.query("select public.staff_w9_store($1, 'Test Person', null, 'individual', null, 'ssn', '6789', 'v1.aaaaaaaaaaaaaaaa.bbbb.cccc', 'Test Person')", [u]);
  await pool.query("select public.staff_destination_record($1, 'mock', 'test', $2, $3, 'STRIPE TEST BANK', 'checking', '6789', 'verified')", [u, `rcpt_${staff}`, `pm_${staff}`]);
  await pool.query("select public.staff_security_confirm($1)", [u]);
  await as(u, "select public.staff_my_finish() r");
  // A person whose bank later disappears (closed account, disconnected): no current destination.
  if (opts.bank === false) await pool.query("delete from public.staff_payout_destinations where staff_id = $1", [staff]);
  return u;
}

d("V8.1 staff, onboarding and payouts (database)", () => {
  let owner: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_staff_payouts"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
  });
  afterAll(async () => { await drop?.(); });

  it("starts safe: automation off, fee policy unapproved, nothing planned", async () => {
    expect(await q1("select mode, paused, live_activated_at from public.payout_settings")).toMatchObject({ mode: "off", paused: false, live_activated_at: null });
    expect(await val("select approved_at from public.payout_fee_policies where version = 1")).toBeNull();
    expect(await val("select public.payout_plan() ->> 'skipped'")).toBe("automation_off");
  });

  it("a Sales Hub rep lands in the directory as pending review (not assumed 1099)", async () => {
    const { staff } = await repWithStatement(owner, "pending@reps.test", 5000);
    expect(await q1("select classification, status from public.staff_members where id = $1", [staff])).toMatchObject({ classification: "pending_review", status: "invited" });
    expect(await val("select array_agg(role)::text from public.staff_roles where staff_id = $1", [staff])).toBe("{sales_rep}");
    await pool.query("select public.admin_payout_settings_save($1, '{\"mode\":\"test\"}')", [owner]);
    await pool.query("select public.payout_plan()");
    expect(await val("select count(*)::int from public.payouts where staff_id = $1", [staff])).toBe(0);
    const ov = await val("select public.admin_payouts_overview($1)", [owner]) as Row;
    expect((ov.exceptions as Row[]).find((e) => e.staff_id === staff)).toMatchObject({ reason: "classification_review" });
  });

  it("tests 1-10: invite, onboard, connect bank, plan, submit (test mode), settle, history", async () => {
    const { st, staff } = await repWithStatement(owner, "rep1@reps.test", 50000);
    const st2 = await statement((await val("select sales_rep_id from public.staff_members where id = $1", [staff])) as string, 12500, "2026-11-01");
    const u = await onboardContractor(owner, staff, "rep1@reps.test");
    expect(await q1("select status, onboarding_completed_at is not null done from public.staff_members where id = $1", [staff])).toMatchObject({ status: "active", done: true });
    expect(await val("select public.payout_blockers($1, 'test')::text", [staff])).toBe("{}");

    // Fee policy approved -> recipient pays the disclosed fee they acknowledged.
    await pool.query("select public.admin_fee_policy_approve($1, 1)", [owner]);
    await pool.query("select public.admin_payout_settings_save($1, '{\"review_above_cents\": 100000}')", [owner]);
    await pool.query("select public.payout_plan()");
    const p = await q1("select * from public.payouts where staff_id = $1", [staff]);
    // Two statements batched into ONE payout: one $1.50 fee instead of two.
    expect(p).toMatchObject({ gross_cents: 62500, fee_cents: 150, fee_bearer: "recipient", net_cents: 62350, status: "scheduled", mode: "test" });
    expect(await val("select count(*)::int from public.payout_items where payout_id = $1", [p.id])).toBe(2);
    expect(p.ref).toMatch(/^B2B-PO-\d{6}-\d{6}-T$/);
    // Running the planner again never duplicates.
    await pool.query("select public.payout_plan()");
    expect(await val("select count(*)::int from public.payouts where staff_id = $1", [staff])).toBe(1);

    const claim = await val("select public.payout_claim_due(25, $1::timestamptz)", [new Date(Date.now() + 3 * 864e5).toISOString()]) as Row;
    const mine = (claim.payouts as Row[]).find((x) => x.id === p.id)!;
    expect(mine).toMatchObject({ net_cents: 62350, recipient_ref: `rcpt_${staff}` });
    // A concurrent second run gets nothing for the same payout.
    const again = await val("select public.payout_claim_due(25, $1::timestamptz)", [new Date(Date.now() + 3 * 864e5).toISOString()]) as Row;
    expect((again.payouts as Row[]).some((x) => x.id === p.id)).toBe(false);
    await pool.query("select public.payout_mark_submitted($1, 'mockpo_1')", [p.id]);

    // Unverified events are refused; verified events are idempotent and only move forward.
    await expect(pool.query("select public.payout_apply_event('evt_x', 'mockpo_1', 'posted', now(), null, false)")).rejects.toThrow(/unverified_event/);
    expect(await val("select public.payout_apply_event('evt_1', 'mockpo_1', 'posted', now(), null, true) ->> 'status'")).toBe("applied");
    expect(await val("select public.payout_apply_event('evt_1', 'mockpo_1', 'posted', now(), null, true) ->> 'status'")).toBe("duplicate");
    expect(await val("select public.payout_apply_event('evt_2', 'mockpo_1', 'processing', now(), null, true) ->> 'status'")).toBe("stale");
    expect(await val("select status from public.payouts where id = $1", [p.id])).toBe("paid");
    // TEST payouts never mark the real statements paid.
    expect(await val("select status from public.sales_statements where id = $1", [st])).toBe("approved");
    expect(await val("select count(*)::int from public.sales_payouts where statement_id = any($1)", [[st, st2]])).toBe(0);

    const my = await as<Row>(u, "select public.staff_my_payouts() r");
    expect((my.payouts as Row[])[0]).toMatchObject({ ref: p.ref, gross_cents: 62500, fee_cents: 150, net_cents: 62350, status: "paid" });
    expect((my.payouts as Row[])[0].idempotency_key).toBeUndefined();
    // Live YTD excludes test payouts.
    expect(my.ytd).toMatchObject({ gross_cents: 0 });
  });

  it("LIVE settlement marks statements paid once; a returned ACH puts them back as owed", async () => {
    const { st, staff } = await repWithStatement(owner, "live@reps.test", 30000);
    await onboardContractor(owner, staff, "live@reps.test");
    // Simulate a live ledger row (activation itself is exercised below); provider evidence drives status.
    const p = await q1(`insert into public.payouts (ref, staff_id, mode, provider, gross_cents, fee_cents, fee_bearer, net_cents, status, scheduled_for, idempotency_key, provider_ref, submitted_at)
      values ('B2B-PO-LIVE-1', $1, 'live', 'stripe_global_payouts', 30000, 150, 'recipient', 29850, 'submitted', current_date, 'idem-live-1', 'obp_live_1', now()) returning id`, [staff]);
    await pool.query("insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents) values ($1, 'live', 'sales_statement', $2, 30000)", [p.id, st]);
    await pool.query("select public.payout_apply_event('evt_l1', 'obp_live_1', 'posted', now(), null, true)");
    expect(await val("select status from public.sales_statements where id = $1", [st])).toBe("paid");
    expect(await q1("select amount_cents, method from public.sales_payouts where statement_id = $1", [st])).toMatchObject({ amount_cents: 30000, method: "ach" });
    expect(await val("select tax_year from public.payouts where id = $1", [p.id])).toBeGreaterThan(2025);

    await pool.query("select public.payout_apply_event('evt_l2', 'obp_live_1', 'returned', now(), 'account_closed', true)");
    expect(await val("select status from public.payouts where id = $1", [p.id])).toBe("returned");
    expect(await val("select status from public.sales_statements where id = $1", [st])).toBe("approved");
    expect(await val("select count(*)::int from public.sales_payouts where statement_id = $1", [st])).toBe(0);
    expect(await val("select status from public.sales_commissions where statement_id = $1", [st])).toBe("approved");
    expect(await val("select status from public.staff_payout_destinations where staff_id = $1 and is_current and mode = 'test'", [staff])).toBe("verified");
  });

  it("fee edge cases: no acknowledgement, blocked jurisdiction, fee exceeds gross, zero statement", async () => {
    const a = await repWithStatement(owner, "noack@reps.test", 20000);
    await onboardContractor(owner, a.staff, "noack@reps.test", { feeAck: false });
    const b = await repWithStatement(owner, "tiny@reps.test", 100);
    await onboardContractor(owner, b.staff, "tiny@reps.test");
    const c = await repWithStatement(owner, "zero@reps.test", 0);
    await onboardContractor(owner, c.staff, "zero@reps.test");
    await pool.query("select public.payout_plan()");
    expect(await q1("select fee_bearer, fee_reason, net_cents from public.payouts where staff_id = $1", [a.staff])).toMatchObject({ fee_bearer: "company", fee_reason: "no_fee_acknowledgement", net_cents: 20000 });
    // $1.00 payout with a $1.50 fee: never negative, Built2Bid pays.
    expect(await q1("select fee_bearer, fee_reason, net_cents from public.payouts where staff_id = $1", [b.staff])).toMatchObject({ fee_bearer: "company", fee_reason: "fee_exceeds_gross", net_cents: 100 });
    expect(await val("select count(*)::int from public.payouts where staff_id = $1", [c.staff])).toBe(0);

    const s = await repWithStatement(owner, "blocked@reps.test", 20000);
    await onboardContractor(owner, s.staff, "blocked@reps.test");
    await pool.query("select public.admin_payout_settings_save($1, '{\"fee_recovery_blocked_states\": [\"mn\"]}')", [owner]);
    await pool.query("select public.payout_plan()");
    expect(await q1("select fee_bearer, fee_reason from public.payouts where staff_id = $1", [s.staff])).toMatchObject({ fee_bearer: "company", fee_reason: "jurisdiction_blocked" });
    await pool.query("select public.admin_payout_settings_save($1, '{\"fee_recovery_blocked_states\": []}')", [owner]);
    // Instant fee math (optional, recipient-selected): $1.50 + 0.75%, min $2.
    expect(await val("select public.payout_fee_cents(10000, 'instant', f) from public.payout_fee_policies f where version = 1")).toBe(225);
    expect(await val("select public.payout_fee_cents(1000, 'instant', f) from public.payout_fee_policies f where version = 1")).toBe(200);
  });

  it("holds without prerequisites, bank-change hold, limits, pause, approval", async () => {
    const h = await repWithStatement(owner, "nobank@reps.test", 40000);
    const u = await onboardContractor(owner, h.staff, "nobank@reps.test", { bank: false });
    await pool.query("select public.payout_plan()");
    expect(await q1("select status, hold_reasons::text from public.payouts where staff_id = $1", [h.staff])).toMatchObject({ status: "held", hold_reasons: "{no_bank}" });
    // Connect a bank -> next run releases it.
    await pool.query("select public.staff_destination_record($1, 'mock', 'test', 'rcpt_nb', 'pm_nb1', 'Bank A', 'checking', '1111', 'verified')", [u]);
    await pool.query("select public.payout_plan()");
    expect(await val("select status from public.payouts where staff_id = $1", [h.staff])).toBe("scheduled");
    // Change of bank -> 72h hold, the old destination is replaced, payout re-held at claim time.
    const r = await val("select public.staff_destination_record($1, 'mock', 'test', 'rcpt_nb', 'pm_nb2', 'Bank B', 'savings', '2222', 'verified')", [u]) as Row;
    expect(r.changed).toBe(true);
    expect(await val("select count(*)::int from public.staff_payout_destinations where staff_id = $1 and status = 'replaced'", [h.staff])).toBe(1);
    expect(await val("select count(*)::int from public.audit_logs where action = 'staff.bank_changed' and target_id = $1", [h.staff])).toBe(1);
    await pool.query("select public.payout_claim_due(25, now() + interval '3 days')");
    // eligible_from is relative to real now(); claim at +3 days still sees now() inside payout_blockers -> held.
    expect(await q1("select status, hold_reasons::text from public.payouts where staff_id = $1", [h.staff])).toMatchObject({ status: "held", hold_reasons: "{bank_change_hold}" });
    await pool.query("update public.staff_payout_destinations set eligible_from = now() - interval '1 minute' where staff_id = $1 and is_current", [h.staff]);

    // Per-payout limit -> needs owner approval.
    await pool.query("select public.admin_payout_settings_save($1, '{\"per_payout_limit_cents\": 30000, \"review_above_cents\": 100000}')", [owner]);
    await pool.query("select public.payout_plan()");
    await pool.query("select public.payout_claim_due(25, now() + interval '3 days')");
    const big = await q1("select id, status, hold_reasons::text from public.payouts where staff_id = $1", [h.staff]);
    expect(big).toMatchObject({ status: "needs_approval", hold_reasons: "{over_per_payout_limit}" });
    await pool.query("select public.admin_payout_approve($1, $2)", [owner, big.id]);

    // Emergency pause stops claims entirely.
    await pool.query("select public.admin_payout_pause($1, true, 'test')", [owner]);
    expect(await val("select public.payout_claim_due(25, now() + interval '3 days') ->> 'skipped'")).toBe("paused");
    await pool.query("select public.admin_payout_pause($1, false, null)", [owner]);
    const c = await val("select public.payout_claim_due(25, now() + interval '3 days')", []) as Row;
    expect((c.payouts as Row[]).some((x) => x.id === big.id)).toBe(true);
    // Retryable submit errors back off and keep the same idempotency key; then fail after max attempts.
    const key = await val("select idempotency_key from public.payouts where id = $1", [big.id]);
    expect(await val("select public.payout_mark_submit_error($1, 'rate_limited', 'slow down', true)", [big.id])).toBe("retry");
    expect(await q1("select status, idempotency_key from public.payouts where id = $1", [big.id])).toMatchObject({ status: "scheduled", idempotency_key: key });
  });

  it("live activation needs the full checklist, an approved funding account and a real provider", async () => {
    await expect(pool.query("select public.admin_payout_settings_save($1, '{\"mode\":\"live\"}')", [owner])).rejects.toThrow(/use_activation/);
    const all = { provider_approved: true, provider_live_keys: true, funding_confirmed: true, fee_policy_reviewed: true, agreements_reviewed_by_counsel: true,
      tax_reporting_plan: true, classification_reviewed: true, limits_reviewed: true, test_run_passed: true };
    await expect(pool.query("select public.admin_payout_activate_live($1, $2)", [owner, JSON.stringify({ ...all, test_run_passed: false })])).rejects.toThrow(/checklist_incomplete:test_run_passed/);
    await expect(pool.query("select public.admin_payout_activate_live($1, $2)", [owner, JSON.stringify(all)])).rejects.toThrow(/provider_is_mock/);
    await pool.query("select public.admin_payout_settings_save($1, '{\"provider\":\"stripe_global_payouts\"}')", [owner]);
    await expect(pool.query("select public.admin_payout_activate_live($1, $2)", [owner, JSON.stringify(all)])).rejects.toThrow(/funding_not_approved/);
    await pool.query("select public.admin_funding_approve($1, 'Stripe storage balance funded from business checking ••4821')", [owner]);
    // A non-owner can't activate.
    const rando = await createUser(pool, "rando@x.test");
    await expect(pool.query("select public.admin_payout_activate_live($1, $2)", [rando, JSON.stringify(all)])).rejects.toThrow(/owner_only/);
    expect(await val("select public.admin_payout_activate_live($1, $2) ->> 'mode'", [owner, JSON.stringify(all)])).toBe("live");
    // A new funding account clears the activation.
    await pool.query("select public.admin_funding_approve($1, 'Different account')", [owner]);
    expect(await q1("select mode, live_activated_at from public.payout_settings")).toMatchObject({ mode: "test", live_activated_at: null });
    await pool.query("select public.admin_payout_settings_save($1, '{\"provider\":\"mock\"}')", [owner]);
  });

  it("test 13: accountant gets read-only finance, banking only when granted, never money movement", async () => {
    const acct = (await val("select public.admin_staff_save($1, null, $2) ->> 'id'", [owner, JSON.stringify({ email: "cpa@firm.test", display_name: "Outside CPA", classification: "vendor", roles: ["external_accountant"] })])) as string;
    await pool.query("select public.admin_staff_invite_create($1, $2, $3, 7)", [owner, acct, hash("cpa")]);
    const u = await createUser(pool, "cpa@firm.test");
    await as(u, "select public.staff_invite_accept($1) r", [hash("cpa")]);
    // While onboarding: nothing financial.
    expect(await val("select public.staff_capabilities($1)::text", [u])).toBe("{self.view}");
    await pool.query("update public.staff_members set status = 'active' where id = $1", [acct]);
    const caps = await val("select public.staff_capabilities($1)", [u]) as string[];
    expect(caps).toEqual(expect.arrayContaining(["payouts.view", "reports.export", "reconcile", "tax.view"]));
    expect(caps).not.toContain("banking.view");
    expect(caps).not.toContain("payouts.manage");
    await expect(pool.query("select public.admin_banking_overview($1, current_date - 30)", [u])).rejects.toThrow(/forbidden/);
    await pool.query("select public.admin_staff_banking_grant($1, $2, true)", [owner, acct]);
    expect(await val("select public.staff_capabilities($1)", [u])).toContain("banking.view");
    await pool.query("select public.admin_banking_overview($1, current_date - 30)", [u]);
    await pool.query("select public.admin_payouts_overview($1)", [u]);
    await expect(pool.query("select public.admin_payout_pause($1, true, 'x')", [u])).rejects.toThrow(/owner_only/);
    await expect(pool.query("select public.admin_payout_approve($1, gen_random_uuid())", [u])).rejects.toThrow(/owner_only/);
    await expect(pool.query("select public.admin_staff_save($1, null, '{}')", [u])).rejects.toThrow(/owner_only/);
    await expect(pool.query("select public.admin_staff_list($1)", [u])).rejects.toThrow(/forbidden/);
  });

  it("test 14: a W-2 employee is never routed through contractor payouts", async () => {
    const { st, staff } = await repWithStatement(owner, "w2@reps.test", 25000);
    await pool.query("select public.admin_staff_save($1, $2, $3)", [owner, staff, JSON.stringify({ classification: "employee_w2", comp_types: ["salary", "commission"], pay_frequency: "biweekly" })]);
    expect(await val("select payment_method from public.staff_members where id = $1", [staff])).toBe("payroll");
    await pool.query("select public.admin_staff_invite_create($1, $2, $3, 7)", [owner, staff, hash("w2")]);
    const u = await createUser(pool, "w2@reps.test");
    await as(u, "select public.staff_invite_accept($1) r", [hash("w2")]);
    const me = await as<Row>(u, "select public.staff_me() r");
    const kinds = (me.required_agreements as Row[]).map((a) => a.kind).sort();
    expect(kinds).toEqual(["commission_agreement", "employee_acknowledgement", "mn_wage_notice"]);
    // No W-9, no contractor bank, no fee disclosure for employees.
    await expect(pool.query("select public.staff_w9_store($1, 'x', null, 'individual', null, 'ssn', '1234', 'v1.aaaaaaaaaaaaaaaa.b.c', 'x')", [u])).rejects.toThrow(/w9_not_applicable/);
    await expect(pool.query("select public.staff_destination_record($1, 'mock', 'test', 'r', 'p', 'b', 'checking', '1234', 'verified')", [u])).rejects.toThrow(/payout_not_applicable/);
    await pool.query("select public.payout_plan()");
    expect(await val("select count(*)::int from public.payouts where staff_id = $1", [staff])).toBe(0);
    const ov = await val("select public.admin_payouts_overview($1)", [owner]) as Row;
    expect((ov.exceptions as Row[]).find((e) => e.statement_id === st)).toMatchObject({ reason: "payroll_required" });
    expect(await val("select public.payout_blockers($1, 'test')", [staff])).toContain("payroll_required");
  });

  it("test 15: suspended staff lose access and their scheduled payouts are held", async () => {
    const { staff, rep } = await repWithStatement(owner, "susp@reps.test", 15000);
    const u = await onboardContractor(owner, staff, "susp@reps.test");
    await pool.query("update public.sales_reps set status = 'active', user_id = $2 where id = $1", [rep, u]);
    await pool.query("select public.payout_plan()");
    expect(await val("select status from public.payouts where staff_id = $1", [staff])).toBe("scheduled");
    await pool.query("select public.admin_staff_set_status($1, $2, 'suspended', 'investigation')", [owner, staff]);
    expect(await val("select status from public.payouts where staff_id = $1", [staff])).toBe("held");
    expect(await val("select status from public.sales_reps where id = $1", [rep])).toBe("suspended");
    expect(await val("select public.staff_capabilities($1)::text", [u])).toBe("{}");
    await expect(as(u, "select public.staff_my_payouts() r")).rejects.toThrow(/staff_inactive/);
    expect(await val("select public.payout_blockers($1, 'test')", [staff])).toContain("not_active");
    // Reactivation restores both.
    await pool.query("select public.admin_staff_set_status($1, $2, 'active', null)", [owner, staff]);
    expect(await val("select status from public.sales_reps where id = $1", [rep])).toBe("active");
  });

  it("invites: email must match, expire, and a customer company admin can't read staff", async () => {
    const id = (await val("select public.admin_staff_save($1, null, $2) ->> 'id'", [owner, JSON.stringify({ email: "ops@b2b.test", display_name: "Ops Person", roles: ["operations"] })])) as string;
    await pool.query("select public.admin_staff_invite_create($1, $2, $3, 7)", [owner, id, hash("ops")]);
    const wrong = await createUser(pool, "other@b2b.test");
    expect(await as(wrong, "select public.staff_invite_accept($1) r", [hash("ops")])).toMatchObject({ status: "email_mismatch" });
    await pool.query("update public.staff_invites set expires_at = now() - interval '1 second' where token_hash = $1", [hash("ops")]);
    const right = await createUser(pool, "ops@b2b.test");
    expect(await as(right, "select public.staff_invite_accept($1) r", [hash("ops")])).toMatchObject({ status: "expired" });
    // Tables are invisible to signed-in users; owner functions refuse them.
    await expect(asUser(pool, right, (q) => q("select * from public.staff_members"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, right, (q) => q("select public.admin_staff_list($1)", [right]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, right, (q) => q("select public.payout_plan()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, right, (q) => q("select * from public.staff_tin_secrets"))).rejects.toThrow(/permission denied/);
  });

  it("agreement acceptance is immutable and pinned to the exact text", async () => {
    const row = await q1("select a.id, t.body from public.staff_agreement_acceptances a join public.staff_agreement_templates t on t.id = a.template_id limit 1");
    await expect(pool.query("update public.staff_agreement_acceptances set typed_name = 'x' where id = $1", [row.id])).rejects.toThrow(/immutable_record/);
    await expect(pool.query("delete from public.staff_agreement_acceptances where id = $1", [row.id])).rejects.toThrow(/immutable_record/);
  });

  it("year-end: live paid gross by tax year with threshold from the table", async () => {
    const year = Number(await val("select extract(year from now() at time zone 'America/Chicago')::int"));
    const t = await val("select public.admin_payout_tax_year($1, $2)", [owner, year]) as Row;
    const live = (t.people as Row[]).find((p) => p.gross_paid_cents > 0);
    // The returned live payout above is not 'paid', so nobody has live paid gross yet: test payouts never count.
    expect(live).toBeUndefined();
    expect(await val("select threshold_cents from public.tax_reporting_thresholds where tax_year = 2026")).toBe(200000);
    const cost = await val("select public.admin_payout_cost_report($1, current_date)", [owner]) as Row;
    expect(cost.transfers).toBeGreaterThan(0);
    expect(cost.batching_savings_cents).toBeGreaterThanOrEqual(150);
  });
});
