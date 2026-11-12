import { Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { clearSynthetic, refreshMarket, saveSettings, seedSynthetic } from "../actions";
import { PageHeader } from "../ui";

export const dynamic = "force-dynamic";

const FIELDS: [string, string, string][] = [
  ["min_contributors", "Minimum independent businesses per reported figure", "At least 20. Lowering it below 20 needs a reviewed database migration."],
  ["zip_min_contributors", "Minimum businesses for a ZIP-level row", "At least 20."],
  ["precise_confidence", "Classification confidence for precise comparisons", "0.5 to 1."],
  ["anomaly_z", "Robust z-score that flags an anomaly", "Default 3.5 (MAD-based)."],
  ["iqr_k", "IQR fence multiplier when MAD is zero", "Default 3."],
  ["min_peer_observations", "Minimum peer observations for anomaly checks", ""],
  ["min_peer_contributors", "Minimum peer businesses for anomaly checks", "Internal data-quality use only."],
  ["peer_window_months", "Peer comparison window (months)", ""],
  ["margin_high_pct", "Gross margin that is always flagged for review (%)", ""],
  ["retention_months", "Keep real observations for (months)", "Older observations are purged on recompute."],
];

export default async function MarketSettings() {
  const { user, db } = await requireAdmin();
  const { data } = await db.rpc("market_settings", { p_caller: user.id });
  const s = (data ?? {}) as Record<string, number | string>;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings & demo data" intro="Thresholds for suppression and anomaly detection, recompute, and synthetic demo data. Every change is written to the audit log." />
      {!data && <Notice tone="warn" title="Market Intelligence isn't set up in this database yet">Apply the migration first.</Notice>}
      <Card className="p-5">
        <h2 className="font-display text-lg font-bold">Recompute</h2>
        <p className="mt-1 text-sm text-ink-soft">Runs retention, anomaly detection, and the monthly trend aggregates. Schedule it nightly with pg_cron (see the migration footer) once real data flows.</p>
        <form action={refreshMarket} className="mt-3"><button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Recompute now</button></form>
      </Card>
      {data && (
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Thresholds</h2>
          <form action={saveSettings} className="mt-3 grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([k, label, hint]) => (
              <label key={k} className="text-sm font-semibold text-ink-soft">{label}
                <input name={k} defaultValue={String(s[k] ?? "")} inputMode="decimal" className="field mt-1 block w-full" required />
                {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
              </label>
            ))}
            <div className="sm:col-span-2"><button className="rounded-md border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-paper">Save thresholds</button></div>
          </form>
        </Card>
      )}
      <Card className="border-warn/40 p-5">
        <h2 className="font-display text-lg font-bold">Synthetic demo data</h2>
        <p className="mt-1 text-sm text-ink-soft">Loads about 840 randomly generated bids from 120 fictional businesses so the dashboards can be tried before real data exists. It is stored separately, shown only when &ldquo;Synthetic demo&rdquo; is selected, labelled on every page, and never mixed into real figures.</p>
        <div className="mt-3 flex gap-2">
          <form action={seedSynthetic}><button className="rounded-md border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-paper">Load (or reload) synthetic data</button></form>
          <form action={clearSynthetic}><button className="rounded-md border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-tint">Remove synthetic data</button></form>
        </div>
      </Card>
      <Notice title="Future products stay off">
        Market-derived recommendations, contractor-facing comparisons, supplier catalogs, price alerts, and paid industry reports are not built into this screen. The <code>market_external_products</code> flag stays off until legal review of confidentiality, data protection, and competition-law questions. This system must never recommend coordinated pricing or reveal any business&apos;s prices.
      </Notice>
    </div>
  );
}
