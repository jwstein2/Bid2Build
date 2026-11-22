import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as Row;
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
let seq = 0;

/** Stripe's view of one invoice, as the webhook / daily run records it. */
async function fact(id: string, user: string | null, o: { paidDaysAgo?: number; amount?: number; status?: string; livemode?: boolean; currency?: string } = {}) {
  return val("select public.billing_invoice_record($1) r", [JSON.stringify({
    invoice_id: id, livemode: o.livemode ?? true, status: o.status ?? "paid", user_id: user, subscription_id: "sub_x", currency: o.currency ?? "usd",
    amount_due: o.amount ?? 1999, amount_paid: (o.status ?? "paid") === "paid" ? o.amount ?? 1999 : 0, pretax_paid: o.amount ?? 1999,
    paid_at: (o.status ?? "paid") === "paid" ? daysAgo(o.paidDaysAgo ?? 40) : null, source: "webhook",
  })]);
}

/** A rep (+ staff record via trigger), a customer attributed to them, and one earned commission on an open statement. */
async function repStatement(owner: string, cents: number, o: { invoice?: string | null; month?: string } = {}) {
  const n = ++seq;
  const rep = (await q1("select (public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'invited', null, true)) ->> 'id' id", [owner, `rep${n}@built2bid.org`, `Rep ${n}`])).id as string;
  const cust = await createUser(pool, `cust${n}@example.com`);
  await pool.query("insert into public.sales_attributions (user_id, rep_id, source, attributed_at) values ($1, $2, 'manual', now() - interval '90 days')", [cust, rep]);
  const month = o.month ?? "2026-09-01";
  const st = (await q1("insert into public.sales_statements (rep_id, period_month, status) values ($1, $2, 'open') returning id", [rep, month])).id as string;
  const inv = o.invoice === undefined ? `in_test_${n}` : o.invoice;
  const line = (await q1(`insert into public.sales_commissions (rep_id, user_id, year_no, period_month, amount_cents, status, statement_id, earned_at, stripe_invoice_id, created_at)
    values ($1, $2, 1, $3, $4, 'earned', $5, now(), $6, now() - interval '40 days') returning id`, [rep, cust, month, cents, st, inv])).id as string;
  await pool.query("select public.sales_statement_refresh($1)", [st]);
  return { rep, cust, st, line, inv };
}

