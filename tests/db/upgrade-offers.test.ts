import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb } from "./harness";

/** V8 batch 4 offer log: constraints, no browser access, idempotent, reversible. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const ROLLBACK = readFileSync(path.resolve(import.meta.dirname, "../../docs/v8-marketing/rollback_20270105001000.sql"), "utf8");
const U = "00000000-0000-4000-8000-0000000000a1";

d("upgrade_offers", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("upgrade_offers_test"));
    await pool.query("insert into auth.users (id, email) values ($1, 'offers@built2bid.test') on conflict do nothing", [U]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("accepts known offers, actions and short codes only", async () => {
    await pool.query("insert into public.upgrade_offers (user_id, offer_id, action) values ($1, 't1_credits_low', 'shown')", [U]);
    await pool.query("insert into public.upgrade_offers (user_id, offer_id, action, detail) values ($1, 'ret1_cancel', 'answered', 'too_expensive')", [U]);
    await expect(pool.query("insert into public.upgrade_offers (user_id, offer_id, action) values ($1, 'popup', 'shown')", [U])).rejects.toThrow();
    await expect(pool.query("insert into public.upgrade_offers (user_id, offer_id, action) values ($1, 't1_credits_low', 'converted_maybe')", [U])).rejects.toThrow();
    await expect(pool.query("insert into public.upgrade_offers (user_id, offer_id, action, detail) values ($1, 'ret1_cancel', 'answered', 'Too expensive! email me at a@b.com')", [U])).rejects.toThrow();
  });

  it("is closed to browser roles", async () => {
    const r = await pool.query("select has_table_privilege('authenticated', 'public.upgrade_offers', 'select') a, has_table_privilege('anon', 'public.upgrade_offers', 'insert') b, relrowsecurity rls from pg_class where oid = 'public.upgrade_offers'::regclass");
    expect(r.rows[0]).toEqual({ a: false, b: false, rls: true });
  });

  it("runs twice safely and rolls back cleanly", async () => {
    await applyMigration(pool, "20270105001000_upgrade_offers.sql");
    expect(Number((await pool.query("select count(*) n from public.upgrade_offers")).rows[0].n)).toBe(2);
    await pool.query(ROLLBACK);
    expect((await pool.query("select to_regclass('public.upgrade_offers') t")).rows[0].t).toBeNull();
    await applyMigration(pool, "20270105001000_upgrade_offers.sql");
    expect((await pool.query("select to_regclass('public.upgrade_offers') t")).rows[0].t).not.toBeNull();
  });
});
