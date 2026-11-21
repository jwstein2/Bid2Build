import { describe, expect, it } from "vitest";
import { accountState, checkoutParams, connectMode, feeNote, hashPayToken, looksLikePayToken, methodFromType, newPayToken, surchargeAllowed } from "@/lib/financials/connect";

describe("Stripe Connect invoice payments: pure helpers", () => {
  it("only goes live with both owner switches", () => {
    expect(connectMode({})).toBe("off");
    expect(connectMode({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe("test");
    expect(connectMode({ STRIPE_SECRET_KEY: "sk_live_x" })).toBe("off");
    expect(connectMode({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_ALLOW_LIVE: "true" })).toBe("off");
    expect(connectMode({ STRIPE_SECRET_KEY: "rk_live_x", STRIPE_ALLOW_LIVE: "true", CONNECT_PAYMENTS_LIVE: "true" })).toBe("live");
  });

  it("keeps the card surcharge off until counsel approves", () => {
    expect(surchargeAllowed({})).toBe(false);
    expect(surchargeAllowed({ CONNECT_CARD_SURCHARGE: "on" })).toBe(false);
    expect(surchargeAllowed({ CONNECT_CARD_SURCHARGE: "approved" })).toBe(true);
  });

  it("derives a plain account state", () => {
    expect(accountState(null)).toBe("not_started");
    expect(accountState({ details_submitted: false })).toBe("onboarding");
    expect(accountState({ details_submitted: true, requirements: { currently_due: [] } })).toBe("pending_review");
    expect(accountState({ details_submitted: true, requirements: { currently_due: ["external_account"] } })).toBe("action_needed");
    expect(accountState({ details_submitted: true, requirements: { disabled_reason: "rejected.fraud" } })).toBe("restricted");
    expect(accountState({ charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } })).toBe("ready");
    expect(accountState({ charges_enabled: true, payouts_enabled: false, details_submitted: true, requirements: { currently_due: ["individual.id_number"] } })).toBe("action_needed");
  });

  it("makes unguessable tokens and stores only a hash", () => {
    const t = newPayToken();
    expect(looksLikePayToken(t)).toBe(true);
    expect(newPayToken()).not.toBe(t);
    expect(hashPayToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikePayToken("short")).toBe(false);
    expect(looksLikePayToken("../../etc/passwd/../../etc/passwd/../../etc/passwd")).toBe(false);
  });

  it("builds a direct-charge Checkout for the open balance with the chosen methods", () => {
    const p = checkoutParams({ invoiceId: "i1", bookId: "b1", invoiceNumber: "INV-7", businessName: "Acme Decks", amountDue: "1234.56", card: true, ach: true, returnUrl: "https://built2bid.org/pay/t" });
    expect(p.line_items[0].price_data.unit_amount).toBe(123456);
    expect(p.payment_method_types).toEqual(["card", "us_bank_account"]);
    expect(p.metadata).toEqual({ b2b_invoice_id: "i1", b2b_book_id: "b1", b2b_kind: "invoice_payment" });
    expect(p.payment_intent_data.metadata.b2b_kind).toBe("invoice_payment");
    expect(p.success_url).toBe("https://built2bid.org/pay/t?paid=1");
    expect(p).not.toHaveProperty("payment_intent_data.application_fee_amount");   // Built2Bid takes no fee
    const achOnly = checkoutParams({ invoiceId: "i", bookId: "b", invoiceNumber: "1", businessName: "x", amountDue: "10", card: false, ach: true, returnUrl: "u" });
    expect(achOnly.payment_method_types).toEqual(["us_bank_account"]);
    expect(() => checkoutParams({ invoiceId: "i", bookId: "b", invoiceNumber: "1", businessName: "x", amountDue: "0.10", card: true, ach: false, returnUrl: "u" })).toThrow("amount_too_small");
    expect(() => checkoutParams({ invoiceId: "i", bookId: "b", invoiceNumber: "1", businessName: "x", amountDue: "10", card: false, ach: false, returnUrl: "u" })).toThrow("no_methods");
  });

  it("maps payment method types and explains methods", () => {
    expect(methodFromType("card")).toBe("card");
    expect(methodFromType("link")).toBe("card");
    expect(methodFromType("us_bank_account")).toBe("ach");
    expect(methodFromType("klarna")).toBeNull();
    expect(feeNote(true, true)).toMatch(/card or directly from your bank/);
    expect(feeNote(false, true)).toMatch(/bank account/);
    expect(feeNote(true, false)).toBe("Pay securely by card.");
  });
});
