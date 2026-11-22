import { describe, expect, it } from "vitest";
import { phoneHalfWidth } from "@/lib/dashboard/phone";
import type { WidgetInstance } from "@/lib/dashboard/schema";

const w = (id: string, type: string, width = 1, h = 1, settings: Record<string, unknown> = {}) => ({ id, type, w: width, h, settings }) as unknown as WidgetInstance;

describe("phone two-up KPI tiles", () => {
  it("pairs single-number cards and keeps lists, charts and quick actions full width", () => {
    const out = phoneHalfWidth([w("qa", "quick_actions", 2), w("a", "sales_awaiting"), w("b", "pm_active"), w("c", "fin_revenue"), w("d", "customers"), w("up", "pm_upcoming", 2)], false);
    expect([...out].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("keeps cards that preview records full width on phones", () => {
    const out = phoneHalfWidth([w("a", "fin_ar"), w("b", "fin_cash_received"), w("c", "sales_drafts"), w("d", "sales_win_rate")], false);
    expect(out.size).toBe(0);
  });
  it("lets a lone card before a full-width widget span the row (no gaps)", () => {
    const out = phoneHalfWidth([w("a", "sales_awaiting"), w("b", "pm_active"), w("c", "customers"), w("list", "sales_recent", 2)], false);
    expect([...out].sort()).toEqual(["a", "b"]);
  });
  it("keeps receivables tables, wide or tall cards and editing mode full width", () => {
    expect(phoneHalfWidth([w("t", "fin_ar", 1, 1, { view: "table" }), w("x", "fin_ar", 1, 1, { view: "table" })], false).size).toBe(0);
    expect(phoneHalfWidth([w("a", "fin_ap", 2), w("b", "fin_ap", 2)], false).size).toBe(0);
    expect(phoneHalfWidth([w("a", "fin_ap"), w("b", "fin_ap")], true).size).toBe(0);
  });
});
