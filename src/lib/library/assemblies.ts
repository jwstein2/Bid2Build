/**
 * Favorites, company templates and scaling assemblies for the Saved Items library (V6 P1-D).
 *
 * A scaling assembly is a Saved Stack with a "measure" (roof squares, wall SF, deck SF, slab SF…). Each
 * row says how much it needs per 1 unit of that measure, plus waste and whether to round up to whole
 * units. Rows without a per-unit amount keep their fixed quantity (a dumpster, a permit). Adding it to
 * an estimate asks for the measure (typed in, or taken from a quantity calculator already applied in
 * the estimate) and copies the scaled rows in. Nothing links back, same as every saved item.
 *
 * Starter assemblies are built in: names, units and starting ratios only, never prices.
 */
import { CALCULATORS } from "../calculators/registry";
import type { CalcId, EstimateWorksheet } from "../calculators/types";
import { D, toDec } from "../estimate/money";
import type { LineItem } from "../estimate/types";
import { UNIT_ABBR } from "../trades/catalog";
import type { SavedItem, SavedStack, StackItem, StackScale } from "./saved-items";
export { SCALE_UNITS, type ScaleUnit } from "./saved-items";


/** Same-dimension conversions (square foot is the base for areas). */
const AREA: Record<string, number> = { "square foot": 1, square: 100, "square yard": 9 };

/** Converts a measurement into the stack's unit, or null when the units don't convert. */
export function convertMeasure(value: string, from: string, to: string): string | null {
  const v = toDec(value);
  if (!v.valid || v.value.isNegative()) return null;
  if (from === to) return v.value.toString();
  if (AREA[from] && AREA[to]) return v.value.times(AREA[from]).div(AREA[to]).toDecimalPlaces(4).toString();
  return null;
}

/** Quantity for one row: measure × per-unit amount × (1 + waste), rounded up to whole units or to 2 places. */
export function scaledQuantity(item: Pick<StackItem, "quantity" | "per" | "wastePct" | "roundUp">, measure: string): string {
  const per = toDec(item.per ?? "");
  if (!item.per || !per.valid) return item.quantity || "1";
  const m = toDec(measure);
  if (!m.valid || m.value.isNegative()) return "0";
  const w = toDec(item.wastePct ?? "");
  const raw = m.value.times(per.value).times(new D(1).plus(w.valid ? w.value.div(100) : 0));
  // Tiny float noise from ratios like 1/350 never forces an extra whole unit.
  if (item.roundUp) return raw.minus("0.000001").ceil().clamp(0, Infinity).toString();
  return raw.toDecimalPlaces(2, D.ROUND_HALF_UP).toString();
}

/** The rows a scaling stack adds for a measure (fixed rows keep their quantity). */
export function scaleStack(stack: SavedStack, measure: string): (StackItem & { quantity: string })[] {
  if (!stack.scale) return stack.items;
  return stack.items.map((i) => ({ ...i, quantity: scaledQuantity(i, measure) }));
}

/** "per 1 SQ" style label for a row. */
export function perLabel(item: Pick<StackItem, "per" | "unit" | "wastePct" | "roundUp" | "quantity">, scale: StackScale | null | undefined): string {
  const u = (x: string) => UNIT_ABBR[x] ?? x;
  if (!scale || !item.per) return `${item.quantity || "1"} ${u(item.unit)}${scale ? " (fixed)" : ""}`;
  const extra = [item.wastePct && Number(item.wastePct) ? `+${Number(item.wastePct)}% waste` : "", item.roundUp ? "round up" : ""].filter(Boolean).join(", ");
  return `${Number(item.per)} ${u(item.unit)} per ${u(scale.unit)}${extra ? ` (${extra})` : ""}`;
}

export interface MeasureOption { label: string; value: string; unit: string; converted: string }

/**
 * Measurements already worked out by quantity calculators in this estimate, converted to the stack's
 * unit. Lets a scaling stack follow the roof or wall area the contractor already measured.
 */
