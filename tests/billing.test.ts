import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { isEntitled, subscriptionToUpdate, type SubscriptionLike } from "@/lib/billing/sync";

const prices = { monthly: "price_month", annual: "price_year" };
const sub = (over: Partial<SubscriptionLike> = {}, periodEnd = Math.floor(Date.now() / 1000) + 86400 * 30, price = "price_year"): SubscriptionLike => ({
  id: "sub_123", customer: "cus_1", status: "active", cancel_at_period_end: false, canceled_at: null, ended_at: null,
  metadata: { user_id: "11111111-1111-1111-1111-111111111111" },
  items: { data: [{ current_period_end: periodEnd, price: { id: price, recurring: { interval: "year" } } }] },
  ...over,
});

describe("14/15. Stripe subscription → entitlement mapping", () => {
  it("active subscription grants unlimited and maps plan from price", () => {
    const u = subscriptionToUpdate(sub(), "u1", 1700000000, prices);
    expect(u.p_plan).toBe("annual");
    expect(u.p_status).toBe("active");
    expect(isEntitled(u)).toBe(true);
    expect(subscriptionToUpdate(sub({}, undefined, "price_month"), "u1", 1, prices).p_plan).toBe("monthly");
  });
  it("cancel at period end keeps access until the period ends", () => {
    const u = subscriptionToUpdate(sub({ cancel_at_period_end: true }), "u1", 1, prices);
    expect(u.p_cancel_at_period_end).toBe(true);
    expect(isEntitled(u)).toBe(true);
  });
  it("canceled, unpaid, incomplete, and expired subscriptions do not grant access", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(isEntitled(subscriptionToUpdate(sub({ status }), "u1", 1, prices)), status).toBe(false);
    }
    expect(isEntitled(subscriptionToUpdate(sub({}, Math.floor(Date.now() / 1000) - 10), "u1", 1, prices))).toBe(false);
  });
  it("past_due keeps access during Stripe's retry window", () => {
    expect(isEntitled(subscriptionToUpdate(sub({ status: "past_due" }), "u1", 1, prices))).toBe(true);
  });
  it("supports legacy subscription-level current_period_end", () => {
    const s = sub({ current_period_end: 2000000000 });
    s.items.data[0].current_period_end = undefined;
    expect(subscriptionToUpdate(s, "u1", 1, prices).p_current_period_end).toBe(new Date(2000000000 * 1000).toISOString());
  });
});

describe("webhook signature verification", () => {
  const stripe = new Stripe("sk_test_dummy");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", created: 1700000000, data: { object: { id: "sub_123" } } });
  it("accepts a correctly signed payload", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe("evt_1");
  });
  it("rejects tampered payloads and wrong secrets", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(() => stripe.webhooks.constructEvent(payload.replace("sub_123", "sub_999"), header, secret)).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
  });
});
