import { describe, expect, it } from "vitest";
import { classifyChannel, creativeOf, creatorOf } from "@/lib/admin/channels";
import { accountFacts, channelReport, creativeReport, creatorReport, paybackMonths, planOf, scope, tradeOfPath, tradeReport, type Snapshot, type SubscriptionRow } from "@/lib/admin/model";

const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sub = (user: string, o: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ stripe_subscription_id: `sub_${user}`, user_id: user, stripe_customer_id: `cus_${user}`, status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: ago(3), seat_quantity: null, current_period_end: ago(-27), company_id: null, ...o });
const lead = (user: string, o: Record<string, string | null>) => ({ user_id: user, source: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, landing_path: "/bids/decks", first_touch_at: ago(10), first_campaign_id: null, first_campaign_name: null, referrer_host: null, click_id_type: null, device_type: "mobile", stage: "signed_up", created_at: ago(10), ...o });
const user = (id: string, days: number) => ({ id, email: `${id}@contractor.dev`, created_at: ago(days), email_confirmed_at: ago(days), last_sign_in_at: ago(1) });
const est = (id: string, u: string, days: number) => ({ id, user_id: u, company_id: null, trades: ["decks"], template_trade: "decks", status: "draft", created_at: ago(days), location_state: null, location_zip: null, project_address: null });

function snap(): Snapshot {
  return {
    users: [user("a", 10), user("b", 10), user("c", 9), user("d", 8), user("e", 5)],
    usersSource: "auth", labels: [], labelsInstalled: true, adminIds: new Set(),
    estimates: [est("e1", "a", 10), est("e2", "b", 9), est("e3", "c", 9)],
    versions: [{ estimate_id: "e1", user_id: "a", created_at: ago(9), version_number: 1 }],
    signatures: [], signingRequests: [],
    subscriptions: [sub("a"), sub("c", { plan: "annual" })],
    businesses: [], companies: [], members: [],
    grants: [{ id: "g1", email: "d@contractor.dev", user_id: "d", status: "active", plan: "unlimited", starts_at: ago(8), expires_at: ago(-30), created_at: ago(8), company_id: null, granted_by: "owner", note: "creator gift", extra_seats: 0, invite_expires_at: null, revoked_at: null }],
    consents: [],
    events: [{ event: "subscribed", user_id: "a", created_at: ago(8) }, { event: "subscribed", user_id: "c", created_at: ago(7) }],
    leads: [
      lead("a", { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "meta-test-nov", utm_content: "A-Overtime-v1" }),
      lead("b", { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "meta-test-nov", utm_content: "b-homeowner-v1" }),
      lead("c", { utm_source: "youtube", utm_medium: "creator", utm_campaign: "DeckGuy" }),
      lead("d", { utm_source: "instagram", utm_medium: "creator", utm_campaign: "deckguy" }),
      lead("e", { utm_source: "creator", utm_medium: null, utm_campaign: null }),
    ],
    leadsInstalled: true, attributionV2: true,
    costs: [{ id: 1, period_start: "2026-11-01", channel: "meta_ads", campaign_id: "meta-test-nov", amount_usd: "100", note: null, created_at: ago(1) }],
    outbox: [], stripeEvents: [], pdfErrors7d: 0, importFailures7d: 0, loadedAt: NOW.toISOString(),
    meaningful: [{ estimate_id: "e2", user_id: "b", reached_at: ago(8), from_event: true }],
  };
}

describe("creator and creative attribution", () => {
  it("classifies creator links ahead of the platform they were posted on", () => {
    expect(classifyChannel({ utm_source: "youtube", utm_medium: "creator" })).toBe("creator");
    expect(classifyChannel({ utm_source: "creator" })).toBe("creator");
    expect(classifyChannel({ utm_source: "facebook", utm_medium: "paid_social" })).toBe("meta_ads");
    expect(classifyChannel({ utm_source: "youtube" })).toBe("youtube");
    expect(creatorOf({ utm_medium: "partner", utm_campaign: " DeckGuy " })).toBe("deckguy");
    expect(creatorOf({ utm_medium: "creator" })).toBe("(not named)");
    expect(creatorOf({ utm_source: "google", utm_medium: "cpc", utm_campaign: "x" })).toBeNull();
    expect(creativeOf({ utm_content: " A-Overtime-v1 " })).toBe("a-overtime-v1");
    expect(creativeOf({})).toBeNull();
  });
});

