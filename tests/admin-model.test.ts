import { describe, expect, it } from "vitest";
import { classifyAccount, isReservedTestEmail } from "@/lib/admin/classify";
import { classifyChannel } from "@/lib/admin/channels";
import { csvCell } from "@/lib/admin/csv";
import { filterCustomers, parseCustomerFilters } from "@/lib/admin/customers";
import {
  accountFacts, channelReport, cohortFunnel, compare, kpis, monthlyCents, needsAttention, ratio, revenueModel, scope, usageModel,
  type Snapshot, type SubscriptionRow,
} from "@/lib/admin/model";
import { RANGES, href, parseView } from "@/lib/admin/view";
import { captureAttribution, decodeAttribution, encodeAttribution } from "@/lib/growth/attribution";

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const R30 = { ...RANGES["30d"], key: "30d" as const };
const sub = (user: string, o: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ stripe_subscription_id: `sub_${user}`, user_id: user, stripe_customer_id: `cus_${user}`, status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: ago(3), seat_quantity: null, current_period_end: ago(-27), company_id: null, ...o });
const est = (id: string, user: string, daysAgo: number) => ({ id, user_id: user, company_id: null, trades: ["roofing"], template_trade: null, status: "draft", created_at: ago(daysAgo), location_state: null, location_zip: null, project_address: null });

function snap(): Snapshot {
  return {
    users: [
      { id: "owner", email: "owner@built2bid.org", created_at: ago(90), email_confirmed_at: ago(90), last_sign_in_at: ago(0) },
      { id: "u1", email: "roofer@gmail.com", created_at: ago(20), email_confirmed_at: ago(20), last_sign_in_at: ago(1) },
      { id: "u2", email: "decks@yahoo.com", created_at: ago(10), email_confirmed_at: ago(10), last_sign_in_at: ago(2) },
      { id: "u3", email: "paint@outlook.com", created_at: ago(5), email_confirmed_at: null, last_sign_in_at: null },
      { id: "u4", email: "ent@acme.co", created_at: ago(40), email_confirmed_at: ago(40), last_sign_in_at: ago(4) },
      { id: "t1", email: "stripe-test-1@built2bid.test", created_at: ago(3), email_confirmed_at: ago(3), last_sign_in_at: ago(3) },
      { id: "d1", email: "demo@realdomain.com", created_at: ago(2), email_confirmed_at: ago(2), last_sign_in_at: ago(2) },
    ],
    usersSource: "auth",
    labels: [{ user_id: "d1", label: "demo", note: null, updated_at: ago(1) }], labelsInstalled: true,
    adminIds: new Set(["owner"]),
    estimates: [est("e1", "u1", 19), est("e2", "u1", 2), est("e3", "u2", 9), est("e4", "t1", 2), est("e5", "owner", 1), est("e6", "u4", 35)],
    versions: [{ estimate_id: "e1", user_id: "u1", created_at: ago(18), version_number: 1 }, { estimate_id: "e1", user_id: "u1", created_at: ago(17), version_number: 2 }, { estimate_id: "e4", user_id: "t1", created_at: ago(2), version_number: 1 }, { estimate_id: "e6", user_id: "u4", created_at: ago(34), version_number: 1 }],
    signatures: [{ estimate_id: "e1", user_id: "u1", signed_at: ago(15), pdf_status: "ready" }],
    signingRequests: [{ id: "r1", estimate_id: "e1", user_id: "u1", status: "signed", created_at: ago(16), signed_at: ago(15), expires_at: ago(-14) }, { id: "r2", estimate_id: "e1", user_id: "u1", status: "pending", created_at: ago(1), signed_at: null, expires_at: ago(-29) }],
    subscriptions: [
      sub("u1", { plan: "monthly" }),
      sub("u2", { plan: "annual", cancel_at_period_end: true }),
      sub("u4", { plan: "enterprise", seat_quantity: 5, status: "past_due" }),
      sub("t1", { plan: "monthly" }),
      sub("u9", { plan: "monthly", status: "canceled", canceled_at: ago(4), ended_at: ago(4) }),
    ],
    businesses: [{ user_id: "u1", created_at: ago(20), company_name: "Lone Star Roofing" }],
    companies: [], members: [],
    grants: [
      { id: "g1", email: "paint@outlook.com", user_id: "u3", status: "active", plan: "unlimited", starts_at: ago(5), expires_at: ago(-3), created_at: ago(5), company_id: null, granted_by: "owner", note: null, extra_seats: 0, invite_expires_at: null, revoked_at: null },
    ],
    consents: [],
    events: [{ event: "subscribed", user_id: "u1", created_at: ago(12) }, { event: "subscribed", user_id: "u2", created_at: ago(60) }, { event: "subscribed", user_id: "t1", created_at: ago(2) }, { event: "subscribed", user_id: "u9", created_at: ago(50) }],
    leads: [
      { user_id: "u1", source: "google", utm_source: "google", utm_medium: "cpc", utm_campaign: "roofers-tx", landing_path: "/bids/roofing", first_touch_at: ago(20), first_campaign_id: null, first_campaign_name: null, referrer_host: "google.com", click_id_type: "gclid", device_type: "mobile", stage: "paid", created_at: ago(20) },
      { user_id: "u2", source: "google.com", utm_source: null, utm_medium: null, utm_campaign: null, landing_path: "/", first_touch_at: ago(10), first_campaign_id: null, first_campaign_name: null, referrer_host: "google.com", click_id_type: null, device_type: "desktop", stage: "paid", created_at: ago(10) },
      { user_id: "u3", source: "direct", utm_source: null, utm_medium: null, utm_campaign: null, landing_path: null, first_touch_at: ago(5), first_campaign_id: null, first_campaign_name: null, referrer_host: null, click_id_type: null, stage: "signed_up", created_at: ago(5) },
    ],
    leadsInstalled: true, attributionV2: true,
    costs: [{ id: 1, period_start: "2026-11-01", channel: "google_ads", campaign_id: "roofers-tx", amount_usd: "150.00", note: null, created_at: ago(1) }],
    outbox: [], stripeEvents: [], pdfErrors7d: 0, importFailures7d: 0, loadedAt: NOW.toISOString(),
  };
}

