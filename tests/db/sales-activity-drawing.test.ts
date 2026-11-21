import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

// Randomized activity bonus: monthly drawing against the real migrations (throwaway database, test users only).
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];

async function newRep(owner: string, name: string, state: string | null) {
  const email = `${name.toLowerCase()}@sales.test`;
  const r = await q1("select public.admin_sales_rep_save($1, null, $2, $3, null, 'rep', 'active', null) as r", [owner, email, name]);
  const user = await createUser(pool, email);
  await asUser(pool, user, (q) => q("select public.sales_me()"));
  if (state) await val("select public.admin_sales_rep_work_location($1, $2, $3, null)", [owner, r.r.id, state]);
  return { id: r.r.id as string, user };
}
let subSeq = 0;
async function payingAccounts(n: number) {
  for (let i = 0; i < n; i++) {
    const u = await createUser(pool, `pay${++subSeq}@co.test`);
    await pool.query("insert into public.subscriptions (stripe_subscription_id, stripe_customer_id, user_id, status, plan, source_event_created) values ($1, $1, $2, 'active', 'monthly', now())", [`sub_d${subSeq}`, u]);
  }
}
let leadSeq = 0;
/** n call/email activities for a rep at a time (each on a new lead unless lead given). */
async function activity(rep: string, at: string, n: number, kind = "call", lead?: string) {
  for (let i = 0; i < n; i++) {
    const l = lead ?? (await val("insert into public.sales_leads (company_name) values ($1) returning id", [`Lead ${++leadSeq}`]));
    await pool.query("insert into public.sales_activities (lead_id, rep_id, kind, occurred_at) values ($1, $2, $3, $4)", [l, rep, kind, at]);
  }
}

