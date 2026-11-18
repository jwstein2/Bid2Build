/**
 * V6.9 upgrade path: a database that ran the first version of 20261226001000 (before the built-in tax engine) can run
 * the current file over it and end up with the built-in engine's tables, constraints and seed rates.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("V6.9 upgrade from the first version", () => {
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_tax_upgrade", { stopBefore: "20261226001000" }));
    const first = execFileSync("git", ["show", "6c835dd:supabase/migrations/20261226001000_tax_banking.sql"], { encoding: "utf8" });
    await pool.query(first);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("re-running the current file adds the built-in engine and keeps working", async () => {
    expect((await pool.query("select to_regclass('public.tax_rate_sources') r")).rows[0].r).toBeNull();
    await applyMigration(pool, "20261226001000_tax_banking.sql");
    await applyMigration(pool, "20261226001000_tax_banking.sql");
    const r = (await pool.query(`select to_regclass('public.tax_rate_sources') a, to_regclass('public.tax_zip_areas') b, to_regclass('public.fin_tax_exemption_certificates') c,
      (select count(*)::int from public.tax_jurisdiction_rates where source = 'seed') seeds, (select count(*)::int from public.tax_rate_sources) sources`)).rows[0];
    expect(r).toMatchObject({ a: "tax_rate_sources", b: "tax_zip_areas", c: "fin_tax_exemption_certificates", sources: 51 });
    expect(r.seeds).toBe(45);
    await pool.query("insert into public.tax_sync_runs (provider, kind, state) values ('official', 'import', 'MN')");
    expect(readFileSync("supabase/migrations/20261226001000_tax_banking.sql", "utf8")).toContain("Upgrade in place");
  });
});
