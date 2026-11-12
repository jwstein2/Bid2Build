import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency, formatPercent } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";

/** Live engine output on an illustrative estimate (clearly labeled; not real pricing data). */
const demo: Estimate = {
  id: "demo", title: "Backyard deck", trades: ["decks"], estimateNumber: "EST-DEMO", estimateDate: "2026-01-01", expirationDate: "2026-02-01",
  status: "draft", customer: { name: "Example customer" }, location: {}, pricing: { mode: "markup", percent: "25" }, fixedAdjustment: "0",
  taxRate: "6", displayMode: "by_group", defaultGroupVisibility: "group_total",
  groups: [
    { id: "a", name: "Decking Material Package", visibility: null, sortOrder: 0 },
    { id: "b", name: "Framing Package", visibility: null, sortOrder: 1 },
    { id: "c", name: "Labor", visibility: null, sortOrder: 2 },
  ],
  items: [
    { id: "1", groupId: "a", name: "Deck boards", costType: "material", treatment: "marked_up", quantity: "100", unit: "each", unitCost: "40", taxable: true, showOnProposal: true, sortOrder: 0 },
    { id: "2", groupId: "b", name: "Framing lumber", costType: "material", treatment: "marked_up", quantity: "1", unit: "lump sum", unitCost: "2400", taxable: true, showOnProposal: true, sortOrder: 0 },
    { id: "3", groupId: "c", name: "Installation", costType: "labor", treatment: "marked_up", quantity: "80", unit: "hour", unitCost: "60", taxable: false, showOnProposal: true, sortOrder: 0 },
  ],
};

export function ProposalSample() {
  const t = computeEstimate(demo);
  const rows = [
    ["Estimated total cost", formatCurrency(t.totalCost)],
    ["Customer bid price", formatCurrency(t.subtotal)],
    ["Expected gross profit", formatCurrency(t.grossProfit)],
    ["Gross margin", formatPercent(t.grossMargin!)],
    ["Markup on cost", formatPercent(t.effectiveMarkup!)],
    ["Sales tax (6%, materials)", formatCurrency(t.tax)],
  ];
  return (
    <figure className="rounded-2xl border border-line bg-paper p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Pricing summary</h3>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-muted">Illustrative example</span>
      </div>
      <dl className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5"><dt className="text-ink-soft">{k}</dt><dd className="tabular font-semibold">{v}</dd></div>
        ))}
        <div className="flex justify-between bg-brand-tint px-4 py-3"><dt className="font-bold">Proposal total</dt><dd className="tabular text-lg font-extrabold">{formatCurrency(t.total)}</dd></div>
      </dl>
      <figcaption className="mt-3 text-xs text-muted">25% markup → 20% gross margin. Gross profit is before overhead you have not entered in the estimate.</figcaption>
    </figure>
  );
}
