/**
 * Builds the de-identified pricing observation captured when a proposal version is finalized.
 *
 * What is deliberately NOT included: customer name/email/phone/address, business details, notes,
 * item descriptions, proposal text, or the estimate number. Traceability back to the operational
 * record is kept only through the version id, which the database stores in a restricted table.
 *
 * Internal costs, markups and margins are included only when the contractor has opted in to
 * sharing them. The database enforces the same rule again (it strips cost fields when the stored
 * consent says no), so a bug here cannot leak costs.
 */
import type { EstimateTotals } from "../estimate/engine";
import type { Estimate } from "../estimate/types";
import { classifyItem } from "./classify";
import { resolveGeo } from "./geo";
import { sanitizeMeasurements, tradeModel, type ProjectProfile } from "./trade-models";
import { normalizeUnit } from "./units";

export interface ShareConsent { sharePrices: boolean; shareCosts: boolean }

export const OBSERVATION_SCHEMA = 1;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Remove things that look like contact details from free text we keep (item and group names). */
export function scrubText(s: string, max = 120): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.' ]{2,30}\s(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way)\b\.?/gi, "[address]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface ObservationLine {
  group_idx: number;
  fingerprint: string;
  original_name: string;
  trade: string | null;
  component: string | null;
  material: string | null;
  category: string;
  brand: string | null;
  product_line: string | null;
  specs: Record<string, string | number>;
  install_type: string | null;
  cost_class: string;
  entered_cost_type: string;
  material_key: string;
  confidence: number;
  class_conflict: boolean;
  treatment: string;
  taxable: boolean;
  unit_raw: string;
  unit_norm: string;
  unit_family: string;
  qty: number;
  qty_norm: number;
  unit_price: number;
  unit_price_norm: number;
  ext_price: number;
  unit_cost?: number;
  unit_cost_norm?: number;
  markup_pct?: number | null;
}

export interface ObservationGroup {
  idx: number;
  name: string;
  std_category: string;
  price: number;
  cost?: number;
  margin_pct?: number | null;
  markup_pct?: number | null;
  item_count: number;
}

export interface ObservationPayload {
  schema: number;
  quote_date: string;
  status: string;
  trade: string | null;
  trades: string[];
  project_type: string | null;
  work_type: string | null;
  sector: string | null;
  complexity: string | null;
  zip5: string | null;
  zip3: string | null;
  state: string | null;
  metro: string | null;
  state_conflict: boolean;
  price_subtotal: number;
  tax_amount: number;
  price_total: number;
  tax_rate: number;
  adjustment: number;
  costs_shared: boolean;
  cost_total?: number;
  gross_margin_pct?: number | null;
  markup_pct?: number | null;
  size_value: number | null;
  size_unit: string | null;
  size_source: "entered" | "inferred" | null;
  price_per_unit: number | null;
  measurements: Record<string, number | string | boolean>;
  group_count: number;
  line_count: number;
  groups: ObservationGroup[];
  lines: ObservationLine[];
}

