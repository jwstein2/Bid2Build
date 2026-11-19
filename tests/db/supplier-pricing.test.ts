/**
 * Supplier pricing (20261211001000), against the real SQL:
 *   - connections are opt-in per company / solo account; only supplier managers change them
 *   - users can request or pause, never mark a connection live; removing deletes the account reference
 *   - the cross-check returns only real imported prices: the latest per supplier, undone imports left out,
 *     company members see imports linked to company suppliers, other accounts see nothing
 *   - rollback removes everything cleanly
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, unknown>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Supplier pricing: connections and price cross-check (database)", () => {
  let solo: string, owner: string, est: string, viewer: string, stranger: string, company: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => as<{ v: T }>(u, `${sql} as v`, args).then((r) => r.v);
  const imp = async (u: string, supplier: string, rows: [string, string, number, string?, string?][], opts: { supplierId?: string; status?: string; days?: number } = {}) => {
    const id = (await pool.query("insert into public.price_imports (user_id, supplier_name, supplier_id, rows_total, status) values ($1, $2, $3, $4, $5) returning id",
      [u, supplier, opts.supplierId ?? null, rows.length, opts.status ?? "applied"])).rows[0].id as string;
    for (const [name, unit, cost, sku, expires] of rows) {
      await pool.query(`insert into public.price_records (user_id, import_id, action, supplier_name, supplier_sku, product_name, unit, unit_cost, effective_on, expires_on)
        values ($1, $2, 'created', $3, $4, $5, $6, $7, current_date - $8::int, $9)`, [u, id, supplier, sku ?? null, name, unit, cost, opts.days ?? 0, expires ?? null]);
    }
    return id;
  };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_supplier_pricing"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    stranger = await createUser(pool, "x@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Erin'), ($1, $3, 'viewer', 'Val')", [company, est, viewer]);
  });
  afterAll(async () => { await drop?.(); });

  it("connections: managers opt in with an account number only; viewers read; other accounts see nothing", async () => {
    const sup = await val<string>(owner, "select public.pm_supplier_save($1)", [{ name: "ABC Supply" }]);
    await as(owner, "select public.supplier_connection_save($1)", [{ provider: "abc_supply", supplierId: sup, accountRef: " 12345 ", branchRef: "Br 77" }]);
    expect(await fails(as(viewer, "select public.supplier_connection_save($1)", [{ provider: "srs" }]))).toMatch(/forbidden/);
    expect(await fails(as(owner, "select public.supplier_connection_save($1)", [{ provider: "scraper" }]))).toMatch(/bad_provider/);
    const otherSup = await val<string>(solo, "select public.pm_supplier_save($1)", [{ name: "Solo Lumber" }]);
    expect(await fails(as(owner, "select public.supplier_connection_save($1)", [{ provider: "qxo", supplierId: otherSup }]))).toMatch(/not_found/);

    const list = await val<{ canManage: boolean; connections: Row[] }>(viewer, "select public.supplier_connections_list()");
    expect(list.canManage).toBe(false);
    expect(list.connections).toEqual([expect.objectContaining({ provider: "abc_supply", supplierName: "ABC Supply", accountRef: "12345", branchRef: "Br 77", status: "requested", useForCrossCheck: true })]);
    expect((await val<{ connections: Row[] }>(stranger, "select public.supplier_connections_list()")).connections).toEqual([]);
    expect((await asUser(pool, stranger, (q) => q("select * from public.supplier_connections"))).rows).toHaveLength(0);
    // No direct writes, even for the owner.
    expect(await fails(asUser(pool, owner, (q) => q("update public.supplier_connections set status = 'connected'")))).toMatch(/permission denied/);
  });

  it("users pause and resume but can't mark a connection live; a live one stays live; remove deletes it", async () => {
    await as(est, "select public.supplier_connection_save($1)", [{ provider: "abc_supply", accountRef: "12345", paused: true }]);
    expect((await pool.query("select status from public.supplier_connections where provider = 'abc_supply'")).rows[0].status).toBe("paused");
    await as(est, "select public.supplier_connection_save($1)", [{ provider: "abc_supply", accountRef: "12345" }]);
    expect((await pool.query("select status from public.supplier_connections where provider = 'abc_supply'")).rows[0].status).toBe("requested");
    // The server marks it live once a partner integration exists.
    await pool.query("update public.supplier_connections set status = 'connected', connected_at = now() where provider = 'abc_supply'");
    await as(est, "select public.supplier_connection_save($1)", [{ provider: "abc_supply", accountRef: "999", useForCrossCheck: false }]);
    const row = (await pool.query("select status, account_ref, use_for_cross_check from public.supplier_connections where provider = 'abc_supply'")).rows[0];
    expect(row).toEqual({ status: "connected", account_ref: "999", use_for_cross_check: false });
    expect(await fails(as(viewer, "select public.supplier_connection_remove('abc_supply')"))).toMatch(/forbidden/);
    await as(owner, "select public.supplier_connection_remove('abc_supply')");
    expect((await pool.query("select count(*)::int as n from public.supplier_connections")).rows[0].n).toBe(0);
  });

  it("cross-check: latest real price per supplier, undone imports out, expired flagged, search escapes wildcards", async () => {
    await imp(solo, "ABC Supply", [["OSB 7/16", "sheet", 14.5, "OSB716"], ["Ice & water 100%", "roll", 80]], { days: 10 });
    await imp(solo, "ABC Supply", [["OSB 7/16", "sheet", 15.25, "OSB716"]], { days: 1 });             // newer price wins
    await imp(solo, "Home Lumber", [["osb 7/16 ", "SHEET", 13.9], ["Ice & water 50", "roll", 70, undefined, "2020-01-01"]]);
    await imp(solo, "QXO", [["OSB 7/16", "sheet", 9.99]], { status: "undone" });                    // undone: ignored
    await imp(stranger, "Cheap Co", [["OSB 7/16", "sheet", 1]]);                                    // someone else's

    const found = await val<{ rows: Row[] }>(solo, "select public.supplier_price_cross_check($1)", ["osb"]);
    expect(found.rows.map((r) => [r.supplier, Number(r.unitCost)])).toEqual([["Home Lumber", 13.9], ["ABC Supply", 15.25]]);
    const compare = await val<{ rows: Row[] }>(solo, "select public.supplier_price_cross_check(null)");
    expect(compare.rows.map((r) => r.supplier)).toEqual(["Home Lumber", "ABC Supply"]);         // only products 2+ suppliers price
    const pct = await val<{ rows: Row[] }>(solo, "select public.supplier_price_cross_check($1)", ["100%"]);
    expect(pct.rows.map((r) => r.product)).toEqual(["Ice & water 100%"]);
    const expired = await val<{ rows: Row[] }>(solo, "select public.supplier_price_cross_check($1)", ["water 50"]);
    expect(expired.rows[0].expired).toBe(true);
    expect(await fails(as(solo, "select public.supplier_price_cross_check($1)", ["x".repeat(101)]))).toMatch(/invalid/);
  });

  it("cross-check: company members see imports linked to company suppliers, not each other's unlinked ones", async () => {
    const sup = await val<string>(owner, "select public.pm_supplier_save($1)", [{ name: "SRS" }]);
    await imp(est, "SRS", [["Ridge cap", "bundle", 52]], { supplierId: sup });
    await imp(est, "Private Yard", [["Ridge cap", "bundle", 49]]);
    const forOwner = await val<{ rows: Row[] }>(owner, "select public.supplier_price_cross_check($1)", ["ridge"]);
    expect(forOwner.rows.map((r) => r.supplier)).toEqual(["SRS"]);
    const forEst = await val<{ rows: Row[] }>(est, "select public.supplier_price_cross_check($1)", ["ridge"]);
    expect(forEst.rows.map((r) => r.supplier)).toEqual(["Private Yard", "SRS"]);
    await as(owner, "select public.pm_supplier_set_status($1, 'archived')", [sup]);
    expect((await val<{ rows: Row[] }>(owner, "select public.supplier_price_cross_check($1)", ["ridge"])).rows).toEqual([]);
  });

  it("rollback removes the feature and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/supplier-pricing/rollback_20261211001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.supplier_connections') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select to_regprocedure('public.supplier_price_cross_check(text)') as f")).rows[0].f).toBeNull();
    await applyMigration(pool, "20261211001001_supplier_pricing.sql");
    expect((await pool.query("select to_regclass('public.supplier_connections') as t")).rows[0].t).not.toBeNull();
  });
});
