import { describe, expect, it } from "vitest";
import { annualNudgeEligible, annualSavings, decideOffer, isCancelReason, isClickTarget, summarizeOffers, type OfferContext } from "@/lib/offers/policy";
import { ANNUAL, MONTHLY } from "@/lib/billing/plans";

const now = new Date("2026-12-01T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = (over: Partial<OfferContext> = {}): OfferContext => ({ now, signupAt: ago(24 * 30), subscriber: false, companyMember: false, pastDue: false, history: [], ...over });

describe("V8 offer caps and suppression", () => {
  it("T1 shows to a free account once per 30 days", () => {
    expect(decideOffer("t1_credits_low", base()).allowed).toBe(true);
    expect(decideOffer("t1_credits_low", base({ history: [{ offer_id: "t1_credits_low", action: "shown", created_at: ago(24 * 29) }] }))).toEqual({ allowed: false, reason: "cap_30d" });
    expect(decideOffer("t1_credits_low", base({ history: [{ offer_id: "t1_credits_low", action: "shown", created_at: ago(24 * 31) }] })).allowed).toBe(true);
  });
  it("never shows upgrade offers to subscribers, company members, past-due accounts or in the first 72 hours", () => {
    expect(decideOffer("t1_credits_low", base({ subscriber: true }))).toEqual({ allowed: false, reason: "subscriber" });
    expect(decideOffer("t1_credits_low", base({ companyMember: true }))).toEqual({ allowed: false, reason: "company_member" });
    expect(decideOffer("t5_annual", base({ subscriber: true, pastDue: true }))).toEqual({ allowed: false, reason: "past_due" });
    expect(decideOffer("t1_credits_low", base({ signupAt: ago(48) }))).toEqual({ allowed: false, reason: "new_account" });
  });
  it("T5 is for subscribers, once per 90 days", () => {
    expect(decideOffer("t5_annual", base())).toEqual({ allowed: false, reason: "not_subscriber" });
    expect(decideOffer("t5_annual", base({ subscriber: true })).allowed).toBe(true);
    expect(decideOffer("t5_annual", base({ subscriber: true, history: [{ offer_id: "t5_annual", action: "shown", created_at: ago(24 * 60) }] }))).toEqual({ allowed: false, reason: "cap_90d" });
  });
  it("T8 shows once ever, even to new and subscribed accounts, but not to company members", () => {
    expect(decideOffer("t8_first_sent", base({ signupAt: ago(1), subscriber: true })).allowed).toBe(true);
    expect(decideOffer("t8_first_sent", base({ history: [{ offer_id: "t8_first_sent", action: "shown", created_at: ago(24 * 400) }] }))).toEqual({ allowed: false, reason: "once_ever" });
    expect(decideOffer("t8_first_sent", base({ companyMember: true })).allowed).toBe(false);
  });
  it("waits 24 hours after any dismissal or after another offer was shown", () => {
    expect(decideOffer("t8_first_sent", base({ history: [{ offer_id: "t1_credits_low", action: "dismissed", created_at: ago(3) }] }))).toEqual({ allowed: false, reason: "dismissed_24h" });
    expect(decideOffer("t8_first_sent", base({ history: [{ offer_id: "t1_credits_low", action: "shown", created_at: ago(3) }] }))).toEqual({ allowed: false, reason: "other_offer_24h" });
    expect(decideOffer("t8_first_sent", base({ history: [{ offer_id: "t1_credits_low", action: "shown", created_at: ago(25) }] })).allowed).toBe(true);
  });
  it("never blocks the cancellation step", () => {
    expect(decideOffer("ret1_cancel", base({ companyMember: true, pastDue: true, history: [{ offer_id: "t5_annual", action: "dismissed", created_at: ago(1) }] })).allowed).toBe(true);
    // A cancellation step never suppresses other surfaces either.
    expect(decideOffer("t8_first_sent", base({ history: [{ offer_id: "ret1_cancel", action: "shown", created_at: ago(1) }] })).allowed).toBe(true);
  });
});

describe("V8 annual nudge", () => {
  it("computes savings from the real plan prices", () => {
    expect(annualSavings(MONTHLY.amountCents, ANNUAL.amountCents)).toBe("$90.88");
  });
  it("needs monthly, active, not cancelling, 3+ paid months and 8+ finalized bids", () => {
    const ok = { plan: "monthly", status: "active", cancelAtPeriodEnd: false, paidMonths: 3, finalizedBids: 8 };
    expect(annualNudgeEligible(ok)).toBe(true);
    expect(annualNudgeEligible({ ...ok, plan: "annual" })).toBe(false);
    expect(annualNudgeEligible({ ...ok, status: "past_due" })).toBe(false);
    expect(annualNudgeEligible({ ...ok, cancelAtPeriodEnd: true })).toBe(false);
    expect(annualNudgeEligible({ ...ok, paidMonths: 2 })).toBe(false);
    expect(annualNudgeEligible({ ...ok, finalizedBids: 7 })).toBe(false);
  });
});

describe("V8 offer inputs and owner report", () => {
  it("accepts only known reasons and click targets", () => {
    expect(isCancelReason("too_expensive")).toBe(true);
    expect(isCancelReason("I hate it")).toBe(false);
    expect(isClickTarget("portal_cancel")).toBe(true);
    expect(isClickTarget("https://evil.example")).toBe(false);
  });
  it("summarizes offers and reasons", () => {
    const s = summarizeOffers([
      { offer_id: "t1_credits_low", action: "shown", detail: null },
      { offer_id: "t1_credits_low", action: "clicked", detail: "checkout" },
      { offer_id: "ret1_cancel", action: "shown", detail: null },
      { offer_id: "ret1_cancel", action: "answered", detail: "seasonal" },
      { offer_id: "ret1_cancel", action: "clicked", detail: "portal_cancel" },
      { offer_id: "ret1_cancel", action: "clicked", detail: "portal_cancel" },
    ]);
    expect(s.offers.find((o) => o.offer === "t1_credits_low")).toEqual({ offer: "t1_credits_low", shown: 1, clicked: 1, dismissed: 0 });
    expect(s.reasons).toEqual([{ code: "seasonal", label: "My work is seasonal or slow", count: 1 }]);
    expect(s.skipped).toBe(1);
  });
});
