/**
 * V5 / V5.1 Project Financials + Accounts Receivable, against the real SQL (20261126001000):
 *   - the V5.1 $45,000 remodel fixture: contract, original cost, invoiced, collected, AR and unbilled
 *     reconcile exactly with invoice and payment records; future milestones never count as AR
 *   - partial payments, pending vs approved change orders, sub-quote overruns move the forecast (per cost
 *     code) but never the customer's contract; actual stays separate from estimated
 *   - bill payments: partial, no overpayment, no void while paid, idempotent
 *   - repaired bill RLS: a PM assigned to the job sees its bills; outsiders still see nothing
 *   - AR view: aging buckets, customer, rep / PM; cross-company isolation
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, changeOrder, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

// Original estimated direct cost $33,000: framing sub 6,500 + material 20,000 (decks) + electrical labor 6,500.
const ITEMS = [
  { id: "f1", groupId: "g1", costType: "subcontractor", quantity: "1", unitCost: "6500" },
  { id: "m1", groupId: "g1", costType: "material", quantity: "1", unitCost: "20000" },
  { id: "e1", groupId: "g2", costType: "labor", quantity: "65", unitCost: "100" },
];
const SCHEDULE = [
  { label: "Deposit", percent: "10", amount: "$4,500.00" }, { label: "Framing", percent: "30", amount: "$13,500.00" },
  { label: "Installation", percent: "40", amount: "$18,000.00" }, { label: "Final completion", percent: "20", amount: "$9,000.00" },
];

d("V5.1 Project Financials + Accounts Receivable (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let est: { id: string; v1: string; customer: string | null };
  let job: string;
  let ms: Row[];
  const inv: Record<string, string> = {};
  let vendor: string;
  let commitment: string;
  let bill: string;

  const summary = async (u = w.owner) => (await rows(u, "select * from public.fin_job_summary_v where job_id = $1", [job]))[0];
  const save = (p: Row) => as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, p]).then((r) => r.r);
  const issue = (id: string) => as<{ r: Row }>(w.bk, "select public.fin_invoice_issue($1) as r", [id]).then((r) => r.r);
  const pay = (p: Row, key: string | null = null) => as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2, $3) as r", [w.book, p, key]).then((r) => r.r);
  const billPay = (u: string, p: Row, key: string | null = null) => as<{ r: Row }>(u, "select public.fin_bill_payment_record($1, $2, $3) as r", [w.book, p, key]).then((r) => r.r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_v5_ar"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    est = await wonBid(pool, w.owner, w.company, { title: "Kitchen remodel", total: "45000.00", tax: "0.00", schedule: SCHEDULE, items: ITEMS });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    ms = await rows(w.owner, "select id, description, amount from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("1-2. the approved proposal's contract and payment schedule carry into the project", async () => {
    expect(ms.map((m) => [m.description, m.amount])).toEqual([
      ["Deposit", "4500.00"], ["Framing", "13500.00"], ["Installation", "18000.00"], ["Final completion", "9000.00"]]);
    expect(await summary()).toMatchObject({
      contract_value: "45000.00", original_estimated_cost: "33000.00", forecast_cost: "33000.00", estimated_profit: "12000.00",
      invoiced: "0", collected: "0", outstanding_ar: "0", unbilled: "45000.00", estimated_margin_pct: "26.7",
    });
  });

  it("V5.1 fixture: deposit + framing paid, installation sent unpaid, final not invoiced", async () => {
    await as(w.bk, "select public.fin_milestone_trigger_record($1, $2)", [job, { triggerKind: "phase_completed_verified", milestoneId: ms[1].id }]);
    await as(w.bk, "select public.fin_milestone_trigger_record($1, $2)", [job, { triggerKind: "phase_completed_verified", milestoneId: ms[2].id }]);
    for (const [k, i] of [["deposit", 0], ["framing", 1], ["install", 2]] as const) {
      const r = await save({ milestoneId: ms[i].id });
      expect(r.discrepancies, k).toEqual([]);
      inv[k] = r.invoiceId;
      await issue(inv[k]);
    }
    await pay({ jobId: job, method: "check", reference: "1001", amount: "4500.00", allocations: [{ invoiceId: inv.deposit, amount: "4500.00" }] });
    await pay({ jobId: job, method: "ach", amount: "13500.00", allocations: [{ invoiceId: inv.framing, amount: "13500.00" }] });
    const s = await summary();
    expect(s).toMatchObject({
      contract_value: "45000.00", original_estimated_cost: "33000.00", estimated_profit: "12000.00",
      invoiced: "36000.00", collected: "18000.00", outstanding_ar: "18000.00", unbilled: "9000.00",
    });
    // 4. invoiced reconciles with invoice records; 5. collected with payments; 6. the unbilled $9,000 is not AR.
    const issued = await rows(w.owner, "select total, paid, balance from public.fin_invoice_balances_v where job_id = $1 and status = 'issued'", [job]);
    const cents = (xs: Row[], k: string) => xs.reduce((t, x) => t + Math.round(Number(x[k]) * 100), 0);
    expect(cents(issued, "total")).toBe(3_600_000);
    expect(cents(issued, "paid")).toBe(1_800_000);
    expect(cents(issued, "balance")).toBe(1_800_000);
    const paid = await rows(w.owner, "select applied from public.fin_payment_balances_v where job_id = $1 and status = 'active'", [job]);
    expect(cents(paid, "applied")).toBe(1_800_000);
  });

  it("3. a second invoice for a fully invoiced milestone is flagged and refused", async () => {
    const dup = await save({ milestoneId: ms[2].id });
    expect(dup.discrepancies.map((x: Row) => x.code)).toContain("duplicate_milestone_invoice");
    expect(dup.total).toBe("0.00");   // nothing left to bill on this milestone
    expect(["bad_amount", "milestone_discrepancy"]).toContain(await fails(issue(dup.invoiceId)));
    await as(w.bk, "select public.fin_invoice_delete_draft($1)", [dup.invoiceId]);
    expect((await summary()).invoiced).toBe("36000.00");
  });

  it("7. a partial payment reduces the outstanding balance exactly", async () => {
    await pay({ jobId: job, method: "check", reference: "1002", amount: "5000.00", allocations: [{ invoiceId: inv.install, amount: "5000.00" }] }, "v5-partial-0001");
    await pay({ jobId: job, method: "check", reference: "1002", amount: "5000.00", allocations: [{ invoiceId: inv.install, amount: "5000.00" }] }, "v5-partial-0001");   // replay
    expect(await summary()).toMatchObject({ collected: "23000.00", outstanding_ar: "13000.00", invoiced: "36000.00" });
  });

  it("8-9. approved change orders update the contract; pending ones don't inflate it", async () => {
    await changeOrder(pool, est, w.owner, w.company, 1, "2000.00", "draft");
    expect(await summary()).toMatchObject({ contract_value: "45000.00", pending_changes: "2000.00", unbilled: "9000.00" });
    await changeOrder(pool, est, w.owner, w.company, 2, "3000.00", "approved");
    expect(await summary()).toMatchObject({ contract_value: "48000.00", original_contract: "45000.00", contract_changes: "3000.00", unbilled: "12000.00", outstanding_ar: "13000.00" });
  });

  it("10-12. a sub quote over the allowance moves the forecast per cost code, never the contract; actual stays separate", async () => {
    const res = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'subcontractor', 'Frame Co') returning id", [w.company])).rows[0].id;
    vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { resourceId: res }])).v;
    const code = (await pool.query("select id from public.fin_cost_codes where book_id = $1 and code = 'decks:subcontractor'", [w.book])).rows[0].id;
    commitment = (await as<{ r: Row }>(w.bk, "select public.fin_commitment_create($1, $2) as r", [w.book, { jobId: job, vendorId: vendor, costCodeId: code, title: "Framing", amount: "7200.00" }])).r.commitmentId;
    // Framing 6,500 -> 7,200: forecast +700. The old whole-job formula would have shown 33,000 (no change).
    expect(await summary()).toMatchObject({ contract_value: "48000.00", original_estimated_cost: "33000.00", forecast_cost: "33700.00", forecast_profit: "14300.00", actual_cost: "0" });
    const line = (await rows(w.owner, "select estimated, committed, actual, forecast from public.fin_job_budget_v where job_id = $1 and code = 'decks:subcontractor'", [job]))[0];
    expect(line).toEqual({ estimated: "6500.00", committed: "7200.00", actual: "0", forecast: "7200.00" });
    // Sub bills 7,000 against the commitment: actual 7,000, 200 still committed, forecast unchanged.
    bill = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, { vendorId: vendor, vendorInvoiceNumber: "FC-1", lines: [{ commitmentId: commitment, amount: "7000.00", description: "Framing" }] }])).r.billId;
    await as(w.owner, "select public.fin_bill_approve($1)", [bill]);
    expect(await summary()).toMatchObject({ forecast_cost: "33700.00", actual_cost: "7000.00", committed_cost: "200.00", original_estimated_cost: "33000.00", contract_value: "48000.00", unpaid_bills: "7000.00", unpaid_sub_bills: "7000.00" });
  });

  it("bill payments: partial, no overpayment, no bill void while paid, voids reverse", async () => {
    expect(await fails(billPay(w.rep, { billId: bill, amount: "1.00", method: "check" }))).toBe("forbidden");
    const p1 = await billPay(w.bk, { billId: bill, amount: "4000.00", method: "check", reference: "2001" }, "billpay-0001");
    expect((await billPay(w.bk, { billId: bill, amount: "4000.00", method: "check" }, "billpay-0001")).billPaymentId).toBe(p1.billPaymentId);
    expect(p1.balance).toBe("3000.00");
    expect(await fails(billPay(w.bk, { billId: bill, amount: "3000.01", method: "check" }))).toBe("over_paid_bill");
    expect((await rows(w.owner, "select paid, balance from public.fin_bill_balances_v where bill_id = $1", [bill]))[0]).toEqual({ paid: "4000.00", balance: "3000.00" });
    expect((await summary()).unpaid_bills).toBe("3000.00");
    expect(await fails(as(w.owner, "select public.fin_bill_void($1, 'oops')", [bill]))).toBe("has_payments");
    expect(await fails(pool.query("update public.fin_bill_payments set amount = 1 where id = $1", [p1.billPaymentId]))).toBe("record_immutable");
    expect(await fails(pool.query("delete from public.fin_bill_payments where id = $1", [p1.billPaymentId]))).toBe("record_immutable");
    expect(await fails(pool.query("insert into public.fin_bill_payments (book_id, bill_id, paid_on, method, amount) values ($1, $2, current_date, 'cash', 3000.01)", [w.book, bill]))).toBe("over_paid_bill");
    expect(await fails(as(w.bk, "select public.fin_bill_payment_void($1, 'bounced')", [p1.billPaymentId]))).toBe("forbidden");
    await as(w.owner, "select public.fin_bill_payment_void($1, 'bounced')", [p1.billPaymentId]);
    expect((await summary()).unpaid_bills).toBe("7000.00");
    // Unapproved bills can't be paid.
    const pending = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, { vendorId: vendor, vendorInvoiceNumber: "FC-2", lines: [{ jobId: job, amount: "50.00" }] }])).r.billId;
    expect(await fails(billPay(w.bk, { billId: pending, amount: "50.00", method: "cash" }))).toBe("bill_not_approved");
  });

  it("repaired bill RLS: the job's PM sees its bills; other companies see nothing", async () => {
    expect((await rows(w.pm, "select id from public.fin_vendor_bills")).length).toBe(0);
    await pool.query(
      `insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date, project_manager_id, sales_rep_id)
       values ($1, $2, $3, 'Kitchen', '{}', '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}', '2026-11-02', $4, $5)`,
      [est.id, w.owner, w.company, w.pm, w.rep]);
    expect((await rows(w.pm, "select id from public.fin_vendor_bills")).map((r) => r.id)).toContain(bill);
    expect((await rows(w.pm, "select bill_id from public.fin_bill_payments")).length).toBeGreaterThan(0);
    expect((await summary(w.pm))).toMatchObject({ contract_value: "48000.00", project_manager_id: w.pm, sales_rep_id: w.rep });
    for (const t of ["fin_vendor_bills", "fin_bill_payments", "fin_job_summary_v", "fin_ar_invoices_v", "fin_bill_balances_v"]) {
      expect((await rows(w.rival, `select * from public.${t}`)).length, t).toBe(0);
      expect((await rows(w.viewer, `select * from public.${t}`)).length, t).toBe(0);
    }
  });

  it("AR view: aging buckets, customer and project, rep / PM for filters", async () => {
    await pool.query("alter table public.fin_invoices disable trigger user");
    await pool.query("update public.fin_invoices set issue_date = current_date - 50, due_date = current_date - 45 where id = $1", [inv.install]);
    await pool.query("alter table public.fin_invoices enable trigger user");
    const ar = await rows(w.owner, "select number, customer_name, job_name, balance, aging_bucket, days_overdue, sales_rep_id, project_manager_id from public.fin_ar_invoices_v where job_id = $1 order by number", [job]);
    expect(ar.map((r) => [r.number, r.balance, r.aging_bucket])).toEqual([["INV-0001", "0.00", "paid"], ["INV-0002", "0.00", "paid"], ["INV-0003", "13000.00", "31_60"]]);
    expect(ar[2]).toMatchObject({ customer_name: "Pat Rivera", job_name: "Kitchen remodel", days_overdue: 45, sales_rep_id: w.rep, project_manager_id: w.pm });
    const cust = (await rows(w.owner, "select * from public.fin_customer_balances_v where customer_id = $1", [est.customer]))[0];
    expect(cust).toMatchObject({ open_balance: "13000.00", days_31_60: "13000.00" });
    expect((await summary()).overdue_ar).toBe("13000.00");
  });

  it("the rollback removes the new objects, restores the old views, and the migration re-applies", async () => {
    const { readFileSync } = await import("node:fs");
    const up = readFileSync("supabase/migrations/20261126001000_fin_v5_ar_job_summary.sql", "utf8");
    const down = readFileSync("docs/financials/rollback_20261126001000.sql", "utf8");
    await pool.query(readFileSync("docs/financials/rollback_20261201007000.sql", "utf8"));   // newer objects that read fin_bill_payments
    expect(await fails(pool.query(down))).toBe("bill payments exist; keep this migration");
    await pool.query("rollback").catch(() => {});
    await pool.query("alter table public.fin_bill_payments disable trigger user");
    await pool.query("delete from public.fin_bill_payments");
    await pool.query("alter table public.fin_bill_payments enable trigger user");
    await pool.query(down);
    expect((await pool.query("select to_regclass('public.fin_job_summary_v') as v")).rows[0].v).toBeNull();
    expect(Object.keys((await pool.query("select * from public.fin_job_profitability_v limit 1")).rows[0] ?? {})).not.toContain("forecast_cost");
    await pool.query(up);
    await pool.query(up);   // idempotent
    expect((await summary()).forecast_cost).toBe("33700.00");
  });
});
