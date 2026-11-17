/**
 * "Refresh Material Costs" (V5 Pricing Intelligence): compare a DRAFT estimate's material rows with
 * the contractor's current Saved Item prices and list what would change. Nothing changes until the
 * contractor picks rows and applies them, and finalized (sent, approved or signed) estimates are
 * never offered a refresh: their prices are what the customer saw.
 */
import { D, toDec, type Dec } from "../estimate/money";
import type { CostType, Estimate } from "../estimate/types";
import { grossMarginPct } from "../estimate/engine";
import { normalizeItemKey, normalizeUnit } from "./provider";

export const REFRESHABLE_TYPES: CostType[] = ["material", "labor_material", "equipment"];

export interface PriceSource {
  id: string;
  name: string;
  unit: string;
  unitCost: string;
  supplierName?: string | null;
  priceSource?: string | null;
  priceEffectiveOn?: string | null;
}

export interface RefreshChange {
  itemId: string;
  name: string;
  unit: string;
  quantity: string;
  from: string;
  to: string;
  /** (to - from) × quantity, to the cent. */
  costDelta: string;
  changePct: string | null;
  source: { savedItemId: string; supplierName: string | null; kind: string; effectiveOn: string | null };
}

export function canRefresh(e: Pick<Estimate, "status">): boolean {
  return e.status === "draft";
}

export function refreshPreview(e: Pick<Estimate, "status" | "items">, prices: PriceSource[]): RefreshChange[] {
  if (!canRefresh(e)) return [];
  const byKey = new Map<string, PriceSource>();
  for (const p of prices) {
    if (p.unitCost === "" || !toDec(p.unitCost).valid) continue;
    const k = `${normalizeItemKey(p.name)}|${normalizeUnit(p.unit)}`;
    if (!byKey.has(k)) byKey.set(k, p);
  }
  const out: RefreshChange[] = [];
  for (const it of e.items) {
    if (it.isExample || !REFRESHABLE_TYPES.includes(it.costType)) continue;
    const p = byKey.get(`${normalizeItemKey(it.name)}|${normalizeUnit(it.unit)}`);
    if (!p) continue;
    const from = toDec(it.unitCost), to = new D(p.unitCost), qty = toDec(it.quantity);
    if (from.valid && it.unitCost !== "" && from.value.eq(to)) continue;
    const fromV = from.valid ? from.value : new D(0);
    out.push({
      itemId: it.id, name: it.name, unit: it.unit, quantity: it.quantity,
      from: it.unitCost, to: to.toString(),
      costDelta: to.minus(fromV).times(qty.valid ? qty.value : 0).toDecimalPlaces(2).toFixed(2),
      changePct: fromV.isZero() ? null : to.minus(fromV).div(fromV).times(100).toDecimalPlaces(1).toString(),
      source: { savedItemId: p.id, supplierName: p.supplierName ?? null, kind: p.priceSource ?? "manual", effectiveOn: p.priceEffectiveOn ?? null },
    });
  }
  return out;
}

/** True when a target margin is set and the bid's gross margin is below it (warning only). */
export function belowTargetMargin(price: Dec, cost: Dec, target: string | null | undefined): boolean {
  if (!target) return false;
  const t = toDec(target);
  if (!t.valid) return false;
  const m = grossMarginPct(price, cost);
  return m !== null && cost.gt(0) && m.lt(t.value);
}
