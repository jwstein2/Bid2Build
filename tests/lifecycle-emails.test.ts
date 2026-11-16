import { describe, expect, it } from "vitest";
import { LIFECYCLE_STEPS, planLifecycle, renderLifecycle, stepOfKind, tradeFromPath, type LifecycleFacts } from "@/lib/email/lifecycle";
import { lifecycleConfig } from "@/lib/email/lifecycle-run";
import { checkLifecycleUnsubSig, lifecycleUnsubSig, lifecycleUnsubUrls } from "@/lib/email/unsubscribe";

const H = 3_600_000, D = 24 * H;
const NOW = Date.parse("2026-11-20T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base = (o: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  userId: "u1", email: "pro@contractor.dev", createdAt: ago(2 * D), cls: "genuine", unsubscribed: false, suppressed: false,
  marketingOptIn: false, payingSince: null, complimentary: false, estimates: [], firstDeliveredAt: null, landingTrade: null,
  done: [], lastSentAt: null, ...o,
});
const est = (o: { updated: number; meaningful?: number; id?: string; trade?: string }) => ({ id: o.id ?? "e1", trade: o.trade ?? "roofing", updatedAt: ago(o.updated), meaningfulAt: o.meaningful === undefined ? null : ago(o.meaningful) });
const plan = (o: Partial<LifecycleFacts>) => planLifecycle(base(o), NOW)?.step ?? null;

describe("lifecycle planner", () => {
  it("A: no bid, between 24h and 7 days after signup", () => {
    expect(plan({ createdAt: ago(12 * H) })).toBeNull();
    expect(plan({ createdAt: ago(2 * D), landingTrade: "painting" })).toBe("a");
    expect(planLifecycle(base({ landingTrade: "painting" }), NOW)?.trade).toBe("painting");
    expect(plan({ createdAt: ago(8 * D) })).toBeNull();
  });
  it("B: unfinished draft idle 48h+, within 14 days", () => {
    expect(plan({ estimates: [est({ updated: 24 * H })] })).toBeNull();
    expect(plan({ createdAt: ago(5 * D), estimates: [est({ updated: 3 * D })] })).toBe("b");
    expect(plan({ createdAt: ago(15 * D), estimates: [est({ updated: 3 * D })] })).toBeNull();
  });
  it("C: priced but never delivered, 24h after reaching 3 items", () => {
    expect(plan({ createdAt: ago(5 * D), estimates: [est({ updated: 2 * D, meaningful: 2 * D })] })).toBe("c");
    expect(plan({ createdAt: ago(5 * D), estimates: [est({ updated: 2 * H, meaningful: 2 * D })] })).toBeNull(); // still working on it
    expect(plan({ createdAt: ago(5 * D), estimates: [est({ updated: 2 * D, meaningful: 2 * D })], firstDeliveredAt: ago(D) })).toBeNull();
  });
  it("D: upgrade email needs marketing opt-in and never goes to complimentary accounts", () => {
    const delivered = { createdAt: ago(10 * D), estimates: [est({ updated: 5 * D, meaningful: 6 * D })], firstDeliveredAt: ago(4 * D) };
    expect(plan(delivered)).toBeNull();
    expect(plan({ ...delivered, marketingOptIn: true })).toBe("d");
    expect(plan({ ...delivered, marketingOptIn: true, complimentary: true })).toBeNull();
    expect(plan({ ...delivered, marketingOptIn: true, firstDeliveredAt: ago(2 * D) })).toBeNull();
  });
  it("E: paying 7-30 days; paying accounts never get A-D", () => {
    expect(plan({ payingSince: ago(3 * D) })).toBeNull();
    expect(plan({ payingSince: ago(8 * D) })).toBe("e");
    expect(plan({ payingSince: ago(40 * D) })).toBeNull();
    expect(plan({ payingSince: ago(3 * D), estimates: [est({ updated: 3 * D })] })).toBeNull();
  });
  it("suppression: unsubscribed, suppressed, no email, non-genuine, already sent, 48h gap", () => {
    for (const o of [{ unsubscribed: true }, { suppressed: true }, { email: null }, { cls: "test" as const }, { cls: "internal" as const }, { done: ["a" as const] }, { lastSentAt: ago(20 * H) }]) {
      expect(plan(o)).toBeNull();
    }
    expect(planLifecycle(base({ cls: "internal" }), NOW, { allowNonGenuine: true })?.step).toBe("a");
    expect(plan({ lastSentAt: ago(49 * H) })).toBe("a");
  });
  it("maps kinds and landing paths", () => {
    expect(stepOfKind("lifecycle_c")).toBe("c");
    expect(stepOfKind("founder_welcome")).toBeNull();
    expect(tradeFromPath("/bids/decks?utm_source=fb")).toBe("decks");
    expect(tradeFromPath("/start/painting")).toBe("painting");
    expect(tradeFromPath("/bids/not-a-trade")).toBeNull();
    expect(tradeFromPath(null)).toBeNull();
  });
});

