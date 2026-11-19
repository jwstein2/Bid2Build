import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const val = async (sql: string, params: unknown[] = []) => Object.values((await pool.query(sql, params)).rows[0])[0];

d("sales academy + AI cap (database)", () => {
  let owner: string, repId: string, ritaU: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_academy"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    repId = ((await pool.query("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita Rep', null, 'rep', 'active', null) as r", [owner])).rows[0].r).id;
    ritaU = await createUser(pool, "rita@sales.com");
    await asUser(pool, ritaU, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("records attempts, keeps the best score and the first pass", async () => {
    await val("select public.sales_academy_record($1, 'closing', 2, 4, false)", [repId]);
    await val("select public.sales_academy_record($1, 'closing', 4, 4, true)", [repId]);
    await val("select public.sales_academy_record($1, 'closing', 1, 4, false)", [repId]);
    const mine = await asUser(pool, ritaU, (q) => q("select public.sales_my_academy() as a"));
    expect(mine.rows[0].a).toEqual([expect.objectContaining({ topic: "closing", best_score: 4, attempts: 3 })]);
    expect(mine.rows[0].a[0].passed_at).not.toBeNull();
    expect(await val("select public.admin_sales_academy($1)", [owner])).toEqual({ [repId]: ["closing"] });
  });

  it("doesn't let a rep record their own quiz result", async () => {
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_academy_record($1, 'mindset', 4, 4, true)", [repId]))).rejects.toThrow(/permission denied/);
  });

  it("enforces the monthly AI cap per rep", async () => {
    await pool.query("update public.sales_settings set ai_monthly_cap = 2 where id");
    expect(await val("select public.sales_ai_reserve($1, 'script', null)", [repId])).toBe(1);
    expect(await val("select public.sales_ai_reserve($1, 'script', null)", [repId])).toBe(0);
    await expect(pool.query("select public.sales_ai_reserve($1, 'script', null)", [repId])).rejects.toThrow(/ai_cap_reached/);
  });
});
