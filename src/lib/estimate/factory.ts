import type { TemplateItem, TradeTemplate } from "../trades/catalog";
import { getTrade } from "../trades/catalog";
import type { Estimate, EstimateGroup, LineItem } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function newLineItem(groupId: string, sortOrder: number, from?: Partial<TemplateItem> & Partial<LineItem>): LineItem {
  return {
    id: uid(),
    groupId,
    name: from?.name ?? "",
    description: from?.description ?? "",
    costType: from?.costType ?? "material",
    treatment: from?.treatment ?? "marked_up",
    quantity: from?.quantity ?? "1",
    unit: from?.unit ?? "each",
    unitCost: from?.unitCost ?? "",
    taxable: from?.taxable ?? (from?.costType ? from.costType === "material" : true),
    pricingOverride: from?.pricingOverride ?? null,
    showOnProposal: from?.showOnProposal ?? true,
    notes: from?.notes ?? "",
    sortOrder,
  };
}

export function newGroup(name: string, sortOrder: number): EstimateGroup {
  return { id: uid(), name, description: "", visibility: null, sortOrder, pricingOverride: null };
}

/**
 * New estimate for a trade. Template groups are created EMPTY: suggested items are offered in
 * the editor but never added (and never priced) automatically.
 */
export function createEstimate(tradeSlug: string, opts: { blank?: boolean; now?: Date; number?: string; template?: TradeTemplate } = {}): Estimate {
  const trade = getTrade(tradeSlug) ?? getTrade("other")!;
  const template = opts.template && opts.template.trade === trade.slug ? opts.template : trade.template;
  const now = opts.now ?? new Date();
  const expires = new Date(now.getTime() + 30 * 86400000);
  const groups = opts.blank
    ? [newGroup("Materials", 0), newGroup("Labor", 1)]
    : template.groups.map((g, i) => newGroup(g.name, i));
  // Every section belongs to the project's (first) trade; more trades add their own sections.
  for (const g of groups) g.trade = trade.slug;
  return {
    id: uid(),
    title: trade.slug === "other" ? "New Project" : `${trade.name} Project`,
    trades: [trade.slug],
    estimateNumber: opts.number ?? `EST-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`,
    estimateDate: isoDate(now),
    expirationDate: isoDate(expires),
    status: "draft",
    customer: { name: "" },
    location: {},
    pricing: { mode: "markup", percent: "25" },
    fixedAdjustment: "0",
    taxRate: "0",
    displayMode: "by_group",
    defaultGroupVisibility: "names_only",
    groups,
    items: [],
    templateRef: { trade: trade.slug, version: template.version },
  };
}

/** Suggested items for a group name across the estimate's trades (for mixed-trade projects). */
export function suggestionsFor(estimate: Pick<Estimate, "trades">, templates: TradeTemplate[]): TemplateItem[] {
  const seen = new Set<string>();
  const out: TemplateItem[] = [];
  for (const t of templates) {
    if (!estimate.trades.includes(t.trade)) continue;
    for (const g of t.groups) for (const it of g.items) {
      const k = it.name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(it); }
    }
  }
  return out;
}
