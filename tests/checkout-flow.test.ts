import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANNUAL, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS_PERCENT, MONTHLY, annualSavingsPercent, formatUsd, isPlanId, monthlyEquivalentCents, priceMismatch } from "@/lib/billing/plans";
import { converge, reusableSession, staleSessions, BLOCKING_SUBSCRIPTION_STATUSES } from "@/lib/billing/checkout-sessions";
import { INTENT_KEY, INTENT_TTL_MS, acquireCheckoutLock, clearIntent, parseIntent, readIntent, releaseCheckoutLock, resumePath, saveIntent, updateIntent } from "@/lib/billing/checkout-intent";
import { plans } from "@/lib/site";

describe("plan prices", () => {
  it("shows the configured Stripe amounts", () => {
    expect(MONTHLY).toMatchObject({ name: "Individual Unlimited Monthly", price: "$19.99", per: "/month", billing: "Billed monthly", amountCents: 1999, interval: "month" });
    expect(ANNUAL).toMatchObject({ name: "Individual Unlimited Annual", price: "$199", per: "/year", billing: "Billed annually", amountCents: 19900, interval: "year" });
  });
  it("computes the annual monthly equivalent and savings honestly", () => {
    // 199 / 12 = 16.5833… → $16.58
    expect(monthlyEquivalentCents(19900)).toBe(1658);
    expect(ANNUAL_MONTHLY_EQUIVALENT).toBe("$16.58");
    // 12 × 19.99 = 239.88; (239.88 − 199) / 239.88 = 17.04% → "approximately 17%"
    expect(annualSavingsPercent(1999, 19900)).toBe(17);
    expect(ANNUAL_SAVINGS_PERCENT).toBe(17);
  });
  it("keeps site-wide labels in sync with the plan table", () => {
    expect(plans.monthlyPriceLabel).toBe(MONTHLY.price);
    expect(plans.annualPriceLabel).toBe(ANNUAL.price);
    expect(plans.annualMonthlyEquivalent).toBe("$16.58");
  });
  it("formats whole and fractional dollars", () => {
    expect(formatUsd(19900)).toBe("$199");
    expect(formatUsd(1999)).toBe("$19.99");
    expect(formatUsd(1990)).toBe("$19.90");
  });
  it("only accepts approved plan ids", () => {
    expect(isPlanId("monthly")).toBe(true);
    expect(isPlanId("annual")).toBe(true);
    for (const bad of ["price_123", "MONTHLY", "", null, undefined, 1999]) expect(isPlanId(bad)).toBe(false);
  });
});

describe("server price verification", () => {
  const live = (unit_amount: number, interval: string, extra: object = {}) => ({ unit_amount, currency: "usd", recurring: { interval, interval_count: 1 }, active: true, ...extra });
  it("accepts the live prices as configured in Stripe", () => {
    expect(priceMismatch("monthly", live(1999, "month"))).toBeNull();
    expect(priceMismatch("annual", live(19900, "year"))).toBeNull();
  });
  it("refuses a price that doesn't match what the page shows", () => {
    expect(priceMismatch("monthly", live(19900, "year"))).toMatch(/amount/);
    expect(priceMismatch("annual", live(19900, "month"))).toMatch(/interval/);
    expect(priceMismatch("annual", live(19900, "year", { currency: "cad" }))).toMatch(/currency/);
    expect(priceMismatch("monthly", live(1999, "month", { active: false }))).toMatch(/archived/);
    expect(priceMismatch("monthly", { unit_amount: 1999, currency: "usd", recurring: null })).toMatch(/recurring/);
  });
});

