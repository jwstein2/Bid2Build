import { Chip, Columns, Empty, Mini, Panel, Table } from "@/components/admin/cc";
import { CATEGORY_LABEL, categorize, matchStripeDeposits, reserve, summarize, type BankTxn, type Obligation } from "@/lib/banking/cashflow";
import type { StripeCash } from "@/lib/banking/stripe-load";
import { money } from "@/lib/payouts/labels";

export interface BankingData {
  designated: boolean; designated_at: string | null; book_name: string | null; books_available: { id: string; name: string }[];
  accounts: { id: string; name: string; kind: string; last4: string | null; institution_name: string | null; source: string; excluded: boolean; current: number | null; available: number | null; as_of: string | null; connection_status: string | null; last_success_at: string | null; sandbox: boolean }[];
  transactions: BankTxn[]; monthly: { month: string; in: number | null; out: number | null }[];
  cash_events: { label: string; amount: number; direction: "in" | "out"; expected_on: string; recurrence: string; certainty: string }[];
  payouts_upcoming: { ref: string; net_cents: number; scheduled_for: string; status: string; mode: string }[];
  payouts_paid: { ref: string; net_cents: number; fee_cents: number; fee_bearer: string; settled_at: string; mode: string }[];
  liabilities: { approved_unpaid_cents: number; earned_unapproved_cents: number }; software_monthly_cents: number; payroll_status: string;
}

const daysAhead = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const Src = ({ s }: { s: "bank" | "stripe" | "scheduled" | "forecast" }) => <Chip tone={s === "bank" ? "green" : s === "stripe" ? "violet" : s === "scheduled" ? "blue" : "muted"}>{s === "bank" ? "Bank-confirmed" : s === "stripe" ? "Stripe event" : s === "scheduled" ? "Scheduled" : "Forecast"}</Chip>;

