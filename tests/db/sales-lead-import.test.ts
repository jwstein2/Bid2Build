import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const val = async (sql: string, params: unknown[] = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
const importBatch = (id: string, rows: unknown[], unverified = 0) => val("select public.sales_import_batch($1, 'test', $2::jsonb, $3)", [id, JSON.stringify(rows), unverified]) as Promise<Record<string, unknown>>;

d("sales weekly lead import (database)", () => {
  let owner: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_import"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, "20270109101000_sales_lead_import.sql"); // safe to re-run
  });
  afterAll(async () => { await drop?.(); });

  it("the owner sets the weekly target; the agent reads it", async () => {
    expect(await val("select public.sales_import_target()")).toMatchObject({ zip: null, radius_miles: 50, count: 50, paused: true });
    await expect(val("select public.admin_sales_import_target_save($1, 'abc', null, 50, 50, false)", [owner])).rejects.toThrow(/invalid_zip/);
    expect(await val("select public.admin_sales_import_target_save($1, '55401', 'Roofing', 50, 50, false)", [owner]))
      .toEqual({ zip: "55401", trade: "roofing", radius_miles: 50, count: 50, paused: false });
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.lead_target_set'")).toBe(1);
  });

  it("adds new businesses unassigned with their facts, skips invalid and duplicates, and counts each", async () => {
    const r = await importBatch("2026-W47", [
      { company_name: "Summit Roofing", contact_name: "Dana Lee", phone: "612-555-0100", zip: "55401", trades: ["Roofing", "roofing"], email: "Dana@Summit.com", source_url: "https://example.org/listing/1",
        business_started: "2014-03", verification: { owner_name: ["https://mn.gov/l/1"] } },
      { company_name: "Summit Roofing LLC", phone: "(612) 555 0100" },
      { company_name: "No Contact Co" },
      { company_name: "", website: "x.com" },
    ], 3);
    expect(r).toMatchObject({ received: 7, added: 1, duplicates: 1, invalid: 2, unverified: 3, suppressed: 0, replayed: false, target_zip: "55401", target_trade: "roofing" });
    const lead = (await pool.query("select id, source, assigned_rep, email, trades, import_batch_id, business_started, verification from public.sales_leads where company_name = 'Summit Roofing'")).rows[0];
    expect(lead).toMatchObject({ source: "agent", assigned_rep: null, email: "dana@summit.com", trades: ["roofing"], business_started: "2014-03", verification: { owner_name: ["https://mn.gov/l/1"] } });
    expect(lead.import_batch_id).toBe(r.id);
    expect(r.added_ids).toEqual([lead.id]);
    const missing = await val("select public.sales_leads_missing_brief(10)") as { id: string }[];
    expect(missing.map((m) => m.id)).toEqual([lead.id]);
    await val("select public.sales_lead_brief_set($1, '  Roofer since 2014. ')", [lead.id]);
    expect(await val("select sales_brief from public.sales_leads where id = $1", [lead.id])).toBe("Roofer since 2014.");
    expect(await val("select public.sales_leads_missing_brief(10)")).toEqual([]);
  });

  it("the same batch id twice is answered from the first run", async () => {
    const r = await importBatch("2026-W47", [{ company_name: "Brand New Decks", phone: "651-555-0199" }]);
    expect(r).toMatchObject({ added: 1, replayed: true, added_ids: [] });
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
    expect(hub).toMatchObject({ target: { zip: "55401" } });
    const other = await createUser(pool, "someone@deck.com");
    await expect(val("select public.admin_sales_import_batches($1)", [other])).rejects.toThrow();
    await expect(asUser(pool, other, (q) => q("select public.sales_import_batch('x', null, '[]'::jsonb, 0)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select public.sales_import_target()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select public.sales_lead_brief_set(gen_random_uuid(), 'x')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select * from public.sales_suppressions"))).rejects.toThrow(/permission denied/);
  });
});
