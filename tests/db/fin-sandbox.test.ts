/**
 * Company sandbox mode (20261130201000), Scenario G:
 *   - a separate practice book (sandbox_of) with SBX- numbering and copies of the real open jobs
 *   - fin_my_book() returns the sandbox only while that person has sandbox mode on
 *   - sandbox records never touch the real book; no email can be drafted or sent from a sandbox
 *   - permissions/plan follow the real book; seats and per-project settings can't be changed from a sandbox
 *   - opening a job always opens it in the real book; change orders reach both; start over archives
 *   - rollback / re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, changeOrder, fails, h, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("company sandbox mode (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let est: { id: string; v1: string };
  let job: string;
  let sb: string;
  const myBook = (u: string) => as<{ b: string }>(u, "select public.fin_my_book() as b").then((r) => r.b);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_sandbox"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    est = await wonBid(pool, w.owner, w.company, { title: "Roof", total: "12000.00" });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    const inv = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "Real work", quantity: "1", unitPrice: "100" }] }])).r.invoiceId;
    await as(w.bk, "select public.fin_invoice_issue($1)", [inv]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("only a config manager creates it; it copies open jobs with SBX numbering; mode is per person", async () => {
    expect(await fails(as(w.rival, "select public.fin_sandbox_enter($1)", [w.book]))).toBe("forbidden");
    expect(await fails(as(w.bk, "select public.fin_sandbox_enter($1)", [w.book]))).toBe("forbidden");   // bookkeeper can't create one
    const r = (await as<{ r: Row }>(w.owner, "select public.fin_sandbox_enter($1) as r", [w.book])).r;
    expect(r).toMatchObject({ created: true, jobsCopied: 1 });
    sb = r.sandboxBookId;
    expect(await myBook(w.owner)).toBe(sb);
    expect(await myBook(w.bk)).toBe(w.book);                 // the bookkeeper is still in the real books
    expect((await as<{ r: Row }>(w.bk, "select public.fin_sandbox_enter($1) as r", [w.book])).r).toMatchObject({ sandboxBookId: sb, created: false });
    expect(await myBook(w.bk)).toBe(sb);
    const acc = (await as<{ a: Row }>(w.bk, "select public.fin_access($1) as a", [sb])).a;
    expect(acc).toMatchObject({ sandbox: true, liveBookId: w.book, kind: "company", role: "bookkeeper", active: true });
    expect((await as<{ a: Row }>(w.bk, "select public.fin_access($1) as a", [w.book])).a.sandbox).toBe(false);
    const sj = (await rows(w.bk, "select id, job_number, sandbox from public.fin_jobs where book_id = $1", [sb]));
    expect(sj).toHaveLength(1);
    expect(sj[0]).toMatchObject({ job_number: "SBX-JOB-0001", sandbox: true });
    // The copy has the same payment schedule and a budget, and no invoices.
    const msReal = await rows(w.bk, "select description, amount from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    const msSb = await rows(w.bk, "select description, amount from public.fin_payment_milestones where job_id = $1 order by seq", [sj[0].id]);
    expect(msSb).toEqual(msReal);
    expect((await rows(w.bk, "select 1 from public.fin_invoices where book_id = $1", [sb]))).toHaveLength(0);
    await as(w.bk, "select public.fin_sandbox_leave()");
    expect(await myBook(w.bk)).toBe(w.book);
  });

  it("sandbox records stay in the sandbox and are numbered SBX-", async () => {
    const sj = (await rows(w.owner, "select id from public.fin_jobs where book_id = $1", [sb]))[0].id;
    const before = await rows(w.owner, "select count(*)::int as n from public.fin_invoices where book_id = $1", [w.book]);
    const inv = (await as<{ r: Row }>(w.owner, "select public.fin_invoice_save($1, $2) as r", [sj, { milestoneId: (await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [sj]))[0].id }])).r.invoiceId;
    const iss = (await as<{ r: Row }>(w.owner, "select public.fin_invoice_issue($1) as r", [inv])).r;
    expect(iss.number).toBe("SBX-INV-0001");
    const pay = (await as<{ r: Row }>(w.owner, "select public.fin_payment_record($1, $2) as r", [sb, { jobId: sj, method: "check", amount: "50.00", allocations: [{ invoiceId: inv, amount: "50.00" }] }])).r;
    expect(pay.number).toBe("SBX-PMT-0001");
    expect(await rows(w.owner, "select count(*)::int as n from public.fin_invoices where book_id = $1", [w.book])).toEqual(before);
    // The real book's next invoice number is unaffected.
    const real = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "More", quantity: "1", unitPrice: "10" }] }])).r.invoiceId;
    expect((await as<{ r: Row }>(w.bk, "select public.fin_invoice_issue($1) as r", [real])).r.number).toBe("INV-0002");
  });

  it("no email from a sandbox; no seats or project settings; jobs open only in the real book", async () => {
    const inv = (await rows(w.owner, "select id from public.fin_invoices where book_id = $1 and status = 'issued' limit 1", [sb]))[0].id;
    expect(await fails(as(w.owner, "select public.fin_email_draft_save($1, $2)", [sb, {
      templateKind: "progress", tone: "friendly", invoiceId: inv, toEmail: "pat@example.test", toName: "Pat", subject: "Invoice", body: "Hi", fieldsHash: h("s"), idempotencyKey: "sbx-mail-1" }]))).toBe("sandbox_no_email");
    expect(await fails(as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [sb, w.pm]))).toMatch(/solo_book|sandbox_setting/);
    expect(await fails(pool.query("insert into public.fin_seats (book_id, user_id, fin_role) values ($1, $2, 'bookkeeper')", [sb, w.pm]))).toBe("sandbox_setting");
    // A newly won bid: opening its job puts it in the real book; then it can be copied into the sandbox.
    const est2 = await wonBid(pool, w.owner, w.company, { title: "Gutters", total: "3000.00" });
    expect(await fails(as(w.owner, "select public.fin_sandbox_copy_job($1, $2)", [sb, est2.id]))).toBe("sandbox_needs_real_job");
    const j2 = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [est2.id, est2.v1])).r;
    expect((await pool.query("select book_id from public.fin_jobs where id = $1", [j2.jobId])).rows[0].book_id).toBe(w.book);
    const c = (await as<{ r: Row }>(w.owner, "select public.fin_sandbox_copy_job($1, $2) as r", [sb, est2.id])).r;
    expect((await as<{ r: Row }>(w.owner, "select public.fin_sandbox_copy_job($1, $2) as r", [sb, est2.id])).r.jobId).toBe(c.jobId);   // idempotent
    expect(await fails(as(w.owner, "select public.fin_sandbox_copy_job($1, $2)", [w.book, est2.id]))).toBe("not_sandbox");
    // Second real job for the same bid is still impossible.
    expect(await fails(pool.query("insert into public.fin_jobs (book_id, estimate_id, job_number, name) values ($1, $2, 'JOB-9', 'x')", [w.book, est2.id]))).toMatch(/duplicate key/);
  });

  it("an approved change order reaches the real job and the sandbox copy; settling one leaves the other open", async () => {
    const co = await changeOrder(pool, est, w.owner, w.company, 1, "-500.00", "signed");
    const cc = await pool.query("select book_id from public.fin_contract_changes where change_order_id = $1 and kind = 'change_order' order by book_id", [co]);
    expect(cc.rows.map((r) => r.book_id).sort()).toEqual([w.book, sb].sort());
    const sj = (await pool.query("select id from public.fin_jobs where book_id = $1 and estimate_id = $2", [sb, est.id])).rows[0].id;
    await as(w.owner, "select public.fin_change_order_credit($1, $2)", [sj, { changeOrderId: co }]);
    const cm = (await as<{ r: Row }>(w.bk, "select public.fin_change_order_credit($1, $2) as r", [job, { changeOrderId: co }])).r;
    expect(cm.number).toBe("CM-0001");
  });

  it("start over archives the old sandbox (read-only, kept) and makes a fresh one", async () => {
    await as(w.bk, "select public.fin_sandbox_enter($1)", [w.book]);
    expect(await fails(as(w.bk, "select public.fin_sandbox_reset($1)", [w.book]))).toBe("forbidden");
    const r = (await as<{ r: Row }>(w.owner, "select public.fin_sandbox_reset($1) as r", [w.book])).r;
    expect(r.created).toBe(true);
    expect(r.sandboxBookId).not.toBe(sb);
    expect(await myBook(w.owner)).toBe(r.sandboxBookId);
    expect(await myBook(w.bk)).toBe(w.book);                 // others drop back to the real books
    expect((await pool.query("select sandbox_archived_at is not null as a from public.fin_books where id = $1", [sb])).rows[0].a).toBe(true);
    expect((await pool.query("select count(*)::int as n from public.fin_invoices where book_id = $1", [sb])).rows[0].n).toBe(1);   // kept
    const old = (await rows(w.owner, "select id from public.fin_jobs where book_id = $1 limit 1", [sb]))[0].id;
    expect(await fails(as(w.owner, "select public.fin_invoice_save($1, $2)", [old, { kind: "custom", lines: [{ description: "x", quantity: "1", unitPrice: "1" }] }]))).toMatch(/forbidden|read_only/);
    expect(await fails(pool.query("update public.fin_books set sandbox_of = null where id = $1", [sb]))).toMatch(/record_immutable|fin_books_scope/);
    await as(w.owner, "select public.fin_sandbox_leave()");
  });

  it("rollback refuses while a sandbox holds records; on a clean database it rolls back and re-applies", async () => {
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));   // newest first: timesheet labor reads fin_books / pm_time_entries
    await expect(pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"))).rejects.toThrow(/sandbox_data_exists/);
    const fresh = await freshDb("byb_test_fin_sandbox_rb");
    try {
      const w2 = await setupWorld(fresh.pool);
      const as2 = asFn(fresh.pool);
      // An empty sandbox (no jobs) is removed by the rollback.
      const e = await wonBid(fresh.pool, w2.owner, w2.company, { title: "Fence" });
      await as2(w2.owner, "select public.fin_sandbox_enter($1)", [w2.book]);
      await fresh.pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
      await fresh.pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
      await fresh.pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
      await fresh.pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));   // newest first
      await fresh.pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"));
      expect((await fresh.pool.query("select to_regprocedure('public.fin_sandbox_enter(uuid)') as f")).rows[0].f).toBeNull();
      expect((await fresh.pool.query("select count(*)::int as n from public.fin_books where name like 'Sandbox:%'")).rows[0].n).toBe(0);
      expect((await as2<{ b: string }>(w2.owner, "select public.fin_my_book() as b")).b).toBe(w2.book);
      const up = readFileSync("supabase/migrations/20261130201000_fin_sandbox.sql", "utf8");
      await fresh.pool.query(up); await fresh.pool.query(up);
      await as2(w2.owner, "select public.fin_job_open($1, $2)", [e.id, e.v1]);
      expect((await as2<{ r: Row }>(w2.owner, "select public.fin_sandbox_enter($1) as r", [w2.book])).r.jobsCopied).toBe(1);
    } finally { await fresh.drop(); }
  }, 120_000);
});
