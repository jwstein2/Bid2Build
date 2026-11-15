import { AreaChart, BarList, Columns, Empty, Kpi, PageHead, Panel, Segmented, ago, fmt } from "@/components/admin/cc";
import { loadCommandCenter } from "@/lib/admin/load";
import { delta, leaderboard, series, tradeOf } from "@/lib/admin/metrics";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

const RANGES = { "30d": { unit: "day", n: 30, label: "30 days", days: 30 }, "12w": { unit: "week", n: 12, label: "12 weeks", days: 84 }, "12m": { unit: "month", n: 12, label: "12 months", days: 365 } } as const;
type RangeKey = keyof typeof RANGES;

export default async function Activity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).range;
  const key: RangeKey = typeof raw === "string" && raw in RANGES ? (raw as RangeKey) : "30d";
  const range = RANGES[key];
  const { p, error } = await loadCommandCenter();
  if (!p) return <Panel title="Report unavailable"><p className="text-sm text-ink-soft">The platform data could not be loaded{error ? `: ${error}` : ""}.</p></Panel>;
  const now = new Date();

  const firstVersion = new Map<string, string>();
  for (const v of p.versions) { const prev = firstVersion.get(v.estimate_id); if (!prev || v.created_at < prev) firstVersion.set(v.estimate_id, v.created_at); }
  const created = p.estimates.map((e) => e.created_at);
  const finalized = [...firstVersion.values()];
  const signed = p.signatures.map((s) => s.signed_at);
  const signups = p.profiles.map((x) => x.created_at);
  const s = (d: string[]) => series(d, now, range.n, range.unit);
  const bidsD = delta(created, now, range.days), finD = delta(finalized, now, range.days), sigD = delta(signed, now, range.days), upD = delta(signups, now, range.days);
  const leaders = leaderboard(p, now, range.days, p.names, 10);

  const since = now.getTime() - range.days * 86_400_000;
  const tradeCounts = new Map<string, number>();
  for (const e of p.estimates) if (Date.parse(e.created_at) >= since) tradeCounts.set(tradeOf(e), (tradeCounts.get(tradeOf(e)) ?? 0) + 1);
  // Day of week (Central time) bids get started.
  const dow = [0, 0, 0, 0, 0, 0, 0];
  for (const e of p.estimates) if (Date.parse(e.created_at) >= since) {
    const d = new Date(new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })).getDay();
    dow[(d + 6) % 7]++;
  }

  return (
    <div className="space-y-6">
      <PageHead kicker={`Activity · ${range.label}`} title="Bid activity over time" intro="Bids created, finalized and signed, plus new accounts. Changes compare against the previous period of the same length."
        right={<Segmented active={key} options={(Object.keys(RANGES) as RangeKey[]).map((k) => ({ value: k, label: RANGES[k].label, href: `/admin/activity?range=${k}` }))} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Bids created" value={bidsD.current} sub={`vs ${bidsD.previous} the period before`} spark={s(created).map((x) => x.value)} />
        <Kpi label="Bids finalized" value={finD.current} tone="blue" sub={`vs ${finD.previous} the period before`} spark={s(finalized).map((x) => x.value)} />
        <Kpi label="Bids signed" value={sigD.current} tone="amber" sub={`vs ${sigD.previous} the period before`} spark={s(signed).map((x) => x.value)} />
        <Kpi label="New accounts" value={upD.current} tone="violet" sub={`vs ${upD.previous} the period before`} spark={s(signups).map((x) => x.value)} />
      </div>

      <Panel kicker="Trend" title="Created, finalized, signed">
        <AreaChart height={220} series={[
          { name: "Bids created", tone: "green", points: s(created) },
          { name: "Finalized", tone: "blue", points: s(finalized) },
          { name: "Signed", tone: "amber", points: s(signed) },
        ]} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Growth" title="New accounts"><Columns tone="violet" points={s(signups)} /></Panel>
        <Panel kicker="Rhythm" title="Bids started by weekday (Central)">
          <Columns tone="green" points={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ label, value: dow[i] }))} />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker={`Leaderboard · ${range.label}`} title="Most active businesses" className="lg:col-span-3">
          {leaders.length === 0 ? <Empty>No bids in this period</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="cc-kicker text-left"><tr><th className="pb-2 font-normal">#</th><th className="pb-2 font-normal">Business</th><th className="pb-2 text-right font-normal">Bids</th><th className="pb-2 text-right font-normal">Finalized</th><th className="pb-2 text-right font-normal">Signed</th><th className="pb-2 text-right font-normal">Last bid</th></tr></thead>
                <tbody className="cc-mono">
                  {leaders.map((l, i) => (
                    <tr key={l.key} className="border-t border-[var(--cc-line)]">
                      <td className="py-2 pr-2 text-[var(--cc-green)]">{String(i + 1).padStart(2, "0")}</td>
                      <td className="max-w-[14rem] truncate py-2 font-sans text-white">{l.label}</td>
                      <td className="py-2 text-right text-white">{fmt(l.bids)}</td><td className="py-2 text-right text-ink-soft">{fmt(l.finalized)}</td><td className="py-2 text-right text-ink-soft">{fmt(l.signed)}</td>
                      <td className="py-2 text-right text-muted">{ago(l.lastActive, now.getTime())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel kicker={`Trades · ${range.label}`} title="Bids by trade" className="lg:col-span-2">
          <BarList tone="blue" items={[...tradeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => ({ label: tradeName(t), value: n }))} empty="No bids in this period" />
        </Panel>
      </div>
    </div>
  );
}
