import { describe, expect, it } from "vitest";
import { categorize, matchStripeDeposits, reserve, summarize, type BankTxn } from "@/lib/banking/cashflow";
import { feeCents, feeLine } from "@/lib/payouts/labels";
import { payoutProvider, ProviderError } from "@/lib/payouts/provider";
import { destinationProblem } from "@/lib/payouts/events";
import { readPayoutState, signPayoutState } from "@/lib/payouts/state";
import { safeStaffNext } from "@/lib/staff/next";

const GP = { standard_fixed_cents: 150, standard_bps: 0, instant_fixed_cents: 150, instant_bps: 75, instant_min_cents: 200 };
const tx = (id: string, posted_on: string, description: string, amount: number): BankTxn => ({ id, account_id: "a1", posted_on, description, amount });
const env = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;

describe("payout fees (mirror of public.payout_fee_cents)", () => {
  it("charges the flat standard ACH fee", () => {
    expect(feeCents(50000, "standard", GP)).toBe(150);
    expect(feeCents(62500, "standard", GP)).toBe(150);
  });
  it("applies the instant minimum and percentage, rounding up", () => {
    expect(feeCents(1000, "instant", GP)).toBe(200);
    expect(feeCents(50000, "instant", GP)).toBe(525);
    expect(feeCents(10001, "instant", GP)).toBe(150 + 76);
  });
  it("is zero with no policy or no money", () => {
    expect(feeCents(50000, "standard", null)).toBe(0);
    expect(feeCents(0, "standard", GP)).toBe(0);
    expect(feeLine(null)).toMatch(/No fee/);
    expect(feeLine(GP)).toContain("$1.50");
  });
});

describe("payout provider guard", () => {
  const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as ProviderError).code; } };
  it("never lets the practice provider run live", () => {
    expect(code(() => payoutProvider("mock", "live", env()))).toBe("mock_in_live");
    expect(payoutProvider("mock", "test", env()).name).toBe("mock");
  });
  it("refuses missing keys and test/live crossovers", () => {
    expect(code(() => payoutProvider("stripe_global_payouts", "test", env()))).toBe("provider_not_configured");
    expect(code(() => payoutProvider("stripe_global_payouts", "test", env({ PAYOUTS_PROVIDER_KEY: "sk_live_x" })))).toBe("mode_mismatch");
    expect(code(() => payoutProvider("stripe_global_payouts", "live", env({ PAYOUTS_PROVIDER_KEY: "sk_test_x" })))).toBe("mode_mismatch");
    expect(code(() => payoutProvider("stripe_global_payouts", "live", env({ PAYOUTS_PROVIDER_KEY: "sk_live_x" })))).toBe("live_not_allowed");
    expect(payoutProvider("stripe_global_payouts", "test", env({ PAYOUTS_PROVIDER_KEY: "sk_test_x" })).mode).toBe("test");
  });
  it("mock refuses non-positive amounts and keeps one reference per idempotency key", async () => {
    const p = payoutProvider("mock", "test", env());
    await expect(p.send({ amountCents: 0, recipientRef: "r", methodRef: null, idempotencyKey: "k", ref: "x", description: "d" })).rejects.toThrow(ProviderError);
    const a = await p.send({ amountCents: 100, recipientRef: "r", methodRef: null, idempotencyKey: "abc-123", ref: "x", description: "d" });
    const b = await p.send({ amountCents: 100, recipientRef: "r", methodRef: null, idempotencyKey: "abc-123", ref: "x", description: "d" });
    expect(a.providerRef).toBe(b.providerRef);
  });
});

describe("bank connection state", () => {
  const S = "test-secret";
  it("round-trips for the same staff member", () => {
    const v = signPayoutState({ staffId: "s1", recipientRef: "acct_1", mode: "test" }, 1000, S);
    expect(readPayoutState(v, "s1", 2000, S)).toEqual({ recipientRef: "acct_1", mode: "test" });
  });
  it("rejects another staff member, a forged recipient, expiry and a wrong secret", () => {
    const v = signPayoutState({ staffId: "s1", recipientRef: "acct_1", mode: "test" }, 1000, S);
    expect(readPayoutState(v, "s2", 2000, S)).toBeNull();
    const sig = v.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ staffId: "s1", recipientRef: "acct_OTHER", mode: "test", exp: 9e15 })).toString("base64url");
    expect(readPayoutState(`${forged}.${sig}`, "s1", 2000, S)).toBeNull();
    expect(readPayoutState(v, "s1", 1000 + 31 * 60 * 1000, S)).toBeNull();
    expect(readPayoutState(v, "s1", 2000, "other")).toBeNull();
    expect(readPayoutState(undefined, "s1", 2000, S)).toBeNull();
  });
});