describe("one open checkout per customer", () => {
  const now = 1_800_000_000;
  const s = (id: string, plan: string, created: number, ttl = 3600) => ({ id, created, url: `https://checkout.stripe.com/c/${id}`, expires_at: now + ttl, metadata: { plan } });
  it("reuses the oldest live session for the same plan", () => {
    const open = [s("b", "monthly", 20), s("a", "monthly", 10), s("c", "annual", 5)];
    expect(reusableSession(open, "monthly", now)?.id).toBe("a");
    expect(staleSessions(open, "monthly", now).map((x) => x.id).sort()).toEqual(["b", "c"]);
  });
  it("doesn't reuse a session about to expire", () => {
    expect(reusableSession([s("a", "monthly", 10, 60)], "monthly", now)).toBeNull();
  });
  it("makes concurrent requests converge on the same session", () => {
    const open = [s("y", "monthly", 30), s("x", "monthly", 30), s("z", "monthly", 31)];
    const r1 = converge(open);
    const r2 = converge([...open].reverse());
    expect(r1.keep?.id).toBe("x");
    expect(r2.keep?.id).toBe("x");
    expect(r1.expire.map((e) => e.id).sort()).toEqual(["y", "z"]);
  });
  it("treats any live subscription as already subscribed", () => {
    for (const st of ["active", "trialing", "past_due", "unpaid", "paused"]) expect(BLOCKING_SUBSCRIPTION_STATUSES.has(st)).toBe(true);
    for (const st of ["canceled", "incomplete_expired", "incomplete"]) expect(BLOCKING_SUBSCRIPTION_STATUSES.has(st)).toBe(false);
  });
});

describe("pending checkout intent", () => {
  class MemStorage {
    m = new Map<string, string>();
    getItem(k: string) { return this.m.get(k) ?? null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
  }
  beforeEach(() => { (globalThis as { window?: unknown }).window = { localStorage: new MemStorage() }; });
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  it("survives a reload and keeps the same id when the plan is re-selected", () => {
    const a = saveIntent("monthly");
    expect(readIntent().intent).toMatchObject({ plan: "monthly", status: "pending", id: a.id });
    const b = saveIntent("monthly");
    expect(b.id).toBe(a.id);
    const c = saveIntent("annual");
    expect(c.id).not.toBe(a.id);
    expect(readIntent().intent?.plan).toBe("annual");
  });
  it("tracks the email being verified and the redirect status", () => {
    saveIntent("annual");
    updateIntent({ email: "pro@example.test" });
    updateIntent({ status: "redirected" });
    expect(readIntent().intent).toMatchObject({ plan: "annual", email: "pro@example.test", status: "redirected" });
    saveIntent("annual");
    expect(readIntent().intent?.status).toBe("pending");
    clearIntent();
    expect(readIntent().intent).toBeNull();
  });
  it("expires after the sign-in window and ignores tampered values", () => {
    const old = JSON.stringify({ v: 1, id: "abc12345", plan: "monthly", createdAt: 0, status: "pending" });
    expect(parseIntent(old, INTENT_TTL_MS + 1)).toMatchObject({ intent: null, expired: { plan: "monthly" } });
    expect(parseIntent(JSON.stringify({ v: 1, id: "x", plan: "price_live_123", createdAt: 1 }), 2).intent).toBeNull();
    expect(parseIntent("not json").intent).toBeNull();
    const w = (globalThis as unknown as { window: { localStorage: MemStorage } }).window;
    w.localStorage.setItem(INTENT_KEY, JSON.stringify({ v: 1, id: "abc12345", plan: "enterprise", createdAt: Date.now() }));
    expect(readIntent().intent).toBeNull();
  });
  it("lets only one tab start checkout at a time", () => {
    expect(acquireCheckoutLock("tab-a")).toBe(true);
    expect(acquireCheckoutLock("tab-b")).toBe(false);
    releaseCheckoutLock("tab-b"); // not the owner: no effect
    expect(acquireCheckoutLock("tab-b")).toBe(false);
    releaseCheckoutLock("tab-a");
    expect(acquireCheckoutLock("tab-b")).toBe(true);
  });
  it("returns email-link sign-ins to the pricing page with the plan", () => {
    expect(resumePath("annual")).toBe("/pricing?resume=annual");
  });
});
