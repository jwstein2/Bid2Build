import { describe, expect, it } from "vitest";
import { capturePlan, disclosureText, noticeReadyOn, settingsProblems, stateFromAddress, STATE_CODES, surchargeCents, surchargeDecision } from "@/lib/financials/surcharge";
import { STATE_RULES } from "@/lib/financials/surcharge-rules";
import { checkoutParams, surchargeAllowed } from "@/lib/financials/connect";

describe("card surcharge rules table", () => {
  it("covers all 50 states and DC, each with a primary source", () => {
    expect(STATE_CODES.filter((c) => c !== "PR")).toHaveLength(51);
    for (const c of STATE_CODES) {
      const r = STATE_RULES[c];
      expect(r.sources.length, c).toBeGreaterThan(0);
      expect(r.summary.length, c).toBeGreaterThan(10);
      if (r.capPct != null) expect(r.capPct).toBeGreaterThan(0);
      if (r.status === "capped") expect(r.capPct!).toBeLessThan(3);
    }
  });

  it("blocks the states that ban surcharges", () => {
    for (const c of ["CT", "MA", "ME", "PR"]) expect(surchargeDecision(c, c).ok, c).toBe(false);
  });

  it("caps Colorado at 2%", () => {
    expect(surchargeDecision("CO", "CO", 3)).toMatchObject({ ok: true, pct: 2 });
  });
});

describe("surcharge decision", () => {
  it("applies the stricter of the contractor's and customer's states", () => {
    expect(surchargeDecision("MN", "MN", 3)).toMatchObject({ ok: true, pct: 3 });
    expect(surchargeDecision("MN", "CT").ok).toBe(false);
    expect(surchargeDecision("CT", "MN").ok).toBe(false);
    expect(surchargeDecision("MN", "CO", 3).pct).toBe(2);
    expect(surchargeDecision("MN", "MN", 2.5).pct).toBe(2.5);
  });
  it("refuses when a state is unknown", () => {
    expect(surchargeDecision(null, "MN").ok).toBe(false);
    expect(surchargeDecision("MN", null).ok).toBe(false);
    expect(surchargeDecision("MN", "ZZ").ok).toBe(false);
  });
  it("never exceeds 3%", () => {
    expect(surchargeDecision("MN", "MN", 4).pct).toBe(3);
  });
});

describe("surcharge amount", () => {
  it("is the rate, but never more than the real card cost on the surcharged total", () => {
    expect(surchargeCents(10_000, 3, 2.9, 30)).toBe(300);            // $100: rate wins (cost would be ~$3.30)
    expect(surchargeCents(1_000_000, 3, 2.9, 30)).toBe(29_897);      // $10,000: cost cap (2.9% of $10,298.97 + 30¢)
    expect(surchargeCents(1_000_000, 2, 2.9, 30)).toBe(20_000);
    expect(surchargeCents(10_000, 0, 2.9, 30)).toBe(0);
    expect(surchargeCents(10_000, 3, 0, 0)).toBe(0);                  // no card cost, no surcharge
  });
});

describe("capture plan (after Stripe tells us the card)", () => {
  const credit = { funding: "credit", pmType: "card", billingState: "MN", billingCountry: "US" };
  it("keeps the surcharge only for a US credit card in an allowed state", () => {
    expect(capturePlan(10_000, 300, "MN", credit)).toEqual({ captureCents: 10_300, keptCents: 300, reason: null });
  });
  it("drops it for debit, prepaid, unknown and wallets that hide funding", () => {
    for (const funding of ["debit", "prepaid", "unknown", null]) expect(capturePlan(10_000, 300, "MN", { ...credit, funding }).captureCents).toBe(10_000);
    expect(capturePlan(10_000, 300, "MN", { ...credit, pmType: "link" }).keptCents).toBe(0);
  });
  it("drops it when the billing address is in a banned state or abroad", () => {
    expect(capturePlan(10_000, 300, "MN", { ...credit, billingState: "Massachusetts" }).keptCents).toBe(0);
    expect(capturePlan(10_000, 300, "MN", { ...credit, billingState: "ON", billingCountry: "CA" }).keptCents).toBe(0);
    expect(capturePlan(10_000, 300, "MN", { ...credit, billingState: null }).keptCents).toBe(0);
  });
  it("lowers it to the billing state's cap", () => {
    expect(capturePlan(10_000, 300, "MN", { ...credit, billingState: "CO" })).toMatchObject({ captureCents: 10_200, keptCents: 200 });
  });
});

