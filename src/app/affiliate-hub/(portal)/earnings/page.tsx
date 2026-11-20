import Link from "next/link";
import { loadDashboard } from "@/lib/affiliates/server";
import { byYear, entries, filterEntries, kindLabel, reasonLabel, STATUSES, usd } from "@/lib/affiliates/portfolio";
import { EarningsChart } from "@/components/affiliates/earnings-chart";
import { PROGRAM } from "@/lib/affiliates/content";

export const metadata = { title: "Earnings" };

/** Annual earnings: historical, pending and projected by year, with filters, a table alternative and CSV export. */
export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; campaign?: string; status?: string }> }) {
  const { dash } = await loadDashboard("/affiliate-hub/earnings");
  const sp = await searchParams;
  const f = { year: /^\d{4}$/.test(sp.year ?? "") ? sp.year : undefined, month: /^\d{2}$/.test(sp.month ?? "") ? sp.month : undefined, campaign: sp.campaign?.slice(0, 40) || undefined, status: sp.status };
  const all = entries(dash);
  const rows = filterEntries(all, f);
  const bars = byYear(rows);
  const years = [...new Set(all.map((e) => e.date.slice(0, 4)))].sort();
  const campaigns = [...new Set(all.map((e) => e.campaign ?? "(none)"))].sort();
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const sel = "min-h-11 rounded-md border border-line-strong bg-surface px-2 text-sm";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold">Earnings</h1>
        <p className="mt-1 text-sm text-ink-soft">{PROGRAM.annual} Forecasts are illustrations at today&apos;s value, not guarantees.</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" aria-label="Filters">
        <label className="text-xs font-semibold">Year<select name="year" defaultValue={f.year ?? ""} className={`${sel} block`}><option value="">All</option>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="text-xs font-semibold">Month<select name="month" defaultValue={f.month ?? ""} className={`${sel} block`}><option value="">All</option>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{new Date(`2026-${m}-15`).toLocaleDateString("en-US", { month: "short" })}</option>)}</select></label>
        <label className="text-xs font-semibold">Campaign<select name="campaign" defaultValue={f.campaign ?? ""} className={`${sel} block`}><option value="">All</option>{campaigns.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs font-semibold">Status<select name="status" defaultValue={f.status ?? ""} className={`${sel} block`}>{STATUSES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></label>
        <button type="submit" className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white">Apply</button>
        <Link href="/affiliate-hub/earnings" className="inline-flex min-h-11 items-center px-2 text-sm underline">Reset</Link>
        <a href={`/affiliate-hub/earnings/export${qs ? `?${qs}` : ""}`} className="ml-auto inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-semibold" download>Export CSV</a>
      </form>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="mb-3 font-bold">By year</h2>
        <EarningsChart bars={bars} />
      </section>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="font-bold">Year totals</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th scope="col" className="py-1">Year</th><th scope="col" className="text-right">Paid</th><th scope="col" className="text-right">Earned, not paid</th><th scope="col" className="text-right">Forecast</th></tr></thead>
            <tbody>{bars.map((b) => <tr key={b.year} className="border-t border-line"><th scope="row" className="py-1 text-left font-semibold">{b.year}</th><td className="text-right tabular-nums">{usd(b.paid)}</td><td className="text-right tabular-nums">{usd(b.pending)}</td><td className="text-right tabular-nums text-ink-soft">{usd(b.projected)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="font-bold">Every annual commission ({rows.length})</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th scope="col" className="py-1">Date</th><th scope="col">Customer</th><th scope="col">Year</th><th scope="col">Status</th><th scope="col" className="text-right">Amount</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={`${e.key}-${e.year_no}`} className="border-t border-line">
                <td className="py-1 whitespace-nowrap">{e.date}</td><td>{e.label}{e.campaign ? <span className="text-xs text-muted"> · {e.campaign}</span> : null}</td><td>{e.year_no}</td>
                <td>{kindLabel(e.kind)}{e.reason ? <span className="block text-xs text-muted">{reasonLabel(e.reason)}</span> : null}</td><td className="text-right tabular-nums">{usd(e.cents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
