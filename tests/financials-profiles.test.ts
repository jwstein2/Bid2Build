import { describe, expect, it } from "vitest";
import {
  CARDS, ESSENTIAL_ALERT_KEYS, PRESETS, PRESET_KEYS, QUICK_ACTIONS, REPORTS, ONBOARDING_STEPS, TRADE_PRESET, presetForTrade,
  resolveLayout, resolveProfile, resolveProjectProfile, ROLE_DEFAULT_CARDS, type PresetKey,
} from "@/lib/financials/profiles";
import { FIN_ROLE_PERMISSIONS } from "@/lib/financials/permissions";
import { tradeSeeds } from "@/lib/trades/data";

const ALL = [...FIN_ROLE_PERMISSIONS.owner];

describe("profile presets", () => {
  it("has exactly the 13 presets the database accepts", () => {
    expect(PRESET_KEYS).toHaveLength(13);
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it.each(PRESET_KEYS.map((k) => [k]))("%s resolves to valid cards, actions, reports, cost codes and onboarding", (key) => {
    const p = resolveProfile({ primaryTradeSlug: null, presetKey: key as PresetKey });
    expect(p.presetKey).toBe(key);
    expect(p.cards.length).toBeGreaterThan(0);
    for (const c of p.cards) expect(CARDS[c], c).toBeDefined();
    for (const a of p.quickActions) expect(QUICK_ACTIONS).toContain(a);
    for (const r of p.reports) expect(REPORTS).toContain(r);
    for (const s of p.onboardingSteps) expect(ONBOARDING_STEPS).toContain(s);
    expect(new Set(p.cards).size).toBe(p.cards.length);
    expect(p.onboardingSteps.slice(0, 2)).toEqual(["confirm_trades", "choose_payment_structure"]);
    // The same configuration always gives the same answer.
    expect(resolveProfile({ primaryTradeSlug: null, presetKey: key as PresetKey })).toEqual(p);
  });

  it("every catalog trade slug maps to a preset", () => {
    for (const t of tradeSeeds) expect(TRADE_PRESET[t.slug], t.slug).toBeDefined();
    expect(presetForTrade("roofing")).toBe("roofing_siding");
    expect(presetForTrade("pressure-washing")).toBe("exterior_cleaning");
    expect(presetForTrade("unknown-trade")).toBe("general_contractor");
    expect(presetForTrade(null)).toBe("custom");
  });

  it("trade presets emphasize their own cost codes, using the database's <trade>:<cost_type> codes", () => {
    const roof = resolveProfile({ primaryTradeSlug: "roofing" });
    expect(roof.costCodeSuggestions[0]).toEqual({ code: "roofing:material", tradeSlug: "roofing", costType: "material" });
    const hvac = resolveProfile({ primaryTradeSlug: "hvac" });
    expect(hvac.costCodeSuggestions[0].costType).toBe("equipment");
    expect(hvac.cards).toContain("service_calls_unbilled");
    expect(resolveProfile({ primaryTradeSlug: "pressure-washing" }).paymentStructure).toBe("on_completion");
  });
});

describe("multi-trade and modifiers", () => {
  it("combines presets in order, primary first, without duplicates", () => {
    const p = resolveProfile({ primaryTradeSlug: "decks", additionalTradeSlugs: ["electrical", "roofing", "decks"] });
    expect(p.presets).toEqual(["deck", "electrical", "roofing_siding"]);
    expect(p.trades).toEqual(["decks", "electrical", "roofing"]);
    expect(p.cards).toEqual(expect.arrayContaining(["tm_unbilled", "service_calls_unbilled", "permit_costs"]));
    expect(new Set(p.cards).size).toBe(p.cards.length);
    expect(p.costCodeSuggestions.map((c) => c.tradeSlug)).toEqual(expect.arrayContaining(["decks", "electrical", "roofing", null]));
    expect(p.presetKey).toBe("deck");
  });

  it("commercial market, T&M, subcontract labor, inventory and equipment add their cards", () => {
    const p = resolveProfile({ primaryTradeSlug: "painting", market: "commercial", projectModel: "time_materials", laborModel: "subcontractors", usesInventory: true, usesEquipment: true });
    expect(p.cards).toEqual(expect.arrayContaining(["retainage_placeholder", "tm_unbilled", "subcontractor_costs", "open_commitments", "inventory_usage", "equipment_costs"]));
    expect(p.onboardingSteps).toEqual(expect.arrayContaining(["set_up_commitments", "set_up_inventory", "set_up_equipment"]));
  });
});

describe("project override", () => {
  const company = { primaryTradeSlug: "kitchens", additionalTradeSlugs: ["bathrooms"], market: "residential" as const };

  it("no override = the company profile", () => {
    expect(resolveProjectProfile(company, null)).toEqual(resolveProfile(company));
  });

  it("a project trade/workflow override changes only that project's presentation", () => {
    const p = resolveProjectProfile(company, { primaryTradeSlug: "hvac", workflow: "service" });
    expect(p.presetKey).toBe("hvac");
    expect(p.trades).toEqual(["hvac"]);
    expect(p.projectModel).toBe("service_call");
    expect(p.cards).toContain("service_calls_unbilled");
    const c = resolveProjectProfile(company, { workflow: "commercial", paymentStructure: "progress_sov" });
    expect(c.presetKey).toBe("residential_remodeler");
    expect(c.market).toBe("commercial");
    expect(c.cards).toContain("progress_billing_placeholder");
    // The company configuration itself is unchanged.
    expect(resolveProfile(company).market).toBe("residential");
  });
});

describe("dashboard layout", () => {
  const profile = resolveProfile({ primaryTradeSlug: "roofing" });

  it("role-aware defaults for owner, sales rep, PM, bookkeeper and view-only", () => {
    for (const role of ["owner", "sales_rep", "project_manager", "bookkeeper", "view_only"] as const) {
      const l = resolveLayout({ profile, role, permissions: FIN_ROLE_PERMISSIONS[role] });
      const keys = l.cards.map((c) => c.key);
      const firstRoleCard = ROLE_DEFAULT_CARDS[role].find((k) => CARDS[k].needs.every((n) => FIN_ROLE_PERMISSIONS[role].includes(n)));
      if (firstRoleCard) expect(keys).toContain(firstRoleCard);
      for (const c of l.cards) expect(CARDS[c.key].needs.every((n) => FIN_ROLE_PERMISSIONS[role].includes(n)), `${role}:${c.key}`).toBe(true);
      expect(l.mode).toBe("contractor");
    }
    expect(resolveLayout({ profile, role: "sales_rep", permissions: FIN_ROLE_PERMISSIONS.sales_rep }).cards.map((c) => c.key)).not.toContain("ar_aging");
  });

  it("essential alerts can't be hidden; locked company cards can't be hidden or moved by users", () => {
    const l = resolveLayout({
      profile, role: "owner", permissions: ALL,
      company: { cards: [{ key: "job_profitability" }, { key: "ar_aging" }], locked_cards: ["job_profitability"] },
      user: { cards: [{ key: "ar_aging" }, { key: "job_profitability", visible: false }, { key: "overdue_invoices", visible: false }, { key: "material_costs", visible: false }] },
    });
    const byKey = Object.fromEntries(l.cards.map((c) => [c.key, c]));
    for (const k of ESSENTIAL_ALERT_KEYS) expect(byKey[k]?.visible, k).toBe(true);
    expect(byKey.job_profitability).toMatchObject({ visible: true, locked: true });
    expect(byKey.material_costs.visible).toBe(false);
    // The locked card keeps its company position (first), the user moved ar_aging ahead of everything else.
    expect(l.cards[0].key).toBe("job_profitability");
    expect(l.cards[1].key).toBe("ar_aging");
  });

  it("user preferences: card order, KPIs, saved views, collapsed sections; restore defaults = no user layer", () => {
    const user = { cards: [{ key: "material_costs" }], kpis: ["collected", "bogus"], saved_views: [{ name: "Roofs", filters: { trades: ["roofing"] } }], collapsed_sections: ["costs"] };
    const l = resolveLayout({ profile, role: "owner", permissions: ALL, user });
    expect(l.cards[0].key).toBe("material_costs");
    expect(l.kpis).toEqual(["collected"]);
    expect(l.savedViews).toHaveLength(1);
    expect(l.collapsedSections).toEqual(["costs"]);
    const reset = resolveLayout({ profile, role: "owner", permissions: ALL });
    expect(reset.cards[0].key).toBe(ESSENTIAL_ALERT_KEYS[0]);
    expect(reset.kpis).toEqual(["contract_value", "collected", "ar_outstanding", "projected_margin"]);
  });

  it("Accountant Mode only when authorized; it adds the accounting cards", () => {
    const pm = resolveLayout({ profile, role: "project_manager", permissions: FIN_ROLE_PERMISSIONS.project_manager, mode: "accountant" });
    expect(pm.mode).toBe("contractor");
    const acct = resolveLayout({ profile, role: "accountant", permissions: FIN_ROLE_PERMISSIONS.accountant, mode: "accountant" });
    expect(acct.mode).toBe("accountant");
    expect(acct.cards.map((c) => c.key)).toEqual(expect.arrayContaining(["export_center", "audit_trail"]));
    expect(resolveLayout({ profile, role: "accountant", permissions: FIN_ROLE_PERMISSIONS.accountant }).cards.map((c) => c.key)).not.toContain("export_center");
  });

  it("profiles never change permissions: the same role sees the same permission-gated cards whatever the trade", () => {
    const gated = (t: string) => resolveLayout({ profile: resolveProfile({ primaryTradeSlug: t }), role: "sales_rep", permissions: FIN_ROLE_PERMISSIONS.sales_rep })
      .cards.filter((c) => CARDS[c.key].needs.includes("view_company_financials"));
    expect(gated("roofing")).toEqual([]);
    expect(gated("commercial-remodeling")).toEqual([]);
  });
});
