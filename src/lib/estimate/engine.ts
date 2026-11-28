import { D, Dec, ZERO, round2, toDec } from "./money";
import { DISCOUNT_PERCENT_UNIT, type Estimate, type EstimateGroup, type GroupVisibility, type LineItem, type PricingRule } from "./types";

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
  /** False when unitPrice × quantity doesn't equal extendedPrice (whole-dollar lines with a fractional quantity): don't print the unit price. */
  unitPriceExact: boolean;
  grossProfit: Dec;
  appliedRule: PricingRule | null; // null = pass-through
  taxable: boolean;
  valid: boolean;
  /** Set on discount lines: extendedPrice is negative and percent is set for percent-of-section discounts. */
  discount?: { percent: Dec | null };
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
  /** Discount lines in this section, as a positive amount (already subtracted from price). */
  discount: Dec;
}

export interface EstimateTotals {
  items: Record<string, ItemTotals>;
  groups: Record<string, GroupTotals>;
  groupOrder: string[];
  totalCost: Dec;
  itemsPrice: Dec; // sum of group prices (after discount lines)
  /** Discount lines across all sections, as a positive amount (already inside itemsPrice). */
  lineDiscounts: Dec;
  /** Whole-project discount actually applied, as a positive amount. */
  projectDiscount: Dec;
  adjustment: Dec;
  subtotal: Dec; // pre-tax customer price = itemsPrice - projectDiscount + adjustment
  grossProfit: Dec;
  grossMargin: Dec | null;
  effectiveMarkup: Dec | null;
  taxableBase: Dec;
  taxRate: Dec;
  tax: Dec;
  /** subtotal + tax, to the cent. */
  calculatedTotal: Dec;
  /** total - calculatedTotal: zero unless the estimate rounds its final total. */
  rounding: Dec;
  total: Dec; // calculatedTotal + rounding
  issues: Issue[];
}

export const isDiscountItem = (item: Pick<LineItem, "costType">) => item.costType === "discount";
export const isPercentDiscount = (item: Pick<LineItem, "costType" | "unit">) => isDiscountItem(item) && item.unit === DISCOUNT_PERCENT_UNIT;

