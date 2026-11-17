/**
 * Financial Command Center, migration 20261124005000: merging customers that have financial records.
 *   - customer_merge re-points fin_jobs / fin_invoices / fin_payments / fin_credit_memos (voided rows too)
 *   - the frozen bill-to copy on issued invoices, numbers, amounts and statuses stay exactly as they were
 *   - outside a merge (or a merge that changes anything but customer_id) the guards still refuse
 *   - balances follow the kept customer; one audit entry per book
 *   - the rollback restores the previous functions and the migration re-applies
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("Financial Command Center: customer merge with financial records (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let removeId: string;
  let keepId: string;
  let job: string;
  let issued: string;
  let voidedPayment: string;
  let billToBefore: unknown;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_customer_merge"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    const est = await wonBid(pool, w.owner, w.company);
    removeId = est.customer!;
    await pool.query("update public.customers set company_id = $2 where id = $1", [removeId, w.company]);
    keepId = (await pool.query("insert into public.customers (user_id, company_id, name, email, source) values ($1, $2, 'Patricia Rivera', null, 'manual') returning id", [w.owner, w.company])).rows[0].id;
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId as string;
    const ms = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    issued = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: ms[0].id }])).r.invoiceId as string;
    await as(w.bk, "select public.fin_invoice_issue($1, null, null)", [issued]);
    await as(w.bk, "select public.fin_payment_record($1, $2)", [w.book, { jobId: job, method: "check", amount: "5000.00", allocations: [{ invoiceId: issued, amount: "5000.00" }] }]);
    voidedPayment = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "50.00" }])).r.paymentId as string;
    await as(w.bk, "select public.fin_payment_void($1, 'entered twice')", [voidedPayment]);
    await as(w.bk, "select public.fin_credit_memo_issue($1, $2)", [w.book, { invoiceId: issued, amount: "100.00", reason: "Goodwill" }]);
    billToBefore = (await pool.query("select bill_to from public.fin_invoices where id = $1", [issued])).rows[0].bill_to;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("the guards still refuse a customer_id change outside a merge", async () => {
    expect(await fails(pool.query("update public.fin_invoices set customer_id = $1 where id = $2", [keepId, issued]))).toBe("record_immutable");
    expect(await fails(pool.query("update public.fin_jobs set customer_id = $1 where id = $2", [keepId, job]))).toBe("record_immutable");
    expect(await fails(pool.query("update public.fin_payments set customer_id = $1 where id = $2", [keepId, voidedPayment]))).toBe("record_immutable");
  });

  it("with the merge flag set, anything other than customer_id is still refused", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.fin_customer_merge', 'on', true)");
      expect(await fails(c.query("update public.fin_invoices set customer_id = $1, total = total + 1 where id = $2", [keepId, issued]))).toBe("record_immutable");
      await c.query("rollback");
    } finally { c.release(); }
  });

  it("merging re-points every financial record and leaves the issued documents' bill-to copy untouched", async () => {
    await as(w.owner, "select public.customer_merge($1, $2)", [keepId, removeId]);
    expect((await pool.query("select count(*)::int n from public.customers where id = $1", [removeId])).rows[0].n).toBe(0);
    for (const t of ["fin_jobs", "fin_invoices", "fin_payments", "fin_credit_memos"]) {
      const r = (await pool.query(`select count(*) filter (where customer_id = $1)::int keep, count(*) filter (where customer_id = $2)::int gone from public.${t}`, [keepId, removeId])).rows[0];
      expect(r.gone, t).toBe(0);
      expect(r.keep, t).toBeGreaterThan(0);
    }
    const inv = (await pool.query("select status, number, total, bill_to from public.fin_invoices where id = $1", [issued])).rows[0];
    expect(inv.status).toBe("issued");
    expect(inv.bill_to).toEqual(billToBefore);
    expect((await pool.query("select status from public.fin_payments where id = $1", [voidedPayment])).rows[0].status).toBe("void");
    const bal = await rows(w.owner, "select customer_id from public.fin_customer_balances_v where book_id = $1", [w.book]);
    expect(bal.map((b) => b.customer_id)).toEqual([keepId]);
    const audit = await pool.query("select count(*)::int n from public.fin_audit_log where book_id = $1 and action = 'customer.merged'", [w.book]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("after the merge the guards are back on", async () => {
    expect(await fails(pool.query("update public.fin_invoices set customer_id = null where id = $1", [issued]))).toBe("record_immutable");
  });

  it("rollback restores the previous functions; the migration re-applies", async () => {
    await pool.query(readFileSync("docs/financials/rollback_20261124005000.sql", "utf8"));
    expect((await pool.query("select count(*)::int n from pg_proc where proname = 'fin_merge_only_customer'")).rows[0].n).toBe(0);
    expect((await pool.query("select prosrc from pg_proc where proname = 'customer_merge'")).rows[0].prosrc).not.toContain("fin_jobs");
    await applyMigration(pool, "20261124005000_fin_customer_merge.sql");
    expect((await pool.query("select prosrc from pg_proc where proname = 'customer_merge'")).rows[0].prosrc).toContain("fin_jobs");
  });
});
