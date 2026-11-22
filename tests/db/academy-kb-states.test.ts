import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb } from "./harness";

/**
 * Statewide code adoptions for every state (seed 20270222003000). A row is "verified" only with a verification record
 * holding the official URL and the quote that was re-checked on it; everything else stays pending_review with a reason.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy statewide code adoptions", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_kb_states_test")); }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("covers most states with verified adoptions", async () => {
    const r = (await pool.query("select count(distinct jurisdiction_id)::int n from public.academy_kb_adoptions where status = 'verified' and jurisdiction_id ~ '^[A-Z]{2}$' and jurisdiction_id <> 'US'")).rows[0];
    expect(r.n).toBeGreaterThanOrEqual(40);
    const cov = (await pool.query("select count(*)::int n from public.academy_kb_jurisdictions where level = 'state' and coverage = 'partial'")).rows[0];
    expect(cov.n).toBeGreaterThanOrEqual(40);
  });

  it("never marks a row verified without an official verification record", async () => {
    const r = (await pool.query(`select count(*)::int n from public.academy_kb_adoptions a where a.status = 'verified' and a.jurisdiction_id <> 'US'
      and not exists (select 1 from public.academy_kb_verifications v where v.target_type = 'adoption' and v.target_id = a.id::text and v.result = 'verified' and v.source_url like 'https://%' and coalesce(v.evidence, '') <> '')`)).rows[0];
    expect(r.n).toBe(0);
    const p = (await pool.query("select count(*)::int n, count(notes)::int with_reason from public.academy_kb_adoptions where status = 'pending_review'")).rows[0];
    expect(p.n).toBeGreaterThan(0);
    expect(p.with_reason).toBe(p.n);
  });

  it("stores model codes as citation-only and state codes as official law", async () => {
    const m = (await pool.query("select rights, fulltext_allowed, excerpt_allowed from public.academy_kb_sources where family_slug = 'upc' limit 1")).rows[0];
    expect(m).toMatchObject({ rights: "metadata_only", fulltext_allowed: false, excerpt_allowed: false });
    const s = (await pool.query("select count(*)::int n from public.academy_kb_sources where family_slug = 'state_code' and rights = 'government_edict' and official_url like 'https://%'")).rows[0];
    expect(s.n).toBeGreaterThan(0);
  });

  it("keeps Minnesota's seeded rows and is safe to re-run", async () => {
    const before = (await pool.query("select (select count(*) from public.academy_kb_adoptions)::int a, (select count(*) from public.academy_kb_verifications)::int v")).rows[0];
    await pool.query(readFileSync("supabase/migrations/20270222003000_academy_kb_states_seed.sql", "utf8"));
    const after = (await pool.query("select (select count(*) from public.academy_kb_adoptions)::int a, (select count(*) from public.academy_kb_verifications)::int v")).rows[0];
    expect(after).toEqual(before);
    const mn = (await pool.query("select count(*)::int n from public.academy_kb_adoptions where jurisdiction_id = 'MN' and status = 'verified'")).rows[0];
    expect(mn.n).toBeGreaterThan(5);
  });

  it("rolls back only what it added", async () => {
    await pool.query(readFileSync("docs/academy/rollback_20270222003000.sql", "utf8"));
    const r = (await pool.query("select count(*)::int n from public.academy_kb_adoptions where jurisdiction_id not in ('US', 'MN') and kind = 'adopts'")).rows[0];
    expect(r.n).toBe(0);
    const mn = (await pool.query("select count(*)::int n from public.academy_kb_adoptions where jurisdiction_id = 'MN' and status = 'verified'")).rows[0];
    expect(mn.n).toBeGreaterThan(5);
    const irc = (await pool.query("select count(*)::int n from public.academy_kb_sources where family_slug = 'irc' and edition = '2018'")).rows[0];
    expect(irc.n).toBe(1);
    const cov = (await pool.query("select count(*)::int n from public.academy_kb_jurisdictions where level = 'state' and coverage = 'partial' and id <> 'MN'")).rows[0];
    expect(cov.n).toBe(0);
  });
});
