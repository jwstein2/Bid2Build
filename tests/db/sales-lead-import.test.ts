import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const val = async (sql: string, params: unknown[] = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
const importBatch = (id: string, rows: unknown[]) => val("select public.sales_import_batch($1, 'test', $2::jsonb)", [id, JSON.stringify(rows)]) as Promise<Record<string, unknown>>;

d("sales weekly lead import (database)", () => {
  let owner: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_import"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, "20270109101000_sales_lead_import.sql"); // safe to re-run
  });
  afterAll(async () => { await drop?.(); });

  it("adds new businesses unassigned, skips invalid and duplicates, and counts each", async () => {
    const r = await importBatch("2026-W47", [
      { company_name: "Summit Roofing", phone: "612-555-0100", zip: "55401", trades: ["Roofing", "roofing"], email: "Dana@Summit.com", source_url: "https://example.org/listing/1" },
      { company_name: "Summit Roofing LLC", phone: "(612) 555 0100" },
      { company_name: "No Contact Co" },
      { company_name: "", website: "x.com" },
    ]);
    expect(r).toMatchObject({ received: 4, added: 1, duplicates: 1, invalid: 2, suppressed: 0, replayed: false });
    const lead = (await pool.query("select source, assigned_rep, email, trades, import_batch_id from public.sales_leads where company_name = 'Summit Roofing'")).rows[0];
    expect(lead).toMatchObject({ source: "agent", assigned_rep: null, email: "dana@summit.com", trades: ["roofing"] });
    expect(lead.import_batch_id).toBe(r.id);
  });

  it("the same batch id twice is answered from the first run", async () => {
    const r = await importBatch("2026-W47", [{ company_name: "Brand New Decks", phone: "651-555-0199" }]);
    expect(r).toMatchObject({ added: 1, replayed: true });
    expect(await val("select count(*)::int from public.sales_leads where company_name = 'Brand New Decks'")).toBe(0);
  });

  it("marking a lead do-not-contact suppresses it from future imports, even if the lead is deleted", async () => {
    await pool.query("update public.sales_leads set do_not_contact = true where company_name = 'Summit Roofing'");
    expect(await val("select count(*)::int from public.sales_suppressions")).toBeGreaterThanOrEqual(2);
    await pool.query("delete from public.sales_leads where company_name = 'Summit Roofing'");
    const r = await importBatch("2026-W48", [
      { company_name: "Summit Roofing & Gutters", email: "DANA@summit.com" },
      { company_name: "Summit Again", phone: "+1 612 555 0100" },
      { company_name: "Lakeside Paint", website: "https://lakesidepaint.com" },
    ]);
    expect(r).toMatchObject({ added: 1, suppressed: 2, duplicates: 0 });
  });

  it("only the owner sees batches; the import itself is service-role only", async () => {
    const hub = await val("select public.admin_sales_import_batches($1)", [owner]) as { batches: Record<string, unknown>[]; unassigned_agent: number };
    expect(hub.batches).toHaveLength(2);
    expect(hub.batches[0]).not.toHaveProperty("external_id");
    expect(hub.unassigned_agent).toBe(1);
    const other = await createUser(pool, "someone@deck.com");
    await expect(val("select public.admin_sales_import_batches($1)", [other])).rejects.toThrow();
    await expect(asUser(pool, other, (q) => q("select public.sales_import_batch('x', null, '[]'::jsonb)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select * from public.sales_suppressions"))).rejects.toThrow(/permission denied/);
  });
});
