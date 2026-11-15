import { describe, expect, it } from "vitest";
import { costIssues, costTotals, costsForWindow, dedupeAgainst, monthlyEquivalent, parseExpenseCsv, renewals, serviceViews, type ExpenseRow, type ServiceRow } from "@/lib/admin/costs";
import { roundValuation, scorecard, type StripeMoney } from "@/lib/admin/finance";
import { defaultAssumptions, forecast, type Observed } from "@/lib/admin/forecast";
import { accountFacts, activationTiming, landingReport, prorateCosts, scope, signupCohorts, type Snapshot, type SubscriptionRow } from "@/lib/admin/model";
import { RANGES } from "@/lib/admin/view";

const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const R30 = { ...RANGES["30d"], key: "30d" as const };
const sub = (user: string, o: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ stripe_subscription_id: `sub_${user}`, user_id: user, stripe_customer_id: `cus_${user}`, status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: ago(3), seat_quantity: null, current_period_end: ago(-27), company_id: null, ...o });
const est = (id: string, user: string, daysAgo: number) => ({ id, user_id: user, company_id: null, trades: ["roofing"], template_trade: null, status: "draft", created_at: ago(daysAgo), location_state: null, location_zip: null, project_address: null });
const user = (id: string, d: number) => ({ id, email: `${id}@contractor.com`, created_at: ago(d), email_confirmed_at: ago(d), last_sign_in_at: ago(0) });

function snap(): Snapshot {
  return {
    users: [user("a", 80), user("b", 45), user("c", 20), user("comp", 10), user("new", 0.5), { ...user("t", 5), email: "qa@built2bid.test" }],
    usersSource: "auth", labels: [], labelsInstalled: true, adminIds: new Set(),
    estimates: [est("e1", "a", 79.9), est("e2", "a", 60), est("e3", "b", 44), est("e4", "c", 19.5), est("e5", "c", 5), est("e6", "t", 4)],
    versions: [{ estimate_id: "e1", user_id: "a", created_at: ago(79.5), version_number: 1 }, { estimate_id: "e4", user_id: "c", created_at: ago(18), version_number: 1 }],
    signatures: [], signingRequests: [{ id: "r1", estimate_id: "e4", user_id: "c", status: "signed", created_at: ago(10), signed_at: ago(9.5), expires_at: ago(-20) }],
    subscriptions: [
      sub("a", { plan: "monthly" }),
      sub("b", { plan: "annual", status: "canceled", canceled_at: ago(10), ended_at: ago(10) }),
      sub("c", { plan: "monthly" }),
      sub("t", { plan: "monthly" }),
    ],
    businesses: [], companies: [], members: [],
    grants: [{ id: "g", email: "comp@contractor.com", user_id: "comp", status: "active", plan: "enterprise", starts_at: ago(10), expires_at: ago(-20), created_at: ago(10), company_id: null, granted_by: "x", note: null, extra_seats: 0, invite_expires_at: null, revoked_at: null }],
    consents: [],
    events: [{ event: "subscribed", user_id: "a", created_at: ago(70) }, { event: "subscribed", user_id: "b", created_at: ago(40) }, { event: "subscribed", user_id: "c", created_at: ago(15) }, { event: "subscribed", user_id: "t", created_at: ago(4) }],
    leads: [{ user_id: "c", source: "google", utm_source: "google", utm_medium: "cpc", utm_campaign: "x", landing_path: "/bids/roofing", first_touch_at: ago(20), first_campaign_id: null, first_campaign_name: null, stage: "paid", created_at: ago(20) }],
    leadsInstalled: true, attributionV2: true,
    costs: [{ id: 1, period_start: "2026-11-01", channel: "google_ads", campaign_id: "x", amount_usd: "300.00", note: null, created_at: ago(1) }],
    outbox: [], stripeEvents: [], pdfErrors7d: 0, importFailures7d: 0, loadedAt: NOW.toISOString(),
  };
}
const svc = (o: Partial<ServiceRow> & { provider_key: string }): ServiceRow => ({ name: o.provider_key, purpose: null, category: "hosting", status: "active", plan: null, cost_type: "fixed", amount_cents: null, billing_interval: "monthly", next_renewal: null, allocation_pct: 100, budget_monthly_cents: null, cost_source: "manual", dashboard_url: null, invoice_ref: null, notes: null, updated_at: null, ...o });
const exp = (o: Partial<ExpenseRow> & { service_key: string; amount_cents: number }): ExpenseRow => ({ id: 1, incurred_on: "2026-11-05", kind: "fixed", source: "manual", external_id: null, note: null, created_at: ago(1), ...o });
const none = () => false;

