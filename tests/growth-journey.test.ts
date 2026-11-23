import { describe, expect, it } from "vitest";
import { classifyChannel } from "@/lib/admin/channels";
import { UTM_PRESETS } from "@/lib/growth/utm-links";
import { appendTouch, decodeTouches, encodeTouches, firstLast, MAX_TOUCHES, touchFromAttribution, attributionFromTouch, trackingPermitted, touchesEnabled, validVisitorId, type Touch } from "@/lib/growth/touches";
import { utmIssues, conventionUrl } from "@/lib/growth/utm-convention";
import { breakdown, buildJourneys, cohortRetention, contribution, dataQuality, revenueByOwner, unitEconomics, type JourneyInput } from "@/lib/growth/journey";
import { syntheticJourneyInput } from "@/lib/growth/journey-synthetic";

const NOW = new Date("2027-03-01T12:00:00Z");
const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("touch cookie", () => {
  const t = (at: string, s = "google", m = "cpc"): Touch => ({ at, s, m, c: "b2b-google-signup-202702" });

  it("is off unless MARKETING_TOUCHES=on, and never with GPC or the analytics opt-out", () => {
    expect(touchesEnabled({})).toBe(false);
    expect(touchesEnabled({ MARKETING_TOUCHES: "on" })).toBe(true);
    expect(trackingPermitted(hdr({}), () => undefined)).toBe(true);
    expect(trackingPermitted(hdr({ "sec-gpc": "1" }), () => undefined)).toBe(false);
    expect(trackingPermitted(hdr({}), (n) => (n === "b2b_ga_optout" ? "1" : undefined))).toBe(false);
  });

  it("collapses the same tags within 30 minutes and keeps first + latest when full", () => {
    let l: Touch[] = [];
    l = appendTouch(l, t("2027-02-01T10:00:00Z"));
    l = appendTouch(l, t("2027-02-01T10:10:00Z"));
    expect(l).toHaveLength(1);
    l = appendTouch(l, t("2027-02-01T11:00:00Z"));
    expect(l).toHaveLength(2);
    for (let i = 0; i < 10; i++) l = appendTouch(l, t(`2027-02-0${2 + (i % 7)}T1${i % 10}:00:00Z`, `src${i}`));
    expect(l).toHaveLength(MAX_TOUCHES);
    expect(l[0].at).toBe("2027-02-01T10:00:00Z");
    expect(l[l.length - 1].s).toBe("src9");
  });

  it("round-trips, drops junk, sorts by time and never carries personal data fields", () => {
    const enc = encodeTouches([t("2027-02-02T10:00:00Z"), { at: "2027-02-01T10:00:00Z", s: "x y", m: "<script>" } as Touch]);
    const dec = decodeTouches(enc);
    expect(dec.map((x) => x.at)).toEqual(["2027-02-01T10:00:00.000Z", "2027-02-02T10:00:00.000Z"]);
    expect(dec[0].m).toBeUndefined();
    expect(decodeTouches("not json")).toEqual([]);
    expect(decodeTouches(encodeURIComponent(JSON.stringify([{ at: "x" }, { email: "a@b.c", at: "2027-01-01T00:00:00Z" }])))).toEqual([{ at: "2027-01-01T00:00:00.000Z" }]);
  });

  it("maps to and from the attribution shape", () => {
    const a = { source: "google", medium: "cpc", campaign: "c", content: "k", path: "/bids/roofing", clickId: "gclid" as const, device: "mobile" as const, at: "2027-01-01T00:00:00.000Z" };
    expect(attributionFromTouch(touchFromAttribution(a))).toMatchObject(a);
  });

  it("first/last touch respects the conversion time", () => {
    const ts = [{ at: "2027-01-01T00:00:00Z", k: 1 }, { at: "2027-01-05T00:00:00Z", k: 2 }, { at: "2027-01-09T00:00:00Z", k: 3 }];
    expect(firstLast(ts, "2027-01-06T00:00:00Z")).toMatchObject({ first: { k: 1 }, last: { k: 2 } });
    expect(firstLast(ts).last?.k).toBe(3);
    expect(firstLast(ts, "2026-12-01T00:00:00Z")).toEqual({ first: null, last: null });
  });

  it("validates visitor ids", () => {
    expect(validVisitorId("8F14E45F-CEEA-467A-9575-0C5F0A3B2E10")).toBe("8f14e45f-ceea-467a-9575-0c5f0a3b2e10");
    expect(validVisitorId("abc")).toBeNull();
  });
});

