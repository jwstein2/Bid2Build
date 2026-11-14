"use client";
import { Info } from "lucide-react";
import type { Dispatch } from "react";
import { pricingFactor, type EstimateTotals } from "@/lib/estimate/engine";
import { D, formatCurrency, formatPercent, toDec } from "@/lib/estimate/money";
import type { Estimate, GroupVisibility } from "@/lib/estimate/types";
import { cn } from "@/lib/cn";
import { tradeTotals } from "@/lib/estimate/trades";
import { tradeName } from "@/lib/trades/catalog";
import type { Action } from "./state";
import { VISIBILITY_LABEL } from "./workspace";

function equivalent(e: Estimate): string | null {
  const f = pricingFactor(e.pricing);
  if (!f.valid || f.factor.lte(0)) return null;
  const margin = new D(1).minus(new D(1).div(f.factor)).times(100);
  const markup = f.factor.minus(1).times(100);
  return e.pricing.mode === "markup" ? `${formatPercent(markup)} markup = ${formatPercent(margin)} gross margin` : `${formatPercent(margin)} margin = ${formatPercent(markup)} markup on cost`;
}

export function PricingPanel({ estimate: e, totals: t, dispatch }: { estimate: Estimate; totals: EstimateTotals; dispatch: Dispatch<Action> }) {
  const pctInvalid = t.issues.some((i) => i.field === "pricing");
  const eq = equivalent(e);
  const taxInvalid = t.issues.some((i) => i.code === "invalid_tax");
  const negProfit = t.grossProfit.isNegative();

  return (
    <aside className="space-y-4 lg:sticky lg:top-[7.5rem] lg:self-start" aria-label="Pricing">
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">Pricing method</h2>
        <div role="radiogroup" aria-label="Pricing method" className="mt-3 grid grid-cols-2 rounded-lg border border-line-strong p-0.5 text-sm font-semibold">
          {(["markup", "margin"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={e.pricing.mode === m}
              onClick={() => dispatch({ type: "patch", patch: { pricing: { ...e.pricing, mode: m } } })}
              className={cn("rounded-md px-2 py-1.5", e.pricing.mode === m ? "bg-brand text-white" : "text-ink-soft hover:bg-black/5")}
            >
              {m === "markup" ? "Markup %" : "Target margin %"}
            </button>
          ))}
        </div>
        <label htmlFor="pricing-pct" className="label mt-3">{e.pricing.mode === "markup" ? "Markup on cost" : "Gross profit margin"}</label>
        <div className="relative">
          <input
            id="pricing-pct"
            inputMode="decimal"
            value={e.pricing.percent}
            onChange={(ev) => dispatch({ type: "patch", patch: { pricing: { ...e.pricing, percent: ev.target.value } } })}
            className="field tabular pr-8"
            aria-invalid={pctInvalid}
            aria-describedby="pricing-help"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
        </div>
        <p id="pricing-help" className={cn("mt-1.5 text-xs", pctInvalid ? "text-danger" : "text-muted")}>
          {pctInvalid ? t.issues.find((i) => i.field === "pricing")?.message : eq}
        </p>
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer font-semibold text-ink-soft"><Info className="mr-1 inline h-3.5 w-3.5" />Markup vs. margin</summary>
          <p className="mt-1">Markup is profit as a percent of <b>cost</b>: price = cost × (1 + markup). Margin is profit as a percent of <b>price</b>: price = cost ÷ (1 − margin). Use one or the other, never both.</p>
        </details>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="adj" className="label">Adjustment $</label>
            <input id="adj" inputMode="decimal" value={e.fixedAdjustment} onChange={(ev) => dispatch({ type: "patch", patch: { fixedAdjustment: ev.target.value } })} className="field tabular" aria-describedby="adj-help" />
          </div>
          <div>
            <label htmlFor="tax" className="label">Sales tax %</label>
            <input id="tax" inputMode="decimal" value={e.taxRate} onChange={(ev) => dispatch({ type: "patch", patch: { taxRate: ev.target.value } })} className="field tabular" aria-invalid={taxInvalid} />
          </div>
        </div>
        <p id="adj-help" className="mt-1 text-xs text-muted">Use a negative amount for a discount. Applied before tax.</p>
        {toDec(e.fixedAdjustment).value.isZero() ? null : (
          <div className="mt-2">
            <label htmlFor="adj-label" className="label">Adjustment label</label>
            <input id="adj-label" value={e.adjustmentLabel ?? ""} placeholder={toDec(e.fixedAdjustment).value.isNegative() ? "Discount" : "Adjustment"} onChange={(ev) => dispatch({ type: "patch", patch: { adjustmentLabel: ev.target.value } })} className="field field-sm" />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">Project summary</h2>
        {e.trades.length > 1 && (
          <dl className="mt-3 space-y-1.5 border-b border-line pb-3 text-sm" aria-label="Subtotal by trade">
            {tradeTotals(e, t).map((tt) => <Metric key={tt.trade} k={tradeName(tt.trade)} v={formatCurrency(tt.price)} />)}
          </dl>
        )}
        <dl className="mt-3 space-y-1.5 text-sm">
          <Metric k="Estimated total cost" v={formatCurrency(t.totalCost)} />
          <Metric k="Customer bid price" v={formatCurrency(t.subtotal)} hint="Pre-tax revenue" />
          <Metric k="Expected gross profit" v={formatCurrency(t.grossProfit)} tone={negProfit ? "danger" : "ok"} />
          <Metric k="Expected gross margin" v={t.grossMargin ? formatPercent(t.grossMargin) : "—"} tone={negProfit ? "danger" : undefined} />
          <Metric k="Markup on cost" v={t.effectiveMarkup ? formatPercent(t.effectiveMarkup) : "—"} />
          {!t.adjustment.isZero() && <Metric k={e.adjustmentLabel || (t.adjustment.isNegative() ? "Discount" : "Adjustment")} v={formatCurrency(t.adjustment)} />}
          <Metric k={`Sales tax collected${t.taxRate.isZero() ? "" : ` (${t.taxRate.toString()}%)`}`} v={formatCurrency(t.tax)} hint="Not revenue" />
        </dl>
        <label className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-sm">
          <input
            type="checkbox"
            checked={Boolean(e.roundTotal)}
            onChange={(ev) => dispatch({ type: "patch", patch: { roundTotal: ev.target.checked || undefined } })}
            className="mt-0.5 h-4 w-4 accent-[var(--color-brand)] max-md:h-5 max-md:w-5"
          />
          <span>
            <span className="font-semibold">Round final bid total</span>
            <span className="block text-xs text-muted">
              Nearest whole dollar. Line items, markup and tax stay exact.
              {e.status === "finalized" ? " Proposals you already sent keep their total until you update them." : ""}
            </span>
          </span>
        </label>
        {e.roundTotal && (
          <dl className="mt-2 space-y-1.5 text-sm" aria-label="Rounding">
            <Metric k="Calculated total" v={formatCurrency(t.calculatedTotal)} />
            <Metric k="Rounding adjustment" v={formatCurrency(t.rounding)} />
          </dl>
        )}
        <div className="mt-3 flex items-baseline justify-between rounded-lg bg-brand-tint px-3 py-2.5">
          <span className="font-bold">{e.roundTotal ? "Final bid" : "Proposal total"}</span>
          <span className="tabular text-xl font-extrabold">{formatCurrency(t.total)}</span>
        </div>
        <p className="mt-2 text-xs text-muted">Gross profit is before overhead and indirect costs you have not entered in this estimate.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">Customer pricing display</h2>
        <fieldset className="mt-3 space-y-2 text-sm">
          <legend className="sr-only">Display mode</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="display" checked={e.displayMode === "by_group"} onChange={() => dispatch({ type: "patch", patch: { displayMode: "by_group" } })} className="mt-1 accent-[var(--color-brand)]" />
            <span>Show sections <span className="block text-xs text-muted">Each section uses its own setting.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="display" checked={e.displayMode === "project_total"} onChange={() => dispatch({ type: "patch", patch: { displayMode: "project_total" } })} className="mt-1 accent-[var(--color-brand)]" />
            <span>Single project total <span className="block text-xs text-muted">One price for the entire project.</span></span>
          </label>
        </fieldset>
        {e.displayMode === "by_group" && (
          <div className="mt-3">
            <label htmlFor="default-vis" className="label">Default for sections</label>
            <select id="default-vis" value={e.defaultGroupVisibility} onChange={(ev) => dispatch({ type: "patch", patch: { defaultGroupVisibility: ev.target.value as GroupVisibility } })} className="field field-sm">
              {Object.entries(VISIBILITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
      </div>
    </aside>
  );
}

function Metric({ k, v, hint, tone }: { k: string; v: string; hint?: string; tone?: "ok" | "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-soft">{k}{hint && <span className="ml-1 text-xs text-muted">({hint})</span>}</dt>
      <dd className={cn("tabular font-semibold", tone === "ok" && "text-ok", tone === "danger" && "text-danger")}>{v}</dd>
    </div>
  );
}
