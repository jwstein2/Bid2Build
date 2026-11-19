import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const save = (u: string, answers: object, opts: { status?: string; pub?: boolean; congrats?: boolean; share?: boolean; layout?: string | null } = {}) =>
  asUser(pool, u, (q) => q("select public.sales_my_preferences_save($1, $2, $3, $4, $5, $6, true) p",
    [JSON.stringify(answers), opts.status ?? "partial", opts.pub ?? false, opts.congrats ?? true, opts.share ?? true, opts.layout ?? null]));

d("sales hub V8.4 P1 preferences, celebrations, congratulations and rewards (database)", () => {
  let owner: string, adminU: string, ritaU: string, samU: string, rita: string, sam: string, cust: string, cust2: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v84_recog"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string, role: string, sells: boolean) =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, $4, 'active', null, $5) r", [owner, email, name, role, sells])).r.id as string;
    rita = await member("rita@sales.com", "Rita Rep", "rep", true);
    sam = await member("sam@sales.com", "Sam Seller", "rep", true);
    await member("adam@sales.com", "Adam Admin", "admin", false);
    ritaU = await createUser(pool, "rita@sales.com");
    samU = await createUser(pool, "sam@sales.com");
    adminU = await createUser(pool, "adam@sales.com");
    for (const u of [ritaU, samU, adminU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
    cust = await createUser(pool, "cust@co.com");
    cust2 = await createUser(pool, "cust2@co.com");
    await pool.query("insert into public.business_profiles (user_id, company_name) values ($1, 'Acme Roofing')", [cust]);
    for (const [u, r] of [[cust, rita], [cust2, sam]]) {
      await pool.query("insert into public.sales_attributions (user_id, rep_id, source, first_paid_at, first_paid_month) values ($1, $2, 'manual', '2026-11-02', '2026-11-01')", [u, r]);
    }
  });
  afterAll(async () => { await drop?.(); });

  it("starts empty, lets a rep skip, and never requires the survey", async () => {
    const p = (await asUser(pool, ritaU, (q) => q("select public.sales_my_preferences() p"))).rows[0].p;
    expect(p).toMatchObject({ status: "not_started", answers: {}, public_recognition: false, congrats_email: true, dashboard_layout: null });
    const s = (await save(ritaU, {}, { status: "skipped" })).rows[0].p;
    expect(s.status).toBe("skipped");
    // Skipping changes nothing about pay or access.
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_my_overview()"))).resolves.toBeTruthy();
  });

  it("saves, edits and deletes answers, rejecting anything outside q1-q20", async () => {
    await save(ritaU, { q1: "achievement", q3: ["quiet_note"], q4: "private", q11: ["gift_card", "training"], q13: "Fishing", q9: "charts" }, { layout: "earnings" });
    const p = (await asUser(pool, ritaU, (q) => q("select public.sales_my_preferences() p"))).rows[0].p;
    expect(p.answers).toMatchObject({ q1: "achievement", q13: "Fishing" });
    expect(p.dashboard_layout).toBe("earnings");
    await expect(save(ritaU, { q21: "x" })).rejects.toThrow(/invalid_answers/);
    await expect(save(ritaU, { q1: { nested: true } })).rejects.toThrow(/invalid_answers/);
    await expect(save(ritaU, { q20: "x".repeat(501) })).rejects.toThrow(/invalid_answers/);
    await expect(save(ritaU, {}, { layout: "leaderboard" })).rejects.toThrow(/invalid_layout/);
    const cleared = (await asUser(pool, samU, async (q) => {
      await q("select public.sales_my_preferences_save('{\"q13\":\"Golf\"}', 'partial', true, true, false, null, true)");
      return (await q("select public.sales_my_preferences_clear() p")).rows[0].p;
    }));
    expect(cleared).toMatchObject({ answers: {}, status: "not_started", public_recognition: true });
  });

  it("shows admins only recognition fields, and interests only when shared", async () => {
    await save(samU, { q1: "money", q13: "Golf", q16: "email", q8: "direct" }, { share: false });
    const r = (await val("select public.admin_sales_recognition($1)", [adminU])) as { preferences: { rep_id: string; recognition: Record<string, unknown>; interests: unknown }[] };
    const ritaP = r.preferences.find((p) => p.rep_id === rita)!;
    const samP = r.preferences.find((p) => p.rep_id === sam)!;
    expect(ritaP.recognition).toMatchObject({ celebrate: ["quiet_note"], visibility: "private", rewards: ["gift_card", "training"] });
    expect(ritaP.interests).toEqual({ hobbies: "Fishing" });
    expect(JSON.stringify(r.preferences)).not.toMatch(/achievement|charts|direct|"money"/); // motivation and feedback answers stay private
    expect(samP.interests).toBeNull();
    expect(samP.recognition).toEqual({ owner_congrats: "email" });
    await expect(asUser(pool, ritaU, (q) => q("select * from public.sales_rep_preferences"))).rejects.toThrow(/permission denied/);
  });

  it("records customer successes from real product events, once each", async () => {
    // A tutorial or an empty estimate doesn't count.
    const est = (await val("insert into public.estimates (user_id, title) values ($1, 'Roof') returning id", [cust])) as string;
    const grp = (await val("insert into public.estimate_groups (estimate_id, user_id, name) values ($1, $2, 'Main') returning id", [est, cust])) as string;
    await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost) values ($1, $2, $3, 'Shingles', 10, 90)", [est, grp, cust]);
    await pool.query("update public.profiles set onboarding_status = 'completed' where id = $1", [cust]);
    expect(await val("select public.sales_customer_successes_evaluate('2026-11-10T00:00:00Z')")).toMatchObject({ new: 0 });
    // Three priced line items make a real estimate; a sent proposal completes onboarding.
    await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost) values ($1, $2, $3, 'Underlayment', 5, 40), ($1, $2, $3, 'Labor', 16, 55)", [est, grp, cust]);
    await pool.query("insert into public.analytics_events (user_id, event, event_id, created_at) values ($1, 'proposal_sent', 'proposal_sent:t1', '2026-11-08')", [cust]);
    expect(await val("select public.sales_customer_successes_evaluate(now())")).toMatchObject({ new: 3, queued: 0 }); // program off: no drafts
    const kinds = (await pool.query("select kind from public.sales_customer_successes where rep_id = $1 order by kind", [rita])).rows.map((r) => r.kind);
    expect(kinds).toEqual(["first_estimate", "first_proposal", "onboarding_complete"]);
    expect(await val("select public.sales_customer_successes_evaluate(now())")).toMatchObject({ new: 0 });
    const mine = (await asUser(pool, ritaU, (q) => q("select public.sales_my_successes() s"))).rows[0].s as { id: string; customer: string; celebrated: boolean }[];
    expect(mine).toHaveLength(3);
    expect(mine[0].customer).toBe("Acme Roofing");
    expect((await asUser(pool, samU, (q) => q("select public.sales_my_successes() s"))).rows[0].s).toEqual([]);
    // Seeing the celebration marks it once; another rep can't mark Rita's.
    expect((await asUser(pool, samU, (q) => q("select public.sales_my_successes_seen($1) n", [mine.map((m) => m.id)]))).rows[0].n).toBe(0);
    expect((await asUser(pool, ritaU, (q) => q("select public.sales_my_successes_seen($1) n", [mine.map((m) => m.id)]))).rows[0].n).toBe(3);
    expect((await asUser(pool, ritaU, (q) => q("select public.sales_my_successes_seen($1) n", [mine.map((m) => m.id)]))).rows[0].n).toBe(0);
  });

  it("queues owner congratulations only when on, skips opted-out reps, and sends each once", async () => {
    await expect(pool.query("select public.admin_sales_congrats_settings_save($1, true, 'Hi', 'Body')", [adminU])).rejects.toThrow(/not_authorized/);
    const s = (await val("select congrats_body from public.sales_settings where id")) as string;
    expect(s).toContain("Carry on, soldier.");
    await pool.query("select public.admin_sales_congrats_settings_save($1, true, 'Congratulations on Your Customer Onboarding!', $2)", [owner, s]);
    // Sam opts out, then his customer completes onboarding: nothing is queued for him.
    await save(samU, {}, { congrats: false });
    const est = (await val("insert into public.estimates (user_id) values ($1) returning id", [cust2])) as string;
    const grp = (await val("insert into public.estimate_groups (estimate_id, user_id) values ($1, $2) returning id", [est, cust2])) as string;
    await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost) values ($1, $2, $3, 'A', 1, 1), ($1, $2, $3, 'B', 1, 1), ($1, $2, $3, 'C', 1, 1)", [est, grp, cust2]);
    await pool.query("insert into public.analytics_events (user_id, event, event_id) values ($1, 'export_succeeded', 'export:t2')", [cust2]);
    expect(await val("select public.sales_customer_successes_evaluate(now())")).toMatchObject({ new: 3, queued: 0 });
    // Rita's earlier onboarding predates the switch; queue one directly the way the evaluator would.
    const succ = (await val("select id from public.sales_customer_successes where rep_id = $1 and kind = 'onboarding_complete'", [rita])) as string;
    const mid = (await val("insert into public.sales_congrats_emails (success_id, rep_id, subject, body) values ($1, $2, 'S', 'B') returning id", [succ, rita])) as string;
    await expect(pool.query("select public.admin_sales_congrats_claim($1, $2, 'S', 'B')", [adminU, mid])).rejects.toThrow(/not_authorized/);
    const claim = (await val("select public.admin_sales_congrats_claim($1, $2, 'Congrats!', 'Hey Rita')", [owner, mid])) as { to: string; subject: string };
    expect(claim).toMatchObject({ to: "rita@sales.com", subject: "Congrats!" });
    await expect(pool.query("select public.admin_sales_congrats_claim($1, $2, 'x', 'y')", [owner, mid])).rejects.toThrow(/not_sendable/); // double click
    await pool.query("select public.admin_sales_congrats_result($1, $2, false, null, 'timeout')", [owner, mid]);
    await pool.query("select public.admin_sales_congrats_claim($1, $2, 'Congrats!', 'Hey Rita')", [owner, mid]);
    await pool.query("select public.admin_sales_congrats_result($1, $2, true, 'msg_1', null)", [owner, mid]);
    expect(await q1("select status, attempts from public.sales_congrats_emails where id = $1", [mid])).toMatchObject({ status: "sent", attempts: 2 });
    expect(await val("select congratulated_at is not null from public.sales_customer_successes where id = $1", [succ])).toBe(true);
    await expect(pool.query("insert into public.sales_congrats_emails (success_id, rep_id, subject, body) values ($1, $2, 'S', 'B')", [succ, rita])).rejects.toThrow(/duplicate/);
    // Turning the program off blocks sending.
    await pool.query("select public.admin_sales_congrats_settings_save($1, false, 'S', 'B')", [owner]);
    const samSucc = (await val("select id from public.sales_customer_successes where rep_id = $1 and kind = 'onboarding_complete'", [sam])) as string;
    const m2 = (await val("insert into public.sales_congrats_emails (success_id, rep_id, subject, body) values ($1, $2, 'S', 'B') returning id", [samSucc, sam])) as string;
    await expect(pool.query("select public.admin_sales_congrats_claim($1, $2, 'S', 'B')", [owner, m2])).rejects.toThrow(/congrats_disabled/);
    await pool.query("select public.admin_sales_congrats_settings_save($1, true, 'S', 'B')", [owner]);
    expect(await val("select public.admin_sales_congrats_claim($1, $2, 'S', 'B')", [owner, m2])).toMatchObject({ skipped: true });
    expect(await val("select status from public.sales_congrats_emails where id = $1", [m2])).toBe("skipped");
  });

  it("keeps rewards as records, pays only authorized cash through the ledger, and never twice", async () => {
    const reward = async (caller: string, name: string, category: string, tax: string, value: number) =>
      (await val("select public.admin_sales_reward_save($1, null, $2, 'desc', $3, 'any rep', $4, $4, 'owner orders it', $5, true, 'active')", [caller, name, category, value, tax])) as string;
    await expect(reward(adminU, "Nope", "gift_card", "taxable_cash_equivalent", 5000)).rejects.toThrow(/not_authorized/);
    await expect(reward(owner, "Bad", "gift_card", "de_minimis", 5000)).rejects.toThrow(/check constraint/);
    const gift = await reward(owner, "$50 outdoor store card", "gift_card", "taxable_cash_equivalent", 5000);
    const cash = await reward(owner, "$100 cash bonus", "cash", "taxable_cash", 10000);
    const succ = (await val("select id from public.sales_customer_successes where rep_id = $1 and kind = 'first_estimate'", [rita])) as string;
    const propose = (caller: string, rw: string, s: string | null) =>
      pool.query("select public.admin_sales_award_propose($1, $2, $3, 'First customer estimate', null, $4, null) id", [caller, rita, rw, s]);
    const a1 = (await propose(adminU, gift, succ)).rows[0].id as string;
    await expect(propose(adminU, gift, succ)).rejects.toThrow(/already_awarded/); // replay can't award twice
    await expect(pool.query("select public.admin_sales_award_set($1, $2, 'authorized', null)", [adminU, a1])).rejects.toThrow(/not_authorized/);
    await pool.query("select public.admin_sales_award_set($1, $2, 'authorized', null)", [owner, a1]);
    await pool.query("select public.admin_sales_award_set($1, $2, 'delivered', 'Emailed code')", [owner, a1]);
    expect(await q1("select status, commission_id from public.sales_reward_awards where id = $1", [a1])).toMatchObject({ status: "delivered", commission_id: null });
    const a2 = (await propose(owner, cash, null)).rows[0].id as string;
    await pool.query("select public.admin_sales_award_set($1, $2, 'authorized', null)", [owner, a2]);
    expect(await q1("select kind, amount_cents, status from public.sales_commissions where kind = 'reward'")).toMatchObject({ kind: "reward", amount_cents: 10000, status: "earned" });
    await expect(pool.query("select public.admin_sales_award_set($1, $2, 'authorized', null)", [owner, a2])).rejects.toThrow(/invalid_transition/);
    await pool.query("select public.admin_sales_award_set($1, $2, 'canceled', 'mistake')", [owner, a2]);
    expect(await val("select status from public.sales_commissions where kind = 'reward'")).toBe("canceled");
    const mine = (await asUser(pool, ritaU, (q) => q("select public.sales_my_rewards() r"))).rows[0].r as { catalog: Record<string, unknown>[]; awards: { status: string }[] };
    expect(mine.catalog).toHaveLength(2);
    expect(mine.catalog[0]).not.toHaveProperty("cost_cents");
    expect(mine.awards.map((a) => a.status)).toEqual(["delivered"]);
    expect((await asUser(pool, samU, (q) => q("select public.sales_my_rewards() r"))).rows[0].r.awards).toEqual([]);
  });

  it("stops a Sales Admin who also sells from awarding themselves, and keeps admin functions off the browser", async () => {
    const dual = (await q1("select public.admin_sales_member_save($1, null, 'dana@sales.com', 'Dana Both', null, 'admin', 'active', null, true) r", [owner])).r.id as string;
    const danaU = await createUser(pool, "dana@sales.com");
    await asUser(pool, danaU, (q) => q("select public.sales_me()"));
    const rw = (await val("select id from public.sales_rewards limit 1")) as string;
    await expect(pool.query("select public.admin_sales_award_propose($1, $2, $3, 'me', null, null, null)", [danaU, dual, rw])).rejects.toThrow(/cannot_approve_own/);
    await pool.query("select public.admin_sales_recognition_note($1, 'success', (select id from public.sales_customer_successes limit 1), 'Called to say thanks')", [danaU]);
    await expect(asUser(pool, ritaU, (q) => q("select public.admin_sales_recognition($1)", [ritaU]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_customer_successes_evaluate(now())"))).rejects.toThrow(/permission denied/);
    await expect(pool.query("select public.admin_sales_recognition($1)", [ritaU])).rejects.toThrow(/not_authorized/);
  });
});
