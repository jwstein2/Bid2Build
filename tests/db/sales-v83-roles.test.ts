import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const caps = async (u: string) => (await val("select public.sales_capabilities($1)", [u])) as string[];
const save = (caller: string, id: string | null, email: string, name: string, role: string, status = "active", sells = true) =>
  pool.query("select public.admin_sales_member_save($1, $2, $3, $4, null, $5, $6, null, $7) as r", [caller, id, email, name, role, status, sells]);

d("sales hub V8.3 dual roles (database)", () => {
  let owner: string, sarahU: string, adamU: string, dualU: string, entU: string;
  let sarah: string, adam: string, dual: string, ownerRep: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v83_roles"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    sarah = (await save(owner, null, "sarah@sales.com", "Sarah Rep", "rep")).rows[0].r.id;
    adam = (await save(owner, null, "adam@sales.com", "Adam Admin", "admin", "active", false)).rows[0].r.id;
    dual = (await save(owner, null, "dana@sales.com", "Dana Both", "admin", "active", true)).rows[0].r.id;
    // The platform owner can also sell (V8.3), using their own login.
    ownerRep = (await save(owner, null, "owner@built2bid.org", "Owner Sells", "rep")).rows[0].r.id;
    sarahU = await createUser(pool, "sarah@sales.com");
    adamU = await createUser(pool, "adam@sales.com");
    dualU = await createUser(pool, "dana@sales.com");
    entU = await createUser(pool, "enterprise-admin@co.com");
    for (const u of [sarahU, adamU, dualU, owner]) await asUser(pool, u, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("computes capabilities for every role combination", async () => {
    const rep = await caps(sarahU);
    expect(rep).toContain("view_own_leads");
    expect(rep).not.toContain("view_admin_hub");

    const admin = await caps(adamU); // Sales Admin only
    expect(admin).toContain("view_all_reps");
    expect(admin).not.toContain("view_own_leads");
    expect(admin).not.toContain("edit_commission_policies");
    expect(admin).not.toContain("payout_operations");

    const both = await caps(dualU); // Rep + Sales Admin
    expect(both).toEqual(expect.arrayContaining(["view_own_leads", "view_all_reps", "approve_commissions"]));
    expect(both).not.toContain("adjust_commissions");

    const own = await caps(owner); // Platform Owner + Rep
    expect(own).toEqual(expect.arrayContaining(["view_own_leads", "view_admin_hub", "edit_commission_policies", "payout_operations"]));

    // An Enterprise company admin (or any customer) gets nothing here.
    expect(await caps(entU)).toEqual([]);
    expect(await asUser(pool, adamU, async (q) => (await q("select public.sales_my_capabilities() c")).rows[0].c)).toContain("view_admin_hub");
  });

  it("reports sells on sales_me so admin-only members get no personal hub", async () => {
    const me = await asUser(pool, adamU, (q) => q("select public.sales_me() m"));
    expect(me.rows[0].m).toMatchObject({ role: "admin", sells: false });
    await expect(save(owner, null, "x@sales.com", "Bad", "rep", "active", false).then((r) => r.rows[0].r.sells)).resolves.toBe(true);
  });

  it("lets a Sales Admin run the team but not policy, adjustments or payouts", async () => {
    await expect(pool.query("select public.admin_sales_hub($1)", [adamU])).resolves.toBeTruthy();
    await expect(pool.query("select public.admin_sales_hub($1)", [sarahU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query("select public.admin_sales_hub($1)", [entU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 3, 90, true, 'x', true)", [adamU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query(`select public.admin_sales_milestone_rules_save($1, 50, '[{"from":50,"pct":3}]', 15000, '[]')`, [adamU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query("select public.admin_sales_payout_record($1, gen_random_uuid(), 'ach', null, null)", [adamU])).rejects.toThrow(/not_authorized/);
    await expect(pool.query("select public.admin_sales_commission_set($1, gen_random_uuid(), 'canceled', null, 'x')", [adamU])).rejects.toThrow(/not_authorized/);
    // The owner still can.
    await expect(pool.query("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 3, 90, true, 'v83 test', true)", [owner])).resolves.toBeTruthy();
    // A Sales Admin can add reps, but only the owner grants the Sales Admin role.
    await expect(save(adamU, null, "new@sales.com", "New Rep", "rep")).resolves.toBeTruthy();
    await expect(save(adamU, null, "admin2@sales.com", "Another Admin", "admin")).rejects.toThrow(/owner_only/);
    await expect(save(adamU, dual, "dana@sales.com", "Dana Both", "rep")).rejects.toThrow(/owner_only/);
    await expect(save(dualU, dual, "dana@sales.com", "Dana Both", "admin", "active", true)).rejects.toThrow(/owner_only|cannot_edit_self/);
  });

  it("blocks a Sales Admin from approving their own statement", async () => {
    await pool.query("insert into public.sales_statements (rep_id, period_month) values ($1, '2026-10-01'), ($2, '2026-10-01')", [dual, sarah]);
    const own = (await val("select id from public.sales_statements where rep_id = $1", [dual])) as string;
    const other = (await val("select id from public.sales_statements where rep_id = $1", [sarah])) as string;
    await expect(pool.query("select public.admin_sales_statement_approve($1, $2)", [dualU, own])).rejects.toThrow(/cannot_approve_own/);
    await expect(pool.query("select public.admin_sales_statement_approve($1, $2)", [dualU, other])).resolves.toBeTruthy();
  });

  it("lists notifications once, by category, never offering your own pay for approval", async () => {
    await pool.query("update public.sales_statements set total_cents = 500 where status = 'open'");
    await pool.query("insert into public.sales_statements (rep_id, period_month, total_cents) values ($1, '2026-09-01', 700)", [dual]);
    const dana = (await asUser(pool, dualU, (q) => q("select public.sales_my_notifications() n"))).rows[0].n as { category: string; kind: string; count: number }[];
    const admin = dana.filter((i) => i.category === "admin");
    // Dana's own open statements (Oct + Sep) are not in her admin list; Sarah's was approved in the previous test.
    expect(admin.find((i) => i.kind === "statements_to_approve")).toBeUndefined();
    expect(new Set(dana.map((i) => i.kind)).size).toBe(dana.length);
    const own = (await asUser(pool, owner, (q) => q("select public.sales_my_notifications() n"))).rows[0].n as { kind: string; count: number }[];
    expect(own.find((i) => i.kind === "statements_to_approve")?.count).toBe(2);
    expect(own.find((i) => i.kind === "payouts_to_record")?.count).toBe(1);
    const sarahN = (await asUser(pool, sarahU, (q) => q("select public.sales_my_notifications() n"))).rows[0].n as { category: string }[];
    expect(sarahN.every((i) => i.category === "personal")).toBe(true);
  });

  it("keeps personal views isolated and attributes admin lead actions to the admin", async () => {
    const lead = (await val("insert into public.sales_leads (company_name, assigned_rep) values ('Sarah Lead Co', $1) returning id", [sarah])) as string;
    await pool.query("insert into public.sales_activities (lead_id, rep_id, kind) values ($1, $2, 'call'), ($1, $2, 'email')", [lead, sarah]);
    // Dana's personal hub (rep view) never shows Sarah's lead, even though Dana is a Sales Admin.
    const mine = await asUser(pool, dualU, (q) => q("select public.sales_crm_leads() l"));
    expect(JSON.stringify(mine.rows[0].l ?? [])).not.toContain("Sarah Lead Co");
    // Reassigning through the admin API records Dana as the actor.
    await pool.query("select public.admin_sales_crm_assign($1, $2, $3)", [dualU, [lead], dual]);
    expect(await val("select actor_id from public.sales_activities where lead_id = $1 and kind = 'assignment' order by id desc limit 1", [lead])).toBe(dualU);
  });

  it("returns analytics and rep detail through admin APIs, logging each detail view", async () => {
    const a = (await val("select public.admin_sales_analytics($1, now() - interval '30 days', now())", [adamU])) as { reps: { id: string; is_admin_rep: boolean; metrics: Record<string, number> }[] };
    const ids = a.reps.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([sarah, dual, ownerRep]));
    expect(ids).not.toContain(adam); // admin-only members don't sell
    expect(a.reps.find((r) => r.id === dual)?.is_admin_rep).toBe(true);
    expect(a.reps.find((r) => r.id === ownerRep)?.is_admin_rep).toBe(true);
    expect(a.reps.find((r) => r.id === sarah)?.metrics).toMatchObject({ calls: 1, emails: 1, contacted: 1 });
    const det = (await val("select public.admin_sales_rep_detail($1, $2, now() - interval '30 days', now())", [adamU, sarah])) as { rep: { full_name: string }; weeks: unknown[] };
    expect(det.rep.full_name).toBe("Sarah Rep");
    expect(det.weeks).toHaveLength(12);
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.rep_detail_viewed' and actor_id = $1", [adamU])).toBe(1);
    await expect(pool.query("select public.admin_sales_rep_detail($1, $2, now() - interval '30 days', now())", [sarahU, dual])).rejects.toThrow(/not_authorized/);
  });

  it("revokes admin access the moment the role is removed or the member is suspended", async () => {
    await save(owner, dual, "dana@sales.com", "Dana Both", "rep");
    expect(await caps(dualU)).not.toContain("view_admin_hub");
    await expect(pool.query("select public.admin_sales_hub($1)", [dualU])).rejects.toThrow(/not_authorized/);
    await save(owner, adam, "adam@sales.com", "Adam Admin", "admin", "suspended", false);
    expect(await caps(adamU)).toEqual([]);
  });

  it("keeps the new functions off the browser", async () => {
    await expect(asUser(pool, sarahU, (q) => q("select public.sales_capabilities($1)", [sarahU]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, owner, (q) => q("select public.admin_sales_analytics($1, now(), now())", [owner]))).rejects.toThrow(/permission denied/);
    await expect(pool.query("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 3, 90, true)", [owner])).rejects.toThrow(/does not exist|permission/);
  });
});
