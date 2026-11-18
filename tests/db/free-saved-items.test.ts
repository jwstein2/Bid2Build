import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

/** V8 batch 5 (LIB-2): free accounts can save their own items (cap 250); stacks stay Unlimited. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const MIGRATION = "20270106001000_free_saved_items.sql";
const ROLLBACK = readFileSync(path.resolve(import.meta.dirname, "../../docs/v8-marketing/rollback_20270106001000.sql"), "utf8");

d("free Saved Items (database)", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let free: string, other: string, pro: string;
  const add = (u: string, name: string) => asUser(pool, u, (q) => q("insert into public.saved_items (user_id, name, unit, unit_cost) values ($1, $2, 'each', 10) returning id", [u, name]));

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("free_saved_items_test"));
    free = await createUser(pool, "free-items@test.dev");
    other = await createUser(pool, "other-items@test.dev");
    pro = await createUser(pool, "pro-items@test.dev");
    await pool.query("select public.apply_subscription_update($1::uuid, $2, $3, 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())", [pro, `cus_${pro}`, `sub_${pro}`]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("a free account can save, edit and delete its own items", async () => {
    const id = (await add(free, "Drywall hang")).rows[0].id;
    await asUser(pool, free, (q) => q("update public.saved_items set unit_cost = 12 where id = $1", [id]));
    expect((await pool.query("select unit_cost::text c from public.saved_items where id = $1", [id])).rows[0].c).toBe("12.0000");
    await asUser(pool, free, (q) => q("delete from public.saved_items where id = $1", [id]));
    expect((await pool.query("select 1 from public.saved_items where id = $1", [id])).rowCount).toBe(0);
    expect((await asUser(pool, free, (q) => q("select public.saved_items_free_ok() v"))).rows[0].v).toBe(true);
  });

  it("can't write someone else's items", async () => {
    await expect(asUser(pool, free, (q) => q("insert into public.saved_items (user_id, name, unit, unit_cost) values ($1, 'x', 'each', 1)", [other]))).rejects.toThrow(/row-level security/);
    const id = (await add(other, "Theirs")).rows[0].id;
    const r = await asUser(pool, free, (q) => q("update public.saved_items set unit_cost = 1 where id = $1", [id]));
    expect(r.rowCount).toBe(0);
  });

  it("stacks, favorites and the library entitlement stay Unlimited", async () => {
    await expect(asUser(pool, free, (q) => q("insert into public.assemblies (user_id, name) values ($1, 'Stack')", [free]))).rejects.toThrow(/row-level security/);
    expect((await asUser(pool, free, (q) => q("select public.library_access() v"))).rows[0].v).toBe(false);
  });

  it("free accounts stop at 250 items; Unlimited has no cap", async () => {
    await pool.query("insert into public.saved_items (user_id, name, unit, unit_cost) select $1, 'Item ' || g, 'each', 1 from generate_series(1, 250) g", [free]);
    await expect(add(free, "One too many")).rejects.toThrow(/free_item_limit/);
    await pool.query("insert into public.saved_items (user_id, name, unit, unit_cost) select $1, 'Item ' || g, 'each', 1 from generate_series(1, 250) g", [pro]);
    await expect(add(pro, "No cap")).resolves.toBeTruthy();
  });

  it("runs twice safely; rollback keeps the items and blocks free writes again", async () => {
    await applyMigration(pool, MIGRATION);
    await pool.query(ROLLBACK);
    expect(Number((await pool.query("select count(*) n from public.saved_items where user_id = $1", [free])).rows[0].n)).toBe(250);
    await pool.query("delete from public.saved_items where user_id = $1 and name = 'Item 1'", [free]);
    await expect(add(free, "After rollback")).rejects.toThrow(/row-level security/);
    await applyMigration(pool, MIGRATION);
    await expect(add(free, "Back again")).resolves.toBeTruthy();
  });
});
