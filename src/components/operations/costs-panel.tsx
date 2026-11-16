"use client";
import { AlertTriangle, FilePlus2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { latestRevision, SUB_QUOTE_STATUS_LABELS, type CostAdjustment, type QuoteComparison, type SubQuote } from "@/lib/operations/sub-quotes";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import type { ChangeOrderDraft } from "./documents-panel";

interface CostsData { available: boolean; canView?: boolean; canApply?: boolean; comparison?: QuoteComparison; quotes?: SubQuote[]; adjustments?: CostAdjustment[] }
const money = (n: string | number | null | undefined) => (n == null ? "—" : `${Number(n) < 0 ? "−" : ""}${formatCurrency(Math.abs(Number(n)).toFixed(2))}`);
const pct = (s: string | null) => (s == null ? "—" : `${s}%`);

/**
 * Internal costs for a project: original estimate vs subcontractor bids. Nothing here changes the
 * customer's price. "Update internal project cost" moves only the internal forecast; "Prepare change
 * order" opens a draft change order the contractor reviews and sends themselves.
 */
export function CostsPanel({ estimateId, onPrepareChangeOrder }: { estimateId: string; onPrepareChangeOrder?: (d: ChangeOrderDraft) => void }) {
  const [data, setData] = useState<CostsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/estimates/${estimateId}/costs`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't load internal costs."); return; }
    setData(d); setError(null);
  }, [estimateId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading internal costs…</p>;
  if (!data.available) return <p className="text-sm text-muted">Internal costs turn on after the project operations update is installed.</p>;
  if (!data.canView) return <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">Your company role doesn&apos;t include subcontractor costs. Ask your company administrator if you need them.</p>;
  const c = data.comparison!, t = c.totals;
  const quoteFor = (itemId: string) => (data.quotes ?? []).filter((q) => q.itemId === itemId && q.status !== "rejected").at(-1) ?? null;

  const apply = async (q: SubQuote) => {
    const rev = latestRevision(q);
    if (!rev) return;
    setBusy(q.id);
    const r = await fetch(`/api/estimates/${estimateId}/sub-quotes/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: q.id, revisionId: rev.id }) });
    const d = await r.json().catch(() => null);
    setBusy(null);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't update the internal cost."); return; }
    void load();
  };
  const prepare = (l: QuoteComparison["lines"][number], q: SubQuote | null) => onPrepareChangeOrder?.({
    title: `Change: ${l.itemName}`.slice(0, 200),
    description: `Revised subcontractor pricing from ${l.vendorName} for ${l.itemName}.`,
    lines: [{ kind: "modify", description: l.itemName, amount: l.difference ?? "0" }],
    internalNotes: `Prefilled with the cost difference (${money(l.difference)}) before markup. Review the customer amount before sending.`,
    sourceQuoteRevisionId: q ? latestRevision(q)?.id : undefined,
  });

  return (
    <div className="space-y-4" data-testid="costs-panel">
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-bold">Original estimate vs subcontractor bids</h2>
        <p className="mt-1 text-xs text-muted">Internal only. Customer prices never change here; price changes go through a change order.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Selling price (before tax)</dt><dd className="tabular font-semibold">{money(t.sellingPrice)}</dd></div>
          <div><dt className="text-xs text-muted">Original cost</dt><dd className="tabular font-semibold">{money(t.originalCost)}</dd></div>
          <div><dt className="text-xs text-muted">Cost with sub bids</dt><dd className="tabular font-semibold">{money(t.forecastCost)}</dd></div>
          <div><dt className="text-xs text-muted">Difference</dt><dd className={cn("tabular font-semibold", Number(t.difference) > 0 ? "text-danger" : Number(t.difference) < 0 ? "text-ok" : "")}>{money(t.difference)}</dd></div>
          <div><dt className="text-xs text-muted">Original profit</dt><dd className="tabular font-semibold">{money(t.originalProfit)} <span className="text-xs text-muted">({pct(t.originalMargin)})</span></dd></div>
          <div><dt className="text-xs text-muted">Profit with sub bids</dt><dd className="tabular font-semibold">{money(t.forecastProfit)} <span className="text-xs text-muted">({pct(t.forecastMargin)})</span></dd></div>
          <div><dt className="text-xs text-muted">Applied cost updates</dt><dd className="tabular font-semibold">{money(t.appliedAdjustments)}</dd></div>
          <div><dt className="text-xs text-muted">Not yet applied</dt><dd className="tabular font-semibold">{t.unapprovedLines} line{t.unapprovedLines === 1 ? "" : "s"}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-bold">Lines with subcontractor quotes</h2>
        {!c.lines.length && <p className="mt-2 text-sm text-muted">No quotes yet. Add one from a line item in the estimate (the quote icon on each line).</p>}
        <ul className="mt-3 divide-y divide-line">
          {c.lines.map((l) => {
            const q = quoteFor(l.itemId);
            return (
              <li key={l.itemId} className="py-3" data-testid="cost-line">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{l.itemName}</p>
                    <p className="text-xs text-muted">{l.vendorName} · {SUB_QUOTE_STATUS_LABELS[l.status]}{l.quoteCount > 1 ? ` · ${l.quoteCount} quotes` : ""}</p>
                  </div>
                  {l.unapproved && <span className="inline-flex items-center gap-1 rounded-full bg-warn-tint px-2 py-0.5 text-xs font-semibold text-warn"><AlertTriangle className="h-3 w-3" aria-hidden />Unapproved quote</span>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <div><dt className="text-muted">Estimate cost</dt><dd className="tabular font-semibold">{money(l.originalCost)}</dd></div>
                  <div><dt className="text-muted">Original quote</dt><dd className="tabular font-semibold">{money(l.originalQuote)}</dd></div>
                  <div><dt className="text-muted">Revised quote</dt><dd className="tabular font-semibold">{money(l.revisedQuote)}</dd></div>
                  <div><dt className="text-muted">Difference</dt><dd className="tabular font-semibold">{money(l.difference)}</dd></div>
                  <div><dt className="text-muted">Margin then → now</dt><dd className="tabular font-semibold">{pct(l.originalMargin)} → {pct(l.forecastMargin)}</dd></div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.canApply && l.unapproved && q && <Button size="sm" variant="secondary" disabled={busy === q.id} onClick={() => void apply(q)}>Update Internal Project Cost</Button>}
                  {onPrepareChangeOrder && l.difference && Number(l.difference) !== 0 && <Button size="sm" variant="ghost" onClick={() => prepare(l, q)}><FilePlus2 className="h-4 w-4" aria-hidden /> Prepare Change Order</Button>}
                  {l.appliedForecast && <span className="self-center text-xs text-muted">Internal cost set to {money(l.appliedForecast)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
