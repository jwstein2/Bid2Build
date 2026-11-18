import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadBank, loadLookups } from "@/lib/financials/accounting-load";
import { cmp } from "@/lib/financials/money";
import { formatCurrency } from "@/lib/estimate/money";
import { Badge, Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { AddBankAccount, BankLineActions, ImportStatement, ReconcilePanel, ReopenPeriod } from "@/components/financials/accounting/bank";
import { PrintButton } from "@/components/financials/accounting/controls";
import { fmtDateServer, fmtWhen } from "@/lib/financials/accounting-format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Reconciliation · Accounting", robots: { index: false } };
const VIEWS = { unmatched: "Not matched", all: "All lines", matched: "Matched", duplicates: "Possible duplicates", checks: "Outstanding checks" } as const;
type View = keyof typeof VIEWS;

/**
 * Bank reconciliation from imported statements. Bank lines are what the bank reported: never edited or
 * deleted. A person matches each line to a payment, refund, bill payment or expense of the same amount (or
 * excludes it with a reason), then confirms the period against the statement's ending balance. There is no
 * bank connection and nothing here can move money.
 */
export default async function Bank({ searchParams }: { searchParams: Promise<{ account?: string; view?: string; line?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title="Reconciliation" active="bank" guide="financials.accounting.bank" />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canWrite = ctx.access.active && !ctx.access.readOnly && perms.includes("reconcile");
  const canExport = perms.includes("export_financials");
  const L = await loadLookups(db, ctx.bookId);
  const bank = await loadBank(db, ctx.bookId, L);
  if (!bank.ready) {
    return (
      <AccountingShell state={state} title="Reconciliation" active="bank" guide="financials.accounting.bank">
        <Notice title="Bank reconciliation turns on after the database update">The Accountant Mode SQL (20261213001000) hasn&apos;t been installed on this database yet. Nothing else is affected.</Notice>
      </AccountingShell>
    );
  }
  const accounts = bank.accounts.filter((a) => a.status === "active");
  const acct = accounts.find((a) => a.id === sp.account) ?? accounts[0] ?? null;
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "unmatched";
  const lines = acct ? bank.lines.filter((l) => l.account_id === acct.id) : [];
  const shown = lines.filter((l) => view === "all" ? true : view === "matched" ? Boolean(l.match) : view === "duplicates" ? l.duplicate : view === "checks" ? false : !l.match);
  const recs = acct ? bank.reconciliations.filter((r) => r.account_id === acct.id) : [];
  const lastOpen = recs.find((r) => !r.reopened_at) ?? null;
  const imports = acct ? bank.imports.filter((i) => i.account_id === acct.id) : [];
  const jobs = [...L.jobs.values()].map((j) => ({ id: j.id, label: `${j.number} · ${j.name}` }));
  const codes = [...L.codes.values()].map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const label = new Map(bank.candidates.map((c) => [`${c.type}:${c.id}`, c.label]));
  const taken = new Set(bank.lines.filter((l) => l.match?.target_id).map((l) => `${l.match!.target_type}:${l.match!.target_id}`));
  // Outstanding checks: check payments to vendors (bill payments / expenses by check) not yet on any bank line.
  const { data: checkPays } = await db.from("fin_bill_payments").select("id, paid_on, amount, reference, bill_id").eq("book_id", ctx.bookId).eq("status", "active").eq("method", "check");
  const { data: checkExps } = await db.from("fin_expenses").select("id, number, spent_on, amount, payee, description").eq("book_id", ctx.bookId).in("status", ["pending", "approved"]).eq("method", "check");
  const outstanding = [
    ...((checkPays ?? []) as Record<string, string>[]).filter((p) => !taken.has(`bill_payment:${p.id}`)).map((p) => ({ key: `bp:${p.id}`, date: p.paid_on, amount: p.amount, label: label.get(`bill_payment:${p.id}`) ?? "Bill payment", ref: p.reference })),
    ...((checkExps ?? []) as Record<string, string>[]).filter((x) => !taken.has(`expense:${x.id}`)).map((x) => ({ key: `ex:${x.id}`, date: x.spent_on, amount: x.amount, label: `Expense ${x.number} · ${x.payee || x.description}`, ref: null as string | null })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const qs = (v: View) => `/financials/accounting/bank?account=${acct?.id ?? ""}&view=${v}`;

  return (
    <AccountingShell state={state} title="Reconciliation" active="bank" guide="financials.accounting.bank"
      intro="Import statements from your bank, match each line to a recorded payment, bill payment or expense, then confirm the period. Bank lines are never edited. No bank login, no connection, no money movement."
      actions={acct ? <div className="flex flex-wrap gap-2">{canExport && <ButtonLink href={`/api/financials/export?kind=bank_lines&account=${acct.id}&from=${acct.opening_date}`} variant="secondary" size="sm">Download lines (CSV)</ButtonLink>}
        {canExport && <ButtonLink href="/api/financials/export?kind=reconciliations" variant="secondary" size="sm">Reconciliation report (CSV)</ButtonLink>}<PrintButton /></div> : undefined}>
      {accounts.length > 0 && (
        <nav aria-label="Bank accounts" className="flex flex-wrap gap-2" data-guide="fin.bank-accounts">
          {accounts.map((a) => (
            <Link key={a.id} href={`/financials/accounting/bank?account=${a.id}`} aria-current={acct?.id === a.id ? "page" : undefined}
              className={cn("rounded-xl border px-3 py-2 text-sm", acct?.id === a.id ? "border-brand bg-brand-tint" : "border-line bg-surface")}>
              <span className="block font-semibold">{a.name}{a.last4 ? ` ••${a.last4}` : ""}</span>
              <span className="block text-xs text-muted">Imported lines balance {formatCurrency(bank.balances[a.id] ?? "0")} · {bank.lines.filter((l) => l.account_id === a.id && !l.match).length} not matched</span>
            </Link>
          ))}
        </nav>
      )}
      {canWrite ? <AddBankAccount first={accounts.length === 0} />
        : accounts.length === 0 && <Notice title="No bank accounts yet">Someone with the Reconcile permission can add a bank account and import statements.</Notice>}

      {acct && (
        <>
          {canWrite && <ImportStatement accounts={accounts.map((a) => ({ id: a.id, label: `${a.name}${a.last4 ? ` ••${a.last4}` : ""}` }))} accountId={acct.id} />}
          <section aria-labelledby="lines-h" className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <h2 id="lines-h" className="mr-auto font-display text-lg font-extrabold">Statement lines · {acct.name}</h2>
              <nav aria-label="Line filter" className="flex flex-wrap gap-1">
                {(Object.keys(VIEWS) as View[]).map((v) => (
                  <Link key={v} href={qs(v)} aria-current={view === v ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold", view === v ? "border-brand bg-brand text-white" : "border-line bg-surface")}>
                    {VIEWS[v]} ({v === "all" ? lines.length : v === "matched" ? lines.filter((l) => l.match).length : v === "duplicates" ? lines.filter((l) => l.duplicate).length : v === "checks" ? outstanding.length : lines.filter((l) => !l.match).length})
                  </Link>
                ))}
              </nav>
            </div>
            {view === "checks" ? (
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="text-sm text-ink-soft">Checks you recorded as paid that haven&apos;t shown up on an imported bank line yet. They clear when you match the line.</p>
                {outstanding.length ? <ul className="mt-2 divide-y divide-line">{outstanding.map((o) => <li key={o.key} className="flex flex-wrap gap-x-3 py-2 text-sm"><span className="flex-1">{o.label}{o.ref ? ` · #${o.ref}` : ""}</span><span className="text-muted">{fmtDateServer(o.date)}</span><span className="font-semibold tabular-nums">{formatCurrency(o.amount)}</span></li>)}</ul>
                  : <p className="mt-2 text-sm text-muted">No outstanding checks.</p>}
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-guide="fin.bank-lines" data-testid="fin-bank-lines">
                {shown.slice(0, 300).map((l) => {
                  const others = bank.candidates.filter((c) => cmp(c.amount, l.amount) === 0 && !taken.has(`${c.type}:${c.id}`) && !l.suggestions.some((s) => s.type === c.type && s.id === c.id)).slice(0, 30);
                  return (
                    <li key={l.id} id={`line-${l.id}`} className={cn("grid gap-2 px-4 py-3 md:grid-cols-[7rem_1fr_8rem_minmax(16rem,1.4fr)]", sp.line === l.id && "bg-brand-tint")}>
                      <span className="text-sm text-muted">{fmtDateServer(l.posted_on)}</span>
                      <span className="min-w-0 text-sm"><span className="font-semibold">{l.description}</span>{l.check_number ? <span className="text-muted"> · check #{l.check_number}</span> : null}
                        {l.duplicate && <> <Badge tone="warn">Appears twice</Badge></>}{l.locked && <> <Badge tone="neutral">Reconciled</Badge></>}</span>
                      <span className={`text-sm font-semibold tabular-nums md:text-right ${cmp(l.amount, 0) < 0 ? "" : "text-ok"}`}>{formatCurrency(l.amount)}</span>
                      <BankLineActions canWrite={canWrite} canExpense={perms.includes("record_expenses")} jobs={jobs} codes={codes}
                        others={others.map((o) => ({ type: o.type, id: o.id, label: `${o.label} · ${fmtDateServer(o.date)}` }))}
                        line={{ id: l.id, amount: l.amount, posted_on: l.posted_on, locked: l.locked, suggestions: l.suggestions.map((s) => ({ type: s.type, id: s.id, label: s.label, why: s.why })),
                          match: l.match ? { ...l.match, label: l.match.target_id ? label.get(`${l.match.target_type}:${l.match.target_id}`) ?? l.match.target_type.replace("_", " ") : "" } : null }} />
                    </li>
                  );
                })}
                {!shown.length && <li className="px-4 py-6 text-center text-sm text-muted">{lines.length ? "Nothing in this view." : "No lines yet. Import a statement to start."}</li>}
              </ul>
            )}
            {shown.length > 300 && <p className="text-xs text-muted">First 300 shown. Download the CSV for all lines.</p>}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <ReconcilePanel accountId={acct.id} openingBalance={acct.opening_balance} openingDate={acct.opening_date} lastEnd={lastOpen?.period_end ?? null} canWrite={canWrite}
              lines={lines.map((l) => ({ posted_on: l.posted_on, amount: l.amount, matched: Boolean(l.match) }))} />
            <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="rh" data-guide="fin.bank-history">
              <h2 id="rh" className="font-display text-base font-extrabold">Confirmed periods</h2>
              {recs.length ? (
                <ul className="mt-2 divide-y divide-line">
                  {recs.map((r) => (
                    <li key={r.id} className="py-2 text-sm">
                      <p><span className="font-semibold">Through {fmtDateServer(r.period_end)}</span> · statement {formatCurrency(r.statement_balance)} · bank {formatCurrency(r.bank_balance)}
                        {r.reopened_at ? <> <Badge tone="neutral">Reopened</Badge></> : r.status === "reconciled" ? <> <Badge tone="ok">Reconciled</Badge></> : <> <Badge tone="warn">Confirmed with differences</Badge></>}</p>
                      {r.status !== "reconciled" && <p className="text-xs text-ink-soft">Difference {formatCurrency(r.difference)} · {r.unmatched_count} unmatched · Note: {r.note}</p>}
                      {r.reopened_at && <p className="text-xs text-muted">Reopened {fmtWhen(r.reopened_at)}: {r.reopen_reason}</p>}
                      {!r.reopened_at && r.id === lastOpen?.id && canWrite && <ReopenPeriod id={r.id} />}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted">No periods confirmed yet.</p>}
              <h3 className="mt-4 text-sm font-bold">Imports</h3>
              {imports.length ? (
                <ul className="mt-1 divide-y divide-line">
                  {imports.map((i) => (
                    <li key={i.id} className="py-2 text-xs">
                      <span className="font-semibold">{i.file_name}</span> · {i.statement_start ?? "?"} to {i.statement_end ?? "?"} · {i.inserted_count} new, {i.skipped_count} skipped · imported {fmtWhen(i.imported_at)}
                      {i.balanced === false && <> <Badge tone="warn">Doesn&apos;t balance</Badge></>}{i.balanced === true && <> <Badge tone="ok">Balances</Badge></>}
                      {i.ending_balance !== null && <> · ending balance {formatCurrency(i.ending_balance)}</>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-muted">No statements imported yet.</p>}
            </section>
          </div>
        </>
      )}
    </AccountingShell>
  );
}
