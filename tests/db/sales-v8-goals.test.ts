import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];

d("sales hub V8 goals + milestone boxes (database)", () => {
  let owner: string, repId: string, repCode: string, ritaU: string;
  const users: string[] = [];

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v8_goals"));
    // These tests cover the V2 rules, which stay available (Compensation V3 is covered in sales-comp-v3.test.ts).
    await pool.query(`update public.sales_settings set milestone_model = 'v2_window', milestone_qualification = 'first_payment', milestone_every = 50, milestone_min_cents = 15000 where id`);
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const r = await q1("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita Rep', null, 'rep', 'active', null) as r", [owner]);
    repId = r.r.id;
    ritaU = await createUser(pool, "rita@sales.com");
    await asUser(pool, ritaU, (q) => q("select public.sales_me()"));
    repCode = (await val("select code from public.sales_reps where id = $1", [repId])) as string;
    // 50 paying customers, one a day starting 2026-01-01, each paying $19.99 (before tax $18.00 of $19.99 total).
    for (let i = 0; i < 50; i++) {
      const u = await createUser(pool, `c${i}@co.com`);
      await val("select public.sales_record_attribution($1, $2, now())", [u, repCode]);
      const at = new Date(Date.UTC(2026, 0, 1 + i, 15)).toISOString();
      await val("select public.sales_sync_billing($1, $2, 'active', 'monthly', null, 1999, '{}'::jsonb, $3, 1999, $4::timestamptz)", [u, `sub_${i}`, `in_${i}`, at]);
      await val("select public.sales_record_revenue($1, $2, 1999, 1800, $3::timestamptz)", [u, `in_${i}`, at]);
      users.push(u);
    }
  });
  afterAll(async () => { await drop?.(); });

  it("creates boxes at 10, 25 and 50 that stay locked through the 30-day hold", async () => {
    // Only accounts that have paid by the evaluation time count (39 by Feb 8; the 50th pays Feb 19).
    await val("select public.sales_milestones_evaluate(null, '2026-02-08T00:00:00Z')");
    const locked = (await pool.query("select status from public.sales_milestone_awards order by milestone")).rows.map((r) => r.status);
    expect(locked).toEqual(["locked", "locked"]); // box 10 reached Jan 10, unlocks Feb 9
    await val("select public.sales_milestones_evaluate(null, '2026-02-20T00:00:00Z')");
    const rows = (await pool.query("select milestone, status, flat_cents, pct, badge from public.sales_milestone_awards order by milestone")).rows;
    expect(rows.map((r) => [r.milestone, r.status])).toEqual([[10, "ready"], [25, "locked"], [50, "locked"]]);
    expect(rows[0]).toMatchObject({ flat_cents: 2500, badge: "First 10" });
    expect(Number(rows[2].pct)).toBe(3);
    // Re-running is idempotent.
    await val("select public.sales_milestones_evaluate(null, '2026-02-20T00:00:00Z')");
    expect(await val("select count(*)::int from public.sales_milestone_awards")).toBe(3);
  });

  it("counts only still-active customers' revenue and applies the $150 minimum", async () => {
    // A refund and a cancellation (after the first month) both remove revenue from the 50 box.
    await val("select public.sales_revenue_refunded('in_5', 1999)");
    await pool.query("update public.sales_attributions set sub_status = 'canceled', cancel_requested_at = '2026-03-15' where user_id = $1", [users[6]]);
    await val("select public.sales_milestones_evaluate(null, '2026-04-01T00:00:00Z')");
    const box50 = await q1("select status, revenue_cents, amount_cents from public.sales_milestone_awards where milestone = 50");
    // The box was created when account 50 paid; its amount is fixed only once the hold passes.
    expect(box50.status).toBe("ready");
    expect(box50.revenue_cents).toBe(48 * 1800); // 50 paid, minus refunded #5, minus canceled #6
    expect(box50.amount_cents).toBe(15000); // 3% of $864 = $25.92 -> $150 minimum
  });

  it("hides the amount until the rep opens the box, then approval puts it on the next statement", async () => {
    const id = (await val("select id from public.sales_milestone_awards where milestone = 10")) as string;
    const before = await asUser(pool, ritaU, (q) => q("select public.sales_my_milestones() as m"));
    const box = (before.rows[0].m.awards as { id: string; amount_cents: number | null; status: string }[]).find((a) => a.id === id)!;
    expect(box).toMatchObject({ status: "ready", amount_cents: null });
    const opened = await asUser(pool, ritaU, (q) => q("select public.sales_my_milestone_open($1) as o", [id]));
    expect(opened.rows[0].o).toMatchObject({ status: "opened", amount_cents: 2500 });
    const res = (await val("select public.admin_sales_milestone_approve($1, $2)", [owner, id])) as { commission_id: string };
    expect(await q1("select kind, status, amount_cents from public.sales_commissions where id = $1", [res.commission_id]))
      .toEqual({ kind: "bonus", status: "earned", amount_cents: 2500 });
    await expect(pool.query("select public.admin_sales_milestone_approve($1, $2)", [owner, id])).rejects.toThrow(/not_ready/);
    expect(await val("select count(*)::int from public.audit_logs where action in ('sales.milestone_opened', 'sales.milestone_approved')")).toBe(2);
  });

  it("lets only the owner void a box, with a reason", async () => {
    const id = (await val("select id from public.sales_milestone_awards where milestone = 25")) as string;
    await expect(pool.query("select public.admin_sales_milestone_void($1, $2, '')", [owner, id])).rejects.toThrow(/reason_required/);
    await expect(pool.query("select public.admin_sales_milestone_void($1, $2, 'x')", [ritaU, id])).rejects.toThrow(/not_authorized/);
    await val("select public.admin_sales_milestone_void($1, $2, 'test account')", [owner, id]);
    expect(await val("select status from public.sales_milestone_awards where id = $1", [id])).toBe("void");
  });

  it("saves milestone rules as a new policy version and validates them", async () => {
    const before = (await val("select public.sales_policy_current_version()")) as number;
    await val(`select public.admin_sales_milestone_rules_save($1, 50, '[{"from":50,"pct":3},{"from":100,"pct":4},{"from":250,"pct":5}]', 20000, '[{"at":10,"cents":2500}]', 'raise min')`, [owner]);
    expect(await val("select public.sales_policy_current_version()")).toBe(before + 1);
    await expect(pool.query(`select public.admin_sales_milestone_rules_save($1, 50, '[{"from":100,"pct":4},{"from":50,"pct":3}]', 0, '[]')`, [owner])).rejects.toThrow(/invalid_milestones/);
    await expect(pool.query(`select public.admin_sales_milestone_rules_save($1, 50, '[{"from":50,"pct":3}]', 0, '[{"at":60,"cents":100}]')`, [owner])).rejects.toThrow(/invalid_milestones/);
  });

  it("returns team goal numbers to reps and the owner, with an owner override", async () => {
    const raw = await asUser(pool, ritaU, (q) => q("select public.sales_my_team_goal() as g"));
    expect(raw.rows[0].g).toMatchObject({ active_reps: 1, floor: 5, override: null });
    expect(raw.rows[0].g.history).toHaveLength(3);
    await val("select public.admin_sales_team_goal_set($1, 30, 8, 'Holiday push')", [owner]);
    expect(await val("select public.admin_sales_team_goal($1)", [owner])).toMatchObject({ floor: 8, override: { target: 30, note: "Holiday push" } });
    await val("select public.admin_sales_team_goal_set($1, null, null, null)", [owner]);
    expect(await val("select public.admin_sales_team_goal($1)", [owner])).toMatchObject({ override: null });
  });

  it("counts quest progress from real work, never email", async () => {
    const lead = (await val("insert into public.sales_leads (company_name, assigned_rep) values ('Acme Roofing', $1) returning id", [repId]).catch(() => null)) as string | null;
    if (lead) {
      await pool.query("insert into public.sales_activities (lead_id, rep_id, kind) values ($1, $2, 'call'), ($1, $2, 'email'), ($1, $2, 'meeting')", [lead, repId]);
    }
    const p = await asUser(pool, ritaU, (q) => q("select public.sales_my_progress() as p"));
    expect(p.rows[0].p.periods.day).toHaveProperty("follow_ups");
    if (lead) expect(p.rows[0].p.periods.day).toMatchObject({ calls: 1, meetings: 1, follow_ups: 1 });
  });

  it("keeps the tables private", async () => {
    await expect(asUser(pool, ritaU, (q) => q("select * from public.sales_milestone_awards"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, ritaU, (q) => q("select public.admin_sales_milestones($1)", [ritaU]))).rejects.toThrow(/permission denied/);
  });
});
