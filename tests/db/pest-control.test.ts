import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb } from "./harness";

/** The Pest Control migration adds the trade to a database that doesn't have it yet, and re-runs cleanly. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const FILE = "20270201001000_pest_control_trade.sql";

d("pest control trade migration", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("pest_control_test")); }, 120_000);
  afterAll(async () => { await drop?.(); });

  const counts = async () => (await pool.query(`select
      (select count(*)::int from public.trade_categories where slug = 'pest-control') cats,
      (select count(*)::int from public.trade_templates where trade_slug = 'pest-control' and published) tpl,
      (select count(*)::int from public.academy_trades where slug = 'pest-control') at,
      (select count(*)::int from public.academy_courses where trade_slug = 'pest-control' and status = 'upcoming') courses,
      (select count(*)::int from public.trade_categories) all_cats`)).rows[0];

  it("adds the trade, template and Academy classroom where they were missing", async () => {
    // Simulate production before this change: no pest control anywhere.
    await pool.query(`delete from public.academy_courses where trade_slug = 'pest-control';
      delete from public.academy_trades where slug = 'pest-control';
      delete from public.trade_templates where trade_slug = 'pest-control';
      delete from public.trade_categories where slug = 'pest-control';`);
    expect(await counts()).toMatchObject({ cats: 0, tpl: 0, at: 0, courses: 0 });
    await applyMigration(pool, FILE);
    expect(await counts()).toEqual({ cats: 1, tpl: 1, at: 1, courses: 8, all_cats: 42 });
    const order = (await pool.query("select slug from public.trade_categories order by sort_order")).rows.map((r) => r.slug);
    expect(order.indexOf("pest-control")).toBe(order.indexOf("cleaning") + 1);
    const tpl = await pool.query("select definition from public.trade_templates where trade_slug = 'pest-control'");
    expect(JSON.stringify(tpl.rows)).not.toMatch(/unitCost|price/i);
  });

  it("is idempotent", async () => {
    await applyMigration(pool, FILE);
    expect(await counts()).toEqual({ cats: 1, tpl: 1, at: 1, courses: 8, all_cats: 42 });
  });
});
