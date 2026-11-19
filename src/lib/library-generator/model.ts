/**
 * "Generate My Price Library" (V8.6): shared types and the deterministic rules.
 *
 * The AI only proposes WHAT a contractor might stock in their library (names, categories, units,
 * notes, optional stacks). Everything here is plain code: duplicate detection against the contractor's
 * own Saved Items, where a cost may come from, the approval preview and stack checks. No function in
 * this file calls a model, and no price is ever invented: a cost is the contractor's own Saved Item or
 * supplier price, a past estimate cost they accept, a number they type, or blank ("Cost not set").
 */
import { z } from "zod";
import type { CostType } from "../estimate/types";
import type { SavedItem } from "../library/saved-items";
import { SCALE_UNITS, type ScaleUnit } from "../library/saved-items";
import { nameSimilarity, nameTokens } from "../ai-draft/resolve";
import { normalizeUnit } from "../pricing/provider";
import { UNITS } from "../trades/catalog";

export const GENERATOR_VERSION = "library-gen-v1";

export const DRAFT_STATUSES = ["generating", "draft", "under_review", "partially_approved", "approved", "archived", "failed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  generating: "Generating", draft: "Draft", under_review: "Under review", partially_approved: "Partially approved",
  approved: "Approved", archived: "Archived", failed: "Didn't finish",
};

export const ITEM_COST_TYPES = ["material", "labor", "labor_material", "equipment", "subcontractor", "permit", "delivery", "other"] as const satisfies readonly CostType[];
export type ItemCostType = (typeof ITEM_COST_TYPES)[number];

