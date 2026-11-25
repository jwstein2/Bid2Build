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
import type { CostType, EstimateGroup, LineItem, Estimate, PricingRule } from "../estimate/types";
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
  /**
   * Optional markup or margin kept with the item (e.g. 0% markup on a dumpster). null/missing = use the
   * bid's pricing, which is how every item saved before 2026-11-21 behaves. Stored in
   * saved_items.pricing_override / assembly_items.pricing_override (SQL 20270219001000).
   */
  pricingOverride?: PricingRule | null;
  /** How many of the contractor's recent estimate rows use this item's name (read-only, for ordering). */
  uses?: number;
  /** Where the saved price came from (read-only here; set by supplier imports). */
  supplierName?: string | null;
  supplierSku?: string | null;
  priceSource?: "manual" | "supplier_import" | "supplier_quote" | "api" | null;
  priceEffectiveOn?: string | null;
  /** Starred by this user: shown first in the builder's picker (quick add). */
  favorite?: boolean;
}

/** What a scaling stack is measured by (roof squares, wall SF…), and the calculator that measures it. */
export const SCALE_UNITS = ["square", "square foot", "square yard", "linear foot", "cubic yard", "each"] as const;
export type ScaleUnit = (typeof SCALE_UNITS)[number];
export interface StackScale { unit: ScaleUnit; label: string; calc?: string | null }

/** A stack row. With a scale, `per` is the amount per 1 unit of the measure; rows without `per` stay fixed. */
export type StackItem = SavedItem & { quantity: string; per?: string; wastePct?: string; roundUp?: boolean };

export interface SavedStack {
  id: string;
  name: string;
  trade?: string | null;
  items: StackItem[];
  favorite?: boolean;
  /** Set for a scaling assembly. */
  scale?: StackScale | null;
  /** Shared with the whole company (a company template). */
  company?: boolean;
  /** This user may change or delete it (own stack, or company template with pricing permission). */
  canEdit?: boolean;
  /** Built-in starter it was copied from. */
  starterKey?: string | null;
}

export interface LibraryData {
  /** True while the account may use the whole library (Unlimited or admin): stacks, favorites, price imports. */
  access: boolean;
  /** True when the account may save and edit its own Saved Items (every plan once SQL 20270106001000 ran). */
  itemsAccess?: boolean;
  /** Entries kept for an account without access (shown as "kept for you", never deleted). */
  lockedCount: number;
  items: SavedItem[];
  stacks: SavedStack[];
  /** Company minimum gross margin %, or null when not set. The builder warns below it. */
  targetMarginPct?: string | null;
  /** May share stacks as company templates (company pricing permission). */
  canShare?: boolean;
}

export const EMPTY_LIBRARY: LibraryData = { access: false, itemsAccess: false, lockedCount: 0, items: [], stacks: [], targetMarginPct: null, canShare: false };

/** Free accounts may keep this many saved items (enforced in the database). Unlimited has no cap. */
export const FREE_SAVED_ITEMS_LIMIT = 250;
/** Shown wherever a free account saves an item. */
export const FREE_ITEMS_KEPT_NOTE = "Your saved items stay with you when you upgrade to Individual Unlimited.";

export const LIBRARY_LOCKED_MESSAGE = "Premium Only — Save your preferred labor rates, material prices, and frequently used estimating items.";

/** Matches the database check on saved_items.pricing_override (SQL 20270219001000). */
const OVERRIDE_PERCENT = /^\d{1,4}(\.\d{1,4})?$/;
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
  pricingOverride: z.object({ mode: z.enum(["markup", "margin"]), percent: z.string().trim().regex(OVERRIDE_PERCENT, "Enter a percent (up to 4 decimals)") })
    .refine((r) => (r.mode === "margin" ? Number(r.percent) < 100 && Number(r.percent) >= 0 : Number(r.percent) >= 0 && Number(r.percent) <= 1000), { message: "Markup 0 to 1000%, margin 0 to 99.99%", path: ["percent"] })
    .nullable().optional(),
});

const per = z.string().trim().max(20).regex(/^\d*(\.\d{0,6})?$/, "Enter a number").optional();
const waste = z.string().trim().max(6).regex(/^(\d{1,2}(\.\d{1,2})?|100)?$/, "0 to 100").optional();
export const stackScaleSchema = z.object({
  unit: z.enum(SCALE_UNITS),
  label: z.string().trim().min(1).max(120),
  calc: z.string().max(40).nullable().optional(),
});
const stackItemSchema = savedItemSchema.extend({ quantity: dec, per, wastePct: waste, roundUp: z.boolean().optional() });

export const savedStackSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  trade: z.string().max(60).nullable().optional(),
  items: z.array(stackItemSchema).min(1).max(200),
  scale: stackScaleSchema.nullable().optional(),
  starterKey: z.string().max(60).nullable().optional(),
  /** Save straight to the company as a template. */
  company: z.boolean().optional(),
});

