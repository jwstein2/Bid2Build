import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const MIGRATION = "20261127001000_pricing_v5_supplier_import.sql";

const subscribe = (u: string) =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $2, $3, 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())",
    [u, `cus_${u}`, `sub_${u}`],
  );
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("V5 supplier price import (database)", () => {
  let pro: string, free: string, rival: string;
  let shingles: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_pricing_import", { stopBefore: MIGRATION }));
    pro = await createUser(pool, "pro@test.dev");
    free = await createUser(pool, "free@test.dev");
    rival = await createUser(pool, "rival@test.dev");
    await subscribe(pro);
    await subscribe(rival);
    shingles = (await pool.query("insert into public.saved_items (user_id, name, unit, unit_cost, trade) values ($1, 'Architectural shingles', 'bundle', 38.50, 'roofing') returning id", [pro])).rows[0].id;
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
  });
  afterAll(async () => { await drop?.(); });

  const apply = (u: string, p: unknown) => asUser(pool, u, (q) => q("select public.price_import_apply($1) as r", [p])).then((r) => r.rows[0].r);
  const undo = (u: string, id: string) => asUser(pool, u, (q) => q("select public.price_import_undo($1) as r", [id])).then((r) => r.rows[0].r);
  const item = (id: string) => pool.query("select unit_cost::text, price_source, supplier_name, supplier_sku from public.saved_items where id = $1", [id]).then((r) => r.rows[0]);

  it("existing saved items keep their price and are marked manual", async () => {
    expect(await item(shingles)).toEqual({ unit_cost: "38.5000", price_source: "manual", supplier_name: null, supplier_sku: null });
  });

  it("an import updates a matched item, creates a new one, records history and the replaced price", async () => {
    const r = await apply(pro, {
      supplierName: "ABC Supply", fileName: "abc-nov.csv", effectiveOn: "2026-11-15",
      rows: [
        { savedItemId: shingles, name: "Architectural shingles", sku: "GAF-TL-01", unit: "bundle", unitCost: "41.25" },
        { name: "Synthetic underlayment", sku: "UDL-10", unit: "roll", unitCost: "89.00", packSize: "10", trade: "roofing" },
      ],
    });
    expect(r).toMatchObject({ created: 1, updated: 1, unchanged: 0 });
    expect(await item(shingles)).toEqual({ unit_cost: "41.2500", price_source: "supplier_import", supplier_name: "ABC Supply", supplier_sku: "GAF-TL-01" });
    const recs = await pool.query("select action, unit_cost::text, previous_unit_cost::text, effective_on::text from public.price_records where import_id = $1 order by action", [r.importId]);
    expect(recs.rows).toEqual([
      { action: "created", unit_cost: "89.0000", previous_unit_cost: null, effective_on: "2026-11-15" },
      { action: "updated", unit_cost: "41.2500", previous_unit_cost: "38.5000", effective_on: "2026-11-15" },
    ]);
    // Undo restores both: the old price comes back and the created item goes.
    expect(await undo(pro, r.importId)).toEqual({ restored: 1, removed: 1, kept: 0 });
    expect(await item(shingles)).toEqual({ unit_cost: "38.5000", price_source: "manual", supplier_name: null, supplier_sku: null });
    expect((await pool.query("select count(*)::int as n from public.saved_items where name = 'Synthetic underlayment'")).rows[0].n).toBe(0);
    expect(await fails(undo(pro, r.importId))).toMatch(/already_undone/);
  });

  it("undo keeps a price the contractor edited after the import (and a hand edit is a manual price)", async () => {
    const r = await apply(pro, { supplierName: "ABC Supply", rows: [{ savedItemId: shingles, name: "Architectural shingles", unit: "bundle", unitCost: "40.00" }] });
    expect((await item(shingles)).price_source).toBe("supplier_import");
    await asUser(pool, pro, (q) => q("update public.saved_items set unit_cost = 42 where id = $1", [shingles]));
    expect((await item(shingles)).price_source).toBe("manual");
    // Renaming without touching the price keeps the source.
    await asUser(pool, pro, (q) => q("update public.saved_items set description = 'x' where id = $1", [shingles]));
    expect((await item(shingles)).price_source).toBe("manual");
    expect(await undo(pro, r.importId)).toEqual({ restored: 0, removed: 0, kept: 1 });
    expect((await item(shingles)).unit_cost).toBe("42.0000");
  });

  it("a later import wins: undoing the older one keeps the newer price", async () => {
    const a = await apply(pro, { supplierName: "ABC Supply", rows: [{ savedItemId: shingles, name: "Architectural shingles", unit: "bundle", unitCost: "43.00" }] });
    const b = await apply(pro, { supplierName: "SRS", rows: [{ savedItemId: shingles, name: "Architectural shingles", unit: "bundle", unitCost: "44.00" }] });
    expect(await undo(pro, a.importId)).toMatchObject({ kept: 1 });
    expect((await item(shingles)).unit_cost).toBe("44.0000");
    expect(await undo(pro, b.importId)).toMatchObject({ restored: 1 });
    expect((await item(shingles)).unit_cost).toBe("43.0000");
  });

  it("same price is counted unchanged and doesn't touch the item", async () => {
    const r = await apply(pro, { supplierName: "SRS", rows: [{ savedItemId: shingles, name: "Architectural shingles", unit: "bundle", unitCost: "43" }] });
    expect(r).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it("the whole file is refused on a bad row (nothing half-applied)", async () => {
    const before = (await pool.query("select count(*)::int as n from public.price_imports")).rows[0].n;
    expect(await fails(apply(pro, { supplierName: "ABC", rows: [{ name: "Good", unit: "each", unitCost: "1" }, { name: "Bad", unit: "each", unitCost: "-3" }] }))).toMatch(/row_bad_number/);
    expect(await fails(apply(pro, { supplierName: "ABC", rows: [{ name: "Bad", unit: "each", unitCost: "abc" }] }))).toMatch(/row_bad_number/);
    expect(await fails(apply(pro, { supplierName: "", rows: [{ name: "A", unit: "each", unitCost: "1" }] }))).toMatch(/supplier_required/);
    expect((await pool.query("select count(*)::int as n from public.price_imports")).rows[0].n).toBe(before);
    expect((await pool.query("select count(*)::int as n from public.saved_items where name = 'Good'")).rows[0].n).toBe(0);
  });

  it("free accounts can't import; nobody can touch another contractor's items or imports", async () => {
    expect(await fails(apply(free, { supplierName: "ABC", rows: [{ name: "A", unit: "each", unitCost: "1" }] }))).toMatch(/premium_required/);
    expect(await fails(apply(rival, { supplierName: "ABC", rows: [{ savedItemId: shingles, name: "x", unit: "each", unitCost: "1" }] }))).toMatch(/item_not_found/);
    const mine = (await pool.query("select id from public.price_imports where user_id = $1 limit 1", [pro])).rows[0].id;
    expect(await fails(undo(rival, mine))).toMatch(/import_not_found/);
    const seen = await asUser(pool, rival, (q) => q("select (select count(*) from public.price_imports)::int as i, (select count(*) from public.price_records)::int as r"));
    expect(seen.rows[0]).toEqual({ i: 0, r: 0 });
    expect(await fails(asUser(pool, pro, (q) => q("insert into public.price_imports (user_id, supplier_name) values ($1, 'x')", [pro])))).toMatch(/row-level security|permission denied/);
  });

  it("target margin accepts 0 to 99.99 only", async () => {
    await pool.query("insert into public.business_profiles (user_id) values ($1) on conflict (user_id) do nothing", [pro]);
    await pool.query("update public.business_profiles set target_margin_pct = 25 where user_id = $1", [pro]);
    expect(await fails(pool.query("update public.business_profiles set target_margin_pct = 100 where user_id = $1", [pro]))).toMatch(/check/);
  });

  it("rollback removes the feature, keeps the contractor's items, and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/v5-pricing-accounting/rollback_20261127001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.price_imports') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select unit_cost::text as c from public.saved_items where id = $1", [shingles])).rows[0].c).toBe("43.0000");
    await applyMigration(pool, MIGRATION);
    expect((await item(shingles)).price_source).toBe("manual");
  });
});
