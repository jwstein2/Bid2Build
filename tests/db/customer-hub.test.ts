import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const MIGRATION = "20261122001000_customer_hub.sql";

type Cust = { name: string; email?: string | null; phone?: string | null; address?: string | null; customerId?: string | null };
const as = <T = Row>(u: string, sql: string, params: unknown[] = []) => asUser(pool, u, (q) => q(sql, params)).then((r) => r.rows as T[]);
const fails = async (u: string, sql: string, params: unknown[] = []) => {
  try { await asUser(pool, u, (q) => q(sql, params)); return null; } catch (e) { return (e as Error).message; }
};

/** The builder's save: an upsert of the whole row (save_estimate does the same). */
async function save(u: string, id: string | null, c: Cust, title = "Bid"): Promise<{ id: string; customer_id: string | null }> {
  const rows = await as<{ id: string; customer_id: string | null }>(u,
    `insert into public.estimates (id, user_id, title, customer_name, customer_email, customer_phone, project_address, customer_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do update set customer_name = excluded.customer_name, customer_email = excluded.customer_email,
       customer_phone = excluded.customer_phone, project_address = excluded.project_address, customer_id = excluded.customer_id, title = excluded.title
     returning id, customer_id`,
    [id, u, title, c.name, c.email ?? null, c.phone ?? null, c.address ?? null, c.customerId ?? null]);
  return rows[0];
}
const customers = (u: string) => as<{ id: string; name: string; email: string | null; source: string; company_id: string | null }>(u, "select id, name, email, source, company_id from public.customers order by created_at");

