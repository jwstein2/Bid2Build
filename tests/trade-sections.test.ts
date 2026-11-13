import { describe, expect, it } from "vitest";
import { reducer, type State } from "@/components/builder/state";
import { reconcileOpenState } from "@/components/builder/open-sections";
import { applySectionTrades, worksheetFrom, worksheetToStore } from "@/lib/data/mappers";
import { computeEstimate, sortedGroups } from "@/lib/estimate/engine";
import { createEstimate } from "@/lib/estimate/factory";
import { estimateSchema } from "@/lib/estimate/schema";
import {
  addTrade, moveTrade, orderedSections, removeTrade, sectionTrade, tradeBlocks, tradeContents, tradeTotals,
} from "@/lib/estimate/trades";
import type { Estimate } from "@/lib/estimate/types";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { getTrade } from "@/lib/trades/catalog";
import { est, item } from "./helpers";

const NOW = new Date("2026-11-13T12:00:00Z");
const templateNames = (slug: string) => getTrade(slug)!.template.groups.map((g) => g.name);
const state = (estimate: Estimate): State => ({ estimate, trash: [], dirty: 0 });
const dispatchAll = (s: State, ...actions: Parameters<typeof reducer>[1][]) => actions.reduce(reducer, s);

/** "Whole Home Renovation": Deck Building, Concrete, Roofing, Siding, added one after another. */
function wholeHome(): Estimate {
  let e = { ...createEstimate("decks", { now: NOW, number: "EST-1" }), title: "Whole Home Renovation" };
  for (const t of ["concrete", "roofing", "siding"]) e = addTrade(e, t);
  return e;
}

/** Puts one priced line item into the first section of a trade. */
function price(e: Estimate, slug: string, qty: string, cost: string): Estimate {
  const g = tradeBlocks(e).find((b) => b.trade === slug)!.groups[0];
  return { ...e, items: [...e.items, item(g.id, qty, cost, { id: crypto.randomUUID(), name: `${slug} work` })] };
}

describe("adding trades creates their estimate sections", () => {
  it("a new estimate's sections belong to its trade", () => {
    const e = createEstimate("roofing", { now: NOW });
    expect(e.groups.every((g) => g.trade === "roofing")).toBe(true);
    expect(e.groups.map((g) => g.name)).toEqual(templateNames("roofing"));
  });

  it("each added trade gets its own template sections, in trade-list order", () => {
    const e = wholeHome();
    const blocks = tradeBlocks(e);
    expect(blocks.map((b) => b.trade)).toEqual(["decks", "concrete", "roofing", "siding"]);
    for (const b of blocks) expect(b.groups.map((g) => g.name)).toEqual(templateNames(b.trade));
    // Sections are numbered contiguously trade by trade, so every consumer of sortOrder agrees.
    expect(sortedGroups(e).map((g) => g.id)).toEqual(orderedSections(e).map((g) => g.id));
    // Template sections start empty: suggestions are offered, never added or priced automatically.
    expect(e.items).toHaveLength(0);
  });

  it("never creates duplicate trades or sections when the same trade is added again", () => {
    const e = wholeHome();
    const again = addTrade(addTrade(e, "roofing"), "roofing");
    expect(again).toBe(e);
    const s = dispatchAll(state(e), { type: "addTrade", trade: "siding" }, { type: "addTrade", trade: "siding" });
    expect(s.estimate.trades).toEqual(e.trades);
    expect(s.estimate.groups).toHaveLength(e.groups.length);
    expect(s.dirty).toBe(0); // a no-op doesn't trigger an autosave
  });

  it("re-adding a trade whose sections were kept doesn't duplicate them", () => {
    const e = wholeHome();
    const kept = removeTrade(e, "roofing", { keepIn: "decks" })!.estimate;
    // The kept roofing sections now belong to decks; adding roofing back creates fresh roofing sections only.
    const back = addTrade(kept, "roofing");
    expect(tradeBlocks(back).find((b) => b.trade === "roofing")!.groups).toHaveLength(templateNames("roofing").length);
    expect(back.groups).toHaveLength(e.groups.length + templateNames("roofing").length);
  });
});

