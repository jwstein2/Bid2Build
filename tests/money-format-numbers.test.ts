import { describe, expect, it } from "vitest";
import { D, formatCurrency } from "@/lib/estimate/money";
import { arTotals, type ArRow } from "@/lib/financials/receivables";

// Supabase returns Postgres numeric columns as JSON numbers: the receivables page crashed on
// formatCurrency(26070) in production (2026-11-17). Every money helper must take numbers too.
describe("money formatting accepts database numbers", () => {
  it("formats numbers, strings, Decimals and empty values", () => {
    expect(formatCurrency(26070)).toBe("$26,070.00");
    expect(formatCurrency(150.5)).toBe("$150.50");
    expect(formatCurrency(0.1 + 0.2)).toBe("$0.30");
    expect(formatCurrency(-12.345)).toBe("-$12.35");
    expect(formatCurrency("1234.5")).toBe("$1,234.50");
    expect(formatCurrency(new D("99.999"))).toBe("$100.00");
    expect(formatCurrency(null)).toBe("$0.00");
    expect(formatCurrency(undefined)).toBe("$0.00");
    expect(formatCurrency("")).toBe("$0.00");
    expect(formatCurrency(26070.4, { cents: false })).toBe("$26,070");
  });

  it("AR totals work on rows whose amounts are numbers", () => {
    const row = { invoice_id: "i", job_id: "j", job_number: "JOB-1", job_name: "Deck", number: "INV-0001", issue_date: "2026-11-01", due_date: "2026-11-30", total: 26070, paid: 0, credited: 0, balance: 26070, aging_bucket: "current", days_overdue: 0 } as unknown as ArRow;
    const t = arTotals([row], "2026-11-17", "2026-12-01");
    expect(t.outstanding).toBe("26070.00");
    expect(formatCurrency(row.total)).toBe("$26,070.00");
  });
});
