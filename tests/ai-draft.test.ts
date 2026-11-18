import { describe, expect, it } from "vitest";
import { buildUserMessage, draftBid, sanitizeDraft } from "@/lib/ai-draft/draft";
import { DEFAULT_LABOR_BURDEN, clampBurden, laborWage, laborWagesFor } from "@/lib/ai-draft/labor-rates";
import { matchSavedItem, nameSimilarity, resolveDraft, sourceCounts, type DraftLine } from "@/lib/ai-draft/resolve";
import { draftSections } from "@/components/builder/ai-draft";
import { reducer, type State } from "@/components/builder/state";
import { AiUnavailableError } from "@/lib/ai/provider";
import type { SavedItem } from "@/lib/library/saved-items";
import { est, item } from "./helpers";

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  section: "Tile", name: "Ceramic wall tile 3x6", description: "", costType: "material", quantity: 60, unit: "square foot",
  laborTrade: null, ballparkUnitCost: 4.5, basis: "", ...over,
});
const saved = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: "s1", name: "3x6 ceramic wall tiles", costType: "material", treatment: "marked_up", unit: "sq ft", unitCost: "4.88", taxable: true, ...over,
});

describe("labor rates (BLS OEWS May 2025)", () => {
  it("uses the state median and falls back to the US median when BLS didn't publish one", () => {
    expect(laborWage("carpenter", "MN")).toMatchObject({ wage: 31.22, area: "MN", soc: "47-2031" });
    expect(laborWage("tile", "DC")).toMatchObject({ wage: 26.77, area: "US" }); // DC tile setters not published
    expect(laborWage("electrician", null).area).toBe("US");
  });
  it("finds the state from the ZIP first", () => {
    expect(laborWagesFor({ zip: "55401", state: "TX" }, ["plumber"]).state).toBe("MN");
    expect(laborWagesFor({ state: "Texas" }, ["plumber"]).wages[0]).toMatchObject({ area: "TX", wage: 28.77 });
  });
  it("keeps the burden in a sane range", () => {
    expect(clampBurden(Number("abc"))).toBe(DEFAULT_LABOR_BURDEN);
    expect(clampBurden(0.2)).toBe(1);
    expect(clampBurden(9)).toBe(3);
  });
});

describe("pricing resolver", () => {
  const wages = [laborWage("tile", "MN")];
  it("prefers the contractor's Saved Item (same unit, similar name)", () => {
    const [p] = resolveDraft([line()], { savedItems: [saved({ supplierName: "ABC Supply" })], wages, useBallpark: true });
    expect(p.unitCost).toBe("4.88");
    expect(p.source).toMatchObject({ kind: "saved", savedItemId: "s1" });
    expect(p.source.detail).toContain("ABC Supply");
  });
  it("never matches across units or material vs labor", () => {
    expect(matchSavedItem(line(), [saved({ unit: "box" })])).toBeNull();
    expect(matchSavedItem(line(), [saved({ costType: "labor" })])).toBeNull();
    expect(matchSavedItem(line({ name: "Shower valve" }), [saved()])).toBeNull();
  });
  it("prices labor hours from the local wage × burden", () => {
    const [p] = resolveDraft([line({ name: "Tile setter labor", costType: "labor", unit: "hour", quantity: 16, laborTrade: "tile" })], { savedItems: [], wages, laborBurden: 1.5, useBallpark: true });
    expect(p.unitCost).toBe((33.92 * 1.5).toFixed(2));
    expect(p.source.kind).toBe("labor_rate");
    expect(p.source.detail).toContain("MN");
  });
  it("uses the AI ballpark only when allowed, and labels it", () => {
    const [on] = resolveDraft([line({ name: "Shower pan 36x48" })], { savedItems: [], wages, useBallpark: true });
    expect(on).toMatchObject({ unitCost: "4.50", source: { kind: "ai_guess", label: "AI guess — verify" } });
    const [off] = resolveDraft([line({ name: "Shower pan 36x48" })], { savedItems: [], wages, useBallpark: false });
    expect(off).toMatchObject({ unitCost: "", source: { kind: "none" } });
    expect(sourceCounts([on, off])).toEqual({ saved: 0, labor_rate: 0, ai_guess: 1, none: 1 });
  });
  it("scores names by shared words, ignoring filler and plurals", () => {
    expect(nameSimilarity("Install drywall sheets", "Drywall sheet")).toBe(1);
    expect(nameSimilarity("Toilet", "Toilet seat")).toBeCloseTo(0.667, 2);
    expect(nameSimilarity("", "x")).toBe(0);
  });
});

