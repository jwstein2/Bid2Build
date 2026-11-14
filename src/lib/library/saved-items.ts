/**
 * Saved Items & Pricing Library (premium). Pure helpers shared by the API route, the builder's
 * "Suggested & Saved Items" picker and the dashboard library page.
 *
 * Storage (unchanged tables, no renames): a Saved Item is a public.saved_items row; a Saved Stack is
 * a public.assemblies row with its public.assembly_items. "Assembly" stays the internal name only.
 *
 * Pricing rule: a saved item's values are COPIED into an estimate when it is added. Estimates never
 * reference library rows, so editing or deleting a saved item can't change an existing estimate or an
 * issued proposal.
 */
import { z } from "zod";
import { lineItemSchema } from "../estimate/schema";
import type { CostType, EstimateGroup, LineItem, Estimate } from "../estimate/types";
import { getTrade, tradeName } from "../trades/catalog";
import { sectionTrade } from "../estimate/trades";

export interface SavedItem {
  id: string;
  name: string;
  description?: string;
  /** Trade slug the item is filed under (null = general). */
  trade?: string | null;
  /** Category inside the trade, normally one of the trade's section names ("Tear Off", "Labor"…). */
  category?: string;
  costType: CostType;
  treatment: LineItem["treatment"];
  /** Default quantity when added ("" = 1). */
  quantity?: string;
  unit: string;
  /** Default rate (internal unit cost). "" = no saved price. */
  unitCost: string;
  taxable: boolean;
}

export interface SavedStack {
  id: string;
  name: string;
  trade?: string | null;
  items: (SavedItem & { quantity: string })[];
}

export interface LibraryData {
  /** True while the account may use the library (Unlimited or admin). */
  access: boolean;
  /** Entries kept for an account without access (shown as "kept for you", never deleted). */
  lockedCount: number;
  items: SavedItem[];
  stacks: SavedStack[];
}

export const EMPTY_LIBRARY: LibraryData = { access: false, lockedCount: 0, items: [], stacks: [] };

export const LIBRARY_LOCKED_MESSAGE = "Premium Only — Save your preferred labor rates, material prices, and frequently used estimating items.";

const dec = z.string().trim().max(20).regex(/^\d*(\.\d*)?$/, "Enter a number").or(z.literal(""));
const optText = (max: number) => z.string().max(max).optional();

export const savedItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(300),
  description: optText(4000),
  trade: z.string().max(60).nullable().optional(),
  category: optText(120),
  costType: lineItemSchema.shape.costType,
  treatment: z.enum(["marked_up", "pass_through"]),
  quantity: dec.optional(),
  unit: z.string().trim().min(1).max(40),
  unitCost: dec,
  taxable: z.boolean(),
});

export const savedStackSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  trade: z.string().max(60).nullable().optional(),
  items: z.array(savedItemSchema.extend({ quantity: dec })).min(1).max(200),
});

