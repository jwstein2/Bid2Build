/**
 * Turns a free-calculator result into the first line of a new draft (see src/lib/marketing/tools.ts).
 * Pure: no storage, no network. The line gets the quantity and the template item's unit and cost
 * type, but never a price.
 */
import { newLineItem } from "@/lib/estimate/factory";
import type { Estimate, PricingMode } from "@/lib/estimate/types";
import { runCalculator } from "@/lib/calculators/registry";
import type { CalcInput, CalcRecord } from "@/lib/calculators/types";
import type { TemplateItem, TradeTemplate } from "@/lib/trades/catalog";
import type { QuantityTool, ToolHandoff } from "./tools";

/** The template item that should receive the quantity, and the section it belongs to. */
function findTemplateItem(template: TradeTemplate | undefined, tool: QuantityTool): { groupName?: string; item?: TemplateItem } {
  if (!template) return {};
  const want = tool.item.name.toLowerCase();
  for (const g of template.groups) {
    const it = g.items.find((x) => x.name.toLowerCase() === want);
    if (it) return { groupName: g.name, item: it };
  }
  // A published template may have renamed the item: fall back to the first item in the same unit.
  for (const g of template.groups) {
    const it = g.items.find((x) => x.unit === tool.item.unit);
    if (it) return { groupName: g.name, item: it };
  }
  return {};
}

function isCalcInput(v: unknown): v is CalcInput {
  if (!v || typeof v !== "object") return false;
  const x = v as CalcInput;
  return Array.isArray(x.sections) && x.sections.length <= 60 && x.options !== null && typeof x.options === "object"
    && x.sections.every((s) => s && typeof s.id === "string" && typeof s.shape === "string" && s.values !== null && typeof s.values === "object");
}

/**
 * Adds the calculator's quantity to the draft as one line item. When the measurements from the same
 * calculation are available (and still produce exactly this quantity), they are saved on the line so
 * the builder's calculator opens with them.
 */
export function applyToolQuantity(estimate: Estimate, template: TradeTemplate | undefined, tool: QuantityTool, quantity: string, handoff?: ToolHandoff | null, now = new Date()): Estimate {
  const { groupName, item } = findTemplateItem(template, tool);
  const group = estimate.groups.find((g) => g.name === groupName) ?? estimate.groups[0];
  if (!group) return estimate;
  const line = newLineItem(group.id, 0, {
    name: item?.name ?? tool.item.name,
    unit: tool.item.unit,
    costType: item?.costType ?? "material",
    treatment: item?.treatment ?? "marked_up",
    quantity,
  });
  let worksheet = estimate.worksheet;
  if (handoff && handoff.tool === tool.slug && handoff.quantity === quantity && isCalcInput(handoff.input)) {
    const check = runCalculator(tool.calc, handoff.input, tool.output);
    if (check.ok && check.quantity !== null && Number(check.quantity) === Number(quantity) && check.unit === tool.item.unit) {
      const record: CalcRecord = { v: 1, calc: tool.calc, output: tool.output, input: handoff.input, result: quantity, unit: tool.item.unit, appliedAt: now.toISOString() };
      worksheet = { ...(worksheet ?? {}), calcs: { ...(worksheet?.calcs ?? {}), [line.id]: record } };
    }
  }
  return { ...estimate, items: [...estimate.items, line], worksheet };
}

/** Starts the draft with the markup or margin chosen on the markup tool. */
export function applyToolPricing(estimate: Estimate, mode: PricingMode, percent: string): Estimate {
  return { ...estimate, pricing: { mode, percent } };
}
