"use client";
import { Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import type { PlanId } from "@/lib/billing/plans";

/**
 * One Unlimited card with a Monthly / Annual switch (MKT-4). Both billing panels are rendered on the
 * server with their exact, approved billing copy and checkout button; the switch only shows one.
 * Starts on the plan in the URL (?plan= / ?resume= / ?upgrade=), then the person's current plan,
 * then Annual (the highlighted best value).
 */
export function UnlimitedCard({ currentPlan, monthly, annual, features, addon, footnote }: {
  currentPlan: PlanId | null;
  monthly: { price: string; per: string; billing: string; action: ReactNode };
  annual: { price: string; per: string; billing: string; note: ReactNode; savings: string; action: ReactNode };
  features: string[];
  addon?: ReactNode;
  footnote?: ReactNode;
}) {
  const params = useSearchParams();
  const fromUrl = [params.get("plan"), params.get("resume"), params.get("upgrade")].find((v) => v === "monthly" || v === "annual") as PlanId | undefined;
  const [plan, setPlan] = useState<PlanId>(fromUrl ?? currentPlan ?? "annual");
  const id = useId();
  const tab = (p: PlanId, label: string) => (
    <button type="button" role="radio" aria-checked={plan === p} onClick={() => setPlan(p)} data-testid={`billing-${p}`}
      className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${plan === p ? "bg-navy text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}>
      {label}
    </button>
  );
  return (
    <div className="relative flex flex-col rounded-2xl border border-accent bg-surface p-6 shadow-lg ring-2 ring-accent/30" data-testid="unlimited-plan">
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1 text-xs font-bold text-navy">Bid as often as you need</span>
      <h2 id={`${id}-h`} className="flex items-center justify-between gap-2 font-display text-lg font-bold">
        Individual Unlimited
        {currentPlan && <span className="shrink-0 whitespace-nowrap rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok" data-testid="current-plan">Your plan</span>}
      </h2>
      <div role="radiogroup" aria-label="Billing schedule" className="mt-3 flex gap-1 rounded-full border border-line bg-paper p-1">
        {tab("monthly", "Monthly")}
        {tab("annual", "Annual")}
      </div>
      <div hidden={plan !== "monthly"} data-panel="monthly">
        <p className="mt-4 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">{monthly.price}</span><span className="font-semibold text-muted">{monthly.per}</span></p>
        <p className="mt-1 text-sm font-semibold text-ink">{monthly.billing}</p>
      </div>
      <div hidden={plan !== "annual"} data-panel="annual">
        <p className="mt-4 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">{annual.price}</span><span className="font-semibold text-muted">{annual.per}</span></p>
        <p className="mt-1"><span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-bold text-ok" data-testid="annual-savings">Save {annual.savings} a year</span></p>
        <p className="mt-1 text-sm font-semibold text-ink">{annual.billing}</p>
        <p className="mt-1 text-sm text-ink-soft">{annual.note}</p>
      </div>
      <ul className="mt-5 flex-1 space-y-2 text-sm">{features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
      {addon && <div className="mt-4 rounded-xl border border-dashed border-line bg-paper p-3 text-sm" data-testid="unlimited-addon">{addon}</div>}
      <div className="mt-6">
        <div hidden={plan !== "monthly"}>{monthly.action}</div>
        <div hidden={plan !== "annual"}>{annual.action}</div>
      </div>
      {footnote && <p className="mt-3 text-xs text-ink-soft">{footnote}</p>}
    </div>
  );
}
