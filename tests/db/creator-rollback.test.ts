import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUser, dbAvailable, freshDb } from "./harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const rollback = (f: string) => readFileSync(path.join(ROOT, "supabase/rollback", f), "utf8");
const d = (await dbAvailable()) ? describe : describe.skip;

d("creator partner program rollback", () => {
  it("removes only the program's objects, ends program grants, and keeps regular complimentary grants", async () => {
    const { pool, drop } = await freshDb("b2b_creator_rollback");
    try {
      await createUser(pool, "owner@built2bid.test");
      const regular = (await pool.query(
        "insert into public.complimentary_grants (email, plan, duration_days, status, starts_at, expires_at) values ('regular@x.test', 'unlimited', 30, 'active', now(), now() + interval '30 days') returning id")).rows[0].id;
      const prog = (await pool.query(
        "insert into public.creator_programs (creator_email, workspace_name, gift_allowance, status) values ('c@x.test', 'Creator Co', 5, 'draft') returning id")).rows[0].id;
      const linked = (await pool.query(
        "insert into public.complimentary_grants (email, plan, duration_days, status, starts_at, expires_at, creator_program_id) values ('g@x.test', 'unlimited', 30, 'active', now(), now() + interval '30 days', $1) returning id", [prog])).rows[0].id;

      await pool.query(rollback("20261117002001_creator_outreach_crm_down.sql"));
      await pool.query(rollback("20261117001000_creator_partner_program_down.sql"));

      const left = (await pool.query("select id, status from public.complimentary_grants order by created_at")).rows;
      expect(left.find((r) => r.id === regular)?.status).toBe("active");
      expect(left.find((r) => r.id === linked)?.status).toBe("revoked");
      const tables = (await pool.query("select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'creator_%' or table_name like 'mentorship_%')")).rows;
      expect(tables).toEqual([]);
      const fns = (await pool.query("select proname from pg_proc where proname in ('claim_creator_gift', 'my_mentorship', 'creator_outreach_reallocate', 'creator_grant_changed')")).rows;
      expect(fns).toEqual([]);
      // Existing Complimentary Access keeps working after rollback.
      expect((await pool.query("select count(*)::int n from public.complimentary_grants where public.comp_grant_state(complimentary_grants) = 'active'")).rows[0].n).toBe(1);
    } finally {
      await drop();
    }
  }, 60_000);
});
