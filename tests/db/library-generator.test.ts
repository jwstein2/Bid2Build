import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

/** V8.6 "Generate My Price Library": draft staging, guarded statuses and the one-transaction approval. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
const MIGRATION = "20270115001000_library_generator.sql";
const ROLLBACK = readFileSync(path.resolve(import.meta.dirname, "../../docs/library-generator/rollback_20270115001000.sql"), "utf8");

d("library generator (database)", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let pro: string, free: string, other: string;

  const draft = (u: string) => asUser(pool, u, (q) => q("insert into public.library_drafts (user_id, title, status) values ($1, 'Concrete', 'draft') returning id", [u])).then((r) => r.rows[0].id as string);
  const item = (u: string, draftId: string, over: Record<string, unknown> = {}) => {
    const cols = { name: "Ready-mix concrete", category: "Concrete supply", unit: "cubic yard", unit_cost: null, cost_source: "none", ...over };
    const keys = Object.keys(cols);
    return asUser(pool, u, (q) => q(
      `insert into public.library_draft_items (draft_id, user_id, ${keys.join(", ")}) values ($1, $2, ${keys.map((_, k) => `$${k + 3}`).join(", ")}) returning id`,
      [draftId, u, ...Object.values(cols)],
    )).then((r) => r.rows[0].id as string);
  };
  const approve = (u: string, p: Record<string, unknown>) => asUser(pool, u, (q) => q("select public.library_draft_approve($1::jsonb) r", [JSON.stringify(p)])).then((r) => r.rows[0].r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("library_generator_test"));
    pro = await createUser(pool, "pro-gen@test.dev");
    free = await createUser(pool, "free-gen@test.dev");
    other = await createUser(pool, "other-gen@test.dev");
    await pool.query("select public.apply_subscription_update($1::uuid, $2, $3, 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())", [pro, `cus_${pro}`, `sub_${pro}`]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("drafts and candidates are private to their owner", async () => {
    const id = await draft(pro);
    await item(pro, id);
    const seen = await asUser(pool, other, (q) => q("select count(*)::int n from public.library_draft_items where draft_id = $1", [id]));
    expect(seen.rows[0].n).toBe(0);
    await expect(item(other, id)).rejects.toThrow(/row-level security/);
    const upd = await asUser(pool, other, (q) => q("update public.library_drafts set title = 'x' where id = $1", [id]));
    expect(upd.rowCount).toBe(0);
  });

  it("a candidate can't be marked approved or linked to a saved item without the approval function", async () => {
    const id = await draft(pro);
    await expect(item(pro, id, { status: "approved" })).rejects.toThrow(/approval_required/);
    const c = await item(pro, id);
    await expect(asUser(pool, pro, (q) => q("update public.library_draft_items set status = 'approved' where id = $1", [c]))).rejects.toThrow(/approval_required/);
    const si = (await pool.query("insert into public.saved_items (user_id, name, unit) values ($1, 'x', 'each') returning id", [pro])).rows[0].id;
    await asUser(pool, pro, (q) => q("update public.library_draft_items set saved_item_id = $2 where id = $1", [c, si]));
    expect((await pool.query("select saved_item_id from public.library_draft_items where id = $1", [c])).rows[0].saved_item_id).toBeNull();
  });

  it("approves priced items, keeps unpriced ones in the draft, and is idempotent per request key", async () => {
    const id = await draft(pro);
    const priced = await item(pro, id, { name: "Rebar #4", unit: "piece", unit_cost: 12.5, cost_source: "contractor" });
    const unpriced = await item(pro, id, { name: "Curing compound", unit: "gallon" });
    const key = randomUUID();
    const r = await approve(pro, { draftId: id, requestKey: key, itemIds: [priced, unpriced] });
    expect(r).toMatchObject({ created: 1, awaitingPrice: 1, remaining: 1 });
    const again = await approve(pro, { draftId: id, requestKey: key, itemIds: [priced, unpriced] });
    expect(again).toMatchObject({ created: 1, replayed: true });
    const rows = (await pool.query("select name, unit_cost::text c, source_draft_id from public.saved_items where user_id = $1 and source_draft_id = $2", [pro, id])).rows;
    expect(rows).toEqual([{ name: "Rebar #4", c: "12.5000", source_draft_id: id }]);
    expect((await pool.query("select status from public.library_drafts where id = $1", [id])).rows[0].status).toBe("partially_approved");
    // A new click re-sends the same (already approved) item: nothing is inserted twice.
    const third = await approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [priced] });
    expect(third).toMatchObject({ created: 0 });
    expect(Number((await pool.query("select count(*) n from public.saved_items where source_draft_id = $1", [id])).rows[0].n)).toBe(1);
  });

  it("saves unpriced candidates only on the explicit Unpriced Template path", async () => {
    const id = await draft(pro);
    const c = await item(pro, id, { name: "Expansion joint", unit: "linear foot" });
    const r = await approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [c], templates: true });
    expect(r).toMatchObject({ templates: 1, created: 0, remaining: 0 });
    const s = (await pool.query("select unit_cost from public.saved_items where source_draft_id = $1", [id])).rows[0];
    expect(s.unit_cost).toBeNull();
    expect((await pool.query("select status from public.library_draft_items where id = $1", [c])).rows[0].status).toBe("template");
    expect((await pool.query("select status from public.library_drafts where id = $1", [id])).rows[0].status).toBe("approved");
  });

  it("blocks unresolved duplicates and never overwrites a price without an update choice", async () => {
    const existing = (await pool.query("insert into public.saved_items (user_id, name, unit, unit_cost) values ($1, 'Wire mesh', 'sheet', 9) returning id", [pro])).rows[0].id;
    const id = await draft(pro);
    const dup = await item(pro, id, { name: "Wire mesh", unit: "sheet", unit_cost: 11, cost_source: "contractor", duplicate_of: existing, duplicate_level: "possible" });
    await expect(approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [dup] })).rejects.toThrow(/unresolved_duplicates/);

    await asUser(pool, pro, (q) => q("update public.library_draft_items set duplicate_action = 'merge' where id = $1", [dup]));
    expect(await approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [dup] })).toMatchObject({ merged: 1 });
    expect((await pool.query("select unit_cost::text c from public.saved_items where id = $1", [existing])).rows[0].c).toBe("9.0000");

    const id2 = await draft(pro);
    const upd = await item(pro, id2, { name: "Wire mesh", unit: "sheet", unit_cost: 11, cost_source: "contractor", duplicate_of: existing, duplicate_level: "exact", duplicate_action: "update_existing" });
    expect(await approve(pro, { draftId: id2, requestKey: randomUUID(), itemIds: [upd] })).toMatchObject({ updated: 1 });
    expect((await pool.query("select unit_cost::text c from public.saved_items where id = $1", [existing])).rows[0].c).toBe("11.0000");
    const hist = (await pool.query("select action, unit_cost::text c, previous_unit_cost::text p, draft_id from public.price_records where saved_item_id = $1", [existing])).rows;
    expect(hist).toEqual([{ action: "updated", c: "11.0000", p: "9.0000", draft_id: id2 }]);

    const id3 = await draft(pro);
    const keep = await item(pro, id3, { name: "Wire mesh", unit: "sheet", duplicate_of: existing, duplicate_level: "exact", duplicate_action: "keep_existing" });
    expect(await approve(pro, { draftId: id3, requestKey: randomUUID(), itemIds: [keep] })).toMatchObject({ matched: 1, created: 0 });
  });

  it("rolls back everything when one part fails (free plan can't save stacks)", async () => {
    const id = await draft(free);
    const c = await item(free, id, { name: "Slab labor", unit: "square foot", unit_cost: 2, cost_source: "contractor" });
    const st = (await asUser(pool, free, (q) => q("insert into public.library_draft_stacks (draft_id, user_id, name, scale_unit, components) values ($1, $2, 'Slab', 'square foot', $3::jsonb) returning id", [id, free, JSON.stringify([{ itemId: c, per: "1" }])]))).rows[0].id;
    await expect(approve(free, { draftId: id, requestKey: randomUUID(), itemIds: [c], stackIds: [st] })).rejects.toThrow(/premium_required/);
    expect(Number((await pool.query("select count(*) n from public.saved_items where source_draft_id = $1", [id])).rows[0].n)).toBe(0);
    expect((await pool.query("select status from public.library_draft_items where id = $1", [c])).rows[0].status).toBe("candidate");
    // Items alone work on the free plan.
    expect(await approve(free, { draftId: id, requestKey: randomUUID(), itemIds: [c] })).toMatchObject({ created: 1 });
  });

  it("saves a reviewed stack as a scaling assembly only when listed; items alone never approve it", async () => {
    const id = await draft(pro);
    const mix = await item(pro, id, { name: "Ready-mix 4000 psi", unit: "cubic yard", unit_cost: 165, cost_source: "contractor" });
    const fin = await item(pro, id, { name: "Finishing labor", unit: "square foot", cost_type: "labor" });
    const st = (await asUser(pool, pro, (q) => q("insert into public.library_draft_stacks (draft_id, user_id, name, scale_unit, scale_label, components) values ($1, $2, '4 in slab', 'square foot', 'Slab area', $3::jsonb) returning id",
      [id, pro, JSON.stringify([{ itemId: mix, per: "0.012346", wastePct: "5" }, { itemId: fin, per: "1" }])]))).rows[0].id;
    expect(await approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [mix] })).toMatchObject({ created: 1, stacks: 0 });
    expect((await pool.query("select status from public.library_draft_stacks where id = $1", [st])).rows[0].status).toBe("candidate");
    expect(await approve(pro, { draftId: id, requestKey: randomUUID(), itemIds: [], stackIds: [st] })).toMatchObject({ stacks: 1 });
    const asm = (await pool.query("select a.scale_unit, a.scale_label, i.name, i.qty_per::text per, i.waste_pct::text w, i.unit_cost::text c from public.library_draft_stacks s join public.assemblies a on a.id = s.assembly_id join public.assembly_items i on i.assembly_id = a.id where s.id = $1 order by i.sort_order", [st])).rows;
    expect(asm).toEqual([
      { scale_unit: "square foot", scale_label: "Slab area", name: "Ready-mix 4000 psi", per: "0.012346", w: "5.00", c: "165.0000" },
      { scale_unit: "square foot", scale_label: "Slab area", name: "Finishing labor", per: "1.000000", w: "0.00", c: null },
    ]);
  });

  it("refuses someone else's draft", async () => {
    const id = await draft(pro);
    await expect(approve(other, { draftId: id, requestKey: randomUUID(), itemIds: [] })).rejects.toThrow(/draft_not_found/);
  });

  it("logs library generations as an AI kind", async () => {
    await pool.query("insert into public.ai_generations (user_id, kind, engine, status) values ($1, 'library_generate', 'ai', 'ok')", [pro]);
  });

  it("runs twice safely; rollback removes the generator and keeps saved items", async () => {
    await applyMigration(pool, MIGRATION);
    const before = Number((await pool.query("select count(*) n from public.saved_items")).rows[0].n);
    await pool.query("delete from public.ai_generations where kind = 'library_generate'");
    await pool.query(ROLLBACK);
    expect((await pool.query("select to_regclass('public.library_drafts') t")).rows[0].t).toBeNull();
    expect(Number((await pool.query("select count(*) n from public.saved_items")).rows[0].n)).toBe(before);
    await applyMigration(pool, MIGRATION);
  });
});
