"use client";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { useMemo, useState, type Dispatch } from "react";
import { pricingFactor, type EstimateTotals } from "@/lib/estimate/engine";
import { D, formatCurrency, formatPercent, toDec } from "@/lib/estimate/money";
import type { Estimate, GroupVisibility } from "@/lib/estimate/types";
import { cn } from "@/lib/cn";
import { tradeTotals } from "@/lib/estimate/trades";
import { tradeName } from "@/lib/trades/catalog";
import type { Action } from "./state";
import type { Library } from "./library";
import { belowTargetMargin, refreshPreview } from "@/lib/pricing/refresh";
import { Button } from "../ui/button";
import { VISIBILITY_LABEL } from "./workspace";
import { TaxDetails } from "./tax-details";
import { useBuilderOps } from "./ops-context";

function equivalent(e: Estimate): string | null {
  const f = pricingFactor(e.pricing);
  if (!f.valid || f.factor.lte(0)) return null;
  const margin = new D(1).minus(new D(1).div(f.factor)).times(100);
  const markup = f.factor.minus(1).times(100);
  return e.pricing.mode === "markup" ? `${formatPercent(markup)} markup = ${formatPercent(margin)} gross margin` : `${formatPercent(margin)} margin = ${formatPercent(markup)} markup on cost`;
}

/** Markup that produces a given gross margin: m / (1 − m). */
function markupForMargin(target: string): string | null {
  const m = toDec(target);
  if (!m.valid || m.value.gte(100)) return null;
  return formatPercent(m.value.div(new D(100).minus(m.value)).times(100));
}

