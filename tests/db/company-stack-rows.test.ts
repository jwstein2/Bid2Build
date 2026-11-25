/**
 * Saved Stacks built on Saved Items & Pricing (20270229001000): someone with "Manage saved company pricing"
 * can add and remove rows on a company template another person created. Members without it still can't,
 * private stacks stay private, and the existing guards still apply.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb } from "./harness";
import { asFn, fails, rowsFn, setupWorld, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("company template rows (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  const row = (u: string, asm: string) => as<{ id: string }>(u, "insert into public.assembly_items (assembly_id, user_id, name, unit, quantity) values ($1, $2, 'Dumpster', 'each', 1) returning id", [asm, u]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_company_stack_rows"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("lets a pricing manager add and remove rows on someone else's company template", async () => {
    const tpl = (await as<{ id: string }>(w.owner, "insert into public.assemblies (user_id, name, company_id) values ($1, 'Acme demo package', $2) returning id", [w.owner, w.company])).id;
    const first = (await row(w.owner, tpl)).id;
    // Without the permission: no new rows, and deleting the owner's row removes nothing.
    expect(await fails(row(w.bk, tpl))).toMatch(/row-level security|company_template_locked/);
    expect(await rows(w.bk, "delete from public.assembly_items where id = $1 returning id", [first])).toHaveLength(0);
    // With it: add a row, then remove the owner's row.
    await pool.query("update public.company_members set permissions_granted = array['manage_company_pricing'], permissions_revoked = '{}' where user_id = $1", [w.bk]);
    const added = (await row(w.bk, tpl)).id;
    expect(await rows(w.bk, "delete from public.assembly_items where id = $1 returning id", [first])).toHaveLength(1);
    expect((await pool.query("select id from public.assembly_items where assembly_id = $1", [tpl])).rows.map((r) => r.id)).toEqual([added]);
    // A member of another company never can.
    expect(await fails(row(w.rival, tpl))).toMatch(/row-level security|company_template_locked/);
    expect(await rows(w.rival, "delete from public.assembly_items where id = $1 returning id", [added])).toHaveLength(0);
  });

  it("keeps private stacks private, even for pricing managers", async () => {
    const mine = (await as<{ id: string }>(w.solo, "insert into public.assemblies (user_id, name) values ($1, 'Solo stack') returning id", [w.solo])).id;
    const r = (await row(w.solo, mine)).id;
    await pool.query("update public.company_members set permissions_granted = array['manage_company_pricing'], permissions_revoked = '{}' where user_id = $1", [w.bk]);
    expect(await fails(row(w.bk, mine))).toMatch(/row-level security|company_template_locked/);
    expect(await rows(w.bk, "delete from public.assembly_items where id = $1 returning id", [r])).toHaveLength(0);
    expect(await rows(w.owner, "delete from public.assembly_items where id = $1 returning id", [r])).toHaveLength(0);
  });
});