describe("tech stack costs", () => {
  it("keeps unknown costs unknown and normalizes annual charges", () => {
    expect(monthlyEquivalent(null, "monthly")).toBeNull();
    expect(monthlyEquivalent(2400, "annual")).toBe(200);
    expect(monthlyEquivalent(null, "none")).toBe(0);
    const views = serviceViews([svc({ provider_key: "netlify", amount_cents: 1900 })], [], none, NOW);
    const t = costTotals(views, [], NOW);
    expect(t.totalMonthlyKnownCents).toBe(1900);
    // Supabase is active in the catalog but has no amount: listed as missing, not counted as $0.
    expect(t.missing.map((m) => m.key)).toContain("supabase");
  });

  it("applies the Built2Bid allocation to shared tools", () => {
    const v = serviceViews([svc({ provider_key: "google-workspace", category: "email", amount_cents: 1400, allocation_pct: 50 })], [], none, NOW).find((x) => x.key === "google-workspace")!;
    expect(v.monthlyTotalCents).toBe(1400);
    expect(v.monthlyAllocatedCents).toBe(700);
  });

  it("does not double count a recurring service's invoice in a window", () => {
    const rows = [svc({ provider_key: "netlify", amount_cents: 1900 }), svc({ provider_key: "anthropic-api", category: "ai", billing_interval: "usage", cost_type: "variable" })];
    const ex = [exp({ service_key: "netlify", amount_cents: 1900, external_id: "INV1" }), exp({ service_key: "anthropic-api", amount_cents: 350 })];
    const views = serviceViews(rows, ex, none, NOW);
    const byCat = costsForWindow(views, ex, NOW.getTime() - 30.4375 * 86_400_000, NOW.getTime());
    expect(byCat.get("hosting")).toBe(1900); // monthly equivalent only, not + the invoice
    expect(byCat.get("ai")).toBe(350);
  });

  it("projects usage spend and flags budgets and renewals", () => {
    const rows = [svc({ provider_key: "anthropic-api", category: "ai", billing_interval: "usage", budget_monthly_cents: 500 }), svc({ provider_key: "domain", category: "domains", amount_cents: 1800, billing_interval: "annual", next_renewal: "2026-11-24" })];
    const views = serviceViews(rows, [exp({ service_key: "anthropic-api", amount_cents: 400, incurred_on: "2026-11-10" })], none, NOW);
    const ai = views.find((v) => v.key === "anthropic-api")!;
    expect(ai.projectedCents).toBe(600); // 400 over 20 days → 30 days
    expect(ai.overBudget).toBe(true);
    expect(renewals(views, NOW, 7).map((v) => v.key)).toEqual(["domain"]);
    const issues = costIssues(views, NOW, { monthCents: 900, budgetCents: 1000 });
    expect(issues.map((i) => i.title).join(" ")).toMatch(/over budget[\s\S]*renewal[\s\S]*90%/);
  });

  it("parses billing CSVs and skips duplicates", () => {
    const known = new Set(["netlify", "supabase"]);
    const p = parseExpenseCsv('date,provider,amount,invoice_id,note\n2026-11-01,netlify,"$1,019.00",INV-1,Pro\n2026-11-01,netlify,19,INV-1,\n2026-11-02,stripe,5,,\n2026-13-01,supabase,25,,\n2026-11-03,supabase,25,,', known);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].amount_cents).toBe(101900);
    expect(p.errors).toHaveLength(3);
    const d = dedupeAgainst(p.rows, [{ service_key: "netlify", incurred_on: "2026-10-01", amount_cents: 1, external_id: "INV-1" }, { service_key: "supabase", incurred_on: "2026-11-03", amount_cents: 2500, external_id: null }]);
    expect(d.fresh).toHaveLength(0);
    expect(d.skipped).toBe(2);
  });
});

