/**
 * Prebuilt "Draft with AI" sample for Practice / Demo sessions (Will meeting 2026-11-21, item C2).
 *
 * No AI call and no cost: the lines come from the trade's own estimate template, so every trade gets a
 * realistic, deterministic sample that matches the rest of the practice data. Quantities are fixed and
 * explained as sample values; nothing is priced by an AI guess (ballpark is always null).
 */
import { getTrade, UNITS } from "../trades/catalog";
import { TRADE_DEFAULT_LABOR } from "./labor-rates";
import { DRAFT_COST_TYPES, type DraftCostType, type DraftLine } from "./resolve";

const QTY: Record<string, number> = { square: 24, "square foot": 400, "square yard": 45, "linear foot": 120, "cubic yard": 6, hour: 16, day: 2, each: 1 };

export function sampleDraft(trade: string): { lines: DraftLine[]; assumptions: string[]; questions: string[] } {
  const t = getTrade(trade) ?? getTrade("other");
  const crew = TRADE_DEFAULT_LABOR[trade] ?? "handyman";
  const lines: DraftLine[] = [];
  for (const g of t?.template.groups ?? []) {
    for (const it of g.items.slice(0, 4)) {
      if (lines.length >= 16) break;
      const costType: DraftCostType = (DRAFT_COST_TYPES as readonly string[]).includes(it.costType) ? (it.costType as DraftCostType) : "other";
      const isLabor = costType === "labor";
      const unit = isLabor ? "hour" : (UNITS as readonly string[]).includes(it.unit) ? it.unit : "each";
      lines.push({
        section: g.name,
        name: it.name,
        description: "",
        costType,
        quantity: QTY[unit] ?? 1,
        unit,
        laborTrade: isLabor ? crew : null,
        ballparkUnitCost: null,
        basis: "Sample quantity (Practice Mode)",
      });
    }
  }
  return {
    lines,
    assumptions: ["This is a Practice Mode sample built from the trade's standard sections, not an AI draft of your description."],
    questions: ["In your own account, Draft with AI reads your job description and sizes each line for it."],
  };
}
