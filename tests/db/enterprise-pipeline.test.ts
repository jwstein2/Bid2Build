import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const stage = (u: string, id: string, s: string, note: string | null = null) =>
  asUser(pool, u, (q) => q("select public.set_estimate_stage($1, $2, $3)", [id, s, note]));
const stageOf = async (id: string) => (await pool.query("select pipeline_stage from public.estimates where id = $1", [id])).rows[0].pipeline_stage;

d("Enterprise pipeline (database)", () => {
  let owner: string, mgr: string, est: string, est2: string, solo: string, company: string, team: string;
  let bidEst: string, bidEst2: string, bidSolo: string;

  async function newBid(u: string, title: string, total?: { total: number; subtotal: number; cost: number }) {
    const id = (await asUser(pool, u, (q) => q("insert into public.estimates (user_id, title, customer_name) values ($1, $2, 'Cust') returning id", [u, title]))).rows[0].id;
    if (total) {
      await pool.query(
        `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
         values ($1, $2, 1, repeat('a', 64), '{}', '{}', $3, $4, 0, $5)`, [id, u, total.cost, total.subtotal, total.total]);
    }
    return id;
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_ent_pipeline"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    est2 = await createUser(pool, "est2@acme.dev");
    solo = await createUser(pool, "solo@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    await pool.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'c', p_stripe_subscription_id => 's', p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 10)", [owner, company]);
    for (const [u, email, role] of [[mgr, "mgr@acme.dev", "manager"], [est, "est@acme.dev", "estimator"], [est2, "est2@acme.dev", "estimator"]] as const) {
      const t = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation($1, $2)", [email, role]))).rows[0].token;
      await asUser(pool, u, (q) => q("select public.accept_company_invitation($1)", [t]));
    }
    team = (await asUser(pool, owner, (q) => q("select public.create_company_team('Roofing', 'roofing') as id"))).rows[0].id;
    for (const [u, m] of [[mgr, true], [est, false]] as const) await asUser(pool, owner, (q) => q("select public.set_company_team_member($1, $2, $3, false)", [team, u, m]));
    bidEst = await newBid(est, "Roof A", { total: 10000, subtotal: 10000, cost: 7000 });
    bidEst2 = await newBid(est2, "Siding B", { total: 5000, subtotal: 5000, cost: 4000 });
    bidSolo = await newBid(solo, "Solo deck");
  });
  afterAll(async () => { await drop?.(); });

  it("new bids start as drafts and the stage can't be set directly", async () => {
    expect(await stageOf(bidEst)).toBe("draft");
    await expect(asUser(pool, est, (q) => q("update public.estimates set pipeline_stage = 'won' where id = $1", [bidEst]))).rejects.toThrow(/use_set_estimate_stage/);
    const forced = (await asUser(pool, est, (q) => q("insert into public.estimates (user_id, title, pipeline_stage) values ($1, 'x', 'won') returning pipeline_stage", [est]))).rows[0];
    expect(forced.pipeline_stage).toBe("draft");
  });

  it("personal bids: owner moves freely, nobody else can", async () => {
    await stage(solo, bidSolo, "sent");
    expect(await stageOf(bidSolo)).toBe("sent");
    await expect(stage(owner, bidSolo, "won")).rejects.toThrow(/estimate_not_found/);
  });

  it("an estimator submits for review but can't approve", async () => {
    await stage(est, bidEst, "ready_for_review");
    await expect(stage(est, bidEst, "approved")).rejects.toThrow(/forbidden/);
  });

  it("a team manager approves team bids but can't see other teams' bids", async () => {
    await stage(mgr, bidEst, "approved", "Looks good");
    expect(await stageOf(bidEst)).toBe("approved");
    await expect(stage(mgr, bidEst2, "approved")).rejects.toThrow(/estimate_not_found/);
    const h = (await asUser(pool, est, (q) => q("select from_stage, to_stage, note from public.estimate_stage_history where estimate_id = $1 order by id", [bidEst]))).rows;
    expect(h).toEqual([{ from_stage: "draft", to_stage: "ready_for_review", note: null }, { from_stage: "ready_for_review", to_stage: "approved", note: "Looks good" }]);
    expect((await asUser(pool, est2, (q) => q("select count(*)::int n from public.estimate_stage_history where estimate_id = $1", [bidEst]))).rows[0].n).toBe(0);
  });

  it("approval rule blocks sending unapproved bids; owner only toggles it", async () => {
    await expect(asUser(pool, mgr, (q) => q("select public.set_company_approval_rule(true)"))).rejects.toThrow(/forbidden/);
    await asUser(pool, owner, (q) => q("select public.set_company_approval_rule(true)"));
    await expect(stage(est2, bidEst2, "sent")).rejects.toThrow(/approval_required/);
    await stage(est, bidEst, "sent"); // already approved
    expect(await stageOf(bidEst)).toBe("sent");
  });

  it("with the rule on, a manager can't approve their own bid but the owner can", async () => {
    const mine = await newBid(mgr, "Mgr bid");
    await expect(stage(mgr, mine, "approved")).rejects.toThrow(/forbidden/);
    await stage(owner, mine, "approved");
    const ownBid = await newBid(owner, "Owner bid");
    await stage(owner, ownBid, "approved");
    expect(await stageOf(ownBid)).toBe("approved");
  });

  it("lost keeps a reason; won/lost recorded in audit", async () => {
    await stage(est, bidEst, "lost", "Price too high");
    expect((await pool.query("select lost_reason from public.estimates where id = $1", [bidEst])).rows[0].lost_reason).toBe("Price too high");
    await stage(est, bidEst, "won");
    expect((await pool.query("select lost_reason from public.estimates where id = $1", [bidEst])).rows[0].lost_reason).toBeNull();
    const n = (await pool.query("select count(*)::int n from public.company_audit_log where company_id = $1 and action = 'bid.stage'", [company])).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("summary: owner sees whole company with margin; manager sees team; estimator is refused", async () => {
    const s = (await asUser(pool, owner, (q) => q("select public.company_pipeline_summary() s"))).rows[0].s;
    expect(s.bids).toBe(5);
    expect(s.won).toBe(1);
    expect(s.winRate).toBe(100);
    expect(Number(s.wonValue)).toBe(10000);
    expect(Number(s.avgMargin)).toBe(25); // (30% + 20%) / 2
    expect(s.requireApproval).toBe(true);
    expect(s.stages.won.count).toBe(1);
    const m = (await asUser(pool, mgr, (q) => q("select public.company_pipeline_summary() s"))).rows[0].s;
    expect(m.bids).toBe(3); // own + est's two (team)
    await expect(asUser(pool, est, (q) => q("select public.company_pipeline_summary()"))).rejects.toThrow(/forbidden/);
  });

  it("bid list is visibility-scoped, filterable and hides margin without permission", async () => {
    const all = (await asUser(pool, owner, (q) => q("select * from public.company_pipeline_bids()"))).rows;
    expect(all).toHaveLength(5);
    expect(all.every((r) => Number(r.total_count) === 5)).toBe(true);
    const won = (await asUser(pool, owner, (q) => q("select title, margin_pct from public.company_pipeline_bids(p_stage => 'won')"))).rows;
    expect(won).toEqual([{ title: "Roof A", margin_pct: "30.0" }]);
    const teamRows = (await asUser(pool, owner, (q) => q("select title from public.company_pipeline_bids(p_team => $1)", [team]))).rows.map((r) => r.title).sort();
    expect(teamRows).toEqual(["Mgr bid", "Roof A", "x"]);
    expect((await asUser(pool, owner, (q) => q("select title from public.company_pipeline_bids(p_q => 'sid')"))).rows).toEqual([{ title: "Siding B" }]);
    const mine = (await asUser(pool, est, (q) => q("select title, margin_pct from public.company_pipeline_bids()"))).rows;
    expect(mine.map((r) => r.title).sort()).toEqual(["Roof A", "x"]);
    expect(mine.every((r) => r.margin_pct === null)).toBe(true);
    const page = (await asUser(pool, owner, (q) => q("select title from public.company_pipeline_bids(p_limit => 2, p_offset => 4)"))).rows;
    expect(page).toHaveLength(1);
  });

  it("bid review shows history and hides costs from people without view_costs", async () => {
    const r = (await asUser(pool, mgr, (q) => q("select public.company_bid_review($1) r", [bidEst]))).rows[0].r;
    expect(r).toMatchObject({ title: "Roof A", stage: "won", isMine: false, canSeeCosts: true });
    expect(Number(r.version.cost)).toBe(7000);
    expect(r.history[0]).toMatchObject({ from: "lost", to: "won", by: expect.any(String) });
    expect(r.history.at(-1)).toMatchObject({ from: "draft", to: "ready_for_review" });
    const viewerless = (await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'manager', '{}', array['view_costs','view_margin'])", [mgr])));
    expect(viewerless).toBeTruthy();
    const r2 = (await asUser(pool, mgr, (q) => q("select public.company_bid_review($1) r", [bidEst]))).rows[0].r;
    expect(r2.version.cost).toBeNull();
    expect(r2.version.marginPct).toBeNull();
    await expect(asUser(pool, mgr, (q) => q("select public.company_bid_review($1)", [bidEst2]))).rejects.toThrow(/estimate_not_found/);
  });

  it("outsiders get nothing", async () => {
    await expect(asUser(pool, solo, (q) => q("select * from public.company_pipeline_bids()"))).rejects.toThrow(/not_a_member/);
    await expect(stage(solo, bidEst, "won")).rejects.toThrow(/estimate_not_found/);
  });
});