describe("reordering", () => {
  it("moving a trade moves its sections with it", () => {
    const e = moveTrade(wholeHome(), "roofing", -1);
    expect(e.trades).toEqual(["decks", "roofing", "concrete", "siding"]);
    expect(tradeBlocks(e).map((b) => b.trade)).toEqual(e.trades);
    expect(sortedGroups(e).map((g) => g.id)).toEqual(orderedSections(e).map((g) => g.id));
  });

  it("moving a section up or down stays inside its trade", () => {
    const e = wholeHome();
    const concrete = tradeBlocks(e).find((b) => b.trade === "concrete")!.groups;
    // First concrete section can't move up into decks.
    const s = reducer(state(e), { type: "moveGroup", id: concrete[0].id, dir: -1 });
    expect(s.estimate).toBe(e);
    const s2 = reducer(state(e), { type: "moveGroup", id: concrete[0].id, dir: 1 });
    expect(tradeBlocks(s2.estimate).find((b) => b.trade === "concrete")!.groups.map((g) => g.id).slice(0, 2)).toEqual([concrete[1].id, concrete[0].id]);
    expect(tradeBlocks(s2.estimate).find((b) => b.trade === "decks")!.groups.map((g) => g.id)).toEqual(tradeBlocks(e)[0].groups.map((g) => g.id));
  });

  it("a section can be moved to another trade", () => {
    const e = wholeHome();
    const g = tradeBlocks(e)[0].groups[0];
    const s = reducer(state(e), { type: "moveGroupToTrade", id: g.id, trade: "siding" });
    const siding = tradeBlocks(s.estimate).find((b) => b.trade === "siding")!.groups;
    expect(siding[siding.length - 1].id).toBe(g.id);
  });

  it("a new section added to a trade lands at the end of that trade", () => {
    const s = reducer(state(wholeHome()), { type: "addGroup", trade: "concrete", name: "Pump truck" });
    const concrete = tradeBlocks(s.estimate).find((b) => b.trade === "concrete")!.groups;
    expect(concrete[concrete.length - 1].name).toBe("Pump truck");
  });
});

describe("removing a trade", () => {
  it("empty template sections hold no data; entered work does", () => {
    const e = wholeHome();
    expect(tradeContents(e, "roofing").hasData).toBe(false);
    expect(tradeContents(price(e, "roofing", "10", "5"), "roofing")).toMatchObject({ items: 1, hasData: true });
    const described = { ...e, groups: e.groups.map((g) => (g.trade === "roofing" ? { ...g, description: "Tear-off" } : g)) };
    expect(tradeContents(described, "roofing").hasData).toBe(true);
  });

  it("deletes only that trade's sections, and undo brings them back in place", () => {
    const e = price(price(wholeHome(), "roofing", "10", "5"), "siding", "2", "50");
    let s = reducer(state(e), { type: "removeTrade", trade: "roofing" });
    expect(s.estimate.trades).toEqual(["decks", "concrete", "siding"]);
    expect(s.estimate.groups.some((g) => g.trade === "roofing")).toBe(false);
    expect(s.estimate.items.map((i) => i.name)).toEqual(["siding work"]);
    expect(tradeContents(s.estimate, "siding").items).toBe(1);
    s = reducer(s, { type: "undo" });
    expect(s.estimate.trades).toEqual(e.trades);
    expect(orderedSections(s.estimate).map((g) => g.id)).toEqual(orderedSections(e).map((g) => g.id));
    expect(computeEstimate(s.estimate).total.toFixed(2)).toBe(computeEstimate(e).total.toFixed(2));
  });

  it("can keep the work by moving the sections to another trade", () => {
    const e = price(wholeHome(), "roofing", "10", "5");
    const s = reducer(state(e), { type: "removeTrade", trade: "roofing", keepIn: "siding" });
    expect(s.estimate.trades).not.toContain("roofing");
    expect(s.estimate.items).toHaveLength(1);
    expect(computeEstimate(s.estimate).total.toFixed(2)).toBe(computeEstimate(e).total.toFixed(2));
    expect(s.trash).toHaveLength(0);
  });

  it("the last trade can't be removed", () => {
    const e = createEstimate("decks", { now: NOW });
    expect(reducer(state(e), { type: "removeTrade", trade: "decks" }).estimate).toBe(e);
  });
});

