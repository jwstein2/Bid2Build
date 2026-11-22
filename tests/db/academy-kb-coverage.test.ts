import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

/** Coverage audit (20270222005000): runs real searches for every state + DC and stores an honest snapshot. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy coverage audit", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_kb_coverage_test")); }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("audits all 50 states + DC with real searches", async () => {
    const id = (await pool.query("select public.academy_kb_run_coverage_audit('manual') id")).rows[0].id;
    const run = (await pool.query("select summary, states from public.academy_kb_coverage_runs where id = $1", [id])).rows[0];
    expect(run.summary.jurisdictions).toBe(51);
    expect(run.summary.searches).toBe(51 * 6);
    const byState = Object.fromEntries(run.states.map((s: { state: string }) => [s.state, s]));
    // Minnesota has verified state text, so a deck stair question gets a verified building-code answer there.
    const mn = byState.MN.searches.find((t: { q: string }) => t.q === "deck stair riser height");
    expect(mn.outcome).toBe("answer");
    expect(mn.citation).toMatch(/Minn\. R\./);
    expect(byState.MN.categories.residential.status).toBe("searchable");
    // California: verified statewide codes, but official reference only (no copyrighted Title 24 text), never an OSHA "answer" for deck stairs.
    expect(byState.CA.categories.residential.status).toBe("reference");
    expect(byState.CA.categories.green.status).toBe("reference");
    const ca = byState.CA.searches.find((t: { q: string }) => t.q === "deck stair riser height");
    expect(ca.outcome).not.toBe("answer");
    const wi = byState.WI.searches.find((t: { q: string }) => t.q === "deck stair riser height");
    expect(wi.citation ?? "").not.toMatch(/1926/);
  });

  it("is limited to Academy editors", async () => {
    const uid = await createUser(pool, "coverage-nobody@example.test");
    await expect(asUser(pool, uid, (q) => q("select public.academy_kb_run_coverage_audit('manual')"))).rejects.toThrow(/forbidden/);
    const seen = await asUser(pool, uid, async (q) => (await q("select count(*)::int n from public.academy_kb_coverage_runs")).rows[0].n);
    expect(seen).toBe(0);
  });
});
