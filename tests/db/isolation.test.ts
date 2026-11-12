import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const payload = (id: string, gid: string, iid: string, title = "Deck for Pat") => ({
  id, title, trades: ["decks"], estimateNumber: "EST-1", estimateDate: "2026-11-01", expirationDate: "2026-12-01",
  status: "draft", customer: { name: "Pat", email: "pat@example.com" }, location: { zip: "12345" },
  pricing: { mode: "markup", percent: "25" }, fixedAdjustment: "0", taxRate: "6", displayMode: "by_group",
  defaultGroupVisibility: "names_only",
  groups: [{ id: gid, name: "Framing", visibility: null, sortOrder: 0 }],
  items: [
    { id: iid, groupId: gid, name: "Joists", costType: "material", treatment: "marked_up", quantity: "14", unit: "each", unitCost: "24.50", taxable: true, showOnProposal: true, sortOrder: 0 },
    { id: crypto.randomUUID(), groupId: gid, name: "Example", isExample: true, quantity: "1", unitCost: "999", sortOrder: 1 },
  ],
});

d("16. user account isolation (RLS)", () => {
  let alice: string, bob: string;
  const eid = crypto.randomUUID(), gid = crypto.randomUUID(), iid = crypto.randomUUID();

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_rls"));
    alice = await createUser(pool, "alice@test.dev");
    bob = await createUser(pool, "bob@test.dev");
    await asUser(pool, alice, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(payload(eid, gid, iid))]));
    await asUser(pool, alice, (q) => q("insert into public.customers (user_id, name) values ($1, 'Pat')", [alice]));
    await asUser(pool, alice, (q) => q("insert into public.business_profiles (user_id, company_name) values ($1, 'Alice Co')", [alice]));
  });
  afterAll(async () => { await drop?.(); });

  it("save_estimate stores normalized rows and skips example rows", async () => {
    const r = await asUser(pool, alice, (q) => q("select name, quantity::text, unit_cost::text from public.estimate_items where estimate_id = $1", [eid]));
    expect(r.rows).toEqual([{ name: "Joists", quantity: "14.0000", unit_cost: "24.5000" }]);
  });

  it("owner can update; removed items are deleted", async () => {
    const p = payload(eid, gid, iid, "Renamed");
    p.items = [p.items[0]];
    p.items[0].unitCost = "30";
    await asUser(pool, alice, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(p)]));
    const r = await asUser(pool, alice, (q) => q("select e.title, i.unit_cost::text from public.estimates e join public.estimate_items i on i.estimate_id = e.id where e.id = $1", [eid]));
    expect(r.rows).toEqual([{ title: "Renamed", unit_cost: "30.0000" }]);
  });

  it("another user cannot read estimates, items, customers, or branding", async () => {
    for (const t of ["estimates", "estimate_groups", "estimate_items", "customers", "business_profiles"]) {
      const r = await asUser(pool, bob, (q) => q(`select * from public.${t}`));
      expect(r.rows, t).toHaveLength(0);
    }
  });

  it("another user cannot overwrite an estimate through save_estimate", async () => {
    await expect(asUser(pool, bob, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(payload(eid, gid, iid, "Hacked"))]))).rejects.toThrow();
    const r = await pool.query("select title from public.estimates where id = $1", [eid]);
    expect(r.rows[0].title).toBe("Renamed");
  });

  it("another user cannot update/delete rows directly", async () => {
    const u = await asUser(pool, bob, (q) => q("update public.estimates set title = 'x' where id = $1", [eid]));
    expect(u.rowCount).toBe(0);
    const del = await asUser(pool, bob, (q) => q("delete from public.estimate_items where estimate_id = $1", [eid]));
    expect(del.rowCount).toBe(0);
  });

  it("cannot attach items to someone else's group", async () => {
    await expect(asUser(pool, bob, (q) => q(
      "insert into public.estimate_items (estimate_id, group_id, user_id, name) values ($1, $2, $3, 'x')", [eid, gid, bob],
    ))).rejects.toThrow(/row-level security/);
  });

  it("cannot read another user's versions, usage, or storage objects", async () => {
    await pool.query("select * from public.record_export($1, $2, $3, '{}', '{}', 1, 1, 0, 1)", [alice, eid, "a".repeat(64)]);
    await pool.query("insert into storage.objects (bucket_id, name) values ('documents', $1)", [`${alice}/doc.pdf`]);
    await pool.query("insert into storage.objects (bucket_id, name) values ('logos', $1)", [`${alice}/logo.png`]);
    for (const t of ["public.estimate_versions", "public.usage_counters", "public.usage_events", "storage.objects"]) {
      const r = await asUser(pool, bob, (q) => q(`select * from ${t}`));
      expect(r.rows, t).toHaveLength(0);
    }
    const mine = await asUser(pool, alice, (q) => q("select name from storage.objects order by name"));
    expect(mine.rows).toHaveLength(2);
  });

  it("users cannot upload into another user's logo folder", async () => {
    await expect(asUser(pool, bob, (q) => q("insert into storage.objects (bucket_id, name) values ('logos', $1)", [`${alice}/evil.png`]))).rejects.toThrow(/row-level security/);
  });

  it("anonymous users see only the public catalog", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin; set local role anon");
      await expect(client.query("select * from public.estimates")).rejects.toThrow(/permission denied/);
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("admin metrics require an admin role and contain no bid contents", async () => {
    await expect(pool.query("select public.admin_metrics($1)", [bob])).rejects.toThrow(/forbidden/);
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [bob]);
    const r = await pool.query("select public.admin_metrics($1) as m", [bob]);
    const json = JSON.stringify(r.rows[0].m);
    expect(json).not.toContain("Pat");
    expect(json).not.toContain("Joists");
    expect(r.rows[0].m.accounts).toBeGreaterThanOrEqual(2);
  });
});