describe("lifecycle copy", () => {
  const ctx = { appUrl: "https://built2bid.org/", trade: "decks", estimateId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: "https://built2bid.org/email/unsubscribe?u=x&s=y", postalAddress: "PO Box 1, Minneapolis, MN 55401" };
  it("every email has an unsubscribe link, the postal address and no price or speed claims", () => {
    for (const step of LIFECYCLE_STEPS) {
      const r = renderLifecycle({ ...ctx, step });
      expect(r.text).toContain(ctx.unsubscribeUrl);
      expect(r.html).toContain("Unsubscribe from these emails");
      expect(r.text).toContain(ctx.postalAddress);
      expect(r.text + r.subject).not.toMatch(/\$\s?\d|\d+\s?%|minutes?|guarantee|win more|testimonial/i);
      expect(r.html).not.toMatch(/<script/i);
    }
  });
  it("links into the app, not to customer data", () => {
    expect(renderLifecycle({ ...ctx, step: "a" }).text).toContain("https://built2bid.org/start/decks");
    expect(renderLifecycle({ ...ctx, step: "b" }).text).toContain(`https://built2bid.org/estimates/${ctx.estimateId}`);
    expect(renderLifecycle({ ...ctx, step: "c" }).text).toContain(`/estimates/${ctx.estimateId}?step=proposal`);
    expect(renderLifecycle({ ...ctx, step: "d" }).text).toContain("https://built2bid.org/pricing");
    expect(renderLifecycle({ ...ctx, step: "d" }).text).toContain("opted in");
    expect(renderLifecycle({ ...ctx, step: "a", trade: null }).text).toContain("https://built2bid.org/bids");
  });
  it("escapes HTML", () => {
    const r = renderLifecycle({ ...ctx, step: "a", unsubscribeUrl: "https://x/?a=1&b=<2>" });
    expect(r.html).toContain("a=1&amp;b=&lt;2&gt;");
  });
});

describe("lifecycle config", () => {
  const ok = { RESEND_API_KEY: "re_x", LIFECYCLE_POSTAL_ADDRESS: "PO Box 1", SUPABASE_SERVICE_ROLE_KEY: "k" };
  it("is off by default and explains why", () => {
    expect(lifecycleConfig({ ...ok }).enabled).toBe(false);
    expect(lifecycleConfig({ ...ok }).reason).toMatch(/MODE is off/);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "live", LIFECYCLE_POSTAL_ADDRESS: "" }).reason).toMatch(/POSTAL/);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "test" }).reason).toMatch(/TEST_RECIPIENTS/);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "live", SUPABASE_SERVICE_ROLE_KEY: "" }).reason).toMatch(/secret/);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "nonsense" }).mode).toBe("off");
  });
  it("enables test and live modes and reads the cap", () => {
    const t = lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "test", LIFECYCLE_TEST_RECIPIENTS: " Me@Built2Bid.org , bad" });
    expect(t.enabled).toBe(true);
    expect(t.testRecipients).toEqual(["me@built2bid.org"]);
    expect(t.dailyCap).toBe(40);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "live", LIFECYCLE_DAILY_CAP: "5" }).dailyCap).toBe(5);
    expect(lifecycleConfig({ ...ok, LIFECYCLE_EMAIL_MODE: "live", LIFECYCLE_DAILY_CAP: "-1" }).dailyCap).toBe(40);
  });
});

describe("unsubscribe links", () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: "service" };
  const id = "22222222-2222-4222-8222-222222222222";
  it("verifies only the matching account", () => {
    const s = lifecycleUnsubSig(id, env);
    expect(checkLifecycleUnsubSig(id, s, env)).toBe(true);
    expect(checkLifecycleUnsubSig("33333333-3333-4333-8333-333333333333", s, env)).toBe(false);
    expect(checkLifecycleUnsubSig(id, s.slice(0, -1) + (s.endsWith("A") ? "B" : "A"), env)).toBe(false);
    expect(checkLifecycleUnsubSig("not-a-uuid", s, env)).toBe(false);
    expect(checkLifecycleUnsubSig(id, s, { SUPABASE_SERVICE_ROLE_KEY: "other" })).toBe(false);
  });
  it("builds page and one-click URLs", () => {
    const u = lifecycleUnsubUrls("https://built2bid.org/", id, env);
    expect(u.page).toMatch(/^https:\/\/built2bid\.org\/email\/unsubscribe\?u=2222.*&s=/);
    expect(u.oneClick).toMatch(/^https:\/\/built2bid\.org\/api\/email\/unsubscribe\?u=/);
  });
});
