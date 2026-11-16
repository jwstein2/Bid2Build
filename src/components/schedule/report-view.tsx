import { CalendarCheck2, CheckCircle2, Clock, Hammer, Info } from "lucide-react";
import { daysBetween, formatDay, formatRange } from "@/lib/schedule/calendar";
import type { CustomerReport, ReportSection, ReportState } from "@/lib/schedule/report";

const STATE: Record<ReportState, { title: string; bar: string; chip: string }> = {
  current: { title: "Current work", bar: "bg-[#0e7490]", chip: "bg-[#e0f2f7] text-[#0e5a70]" },
  completed: { title: "Completed", bar: "bg-[#15803d]", chip: "bg-ok-tint text-ok" },
  upcoming: { title: "Upcoming", bar: "bg-[#94a3b8]", chip: "bg-black/5 text-ink-soft" },
};
const chipFor = (x: ReportSection) => (x.status === "delayed" ? "bg-warn-tint text-warn" : x.status === "on_hold" ? "bg-[#EFE9F8] text-[#5B3E99]" : STATE[x.state].chip);
const long = (d: string) => formatDay(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const short = (d: string) => formatDay(d, { month: "short", day: "numeric", year: "numeric" });

/**
 * The customer's view of a schedule update. Used for the contractor's preview, the published copy and
 * the customer's share page, so all three show exactly the same thing. Renders only what is in the
 * report (which never carries prices, costs or internal notes).
 */
export function ReportView({ r, logoUrl, version }: { r: CustomerReport; logoUrl?: string | null; version?: number }) {
  const accent = r.brand.color ?? "#0b2d4d";
  const groups = (["current", "completed", "upcoming"] as ReportState[]).map((s) => ({ s, items: r.sections.filter((x) => x.state === s) })).filter((g) => g.items.length);
  const start = r.projectStart, end = r.forecastFinish;
  const span = start && end ? Math.max(1, daysBetween(start, end) + 1) : 1;
  const pct = (d: string) => (start ? Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100)) : 0);
  const contact = [r.company.phone, r.company.email, r.company.website].filter(Boolean).join(" · ");

  return (
    <article className="theme-light overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" data-testid="report-view">
      <header className="border-b-4 p-4 sm:p-6" style={{ borderColor: accent }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {r.brand.logo && logoUrl && <img src={logoUrl} alt="" className="h-12 max-w-[9rem] object-contain" />}
            <div className="min-w-0">
              <p className="font-display text-lg font-extrabold text-navy">{r.company.name}</p>
              {contact && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{contact}</p>}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>Project update{version ? ` · ${version}` : ""}</p>
            <h2 className="font-display text-xl font-extrabold text-navy sm:text-2xl">{r.projectTitle}</h2>
            <p className="text-sm text-ink-soft">{r.customerName ? <>Prepared for {r.customerName}</> : null}{r.projectAddress ? <><br />{r.projectAddress}</> : null}</p>
            <p className="text-sm text-ink-soft">{long(r.reportDate)}</p>
          </div>
        </div>
      </header>

      <div className="space-y-5 p-4 sm:p-6">
        {r.provisional && <p className="rounded-lg bg-warn-tint px-3 py-2 text-sm font-semibold text-warn">Tentative schedule: dates are provisional until the project is confirmed.</p>}

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Summary">
          {r.progress !== null && (
            <div className="rounded-xl bg-paper p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Overall progress</p>
              <p className="mt-1 text-3xl font-extrabold text-navy" data-testid="report-progress">{r.progress}%</p>
              <div className="mt-2 h-2 rounded-full bg-black/10" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress"><div className="h-2 rounded-full" style={{ width: `${r.progress}%`, background: accent }} /></div>
              <p className="mt-1 text-xs text-muted">Based on work completed, not days passed.</p>
            </div>
          )}
          {r.forecastFinish && (
            <div className="rounded-xl bg-paper p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Forecast completion</p>
              <p className="mt-1 text-xl font-extrabold text-navy" data-testid="report-forecast">{short(r.forecastFinish)}</p>
              {r.previousForecast && <p className="mt-1 text-sm font-semibold text-warn" data-testid="report-previous-forecast">Previously {short(r.previousForecast)}</p>}
            </div>
          )}
          <div className="rounded-xl bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Work status</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />{r.counts.completed} complete</li>
              <li className="flex items-center gap-1.5"><Hammer className="h-4 w-4 text-[#0e7490]" aria-hidden />{r.counts.current} in progress</li>
              <li className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-muted" aria-hidden />{r.counts.upcoming} upcoming</li>
            </ul>
          </div>
        </section>

        {r.notes && (
          <section className="rounded-xl border-l-4 bg-paper p-4" style={{ borderColor: accent }} aria-labelledby="rv-notes">
            <h3 id="rv-notes" className="font-display font-extrabold text-navy">Notes from {r.company.name}</h3>
            <p className="mt-1 whitespace-pre-line text-ink">{r.notes}</p>
          </section>
        )}

        {r.showTimeline && start && end && r.sections.length > 0 && (
          <section aria-labelledby="rv-timeline">
            <h3 id="rv-timeline" className="font-display font-extrabold text-navy">Timeline</h3>
            <ul className="mt-2 space-y-1.5" data-testid="report-timeline">
              {r.sections.map((x) => (
                <li key={x.key} className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-2 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
                  <span className="truncate font-semibold" title={x.name}>{x.name}</span>
                  <span className="relative block h-3 rounded-full bg-paper">
                    <span className={`absolute top-0 h-3 rounded-full ${STATE[x.state].bar}`} style={{ left: `${pct(x.plannedStart)}%`, width: `${Math.max(2, pct(x.plannedEnd) - pct(x.plannedStart) + 100 / span)}%`, maxWidth: `${100 - pct(x.plannedStart)}%` }} title={formatRange(x.plannedStart, x.plannedEnd)} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex justify-between pl-[7.5rem] text-xs text-muted sm:pl-[11.5rem]"><span>{formatDay(start)}</span><span>{formatDay(end)}</span></div>
            <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted">{(["completed", "current", "upcoming"] as ReportState[]).map((s) => <span key={s} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${STATE[s].bar}`} aria-hidden />{STATE[s].title}</span>)}</p>
          </section>
        )}

        {groups.map((g) => (
          <section key={g.s} aria-labelledby={`rv-${g.s}`}>
            <h3 id={`rv-${g.s}`} className="font-display font-extrabold text-navy">{STATE[g.s].title}</h3>
            <ul className="mt-2 space-y-2">
              {g.items.map((x) => (
                <li key={x.key} className="rounded-xl border border-line p-3" data-testid={`report-section-${x.key}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 font-bold text-navy">{x.name}{x.trade && <span className="ml-2 text-xs font-semibold text-muted">{x.trade}</span>}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${chipFor(x)}`}>{x.statusLabel}{x.progress !== null && x.state === "current" ? ` · ${x.progress}%` : ""}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                    <span><CalendarCheck2 className="mr-1 inline h-4 w-4 align-[-3px]" aria-hidden />Scheduled {formatRange(x.plannedStart, x.plannedEnd)}</span>
                    {x.actualFinish && <span className="font-semibold text-ok">Completed {short(x.actualFinish)}</span>}
                  </p>
                  {x.change && <p className="mt-1 flex items-start gap-1 text-sm font-semibold text-warn" data-testid="report-change"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{x.change}</p>}
                  {x.assignedTo && <p className="mt-1 text-sm text-ink" data-testid="report-assigned"><span className="font-semibold">Done by:</span> {x.assignedTo}</p>}
                  {x.scope && <p className="mt-1 text-sm text-ink"><span className="font-semibold">Scope:</span> {x.scope}</p>}
                  {x.tasks && (
                    <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-sm">
                      {x.tasks.map((t, i) => <li key={i} className="flex flex-wrap justify-between gap-2"><span>{t.name}</span><span className="text-ink-soft">{formatRange(t.plannedStart, t.plannedEnd)} · {t.statusLabel}</span></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {r.sections.length === 0 && <p className="text-sm text-muted">No sections are included in this update.</p>}
        <p className="border-t border-line pt-3 text-xs text-muted">Dates are forecasts and may change. Questions about this update go to {r.company.name}{contact ? ` (${contact})` : ""}.</p>
      </div>
    </article>
  );
}