describe("contractor setup and disclosures", () => {
  it("needs a rate, the terms and 30 days' notice", () => {
    const ok = { pct: 3, costPct: 2.9, costFixedCents: 30, noticeDate: "2026-10-01", attested: true };
    expect(settingsProblems(ok, "2026-11-21")).toEqual([]);
    expect(settingsProblems({ ...ok, noticeDate: "2026-11-01" }, "2026-11-21")[0]).toMatch(/2026-12-01/);
    expect(settingsProblems({ ...ok, attested: false }, "2026-11-21")).toHaveLength(1);
    expect(settingsProblems({ ...ok, noticeDate: null }, "2026-11-21")).toHaveLength(1);
    expect(noticeReadyOn("2026-01-31")).toBe("2026-03-02");
  });
  it("reads the state from an address", () => {
    expect(stateFromAddress("12 Oak St, Edina, MN 55424")).toBe("MN");
    expect(stateFromAddress("12 Oak St, Edina, MN 55424-1234, USA")).toBe("MN");
    expect(stateFromAddress("9 Elm Rd, Hartford, Connecticut")).toBe("CT");
    expect(stateFromAddress("somewhere")).toBeNull();
    expect(stateFromAddress(null)).toBeNull();
  });
  it("says credit only, cost cap and no surcharge on debit or ACH", () => {
    const t = disclosureText(3);
    expect(t).toMatch(/3% surcharge/);
    expect(t).toMatch(/not greater than our cost/);
    expect(t).toMatch(/debit cards, prepaid cards, or bank \(ACH\)/);
  });
  it("is on unless the owner's kill switch is set", () => {
    expect(surchargeAllowed({})).toBe(true);
    expect(surchargeAllowed({ CONNECT_CARD_SURCHARGE: "off" })).toBe(false);
  });
});

describe("surcharge checkout", () => {
  const base = { invoiceId: "i1", bookId: "b1", invoiceNumber: "INV-7", businessName: "Acme Decks", amountDue: "100.00", returnUrl: "https://built2bid.org/pay/t" };
  it("authorizes invoice + surcharge on a card-only session for manual capture", () => {
    const p = checkoutParams({ ...base, card: true, ach: false, surcharge: { cents: 300, pct: 3, contractorState: "MN", customerState: "MN", disclosure: disclosureText(3) } });
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.line_items).toHaveLength(2);
    expect(p.line_items[1].price_data.unit_amount).toBe(300);
    expect(p.line_items[1].price_data.product_data.name).toBe("Credit card surcharge (3%)");
    expect(p.payment_intent_data).toMatchObject({ capture_method: "manual" });
    expect(p.metadata).toMatchObject({ b2b_base_cents: "10000", b2b_surcharge_cents: "300", b2b_contractor_state: "MN" });
    expect(p).toMatchObject({ billing_address_collection: "required" });
  });
  it("never puts a surcharge on a bank payment", () => {
    expect(() => checkoutParams({ ...base, card: true, ach: true, surcharge: { cents: 300, pct: 3, contractorState: "MN", customerState: "MN", disclosure: "x" } })).toThrow("surcharge_card_only");
    const plain = checkoutParams({ ...base, card: false, ach: true });
    expect(plain.payment_intent_data).not.toHaveProperty("capture_method");
  });
});
