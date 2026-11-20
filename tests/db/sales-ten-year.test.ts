import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

/**
 * Ten-year recurring term (20270209001000): only the duration changes. One commission per eligible year, at the
 * value in force at each anniversary, never up front or monthly; per-customer term survives later policy changes;
 * the clock never restarts; no lines are created by the migration itself.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const MIG = "20270209001000_sales_ten_year_term.sql";

d("sales ten-year term (database)", () => {
  let owner: string, repId: string, repCode: string, repUser: string;
  const attribute = async (email: string) => {
    const u = await createUser(pool, email);
    expect(await val("select public.sales_record_attribution($1, $2, now())", [u, repCode])).toBe("recorded");
    return u;
  };
  const pay = (u: string, inv: string, paidAt: string, basis = 1999, status = "active") =>
    val("select public.sales_sync_billing($1, $2, $5, 'monthly', null, $6, '{}'::jsonb, $3, $6, $4::timestamptz)", [u, `sub_${u}`, inv, paidAt, status, basis]);
  const lines = async (u: string) => (await pool.query("select year_no, period_month::text m, amount_cents, status, reason from public.sales_commissions where user_id = $1 and kind = 'commission' order by year_no", [u])).rows;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_ten_year"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const r = await q1("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita Rep', null, 'rep', 'active', null) as r", [owner]);
    repId = r.r.id;
    repUser = await createUser(pool, "rita@sales.com");
    await asUser(pool, repUser, (q) => q("select public.sales_me()"));
    repCode = await val("select code from public.sales_reps where id = $1", [repId]) as string;
  });
  afterAll(async () => { await drop?.(); });

  it("sets the policy to 10 years as a new version and changes no other rule", async () => {
    const versions = await val("select public.admin_sales_policy_versions($1)", [owner]) as { version: number; policy: Record<string, unknown>; note: string }[];
    const [cur, prev] = versions;
    expect(cur.note).toMatch(/Ten-year recurring term/);
    expect(cur.policy.commission_years).toBe(10);
    expect(prev.policy.commission_years).toBe(3);
    expect({ ...cur.policy, commission_years: null }).toEqual({ ...prev.policy, commission_years: null });
    // Re-running the migration is a no-op (no extra version, no lines).
    await applyMigration(pool, MIG);
    expect(await val("select public.sales_policy_current_version()")).toBe(cur.version);
    expect(await val("select count(*)::int from public.sales_commissions")).toBe(0);
  });

  it("pays once a year for 10 years at the anniversary value; year 11 is past the term; monthly payments in between pay nothing", async () => {
    const c = await attribute("ten@deck.com");
    expect(await pay(c, "in_1", "2027-01-10T15:00:00Z", 5000)).toEqual({ action: "created_year_1" });
    expect(await pay(c, "in_1", "2027-01-10T15:00:00Z", 5000)).toEqual({ action: "synced" }); // duplicate webhook
    for (let m = 2; m <= 12; m++) expect(await pay(c, `in_m${m}`, `2027-${String(m).padStart(2, "0")}-10T15:00:00Z`, 5000)).toEqual({ action: "synced" });
    // Upgrade to $70 before year 2: year 2 uses $70.
    expect(await pay(c, "in_y2", "2028-01-10T15:00:00Z", 7000)).toEqual({ action: "created_year_2" });
    for (let y = 3; y <= 10; y++) expect(await pay(c, `in_y${y}`, `${2026 + y}-01-10T15:00:00Z`, 7000)).toEqual({ action: `created_year_${y}` });
    expect(await pay(c, "in_y11", "2037-01-10T15:00:00Z", 7000)).toEqual({ action: "synced", reason: "past_commission_term" });
    const rows = await lines(c);
    expect(rows.map((r) => r.year_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[0].amount_cents).toBe(5000);
    expect(rows.slice(1).every((r) => r.amount_cents === 7000)).toBe(true);
    expect(rows[9].m).toBe("2036-01-01");
    expect(await val("select commission_term_years from public.sales_attributions where user_id = $1", [c])).toBe(10);
  });

  it("never restarts the clock after cancel + reactivation, and a missed anniversary is ineligible, not paid later", async () => {
    const c = await attribute("back@roof.com");
    await pay(c, "in_a1", "2027-03-05T15:00:00Z");
    await pool.query("update public.sales_attributions set sub_status = 'canceled' where user_id = $1", [c]);
    await val("select public.sales_close_month('2028-04-02T12:00:00Z')");
    expect((await lines(c)).find((r) => r.year_no === 2)).toMatchObject({ status: "ineligible", reason: "no_paid_invoice_in_anniversary_month", amount_cents: 0 });
    // Comes back in June 2028 (not an anniversary month): nothing; pays in March 2029 => year 3 (clock from 2027-03).
    expect(await pay(c, "in_back", "2028-06-05T15:00:00Z")).toEqual({ action: "synced" });
    expect(await pay(c, "in_a3", "2029-03-05T15:00:00Z")).toEqual({ action: "created_year_3" });
    expect(await val("select first_paid_month::text from public.sales_attributions where user_id = $1", [c])).toBe("2027-03-01");
  });

  it("keeps a customer's term when the policy is later shortened (term is vested per customer)", async () => {
    const c = await attribute("vested@hvac.com");
    await pay(c, "in_v1", "2027-05-05T15:00:00Z");
    await val("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 3, 90, false, 'test shorten', true)", [owner]);
    expect(await pay(c, "in_v5", "2031-05-05T15:00:00Z")).toEqual({ action: "created_year_5" });
    const later = await attribute("later@hvac.com");
    await pay(later, "in_l1", "2027-06-05T15:00:00Z");
    expect(await val("select commission_term_years from public.sales_attributions where user_id = $1", [later])).toBe(3);
    expect(await pay(later, "in_l4", "2030-06-05T15:00:00Z")).toEqual({ action: "synced", reason: "past_commission_term" });
    await val("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 10, 90, false, 'restore', true)", [owner]);
  });

  it("shows the rep their portfolio with per-customer term and lines; customers can't call it", async () => {
    const p = (await asUser(pool, repUser, (q) => q("select public.sales_my_portfolio() as p"))).rows[0].p;
    expect(p.policy_years).toBe(10);
    const ten = p.customers.find((c: { email: string }) => c.email === "ten@deck.com");
    expect(ten).toMatchObject({ term_years: 10, first_paid_month: "2027-01-01" });
    expect(ten.lines).toHaveLength(10);
    expect(ten.key).toMatch(/^[0-9a-f]{10}$/);
    expect(JSON.stringify(p)).not.toMatch(/user_id|stripe/);
    const stranger = await createUser(pool, "x@y.com");
    await expect(asUser(pool, stranger, (q) => q("select public.sales_my_portfolio()"))).rejects.toThrow(/not_sales_staff/);
  });

  it("records an immutable, text-hashed amendment acceptance; owner sees who accepted", async () => {
    const list = (await asUser(pool, repUser, (q) => q("select public.sales_my_amendments() as a"))).rows[0].a;
    expect(list).toHaveLength(1);
    const a = list[0];
    expect(a).toMatchObject({ code: "ten_year_term", legal_status: "draft_pending_counsel", accepted_at: null });
    await expect(asUser(pool, repUser, (q) => q("select public.sales_my_amendment_accept($1, $2, 'Rita Rep')", [a.id, "0".repeat(64)]))).rejects.toThrow(/agreement_changed/);
    const sha = createHash("sha256").update(a.body, "utf8").digest("hex");
    await asUser(pool, repUser, (q) => q("select public.sales_my_amendment_accept($1, $2, 'Rita Rep')", [a.id, sha]));
    await asUser(pool, repUser, (q) => q("select public.sales_my_amendment_accept($1, $2, 'Rita Rep')", [a.id, sha])); // idempotent
    expect(await val("select count(*)::int from public.sales_amendment_acceptances")).toBe(1);
    await expect(pool.query("update public.sales_amendment_acceptances set typed_name = 'X'")).rejects.toThrow(/immutable_record/);
    const adm = await val("select public.admin_sales_amendments($1)", [owner]) as { accepted: { rep: string }[] }[];
    expect(adm[0].accepted.map((x) => x.rep)).toEqual(["Rita Rep"]);
    await expect(q1("select public.admin_sales_amendments($1)", [repUser])).rejects.toThrow(/not_authorized/);
    await expect(asUser(pool, repUser, (q) => q("select public.admin_sales_amendments($1)", [owner]))).rejects.toThrow(/permission denied/);
  });
});
