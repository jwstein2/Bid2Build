import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
const MIGRATION = "20261114000100_phone_sign_in.sql";

let pool: Pool;
let drop: () => Promise<void>;

/** Supabase keeps phones as digits without "+". */
async function phoneUser(phone: string, verified = true): Promise<string> {
  const r = await pool.query("insert into auth.users (phone, phone_confirmed_at) values ($1, $2) returning id", [phone, verified ? new Date() : null]);
  return r.rows[0].id;
}
const status = (u: string) => asUser(pool, u, (q) => q("select * from public.credit_status()")).then((r) => r.rows[0]);
const newEstimate = async (u: string) => (await pool.query("insert into public.estimates (user_id, title) values ($1, 'Bid') returning id", [u])).rows[0].id as string;
const finalize = (u: string, e: string, h: string) =>
  pool.query("select * from public.finalize_bid($1, $2, $3, '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)", [u, e, h]);

d("phone sign-in (database)", () => {
  beforeAll(async () => { ({ pool, drop } = await freshDb("b2b_test_phone")); });
  afterAll(async () => { await drop?.(); });

  it("treats a confirmed phone as a verified account: starter credits and finalizing work", async () => {
    const u = await phoneUser("15555550101");
    expect(await status(u)).toMatchObject({ starter_balance: 3, email_verified: true, starter_granted: true });
    const r = await finalize(u, await newEstimate(u), "a".repeat(64));
    expect(r.rows[0]).toMatchObject({ charged: true, credit_source: "starter", starter_balance: 2 });
  });

  it("waits for the phone code before granting or finalizing", async () => {
    const u = await phoneUser("15555550102", false);
    expect(await status(u)).toMatchObject({ starter_balance: 0, email_verified: false, starter_granted: false });
    await expect(finalize(u, await newEstimate(u), "b".repeat(64))).rejects.toThrow(/email_not_verified/);
    await pool.query("update auth.users set phone_confirmed_at = now() where id = $1", [u]);
    expect((await status(u)).starter_balance).toBe(3);
  });

  it("does not grant a second bonus when the same phone deletes and re-creates its account", async () => {
    const u = await phoneUser("15555550103");
    expect((await status(u)).starter_balance).toBe(3);
    await pool.query("delete from auth.users where id = $1", [u]);
    const again = await phoneUser("15555550103");
    expect(await status(again)).toMatchObject({ starter_balance: 0, starter_granted: true });
  });

  it("an existing email account that adds a phone keeps its credits and gets no extra grant", async () => {
    const u = await createUser(pool, "owner@test.dev");
    expect((await status(u)).starter_balance).toBe(3);
    await finalize(u, await newEstimate(u), "c".repeat(64));
    await pool.query("update auth.users set phone = '15555550104', phone_confirmed_at = now() where id = $1", [u]);
    expect((await status(u)).starter_balance).toBe(2);
    const g = await pool.query("select count(*)::int n from public.credit_ledger where user_id = $1 and kind = 'starter_grant'", [u]);
    expect(g.rows[0].n).toBe(1);
  });

  it("refuses the bonus when either verified identifier was already claimed", async () => {
    const first = await phoneUser("15555550105");
    expect((await status(first)).starter_balance).toBe(3);
    await pool.query("delete from auth.users where id = $1", [first]);
    const r = await pool.query("insert into auth.users (email, email_confirmed_at, phone, phone_confirmed_at) values ('fresh@test.dev', now(), '15555550105', now()) returning id");
    expect((await status(r.rows[0].id)).starter_balance).toBe(0);
  });

  it("email accounts behave exactly as before", async () => {
    const u = await createUser(pool, "plain@test.dev");
    expect(await status(u)).toMatchObject({ starter_balance: 3, email_verified: true });
    const unverified = await createUser(pool, "pending@test.dev", false);
    expect(await status(unverified)).toMatchObject({ starter_balance: 0, email_verified: false });
  });

  it("counts phone accounts as verified in admin metrics", async () => {
    const def = await pool.query("select pg_get_functiondef('public.admin_metrics(uuid)'::regprocedure) d");
    expect(def.rows[0].d).toContain("phone_confirmed_at is not null");
  });

  it("can be applied again without changing anything", async () => {
    await applyMigration(pool, MIGRATION);
    const u = await phoneUser("15555550106");
    expect((await status(u)).starter_balance).toBe(3);
  });
});