describe("UTM convention", () => {
  it("accepts the existing presets, program links and paid names", () => {
    for (const p of Object.values(UTM_PRESETS)) expect(utmIssues({ source: p.source, medium: p.medium, campaign: p.campaign })).toEqual([]);
    expect(utmIssues({ source: "sales_rep", medium: "referral", campaign: "sales_team", content: "ABC123" })).toEqual([]);
    expect(utmIssues({ source: "facebook", medium: "paid_social", campaign: "b2b-meta-signup-202612", content: "b-h1-15s-916-v1" })).toEqual([]);
    expect(utmIssues({})).toEqual([]);
  });
  it("flags case, characters, unknown mediums, missing tags and bad paid names", () => {
    expect(utmIssues({ source: "Facebook", medium: "social", campaign: "x" })).toContain("not_lowercase");
    expect(utmIssues({ source: "fb", medium: "social", campaign: "my post" })).toContain("bad_characters");
    expect(utmIssues({ source: "fb", medium: "banner", campaign: "x" })).toContain("unknown_medium");
    expect(utmIssues({ source: "fb" })).toEqual(expect.arrayContaining(["missing_medium", "missing_campaign"]));
    expect(utmIssues({ source: "google", medium: "cpc", campaign: "roofing" })).toContain("paid_campaign_format");
    expect(conventionUrl("https://built2bid.org", "/bids/roofing", { source: "google", medium: "cpc", campaign: "b2b-google-signup-202701" })).toEqual({ url: "https://built2bid.org/bids/roofing?utm_source=google&utm_medium=cpc&utm_campaign=b2b-google-signup-202701" });
  });
});

describe("Android app referrers", () => {
  it("classifies the Google app as organic search and social apps as social; Gmail stays referral (GA4 rules)", () => {
    expect(classifyChannel({ referrer_host: "com.google.android.googlequicksearchbox" })).toBe("organic_search");
    expect(classifyChannel({ referrer_host: "com.facebook.katana" })).toBe("social");
    expect(classifyChannel({ referrer_host: "com.google.android.youtube" })).toBe("youtube");
    expect(classifyChannel({ referrer_host: "com.google.android.gm" })).toBe("referral");
  });
});

