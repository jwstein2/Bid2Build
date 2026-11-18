import Link from "next/link";
import { MetricCard } from "@/components/ui/metric-card";
import { ButtonLink } from "@/components/ui/button";
import { formatCurrency } from "@/lib/estimate/money";
import { QUEUE_KINDS, QUEUE_LABELS, type AccountantAction, type QueueKind } from "@/lib/financials/accounting";
import type { AccountantMetrics } from "@/lib/financials/accounting-load";
import { fmtDateServer, fmtWhen } from "@/lib/financials/accounting-format";
import { cmp } from "@/lib/financials/money";
import { AccountantNav } from "./shell";

/**
 * Accountant Mode on the Financials home: the six accountant numbers (each opens its records), what's in the
 * review queue, and the accountant quick actions this person may use. The bank balance is only ever the
 * ending balance of an imported statement, with its source and when it was imported; never estimated.
 */
export function AccountantHome({ m, counts, actions }: { m: AccountantMetrics; counts: Record<QueueKind, number>; actions: AccountantAction[] }) {
  const queued = QUEUE_KINDS.filter((k) => k !== "missing_job" && counts[k] > 0);
  return (
    <div className="space-y-5" data-testid="fin-accountant-home">
      <AccountantNav />
      <section aria-labelledby="acct-kpi-h" data-guide="fin.acct-kpis">
        <h2 id="acct-kpi-h" className="sr-only">Accountant numbers</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard title="Bank-reported balance" testId="fin-acct-bank" href="/financials/accounting/bank" action={m.bankBalance ? "View statements" : "Import a statement"}
            value={m.bankBalance ? formatCurrency(m.bankBalance.amount) : "No statement yet"} empty={!m.bankBalance}
            sub={m.bankBalance ? `${m.bankBalance.source} · as of ${fmtDateServer(m.bankBalance.asOf)} · imported ${fmtWhen(m.bankBalance.refreshedAt)}`
              : m.bankReady ? "Import a bank statement with its ending balance to see this. Nothing is estimated." : "Turns on after the Accountant Mode database update."} />
          <MetricCard title="Projected balance (30 days)" testId="fin-acct-projected" href="/financials/accounting/bank" action="How it's worked out"
            value={m.projected ? formatCurrency(m.projected.amount) : "Not yet"} empty={!m.projected}
            sub={m.projected ? `Forecast: bank-reported ${formatCurrency(m.bankBalance!.amount)} + customer invoices due ${formatCurrency(m.projected.arIn)} − bills due ${formatCurrency(m.projected.apOut)}` : "Shown once a statement ending balance is imported."} />
          <MetricCard title="Accounts receivable" testId="fin-acct-ar" href="/financials/receivables" action="View receivables" value={formatCurrency(m.ar.amount)} empty={m.ar.count === 0}
            tone={cmp(m.ar.overdue, 0) > 0 ? "warn" : "default"} sub={`${m.ar.count} open invoice${m.ar.count === 1 ? "" : "s"} · ${formatCurrency(m.ar.overdue)} past due`} />
          <MetricCard title="Accounts payable" testId="fin-acct-ap" href="/financials/accounting/reports?r=ap_aging" action="View AP aging" value={formatCurrency(m.ap.amount)} empty={m.ap.count === 0}
            tone={cmp(m.ap.overdue, 0) > 0 ? "danger" : "default"} sub={`${m.ap.count} approved bill${m.ap.count === 1 ? "" : "s"} unpaid · ${formatCurrency(m.ap.overdue)} past due`} />
          <MetricCard title="Unreconciled bank lines" testId="fin-acct-unrec" href="/financials/accounting/bank" action="Match lines" value={String(m.unreconciled)} empty={m.unreconciled === 0}
            tone={m.unreconciled ? "warn" : "ok"} sub={m.bankReady ? "Imported lines not yet matched or excluded" : "Turns on after the database update"} />
          <MetricCard title="Transactions needing review" testId="fin-acct-review" href="/financials/accounting" action="Open the review queue" value={String(m.needsReview)} empty={m.needsReview === 0}
            tone={m.needsReview ? "warn" : "ok"} sub="Uncategorized, unmatched, duplicates, unapplied, bills" />
        </div>
      </section>
      {queued.length > 0 && (
        <section aria-labelledby="acct-q-h" className="rounded-xl border border-line bg-surface p-4" data-guide="fin.acct-queue-summary">
          <h2 id="acct-q-h" className="font-display text-lg font-extrabold">In the review queue</h2>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {queued.map((k) => <li key={k}><Link href={`/financials/accounting?kind=${k}`} className="flex min-h-11 items-center gap-2 text-sm"><span className="font-semibold text-accent-ink underline">{QUEUE_LABELS[k].title}</span><span className="rounded-full bg-warn-tint px-2 text-xs font-bold">{counts[k]}</span></Link></li>)}
          </ul>
        </section>
      )}
      {actions.length > 0 && (
        <section aria-labelledby="acct-qa-h" data-guide="fin.acct-quick" data-testid="fin-acct-quick">
          <h2 id="acct-qa-h" className="mb-2 font-display text-lg font-extrabold">Accountant quick actions</h2>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => a.href.startsWith("/api/")
              ? <a key={a.key} href={a.href} title={a.hint} className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:border-line-strong" data-testid={`fin-acct-action-${a.key}`}>{a.label}</a>
              : <ButtonLink key={a.key} href={a.href} title={a.hint} variant="secondary" size="sm" data-testid={`fin-acct-action-${a.key}`}>{a.label}</ButtonLink>)}
          </div>
        </section>
      )}
    </div>
  );
}
