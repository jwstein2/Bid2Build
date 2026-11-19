import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const val = async (sql: string, params: unknown[] = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
const lead = (n: number, zip: string) => ({ company_name: `Region Co ${n}`, contact_name: "Pat Doe", email: `pat${n}@regionco${n}.com`, phone: `507555${String(n).padStart(4, "0")}`, zip, trades: ["roofing"] });
const importBatch = (id: string, rows: unknown[]) => val("select public.sales_import_batch($1, 'test', $2::jsonb, 0)", [id, JSON.stringify(rows)]) as Promise<Record<string, unknown>>;
const progress = (id: string, cursor: string, checked: number, exhausted = false) =>
  val("select public.sales_import_progress_save($1, $2, $3, $4)", [id, cursor, checked, exhausted]) as Promise<Record<string, unknown>>;
type Target = { mode: string; zip: string | null; state: string | null; paused: boolean; region: { name: string; counties: string[]; zips: string[] } | null;
  source: { url: string; match_by: string; cursor_field: string } | null; resume: { key: string; cursor: string | null; checked: number; added: number; runs: number; exhausted: boolean } };
const target = () => val("select public.sales_import_target()") as Promise<Target>;

d("sales lead import by state region (database)", () => {
  let owner: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_regions"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, "20270114001000_sales_lead_regions.sql"); // safe to re-run
  });
  afterAll(async () => { await drop?.(); });

  it("seeds every Minnesota and Iowa county exactly once, each region with ZIPs", async () => {
    const rows = (await pool.query("select state, slug, counties, zips from public.sales_lead_regions order by state, sort")).rows as { state: string; slug: string; counties: string[]; zips: string[] }[];
    const counties = (st: string) => rows.filter((r) => r.state === st).flatMap((r) => r.counties);
    expect(counties("MN")).toHaveLength(87);
    expect(new Set(counties("MN")).size).toBe(87);
    expect(counties("IA")).toHaveLength(99);
    expect(new Set(counties("IA")).size).toBe(99);
    expect(rows.filter((r) => r.state === "MN").map((r) => r.slug)).toEqual(["metro", "central", "northeast", "northwest", "southeast", "southwest"]);
    expect(rows.every((r) => r.zips.length > 50)).toBe(true);
    const se = rows.find((r) => r.state === "MN" && r.slug === "southeast")!;
    expect(se.counties).toEqual(["Dodge", "Fillmore", "Freeborn", "Goodhue", "Houston", "Mower", "Olmsted", "Rice", "Steele", "Wabasha", "Winona"]);
    expect(se.zips).toContain("55901"); // Rochester
    expect(se.zips).not.toContain("55401"); // Minneapolis
    const allZips = rows.flatMap((r) => r.zips);
    expect(new Set(allZips).size).toBe(allZips.length);
    const picker = await val("select public.admin_sales_lead_regions($1)", [owner]) as { state: string; regions: { slug: string; name: string }[] }[];
    expect(picker.map((s) => s.state)).toEqual(["IA", "MN"]);
    expect(picker[0].regions.find((r) => r.slug === "southwest")?.name).toBe("Southwest Iowa");
  });

  it("a ZIP target still works and reports its own progress key", async () => {
    expect(await target()).toMatchObject({ mode: "zip", zip: null, paused: true, region: null });
    const t = await val("select public.admin_sales_import_target_save($1, '55901', 'roofing', 50, 50, false)", [owner]) as Target;
    expect(t).toMatchObject({ mode: "zip", zip: "55901", paused: false, region: null, source: null, resume: { key: "zip:55901:50:roofing", cursor: null, checked: 0 } });
  });

  it("the owner picks a state region; the agent gets counties, ZIPs, the download and where to resume", async () => {
    await expect(val("select public.admin_sales_import_target_save_region($1, 'WI', 'southeast', null, 50, false)", [owner])).rejects.toThrow(/invalid_region/);
    const t = await val("select public.admin_sales_import_target_save_region($1, 'mn', 'Southeast', 'Roofing', 40, false)", [owner]) as Target;
    expect(t).toMatchObject({ mode: "region", zip: null, state: "MN", paused: false, region: { name: "Southeast Minnesota" },
      source: { match_by: "zip", cursor_field: "Lic_Number" }, resume: { key: "region:MN:southeast:roofing", cursor: null, checked: 0, runs: 0, exhausted: false } });
    expect(t.region!.counties).toContain("Olmsted");
    expect(t.source!.url).toMatch(/^https:\/\/secure\.doli\.state\.mn\.us\//);
    expect(await val("select details->>'mode' from public.audit_logs where action = 'sales.lead_target_set' order by created_at desc limit 1")).toBe("region");
  });

  it("each run resumes after the last one, a retried batch changes nothing, and the owner can start over", async () => {
    const b1 = await importBatch("2026-W48", [lead(1, "55901"), lead(2, "55902")]);
    expect(b1).toMatchObject({ added: 2, target_mode: "region", target_state: "MN", target_region: "southeast", target_key: "region:MN:southeast:roofing", target_zip: null });
    expect(await progress("2026-W48", "CR100500", 120)).toMatchObject({ cursor: "CR100500", checked: 120, added: 2, runs: 1, replayed: false });
    expect(await progress("2026-W48", "CR999999", 999)).toMatchObject({ cursor: "CR100500", checked: 120, replayed: true });
    expect((await target()).resume).toMatchObject({ cursor: "CR100500", checked: 120, added: 2, runs: 1 });

    await importBatch("2026-W49", [lead(3, "55987")]);
    expect(await progress("2026-W49", "CR200000", 80, true)).toMatchObject({ cursor: "CR200000", checked: 200, added: 3, runs: 2, exhausted: true });

    // A different trade is a different list position; switching back keeps the first one's progress.
    expect((await val("select public.admin_sales_import_target_save_region($1, 'MN', 'southeast', null, 40, false)", [owner]) as Target).resume).toMatchObject({ key: "region:MN:southeast:any", cursor: null });
    expect((await val("select public.admin_sales_import_target_save_region($1, 'MN', 'southeast', 'roofing', 40, false)", [owner]) as Target).resume).toMatchObject({ cursor: "CR200000", exhausted: true });
    expect((await val("select public.admin_sales_import_target_save_region($1, 'MN', 'southeast', 'roofing', 40, false, true)", [owner]) as Target).resume).toMatchObject({ cursor: null, checked: 0, exhausted: false });

    await expect(progress("no-such-batch", "x", 1)).rejects.toThrow(/batch_not_found/);
  });

  it("Iowa regions match by the download's county column", async () => {
    const t = await val("select public.admin_sales_import_target_save_region($1, 'IA', 'southwest', null, 50, false)", [owner]) as Target;
    expect(t).toMatchObject({ region: { name: "Southwest Iowa" }, source: { match_by: "county", cursor_field: "registration_number" } });
    expect(t.region!.counties).toEqual(expect.arrayContaining(["Pottawattamie", "Mills", "Fremont", "Page"]));
  });

  it("all of it is owner or service role only", async () => {
    const other = await createUser(pool, "someone@deck.com");
    await expect(val("select public.admin_sales_import_target_save_region($1, 'MN', 'metro', null, 50, false)", [other])).rejects.toThrow();
    await expect(val("select public.admin_sales_lead_regions($1)", [other])).rejects.toThrow();
    await expect(asUser(pool, other, (q) => q("select public.sales_import_progress_save('x', 'y', 1, false)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select * from public.sales_lead_regions"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select * from public.sales_lead_progress"))).rejects.toThrow(/permission denied/);
  });
});