/** Owner Banking & Cash Flow body, also used read-only for finance staff granted banking visibility. */
export function CashView({ b, stripe, monthStart }: { b: BankingData; stripe: StripeCash | null; monthStart: string }) {
  const sum = summarize(b.transactions, b.accounts, monthStart);
  const recon = stripe ? matchStripeDeposits(b.transactions, stripe.payouts) : null;
  const in30 = daysAhead(30);
  const obligations: Obligation[] = [
    ...b.payouts_upcoming.filter((p) => p.mode === "live").map((p) => ({ label: `Contractor payout ${p.ref}`, cents: p.net_cents, due: p.scheduled_for, source: "scheduled" as const })),
    { label: "Approved commissions not yet paid", cents: b.liabilities.approved_unpaid_cents - b.payouts_upcoming.filter((p) => p.mode === "live").reduce((n, p) => n + p.net_cents, 0), due: null, source: "scheduled" as const },
    ...b.cash_events.filter((e) => e.direction === "out" && e.expected_on <= in30).map((e) => ({ label: e.label, cents: Math.round(e.amount * 100), due: e.expected_on, source: "scheduled" as const })),
    { label: "Software subscriptions (30 days, from Tech Stack & Costs)", cents: b.software_monthly_cents, due: null, source: "forecast" as const },
    { label: "Earned commissions awaiting approval", cents: b.liabilities.earned_unapproved_cents, due: null, source: "forecast" as const },
  ].filter((o) => o.cents > 0);
  const expectedIn = (stripe?.pendingCents ?? 0) + b.cash_events.filter((e) => e.direction === "in" && e.expected_on <= in30).reduce((n, e) => n + Math.round(e.amount * 100), 0);
  const r = reserve(sum.cashCents, obligations, expectedIn);
  const freshest = b.accounts.map((a) => a.as_of).filter(Boolean).sort().at(-1);
  const alerts = [
    ...b.accounts.filter((a) => a.connection_status && a.connection_status !== "active").map((a) => `${a.name}: bank connection ${a.connection_status}`),
    ...(recon && recon.unmatchedPayouts.length ? [`${recon.unmatchedPayouts.length} Stripe payout(s) not found in the bank yet`] : []),
    ...(r.afterCents != null && r.afterCents < 0 ? ["Projected cash after known obligations is negative"] : []),
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Mini label="Cash (business accounts)" value={sum.cashCents == null ? "No balance" : money(sum.cashCents)} tone="green" />
        <Mini label="Bank income this month" value={money(sum.incomeCents)} />
        <Mini label="Bank expenses this month" value={money(sum.expenseCents)} />
        <Mini label="Net cash movement" value={money(sum.netCents)} tone={sum.netCents >= 0 ? "green" : "red"} />
        <Mini label="Known obligations (30d)" value={money(r.outCents)} tone="amber" />
        <Mini label="Projected after obligations" value={r.afterCents == null ? "—" : money(r.afterCents)} tone={r.afterCents != null && r.afterCents < 0 ? "red" : "blue"} />
      </div>
      {alerts.length > 0 && <Panel title="Alerts"><ul className="space-y-1 text-xs text-[var(--cc-amber)]">{alerts.map((a) => <li key={a}>{a}</li>)}</ul></Panel>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Connected business accounts" kicker={freshest ? `Latest bank data ${new Date(freshest).toLocaleString()}` : "No bank data yet"}>
          {b.accounts.length === 0 ? <Empty>No accounts in the designated book yet. Connect the bank (read-only) in that account&apos;s Financials → Banking, then refresh.</Empty> : (
            <Table head={["Account", "Available", "Current", "As of", "Connection"]}>
              {b.accounts.map((a) => (
                <tr key={a.id} className={a.excluded ? "opacity-50" : ""}><td className="text-white">{a.name} ••{a.last4 ?? "?"}<div className="text-[11px] text-ink-soft">{a.institution_name ?? a.source}{a.excluded ? " · excluded (personal)" : ""}{a.sandbox ? " · simulated (not a real bank)" : ""}</div></td>
                  <td>{a.available == null ? <span className="text-ink-soft">not reported</span> : money(Math.round(a.available * 100))}</td><td>{a.current == null ? "—" : money(Math.round(a.current * 100))}</td>
                  <td className="text-[11px] text-ink-soft">{a.as_of ? new Date(a.as_of).toLocaleString() : "—"}</td><td className="text-xs">{a.connection_status ?? (a.source === "statement_import" ? "statement import" : "—")}</td></tr>))}
            </Table>
          )}
          <p className="mt-2 text-[11px] text-ink-soft">Read-only: balances and transactions only. This connection can&apos;t move money, and bank monitoring access never grants payout authority.</p>
        </Panel>
        <Panel title="Incoming (Stripe)" action={<Src s="stripe" />}>
          {!stripe ? <Empty>Stripe isn&apos;t reachable from this server right now.</Empty> : (
            <ul className="space-y-1 text-sm text-white">
              <li className="flex justify-between"><span>Customer payments this month</span><span>{money(stripe.grossCents)}</span></li>
              <li className="flex justify-between"><span>Refunds</span><span>-{money(stripe.refundsCents)}</span></li>
              <li className="flex justify-between"><span>Chargebacks / disputes</span><span>-{money(stripe.disputesCents)}</span></li>
              <li className="flex justify-between"><span>Stripe fees</span><span>-{money(stripe.feesCents)}</span></li>
              <li className="flex justify-between text-ink-soft"><span>Pending Stripe settlements (expected in)</span><span>{money(stripe.pendingCents)}</span></li>
              <li className="flex justify-between text-ink-soft"><span>Available in Stripe</span><span>{money(stripe.availableCents)}</span></li>
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-soft">Revenue is counted once, from customer payments. Stripe deposits in the bank are settlements of that same money and are matched below, not added again.</p>
        </Panel>
      </div>
      <Panel title="Stripe deposits ↔ bank reconciliation" action={<Src s="bank" />}>
        {!recon ? <Empty>Needs Stripe and a bank feed.</Empty> : (
          <div className="grid gap-4 md:grid-cols-3 text-xs">
            <div><p className="cc-kicker mb-1">Matched ({recon.matched.length})</p><ul className="space-y-1 text-white">{recon.matched.slice(0, 12).map((m) => <li key={m.payout.id}>{m.payout.arrival_date} · {money(m.payout.amount_cents)} ✓</li>)}</ul></div>
            <div><p className="cc-kicker mb-1">Stripe payouts not in bank ({recon.unmatchedPayouts.length})</p><ul className="space-y-1 text-[var(--cc-amber)]">{recon.unmatchedPayouts.slice(0, 12).map((p) => <li key={p.id}>{p.arrival_date} · {money(p.amount_cents)}</li>)}</ul></div>
            <div><p className="cc-kicker mb-1">Stripe-labelled deposits without a payout ({recon.unmatchedDeposits.length})</p><ul className="space-y-1 text-[var(--cc-amber)]">{recon.unmatchedDeposits.slice(0, 12).map((t) => <li key={t.id}>{t.posted_on} · {money(Math.round(t.amount * 100))}</li>)}</ul></div>
          </div>
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="This month by category" action={<Src s="bank" />}>
          {sum.byCategory.length === 0 ? <Empty>No bank transactions this month.</Empty> : (
            <ul className="space-y-1 text-sm">{sum.byCategory.map((c) => <li key={c.category} className="flex justify-between text-white"><span>{CATEGORY_LABEL[c.category]}</span><span className={c.cents < 0 ? "text-[var(--cc-red)]" : ""}>{money(c.cents)}</span></li>)}</ul>
          )}
          {b.payouts_paid.length > 0 && <p className="mt-2 text-xs text-ink-soft">Contractor payouts settled: {money(b.payouts_paid.filter((p) => p.mode === "live").reduce((n, p) => n + p.net_cents, 0))} (paid from the Stripe payout balance; the bank shows the top-ups).</p>}
        </Panel>
        <Panel title="Known obligations, next 30 days">
          {obligations.length === 0 ? <Empty>None recorded.</Empty> : <ul className="space-y-1 text-sm">{obligations.map((o) => <li key={o.label} className="flex items-center justify-between gap-2 text-white"><span>{o.label}{o.due ? <span className="text-ink-soft"> · {o.due}</span> : ""}</span><span className="flex items-center gap-2">{money(o.cents)}<Src s={o.source} /></span></li>)}</ul>}
          <p className="mt-2 text-xs text-ink-soft">W-2 payroll: {b.payroll_status === "connected" ? "connected" : "Payroll Integration Required (no wages shown as paid)."}</p>
        </Panel>
      </div>
      <Panel title="Historical cash flow (bank-confirmed, 12 months)">
        {b.monthly.length === 0 ? <Empty>No history yet.</Empty> : (
          <div className="grid gap-4 md:grid-cols-2">
            <div><p className="cc-kicker mb-1">Money in</p><Columns tone="green" points={b.monthly.map((m) => ({ label: m.month.slice(5, 7), value: Math.round(m.in ?? 0) }))} /></div>
            <div><p className="cc-kicker mb-1">Money out</p><Columns tone="red" points={b.monthly.map((m) => ({ label: m.month.slice(5, 7), value: Math.round(m.out ?? 0) }))} /></div>
          </div>
        )}
      </Panel>
      <Panel title="Recent bank transactions">
        {b.transactions.length === 0 ? <Empty>None.</Empty> : (
          <Table head={["Date", "Description", "Category", "Amount"]} align={["l", "l", "l", "r"]}>
            {b.transactions.slice(0, 60).map((t) => <tr key={t.id}><td className="text-ink-soft">{t.posted_on}</td><td className="text-white">{t.description}</td><td className="text-xs text-ink-soft">{CATEGORY_LABEL[categorize(t)]}</td><td className={`text-right ${t.amount < 0 ? "text-[var(--cc-red)]" : "text-white"}`}>{money(Math.round(t.amount * 100))}</td></tr>)}
          </Table>
        )}
      </Panel>
    </div>
  );
}