describe("docs/growth/ADS.md naming standard", () => {
  it("classifies the documented tags into the right channel, creative and creator", () => {
    const q = (u: string) => Object.fromEntries(new URL(u).searchParams);
    const meta = q("https://built2bid.org/bids/decks?utm_source=facebook&utm_medium=paid_social&utm_campaign=b2b-meta-signup-202612&utm_content=b-h1-15s-916-v1");
    expect(classifyChannel(meta)).toBe("meta_ads");
    expect(creativeOf(meta)).toBe("b-h1-15s-916-v1");
    expect(classifyChannel({ utm_source: "instagram", utm_medium: "paid_social" })).toBe("meta_ads");
    expect(classifyChannel({ utm_source: "youtube", utm_medium: "video", utm_campaign: "b2b-yt-signup-202612" })).toBe("youtube");
    const creator = q("https://built2bid.org/bids/decks?utm_source=youtube&utm_medium=creator&utm_campaign=deckguy");
    expect(classifyChannel(creator)).toBe("creator");
    expect(creatorOf(creator)).toBe("deckguy");
  });
});

describe("growth reports", () => {
  const facts = accountFacts(scope(snap(), false), NOW);
  const start = NOW.getTime() - 30 * 86_400_000, end = NOW.getTime();

  it("creator report never counts complimentary access as paid", () => {
    const rows = creatorReport(facts);
    const deck = rows.find((r) => r.creator === "deckguy")!;
    expect(deck).toMatchObject({ signups: 2, paid: 1, payingNow: 1, complimentary: 1 });
    expect(deck.mrrCents).toBe(Math.round(19900 / 12));
    expect(rows.find((r) => r.creator === "(not named)")).toMatchObject({ signups: 1, paid: 0, complimentary: 0 });
  });

  it("creative report groups by utm_content with 7-day activation and paid", () => {
    const rows = creativeReport(facts, start, end);
    expect(rows.map((r) => r.creative)).toEqual(["a-overtime-v1", "b-homeowner-v1"]);
    expect(rows[0]).toMatchObject({ channel: "meta_ads", campaign: "meta-test-nov", signups: 1, finalized: 1, paid: 1, activated7d: 1 });
    expect(rows[1]).toMatchObject({ signups: 1, activated7d: 1, paid: 0 });
  });

  it("channel report adds 7-day activation and CAC payback", () => {
    const meta = channelReport(facts, snap().costs, start, end).find((r) => r.key === "meta_ads")!;
    expect(meta).toMatchObject({ signups: 2, activated7d: 2, paid: 1, spendUsd: 100, cacUsd: 100 });
    expect(meta.paybackMonths).toBeCloseTo(100 / 19.99, 5);
    const creator = channelReport(facts, snap().costs, start, end).find((r) => r.key === "creator")!;
    expect(creator.paybackMonths).toBeNull(); // no spend entered
  });

  it("payback needs spend, a paying account and MRR", () => {
    expect(paybackMonths(null, 1, 1999, 1)).toBeNull();
    expect(paybackMonths(100, 0, 0, 0)).toBeNull();
    expect(paybackMonths(100, 2, 0, 0)).toBeNull();
    expect(paybackMonths(200, 2, 3998, 2)).toBeCloseTo(100 / 19.99, 5);
  });

  it("trade report and plan buckets", () => {
    expect(tradeOfPath("/bids/painting?utm_source=x")).toBe("painting");
    expect(tradeOfPath("/start/decks")).toBe("decks");
    expect(tradeOfPath("/pricing")).toBeNull();
    expect(tradeReport(facts, start, end)).toEqual([expect.objectContaining({ trade: "decks", signups: 5, firstBid: 3, paid: 2 })]);
    const plan = Object.fromEntries(facts.map((f) => [f.id, planOf(f)]));
    expect(plan).toMatchObject({ a: "paid", c: "paid", d: "complimentary", b: "free", e: "free" });
  });
});
