import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("ad conversions queue (migration 20261117002000)", () => {
  let alice: string;
  beforeAll(async () => { ({ pool, drop } = await freshDb("byb_test_ad_conversions")); alice = await createUser(pool, "alice@test.dev"); });
  afterAll(async () => { await drop?.(); });

  it("stores one row per platform + event id", async () => {
    await pool.query("insert into public.ad_conversions (platform, event_id, event_name, user_id, payload) values ('meta', 'account_created:a', 'CompleteRegistration', $1, '{}')", [alice]);
    const r = await pool.query("insert into public.ad_conversions (platform, event_id, event_name, user_id, payload) values ('meta', 'account_created:a', 'CompleteRegistration', $1, '{}') on conflict (platform, event_id) do nothing returning id", [alice]);
    expect(r.rowCount).toBe(0);
    await expect(pool.query("insert into public.ad_conversions (platform, event_id, event_name, payload) values ('tiktok', 'x', 'y', '{}')")).rejects.toThrow(/check constraint/);
  });
  it("is invisible to end users", async () => {
    await expect(asUser(pool, alice, (q) => q("select * from public.ad_conversions"))).rejects.toThrow(/permission denied/);
  });
});
