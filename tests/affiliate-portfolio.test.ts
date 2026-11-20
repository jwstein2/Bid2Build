import { describe, expect, it } from "vitest";
import { addYears, byYear, entries, monthGrid, summarize, toCsv, type Dashboard } from "@/lib/affiliates/portfolio";
import { affiliateLandingPath, affiliateLink, attributionOrder, decodeAffiliateCookie, encodeAffiliateCookie, safeLandingPath } from "@/lib/affiliates/link";
import { invoiceFacts, pretaxPaid, servicePeriod } from "@/lib/affiliates/billing";
import { parseChannelInput, mapChannel } from "@/lib/affiliates/youtube";
import { LESSONS } from "@/lib/affiliates/content";

const line = (year_no: number, date: string, amount_cents: number, status: string) => ({ id: `l${year_no}`, year_no, date, amount_cents, status, reason: null, hold_until: null, paid_at: null, payable_at: null }) as never;
const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  affiliate: { id: "a", code: "ABCDEFGH", status: "active", name: "A", email: "a@x.com" }, today: "2027-03-10",
  clicks: { total: 40, last_30: 5, by_campaign: {} }, payouts: [],
  referrals: [{
    key: "k1", label: "Customer 1A2B3C", business_initial: "R", referred_at: "2026-01-01", campaign: "roofing", status: "active", plan: "Monthly",
    first_paid_on: "2026-01-15", anniversary_date: "2026-01-15", term_years: 10, eligibility_end_date: "2035-01-15", cancel_requested: false, expected_cents: 2999,
    lines: [line(1, "2026-01-15", 1999, "paid"), line(2, "2027-01-15", 2999, "pending")],
  }],
  ...over,
});

describe("affiliate portfolio", () => {
  it("adds years safely around leap days", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2026-01-15", 9)).toBe("2035-01-15");
  });

  it("confirmed lines + forecast for the rest of the 10-year term, never more than 10", () => {
    const e = entries(dash());
    expect(e.length).toBe(10);
    expect(e.filter((x) => x.confirmed).map((x) => x.kind)).toEqual(["paid", "pending"]);
    expect(e.filter((x) => !x.confirmed).every((x) => x.cents === 2999 && x.kind === "forecast")).toBe(true);
    expect(e.at(-1)!.date).toBe("2035-01-15");
  });

  it("no forecast for a customer who canceled", () => {
    const d = dash();
    d.referrals[0].cancel_requested = true;
    expect(entries(d).filter((x) => x.kind === "forecast")).toEqual([]);
    expect(summarize(d).canceled).toBe(1);
  });

  it("annual chart separates paid, pending and projected", () => {
    const y = byYear(entries(dash()));
    expect(y[0]).toEqual({ year: 2026, paid: 1999, pending: 0, projected: 0 });
    expect(y[1]).toEqual({ year: 2027, paid: 0, pending: 2999, projected: 0 });
    expect(y[2].projected).toBe(2999);
  });

  it("summary and calendar month", () => {
    const s = summarize(dash());
    expect(s).toMatchObject({ referred: 1, paying: 1, active: 1, paidCents: 1999, pendingCents: 2999, nextTwelveCents: 2999 });
    const g = monthGrid(entries(dash()), "2027-01");
    expect(g.total).toEqual({ confirmed: 2999, forecast: 0 });
    expect(g.weeks.flat().filter(Boolean).length).toBe(31);
  });

  it("CSV quotes cells and neutralizes formulas", () => {
    const csv = toCsv(entries(dash()));
    expect(csv.split("\r\n")[0]).toBe('"date","customer","year","status","amount_usd","confirmed","campaign","note"');
    const d = dash(); d.referrals[0].campaign = "=HYPERLINK(1)";
    expect(toCsv(entries(d))).toContain(`"'=HYPERLINK(1)"`);
  });
});

describe("affiliate links", () => {
  it("cookie round trip and campaign links", () => {
    const at = new Date("2026-11-20T12:00:00Z");
    const c = encodeAffiliateCookie("ABCDEFGH", "0b9b3c1e-1111-4222-8333-444455556666", at);
    expect(decodeAffiliateCookie(c)).toEqual({ code: "ABCDEFGH", visitAt: at, clickId: "0b9b3c1e-1111-4222-8333-444455556666" });
    expect(decodeAffiliateCookie("ABCDEFGH.1764000000.notauuid")?.clickId).toBeNull();
    expect(decodeAffiliateCookie("bad!")).toBeNull();
    expect(affiliateLink("ABCDEFGH", { campaign: "Roof Video #1", source: "YouTube" }, "https://built2bid.org")).toBe("https://built2bid.org/a/ABCDEFGH?c=roof-video-1&s=youtube");
    expect(affiliateLandingPath("ABCDEFGH", "/pricing", "x")).toBe("/pricing?utm_source=affiliate&utm_medium=referral&utm_campaign=x&utm_content=ABCDEFGH");
    expect(safeLandingPath("//evil.com")).toBe("/");
    expect(safeLandingPath("/sales/admin")).toBe("/");
  });

  it("earliest visit records first when both a rep and an affiliate cookie exist", () => {
    const early = { visitAt: new Date("2026-01-01") }, late = { visitAt: new Date("2026-02-01") };
    expect(attributionOrder(early, late)).toEqual(["sales", "affiliate"]);
    expect(attributionOrder(late, early)).toEqual(["affiliate", "sales"]);
    expect(attributionOrder(null, early)).toEqual(["affiliate"]);
    expect(attributionOrder(null, null)).toEqual([]);
  });
});

