"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarDays, ChevronLeft, ChevronRight, DollarSign, ExternalLink, Home, MapPin, Moon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { addDays, fmtHours, weekStart } from "@/lib/team/records";
import { breakdown, categoryLabel, compareWeek, dutyState, type ScheduleItem, type WorkerWeek } from "@/lib/workforce/hub/model";
import { PAY_DISCLAIMER, type PayEstimate, type PayProjection } from "@/lib/workforce/hub/pay";

type PayResult = { available: false } | { available: true; audience: "admin" | "worker"; projection: PayProjection };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const t12 = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const timeRange = (i: ScheduleItem) => (i.startTime && i.endTime ? `${t12(i.startTime)} – ${t12(i.endTime)}` : i.kind === "time_off" ? "All day" : "Time not set");
const diffTone = (d: number) => (Math.abs(d) < 0.25 ? "ok" : d > 0 ? "warn" : "neutral") as "ok" | "warn" | "neutral";
const osm = (q: string) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;

/**
 * Worker dashboard (V8.3), built on the one employee record: where I am now (customer project, internal work, or
 * off duty), today's jobs, scheduled vs recorded hours, next shifts, a weekly calendar with a breakdown by job or
 * internal work, assignment details, and (only when the company allows it) estimated gross pay.
 */
