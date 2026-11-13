import { describe, expect, it } from "vitest";
import type { CreditStatus } from "@/lib/credits/status";
import { accountCtas, accountStatusFrom, creditBadge, SIGNED_OUT } from "@/lib/account/status";

const user = { emailVerified: true };
const credits = (o: Partial<CreditStatus> = {}): CreditStatus => ({ starter: 2, starterTotal: 3, monthly: 0, monthlyEligible: false, nextCycleAt: "2027-03-31T10:00:00.000Z", unlimited: false, emailVerified: true, starterGranted: true, ...o });
const labels = (s: ReturnType<typeof accountStatusFrom>) => { const c = accountCtas(s); return [c.primary.label, c.secondary.label]; };

describe("account-aware CTAs", () => {
  it("signed-out visitors keep the free offer and How It Works", () => {
    const s = accountStatusFrom(null, null);
    expect(s).toEqual(SIGNED_OUT);
    expect(labels(s)).toEqual(["Create a Free Bid", "See How It Works"]);
    expect(accountCtas(s).primary.href).toBe("/bids");
    expect(creditBadge(s)).toBeNull();
  });

  it("starter-credit users get Create New Bid, View My Bids and their balance", () => {
    const s = accountStatusFrom(user, credits());
    expect(s.kind).toBe("free");
    expect(labels(s)).toEqual(["Create New Bid", "View My Bids"]);
    expect(accountCtas(s).secondary.href).toBe("/dashboard");
    expect(creditBadge(s)).toBe("2 free bids left");
  });

  it("monthly-credit users count the monthly bid", () => {
    const s = accountStatusFrom(user, credits({ starter: 0, monthly: 1, monthlyEligible: true }));
    expect(s.kind).toBe("free");
    expect(creditBadge(s)).toBe("1 free bid left");
  });

  it("Unlimited subscribers never see credit limits, even with credits on file or a cancellation pending", () => {
    // has_unlimited stays true for active (incl. cancel_at_period_end) and past_due until the period ends.
    for (const c of [credits({ unlimited: true }), credits({ unlimited: true, starter: 0 })]) {
      const s = accountStatusFrom(user, c);
      expect(s.kind).toBe("unlimited");
      expect(labels(s)).toEqual(["Create New Bid", "View My Bids"]);
      expect(creditBadge(s)).toBeNull();
      expect(s.creditsLeft).toBeNull();
    }
  });

  it("expired subscriptions fall back to the Free plan rules", () => {
    expect(accountStatusFrom(user, credits({ unlimited: false, starter: 1 })).kind).toBe("free");
    expect(accountStatusFrom(user, credits({ unlimited: false, starter: 0, monthly: 0 })).kind).toBe("no_credits");
  });

  it("zero-credit users are pointed to plans and keep access to their bids", () => {
    const s = accountStatusFrom(user, credits({ starter: 0, monthly: 0, monthlyEligible: true }));
    expect(s.kind).toBe("no_credits");
    const c = accountCtas(s);
    expect([c.primary.label, c.primary.href]).toEqual(["View Plans", "/pricing"]);
    expect([c.secondary.label, c.secondary.href]).toEqual(["View My Bids", "/dashboard"]);
    expect(creditBadge(s)).toBe("No free bids left");
  });

  it("never shows signed-out promos or a false zero to a signed-in user whose balance is unknown", () => {
    for (const c of [null, credits({ emailVerified: false, starter: 0, starterGranted: false })]) {
      const s = accountStatusFrom({ emailVerified: false }, c);
      expect(s.kind).toBe("free");
      expect(labels(s)).toEqual(["Create New Bid", "View My Bids"]);
      expect(creditBadge(s)).toBeNull();
    }
  });

  it("trade pages open the trade directly", () => {
    expect(accountCtas(SIGNED_OUT, { createHref: "/start/roofing" }).primary.href).toBe("/start/roofing");
    expect(accountCtas(accountStatusFrom(user, credits()), { createHref: "/start/roofing" }).primary.href).toBe("/start/roofing");
  });
});
