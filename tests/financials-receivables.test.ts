import { describe, expect, it } from "vitest";
import { arTotals, collectedIn, filterAr, nextAction, unappliedTotal, type ArRow, type PayRow } from "@/lib/financials/receivables";

const row = (o: Partial<ArRow>): ArRow => ({
  invoice_id: "i", job_id: "j1", estimate_id: "e1", job_number: "JOB-0001", job_name: "Kitchen", customer_id: "c1", customer_name: "Pat",
  number: "INV-0001", kind: "milestone", status: "issued", issue_date: "2026-10-01", due_date: "2026-11-30", total: "0", paid: "0", credited: "0",
  balance: "0", days_overdue: 0, aging_bucket: "current", sales_rep_id: null, project_manager_id: null, ...o,
});
const TODAY = "2026-11-17", SOON = "2026-12-01";

// The V5.1 $45,000 fixture: deposit + framing paid, installation issued and unpaid, final not invoiced (no row).
const FIXTURE: ArRow[] = [
  row({ invoice_id: "a", number: "INV-0001", total: "4500.00", paid: "4500.00", balance: "0.00", aging_bucket: "paid" }),
  row({ invoice_id: "b", number: "INV-0002", total: "13500.00", paid: "13500.00", balance: "0.00", aging_bucket: "paid" }),
  row({ invoice_id: "c", number: "INV-0003", total: "18000.00", balance: "18000.00", due_date: "2026-11-25" }),
];

describe("accounts receivable math", () => {
  it("V5.1 fixture: AR is only the unpaid issued invoice; the unbilled milestone never counts", () => {
    const t = arTotals(FIXTURE, TODAY, SOON);
    expect(t.outstanding).toBe("18000.00");
    expect(t.buckets.current).toBe("18000.00");
    expect(t.overdue).toBe("0.00");
    expect(t.openCount).toBe(1);
    expect(t.dueSoon).toBe("18000.00");
  });

  it("aging buckets add up to the outstanding total, to the cent", () => {
    const rows = [
      row({ invoice_id: "1", balance: "100.10", aging_bucket: "current" }),
      row({ invoice_id: "2", balance: "200.20", aging_bucket: "1_30", days_overdue: 5, due_date: "2026-11-12" }),
      row({ invoice_id: "3", balance: "300.30", aging_bucket: "31_60", days_overdue: 40 }),
      row({ invoice_id: "4", balance: "0.01", aging_bucket: "61_90", days_overdue: 70 }),
      row({ invoice_id: "5", balance: "999.99", aging_bucket: "over_90", days_overdue: 120 }),
    ];
    const t = arTotals(rows, TODAY, SOON);
    expect(t.outstanding).toBe("1600.60");
    expect(t.overdue).toBe("1500.50");
    expect(Object.values(t.buckets).reduce((s, v) => s + Math.round(Number(v) * 100), 0)).toBe(160060);
  });

  it("filters: bucket, customer, job, rep, PM, due-date range and search; partial payments stay open", () => {
    const rows = [
      row({ invoice_id: "1", balance: "50.00", paid: "50.00", customer_id: "c1", sales_rep_id: "r1" }),
      row({ invoice_id: "2", balance: "10.00", customer_id: "c2", job_id: "j2", project_manager_id: "p1", days_overdue: 3, aging_bucket: "1_30", due_date: "2026-11-14", number: "INV-0099" }),
      row({ invoice_id: "3", balance: "0.00", customer_id: "c1", aging_bucket: "paid" }),
    ];
    const ids = (f: Parameters<typeof filterAr>[1]) => filterAr(rows, f, TODAY, SOON).map((r) => r.invoice_id);
    expect(ids({})).toEqual(["1", "2"]);
    expect(ids({ bucket: "paid" })).toEqual(["3"]);
    expect(ids({ bucket: "all" })).toEqual(["1", "2", "3"]);
    expect(ids({ bucket: "overdue" })).toEqual(["2"]);
    expect(ids({ bucket: "1_30" })).toEqual(["2"]);
    expect(ids({ customer: "c1" })).toEqual(["1"]);
    expect(ids({ job: "j2" })).toEqual(["2"]);
    expect(ids({ rep: "r1" })).toEqual(["1"]);
    expect(ids({ pm: "p1" })).toEqual(["2"]);
    expect(ids({ from: "2026-11-20" })).toEqual(["1"]);
    expect(ids({ q: "0099" })).toEqual(["2"]);
    expect(nextAction(rows[0])).toBe("Partial payment received");
    expect(nextAction(rows[1])).toBe("Send a reminder");
  });

  it("collected in a period is cash received net of refunds; voids don't count", () => {
    const pays: PayRow[] = [
      { payment_id: "1", received_on: "2026-11-02", amount: "1000.00", refunded: "100.00", unapplied: "0", status: "active", customer_id: null, job_id: null },
      { payment_id: "2", received_on: "2026-10-30", amount: "500.00", refunded: "0", unapplied: "200.00", status: "active", customer_id: null, job_id: null },
      { payment_id: "3", received_on: "2026-11-05", amount: "700.00", refunded: "0", unapplied: "0", status: "void", customer_id: null, job_id: null },
    ];
    expect(collectedIn(pays, "2026-11-01", "2026-11-30")).toBe("900.00");
    expect(unappliedTotal(pays)).toBe("200.00");
  });
});

import { buildLedger } from "@/lib/financials/ledger";
describe("customer ledger", () => {
  it("running balance: invoices add, payments and credits subtract, voids don't move it, refunds add back", () => {
    const { lines, balance } = buildLedger({
      invoices: [
        { id: "1", number: "INV-0001", issue_date: "2026-10-01", total: "4500.00", status: "issued" },
        { id: "2", number: "INV-0002", issue_date: "2026-10-15", total: "13500.00", status: "issued" },
        { id: "3", number: "INV-0003", issue_date: "2026-11-01", total: "18000.00", status: "issued" },
        { id: "4", number: "INV-0004", issue_date: "2026-11-02", total: "99.00", status: "void" },
      ],
      payments: [
        { id: "a", number: "PMT-0001", received_on: "2026-10-03", amount: "4500.00", refunded: "0", status: "active", method: "check" },
        { id: "b", number: "PMT-0002", received_on: "2026-10-20", amount: "14000.00", refunded: "500.00", status: "active", method: "ach" },
        { id: "c", number: "PMT-0003", received_on: "2026-11-03", amount: "1.00", refunded: "0", status: "void", method: "cash" },
      ],
      credits: [{ id: "x", number: "CM-0001", issue_date: "2026-11-05", amount: "250.00", refunded: "0", status: "issued" }],
    });
    expect(balance).toBe("17750.00");   // 36,000 invoiced - 18,000 net paid - 250 credit
    expect(lines.find((l) => l.ref === "INV-0004")?.voided).toBe(true);
    expect(lines.map((l) => l.kind)).toEqual(["invoice", "payment", "invoice", "payment", "refund", "invoice", "invoice", "payment", "credit"]);
  });
});

import { arDates } from "@/lib/financials/receivables";
describe("AR date windows", () => {
  it("this month, last month (across a year boundary) and this year", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(arDates("month", now)).toMatchObject({ today: "2026-01-10", soon: "2026-01-24", from: "2026-01-01", to: "2026-01-10" });
    expect(arDates("last_month", now)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(arDates("year", now)).toMatchObject({ from: "2026-01-01", to: "2026-01-10" });
  });
});
