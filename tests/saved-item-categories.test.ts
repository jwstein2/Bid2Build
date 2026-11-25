import { describe, expect, it } from "vitest";
import { categoryDuplicates, closeCategory, exactCategory, filterCategories, resolveCategory, similarCategories } from "@/lib/library/categories";

const opts = ["Labor", "Materials", "Tear Off", "Underlayment", "Shingles", "Trim"];

describe("saved item categories", () => {
  it("snaps case and spacing differences to the existing spelling", () => {
    expect(resolveCategory("labor", opts)).toBe("Labor");
    expect(resolveCategory("  LABOR ", opts)).toBe("Labor");
    expect(resolveCategory("tear   off", opts)).toBe("Tear Off");
    expect(resolveCategory("  Gutters  ", opts)).toBe("Gutters");
    expect(exactCategory("", opts)).toBeUndefined();
  });

  it("suggests the existing category for UK spellings, plurals and typos", () => {
    expect(closeCategory("Labour", opts)).toBe("Labor");
    expect(closeCategory("labour", opts)).toBe("Labor");
    expect(closeCategory("Material", opts)).toBe("Materials");
    expect(closeCategory("Shingle", opts)).toBe("Shingles");
    expect(closeCategory("Underlayement", opts)).toBe("Underlayment");
    expect(closeCategory("Labr", opts)).toBeUndefined(); // too short to guess safely
    expect(closeCategory("Labor", opts)).toBeUndefined(); // exact, nothing to suggest
    expect(closeCategory("Gutters", opts)).toBeUndefined();
    expect(similarCategories("Trim", "Tile")).toBe(false);
  });

  it("filters the dropdown: starts-with first, then contains, then likely matches", () => {
    expect(filterCategories("", opts)).toEqual(opts);
    expect(filterCategories("t", opts)).toEqual(["Tear Off", "Trim", "Materials", "Underlayment"]);
    expect(filterCategories("labour", opts)).toEqual(["Labor"]);
    expect(filterCategories("off", opts)).toEqual(["Tear Off"]);
  });

  it("finds near-duplicate spellings per trade and picks the most used", () => {
    const items = [
      { trade: "roofing", category: "Labor" }, { trade: "roofing", category: "Labor" },
      { trade: "roofing", category: "labor" }, { trade: "roofing", category: "Labour" },
      { trade: "roofing", category: "Shingles" },
      { trade: "painting", category: "Labor" }, // other trade: not a duplicate of roofing's
      { trade: null, category: "materials" }, { trade: null, category: "Materials" },
    ];
    const g = categoryDuplicates(items);
    expect(g).toHaveLength(2);
    const roof = g.find((x) => x.trade === "roofing")!;
    expect(roof.target).toBe("Labor");
    expect(roof.names.map((n) => n.name)).toEqual(["Labor", "Labour", "labor"]);
    // Tie on count: the capitalized spelling wins.
    expect(g.find((x) => x.trade === null)!.target).toBe("Materials");
  });
});

import { categoryPath, childCategory, matchRoot, parseCategoryPath } from "@/lib/library/categories";
import { COST_TYPES } from "@/lib/trades/catalog";
import { itemPath, organizeLibrary, pathOptions, type SavedItem } from "@/lib/library/saved-items";

describe("Type › Category combined list", () => {
  it("shows existing items as Type : Category without changing stored data", () => {
    expect(itemPath({ costType: "labor", category: "Contractor" })).toBe("Labor : Contractor");
    expect(itemPath({ costType: "material", category: "" })).toBe("Material");
    // A category that just repeats the Type collapses into it (old "Labor"/"Materials" categories).
    expect(itemPath({ costType: "labor", category: "Labor" })).toBe("Labor");
    expect(itemPath({ costType: "material", category: "Materials" })).toBe("Material");
    expect(itemPath({ costType: "labor_material", category: "Tear Off" })).toBe("Labor / Material : Tear Off");
    expect(childCategory("Labor : Contractor : Framing", "Labor")).toBe("Contractor : Framing");
    expect(categoryPath("Labor", "  contractor  ")).toBe("Labor : contractor");
  });

  it("reads typed text: the first level sets the Type, the rest is the category", () => {
    expect(parseCategoryPath("Material : Shingles", COST_TYPES, "labor")).toEqual({ type: "material", category: "Shingles", rootTyped: true });
    expect(parseCategoryPath("labour:overhead", COST_TYPES, "material")).toEqual({ type: "labor", category: "overhead", rootTyped: true });
    expect(parseCategoryPath("Subcontractor", COST_TYPES, "labor")).toEqual({ type: "subcontractor", category: "", rootTyped: true });
    expect(parseCategoryPath("Contractor", COST_TYPES, "labor")).toEqual({ type: "labor", category: "Contractor", rootTyped: false });
    expect(parseCategoryPath("Labor : Contractor : Framing", COST_TYPES, "material").category).toBe("Contractor : Framing");
    expect(parseCategoryPath("", COST_TYPES, "equipment")).toEqual({ type: "equipment", category: "", rootTyped: false });
    expect(matchRoot("Materials", COST_TYPES)).toBe("material");
    expect(matchRoot("labor_material", COST_TYPES)).toBe("labor_material");
    expect(matchRoot("Permit / fee", COST_TYPES)).toBe("permit");
    expect(matchRoot("Contractor", COST_TYPES)).toBeUndefined();
  });

  it("offers this trade's paths first, then the trade's sections, other trades, and every Type", () => {
    const items = [
      { costType: "labor" as const, category: "Contractor", trade: "roofing" },
      { costType: "labor" as const, category: "Overhead", trade: null },
    ];
    const opts = pathOptions("roofing", items);
    expect(opts[0]).toBe("Material");
    expect(opts.indexOf("Labor : Contractor")).toBe(opts.indexOf("Labor") + 1);
    expect(opts).toContain("Labor : Overhead");
    expect(opts).toContain("Material");
    expect(opts).toContain("Subcontractor");
    expect(opts.some((o) => o.startsWith("Material : "))).toBe(true); // roofing sections under their Types
    expect(new Set(opts.map((o) => o.toLowerCase())).size).toBe(opts.length);
  });

  it("near-duplicates are found per trade and Type", () => {
    const g = categoryDuplicates([
      { trade: null, costType: "labor", category: "Contractor" }, { trade: null, costType: "labor", category: "Contractor" },
      { trade: null, costType: "labor", category: "contracter" },
      { trade: null, costType: "material", category: "contractor" }, // other Type: separate
    ], (t) => (t === "labor" ? "Labor" : "Material"));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ costType: "labor", target: "Contractor" });
  });

  it("library groups follow the combined list", () => {
    const s = (p: Partial<SavedItem>): SavedItem => ({ id: crypto.randomUUID(), name: "x", costType: "labor", treatment: "marked_up", unit: "each", unitCost: "", taxable: false, ...p });
    const org = organizeLibrary([s({ category: "Contractor" }), s({ category: "contractor " }), s({ costType: "equipment" })]);
    expect(org[0].categories.map((c) => c.name)).toEqual(["Equipment", "Labor : Contractor"]);
    expect(org[0].categories[1].items).toHaveLength(2);
  });
});
