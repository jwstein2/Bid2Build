import { Fragment } from "react";
import { PageHead, Panel } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { createAdminClient } from "@/lib/supabase/server";
import { bankProviderMode, taxProviderMode } from "@/lib/tax-banking/isolation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax & banking health" };

type Health = { tax: Record<string, unknown>; bank: { connectionsByStatus: Record<string, number>; connectionsByProvider: Record<string, number>; linkedAccounts: number; staleConnections: number; syncErrors7d: number } };

/**
 * Owner-only health of the V6.9 integrations: aggregate counts only. No customer's institution, balance,
 * transaction or tax detail is read here (admin_tax_banking_health returns totals).
 */
export default async function TaxBankingHealth() {
  await requireAdmin();
  const { data, error } = await createAdminClient().rpc("admin_tax_banking_health");
  const h = (data ?? null) as Health | null;
  const row = (k: string, v: unknown) => <><dt className="text-muted">{k}</dt><dd className="text-right font-semibold tabular-nums text-white">{v === null || v === undefined ? "—" : String(v)}</dd></>;
  return (
    <div className="space-y-6">
      <PageHead kicker="Operations" title="Tax & banking health" intro="Totals across all accounts. Practice (sandbox) connections are excluded. No customer's bank or tax details are shown here." />
      {error || !h ? <Panel title="Not installed"><p className="text-sm text-ink-soft">The V6.9 SQL (20261226001000) hasn&apos;t been run on this database yet.</p></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Tax data">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {row("Provider (configured)", taxProviderMode(process.env))}
              {row("Last successful rate update", h.tax.lastSuccessAt ?? "Never")}
              {row("Last run status", h.tax.lastStatus)}
              {row("Sync failures (7 days)", h.tax.syncFailures7d)}
              {row("Tax API calls (30 days)", h.tax.apiCalls30d)}
              {row("Changes waiting for review", h.tax.changesNeedingReview)}
              {row("Changes scheduled", h.tax.changesScheduled)}
              {row("Agency sites reachable", `${h.tax.authoritiesReachable} of ${h.tax.authoritiesTotal}`)}
              {row("Companies with tax setup", h.tax.booksWithProfiles)}
              {row("States covered by setups", h.tax.statesWithProfiles)}
              {row("Calculations needing review (30 days)", h.tax.reviewCalcs30d)}
              {row("Failed calculations (30 days)", h.tax.failedCalcs30d)}
            </dl>
          </Panel>
          <Panel title="Connected banks">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {row("Provider (configured)", bankProviderMode(process.env))}
              {row("Linked accounts", h.bank.linkedAccounts)}
              {row("Stale connections (no update in 2 days)", h.bank.staleConnections)}
              {row("Sync errors (7 days)", h.bank.syncErrors7d)}
              {Object.entries(h.bank.connectionsByStatus).map(([k, v]) => <Fragment key={k}>{row(`Connections: ${k.replace(/_/g, " ")}`, v)}</Fragment>)}
              {Object.entries(h.bank.connectionsByProvider).map(([k, v]) => <Fragment key={k}>{row(`Provider: ${k}`, v)}</Fragment>)}
            </dl>
          </Panel>
        </div>
      )}
    </div>
  );
}
