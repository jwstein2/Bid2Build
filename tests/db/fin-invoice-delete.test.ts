/**
 * Deleting an issued invoice that was a mistake (20261130001000):
 *   - allowed only with no payments (even reversed), credits, deposit deductions, disputes or sent/queued emails
 *   - unsent email drafts go with it; a reason is required; the full invoice is kept in the audit log
 *   - the number is released only when nothing was numbered after it (numbering stays gapless)
 *   - every other path still refuses to delete an issued invoice; permissions; rollback / re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, h, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("delete a mistaken invoice (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let ms: Row[];
  const custom = async (amount = "100.00") => {
    const id = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "Extra work", quantity: "1", unitPrice: amount }] }])).r.invoiceId as string;
    const r = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_issue($1) as r", [id])).r;
    return { id, number: r.number as string };
  };
  const del = (id: string, reason: string | null = "Entered by mistake", u = w.bk) => as<{ r: Row }>(u, "select public.fin_invoice_delete_mistake($1, $2) as r", [id, reason]).then((x) => x.r);
  const exists = async (id: string) => (await pool.query("select 1 from public.fin_invoices where id = $1", [id])).rowCount === 1;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_invoice_delete"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    const est = await wonBid(pool, w.owner, w.company, { title: "Deck" });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    ms = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("deletes the latest issued invoice, releases its number, removes unsent drafts and keeps an audit copy", async () => {
    const depId = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: ms[0].id }])).r.invoiceId as string;
    await as(w.bk, "select public.fin_invoice_issue($1)", [depId]);
    const draftMsg = (await as<{ id: string }>(w.bk, "select public.fin_email_draft_save($1, $2) as id", [w.book, {
      templateKind: "deposit", tone: "friendly", invoiceId: depId, toEmail: "pat@example.test", toName: "Pat", subject: "Invoice", body: "Hi", fieldsHash: h("x"), idempotencyKey: "del-1" }])).id;
    expect(await fails(del(depId, "  "))).toBe("reason_required");
    expect(await fails(del(depId, "oops", w.rep))).toBe("forbidden");
    expect(await del(depId)).toEqual({ deleted: true, number: "INV-0001", numberReleased: true });
    expect(await exists(depId)).toBe(false);
    expect((await pool.query("select 1 from public.comm_messages where id = $1", [draftMsg])).rowCount).toBe(0);
    const audit = (await pool.query("select details from public.fin_audit_log where action = 'invoice.deleted' and entity_id = $1", [depId])).rows[0].details;
    expect(audit).toMatchObject({ number: "INV-0001", reason: "Entered by mistake", numberReleased: true, invoice: { status: "issued", milestone_id: ms[0].id } });
    expect(audit.invoice.lines.length).toBeGreaterThan(0);
    // The milestone is billable again and the number is reused.
    const again = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: ms[0].id }])).r.invoiceId as string;
    expect((await as<{ r: Row }>(w.bk, "select public.fin_invoice_issue($1) as r", [again])).r.number).toBe("INV-0001");
  });

  it("keeps the number retired when a later invoice exists (no reuse, gap explained in the audit log)", async () => {
    const a = await custom("50.00");
    await custom("60.00");
    expect(await del(a.id)).toEqual({ deleted: true, number: a.number, numberReleased: false });
    const next = await custom("70.00");
    expect(next.number).not.toBe(a.number);
  });

  it("refuses once anything depends on the invoice", async () => {
    // Payment applied, even after the payment is voided (allocation reversed).
    const paid = await custom("80.00");
    const pay = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { jobId: job, method: "check", amount: "80.00", allocations: [{ invoiceId: paid.id, amount: "80.00" }] }])).r;
    expect(await fails(del(paid.id))).toBe("invoice_has_payments");
    await as(w.bk, "select public.fin_payment_void($1, 'bounced')", [pay.paymentId]);
    expect(await fails(del(paid.id))).toBe("invoice_has_payments");
    // Credit issued against it.
    const cred = await custom("90.00");
    await as(w.bk, "select public.fin_credit_memo_issue($1, $2) as r", [w.book, { jobId: job, invoiceId: cred.id, amount: "10.00", reason: "Goodwill" }]);
    expect(await fails(del(cred.id))).toBe("has_credits");
    // An email that was queued (not just drafted).
    const mailed = await custom("95.00");
    const mid = (await as<{ id: string }>(w.bk, "select public.fin_email_draft_save($1, $2) as id", [w.book, {
      templateKind: "progress", tone: "friendly", invoiceId: mailed.id, toEmail: "pat@example.test", toName: "Pat", subject: "Invoice", body: "Hi", fieldsHash: h("y"), idempotencyKey: "del-2" }])).id;
    await as(w.bk, "select public.fin_email_queue($1, $2)", [mid, h("y")]);
    expect(await fails(del(mailed.id))).toBe("already_emailed");
    // Void invoices stay as they are.
    const v = await custom("20.00");
    await as(w.bk, "select public.fin_invoice_void($1, 'wrong')", [v.id]);
    expect(await fails(del(v.id))).toBe("record_immutable");
    for (const id of [paid.id, cred.id, mailed.id, v.id]) expect(await exists(id)).toBe(true);
  });

  it("no other path can delete an issued invoice", async () => {
    const x = await custom("30.00");
    expect(await fails(pool.query("delete from public.fin_invoices where id = $1", [x.id]))).toBe("record_immutable");
    expect(await fails(pool.query("delete from public.fin_invoice_lines where invoice_id = $1", [x.id]))).toBe("record_immutable");
    // Setting the flag for another invoice doesn't help.
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('b2b.fin_invoice_delete', gen_random_uuid()::text, true)");
      expect(await fails(c.query("delete from public.fin_invoices where id = $1", [x.id]))).toBe("record_immutable");
    } finally { await c.query("rollback"); c.release(); }
    expect(await fails(as(w.bk, "select public.fin_invoice_delete_blocker($1)", [x.id]))).toMatch(/permission denied/);
    // Another company can't touch it.
    expect(await fails(del(x.id, "nope", w.rival))).toMatch(/forbidden|not_found/);
    expect(await exists(x.id)).toBe(true);
  });

  it("rollback restores the old guards and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));   // newest first: timesheet labor reads fin_books / pm_time_entries
    await pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130101000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130001000.sql", "utf8"));
    expect((await pool.query("select to_regprocedure('public.fin_invoice_delete_mistake(uuid, text)') as f")).rows[0].f).toBeNull();
    const draft = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "x", quantity: "1", unitPrice: "5" }] }])).r.invoiceId;
    await as(w.bk, "select public.fin_invoice_delete_draft($1)", [draft]);   // drafts still delete
    const up = readFileSync("supabase/migrations/20261130001000_fin_invoice_delete_mistake.sql", "utf8");
    await pool.query(up); await pool.query(up);
    const y = await custom("12.00");
    expect((await del(y.id)).deleted).toBe(true);
  });
});
