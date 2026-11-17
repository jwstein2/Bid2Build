/**
 * Invoice send states + scope-removal credits (20261130101000):
 *   - "Mark as sent" for invoices sent outside Built2Bid; one live mark; undo with a reason; blocks delete-as-mistake
 *   - a scope-removal change order is settled once: by a credit memo linked to it, or a remaining-payment amendment
 *   - alerts: credited change orders stop "affects billing"; credits count against "billed over contract"
 *   - permissions; rollback / re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, changeOrder, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("invoice send states and scope-removal credits (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let est: { id: string; v1: string };
  let ms: Row[];
  const custom = async (amount = "100.00") => {
    const id = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ description: "Extra work", quantity: "1", unitPrice: amount }] }])).r.invoiceId as string;
    const r = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_issue($1) as r", [id])).r;
    return { id, number: r.number as string };
  };
  const alerts = async () => {
    await as(w.bk, "select public.fin_alerts_refresh($1)", [w.book]);
    return (await pool.query("select kind, details from public.fin_alerts where job_id = $1 and status = 'open'", [job])).rows as Row[];
  };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_send_scope"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    est = await wonBid(pool, w.owner, w.company, { title: "Siding", total: "10000.00" });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    ms = await rows(w.owner, "select id, amount from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("marks an invoice as sent once, undoes with a reason, and a live mark blocks delete-as-mistake", async () => {
    const inv = await custom("75.00");
    expect(await fails(as(w.rep, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, { method: "own_email" }]))).toBe("forbidden");
    expect(await fails(as(w.bk, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, { method: "pigeon" }]))).toBe("bad_method");
    await as(w.bk, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, { method: "printed", note: "Handed to Pat" }]);
    expect(await fails(as(w.bk, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, {}]))).toBe("already_marked_sent");
    // Visible to the job's viewers, written only through the functions.
    expect((await rows(w.bk, "select method from public.fin_invoice_sends where invoice_id = $1", [inv.id]))[0].method).toBe("printed");
    expect(await fails(as(w.bk, "update public.fin_invoice_sends set method = 'other' where invoice_id = $1", [inv.id]))).toMatch(/permission denied/);
    expect(await fails(pool.query("delete from public.fin_invoice_sends where invoice_id = $1", [inv.id]))).toBe("record_immutable");
    // Delete-as-mistake refuses while the mark is live.
    expect(await fails(as(w.bk, "select public.fin_invoice_delete_mistake($1, 'oops')", [inv.id]))).toBe("already_sent");
    expect(await fails(as(w.bk, "select public.fin_invoice_unmark_sent($1, ' ')", [inv.id]))).toBe("reason_required");
    await as(w.bk, "select public.fin_invoice_unmark_sent($1, 'Clicked the wrong invoice')", [inv.id]);
    expect(await fails(as(w.bk, "select public.fin_invoice_unmark_sent($1, 'again')", [inv.id]))).toBe("not_marked_sent");
    // Once undone it can be marked again, and (undone marks go with it) deleted as a mistake.
    await as(w.bk, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, { method: "own_email" }]);
    await as(w.bk, "select public.fin_invoice_unmark_sent($1, 'Not sent after all')", [inv.id]);
    expect((await as<{ r: Row }>(w.bk, "select public.fin_invoice_delete_mistake($1, 'Entered twice') as r", [inv.id])).r.deleted).toBe(true);
    expect((await pool.query("select 1 from public.fin_invoice_sends where invoice_id = $1", [inv.id])).rowCount).toBe(0);
    const audit = (await pool.query("select action from public.fin_audit_log where entity_id = $1 order by created_at", [inv.id])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["invoice.marked_sent", "invoice.unmarked_sent", "invoice.deleted"]));
  });

  it("credits a scope-removal change order once and clears its alert; the original contract is untouched", async () => {
    const before = (await pool.query("select total from public.fin_contract_snapshots where job_id = $1", [job])).rows[0].total;
    const co = await changeOrder(pool, est, w.owner, w.company, 1, "-2000.00", "signed");
    const contract = (await rows(w.bk, "select current_contract from public.fin_job_contract_v where job_id = $1", [job]))[0];
    expect(Number(contract.current_contract)).toBe(8000);
    expect((await alerts()).map((a) => a.kind)).toContain("change_order_affects_billing");
    expect(await fails(as(w.rep, "select public.fin_change_order_credit($1, $2)", [job, { changeOrderId: co }]))).toBe("forbidden");
    const plus = await changeOrder(pool, est, w.owner, w.company, 2, "500.00", "approved");
    expect(await fails(as(w.bk, "select public.fin_change_order_credit($1, $2)", [job, { changeOrderId: plus }]))).toBe("not_a_reduction");
    const draft = await changeOrder(pool, est, w.owner, w.company, 3, "-100.00", "sent");
    expect(await fails(as(w.bk, "select public.fin_change_order_credit($1, $2)", [job, { changeOrderId: draft }]))).toBe("not_approved");
    const r = (await as<{ r: Row }>(w.bk, "select public.fin_change_order_credit($1, $2, 'co-credit-1') as r", [job, { changeOrderId: co }])).r;
    expect(r.available).toBe("2000.00");
    // Idempotent retry returns the same credit; a second settlement is refused every way.
    expect((await as<{ r: Row }>(w.bk, "select public.fin_change_order_credit($1, $2, 'co-credit-1') as r", [job, { changeOrderId: co }])).r.creditMemoId).toBe(r.creditMemoId);
    expect(await fails(as(w.bk, "select public.fin_change_order_credit($1, $2)", [job, { changeOrderId: co }]))).toBe("already_billed_plan");
    expect(await fails(as(w.bk, "select public.fin_milestone_amendment_request($1, $2)", [ms[2].id, { changeOrderId: co, delta: "-2000.00", reason: "x" }]))).toBe("already_billed_plan");
    const memo = (await pool.query("select amount, change_order_id, reason from public.fin_credit_memos where id = $1", [r.creditMemoId])).rows[0];
    expect(memo).toMatchObject({ amount: "2000.00", change_order_id: co });
    expect(memo.reason).toMatch(/Change order #1/);
    expect((await alerts()).filter((a) => a.kind === "change_order_affects_billing" && a.details.changeOrderId === co)).toHaveLength(0);
    expect((await pool.query("select total from public.fin_contract_snapshots where job_id = $1", [job])).rows[0].total).toBe(before);
    // Voiding the credit makes the change order open again.
    await as(w.bk, "select public.fin_credit_memo_void($1, 'wrong amount')", [r.creditMemoId]);
    expect((await alerts()).map((a) => a.details.changeOrderId)).toContain(co);
    // Settled the other way: take it off a remaining payment instead.
    const am = (await as<{ a: string }>(w.bk, "select public.fin_milestone_amendment_request($1, $2) as a", [ms[2].id, { changeOrderId: co, delta: "-2000.00", reason: "CO #1 scope removed" }])).a;
    await as(w.owner, "select public.fin_milestone_amendment_decide($1, true)", [am]);
    expect(await fails(as(w.bk, "select public.fin_change_order_credit($1, $2)", [job, { changeOrderId: co }]))).toBe("already_billed_plan");
    expect((await alerts()).map((a) => a.details.changeOrderId)).not.toContain(co);
  });

  it("credits count against billed over contract", async () => {
    // Bill the whole (now reduced) contract plus extra, then credit the extra.
    const over = await custom("9000.00");
    expect((await alerts()).map((a) => a.kind)).toContain("billed_over_contract");
    const cm = (await as<{ r: Row }>(w.bk, "select public.fin_credit_memo_issue($1, $2) as r", [w.book, { jobId: job, invoiceId: over.id, amount: "9000.00", reason: "Billed in error" }])).r;
    expect(cm.number).toBeTruthy();
    expect((await alerts()).map((a) => a.kind)).not.toContain("billed_over_contract");
  });

  it("rollback restores the old rules and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130101000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.fin_invoice_sends') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select to_regprocedure('public.fin_change_order_credit(uuid, jsonb, text)') as f")).rows[0].f).toBeNull();
    await as(w.bk, "select public.fin_alerts_refresh($1)", [w.book]);
    const up = readFileSync("supabase/migrations/20261130101000_fin_send_states_scope_credits.sql", "utf8");
    await pool.query(up); await pool.query(up);
    const inv = await custom("10.00");
    await as(w.bk, "select public.fin_invoice_mark_sent($1, $2)", [inv.id, { method: "text" }]);
    expect(await fails(as(w.bk, "select public.fin_invoice_delete_mistake($1, 'x')", [inv.id]))).toBe("already_sent");
  });
});
