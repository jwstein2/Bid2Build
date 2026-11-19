import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { MetricCard } from "@/components/ui/metric-card";
import { dateLabel } from "@/lib/sales/format";
import { HOLD_LABEL, RECYCLE_OUTCOME, RECYCLE_PROTECTED, RECYCLE_REASON, RECYCLE_RULE, untilLabel } from "@/lib/sales/leads-admin";
import { decideDispute, extendDeadline, holdFromRecycling, recycleNow, reviewRecycled, saveRecycleSettings } from "./recycle-actions";

export interface RecycleOverview {
  settings: { enabled: boolean; days: number; grace: number; warning_hours: number; max_cycles: number; last_run: string | null; started_at: string };
  window_days: number;
  trades: string[];
  metrics: { assigned: number; contacted: number; untouched: number; approaching: number; recycled: number; contacted_after: number; converted_after: number; reps_overdue: number; repeat: number; avg_first_hours: number | null };
  approaching: { lead_id: string; company_name: string; rep_id: string; rep_name: string; rule: string; deadline: string; warned: boolean; protected: string | null }[];
  recent: { id: number; lead_id: string; company_name: string; reason: string; outcome: string; cycle: number; at: string; from: string | null; to: string | null }[];
  review: { lead_id: string; company_name: string; hold_reason: string; cycles: number; city: string | null; state: string | null; updated_at: string }[];
  disputes: { id: string; lead_id: string; company_name: string; rep_name: string; note: string; at: string }[];
  reps: { id: string; name: string; open: number; untouched: number; approaching: number; overdue: number; recycled_away: number; away: boolean; paused: boolean }[];
  coverage: { rep_id: string; rep_name: string; until: string; urgent: { lead_id: string; company_name: string; title: string; due_at: string }[] }[];
}
export interface RecycleFilters { rep?: string; trade?: string; source?: string; days?: string }

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const sel = "min-h-11 rounded-lg border border-line bg-white px-2 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const isPast = (iso: string) => new Date(iso).getTime() < Date.now();

