import { describe, expect, it } from "vitest";
import { billPayload, billState, displayName, isDuplicateName, qbQuote, vendorPayload } from "@/lib/quickbooks/payout-bills";

describe("QuickBooks payout vendors", () => {
  it("cleans display names and keeps them within 100 characters", () => {
    expect(displayName("Pat: Smith\tJr")).toBe("Pat Smith Jr");
    expect(displayName("   ")).toBe("Built2Bid payee");
    expect(displayName("x".repeat(120), " (Built2Bid)")).toHaveLength(100);
    expect(displayName("x".repeat(120), " (Built2Bid)").endsWith(" (Built2Bid)")).toBe(true);
  });
  it("quotes query values", () => {
    expect(qbQuote("O'Brien \\ Co")).toBe("'O\\'Brien \\\\ Co'");
  });
  it("builds a 1099 vendor with contact details only", () => {
    const v = vendorPayload({ payeeName: "Pat Smith", givenName: "Pat", familyName: "Smith", email: "pat@example.com", phone: "555-0100", line1: "1 Main St", city: "Rochester", state: "MN", postalCode: "55901" });
    expect(v).toMatchObject({ DisplayName: "Pat Smith", GivenName: "Pat", FamilyName: "Smith", Vendor1099: true, PrimaryEmailAddr: { Address: "pat@example.com" } });
    expect(v.BillAddr).toMatchObject({ Line1: "1 Main St", City: "Rochester", CountrySubDivisionCode: "MN", PostalCode: "55901", Country: "US" });
    expect(JSON.stringify(v)).not.toMatch(/TaxIdentifier|AcctNum|Bank/);
  });
  it("drops a bad email and empty address", () => {
    const v = vendorPayload({ payeeName: "Lee", email: "not-an-email" });
    expect(v.PrimaryEmailAddr).toBeUndefined();
    expect(v.BillAddr).toBeUndefined();
  });
  it("spots QuickBooks duplicate-name errors", () => {
    expect(isDuplicateName("Duplicate Name Exists Error: The name supplied already exists.")).toBe(true);
    expect(isDuplicateName("Error 6240")).toBe(true);
    expect(isDuplicateName("Invalid date")).toBe(false);
  });
});

describe("QuickBooks payout bills", () => {
  const base = { vendorId: "56", accountId: "7", amountCents: 123456, docNumber: "B2B-S2611-ABCDEF12", description: "Sales commission statement Nov 2026", txnDate: "2026-11-21" };
  it("books the amount to the chosen expense account", () => {
    const b = billPayload(base) as { VendorRef: { value: string }; DocNumber: string; Line: { Amount: number; AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }[] };
    expect(b.VendorRef.value).toBe("56");
    expect(b.DocNumber).toBe("B2B-S2611-ABCDEF12");
    expect(b.Line).toHaveLength(1);
    expect(b.Line[0].Amount).toBe(1234.56);
    expect(b.Line[0].AccountBasedExpenseLineDetail.AccountRef.value).toBe("7");
  });
  it("refuses bad ids, amounts and dates", () => {
    expect(() => billPayload({ ...base, vendorId: "x" })).toThrow();
    expect(() => billPayload({ ...base, amountCents: 0 })).toThrow();
    expect(() => billPayload({ ...base, amountCents: 1.5 })).toThrow();
    expect(() => billPayload({ ...base, txnDate: "11/21/2026" })).toThrow();
  });
  it("reads paid and open bills", () => {
    expect(billState({ Balance: 0, TotalAmt: 50 })).toBe("paid");
    expect(billState({ Balance: "0.00" })).toBe("paid");
    expect(billState({ Balance: 12.5 })).toBe("open");
    expect(billState(null)).toBe("unknown");
    expect(billState({})).toBe("unknown");
  });
});
