import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { Badge, Notice } from "@/components/ui/misc";
import { TbShell } from "@/components/tax-banking/shell";
import { CashChart } from "@/components/tax-banking/cash-chart";
import { CancelPlanned, CashPlanForm } from "@/components/tax-banking/cash-plan";
import { can } from "@/lib/tax-banking/capabilities";
import { loadForecast } from "@/lib/tax-banking/load";
import { fmtDateServer, fmtWhen } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Cash flow", robots: { index: false } };
type Row = Record<string, unknown>;
const HORIZONS = [7, 14, 30, 60, 90] as const;
const CATEGORY: Record<string, string> = { customer_payment: "Customer payment", deposit: "Deposit", milestone: "Milestone", payroll: "Payroll", supplier: "Supplier", subcontractor: "Subcontractor", recurring: "Recurring", check: "Uncleared check", transfer: "Transfer", other: "Other" };

/**
 * Cash-flow forecast: bank-reported balance (when the viewer may see it) plus what's scheduled and expected.
 * Every number is a forecast except the bank-reported balance; expected dates are estimates and say so.
 */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ h?: string; end?: string; acct?: string | string[] }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const shell = { state, title: "Cash flow", active: "cash" as const, cap: "cash.view_forecast" as const };
  if (state.kind !== "ready" || !can(state.ctx.access.permissions, "cash.view_forecast")) return <TbShell {...shell} />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canPlan = ctx.access.active && !ctx.access.readOnly && can(perms, "cash.manage_plan");
  const today = new Date().toISOString().slice(0, 10);
  const custom = sp.h === "custom" && sp.end && /^\d{4}-\d{2}-\d{2}$/.test(sp.end) && sp.end > today ? sp.end : undefined;
  const horizon = custom ? Math.min(365, Math.round((Date.parse(custom) - Date.parse(today)) / 864e5)) : HORIZONS.includes(Number(sp.h) as 7) ? Number(sp.h) : 30;
  const acctSel = (Array.isArray(sp.acct) ? sp.acct : sp.acct ? [sp.acct] : []).filter((a) => /^[0-9a-f-]{36}$/.test(a));
  const r = await loadForecast(db, ctx.bookId, perms, { horizon, end: custom, accounts: acctSel });
  if (!r.installed) return <TbShell {...shell}><Notice title="Cash flow turns on after the database update">The V6.9 SQL (20261226001000) hasn&apos;t been installed on this database yet. Nothing else is affected.</Notice></TbShell>;
  const f = r.forecast;
  const qs = (h: string, extra = "") => `/financials/cash?h=${h}${acctSel.map((a) => `&acct=${a}`).join("")}${extra}`;
  const planned = r.planned as Row[];
  const acctOpts = r.banks.accounts.filter((a) => a.status !== "disconnected").map((a) => ({ id: a.id, label: `${a.name}${a.last4 ? ` ••${a.last4}` : ""}` }));

  return (
    <TbShell {...shell} intro="Where your cash is headed: today's bank-reported balance, plus bills, payroll and planned payments with set dates, plus the invoices and milestones you expect to collect. Forecasts are estimates, not guarantees.">
      {!f.startsFromBank && (r.withBank
        ? <Notice title="No bank-reported balance yet">Connect a bank (or wait for its first update) and the forecast starts from the real balance. Until then it shows the net change from today.{" "}<Link href="/financials/banks" className="font-semibold underline">Connected banks</Link></Notice>
        : <Notice title="Showing net change only">Your role can see the forecast but not bank balances, so it starts at $0 and shows what&apos;s coming in and going out.</Notice>)}
      {f.stale && <Notice tone="warn" title="Bank balance may be out of date">The last bank update was {f.openingAsOf ? fmtWhen(f.openingAsOf) : "a while ago"}. Refresh it on Connected banks.</Notice>}
      {f.missingBalances.length > 0 && <Notice tone="warn" title="Some accounts didn't report a balance">{f.missingBalances.join(", ")}. They&apos;re left out of the starting balance.</Notice>}

      <form className="flex flex-wrap items-end gap-2" action="/financials/cash" data-testid="cash-controls">
        <nav aria-label="Forecast horizon" className="flex flex-wrap gap-1">
          {HORIZONS.map((h) => <Link key={h} href={qs(String(h))} aria-current={!custom && horizon === h ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${!custom && horizon === h ? "border-brand bg-brand-tint" : "border-line"}`}>{h} days</Link>)}
        </nav>
        <input type="hidden" name="h" value="custom" />
        {acctSel.map((a) => <input key={a} type="hidden" name="acct" value={a} />)}
        <label className="text-xs font-semibold text-ink-soft" htmlFor="cash-end">Custom end<input id="cash-end" name="end" type="date" min={today} defaultValue={custom ?? ""} className="field field-sm mt-1" /></label>
        <button type="submit" className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold">Show</button>
      </form>
      {r.accounts.length > 1 && (
        <nav aria-label="Accounts in the forecast" className="flex flex-wrap gap-2 text-sm">
          {r.accounts.map((a) => {
            const next = a.included ? r.accounts.filter((x) => x.included && x.id !== a.id) : [...r.accounts.filter((x) => x.included), a];
            const href = `/financials/cash?h=${custom ? "custom" : horizon}${custom ? `&end=${custom}` : ""}${next.map((x) => `&acct=${x.id}`).join("")}`;
            return <Link key={a.id} href={href} aria-pressed={a.included} className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 ${a.included ? "border-brand bg-brand-tint font-semibold" : "border-line text-ink-soft"}`}>{a.included ? "✓ " : ""}{a.name}</Link>;
          })}
        </nav>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="cash-kpis">
        {[
          { k: "Bank-reported balance", v: f.opening !== null ? formatCurrency(f.opening) : "—", sub: f.openingAsOf ? `As of ${fmtWhen(f.openingAsOf)}` : "Not connected", href: "/financials/banks" },
          { k: `Projected in ${horizon} days`, v: formatCurrency(f.end.expected), sub: `Scheduled only: ${formatCurrency(f.end.scheduled)}`, href: "#events", danger: Number(f.end.expected) < 0 },
          { k: "Expected money in", v: formatCurrency(f.totals.expectedIn), sub: `Scheduled: ${formatCurrency(f.totals.scheduledIn)}`, href: "/financials/receivables" },
          { k: "Expected money out", v: formatCurrency(f.totals.expectedOut.replace("-", "")), sub: `Scheduled: ${formatCurrency(f.totals.scheduledOut.replace("-", ""))}`, href: "/financials/records?view=costs&filter=bills_pending" },
          { k: "Lowest point", v: f.lowPoint ? formatCurrency(f.lowPoint.value) : "—", sub: f.lowPoint ? fmtDateServer(f.lowPoint.date) : "", href: "#events", danger: f.lowPoint ? Number(f.lowPoint.value) < 0 : false },
        ].map((m) => (
          <Link key={m.k} href={m.href} className="rounded-xl border border-line bg-surface p-3 hover:border-brand">
            <dt className="text-xs font-semibold text-muted">{m.k}</dt>
            <dd className={`font-display text-2xl font-extrabold tabular-nums ${m.danger ? "text-danger" : ""}`}>{m.v}</dd>
            <dd className="text-xs text-muted">{m.sub}</dd>
          </Link>
        ))}
      </dl>

      <CashChart series={f.series} events={f.events} scheduledEvents={f.scheduledEvents} startsFromBank={f.startsFromBank} />

      <section id="events" aria-labelledby="events-h" className="space-y-2">
        <h2 id="events-h" className="font-display text-lg font-extrabold">What&apos;s coming ({f.events.length})</h2>
        {f.events.length ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm" data-testid="cash-events">
              <thead><tr className="text-left text-xs text-muted"><th className="p-2">Date</th><th className="p-2">What</th><th className="p-2">Type</th><th className="p-2">How sure</th><th className="p-2 text-right">Amount</th></tr></thead>
              <tbody>{f.events.map((e) => (
                <tr key={e.key} className="border-t border-line">
                  <td className="whitespace-nowrap p-2">{fmtDateServer(e.date)}</td>
                  <td className="p-2">{e.href ? <Link href={e.href} className="text-accent-ink underline">{e.label}</Link> : e.label}{e.note && <span className="block text-xs text-muted">{e.note}</span>}</td>
                  <td className="p-2 text-ink-soft">{CATEGORY[e.category] ?? e.category}</td>
                  <td className="p-2"><Badge tone={e.certainty === "scheduled" ? "brand" : "neutral"}>{e.certainty === "scheduled" ? "Scheduled" : e.certainty === "confirmed" ? "Confirmed" : "Expected"}</Badge></td>
                  <td className={`p-2 text-right font-semibold tabular-nums ${Number(e.amount) < 0 ? "text-danger" : "text-ok"}`}>{Number(e.amount) < 0 ? "−" : "+"}{formatCurrency(e.amount.replace("-", ""))}</td>
                </tr>))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Nothing scheduled or expected in this window.</p>}
      </section>

      <section aria-labelledby="plan-h" className="space-y-2">
        <h2 id="plan-h" className="font-display text-lg font-extrabold">Cash plan</h2>
        <p className="text-sm text-ink-soft">Payroll, rent, expected deposits and transfers that aren&apos;t in your records yet. These are forecast entries only.</p>
        {canPlan && <CashPlanForm accounts={acctOpts} invoices={r.invoices} />}
        {planned.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {planned.map((p) => (
              <li key={String(p.id)} className="flex flex-wrap items-center gap-2 p-3">
                <span className="font-semibold">{String(p.label)}</span>
                <span className="text-muted">{p.direction === "in" ? "+" : "−"}{formatCurrency(String(p.amount))} · {fmtDateServer(String(p.expected_on))}{p.recurrence !== "none" ? ` · repeats ${String(p.recurrence)}` : ""}</span>
                <Badge tone={p.certainty === "scheduled" ? "brand" : "neutral"}>{p.certainty === "scheduled" ? "Scheduled" : "Expected"}</Badge>
                {canPlan && <span className="ml-auto"><CancelPlanned id={String(p.id)} /></span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </TbShell>
  );
}
