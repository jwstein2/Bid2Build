import Link from "next/link";
import { requireStaffCap } from "@/lib/staff/server";
import { Mini, PageHead, Panel } from "@/components/admin/cc";
import { PayoutLedger, type PayoutRow } from "@/components/payouts/ledger";
import { CashView, type BankingData } from "@/components/banking/cash-view";
import { loadStripeCash } from "@/lib/banking/stripe-load";
import { money } from "@/lib/payouts/labels";

export const metadata = { title: "Finance" };

/**
 * Read-only finance view for staff the owner granted finance or accountant access. No controls: approvals, settings,
 * live activation and bank designation stay on the owner's pages. Banking shows only with explicit banking visibility.
 */
export default async function StaffFinancePage() {
  const { user, db, caps } = await requireStaffCap("payouts.view");
  const banking = caps.includes("banking.view");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [{ data: o }, bank, stripe] = await Promise.all([
    db.rpc("admin_payouts_overview", { p_caller: user.id }),
    banking ? db.rpc("admin_banking_overview", { p_caller: user.id, p_since: new Date(now.getTime() - 120 * 864e5).toISOString().slice(0, 10) }) : Promise.resolve({ data: null }),
    banking ? loadStripeCash(new Date(`${monthStart}T00:00:00Z`)) : Promise.resolve(null),
  ]);
  const ov = o as { payouts: PayoutRow[]; liabilities?: { approved_unpaid_cents: number; earned_unapproved_cents: number }; settings: { mode: string; paused: boolean } } | null;
  const rows = ov?.payouts ?? [];
  const live = rows.filter((p) => p.mode === "live");
  const b = bank.data as BankingData | null;
  return (
    <div className="cc cc-grid -mx-4 min-h-screen space-y-6 rounded-2xl p-4 sm:-mx-6 sm:p-6">
      <PageHead kicker="Finance (read-only)" title="Payments & Payouts" intro="What's been paid, what's scheduled, and what's held. Changes are made by the owner." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini label="Mode" value={ov?.settings.mode === "live" ? (ov.settings.paused ? "Live · paused" : "Live") : ov?.settings.mode === "test" ? "Test" : "Off"} tone={ov?.settings.paused ? "red" : "blue"} />
        <Mini label="Paid (live)" value={money(live.filter((p) => p.status === "paid").reduce((n, p) => n + p.net_cents, 0))} tone="green" />
        <Mini label="Scheduled / in transit" value={money(live.filter((p) => ["scheduled", "submitting", "submitted"].includes(p.status)).reduce((n, p) => n + p.net_cents, 0))} />
        <Mini label="Held / needs approval" value={String(rows.filter((p) => p.status === "held" || p.status === "needs_approval").length)} tone="amber" />
      </div>
      <Panel title="Payout ledger" action={caps.includes("reports.export") ? <a className="cc-mono text-xs underline" href="/api/payouts/export">Export CSV</a> : undefined}>
        <PayoutLedger rows={rows} />
      </Panel>
      {banking ? (b?.designated ? <CashView b={b} stripe={stripe} monthStart={monthStart} /> : <Panel title="Banking"><p className="text-sm text-ink-soft">The owner hasn&apos;t designated the company bank books yet.</p></Panel>) : null}
      <p className="text-xs text-ink-soft"><Link className="underline" href="/staff">Back to my profile</Link></p>
    </div>
  );
}
