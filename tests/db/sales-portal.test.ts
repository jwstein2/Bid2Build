import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20270107001000_sales_portal.sql";
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];

const subscribe = (u: string, opts: { status?: string; plan?: string } = {}) =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $2, $3, $4, $5, 'price_m', '2099-01-01'::timestamptz, false, null, null, now())",
    [u, `cus_${u}`, `sub_${u}`, opts.status ?? "active", opts.plan ?? "monthly"],
  );
const pay = (u: string, invoice: string, paidAt: string, basis = 1999) =>
  val("select public.sales_sync_billing($1, $2, 'active', 'monthly', null, $3, $4::jsonb, $5, $3, $6::timestamptz)",
    [u, `sub_${u}`, basis, JSON.stringify({ cents: basis }), invoice, paidAt]);
const commissions = async (u: string) => (await pool.query("select year_no, kind, period_month::text as m, amount_cents, status, reason, statement_id from public.sales_commissions where user_id = $1 order by year_no, kind", [u])).rows;

d("sales portal (database)", () => {
  let owner: string, repUser: string, rep2User: string, repId: string, rep2Id: string, repCode: string, rep2Code: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_portal"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, MIGRATION); // idempotent re-run
  });
  afterAll(async () => { await drop?.(); });

  it("lets only the owner add sales staff; the invite links on first verified sign-in", async () => {
    const stranger = await createUser(pool, "nobody@roofco.com");
    await expect(q1("select public.admin_sales_rep_save($1, null, 'x@y.com', 'X', null, 'rep', 'active', null)", [stranger])).rejects.toThrow(/not_authorized/);
    await expect(q1("select public.admin_sales_rep_save($1, null, 'owner@built2bid.org', 'Me', null, 'rep', 'active', null)", [owner])).rejects.toThrow(/owner_cannot_be_rep/);

    const r = (await q1("select public.admin_sales_rep_save($1, null, ' Rita@Sales.com ', 'Rita Rep', '555', 'rep', 'active', 'ACH') as r", [owner])).r;
    expect(r).toMatchObject({ email: "rita@sales.com", status: "invited", role: "rep" });
    expect(r.code).toMatch(/^[A-Z2-9]{8}$/);
    repId = r.id; repCode = r.code;
    await expect(q1("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Dup', null, 'rep', 'active', null)", [owner])).rejects.toThrow(/duplicate key/);
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.rep_invited'")).toBe(1);

    // Unverified email: not linked.
    const unverified = await createUser(pool, "rita@sales.com", false);
    expect((await asUser(pool, unverified, (q) => q("select public.sales_me() as m"))).rows[0].m).toBeNull();
    await pool.query("delete from auth.users where id = $1", [unverified]);

    repUser = await createUser(pool, "rita@sales.com");
    const me = (await asUser(pool, repUser, (q) => q("select public.sales_me() as m"))).rows[0].m;
    expect(me).toMatchObject({ id: repId, status: "active", code: repCode });
    // Customer accounts are not sales staff.
    expect((await asUser(pool, stranger, (q) => q("select public.sales_me() as m"))).rows[0].m).toBeNull();

    const r2 = (await q1("select public.admin_sales_rep_save($1, null, 'sam@sales.com', 'Sam Seller', null, 'manager', 'active', null) as r", [owner])).r;
    rep2Id = r2.id; rep2Code = r2.code;
    rep2User = await createUser(pool, "sam@sales.com");
    await asUser(pool, rep2User, (q) => q("select public.sales_me()"));
  });

  it("keeps sales tables and owner/billing functions out of reach of signed-in users", async () => {
    await expect(asUser(pool, repUser, (q) => q("select * from public.sales_commissions"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, repUser, (q) => q("select * from public.sales_attributions"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, repUser, (q) => q("select public.admin_sales_hub($1)", [owner]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, repUser, (q) => q("select public.sales_record_attribution($1, $2, null)", [repUser, repCode]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, repUser, (q) => q("select public.sales_sync_billing($1, 's', 'active', 'monthly', null, 1, '{}'::jsonb, 'in', 1, now())", [repUser]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, repUser, (q) => q("select public.sales_close_month(now())"))).rejects.toThrow(/permission denied/);
    const outsider = await createUser(pool, "outsider@deck.com");
    await expect(asUser(pool, outsider, (q) => q("select public.sales_my_overview()"))).rejects.toThrow(/not_sales_staff/);
  });

  it("attributes only new, never-paid, genuine accounts, once, to one rep", async () => {
    expect(await val("select public.sales_log_visit($1)", [repCode])).toBe(true);
    expect(await val("select public.sales_log_visit('ZZZZZZZZ')")).toBe(false);

    const unknown = await createUser(pool, "u1@plumbing.com");
    expect(await val("select public.sales_record_attribution($1, 'ZZZZZZZZ', now())", [unknown])).toBe("unknown_code");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [repUser, repCode])).toBe("ineligible:sales_staff");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [rep2User, repCode])).toBe("ineligible:sales_staff");
    const tester = await createUser(pool, "someone@example.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [tester, repCode])).toBe("ineligible:excluded_test");
    const customer = await createUser(pool, "paying@roofing.com");
    await subscribe(customer);
    expect(await val("select public.sales_record_attribution($1, $2, now())", [customer, repCode])).toBe("existing_customer");
    const old = await createUser(pool, "old@siding.com");
    await pool.query("update auth.users set created_at = now() - interval '200 days' where id = $1", [old]);
    expect(await val("select public.sales_record_attribution($1, $2, now())", [old, repCode])).toBe("existing_account");

    const fresh = await createUser(pool, "new@concrete.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [fresh, repCode.toLowerCase()])).toBe("recorded");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [fresh, repCode])).toBe("already_attributed");
    // A second rep's link later never steals the customer.
    expect(await val("select public.sales_record_attribution($1, $2, now())", [fresh, rep2Code])).toBe("already_attributed");
    expect(await val("select rep_id from public.sales_attributions where user_id = $1", [fresh])).toBe(repId);

    // Suspended rep's link stops counting.
    await q1("select public.admin_sales_rep_save($1, $2, 'sam@sales.com', 'Sam Seller', null, 'manager', 'suspended', null)", [owner, rep2Id]);
    const another = await createUser(pool, "another@paint.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [another, rep2Code])).toBe("unknown_code");
    expect((await asUser(pool, rep2User, (q) => q("select public.sales_me() as m"))).rows[0].m).toEqual({ status: "suspended" });
    await q1("select public.admin_sales_rep_save($1, $2, 'sam@sales.com', 'Sam Seller', null, 'manager', 'active', null)", [owner, rep2Id]);
  });

  it("creates the sale-month commission once, then anniversaries in years 2 and 3 at the current (upgraded) rate", async () => {
    const c = await createUser(pool, "deck@builders.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [c, repCode])).toBe("recorded");
    // Plan change without payment: basis only.
    expect(await val("select public.sales_sync_billing($1, 's', 'incomplete', 'monthly', null, 1999, '{}'::jsonb, null, 0, null)", [c])).toEqual({ action: "synced" });
    expect(await commissions(c)).toHaveLength(0);

    expect(await pay(c, "in_1", "2027-01-10T15:00:00Z")).toEqual({ action: "created_year_1" });
    expect(await pay(c, "in_1", "2027-01-10T15:00:00Z")).toEqual({ action: "synced" }); // webhook retry
    expect(await pay(c, "in_2", "2027-02-10T15:00:00Z")).toEqual({ action: "synced" });
    // Upgrade shortly before the first anniversary: year 2 uses the new rate.
    expect(await pay(c, "in_12", "2027-12-10T15:00:00Z", 4999)).toEqual({ action: "synced" });
    expect(await pay(c, "in_13", "2028-01-10T15:00:00Z", 4999)).toEqual({ action: "created_year_2" });
    expect(await pay(c, "in_25", "2029-01-09T15:00:00Z", 4999)).toEqual({ action: "created_year_3" });
    expect(await pay(c, "in_37", "2030-01-09T15:00:00Z", 4999)).toEqual({ action: "synced", reason: "past_commission_term" });
    const rows = await commissions(c);
    expect(rows.map((r) => [r.year_no, r.m, r.amount_cents, r.status])).toEqual([
      [1, "2027-01-01", 1999, "pending"], [2, "2028-01-01", 4999, "pending"], [3, "2029-01-01", 4999, "pending"],
    ]);
    // Sale month uses Central time: 03:00 UTC on Feb 1 is still January in Chicago.
    const late = await createUser(pool, "late@hvac.com");
    await val("select public.sales_record_attribution($1, $2, now())", [late, repCode]);
    await pay(late, "in_late", "2027-02-01T03:00:00Z");
    expect((await commissions(late))[0].m).toBe("2027-01-01");
  });

  it("month-end close earns last month, marks missed anniversaries, builds statements; payout needs approval + confirmed policy, once", async () => {
    const c = await createUser(pool, "monthly@electric.com");
    await val("select public.sales_record_attribution($1, $2, now())", [c, repCode]);
    await pay(c, "in_e1", "2026-03-05T15:00:00Z");
    // Still March: nothing earned yet.
    let r = await val("select public.sales_close_month('2026-03-20T12:00:00Z')");
    expect(r).toMatchObject({ earned: 0 });
    expect((await commissions(c))[0].status).toBe("pending");
    // April: March closes.
    r = await val("select public.sales_close_month('2026-04-01T12:00:00Z')");
    expect((r as { earned: number }).earned).toBeGreaterThanOrEqual(1);
    const [line] = await commissions(c);
    expect(line.status).toBe("earned");
    const st = await q1("select * from public.sales_statements where id = $1", [line.statement_id]);
    expect(st).toMatchObject({ rep_id: repId, status: "open" });
    expect(st.period_month.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(st.total_cents).toBe(1999);
    // Idempotent.
    await val("select public.sales_close_month('2026-04-02T12:00:00Z')");
    expect((await q1("select total_cents from public.sales_statements where id = $1", [st.id])).total_cents).toBe(1999);

    // Two years later with no payment in March 2027: year 2 is ineligible.
    await pool.query("update public.sales_attributions set sub_status = 'canceled' where user_id = $1", [c]);
    await val("select public.sales_close_month('2027-04-03T12:00:00Z')");
    expect((await commissions(c)).find((x) => x.year_no === 2)).toMatchObject({ status: "ineligible", reason: "no_paid_invoice_in_anniversary_month", amount_cents: 0 });

    await expect(q1("select public.admin_sales_statement_approve($1, $2)", [owner, st.id])).rejects.toThrow(/policy_not_confirmed/);
    await q1("select public.admin_sales_settings_save($1, 'divide_12', 'month_end_clawback', 'plan_seats', 3, 30, true)", [owner]);
    await expect(q1("select public.admin_sales_payout_record($1, $2, 'ach', null, current_date)", [owner, st.id])).rejects.toThrow(/approve_first/);
    await q1("select public.admin_sales_statement_approve($1, $2)", [owner, st.id]);
    await expect(q1("select public.admin_sales_statement_approve($1, $2)", [owner, st.id])).rejects.toThrow(/already_approved/);
    await expect(q1("select public.admin_sales_commission_set($1, (select id from public.sales_commissions where statement_id = $2 limit 1), 'canceled', null, 'test')", [owner, st.id])).rejects.toThrow(/locked_after_approval/);
    const p = (await q1("select public.admin_sales_payout_record($1, $2, 'ach', 'T-1', '2026-04-05') as p", [owner, st.id])).p;
    expect(p.amount_cents).toBe(st.total_cents);
    await expect(q1("select public.admin_sales_payout_record($1, $2, 'ach', 'T-2', '2026-04-06')", [owner, st.id])).rejects.toThrow(/already_paid/);
    expect((await commissions(c))[0].status).toBe("paid");
    expect(await val("select count(*)::int from public.audit_logs where action in ('sales.statement_approved', 'sales.payout_recorded')")).toBe(2);
  });

  it("applies the refund policy: void before payout, deduct after payout, partial refunds flagged", async () => {
    const a = await createUser(pool, "refund1@gutters.com");
    await val("select public.sales_record_attribution($1, $2, now())", [a, repCode]);
    await pay(a, "in_r1", "2026-05-05T15:00:00Z");
    expect(await val("select public.sales_invoice_refunded('in_r1', false)")).toEqual({ action: "flagged_partial" });
    expect(await val("select public.sales_invoice_refunded('in_r1', true)")).toEqual({ action: "reversed" });
    expect((await commissions(a))[0]).toMatchObject({ status: "reversed", reason: "invoice_refunded" });

    // The paid line from the previous test gets refunded after payout: clawback next statement.
    const paid = await q1("select user_id, stripe_invoice_id from public.sales_commissions where status = 'paid' limit 1");
    expect(await val("select public.sales_invoice_refunded($1, true, '2026-06-10T12:00:00Z')", [paid.stripe_invoice_id])).toEqual({ action: "clawback" });
    expect(await val("select public.sales_invoice_refunded($1, true, '2026-06-11T12:00:00Z')", [paid.stripe_invoice_id])).toEqual({ action: "none" });
    const claw = (await commissions(paid.user_id)).find((x) => x.kind === "clawback");
    expect(claw).toMatchObject({ amount_cents: -1999, status: "earned", m: "2026-06-01" });
    await val("select public.sales_close_month('2026-07-01T12:00:00Z')");
    const st = await q1("select s.total_cents from public.sales_statements s join public.sales_commissions c on c.statement_id = s.id where c.kind = 'clawback'");
    expect(st.total_cents).toBeLessThanOrEqual(0);

    await q1("select public.admin_sales_settings_save($1, 'divide_12', 'never_reverse', 'plan_seats', 3, 30, false)", [owner]);
    const b = await createUser(pool, "refund2@windows.com");
    await val("select public.sales_record_attribution($1, $2, now())", [b, repCode]);
    await pay(b, "in_r2", "2026-05-06T15:00:00Z");
    expect(await val("select public.sales_invoice_refunded('in_r2', true)")).toEqual({ action: "kept_by_policy" });
    await q1("select public.admin_sales_settings_save($1, 'divide_12', 'month_end_clawback', 'plan_seats', 3, 30, false)", [owner]);
  });

  it("owner can assign, reassign (with reason) and end attributions; history and audit are kept", async () => {
    const c = await createUser(pool, "walkin@remodel.com");
    await pool.query("update auth.users set created_at = now() - interval '300 days' where id = $1", [c]);
    await expect(q1("select public.admin_sales_attribution_set($1, 'walkin@remodel.com', $2, '')", [owner, repId])).rejects.toThrow(/reason_required/);
    await expect(q1("select public.admin_sales_attribution_set($1, 'rita@sales.com', $2, 'x reason')", [owner, rep2Id])).rejects.toThrow(/customer_is_sales_staff/);
    expect(await val("select public.admin_sales_attribution_set($1, 'WalkIn@remodel.com', $2, 'Trade show demo')", [owner, repId])).toEqual({ action: "assigned" });
    expect(await val("select public.admin_sales_attribution_set($1, 'walkin@remodel.com', $2, 'Territory change')", [owner, rep2Id])).toEqual({ action: "reassigned" });
    expect(await val("select rep_id from public.sales_attributions where user_id = $1", [c])).toBe(rep2Id);
    await pay(c, "in_w1", "2026-08-01T15:00:00Z");
    expect(await val("select public.admin_sales_attribution_end($1, $2, 'Customer asked')", [owner, c])).toEqual({ action: "ended" });
    expect((await commissions(c))[0].status).toBe("canceled");
    expect(await pay(c, "in_w2", "2027-08-01T15:00:00Z")).toEqual({ action: "synced" });
    expect(await val("select count(*)::int from public.sales_attribution_history where user_id = $1", [c])).toBe(3);
    expect(await val("select count(*)::int from public.audit_logs where target_id = $1::text", [c])).toBe(3);
  });

  it("shows a rep only their own customers and commissions, with limited fields", async () => {
    const mine = (await asUser(pool, repUser, (q) => q("select public.sales_my_overview() as o"))).rows[0].o;
    const theirs = (await asUser(pool, rep2User, (q) => q("select public.sales_my_overview() as o"))).rows[0].o;
    expect(mine.rep.id).toBe(repId);
    expect(mine.customers.length).toBeGreaterThan(3);
    expect(mine.customers.map((c: { email: string }) => c.email)).not.toContain("walkin@remodel.com");
    expect(theirs.customers.map((c: { email: string }) => c.email)).toEqual(["walkin@remodel.com"]);
    expect(Object.keys(mine.customers[0]).sort()).toEqual(["attributed_at", "basis_cents", "business", "email", "ended", "first_paid_at", "has_estimate", "last_paid_at", "next_anniversary", "plan", "signed_up_at", "sub_status", "tier"]);
    expect(mine.funnel.visits).toBe(1);
    expect(mine.commissions.every((c: { id: string }) => typeof c.id === "string")).toBe(true);
    const hub = (await q1("select public.admin_sales_hub($1) as h", [owner])).h;
    expect(hub.reps).toHaveLength(2);
    expect(hub.attributions.length).toBe(mine.customers.length + theirs.customers.length);
  });
});