describe("account classification", () => {
  it("uses owner labels, admin roles and reserved test domains, never names", () => {
    expect(classifyAccount("x@gmail.com", { label: "test" })).toMatchObject({ cls: "test", manual: true });
    expect(classifyAccount("owner@built2bid.org", { isAdmin: true }).cls).toBe("internal");
    expect(isReservedTestEmail("stripe-test-2@built2bid.test")).toBe(true);
    expect(isReservedTestEmail("a@example.com")).toBe(true);
    expect(isReservedTestEmail("demo@demo-roofing.com")).toBe(false);
    expect(classifyAccount("demo.roofing@gmail.com", {}).cls).toBe("genuine");
  });
  it("excludes internal, test and demo accounts from business metrics by default", () => {
    const s = scope(snap(), false);
    expect(s.excluded).toMatchObject({ internal: 1, test: 1, demo: 1 });
    expect(s.d.users.map((u) => u.id).sort()).toEqual(["u1", "u2", "u3", "u4"]);
    expect(s.d.estimates.some((e) => e.user_id === "t1" || e.user_id === "owner")).toBe(false);
    expect(scope(snap(), true).d.users).toHaveLength(7);
  });
});

describe("revenue rules", () => {
  const facts = accountFacts(scope(snap(), false), NOW);
  it("normalizes annual and enterprise MRR and excludes complimentary access", () => {
    expect(monthlyCents({ plan: "annual", seat_quantity: null })).toBe(1242);
    // seat_quantity is the TOTAL licensed users: 5 users = base + 2 extra seats, not 3 + 5.
    expect(monthlyCents({ plan: "enterprise", seat_quantity: 5 })).toBe(4999 + 2 * 1999);
    const rev = revenueModel(facts, R30, NOW);
    expect(rev.paying).toBe(3); // u1, u2, u4 (past due still paying); comp u3 and test t1 excluded
    expect(rev.mrrCents).toBe(1999 + 1242 + 4999 + 2 * 1999);
    expect(rev.comp.active).toBe(1);
    expect(rev.pastDue).toBe(1);
  });
  it("keeps scheduled cancellations separate from ended subscriptions", () => {
    const rev = revenueModel(facts, R30, NOW);
    expect(rev.scheduledCancel).toBe(1);
    expect(rev.ended.current).toBe(0); // u9 has no auth row → not in facts
    const withEnded = accountFacts(scope({ ...snap(), users: [...snap().users, { id: "u9", email: "gone@gmail.com", created_at: ago(70), email_confirmed_at: ago(70), last_sign_in_at: null }] }, false), NOW);
    const rev2 = revenueModel(withEnded, R30, NOW);
    expect(rev2.ended.current).toBe(1);
    expect(rev2.lostMrrCents).toBe(1999);
    expect(rev2.newMrrCents).toBe(1999); // u1 started 12 days ago
    expect(rev2.netMrrCents).toBe(0);
  });
  it("never treats a signed proposal as a payment", () => {
    const s = snap();
    s.subscriptions = [];
    const f = accountFacts(scope(s, false), NOW);
    expect(f.find((x) => x.id === "u1")!.signed).toBe(1);
    expect(revenueModel(f, R30, NOW).mrrCents).toBe(0);
    expect(kpis(f, R30, NOW).paying.now).toBe(0);
  });
});

