/**
 * V5.0 billing correctness: the scenario matrix from the pricing audit, checked against an independent
 * re-implementation of Stripe's graduated-tier algorithm using the LIVE seat price's tier table
 * (read from Stripe on 2026-11-17: up_to 2 @1999, up_to 7 @1799, inf @1599). No network, no charges.
 */
import { describe, expect, it } from "vitest";
import { ENTERPRISE_BASE_CENTS, ENTERPRISE_SEAT_TIERS, enterpriseMonthlyCents, enterpriseQuote, nextSeatCents } from "@/lib/enterprise/pricing";
import { subscriptionListCents } from "@/lib/billing/sync";
import { isCompanySeat } from "@/lib/billing/company-seat";
import { pickPlanItem } from "@/lib/growth/referral";
import { PM_ADDON_ANNUAL_CENTS, PM_ADDON_CENTS, PM_EDITOR_CENTS, editorMonthlyCents } from "@/lib/pm/billing";
import { checkSeatTarget, seatItemUpdates } from "@/lib/enterprise/seats";

/** Live Stripe tier table for price_1UcfEACyFxy55f1osxQTkAIb, copied verbatim. */
const LIVE_TIERS = [
  { up_to: 2, unit_amount: 1999 },
  { up_to: 7, unit_amount: 1799 },
  { up_to: null, unit_amount: 1599 },
];

/** Stripe "graduated" pricing: each unit is priced by the tier its position falls in. */
function stripeGraduated(qty: number, tiers = LIVE_TIERS): number {
  let total = 0;
  let prev = 0;
  for (const t of tiers) {
    if (qty <= prev) break;
    const top = t.up_to === null ? qty : Math.min(qty, t.up_to);
    total += (top - prev) * t.unit_amount;
    prev = t.up_to ?? qty;
  }
  return total;
}
/** What Stripe bills monthly for an Enterprise company with `users` licensed users. */
const stripeEnterprise = (users: number) => ENTERPRISE_BASE_CENTS + stripeGraduated(Math.max(0, users - 3));

describe("Enterprise graduated seats (code vs live Stripe tiers)", () => {
  it("code tier table equals the live Stripe tier table", () => {
    expect(ENTERPRISE_SEAT_TIERS.map((t) => [t.upTo, t.unitCents])).toEqual(LIVE_TIERS.map((t) => [t.up_to, t.unit_amount]));
  });

  it.each([
    [3, 4999], // base only
    [4, 4999 + 1999],
    [5, 4999 + 2 * 1999], // $89.97
    [6, 4999 + 2 * 1999 + 1799],
    [10, 4999 + 2 * 1999 + 5 * 1799], // $179.92
    [11, 4999 + 2 * 1999 + 5 * 1799 + 1599],
    [20, 4999 + 2 * 1999 + 5 * 1799 + 10 * 1599], // $339.82
  ])("%i users bill %i cents in both the quote and Stripe", (users, cents) => {
    expect(enterpriseMonthlyCents(users)).toBe(cents);
    expect(stripeEnterprise(users)).toBe(cents);
  });

  it("matches Stripe for every headcount 1..250 (graduated, never the last tier for all seats)", () => {
    for (let u = 1; u <= 250; u++) expect(enterpriseMonthlyCents(u)).toBe(stripeEnterprise(u));
    // Volume pricing (all seats at the last rate) would bill 20 users 4999 + 17*1599; we must not.
    expect(enterpriseMonthlyCents(20)).not.toBe(4999 + 17 * 1599);
  });

  it("adding a user costs exactly the marginal tier price", () => {
    expect(nextSeatCents(3)).toBe(1999);
    expect(nextSeatCents(5)).toBe(1799);
    expect(nextSeatCents(10)).toBe(1599);
    expect(nextSeatCents(19)).toBe(1599);
  });

  it("quote lines itemize the tiers the customer sees", () => {
    expect(enterpriseQuote(20).lines.map((l) => [l.label, l.users, l.totalCents])).toEqual([
      ["Team base (includes 3 users)", 3, 4999],
      ["Users 4-5", 2, 3998],
      ["Users 6-10", 5, 8995],
      ["Users 11-20", 10, 15990],
    ]);
  });

  it("seat changes only touch the seat item quantity (users - 3) and removing below in-use is refused", () => {
    const items = [{ id: "si_base", price: { id: "base" }, quantity: 1 }, { id: "si_seat", price: { id: "seat" }, quantity: 7 }];
    expect(seatItemUpdates(items, "seat", 20)).toEqual([{ id: "si_seat", quantity: 17 }]);
    expect(seatItemUpdates(items, "seat", 3)).toEqual([{ id: "si_seat", deleted: true }]);
    expect(checkSeatTarget(8, 10, 9).ok).toBe(false);
    expect(checkSeatTarget(9, 10, 9).ok).toBe(true);
  });
});