describe("business scorecard", () => {
  const sc = scope(snap(), false);
  const facts = accountFacts(sc, NOW);
  const stripe: StripeMoney = { grossCents: 5000, refundsCents: 1000, feesCents: 300, invoices: 3, fetchedAt: NOW.toISOString(), feesScope: "account" };
  const base = { facts, range: R30, now: NOW, costsByCategory: new Map([["hosting", 1900], ["prospecting", 2000]] as const) as Map<never, number>, marketingCosts: prorateCosts(snap().costs, NOW.getTime() - 30 * 86_400_000, NOW.getTime()), aiMeasuredCents: 50, aiLedgered: false, missingCosts: ["Supabase"], activeBusinesses30d: 2, finalizedInWindow: 1, signedInWindow: 1 };

  it("uses Stripe cash, excludes complimentary access, and labels profit provisional", () => {
    const s = scorecard({ ...base, stripe });
    expect(s.revenue.net).toBe(4000);
    expect(s.revenue.mrrCents).toBe(1999 * 2); // a + c; comp and test excluded
    // Ad spend is prorated: Nov 1 → Nov 20 12:00 is 19.5 of November's 30 days → $195.
    expect(s.profit.operatingCents).toBe(4000 - (1900 + 50 + 19500 + 2000 + 300));
    expect(s.profit.missing).toContain("Supabase");
    expect(s.profit.confidence).toBe("estimated");
  });

  it("never claims cash when Stripe is unreachable", () => {
    const s = scorecard({ ...base, stripe: null });
    expect(s.revenue.net).toBeNull();
    expect(s.revenue.source).toBe("unavailable");
    expect(s.profit.revenueBasis).toBe("mrr_estimate");
    expect(s.profit.lines.find((l) => l.label.startsWith("Payment"))!.cents).toBeNull();
  });

  it("computes CAC over the same window and churn from the starting base", () => {
    const s = scorecard({ ...base, stripe });
    expect(s.cac.newPaying).toBe(1); // c (t is a test account, excluded)
    expect(s.cac.blendedCents).toBe(19500 + 2000);
    expect(s.churn.startBase).toBe(2); // a and b were paying 30 days ago
    expect(s.churn.ended).toBe(1);
    expect(s.churn.customer.pct).toBe(50);
    expect(s.churn.customer.small).toBe(true);
  });

  it("shows no CAC number without new paying customers", () => {
    const s = scorecard({ ...base, stripe, facts: facts.filter((f) => f.id !== "c") });
    expect(s.cac.blendedCents).toBeNull();
  });

  it("keeps the valuation illustrative and rounded", () => {
    const s = scorecard({ ...base, stripe, multiples: { low: 2, base: 4, high: 99 } });
    expect(s.ev.multiples.high).toBe(5); // out of range → default
    expect(s.ev.sufficient).toBe(false);
    expect(s.ev.values.base % 50000).toBe(0);
    expect(roundValuation(123_456_78)).toBe(12_000_000); // $123,456.78 → nearest $10,000
    expect(s.unit.ltvCents).toBeNull();
  });
});

describe("activation, cohorts and landing pages", () => {
  const sc = scope(snap(), false);
  const facts = accountFacts(sc, NOW);
  it("measures time to value from real timestamps with observation windows", () => {
    const t = activationTiming(sc, facts, NOW.getTime() - 90 * 86_400_000, NOW.getTime(), NOW);
    expect(t.firstBidSample).toBe(3); // a, b, c
    expect(t.firstBidWithin24h.d).toBe(4); // "new" (12 h old) is not yet eligible
    expect(t.firstBidWithin24h.n).toBe(3);
    expect(t.secondBid30d.n).toBe(1); // a qualifies; c's first bid is under 30 days old, so c is not yet eligible
    expect(t.medianHoursToSign).toBeCloseTo(12, 0);
  });
  it("groups signup cohorts and flags immature ones", () => {
    const c = signupCohorts(sc, facts, NOW);
    expect(c[0].month).toBe("2026-11");
    expect(c[0].immature).toBe(true);
    expect(c.reduce((n, r) => n + r.registered, 0)).toBe(5);
  });
  it("ranks landing pages by paying users", () => {
    const l = landingReport(facts, NOW.getTime() - 30 * 86_400_000, NOW.getTime());
    expect(l[0].path).toBe("/bids/roofing");
    expect(l[0].paid).toBe(1);
  });
});

describe("scaling forecast", () => {
  const o: Observed = { dbBytes: 17e6, storageBytes: 1.5e6, estimates: 30, businesses: 9, aiCostPerGenerationUsd: 0.011, arpaUsd: 19.99, hostingMonthlyUsd: 19 };
  it("uses observed inputs and grows by tiers, not linearly", () => {
    const a = defaultAssumptions(o);
    expect(a.aiCostPerGenerationUsd).toBe(0.011);
    const f100 = forecast(100, a, o), f2500 = forecast(2500, a, o);
    expect(f100.totalUsd).toBeGreaterThan(0);
    expect(f2500.perCustomerUsd).toBeLessThan(f100.perCustomerUsd);
    expect(f2500.limits.length).toBeGreaterThan(0);
    expect(f100.lines.find((l) => l.key === "email")!.note).toMatch(/Resend/);
  });
});