describe("funnel, KPIs and honesty helpers", () => {
  const facts = accountFacts(scope(snap(), false), NOW);
  it("builds an account-based cohort funnel", () => {
    const start = NOW.getTime() - 30 * 86_400_000;
    const f = cohortFunnel(facts, start, NOW.getTime());
    expect([f.cohort, f.firstBid, f.finalized, f.paid]).toEqual([3, 2, 1, 2]); // u1,u2,u3 joined in 30d
    expect(f.steps[1].ofPrev).toMatchObject({ n: 2, d: 3, pct: 67, small: true });
  });
  it("does not show percentage changes from tiny baselines", () => {
    expect(compare(3, 0).pctChange).toBeNull();
    expect(compare(3, 2).pctChange).toBeNull();
    expect(compare(12, 10).pctChange).toBe(20);
    expect(ratio(0, 0).pct).toBeNull();
  });
  it("free-to-paid ignores complimentary access", () => {
    const k = kpis(facts, R30, NOW);
    expect(k.freeToPaid).toMatchObject({ n: 3, d: 4 }); // u1,u2,u4 ever paid; u3 is comp only
  });
  it("assigns segments without calling inactivity churn", () => {
    const seg = Object.fromEntries(facts.map((f) => [f.id, f.segment]));
    expect(seg).toMatchObject({ u1: "paying_active", u3: "complimentary", u4: "paying_quiet" });
  });
});

describe("needs attention", () => {
  it("flags only real exceptions", () => {
    const sc = scope(snap(), false);
    const issues = needsAttention(sc, accountFacts(sc, NOW), NOW);
    expect(issues.map((i) => [i.severity, i.title])).toEqual([["red", "1 failed subscription payment"], ["amber", "1 complimentary grant expiring within 7 days"]]);
    const quiet = snap(); quiet.subscriptions = []; quiet.grants = [];
    const qsc = scope(quiet, false);
    expect(needsAttention(qsc, accountFacts(qsc, NOW), NOW)).toEqual([]);
  });
});

describe("marketing attribution", () => {
  it("classifies channels from recorded data only", () => {
    expect(classifyChannel({ click_id_type: "gclid" })).toBe("google_ads");
    expect(classifyChannel({ utm_source: "facebook", utm_medium: "paid_social" })).toBe("meta_ads");
    expect(classifyChannel({ utm_source: "facebook" })).toBe("social");
    expect(classifyChannel({ referrer_host: "google.com" })).toBe("organic_search");
    expect(classifyChannel({ referrer_host: "youtube.com" })).toBe("youtube");
    expect(classifyChannel({ utm_source: "instantly", utm_medium: "email" })).toBe("email_outreach");
    expect(classifyChannel({ referrer_host: "contractortalk.com" })).toBe("referral");
    expect(classifyChannel({ source: "direct", referrer_host: "(none)" })).toBe("direct");
    expect(classifyChannel({ source: "direct", referrer_host: null })).toBe("unknown");
    expect(classifyChannel(null)).toBe("unknown");
  });
  it("computes CAC only from entered spend", () => {
    const facts = accountFacts(scope(snap(), false), NOW);
    const rows = channelReport(facts, snap().costs, NOW.getTime() - 30 * 86_400_000, NOW.getTime());
    const g = rows.find((r) => r.key === "google_ads")!;
    expect(g).toMatchObject({ signups: 1, activated: 1, paid: 1, spendUsd: 150, cacUsd: 150 });
    expect(rows.find((r) => r.key === "organic_search")).toMatchObject({ signups: 1, spendUsd: null, cacUsd: null });
  });
  it("captures referrer host, click id type and device, never full URLs or values", () => {
    const a = captureAttribution(new URL("https://built2bid.org/bids/roofing?gclid=abc123"), "https://www.google.com/search?q=roofing+estimate", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile", NOW)!;
    expect(a).toMatchObject({ referrer: "google.com", clickId: "gclid", device: "mobile", path: "/bids/roofing" });
    expect(JSON.stringify(a)).not.toContain("abc123");
    expect(JSON.stringify(a)).not.toContain("q=roofing");
    expect(captureAttribution(new URL("https://built2bid.org/pricing"), "https://built2bid.org/", null, NOW)).toBeNull();
    expect(captureAttribution(new URL("https://built2bid.org/auth/callback?code=x"), "https://mail.google.com/", null, NOW)).toBeNull();
    expect(captureAttribution(new URL("https://built2bid.org/"), null, null, NOW)).toBeNull();
    expect(decodeAttribution(encodeAttribution(a))).toMatchObject({ referrer: "google.com", clickId: "gclid", device: "mobile" });
  });
});

describe("usage, customers and exports", () => {
  it("measures acceptance on resolved signing requests only", () => {
    const sc = scope(snap(), false);
    const u = usageModel(sc, accountFacts(sc, NOW), R30, NOW);
    expect(u.acceptance).toMatchObject({ n: 1, d: 1 });
    expect(u.pendingRequests).toBe(1);
    expect(u.repeatBusinesses).toBe(1);
  });
  it("filters and searches customers", () => {
    const facts = accountFacts(scope(snap(), false), NOW);
    expect(filterCustomers(facts, parseCustomerFilters({ q: "lone star" })).map((f) => f.id)).toEqual(["u1"]);
    expect(filterCustomers(facts, parseCustomerFilters({ plan: "complimentary" })).map((f) => f.id)).toEqual(["u3"]);
    expect(parseCustomerFilters({ sort: "drop table", page: "-4", segment: "nope" })).toMatchObject({ sort: "signup", page: 1, segment: "" });
  });
  it("neutralizes spreadsheet formulas in CSV", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('a "b"')).toBe(`"a ""b"""`);
  });
  it("keeps report controls in links", () => {
    const v = parseView({ range: "90d", data: "all", channel: "google_ads" });
    expect(href("/admin/marketing", v, { channel: undefined })).toBe("/admin/marketing?range=90d&data=all");
    expect(href("/admin", parseView({}), { range: "30d" })).toBe("/admin");
  });
});