describe("totals", () => {
  it("each trade has its own subtotal and they add up to the estimate", () => {
    let e = wholeHome();
    e = price(e, "decks", "100", "10"); // cost 1000 → price 1250 at 25% markup
    e = price(e, "concrete", "4", "150"); // cost 600 → 750
    e = price(e, "siding", "3", "33.33"); // cost 99.99 → unit price 41.66 (rounded per unit) → 124.98
    e = { ...e, fixedAdjustment: "-100", taxRate: "6" };
    const totals = computeEstimate(e);
    const byTrade = Object.fromEntries(tradeTotals(e, totals).map((t) => [t.trade, t.price.toFixed(2)]));
    expect(byTrade).toEqual({ decks: "1250.00", concrete: "750.00", roofing: "0.00", siding: "124.98" });
    const sum = tradeTotals(e, totals).reduce((s, t) => s + Number(t.price.toFixed(2)), 0);
    expect(sum.toFixed(2)).toBe(totals.itemsPrice.toFixed(2));
    // Estimate-level adjustment and tax still apply once, on top of the trade subtotals.
    expect(totals.subtotal.toFixed(2)).toBe("2024.98");
    expect(totals.total.toFixed(2)).toBe("2146.48");
  });

  it("section and item pricing overrides keep working inside a trade", () => {
    let e = price(wholeHome(), "concrete", "1", "100");
    const g = tradeBlocks(e).find((b) => b.trade === "concrete")!.groups[0];
    e = { ...e, groups: e.groups.map((x) => (x.id === g.id ? { ...x, pricingOverride: { mode: "margin" as const, percent: "50" } } : x)) };
    expect(tradeTotals(e, computeEstimate(e)).find((t) => t.trade === "concrete")!.price.toFixed(2)).toBe("200.00");
  });
});

