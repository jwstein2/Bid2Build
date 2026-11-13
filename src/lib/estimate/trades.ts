/**
 * Project trades ↔ estimate trade sections.
 *
 * The project's trade list (Estimate.trades, ordered) is the single source of truth for WHICH trades
 * a project has. Each estimate section (EstimateGroup) points at the trade it belongs to through
 * group.trade, the trade's slug: the stable identifier shared by the trade list and the estimate.
 * A section without a trade (estimates saved before trade sections existed) belongs to the primary
 * trade, so older estimates read exactly as before and are not rewritten until the trade list changes.
 *
 * Everything here is pure: the builder reducer calls these and the tests exercise them directly.
 */
import { D, type Dec } from "./money";
import type { EstimateTotals } from "./engine";
import { grossMarginPct } from "./engine";
import { newGroup } from "./factory";
import type { Estimate, EstimateGroup, LineItem } from "./types";
import { getTrade, tradeName } from "../trades/catalog";
import type { TradeTemplate } from "../trades/catalog";

/** The trade a section belongs to: its own trade if that trade is still in the project, else the primary trade. */
export function sectionTrade(e: Pick<Estimate, "trades">, g: Pick<EstimateGroup, "trade">): string {
  if (g.trade && e.trades.includes(g.trade)) return g.trade;
  return e.trades[0] ?? "";
}

export interface TradeBlock {
  trade: string;
  name: string;
  groups: EstimateGroup[];
}

/** Sections grouped by trade, in the order of the project's trade list. Every section appears exactly once. */
export function tradeBlocks(e: Pick<Estimate, "trades" | "groups">): TradeBlock[] {
  const sorted = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const slugs = e.trades.length ? e.trades : [""];
  return slugs.map((trade) => ({
    trade,
    name: trade ? tradeName(trade) : "Estimate",
    groups: sorted.filter((g) => sectionTrade(e, g) === trade),
  }));
}

/** Sections in display order (trade by trade). The proposal and the editor both use this order. */
export function orderedSections(e: Pick<Estimate, "trades" | "groups">): EstimateGroup[] {
  return tradeBlocks(e).flatMap((b) => b.groups);
}

/**
 * Writes the trade onto every section and renumbers sections so each trade's sections are
 * contiguous and follow the trade list. Called only when the trade list or a section's trade changes.
 */
export function arrangeSections(e: Estimate): Estimate {
  let i = 0;
  const groups = tradeBlocks(e).flatMap((b) =>
    b.groups.map((g) => {
      const next = { ...g, trade: b.trade || null, sortOrder: i++ };
      return next.trade === g.trade && next.sortOrder === g.sortOrder ? g : next;
    }),
  );
  return { ...e, groups };
}

/** The trade's estimating sections, from its template. A trade with no template sections gets one section named after it. */
export function templateSections(slug: string, startOrder = 0, template?: TradeTemplate): EstimateGroup[] {
  const t = template && template.trade === slug ? template : getTrade(slug)?.template;
  const names = t?.groups.map((g) => g.name).filter((n) => n.trim()) ?? [];
  const list = names.length ? names : [tradeName(slug)];
  return list.map((name, i) => ({ ...newGroup(name, startOrder + i), trade: slug }));
}

/**
 * Adds a trade to the project and creates its estimate sections. Idempotent: a trade already in the
 * project is left alone, and sections are only created when the trade has none (no duplicates).
 * Template sections start empty; suggested items are offered in the editor, never added or priced automatically.
 */
export function addTrade(e: Estimate, slug: string, opts: { template?: TradeTemplate } = {}): Estimate {
  if (!slug || e.trades.includes(slug)) return e;
  const settled = arrangeSections(e);
  const withTrade = { ...settled, trades: [...settled.trades, slug] };
  const hasSections = withTrade.groups.some((g) => g.trade === slug);
  const groups = hasSections ? withTrade.groups : [...withTrade.groups, ...templateSections(slug, withTrade.groups.length, opts.template)];
  return arrangeSections({ ...withTrade, groups });
}

export interface TradeRemoval {
  estimate: Estimate;
  index: number;
  groups: EstimateGroup[];
  items: LineItem[];
}

/**
 * Removes a trade from the project. Its sections are either deleted (returned so the caller can
 * offer undo) or kept by moving them to another trade. Other trades' sections are never touched.
 * The last trade can't be removed.
 */
export function removeTrade(e: Estimate, slug: string, opts: { keepIn?: string } = {}): TradeRemoval | null {
  const index = e.trades.indexOf(slug);
  if (index < 0 || e.trades.length < 2) return null;
  const settled = arrangeSections(e);
  const trades = settled.trades.filter((t) => t !== slug);
  const keepIn = opts.keepIn && trades.includes(opts.keepIn) ? opts.keepIn : null;
  const own = settled.groups.filter((g) => g.trade === slug);
  if (keepIn) {
    const groups = settled.groups.map((g) => (g.trade === slug ? { ...g, trade: keepIn } : g));
    return { estimate: arrangeSections({ ...settled, trades, groups }), index, groups: [], items: [] };
  }
  const ids = new Set(own.map((g) => g.id));
  const items = settled.items.filter((i) => ids.has(i.groupId));
  const estimate = arrangeSections({
    ...settled,
    trades,
    groups: settled.groups.filter((g) => !ids.has(g.id)),
    items: settled.items.filter((i) => !ids.has(i.groupId)),
  });
  return { estimate, index, groups: own, items };
}

