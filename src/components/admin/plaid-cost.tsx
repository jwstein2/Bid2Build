import { NotConnected, Panel, Row, fmt, usd } from "@/components/admin/cc";
import type { PlaidUsage } from "@/lib/admin/plaid-cost";
import { bankProviderMode } from "@/lib/tax-banking/isolation";

const price = (c: number | null) => (c == null ? <span className="text-[var(--cc-amber)]">Not set</span> : `$${(c / 100).toFixed(Number.isInteger(c) ? 2 : 4)}`);
const money = (c: number | null) => (c == null ? <span className="text-[var(--cc-amber)]">Unknown</span> : usd(c));

/** Plaid status + live usage-based cost estimate (owner pages only). */
export function PlaidCostPanel({ u, className }: { u: PlaidUsage | null; className?: string }) {
  const mode = bankProviderMode(process.env);
  const env = (process.env.PLAID_ENV ?? "sandbox").trim() === "production" ? "Production" : "Sandbox";
  return (
    <Panel title="Plaid (bank feeds)" className={className} action={mode === "plaid" ? <span className="cc-mono text-[11px] text-[var(--cc-green)]">Live · {env}</span> : <NotConnected>{mode === "none" ? "Off" : "Practice mode"}</NotConnected>}>
      {!u ? <p className="text-sm text-ink-soft">Usage appears after the V6.9 SQL (20261226001000) is applied.</p> : (
        <dl>
          <Row k="Connected banks (billable this month)">{fmt(u.billableItems)}</Row>
          <Row k="Live now">{fmt(u.activeItems)}{u.needsAttention ? <span className="text-[var(--cc-amber)]"> · {fmt(u.needsAttention)} need attention</span> : null}</Row>
          <Row k="Balance refreshes this month">{fmt(u.balanceCallsMtd)} <span className="text-muted">(≈{fmt(u.projectedBalanceCalls)} by month end)</span></Row>
          <Row k="Price per connected bank / month">{price(u.prices.transactionsCents)}</Row>
          <Row k="Price per balance refresh">{price(u.prices.balanceCents)}</Row>
          <Row k="Estimated cost so far">{money(u.mtdCents)}</Row>
          <Row k="Projected this month">{money(u.projectedCents)}</Row>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted">
        Estimated from Built2Bid&apos;s own records (practice connections excluded). Plaid bills Transactions per connected bank each month and Balance per refresh.
        {u && (u.prices.transactionsCents == null || u.prices.balanceCents == null) ? " Set PLAID_PRICE_TRANSACTIONS_USD and PLAID_PRICE_BALANCE_USD from Plaid Dashboard → Billing to see dollars." : ""}{" "}
        The Plaid invoice is the source of truth: <a className="underline" href="https://dashboard.plaid.com/settings/team/billing" target="_blank" rel="noopener noreferrer">Plaid billing</a>.
      </p>
    </Panel>
  );
}
