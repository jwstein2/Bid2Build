import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("growth funnel: leads, events, admin metrics", () => {
  let alice: string, admin: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_growth"));
    alice = await createUser(pool, "alice@test.dev");
    admin = await createUser(pool, "admin@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
  });
  afterAll(async () => { await drop?.(); });

  it("end users cannot read or write leads, lead events or costs", async () => {
    await pool.query("insert into public.leads (email_norm, user_id, first_campaign_id) values ('alice@test.dev', $1, 'camp-1')", [alice]);
    for (const t of ["leads", "lead_events", "marketing_costs"]) {
      await expect(asUser(pool, alice, (q) => q(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(pool, alice, (q) => q("insert into public.leads (email_norm) values ('x@y.dev')"))).rejects.toThrow(/permission denied/);
  });

  it("normalized email is unique and must be lowercase", async () => {
    await expect(pool.query("insert into public.leads (email_norm) values ('alice@test.dev')")).rejects.toThrow(/duplicate key/);
    await expect(pool.query("insert into public.leads (email_norm) values ('Bob@Test.dev')")).rejects.toThrow(/check constraint/);
  });

  it("lead events are idempotent on dedupe_key", async () => {
    const { rows } = await pool.query("select id from public.leads where email_norm = 'alice@test.dev'");
    await pool.query("insert into public.lead_events (lead_id, event, source, dedupe_key) values ($1, 'reply_received', 'instantly', 'k1')", [rows[0].id]);
    await expect(pool.query("insert into public.lead_events (lead_id, event, source, dedupe_key) values ($1, 'reply_received', 'instantly', 'k1')", [rows[0].id])).rejects.toThrow(/duplicate key/);
  });

  it("deleting the account keeps the lead (suppression survives) but unlinks it", async () => {
    const bob = await createUser(pool, "bob@test.dev");
    await pool.query("insert into public.leads (email_norm, user_id, suppressed_at, suppression_reason) values ('bob@test.dev', $1, now(), 'unsubscribed')", [bob]);
    await pool.query("delete from auth.users where id = $1", [bob]);
    const { rows } = await pool.query("select user_id, suppressed_at from public.leads where email_norm = 'bob@test.dev'");
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].suppressed_at).not.toBeNull();
  });

  it("growth_funnel is admin only and aggregates by first-touch campaign", async () => {
    await expect(pool.query("select public.growth_funnel($1)", [alice])).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, admin, (q) => q("select public.growth_funnel($1)", [admin]))).rejects.toThrow(/permission denied/);
    const { rows } = await pool.query("select public.growth_funnel($1) r", [admin]);
    const r = rows[0].r;
    expect(r.leads_total).toBe(2);
    expect(r.signups_total).toBe(2);
    const camp = r.campaigns.find((c: { campaign: string }) => c.campaign === "camp-1");
    expect(camp).toMatchObject({ leads: 1, replied: 1, signed_up: 1, paid: 0 });
  });

  it("rollback script drops only the growth objects", async () => {
    await pool.query(readFileSync(path.resolve(import.meta.dirname, "../../supabase/rollback/20261112001000_growth_funnel_down.sql"), "utf8"));
    const { rows } = await pool.query("select to_regclass('public.leads') l, to_regclass('public.estimates') e");
    expect(rows[0].l).toBeNull();
    expect(rows[0].e).not.toBeNull();
  });
});
