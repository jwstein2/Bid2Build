import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { SavedItem } from "../library/saved-items";
import type { CandidateItem, CandidateStack } from "./generate";
import {
  canonicalUnit, findDuplicate, historySuggestion, initialCost, isScaleUnit,
  type DraftDetail, type DraftItem, type DraftStack, type HistoryRow, type LibraryDraft, type StackComponent, HISTORY_MAX_AGE_DAYS,
} from "./model";

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped here */
export type Supa = Awaited<ReturnType<typeof createClient>>;

const num = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const mapDraft = (r: any): LibraryDraft => ({
  id: r.id, title: r.title, prompt: r.prompt ?? "", trades: r.trades ?? [], mode: r.mode, status: r.status,
  notes: r.notes ?? [], lastError: r.last_error ?? null, generationCount: r.generation_count ?? 0,
  approvedItems: r.approved_items ?? 0, approvedStacks: r.approved_stacks ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const mapItem = (r: any): DraftItem => ({
  id: r.id, name: r.name, description: r.description ?? "", trade: r.trade ?? null, category: r.category, costType: r.cost_type,
  unit: r.unit, unitCost: num(r.unit_cost), costSource: r.cost_source, costSourceNote: r.cost_source_note ?? "",
  suggestedCost: num(r.suggested_cost), suggestedNote: r.suggested_note ?? "", supplierSku: r.supplier_sku ?? "", notes: r.notes ?? "",
  conditions: r.conditions ?? [], optional: Boolean(r.optional), confidence: r.confidence, verifyNote: r.verify_note ?? "", taxable: r.taxable !== false,
  status: r.status, duplicateOf: r.duplicate_of ?? null, duplicateLevel: r.duplicate_level ?? null, duplicateReason: r.duplicate_reason ?? "",
  duplicateAction: r.duplicate_action ?? null, savedItemId: r.saved_item_id ?? null, batch: r.batch ?? 1, sortOrder: r.sort_order ?? 0,
});

export const mapStack = (r: any): DraftStack => ({
  id: r.id, name: r.name, trade: r.trade ?? null, scaleUnit: r.scale_unit && isScaleUnit(r.scale_unit) ? r.scale_unit : null,
  scaleLabel: r.scale_label ?? "", scaleCalc: r.scale_calc ?? null, assumptions: r.assumptions ?? [],
  components: Array.isArray(r.components) ? r.components.map((c: any): StackComponent => ({
    itemId: str(c.itemId), per: str(c.per), quantity: str(c.quantity) || "1", wastePct: str(c.wastePct), roundUp: c.roundUp === true,
    optional: c.optional === true, note: str(c.note),
  })) : [],
  status: r.status, assemblyId: r.assembly_id ?? null, sortOrder: r.sort_order ?? 0,
});

/** True once SQL 20270115001000 has been run (the drafts table exists). */
export async function generatorReady(supabase: Supa): Promise<boolean> {
  const { error } = await supabase.from("library_drafts").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function loadDetail(supabase: Supa, id: string): Promise<DraftDetail | null> {
  const [{ data: d }, { data: items }, { data: stacks }] = await Promise.all([
    supabase.from("library_drafts").select("*").eq("id", id).maybeSingle(),
    supabase.from("library_draft_items").select("*").eq("draft_id", id).order("sort_order").limit(2000),
    supabase.from("library_draft_stacks").select("*").eq("draft_id", id).order("sort_order").limit(200),
  ]);
  if (!d) return null;
  return { draft: mapDraft(d), items: (items ?? []).map(mapItem), stacks: (stacks ?? []).map(mapStack) };
}

/** The contractor's own Saved Items (RLS: own rows), in the shape the duplicate rules use. */
export async function loadSavedItems(supabase: Supa): Promise<SavedItem[]> {
  const { data } = await supabase.from("saved_items").select("*").order("name").limit(5000);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, description: r.description ?? undefined, trade: r.trade ?? null, category: r.category ?? undefined,
    costType: r.cost_type ?? "material", treatment: r.treatment ?? "marked_up", unit: r.unit ?? "each", unitCost: num(r.unit_cost), taxable: r.taxable ?? true,
    supplierName: r.supplier_name ?? null, supplierSku: r.supplier_sku ?? null, priceSource: r.price_source ?? null,
    priceEffectiveOn: r.price_effective_on ? String(r.price_effective_on).slice(0, 10) : null,
  }));
}

