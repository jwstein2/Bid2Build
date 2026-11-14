import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261114003000_proposal_defaults_premium.sql";
const CFG = { style: "modern" };

const subscribe = (u: string, status = "active") =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $3, $4, $2, 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())",
    [u, status, `cus_${u}`, `sub_${u}`],
  );

const config = async (u: string) => (await pool.query("select default_proposal_config from public.business_profiles where user_id = $1", [u])).rows[0]?.default_proposal_config ?? null;

d("Proposal Templates defaults are Unlimited-only (database)", () => {
  let pro: string, free: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_proposal_defaults", { stopBefore: MIGRATION }));
    pro = await createUser(pool, "pro@test.dev");
    free = await createUser(pool, "free@test.dev");
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
    await subscribe(pro);
  });
  afterAll(async () => { await drop?.(); });

  it("an Unlimited account can save proposal defaults", async () => {
    await asUser(pool, pro, (q) => q("insert into public.business_profiles (user_id, company_name, default_proposal_config) values ($1, 'Pro Co', $2)", [pro, CFG]));
    expect(await config(pro)).toEqual(CFG);
  });

  it("a free account can save its company profile but not proposal defaults", async () => {
    await asUser(pool, free, (q) => q("insert into public.business_profiles (user_id, company_name, default_proposal_config) values ($1, 'Free Co', $2)", [free, CFG]));
    expect(await config(free)).toBeNull();
    await asUser(pool, free, (q) => q("update public.business_profiles set company_name = 'Free Co 2', default_proposal_config = $2 where user_id = $1", [free, CFG]));
    const r = await pool.query("select company_name, default_proposal_config from public.business_profiles where user_id = $1", [free]);
    expect(r.rows[0]).toMatchObject({ company_name: "Free Co 2", default_proposal_config: null });
  });

  it("a lapsed subscription keeps saved defaults untouched and blocks changes until reactivated", async () => {
    await subscribe(pro, "canceled");
    await asUser(pool, pro, (q) => q("update public.business_profiles set default_proposal_config = $2 where user_id = $1", [pro, { style: "other" }]));
    expect(await config(pro)).toEqual(CFG);
    await asUser(pool, pro, (q) => q("update public.business_profiles set company_name = 'Pro Co 2' where user_id = $1", [pro]));
    expect(await config(pro)).toEqual(CFG); // nothing deleted
    await subscribe(pro, "active");
    await asUser(pool, pro, (q) => q("update public.business_profiles set default_proposal_config = $2 where user_id = $1", [pro, { style: "other" }]));
    expect(await config(pro)).toEqual({ style: "other" });
  });

  it("server-side code (no signed-in user) is not affected", async () => {
    await pool.query("update public.business_profiles set default_proposal_config = $2 where user_id = $1", [free, CFG]);
    expect(await config(free)).toEqual(CFG);
  });
});
