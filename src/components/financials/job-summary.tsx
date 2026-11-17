"use client";
import { Download, FilePlus2, HandCoins, Receipt, ScrollText, UserRound, Wrench } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { cmp, sub } from "@/lib/financials/money";
import { BasisBadge } from "./basis";
import { usd } from "./fin-client";

type R = Record<string, unknown>;
export type SummaryTarget = "contract" | "budget" | "invoices" | "payments" | "bills";
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Project Financials at a glance (V5.1 §2): the six numbers a contractor asks first, each opening the
 * records behind it, plus the secondary figures and one-click actions. Figures come only from
 * fin_job_summary_v (contract snapshot + approved changes, frozen budget, issued invoices, applied
 * payments). AR never includes milestones that haven't been invoiced.
 */
export function JobSummary({ summary, estimateId, customerId, perms, writable, onOpen, onAction }: {
  summary: R; estimateId: string; customerId: string | null;
  perms: { invoice: boolean; pay: boolean; expense: boolean; bill: boolean; company: boolean };
  writable: boolean;
  onOpen: (t: SummaryTarget) => void;
  onAction: (a: "invoice" | "payment" | "expense" | "bill") => void;
}) {
  const v = (k: string) => s(summary[k]) || "0";
  const forecastUp = cmp(v("forecast_cost"), v("original_estimated_cost")) > 0;
  const overbilled = cmp(v("unbilled"), 0) < 0;
  const marginPct = s(summary.forecast_margin_pct);
  const jobId = s(summary.job_id);
  return (
    <section aria-labelledby="fin-summary-h" className="space-y-3" data-testid="fin-job-summary" data-guide="fin.job-summary">
      <h2 id="fin-summary-h" className="sr-only">Project financial summary</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard size="sm" title="Approved contract" value={usd(v("contract_value"))} status={<BasisBadge basis="Contracted" />}
          sub={cmp(v("contract_changes"), 0) !== 0 ? `${usd(v("original_contract"))} signed ${cmp(v("contract_changes"), 0) > 0 ? "+" : ""}${usd(v("contract_changes"))} changes` : "What you sold the job for"}
          onSelect={() => onOpen("contract")} action="Contract & changes" testId="fin-sum-contract" />
        <MetricCard size="sm" title="Original estimated cost" value={usd(v("original_estimated_cost"))} status={<BasisBadge basis="Estimated" />}
          sub="Frozen from the signed bid" onSelect={() => onOpen("budget")} action="Budget by trade" testId="fin-sum-estimated" />
        <MetricCard size="sm" title="Current forecast cost" value={usd(v("forecast_cost"))} status={<BasisBadge basis="Forecast" />} tone={forecastUp ? "warn" : "default"}
          sub={forecastUp ? `${usd(sub(v("forecast_cost"), v("original_estimated_cost")))} over the estimate` : "Actual + committed, by trade"}
          onSelect={() => onOpen("budget")} action="Estimate vs forecast" testId="fin-sum-forecast" />
        <MetricCard size="sm" title="Invoiced to date" value={usd(v("invoiced"))} status={<BasisBadge basis="Invoiced" />}
          sub={overbilled ? "Billed more than the contract" : `${usd(v("unbilled"))} approved, not billed yet`} tone={overbilled ? "danger" : "default"}
          onSelect={() => onOpen("invoices")} action="Invoices" testId="fin-sum-invoiced" />
        <MetricCard size="sm" title="Collected to date" value={usd(v("collected"))} status={<BasisBadge basis="Paid" />}
          sub="Payments applied to invoices" onSelect={() => onOpen("payments")} action="Payments" testId="fin-sum-collected" />
        <MetricCard size="sm" title="Outstanding AR" value={usd(v("outstanding_ar"))}
          tone={cmp(v("overdue_ar"), 0) > 0 ? "danger" : "default"} empty={cmp(v("outstanding_ar"), 0) === 0}
          sub={cmp(v("overdue_ar"), 0) > 0 ? `${usd(v("overdue_ar"))} past due` : "Issued invoices not yet paid"}
          href={`/financials/receivables?job=${jobId}`} action="Receivables" testId="fin-sum-ar" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="fin-sum-secondary">
        <MetricCard size="sm" title="Approved but unbilled" value={usd(v("unbilled"))} onSelect={() => onOpen("contract")} action="Payment schedule" tone={overbilled ? "danger" : "default"} testId="fin-sum-unbilled" />
        <MetricCard size="sm" title="Forecast gross profit" value={usd(v("forecast_profit"))} status={<BasisBadge basis="Forecast" />} tone={cmp(v("forecast_profit"), 0) < 0 ? "danger" : "default"}
          sub={`Estimated ${usd(v("estimated_profit"))}`} onSelect={() => onOpen("budget")} action="How it's calculated" testId="fin-sum-profit" />
        <MetricCard size="sm" title="Forecast gross margin" value={marginPct ? `${marginPct}%` : "—"} status={<BasisBadge basis="Forecast" />}
          sub={summary.estimated_margin_pct ? `Estimated ${s(summary.estimated_margin_pct)}%` : undefined} onSelect={() => onOpen("budget")} action="Budget by trade" testId="fin-sum-margin" />
        <MetricCard size="sm" title="Pending change orders" value={usd(v("pending_changes"))} empty={cmp(v("pending_changes"), 0) === 0}
          sub="Not in the contract until approved" href={`/builder?draft=${estimateId}`} action="Open change orders" testId="fin-sum-pending" />
        <MetricCard size="sm" title="Unpaid sub bills" value={usd(v("unpaid_sub_bills"))} empty={cmp(v("unpaid_sub_bills"), 0) === 0}
          sub={cmp(v("unpaid_bills"), v("unpaid_sub_bills")) !== 0 ? `${usd(v("unpaid_bills"))} all vendors` : "Approved, not yet paid"} onSelect={() => onOpen("bills")} action="Vendor bills" testId="fin-sum-bills" />
      </div>

      <div className="flex flex-wrap gap-2" data-testid="fin-sum-actions" data-guide="fin.job-actions">
        {perms.invoice && writable && <Button size="sm" onClick={() => onAction("invoice")}><FilePlus2 className="h-4 w-4" aria-hidden /> Create invoice</Button>}
        {perms.pay && writable && <Button size="sm" variant="secondary" onClick={() => onAction("payment")}><HandCoins className="h-4 w-4" aria-hidden /> Record payment</Button>}
        {customerId && <ButtonLink href={`/financials/customers/${customerId}`} size="sm" variant="ghost"><UserRound className="h-4 w-4" aria-hidden /> Customer ledger</ButtonLink>}
        {perms.expense && writable && <Button size="sm" variant="ghost" onClick={() => onAction("expense")}><Receipt className="h-4 w-4" aria-hidden /> Add expense</Button>}
        {perms.bill && writable && <Button size="sm" variant="ghost" onClick={() => onAction("bill")}><Wrench className="h-4 w-4" aria-hidden /> Sub / vendor bill</Button>}
        <ButtonLink href={`/builder?draft=${estimateId}`} size="sm" variant="ghost"><ScrollText className="h-4 w-4" aria-hidden /> Change order</ButtonLink>
        <a href={`/api/financials/jobs/${estimateId}/report`} className={buttonClass("ghost", "sm")} download><Download className="h-4 w-4" aria-hidden /> Financial report (CSV)</a>
      </div>
    </section>
  );
}
