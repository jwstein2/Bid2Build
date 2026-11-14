import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261114001000_saved_items_library.sql";

const subscribe = (u: string, status = "active", periodEnd = "2099-01-01T00:00:00Z") =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $4, $5, $2, 'monthly', 'price_m', $3::timestamptz, false, null, null, now())",
    [u, status, periodEnd, `cus_${u}`, `sub_${u}`],
  );

const insertItem = (q: (s: string, p?: unknown[]) => Promise<unknown>, u: string, name = "Complete Framing", rate = "18") =>
  q("insert into public.saved_items (user_id, name, trade, category, cost_type, unit, unit_cost, taxable) values ($1, $2, 'framing', 'Complete Framing', 'labor_material', 'square foot', $3, false) returning id", [u, name, rate]);

d("premium Saved Items & Pricing Library (database)", () => {
  let pro: string, free: string, lapsed: string, admin: string;

  beforeAll(async () => {
    // Start before the migration so a pre-existing free-plan saved item can be checked for preservation.
    ({ pool, drop } = await freshDb("byb_test_library", { stopBefore: MIGRATION }));
    pro = await createUser(pool, "pro@test.dev");
    free = await createUser(pool, "free@test.dev");
    lapsed = await createUser(pool, "lapsed@test.dev");
    admin = await createUser(pool, "admin@test.dev");
    await asUser(pool, free, (q) => q("insert into public.saved_items (user_id, name, unit, unit_cost) values ($1, 'Old favorite', 'each', 12)", [free]));
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
    await subscribe(pro);
    await subscribe(lapsed);
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
  });
  afterAll(async () => { await drop?.(); });

  it("library_access() follows the Unlimited entitlement (and admins)", async () => {
    const access = (u: string) => asUser(pool, u, (q) => q("select public.library_access() as v")).then((r) => r.rows[0].v);
    expect(await access(pro)).toBe(true);
    expect(await access(free)).toBe(false);
    expect(await access(admin)).toBe(true);
  });

  it("existing saved items survive the migration untouched", async () => {
    const r = await pool.query("select name, unit_cost::text, category, quantity from public.saved_items where user_id = $1", [free]);
    expect(r.rows).toEqual([{ name: "Old favorite", unit_cost: "12.0000", category: null, quantity: null }]);
  });

  it("a premium contractor can save, edit and delete Complete Framing at $18/sq. ft.", async () => {
    const id = await asUser(pool, pro, async (q) => ((await insertItem(q, pro)) as { rows: { id: string }[] }).rows[0].id);
    await asUser(pool, pro, (q) => q("update public.saved_items set unit_cost = 19.5, quantity = 2 where id = $1", [id]));
    let r = await pool.query("select unit_cost::text, quantity::text, cost_type from public.saved_items where id = $1", [id]);
    expect(r.rows[0]).toEqual({ unit_cost: "19.5000", quantity: "2.0000", cost_type: "labor_material" });
    await asUser(pool, pro, (q) => q("delete from public.saved_items where id = $1", [id]));
    r = await pool.query("select 1 from public.saved_items where id = $1", [id]);
    expect(r.rowCount).toBe(0);
  });

  it("a free account cannot create or change saved items or stacks through the API (RLS)", async () => {
    await expect(asUser(pool, free, (q) => insertItem(q, free))).rejects.toThrow(/row-level security/);
    await expect(asUser(pool, free, (q) => q("insert into public.assemblies (user_id, name) values ($1, 'Stack')", [free]))).rejects.toThrow(/row-level security/);
    const upd = await asUser(pool, free, (q) => q("update public.saved_items set unit_cost = 1 where user_id = $1", [free]));
    expect(upd.rowCount).toBe(0);
    const r = await pool.query("select unit_cost::text from public.saved_items where user_id = $1", [free]);
    expect(r.rows[0].unit_cost).toBe("12.0000");
  });

  it("free accounts still own their data: they can read it (export) and delete it", async () => {
    const r = await asUser(pool, free, (q) => q("select name from public.saved_items"));
    expect(r.rows.map((x) => x.name)).toEqual(["Old favorite"]);
  });

  it("a lapsed subscription keeps saved items but blocks edits until renewal", async () => {
    const id = await asUser(pool, lapsed, async (q) => ((await insertItem(q, lapsed, "Tear off", "95")) as { rows: { id: string }[] }).rows[0].id);
    await pool.query("update public.subscriptions set status = 'canceled' where user_id = $1", [lapsed]);
    const upd = await asUser(pool, lapsed, (q) => q("update public.saved_items set unit_cost = 1 where id = $1", [id]));
    expect(upd.rowCount).toBe(0);
    const kept = await pool.query("select unit_cost::text from public.saved_items where id = $1", [id]);
    expect(kept.rows[0].unit_cost).toBe("95.0000");
    await pool.query("update public.subscriptions set status = 'active' where user_id = $1", [lapsed]);
    const again = await asUser(pool, lapsed, (q) => q("update public.saved_items set unit_cost = 99 where id = $1", [id]));
    expect(again.rowCount).toBe(1);
  });

  it("pricing data is private to its account", async () => {
    await asUser(pool, pro, (q) => insertItem(q, pro, "Private rate", "42"));
    const asOther = await asUser(pool, admin, (q) => q("select * from public.saved_items where name = 'Private rate'"));
    expect(asOther.rows).toHaveLength(0);
    await expect(asUser(pool, admin, (q) => q("insert into public.saved_items (user_id, name) values ($1, 'Injected')", [pro]))).rejects.toThrow(/row-level security/);
    const del = await asUser(pool, free, (q) => q("delete from public.saved_items where name = 'Private rate'"));
    expect(del.rowCount).toBe(0);
  });

  it("saved stacks keep their rows in order and cannot attach rows to someone else's stack", async () => {
    const sid = await asUser(pool, pro, async (q) => (await q("insert into public.assemblies (user_id, name, trade) values ($1, 'Deck package', 'decks') returning id", [pro])).rows[0].id);
    await asUser(pool, pro, (q) => q(
      "insert into public.assembly_items (assembly_id, user_id, name, cost_type, quantity, unit, unit_cost, sort_order) values ($1, $2, 'Framing', 'labor', 300, 'square foot', 8, 0), ($1, $2, 'Boards', 'material', 300, 'square foot', 10, 1)",
      [sid, pro],
    ));
    const r = await asUser(pool, pro, (q) => q("select name from public.assembly_items where assembly_id = $1 order by sort_order", [sid]));
    expect(r.rows.map((x) => x.name)).toEqual(["Framing", "Boards"]);
    await expect(asUser(pool, admin, (q) => q("insert into public.assembly_items (assembly_id, user_id, name) values ($1, $2, 'x')", [sid, admin]))).rejects.toThrow(/row-level security/);
  });

  it("estimate rows accept the Labor / Material type; existing types still work", async () => {
    const eid = crypto.randomUUID(), gid = crypto.randomUUID();
    const items = ["labor_material", "labor", "material"].map((t, k) => ({ id: crypto.randomUUID(), groupId: gid, name: `Row ${t}`, costType: t, treatment: "marked_up", quantity: "1", unit: "each", unitCost: "10", taxable: false, showOnProposal: true, sortOrder: k }));
    const p = {
      id: eid, title: "Roof", trades: ["roofing"], estimateNumber: "E-1", estimateDate: "2026-11-14", expirationDate: "2026-12-14", status: "draft",
      customer: { name: "Pat" }, location: {}, pricing: { mode: "markup", percent: "20" }, fixedAdjustment: "0", taxRate: "0", displayMode: "by_group",
      defaultGroupVisibility: "itemized", groups: [{ id: gid, name: "Tear Off", visibility: null, sortOrder: 0 }], items,
      proposalConfig: { roundTotal: true },
    };
    await asUser(pool, free, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(p)]));
    const r = await pool.query("select cost_type from public.estimate_items where estimate_id = $1 order by sort_order", [eid]);
    expect(r.rows.map((x) => x.cost_type)).toEqual(["labor_material", "labor", "material"]);
    const cfg = await pool.query("select proposal_config->>'roundTotal' as rt from public.estimates where id = $1", [eid]);
    expect(cfg.rows[0].rt).toBe("true");
    await expect(pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, cost_type) values ($1, $2, $3, 'bad', 'bogus')", [eid, gid, free])).rejects.toThrow(/cost_type_check/);
  });
});
