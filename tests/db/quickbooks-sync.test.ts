/**
 * QuickBooks hours sync (20270214005000), against the real SQL:
 *   - browsers can read their own scope's connection and links, but never tokens, and can't write anything
 *   - qb_my_scope says who may manage the connection
 *   - links and exports must belong to the connection's own company or solo owner
 *   - an entry can only be claimed for sending once, unless the earlier try failed
 *   - rollback removes everything and the migration re-applies
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("QuickBooks hours sync (database)", () => {
  let owner: string, other: string, worker: string, otherWorker: string, entry: string, otherEntry: string, conn: string;
  const fails = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);
  const claim = (entryId: string) => pool.query("select public.qb_claim_export($1, $2, $3, 8, '2026-11-16') as ok", [conn, entryId, owner]).then((r) => r.rows[0].ok as boolean);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_quickbooks"));
    owner = await createUser(pool, "owner@qb.test");
    other = await createUser(pool, "other@qb.test");
    worker = (await pool.query("insert into public.pm_resources (owner_id, kind, name) values ($1, 'staff', 'Ana') returning id", [owner])).rows[0].id;
    otherWorker = (await pool.query("insert into public.pm_resources (owner_id, kind, name) values ($1, 'staff', 'Bo') returning id", [other])).rows[0].id;
    const mk = (o: string, r: string) => pool.query(
      "insert into public.pm_time_entries (owner_id, resource_id, clock_in, clock_out, status) values ($1, $2, '2026-11-16T14:00:00Z', '2026-11-16T22:00:00Z', 'approved') returning id", [o, r]).then((x) => x.rows[0].id as string);
    entry = await mk(owner, worker);
    otherEntry = await mk(other, otherWorker);
    conn = (await pool.query("insert into public.qb_connections (owner_id, realm_id, company_name, connected_by) values ($1, '9130350000000001', 'Ana Painting', $1) returning id", [owner])).rows[0].id;
    await pool.query("insert into public.qb_connection_secrets (connection_id, access_ciphertext, refresh_ciphertext, access_expires_at) values ($1, 'v1.aaaaaaaaaaaaaaaa', 'v1.bbbbbbbbbbbbbbbb', now())", [conn]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("tells the signed-in user their scope and that they may manage it", async () => {
    const r = await asUser(pool, owner, (q) => q("select public.qb_my_scope() as s"));
    expect(r.rows[0].s).toMatchObject({ companyId: null, ownerId: owner, canManage: true });
  });

  it("lets owners read their connection but never the tokens, and blocks all browser writes", async () => {
    const mine = await asUser(pool, owner, (q) => q("select company_name from public.qb_connections"));
    expect(mine.rows).toEqual([{ company_name: "Ana Painting" }]);
    const theirs = await asUser(pool, other, (q) => q("select id from public.qb_connections"));
    expect(theirs.rows).toHaveLength(0);
    expect(await fails(asUser(pool, owner, (q) => q("select * from public.qb_connection_secrets")))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, owner, (q) => q("insert into public.qb_worker_links (connection_id, resource_id, qb_type, qb_id) values ($1, $2, 'Employee', '55')", [conn, worker])))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, owner, (q) => q("select public.qb_claim_export($1, $2, $3, 1, '2026-11-16')", [conn, entry, owner])))).toMatch(/permission denied/);
  });

  it("allows only one live connection per owner", async () => {
    expect(await fails(pool.query("insert into public.qb_connections (owner_id, realm_id) values ($1, '1')", [owner]))).toMatch(/qb_connections_one_live/);
  });

  it("refuses links and exports for another owner's records", async () => {
    await pool.query("insert into public.qb_worker_links (connection_id, resource_id, qb_type, qb_id, qb_name) values ($1, $2, 'Employee', '55', 'Ana')", [conn, worker]);
    expect(await fails(pool.query("insert into public.qb_worker_links (connection_id, resource_id, qb_type, qb_id) values ($1, $2, 'Employee', '56')", [conn, otherWorker]))).toMatch(/qb_scope_mismatch/);
    expect(await fails(claim(otherEntry))).toMatch(/qb_scope_mismatch/);
    const links = await asUser(pool, owner, (q) => q("select qb_name from public.qb_worker_links"));
    expect(links.rows).toEqual([{ qb_name: "Ana" }]);
  });

  it("claims an entry once, and again only after a failed send", async () => {
    expect(await claim(entry)).toBe(true);
    expect(await claim(entry)).toBe(false);
    await pool.query("update public.qb_time_exports set status = 'error', error = 'boom' where entry_id = $1", [entry]);
    expect(await claim(entry)).toBe(true);
    await pool.query("update public.qb_time_exports set status = 'sent', qb_time_activity_id = '101' where entry_id = $1", [entry]);
    expect(await claim(entry)).toBe(false);
    expect(await fails(pool.query("update public.qb_time_exports set qb_time_activity_id = null where entry_id = $1", [entry]))).toMatch(/qb_time_exports_sent/);
  });

  it("rollback removes everything and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/quickbooks/rollback_20270214005000.sql", "utf8"));
    const left = await pool.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'qb\\_%'");
    expect(left.rows[0].n).toBe(0);
    await pool.query(readFileSync("supabase/migrations/20270214005000_quickbooks_sync.sql", "utf8"));
    await pool.query(readFileSync("supabase/migrations/20270214005000_quickbooks_sync.sql", "utf8"));
  });
});
