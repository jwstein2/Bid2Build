/**
 * Company Reports + P&L (20261201007000), against the real SQL:
 *   - cash basis: payments (applied + unapplied) - refunds; bill payments split across bill lines; approved expenses
 *   - billed basis: issued invoices - credit memos; approved bill lines; approved expenses
 *   - voided / pending records never count; costs with no project are overhead
 *   - revenue is split across a project's trades by its estimated cost per trade, and still sums exactly
 *   - date range filter; company-level permission; RLS on the entries view; rollback + re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

const cents = (xs: Row[]) => xs.reduce((t, x) => t + Math.round(Number(x.amount) * 100), 0);
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

d("Company Reports + P&L (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  const pl = async (basis: "cash" | "billed", from = `${month}-01`, to = today, u = w.owner) =>
    (await as<{ r: { rows: Row[]; jobs: Row[]; trades: Row[] } }>(u, "select public.fin_report_pl($1, $2, $3, $4) as r", [w.book, basis, from, to])).r;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_reports"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    // Budget: decks 1,405.55 (material 1,005.55 + labor 400), electrical 2,000 (sub). Contract 40,000.
    const est = await wonBid(pool, w.owner, w.company);
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    const ms = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    const deposit = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: ms[0].id }])).r.invoiceId;
    await as(w.bk, "select public.fin_invoice_issue($1)", [deposit]);   // 12,000
    const draft = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "Extra", quantity: "1", unitPrice: "999" }] }])).r.invoiceId;
    expect(draft).toBeTruthy();   // a draft never counts
    await as(w.bk, "select public.fin_payment_record($1, $2)", [w.book, { jobId: job, method: "check", amount: "12000.00", allocations: [{ invoiceId: deposit, amount: "12000.00" }] }]);
    const extra = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "500.00" }])).r.paymentId;
    await as(w.bk, "select public.fin_refund_record($1, $2)", [w.book, { paymentId: extra, amount: "100.00", method: "check" }]);
    const voided = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "777.00" }])).r.paymentId;
    await as(w.owner, "select public.fin_payment_void($1, 'bounced')", [voided]);
    await as(w.bk, "select public.fin_credit_memo_issue($1, $2)", [w.book, { jobId: job, amount: "250.00", reason: "Scope removed" }]);

    const vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { name: "Lumber Yard", kind: "supplier" }])).v;
    const code = async (c: string) => (await pool.query("select id from public.fin_cost_codes where book_id = $1 and code = $2", [w.book, c])).rows[0].id as string;
    const bill = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, {
      vendorId: vendor, vendorInvoiceNumber: "LY-1", lines: [{ jobId: job, costCodeId: await code("decks:material"), amount: "1000.00", description: "Joists" }, { amount: "200.00", description: "Shop supplies" }],
    }])).r.billId;
    await as(w.owner, "select public.fin_bill_approve($1)", [bill]);
    await as(w.bk, "select public.fin_bill_payment_record($1, $2)", [w.book, { billId: bill, amount: "600.00", method: "check" }]);
    // Pending bill: never counts.
    await as(w.bk, "select public.fin_bill_record($1, $2)", [w.book, { vendorId: vendor, vendorInvoiceNumber: "LY-2", lines: [{ jobId: job, amount: "5000.00" }] }]);
    const exp = (await as<{ r: Row }>(w.bk, "select public.fin_expense_record($1, $2) as r", [w.book, { jobId: job, costCodeId: await code("decks:labor"), amount: "300.00", description: "Helper day" }])).r.expenseId;
    await as(w.owner, "select public.fin_expense_decide($1, 'approve')", [exp]);
    await as(w.bk, "select public.fin_expense_record($1, $2)", [w.book, { jobId: job, amount: "45.00", description: "Pending lunch" }]);   // pending
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("billed basis: invoices - credits; approved bill lines + approved expenses; overhead separate", async () => {
    const r = await pl("billed");
    const inc = r.rows.filter((x) => x.dir === "income");
    const cost = r.rows.filter((x) => x.dir === "cost");
    expect(cents(inc)).toBe(1_175_000);   // 12,000 - 250
    expect(cents(cost.filter((x) => x.job === job))).toBe(130_000);   // 1,000 material + 300 labor
    expect(cents(cost.filter((x) => x.job === null))).toBe(20_000);   // overhead line
    expect(cost.find((x) => x.type === "material" && x.job === job)).toMatchObject({ trade: "decks", amount: "1000.00", m: month });
    expect(cost.find((x) => x.type === "labor")).toMatchObject({ trade: "decks", amount: "300.00" });
    expect(r.jobs).toEqual([expect.objectContaining({ id: job, name: "Backyard deck", customer: "Pat Rivera", trades: expect.arrayContaining(["decks", "electrical"]) })]);
  });

  it("cash basis: payments + unapplied - refunds (voids excluded); bill payments split by line", async () => {
    const r = await pl("cash");
    const inc = r.rows.filter((x) => x.dir === "income");
    const cost = r.rows.filter((x) => x.dir === "cost");
    expect(cents(inc)).toBe(1_240_000);   // 12,000 + 500 - 100
    // Half the 1,200 bill paid: 500 to the job's material, 100 to overhead; plus the 300 expense.
    expect(cost.find((x) => x.type === "material")).toMatchObject({ amount: "500.00", job });
    expect(cost.find((x) => x.job === null)).toMatchObject({ amount: "100.00", type: null });
    expect(cents(cost)).toBe(90_000);
  });

  it("revenue is split across the project's trades by estimated cost, and the parts sum exactly", async () => {
    const inc = (await pl("cash")).rows.filter((x) => x.dir === "income");
    const byTrade = Object.fromEntries(inc.map((x) => [x.trade, x.amount]));
    // 12,400 x 1,405.55 / 3,405.55 = 5,117.77 (rounded); electrical (the larger share) takes any cent remainder.
    expect(byTrade.decks).toBe("5117.77");
    expect(byTrade.electrical).toBe("7282.23");
    expect(Number(byTrade.decks) + Number(byTrade.electrical)).toBeCloseTo(12400, 2);
    expect(cents(inc)).toBe(1_240_000);
  });

  it("a date range outside the activity is empty; bad input is refused", async () => {
    expect((await pl("cash", "2020-01-01", "2020-12-31")).rows).toEqual([]);
    expect(await fails(pl("cash", today, "2020-01-01"))).toBe("bad_range");
    expect(await fails(as(w.owner, "select public.fin_report_pl($1, 'accrual', current_date, current_date)", [w.book]))).toBe("bad_basis");
  });

  it("company reports need view_company_financials; other companies see nothing", async () => {
    expect(await fails(pl("cash", `${month}-01`, today, w.rep))).toBe("forbidden");
    expect(await fails(pl("cash", `${month}-01`, today, w.rival))).toBe("forbidden");
    expect((await pl("cash", `${month}-01`, today, w.bk)).rows.length).toBeGreaterThan(0);
    expect((await rows(w.rival, "select * from public.fin_report_entries_v")).length).toBe(0);
    expect((await rows(w.viewer, "select * from public.fin_report_entries_v")).length).toBe(0);
    const mine = await rows(w.bk, "select source, ref, amount, party from public.fin_report_entries_v where basis = 'billed' and direction = 'income' order by amount");
    expect(mine.map((x) => [x.source, x.amount])).toEqual([["credit_memo", "-250.00"], ["invoice", "12000.00"]]);
    expect(mine[1].party).toBe("Pat Rivera");
  });

  it("the rollback removes the report objects and the migration re-applies", async () => {
    const { readFileSync } = await import("node:fs");
    const up = readFileSync("supabase/migrations/20261201007000_fin_reports_pl.sql", "utf8");
    const down = readFileSync("docs/financials/rollback_20261201007000.sql", "utf8");
    await pool.query(down);
    expect((await pool.query("select to_regclass('public.fin_report_entries_v') as v")).rows[0].v).toBeNull();
    await pool.query(up);
    await pool.query(up);   // idempotent
    expect(cents((await pl("billed")).rows.filter((x) => x.dir === "income"))).toBe(1_175_000);
  });
});