d("sales activity drawing", () => {
  let owner: string;
  let mia: { id: string; user: string }, ned: { id: string; user: string }, tex: { id: string; user: string };
  // Drawings are for the month before p_now (America/Chicago).
  const RUN_JAN = "2030-02-01T12:00:00Z", IN_JAN = "2030-01-15T18:00:00Z";
  const RUN_FEB = "2030-03-01T12:00:00Z", IN_FEB = "2030-02-10T18:00:00Z";
  const RUN_MAR = "2030-04-01T12:00:00Z", IN_MAR = "2030-03-10T18:00:00Z";

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_drawing"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    mia = await newRep(owner, "Mia", "MN");
    ned = await newRep(owner, "Ned", "MN");
    tex = await newRep(owner, "Tex", "TX");
  });
  afterAll(async () => { await drop?.(); });

  it("skips while the program is off, and records why", async () => {
    await payingAccounts(3);
    expect(await val("select public.sales_activity_drawing_run($1)", [RUN_JAN])).toMatchObject({ status: "no_draw", reason: "program_off" });
    // Idempotent: the month is settled.
    expect(await val("select public.sales_activity_drawing_run($1)", [RUN_JAN])).toMatchObject({ already: true });
  });

  it("prize tiers follow paying accounts: none under 3, $20, $50, $100", async () => {
    const prize = async (n: number) => val("select public.sales_drawing_prize(drawing_tiers, $1) from public.sales_settings", [n]);
    expect([await prize(2), await prize(3), await prize(9), await prize(10), await prize(99), await prize(100), await prize(500)])
      .toEqual([0, 2000, 2000, 5000, 5000, 10000, 10000]);
  });

  it("draws one winner among eligible reps, weighted by capped activity, and adds a reward line", async () => {
    await val("select public.admin_sales_jurisdiction_save($1, 'randomized_activity_bonus', 'MN', null, 'approved', 'Owner decision', 'Owner', '2026-01-01', null, null)", [owner]);
    await val("select public.admin_sales_program_set($1, 'randomized_activity_bonus', true, 'on')", [owner]);
    await pool.query("update public.sales_settings set drawing_entry_cap = 5 where id");
    await activity(mia.id, IN_FEB, 8);                        // 8 leads -> capped at 5
    const lead = (await val("insert into public.sales_leads (company_name) values ('Repeat') returning id")) as string;
    await activity(ned.id, IN_FEB, 3, "email", lead);          // same lead same day -> 1
    await activity(ned.id, IN_FEB, 1, "note");                 // notes don't count
    await activity(tex.id, IN_FEB, 4);                         // TX not approved -> not eligible
    await activity(mia.id, IN_JAN, 4);                         // other month -> ignored
    const r = (await val("select public.sales_activity_drawing_run($1)", [RUN_FEB])) as { status: string; prize_cents: number; total_entries: number; winner_rep_id: string };
    expect(r).toMatchObject({ status: "drawn", prize_cents: 2000, total_entries: 8 });   // Mia 1+5, Ned 1+1
    expect([mia.id, ned.id]).toContain(r.winner_rep_id);
    const row = await q1("select d.entries, d.commission_id, public.sales_drawing_hash_ok(d) ok from public.sales_activity_drawings d where month = '2030-02-01'");
    expect(row.ok).toBe(true);
    expect(row.entries.map((e: { rep_id: string; entries: number }) => [e.rep_id, e.entries]).sort())
      .toEqual([[mia.id, 6], [ned.id, 2]].sort());
    expect(await q1("select rep_id, kind, amount_cents, status from public.sales_commissions where id = $1", [row.commission_id]))
      .toEqual({ rep_id: r.winner_rep_id, kind: "reward", amount_cents: 2000, status: "earned" });
  });

  it("rows can't be edited or deleted", async () => {
    await expect(pool.query("update public.sales_activity_drawings set prize_cents = 1")).rejects.toThrow(/append_only/);
    await expect(pool.query("delete from public.sales_activity_drawings")).rejects.toThrow(/append_only/);
  });

  it("picks winners in proportion to entries (statistical check)", async () => {
    // Re-run the pick logic many times on the stored entries: Mia (6 of 8) should win about 75%.
    const wins = (await val(`select count(*) filter (where t <= 6) from (
      select (('x' || substr(encode(sha256(convert_to(md5(random()::text), 'UTF8')), 'hex'), 1, 12))::bit(48)::bigint % 8)::int + 1 t from generate_series(1, 4000)) s`)) as string;
    expect(Number(wins) / 4000).toBeGreaterThan(0.71);
    expect(Number(wins) / 4000).toBeLessThan(0.79);
  });

  it("bumps the prize at 10 accounts, and shows reps only their own entries", async () => {
    await payingAccounts(7);
    await activity(ned.id, IN_MAR, 2);
    const view = await asUser(pool, ned.user, (q) => q("select public.sales_my_drawing() v"));
    const v = view.rows[0].v as { prize_cents: number; history: { month: string; my_entries: number }[] };
    expect(v.prize_cents).toBe(5000);
    expect(v.history[0]).toMatchObject({ my_entries: 2 });
    expect(JSON.stringify(v)).not.toContain(mia.id);
    expect(await val("select public.sales_activity_drawing_run($1)", [RUN_MAR])).toMatchObject({ status: "drawn", prize_cents: 5000, total_entries: 4 });
  });

  it("validates owner tier edits", async () => {
    await expect(pool.query("select public.admin_sales_drawing_settings_save($1, '[]'::jsonb, 10, 'x')", [owner])).rejects.toThrow(/invalid/);
    await expect(pool.query(`select public.admin_sales_drawing_settings_save($1, '[{"at":3,"cents":2000}]'::jsonb, 10, '')`, [owner])).rejects.toThrow(/reason_required/);
    await val(`select public.admin_sales_drawing_settings_save($1, '[{"at":3,"cents":2500}]'::jsonb, 50, 'raise')`, [owner]);
    expect(await q1("select drawing_tiers, drawing_entry_cap from public.sales_settings where id")).toEqual({ drawing_tiers: [{ at: 3, cents: 2500 }], drawing_entry_cap: 50 });
  });
});
