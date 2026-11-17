import { describe, expect, it } from "vitest";
import { add, cmp, isMoney, lineAmount, money, splitByPercents, splitMixed, sub, sum, taxOn, toMoney } from "@/lib/financials/money";
import { round2, D } from "@/lib/estimate/money";
import { FIN_OWNER_ONLY, FIN_PERMISSION_KEYS, FIN_ROLE_PERMISSIONS, canUseAccountantMode } from "@/lib/financials/permissions";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_KEYS } from "@/lib/enterprise/permissions";

describe("financial money helpers", () => {
  it("never uses binary floats", () => {
    expect(add("0.10", "0.20")).toBe("0.30");
    expect(sum(["19.99", "0.01", "100"])).toBe("120.00");
    expect(sub("100", "33.33")).toBe("66.67");
  });

  it("rounds half away from zero, matching round2 and Postgres round()", () => {
    for (const [x, want] of [["2.345", "2.35"], ["2.344", "2.34"], ["-2.345", "-2.35"], ["0.005", "0.01"], ["-0.005", "-0.01"]] as const) {
      expect(toMoney(x)).toBe(want);
      expect(round2(new D(x)).toFixed(2)).toBe(want);
    }
  });

  it("validates money strings and refuses extra decimals unless asked to round", () => {
    expect(isMoney("1234.50")).toBe(true);
    expect(isMoney("1.234")).toBe(false);
    expect(() => money("1.234")).toThrow(/too_many_decimals/);
    expect(money("1.234", { round: true }).toFixed(2)).toBe("1.23");
    expect(money("$1,234.5").toFixed(2)).toBe("1234.50");
    expect(() => money("abc")).toThrow(/invalid_money/);
    expect(cmp("10.00", "9.99")).toBe(1);
  });

  it("line amounts and tax", () => {
    expect(lineAmount("3", "33.3333")).toBe("100.00");
    expect(lineAmount("1.5", "10.005")).toBe("15.01");
    expect(taxOn("100.00", "8.25")).toBe("8.25");
    expect(taxOn("19.99", "7")).toBe("1.40");
  });

  it("percent splits put the remainder on the last part (sum = total)", () => {
    expect(splitByPercents("40000", ["30", "20", "50"])).toEqual({ parts: ["12000.00", "8000.00", "20000.00"], remainder: "0.00" });
    const r = splitByPercents("1000.00", ["33.3333", "33.3333", "33.3334"]);
    expect(add(...r.parts)).toBe("1000.00");
    expect(r.parts).toEqual(["333.33", "333.33", "333.34"]);
    const odd = splitByPercents("100.00", ["33", "33"]);
    expect(odd).toEqual({ parts: ["33.00", "33.00"], remainder: "34.00" });
  });

  it("mixed fixed/percent splits sum exactly", () => {
    const parts = splitMixed("12345.67", [{ fixed: "1000" }, { percent: "33.3333" }, { percent: "50" }]);
    expect(add(...parts)).toBe("12345.67");
    expect(parts[0]).toBe("1000.00");
  });
});

describe("financial permission mirror", () => {
  it("financial keys are appended to the company catalog in order, grouped, and owner-only where required", () => {
    expect(PERMISSION_KEYS.slice(-FIN_PERMISSION_KEYS.length)).toEqual([...FIN_PERMISSION_KEYS]);
    expect(PERMISSION_GROUPS.find((g) => g.title === "Financials")!.keys).toEqual([...FIN_PERMISSION_KEYS]);
    for (const k of FIN_OWNER_ONLY) expect(OWNER_ONLY_PERMISSIONS).toContain(k);
    expect(FIN_ROLE_PERMISSIONS.financial_admin).not.toContain("manage_financial_seats");
    expect(FIN_ROLE_PERMISSIONS.accountant_readonly.every((k) => k.startsWith("view_") || k === "export_financials")).toBe(true);
  });

  it("Accountant Mode only for accounting permissions", () => {
    expect(canUseAccountantMode(FIN_ROLE_PERMISSIONS.sales_rep)).toBe(false);
    expect(canUseAccountantMode(FIN_ROLE_PERMISSIONS.project_manager)).toBe(false);
    expect(canUseAccountantMode(FIN_ROLE_PERMISSIONS.bookkeeper)).toBe(true);
    expect(canUseAccountantMode(FIN_ROLE_PERMISSIONS.accountant_readonly)).toBe(true);
  });
});
