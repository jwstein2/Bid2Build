import { describe, expect, it } from "vitest";
import { commissionBasis, projectedCommissions, type BasisItem } from "@/lib/sales/basis";
import { decodeRepCookie, encodeRepCookie, normalizeRepCode, repLandingPath, repLink } from "@/lib/sales/link";
import { captureAttribution } from "@/lib/growth/attribution";

const P = { monthly: "price_m", annual: "price_a", enterpriseBase: "price_eb", enterpriseSeat: "price_es", monthlyListCents: 1999 };
const month = { interval: "month", interval_count: 1 };
const year = { interval: "year", interval_count: 1 };
const item = (id: string, unit: number | null, recurring = month, quantity = 1): BasisItem => ({ quantity, price: { id, unit_amount: unit, recurring } });

describe("commission basis", () => {
  it("monthly Unlimited is one month of the plan", () => {
    expect(commissionBasis([item("price_m", 1999)], { annual_basis: "divide_12", value_scope: "plan_seats" }, P).cents).toBe(1999);
  });
  it("annual Unlimited follows the owner's annual rule", () => {
    const items = [item("price_a", 14900, year)];
    expect(commissionBasis(items, { annual_basis: "divide_12", value_scope: "plan_seats" }, P).cents).toBe(1242);
    expect(commissionBasis(items, { annual_basis: "monthly_list", value_scope: "plan_seats" }, P).cents).toBe(1999);
    expect(commissionBasis(items, { annual_basis: "full_payment", value_scope: "plan_seats" }, P).cents).toBe(14900);
  });
  it("Enterprise counts base + graduated seats; add-ons only when the policy says so", () => {
    const items = [item("price_eb", 4999), item("price_es", null, month, 3), item("price_pm", 499)];
    // 6 users: 4999 + 2*1999 + 1*1799
    expect(commissionBasis(items, { annual_basis: "divide_12", value_scope: "plan_seats" }, P).cents).toBe(4999 + 2 * 1999 + 1799);
    expect(commissionBasis(items, { annual_basis: "divide_12", value_scope: "all_items" }, P).cents).toBe(4999 + 2 * 1999 + 1799 + 499);
    expect(commissionBasis(items, { annual_basis: "divide_12", value_scope: "base_plan" }, P).cents).toBe(4999);
  });
  it("skips one-off and zero-quantity items and records every line", () => {
    const b = commissionBasis([item("price_m", 1999), { quantity: 1, price: { id: "price_once", unit_amount: 500, recurring: null } }, item("price_pm", 499, month, 0)], { annual_basis: "divide_12", value_scope: "all_items" }, P);
    expect(b.cents).toBe(1999);
    expect(b.lines).toHaveLength(1);
  });
  it("projects only future anniversaries inside the term", () => {
    expect(projectedCommissions("2026-03-01", 1999, 3, "2026-11-01")).toEqual([{ month: "2027-03-01", cents: 1999 }, { month: "2028-03-01", cents: 1999 }]);
    expect(projectedCommissions("2024-03-01", 1999, 3, "2026-11-01")).toEqual([]);
    expect(projectedCommissions(null, 1999, 3, "2026-11-01")).toEqual([]);
  });
});

describe("rep links", () => {
  it("normalizes codes and builds the short link and landing path", () => {
    expect(normalizeRepCode(" ab3de7gh ")).toBe("AB3DE7GH");
    expect(normalizeRepCode("AB-3")).toBeNull();
    expect(normalizeRepCode("ABCDEF0O")).toBeNull(); // 0 and O never appear in codes
    expect(repLink("AB3DE7GH", "https://built2bid.org")).toBe("https://built2bid.org/s/AB3DE7GH");
    expect(repLandingPath("AB3DE7GH")).toBe("/?utm_source=sales_rep&utm_medium=referral&utm_campaign=sales_team&utm_content=AB3DE7GH");
    expect(repLandingPath("AB3DE7GH", "/pricing")).toMatch(/^\/pricing\?/);
    expect(repLandingPath("AB3DE7GH", "//evil.com")).toMatch(/^\/\?/);
    expect(repLandingPath("AB3DE7GH", "https://evil.com")).toMatch(/^\/\?/);
  });
  it("round-trips the cookie and rejects junk", () => {
    const at = new Date("2026-11-19T00:00:00Z");
    expect(decodeRepCookie(encodeRepCookie("AB3DE7GH", at))).toEqual({ code: "AB3DE7GH", visitAt: at });
    expect(decodeRepCookie("AB3DE7GH")).toEqual({ code: "AB3DE7GH", visitAt: null });
    expect(decodeRepCookie("<script>")).toBeNull();
    expect(decodeRepCookie("x".repeat(50))).toBeNull();
  });
  it("the /s/<code> hop is not recorded as a first-touch landing page", () => {
    expect(captureAttribution(new URL("https://built2bid.org/s/AB3DE7GH"), null, null)).toBeNull();
    expect(captureAttribution(new URL("https://built2bid.org/sales"), "https://google.com/", null)).toBeNull();
    expect(captureAttribution(new URL("https://built2bid.org/?utm_source=sales_rep&utm_content=AB3DE7GH"), null, null)?.source).toBe("sales_rep");
  });
});

import { parseLeadRows } from "@/lib/sales/crm";
describe("lead import parsing", () => {
  it("reads CSV and tab rows, skips headers and blank names, splits trades", () => {
    const rows = parseLeadRows('company,contact\n"Summit Roofing, LLC",Dana,dana@x.com,612,summit.com,Minneapolis,MN,55401,roofing;siding\n\t\nBright Deck\tJo\t\t\t\t\t\t55102\tdecks');
    expect(rows).toEqual([
      { company_name: "Summit Roofing, LLC", contact_name: "Dana", email: "dana@x.com", phone: "612", website: "summit.com", city: "Minneapolis", state: "MN", zip: "55401", trades: ["roofing", "siding"] },
      { company_name: "Bright Deck", contact_name: "Jo", zip: "55102", trades: ["decks"] },
    ]);
  });
});
