import Link from "next/link";
import { BarList, Chip, Empty, Kpi, PageHead, Panel, fmt } from "@/components/admin/cc";
import { UsTileMap } from "@/components/admin/us-tile-map";
import { loadReport } from "@/lib/admin/load";
import { ReportUnavailable, ScopeNote } from "@/components/admin/report";
import { parseStateFilters, stateReport, type StateFilters } from "@/lib/admin/metrics";
import { US_STATES } from "@/lib/market/geo";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bids by state" };

const SORTS = [["bids", "Total bids"], ["businesses", "Businesses"], ["signed", "Signed"], ["name", "A–Z"]] as const;

export default async function BidsByState({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseStateFilters(sp);
  const { r: rep, error, view } = await loadReport(sp);
  if (!rep) return <ReportUnavailable error={error} />;
  const r = stateReport(rep.sc.d, f, rep.now);
  const qs = (patch: Partial<Record<keyof StateFilters, string>>) => {
    const m = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) {
      if (!v || (k === "plan" && v === "all") || (k === "status" && v === "all") || (k === "sort" && v === "bids")) continue;
      m.set(k, String(v));
    }
    if (view.includeTest) m.set("data", "all");
    const s = m.toString();
    return s ? `/admin/states?${s}` : "/admin/states";
  };
  const filtered = Boolean(f.from || f.to || f.trade || f.plan !== "all" || f.status !== "all");
  const located = r.totalBids ? Math.round((r.withState / r.totalBids) * 100) : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/operations#reports" className="text-ink-soft underline">Operations</Link> <span className="text-muted">/ report</span></p>
      <PageHead kicker="Geography · counts only" title="Bids by state"
        intro="Where contractors are bidding, across every account's bids. Counts only, never prices, so no 20-business minimum applies. A bid's state comes from its ZIP, its state field, or the typed project address." />

      <ScopeNote sc={rep.sc} />
      <form method="get" action="/admin/states" className="cc-panel cc-rise grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <label className="text-xs"><span className="cc-kicker mb-1 block">From</span><input type="date" name="from" defaultValue={f.from} className="field field-sm" /></label>
        <label className="text-xs"><span className="cc-kicker mb-1 block">To</span><input type="date" name="to" defaultValue={f.to} className="field field-sm" /></label>
        <label className="text-xs"><span className="cc-kicker mb-1 block">Trade</span>
          <select name="trade" defaultValue={f.trade ?? ""} className="field field-sm"><option value="">All trades</option>{r.trades.map((t) => <option key={t} value={t}>{tradeName(t)}</option>)}</select></label>
        <label className="text-xs"><span className="cc-kicker mb-1 block">Account</span>
          <select name="plan" defaultValue={f.plan} className="field field-sm"><option value="all">All accounts</option><option value="paid">Paid or complimentary</option><option value="free">Free</option></select></label>
        <label className="text-xs"><span className="cc-kicker mb-1 block">Bid status</span>
          <select name="status" defaultValue={f.status} className="field field-sm"><option value="all">All bids</option><option value="finalized">Finalized</option><option value="draft">Not finalized</option></select></label>
        <input type="hidden" name="sort" value={f.sort} />
        {view.includeTest && <input type="hidden" name="data" value="all" />}
        <div className="flex items-end gap-2">
          <button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c] shadow-[0_0_16px_rgb(61_255_168/0.45)] hover:brightness-110">Apply</button>
          {filtered && <Link href={qs({ from: "", to: "", trade: "", plan: "all", status: "all" })} className="cc-mono px-2 py-1.5 text-xs text-ink-soft underline hover:text-white">Reset</Link>}
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="States represented" value={r.states} tone="blue" href={qs({ sort: "name" }) + "#report"} action="View all states" />
        <Kpi label="Top state" value={r.top ? r.top.state : "–"} href={qs({ sort: "bids" }) + "#report"} action="View the ranking" sub={r.top ? `${US_STATES[r.top.state] ?? r.top.state} · ${fmt(r.top.bids)} bids` : "No located bids yet"} />
        <Kpi label="Bids with a state" value={r.withState} href={qs({}) + "#report"} action="View the state report" sub={`${located}% of ${fmt(r.totalBids)} bids`} />
        <Kpi label="Bids missing state" value={r.missingState} href="/admin/operations#data" action="Location data quality" tone={r.missingState ? "amber" : "green"} sub="No ZIP, state, or readable address" />
        <Kpi label="Businesses" value={r.businesses} href={qs({ sort: "businesses" }) + "#report"} action="Ranked by businesses" tone="violet" sub="In the bids shown" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker="Map" title="Bid volume" className="lg:col-span-3">
          <UsTileMap values={Object.fromEntries(r.rows.map((s) => [s.state, s.bids]))} />
        </Panel>
        <Panel kicker="Ranking" title="Top 10 states by bids" className="lg:col-span-2">
          <BarList items={[...r.rows].sort((a, b) => b.bids - a.bids).slice(0, 10).map((s) => ({ label: US_STATES[s.state] ?? s.state, value: s.bids, sub: `${s.businesses} biz` }))} empty="No located bids match these filters" />
        </Panel>
      </div>

      <Panel id="report" kicker="All states" title="State report" action={<div className="flex flex-wrap items-center gap-3"><a href={`/admin/export/states${qs({}).replace("/admin/states", "")}`} className="cc-mono text-[11px] text-[var(--cc-blue)] underline">CSV</a>
        <div className="cc-mono flex flex-wrap gap-1 text-[11px]">
          {SORTS.map(([k, label]) => <Link key={k} href={qs({ sort: k })} aria-current={f.sort === k ? "true" : undefined} className={f.sort === k ? "rounded border border-[var(--cc-line-strong)] px-2 py-1 text-[var(--cc-green)]" : "rounded border border-transparent px-2 py-1 text-ink-soft hover:text-white"}>{label}</Link>)}
        </div></div>}>
        {r.rows.length === 0 ? <Empty>No bids with a location match these filters yet</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="cc-kicker text-left"><tr>
                <th className="pb-2 font-normal">#</th><th className="pb-2 font-normal">State</th><th className="pb-2 text-right font-normal">Bids</th><th className="pb-2 text-right font-normal">Businesses</th>
                <th className="pb-2 text-right font-normal">Accounts</th><th className="pb-2 text-right font-normal">Finalized</th><th className="pb-2 text-right font-normal">Signed</th><th className="pb-2 pl-4 font-normal">ZIP entered</th><th className="pb-2 font-normal">Top trades</th>
              </tr></thead>
              <tbody className="cc-mono">
                {r.rows.map((s, i) => (
                  <tr key={s.state} className="border-t border-[var(--cc-line)] align-middle">
                    <td className="py-2.5 pr-2 text-[var(--cc-green)]">{String(i + 1).padStart(2, "0")}</td>
                    <td className="py-2.5 font-sans"><span className="font-semibold text-white">{US_STATES[s.state] ?? s.state}</span> <span className="text-muted">{s.state}</span></td>
                    <td className="py-2.5 text-right font-bold text-white">{fmt(s.bids)}</td>
                    <td className="py-2.5 text-right text-ink-soft">{fmt(s.businesses)}</td>
                    <td className="py-2.5 text-right text-ink-soft">{fmt(s.accounts)}</td>
                    <td className="py-2.5 text-right text-ink-soft">{fmt(s.finalized)}</td>
                    <td className="py-2.5 text-right text-ink-soft">{fmt(s.signed)}</td>
                    <td className="py-2.5 pl-4"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgb(56_182_255/0.1)]"><div className="h-full rounded-full bg-[var(--cc-blue)]" style={{ width: `${s.completeness}%` }} /></div><span className="text-[11px] text-muted">{s.completeness}%</span></div></td>
                    <td className="py-2.5"><div className="flex flex-wrap gap-1">{s.topTrades.map((t) => <Chip key={t.trade} tone="muted">{tradeName(t.trade)} {t.n}</Chip>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">ZIP entered = share of the state&apos;s bids with a ZIP saved on the bid itself, not just read from the address. A Team company counts as one business.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
