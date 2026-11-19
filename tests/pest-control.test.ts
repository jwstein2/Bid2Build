import { describe, expect, it } from "vitest";
import { getTrade } from "@/lib/trades/catalog";
import { ruleExclusions } from "@/lib/proposal/generate-rules";
import { tradeGroup } from "@/lib/features/page-guides";
import { TRADE_MODELS } from "@/lib/market/trade-models";
import { startersFor } from "@/lib/library/assemblies";
import { classify } from "@/lib/radar/classify";
import { calculatorsFor } from "@/lib/calculators/mapping";
import { presetForTrade } from "@/lib/financials/profiles/presets";

const bid = (items: string[]) => ({
  tradeSlugs: ["pest-control"], projectTitle: "Home pest service", scope: "", notes: "", style: "professional" as const,
  groups: [{ name: "Work", description: "", items: items.map((name) => ({ name, description: "", kind: "labor" })) }],
});

describe("pest control trade", () => {
  it("is in the catalog with a template, guide family, market model, preset and starter assembly", () => {
    const t = getTrade("pest-control")!;
    expect(t.name).toBe("Pest Control");
    expect(t.icon).toBe("Bug");
    expect(t.template.groups.length).toBeGreaterThanOrEqual(6);
    expect(tradeGroup("pest-control")).toBe("pest");
    expect(TRADE_MODELS["pest-control"]?.primary?.unit).toBe("square foot");
    expect(presetForTrade("pest-control")).toBe("exterior_cleaning");
    const starter = startersFor("pest-control")[0];
    expect(starter.trade).toBe("pest-control");
    expect(starter.scale).toMatchObject({ unit: "linear foot", calc: "perimeter" });
  });

  it("never ships prices or product recommendations in the template", () => {
    const json = JSON.stringify(getTrade("pest-control")!.template);
    expect(json).not.toMatch(/unitCost|price|\$\d/i);
    expect(json).not.toMatch(/bifenthrin|fipronil|permethrin|imidacloprid/i);
  });

  it("offers the perimeter calculator on linear-foot treatments and exclusion work", () => {
    for (const name of ["Exterior perimeter treatment", "Termite trench and treat", "Exclusion sealing (entry points)"]) {
      expect(calculatorsFor({ name, unit: "linear foot" }, ["pest-control"])[0]?.calc).toBe("perimeter");
    }
    expect(calculatorsFor({ name: "Interior treatment", unit: "square foot" }, ["pest-control"])[0]?.calc).toBe("area");
  });

  it("suggests pest-specific exclusions and clarifications", () => {
    const cats = ruleExclusions(bid(["Initial interior and exterior treatment", "Quarterly service visit"]) as never).map((x) => x.category);
    expect(cats).toEqual(expect.arrayContaining(["pest_prep", "pest_results", "pest_damage", "inaccessible_areas"]));
    expect(cats).not.toContain("demolition");
    expect(cats).not.toContain("stump_grinding");
    // Listing a repair line means repair is no longer suggested as an exclusion.
    const withRepair = ruleExclusions(bid(["Termite trench and treat", "Damaged sill plate repair"]) as never).map((x) => x.category);
    expect(withRepair).not.toContain("pest_damage");
  });

  it("recognizes pest control in community posts", () => {
    expect(classify({ title: "How do you price a quarterly pest control plan?", text: "" }).trade).toBe("pest-control");
    expect(classify({ title: "Exterminator here, what software do you use for quotes?", text: "" }).trade).toBe("pest-control");
  });
});