describe("Scenario matrix: monthly list value of each subscription shape", () => {
  const P = { enterpriseSeat: "seat" };
  const std = (cents: number) => ({ quantity: 1, price: { id: "std", unit_amount: cents } });
  const ent = (users: number, extraEditors = 0) => [
    { quantity: 1, price: { id: "base", unit_amount: 4999 } },
    ...(users > 3 ? [{ quantity: users - 3, price: { id: "seat", unit_amount: null } }] : []),
    ...(extraEditors > 0 ? [{ quantity: extraEditors, price: { id: "ed", unit_amount: PM_EDITOR_CENTS } }] : []),
  ];

  it.each([
    ["Standard monthly", [std(1999)], 1999],
    ["Standard annual (per year)", [std(14900)], 14900],
    ["Standard + PM monthly", [std(1999), { quantity: 1, price: { id: "pm", unit_amount: PM_ADDON_CENTS } }], 2498],
    ["Standard annual + PM annual (per year)", [std(14900), { quantity: 1, price: { id: "pma", unit_amount: PM_ADDON_ANNUAL_CENTS } }], 19899],
    ["Enterprise 3 users", ent(3), 4999],
    ["Enterprise 5 users", ent(5), 8997],
    ["Enterprise 10 users", ent(10), 17992],
    ["Enterprise 20 users", ent(20), 33982],
    ["Enterprise 10 users + 2 extra PM editors", ent(10, 2), 17992 + 398],
  ] as const)("%s = %i cents", (_label, items, cents) => {
    expect(subscriptionListCents(items as never, P)).toBe(cents);
  });

  it("before the fix, tiered seats were valued at $0 (unit_amount null)", () => {
    const naive = ent(20).reduce((n, i) => n + (i.price.unit_amount ?? 0) * i.quantity, 0);
    expect(naive).toBe(4999);
    expect(subscriptionListCents(ent(20) as never, P)).toBe(33982);
  });

  it("extra PM editors are $1.99 each and independent of licensed users", () => {
    expect(editorMonthlyCents(0)).toBe(0);
    expect(editorMonthlyCents(3)).toBe(597);
  });
});

describe("Double-billing guard", () => {
  it("recognizes an Enterprise company seat from user_entitlement()", () => {
    expect(isCompanySeat([{ tier: "enterprise", source: "company_seat" }])).toBe(true);
    expect(isCompanySeat({ tier: "enterprise", source: "company_seat" })).toBe(true);
    expect(isCompanySeat([{ tier: "unlimited", source: "subscription" }])).toBe(false);
    expect(isCompanySeat([{ tier: "unlimited", source: "complimentary" }])).toBe(false);
    expect(isCompanySeat(null)).toBe(false);
    expect(isCompanySeat(false)).toBe(false);
  });
});

describe("Referral reward prices the plan item, not an add-on or tiered seat", () => {
  const m = (unit_amount: number | null, interval = "month", quantity = 1) => ({ quantity, price: { unit_amount, recurring: { interval, interval_count: 1 } } });
  it("Enterprise: base $49.99 even when the seat item comes first", () => {
    expect(pickPlanItem([m(null, "month", 7), m(4999), m(199, "month", 2)])?.price.unit_amount).toBe(4999);
  });
  it("Standard + PM: the $19.99 plan, not the $4.99 add-on", () => {
    expect(pickPlanItem([m(499), m(1999)])?.price.unit_amount).toBe(1999);
  });
  it("Annual: the $149 plan", () => {
    expect(pickPlanItem([m(4999, "year"), m(14900, "year")])?.price.unit_amount).toBe(14900);
  });
});
