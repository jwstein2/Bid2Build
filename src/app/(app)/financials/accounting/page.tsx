import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadBank, loadLookups, loadQueue, queueTotal } from "@/lib/financials/accounting-load";
import { QUEUE_KINDS, QUEUE_LABELS, type QueueKind } from "@/lib/financials/accounting";
import { formatCurrency } from "@/lib/estimate/money";
import { Notice } from "@/components/ui/misc";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { ClassifyControls, DuplicateActions } from "@/components/financials/accounting/controls";
import { fmtDateServer } from "@/lib/financials/accounting-format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Review queue · Accounting", robots: { index: false } };

/**
 * Accountant Mode: everything that needs a person, grouped by what's wrong. Each item says what to do next
 * and opens the record. Nothing is fixed automatically (no AI changes records); classification fills in
 * missing fields once, through the same rules as everywhere else.
 */
export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title="Review queue" active="queue" guide="financials.accounting" />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canWrite = ctx.access.active && !ctx.access.readOnly;
  const L = await loadLookups(db, ctx.bookId);
  const bank = await loadBank(db, ctx.bookId, L);
  const q = await loadQueue(db, ctx.bookId, L, bank);
  const kind: QueueKind | null = sp.kind && (QUEUE_KINDS as readonly string[]).includes(sp.kind) ? (sp.kind as QueueKind) : null;
  const total = queueTotal(q);
  const { data: sec } = await db.from("project_scope_sections").select("id, estimate_id, title").limit(2000);
  const byEstimate = new Map([...L.jobs.values()].map((j) => [j.estimateId, j.id] as const));
  const sections = ((sec ?? []) as { id: string; estimate_id: string; title: string }[]).filter((x) => byEstimate.has(x.estimate_id)).map((x) => ({ id: x.id, label: x.title, jobId: byEstimate.get(x.estimate_id)! }));
  const jobs = [...L.jobs.values()].map((j) => ({ id: j.id, label: `${j.number} · ${j.name}` }));
  const codes = [...L.codes.values()].map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const vendors = [...L.vendors.values()].map((v) => ({ id: v.id, label: v.name }));
  const shown = kind ? [kind] : QUEUE_KINDS.filter((k) => q[k].length > 0);

  return (
    <AccountingShell state={state} title="Review queue" active="queue" guide="financials.accounting"
      intro="Everything that needs a person, grouped by what's wrong. Each item says what to do next. Nothing here is changed for you.">
      {!bank.ready && <Notice title="Bank reconciliation isn't installed yet">Unmatched bank lines, imports and reconciliation differences appear here after the Accountant Mode database update is installed.</Notice>}
      <nav aria-label="Queue groups" className="flex flex-wrap gap-2" data-guide="fin.acct-queue-groups">
        <Link href="/financials/accounting" aria-current={!kind ? "page" : undefined} className={cn("inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold", !kind ? "border-brand bg-brand text-white" : "border-line bg-surface")}>All ({total})</Link>
        {QUEUE_KINDS.map((k) => (
          <Link key={k} href={`/financials/accounting?kind=${k}`} aria-current={kind === k ? "page" : undefined} data-testid={`fin-queue-chip-${k}`}
            className={cn("inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold", kind === k ? "border-brand bg-brand text-white" : "border-line bg-surface", !q[k].length && kind !== k && "text-muted")}>
            {QUEUE_LABELS[k].title} ({q[k].length})
          </Link>
        ))}
      </nav>
      {!shown.length && <Notice tone="ok" title="Nothing to review">Every cost has a code, every payment is applied, every bank line is matched or excluded.</Notice>}
      <div className="space-y-6" data-guide="fin.acct-queue">
        {shown.map((k) => (
          <section key={k} aria-labelledby={`q-${k}`} data-testid={`fin-queue-${k}`}>
            <h2 id={`q-${k}`} className="font-display text-lg font-extrabold">{QUEUE_LABELS[k].title} <span className="text-muted">({q[k].length})</span></h2>
            <p className="text-sm text-ink-soft">{QUEUE_LABELS[k].hint}{k === "missing_job" ? " Not counted in the total: overhead is fine when it's really overhead." : ""}</p>
            {q[k].length === 0 ? <p className="mt-2 text-sm text-muted">Nothing here.</p> : (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
                {q[k].slice(0, kind ? 200 : 8).map((it) => (
                  <li key={it.key} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="min-w-0 flex-1 font-semibold">{it.title}</p>
                      {it.amount && <span className="font-semibold tabular-nums">{formatCurrency(it.amount)}</span>}
                      {it.date && <span className="text-xs text-muted">{fmtDateServer(it.date)}</span>}
                    </div>
                    <p className="text-sm text-ink-soft">{it.detail}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Next: {QUEUE_LABELS[k].action}</span>
                      {it.href && <Link href={it.href} className="inline-flex min-h-9 items-center font-semibold text-accent-ink underline">Open the record</Link>}
                    </div>
                    {it.classify && <ClassifyControls c={it.classify} jobs={jobs} codes={codes} vendors={vendors} sections={sections}
                      canWrite={canWrite && perms.includes(it.classify.entityType === "expense" ? "record_expenses" : "record_bills")} />}
                    {it.reviewItemId && <DuplicateActions expenseId={it.expenseId} keep={it.duplicateOf ?? null} reviewItemId={it.reviewItemId}
                      canWrite={canWrite && perms.includes("record_expenses")} />}
                  </li>
                ))}
              </ul>
            )}
            {!kind && q[k].length > 8 && <Link href={`/financials/accounting?kind=${k}`} className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">See all {q[k].length}</Link>}
          </section>
        ))}
      </div>
    </AccountingShell>
  );
}
