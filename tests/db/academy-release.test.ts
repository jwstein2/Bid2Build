import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { dbAvailable, freshDb } from "./harness";

/** Academy weekly release schedule (20270216001000): first schedule, re-pack after a delete, pace changes, grants. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy release schedule", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_release_test")); }, 120_000);
  afterAll(async () => { await drop?.(); });

  const dates = async () => (await pool.query(`select c.slug, c.release_on::text as d from public.academy_courses c left join public.academy_trades t on t.slug = c.trade_slug
    where c.status = 'upcoming' order by c.release_on, c.sort_order, coalesce(t.sort_order, 0), c.trade_slug nulls first, c.slug`)).rows as { slug: string; d: string }[];

  it("gave every upcoming course a Monday, two per week, starting Nov 30 2026", async () => {
    const rows = await dates();
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => r.d)).toBe(true);
    expect(rows[0].d).toBe("2026-11-30");
    expect(rows[1].d).toBe("2026-11-30");
    expect(rows[2].d).toBe("2026-12-07");
    const perDay = new Map<string, number>();
    for (const r of rows) perDay.set(r.d, (perDay.get(r.d) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(2);
    for (const day of perDay.keys()) expect(new Date(`${day}T12:00:00Z`).getUTCDay()).toBe(1);
    const pub = await pool.query("select count(*)::int as n from public.academy_courses where status = 'published' and release_on is not null");
    expect(pub.rows[0].n).toBe(0);
  });

  it("closes the gap when a course is deleted and keeps the order", async () => {
    const before = await dates();
    await pool.query("delete from public.academy_courses where slug = $1", [before[0].slug]);
    await pool.query("select public.academy_schedule_releases('2026-11-24')");
    const after = await dates();
    expect(after.map((r) => r.slug)).toEqual(before.slice(1).map((r) => r.slug));
    expect(after[0].d).toBe("2026-11-30");
    expect(after[1].d).toBe("2026-11-30");
    expect(after[2].d).toBe("2026-12-07");
  });

  it("follows the pace and weekday settings", async () => {
    await pool.query("update public.academy_settings set release_per_week = 3, release_weekday = 4");
    await pool.query("select public.academy_schedule_releases('2026-11-24')");
    const rows = await dates();
    expect(rows.slice(0, 4).map((r) => r.d)).toEqual(["2026-11-26", "2026-11-26", "2026-11-26", "2026-12-03"]);
    await pool.query("update public.academy_settings set release_per_week = 2, release_weekday = 1");
  });

  it("is callable only by the service role", async () => {
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query(`begin; set local role ${role}`);
        await expect(c.query("select public.academy_schedule_releases('2026-11-24')")).rejects.toThrow(/permission denied/);
      } finally { await c.query("rollback").catch(() => {}); c.release(); }
    }
  });

  it("rolls back and re-applies cleanly", async () => {
    const read = (p: string) => readFileSync(path.resolve(import.meta.dirname, "../..", p), "utf8");
    await pool.query(read("docs/academy/rollback_20270216001000.sql"));
    const col = await pool.query("select 1 from information_schema.columns where table_name = 'academy_courses' and column_name = 'release_on'");
    expect(col.rowCount).toBe(0);
    await pool.query(read("supabase/migrations/20270216001000_academy_release_schedule.sql"));
    expect((await dates())[0].d).toBe("2026-11-30");
  });
});
