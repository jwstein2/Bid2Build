/**
 * V6.3 Accountant Mode (20261213001000), against the real SQL:
 *   - bank statement import: append-only lines, re-import skips lines already on file, identical lines in one file both import
 *   - bank lines and import batches can never be edited or deleted (not even by the owner / service role)
 *   - matching: same amount + direction + active record only; one match per line and per record; undo needs a reason
 *   - create an expense from a withdrawal (pending, idempotent) and match it
 *   - reconciliation: differences need a note; a confirmed period locks its lines; reopen latest only, with a reason
 *   - classification: project / vendor / scope section fill once, then already_set; audit keeps previous + new
 *   - export log needs export_financials (works on a read-only book); audit list redacts sensitive keys
 *   - roles: sales rep / project manager can't see bank data or reconcile; another company can't touch it
 *   - rollback + re-apply
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

d("Accountant Mode: bank, reconciliation, classification, exports, audit (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let acct: string;
  let payment: string;
  let est: { id: string };
  const rowsIn = [
    { date: "2026-11-02", description: "Deposit Pat Rivera", amount: "12000.00", ref: "D1" },
    { date: "2026-11-03", description: "Lumber Yard", amount: "-600.00", checkNumber: "1001" },
    { date: "2026-11-04", description: "Gas station", amount: "-45.10" },
    { date: "2026-11-04", description: "Gas station", amount: "-45.10" },   // a real second identical charge
    { date: "2026-11-05", description: "Transfer to savings", amount: "-1000.00" },
  ];
  const imp = (u: string, rs = rowsIn, extra: Row = {}) =>
    as<{ r: Row }>(u, "select public.fin_bank_import($1, $2) as r", [acct, { fileName: "nov.csv", fileHash: "a".repeat(64), rows: rs, ...extra }]).then((x) => x.r);
  const line = async (descr: string, n = 0) =>
    (await pool.query("select id from public.fin_bank_transactions where account_id = $1 and description = $2 order by fingerprint", [acct, descr])).rows[n].id as string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_accounting"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    est = await wonBid(pool, w.owner, w.company);
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, (est as unknown as { v1: string }).v1])).r.jobId;
    payment = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "check", amount: "12000.00" }])).r.paymentId;
    acct = (await as<{ v: string }>(w.bk, "select public.fin_bank_account_save($1, $2) as v", [w.book, { name: "Operating", kind: "checking", last4: "4321", openingBalance: "500.00", openingDate: "2026-11-01" }])).v;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("imports statement lines once; identical lines in one file both import; re-import skips", async () => {
    expect(await imp(w.bk, rowsIn, { openingBalance: "500.00", endingBalance: "10809.80" })).toMatchObject({ rows: 5, inserted: 5, skipped: 0, balanced: true });
    expect(await imp(w.bk)).toMatchObject({ rows: 5, inserted: 0, skipped: 5, balanced: null });
    const more = [...rowsIn, { date: "2026-11-06", description: "Bank fee", amount: "-12.00" }];
    expect(await imp(w.bk, more)).toMatchObject({ inserted: 1, skipped: 5 });
    const imports = await rows(w.bk, "select inserted_count, skipped_count from public.fin_bank_imports where account_id = $1 order by imported_at", [acct]);
    expect(imports.map((x) => [x.inserted_count, x.skipped_count])).toEqual([[5, 0], [0, 5], [1, 5]]);
    expect(Number((await as<{ b: string }>(w.bk, "select public.fin_bank_balance($1, '2026-11-30') as b", [acct])).b)).toBeCloseTo(500 + 12000 - 600 - 90.2 - 1000 - 12, 2);
    expect(await fails(imp(w.bk, [{ date: "2026-11-07", description: "x", amount: "1.005" }]))).toBe("bad_rows");
  });

  it("bank lines and import batches can never change or be deleted", async () => {
    const id = await line("Bank fee");
    expect(await fails(pool.query("update public.fin_bank_transactions set amount = -1 where id = $1", [id]))).toMatch(/immutable/);
    expect(await fails(pool.query("delete from public.fin_bank_transactions where id = $1", [id]))).toMatch(/immutable/);
    expect(await fails(pool.query("delete from public.fin_bank_imports where account_id = $1", [acct]))).toMatch(/immutable/);
    expect(await fails(as(w.owner, "update public.fin_bank_transactions set description = 'x' where id = $1", [id]))).toMatch(/permission denied/);
    // Opening balance is frozen once lines exist.
    await as(w.bk, "select public.fin_bank_account_save($1, $2)", [w.book, { id: acct, name: "Operating 4321", openingBalance: "999.00" }]);
    expect((await pool.query("select name, opening_balance from public.fin_bank_accounts where id = $1", [acct])).rows[0]).toMatchObject({ name: "Operating 4321", opening_balance: "500.00" });
  });

  it("matches only same amount, direction and active records; one match per line/record; undo needs a reason", async () => {
    const dep = await line("Deposit Pat Rivera");
    const lumber = await line("Lumber Yard");
    expect(await fails(as(w.bk, "select public.fin_bank_match($1, $2)", [lumber, { targetType: "payment", targetId: payment }]))).toBe("amount_mismatch");
    const m = (await as<{ v: string }>(w.bk, "select public.fin_bank_match($1, $2) as v", [dep, { targetType: "payment", targetId: payment }])).v;
    expect(await fails(as(w.bk, "select public.fin_bank_match($1, $2)", [dep, { targetType: "excluded", excludeReason: "other" }]))).toBe("already_matched");
    expect(await fails(as(w.bk, "select public.fin_bank_unmatch($1, '')", [m]))).toBe("reason_required");
    await as(w.bk, "select public.fin_bank_unmatch($1, 'Wrong deposit')", [m]);
    expect(await fails(as(w.bk, "select public.fin_bank_unmatch($1, 'again')", [m]))).toBe("bad_state");
    await as(w.bk, "select public.fin_bank_match($1, $2)", [dep, { targetType: "payment", targetId: payment }]);
    expect(await fails(as(w.bk, "select public.fin_bank_match($1, $2)", [await line("Transfer to savings"), { targetType: "excluded" }]))).toBe("reason_required");
    await as(w.bk, "select public.fin_bank_match($1, $2)", [await line("Transfer to savings"), { targetType: "excluded", excludeReason: "transfer" }]);
    // A voided payment can't be matched.
    const p2 = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "cash", amount: "45.10" }])).r.paymentId;
    await as(w.owner, "select public.fin_payment_void($1, 'entered twice')", [p2]);
    expect(await fails(as(w.bk, "select public.fin_bank_match($1, $2)", [await line("Gas station"), { targetType: "payment", targetId: p2 }]))).toBe("bad_state");
    const history = await rows(w.bk, "select status from public.fin_bank_matches where bank_txn_id = $1 order by matched_at", [dep]);
    expect(history.map((x) => x.status)).toEqual(["undone", "active"]);
  });

  it("creates a pending expense from a withdrawal (idempotent) and matches it", async () => {
    const gas = await line("Gas station", 0);
    const r = (await as<{ r: Row }>(w.bk, "select public.fin_bank_create_expense($1, $2) as r", [gas, { jobId: job }])).r;
    const x = (await pool.query("select amount, status, job_id, spent_on, method from public.fin_expenses where id = $1", [r.expenseId])).rows[0];
    expect(x).toMatchObject({ amount: "45.10", status: "pending", job_id: job, method: "ach" });
    expect(await fails(as(w.bk, "select public.fin_bank_create_expense($1, '{}')", [gas]))).toBe("already_matched");
    expect(await fails(as(w.bk, "select public.fin_bank_create_expense($1, '{}')", [await line("Deposit Pat Rivera")]))).toBe("not_withdrawal");
    const lumber = await line("Lumber Yard");
    const ck = (await as<{ r: Row }>(w.bk, "select public.fin_bank_create_expense($1, '{}') as r", [lumber])).r;
    expect((await pool.query("select method from public.fin_expenses where id = $1", [ck.expenseId])).rows[0].method).toBe("check");
  });

  it("reconciles: differences need a note; confirmed period locks lines; reopen latest only with a reason", async () => {
    // Unmatched: second gas charge + bank fee.
    expect(await fails(as(w.bk, "select public.fin_bank_reconcile($1, $2)", [acct, { periodEnd: "2026-11-30", statementBalance: "10797.80" }]))).toBe("differences_need_note");
    await as(w.bk, "select public.fin_bank_match($1, $2)", [await line("Gas station", 1), { targetType: "excluded", excludeReason: "duplicate", note: "bank shows twice" }]);
    await as(w.bk, "select public.fin_bank_match($1, $2)", [await line("Bank fee"), { targetType: "excluded", excludeReason: "other", note: "fee" }]);
    const ok = (await as<{ r: Row }>(w.bk, "select public.fin_bank_reconcile($1, $2) as r", [acct, { periodEnd: "2026-11-30", statementBalance: "10797.80" }])).r;
    expect(ok).toMatchObject({ status: "reconciled", difference: "0.00", unmatched: 0 });
    expect(await fails(as(w.bk, "select public.fin_bank_reconcile($1, $2)", [acct, { periodEnd: "2026-11-15", statementBalance: "1" }]))).toBe("period_already_confirmed");
    const m = (await pool.query("select id from public.fin_bank_matches where bank_txn_id = $1 and status = 'active'", [await line("Bank fee")])).rows[0].id;
    expect(await fails(as(w.bk, "select public.fin_bank_unmatch($1, 'oops')", [m]))).toBe("period_locked");
    expect(await fails(as(w.bk, "select public.fin_bank_reconcile_reopen($1, '')", [ok.id]))).toBe("reason_required");
    await as(w.bk, "select public.fin_bank_reconcile_reopen($1, 'Fee was a refund')", [ok.id]);
    await as(w.bk, "select public.fin_bank_unmatch($1, 'oops')", [m]);
    const withDiff = (await as<{ r: Row }>(w.bk, "select public.fin_bank_reconcile($1, $2) as r", [acct, { periodEnd: "2026-11-30", statementBalance: "10800.00", note: "Fee disputed with bank" }])).r;
    expect(withDiff).toMatchObject({ status: "confirmed_with_differences", difference: "2.20", unmatched: 1 });
    expect(await fails(pool.query("delete from public.fin_reconciliations where id = $1", [withDiff.id]))).toMatch(/immutable/);
  });

  it("classification fills project, vendor and scope section once; audit keeps previous + new", async () => {
    const e = (await as<{ r: Row }>(w.bk, "select public.fin_expense_record($1, $2) as r", [w.book, { amount: "80.00", description: "Screws" }])).r.expenseId;
    const vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { name: "Hardware Co", kind: "supplier" }])).v;
    await pool.query("insert into public.project_scope_sections (estimate_id, user_id, source_group_id, title) values ($1, $2, gen_random_uuid(), 'Framing')", [est.id, w.owner]);
    const sec = (await pool.query("select id from public.project_scope_sections where estimate_id = $1 limit 1", [est.id])).rows[0].id as string;
    await as(w.bk, "select public.fin_cost_fill('expense', $1, $2)", [e, { jobId: job, vendorId: vendor, scopeSectionId: sec }]);
    const x = (await pool.query("select job_id, vendor_id, scope_section_id from public.fin_expenses where id = $1", [e])).rows[0];
    expect(x).toMatchObject({ job_id: job, vendor_id: vendor, scope_section_id: sec });
    expect(await fails(as(w.bk, "select public.fin_cost_fill('expense', $1, $2)", [e, { jobId: job }]))).toBe("already_set");
    expect(await fails(pool.query("update public.fin_expenses set job_id = null where id = $1", [e]))).toMatch(/immutable/);
    // Now a project cost with no code: it's in the review queue.
    expect((await pool.query("select count(*)::int as n from public.fin_review_items where entity_id = $1 and kind = 'uncoded_cost' and status = 'open'", [e])).rows[0].n).toBe(1);
    const a = (await pool.query("select details from public.fin_audit_log where entity_id = $1 and action = 'cost.filled'", [e])).rows[0].details;
    expect(a.previous).toMatchObject({ jobId: null, vendorId: null });
    expect(a.new).toMatchObject({ jobId: job, vendorId: vendor });
  });

  it("exports are authorized and audited; audit list redacts sensitive keys", async () => {
    await as(w.bk, "select public.fin_export_log($1, 'general_ledger', $2)", [w.book, { from: "2026-11-01" }]);
    expect(await fails(as(w.rep, "select public.fin_export_log($1, 'general_ledger')", [w.book]))).toBe("forbidden");
    expect(await fails(as(w.viewer, "select public.fin_export_log($1, 'general_ledger')", [w.book]))).toBe("forbidden");
    expect(await fails(as(w.bk, "select public.fin_export_log($1, 'DROP TABLE')", [w.book]))).toBe("bad_kind");
    await pool.query("insert into public.fin_audit_log (book_id, actor_id, action, entity_type, details) values ($1, $2, 'test.secret', 'book', $3)",
      [w.book, w.owner, { tin: "12-3456789", nested: { account_number: "999", ok: "yes" }, list: [{ token: "t" }] }]);
    const list = (await as<{ l: Row[] }>(w.bk, "select public.fin_audit_list($1, $2) as l", [w.book, { limit: 500 }])).l;
    expect(list.some((x) => x.action === "export.general_ledger" && x.actor_name)).toBe(true);
    const secret = list.find((x) => x.action === "test.secret");
    expect(secret?.details).toEqual({ tin: "[hidden]", nested: { account_number: "[hidden]", ok: "yes" }, list: [{ token: "[hidden]" }] });
    const filtered = (await as<{ l: Row[] }>(w.bk, "select public.fin_audit_list($1, $2) as l", [w.book, { action: "bank." }])).l;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((x) => String(x.action).startsWith("bank."))).toBe(true);
    expect(await fails(as(w.rep, "select public.fin_audit_list($1)", [w.book]))).toBe("forbidden");
  });

  it("roles: rep / PM / another company can't see bank data or reconcile", async () => {
    for (const u of [w.rep, w.pm, w.rival]) {
      expect(await rows(u, "select id from public.fin_bank_transactions")).toEqual([]);
      expect(await rows(u, "select id from public.fin_bank_accounts")).toEqual([]);
      expect(await fails(imp(u))).toMatch(/forbidden/);
      expect((await as<{ b: string | null }>(u, "select public.fin_bank_balance($1, '2026-11-30') as b", [acct])).b).toBeNull();
    }
    expect(await fails(as(w.viewer, "select public.fin_bank_account_save($1, $2)", [w.book, { name: "X" }]))).toBe("forbidden");
    expect((await rows(w.bk, "select id from public.fin_bank_transactions")).length).toBeGreaterThan(0);
    expect(await fails(as(w.rival, "select public.fin_bank_match($1, $2)", [await line("Bank fee"), { targetType: "excluded", excludeReason: "other" }]))).toMatch(/forbidden/);
  });

  it("rollback removes the accounting objects and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/tax-banking/rollback_20261226001000.sql", "utf8"));   // V6.9 tax + banking (newer)
    await pool.query(readFileSync("docs/financials/rollback_20261213001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.fin_bank_transactions') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select to_regprocedure('public.fin_audit_list(uuid, jsonb)') as f")).rows[0].f).toBeNull();
    await applyMigration(pool, "20261213001000_fin_accounting.sql");
    await applyMigration(pool, "20261213001000_fin_accounting.sql");
    expect((await pool.query("select to_regclass('public.fin_bank_transactions') as t")).rows[0].t).not.toBeNull();
  });
});
