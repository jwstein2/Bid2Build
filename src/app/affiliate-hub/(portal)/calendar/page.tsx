import Link from "next/link";
import { cn } from "@/lib/cn";
import { loadDashboard } from "@/lib/affiliates/server";
import { entries, kindLabel, monthGrid, reasonLabel, shiftMonth, usd, type EntryKind } from "@/lib/affiliates/portfolio";

export const metadata = { title: "Commission calendar" };

const TONE: Record<EntryKind, string> = {
  paid: "bg-ok-tint text-ok border-ok/30", payable: "bg-brand-tint text-brand border-brand/30", pending: "bg-warn-tint text-warn border-warn/30",
  held: "bg-warn-tint text-warn border-warn/30", not_paid: "bg-black/5 text-muted border-line line-through", forecast: "border-dashed border-line-strong text-ink-soft",
};

/** Monthly commission calendar: confirmed ledger lines (solid) and forecast anniversaries (dashed). Each entry opens its detail. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; e?: string }> }) {
  const { dash } = await loadDashboard("/affiliate-hub/calendar");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : dash.today.slice(0, 7);
  const all = entries(dash);
  const g = monthGrid(all, month);
  const open = sp.e ? all.find((x) => `${x.key}-${x.year_no}` === sp.e) : null;
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Commission calendar</h1>
        <nav aria-label="Month" className="flex items-center gap-2">
          <Link className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm" href={`?m=${shiftMonth(month, -1)}`}>← Prev</Link>
          <span className="min-w-36 text-center font-bold">{label}</span>
          <Link className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm" href={`?m=${shiftMonth(month, 1)}`}>Next →</Link>
        </nav>
      </div>
      <p className="text-sm text-ink-soft">Confirmed this month: <strong>{usd(g.total.confirmed)}</strong> · Forecast: <strong>{usd(g.total.forecast)}</strong> <span className="text-xs text-muted">(forecasts assume the customer keeps paying)</span></p>
      <ul className="flex flex-wrap gap-2 text-xs" aria-label="Legend">
        {(["paid", "payable", "pending", "not_paid", "forecast"] as EntryKind[]).map((k) => <li key={k} className={cn("rounded border px-2 py-0.5", TONE[k])}>{kindLabel(k)}</li>)}
      </ul>

      {open && (
        <section aria-label="Commission detail" className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">{open.label} · year {open.year_no}</h2>
              <p className="text-sm text-ink-soft">{new Date(`${open.date}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long" })} · {kindLabel(open.kind)}{open.campaign ? ` · campaign ${open.campaign}` : ""}</p>
            </div>
            <Link href={`?m=${month}`} className="text-sm underline">Close</Link>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{usd(open.cents)}</p>
          {open.reason && <p className="mt-1 text-sm text-ink-soft">{reasonLabel(open.reason)}</p>}
          <p className="mt-2 text-xs text-muted">{open.confirmed ? "From the ledger: one month of the customer's eligible paid subscription value for this anniversary." : "Forecast only: today's eligible value if the customer is still paying on this date. Not guaranteed."}</p>
        </section>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <caption className="sr-only">Commissions in {label}</caption>
          <thead><tr>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <th key={d} scope="col" className="py-2 text-xs font-semibold text-muted">{d}</th>)}</tr></thead>
          <tbody>
            {g.weeks.map((w, i) => (
              <tr key={i}>
                {w.map((c, j) => (
                  <td key={j} className={cn("h-24 border border-line align-top p-1", !c && "bg-paper", c?.date === dash.today && "ring-2 ring-inset ring-brand")}>
                    {c && (
                      <>
                        <span className="text-xs text-muted">{Number(c.date.slice(8))}</span>
                        <ul className="mt-1 space-y-1">
                          {c.entries.map((e) => (
                            <li key={`${e.key}-${e.year_no}`}>
                              <Link href={`?m=${month}&e=${e.key}-${e.year_no}`} className={cn("block truncate rounded border px-1 py-0.5 text-xs", TONE[e.kind])} title={`${e.label}: ${usd(e.cents)} (${kindLabel(e.kind)})`}>
                                {usd(e.cents)} <span className="sr-only">{e.label}, {kindLabel(e.kind)}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
