import { D, Dec, ZERO, round2, toDec } from "./money";
import type { Estimate, EstimateGroup, GroupVisibility, LineItem, PricingRule } from "./types";

export const MAX_MARGIN = new D("99.99");
export const MIN_MARKUP = new D("-100");

export type IssueCode =
  | "invalid_number"
  | "negative_quantity"
  | "negative_cost"
  | "margin_too_high"
  | "markup_too_low"
  | "invalid_tax"
  | "orphan_item";

export interface Issue {
  code: IssueCode;
  message: string;
  itemId?: string;
  groupId?: string;
  field?: string;
}

export interface PricingFactor {
  factor: Dec;
  valid: boolean;
  issue?: Issue;
}

/** Multiplier that turns internal cost into customer price. */
export function pricingFactor(rule: PricingRule): PricingFactor {
  const { value: pct, valid } = toDec(rule.percent);
  if (!valid) {
    return { factor: new D(1), valid: false, issue: { code: "invalid_number", message: "Pricing percentage is not a number." } };
  }
  if (rule.mode === "markup") {
    if (pct.lt(MIN_MARKUP)) {
      return { factor: ZERO, valid: false, issue: { code: "markup_too_low", message: "Markup cannot be below -100%." } };
    }
    return { factor: new D(1).plus(pct.div(100)), valid: true };
  }
  // margin: price = cost / (1 - m). 100% margin would divide by zero.
  if (pct.gt(MAX_MARGIN)) {
    return {
      factor: new D(1),
      valid: false,
      issue: { code: "margin_too_high", message: "Target margin must be below 100% (100% would mean the cost is zero)." },
    };
  }
  return { factor: new D(1).div(new D(1).minus(pct.div(100))), valid: true };
}

/** Customer price from cost under a rule (unrounded). */
export function priceFromCost(cost: Dec, rule: PricingRule): Dec {
  return cost.times(pricingFactor(rule).factor);
}

export function grossMarginPct(price: Dec, cost: Dec): Dec | null {
  if (price.isZero()) return null;
  return price.minus(cost).div(price).times(100);
}

export function markupPct(price: Dec, cost: Dec): Dec | null {
  if (cost.isZero()) return null;
  return price.minus(cost).div(cost).times(100);
}

export interface ItemTotals {
  itemId: string;
  groupId: string;
  quantity: Dec;
  unitCost: Dec;
  extendedCost: Dec;
  unitPrice: Dec;
  extendedPrice: Dec;
  grossProfit: Dec;
  appliedRule: PricingRule | null; // null = pass-through
  taxable: boolean;
  valid: boolean;
}

export interface GroupTotals {
  groupId: string;
  cost: Dec;
  price: Dec;
  grossProfit: Dec;
  grossMargin: Dec | null;
  taxableBase: Dec;
  itemCount: number;
  visibility: GroupVisibility;
}

export interface EstimateTotals {
  items: Record<string, ItemTotals>;
  groups: Record<string, GroupTotals>;
  groupOrder: string[];
  totalCost: Dec;
  itemsPrice: Dec; // sum of group prices
  adjustment: Dec;
  subtotal: Dec; // pre-tax customer price = itemsPrice + adjustment
  grossProfit: Dec;
  grossMargin: Dec | null;
  effectiveMarkup: Dec | null;
  taxableBase: Dec;
  taxRate: Dec;
  tax: Dec;
  total: Dec; // subtotal + tax
  issues: Issue[];
}

export function resolveRule(item: LineItem, group: EstimateGroup | undefined, estimate: Pick<Estimate, "pricing">): PricingRule | null {
  if (item.treatment === "pass_through") return null;
  return item.pricingOverride ?? group?.pricingOverride ?? estimate.pricing;
}

export function effectiveVisibility(group: EstimateGroup, estimate: Pick<Estimate, "defaultGroupVisibility">): GroupVisibility {
  return group.visibility ?? estimate.defaultGroupVisibility;
}

