import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const TIERS = '[{"from":5,"pct":5},{"from":10,"pct":10},{"from":15,"pct":15},{"from":20,"pct":20}]';

d("sales hub V8.4 accelerators + achievements (database)", () => {
  let owner: string, adminU: string, ritaU: string, rep: string;
  const customers: string[] = [];
  const lineIds: string[] = [];

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v84"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    rep = (await q1("select public.admin_sales_member_save($1, null, 'rita@sales.com', 'Rita Rep', null, 'rep', 'active', null, true) r", [owner])).r.id;
    await q1("select public.admin_sales_member_save($1, null, 'adam@sales.com', 'Adam Admin', null, 'admin', 'active', null, false)", [owner]);
    ritaU = await createUser(pool, "rita@sales.com");
    adminU = await createUser(pool, "adam@sales.com");
    for (const u of [ritaU, adminU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
    // October 2026: 10 paid sale-month lines at $19.99, one refunded inside the hold, one anniversary.
    for (let i = 0; i < 12; i++) customers.push(await createUser(pool, `c${i}@co.com`));
    for (let i = 0; i < 10; i++) {
      lineIds.push((await val("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 1, 'commission', '2026-10-01', 1999, 'earned') returning id", [rep, customers[i]])) as string);
    }
    await pool.query("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 1, 'commission', '2026-10-01', 1999, 'canceled')", [rep, customers[10]]);
    await pool.query("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 2, 'commission', '2026-10-01', 1999, 'earned')", [rep, customers[11]]);
  });
  afterAll(async () => { await drop?.(); });

  it("picks the right tier at each threshold", async () => {
    const rate = async (n: number) => Number(await val(`select public.sales_accelerator_rate('${TIERS}'::jsonb, $1)`, [n]));
    expect(await Promise.all([0, 4, 5, 9, 10, 14, 15, 19, 20, 100].map(rate))).toEqual([0, 0, 5, 5, 10, 10, 15, 15, 20, 20]);
  });

  it("previews while the program is off and creates no money", async () => {
    await val("select public.sales_accelerators_evaluate(null, '2026-11-15T12:00:00Z')");
    const a = await q1("select status, sales_count, base_cents, rate, bonus_cents, dropped_count, dropped_base_cents from public.sales_accelerators where rep_id = $1", [rep]);
    // 10 qualifying (anniversary and refunded excluded): $199.90 x 10% = $19.99.
    expect(a).toMatchObject({ status: "open", sales_count: 10, base_cents: 19990, bonus_cents: 1999, dropped_count: 1, dropped_base_cents: 1999 });
    expect(Number(a.rate)).toBe(10);
    expect(await val("select count(*)::int from public.sales_commissions where kind = 'accelerator'")).toBe(0);
  });

  it("only the owner sets the rates, as a new policy version", async () => {
    const before = (await val("select public.sales_policy_current_version()")) as number;
    await expect(pool.query(`select public.admin_sales_accelerator_rules_save($1, true, '${TIERS}', 'x')`, [adminU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query(`select public.admin_sales_accelerator_rules_save($1, true, '[{"from":10,"pct":10},{"from":5,"pct":5}]', 'x')`, [owner])).rejects.toThrow(/invalid_tiers/);
    await val(`select public.admin_sales_accelerator_rules_save($1, true, '${TIERS}', 'Turn on accelerators')`, [owner]);
    expect(await val("select public.sales_policy_current_version()")).toBe(before + 1);
    // Turning it on starts from the current month; for the test, pretend it started in January.
    expect(await val("select accelerator_active_from is not null from public.sales_settings where id")).toBe(true);
    await pool.query("update public.sales_settings set accelerator_active_from = '2026-01-01' where id");
  });

  it("waits while any of the month's sales is still in its refund hold", async () => {
    await pool.query("update public.sales_commissions set status = 'pending' where id = $1", [lineIds[0]]);
    await val("select public.sales_accelerators_evaluate(null, '2026-11-15T12:00:00Z')");
    expect(await val("select status from public.sales_accelerators where rep_id = $1", [rep])).toBe("open");
    expect(await val("select count(*)::int from public.sales_commissions where kind = 'accelerator'")).toBe(0);
  });

  it("finalizes after the month and the hold, splitting the bonus exactly, once", async () => {
    await pool.query("update public.sales_commissions set status = 'earned' where id = $1", [lineIds[0]]);
    expect(await val("select public.sales_accelerators_evaluate(null, '2026-11-16T12:00:00Z')")).toMatchObject({ finalized: 1, lines: 10 });
    const lines = (await pool.query("select amount_cents, status, period_month::text, basis_detail from public.sales_commissions where kind = 'accelerator' order by amount_cents")).rows;
    expect(lines).toHaveLength(10);
    expect(lines.reduce((t, l) => t + l.amount_cents, 0)).toBe(1999); // not 10 x 200
    expect(lines.every((l) => l.status === "earned" && l.period_month === "2026-11-01")).toBe(true);
    // Re-running (or a retry) never pays twice.
    await val("select public.sales_accelerators_evaluate(null, '2026-11-17T12:00:00Z')");
    expect(await val("select count(*)::int from public.sales_commissions where kind = 'accelerator'")).toBe(10);
    expect(await val("select count(*)::int from public.sales_achievements where kind = 'accelerator_tier'")).toBe(1);
  });

  it("never changes a finalized month, even if a sale is canceled later", async () => {
    await pool.query("update public.sales_commissions set status = 'canceled' where id = $1", [lineIds[1]]);
    await val("select public.sales_accelerators_evaluate(null, '2026-12-02T12:00:00Z')");
    expect(await q1("select status, sales_count, bonus_cents from public.sales_accelerators where rep_id = $1 and period_month = '2026-10-01'", [rep]))
      .toMatchObject({ status: "final", sales_count: 10, bonus_cents: 1999 });
  });

  it("doesn't finalize the current month or pay months before activation", async () => {
    await pool.query("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 1, 'commission', '2026-12-01', 1999, 'earned')", [rep, await createUser(pool, "dec@co.com")]);
    await val("select public.sales_accelerators_evaluate(null, '2026-12-20T12:00:00Z')");
    expect(await val("select status from public.sales_accelerators where period_month = '2026-12-01'")).toBe("open");
    await pool.query("update public.sales_settings set accelerator_active_from = '2027-01-01' where id");
    await val("select public.sales_accelerators_evaluate(null, '2027-01-05T12:00:00Z')");
    expect(await val("select status from public.sales_accelerators where period_month = '2026-12-01'")).toBe("open");
  });

  it("records firsts and personal records against the rep's own history", async () => {
    const add = (u: string, m: string) => pool.query("insert into public.sales_attributions (user_id, rep_id, source, first_paid_at, first_paid_month) values ($1, $2, 'manual', $3::date + 1, $3::date)", [u, rep, m]);
    await add(customers[0], "2026-09-01");
    await add(customers[1], "2026-10-01");
    await add(customers[2], "2026-10-01");
    await val("select public.sales_achievements_evaluate(null, '2026-11-03T12:00:00Z')");
    const kinds = (await pool.query("select kind, period_month::text m from public.sales_achievements where kind <> 'accelerator_tier' order by kind, m")).rows;
    expect(kinds).toEqual(expect.arrayContaining([{ kind: "first_sale", m: "2026-09-01" }, { kind: "month_first_sale", m: "2026-10-01" }, { kind: "record_sales", m: "2026-10-01" }]));
    const n = await val("select count(*)::int from public.sales_achievements");
    await val("select public.sales_achievements_evaluate(null, '2026-11-03T12:00:00Z')");
    expect(await val("select count(*)::int from public.sales_achievements")).toBe(n);
  });

  it("shows the rep their own numbers and the admin the incentive view", async () => {
    const mine = (await asUser(pool, ritaU, (q) => q("select public.sales_my_accelerator('2026-11-20T12:00:00Z') a"))).rows[0].a;
    expect(mine).toMatchObject({ enabled: true });
    expect(mine.months[0]).toMatchObject({ status: "final", sales: 10, bonus_cents: 1999 });
    const rec = (await asUser(pool, ritaU, (q) => q("select public.sales_my_records('2026-11-20T12:00:00Z') r"))).rows[0].r;
    expect(rec.months).toHaveLength(13);
    const inc = (await val("select public.admin_sales_incentives($1, '2026-11-20T12:00:00Z')", [adminU])) as { accelerators: unknown[]; cost: unknown[]; achievements: { id: string }[] };
    expect(inc.accelerators.length).toBeGreaterThan(0);
    expect(inc.cost).toHaveLength(6);
    await val("select public.admin_sales_achievement_congratulate($1, $2)", [owner, inc.achievements[0].id]);
    await expect(asUser(pool, ritaU, (q) => q("select * from public.sales_accelerators"))).rejects.toThrow(/permission denied/);
    await expect(pool.query("select public.admin_sales_incentives($1)", [ritaU])).rejects.toThrow(/not_authorized/);
  });
});
