/**
 * V6 P1-B corrections, against the real SQL (20261128001000):
 *   - Scenario B: a $450 expense entered twice is flagged as a possible duplicate, never auto-hidden
 *   - marking it a duplicate voids one copy (reason "Duplicate of EXP-x"), keeps the other, counts the cost once,
 *     closes the review items and keeps the audit trail; nothing is deleted
 *   - different amounts, vendors or dates further than 3 days apart are not flagged
 *   - permissions, cross-book ids, and the rollback / re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("V6 corrections: duplicate expenses (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let vendor: string;
  const expense = (p: Row, u = w.bk) => as<{ r: Row }>(u, "select public.fin_expense_record($1, $2) as r", [w.book, { jobId: job, ...p }]).then((r) => r.r as { expenseId: string; number: string });
  const dupItems = () => pool.query("select entity_id, status, details from public.fin_review_items where kind = 'duplicate_suspected' and book_id = $1 order by created_at", [w.book]).then((r) => r.rows);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_v6_corrections"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    const est = await wonBid(pool, w.owner, w.company, { title: "Roof replacement" });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { name: "Lumber Yard", kind: "supplier" }])).v;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  let first: { expenseId: string; number: string };
  let second: { expenseId: string; number: string };

  it("Scenario B: the same $450 entered twice is flagged for review, not hidden", async () => {
    first = await expense({ vendorId: vendor, amount: "450.00", spentOn: "2026-11-10", description: "Plywood" });
    second = await expense({ vendorId: vendor, amount: "450.00", spentOn: "2026-11-12", description: "Plywood (again)" });
    const items = await dupItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ entity_id: second.expenseId, status: "open", details: { duplicateOfId: first.expenseId, duplicateOf: first.number, amount: "450.00" } });
    // Both records still exist and are untouched until a person decides.
    expect((await rows(w.bk, "select status from public.fin_expenses where id = any($1) order by seq", [[first.expenseId, second.expenseId]])).map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  it("does not flag different amounts, vendors, payees or dates more than 3 days apart", async () => {
    await expense({ vendorId: vendor, amount: "451.00", spentOn: "2026-11-10", description: "Different amount" });
    await expense({ payee: "Hardware store", amount: "450.00", spentOn: "2026-11-10", description: "Different payee" });
    await expense({ vendorId: vendor, amount: "450.00", spentOn: "2026-11-20", description: "Eight days later" });
    expect(await dupItems()).toHaveLength(1);
    // Same payee typed with different case/spaces IS flagged.
    await expense({ payee: " hardware STORE ", amount: "450.00", spentOn: "2026-11-11", description: "Same store" });
    expect(await dupItems()).toHaveLength(2);
  });

  it("marking a duplicate voids one copy with a reason, keeps the other, and counts the cost once", async () => {
    for (const id of [first.expenseId, second.expenseId]) await as(w.owner, "select public.fin_expense_decide($1, 'approve')", [id]);
    const actual = async () => (await rows(w.owner, "select coalesce(sum(amount), 0)::text as t from public.fin_job_costs_v where job_id = $1 and description like 'Plywood%'", [job]))[0].t;
    expect(await actual()).toBe("900.00");
    expect(await fails(as(w.rep, "select public.fin_expense_mark_duplicate($1, $2)", [second.expenseId, first.expenseId]))).toBe("forbidden");
    expect(await fails(as(w.owner, "select public.fin_expense_mark_duplicate($1, $1)", [second.expenseId]))).toBe("same_record");
    await as(w.owner, "select public.fin_expense_mark_duplicate($1, $2)", [second.expenseId, first.expenseId]);
    expect(await actual()).toBe("450.00");
    const [kept, voided] = await rows(w.owner, "select status, decision_note from public.fin_expenses where id = any($1) order by seq", [[first.expenseId, second.expenseId]]);
    expect(kept.status).toBe("approved");
    expect(voided).toMatchObject({ status: "void", decision_note: `Duplicate of ${first.number}` });
    expect((await dupItems())[0].status).toBe("resolved");
    const audit = await pool.query("select action, details from public.fin_audit_log where entity_id = $1 order by created_at", [second.expenseId]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["expense.recorded", "expense.approve", "expense.void", "expense.duplicate"]));
    // You can't keep a voided record.
    const third = await expense({ vendorId: vendor, amount: "75.00", spentOn: "2026-11-10", description: "Nails" });
    expect(await fails(as(w.owner, "select public.fin_expense_mark_duplicate($1, $2)", [third.expenseId, second.expenseId]))).toBe("keep_is_void");
  });

  it("refuses ids from another company's book", async () => {
    const rivalEst = await wonBid(pool, w.rival, w.rivalCompany, { title: "Rival job" });
    const rivalJob = (await as<{ r: Row }>(w.rival, "select public.fin_job_open($1, $2) as r", [rivalEst.id, rivalEst.v1])).r.jobId;
    const theirs = (await as<{ r: Row }>(w.rival, "select public.fin_expense_record($1, $2) as r", [w.rivalBook, { jobId: rivalJob, amount: "450.00", description: "Theirs" }])).r.expenseId;
    expect(await fails(as(w.owner, "select public.fin_expense_mark_duplicate($1, $2)", [theirs, first.expenseId]))).toBe("not_found");
    // A rival's identical expense never flags anything in our book.
    expect(await dupItems()).toHaveLength(2);
  });

  it("the rollback removes the trigger and function, keeps records, and the migration re-applies", async () => {
    const before = (await pool.query("select count(*)::int as n from public.fin_expenses")).rows[0].n;
    await pool.query(readFileSync("docs/financials/rollback_20261128001000.sql", "utf8"));
    expect((await pool.query("select to_regprocedure('public.fin_expense_mark_duplicate(uuid, uuid)') as f")).rows[0].f).toBeNull();
    expect((await pool.query("select count(*)::int as n from public.fin_expenses")).rows[0].n).toBe(before);
    const up = readFileSync("supabase/migrations/20261128001000_fin_v6_corrections.sql", "utf8");
    await pool.query(up);
    await pool.query(up);
    expect((await pool.query("select count(*)::int as n from pg_trigger where tgname = 'fin_expense_duplicate_check'")).rows[0].n).toBe(1);
  });
});