describe("AI draft sanitizing", () => {
  const raw = {
    sections: [{ name: "  Plumbing ", lines: [
      { name: "Toilet", description: "elongated", cost_type: "material" as const, quantity: 1, unit: "each" as const, labor_trade: "", ballpark_unit_cost: 399.09, basis: "" },
      { name: "Toilet", description: "dupe", cost_type: "material" as const, quantity: 1, unit: "each" as const, labor_trade: "", ballpark_unit_cost: 1, basis: "" },
      { name: "Plumber labor", description: "", cost_type: "labor" as const, quantity: 6, unit: "hour" as const, labor_trade: "wizard", ballpark_unit_cost: 0, basis: "" },
      { name: "Bad qty", description: "", cost_type: "material" as const, quantity: -2, unit: "each" as const, labor_trade: "", ballpark_unit_cost: 3, basis: "" },
      { name: "Drywall", description: "", cost_type: "material" as const, quantity: 3, unit: "sheet" as const, labor_trade: "plumber", ballpark_unit_cost: 15, basis: "" },
    ] }],
    assumptions: ["Standard 8 ft ceilings", ""],
    questions: ["Keep the existing tub?"],
  };
  it("drops bad and duplicate lines, fixes crews, and clears crews on non-labor lines", () => {
    const out = sanitizeDraft(raw, "bathrooms");
    expect(out.lines.map((l) => l.name)).toEqual(["Toilet", "Plumber labor", "Drywall"]);
    expect(out.lines[0]).toMatchObject({ section: "Plumbing", ballparkUnitCost: 399.09, laborTrade: null });
    expect(out.lines[1]).toMatchObject({ laborTrade: "carpenter", ballparkUnitCost: null }); // unknown crew → trade default
    expect(out.lines[2].laborTrade).toBeNull();
    expect(out.assumptions).toEqual(["Standard 8 ft ceilings"]);
  });
  it("puts the job inside data tags and never sends prices", () => {
    const msg = buildUserMessage({ trade: "bathrooms", description: "5x8 bath", state: "MN", existingSections: ["Demolition"] });
    expect(msg).toContain("<job>\n5x8 bath\n</job>");
    expect(msg).toContain("Project state: MN");
    expect(msg).not.toMatch(/\$/);
  });
  it("throws when the AI returns nothing usable", async () => {
    const ai = async () => ({ data: { sections: [], assumptions: [], questions: [] }, model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 5, costUsd: 0 });
    await expect(draftBid({ trade: "tile", description: "small job", state: null, existingSections: [] }, ai as never)).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("applying a draft", () => {
  it("adds picked rows into same-named sections and creates missing ones", () => {
    const priced = resolveDraft([
      line({ section: "Tile" }),
      line({ section: "Permits", name: "Plumbing permit", costType: "permit", unit: "each", quantity: 1, ballparkUnitCost: 150 }),
      line({ section: "Tile", name: "Skip me" }),
    ], { savedItems: [], wages: [], useBallpark: true });
    let n = 0;
    const sections = draftSections(priced, new Set([0, 1]), () => `d${++n}`);
    expect(sections.map((s) => s.name)).toEqual(["Tile", "Permits"]);
    expect(sections[1].items[0]).toMatchObject({ treatment: "pass_through", taxable: false, unitCost: "150.00" });

    const base = est({ items: [item("g1", "1", "10", { id: "a" })] });
    const tileGroup = { ...base.groups[0], name: "tile " };
    const s0: State = { estimate: { ...base, groups: [tileGroup, ...base.groups.slice(1)] }, trash: [], dirty: 0 };
    const s1 = reducer(s0, { type: "applyDraft", trade: base.trades[0], sections });
    const d1 = s1.estimate.items.find((i) => i.id === "d1")!;
    expect(d1.groupId).toBe(tileGroup.id);
    const permits = s1.estimate.groups.find((g) => g.name === "Permits")!;
    expect(s1.estimate.items.find((i) => i.id === "d2")!.groupId).toBe(permits.id);
    expect(s1.dirty).toBe(1);
    // Undo from the panel removes exactly the drafted rows.
    const s2 = reducer(s1, { type: "deleteItems", ids: ["d1", "d2"] });
    expect(s2.estimate.items.map((i) => i.id)).toEqual(s0.estimate.items.map((i) => i.id));
  });
  it("ignores a trade the bid doesn't have", () => {
    const s0: State = { estimate: est({}), trash: [], dirty: 0 };
    expect(reducer(s0, { type: "applyDraft", trade: "not-a-trade", sections: [{ name: "X", items: [{ id: "z", name: "z" }] }] })).toBe(s0);
  });
});
