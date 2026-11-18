import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadAudit } from "@/lib/financials/accounting-load";
import { auditSummary, AUDIT_GROUPS } from "@/lib/financials/audit-view";
import { Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { PrintButton } from "@/components/financials/accounting/controls";
import { fmtWhen } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Audit trail · Accounting", robots: { index: false } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The financial audit trail: who did what, when, to which record, with previous and new values where the
 * action recorded them. Append-only (nobody can edit or delete an entry); sensitive keys are hidden by
 * public.fin_redact before they leave the database.
 */
export default async function AuditTrail({ searchParams }: { searchParams: Promise<{ q?: string; group?: string; from?: string; to?: string; before?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title="Audit trail" active="audit" guide="financials.accounting.audit" />;
  const { ctx } = state;
  const group = AUDIT_GROUPS.find((g) => g.key === sp.group) ?? null;
  const filter = { q: (sp.q ?? "").slice(0, 100) || undefined, action: group?.prefix, from: DAY.test(sp.from ?? "") ? sp.from : undefined, to: DAY.test(sp.to ?? "") ? sp.to : undefined,
    before: /^\d{1,18}$/.test(sp.before ?? "") ? sp.before : undefined, limit: 100 };
  const res = await loadAudit(db, ctx.bookId, filter);
  const canExport = ctx.access.permissions.includes("export_financials");
  const qs = new URLSearchParams(Object.entries({ q: filter.q, from: filter.from, to: filter.to }).filter(([, v]) => v) as [string, string][]).toString();
  const sel = "field field-sm mt-1";
  return (
    <AccountingShell state={state} title="Audit trail" active="audit" guide="financials.accounting.audit"
      intro="Every financial action: who, what, when, which record, and the previous and new values where they apply. Entries can't be edited or deleted. Tax IDs, account numbers and tokens are hidden."
      actions={<div className="no-print flex flex-wrap gap-2">{canExport && <ButtonLink href={`/api/financials/export?kind=audit_trail${qs ? `&${qs}` : ""}`} variant="secondary" size="sm">Download CSV</ButtonLink>}<PrintButton /></div>}>
      <form method="get" role="search" aria-label="Filter the audit trail" className="no-print grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5" data-guide="fin.acct-audit-filters">
        <label className="label lg:col-span-2" htmlFor="aq">Search<input id="aq" name="q" type="search" className={sel} defaultValue={filter.q} placeholder="Action, record type or any value" /></label>
        <label className="label" htmlFor="ag">What<select id="ag" name="group" className={sel} defaultValue={group?.key ?? ""}><option value="">Everything</option>{AUDIT_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label>
        <label className="label" htmlFor="af">From<input id="af" name="from" type="date" className={sel} defaultValue={filter.from} /></label>
        <label className="label" htmlFor="at">To<input id="at" name="to" type="date" className={sel} defaultValue={filter.to} /></label>
        <div className="flex items-end gap-2"><button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">Apply</button><Link href="/financials/accounting/audit" className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-ink underline">Clear</Link></div>
      </form>
      {!res.ok ? <Notice title={res.reason === "not_installed" ? "The audit trail viewer turns on after the database update" : "The audit trail isn't available"}>{res.reason === "not_installed" ? "Actions are still being recorded; the viewer needs the Accountant Mode SQL (20261213001000)." : "Try again in a moment."}</Notice> : (
        <>
          <ol className="divide-y divide-line rounded-xl border border-line bg-surface" data-guide="fin.acct-audit-list" data-testid="fin-audit-list">
            {res.rows.map((e) => {
              const s = auditSummary(e.action, e.details);
              return (
                <li key={e.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3"><span className="font-semibold">{s.title}</span><span className="text-muted">by {e.actor_name}</span><span className="ml-auto text-xs text-muted">{fmtWhen(e.created_at)}</span></div>
                  <p className="text-xs text-ink-soft">{e.entity_type.replace(/_/g, " ")}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ""} · {e.action}</p>
                  {s.changes.length > 0 && <dl className="mt-1 grid gap-x-4 text-xs sm:grid-cols-[10rem_1fr_1fr]">{s.changes.map((c) => <div key={c.field} className="contents"><dt className="font-semibold">{c.field}</dt><dd>Before: {c.before}</dd><dd>After: {c.after}</dd></div>)}</dl>}
                  {s.facts.length > 0 && <p className="mt-1 text-xs text-ink-soft">{s.facts.join(" · ")}</p>}
                </li>
              );
            })}
            {!res.rows.length && <li className="px-4 py-6 text-center text-sm text-muted">No entries match.</li>}
          </ol>
          {res.rows.length === 100 && <Link href={`/financials/accounting/audit?${new URLSearchParams({ ...(qs ? Object.fromEntries(new URLSearchParams(qs)) : {}), ...(group ? { group: group.key } : {}), before: String(res.rows.at(-1)!.id) }).toString()}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-ink underline">Older entries</Link>}
        </>
      )}
    </AccountingShell>
  );
}
