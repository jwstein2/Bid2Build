import { describe, expect, it } from "vitest";
import { invoiceSendInfo } from "@/lib/financials/send-state";

const inv = (o: Record<string, unknown> = {}) => ({ status: "issued", balance: 500, paid: 0, credited: 0, ...o });

describe("invoice send state", () => {
  it("draft and void", () => {
    expect(invoiceSendInfo(inv({ status: "draft" }), [], null).state).toBe("draft");
    expect(invoiceSendInfo(inv({ status: "void" }), [{ status: "sent", sent_at: "2026-11-01" }], null).state).toBe("void");
  });
  it("issued with nothing sent", () => {
    expect(invoiceSendInfo(inv(), [{ status: "canceled", created_at: "2026-11-02" }], null)).toMatchObject({ state: "issued", step: "issued" });
  });
  it("email prepared, failed, sent", () => {
    expect(invoiceSendInfo(inv(), [{ status: "awaiting_review", created_at: "2026-11-02" }], null).state).toBe("email_prepared");
    expect(invoiceSendInfo(inv(), [{ status: "failed", created_at: "2026-11-03" }, { status: "draft", created_at: "2026-11-02" }], null).state).toBe("email_failed");
    expect(invoiceSendInfo(inv(), [{ status: "draft", created_at: "2026-11-05" }, { status: "delivered", sent_at: "2026-11-03T10:00:00Z", created_at: "2026-11-02" }], null))
      .toMatchObject({ state: "sent", via: "built2bid", at: "2026-11-03T10:00:00Z" });
  });
  it("marked as sent outside Built2Bid", () => {
    expect(invoiceSendInfo(inv(), [], { method: "printed", sent_on: "2026-11-04" })).toMatchObject({ state: "sent", via: "printed", at: "2026-11-04", marked: true });
  });
  it("partly paid and paid (numbers or strings, as PostgREST returns numbers)", () => {
    expect(invoiceSendInfo(inv({ paid: 100, balance: 400 }), [], { method: "own_email", sent_on: "2026-11-04" })).toMatchObject({ state: "sent", partlyPaid: true });
    expect(invoiceSendInfo(inv({ paid: "500.00", balance: "0.00" }), [], null)).toMatchObject({ state: "paid", step: "paid" });
    expect(invoiceSendInfo(inv({ paid: 0, credited: 0, balance: 0 }), [], null).state).toBe("issued");
  });
});