export function PricingPanel({ estimate: e, totals: t, dispatch, lib }: { estimate: Estimate; totals: EstimateTotals; dispatch: Dispatch<Action>; lib?: Pick<Library, "access" | "items" | "targetMarginPct"> }) {
  const pctInvalid = t.issues.some((i) => i.field === "pricing");
  const eq = equivalent(e);
  const taxInvalid = t.issues.some((i) => i.code === "invalid_tax");
  const negProfit = t.grossProfit.isNegative();
  // What the customer will actually see (company proposal style applied), not just this bid's raw value.
  const pd = useBuilderOps().priceDisplay;
  const mode = pd?.displayMode ?? e.displayMode;
  const vis = pd?.defaultGroupVisibility ?? e.defaultGroupVisibility;
  const canMode = pd?.canEdit.displayMode ?? true;
  const canVis = pd?.canEdit.defaultGroupVisibility ?? true;
  const chooseMode = (m: Estimate["displayMode"]) => { dispatch({ type: "patch", patch: { displayMode: m } }); pd?.choose("displayMode"); };

  return (
    <aside className="space-y-4 lg:sticky lg:top-[calc(7.5rem+var(--b2b-banner-h))] lg:self-start" aria-label="Pricing">
      <div className="rounded-xl border border-line bg-surface p-4" data-guide="builder.pricing">
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
        {lib?.targetMarginPct && belowTargetMargin(t.subtotal, t.totalCost, lib.targetMarginPct) && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn-tint px-2.5 py-2 text-xs text-warn" role="status" data-testid="target-margin-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Below your {formatPercent(lib.targetMarginPct)} target margin ({t.grossMargin ? formatPercent(t.grossMargin) : "—"} now).
              {markupForMargin(lib.targetMarginPct) ? ` A ${formatPercent(lib.targetMarginPct)} margin takes ${markupForMargin(lib.targetMarginPct)} markup on cost.` : ""} You can still send this bid.
            </span>
          </p>
        )}
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer font-semibold text-ink-soft"><Info className="mr-1 inline h-3.5 w-3.5" />Markup vs. margin</summary>
          <p className="mt-1">Markup is profit as a percent of <b>cost</b>: price = cost × (1 + markup). Margin is profit as a percent of <b>price</b>: price = cost ÷ (1 − margin). Use one or the other, never both.</p>
        </details>

        <ProjectDiscountField estimate={e} totals={t} dispatch={dispatch} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="adj" className="label">Adjustment $</label>
            <input id="adj" inputMode="decimal" value={e.fixedAdjustment} onChange={(ev) => dispatch({ type: "patch", patch: { fixedAdjustment: ev.target.value } })} className="field tabular" aria-describedby="adj-help" />
          </div>
          <div>
            <label htmlFor="tax" className="label">Sales tax %</label>
            <input id="tax" inputMode="decimal" value={e.taxRate} onChange={(ev) => dispatch({ type: "patch", patch: { taxRate: ev.target.value } })} className="field tabular" aria-invalid={taxInvalid} />
          </div>
        </div>
        <p id="adj-help" className="mt-1 text-xs text-muted">Any other change to the price, before tax. A negative amount lowers it. For discounts by section, use Add discount in that section.</p>
        <TaxDetails estimateId={/^[0-9a-f-]{36}$/.test(e.id) ? e.id : null} onUseRate={(rate) => dispatch({ type: "patch", patch: { taxRate: rate } })} />
        {toDec(e.fixedAdjustment).value.isZero() ? null : (
          <div className="mt-2">
            <label htmlFor="adj-label" className="label">Adjustment label</label>
            <input id="adj-label" value={e.adjustmentLabel ?? ""} placeholder={toDec(e.fixedAdjustment).value.isNegative() ? "Discount" : "Adjustment"} onChange={(ev) => dispatch({ type: "patch", patch: { adjustmentLabel: ev.target.value } })} className="field field-sm" />
          </div>
        )}
      </div>

      {lib?.access && <RefreshCosts estimate={e} lib={lib} dispatch={dispatch} />}

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
          {t.lineDiscounts.gt(0) && <Metric k="Section discounts" v={formatCurrency(t.lineDiscounts.negated())} hint="Included in bid price" />}
          {t.projectDiscount.gt(0) && <Metric k={e.projectDiscount?.label?.trim() || "Project discount"} v={formatCurrency(t.projectDiscount.negated())} hint="Included in bid price" />}
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
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(e.roundLines)}
            onChange={(ev) => dispatch({ type: "patch", patch: { roundLines: ev.target.checked || undefined } })}
            className="mt-0.5 h-4 w-4 accent-[var(--color-brand)] max-md:h-5 max-md:w-5"
            data-testid="round-lines"
          />
          <span>
            <span className="font-semibold">Whole-dollar line prices</span>
            <span className="block text-xs text-muted">
              Customer line prices show whole dollars, and the subtotal, tax and total are added up from those lines, so everything on the proposal matches. Billed-at-cost items keep their cents; your costs stay exact.
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
        <fieldset className="mt-3 space-y-2 text-sm" disabled={!canMode} data-testid="price-display">
          <legend className="sr-only">Display mode</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="display" checked={mode === "by_group"} onChange={() => chooseMode("by_group")} className="mt-1 accent-[var(--color-brand)]" />
            <span>Show sections <span className="block text-xs text-muted">Each section uses its own setting.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="display" checked={mode === "project_total"} onChange={() => chooseMode("project_total")} className="mt-1 accent-[var(--color-brand)]" />
            <span>Single project total <span className="block text-xs text-muted">One price for the entire project. Sections, line items, costs and markup stay private.</span></span>
          </label>
        </fieldset>
        {!canMode && <p className="mt-2 text-xs text-muted">Set by your company&apos;s proposal style.</p>}
        {mode === "by_group" && (
          <div className="mt-3">
            <label htmlFor="default-vis" className="label">Default for sections</label>
            <select id="default-vis" value={vis} disabled={!canVis} onChange={(ev) => { dispatch({ type: "patch", patch: { defaultGroupVisibility: ev.target.value as GroupVisibility } }); pd?.choose("defaultGroupVisibility"); }} className="field field-sm">
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

/**
 * "Refresh material costs": draft estimates only. Lists material rows whose Saved Item price changed
 * (e.g. after a supplier import); nothing changes until the contractor applies the ticked rows.
 * Finalized estimates (sent, approved or signed) never show it.
 */
function RefreshCosts({ estimate: e, lib, dispatch }: { estimate: Estimate; lib: Pick<Library, "items">; dispatch: Dispatch<Action> }) {
  const changes = useMemo(() => refreshPreview(e, lib.items), [e, lib.items]);
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  if (!changes.length) return null;
  const picked = changes.filter((c) => !skip.has(c.itemId));
  const delta = picked.reduce((s, c) => s.plus(c.costDelta), new D(0));
  return (
    <div className="rounded-xl border border-brand/40 bg-brand-tint/40 p-4" data-testid="refresh-costs">
      <h2 className="flex items-center gap-2 font-display font-bold"><RefreshCw className="h-4 w-4 text-brand" aria-hidden /> Material prices changed</h2>
      <p className="mt-1 text-sm text-ink-soft">{changes.length} row{changes.length === 1 ? "" : "s"} in this draft use{changes.length === 1 ? "s" : ""} an older price than your Saved Items.</p>
      {!open ? (
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)} data-testid="refresh-costs-review">Review price updates</Button>
      ) : (
        <>
          <ul className="mt-2 space-y-2 text-sm">
            {changes.map((c) => (
              <li key={c.itemId}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={!skip.has(c.itemId)} onChange={(ev) => { const n = new Set(skip); if (ev.target.checked) n.delete(c.itemId); else n.add(c.itemId); setSkip(n); }} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
                  <span className="min-w-0">
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-muted">
                      {formatCurrency(c.from || "0")} → {formatCurrency(c.to)} / {c.unit}{c.changePct ? ` (${Number(c.changePct) > 0 ? "+" : ""}${c.changePct}%)` : ""}
                      {c.source.supplierName ? ` · ${c.source.supplierName}` : ""}{c.source.effectiveOn ? ` · ${c.source.effectiveOn}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Cost change {delta.isNegative() ? "" : "+"}{formatCurrency(delta)} before markup. Your markup or margin stays the same.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={!picked.length} data-testid="refresh-costs-apply" onClick={() => { for (const c of picked) dispatch({ type: "updateItem", id: c.itemId, patch: { unitCost: c.to } }); setOpen(false); setSkip(new Set()); }}>
              Update {picked.length} price{picked.length === 1 ? "" : "s"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Whole-project discount: dollars or a percent of the line items. Shown to the customer as its own row. */
function ProjectDiscountField({ estimate: e, totals: t, dispatch }: { estimate: Estimate; totals: EstimateTotals; dispatch: Dispatch<Action> }) {
  const pd = e.projectDiscount ?? null;
  const kind = pd?.kind ?? "amount";
  const set = (patch: Partial<NonNullable<Estimate["projectDiscount"]>>) => {
    const next = { kind, value: pd?.value ?? "", ...(pd?.label ? { label: pd.label } : {}), ...patch };
    dispatch({ type: "patch", patch: { projectDiscount: next.value.trim() || next.label ? next : null } });
  };
  const invalid = t.issues.some((i) => i.field === "projectDiscount");
  return (
    <div className="mt-4" data-testid="project-discount">
      <div className="flex items-end justify-between gap-2">
        <label htmlFor="project-discount" className="label mb-0">Discount</label>
        <div role="radiogroup" aria-label="Discount type" className="grid grid-cols-2 rounded-lg border border-line-strong p-0.5 text-xs font-semibold">
          {(["amount", "percent"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => set({ kind: k })}
              className={cn("rounded-md px-2 py-1", kind === k ? "bg-brand text-white" : "text-ink-soft hover:bg-black/5")}>
              {k === "amount" ? "$" : "%"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-1">
        {kind === "amount" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>}
        <input id="project-discount" inputMode="decimal" value={pd?.value ?? ""} placeholder={kind === "amount" ? "0.00" : "0"}
          onChange={(ev) => set({ value: ev.target.value })}
          className={cn("field tabular", kind === "amount" ? "pl-7" : "pr-8")} aria-invalid={invalid} aria-describedby="project-discount-help" />
        {kind === "percent" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>}
      </div>
      <p id="project-discount-help" className={cn("mt-1 text-xs", invalid ? "text-danger" : "text-muted")}>
        {invalid
          ? t.issues.find((i) => i.field === "projectDiscount")?.message
          : t.projectDiscount.gt(0)
            ? `Customer sees ${formatCurrency(t.itemsPrice)} less ${formatCurrency(t.projectDiscount)} before tax. Tax is figured on the discounted price.`
            : "Off the whole job, before tax. Shown to your customer as its own line."}
      </p>
      {pd?.value.trim() ? (
        <div className="mt-2">
          <label htmlFor="project-discount-label" className="label">Discount label</label>
          <input id="project-discount-label" value={pd.label ?? ""} placeholder="Discount" maxLength={100} onChange={(ev) => set({ label: ev.target.value })} className="field field-sm" />
        </div>
      ) : null}
    </div>
  );
}
