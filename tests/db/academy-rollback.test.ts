import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb } from "./harness";

/** The Academy migrations are reversible: the rollback removes every Academy object and the migrations re-apply cleanly. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const ROLLBACK = readFileSync(path.resolve(import.meta.dirname, "../../docs/academy/rollback_20261230001000.sql"), "utf8");

d("contractor academy rollback", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_rollback_test")); }, 120_000);
  afterAll(async () => { await drop?.(); });
  const count = async () => (await pool.query(`select
      (select count(*) from pg_tables where schemaname = 'public' and tablename like 'academy\\_%') t,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'academy\\_%') f,
      (select count(*) from storage.buckets where id = 'academy-media') b`)).rows[0];

  it("drops everything, then the migrations apply again", async () => {
    const before = await count();
    expect(Number(before.t)).toBe(20);
    expect(Number(before.f)).toBeGreaterThan(30);
    await pool.query(ROLLBACK);
    expect(await count()).toEqual({ t: "0", f: "0", b: "0" });
    // Nothing outside the Academy was removed.
    expect((await pool.query("select to_regclass('public.profiles') is not null ok")).rows[0].ok).toBe(true);
    await applyMigration(pool, "20261230001000_contractor_academy.sql");
    await applyMigration(pool, "20261230002000_academy_content_seed.sql");
    expect(Number((await count()).t)).toBe(20);
    expect(Number((await pool.query("select count(*) n from public.academy_courses")).rows[0].n)).toBe(297);
  });

  it("is idempotent: running the migrations twice changes nothing", async () => {
    await applyMigration(pool, "20261230001000_contractor_academy.sql");
    await applyMigration(pool, "20261230002000_academy_content_seed.sql");
    expect(Number((await pool.query("select count(*) n from public.academy_courses")).rows[0].n)).toBe(297);
    expect(Number((await pool.query("select count(*) n from public.academy_categories")).rows[0].n)).toBe(14);
  });
});
