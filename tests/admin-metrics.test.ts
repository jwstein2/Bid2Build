import { describe, expect, it } from "vitest";
import { delta, leaderboard, locationQuality, overview, parseStateFilters, revenue, series, stateReport, type PlatformData } from "@/lib/admin/metrics";

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const est = (id: string, user: string, o: Partial<PlatformData["estimates"][number]> = {}) => ({ id, user_id: user, company_id: null, trades: ["roofing"], template_trade: null, status: "draft", created_at: ago(1), location_state: null, location_zip: null, project_address: null, ...o });

const data = (): PlatformData => ({
  estimates: [
    est("e1", "u1", { location_zip: "78701" }),                                  // TX via ZIP
    est("e2", "u1", { location_state: "Texas", trades: ["decks"] }),            // TX via state field
    est("e3", "u2", { project_address: "1 Main St, Denver, CO 80202" }),       // CO via address
    est("e4", "u3", { company_id: "c1", project_address: "", created_at: ago(40) }), // no location
    est("e5", "u4", { company_id: "c1", location_zip: "80202", created_at: ago(3) }), // CO, same company as u3
  ],
  versions: [{ estimate_id: "e1", user_id: "u1", created_at: ago(1), version_number: 1 }, { estimate_id: "e1", user_id: "u1", created_at: ago(0), version_number: 2 }, { estimate_id: "e5", user_id: "u4", created_at: ago(2), version_number: 1 }],
  signatures: [{ estimate_id: "e1", user_id: "u1", signed_at: ago(0) }],
  subscriptions: [
    { user_id: "u1", status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: ago(5), seat_quantity: null, current_period_end: ago(-25) },
    { user_id: "u2", status: "active", plan: "annual", cancel_at_period_end: true, canceled_at: ago(2), ended_at: null, updated_at: ago(2), seat_quantity: null, current_period_end: ago(-300) },
    { user_id: "u9", status: "canceled", plan: "monthly", cancel_at_period_end: false, canceled_at: ago(60), ended_at: ago(60), updated_at: ago(60), seat_quantity: null, current_period_end: ago(60) },
  ],
  profiles: ["u1", "u2", "u3", "u4", "u5"].map((id, i) => ({ id, created_at: ago(i * 3) })),
  businesses: [{ user_id: "u1", created_at: ago(1), has_name: true }, { user_id: "u2", created_at: ago(20), has_name: true }],
  companies: [{ id: "c1", created_at: ago(10) }],
  grants: [{ user_id: "u3", status: "active", plan: "enterprise", starts_at: ago(5), expires_at: ago(-100) }],
  consents: [{ user_id: "u1", share_prices: true }, { user_id: "u2", share_prices: false }],
  accounts: 5, verifiedAccounts: 4,
});

describe("stateReport", () => {
  it("counts bids, businesses and accounts per state from ZIP, state field or address", () => {
    const r = stateReport(data(), {}, NOW);
    expect(r.rows.map((x) => [x.state, x.bids, x.businesses, x.accounts, x.finalized, x.signed])).toEqual([["CO", 2, 2, 2, 1, 0], ["TX", 2, 1, 1, 1, 1]]);
    expect(r).toMatchObject({ totalBids: 5, withState: 4, missingState: 1, states: 2, businesses: 3 });
  });
  it("filters by date, trade, plan and status", () => {
    expect(stateReport(data(), { trade: "decks" }, NOW).totalBids).toBe(1);
    expect(stateReport(data(), { from: ago(2).slice(0, 10) }, NOW).totalBids).toBe(3);
    expect(stateReport(data(), { status: "finalized" }, NOW).totalBids).toBe(2);
    // u1, u2 paid; u3 complimentary: paid = e1,e2,e3,e4
    expect(stateReport(data(), { plan: "paid" }, NOW).totalBids).toBe(4);
    expect(stateReport(data(), { plan: "free" }, NOW).totalBids).toBe(1);
  });
  it("sorts", () => {
    expect(stateReport(data(), { sort: "name" }, NOW).rows[0].state).toBe("CO");
    expect(stateReport(data(), { sort: "signed" }, NOW).rows[0].state).toBe("TX");
  });
});

describe("revenue", () => {
  it("estimates MRR from active subscriptions only", () => {
    const r = revenue(data(), NOW);
    expect(r).toMatchObject({ monthly: 1, annual: 1, enterprise: 0, paidAccounts: 2, mrrCents: 1999 + 1242, cancelingAtPeriodEnd: 1, compActive: 1 });
  });
});

describe("overview + helpers", () => {
  it("never double counts finalized bids with several versions", () => {
    const o = overview(data(), NOW);
    expect(o).toMatchObject({ bidsTotal: 5, finalizedBids: 2, versions: 3, signedBids: 1, accounts: 5, businesses: 3, sharingAnalytics: 1, statesRepresented: 2, freeAccounts: 2 });
  });
  it("buckets series and deltas", () => {
    const s = series([ago(0), ago(0), ago(1), ago(40)], NOW, 7, "day");
    expect(s).toHaveLength(7);
    expect(s.at(-1)!.value).toBe(2);
    expect(s.reduce((a, p) => a + p.value, 0)).toBe(3);
    expect(delta([ago(1), ago(2), ago(9)], NOW, 7)).toEqual({ current: 2, previous: 1, pct: 100 });
  });
  it("location quality and leaderboard", () => {
    expect(locationQuality(data().estimates)).toMatchObject({ total: 5, withState: 4, missing: 1, bySource: { zip: 2, state_field: 1, address: 1, missing: 1 } });
    const l = leaderboard(data(), NOW, 30, new Map([["u:u1", "Lone Star"]]));
    expect(l[0]).toMatchObject({ label: "Lone Star", bids: 2, finalized: 1, signed: 1 });
  });
  it("parses filters defensively", () => {
    expect(parseStateFilters({ from: "2026-01-01", to: "bad", trade: "../x", plan: "paid", status: "nope", sort: "name" })).toEqual({ from: "2026-01-01", to: undefined, trade: undefined, plan: "paid", status: "all", sort: "name" });
  });
});