/** Puts a removed trade (and its deleted sections) back where it was. */
export function restoreTrade(e: Estimate, slug: string, index: number, groups: EstimateGroup[], items: LineItem[]): Estimate {
  const trades = e.trades.includes(slug) ? e.trades : [...e.trades.slice(0, index), slug, ...e.trades.slice(index)];
  const existing = new Set(e.groups.map((g) => g.id));
  const back = groups.filter((g) => !existing.has(g.id)).map((g, i) => ({ ...g, trade: slug, sortOrder: 10_000 + i }));
  const backIds = new Set(back.map((g) => g.id));
  return arrangeSections({ ...e, trades, groups: [...e.groups, ...back], items: [...e.items, ...items.filter((i) => backIds.has(i.groupId))] });
}

/** Moves a trade up or down the project's trade list; its sections follow. */
export function moveTrade(e: Estimate, slug: string, dir: -1 | 1): Estimate {
  const idx = e.trades.indexOf(slug);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= e.trades.length) return e;
  const settled = arrangeSections(e); // pin unassigned sections to the current primary trade first
  const trades = [...settled.trades];
  [trades[idx], trades[to]] = [trades[to], trades[idx]];
  return arrangeSections({ ...settled, trades });
}

/** Moves one section to another trade (it goes to the end of that trade's sections). */
export function moveSectionToTrade(e: Estimate, groupId: string, slug: string): Estimate {
  if (!e.trades.includes(slug)) return e;
  const g = e.groups.find((x) => x.id === groupId);
  if (!g || sectionTrade(e, g) === slug) return e;
  const settled = arrangeSections(e);
  const groups = settled.groups.map((x) => (x.id === groupId ? { ...x, trade: slug, sortOrder: 10_000 } : x));
  return arrangeSections({ ...settled, groups });
}

/** Adds an empty section at the end of a trade's sections. */
export function addSection(e: Estimate, name: string, slug?: string): Estimate {
  const sorted = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!slug || !e.trades.includes(slug) || e.trades.length < 2) {
    // Single-trade estimates: unchanged behavior (append, no trade rewrite).
    return { ...e, groups: [...sorted.map((g, i) => (g.sortOrder === i ? g : { ...g, sortOrder: i })), { ...newGroup(name, sorted.length), ...(slug ? { trade: slug } : {}) }] };
  }
  const settled = arrangeSections(e);
  return arrangeSections({ ...settled, groups: [...settled.groups, { ...newGroup(name, 10_000), trade: slug }] });
}

/** Moves a section up or down within its own trade. Sections never jump into another trade this way. */
export function moveSectionWithinTrade(e: Estimate, groupId: string, dir: -1 | 1): Estimate {
  const g = e.groups.find((x) => x.id === groupId);
  if (!g) return e;
  const block = tradeBlocks(e).find((b) => b.groups.some((x) => x.id === groupId));
  if (!block) return e;
  const list = [...block.groups];
  const idx = list.findIndex((x) => x.id === groupId);
  const to = idx + dir;
  if (to < 0 || to >= list.length) return e;
  const orders = list.map((x) => x.sortOrder).sort((a, b) => a - b);
  [list[idx], list[to]] = [list[to], list[idx]];
  const newOrder = new Map(list.map((x, i) => [x.id, orders[i]]));
  return { ...e, groups: e.groups.map((x) => (newOrder.has(x.id) && newOrder.get(x.id) !== x.sortOrder ? { ...x, sortOrder: newOrder.get(x.id)! } : x)) };
}

export interface TradeContents {
  sections: number;
  items: number;
  /** True when removing the trade would lose something the contractor entered. */
  hasData: boolean;
}

/**
 * What a trade's sections hold. Empty template sections hold nothing; line items, section pricing,
 * section descriptions and saved calculations all count as entered data.
 */
export function tradeContents(e: Estimate, slug: string): TradeContents {
  const groups = e.groups.filter((g) => sectionTrade(e, g) === slug);
  const ids = new Set(groups.map((g) => g.id));
  const items = e.items.filter((i) => ids.has(i.groupId) && !i.isExample);
  const calcs = e.worksheet?.calcs ?? {};
  const hasData =
    items.length > 0 ||
    groups.some((g) => g.pricingOverride || (g.description ?? "").trim() || g.visibility) ||
    items.some((i) => calcs[i.id]);
  return { sections: groups.length, items: items.length, hasData: Boolean(hasData) };
}

export interface TradeTotals {
  trade: string;
  cost: Dec;
  price: Dec;
  grossProfit: Dec;
  grossMargin: Dec | null;
  itemCount: number;
  sectionCount: number;
}

/**
 * Per-trade subtotals: the sum of the trade's section totals (pre-adjustment, pre-tax). Because every
 * section belongs to exactly one trade, trade subtotals always add up to the estimate's item price.
 */
export function tradeTotals(e: Pick<Estimate, "trades" | "groups">, totals: Pick<EstimateTotals, "groups">): TradeTotals[] {
  return tradeBlocks(e).map((b) => {
    let cost = new D(0), price = new D(0), itemCount = 0;
    for (const g of b.groups) {
      const gt = totals.groups[g.id];
      if (!gt) continue;
      cost = cost.plus(gt.cost);
      price = price.plus(gt.price);
      itemCount += gt.itemCount;
    }
    return { trade: b.trade, cost, price, grossProfit: price.minus(cost), grossMargin: grossMarginPct(price, cost), itemCount, sectionCount: b.groups.length };
  });
}