export const libraryOpSchema = z.union([
  z.object({ kind: z.literal("item"), action: z.enum(["add", "update"]), payload: savedItemSchema }),
  z.object({ kind: z.literal("item"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("add"), payload: savedStackSchema }),
  z.object({ kind: z.literal("stack"), action: z.literal("rename"), payload: z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200) }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
]);
export type LibraryOp = z.infer<typeof libraryOpSchema>;

const clean = (s?: string | null) => (s && s.trim() ? s.trim() : undefined);

/** A Saved Item built from an estimate row: name, type, unit, rate and quantity, filed under the row's trade and section. */
export function savedItemFromLine(item: LineItem, ctx: { trade?: string | null; category?: string | null }, id: string): SavedItem {
  return {
    id,
    name: item.name.trim(),
    description: clean(item.description),
    trade: ctx.trade ?? null,
    category: clean(item.category) ?? clean(ctx.category),
    costType: item.costType,
    treatment: item.treatment,
    quantity: clean(item.quantity),
    unit: item.unit,
    unitCost: item.unitCost.trim(),
    taxable: item.taxable,
  };
}

/** Trade and section of an estimate row, for filing it in the library. */
export function lineContext(estimate: Pick<Estimate, "trades" | "groups">, group: EstimateGroup | undefined): { trade: string | null; category: string | null } {
  if (!group) return { trade: estimate.trades[0] ?? null, category: null };
  return { trade: sectionTrade(estimate, group) ?? estimate.trades[0] ?? null, category: clean(group.name) ?? null };
}

const key = (s?: string | null) => (s ?? "").trim().toLowerCase();

/** The existing saved item that "Save Item" should update instead of duplicating (same name in the same trade). */
export function findSameItem(items: SavedItem[], candidate: Pick<SavedItem, "name" | "trade">): SavedItem | undefined {
  return items.find((x) => key(x.name) === key(candidate.name) && key(x.trade) === key(candidate.trade));
}

/** Line-item fields to add a saved item to an estimate: the saved rate becomes the default; nothing links back. */
export function lineFromSaved(s: SavedItem): Partial<LineItem> {
  return {
    name: s.name,
    description: s.description ?? "",
    category: s.category,
    costType: s.costType,
    treatment: s.treatment,
    quantity: s.quantity && s.quantity.trim() ? s.quantity : "1",
    unit: s.unit,
    unitCost: s.unitCost,
    taxable: s.taxable,
  };
}

/** Category suggestions for a trade: its existing estimate sections plus categories already used in the library. */
export function categoryOptions(trade: string | null | undefined, items: SavedItem[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (c?: string) => { const k = key(c); if (c && k && !seen.has(k)) { seen.add(k); out.push(c.trim()); } };
  if (trade) for (const g of getTrade(trade)?.template.groups ?? []) push(g.name);
  push("Labor");
  push("Materials");
  for (const i of items) if (key(i.trade) === key(trade)) push(i.category);
  return out;
}

export interface LibraryCategory { name: string; items: SavedItem[] }
export interface LibraryTrade { trade: string | null; name: string; categories: LibraryCategory[]; count: number }

/**
 * Items organized by trade, then category. Trades and categories follow the trade template's section
 * order (so Roofing reads Tear Off, Underlayment, Shingles…), then anything custom alphabetically.
 */
export function organizeLibrary(items: SavedItem[], preferTrades: string[] = []): LibraryTrade[] {
  const byTrade = new Map<string, SavedItem[]>();
  for (const i of items) {
    const t = i.trade ?? "";
    byTrade.set(t, [...(byTrade.get(t) ?? []), i]);
  }
  const tradeOrder = (t: string) => {
    const p = preferTrades.indexOf(t);
    return p >= 0 ? `0${String(p).padStart(3, "0")}` : t ? `1${tradeName(t).toLowerCase()}` : "2";
  };
  return [...byTrade.entries()]
    .sort(([a], [b]) => tradeOrder(a).localeCompare(tradeOrder(b)))
    .map(([t, list]) => {
      const sections = (t ? getTrade(t)?.template.groups ?? [] : []).map((g) => key(g.name));
      const byCat = new Map<string, LibraryCategory>();
      for (const i of list) {
        const name = clean(i.category) ?? "Uncategorized";
        const k = key(name);
        if (!byCat.has(k)) byCat.set(k, { name, items: [] });
        byCat.get(k)!.items.push(i);
      }
      const catOrder = (c: LibraryCategory) => {
        const k = key(c.name);
        const p = sections.indexOf(k);
        return p >= 0 ? `0${String(p).padStart(3, "0")}` : k === "uncategorized" ? "2" : `1${k}`;
      };
      const categories = [...byCat.values()]
        .sort((a, b) => catOrder(a).localeCompare(catOrder(b)))
        .map((c) => ({ ...c, items: [...c.items].sort((a, b) => a.name.localeCompare(b.name)) }));
      return { trade: t || null, name: t ? tradeName(t) : "General", categories, count: list.length };
    });
}

/** Matches a search box against name, category, trade and description. */
export function matchesQuery(i: Pick<SavedItem, "name" | "category" | "trade" | "description">, q: string): boolean {
  const s = key(q);
  if (!s) return true;
  return [i.name, i.category, i.trade ? tradeName(i.trade) : "", i.description].some((v) => key(v).includes(s));
}