export function sortedGroups(estimate: Pick<Estimate, "groups">): EstimateGroup[] {
  return [...estimate.groups].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function itemsForGroup(estimate: Pick<Estimate, "items">, groupId: string): LineItem[] {
  return estimate.items
    .filter((i) => i.groupId === groupId && !i.isExample)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Deterministically compute every number in an estimate.
 * Example rows (isExample) are always excluded. Invalid inputs count as zero and are reported.
 */
export function computeEstimate(estimate: Estimate): EstimateTotals {
  const issues: Issue[] = [];
  const items: Record<string, ItemTotals> = {};
  const groups: Record<string, GroupTotals> = {};
  const groupById = new Map(estimate.groups.map((g) => [g.id, g]));

  const ruleChecked = new Set<string>();
  const checkRule = (rule: PricingRule, key: string, ctx: Partial<Issue>) => {
    const f = pricingFactor(rule);
    if (!f.valid && f.issue && !ruleChecked.has(key)) {
      ruleChecked.add(key);
      issues.push({ ...f.issue, ...ctx });
    }
    return f;
  };
  checkRule(estimate.pricing, "estimate", { field: "pricing" });

  for (const item of estimate.items) {
    if (item.isExample) continue;
    const group = groupById.get(item.groupId);
    if (!group) {
      issues.push({ code: "orphan_item", message: `"${item.name}" is not in a group.`, itemId: item.id });
      continue;
    }
    let valid = true;
    const q = toDec(item.quantity);
    const c = toDec(item.unitCost);
    if (!q.valid) { valid = false; issues.push({ code: "invalid_number", message: `Quantity for "${item.name || "item"}" is not a number.`, itemId: item.id, field: "quantity" }); }
    if (!c.valid) { valid = false; issues.push({ code: "invalid_number", message: `Unit cost for "${item.name || "item"}" is not a number.`, itemId: item.id, field: "unitCost" }); }
    let quantity = q.value;
    let unitCost = c.value;
    if (quantity.isNegative()) { valid = false; quantity = ZERO; issues.push({ code: "negative_quantity", message: `Quantity for "${item.name || "item"}" cannot be negative.`, itemId: item.id, field: "quantity" }); }
    if (unitCost.isNegative()) { valid = false; unitCost = ZERO; issues.push({ code: "negative_cost", message: `Unit cost for "${item.name || "item"}" cannot be negative. Use the project adjustment for discounts.`, itemId: item.id, field: "unitCost" }); }

    const rule = resolveRule(item, group, estimate);
    let factor = new D(1);
    if (rule) {
      const key = item.pricingOverride ? `item:${item.id}` : group.pricingOverride ? `group:${group.id}` : "estimate";
      const f = checkRule(rule, key, item.pricingOverride ? { itemId: item.id } : group.pricingOverride ? { groupId: group.id } : {});
      factor = f.valid ? f.factor : new D(1);
      if (!f.valid) valid = false;
    }
    const extendedCost = round2(quantity.times(unitCost));
    const unitPrice = round2(unitCost.times(factor));
    const extendedPrice = round2(quantity.times(unitPrice));
    items[item.id] = {
      itemId: item.id,
      groupId: item.groupId,
      quantity,
      unitCost,
      extendedCost,
      unitPrice,
      extendedPrice,
      grossProfit: extendedPrice.minus(extendedCost),
      appliedRule: rule,
      taxable: item.taxable,
      valid,
    };
  }

  const ordered = sortedGroups(estimate);
  for (const g of ordered) {
    let cost = ZERO, price = ZERO, taxableBase = ZERO, count = 0;
    for (const it of itemsForGroup(estimate, g.id)) {
      const t = items[it.id];
      if (!t) continue;
      cost = cost.plus(t.extendedCost);
      price = price.plus(t.extendedPrice);
      if (t.taxable) taxableBase = taxableBase.plus(t.extendedPrice);
      count++;
    }
    groups[g.id] = {
      groupId: g.id,
      cost,
      price,
      grossProfit: price.minus(cost),
      grossMargin: grossMarginPct(price, cost),
      taxableBase,
      itemCount: count,
      visibility: effectiveVisibility(g, estimate),
    };
  }

  const totalCost = Object.values(groups).reduce((s, g) => s.plus(g.cost), ZERO);
  const itemsPrice = Object.values(groups).reduce((s, g) => s.plus(g.price), ZERO);
  const itemsTaxable = Object.values(groups).reduce((s, g) => s.plus(g.taxableBase), ZERO);

  const adj = toDec(estimate.fixedAdjustment);
  if (!adj.valid) issues.push({ code: "invalid_number", message: "Fixed adjustment is not a number.", field: "fixedAdjustment" });
  const adjustment = round2(adj.value);
  // A discount can at most bring the price to zero.
  const subtotal = D.max(ZERO, itemsPrice.plus(adjustment));
  const appliedAdjustment = subtotal.minus(itemsPrice);

  // The adjustment is allocated to the taxable base in proportion to the taxable share of the price.
  let taxableBase = itemsTaxable;
  if (!itemsPrice.isZero() && !appliedAdjustment.isZero()) {
    taxableBase = itemsTaxable.plus(appliedAdjustment.times(itemsTaxable).div(itemsPrice));
  }
  taxableBase = D.max(ZERO, round2(taxableBase));

  const tr = toDec(estimate.taxRate);
  let taxRate = tr.value;
  if (!tr.valid || taxRate.isNegative() || taxRate.gt(100)) {
    issues.push({ code: "invalid_tax", message: "Tax rate must be between 0% and 100%.", field: "taxRate" });
    taxRate = ZERO;
  }
  const tax = round2(taxableBase.times(taxRate).div(100));
  const grossProfit = subtotal.minus(totalCost);

  return {
    items,
    groups,
    groupOrder: ordered.map((g) => g.id),
    totalCost,
    itemsPrice,
    adjustment: appliedAdjustment,
    subtotal,
    grossProfit,
    grossMargin: grossMarginPct(subtotal, totalCost),
    effectiveMarkup: markupPct(subtotal, totalCost),
    taxableBase,
    taxRate,
    tax,
    total: subtotal.plus(tax),
    issues,
  };
}
