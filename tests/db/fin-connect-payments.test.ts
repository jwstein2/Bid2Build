/**
 * Online invoice payments through Stripe Connect (20270213001000), against the real SQL:
 *   - settling a paid Checkout session records a verified 'stripe' payment and applies it to the invoice
 *   - settling twice (Stripe retries) never records a second payment
 *   - an overpayment stays unapplied (a customer credit), never over-applies the invoice
 *   - the settle function is server-only; the settings RPC is owner-only and keeps at least one method on
 *   - the new tables have no browser access
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

d("Stripe Connect invoice payments (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let invoice: string;
  let invoice2: string;

  const openSession = (inv: string, id: string, amount: string) =>
    pool.query("insert into public.fin_online_payments (book_id, invoice_id, stripe_account_id, checkout_session_id, livemode, amount) values ($1, $2, 'acct_TEST123', $3, false, $4)", [w.book, inv, id, amount]);
  const settle = (id: string, pi: string, method: string, amount: string) =>
    pool.query("select public.fin_online_payment_settle($1, $2, $3, $4) as r", [id, pi, method, amount]).then((r) => r.rows[0].r as Row);
  const balance = async (inv: string) => Number((await pool.query("select balance from public.fin_invoice_balances_v where invoice_id = $1", [inv])).rows[0].balance);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_connect"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    const est = await wonBid(pool, w.owner, w.company, { title: "Deck", total: "10000.00", tax: "0.00" });
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    const ms = await rows(w.owner, "select id from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
    const mk = async (m: string) => {
      const id = (await as<{ r: Row }>(w.owner, "select public.fin_invoice_save($1, $2) as r", [job, { milestoneId: m }])).r.invoiceId as string;
      await as(w.owner, "select public.fin_invoice_issue($1, null, $2)", [id, "Billed early for the test"]);
      return id;
    };
    invoice = await mk(ms[0].id);    // deposit 30% = 3,000
    invoice2 = await mk(ms[1].id);   // 20% = 2,000
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("records a verified online payment and applies it to the invoice", async () => {
    expect(await balance(invoice)).toBe(3000);
    await openSession(invoice, "cs_test_1", "3000.00");
    const r = await settle("cs_test_1", "pi_1", "card", "3000.00");
    expect(r.applied).toBe("3000.00");
    const [pay] = (await pool.query("select * from public.fin_payments where id = $1", [r.paymentId])).rows;
    expect(pay).toMatchObject({ source: "stripe", method: "card", reference: "pi_1", verified: true, status: "active" });
    expect(await balance(invoice)).toBe(0);
    const [op] = (await pool.query("select status, payment_id from public.fin_online_payments where checkout_session_id = 'cs_test_1'")).rows;
    expect(op).toMatchObject({ status: "succeeded", payment_id: r.paymentId });
    const audit = (await pool.query("select action from public.fin_audit_log where entity_id = $1", [r.paymentId])).rows;
    expect(audit.map((a) => a.action)).toContain("payment.online_received");
  });

  it("is idempotent when Stripe retries the event", async () => {
    const r = await settle("cs_test_1", "pi_1", "card", "3000.00");
    expect(r.duplicate).toBe(true);
    const { rows: pays } = await pool.query("select count(*)::int as n from public.fin_payments where reference = 'pi_1'");
    expect(pays[0].n).toBe(1);
  });

  it("keeps an overpayment unapplied instead of over-applying the invoice", async () => {
    await openSession(invoice2, "cs_test_2", "2000.00");
    const r = await settle("cs_test_2", "pi_2", "ach", "2500.00");
    expect(r.applied).toBe("2000.00");
    expect(await balance(invoice2)).toBe(0);
    const { rows: un } = await pool.query("select public.fin_payment_unapplied($1) as u", [r.paymentId]);
    expect(Number(un[0].u)).toBe(500);
  });

  it("refuses bad input and unknown sessions", async () => {
    expect(await fails(settle("cs_nope", "pi_x", "card", "10.00"))).toMatch(/not_found/);
    await openSession(invoice2, "cs_test_3", "1.00");
    expect(await fails(settle("cs_test_3", "pi_3", "bitcoin", "1.00"))).toMatch(/bad_method/);
    expect(await fails(settle("cs_test_3", "pi_3", "card", "0"))).toMatch(/bad_amount/);
  });

  it("is server-only: signed-in users can't call settle or read the Connect tables", async () => {
    expect(await fails(as(w.owner, "select public.fin_online_payment_settle('cs_test_3', 'pi_3', 'card', 1)"))).toMatch(/permission denied/);
    expect(await rows(w.owner, "select * from public.fin_online_payments").then((r) => (r.length ? "visible" : "empty"), () => "denied")).not.toBe("visible");
    expect(await rows(w.owner, "select * from public.fin_payment_accounts").then((r) => (r.length ? "visible" : "empty"), () => "denied")).not.toBe("visible");
    expect(await rows(w.owner, "select * from public.fin_invoice_pay_links").then((r) => (r.length ? "visible" : "empty"), () => "denied")).not.toBe("visible");
  });

  it("settings are owner-only and keep at least one way to pay", async () => {
    await pool.query("insert into public.fin_payment_accounts (book_id, stripe_account_id, livemode) values ($1, 'acct_TEST123', false)", [w.book]);
    const r = await as<{ r: Row }>(w.owner, "select public.fin_payment_account_settings($1, $2) as r", [w.book, { cardEnabled: false }]);
    expect(r.r).toMatchObject({ cardEnabled: false, achEnabled: true, cardFeePayer: "contractor" });
    expect(await fails(as(w.owner, "select public.fin_payment_account_settings($1, $2)", [w.book, { achEnabled: false }]))).toMatch(/fin_payment_accounts_method/);
    expect(await fails(as(w.rival, "select public.fin_payment_account_settings($1, $2)", [w.book, { cardEnabled: true }]))).toMatch(/forbidden/);
  });

  it("allows only one active pay link per invoice", async () => {
    const h = (c: string) => c.repeat(64);
    await pool.query("insert into public.fin_invoice_pay_links (book_id, invoice_id, token_hash) values ($1, $2, $3)", [w.book, invoice2, h("a")]);
    expect(await fails(pool.query("insert into public.fin_invoice_pay_links (book_id, invoice_id, token_hash) values ($1, $2, $3)", [w.book, invoice2, h("b")]))).toMatch(/fin_invoice_pay_links_active/);
    await pool.query("update public.fin_invoice_pay_links set revoked_at = now() where invoice_id = $1", [invoice2]);
    await pool.query("insert into public.fin_invoice_pay_links (book_id, invoice_id, token_hash) values ($1, $2, $3)", [w.book, invoice2, h("b")]);
  });
});
