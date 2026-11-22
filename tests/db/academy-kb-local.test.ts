import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";

/**
 * Local permitting authorities (20270222001000 + seed 20270222002000): picking a verified Minnesota city or township
 * turns "Jurisdiction Confirmation Needed" into a documented answer from the DLI directory.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy local permitting authorities", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_kb_local_test")); }, 180_000);
  afterAll(async () => { await drop?.(); });

  const search = async (q: string, state: string, local: string | null) =>
    (await pool.query("select * from public.academy_kb_search($1, $2, $3, array['decks'], null, null, null, false, 10)", [q, state, local])).rows as Row[];

  it("loads Minnesota's DLI directory with honest statuses", async () => {
    const r = (await pool.query("select kind, local_status, count(*)::int n from public.academy_kb_jurisdictions where state_code = 'MN' and level = 'municipal' group by 1, 2")).rows;
    const total = r.reduce((a, x) => a + x.n, 0);
    expect(total).toBeGreaterThan(3000);
    expect(r.find((x) => x.kind === "city" && x.local_status === "enforces")?.n).toBeGreaterThan(400);
    const byron = (await pool.query("select name, kind, local_status, phone, parent_id, verified_at from public.academy_kb_jurisdictions where id = 'MN:byron'")).rows[0];
    expect(byron).toMatchObject({ name: "Byron", kind: "city", local_status: "enforces", parent_id: "MN:olmsted-county" });
    expect(byron.verified_at).not.toBeNull();
    const cascade = (await pool.query("select name from public.academy_kb_jurisdictions where id = 'MN:olmsted:cascade-twp'")).rows[0];
    expect(cascade?.name).toBe("Cascade Township, Olmsted County");
  });

  it("a city that enforces the code makes the Minnesota rule Verified Applicable, with the local facts", async () => {
    const rows = await search("deck stair riser height", "MN", "MN:byron");
    expect(rows[0].citation).toBe("Minn. R. 1309.0311, subp. 2");
    expect(rows[0].applicability.status).toBe("verified_applicable");
    expect(rows[0].applicability.reason).toBe("local_verified");
    expect(rows[0].applicability.local).toMatchObject({ name: "Byron", status: "enforces" });
  });

  it("a township that has not adopted the code says so instead of claiming it applies", async () => {
    const twp = (await pool.query("select id from public.academy_kb_jurisdictions where state_code = 'MN' and kind = 'township' and local_status = 'not_enforced' limit 1")).rows[0].id;
    const rows = await search("deck stair riser height", "MN", twp);
    expect(rows[0].applicability.status).toBe("jurisdiction_confirmation_needed");
    expect(rows[0].applicability.reason).toBe("local_not_enforced");
  });

  it("an unknown or unverified local area stays Jurisdiction Confirmation Needed", async () => {
    expect((await search("deck stair riser height", "MN", "MN:olmsted-county"))[0].applicability.reason).toBe("local_not_verified");
    expect((await search("deck stair riser height", "MN", "MN:nowhere-at-all"))[0].applicability.reason).toBe("local_not_verified");
    expect((await search("deck stair riser height", "MN", null))[0].applicability.reason).toBe("local_not_selected");
  });

  it("the loader is not callable by visitors", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expect(c.query("select public.academy_kb_load_local('MN', 'https://x', now(), 'x|X|c|olmsted|Y||s|l|0|0|1')")).rejects.toThrow(/permission denied/);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });

  it("re-running the seed changes nothing", async () => {
    const before = (await pool.query("select count(*)::int n from public.academy_kb_jurisdictions")).rows[0].n;
    const { readFileSync } = await import("node:fs");
    await pool.query(readFileSync("supabase/migrations/20270222002000_academy_kb_local_seed.sql", "utf8"));
    expect((await pool.query("select count(*)::int n from public.academy_kb_jurisdictions")).rows[0].n).toBe(before);
  });
});

d("academy local permitting authorities rollback", () => {
  it("rolls back to the original applicability without touching the knowledge engine", async () => {
    const { pool, drop } = await freshDb("academy_kb_local_rb");
    try {
      const { readFileSync } = await import("node:fs");
      await pool.query(readFileSync("docs/academy/rollback_20270222001000.sql", "utf8"));
      const cols = (await pool.query("select count(*)::int n from information_schema.columns where table_name = 'academy_kb_jurisdictions' and column_name = 'local_status'")).rows[0].n;
      expect(cols).toBe(0);
      expect((await pool.query("select count(*)::int n from public.academy_kb_jurisdictions")).rows[0].n).toBe(52);
      const r = (await pool.query("select applicability from public.academy_kb_search('deck stair riser height', 'MN', 'MN:byron', array['decks'], null, null, null, false, 1)")).rows[0];
      expect(r.applicability.reason).toBe("local_not_verified");
    } finally { await drop(); }
  }, 180_000);
});