d("Revenue & Commission Reconciliation (database)", () => {
  let owner: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_commission_recon"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await pool.query("update public.sales_settings set policy_confirmed_at = now(), refund_policy = 'hold_30_no_clawback'");
  });
  afterAll(async () => { await drop?.(); });

  it("the migration can run twice", async () => {
    await pool.query(readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20270223001000_commission_reconciliation.sql"), "utf8"));
    expect(await val("select count(*)::int from public.recon_settings")).toBe(1);
  });

  it("invoice facts are out-of-order safe: paid never goes back to open, amounts only grow", async () => {
    expect(await fact("in_order_1", null, { status: "open", amount: 1999 })).toMatchObject({ action: "inserted", status: "open" });
    expect(await fact("in_order_1", null, { status: "paid" })).toMatchObject({ status: "paid" });
    expect(await fact("in_order_1", null, { status: "open" })).toMatchObject({ status: "paid", action: "unchanged" });
    expect(await val("select public.billing_invoice_refund('in_order_1', 500)")).toBe("changed");
    expect(await val("select public.billing_invoice_refund('in_order_1', 500)")).toBe("unchanged");
    expect(await val("select public.billing_invoice_refund('in_missing', 500)")).toBe("unknown");
  });

  it("a signup or unpaid invoice never verifies; a paid live invoice past the hold does", async () => {
    const u = await createUser(pool, "gate@example.com");
    expect(await val("select public.recon_payment_problems(null, $1)", [u])).toEqual(["no_invoice"]);
    expect(await val("select public.recon_payment_problems('in_never_seen', $1)", [u])).toEqual(["invoice_not_verified"]);
    await fact("in_gate_open", u, { status: "open" });
    expect(await val("select public.recon_gate(public.recon_payment_problems('in_gate_open', $1))", [u])).toContain("invoice_not_paid");
    await fact("in_gate_test", u, { livemode: false });
    expect(await val("select public.recon_gate(public.recon_payment_problems('in_gate_test', $1))", [u])).toEqual(["not_live_payment"]);
    await fact("in_gate_new", u, { paidDaysAgo: 3 });
    // Inside the hold: blocks automatic approval only, not a person.
    expect(await val("select public.recon_payment_problems('in_gate_new', $1)", [u])).toEqual(["in_refund_hold"]);
    expect(await val("select public.recon_gate(public.recon_payment_problems('in_gate_new', $1))", [u])).toEqual([]);
    await fact("in_gate_ok", u);
    expect(await val("select public.recon_payment_problems('in_gate_ok', $1)", [u])).toEqual([]);
    const other = await createUser(pool, "other@example.com");
    expect(await val("select public.recon_payment_problems('in_gate_ok', $1)", [other])).toContain("customer_mismatch");
    await pool.query("select public.billing_invoice_dispute('in_gate_ok', 'open')");
    expect(await val("select public.recon_payment_problems('in_gate_ok', $1)", [u])).toContain("dispute_open");
  });

  it("refund rules follow the agreement: a refund after the 30-day hold keeps the commission (hold_30_no_clawback)", async () => {
    const a = await repStatement(owner, 1999);
    await fact(a.inv!, a.cust);
    await pool.query("select public.billing_invoice_refund($1, 1999, now())", [a.inv]);   // refunded 40 days after the line was created
    expect(await val("select public.recon_sales_line_problems($1)", [a.line])).toEqual([]);
    const b = await repStatement(owner, 1999);
    await fact(b.inv!, b.cust);
    await pool.query("select public.billing_invoice_refund($1, 1999, now() - interval '35 days')", [b.inv]);   // within 30 days of the line
    expect(await val("select public.recon_sales_line_problems($1)", [b.line])).toContain("fully_refunded");
  });

  it("automatic approval: off by default, needs the owner's confirmation, approves only verified ordinary statements", async () => {
    const ok = await repStatement(owner, 1999);
    await fact(ok.inv!, ok.cust);
    const unverified = await repStatement(owner, 1999);           // Stripe never confirmed this invoice
    const big = await repStatement(owner, 250000);
    await fact(big.inv!, big.cust, { amount: 250000 });

    expect(await val("select public.recon_auto_approve(now()) ->> 'skipped'")).toBe("off");
    await expect(pool.query("select public.admin_recon_settings_save($1, '{\"auto_approve_statements\": true}')", [owner])).rejects.toThrow(/confirm_required/);
    const rep = await createUser(pool, "notowner@example.com");
    await expect(pool.query("select public.admin_recon_settings_save($1, '{\"auto_approve_statements\": true, \"confirm\": true}')", [rep])).rejects.toThrow(/owner_only/);
    await pool.query("select public.admin_recon_settings_save($1, '{\"auto_approve_statements\": true, \"auto_approve_from_day\": 1, \"confirm\": true}')", [owner]);

    const r = await val("select public.recon_auto_approve(now())") as Row;
    expect(await val("select status from public.sales_statements where id = $1", [ok.st])).toBe("approved");
    expect(await val("select approved_by from public.sales_statements where id = $1", [ok.st])).toBe(owner);
    expect(await val("select status from public.sales_commissions where id = $1", [ok.line])).toBe("approved");
    expect(await val("select status from public.sales_statements where id = $1", [unverified.st])).toBe("open");
    expect(await val("select status from public.sales_statements where id = $1", [big.st])).toBe("open");
    const f = (r.findings as Row[]).map((x) => [x.entity_id, x.severity, (x.detail as Row).problems]);
    expect(f).toContainEqual([unverified.st, "material", ["invoice_not_verified"]]);
    expect(f).toContainEqual([big.st, "action", ["above_auto_limit"]]);
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.statement_auto_approved' and target_id = $1", [ok.st])).toBe(1);
    // Re-running changes nothing.
    await pool.query("select public.recon_auto_approve(now())");
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.statement_auto_approved' and target_id = $1", [ok.st])).toBe(1);
  });

  it("live payouts and production QuickBooks bills skip statements whose payment isn't verified; test mode is unchanged", async () => {
    const good = await repStatement(owner, 1999);
    await fact(good.inv!, good.cust);
    const bad = await repStatement(owner, 1999);
    await pool.query("update public.sales_statements set status = 'approved' where id = any($1)", [[good.st, bad.st]]);
    await pool.query("update public.sales_commissions set status = 'approved' where statement_id = any($1)", [[good.st, bad.st]]);
    expect(await val("select public.recon_statement_ready($1)", [good.st])).toBe(true);
    expect(await val("select public.recon_statement_ready($1)", [bad.st])).toBe(false);
    const prod = await val("select public.qb_payout_candidates('production') -> 'items'") as Row[];
    const sand = await val("select public.qb_payout_candidates('sandbox') -> 'items'") as Row[];
    expect(prod.map((x) => x.source_id)).toContain(good.st);
    expect(prod.map((x) => x.source_id)).not.toContain(bad.st);
    expect(sand.map((x) => x.source_id)).toContain(bad.st);
    await expect(pool.query("select public.qb_payout_bill_reserve($1, 'sales_statement', $2, '123', 'production')", [owner, bad.st])).rejects.toThrow(/payment_not_verified/);
  });

  it("daily checks find mismatches, duplicate attribution, unverified paid payouts and missed invoices", async () => {
    const a = await repStatement(owner, 1999);
    await pool.query("update public.sales_statements set status = 'approved', total_cents = 5000 where id = $1", [a.st]);
    await pool.query("update public.sales_commissions set status = 'approved' where id = $1", [a.line]);
    // A paid invoice for this attributed customer that the Sales Hub never recorded.
    await fact(`in_missed_${a.cust.slice(0, 6)}`, a.cust, { paidDaysAgo: 5 });
    // The same customer also credited to an affiliate.
    const af = (await q1("insert into public.affiliates (email, code, status, source) values ('dup@creators.com', 'DUPAFF22', 'active', 'invite') returning id")).id;
    await pool.query("insert into public.affiliate_referrals (user_id, affiliate_id, code) values ($1, $2, 'DUPAFF22')", [a.cust, af]);
    // A live payout marked paid with no provider confirmation.
    const staff = await val("select id from public.staff_members where sales_rep_id = $1", [a.rep]);
    await pool.query(`insert into public.payouts (ref, staff_id, mode, provider, gross_cents, net_cents, status, scheduled_for, idempotency_key)
      values ('B2B-PO-TEST-1', $1, 'live', 'stripe_global_payouts', 5000, 5000, 'paid', current_date, 'idem-recon-1')`, [staff]);

    const f = await val("select public.recon_db_findings(now(), true)") as Row[];
    const kinds = (k: string) => f.filter((x) => x.kind === k).map((x) => x.entity_id);
    expect(kinds("statement_total_mismatch")).toContain(a.st);
    expect(kinds("commission_unverified")).toContain(a.line);
    expect(kinds("duplicate_attribution")).toContain(a.cust);
    expect(f.some((x) => x.kind === "payout_paid_unverified")).toBe(true);
    expect(f.some((x) => x.kind === "paid_invoice_unprocessed" && String(x.entity_id).startsWith("in_missed_"))).toBe(true);
    // Without a successful Stripe check, "not verified" can't be told apart from "not fetched yet": not reported.
    const noStripe = await val("select public.recon_db_findings(now(), false)") as Row[];
    expect(noStripe.some((x) => x.kind === "commission_unverified")).toBe(false);
  });

  it("exceptions are deduplicated, cleared when the records are fixed, and acknowledged only with a note", async () => {
    const run = await val("select public.recon_run_begin('daily', null)") as string;
    expect(await val("select public.recon_run_begin('daily', null)")).toBeNull();            // one run at a time
    const find = [{ fingerprint: "test:1", scope: "db", kind: "statement_total_mismatch", severity: "material", summary: "Test mismatch", amount_cents: 300 },
      { fingerprint: "test:2", scope: "db", kind: "payout_stuck", severity: "action", summary: "Stuck" }];
    const s1 = await val("select public.recon_exceptions_sync($1, $2, array['db'])", [run, JSON.stringify(find)]) as Row;
    expect(s1.new).toBeGreaterThanOrEqual(2);
    expect((s1.notify as Row[]).map((x) => x.summary)).toEqual(expect.arrayContaining(["Test mismatch", "Stuck"]));
    await pool.query("select public.recon_exceptions_mark_notified(array(select id from public.recon_exceptions where fingerprint like 'test:%'))");
    const s2 = await val("select public.recon_exceptions_sync($1, $2, array['db'])", [run, JSON.stringify(find)]) as Row;
    expect(s2.new).toBe(0);
    expect((s2.notify as Row[]).some((x) => String(x.summary).startsWith("Test"))).toBe(false);   // no repeat email
    expect(await val("select occurrences from public.recon_exceptions where fingerprint = 'test:1' and status = 'open'")).toBe(2);
    const id = await val("select id from public.recon_exceptions where fingerprint = 'test:2' and status = 'open'");
    await expect(pool.query("select public.admin_recon_exception_ack($1, $2, 'ok')", [owner, id])).rejects.toThrow(/note_required/);
    await pool.query("select public.admin_recon_exception_ack($1, $2, 'Checked with the bank')", [owner, id]);
    // Next run without test:1 -> cleared (the records were fixed), never deleted.
    await pool.query("select public.recon_exceptions_sync($1, $2, array['db'])", [run, JSON.stringify([find[1]])]);
    expect(await q1("select status, resolution from public.recon_exceptions where fingerprint = 'test:1'")).toMatchObject({ status: "resolved", resolution: "cleared: no longer detected" });
    expect(await val("select status from public.recon_exceptions where fingerprint = 'test:2' and status <> 'resolved'")).toBe("acknowledged");
    await pool.query("select public.recon_run_finish($1, 'exceptions', '{}'::jsonb, null)", [run]);
  });

  it("month-end close: blocked while a material discrepancy is open, closes on its own once resolved, then immutable", async () => {
    await pool.query("delete from public.recon_exceptions");
    await pool.query("delete from public.recon_periods");
    const run = await val("select public.recon_run_begin('daily', null)") as string;
    await pool.query("select public.recon_exceptions_sync($1, $2, array['db'])", [run, JSON.stringify([{ fingerprint: "blk:1", scope: "db", kind: "duplicate_payment_route", severity: "material", summary: "Dup", period_month: "2026-11-01" }])]);
    const now = "2026-12-10T15:00:00Z";
    const r1 = await val("select public.recon_close_due($1, $2, true)", [run, now]) as Row;
    expect(r1).toMatchObject({ closed: 0, blocked: 1 });
    expect(await q1("select status, blocked_reasons from public.recon_periods where period_month = '2026-11-01'")).toMatchObject({ status: "blocked", blocked_reasons: ["duplicate_payment_route"] });
    // Stripe not checked today: never close.
    await pool.query("update public.recon_exceptions set status = 'resolved' where fingerprint = 'blk:1'");
    expect(await val("select public.recon_close_due($1, $2, false)", [run, now])).toMatchObject({ closed: 0, blocked: 1 });
    const r2 = await val("select public.recon_close_due($1, $2, true)", [run, now]) as Row;
    expect(r2.closed).toBeGreaterThanOrEqual(1);
    const p = await q1("select status, report_sha256, report from public.recon_periods where period_month = '2026-11-01'");
    expect(p.status).toBe("closed");
    expect(p.report_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((p.report as Row).status).toBe("passed");
    expect(Object.keys(p.report as Row)).toEqual(expect.arrayContaining(["revenue", "sales", "affiliates", "payouts", "quickbooks", "exceptions"]));
    await expect(pool.query("update public.recon_periods set status = 'open' where period_month = '2026-11-01'")).rejects.toThrow(/period_closed/);
    // Before the grace days pass, the month isn't attempted.
    await pool.query("delete from public.recon_periods where status <> 'closed'");
    expect(await val("select public.recon_close_due($1, '2027-01-02T15:00:00Z', true) ->> 'closed'", [run])).toBe("0");
    await pool.query("select public.recon_run_finish($1, 'passed', '{}'::jsonb, null)", [run]);
  });

  it("admin reads need a payouts capability", async () => {
    const stranger = await createUser(pool, "stranger@example.com");
    await expect(pool.query("select public.admin_recon_overview($1)", [stranger])).rejects.toThrow(/forbidden/);
    const o = await val("select public.admin_recon_overview($1)", [owner]) as Row;
    expect(Object.keys(o.cards as Row)).toEqual(expect.arrayContaining(["verified_revenue_cents", "accrued_sales_cents", "pending_approval_cents", "qb_awaiting_payment_cents", "open_exceptions"]));
    const t = await val("select public.admin_recon_trace($1, '{\"program\": \"sales\"}')", [owner]) as Row[];
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]).toHaveProperty("problems");
  });
});