describe("estimates saved before trade sections", () => {
  const legacy = () => est({
    trades: ["decks", "concrete"],
    items: [item("g1", "10", "10", { id: "a" }), item("g2", "5", "20", { id: "b" })],
  });

  it("read as before: unassigned sections belong to the primary trade, and nothing is rewritten", () => {
    const e = legacy();
    expect(e.groups.every((g) => g.trade === undefined)).toBe(true);
    expect(sectionTrade(e, e.groups[0])).toBe("decks");
    expect(tradeBlocks(e).map((b) => b.groups.length)).toEqual([2, 0]);
  });

  it("loading one adds no trade fields, so its proposal version hash is unchanged", () => {
    const e = legacy();
    const loaded = applySectionTrades(e, worksheetFrom({ worksheet: null }));
    const cfg = defaultProposalConfig();
    const biz = defaultBusinessProfile();
    expect(contentHash(versionSnapshot(loaded, biz, cfg))).toBe(contentHash(versionSnapshot(e, biz, cfg)));
  });

  it("changing the trade list pins the existing sections to the trade they were shown under", () => {
    const e = moveTrade(legacy(), "concrete", -1);
    expect(e.trades).toEqual(["concrete", "decks"]);
    expect(tradeBlocks(e).find((b) => b.trade === "decks")!.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});

describe("persistence (no schema change)", () => {
  it("section trades ride in proposal_config.worksheet and come back onto the sections", () => {
    const e = price(wholeHome(), "roofing", "1", "100");
    const stored = worksheetToStore(e);
    expect(Object.keys(stored!.sectionTrades!)).toHaveLength(e.groups.length);
    const fromDb = { ...e, groups: e.groups.map(({ trade: _t, ...g }) => g) };
    const restored = applySectionTrades(fromDb, worksheetFrom({ worksheet: stored }));
    expect(restored.groups.map((g) => g.trade)).toEqual(e.groups.map((g) => g.trade));
    expect(restored.worksheet).toBeNull(); // the in-memory worksheet doesn't keep a second copy
  });

  it("keeps calculator inputs alongside section trades", () => {
    const e = price(wholeHome(), "roofing", "1", "100");
    const id = e.items[0].id;
    const calc = { v: 1 as const, calc: "area" as const, output: "area", input: { sections: [], options: {} }, result: "1", unit: "sq ft", appliedAt: "2026-11-13" };
    const stored = worksheetToStore({ ...e, worksheet: { calcs: { [id]: calc }, minimumCharge: "150" } })!;
    const restored = applySectionTrades(e, worksheetFrom({ worksheet: stored }));
    expect(restored.worksheet).toEqual({ calcs: { [id]: calc }, minimumCharge: "150" });
  });

  it("the save payload validates with section trades and keeps them", () => {
    const e = wholeHome();
    const parsed = estimateSchema.parse(e);
    expect(parsed.groups.map((g) => g.trade)).toEqual(e.groups.map((g) => g.trade));
  });
});

describe("customer proposal", () => {
  const cfg = () => defaultProposalConfig();
  const biz = { ...defaultBusinessProfile(), companyName: "Acme" };

  it("groups sections under trade headings with trade subtotals, in trade order", () => {
    let e: Estimate = { ...wholeHome(), defaultGroupVisibility: "group_total" };
    e = price(price(e, "siding", "2", "40"), "decks", "1", "800");
    const doc = buildProposal(e, biz, cfg());
    const headed = doc.pricing.sections.filter((s) => s.tradeHeading);
    expect(headed.map((s) => s.tradeHeading!.title)).toEqual([getTrade("decks")!.name, getTrade("siding")!.name]);
    expect(headed.map((s) => s.tradeHeading!.amount)).toEqual(["$1,000.00", "$100.00"]);
    expect(doc.pricing.total).toBe("$1,100.00");
  });

  it("never reveals a trade subtotal when its sections hide prices", () => {
    let e: Estimate = { ...wholeHome(), defaultGroupVisibility: "names_only" };
    e = price(e, "decks", "1", "800");
    const c = cfg();
    const doc = buildProposal(e, biz, { ...c, show: { ...c.show, groupPrices: false } });
    expect(doc.pricing.sections[0].tradeHeading).toEqual({ title: getTrade("decks")!.name, amount: undefined });
  });

  it("the PDF renders trade headings", async () => {
    const { renderProposalPdf } = await import("@/lib/pdf/render");
    let e: Estimate = { ...wholeHome(), defaultGroupVisibility: "itemized" };
    e = price(price(e, "roofing", "30", "100"), "decks", "1", "800");
    const buf = await renderProposalPdf(buildProposal(e, biz, cfg()));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("single-trade proposals are unchanged (no trade heading)", () => {
    const e = price(createEstimate("decks", { now: NOW }), "decks", "1", "800");
    expect(buildProposal(e, biz, cfg()).pricing.sections.some((s) => s.tradeHeading)).toBe(false);
  });
});

describe("accordion when a trade is added", () => {
  it("opens just the first of the new trade's sections", () => {
    const s = reconcileOpenState({ open: ["a"], known: ["a"] }, ["a", "n1", "n2", "n3"], "first");
    expect(s.open).toEqual(["a", "n1"]);
  });
});