export const ITEM_STATUSES = ["candidate", "approved", "template", "matched", "merged", "updated", "removed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
/** Statuses that mean the candidate is done (already in, or linked to, the library). */
export const DONE_STATUSES: readonly ItemStatus[] = ["approved", "template", "matched", "merged", "updated"];

export const COST_SOURCES = ["none", "contractor", "saved_item", "supplier_import", "history"] as const;
export type CostSource = (typeof COST_SOURCES)[number];
export const COST_SOURCE_LABEL: Record<CostSource, string> = {
  none: "Cost not set",
  contractor: "Your cost",
  saved_item: "From your Saved Items",
  supplier_import: "From your supplier price list",
  history: "From your past estimates",
};

export const DUPLICATE_ACTIONS = ["keep_existing", "add_separate", "update_existing", "merge"] as const;
export type DuplicateAction = (typeof DUPLICATE_ACTIONS)[number];
export const DUPLICATE_ACTION_LABEL: Record<DuplicateAction, string> = {
  keep_existing: "Keep my existing item",
  add_separate: "Add as a separate item",
  update_existing: "Update my existing item",
  merge: "Fill in missing details only",
};

export const GENERATE_FOCUS = ["catalog", "more", "materials", "labor", "equipment", "assemblies", "alternatives"] as const;
export type GenerateFocus = (typeof GENERATE_FOCUS)[number];
export const FOCUS_LABEL: Record<GenerateFocus, string> = {
  catalog: "Starting catalog", more: "More items", materials: "Expand material options", labor: "Add labor",
  equipment: "Add equipment", assemblies: "Add stacks", alternatives: "Alternative materials and methods",
};

export interface DraftItem {
  id: string;
  name: string;
  description: string;
  trade: string | null;
  category: string;
  costType: ItemCostType;
  unit: string;
  /** "" = Cost not set. */
  unitCost: string;
  costSource: CostSource;
  costSourceNote: string;
  /** A past estimate cost the contractor may accept with one tap. Never applied automatically. */
  suggestedCost: string;
  suggestedNote: string;
  supplierSku: string;
  notes: string;
  conditions: string[];
  optional: boolean;
  confidence: "low" | "medium" | "high";
  verifyNote: string;
  taxable: boolean;
  status: ItemStatus;
  duplicateOf: string | null;
  duplicateLevel: "exact" | "possible" | null;
  duplicateReason: string;
  duplicateAction: DuplicateAction | null;
  savedItemId: string | null;
  batch: number;
  sortOrder: number;
}

export interface StackComponent {
  itemId: string;
  /** Amount per 1 unit of the stack's measure. Blank = fixed quantity. */
  per: string;
  /** Fixed quantity (used when `per` is blank). */
  quantity: string;
  wastePct: string;
  roundUp: boolean;
  optional: boolean;
  note: string;
}

export interface DraftStack {
  id: string;
  name: string;
  trade: string | null;
  scaleUnit: ScaleUnit | null;
  scaleLabel: string;
  scaleCalc: string | null;
  assumptions: string[];
  components: StackComponent[];
  status: "candidate" | "approved" | "removed";
  assemblyId: string | null;
  sortOrder: number;
}

export interface LibraryDraft {
  id: string;
  title: string;
  prompt: string;
  trades: string[];
  mode: "catalog" | "scope";
  status: DraftStatus;
  notes: string[];
  lastError: string | null;
  generationCount: number;
  approvedItems: number;
  approvedStacks: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftDetail { draft: LibraryDraft; items: DraftItem[]; stacks: DraftStack[] }

export interface DraftSummaryRow extends LibraryDraft { itemCount: number; candidateCount: number }

// ── Input validation (shared by the API and the browser) ─────────────────────────────────────────────

export const GENERATE_LIMITS = { prompt: 2000, trades: 4, avoidNames: 150, category: 120 } as const;

const dec = z.string().trim().max(20).regex(/^\d*(\.\d{0,4})?$/, "Enter a number").or(z.literal(""));

export const generateRequestSchema = z.strictObject({
  /** Continue an existing draft (more items, a category, labor…). Omit to start a new draft. */
  draftId: z.string().uuid().optional(),
  prompt: z.string().trim().max(GENERATE_LIMITS.prompt).default(""),
  trades: z.array(z.string().max(60)).max(GENERATE_LIMITS.trades).default([]),
  focus: z.enum(GENERATE_FOCUS).default("catalog"),
  /** Limit the batch to one category ("Formwork") — more items, or regenerate it. */
  category: z.string().trim().max(GENERATE_LIMITS.category).optional(),
  /** Replace the candidates of `category` that haven't been approved or edited. */
  regenerate: z.boolean().optional(),
  /** Start from one of the contractor's own bids (names and sections only, no prices or customer). */
  estimateId: z.string().uuid().optional(),
  /** Generate again even if the same request ran in the last 24 hours. */
  force: z.boolean().optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const itemPatchSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required").max(300).optional(),
  description: z.string().max(4000).optional(),
  trade: z.string().max(60).nullable().optional(),
  category: z.string().trim().min(1).max(120).optional(),
  costType: z.enum(ITEM_COST_TYPES).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  unitCost: dec.optional(),
  /** "accept_suggestion" copies the suggested past cost in, keeping its attribution. */
  costAction: z.enum(["accept_suggestion", "clear"]).optional(),
  supplierSku: z.string().trim().max(80).optional(),
  notes: z.string().max(1000).optional(),
  taxable: z.boolean().optional(),
  duplicateAction: z.enum(DUPLICATE_ACTIONS).nullable().optional(),
  /** Soft removal (kept for history, never shown in the library or the builder). */
  removed: z.boolean().optional(),
});
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const stackPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  scaleUnit: z.enum(SCALE_UNITS).nullable().optional(),
  scaleLabel: z.string().trim().max(120).optional(),
  components: z.array(z.strictObject({
    itemId: z.string().uuid(),
    per: z.string().trim().max(20).regex(/^\d*(\.\d{0,6})?$/).or(z.literal("")),
    quantity: dec,
    wastePct: z.string().trim().max(6).regex(/^(\d{1,2}(\.\d{1,2})?|100)?$/),
    roundUp: z.boolean(),
    optional: z.boolean(),
    note: z.string().max(200),
  })).max(40).optional(),
  removed: z.boolean().optional(),
});
export type StackPatch = z.infer<typeof stackPatchSchema>;

export const approveRequestSchema = z.strictObject({
  requestKey: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).max(1000),
  stackIds: z.array(z.string().uuid()).max(100).default([]),
  /** Also save unpriced candidates, clearly marked as Unpriced Templates. */
  templates: z.boolean().default(false),
  /** Save approved stacks as company templates (needs the company pricing permission). */
  shareStacks: z.boolean().default(false),
});
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

// ── Units and names ───────────────────────────────────────────────────────────────────────────────

const UNIT_SET = new Set<string>(UNITS);
/** A unit as one of Built2Bid's units when it maps to one ("SF", "sq ft" → "square foot"); otherwise trimmed as typed. */
export function canonicalUnit(u: string): string {
  const n = normalizeUnit(u);
  return UNIT_SET.has(n) ? n : u.trim();
}

