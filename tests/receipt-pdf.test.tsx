import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { ReceiptPdf, receiptDay, RECEIPT_METHOD, type ReceiptPdfData } from "@/lib/pdf/receipt-pdf";

const base: ReceiptPdfData = {
  kind: "customer",
  company: { name: "Rivera Decks", phone: "555-0100", email: "office@example.test" },
  receipt: { number: "PAY-0003", date: "2026-11-15", method: "check", reference: "1042", amount: "4500.00", memo: null },
  party: { name: "Pat Rivera", address: "1 Main St" },
  project: { name: "Backyard deck", jobNumber: "JOB-0001" },
  appliedTo: [{ label: "Invoice INV-0001", amount: "4000.00", balanceNow: "0.00" }],
  unapplied: "500.00",
};

describe("payment receipt PDF", () => {
  it("formats dates without a timezone shift and names methods plainly", () => {
    expect(receiptDay("2026-11-01")).toBe("November 1, 2026");
    expect(receiptDay("2026-11-01T23:30:00-06:00")).toBe("November 1, 2026");
    expect(receiptDay("")).toBe("");
    expect(RECEIPT_METHOD.ach).toBe("Bank transfer (ACH)");
  });

  it("renders a customer receipt and a vendor payment record", async () => {
    for (const d of [base, { ...base, kind: "vendor" as const, party: { name: "Ace Framing" }, unapplied: null, appliedTo: [{ label: "Bill BILL-0002 (#A-77)", amount: "6500.00", balanceNow: "700.00" }] }]) {
      const buf = await renderToBuffer(createElement(ReceiptPdf, { d }) as unknown as React.ReactElement<DocumentProps>);
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1500);
    }
  }, 30_000);
});