describe("destination problems", () => {
  it("maps closed or invalid accounts so the bank must be replaced", () => {
    expect(destinationProblem("account_closed")).toBe("account_closed");
    expect(destinationProblem("invalid_account_number")).toBe("account_closed");
    expect(destinationProblem("insufficient_funds")).toBe("insufficient_funds");
    expect(destinationProblem(null)).toBeNull();
  });
});

describe("safe staff return path", () => {
  it("allows only /staff pages", () => {
    expect(safeStaffNext("/staff/payouts")).toBe("/staff/payouts");
    expect(safeStaffNext("/staff")).toBe("/staff");
    expect(safeStaffNext("/staff?x=1")).toBe("/staff?x=1");
    for (const bad of ["/staffing", "//evil.com", "https://evil.com", "/staff/login", "/staff\\..\\x", "/dashboard", null, undefined]) expect(safeStaffNext(bad)).toBe("/staff");
  });
});

describe("banking cash flow", () => {
  it("categorizes Stripe deposits separately so revenue isn't double-counted", () => {
    expect(categorize({ description: "STRIPE TRANSFER ST-123", amount: 950 })).toBe("stripe_settlement");
    expect(categorize({ description: "STRIPE top-up", amount: -500 })).toBe("payout_funding");
    expect(categorize({ description: "Online Transfer to SAV", amount: -100 })).toBe("transfer");
    expect(categorize({ description: "NETLIFY", amount: -19 })).toBe("software");
    expect(categorize({ description: "Gusto payroll", amount: -2000 })).toBe("payroll");
  });
  it("matches Stripe payouts to bank deposits once, within the arrival window", () => {
    const bank = [tx("t1", "2026-11-03", "STRIPE TRANSFER", 100), tx("t2", "2026-11-03", "STRIPE TRANSFER", 100), tx("t3", "2026-11-20", "STRIPE TRANSFER", 55)];
    const r = matchStripeDeposits(bank, [
      { id: "po1", amount_cents: 10000, arrival_date: "2026-11-02", status: "paid" },
      { id: "po2", amount_cents: 7700, arrival_date: "2026-11-02", status: "paid" },
      { id: "po3", amount_cents: 5500, arrival_date: "2026-11-01", status: "paid" },
      { id: "po4", amount_cents: 10000, arrival_date: "2026-11-02", status: "in_transit" },
    ]);
    expect(r.matched.map((m) => [m.payout.id, m.txn.id])).toEqual([["po1", "t1"]]);
    expect(r.unmatchedPayouts.map((p) => p.id).sort()).toEqual(["po2", "po3"]);
    expect(r.unmatchedDeposits.map((t) => t.id).sort()).toEqual(["t2", "t3"]);
  });
  it("summarizes the month and leaves transfers and excluded (personal) accounts out", () => {
    const s = summarize([tx("a", "2026-10-30", "old", 999), tx("b", "2026-11-02", "Customer check", 500), tx("c", "2026-11-03", "Online transfer from SAV", 300), tx("d", "2026-11-04", "Home Depot", -120.5)],
      [{ current: 1000, available: 900, excluded: false }, { current: 5000, available: null, excluded: true }], "2026-11-01");
    expect(s.incomeCents).toBe(50000);
    expect(s.expenseCents).toBe(12050);
    expect(s.netCents).toBe(37950);
    expect(s.transferCents).toBe(30000);
    expect(s.cashCents).toBe(90000);
    expect(summarize([], [{ current: null, available: null, excluded: false }], "2026-11-01").cashCents).toBeNull();
  });
  it("projects cash after obligations", () => {
    expect(reserve(100000, [{ label: "x", cents: 30000, due: null, source: "scheduled" }], 5000)).toEqual({ afterCents: 75000, outCents: 30000 });
    expect(reserve(null, [], 0).afterCents).toBeNull();
  });
});
