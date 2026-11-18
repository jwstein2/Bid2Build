import { Fragment } from "react";
import { PageHead, Panel } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { createAdminClient } from "@/lib/supabase/server";
import { bankProviderMode, taxProviderMode } from "@/lib/tax-banking/isolation";
import { importStateNow, saveSourceLinks } from "./actions";
import { PlaidCostPanel } from "@/components/admin/plaid-cost";
import { loadPlaidUsage } from "@/lib/admin/plaid-cost-load";

type Source = { state: string; kind: string; status: string; listing_url: string | null; rate_url: string | null; boundary_url: string | null; last_success_at: string | null;
  last_error: string | null; last_rate_file: string | null; rates_loaded: number; zips_loaded: number };
const TONE: Record<string, string> = { ok: "text-emerald-300", not_needed: "text-ink-soft", needs_link: "text-amber-300", failed: "text-red-300", format_changed: "text-red-300" };

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax & banking health" };

type Health = { tax: Record<string, unknown>; bank: { connectionsByStatus: Record<string, number>; connectionsByProvider: Record<string, number>; linkedAccounts: number; staleConnections: number; syncErrors7d: number } };

/**
 * Owner-only health of the V6.9 integrations: aggregate counts only. No customer's institution, balance,
 * transaction or tax detail is read here (admin_tax_banking_health returns totals).
 */
export default async function TaxBankingHealth() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data, error }, { data: srcData }, plaid] = await Promise.all([
    admin.rpc("admin_tax_banking_health"),
    admin.from("tax_rate_sources").select("state, kind, status, listing_url, rate_url, boundary_url, last_success_at, last_error, last_rate_file, rates_loaded, zips_loaded").order("state"),
    loadPlaidUsage(),
  ]);
  const h = (data ?? null) as Health | null;
  const sources = (srcData ?? []) as Source[];
  const row = (k: string, v: unknown) => <><dt className="text-muted">{k}</dt><dd className="text-right font-semibold tabular-nums text-white">{v === null || v === undefined ? "—" : String(v)}</dd></>;
  return (
    <div className="space-y-6">
      <PageHead kicker="Operations" title="Tax & banking health" intro="Totals across all accounts. Practice (sandbox) connections are excluded. No customer's bank or tax details are shown here." />
      {error || !h ? <Panel title="Not installed"><p className="text-sm text-ink-soft">The V6.9 SQL (20261226001000) hasn&apos;t been run on this database yet.</p></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Tax data">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {row("Engine", taxProviderMode(process.env) === "builtin" ? "Built-in (official state files, free)" : taxProviderMode(process.env))}
              {row("States with official rates loaded", h.tax.statesLoaded)}
              {row("States needing a file link or fix", h.tax.statesNeedingSource)}
              {row("Last successful rate update", h.tax.lastSuccessAt ?? "Never")}
              {row("Last run status", h.tax.lastStatus)}
              {row("Sync failures (7 days)", h.tax.syncFailures7d)}
              {row("Changes waiting for review", h.tax.changesNeedingReview)}
              {row("Changes scheduled", h.tax.changesScheduled)}
              {row("Agency sites reachable", `${h.tax.authoritiesReachable} of ${h.tax.authoritiesTotal}`)}
              {row("Companies with tax setup", h.tax.booksWithProfiles)}
              {row("States covered by setups", h.tax.statesWithProfiles)}
              {row("Calculations needing review (30 days)", h.tax.reviewCalcs30d)}
              {row("Failed calculations (30 days)", h.tax.failedCalcs30d)}
            </dl>
          </Panel>
          <Panel title="Official rate files (built-in tax engine)" className="lg:col-span-2">
            <p className="mb-3 text-sm text-ink-soft">Each state&apos;s official rate file is imported hourly, oldest first. A state that can&apos;t be read keeps its last good rates; bids there show the statewide rate and flag the local part. Paste a direct file link or the official page that lists the files to fix a state.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted"><th className="p-1.5">State</th><th className="p-1.5">Source</th><th className="p-1.5">Status</th><th className="p-1.5">Rates</th><th className="p-1.5">ZIPs</th><th className="p-1.5">Last good import</th><th className="p-1.5">Links</th></tr></thead>
                <tbody>{sources.map((s) => (
                  <tr key={s.state} className="border-t border-white/10 align-top">
                    <td className="p-1.5 font-semibold text-white">{s.state}</td>
                    <td className="p-1.5">{s.kind === "sst" ? "Streamlined files" : s.kind === "state_table" ? "State table" : s.kind === "state_only" ? "Statewide only" : "No sales tax"}</td>
                    <td className={`p-1.5 ${TONE[s.status] ?? ""}`}>{s.status.replace(/_/g, " ")}{s.last_error ? <span className="block max-w-[240px] text-ink-soft">{s.last_error}</span> : null}</td>
                    <td className="p-1.5 tabular-nums">{s.rates_loaded || "—"}</td>
                    <td className="p-1.5 tabular-nums">{s.zips_loaded || "—"}</td>
                    <td className="p-1.5">{s.last_success_at ? new Date(s.last_success_at).toISOString().slice(0, 16).replace("T", " ") : "Never"}{s.last_rate_file ? <span className="block text-ink-soft">{s.last_rate_file}</span> : null}</td>
                    <td className="p-1.5">
                      {s.kind === "sst" || s.kind === "state_table" ? (
                        <details><summary className="cursor-pointer text-accent-ink">Edit</summary>
                          <form action={saveSourceLinks} className="mt-1 grid min-w-[280px] gap-1">
                            <input type="hidden" name="state" value={s.state} />
                            <input name="listingUrl" defaultValue={s.listing_url ?? ""} placeholder="Official page listing the files (https://…)" className="field h-8 text-xs" />
                            <input name="rateUrl" defaultValue={s.rate_url ?? ""} placeholder="Direct rate file link (optional)" className="field h-8 text-xs" />
                            <input name="boundaryUrl" defaultValue={s.boundary_url ?? ""} placeholder="Direct boundary file link (optional)" className="field h-8 text-xs" />
                            <button type="submit" className="rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-white">Save links</button>
                          </form>
                          <form action={importStateNow} className="mt-1"><input type="hidden" name="state" value={s.state} /><button type="submit" className="rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-white">Import now</button></form>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
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
          <PlaidCostPanel u={plaid} />
        </div>
      )}
    </div>
  );
}
