import { describe, expect, it } from "vitest";
import { ENTERPRISE_SEAT_TIERS, enterpriseMonthlyCents, enterpriseQuote, formatCents, nextSeatCents } from "../src/lib/enterprise/pricing";
import { effectivePermissions, ROLE_PERMISSIONS } from "../src/lib/enterprise/permissions";

describe("Enterprise seat pricing", () => {
  it.each([
    [1, 4999], [2, 4999], [3, 4999],
    [4, 6998], [5, 8997], [6, 10796], [10, 17992], [11, 19591],
    [25, 41977], [50, 81952], [100, 161902], [200, 321802],
  ])("%i users -> %i cents/month (spec table)", (users, cents) => {
    expect(enterpriseMonthlyCents(users)).toBe(cents);
  });

  it("200 users annualize to $38,616.24", () => {
    expect(formatCents(enterpriseQuote(200).annualizedCents)).toBe("$38,616.24");
  });

  it("each tier only discounts the seats inside it", () => {
    expect(nextSeatCents(3)).toBe(1999); // user 4
    expect(nextSeatCents(4)).toBe(1999); // user 5
    expect(nextSeatCents(5)).toBe(1799); // user 6
    expect(nextSeatCents(9)).toBe(1799); // user 10
    expect(nextSeatCents(10)).toBe(1599); // user 11
    expect(nextSeatCents(199)).toBe(1599);
  });

  it("itemizes the bill", () => {
    const q = enterpriseQuote(25);
    expect(q.lines.map((l) => [l.label, l.users, l.totalCents])).toEqual([
      ["Enterprise base (includes 3 users)", 3, 4999],
      ["Users 4-5", 2, 3998],
      ["Users 6-10", 5, 8995],
      ["Users 11-25", 15, 23985],
    ]);
    expect(q.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(q.monthlyCents);
  });

  it("matches a Stripe-style graduated tier evaluation of the extra-seat quantity", () => {
    const stripeGraduated = (qty: number) => {
      let total = 0;
      let prev = 0;
      for (const t of ENTERPRISE_SEAT_TIERS) {
        const upTo = t.upTo ?? Infinity;
        if (qty > prev) total += (Math.min(qty, upTo) - prev) * t.unitCents;
        prev = upTo;
      }
      return total;
    };
    for (let users = 1; users <= 400; users++) {
      expect(enterpriseMonthlyCents(users)).toBe(4999 + stripeGraduated(Math.max(0, users - 3)));
    }
  });

  it("rejects nonsense headcounts", () => {
    expect(() => enterpriseQuote(0)).toThrow(RangeError);
    expect(() => enterpriseQuote(2.5)).toThrow(RangeError);
    expect(() => enterpriseQuote(Number.NaN)).toThrow(RangeError);
  });

  it("formats cents without float error", () => {
    expect(formatCents(161902)).toBe("$1,619.02");
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("Enterprise permissions mirror", () => {
  it("owner holds everything regardless of revocations", () => {
    expect(effectivePermissions("owner", [], ["manage_billing"])).toContain("manage_billing");
  });
  it("grants add and revocations remove", () => {
    const p = effectivePermissions("estimator", ["view_margin"], ["view_costs"]);
    expect(p).toContain("view_margin");
    expect(p).not.toContain("view_costs");
  });
  it("no role but owner gets billing by default", () => {
    for (const r of ["manager", "estimator", "viewer"] as const) expect(ROLE_PERMISSIONS[r]).not.toContain("manage_billing");
  });
});
