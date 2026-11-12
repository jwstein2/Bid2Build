"use client";
import { useState } from "react";
import { Card, Notice } from "@/components/ui/misc";

export interface MarketConsent { sharePrices: boolean; shareCosts: boolean; commercialUse: boolean }

/** Opt-in controls for contributing de-identified pricing data. Everything starts off. */
export function MarketSharing({ initial }: { initial: MarketConsent }) {
  const [c, setC] = useState(initial);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function save(next: MarketConsent) {
    const normalized = { ...next, shareCosts: next.sharePrices && next.shareCosts, commercialUse: next.sharePrices && next.commercialUse };
    const prev = c;
    setC(normalized);
    const r = await fetch("/api/account/market-consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(normalized) }).catch(() => null);
    if (r?.ok) setMsg({ tone: "ok", text: prev.sharePrices && !normalized.sharePrices ? "Sharing is off. Data you contributed earlier has been removed." : "Saved." });
    else { setC(prev); setMsg({ tone: "danger", text: "Could not save your preference. Please try again." }); }
  }
  return (
    <Card className="p-5">
      <h2 className="font-bold">Anonymous pricing benchmarks</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Optional. When you finalize a proposal, Built2Bid can keep a de-identified copy of its pricing: trade, ZIP prefix, quantities, units, and
        customer prices. It never includes your business name, your customer&apos;s name or contact details, addresses, notes, or proposal text.
        Figures are only ever reported in aggregate, when at least 20 different businesses contributed, and are not shown to other contractors.
      </p>
      <div className="mt-4 space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-brand)]" checked={c.sharePrices} onChange={(e) => save({ ...c, sharePrices: e.target.checked })} />
          <span><span className="font-semibold">Share customer prices from finalized proposals.</span> Drafts and previews are never shared.</span>
        </label>
        <label className={`flex items-start gap-2 ${c.sharePrices ? "" : "opacity-50"}`}>
          <input type="checkbox" className="mt-0.5 accent-[var(--color-brand)]" disabled={!c.sharePrices} checked={c.shareCosts} onChange={(e) => save({ ...c, shareCosts: e.target.checked })} />
          <span><span className="font-semibold">Also share my internal costs and margins.</span> Used only for aggregate cost and margin statistics.</span>
        </label>
        <label className={`flex items-start gap-2 ${c.sharePrices ? "" : "opacity-50"}`}>
          <input type="checkbox" className="mt-0.5 accent-[var(--color-brand)]" disabled={!c.sharePrices} checked={c.commercialUse} onChange={(e) => save({ ...c, commercialUse: e.target.checked })} />
          <span><span className="font-semibold">Allow my data in future aggregated industry reports.</span> No such product exists today.</span>
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">Turning sharing off removes the observations you contributed. Turning cost sharing off removes your costs and margins from them.</p>
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Card>
  );
}