/** Admin Sales Hub → Lead recycling: who's working their leads, what's about to move, and what moved. */
export function RecyclingPanel({ data, filters, reps, canAct, canSettings }: {
  data: RecycleOverview; filters: RecycleFilters; reps: { id: string; name: string }[]; canAct: boolean; canSettings: boolean;
}) {
  const s = data.settings;
  const m = data.metrics;
  const back = new URLSearchParams({ tab: "recycling", ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const exportHref = `/sales/admin/recycling/export?days=${Math.max(data.window_days, 30)}`;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const repOptions = reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>);

  return (
    <div className="space-y-5">
      {!s.enabled && <Notice tone="warn" title="Recycling is paused">No warnings go out and no leads move until it&apos;s turned back on below.</Notice>}

      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter lead recycling">
        <input type="hidden" name="tab" value="recycling" />
        <label className="text-sm">Rep<select name="rep" defaultValue={filters.rep ?? ""} className={sel}><option value="">Everyone</option>{repOptions}</select></label>
        <label className="text-sm">Trade<select name="trade" defaultValue={filters.trade ?? ""} className={sel}><option value="">All trades</option>{data.trades.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="text-sm">Source<select name="source" defaultValue={filters.source ?? ""} className={sel}>
          <option value="">All sources</option><option value="import">Weekly import</option><option value="owner">Admin added</option><option value="places">Places</option>
        </select></label>
        <label className="text-sm">Period<select name="days" defaultValue={filters.days ?? "7"} className={sel}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        </select></label>
        <button className={btnLight}>Apply</button>
        <a href={exportHref} className={`${btnLight} inline-flex items-center`}>Export history (CSV)</a>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricCard size="sm" title="New leads assigned" value={m.assigned} sub={`Last ${data.window_days} days`} href={`/sales/admin?tab=leads`} action="All leads" />
        <MetricCard size="sm" title="Contacted" value={m.contacted} sub={`${pct(m.contacted, m.assigned)} of assigned`} tone="ok" />
        <MetricCard size="sm" title="Untouched now" value={m.untouched} sub="No first contact yet" href="#approaching" action="See leads" empty={!m.untouched} />
        <MetricCard size="sm" title="Approaching recycle" value={m.approaching} sub={`Warned, inside ${s.warning_hours}h`} tone={m.approaching ? "warn" : "default"} href="#approaching" action="See leads" />
        <MetricCard size="sm" title="Recycled" value={m.recycled} sub={`Last ${data.window_days} days`} href="#recent" action="See history" />
        <MetricCard size="sm" title="Contacted after recycling" value={m.contacted_after} sub={pct(m.contacted_after, m.recycled)} tone="ok" />
        <MetricCard size="sm" title="Converted after reassignment" value={m.converted_after} sub="Trial or paying" />
        <MetricCard size="sm" title="Reps with overdue leads" value={m.reps_overdue} href="#reps" action="See reps" tone={m.reps_overdue ? "warn" : "default"} />
        <MetricCard size="sm" title="Repeat recycled" value={m.repeat} sub="Recycled 2+ times" href="#review" action="Review" />
        <MetricCard size="sm" title="Avg. time to first attempt" value={m.avg_first_hours == null ? "–" : m.avg_first_hours < 48 ? `${m.avg_first_hours}h` : `${Math.round(m.avg_first_hours / 24)}d`} sub="From assignment" />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold">How recycling works</h3>
        <p className="mt-1 text-sm text-muted">
          Each company lead gets {s.days} days for a first contact: a call with an outcome, a sent email or text, a reply, or a scheduled meeting. Notes,
          stage changes and failed emails don&apos;t count. After that, a follow-up that&apos;s more than {s.grace} days overdue counts as neglected. The rep is
          warned {s.warning_hours} hours ahead with the business names. Then the lead goes to the next rep in turn, never back to the same person, with its
          history, source and commission attribution unchanged. Customers, trials, do-not-contact leads, booked appointments, holds, reviews and reps on time off
          are skipped. After {s.max_cycles} cycles a lead comes here for review instead of rotating forever. Recycling counts are never used to penalize anyone
          automatically.
        </p>
        <p className="mt-1 text-xs text-muted">Runs daily{s.last_run ? `, last ${dateLabel(s.last_run)}` : ""}. Leads assigned before recycling was installed started their clock on {dateLabel(s.started_at)}.</p>
      </Card>

      {data.disputes.length > 0 && (
        <Card className="p-4" id="disputes">
          <h3 className="font-semibold">Review requests ({data.disputes.length})</h3>
          <p className="text-sm text-muted">A rep says a lead was worked or shouldn&apos;t move. It won&apos;t be recycled until you decide.</p>
          <ul className="mt-2 divide-y divide-line">
            {data.disputes.map((d) => (
              <li key={d.id} className="py-2">
                <p className="text-sm"><Link className="font-semibold underline" href={`/sales/admin/leads/${d.lead_id}`}>{d.company_name}</Link> · {d.rep_name} · {dateLabel(d.at)}</p>
                <p className="text-sm text-muted">&ldquo;{d.note}&rdquo;</p>
                {canAct && (
                  <form action={decideDispute} className="mt-1 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
                    <input name="note" maxLength={300} placeholder="Note to the rep (optional)" className={`${input} max-w-sm`} />
                    <button name="decision" value="upheld" className={btn}>Accept: fresh window</button>
                    <button name="decision" value="rejected" className={btnLight}>Decline</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4" id="approaching">
        <h3 className="font-semibold">Leads on the clock</h3>
        <p className="text-sm text-muted">Every assigned company lead with a first-contact or follow-up deadline, soonest first.</p>
        {data.approaching.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing on the clock. Every lead has been worked or is protected.</p> : (
          <form className="mt-2">
            <input type="hidden" name="back" value={back} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="w-8 py-1"><span className="sr-only">Select</span></th><th>Business</th><th>Rep</th><th>Why</th><th>Deadline</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.approaching.map((a) => (
                    <tr key={a.lead_id}>
                      <td className="py-2">{canAct && <input type="checkbox" name="lead" value={a.lead_id} aria-label={`Select ${a.company_name}`} className="h-5 w-5" />}</td>
                      <td><Link href={`/sales/admin/leads/${a.lead_id}`} className="font-semibold underline">{a.company_name}</Link></td>
                      <td>{a.rep_name}</td>
                      <td>{RECYCLE_RULE[a.rule] ?? a.rule}</td>
                      <td className={isPast(a.deadline) ? "text-danger" : ""}>{dateLabel(a.deadline)} <span className="text-xs text-muted">({untilLabel(a.deadline)})</span></td>
                      <td>{a.protected ? <Badge>{RECYCLE_PROTECTED[a.protected] ?? a.protected}</Badge> : a.warned ? <Badge tone="warn">Warned</Badge> : <Badge tone="neutral">On track</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canAct && (
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <label className="text-sm">Extend by<select name="days" defaultValue="7" className={sel}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
                <input name="reason" maxLength={200} placeholder="Reason (optional)" className={`${input} max-w-xs`} />
                <button formAction={extendDeadline} className={btnLight}>Extend selected</button>
                <label className="text-sm">Hold until<input type="date" name="until" className={input} /></label>
                <button formAction={holdFromRecycling} className={btnLight}>Hold selected</button>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="h-5 w-5" /> I&apos;m sure</label>
                <button formAction={recycleNow} className={btn}>Recycle selected now</button>
              </div>
            )}
          </form>
        )}
      </Card>

      <Card className="p-4" id="reps">
        <h3 className="font-semibold">By rep</h3>
        <p className="text-sm text-muted">For coaching, not scoring. Time off pauses the clock and new leads.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Rep</th><th>Open leads</th><th>Untouched</th><th>Warned</th><th>Overdue</th><th>Recycled away</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {data.reps.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 font-semibold">{r.name} {r.away && <Badge tone="brand">Away</Badge>} {r.paused && <Badge>Paused</Badge>}</td>
                  <td>{r.open}</td><td>{r.untouched}</td><td>{r.approaching}</td><td className={r.overdue ? "text-danger" : ""}>{r.overdue}</td><td>{r.recycled_away}</td>
                  <td><Link className="underline" href={`/sales/admin/reps/${r.id}/manage`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.coverage.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold">Coverage while reps are away</h3>
          <p className="text-sm text-muted">Follow-ups due before they&apos;re back. Their leads won&apos;t recycle while they&apos;re out; reassign any that can&apos;t wait.</p>
          {data.coverage.map((c) => (
            <div key={c.rep_id} className="mt-2">
              <p className="text-sm font-semibold">{c.rep_name} · back {dateLabel(c.until)}</p>
              {c.urgent.length === 0 ? <p className="text-sm text-muted">Nothing due while away.</p> : (
                <ul className="text-sm">{c.urgent.map((u) => <li key={`${u.lead_id}-${u.due_at}`}><Link className="underline" href={`/sales/admin/leads/${u.lead_id}`}>{u.company_name}</Link>: {u.title} ({dateLabel(u.due_at)})</li>)}</ul>
              )}
            </div>
          ))}
        </Card>
      )}

      <Card className="p-4" id="review">
        <h3 className="font-semibold">Needs a decision ({data.review.length})</h3>
        <p className="text-sm text-muted">Leads recycled {s.max_cycles} times, or waiting because no other rep could take them.</p>
        {data.review.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing waiting.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {data.review.map((r) => (
              <li key={r.lead_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="text-sm">
                  <Link className="font-semibold underline" href={`/sales/admin/leads/${r.lead_id}`}>{r.company_name}</Link>
                  <span className="text-muted"> · {[r.city, r.state].filter(Boolean).join(", ")} · {HOLD_LABEL[r.hold_reason] ?? r.hold_reason} · {r.cycles} cycle{r.cycles === 1 ? "" : "s"}</span>
                </div>
                {canAct && (
                  <form action={reviewRecycled} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="lead" value={r.lead_id} /><input type="hidden" name="back" value={back} />
                    <select name="rep" className={sel} aria-label="Give to"><option value="">Next rep in turn</option>{repOptions}</select>
                    <button name="decision" value="reassign" className={btnLight}>Reassign</button>
                    <button name="decision" value="dormant" className={btnLight}>Park as dormant</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4" id="recent">
        <h3 className="font-semibold">Recently recycled</h3>
        {data.recent.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing recycled in this period.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">When</th><th>Business</th><th>Why</th><th>From → to</th><th>Result</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{dateLabel(r.at)}</td>
                    <td><Link className="underline" href={`/sales/admin/leads/${r.lead_id}`}>{r.company_name}</Link>{r.cycle > 1 && <span className="text-xs text-muted"> (cycle {r.cycle})</span>}</td>
                    <td>{RECYCLE_REASON[r.reason] ?? r.reason}</td>
                    <td>{r.from ?? "–"} → {r.to ?? "queue"}</td>
                    <td>{RECYCLE_OUTCOME[r.outcome] ?? r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canSettings && (
        <Card className="p-4">
          <h3 className="font-semibold">Recycling settings</h3>
          <form action={saveRecycleSettings} className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="back" value={back} />
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={s.enabled} className="h-5 w-5" /> Recycling on</label>
            <label className="text-sm">First-contact window (days)<input type="number" name="days" min={3} max={30} defaultValue={s.days} className={input} /></label>
            <label className="text-sm">Follow-up grace (days)<input type="number" name="grace" min={1} max={14} defaultValue={s.grace} className={input} /></label>
            <label className="text-sm">Warning ahead (hours)<input type="number" name="warning_hours" min={12} max={72} defaultValue={s.warning_hours} className={input} /></label>
            <label className="text-sm">Cycles before review<input type="number" name="max_cycles" min={2} max={10} defaultValue={s.max_cycles} className={input} /></label>
            <div className="sm:col-span-2 lg:col-span-5"><button className={btn}>Save settings</button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