export function resolveRule(item: LineItem, group: EstimateGroup | undefined, estimate: Pick<Estimate, "pricing">): PricingRule | null {
  if (item.treatment === "pass_through" || isDiscountItem(item)) return null;
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
    if (unitCost.isNegative()) { valid = false; unitCost = ZERO; issues.push({ code: "negative_cost", message: isDiscountItem(item) ? `Enter the discount for "${item.name || "item"}" as a positive number.` : `Unit cost for "${item.name || "item"}" cannot be negative. Use a Discount line or the project discount instead.`, itemId: item.id, field: "unitCost" }); }

    if (isDiscountItem(item)) {
      // Discount lines carry no cost and are never marked up. Percent discounts are sized per section below.
      const percent = isPercentDiscount(item) ? D.min(unitCost, new D(100)) : null;
      const amount = percent ? ZERO : round2(quantity.times(unitCost));
      items[item.id] = {
        itemId: item.id, groupId: item.groupId, quantity, unitCost, extendedCost: ZERO,
        unitPrice: percent ? ZERO : round2(unitCost).negated(), extendedPrice: amount.negated(), unitPriceExact: true,
        grossProfit: amount.negated(), appliedRule: null, taxable: item.taxable, valid, discount: { percent },
      };
      continue;
    }

    const rule = resolveRule(item, group, estimate);
    let factor = new D(1);
    if (rule) {
      const key = item.pricingOverride ? `item:${item.id}` : group.pricingOverride ? `group:${group.id}` : "estimate";
      const f = checkRule(rule, key, item.pricingOverride ? { itemId: item.id } : group.pricingOverride ? { groupId: group.id } : {});
      factor = f.valid ? f.factor : new D(1);
      if (!f.valid) valid = false;
    }
    const extendedCost = round2(quantity.times(unitCost));
    let unitPrice = round2(unitCost.times(factor));
    let extendedPrice = round2(quantity.times(unitPrice));
    let unitPriceExact = true;
    if (estimate.roundLines && rule) {
      // Whole-dollar customer lines (billed-at-cost lines, rule === null, keep their exact cents).
      const exactUnit = unitCost.times(factor);
      if (quantity.isInteger()) {
        unitPrice = exactUnit.toDecimalPlaces(0, D.ROUND_HALF_UP);
        extendedPrice = quantity.times(unitPrice);
      } else {
        extendedPrice = quantity.times(exactUnit).toDecimalPlaces(0, D.ROUND_HALF_UP);
        unitPrice = quantity.isZero() ? exactUnit.toDecimalPlaces(0, D.ROUND_HALF_UP) : round2(extendedPrice.div(quantity));
        unitPriceExact = round2(quantity.times(unitPrice)).equals(extendedPrice);
      }
    }
    items[item.id] = {
      itemId: item.id,
      groupId: item.groupId,
      quantity,
      unitCost,
      extendedCost,
      unitPrice,
      extendedPrice,
      unitPriceExact,
      grossProfit: extendedPrice.minus(extendedCost),
      appliedRule: rule,
      taxable: item.taxable,
      valid,
    };
  }

  const ordered = sortedGroups(estimate);
  for (const g of ordered) {
    let cost = ZERO, price = ZERO, taxableBase = ZERO, count = 0;
    const discounts: ItemTotals[] = [];
    for (const it of itemsForGroup(estimate, g.id)) {
      const t = items[it.id];
      if (!t) continue;
      count++;
      if (t.discount) { discounts.push(t); continue; }
      cost = cost.plus(t.extendedCost);
      price = price.plus(t.extendedPrice);
      if (t.taxable) taxableBase = taxableBase.plus(t.extendedPrice);
    }
    // Discount lines, in order: a percent is of the section's other lines; together they can at most
    // bring the section to zero. They lower the taxable amount in proportion to the taxable share.
    const base = price;
    let discount = ZERO;
    for (const t of discounts) {
      const pct = t.discount!.percent;
      const wanted = pct ? base.times(pct).div(100).toDecimalPlaces(estimate.roundLines ? 0 : 2, D.ROUND_HALF_UP) : t.extendedPrice.negated();
      const amount = D.max(ZERO, D.min(wanted, base.minus(discount)));
      t.extendedPrice = amount.negated();
      t.grossProfit = amount.negated();
      discount = discount.plus(amount);
    }
    if (!discount.isZero() && !base.isZero()) {
      taxableBase = D.max(ZERO, round2(taxableBase.minus(discount.times(taxableBase).div(base))));
      price = price.minus(discount);
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
      discount,
    };
  }

  const totalCost = Object.values(groups).reduce((s, g) => s.plus(g.cost), ZERO);
  const itemsPrice = Object.values(groups).reduce((s, g) => s.plus(g.price), ZERO);
  const itemsTaxable = Object.values(groups).reduce((s, g) => s.plus(g.taxableBase), ZERO);
  const lineDiscounts = Object.values(groups).reduce((s, g) => s.plus(g.discount), ZERO);

  // Whole-project discount: dollars or a percent of the line-item total, never more than that total.
  let projectDiscount = ZERO;
  const pd = estimate.projectDiscount;
  if (pd && pd.value.trim()) {
    const v = toDec(pd.value);
    if (!v.valid || v.value.isNegative()) {
      issues.push({ code: "invalid_number", message: "Enter the project discount as a positive number.", field: "projectDiscount" });
    } else {
      const wanted = pd.kind === "percent" ? round2(itemsPrice.times(D.min(v.value, new D(100))).div(100)) : round2(v.value);
      projectDiscount = D.max(ZERO, D.min(wanted, itemsPrice));
    }
  }
  const afterDiscount = itemsPrice.minus(projectDiscount);

  const adj = toDec(estimate.fixedAdjustment);
  if (!adj.valid) issues.push({ code: "invalid_number", message: "Fixed adjustment is not a number.", field: "fixedAdjustment" });
  const adjustment = round2(adj.value);
  // A discount can at most bring the price to zero.
  const subtotal = D.max(ZERO, afterDiscount.plus(adjustment));
  const appliedAdjustment = subtotal.minus(afterDiscount);

  // The project discount and adjustment are allocated to the taxable base in proportion to the taxable share of the price.
  let taxableBase = itemsTaxable;
  const change = subtotal.minus(itemsPrice);
  if (!itemsPrice.isZero() && !change.isZero()) {
    taxableBase = itemsTaxable.plus(change.times(itemsTaxable).div(itemsPrice));
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
  const calculatedTotal = subtotal.plus(tax);
  // Rounding happens once, on the final figure, and is tracked as its own adjustment.
  const total = estimate.roundTotal ? calculatedTotal.toDecimalPlaces(0, D.ROUND_HALF_UP) : calculatedTotal;

  return {
    items,
    groups,
    groupOrder: ordered.map((g) => g.id),
    totalCost,
    itemsPrice,
    lineDiscounts,
    projectDiscount,
    adjustment: appliedAdjustment,
    subtotal,
    grossProfit,
    grossMargin: grossMarginPct(subtotal, totalCost),
    effectiveMarkup: markupPct(subtotal, totalCost),
    taxableBase,
    taxRate,
    tax,
    calculatedTotal,
    rounding: total.minus(calculatedTotal),
    total,
    issues,
  };
}
