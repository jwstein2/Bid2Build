/** V4 Phase 10: the report generation log is server-only and holds no estimate data. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Report generation log (database)", () => {
  let u: string;
  beforeAll(async () => { ({ pool, drop } = await freshDb("byb_test_report_log")); u = await createUser(pool, "u@test.dev"); });
  afterAll(async () => { await drop?.(); });

  it("only the server writes and reads it; columns are who / action / when", async () => {
    await pool.query("insert into public.report_generations (user_id, action) values ($1, 'download')", [u]);
    expect(await fails(asUser(pool, u, (q) => q("insert into public.report_generations (user_id, action) values ($1, 'preview')", [u])))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, u, (q) => q("select * from public.report_generations")))).toMatch(/permission denied/);
    expect(await fails(pool.query("insert into public.report_generations (user_id, action) values ($1, 'shared')", [u]))).toMatch(/check/);
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'report_generations' order by ordinal_position")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "user_id", "company_id", "kind", "action", "created_at"]);
  });
});
