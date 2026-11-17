import { describe, expect, it } from "vitest";
import { TEMPLATE_KINDS, TONES, fieldsHash, paymentStatusSentence, render, scheduleLines, type EmailFacts } from "@/lib/financials/emails";

const base: EmailFacts = {
  customerName: "Pat Rivera", companyName: "Acme Decks", senderName: "Sam", projectName: "Backyard deck", invoiceNumber: "INV-0001",
  amountDue: "12000", dueDate: "2026-12-01", milestone: "Framing complete", balance: "28000", contractTotal: "40000",
  schedule: [{ label: "Deposit", percent: "30" }, { label: "Framing", percent: "20" }, { label: "Completion", percent: "50" }],
  payment: { amount: "12000", date: "2026-12-02", method: "check", verified: false }, creditAmount: "250", changeOrder: "Change order #1: Stairs",
};

describe("financial email renderer", () => {
  it("30/20/50 on $40,000 = 12,000 / 8,000 / 20,000", () => {
    expect(scheduleLines("40000", base.schedule!).map((l) => l.amount)).toEqual(["12000.00", "8000.00", "20000.00"]);
    const e = render("deposit", "professional", base);
    expect(e.body).toContain("Deposit (30%): $12,000.00");
    expect(e.body).toContain("Framing (20%): $8,000.00");
    expect(e.body).toContain("Completion (50%): $20,000.00");
    expect(e.subject).toBe("Deposit invoice INV-0001 - Backyard deck");
    expect(e.body).toContain("December 1, 2026");
  });

  it("an unverified manual payment is 'recorded', never confirmed by a bank", () => {
    for (const kind of ["receipt", "partial_payment", "final_thanks"] as const) for (const tone of TONES) {
      const e = render(kind, tone, base);
      expect(e.body).toContain("We've recorded your payment of $12,000.00");
      expect(e.body.toLowerCase()).not.toMatch(/confirmed by (the|your) bank|bank confirmed|cleared/);
    }
    expect(paymentStatusSentence({ ...base.payment!, verified: true })).toBe("We've received your payment of $12,000.00 on December 2, 2026.");
  });

  it("every kind and tone renders without leftover placeholders and deterministically", () => {
    for (const kind of TEMPLATE_KINDS) for (const tone of TONES) {
      const a = render(kind, tone, base);
      expect(a.body, `${kind}/${tone}`).not.toMatch(/\{[a-z_]+\}/);
      expect(a.subject).not.toMatch(/\{[a-z_]+\}/);
      expect(render(kind, tone, base)).toEqual(a);
    }
  });

  it("company overrides replace the default wording", () => {
    const e = render("progress", "brief", base, { subject: "Bill {invoice_number}", body: "Due {amount_due} by {due_date}." });
    expect(e).toMatchObject({ subject: "Bill INV-0001", body: "Due $12,000.00 by December 1, 2026." });
  });

  it("the fields hash changes when a financial fact changes (stale drafts), not when wording/tone changes", () => {
    const h = fieldsHash("progress", base);
    expect(render("progress", "friendly", base).fieldsHash).toBe(h);
    expect(render("progress", "brief", base).fieldsHash).toBe(h);
    expect(fieldsHash("progress", { ...base, amountDue: "12000.01" })).not.toBe(h);
    expect(fieldsHash("progress", { ...base, dueDate: "2026-12-02" })).not.toBe(h);
    expect(fieldsHash("progress", { ...base, payment: { ...base.payment!, verified: true } })).not.toBe(h);
    expect(fieldsHash("progress", { ...base, amountDue: "12000.00" })).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