d("Customer Hub: bids link to one customer record (database)", () => {
  let solo: string, other: string, owner: string, est: string, viewer: string, company: string;
  let legacyA: string, legacyB: string, legacyC: string, legacyUpdatedAt: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_customer_hub", { stopBefore: MIGRATION }));
    solo = await createUser(pool, "solo@hub.dev");
    other = await createUser(pool, "other@hub.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    await pool.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'c', p_stripe_subscription_id => 's', p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 10)", [owner, company]);
    for (const [u, email, role] of [[est, "est@acme.dev", "estimator"], [viewer, "viewer@acme.dev", "viewer"]] as const) {
      const t = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation($1, $2)", [email, role]))).rows[0].token;
      await asUser(pool, u, (q) => q("select public.accept_company_invitation($1)", [t]));
    }
    // Bids that exist before the migration: customer as text only (the production situation).
    const ins = (name: string, email: string | null, addr: string | null, daysAgo: number) => pool.query(
      `insert into public.estimates (user_id, title, customer_name, customer_email, project_address, created_at) values ($1, 'Old', $2, $3, $4, now() - ($5 || ' days')::interval) returning id`,
      [solo, name, email, addr, daysAgo]).then((r) => r.rows[0].id as string);
    legacyA = await ins("John Smith", "john@x.dev", "1 Elm St", 30);
    legacyB = await ins("john smith", "JOHN@x.dev ", null, 20);      // same person (email)
    legacyC = await ins("John Smith", null, null, 10);                // name only: never merged automatically
    await pool.query("insert into public.estimates (user_id, title, customer_name) values ($1, 'No customer yet', '')", [solo]);
    legacyUpdatedAt = (await pool.query("select updated_at from public.estimates where id = $1", [legacyA])).rows[0].updated_at.toISOString();
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
  });
  afterAll(async () => { await drop?.(); });

  it("backfills historical bids: same email groups, name-only stays separate, edit times preserved", async () => {
    const rows = (await pool.query("select id, customer_id, updated_at from public.estimates where id = any($1)", [[legacyA, legacyB, legacyC]])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[legacyA].customer_id).toBeTruthy();
    expect(by[legacyB].customer_id).toBe(by[legacyA].customer_id);
    expect(by[legacyC].customer_id).toBeTruthy();
    expect(by[legacyC].customer_id).not.toBe(by[legacyA].customer_id);
    expect(by[legacyA].updated_at.toISOString()).toBe(legacyUpdatedAt);
    const cs = await customers(solo);
    expect(cs).toHaveLength(2);
    expect(cs.every((c) => c.source === "backfill")).toBe(true);
    // A bid with no customer name gets no record.
    expect((await pool.query("select count(*)::int n from public.estimates where customer_name = '' and customer_id is not null")).rows[0].n).toBe(0);
  });

  it("a new bid creates the customer once; autosaves while typing do not create one record per keystroke", async () => {
    let b = await save(other, null, { name: "M" });
    const first = b.customer_id;
    expect(first).toBeTruthy();
    for (const n of ["Ma", "Mar", "Maria Lopez"]) b = await save(other, b.id, { name: n, customerId: null });
    b = await save(other, b.id, { name: "Maria Lopez", email: "maria@x.dev", address: "9 Pine Rd", customerId: null });
    expect(b.customer_id).toBe(first);
    const cs = await customers(other);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ name: "Maria Lopez", email: "maria@x.dev", source: "bid" });
  });

  it("a second bid for the same customer (email) reuses the record; a different person does not", async () => {
    const b2 = await save(other, null, { name: "Maria Lopez", email: "MARIA@x.dev" });
    const [c] = await customers(other);
    expect(b2.customer_id).toBe(c.id);
    const b3 = await save(other, null, { name: "Acme Property Mgmt", email: "maria@x.dev" }); // shared inbox, unrelated name
    expect(b3.customer_id).not.toBe(c.id);
    const b4 = await save(other, null, { name: "Maria Lopez" }); // name only
    expect(b4.customer_id).not.toBe(c.id);
    const b5 = await save(other, null, { name: "maria  lopez", address: "9 Pine Rd." }); // same name + same address
    expect(b5.customer_id).toBe(c.id);
  });

  it("picking a saved customer links it and removes the bid's now-unused automatic record", async () => {
    const [c] = await customers(other);
    const b = await save(other, null, { name: "Temp Person" });
    const temp = b.customer_id;
    const linked = await save(other, b.id, { name: "Maria Lopez", customerId: c.id });
    expect(linked.customer_id).toBe(c.id);
    expect((await customers(other)).some((x) => x.id === temp)).toBe(false);
  });

  it("never links a customer from another account (tenant isolation)", async () => {
    const [mine] = await customers(solo);
    const b = await save(other, null, { name: "Sneaky", customerId: mine.id });
    expect(b.customer_id).not.toBe(mine.id);
    expect((await as(other, "select id from public.customers where id = $1", [mine.id]))).toHaveLength(0);
    expect(await as(solo, "select id from public.customers where user_id = $1", [other])).toHaveLength(0);
  });

  it("company bids share one company customer across employees, readable only by members who can see a bid", async () => {
    const a = await save(est, null, { name: "Dana Park", email: "dana@x.dev" });
    const b = await save(owner, null, { name: "Dana Park", email: "dana@x.dev" });
    expect(a.customer_id).toBe(b.customer_id);
    const [row] = (await pool.query("select company_id, user_id from public.customers where id = $1", [a.customer_id])).rows;
    expect(row.company_id).toBe(company);
    // Owner sees it, the estimator sees it through their own bid, an outsider never does.
    expect(await as(owner, "select id from public.customers where id = $1", [a.customer_id])).toHaveLength(1);
    expect(await as(est, "select id from public.customers where id = $1", [a.customer_id])).toHaveLength(1);
    expect(await as(solo, "select id from public.customers where id = $1", [a.customer_id])).toHaveLength(0);
  });

  it("edits: owner and permitted members can edit; viewers and outsiders cannot; bids keep their own text", async () => {
    const [c] = await as<{ id: string }>(owner, "select c.id from public.customers c where c.email = 'dana@x.dev'");
    expect(await fails(viewer, "select public.customer_update($1, $2)", [c.id, { name: "Hacked" }])).toMatch(/forbidden/);
    expect(await fails(solo, "select public.customer_update($1, $2)", [c.id, { name: "Hacked" }])).toMatch(/forbidden/);
    await as(owner, "select public.customer_update($1, $2)", [c.id, { name: "Dana Park", email: "dana.park@x.dev", customerType: "business", companyName: "Park Holdings" }]);
    const [after] = (await pool.query("select email, source, customer_type, company_name from public.customers where id = $1", [c.id])).rows;
    expect(after).toMatchObject({ email: "dana.park@x.dev", source: "manual", customer_type: "business", company_name: "Park Holdings" });
    // The bid (and so any proposal built from it) still says what it said.
    expect((await pool.query("select customer_email from public.estimates where customer_id = $1 order by created_at limit 1", [c.id])).rows[0].customer_email).toBe("dana@x.dev");
  });

  it("merge moves bids to the kept record and deletes the other; cross-scope merges are refused", async () => {
    const cs = await customers(solo);
    const [keep, remove] = cs;
    await as(solo, "select public.customer_merge($1, $2)", [keep.id, remove.id]);
    expect(await customers(solo)).toHaveLength(1);
    expect((await pool.query("select count(*)::int n from public.estimates where customer_id = $1", [keep.id])).rows[0].n).toBe(3);
    const [theirs] = await customers(other);
    expect(await fails(solo, "select public.customer_merge($1, $2)", [keep.id, theirs.id])).toMatch(/forbidden/);
  });

  it("deleting the only bid of an automatic customer removes that record; hand-edited ones stay", async () => {
    const b = await save(other, null, { name: "Short Lived" });
    await as(other, "delete from public.estimates where id = $1", [b.id]);
    expect((await customers(other)).some((x) => x.id === b.customer_id)).toBe(false);
    const k = await save(other, null, { name: "Keeper" });
    await as(other, "select public.customer_update($1, $2)", [k.customer_id, { name: "Keeper" }]);
    await as(other, "delete from public.estimates where id = $1", [k.id]);
    expect((await customers(other)).some((x) => x.id === k.customer_id)).toBe(true);
  });
});