describe("affiliate invoice facts", () => {
  const monthly = [{ quantity: 1, price: { id: "price_m", unit_amount: 1999, recurring: { interval: "month", interval_count: 1 } } }];
  const annual = [{ quantity: 1, price: { id: "price_y", unit_amount: 19900, recurring: { interval: "year", interval_count: 1 } } }];
  const prices = { monthly: "price_m", annual: "price_y", monthlyListCents: 1999 };
  const t = 1_790_000_000;

  it("pre-tax share and service period from the subscription line", () => {
    expect(pretaxPaid({ amount_paid: 2149, total: 2149, total_excluding_tax: 1999 })).toBe(1999);
    expect(servicePeriod({ lines: { data: [{ amount: -500, period: { start: t, end: t + 100 } }, { amount: 1999, period: { start: t, end: t + 2_629_800 } }] } }, 1)).toEqual({ start: t, end: t + 2_629_800 });
  });

  it("monthly and annual invoices", () => {
    const m = invoiceFacts({ id: "in_1", amount_paid: 1999, status: "paid", created: t, lines: { data: [{ amount: 1999, period: { start: t, end: t + 2_629_800 } }] } }, monthly, prices)!;
    expect(m).toMatchObject({ periodMonths: 1, grossCents: 1999, pretaxCents: 1999, listDivideCents: 1999, listMonthlyCents: 1999 });
    const y = invoiceFacts({ id: "in_2", amount_paid: 19900, status: "paid", created: t, lines: { data: [{ amount: 19900, period: { start: t, end: t + 31_557_600 } }] } }, annual, prices)!;
    expect(y).toMatchObject({ periodMonths: 12, listDivideCents: 1658, listMonthlyCents: 1999 });
    expect(invoiceFacts({ id: "in_3", amount_paid: 0, status: "paid" }, monthly, prices)).toBeNull();
    expect(invoiceFacts({ id: "in_4", amount_paid: 100, status: "open" }, monthly, prices)).toBeNull();
  });
});

describe("youtube + content", () => {
  it("parses channel input", () => {
    expect(parseChannelInput("https://www.youtube.com/@RoofTalk")).toEqual({ handle: "RoofTalk" });
    expect(parseChannelInput("https://youtube.com/channel/UC" + "a".repeat(22))).toEqual({ id: "UC" + "a".repeat(22) });
    expect(parseChannelInput("@roof.talk")).toEqual({ handle: "roof.talk" });
    expect(parseChannelInput("https://evil.com/x y")).toBeNull();
    expect(mapChannel({ id: "UCx", statistics: { hiddenSubscriberCount: true, subscriberCount: "5" } }).subscriber_count).toBeNull();
  });

  it("10 lessons with unique keys (the database requires 10)", () => {
    expect(LESSONS.length).toBe(10);
    expect(new Set(LESSONS.map((l) => l.key)).size).toBe(10);
    expect(LESSONS.every((l) => /^[a-z0-9_]{2,40}$/.test(l.key))).toBe(true);
  });
});

import { annualSurvival, projectExposure, unitEconomics } from "@/lib/affiliates/analytics";
describe("affiliate owner analytics", () => {
  it("exposure: worst case vs expected with churn and upgrades", () => {
    const rows = [{ value: 2000, years_left: 3, anniversary_date: "2026-06-01", affiliate_id: "a" }, { value: 1000, years_left: 1, anniversary_date: "2026-02-01", affiliate_id: "b" }];
    const none = projectExposure(rows, { monthlyChurnBps: 0, annualUpgradeBps: 0, today: "2027-01-01" });
    expect(none.maxCents).toBe(7000);
    expect(none.expectedCents).toBe(7000);
    const churn = projectExposure(rows, { monthlyChurnBps: 300, annualUpgradeBps: 0, today: "2027-01-01" });
    expect(churn.expectedCents).toBeLessThan(7000);
    expect(churn.byYear[0]).toEqual({ year: 2027, maxCents: 3000, expectedCents: 3000 });
    expect(annualSurvival(300)).toBeCloseTo(0.694, 2);
  });
  it("unit economics", () => {
    expect(unitEconomics({ revenueYearCents: 100000, paidYearCents: 8000, payoutFeesCents: 500 })).toEqual({ commissionToRevenueBps: 800, contributionCents: 91500, contributionMarginBps: 9150 });
    expect(unitEconomics({ revenueYearCents: 0, paidYearCents: 0, payoutFeesCents: 0 }).commissionToRevenueBps).toBe(0);
  });
});
