/**
 * General ledger (20270214001000), against the real SQL:
 *   - sync posts balanced accrual entries for invoices, payments, credit memos, refunds, bills, bill payments, expenses
 *   - re-running sync never double-posts; voiding a record posts one reversal
 *   - the trial balance always nets to zero; AR and AP agree with the open balances
 *   - manual entries must balance, use the book's own accounts and stay out of closed periods
 *   - closing a period moves late automatic postings to the first open day; reopening needs a reason
 *   - the payroll journal posts gross wages, employer taxes, liabilities and net pay
 *   - the tables are read-only to browsers and hidden from people without company-financials access
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

d("General ledger (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let inv: string;

  const sync = (u = w.owner) => as<{ n: number }>(u, "select public.fin_gl_sync($1) as n", [w.book]).then((r) => Number(r.n));
  const balances = (u = w.owner, to: string | null = null) => rows(u, "select * from public.fin_gl_balances($1, null, $2)", [w.book, to]);
  const bal = async (key: string) => Number((await balances()).find((b) => b.system_key === key)?.balance ?? 0);
  const acct = async (key: string) => (await pool.query("select id from public.fin_gl_accounts where book_id = $1 and system_key = $2", [w.book, key])).rows[0].id as string;
  const totals = async () => {
    const r = (await pool.query("select coalesce(sum(debit), 0)::numeric as dr, coalesce(sum(credit), 0)::numeric as cr from public.fin_journal_lines where book_id = $1", [w.book])).rows[0];
    return { dr: Number(r.dr), cr: Number(r.cr) };
  };
  const journal = (u: string, p: Row, key: string | null = null) => as<{ r: Row }>(u, "select public.fin_gl_journal_post($1, $2, $3) as r", [w.book, p, key]).then((r) => r.r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_gl"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    const est = await wonBid(pool, w.owner, w.company, { title: "Deck", total: "10000.00", tax: "0.00" });
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    const ms = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    inv = (await as<{ r: Row }>(w.owner, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: ms[0].id }])).r.invoiceId as string;
    await as(w.owner, "select public.fin_invoice_issue($1, null, $2)", [inv, "Billed early for the test"]);   // 3,000
    await as(w.bk, "select public.fin_payment_record($1, $2)", [w.book, { jobId: job, invoiceId: inv, method: "check", amount: "2000.00" }]);
    const vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { name: "Lumber Yard", kind: "supplier" }])).v;
    const bill = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, {
      vendorId: vendor, vendorInvoiceNumber: "LY-1", lines: [{ jobId: job, amount: "1000.00", description: "Joists" }, { amount: "200.00", description: "Shop supplies" }],
    }])).r.billId;
    await as(w.owner, "select public.fin_bill_approve($1)", [bill]);
    await as(w.bk, "select public.fin_bill_payment_record($1, $2)", [w.book, { billId: bill, amount: "600.00", method: "check" }]);
    const e = (await as<{ r: Row }>(w.bk, "select public.fin_expense_record($1, $2) as r", [w.book, { amount: "80.00", description: "Screws", jobId: job }])).r.expenseId;
    await as(w.owner, "select public.fin_expense_decide($1, 'approve')", [e]);
    // A pending (unapproved) expense is not in the ledger.
    await as(w.bk, "select public.fin_expense_record($1, $2)", [w.book, { amount: "15.00", description: "Coffee" }]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("posts balanced accrual entries for every financial record", async () => {
    const n = await sync();
    expect(n).toBe(5);   // invoice, payment, bill, bill payment, approved expense
    expect(await bal("ar")).toBe(1000);              // 3,000 invoiced - 2,000 paid
    expect(await bal("revenue")).toBe(3000);
    expect(await bal("cash")).toBe(2000 - 600 - 80);
    expect(await bal("ap")).toBe(600);               // 1,200 approved - 600 paid
    expect(await bal("job_costs")).toBe(1080);
    expect(await bal("overhead")).toBe(200);
    const t = await totals();
    expect(t.dr).toBe(t.cr);
    // Every entry has at least two lines and balances on its own.
    const { rows: bad } = await pool.query(`select e.id from public.fin_journal_entries e join public.fin_journal_lines l on l.entry_id = e.id
      where e.book_id = $1 group by e.id having sum(l.debit) <> sum(l.credit) or count(*) < 2`, [w.book]);
    expect(bad).toEqual([]);
  });

  it("is idempotent and reverses voided records once", async () => {
    expect(await sync()).toBe(0);
    const p2 = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "45.10" }])).r.paymentId;
    expect(await sync()).toBe(1);
    await as(w.owner, "select public.fin_payment_void($1, 'entered twice')", [p2]);
    expect(await sync()).toBe(1);
    expect(await sync()).toBe(0);
    const { rows: es } = await pool.query("select event_kind, reverses is not null as rev from public.fin_journal_entries where source_ref = $1 order by posted_at", [p2]);
    expect(es).toEqual([{ event_kind: "post", rev: false }, { event_kind: "void", rev: true }]);
    expect(await bal("cash")).toBe(1320);
  });

  it("rejects unbalanced, empty, foreign and locked manual entries", async () => {
    const cash = await acct("cash"); const eq = await acct("opening_equity");
    const today = new Date().toISOString().slice(0, 10);
    expect(await fails(journal(w.owner, { date: today, memo: "Bad", lines: [{ account: cash, debit: "10" }, { account: eq, credit: "9" }] }))).toBe("journal_unbalanced");
    expect(await fails(journal(w.owner, { date: today, memo: "One", lines: [{ account: cash, debit: "0" }] }))).toBe("journal_needs_two_lines");
    expect(await fails(journal(w.owner, { date: today, memo: "", lines: [{ account: cash, debit: "1" }, { account: eq, credit: "1" }] }))).toBe("memo_required");
    await as(w.rival, "select public.fin_gl_sync($1)", [w.rivalBook]);
    const rivalCash = (await pool.query("select id from public.fin_gl_accounts where book_id = $1 and system_key = 'cash'", [w.rivalBook])).rows[0].id;
    expect(await fails(journal(w.owner, { date: today, memo: "X", lines: [{ account: rivalCash, debit: "1" }, { account: eq, credit: "1" }] }))).toBe("unknown_account");
    expect(await fails(journal(w.bk, { date: today, memo: "X", lines: [{ account: cash, debit: "1" }, { account: eq, credit: "1" }] }))).toBe("forbidden");
    // Opening balance: Dr cash / Cr opening equity.
    const r = await journal(w.owner, { date: "2026-01-01", memo: "Opening bank balance", opening: true, lines: [{ account: cash, debit: "5000" }, { account: eq, credit: "5000" }] }, "gl-open-0001");
    expect((await journal(w.owner, { date: "2026-01-01", memo: "again" }, "gl-open-0001")).entryId).toBe(r.entryId);
    expect(await bal("cash")).toBe(6320);
    expect(await bal("opening_equity")).toBe(5000);
  });

  it("closes periods: late records post on the first open day, reopening needs a reason", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect(await fails(as(w.bk, "select public.fin_gl_lock_period($1, $2)", [w.book, yesterday]))).toBe("forbidden");
    await as(w.owner, "select public.fin_gl_lock_period($1, $2)", [w.book, yesterday]);
    const cash = await acct("cash"); const eq = await acct("opening_equity");
    expect(await fails(journal(w.owner, { date: yesterday, memo: "Late", lines: [{ account: cash, debit: "1" }, { account: eq, credit: "1" }] }))).toBe("gl_period_closed");
    const p = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "10.00", receivedOn: "2026-02-01" }])).r.paymentId;
    await sync();
    const { rows: [e] } = await pool.query("select entry_date::text as d from public.fin_journal_entries where source_ref = $1", [p]);
    expect(e.d > yesterday).toBe(true);
    expect(await fails(as(w.owner, "select public.fin_gl_lock_period($1, '2026-01-01')", [w.book]))).toBe("reason_required");
    await as(w.owner, "select public.fin_gl_lock_period($1, '2026-01-01', 'Fixing January')", [w.book]);
    const audit = (await pool.query("select action from public.fin_audit_log where book_id = $1 and action like 'period.%' order by created_at", [w.book])).rows.map((a) => a.action);
    expect(audit).toEqual(["period.closed", "period.reopened"]);
  });

  it("reverses manual and payroll entries, not automatic ones", async () => {
    const r = await as<{ r: Row }>(w.owner, "select public.fin_gl_payroll_post($1, $2) as r", [w.book, {
      payDate: new Date().toISOString().slice(0, 10), reference: "PR-2026-11-21", gross: "3000.00", employerTaxes: "230.00", withholding: "650.00", net: "2350.00",
      jobAllocations: [{ jobId: job, amount: "1200.00" }],
    }]).then((x) => x.r);
    expect(await bal("job_labor")).toBe(1200);
    expect(await bal("wages")).toBe(1800);
    expect(await bal("payroll_taxes")).toBe(230);
    expect(await bal("payroll_liabilities")).toBe(880);
    expect(await fails(as(w.owner, "select public.fin_gl_payroll_post($1, $2)", [w.book, { reference: "PR-X", gross: "100", withholding: "10", net: "80" }]))).toBe("payroll_unbalanced");
    // Same reference again: same entry, nothing new.
    const again = await as<{ r: Row }>(w.owner, "select public.fin_gl_payroll_post($1, $2) as r", [w.book, { reference: "PR-2026-11-21", gross: "3000.00", withholding: "650.00", net: "2350.00" }]).then((x) => x.r);
    expect(again.entryId).toBe(r.entryId);
    expect(await fails(as(w.owner, "select public.fin_gl_journal_reverse($1, null, '')", [r.entryId]))).toBe("reason_required");
    await as(w.owner, "select public.fin_gl_journal_reverse($1, null, 'Wrong pay run')", [r.entryId]);
    expect(await fails(as(w.owner, "select public.fin_gl_journal_reverse($1, null, 'again')", [r.entryId]))).toBe("already_reversed");
    expect(await bal("wages")).toBe(0);
    const auto = (await pool.query("select id from public.fin_journal_entries where book_id = $1 and source_type = 'invoice' limit 1", [w.book])).rows[0].id;
    expect(await fails(as(w.owner, "select public.fin_gl_journal_reverse($1, null, 'no')", [auto]))).toBe("reverse_source_instead");
  });

  it("keeps the trial balance at zero and the books read-only", async () => {
    const all = await balances();
    const dr = all.filter((b) => ["asset", "cogs", "expense"].includes(b.type as string)).reduce((s, b) => s + Number(b.balance), 0);
    const cr = all.filter((b) => !["asset", "cogs", "expense"].includes(b.type as string)).reduce((s, b) => s + Number(b.balance), 0);
    expect(Math.round((dr - cr) * 100)).toBe(0);
    // Activity report has a running balance that ends at the account balance.
    const act = await rows(w.owner, "select * from public.fin_gl_activity($1, $2, null, null)", [w.book, await acct("cash")]);
    expect(Number(act[act.length - 1].running)).toBe(await bal("cash"));
    // Append-only, even for the service role.
    expect(await fails(pool.query("update public.fin_journal_lines set debit = debit + 1 where book_id = $1", [w.book]))).toMatch(/immutable|append|not allowed|cannot/i);
    // Browsers can't write; people without company financials can't read.
    expect(await fails(as(w.owner, "insert into public.fin_journal_entries (book_id, entry_date, memo, source_type, source_ref, event_kind) values ($1, now(), 'x', 'manual', 'x', 'post')", [w.book]))).toMatch(/permission denied/);
    expect(await rows(w.rep, "select id from public.fin_journal_entries where book_id = $1", [w.book])).toEqual([]);
    expect(await fails(as(w.rep, "select * from public.fin_gl_balances($1, null, null)", [w.book]))).toBe("forbidden");
    expect(await fails(pool.query("select public.fin_gl_post($1, now()::date, 'x', 'manual', 'y', 'post', '[]')", [w.book]).then(() => as(w.owner, "select public.fin_gl_post($1, now()::date, 'x', 'manual', 'y', 'post', '[]')", [w.book])))).toMatch(/permission denied/);
  });

  it("lets accounts be added and renamed but protects system accounts", async () => {
    const a = await as<{ r: Row }>(w.owner, "select public.fin_gl_account_save($1, $2) as r", [w.book, { code: "1010", name: "Savings", type: "asset" }]).then((x) => x.r);
    expect(a).toMatchObject({ code: "1010", type: "asset", active: true });
    expect(await fails(as(w.owner, "select public.fin_gl_account_save($1, $2)", [w.book, { code: "1010", name: "Dup", type: "asset" }]))).toMatch(/duplicate|unique/);
    const cash = await acct("cash");
    await as(w.owner, "select public.fin_gl_account_save($1, $2)", [w.book, { id: cash, name: "Operating checking" }]);
    expect(await fails(as(w.owner, "select public.fin_gl_account_save($1, $2)", [w.book, { id: cash, active: false }]))).toBe("system_account");
    expect(await fails(as(w.bk, "select public.fin_gl_account_save($1, $2)", [w.book, { code: "1020", name: "X", type: "asset" }]))).toBe("forbidden");
  });
});
