/** Draft with AI keeps its draft per bid in the browser (Will meeting 2026-11-21, item B). */
import { describe, expect, it } from "vitest";
import { clearStoredDraft, loadStoredDraft, saveStoredDraft } from "@/lib/ai-draft/store";
import type { DraftResponse } from "@/lib/ai-draft/resolve";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const draft: DraftResponse = { trade: "decks", lines: [
  { section: "Framing", name: "Joists", description: "", costType: "material", quantity: 20, unit: "each", laborTrade: null, ballparkUnitCost: null, basis: "" },
  { section: "Labor", name: "Carpenter", description: "", costType: "labor", quantity: 16, unit: "hour", laborTrade: "carpenter", ballparkUnitCost: null, basis: "" },
], assumptions: [], questions: [], labor: { state: null, period: "May 2025", source: "BLS OEWS", wages: [] } };

describe("Draft with AI browser copy", () => {
  it("restores the draft, ticks, burden and the applied note for the same bid only", () => {
    const s = mem();
    saveStoredDraft("e1", { trade: "decks", description: "12x16 deck", draftedFrom: "12x16 deck", draft, picked: [1], burden: "1.4", useBallpark: false, appliedAt: "2026-11-21T20:00:00Z", appliedCount: 1 }, s);
    expect(loadStoredDraft("e1", s)).toMatchObject({ trade: "decks", description: "12x16 deck", picked: [1], burden: "1.4", useBallpark: false, appliedCount: 1 });
    expect(loadStoredDraft("e1", s)!.draft!.lines).toHaveLength(2);
    expect(loadStoredDraft("e2", s)).toBeNull(); // another bid never sees it
    clearStoredDraft("e1", s);
    expect(loadStoredDraft("e1", s)).toBeNull();
  });

  it("drops ticks that point past the draft, ignores junk, and never throws when storage is blocked", () => {
    const s = mem();
    saveStoredDraft("e1", { trade: "decks", description: "x", draft, picked: [0, 5, -1], burden: "1.35", useBallpark: true }, s);
    expect(loadStoredDraft("e1", s)!.picked).toEqual([0]);
    s.setItem("b2b:ai-draft:e3", "{not json");
    expect(loadStoredDraft("e3", s)).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadStoredDraft("e1", blocked)).toBeNull();
    expect(saveStoredDraft("e1", { trade: "decks", description: "", draft: null, picked: [], burden: "1", useBallpark: true }, blocked)).toBe(false);
    expect(() => clearStoredDraft("e1", blocked)).not.toThrow();
  });
});
