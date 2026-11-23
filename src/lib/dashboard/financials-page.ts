/**
 * The Financials page (Know Your Numbers) laid out with the dashboard builder. Pure and client-safe.
 *
 * Each person keeps one Financials layout per mode (Contractor / Accountant), stored next to their Home layouts
 * (public.dashboard_layouts, page 'financials'). Until they save one, the page starts from what the Financials
 * layout rules already pick for them (role, trade profile, company defaults and their earlier card choices), so
 * nothing moves for anyone on the first visit.
 */
import { widgetDef } from "./registry";
import { newInstance, type Layout, type WidgetInstance } from "./schema";

export interface FinancialsStart {
  mode: "contractor" | "accountant";
  /** Headline numbers in order. */
  kpis: readonly string[];
  /** Quick actions in order. */
  quickActions: readonly string[];
  /** Shown (non-essential) cards in order. */
  cards: readonly string[];
}

/** Sections that are always on the page (essential alerts): they can be moved and resized, never removed. */
export const REQUIRED_SECTIONS = ["fin_page_attention", "fin_page_alerts"] as const;

const ID: Record<string, string> = {
  fin_page_nav: "fp_nav", fin_page_accountant: "fp_acct", fin_page_kpis: "fp_kpis", fin_page_overview: "fp_overview",
  fin_page_attention: "fp_attention", fin_page_alerts: "fp_alerts", fin_page_quick: "fp_quick", fin_page_reports: "fp_reports",
};

/** The starting layout: the same sections, in the same order, as the Financials page had before it was customizable. */
export function financialsStartLayout(s: FinancialsStart): Layout {
  const w: WidgetInstance[] = [
    newInstance(s.mode === "accountant" ? "fin_page_accountant" : "fin_page_nav", undefined, undefined, s.mode === "accountant" ? ID.fin_page_accountant : ID.fin_page_nav),
    newInstance("fin_page_kpis", { kpis: [...s.kpis] }, undefined, ID.fin_page_kpis),
    newInstance("fin_page_overview", undefined, undefined, ID.fin_page_overview),
    newInstance("fin_page_attention", undefined, undefined, ID.fin_page_attention),
    newInstance("fin_page_alerts", undefined, undefined, ID.fin_page_alerts),
  ];
  if (s.quickActions.length) w.push(newInstance("fin_page_quick", { actions: [...s.quickActions] }, undefined, ID.fin_page_quick));
  for (const card of s.cards) w.push(newInstance("fin_page_card", { card }, undefined, `fc_${card}`.slice(0, 40)));
  w.push(newInstance("fin_page_reports", undefined, undefined, ID.fin_page_reports));
  return { version: 1, template: null, widgets: w.filter((x) => widgetDef(x.type)) };
}

/**
 * Put back any always-shown section a saved layout is missing (an older save, or one edited elsewhere), after the
 * headline numbers when there are any, else at the top.
 */
export function withRequiredSections(widgets: WidgetInstance[]): WidgetInstance[] {
  let out = widgets;
  for (const type of REQUIRED_SECTIONS) {
    if (out.some((w) => w.type === type)) continue;
    // After the headline numbers or an always-shown section already placed, whichever comes last; else the top.
    const at = Math.max(...out.map((w, i) => (w.type === "fin_page_kpis" || (REQUIRED_SECTIONS as readonly string[]).includes(w.type) ? i : -1)), -1);
    const next = [...out];
    next.splice(at + 1, 0, newInstance(type, undefined, undefined, out.some((w) => w.id === ID[type]) ? undefined : ID[type]));
    out = next;
  }
  return out;
}