/** Cost history from the contractor's own estimates in the last 18 months (names, units and costs only). */
export async function loadHistory(supabase: Supa, userId: string): Promise<HistoryRow[]> {
  const cutoff = new Date(Date.now() - HISTORY_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("estimate_items")
    .select("name, unit, unit_cost, cost_type, estimates!inner(updated_at, trades)")
    .eq("user_id", userId)
    .gt("unit_cost", 0)
    .gte("estimates.updated_at", cutoff)
    .limit(5000);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    name: r.name ?? "", unit: r.unit ?? "", unitCost: Number(r.unit_cost) || 0, costType: r.cost_type ?? "material",
    updatedAt: r.estimates?.updated_at ?? new Date(0).toISOString(), trades: r.estimates?.trades ?? [],
  }));
}

/**
 * Sections, scope text and item names of one of the contractor's own bids, for "start from a bid".
 * RLS decides access. No prices, customer name, address or title are read.
 */
export async function loadBidOutline(supabase: Supa, estimateId: string): Promise<{ outline: string; trades: string[] } | null> {
  const [{ data: est }, { data: groups }, { data: items }] = await Promise.all([
    supabase.from("estimates").select("id, trades").eq("id", estimateId).maybeSingle(),
    supabase.from("estimate_groups").select("id, name, description").eq("estimate_id", estimateId).order("sort_order").limit(60),
    supabase.from("estimate_items").select("group_id, name, unit").eq("estimate_id", estimateId).order("sort_order").limit(400),
  ]);
  if (!est) return null;
  const lines: string[] = [];
  for (const g of groups ?? []) {
    lines.push(`Section: ${String(g.name ?? "").slice(0, 120)}`);
    if (g.description) lines.push(`  Scope: ${String(g.description).replace(/\s+/g, " ").slice(0, 600)}`);
    for (const it of (items ?? []).filter((i: any) => i.group_id === g.id && i.name)) lines.push(`  - ${String(it.name).slice(0, 120)} (${it.unit})`);
  }
  return { outline: lines.join("\n").slice(0, 6000), trades: (est as any).trades ?? [] };
}

/** Stored row for a fresh AI candidate, with deterministic duplicate and cost checks applied. */
export function candidateRow(c: CandidateItem, ctx: { draftId: string; userId: string; batch: number; sortOrder: number; saved: SavedItem[]; history: HistoryRow[] }) {
  const unit = canonicalUnit(c.unit);
  const dup = findDuplicate({ name: c.name, unit, trade: c.trade, costType: c.costType, supplierSku: "" }, ctx.saved);
  const hist = historySuggestion({ name: c.name, unit, costType: c.costType, trade: c.trade }, ctx.history);
  const cost = initialCost(dup, hist);
  return {
    draft_id: ctx.draftId, user_id: ctx.userId, name: c.name, description: c.description || null, trade: c.trade, category: c.category,
    cost_type: c.costType, unit, unit_cost: cost.unitCost === "" ? null : cost.unitCost, cost_source: cost.costSource,
    cost_source_note: cost.costSourceNote || null, suggested_cost: cost.suggestedCost === "" ? null : cost.suggestedCost,
    suggested_note: cost.suggestedNote || null, notes: c.notes || null, conditions: c.conditions, optional: c.optional,
    confidence: c.confidence, verify_note: c.verifyNote || null, taxable: c.costType !== "labor",
    duplicate_of: dup?.savedItemId ?? null, duplicate_level: dup?.level ?? null, duplicate_reason: dup?.reason ?? null,
    // An exact match defaults to "keep my existing item"; a possible match waits for the contractor.
    duplicate_action: dup?.level === "exact" ? "keep_existing" : null,
    batch: ctx.batch, sort_order: ctx.sortOrder,
  };
}

/** Stored row for a candidate stack; component names are resolved to draft item ids. */
export function stackRow(s: CandidateStack, ctx: { draftId: string; userId: string; sortOrder: number; idByName: Map<string, string> }) {
  const components = s.components.flatMap((c) => {
    const itemId = ctx.idByName.get(c.itemName.toLowerCase());
    return itemId ? [{ itemId, per: c.per, quantity: c.quantity, wastePct: c.wastePct, roundUp: c.roundUp, optional: c.optional, note: c.note }] : [];
  });
  if (components.length < 2) return null;
  return {
    draft_id: ctx.draftId, user_id: ctx.userId, name: s.name, trade: s.trade, scale_unit: s.scaleUnit, scale_label: s.scaleLabel,
    scale_calc: s.scaleCalc, assumptions: s.assumptions, components, sort_order: ctx.sortOrder,
  };
}