describe("journey report on synthetic data", () => {
  const input = syntheticJourneyInput(NOW);
  const js = buildJourneys(input, NOW);
  const j = (id: string) => js.find((x) => x.id === id)!;
  const all = [0, NOW.getTime()] as const;

  it("follows each account through the funnel", () => {
    const a = j("syn-a-google");
    expect([a.firstBidAt, a.proposalSentAt, a.activatedAt, a.paidAt].every(Boolean)).toBe(true);
    expect(a.renewals).toBe(2);
    expect(a.paying).toBe(true);
    expect(a.canceledAt).toBeNull();
    const b = j("syn-b-meta");
    expect(b.cancelScheduledAt).not.toBeNull();
    expect(b.canceledAt).not.toBeNull();
    expect(j("syn-f-direct").paidAt).toBeNull();
  });

  it("separates first touch, last touch and the commission owner", () => {
    const b = j("syn-b-meta");
    expect(b.firstTouch.channel).toBe("meta_ads");
    expect(b.lastTouchSignup.channel).toBe("organic_search");
    expect(b.owner).toMatchObject({ kind: "marketing", key: "organic_search" });
    const c = j("syn-c-rep");
    expect(c.firstTouch.channel).toBe("google_ads");
    expect(c.owner).toMatchObject({ kind: "sales_rep", partnerId: "syn-rep-1" });
    expect(j("syn-d-affiliate").owner.kind).toBe("affiliate");
    expect(j("syn-e-referral").referredBy).toBe("syn-a-google");
    expect(j("syn-f-direct").firstTouch).toMatchObject({ channel: "direct", from: "lead" });
  });

  it("counts revenue once: net of refunds and lost disputes, each invoice once, summed only by owner", () => {
    const doubled: JourneyInput = { ...input, revenue: [...input.revenue, ...input.revenue] };
    const r = revenueByOwner(doubled, buildJourneys(doubled, NOW), ...all);
    const expected = input.revenue.reduce((n, x) => n + x.net_cents, 0);
    expect(r.totalCents).toBe(expected);
    expect(r.rows.reduce((n, x) => n + x.netCents, 0)).toBe(expected);
    expect(r.invoiceIds).toBe(input.revenue.length);
    expect(r.rows.find((x) => x.key === "sales_rep")?.netCents).toBe(19188);
    expect(r.rows.find((x) => x.key === "unmatched")?.netCents).toBe(1999);
    expect(j("syn-b-meta").netCents).toBe(1999 + 999);
    expect(j("syn-h-dispute").netCents).toBe(0);
    // Owner breakdown partitions accounts: its revenue column adds up to the matched total.
    const owner = breakdown(js, "channel", "owner", ...all);
    expect(owner.reduce((n, x) => n + x.netCents, 0)).toBe(expected - 1999);
    expect(owner.reduce((n, x) => n + x.counts.signup, 0)).toBe(input.accounts.length);
  });

  it("breaks down by first and last touch, campaign, trade, landing page and creative", () => {
    const first = breakdown(js, "channel", "first", ...all);
    expect(first.find((x) => x.key === "google_ads")?.counts).toMatchObject({ signup: 2, paid: 2 });
    const last = breakdown(js, "channel", "last", ...all);
    expect(last.find((x) => x.key === "google_ads")?.counts.signup).toBe(1); // the rep-link account moved to its last touch
    expect(breakdown(js, "trade", "first", ...all).find((x) => x.key === "roofing")?.counts.paid).toBe(2);
    expect(breakdown(js, "landing", "first", ...all).find((x) => x.key === "/bids/decks")?.counts.signup).toBe(1);
    expect(breakdown(js, "creative", "first", ...all).find((x) => x.key === "b-h1-15s-916-v1")?.counts.canceled).toBe(1);
    expect(breakdown(js, "campaign", "first", ...all).find((x) => x.key === "b2b-google-signup-202611")?.counts.signup).toBe(2);
    expect(breakdown(js, "segment", "first", ...all).length).toBeGreaterThan(1);
  });

  it("builds cohort retention by first paid month", () => {
    const rows = cohortRetention(js, NOW, 3);
    expect(rows.reduce((n, r) => n + r.size, 0)).toBe(6);
    for (const r of rows) for (const v of r.retained) if (v != null) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("puts commissions and referral rewards into CAC, not revenue, and gates LTV", () => {
    const u = unitEconomics(js, input.costs, ...all);
    const rep = u.rows.find((r) => r.key === "sales_rep")!;
    expect(rep).toMatchObject({ newPaying: 1, spendCents: 0, year1CommissionCents: 1999, cacCents: 1999 });
    const google = u.rows.find((r) => r.key === "google_ads")!;
    expect(google).toMatchObject({ newPaying: 1, spendCents: 30000, cacCents: 30000 });
    expect(google.paybackMonths).toBeGreaterThan(0);
    const meta = u.rows.find((r) => r.key === "meta_ads")!;
    expect(meta).toMatchObject({ newPaying: 0, spendCents: 20000, cacCents: null });
    expect(u.blended.referralCents).toBe(1999);
    expect(u.contributionLtvCents).toBeNull();
    expect(u.ltvReason).toMatch(/Not enough/);
    expect(contribution(j("syn-a-google"))).toBe(3 * 1999 - 3 * (Math.round(1999 * 0.029) + 30));
  });

  it("data quality: clean except the planted unmatched invoice", () => {
    const q = dataQuality(input, js, NOW, { touchesOn: true, utmIssueCount: 0 });
    expect(q.filter((c) => c.severity !== "ok").map((c) => c.key)).toEqual(["unmatched_revenue"]);
    const broken = dataQuality({ ...input, owners: [...input.owners, { user_id: "syn-c-rep", program: "affiliate", partner_id: "x" }], revenue: [...input.revenue, input.revenue[0]] }, js, NOW);
    expect(broken.filter((c) => c.severity === "red").map((c) => c.key).sort()).toEqual(["duplicate_invoices", "owner_conflicts"]);
  });
});
