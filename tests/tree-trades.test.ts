import { describe, expect, it } from "vitest";
import { getTrade } from "@/lib/trades/catalog";
import { ruleExclusions } from "@/lib/proposal/generate-rules";
import { tradeGroup } from "@/lib/features/page-guides";
import { TRADE_MODELS } from "@/lib/market/trade-models";
import { startersFor } from "@/lib/library/assemblies";
import { classify } from "@/lib/radar/classify";

const bid = (slug: string, items: string[]) => ({
  tradeSlugs: [slug], projectTitle: "Backyard trees", scope: "", notes: "", style: "professional" as const,
  groups: [{ name: "Work", description: "", items: items.map((name) => ({ name, description: "", kind: "labor" })) }],
});

describe("tree removal and tree trimming trades", () => {
  it("are in the catalog with templates, a guide family, a market model and a starter assembly", () => {
    for (const slug of ["tree-removal", "tree-trimming"]) {
      const t = getTrade(slug)!;
      expect(t.family).toBe("Sitework");
      expect(t.template.groups.length).toBeGreaterThanOrEqual(5);
      expect(tradeGroup(slug)).toBe("trees");
      expect(TRADE_MODELS[slug]?.primary?.unit).toBe("each");
      expect(startersFor(slug)[0].trade).toBe(slug);
    }
  });

  it("suggests tree-specific exclusions and clarifications", () => {
    const removal = ruleExclusions(bid("tree-removal", ["Medium tree removal (30 to 60 ft)"]) as never).map((x) => x.category);
    expect(removal).toEqual(expect.arrayContaining(["stump_grinding", "wood_left", "utility_lines", "hidden_hazards", "landscaping"]));
    expect(removal).not.toContain("demolition");
    const trim = ruleExclusions(bid("tree-trimming", ["Crown thinning"]) as never).map((x) => x.category);
    expect(trim).toEqual(expect.arrayContaining(["wood_left", "utility_lines"]));
    expect(trim).not.toContain("stump_grinding");
    // Listing the stump and haul-away means they're no longer suggested as exclusions.
    const full = ruleExclusions(bid("tree-removal", ["Large tree removal (over 60 ft)", "Stump grinding", "Log hauling"]) as never).map((x) => x.category);
    expect(full).not.toContain("stump_grinding");
    expect(full).not.toContain("wood_left");
  });

  it("recognizes tree work in community posts", () => {
    expect(classify({ title: "Looking for a tree removal company and stump grinding quote", text: "" }).trade).toBe("tree-removal");
    expect(classify({ title: "How do you price tree trimming for a few maples?", text: "" }).trade).toBe("tree-trimming");
  });
});
