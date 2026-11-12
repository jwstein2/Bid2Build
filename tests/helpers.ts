import type { Estimate, LineItem } from "@/lib/estimate/types";

export function est(partial: Partial<Estimate> = {}): Estimate {
  return {
    id: "e1",
    title: "Deck",
    trades: ["decks"],
    estimateNumber: "EST-1",
    estimateDate: "2026-11-01",
    expirationDate: "2026-12-01",
    status: "draft",
    customer: { name: "Pat Customer" },
    location: {},
    pricing: { mode: "markup", percent: "25" },
    fixedAdjustment: "0",
    taxRate: "0",
    displayMode: "by_group",
    defaultGroupVisibility: "itemized",
    groups: [
      { id: "g1", name: "Decking Material Package", visibility: null, sortOrder: 0 },
      { id: "g2", name: "Labor", visibility: null, sortOrder: 1 },
    ],
    items: [],
    ...partial,
  };
}

let n = 0;
export function item(groupId: string, quantity: string, unitCost: string, extra: Partial<LineItem> = {}): LineItem {
  n++;
  return {
    id: extra.id ?? `i${n}`,
    groupId,
    name: extra.name ?? `Item ${n}`,
    costType: "material",
    treatment: "marked_up",
    quantity,
    unit: "each",
    unitCost,
    taxable: true,
    showOnProposal: true,
    sortOrder: n,
    ...extra,
  };
}