describe("clickable KPI drilldowns", () => {
  const sc = scope(snap(), false);
  const facts = accountFacts(sc, NOW);
  const w = { start: NOW.getTime() - 30 * 86_400_000, end: NOW.getTime() };
  const ids = (sp: Record<string, string>) => filterCustomers(facts, parseCustomerFilters(sp), w).map((f) => f.id).sort();

  it("each cohort lists exactly the accounts its card counts", () => {
    const rev = revenueModel(facts, R30, NOW);
    const k = kpis(facts, R30, NOW);
    expect(ids({ cohort: "new_paid" })).toHaveLength(rev.newPaid.current);
    expect(ids({ cohort: "ended" })).toHaveLength(rev.ended.current);
    expect(ids({ cohort: "past_due" })).toHaveLength(rev.pastDue);
    expect(ids({ cohort: "canceling" })).toHaveLength(rev.scheduledCancel);
    expect(ids({ cohort: "activated" })).toHaveLength(k.activated.current);
    expect(ids({ plan: "paying" })).toHaveLength(rev.paying);
    expect(ids({ cohort: "past_due" })).toEqual(["u4"]);
  });
  it("marketing funnel cards match the signup cohort and its steps", () => {
    const fun = cohortFunnel(facts, w.start, w.end);
    expect(ids({ cohort: "signups" })).toHaveLength(fun.cohort);
    expect(ids({ cohort: "signups", step: "first_bid" })).toHaveLength(fun.firstBid);
    expect(ids({ cohort: "signups", step: "finalized" })).toHaveLength(fun.finalized);
    expect(ids({ cohort: "signups", step: "paid" })).toHaveLength(fun.paid);
  });
  it("zero-count cohorts return an empty list, not everything", () => {
    const quiet = { start: 0, end: 1 };
    expect(filterCustomers(facts, parseCustomerFilters({ cohort: "new_paid" }), quiet)).toEqual([]);
  });
  it("ignores unknown drilldown values (no filter bypass, no crash)", () => {
    expect(parseCustomerFilters({ cohort: "everyone'; drop table", step: "__proto__", sub: "free-for-all" })).toMatchObject({ cohort: "", step: "", sub: "" });
    expect(parseCustomerFilters({ cohort: "constructor" }).cohort).toBe("");
  });
  it("drilldowns never surface test or internal accounts the report excluded", () => {
    expect(ids({ cohort: "signups" })).not.toContain("t1");
    expect(ids({ cohort: "signups" })).not.toContain("owner");
  });
});
