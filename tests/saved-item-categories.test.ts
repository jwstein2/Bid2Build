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
