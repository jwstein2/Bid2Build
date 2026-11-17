/**
 * Saved Items favorites, company templates and scaling assemblies (20261130301000):
 *   - favorites are per user, need the library entitlement, vanish with the item/stack
 *   - scaling columns + checks
 *   - company templates: members read, only the pricing permission shares/changes/deletes
 *   - rows can't be added to someone else's stack
 *   - rollback / re-apply
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb } from "./harness";
import { asFn, fails, rowsFn, setupWorld, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("library favorites, company templates and scaling assemblies (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let free: string;
  const stack = async (u: string, name: string, extra: Record<string, unknown> = {}) => {
    const cols = ["user_id", "name", ...Object.keys(extra)];
    const vals = [u, name, ...Object.values(extra)];
    return (await as<{ id: string }>(u, `insert into public.assemblies (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals)).id;
  };
  const row = (u: string, asm: string, extra = "") => as<{ id: string }>(u, `insert into public.assembly_items (assembly_id, user_id, name, unit, quantity${extra ? ", qty_per, waste_pct, round_up" : ""}) values ($1, $2, 'Shingles', 'bundle', 1${extra}) returning id`, [asm, u]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_library_p1d"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    free = (await pool.query("insert into auth.users (email, email_confirmed_at) values ('free@x.test', now()) returning id")).rows[0].id;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("stores a scaling stack and checks its values", async () => {
    const s = await stack(w.solo, "Re-roof", { scale_unit: "square", scale_label: "Roof area", scale_calc: "roof", starter_key: "roofing-reroof" });
    await row(w.solo, s, ", 3, 10, true");
    const r = (await pool.query("select qty_per::text, waste_pct::text, round_up from public.assembly_items where assembly_id = $1", [s])).rows[0];
    expect(r).toEqual({ qty_per: "3.000000", waste_pct: "10.00", round_up: true });
    expect(await fails(stack(w.solo, "Bad", { scale_unit: "acre", scale_label: "x" }))).toMatch(/assemblies_scale_unit_check/);
    expect(await fails(stack(w.solo, "No label", { scale_unit: "square" }))).toMatch(/assemblies_scale_label_check/);
    expect(await fails(row(w.solo, s, ", 1, 150, false"))).toMatch(/assembly_items_waste_check/);
    // Old stacks (no scale) are untouched by the new columns.
    const plain = await stack(w.solo, "Plain");
    await row(w.solo, plain);
    expect((await pool.query("select qty_per, waste_pct::text, round_up from public.assembly_items where assembly_id = $1", [plain])).rows[0]).toEqual({ qty_per: null, waste_pct: "0.00", round_up: false });
  });

  it("favorites are per user, need the entitlement, and go with their item or stack", async () => {
    const item = (await as<{ id: string }>(w.solo, "insert into public.saved_items (user_id, name, unit) values ($1, 'Drip edge', 'linear foot') returning id", [w.solo])).id;
    const s = await stack(w.solo, "Fav stack");
    await as(w.solo, "insert into public.library_favorites (user_id, saved_item_id) values ($1, $2)", [w.solo, item]);
    await as(w.solo, "insert into public.library_favorites (user_id, assembly_id) values ($1, $2)", [w.solo, s]);
    expect(await fails(as(w.solo, "insert into public.library_favorites (user_id, saved_item_id) values ($1, $2)", [w.solo, item]))).toMatch(/duplicate key/);
    expect(await fails(as(w.solo, "insert into public.library_favorites (user_id, saved_item_id, assembly_id) values ($1, $2, $3)", [w.solo, item, s]))).toMatch(/library_favorites_one_target/);
    // Someone else's item can't be starred, and nobody sees another user's stars.
    expect(await fails(as(w.owner, "insert into public.library_favorites (user_id, saved_item_id) values ($1, $2)", [w.owner, item]))).toMatch(/row-level security/);
    expect(await rows(w.owner, "select 1 from public.library_favorites")).toHaveLength(0);
    // Free accounts can't star.
    const fi = (await pool.query("insert into public.saved_items (user_id, name, unit) values ($1, 'Old', 'each') returning id", [free])).rows[0].id;
    expect(await fails(as(free, "insert into public.library_favorites (user_id, saved_item_id) values ($1, $2)", [free, fi]))).toMatch(/row-level security/);
    await as(w.solo, "delete from public.saved_items where id = $1", [item]);
    await as(w.solo, "delete from public.assemblies where id = $1", [s]);
    expect(await rows(w.solo, "select 1 from public.library_favorites")).toHaveLength(0);
  });

  it("company templates: members read them, only the pricing permission shares, changes or deletes them", async () => {
    // A manager without the pricing permission can't share.
    const mine = await stack(w.bk, "Bo's deck package");
    expect(await fails(as(w.bk, "update public.assemblies set company_id = $2 where id = $1", [mine, w.company]))).toMatch(/company_template_locked/);
    expect(await fails(stack(w.bk, "Sneaky", { company_id: w.company }))).toMatch(/company_template_locked/);
    // The owner shares one; every active member reads it and its rows; another company does not.
    const tpl = await stack(w.owner, "Acme re-roof", { company_id: w.company, scale_unit: "square", scale_label: "Roof area" });
    await row(w.owner, tpl, ", 3, 10, true");
    expect(await rows(w.rep, "select name from public.assemblies where id = $1", [tpl])).toHaveLength(1);
    expect(await rows(w.viewer, "select 1 from public.assembly_items where assembly_id = $1", [tpl])).toHaveLength(1);
    expect(await rows(w.rival, "select 1 from public.assemblies where id = $1", [tpl])).toHaveLength(0);
    // Members can star it for themselves.
    await as(w.rep, "insert into public.library_favorites (user_id, assembly_id) values ($1, $2)", [w.rep, tpl]);
    // Members without the permission can't rename, delete, or add rows.
    expect(await rows(w.rep, "update public.assemblies set name = 'x' where id = $1 returning id", [tpl])).toHaveLength(0);
    expect(await rows(w.bk, "delete from public.assemblies where id = $1 returning id", [tpl])).toHaveLength(0);
    expect(await fails(row(w.rep, tpl))).toMatch(/company_template_locked/);
    // Granting the permission lets a manager change and scale it.
    await pool.query("update public.company_members set permissions_granted = array['manage_company_pricing'] where user_id = $1", [w.bk]);
    expect(await rows(w.bk, "update public.assemblies set name = 'Acme re-roof v2' where id = $1 returning id", [tpl])).toHaveLength(1);
    expect(await rows(w.bk, "update public.assembly_items set qty_per = 3.1 where assembly_id = $1 returning id", [tpl])).toHaveLength(1);
    // The creator who loses the permission can't take it back private or delete it.
    await pool.query("update public.company_members set permissions_granted = '{}', permissions_revoked = array['manage_company_pricing'] where user_id = $1", [w.bk]);
    const bkTpl = (await pool.query("insert into public.assemblies (user_id, name, company_id) values ($1, 'Bo shared', $2) returning id", [w.bk, w.company])).rows[0].id;
    expect(await fails(as(w.bk, "update public.assemblies set company_id = null where id = $1", [bkTpl]))).toMatch(/company_template_locked/);
    expect(await fails(as(w.bk, "delete from public.assemblies where id = $1", [bkTpl]))).toMatch(/company_template_locked/);
    expect(await rows(w.owner, "delete from public.assemblies where id = $1 returning id", [bkTpl])).toHaveLength(1);
  });

  it("rows can't be added to someone else's private stack", async () => {
    const s = await stack(w.solo, "Solo stack");
    expect(await fails(row(w.owner, s))).toMatch(/company_template_locked/);
  });

  it("rollback keeps every stack (templates go private) and the migration re-applies", async () => {
    const before = Number((await pool.query("select count(*) n from public.assemblies")).rows[0].n);
    await pool.query(readFileSync("docs/financials/rollback_20261130301000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.library_favorites') t")).rows[0].t).toBeNull();
    expect(Number((await pool.query("select count(*) n from public.assemblies")).rows[0].n)).toBe(before);
    const up = readFileSync("supabase/migrations/20261130301000_library_favorites_assemblies.sql", "utf8");
    await pool.query(up); await pool.query(up);
    const s = await stack(w.solo, "After", { scale_unit: "square foot", scale_label: "Wall area" });
    await row(w.solo, s, ", 0.01, 10, true");
    expect((await pool.query("select count(*) n from public.assembly_items where assembly_id = $1", [s])).rows[0].n).toBe("1");
  });
});
