/**
 * Phone layout of the Home dashboard. Pure, so it is unit tested.
 */
import type { WidgetInstance } from "./schema";

/**
 * Widgets that share a row two-up on phones: single-number cards (one column wide on desktop). Lists, charts and
 * quick actions stay full width. A card left alone before a full-width widget spans the row, so there are no gaps.
 * Editing always uses full-width cells (the handle bar needs the room). Cards that preview records under their number
 * (Outstanding receivables, Collected, Draft bids, Win rate) stay full width so names and amounts stay readable.
 */
const METRIC_TYPES = new Set(["fin_revenue", "fin_upcoming_payments", "fin_profitability", "fin_uncategorized", "fin_unpaid_bills", "fin_labor_costs",
  "fin_sub_commitments", "fin_sub_costs", "tax_updates", "cash_position", "fin_bank_balance", "fin_projected_balance", "fin_ap", "fin_reconciliation", "fin_unmatched",
  "pm_active", "pm_scheduled", "sales_awaiting", "sales_won", "sales_avg_value", "customers", "team_hours"]);
const isMetric = (w: WidgetInstance) => w.w === 1 && w.h === 1 && METRIC_TYPES.has(w.type);
export function phoneHalfWidth(list: WidgetInstance[], editing: boolean): Set<string> {
  const out = new Set<string>();
  if (editing) return out;
  let run: string[] = [];
  const flush = () => { (run.length % 2 ? run.slice(0, -1) : run).forEach((id) => out.add(id)); run = []; };
  for (const w of list) { if (isMetric(w)) run.push(w.id); else flush(); }
  flush();
  return out;
}

