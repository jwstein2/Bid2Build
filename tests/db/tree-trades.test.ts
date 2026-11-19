import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb } from "./harness";

/** The Tree Removal / Tree Trimming migration adds both trades to a database that doesn't have them yet, and re-runs cleanly. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const FILE = "20270131004100_tree_trades.sql";

d("tree trades migration", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("tree_trades_test")); }, 120_000);
  afterAll(async () => { await drop?.(); });

  const counts = async () => (await pool.query(`select
      (select count(*)::int from public.trade_categories where slug like 'tree-%') cats,
      (select count(*)::int from public.trade_templates where trade_slug like 'tree-%' and published) tpl,
      (select count(*)::int from public.academy_trades where slug like 'tree-%') at,
      (select count(*)::int from public.academy_courses where trade_slug like 'tree-%' and status = 'upcoming') courses,
      (select count(*)::int from public.trade_categories) all_cats`)).rows[0];

  it("adds both trades, templates and Academy classrooms where they were missing", async () => {
    // Simulate production before this change: no tree trades anywhere.
    await pool.query(`delete from public.academy_courses where trade_slug like 'tree-%';
      delete from public.academy_trades where slug like 'tree-%';
      delete from public.trade_templates where trade_slug like 'tree-%';
      delete from public.trade_categories where slug like 'tree-%';`);
    expect(await counts()).toMatchObject({ cats: 0, tpl: 0, at: 0, courses: 0 });
    await applyMigration(pool, FILE);
    expect(await counts()).toEqual({ cats: 2, tpl: 2, at: 2, courses: 16, all_cats: 41 });
    const order = (await pool.query("select slug from public.trade_categories order by sort_order")).rows.map((r) => r.slug);
    expect(order.indexOf("tree-removal")).toBe(order.indexOf("landscaping") + 1);
    expect(order.indexOf("tree-trimming")).toBe(order.indexOf("landscaping") + 2);
    const tpl = await pool.query("select definition from public.trade_templates where trade_slug like 'tree-%'");
    expect(JSON.stringify(tpl.rows)).not.toMatch(/unitCost|price/i);
  });

  it("is idempotent", async () => {
    await applyMigration(pool, FILE);
    expect(await counts()).toEqual({ cats: 2, tpl: 2, at: 2, courses: 16, all_cats: 41 });
  });
});
