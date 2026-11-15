import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const h = (s: string) => createHash("sha256").update(s).digest("hex");

const move = (u: string, id: string, s: string, note: string | null = null, at: string | null = null) =>
  asUser(pool, u, (q) => q("select public.set_estimate_stage($1, $2, $3, $4)", [id, s, note, at]));
const row = async (id: string) => (await pool.query("select pipeline_stage, won_at, lost_reason from public.estimates where id = $1", [id])).rows[0];

d("V4 sales pipeline (database)", () => {
  let solo: string, other: string;
  async function newBid(u: string, total = 1000) {
    const id = (await asUser(pool, u, (q) => q("insert into public.estimates (user_id, title, customer_name) values ($1, 'Deck', 'Cust') returning id", [u]))).rows[0].id as string;
    const v = (await pool.query(
      `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
       values ($1, $2, 1, $3, '{}', $4, 700, $5, 0, $5) returning id`,
      [id, u, h(id), { meta: { title: "Deck", number: "1" }, customer: { name: "Cust" }, pricing: { total: "$1" } }, total])).rows[0].id as string;
    return { id, v };
  }
  async function sign(u: string, b: { id: string; v: string }) {
    const tok = `tok-${b.id}`;
    await pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, now() + interval '7 days')", [u, b.id, b.v, h(tok), h("d")]);
    await pool.query(`select * from public.accept_signing_request($1, 'John Smith', 'j@x.dev', 'typed', 'John Smith', null, 'v1', 'I consent', 'I accept', now(), '203.0.113.9', 'agent')`, [h(tok)]);
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_pipeline"));
    solo = await createUser(pool, "solo@test.dev");
    other = await createUser(pool, "other@test.dev");
  });
  afterAll(async () => { await drop?.(); });

  it("job stages exist but need a won bid", async () => {
    const b = await newBid(solo);
    await expect(move(solo, b.id, "scheduled")).rejects.toThrow(/not_won/);
    await move(solo, b.id, "won", "Approved by phone", "2026-11-10T12:00:00Z");
    let r = await row(b.id);
    expect(r.pipeline_stage).toBe("won");
    expect(new Date(r.won_at).toISOString()).toBe("2026-11-10T12:00:00.000Z");
    await move(solo, b.id, "scheduled");
    await move(solo, b.id, "in_progress");
    await move(solo, b.id, "completed");
    r = await row(b.id);
    expect(r.pipeline_stage).toBe("completed");
    expect(new Date(r.won_at).toISOString()).toBe("2026-11-10T12:00:00.000Z"); // won date survives job stages
    const hist = (await pool.query("select from_stage, to_stage, note, effective_at from public.estimate_stage_history where estimate_id = $1 order by id", [b.id])).rows;
    expect(hist.map((x) => x.to_stage)).toEqual(["won", "scheduled", "in_progress", "completed"]);
    expect(hist[0].note).toBe("Approved by phone");
  });

  it("a manual Won never creates a signature", async () => {
    const b = await newBid(solo);
    await move(solo, b.id, "won");
    expect((await pool.query("select count(*)::int c from public.signatures where estimate_id = $1", [b.id])).rows[0].c).toBe(0);
  });

  it("reopening clears the won date; future dates are refused", async () => {
    const b = await newBid(solo);
    await move(solo, b.id, "won");
    await move(solo, b.id, "sent");
    expect((await row(b.id)).won_at).toBeNull();
    await expect(move(solo, b.id, "won", null, new Date(Date.now() + 5 * 864e5).toISOString())).rejects.toThrow(/invalid_date/);
  });

  it("signed bids can't move back before Won, but can be scheduled or lost", async () => {
    const b = await newBid(solo);
    await sign(solo, b);
    await expect(move(solo, b.id, "sent")).rejects.toThrow(/bid_signed/);
    await expect(move(solo, b.id, "draft")).rejects.toThrow(/bid_signed/);
    await move(solo, b.id, "scheduled"); // signature counts as won
    expect((await row(b.id)).pipeline_stage).toBe("scheduled");
    await move(solo, b.id, "lost", "Customer cancelled");
    expect(await row(b.id)).toMatchObject({ pipeline_stage: "lost", lost_reason: "Customer cancelled", won_at: null });
    expect((await pool.query("select count(*)::int c from public.signatures where estimate_id = $1", [b.id])).rows[0].c).toBe(1);
  });

  it("stage and won date can't be written directly or by another user", async () => {
    const b = await newBid(solo);
    await expect(asUser(pool, solo, (q) => q("update public.estimates set won_at = now() where id = $1", [b.id]))).rejects.toThrow(/use_set_estimate_stage/);
    await expect(asUser(pool, solo, (q) => q("update public.estimates set pipeline_stage = 'completed' where id = $1", [b.id]))).rejects.toThrow(/use_set_estimate_stage/);
    await expect(move(other, b.id, "won")).rejects.toThrow(/estimate_not_found/);
  });

  it("sales pay settings are private to their owner", async () => {
    await asUser(pool, solo, (q) => q("insert into public.sales_pay_settings (user_id, method, rate) values ($1, 'percent_profit', 12.5)", [solo]));
    const mine = await asUser(pool, solo, (q) => q("select rate from public.sales_pay_settings"));
    expect(mine.rows.map((r) => Number(r.rate))).toEqual([12.5]);
    const theirs = await asUser(pool, other, (q) => q("select * from public.sales_pay_settings"));
    expect(theirs.rows).toHaveLength(0);
    await expect(asUser(pool, other, (q) => q("insert into public.sales_pay_settings (user_id, method, rate) values ($1, 'flat', 1)", [solo]))).rejects.toThrow(/row-level security/);
    const upd = await asUser(pool, other, (q) => q("update public.sales_pay_settings set rate = 99 where user_id = $1", [solo]));
    expect(upd.rowCount).toBe(0);
  });

  it("the migration can run twice", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../supabase/migrations/20261116002000_sales_pipeline.sql", import.meta.url), "utf8");
    await pool.query(sql);
    await pool.query(sql);
  });
});