/** Normalized item name for exact duplicate checks: lowercase, inch marks unified, filler words and plurals dropped, sorted. */
export function normalizedName(name: string): string {
  const s = name.toLowerCase()
    .replace(/(\d)\s*(?:"|''|”|inches|inch|in\.)(?=\W|$)/g, "$1 in")
    .replace(/(\d)\s*(?:'|’|feet|foot|ft\.)(?=\W|$)/g, "$1 ft")
    .replace(/(\d)-(in|ft)\b/g, "$1 $2");
  return [...nameTokens(s)].sort().join(" ");
}

/** Material spec numbers in a name ("4 in", "#4", "3000 psi", "6x6"): two items with different specs aren't duplicates. */
export function specTokens(name: string): string[] {
  const n = normalizedName(name).split(" ");
  return n.filter((w) => /\d/.test(w)).sort();
}

export interface DuplicateMatch { savedItemId: string; level: "exact" | "possible"; reason: string; savedItem: SavedItem }

const isLaborish = (t: string) => t === "labor" || t === "labor_material";

/**
 * The contractor's existing Saved Item a candidate duplicates, by normalized name and structured
 * attributes (unit, trade, cost type, spec numbers, supplier SKU). Never by AI similarity alone:
 *   exact    — same SKU, or same normalized name and unit in the same (or no) trade.
 *   possible — same name but a different unit, or very similar names with the same unit and specs.
 */
export function findDuplicate(c: Pick<DraftItem, "name" | "unit" | "trade" | "costType" | "supplierSku">, items: SavedItem[]): DuplicateMatch | null {
  const sku = c.supplierSku.trim().toLowerCase();
  const nm = normalizedName(c.name);
  const unit = normalizeUnit(c.unit);
  const specs = specTokens(c.name).join(" ");
  let possible: DuplicateMatch | null = null;
  let bestSim = 0;
  for (const it of items) {
    if (sku && it.supplierSku && it.supplierSku.trim().toLowerCase() === sku) return { savedItemId: it.id, level: "exact", reason: `Same supplier SKU (${it.supplierSku})`, savedItem: it };
    const tradeOk = !c.trade || !it.trade || it.trade === c.trade;
    if (!tradeOk) continue;
    const sameUnit = normalizeUnit(it.unit) === unit;
    const itName = normalizedName(it.name);
    if (itName === nm && nm) {
      if (sameUnit) return { savedItemId: it.id, level: "exact", reason: "Same name and unit", savedItem: it };
      if (!possible || possible.reason !== "Same name, different unit") possible = { savedItemId: it.id, level: "possible", reason: `Same name, different unit (yours is ${it.unit})`, savedItem: it };
      continue;
    }
    if (!sameUnit || isLaborish(it.costType) !== isLaborish(c.costType)) continue;
    if (specTokens(it.name).join(" ") !== specs) continue;
    const sim = nameSimilarity(c.name, it.name);
    if (sim >= 0.8 && sim > bestSim && !possible?.reason.startsWith("Same name")) {
      bestSim = sim;
      possible = { savedItemId: it.id, level: "possible", reason: "Very similar name and same unit", savedItem: it };
    }
  }
  return possible;
}

// ── Where a cost may come from ────────────────────────────────────────────────────────────────────

export interface HistoryRow { name: string; unit: string; unitCost: number; costType: string; updatedAt: string; trades: string[] }

export const HISTORY_MAX_AGE_DAYS = 548; // about 18 months

/**
 * A comparable cost from the contractor's own past estimates: same normalized name, same unit,
 * compatible cost type and trade, from the last 18 months. Returns the median of up to the five most
 * recent rows, with where it came from. A suggestion only: the contractor accepts it or not.
 */
export function historySuggestion(c: Pick<DraftItem, "name" | "unit" | "costType" | "trade">, rows: HistoryRow[], now = new Date()): { cost: string; note: string } | null {
  const nm = normalizedName(c.name);
  const unit = normalizeUnit(c.unit);
  const cutoff = now.getTime() - HISTORY_MAX_AGE_DAYS * 86_400_000;
  const hits = rows
    .filter((r) => r.unitCost > 0 && normalizedName(r.name) === nm && normalizeUnit(r.unit) === unit
      && isLaborish(r.costType) === isLaborish(c.costType)
      && (!c.trade || !r.trades.length || r.trades.includes(c.trade))
      && Date.parse(r.updatedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 5);
  if (!hits.length) return null;
  const vals = hits.map((h) => h.unitCost).sort((a, b) => a - b);
  const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const last = new Date(hits[0].updatedAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return {
    cost: (Math.round(mid * 100) / 100).toFixed(2),
    note: `${hits.length === 1 ? "Used on 1 of your estimates" : `Median of ${hits.length} of your estimates`}, last ${last}. Check it's still current.`,
  };
}

/**
 * Cost for a fresh candidate, in the required order: (1) the contractor's own approved Saved Item,
 * (2) their supplier price list (also stored as Saved Items, marked supplier_import), (3) a past
 * estimate cost — only as a suggestion, (4) a licensed pricing source — none is connected, so this
 * step is skipped, (5) unknown: blank, "Cost not set".
 */
export function initialCost(dup: DuplicateMatch | null, history: { cost: string; note: string } | null): Pick<DraftItem, "unitCost" | "costSource" | "costSourceNote" | "suggestedCost" | "suggestedNote"> {
  const base = { suggestedCost: history?.cost ?? "", suggestedNote: history?.note ?? "" };
  if (dup?.level === "exact" && dup.savedItem.unitCost) {
    const supplier = dup.savedItem.priceSource === "supplier_import";
    return {
      ...base,
      unitCost: dup.savedItem.unitCost,
      costSource: supplier ? "supplier_import" : "saved_item",
      costSourceNote: supplier ? `${dup.savedItem.supplierName ?? "Supplier"} price list${dup.savedItem.priceEffectiveOn ? `, ${dup.savedItem.priceEffectiveOn}` : ""}` : `Your Saved Item “${dup.savedItem.name}”`,
    };
  }
  return { ...base, unitCost: "", costSource: "none", costSourceNote: "" };
}

// ── Review state ──────────────────────────────────────────────────────────────────────────────────

export const isPriced = (i: Pick<DraftItem, "unitCost">) => i.unitCost.trim() !== "" && Number(i.unitCost) >= 0;
export const needsDuplicateChoice = (i: Pick<DraftItem, "duplicateOf" | "duplicateAction">) => Boolean(i.duplicateOf && !i.duplicateAction);

export type ItemReadiness = "ready" | "needs_cost" | "duplicate" | "invalid" | "done" | "removed";

/** What still stands between a candidate and approval. */
export function readiness(i: DraftItem): ItemReadiness {
  if (i.status === "removed") return "removed";
  if (DONE_STATUSES.includes(i.status)) return "done";
  if (!i.name.trim() || !i.unit.trim() || !i.category.trim()) return "invalid";
  if (needsDuplicateChoice(i)) return "duplicate";
  if (i.duplicateOf && i.duplicateAction === "keep_existing") return "ready";
  if (i.duplicateOf && i.duplicateAction === "merge") return "ready";
  return isPriced(i) ? "ready" : "needs_cost";
}

export interface ApprovalPreview {
  selected: number;
  created: number;
  templates: number;
  matched: number;
  updated: number;
  merged: number;
  awaitingPrice: number;
  skipped: number;
  stacks: number;
  conflicts: { itemId: string; name: string; reason: string }[];
  /** Saved prices that would change (update_existing), shown before confirming. */
  priceChanges: { itemId: string; name: string; from: string; to: string }[];
}

/**
 * What approving this selection will do — computed the same way the database function decides, so
 * the confirmation screen's numbers match the result.
 */
export function approvalPreview(items: DraftItem[], selectedIds: Iterable<string>, opts: { templates: boolean; stackIds?: string[]; savedItems?: SavedItem[] }): ApprovalPreview {
  const sel = new Set(selectedIds);
  const p: ApprovalPreview = { selected: 0, created: 0, templates: 0, matched: 0, updated: 0, merged: 0, awaitingPrice: 0, skipped: 0, stacks: opts.stackIds?.length ?? 0, conflicts: [], priceChanges: [] };
  const saved = new Map((opts.savedItems ?? []).map((s) => [s.id, s]));
  for (const i of items) {
    if (!sel.has(i.id) || i.status !== "candidate") continue;
    p.selected++;
    if (!i.name.trim() || !i.unit.trim() || !i.category.trim()) { p.skipped++; continue; }
    if (needsDuplicateChoice(i)) { p.conflicts.push({ itemId: i.id, name: i.name, reason: i.duplicateReason || "Possible duplicate of a Saved Item" }); continue; }
    if (i.duplicateOf && i.duplicateAction === "keep_existing") { p.matched++; continue; }
    if (i.duplicateOf && i.duplicateAction === "merge") { p.merged++; continue; }
    if (i.duplicateOf && i.duplicateAction === "update_existing") {
      if (!isPriced(i)) { p.awaitingPrice++; continue; }
      p.updated++;
      const old = saved.get(i.duplicateOf);
      if (old && old.unitCost !== i.unitCost) p.priceChanges.push({ itemId: i.id, name: old.name, from: old.unitCost || "not set", to: i.unitCost });
      continue;
    }
    if (isPriced(i)) p.created++;
    else if (opts.templates) p.templates++;
    else p.awaitingPrice++;
  }
  return p;
}

// ── Stacks ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Plain checks on a candidate stack's quantities. These are warnings for the contractor to review,
 * never automatic fixes: ratios depend on how each contractor builds and on the job.
 */
export function stackWarnings(stack: Pick<DraftStack, "scaleUnit" | "components">, items: Pick<DraftItem, "id" | "name" | "unit" | "status">[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!stack.components.length) out.push("This stack has no rows.");
  for (const c of stack.components) {
    const it = byId.get(c.itemId);
    if (!it || it.status === "removed") { out.push("A row points to an item that was removed from the draft."); continue; }
    if (!stack.scaleUnit) continue;
    if (!c.per) continue;
    const per = Number(c.per);
    if (!Number.isFinite(per) || per <= 0) { out.push(`“${it.name}”: the amount per unit must be more than 0.`); continue; }
    const u = normalizeUnit(it.unit);
    if (u === stack.scaleUnit && Math.abs(per - 1) > 0.25) out.push(`“${it.name}” is measured in the same unit as the stack, so it's usually 1 per ${stack.scaleUnit} (it's ${per}).`);
    if (u === "cubic yard" && stack.scaleUnit === "square foot" && per > 0.1) out.push(`“${it.name}”: ${per} CY per SF is over 32 inches thick. Check the thickness.`);
    if (u === "cubic yard" && stack.scaleUnit === "square foot") {
      const inches = per * 27 * 12;
      if (per <= 0.1) out.push(`“${it.name}”: ${per} CY per SF is about ${inches.toFixed(1)} inches thick before waste. Change it to match each job.`);
    }
    if (per > 1000) out.push(`“${it.name}”: ${per} per ${stack.scaleUnit} looks too high.`);
    const w = Number(c.wastePct || 0);
    if (w > 30) out.push(`“${it.name}”: ${w}% waste is high. Check it.`);
  }
  return out;
}

/** Cubic yards of concrete per square foot for a slab thickness in inches (thickness ÷ 12 ÷ 27). */
export const cyPerSf = (inches: number) => Math.round((inches / 12 / 27) * 1_000_000) / 1_000_000;

export const isScaleUnit = (u: string): u is ScaleUnit => (SCALE_UNITS as readonly string[]).includes(u);

/** Groups candidates by category in first-seen order (the AI's order), with counts. */
export function groupByCategory<T extends Pick<DraftItem, "category">>(items: T[]): { name: string; items: T[] }[] {
  const m = new Map<string, { name: string; items: T[] }>();
  for (const i of items) {
    const k = i.category.trim().toLowerCase() || "general";
    if (!m.has(k)) m.set(k, { name: i.category.trim() || "General", items: [] });
    m.get(k)!.items.push(i);
  }
  return [...m.values()];
}

/** Search inside a draft: name, category, description, notes. */
export function draftMatches(i: Pick<DraftItem, "name" | "category" | "description" | "notes">, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [i.name, i.category, i.description, i.notes].some((v) => v.toLowerCase().includes(s));
}

/** Short title for a draft list ("Concrete", "Kitchens, Bathrooms"). */
export function draftTitle(prompt: string, tradeNames: string[]): string {
  const p = prompt.replace(/\s+/g, " ").trim();
  if (p && p.length <= 60) return p;
  if (tradeNames.length) return tradeNames.join(", ").slice(0, 160);
  return (p.slice(0, 57) + "…") || "Price library";
}

/** A broad catalog for a short prompt ("Concrete"); a scope-based list for a detailed description. */
export const modeFor = (prompt: string, estimateId?: string): "catalog" | "scope" => (estimateId || prompt.trim().length > 120 ? "scope" : "catalog");
