import { describe, expect, it } from "vitest";
import { addMonths, summarize, termRemaining, timeline, type Portfolio, type PortfolioCustomer } from "@/lib/sales/portfolio";

const base: PortfolioCustomer = {
  key: "k1", business: "Deck Co", email: "d@x.com", plan: "monthly", sub_status: "active", attributed_at: "2027-01-01", first_paid_at: "2027-01-10",
  first_paid_month: "2027-01-01", term_years: 10, basis_cents: 7000, ended: false, cancel_requested_at: null,
  lines: [
    { year_no: 1, kind: "commission", period_month: "2027-01-01", amount_cents: 5000, status: "paid", reason: null, paid_at: "2027-03-01" },
    { year_no: 2, kind: "commission", period_month: "2028-01-01", amount_cents: 7000, status: "pending", reason: null, paid_at: null },
  ],
};

describe("sales 10-year portfolio", () => {
  it("adds months across years", () => {
    expect(addMonths("2027-11-01", 3)).toBe("2028-02-01");
    expect(addMonths("2027-01-01", 12 * 9)).toBe("2036-01-01");
  });

  it("builds a 10-year timeline: real lines, then expected years at today's value (never monthly)", () => {
    const t = timeline(base, "2028-02-01");
    expect(t).toHaveLength(10);
    expect(t.map((x) => x.state).slice(0, 3)).toEqual(["paid", "pending", "projected"]);
    expect(t[2]).toMatchObject({ month: "2029-01-01", cents: 7000, forecast: true });
    expect(t[9].month).toBe("2036-01-01");
    // Each year is one month of value: 2 real + 8 expected = 10 entries, never 12 per year.
    expect(t.filter((x) => x.forecast).length).toBe(8);
  });

  it("marks a passed anniversary without a line as not qualifying and stops forecasting for canceled customers", () => {
    const canceled = { ...base, sub_status: "canceled", lines: [base.lines[0]] };
    const t = timeline(canceled, "2028-06-01");
    expect(t[1]).toMatchObject({ state: "ineligible", cents: 0 });
    expect(t[2]).toMatchObject({ state: "not_expected", cents: 0 });
  });

  it("summarizes the book: earned/pending/paid, history, renewals soon, upgrades and conditional future value", () => {
    const p: Portfolio = { policy_years: 10, current_month: "2028-11-01", customers: [base, { ...base, key: "k2", business: null, email: "free@x.com", first_paid_month: null, first_paid_at: null, lines: [] }] };
    const s = summarize(p);
    expect(s).toMatchObject({ referred: 2, paying: 1, active: 1, canceled: 0, paidCents: 5000, pendingCents: 7000, annualRunCents: 7000 });
    expect(s.expectedFutureCents).toBe(8 * 7000);
    expect(s.history).toEqual([{ year: 2027, cents: 5000, lines: 1 }]);
    expect(s.renewingSoon).toEqual([{ key: "k1", name: "Deck Co", month: "2029-01-01", cents: 7000 }]);
    const down = summarize({ ...p, customers: [{ ...base, basis_cents: 4000 }] });
    expect(down.changed[0]).toMatchObject({ direction: "down", fromCents: 7000, toCents: 4000 });
  });

  it("reports the time left in the term", () => {
    expect(termRemaining(base, "2028-02-01")).toEqual({ years: 7, months: 11, endMonth: "2036-01-01" });
    expect(termRemaining(base, "2037-01-01")).toEqual({ years: 0, months: 0, endMonth: "2036-01-01" });
  });
});
