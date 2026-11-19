import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const NOW = "2026-11-20T18:00:00Z";

d("sales hub V8.4 P3 goals, team wins and the owner digest (database)", () => {
  let owner: string, ritaU: string, samU: string, rita: string, sam: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v84_biz"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string) =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'active', null, true) r", [owner, email, name])).r.id as string;
    rita = await member("rita@sales.com", "Rita Rep");
    sam = await member("sam@sales.com", "Sam Seller");
    ritaU = await createUser(pool, "rita@sales.com");
    samU = await createUser(pool, "sam@sales.com");
    for (const u of [ritaU, samU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
    const c1 = await createUser(pool, "c1@co.com"), c2 = await createUser(pool, "c2@co.com");
    for (const c of [c1, c2]) await pool.query("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 1, 'commission', '2026-11-01', 1999, 'pending')", [rita, c]);
    await pool.query("insert into public.sales_customer_successes (rep_id, user_id, kind, occurred_at, detected_at) values ($1, $2, 'onboarding_complete', '2026-11-18', $3), ($4, $5, 'onboarding_complete', '2026-11-18', $3)", [rita, c1, NOW, sam, c2]);
  });
  afterAll(async () => { await drop?.(); });

  it("tracks self-chosen goals against real activity, with last month as a reference only", async () => {
    await asUser(pool, ritaU, async (q) => {
      await q("select public.sales_my_goal_save('new_sales', 3, $1)", [NOW]);
      await q("select public.sales_my_goal_save('earnings', 5000, $1)", [NOW]);
      await q("select public.sales_my_goal_save('new_sales', 2, $1)", [NOW]); // edit, not duplicate
    });
    const g = (await asUser(pool, ritaU, (q) => q("select public.sales_my_goals($1) g", [NOW]))).rows[0].g;
    expect(g.goals).toHaveLength(2);
    expect(g.goals.find((x: { kind: string }) => x.kind === "new_sales")).toMatchObject({ target: 2, progress: 2 });
    expect(g.goals.find((x: { kind: string }) => x.kind === "earnings")).toMatchObject({ target: 5000, progress: 3998 });
    expect(g.last_month).toMatchObject({ new_sales: 0 });
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_my_goal_save('calls_per_day', 50, $1)", [NOW]))).rejects.toThrow(/check constraint/);
    // Sam can't see or delete Rita's goals.
    expect((await asUser(pool, samU, (q) => q("select public.sales_my_goals($1) g", [NOW]))).rows[0].g.goals).toEqual([]);
    await asUser(pool, samU, (q) => q("select public.sales_my_goal_delete($1)", [g.goals[0].id]));
    expect(await val("select count(*)::int from public.sales_rep_goals")).toBe(2);
  });

  it("shows team wins only for reps who opted in, with no amounts", async () => {
    const wins = async (u: string) => (await asUser(pool, u, (q) => q("select public.sales_team_wins($1) w", [NOW]))).rows[0].w as { rep: string }[];
    expect(await wins(samU)).toEqual([]);
    await asUser(pool, ritaU, (q) => q("select public.sales_my_preferences_save('{}', 'skipped', true, true, true, null, true)"));
    const w = await wins(samU);
    expect(w.map((x) => x.rep)).toEqual(["Rita"]);
    expect(JSON.stringify(w)).not.toMatch(/cents|amount|Seller/);
  });

  it("sends the owner digest once a week, only when turned on", async () => {
    expect(await val("select public.sales_digest_claim($1)", [NOW])).toBeNull();
    await expect(pool.query("select public.admin_sales_digest_settings_save($1, true)", [ritaU])).rejects.toThrow(/not_authorized/);
    await pool.query("select public.admin_sales_digest_settings_save($1, true)", [owner]);
    const dg = (await val("select public.sales_digest_claim($1)", [NOW])) as { successes: unknown[]; awaiting: { not_congratulated: number } };
    expect(dg.successes).toHaveLength(2);
    expect(dg.awaiting.not_congratulated).toBe(2);
    expect(await val("select public.sales_digest_claim($1)", ["2026-11-21T18:00:00Z"])).toBeNull(); // same week
    expect(await val("select public.sales_digest_claim($1)", ["2026-11-23T18:00:00Z"])).not.toBeNull(); // next Monday
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_recognition_digest(now())"))).rejects.toThrow(/permission denied/);
  });
});