export function buildObservation(estimate: Estimate, totals: EstimateTotals, profile: ProjectProfile | null | undefined, consent: ShareConsent): ObservationPayload {
  const trade = estimate.trades[0] ?? null;
  const model = tradeModel(trade);
  const shareCosts = consent.shareCosts;
  const geo = resolveGeo(estimate.location);
  const measurements = sanitizeMeasurements(trade, profile?.measurements);
  const projectType = profile?.projectType && model.projectTypes.some((p) => p.value === profile.projectType) ? profile.projectType : null;

  const groupIdx = new Map<string, number>();
  totals.groupOrder.forEach((id, i) => groupIdx.set(id, i));

  const lines: ObservationLine[] = [];
  for (const item of estimate.items) {
    if (item.isExample) continue;
    const t = totals.items[item.id];
    if (!t || !t.valid) continue;
    const qty = t.quantity.toNumber();
    const unitPrice = t.unitPrice.toNumber();
    if (!(qty > 0) && !(unitPrice > 0)) continue;
    const c = classifyItem({ name: item.name, category: item.category, costType: item.costType, unit: item.unit, trade });
    const u = normalizeUnit(item.unit);
    const unitCost = t.unitCost.toNumber();
    const line: ObservationLine = {
      group_idx: groupIdx.get(item.groupId) ?? 0,
      fingerprint: c.fingerprint,
      original_name: scrubText(item.name),
      trade,
      component: c.component,
      material: c.material,
      category: c.category,
      brand: c.brand,
      product_line: c.productLine,
      specs: c.specs,
      install_type: c.installType,
      cost_class: c.costClass,
      entered_cost_type: item.costType,
      material_key: c.materialKey,
      confidence: c.confidence,
      class_conflict: c.classConflict,
      treatment: item.treatment,
      taxable: item.taxable,
      unit_raw: item.unit.slice(0, 40),
      unit_norm: u.base,
      unit_family: u.family,
      qty: r4(qty),
      qty_norm: r4(qty * u.factor),
      unit_price: r4(unitPrice),
      unit_price_norm: r4(u.factor ? unitPrice / u.factor : unitPrice),
      ext_price: r2(t.extendedPrice.toNumber()),
    };
    if (shareCosts) {
      line.unit_cost = r4(unitCost);
      line.unit_cost_norm = r4(u.factor ? unitCost / u.factor : unitCost);
      line.markup_pct = unitCost > 0 ? r2(((unitPrice - unitCost) / unitCost) * 100) : null;
    }
    lines.push(line);
  }

  const groups: ObservationGroup[] = totals.groupOrder.map((id, idx) => {
    const g = totals.groups[id];
    const src = estimate.groups.find((x) => x.id === id);
    const mine = lines.filter((l) => l.group_idx === idx);
    const weight = new Map<string, number>();
    for (const l of mine) if (l.component) weight.set(l.component, (weight.get(l.component) ?? 0) + Math.max(l.ext_price, 0.01));
    const std = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unclassified";
    const out: ObservationGroup = { idx, name: scrubText(src?.name ?? "", 100), std_category: std, price: r2(g.price.toNumber()), item_count: mine.length };
    if (shareCosts) {
      out.cost = r2(g.cost.toNumber());
      out.margin_pct = g.grossMargin ? r2(g.grossMargin.toNumber()) : null;
      out.markup_pct = g.cost.isZero() ? null : r2(g.price.minus(g.cost).div(g.cost).times(100).toNumber());
    }
    return out;
  });

  // Standardized project size: entered measurement first, else inferred from line items.
  let sizeValue: number | null = null;
  let sizeSource: ObservationPayload["size_source"] = null;
  if (model.primary) {
    const entered = measurements[model.primary.key];
    if (typeof entered === "number" && entered > 0) { sizeValue = entered; sizeSource = "entered"; }
    else if (model.inferFrom) {
      const fam = model.inferFrom.family;
      const cands = lines.filter((l) => l.cost_class === "material" && l.component && model.inferFrom!.components.includes(l.component) && l.unit_family === fam);
      const best = Math.max(0, ...cands.map((l) => l.qty_norm));
      if (best > 0) { sizeValue = model.primary.unit === "square" ? r2(best / 100) : r2(best); sizeSource = "inferred"; }
    }
  }
  const subtotal = r2(totals.subtotal.toNumber());
  // Price per standardized unit only for single-trade projects with a measured size.
  const pricePerUnit = sizeValue && estimate.trades.length === 1 && subtotal > 0 ? r2(subtotal / sizeValue) : null;

  const payload: ObservationPayload = {
    schema: OBSERVATION_SCHEMA,
    quote_date: estimate.estimateDate,
    status: profile?.outcome ?? "quoted",
    trade,
    trades: estimate.trades.slice(0, 10),
    project_type: projectType,
    work_type: profile?.workType ?? null,
    sector: profile?.sector ?? null,
    complexity: model.complexity(measurements, projectType ?? undefined),
    zip5: geo.zip5,
    zip3: geo.zip3,
    state: geo.state,
    metro: geo.metro,
    state_conflict: geo.stateConflict,
    price_subtotal: subtotal,
    tax_amount: r2(totals.tax.toNumber()),
    price_total: r2(totals.total.toNumber()),
    tax_rate: r4(totals.taxRate.toNumber()),
    adjustment: r2(totals.adjustment.toNumber()),
    costs_shared: shareCosts,
    size_value: sizeValue,
    size_unit: sizeValue ? model.primary!.unit : null,
    size_source: sizeSource,
    price_per_unit: pricePerUnit,
    measurements,
    group_count: groups.length,
    line_count: lines.length,
    groups,
    lines,
  };
  if (shareCosts) {
    payload.cost_total = r2(totals.totalCost.toNumber());
    payload.gross_margin_pct = totals.grossMargin ? r2(totals.grossMargin.toNumber()) : null;
    payload.markup_pct = totals.effectiveMarkup ? r2(totals.effectiveMarkup.toNumber()) : null;
  }
  return payload;
}
