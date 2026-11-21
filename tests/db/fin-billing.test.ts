/**
 * Financial Command Center Phase 1, receivables + V4.5 milestones + V4.4 emails, against the real SQL:
 *   - contract = original + approved/signed change orders - deductions; pending change orders excluded
 *   - the signed payment schedule is frozen as milestones (Σ = contract), derived milestone state,
 *     discrepancy flags, exception reasons and the one-active-invoice-per-milestone guard
 *   - partial / over payments, one payment across invoices, credit memos, refunds and voids, derived
 *     balances, row-lock + commit-time backstops, idempotency keys, immutability of issued rows
 *   - deterministic billing alerts that never block anything
 *   - financial email drafts on the Customer Hub module: stale detection, reminder suppression, RLS
 *   - the rollbacks remove everything and the migrations re-apply
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb, type Row } from "./harness";
import { asFn, changeOrder, fails, h, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("Financial Command Center: receivables, milestones and emails (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let est: { id: string; v1: string; customer: string | null };
  let job: string;
  let ms: Row[];
  let depositInv: string;

  const bal = async (inv: string) => (await rows(w.owner, "select * from public.fin_invoice_balances_v where invoice_id = $1", [inv]))[0];
  const payBal = async (p: string) => (await rows(w.owner, "select * from public.fin_payment_balances_v where payment_id = $1", [p]))[0];
  const contract = async () => (await rows(w.owner, "select * from public.fin_job_contract_v where job_id = $1", [job]))[0];
  const msState = async () => (await rows(w.owner, "select seq, state, current_amount, invoiced, paid, overdue from public.fin_milestone_status_v where job_id = $1 order by seq", [job]));
  const save = (u: string, p: Row, key: string | null = null) => as<{ r: Row }>(u, "select public.fin_invoice_save($1, $2, $3) as r", [job, p, key]).then((r) => r.r);
  const issue = (u: string, inv: string, reason: string | null = null) => as<{ r: Row }>(u, "select public.fin_invoice_issue($1, null, $2) as r", [inv, reason]).then((r) => r.r);
  const pay = (u: string, p: Row, key: string | null = null) => as<{ r: Row }>(u, "select public.fin_payment_record($1, $2, $3) as r", [w.book, p, key]).then((r) => r.r);
  const alerts = async () => (await rows(w.owner, "select kind, status, dedupe_key from public.fin_alerts where book_id = $1 order by created_at, kind", [w.book]));
  const openAlerts = async () => (await alerts()).filter((a) => a.status === "open" || a.status === "acknowledged").map((a) => a.kind).sort();
  const refresh = () => as<{ r: Row }>(w.bk, "select public.fin_alerts_refresh($1) as r", [w.book]).then((r) => r.r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_billing"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    est = await wonBid(pool, w.owner, w.company);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("opening a job freezes the contract and the signed payment schedule (Σ milestones = contract)", async () => {
    const unaccepted = await wonBid(pool, w.owner, w.company, { title: "Not yet", won: false });
    expect(await fails(as(w.bk, "select public.fin_job_open($1, $2)", [unaccepted.id, unaccepted.v1]))).toBe("not_accepted");
    expect(await fails(as(w.bk, "select public.fin_job_open($1)", [est.id]))).toBe("version_required");
    // A change order approved before the job opened is backfilled; a draft one stays pending.
    await changeOrder(pool, est, w.owner, w.company, 1, "1000.00", "approved");
    await changeOrder(pool, est, w.owner, w.company, 2, "500.00", "draft");
    const r = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r;
    expect(r).toMatchObject({ jobNumber: "JOB-0001", created: true });
    job = r.jobId;
    expect((await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r).toMatchObject({ jobId: job, created: false });
    const snap = (await rows(w.owner, "select subtotal, tax, rounding, total, source from public.fin_contract_snapshots where job_id = $1", [job]))[0];
    expect(snap).toEqual({ subtotal: "37000.00", tax: "3000.00", rounding: "0.00", total: "40000.00", source: "manual_confirmed" });
    ms = await rows(w.owner, "select * from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    expect(ms.map((m) => [m.description, m.amount, m.trigger_kind, m.is_deposit])).toEqual([
      ["Deposit", "12000.00", "agreement_signed", true],
      ["Framing", "8000.00", "phase_completed_verified", false],
      ["Completion", "20000.00", "final_completion_confirmed", false],
    ]);
    expect(await fails(pool.query("update public.fin_payment_milestones set amount = 1 where id = $1", [ms[0].id]))).toBe("record_immutable");
    expect(await fails(pool.query("update public.fin_contract_snapshots set total = 1 where job_id = $1", [job]))).toBe("record_immutable");
    // Deleting the bid is blocked while financial records point at it.
    expect(await fails(pool.query("delete from public.estimates where id = $1", [est.id]))).toMatch(/foreign key|violates/);
  });

  it("a schedule whose percents don't add up gets a Balance due milestone; Σ = contract exactly", async () => {
    const b = await wonBid(pool, w.owner, w.company, { title: "Odd schedule", total: "1000.01", schedule: [{ label: "Deposit", percent: "33.3333" }, { label: "Middle", percent: "33.3333" }] });
    const j = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [b.id, b.v1])).r.jobId;
    const m = await rows(w.owner, "select description, amount from public.fin_payment_milestones where job_id = $1 order by seq", [j]);
    expect(m).toEqual([{ description: "Deposit", amount: "333.34" }, { description: "Middle", amount: "333.34" }, { description: "Balance due", amount: "333.33" }]);
    expect(m.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0)).toBe(100001);
  });

  it("contract = original + approved COs - deductions; pending change orders are excluded", async () => {
    expect(await contract()).toMatchObject({ original_contract: "40000.00", approved_changes: "1000.00", current_contract: "41000.00", pending_changes: "500.00" });
    const signed = await changeOrder(pool, est, w.owner, w.company, 3, "250.00", "sent");
    await pool.query("update public.change_orders set status = 'signed', approval_method = 'signature', approved_version = 1, decided_at = now() where id = $1", [signed]);
    await pool.query("update public.change_orders set title = 'renamed' where id = $1", [signed]);   // no second contract change
    await as(w.bk, "select public.fin_contract_deduction_add($1, '300.00', 'Customer supplies fixtures', 'ded-key-0001')", [job]);
    expect((await as<{ r: Row }>(w.bk, "select public.fin_contract_deduction_add($1, '300.00', 'Customer supplies fixtures', 'ded-key-0001') as r", [job])).r.replayed).toBe(true);
    expect(await contract()).toMatchObject({ approved_changes: "1250.00", deductions: "-300.00", current_contract: "40950.00", pending_changes: "500.00" });
    expect((await pool.query("select count(*)::int as n from public.fin_contract_changes where change_order_id = $1", [signed])).rows[0].n).toBe(1);
  });

  it("deposit invoice from the milestone: no discrepancies, gapless number, frozen once issued", async () => {
    const r = await save(w.bk, { milestoneId: ms[0].id });
    expect(r).toMatchObject({ total: "12000.00", discrepancies: [] });
    depositInv = r.invoiceId;
    expect(await fails(as(w.rep, "select public.fin_invoice_issue($1)", [depositInv]))).toBe("forbidden");
    expect(await issue(w.bk, depositInv)).toMatchObject({ number: "INV-0001", total: "12000.00", discrepancies: [] });
    const inv = (await rows(w.owner, "select status, kind, bill_to, due_date from public.fin_invoices where id = $1", [depositInv]))[0];
    expect(inv).toMatchObject({ status: "issued", kind: "deposit" });
    expect(inv.bill_to.name).toBe("Pat Rivera");
    for (const sql of ["update public.fin_invoices set total = 1, subtotal = 1 where id = $1", "update public.fin_invoices set memo = 'x' where id = $1", "delete from public.fin_invoices where id = $1",
      "update public.fin_invoice_lines set description = 'x' where invoice_id = $1", "delete from public.fin_invoice_lines where invoice_id = $1"]) {
      expect(await fails(pool.query(sql, [depositInv])), sql).toBe("record_immutable");
    }
    expect(await fails(pool.query("insert into public.fin_invoice_lines (book_id, invoice_id, line_no, kind, description, unit_price, amount) values ($1, $2, 9, 'custom', 'sneak', 1, 1)", [w.book, depositInv]))).toBe("record_immutable");
    expect((await msState())[0]).toMatchObject({ state: "invoiced", invoiced: "12000.00" });
  });

  it("partial payment, overpayment kept unapplied, one payment across invoices, over-application refused", async () => {
    const p1 = await pay(w.bk, { jobId: job, method: "check", reference: "1001", amount: "5000.00", allocations: [{ invoiceId: depositInv, amount: "5000.00" }] }, "pay-key-0001");
    expect((await pay(w.bk, { jobId: job, method: "check", amount: "5000.00", allocations: [{ invoiceId: depositInv, amount: "5000.00" }] }, "pay-key-0001")).paymentId).toBe(p1.paymentId);   // idempotent
    expect(await bal(depositInv)).toMatchObject({ paid: "5000.00", balance: "7000.00" });
    expect((await rows(w.owner, "select verified from public.fin_payments where id = $1", [p1.paymentId]))[0].verified).toBe(false);
    expect((await msState())[0]).toMatchObject({ state: "partially_paid", paid: "5000.00" });
    // Overpayment: 10,000 received, 7,000 applied, 3,000 stays unapplied (customer credit).
    const p2 = await pay(w.bk, { jobId: job, method: "ach", amount: "10000.00", allocations: [{ invoiceId: depositInv, amount: "7000.00" }] });
    expect(await payBal(p2.paymentId)).toMatchObject({ applied: "7000.00", unapplied: "3000.00" });
    expect(await bal(depositInv)).toMatchObject({ balance: "0.00", aging_bucket: "paid" });
    expect((await msState())[0].state).toBe("paid");
    expect(await fails(as(w.bk, "select public.fin_payment_allocate($1, $2)", [p2.paymentId, JSON.stringify([{ invoiceId: depositInv, amount: "0.01" }])]))).toBe("over_applied_invoice");
    // Two more invoices; the unapplied 3,000 is split across them.
    const a = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Extra lighting", unitPrice: "1000.00" }] })).invoiceId;
    const b = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Railing upgrade", quantity: "2", unitPrice: "1250.00", taxable: true }] })).invoiceId;
    expect((await rows(w.owner, "select subtotal, tax, total from public.fin_invoices where id = $1", [b]))[0]).toEqual({ subtotal: "2500.00", tax: "202.70", total: "2702.70" });
    await issue(w.bk, a); await issue(w.bk, b);
    expect(await fails(as(w.bk, "select public.fin_payment_allocate($1, $2)", [p2.paymentId, JSON.stringify([{ invoiceId: a, amount: "1000.00" }, { invoiceId: b, amount: "2000.01" }])]))).toBe("over_applied_payment");
    await as(w.bk, "select public.fin_payment_allocate($1, $2)", [p2.paymentId, JSON.stringify([{ invoiceId: a, amount: "1000.00" }, { invoiceId: b, amount: "2000.00" }])]);
    expect(await payBal(p2.paymentId)).toMatchObject({ applied: "10000.00", unapplied: "0.00" });
    expect(await bal(a)).toMatchObject({ balance: "0.00" });
    expect(await bal(b)).toMatchObject({ balance: "702.70" });
    // The commit-time backstop catches an over-application written around the RPCs.
    expect(await fails(pool.query("insert into public.fin_payment_allocations (book_id, payment_id, invoice_id, amount) values ($1, $2, $3, 1)", [w.book, p1.paymentId, a]))).toBe("over_applied_invoice");
    // Verifying is a separate, recorded step.
    await as(w.bk, "select public.fin_payment_verify($1)", [p1.paymentId]);
    expect((await rows(w.owner, "select verified from public.fin_payments where id = $1", [p1.paymentId]))[0].verified).toBe(true);
    expect(await fails(pool.query("update public.fin_payments set amount = 1 where id = $1", [p1.paymentId]))).toBe("record_immutable");
  });

  it("credit memos, refunds and voids reverse instead of deleting; balances stay derived", async () => {
    const inv = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Stain", unitPrice: "800.00" }] })).invoiceId;
    await issue(w.bk, inv);
    const cm = (await as<{ r: Row }>(w.bk, "select public.fin_credit_memo_issue($1, $2) as r", [w.book, { invoiceId: inv, amount: "300.00", reason: "Goodwill", applyTo: [{ invoiceId: inv, amount: "200.00" }] }])).r;
    expect(cm).toMatchObject({ number: "CM-0001", available: "100.00" });
    expect(await bal(inv)).toMatchObject({ credited: "200.00", balance: "600.00" });
    // Refund part of the remaining credit; can't refund more than is available.
    expect(await fails(as(w.bk, "select public.fin_refund_record($1, $2)", [w.book, { creditMemoId: cm.creditMemoId, amount: "100.01", method: "check" }]))).toBe("over_refund");
    const rf = (await as<{ r: Row }>(w.bk, "select public.fin_refund_record($1, $2) as r", [w.book, { creditMemoId: cm.creditMemoId, amount: "100.00", method: "check" }])).r;
    expect((await rows(w.owner, "select available from public.fin_credit_memo_balances_v where credit_memo_id = $1", [cm.creditMemoId]))[0].available).toBe("0.00");
    // A payment with unapplied money can be refunded; voiding it needs the refund voided first.
    const p = await pay(w.bk, { jobId: job, method: "cash", amount: "900.00", allocations: [{ invoiceId: inv, amount: "600.00" }] });
    const r2 = (await as<{ r: Row }>(w.bk, "select public.fin_refund_record($1, $2) as r", [w.book, { paymentId: p.paymentId, amount: "300.00", method: "cash" }])).r;
    expect(await payBal(p.paymentId)).toMatchObject({ applied: "600.00", refunded: "300.00", unapplied: "0.00" });
    expect(await fails(as(w.bk, "select public.fin_payment_void($1, 'bounced')", [p.paymentId]))).toBe("has_refunds");
    // Invoice with applications can't be voided.
    expect(await fails(as(w.bk, "select public.fin_invoice_void($1, 'oops')", [inv]))).toBe("has_applications");
    await as(w.bk, "select public.fin_refund_void($1, 'entered in error')", [r2.refundId]);
    await as(w.bk, "select public.fin_payment_void($1, 'bounced')", [p.paymentId]);
    expect(await payBal(p.paymentId)).toMatchObject({ status: "void", applied: "0", unapplied: "0" });
    expect(await bal(inv)).toMatchObject({ paid: "0", balance: "600.00" });
    expect((await pool.query("select count(*)::int as n from public.fin_payment_allocations where payment_id = $1 and reversed_at is not null", [p.paymentId])).rows[0].n).toBe(1);
    // Void the credit memo -> invoice open again; then void the invoice itself.
    expect(await fails(as(w.bk, "select public.fin_credit_memo_void($1, 'x')", [cm.creditMemoId]))).toBe("has_refunds");
    await as(w.bk, "select public.fin_refund_void($1, 'x')", [rf.refundId]);
    await as(w.bk, "select public.fin_credit_memo_void($1, 'x')", [cm.creditMemoId]);
    expect(await bal(inv)).toMatchObject({ balance: "800.00" });
    await as(w.bk, "select public.fin_invoice_void($1, 'Duplicate')", [inv]);
    expect(await bal(inv)).toMatchObject({ status: "void", balance: "0" });
    expect(await fails(pool.query("update public.fin_invoices set void_reason = 'changed' where id = $1", [inv]))).toBe("record_immutable");
    expect(await fails(pool.query("update public.fin_refunds set amount = 1 where id = $1", [rf.refundId]))).toBe("record_immutable");
    // Customer roll-up from the same derived numbers.
    const c = (await rows(w.owner, "select * from public.fin_customer_balances_v where book_id = $1", [w.book]));
    expect(c.length).toBeGreaterThan(0);
    expect(c.find((x) => x.customer_id === est.customer)!.open_balance).toBe("702.70");
  });

  it("milestone triggers, discrepancies, exception reasons and the one-active-invoice guard", async () => {
    // Framing isn't triggered yet: invoicing it flags it and needs a reason.
    const early = await save(w.bk, { milestoneId: ms[1].id });
    expect(early.discrepancies.map((x: Row) => x.code)).toEqual(["not_triggered"]);
    expect(await fails(issue(w.bk, early.invoiceId))).toBe("milestone_discrepancy");
    await as(w.bk, "select public.fin_invoice_delete_draft($1)", [early.invoiceId]);
    expect((await msState())[1].state).toBe("not_triggered");
    // Record the phase completion (explicit, audited): Framing becomes ready to invoice.
    await as(w.bk, "select public.fin_milestone_trigger_record($1, $2)", [job, { triggerKind: "phase_completed_verified", milestoneId: ms[1].id, note: "Inspected" }]);
    expect((await msState())[1].state).toBe("ready_to_invoice");
    // A different amount is flagged; issuing it needs a reason, which is stored with the invoice.
    const off = await save(w.bk, { milestoneId: ms[1].id, lines: [{ kind: "milestone", description: "Framing", unitPrice: "7500.00" }] });
    expect(off.discrepancies).toEqual([{ code: "amount_differs", expected: "8000.00", actual: "7500.00" }]);
    expect(await fails(issue(w.bk, off.invoiceId))).toBe("milestone_discrepancy");
    await issue(w.bk, off.invoiceId, "Customer prepaid materials directly");
    expect((await rows(w.owner, "select exception_reason, discrepancies from public.fin_invoices where id = $1", [off.invoiceId]))[0])
      .toMatchObject({ exception_reason: "Customer prepaid materials directly", discrepancies: [{ code: "amount_differs" }] });
    // A second invoice for the same milestone is flagged as a duplicate and also needs a reason.
    const second = await save(w.bk, { milestoneId: ms[1].id });
    expect(second).toMatchObject({ total: "500.00" });
    expect(second.discrepancies.map((x: Row) => x.code)).toEqual(["duplicate_milestone_invoice"]);
    expect(await fails(issue(w.bk, second.invoiceId))).toBe("milestone_discrepancy");
    await issue(w.bk, second.invoiceId, "Remainder after prepaid materials");
    expect((await msState())[1]).toMatchObject({ state: "invoiced", invoiced: "8000.00" });
    // The unique guard backs this up even if the exception path is bypassed.
    expect(await fails(pool.query("update public.fin_invoices set exception_reason = null where id = $1", [second.invoiceId]))).toBe("record_immutable");
    // Policy on: an exception also needs manage_financial_config.
    await as(w.owner, "select public.fin_business_config_save($1, $2)", [w.book, { primaryTradeSlug: "decks" }]);
    await pool.query("update public.fin_business_config set require_billing_exception_approval = true where book_id = $1", [w.book]);
    const third = await save(w.bk, { milestoneId: ms[2].id });
    expect(third.discrepancies.map((x: Row) => x.code)).toEqual(["not_triggered"]);
    expect(await fails(issue(w.bk, third.invoiceId, "Customer asked early"))).toBe("forbidden");
    await as(w.bk, "select public.fin_invoice_delete_draft($1)", [third.invoiceId]);
    await pool.query("update public.fin_business_config set require_billing_exception_approval = false where book_id = $1", [w.book]);
    // Triggers are append-only.
    expect(await fails(pool.query("delete from public.fin_milestone_triggers where job_id = $1", [job]))).toBe("record_immutable");
  });

  it("due dates come only from the due rule + recorded trigger time (never planned dates); overdue is separate", async () => {
    const b = await wonBid(pool, w.owner, w.company, { title: "Due rules" });
    const j = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [b.id, b.v1])).r.jobId;
    const m = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [j]);
    // A planned schedule date doesn't trigger anything.
    await pool.query(
      `insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date, target_end_date)
       values ($1, $2, $3, 'Due', '{}', '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}', '2020-01-01', '2020-02-01')`, [b.id, w.owner, w.company]);
    let st = await rows(w.owner, "select seq, state, due_on, overdue from public.fin_milestone_status_v where job_id = $1 order by seq", [j]);
    expect(st.map((x) => x.state)).toEqual(["ready_to_invoice", "not_triggered", "not_triggered"]);
    expect(st[2]).toMatchObject({ due_on: null, overdue: false });
    // A confirmed completion recorded in the bid's stage history (an existing record) triggers the final milestone.
    await pool.query("insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, created_at) values ($1, $2, 'in_progress', 'completed', $3, now() - interval '10 days')", [b.id, w.company, w.owner]);
    st = await rows(w.owner, "select seq, state, overdue, days_overdue from public.fin_milestone_status_v where job_id = $1 order by seq", [j]);
    expect(st[2]).toMatchObject({ state: "ready_to_invoice", overdue: true });
    expect(Number(st[2].days_overdue)).toBeGreaterThanOrEqual(9);
    expect(m.length).toBe(3);
  });

  it("change orders: own milestone or an approved amendment; never the original rows or issued invoices", async () => {
    await refresh();
    const coAlerts = (await alerts()).filter((a) => a.kind === "change_order_affects_billing" && a.status === "open");
    expect(coAlerts.length).toBe(2);   // CO #1 (1,000) and CO #3 (250)
    const [co1, co3] = (await pool.query("select id from public.change_orders where estimate_id = $1 and number in (1, 3) order by number", [est.id])).rows.map((r) => r.id as string);
    expect(await fails(as(w.bk, "select public.fin_change_order_milestones_add($1, $2)", [job, { changeOrderId: co1, milestones: [{ description: "CO 1", amount: "999.00" }] }]))).toBe("milestones_must_sum");
    const added = (await as<{ r: Row }>(w.bk, "select public.fin_change_order_milestones_add($1, $2) as r", [job, { changeOrderId: co1, milestones: [{ description: "CO 1 on approval", amount: "1000.00" }] }])).r;
    expect(added.milestoneIds).toHaveLength(1);
    // CO #3 amends the remaining Completion milestone instead; needs approval by a config manager.
    const am = (await as<{ a: string }>(w.bk, "select public.fin_milestone_amendment_request($1, $2) as a", [ms[2].id, { changeOrderId: co3, delta: "250.00", reason: "Signed CO #3" }])).a;
    expect(await fails(as(w.bk, "select public.fin_milestone_amendment_decide($1, true)", [am]))).toBe("forbidden");
    // Fully invoiced milestones can't be amended.
    expect(await fails(as(w.bk, "select public.fin_milestone_amendment_request($1, $2)", [ms[0].id, { delta: "10.00", reason: "x" }]))).toBe("milestone_invoiced");
    await as(w.owner, "select public.fin_milestone_amendment_decide($1, true)", [am]);
    const st = await msState();
    expect(st.find((x) => x.seq === 3)!.current_amount).toBe("20250.00");
    expect((await rows(w.owner, "select amount from public.fin_payment_milestones where id = $1", [ms[2].id]))[0].amount).toBe("20000.00");   // original untouched
    await refresh();
    expect((await alerts()).filter((a) => a.kind === "change_order_affects_billing").map((a) => a.status).sort()).toEqual(["resolved", "resolved"]);
  });

  it("billing alerts are deterministic, deduplicated, overridable with a reason, and never block", async () => {
    await refresh();
    const first = await openAlerts();
    expect((await refresh())).toEqual({ opened: 0, resolved: 0 });                     // same state -> no new rows
    expect(await openAlerts()).toEqual(first);
    // CO #1's own milestone is due on approval and not invoiced yet.
    expect(first).toContain("milestone_ready_not_invoiced");
    // Project start recorded while a pre-start payment (the CO milestone due on signing) is unpaid.
    await as(w.bk, "select public.fin_milestone_trigger_record($1, $2)", [job, { triggerKind: "project_start_confirmed" }]);
    await refresh();
    expect(await openAlerts()).toContain("start_with_prestart_unpaid");
    // The mismatched framing invoice is visible as info.
    expect(await openAlerts()).toContain("invoice_milestone_mismatch");
    // Billing more than the contract raises an alert but is still allowed.
    const big = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Too much", unitPrice: "40000.00" }] })).invoiceId;
    await issue(w.bk, big);
    await refresh();
    expect(await openAlerts()).toContain("billed_over_contract");
    // Override needs a reason; an overridden alert stays quiet while the condition persists.
    const id = (await rows(w.owner, "select id from public.fin_alerts where kind = 'billed_over_contract' and status = 'open'"))[0].id;
    expect(await fails(as(w.bk, "select public.fin_alert_set_status($1, 'overridden')", [id]))).toBe("reason_required");
    await as(w.bk, "select public.fin_alert_set_status($1, 'overridden', 'Agreed extra scope, CO pending')", [id]);
    await refresh();
    expect(await openAlerts()).not.toContain("billed_over_contract");
    // Clearing the condition resolves alerts automatically.
    await as(w.bk, "select public.fin_invoice_void($1, 'wrong')", [big]);
    await refresh();
    expect((await rows(w.owner, "select status from public.fin_alerts where kind = 'billed_over_contract' order by created_at"))).toEqual([{ status: "overridden" }]);
    expect((await rows(w.owner, "select action from public.fin_audit_log where action like 'alert.%'")).map((r) => r.action)).toEqual(["alert.overridden"]);
    // Completion with an open balance.
    await as(w.bk, "select public.fin_milestone_trigger_record($1, $2)", [job, { triggerKind: "final_completion_confirmed" }]);
    await refresh();
    expect(await openAlerts()).toContain("completion_with_balance");
    expect(await fails(pool.query("delete from public.fin_alerts where book_id = $1", [w.book]))).toBe("record_immutable");
  });

  it("deposit alerts: not invoiced, then overdue from the due rule", async () => {
    const b = await wonBid(pool, w.owner, w.company, { title: "Deposit alerts" });
    const j = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [b.id, b.v1])).r.jobId;
    await refresh();
    const forJob = async () => (await rows(w.owner, "select kind from public.fin_alerts where job_id = $1 and status = 'open' order by kind", [j])).map((r) => r.kind);
    expect(await forJob()).toEqual(["deposit_not_invoiced"]);
    const dep = (await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 and is_deposit", [j]))[0].id;
    const inv = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [j, { milestoneId: dep }])).r.invoiceId;
    await as(w.bk, "select public.fin_invoice_issue($1)", [inv]);
    await refresh();
    expect(await forJob()).toEqual([]);
    // Backdate the agreement (as if signed 10 days ago): the deposit is now overdue under its due rule.
    await pool.query("alter table public.fin_contract_snapshots disable trigger fin_contract_snapshots_immutable");
    await pool.query("update public.fin_contract_snapshots set created_at = now() - interval '10 days' where job_id = $1", [j]);
    await pool.query("alter table public.fin_contract_snapshots enable trigger fin_contract_snapshots_immutable");
    await refresh();
    expect(await forJob()).toEqual(["deposit_overdue"]);
  });

  it("isolation and permissions on receivables", async () => {
    expect((await rows(w.rival, "select id from public.fin_invoices")).length).toBe(0);
    expect((await rows(w.rival, "select * from public.fin_invoice_balances_v")).length).toBe(0);
    expect((await rows(w.rival, "select * from public.fin_milestone_status_v")).length).toBe(0);
    const rivalPay = (await as<{ r: Row }>(w.rival, "select public.fin_payment_record($1, $2) as r", [w.rivalBook, { method: "cash", amount: "50.00" }])).r;
    expect(await fails(as(w.rival, "select public.fin_payment_allocate($1, $2)", [rivalPay.paymentId, JSON.stringify([{ invoiceId: depositInv, amount: "1.00" }])]))).toBe("not_found");
    expect(await fails(as(w.rival, "select public.fin_invoice_void($1, 'x')", [depositInv]))).toBe("forbidden");
    expect(await fails(as(w.rep, "select public.fin_payment_record($1, $2)", [w.book, { method: "cash", amount: "1.00" }]))).toBe("forbidden");
    expect(await fails(as(w.viewer, "select public.fin_alerts_refresh($1)", [w.book]))).toBe("forbidden");
    // Concurrent allocations against the same invoice never over-apply it (row locks).
    const inv = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Lock test", unitPrice: "100.00" }] })).invoiceId;
    await issue(w.bk, inv);
    const results = await Promise.all(Array.from({ length: 6 }, () => fails(pay(w.bk, { jobId: job, method: "cash", amount: "60.00", allocations: [{ invoiceId: inv, amount: "60.00" }] }))));
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.filter((r) => r !== "ok").every((r) => r === "over_applied_invoice")).toBe(true);
    expect(await bal(inv)).toMatchObject({ paid: "60.00", balance: "40.00" });
  });

  // V4.4 -------------------------------------------------------------------------------------------------------
  it("financial email drafts reuse comm_messages: stale detection, idempotency, suppression, RLS", async () => {
    const hash = h("facts-v1");
    const draft = (p: Row = {}) => as<{ id: string }>(w.bk, "select public.fin_email_draft_save($1, $2) as id", [w.book, {
      templateKind: "progress", tone: "friendly", invoiceId: depositInv, toEmail: "Pat@Example.test", toName: "Pat", subject: "Invoice INV-0001",
      body: "Hi Pat", fieldsHash: hash, idempotencyKey: "fin-email-0001", ...p }]).then((r) => r.id);
    const id = await draft();
    expect(await draft()).toBe(id);   // same idempotency key -> same draft
    const m = (await pool.query("select kind, trigger, status, to_email, fin_invoice_id, account_id from public.comm_messages where id = $1", [id])).rows[0];
    expect(m).toMatchObject({ kind: "financial", trigger: "financial", status: "draft", to_email: "pat@example.test", fin_invoice_id: depositInv, account_id: w.company });
    // Facts changed since rendering -> refused.
    expect(await fails(as(w.bk, "select public.fin_email_queue($1, $2)", [id, h("facts-v2")]))).toBe("stale_draft");
    expect(await as<{ s: string }>(w.bk, "select public.fin_email_queue($1, $2) as s", [id, hash]).then((r) => r.s)).toBe("queued");
    expect(await as<{ s: string }>(w.bk, "select public.fin_email_queue($1, $2) as s", [id, hash]).then((r) => r.s)).toBe("queued");   // no double queue
    // Only the service role records provider states.
    expect(await fails(as(w.bk, "select public.fin_email_set_status($1, 'delivered')", [id]))).toMatch(/permission denied/);
    await pool.query("select public.fin_email_set_status($1, 'provider_accepted', 'prov_1')", [id]);
    await pool.query("select public.fin_email_set_status($1, 'delivered')", [id]);
    expect((await pool.query("select status, sent_at is not null as sent from public.comm_messages where id = $1", [id])).rows[0]).toEqual({ status: "delivered", sent: true });
    // Financial messages need view_company_financials, not just view_communications (the rep has that one).
    expect((await rows(w.rep, "select id from public.comm_messages where kind = 'financial'")).length).toBe(0);
    expect((await rows(w.bk, "select id from public.comm_messages where kind = 'financial'")).length).toBe(1);

    // Reminders are off by default, and suppressed for paid / void / disputed invoices.
    const open = (await save(w.bk, { kind: "custom", lines: [{ kind: "custom", description: "Reminder test", unitPrice: "50.00" }] })).invoiceId;
    await issue(w.bk, open);
    const remind = async (inv: string, key: string) => {
      const mid = (await as<{ id: string }>(w.bk, "select public.fin_email_draft_save($1, $2) as id", [w.book, {
        templateKind: "balance_reminder", tone: "brief", invoiceId: inv, toEmail: "pat@example.test", subject: "Reminder", body: "x", fieldsHash: hash, idempotencyKey: key }])).id;
      const s = (await as<{ s: string }>(w.bk, "select public.fin_email_queue($1, $2) as s", [mid, hash])).s;
      return { s, reason: (await pool.query("select status_reason from public.comm_messages where id = $1", [mid])).rows[0].status_reason };
    };
    expect(await remind(open, "fin-rem-0001")).toEqual({ s: "skipped", reason: "suppressed:rule_off" });
    await as(w.owner, "select public.fin_email_config_save($1, $2)", [w.book, { tone: "brief", reminders: [{ kind: "balance_reminder", enabled: true, offsetDays: 3 }],
      templates: [{ templateKind: "receipt", tone: "brief", subject: "Got it", body: "{payment_status_sentence}" }] }]);
    expect(await remind(depositInv, "fin-rem-0002")).toEqual({ s: "skipped", reason: "suppressed:paid" });
    await as(w.bk, "select public.fin_invoice_dispute_set($1, true, 'Customer questions the amount')", [open]);
    expect(await remind(open, "fin-rem-0003")).toEqual({ s: "skipped", reason: "suppressed:disputed" });
    await as(w.bk, "select public.fin_invoice_dispute_set($1, false)", [open]);
    expect(await remind(open, "fin-rem-0004")).toEqual({ s: "queued", reason: null });
    expect((await rows(w.bk, "select tone from public.fin_email_settings where book_id = $1", [w.book]))[0].tone).toBe("brief");
    expect((await rows(w.bk, "select subject from public.fin_email_templates where book_id = $1", [w.book]))[0].subject).toBe("Got it");
    expect(await fails(as(w.rep, "select public.fin_email_config_save($1, $2)", [w.book, { tone: "friendly" }]))).toBe("forbidden");
  });

  it("rollbacks remove the financial objects (newest first) and the migrations re-apply", async () => {
    await pool.query(readFileSync("docs/financials/rollback_20270214001000.sql", "utf8"));   // General ledger references books, accounts and jobs
    await pool.query(readFileSync("docs/financials/rollback_20270213001000.sql", "utf8"));   // Connect payments reference invoices and payments
    await pool.query(readFileSync("docs/affiliates/rollback_20270211001000.sql", "utf8"));   // newest first: affiliate payouts extend the staff payout ledger
    await pool.query(readFileSync("docs/worker-invites/rollback_20270212001000.sql", "utf8"));
    await pool.query(readFileSync("docs/worker-hub/rollback_20270210001000.sql", "utf8"));
    await pool.query(readFileSync("docs/workforce-gps/rollback_20270208001000.sql", "utf8"));
    await pool.query(readFileSync("docs/staff-payouts/rollback_20270207001000.sql", "utf8"));
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));   // newest first: timesheet labor reads fin_books / pm_time_entries
    await pool.query(readFileSync("docs/tax-banking/rollback_20261226001000.sql", "utf8"));   // V6.9 tax + banking (newer)
    await pool.query(readFileSync("docs/financials/rollback_20261213001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261211001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261201007000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130101000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261129002000.sql", "utf8"));
    await pool.query(readFileSync("docs/project-operations/rollback_20261129001000.sql", "utf8")); // newest first
    for (const f of ["20261128001000", "20261126001000", "20261125001000", "20261124005000", "20261124004000", "20261124003000", "20261124002000", "20261124001000"]) await pool.query(readFileSync(`docs/financials/rollback_${f}.sql`, "utf8"));
    expect((await pool.query("select count(*)::int as n from pg_class where relname like 'fin\\_%' and relnamespace = 'public'::regnamespace")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from pg_proc where proname like 'fin\\_%' and pronamespace = 'public'::regnamespace")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from public.comm_messages where kind = 'financial'")).rows.length).toBe(1);
    expect((await pool.query("select public.company_permission_keys() as k")).rows[0].k).not.toContain("view_company_financials");
    // Change orders and estimates were never touched by finance.
    expect((await pool.query("select count(*)::int as n from public.change_orders where estimate_id = $1", [est.id])).rows[0].n).toBe(3);
    for (const f of ["20261124001000_fin_foundation.sql", "20261124002000_fin_receivables.sql", "20261124003000_fin_costs.sql", "20261124004000_fin_communications.sql", "20261124005000_fin_customer_merge.sql", "20261125001001_fin_access_retention.sql", "20261126001000_fin_v5_ar_job_summary.sql", "20261128001000_fin_v6_corrections.sql", "20261129002000_fin_quick_actions.sql", "20261130001000_fin_invoice_delete_mistake.sql", "20261130101000_fin_send_states_scope_credits.sql", "20261130201000_fin_sandbox.sql", "20261211001000_fin_book_local_dates.sql", "20261213001000_fin_accounting.sql"]) await applyMigration(pool, f);
    expect((await pool.query("select public.company_permission_keys() as k")).rows[0].k).toContain("manage_financial_seats");
  });
});
