import { describe, expect, it } from "vitest";
import { arPreview, arStatus, customerHref, decidedPreview, draftPreview, invoiceHref, paymentStatus, previewCount } from "@/lib/dashboard/previews";
import type { ArRow } from "@/lib/financials/receivables";
import type { Column } from "@/lib/pipeline/board";

const inv = (id: string, days: number, balance: string, due = "2026-12-01") => ({ invoice_id: id, days_overdue: days, balance, due_date: due }) as unknown as ArRow;
const bid = (id: string, column: Column, updatedAt: string, stageAt: string | null = null) => ({ id, column, updatedAt, stageAt, createdAt: "2026-01-01T00:00:00Z" });

describe("Home card previews", () => {
  it("shows three records, four on a tall card", () => {
    expect(previewCount(false)).toBe(3);
    expect(previewCount(true)).toBe(4);
  });

  it("orders receivables: overdue first, then most days overdue, then largest balance", () => {
    const rows = [inv("cur-big", 0, "9000"), inv("od-5", 5, "100"), inv("od-30-small", 30, "50"), inv("od-30-big", 30, "5000"), inv("cur-small", 0, "10")];
    expect(arPreview(rows, 3).map((r) => r.invoice_id)).toEqual(["od-30-big", "od-30-small", "od-5"]);
    expect(arPreview(rows, 10).map((r) => r.invoice_id)).toEqual(["od-30-big", "od-30-small", "od-5", "cur-big", "cur-small"]);
    expect(rows[0].invoice_id).toBe("cur-big"); // input untouched
  });

  it("labels invoice status", () => {
    expect(arStatus({ days_overdue: 3, due_date: "2026-11-01" }, "2026-11-22", "2026-12-06").text).toBe("Overdue");
    expect(arStatus({ days_overdue: 0, due_date: "2026-11-30" }, "2026-11-22", "2026-12-06").text).toBe("Due soon");
    expect(arStatus({ days_overdue: 0, due_date: "2027-01-30" }, "2026-11-22", "2026-12-06").text).toBe("Current");
  });

  it("lists drafts by last edit and nothing else", () => {
    const bids = [bid("a", "draft", "2026-11-01"), bid("b", "sent", "2026-11-21"), bid("c", "draft", "2026-11-20"), bid("d", "draft", "2026-10-01")];
    expect(draftPreview(bids, 3).map((b) => b.id)).toEqual(["c", "a", "d"]);
  });

  it("lists decided bids (won stages and lost) by decision time", () => {
    const bids = [bid("w", "won", "2026-11-01", "2026-11-02"), bid("l", "lost", "2026-11-10"), bid("s", "scheduled", "2026-11-05", "2026-11-15"), bid("d", "draft", "2026-11-21"), bid("x", "awaiting", "2026-11-20")];
    expect(decidedPreview(bids, 3).map((b) => b.id)).toEqual(["s", "l", "w"]);
  });

  it("shows refunds on verified payments", () => {
    expect(paymentStatus({ amount: "100.00", refunded: "0" }).text).toBe("Verified");
    expect(paymentStatus({ amount: "100.00", refunded: "40.00" }).text).toBe("Part refunded");
    expect(paymentStatus({ amount: "100.00", refunded: "100.00" }).text).toBe("Refunded");
  });
});

describe("record links on preview rows", () => {
  it("links a customer only when the record has a real customer id", () => {
    expect(customerHref("0b7d0c1e-1111-4a2b-9c3d-123456789abc")).toBe("/dashboard/customers/0b7d0c1e-1111-4a2b-9c3d-123456789abc");
    expect(customerHref(null)).toBeUndefined();
    expect(customerHref("")).toBeUndefined();
    expect(customerHref("../admin")).toBeUndefined();
  });
  it("opens one invoice on its job", () => {
    expect(invoiceHref("e1", "i9")).toBe("/financials/jobs/e1#invoice-i9");
  });
});
