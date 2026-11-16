import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("growth activation (migration 20261117001000)", () => {
  let alice: string, est: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_growth_activation"));
    alice = await createUser(pool, "alice@test.dev");
    est = (await pool.query("insert into public.estimates (user_id, title) values ($1, 'Deck') returning id", [alice])).rows[0].id;
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name) values ($1, $2, 'Framing') returning id", [est, alice])).rows[0].id;
    const add = (name: string, q: number, c: number) => pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost) values ($1, $2, $3, $4, $5, $6)", [est, g, alice, name, q, c]);
    await add("Joists", 10, 12); await add("Beams", 2, 80); await add("", 1, 1); await add("Blocking", 0, 3);
  });
  afterAll(async () => { await drop?.(); });

  it("accepts the new event names and keeps rejecting unknown ones", async () => {
    for (const e of ["first_bid_started", "bid_created", "bid_activated", "proposal_sent", "subscription_renewed", "subscription_canceled", "account_created"]) {
      await pool.query("insert into public.analytics_events (user_id, event) values ($1, $2)", [alice, e]);
    }
    await expect(pool.query("insert into public.analytics_events (user_id, event) values ($1, 'made_up')", [alice])).rejects.toThrow(/check constraint/);
  });

  it("event_id makes a business event idempotent", async () => {
    await pool.query("insert into public.analytics_events (user_id, event, event_id) values ($1, 'account_created', 'account_created:x')", [alice]);
    await expect(pool.query("insert into public.analytics_events (user_id, event, event_id) values ($1, 'account_created', 'account_created:x')", [alice])).rejects.toThrow(/duplicate key/);
    const r = await pool.query("insert into public.analytics_events (user_id, event, event_id) values ($1, 'account_created', 'account_created:x') on conflict (event_id) do nothing returning id", [alice]);
    expect(r.rowCount).toBe(0);
  });

  it("counts only estimates with 3+ meaningful items", async () => {
    let { rows } = await pool.query("select * from public.growth_meaningful_estimates()");
    expect(rows).toHaveLength(0); // 2 meaningful of 4
    const g = (await pool.query("select id from public.estimate_groups where estimate_id = $1", [est])).rows[0].id;
    await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost) values ($1, $2, $3, 'Decking', 300, 4)", [est, g, alice]);
    ({ rows } = await pool.query("select * from public.growth_meaningful_estimates()"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ estimate_id: est, user_id: alice, from_event: false });
    await pool.query("insert into public.analytics_events (user_id, event, event_id, estimate_id, created_at) values ($1, 'bid_created', $2, $3, '2026-11-01T00:00:00Z')", [alice, `bid_created:${est}`, est]);
    ({ rows } = await pool.query("select * from public.growth_meaningful_estimates()"));
    expect(rows[0].from_event).toBe(true);
    expect(new Date(rows[0].reached_at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("end users can't call the report function or read events", async () => {
    await expect(asUser(pool, alice, (q) => q("select * from public.growth_meaningful_estimates()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, alice, (q) => q("select * from public.analytics_events"))).rejects.toThrow(/permission denied/);
  });

  it("deleting the bid keeps the event but unlinks it", async () => {
    await pool.query("delete from public.estimates where id = $1", [est]);
    const { rows } = await pool.query("select estimate_id from public.analytics_events where event_id = $1", [`bid_created:${est}`]);
    expect(rows[0].estimate_id).toBeNull();
  });
});