export const libraryOpSchema = z.union([
  z.object({ kind: z.literal("item"), action: z.enum(["add", "update"]), payload: savedItemSchema }),
  z.object({ kind: z.literal("item"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("add"), payload: savedStackSchema }),
  /** Replace a stack's name, trade, scaling and rows (built on Saved Items & Pricing). Sharing stays its own action. */
  z.object({ kind: z.literal("stack"), action: z.literal("update"), payload: savedStackSchema.omit({ company: true, starterKey: true }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("rename"), payload: z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200) }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ kind: z.enum(["item", "stack"]), action: z.literal("favorite"), payload: z.object({ id: z.string().uuid(), on: z.boolean() }) }),
  z.object({ kind: z.literal("stack"), action: z.literal("share"), payload: z.object({ id: z.string().uuid(), on: z.boolean() }) }),
  z.object({
    kind: z.literal("stack"), action: z.literal("scale"),
    payload: z.object({ id: z.string().uuid(), scale: stackScaleSchema.nullable(), items: z.array(z.object({ id: z.string().uuid(), per, wastePct: waste, roundUp: z.boolean().optional() })).max(200) }),
  }),
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
    // The row's own markup/margin (not a section's or the bid's) is part of the item; bill-at-cost rows have none.
    pricingOverride: savedOverride(item),
  };
}

/** The item-level markup/margin a saved item keeps: only on marked-up rows with a valid percent. */
export function savedOverride(item: Pick<LineItem, "treatment" | "pricingOverride">): PricingRule | null {
  const o = item.pricingOverride;
  if (!o || item.treatment === "pass_through" || !OVERRIDE_PERCENT.test(o.percent.trim())) return null;
  const n = Number(o.percent);
  if (o.mode === "margin" ? n >= 100 : n > 1000) return null;
  return { mode: o.mode, percent: o.percent.trim() };
}

/** Short label for a saved item's own pricing ("0% markup", "30% margin"), or null when it follows the bid. */
export function overrideLabel(s: Pick<SavedItem, "treatment" | "pricingOverride">): string | null {
  const o = savedOverride({ treatment: s.treatment, pricingOverride: s.pricingOverride ?? null });
  return o ? `${Number(o.percent)}% ${o.mode}` : null;
}

/**
 * A stack row copied from a Saved Item (built on Saved Items & Pricing, no estimate needed). Values are
 * copied like everywhere else: editing the saved item later doesn't change the stack.
 */
export function stackRowFromSaved(s: SavedItem, id: string = crypto.randomUUID()): StackItem {
  return {
    id, name: s.name, description: s.description, trade: s.trade ?? null, category: s.category,
    costType: s.costType, treatment: s.treatment, unit: s.unit, unitCost: s.unitCost, taxable: s.taxable,
    pricingOverride: savedOverride({ treatment: s.treatment, pricingOverride: s.pricingOverride ?? null }),
    quantity: s.quantity && s.quantity.trim() ? s.quantity.trim() : "1",
  };
}

/** Problems that stop a stack built on the library page from saving, or [] when it can be saved. */
export function stackDraftProblems(d: { name: string; items: Pick<StackItem, "quantity" | "per" | "wastePct">[]; scale?: StackScale | null }): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Give the stack a name.");
  if (!d.items.length) out.push("Add at least one saved item.");
  if (d.items.length > 200) out.push("A stack can hold up to 200 items.");
  if (d.scale && !d.scale.label.trim()) out.push("Name the measurement the stack scales by.");
  if (d.items.some((i) => !/^\d*(\.\d*)?$/.test(i.quantity.trim()) || (i.quantity.trim() !== "" && Number(i.quantity) <= 0))) out.push("Quantities must be numbers above 0.");
  if (d.scale && d.items.some((i) => (i.per && !/^\d*(\.\d{0,6})?$/.test(i.per)) || (i.wastePct && !/^(\d{1,2}(\.\d{1,2})?|100)$/.test(i.wastePct)))) out.push("Use numbers only for amount per unit and waste (waste 0 to 100).");
  return out;
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
    // Saved items without their own markup keep following the bid (and the section's override, if any).
    pricingOverride: savedOverride({ treatment: s.treatment, pricingOverride: s.pricingOverride ?? null }),
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
        .map((c) => ({ ...c, items: [...c.items].sort(byUse) }));
      return { trade: t || null, name: t ? tradeName(t) : "General", categories, count: list.length };
    });
}

/** Most-used first, then by name: "Frequently used" items lead the library and the builder picker. */
export const byUse = (a: Pick<SavedItem, "uses" | "name">, b: Pick<SavedItem, "uses" | "name">) => (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name);

/** Items used at least twice recently, most-used first (the "Frequently used" shortcut). */
export const frequentItems = (items: SavedItem[], max = 6) => items.filter((i) => (i.uses ?? 0) >= 2).sort(byUse).slice(0, max);

/** Count recent estimate rows per saved-item name (case-insensitive). */
export function usageCounts(rowNames: (string | null | undefined)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of rowNames) { const k = key(n); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
export const usesFor = (counts: Map<string, number>, name: string) => counts.get(key(name)) ?? 0;

/** Matches a search box against name, category, trade and description. */
export function matchesQuery(i: Pick<SavedItem, "name" | "category" | "trade" | "description">, q: string): boolean {
  const s = key(q);
  if (!s) return true;
  return [i.name, i.category, i.trade ? tradeName(i.trade) : "", i.description].some((v) => key(v).includes(s));
}