export function WorkerHome({ initial }: { initial: WorkerWeek }) {
  const [w, setW] = useState<WorkerWeek>(initial);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<ScheduleItem | null>(null);
  const load = useCallback(async (wk: string) => {
    setLoading(true);
    const r = await api<WorkerWeek>(`/api/workforce/hub/week?resourceId=${initial.resource.id}&week=${wk}`);
    setLoading(false);
    if (r.ok) setW(r.data);
  }, [initial.resource.id]);
  const week = w.week;
  const setWeek = (wk: string) => { if (wk !== w.week) void load(wk); };
  const days = useMemo(() => compareWeek(w), [w]);
  const parts = useMemo(() => breakdown(w), [w]);
  const isThisWeek = w.week === weekStart(w.today);
  const duty = dutyState(w);
  const scheduled = days.reduce((s, d) => s + d.scheduled, 0);
  const actual = days.reduce((s, d) => s + d.actual, 0);
  const remaining = isThisWeek ? days.filter((d) => d.date > w.today).reduce((s, d) => s + d.scheduled, 0) + Math.max(0, (days.find((d) => d.date === w.today)?.scheduled ?? 0) - (days.find((d) => d.date === w.today)?.actual ?? 0)) : w.week > w.today ? scheduled : 0;
  const today = w.schedule.filter((s) => s.date === w.today);
  const pending = w.corrections.filter((c) => c.status === "pending").length;
  const approved = w.entries.filter((e) => e.status === "approved").length;
  const DutyIcon = duty.kind === "project" ? Briefcase : duty.kind === "internal" ? Home : Moon;

  return (
    <div className="space-y-5" data-testid="worker-home">
      <section className={`rounded-xl border p-4 ${duty.kind === "project" ? "border-accent-ink/50 bg-accent-tint" : duty.kind === "internal" ? "border-ok/40 bg-surface" : "border-line bg-surface"}`} data-testid="duty-state" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Right now</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-extrabold text-navy"><DutyIcon className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />{duty.label}</p>
        {duty.detail && <p className="text-sm text-ink-soft">{duty.detail}</p>}
      </section>

      {isThisWeek && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="week-stats">
          {[["Scheduled this week", fmtHours(scheduled)], ["Recorded this week", fmtHours(actual)], ["Scheduled hours left", fmtHours(remaining)],
            ["Fix requests waiting", String(pending)], ["Approved entries", String(approved)]].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-surface p-3"><dt className="text-xs text-muted">{k}</dt><dd className="text-lg font-extrabold text-navy">{v}</dd></div>
          ))}
        </dl>
      )}

      {isThisWeek && (
        <section className="space-y-2" data-testid="today-jobs">
          <h2 className="font-extrabold text-navy">Today</h2>
          {today.length === 0 ? <p className="text-sm text-muted">Nothing scheduled today.</p> : (
            <ul className="space-y-2">{today.map((i) => <ItemRow key={`${i.kind}-${i.id}-${i.date}`} i={i} onOpen={setOpen} />)}</ul>
          )}
          {w.upcoming.length > 0 && (
            <div data-testid="next-shifts">
              <h3 className="mt-3 text-sm font-bold text-ink-soft">Coming up</h3>
              <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
                {w.upcoming.filter((u) => u.date !== w.today).slice(0, 4).map((u) => (
                  <li key={`${u.kind}-${u.id}-${u.date}`}><button type="button" className="flex w-full flex-wrap items-center gap-x-2 px-3 py-2 text-left hover:bg-paper" onClick={() => setOpen(u)}>
                    <span className="font-semibold">{dayLabel(u.date)}</span><span className="text-ink-soft">{timeRange(u)}</span><span className="truncate">{u.title}</span>
                    <Badge tone={u.category === "project" ? "accent" : "neutral"} className="ml-auto">{categoryLabel(u.category)}</Badge></button></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3" data-testid="week-calendar">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 font-extrabold text-navy"><CalendarDays className="h-5 w-5 text-accent-ink" aria-hidden />My schedule</h2>
          <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span className="text-sm font-semibold" aria-live="polite">Week of {dayLabel(week, { month: "short", day: "numeric" })}{loading ? " …" : ""}</span>
          <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
          {!isThisWeek && <Button size="sm" variant="ghost" onClick={() => setWeek(weekStart(w.today))}>This week</Button>}
        </div>
        <ol className="grid gap-2 md:grid-cols-7" aria-label="Days this week">
          {days.map((d) => (
            <li key={d.date} className={`rounded-xl border bg-surface p-2 text-sm ${d.date === w.today ? "border-accent-ink" : "border-line"}`} data-testid="cal-day">
              <p className="flex items-baseline justify-between gap-1"><span className="font-bold">{dayLabel(d.date, { weekday: "short", day: "numeric" })}</span>{d.date === w.today && <span className="text-xs font-semibold text-accent-ink">Today</span>}</p>
              <ul className="mt-1 space-y-1">
                {d.items.map((i) => (
                  <li key={`${i.kind}-${i.id}`}><button type="button" onClick={() => setOpen(i)} data-testid="cal-item"
                    className={`w-full rounded-md border-l-4 px-2 py-1 text-left text-xs hover:bg-paper ${i.category === "project" ? "border-accent-ink bg-accent-tint/50" : i.category === "time_off" ? "border-muted bg-paper" : "border-ok bg-ok-tint/40"}`}>
                    <span className="block font-semibold">{i.title}</span><span className="block text-ink-soft">{timeRange(i)} · {fmtHours(i.hours)}{i.estimated ? " est." : ""}</span>
                  </button></li>
                ))}
                {d.items.length === 0 && <li className="text-xs text-muted">Not scheduled</li>}
              </ul>
              <p className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-1 text-xs">
                <span>Sched {d.scheduled.toFixed(2)}</span><span>· Actual {d.actual.toFixed(2)}</span>
                {(d.scheduled > 0 || d.actual > 0) && <Badge tone={diffTone(d.diff)}>{d.diff > 0 ? "+" : ""}{d.diff.toFixed(2)} h</Badge>}
              </p>
            </li>
          ))}
        </ol>
        {parts.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm" data-testid="hours-breakdown">
              <caption className="px-3 pt-2 text-left text-sm font-bold text-navy">Hours by job or internal work</caption>
              <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Where</th><th className="px-3 py-2 text-right">Scheduled</th><th className="px-3 py-2 text-right">Recorded</th><th className="px-3 py-2 text-right">Difference</th></tr></thead>
              <tbody className="divide-y divide-line">
                {parts.map((b) => (
                  <tr key={b.key}><td className="px-3 py-2"><span className="font-semibold">{b.label}</span>{b.category !== "project" && <span className="block text-xs text-muted">Company time (not a customer job)</span>}</td>
                    <td className="px-3 py-2 text-right">{b.scheduled.toFixed(2)}</td><td className="px-3 py-2 text-right">{b.actual.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right"><Badge tone={diffTone(b.diff)}>{b.diff > 0 ? "+" : ""}{b.diff.toFixed(2)}</Badge></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">&quot;est.&quot; means the project didn&apos;t set times of day, so hours are spread over its workdays. Unpaid time and time off aren&apos;t counted as recorded work.</p>
      </section>

      {w.pay.visible && <PayCard resourceId={w.resource.id} />}

      {open && <ItemDetail i={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ItemRow({ i, onOpen }: { i: ScheduleItem; onOpen: (i: ScheduleItem) => void }) {
  return (
    <li><button type="button" onClick={() => onOpen(i)} data-testid="today-item"
      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-surface p-3 text-left text-sm hover:border-accent-ink ${i.category === "project" ? "border-accent-ink/40" : "border-line"}`}>
      <span className="font-semibold text-navy">{i.title}{i.task ? `: ${i.task}` : ""}</span>
      <span className="text-ink-soft">{timeRange(i)} · {fmtHours(i.hours)}{i.estimated ? " est." : ""}</span>
      {(i.location || i.address) && <span className="flex items-center gap-1 text-ink-soft"><MapPin className="h-3.5 w-3.5" aria-hidden />{i.location ?? i.address}</span>}
      <Badge tone={i.category === "project" ? "accent" : "neutral"} className="ml-auto">{categoryLabel(i.category)}</Badge>
    </button></li>
  );
}

function ItemDetail({ i, onClose }: { i: ScheduleItem; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const rows: [string, string | null][] = [
    ["What", categoryLabel(i.category)], ["Project", i.project], ["Task", i.task], ["When", `${dayLabel(i.date, { weekday: "long", month: "long", day: "numeric" })} · ${timeRange(i)}`],
    ["Hours", `${fmtHours(i.hours)}${i.estimated ? " (estimated)" : ""}${i.unpaidBreakMinutes ? ` after a ${i.unpaidBreakMinutes}-minute unpaid break` : ""}`],
    ["Where", i.location], ["Address", i.address], ["Assigned through", i.via], ["Your responsibilities", i.responsibilities], ["Notes", i.notes],
    ["Status", i.kind === "task" ? i.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : null],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="assignment-title" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-testid="assignment-detail">
        <div className="flex items-start gap-2"><h2 id="assignment-title" className="mr-auto text-lg font-extrabold text-navy">{i.title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" autoFocus><X className="h-4 w-4" aria-hidden /></Button></div>
        <dl className="mt-2 space-y-2 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold text-muted">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>)}
        </dl>
        {i.address && <a href={osm(i.address)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-accent-ink underline">Open in a map<ExternalLink className="h-3 w-3" aria-hidden /></a>}
      </div>
    </div>
  );
}

function PayCard({ resourceId }: { resourceId: string }) {
  const [r, setR] = useState<PayResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<PayResult>(`/api/workforce/hub/pay?resourceId=${resourceId}`).then((x) => { if (!live) return; if (x.ok) setR(x.data); else setErr(x.message); });
    return () => { live = false; };
  }, [resourceId]);
  if (err) return <Notice tone="warn">Couldn&apos;t load your pay estimate: {err}</Notice>;
  if (!r) return <p className="text-sm text-muted">Loading pay estimate…</p>;
  if (!r.available) return null;
  const p = r.projection;
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="pay-card">
      <h2 className="flex items-center gap-2 font-extrabold text-navy"><DollarSign className="h-5 w-5 text-accent-ink" aria-hidden />Estimated gross pay · {p.period.label.toLowerCase()} ({dayLabel(p.period.from, { month: "short", day: "numeric" })} – {dayLabel(p.period.to, { month: "short", day: "numeric" })})</h2>
      <p className="rounded-lg bg-warn-tint px-3 py-2 text-sm font-semibold" data-testid="pay-disclaimer">{PAY_DISCLAIMER}</p>
      {p.method === "none" ? <p className="text-sm text-ink-soft">{p.reason}</p> : (
        <div className="grid gap-2 sm:grid-cols-3">
          <PayBox title="1. If you work your schedule" sub="Scheduled hours" e={p.scheduled} testid="pay-scheduled" />
          <PayBox title="2. From hours recorded so far" sub="Actual hours, not yet final" e={p.actual} testid="pay-actual" />
          <div className="rounded-lg border border-dashed border-line p-3 text-sm" data-testid="pay-final"><p className="font-semibold">3. Final payroll amount</p>
            <p className="mt-1 text-ink-soft">Not available here. Your paycheck comes from your company&apos;s payroll.</p></div>
        </div>
      )}
      {p.notes.length > 0 && <ul className="list-disc pl-5 text-xs text-muted">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </section>
  );
}

function PayBox({ title, sub, e, testid }: { title: string; sub: string; e: PayEstimate | null; testid: string }) {
  if (!e) return null;
  return (
    <div className="rounded-lg border border-line p-3 text-sm" data-testid={testid}>
      <p className="font-semibold">{title}</p><p className="text-xs text-muted">{sub}</p>
      <p className="mt-1 text-2xl font-extrabold text-navy">{money(e.gross)}</p>
      <p className="text-xs text-ink-soft">{e.hours.toFixed(2)} h{e.overtime > 0 ? ` · ${e.overtime.toFixed(2)} OT` : ""}{e.double > 0 ? ` · ${e.double.toFixed(2)} DT` : ""}{e.timeOff > 0 ? ` · ${e.timeOff.toFixed(2)} paid time off` : ""}</p>
      {e.lines.length > 0 && (
        <details className="mt-1 text-xs"><summary className="cursor-pointer text-accent-ink">How it&apos;s figured</summary>
          <ul className="mt-1 space-y-0.5">{e.lines.map((l) => <li key={l.label}>{l.label}: {l.hours.toFixed(2)} h{l.rate ? ` × ${money(l.rate)}` : ""} = {money(l.amount)}</li>)}</ul></details>
      )}
    </div>
  );
}