export function calculatorMeasures(estimate: { items: Pick<LineItem, "id" | "name">[]; worksheet?: EstimateWorksheet | null }, unit: string): MeasureOption[] {
  const out: MeasureOption[] = [];
  const seen = new Set<string>();
  for (const [itemId, rec] of Object.entries(estimate.worksheet?.calcs ?? {})) {
    const it = estimate.items.find((i) => i.id === itemId);
    if (!it || !rec?.result) continue;
    // A calculation's exact area, not the rounded package count, when it measured an area.
    const converted = convertMeasure(rec.result, rec.unit, unit);
    if (converted === null) continue;
    const k = `${rec.calc}:${converted}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: `${CALCULATORS[rec.calc as CalcId]?.name ?? "Calculator"} on “${it.name}”`, value: rec.result, unit: rec.unit, converted });
  }
  return out;
}

/** Derives per-unit amounts from a stack's current quantities ("these quantities were for 24 SQ"). */
export function perFromQuantities(items: Pick<StackItem, "quantity">[], measure: string): (string | undefined)[] {
  const m = toDec(measure);
  if (!m.valid || m.value.lte(0)) return items.map(() => undefined);
  return items.map((i) => {
    const q = toDec(i.quantity || "1");
    return q.valid ? q.value.div(m.value).toDecimalPlaces(6).toString() : undefined;
  });
}

type Starter = Omit<SavedStack, "id" | "items"> & { key: string; summary: string; items: (Omit<SavedItem, "id" | "unitCost" | "taxable" | "treatment"> & { per?: string; wastePct?: string; roundUp?: boolean; quantity: string })[] };

const mat = { costType: "material" as const }, lab = { costType: "labor" as const };

/**
 * Built-in starting points for the first five trades, plus per-tree stacks for tree removal and trimming and a perimeter-based pest control plan. Ratios are common rules of thumb, shown as
 * "starting ratios" for the contractor to check and change. No prices: rates come from the contractor.
 */
export const STARTER_ASSEMBLIES: Starter[] = [
  {
    key: "roofing-reroof", name: "Re-roof per square", trade: "roofing", summary: "Tear-off, underlayment, architectural shingles and labor, scaled by roof squares.",
    scale: { unit: "square", label: "Roof area", calc: "roof" },
    items: [
      { ...lab, name: "Tear-off existing roofing", category: "Tear-Off & Disposal", unit: "square", quantity: "1", per: "1" },
      { ...mat, name: "Dumpster and disposal", category: "Tear-Off & Disposal", unit: "each", quantity: "1" },
      { ...mat, name: "Synthetic underlayment", category: "Roofing Materials", unit: "roll", quantity: "1", per: "0.1", wastePct: "10", roundUp: true },
      { ...mat, name: "Architectural shingles", category: "Roofing Materials", unit: "bundle", quantity: "1", per: "3", wastePct: "10", roundUp: true },
      { ...mat, name: "Roofing nails", category: "Roofing Materials", unit: "box", quantity: "1", per: "0.07", roundUp: true },
      { ...lab, name: "Shingle installation labor", category: "Labor", unit: "square", quantity: "1", per: "1" },
    ],
  },
  {
    key: "siding-vinyl", name: "Siding per wall square foot", trade: "siding", summary: "Removal, house wrap, siding panels and labor, scaled by wall area.",
    scale: { unit: "square foot", label: "Wall area", calc: "area" },
    items: [
      { ...lab, name: "Remove existing siding", category: "Removal", unit: "square", quantity: "1", per: "0.01" },
      { ...mat, name: "Disposal", category: "Removal", unit: "each", quantity: "1" },
      { ...mat, name: "House wrap", category: "Siding Materials", unit: "roll", quantity: "1", per: "0.00074", wastePct: "10", roundUp: true },
      { ...mat, name: "Siding panels", category: "Siding Materials", unit: "square", quantity: "1", per: "0.01", wastePct: "10", roundUp: true },
      { ...mat, name: "Fasteners", category: "Siding Materials", unit: "box", quantity: "1", per: "0.0005", roundUp: true },
      { ...lab, name: "Siding installation", category: "Labor", unit: "square", quantity: "1", per: "0.01" },
    ],
  },
  {
    key: "painting-walls", name: "Wall painting, 2 coats", trade: "painting", summary: "Prep, primer, two coats of wall paint and labor, scaled by wall area.",
    scale: { unit: "square foot", label: "Wall area", calc: "area" },
    items: [
      { ...lab, name: "Surface prep and patching", category: "Preparation", unit: "hour", quantity: "1", per: "0.005" },
      { ...mat, name: "Masking and protection", category: "Preparation", unit: "lump sum", quantity: "1" },
      { ...mat, name: "Primer", category: "Materials", unit: "gallon", quantity: "1", per: "0.003333", roundUp: true },
      { ...mat, name: "Wall paint", category: "Materials", unit: "gallon", quantity: "1", per: "0.005714", wastePct: "5", roundUp: true },
      { ...lab, name: "Wall painting", category: "Labor", unit: "square foot", quantity: "1", per: "1" },
    ],
  },
  {
    key: "decks-composite", name: "Composite deck per square foot", trade: "decks", summary: "Footings, joists, hangers, composite boards, fasteners and labor, scaled by deck area.",
    scale: { unit: "square foot", label: "Deck area", calc: "area" },
    items: [
      { ...mat, name: "Concrete footings", category: "Footings & Foundation", unit: "each", quantity: "1", per: "0.02", roundUp: true },
      { ...mat, name: "Joists", category: "Framing Package", unit: "each", quantity: "1", per: "0.0625", wastePct: "5", roundUp: true },
      { ...mat, name: "Joist hangers", category: "Framing Package", unit: "each", quantity: "1", per: "0.125", roundUp: true },
      { ...mat, name: "Composite deck boards", category: "Decking Material Package", unit: "each", quantity: "1", per: "0.132", wastePct: "10", roundUp: true },
      { ...mat, name: "Hidden fastening system", category: "Decking Material Package", unit: "box", quantity: "1", per: "0.02", roundUp: true },
      { ...lab, name: "Framing installation", category: "Labor", unit: "hour", quantity: "1", per: "0.1" },
      { ...lab, name: "Decking installation", category: "Labor", unit: "square foot", quantity: "1", per: "1" },
    ],
  },
  {
    key: "concrete-slab-4in", name: "Concrete slab, 4 inch", trade: "concrete", summary: "Subgrade, mesh, ready-mix, finishing, joints and curing, scaled by slab area.",
    scale: { unit: "square foot", label: "Slab area", calc: "area" },
    items: [
      { ...lab, name: "Subgrade preparation", category: "Site Preparation", unit: "square foot", quantity: "1", per: "1" },
      { ...mat, name: "Wire mesh", category: "Forms & Reinforcement", unit: "sheet", quantity: "1", per: "0.02", wastePct: "10", roundUp: true },
      { ...mat, name: "Ready-mix concrete", category: "Concrete", unit: "cubic yard", quantity: "1", per: "0.012346", wastePct: "5" },
      { ...lab, name: "Placing and finishing", category: "Finishing", unit: "square foot", quantity: "1", per: "1" },
      { ...lab, name: "Control joints", category: "Finishing", unit: "linear foot", quantity: "1", per: "0.2" },
      { ...mat, name: "Curing compound", category: "Finishing", unit: "gallon", quantity: "1", per: "0.005", roundUp: true },
    ],
  },
  {
    key: "tree-removal-per-tree", name: "Tree removal with stump grinding", trade: "tree-removal", summary: "Removal, stump grinding, log and chip haul-away and cleanup, scaled by the number of trees.",
    scale: { unit: "each", label: "Trees" },
    items: [
      { ...lab, name: "Medium tree removal (30 to 60 ft)", category: "Tree Removal", unit: "each", quantity: "1", per: "1" },
      { ...lab, name: "Stump grinding", category: "Stump Work", unit: "each", quantity: "1", per: "1" },
      { costType: "other", name: "Log hauling", category: "Wood & Debris", unit: "load", quantity: "1", per: "0.5", roundUp: true },
      { costType: "other", name: "Wood chip haul-away", category: "Wood & Debris", unit: "load", quantity: "1", per: "0.5", roundUp: true },
      { ...lab, name: "Site cleanup and raking", category: "Wood & Debris", unit: "lump sum", quantity: "1" },
    ],
  },
  {
    key: "tree-trimming-per-tree", name: "Tree pruning visit", trade: "tree-trimming", summary: "Crown cleaning, brush haul-away and cleanup, scaled by the number of trees.",
    scale: { unit: "each", label: "Trees" },
    items: [
      { ...lab, name: "Crown cleaning (deadwood removal)", category: "Pruning", unit: "each", quantity: "1", per: "1" },
      { costType: "other", name: "Brush and debris haul-away", category: "Cleanup & Haul-Away", unit: "load", quantity: "1", per: "0.25", roundUp: true },
      { ...lab, name: "Site cleanup and raking", category: "Cleanup & Haul-Away", unit: "lump sum", quantity: "1" },
    ],
  },
  {
    key: "pest-control-initial-quarterly", name: "Initial treatment + quarterly plan", trade: "pest-control", summary: "Inspection, perimeter and crack-and-crevice treatment, products and four quarterly visits, scaled by the treated perimeter.",
    scale: { unit: "linear foot", label: "Treated perimeter", calc: "perimeter" },
    items: [
      { ...lab, name: "Pest inspection", category: "Inspection", unit: "each", quantity: "1" },
      { ...lab, name: "Exterior perimeter treatment", category: "General Pest Treatment", unit: "linear foot", quantity: "1", per: "1" },
      { ...lab, name: "Crack and crevice treatment", category: "General Pest Treatment", unit: "each", quantity: "1" },
      { ...mat, name: "Treatment products", category: "General Pest Treatment", unit: "lump sum", quantity: "1" },
      { ...lab, name: "Quarterly service visit", category: "Service Plans", unit: "each", quantity: "4" },
    ],
  },
];

/** A starter as a Saved Stack (fresh ids, blank rates) ready to save or add. */
export function starterStack(s: Starter, newId: () => string = () => crypto.randomUUID()): SavedStack {
  return {
    id: newId(), name: s.name, trade: s.trade, scale: s.scale, starterKey: s.key,
    items: s.items.map((i) => ({ ...i, id: newId(), unitCost: "", taxable: i.costType !== "labor", treatment: "marked_up" as const })),
  };
}

/** Starter assemblies for a section's trade first, then the rest. */
export function startersFor(trade: string | null | undefined): Starter[] {
  return [...STARTER_ASSEMBLIES].sort((a, b) => Number(b.trade === trade) - Number(a.trade === trade));
}
