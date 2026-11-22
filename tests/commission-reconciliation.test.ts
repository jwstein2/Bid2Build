import { describe, expect, it } from "vitest";
import { alertDigest, invoiceFact, pretaxPaidCents, reportCsv } from "@/lib/reconciliation/facts";
import { billPaymentPayload, billState } from "@/lib/quickbooks/payout-bills";

describe("reconciliation: Stripe invoice facts", () => {
  const paid = { id: "in_1", livemode: true, status: "paid", customer: "cus_1", currency: "USD", amount_due: 2149, amount_paid: 2149, total: 2149, total_excluding_tax: 1999,
    created: 1_790_000_000, status_transitions: { paid_at: 1_790_000_100 }, parent: { subscription_details: { subscription: "sub_1" } } };

  it("maps a paid invoice: pre-tax share, paid time, subscription from the new parent field", () => {
    expect(invoiceFact(paid, { source: "webhook" })).toMatchObject({ invoice_id: "in_1", livemode: true, status: "paid", customer: "cus_1", subscription_id: "sub_1", currency: "usd",
      amount_paid: 2149, pretax_paid: 1999, paid_at: new Date(1_790_000_100_000).toISOString(), source: "webhook" });
  });
  it("an unpaid or failed invoice records no payment", () => {
    const f = invoiceFact({ ...paid, status: "open", amount_paid: 0 }, { source: "webhook", failedAt: new Date(0) });
    expect(f).toMatchObject({ status: "open", amount_paid: 0, pretax_paid: 0, paid_at: null, failed_at: new Date(0).toISOString() });
  });
  it("test-mode and malformed invoices are marked or ignored", () => {
    expect(invoiceFact({ ...paid, livemode: false }, { source: "reconcile" })?.livemode).toBe(false);
    expect(invoiceFact({}, { source: "reconcile" })).toBeNull();
  });
  it("pre-tax share falls back to the amount paid", () => {
    expect(pretaxPaidCents({ amount_paid: 1000, total: null, total_excluding_tax: null })).toBe(1000);
    expect(pretaxPaidCents({ amount_paid: 1100, total: 1100, total_excluding_tax: 1000 })).toBe(1000);
  });
});

describe("reconciliation: alerts and reports", () => {
  it("sends nothing when nothing needs the owner", () => {
    expect(alertDigest([])).toBeNull();
  });
  it("one digest, discrepancies called out", () => {
    const d = alertDigest([{ kind: "x", severity: "material", summary: "Statement total mismatch", amount_cents: -300 }, { kind: "y", severity: "action", summary: "QuickBooks sign-in", amount_cents: null, repeat: true }])!;
    expect(d.subject).toBe("Reconciliation: 1 discrepancy needs review");
    expect(d.body).toContain("[Discrepancy] Statement total mismatch ($3.00)");
    expect(d.body).toContain("(still open)");
  });
  it("CSV keeps negative numbers and neutralizes formulas", () => {
    const csv = reportCsv({ period: "2026-11", revenue: { collected_cents: 199900, invoices_paid: 3 }, exceptions: { difference_cents: -1250, items: [{ kind: "k", severity: "material", status: "open", summary: "=HYPERLINK()" }] } });
    expect(csv).toContain("revenue,collected_usd,1999.00");
    expect(csv).toContain("exceptions,difference_usd,-12.50");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

describe("QuickBooks bookkeeping for provider-settled payouts", () => {
  it("a bill payment is a 'Check' entry linked to the bill (records, never sends money)", () => {
    const p = billPaymentPayload({ vendorId: "12", bankAccountId: "35", billId: "77", amountCents: 12345, txnDate: "2026-12-01", note: "Built2Bid B2B-S2611-ABC: paid by payout B2B-PO-1" });
    expect(p).toMatchObject({ PayType: "Check", TotalAmt: 123.45, VendorRef: { value: "12" }, CheckPayment: { BankAccountRef: { value: "35" } }, Line: [{ Amount: 123.45, LinkedTxn: [{ TxnId: "77", TxnType: "Bill" }] }] });
    expect(() => billPaymentPayload({ vendorId: "x", bankAccountId: "35", billId: "77", amountCents: 1, txnDate: "2026-12-01", note: "" })).toThrow("bad_ref");
    expect(() => billPaymentPayload({ vendorId: "1", bankAccountId: "35", billId: "77", amountCents: 0, txnDate: "2026-12-01", note: "" })).toThrow("bad_amount");
  });
  it("a partly paid bill stays open", () => {
    expect(billState({ Balance: 50, TotalAmt: 100 })).toBe("open");
    expect(billState({ Balance: 0, TotalAmt: 100 })).toBe("paid");
    expect(billState(null)).toBe("unknown");
  });
});
