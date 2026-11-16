"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CalendarRange, Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { WEEKDAY_NAMES, formatDay, formatRange, isIsoDate, normalizeCalendar, todayIn, workdaysBetween, type WorkCalendar } from "@/lib/schedule/calendar";
import { applyReviewEdit, checkTarget, finishOf, planSections, wouldCycle, type PlanSection } from "@/lib/schedule/engine";
import type { Dep } from "@/lib/schedule/types";
import { api, COMMON_TIMEZONES } from "./client";
import { MiniTimeline, type MiniEdit } from "./mini-timeline";
import { AssignStep, type SectionAssignment } from "./assign-step";
import type { Team } from "@/lib/projects/team";
import { CompanyCalendar } from "./company-calendar";

export interface WizardSection { id: string; name: string; trade: string | null; items: { id: string; name: string }[] }
export interface WizardProps {
  estimate: { id: string; title: string; number: string; customerName: string; stage: string | null; versionNumber: number | null };
  accepted: boolean;
  signed: boolean;
  sections: WizardSection[];
  timezone: string;
  tradeLabels: Record<string, string>;
  /** V4.2 Team & Subcontractors (null until that SQL runs: the assign step then just explains). */
  team?: Team | null;
  people?: { id: string; name: string }[];
  me?: string | null;
  /** V4.3: this newly approved job hasn't been reviewed yet (saving records the reviewer). */
  needsReview?: boolean;
}

const STEPS = ["Source estimate", "Sections", "Start date", "Durations", "Dependencies", "Target date", "Review", "Assign", "Save"] as const;
const LAST = STEPS.length - 1;

type Link_ = { after: string | null; lag: number; overlap: number };

export function ScheduleWizard({ estimate, accepted, signed, sections, timezone, tradeLabels, team = null, people = [], me = null, needsReview = false }: WizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [provisional, setProvisional] = useState(false);
  const [included, setIncluded] = useState<string[]>(sections.map((s) => s.id));
  const [cal, setCal] = useState<WorkCalendar>(() => normalizeCalendar({ workdays: [1, 2, 3, 4, 5], holidays: [], timezone }));
  const [start, setStart] = useState(() => todayIn(timezone));
  const [holiday, setHoliday] = useState("");
  const [durations, setDurations] = useState<Record<string, number>>(() => Object.fromEntries(sections.map((s) => [s.id, Math.min(10, Math.max(1, s.items.length || 1))])));
  // Default: each section after the one before it. Any section can be changed to start with the project.
  const [links, setLinks] = useState<Record<string, Link_>>(() => Object.fromEntries(sections.map((s, i) => [s.id, { after: i ? sections[i - 1].id : null, lag: 0, overlap: 0 }])));
  // "Don't start before" offsets (working days after the project start), set by dragging bars in Review.
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  // Who's doing the work, per section (saved right after the schedule is created).
  const [assign, setAssign] = useState<Record<string, SectionAssignment>>({});
  const [reviewed, setReviewed] = useState(false);
  // V4.5A Company Calendar: always beside the wizard on wide screens; a panel below it on tablets and a
  // full-screen view on phones. Opening, expanding or closing it never resets the wizard (same component).
  const [calOpen, setCalOpen] = useState(false);
  const [calExpanded, setCalExpanded] = useState(false);
  const phone = useIsPhone();
  const stepNav = useRef<HTMLOListElement>(null);
  useEffect(() => {
    stepNav.current?.querySelector<HTMLElement>("[aria-current=step]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step]);
  useEffect(() => {
    if (!calExpanded && !(phone && calOpen)) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setCalExpanded(false); if (phone) setCalOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calExpanded, calOpen, phone]);

  const chosen = sections.filter((s) => included.includes(s.id));
  const planInput: PlanSection[] = chosen.map((s, i) => ({ key: s.id, sourceGroupId: s.id, name: s.name, durationDays: durations[s.id] || 1, sortOrder: i, offsetDays: offsets[s.id] ?? 0 }));
  const deps: Dep[] = chosen.flatMap((s) => {
    const l = links[s.id];
    return l?.after && included.includes(l.after) ? [{ from: l.after, to: s.id, lagDays: l.lag, maxOverlap: l.overlap }] : [];
  });
  // Cheap enough to recompute on every render (a few hundred sections at most).
  const plan = isIsoDate(start) ? planSections(planInput, deps, start, cal) : null;
  const feas = plan && isIsoDate(target) ? checkTarget(planInput, deps, start, target, cal) : null;
  const multiTrade = new Set(sections.map((s) => s.trade)).size > 1;
  // The draft appears on the Company Calendar from the Start date step on (before that: existing work only).
  const draftPlan = step >= 2 && plan ? plan.map((p) => ({ key: p.key, name: p.name, trade: sections.find((x) => x.id === p.key)?.trade ?? null, plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, durationDays: p.durationDays })) : [];

  const canNext = [
    accepted || provisional,
    chosen.length > 0,
    isIsoDate(start) && cal.workdays.length > 0,
    chosen.every((s) => (durations[s.id] ?? 0) >= 1),
    Boolean(plan),
    !target || (isIsoDate(target) && target >= start),
    Boolean(plan),
    true,
    true,
  ][step];

  const setLink = (id: string, patch: Partial<Link_>) => setLinks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  /** Review step: a dragged or date-edited bar becomes a duration, a wait/overlap or a start offset. */
  const reviewEdit = (e: MiniEdit) => {
    const r = applyReviewEdit(planInput, deps, start, cal, { key: e.id, start: e.start, end: e.end, durationDays: e.durationDays });
    if (!r) return;
    setDurations((d) => ({ ...d, [e.id]: r.durationDays }));
    setOffsets((o) => ({ ...o, [e.id]: r.offsetDays }));
    if (r.dep) setLink(e.id, { lag: r.dep.lagDays, overlap: r.dep.maxOverlap });
  };

  async function save(publish = false) {
    if (!plan) return;
    setSaving(true); setError(null);
    const r = await api<{ id: string }>("/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        estimateId: estimate.id, provisional: !accepted && provisional, calendar: cal, startDate: start, targetEndDate: target || null,
        ...(needsReview ? { markReviewed: reviewed } : {}), ...(publish && accepted ? { publish: true } : {}),
        sections: planInput.map((p) => ({ sourceGroupId: p.sourceGroupId, durationDays: p.durationDays, sortOrder: p.sortOrder, offsetDays: p.offsetDays ?? 0 })), deps,
      }),
    });
    if (r.ok) {
      const picks = chosen.filter((s) => assign[s.id]?.resourceId);
      if (picks.length) {
        // Section tasks get their ids on create: look them up, then assign in one revision.
        const full = await api<{ schedule: { revision: number }; tasks: { id: string; kind: string; sourceGroupId: string; splitFrom?: string | null }[] }>(`/api/schedules/${r.data.id}`);
        const items = full.ok ? picks.flatMap((s) => {
          const t = full.data.tasks.find((x) => x.kind === "section" && x.sourceGroupId === s.id && !x.splitFrom);
          return t ? [{ taskId: t.id, resourceId: assign[s.id].resourceId, status: assign[s.id].status }] : [];
        }) : [];
        const a = full.ok && items.length ? await api(`/api/projects/${r.data.id}/assign`, { method: "POST", body: JSON.stringify({ baseRevision: full.data.schedule.revision, items, summary: `Assigned ${items.length} section${items.length === 1 ? "" : "s"} in Schedule Now` }) }) : null;
        if (!a || !a.ok) { setSaving(false); router.push(`/projects/${r.data.id}?created=1&assign=failed`); return; }
      }
      setSaving(false);
      router.push(`/projects/${r.data.id}?created=1`); return;
    }
    setSaving(false);
    if (r.code === "schedule_exists" && typeof r.extra.scheduleId === "string") setExisting(r.extra.scheduleId);
    setError(r.message);
  }

  return (
    <div className="mx-auto max-w-[1520px] space-y-5" data-testid="schedule-wizard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumbs items={[{ label: "Projects", href: "/projects" }, { label: "Schedule Now" }]} />
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-navy sm:text-3xl"><CalendarRange className="h-7 w-7 text-accent-ink" aria-hidden /> Schedule Now</h1>
          <p className="mt-1 text-ink-soft">Build a draft job schedule from <strong>{estimate.title || "this bid"}</strong>. Your customer isn&apos;t notified.</p>
        </div>
        <Button type="button" variant="secondary" className="xl:hidden" aria-expanded={calOpen} aria-controls="company-cal-panel" data-testid="view-company-calendar"
          onClick={() => { const next = !calOpen; setCalOpen(next); if (next && !phone) setTimeout(() => document.getElementById("company-cal-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}>
          <CalendarDays className="h-4 w-4" aria-hidden /> {calOpen && !phone ? "Hide Company Calendar" : "View Company Calendar"}
        </Button>
      </div>

      <div className="xl:grid xl:grid-cols-[minmax(0,58fr)_minmax(380px,42fr)] xl:items-start xl:gap-6" data-testid="schedule-split">
      <div className="min-w-0 space-y-5" data-testid="wizard-column">
      <ol ref={stepNav} className="flex gap-1 overflow-x-auto pb-1 text-xs [scrollbar-width:thin]" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="shrink-0">
            <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
              className={cn("flex min-h-9 items-center gap-1.5 rounded-full border px-3 font-semibold", i === step ? "border-navy bg-navy text-white" : i < step ? "border-ok/40 bg-ok-tint text-ok" : "border-line text-muted")}>
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden>{i + 1}</span>}<span>{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-labelledby="step-title">
        <h2 id="step-title" className="font-display text-lg font-extrabold text-navy">Step {step + 1} of {STEPS.length}: {step === 7 ? "Assign who's doing the work" : STEPS[step]}</h2>

        {step === 0 && (
          <div className="mt-3 space-y-3">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Bid</dt><dd className="font-semibold text-navy">{estimate.title || "Untitled bid"}{estimate.number ? ` · ${estimate.number}` : ""}</dd></div>
              <div><dt className="text-muted">Customer</dt><dd className="font-semibold">{estimate.customerName || "—"}</dd></div>
              <div><dt className="text-muted">Estimate version</dt><dd>{estimate.versionNumber ? `Version ${estimate.versionNumber} (latest finalized)` : "Current working copy"}</dd></div>
              <div><dt className="text-muted">Status</dt><dd>{accepted ? <Badge tone="ok"><Check className="h-3 w-3" aria-hidden />{signed ? "Signed by customer" : "Won"}</Badge> : <Badge tone="warn">Not accepted yet</Badge>}</dd></div>
            </dl>
            <p className="text-sm text-ink-soft">The schedule keeps a copy of this estimate&apos;s sections and line items. Editing the bid later won&apos;t change the schedule.</p>
            {!accepted && (
              <Notice tone="warn" title="This bid hasn't been accepted">
                <p>Only accepted bids become confirmed jobs. You can still plan ahead with a provisional schedule, clearly labelled as provisional.</p>
                <label className="mt-2 flex items-start gap-2 font-semibold text-ink">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} data-testid="provisional" />
                  Create a provisional schedule for this unaccepted bid
                </label>
              </Notice>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-ink-soft">These sections come from the estimate. Uncheck any you don&apos;t want on the schedule. Nothing is added that isn&apos;t in the bid.</p>
            {sections.length === 0 && <Notice tone="warn">This bid has no sections yet. Add sections to the estimate first.</Notice>}
            {groupByTrade(sections, multiTrade).map(([trade, list]) => (
              <fieldset key={trade ?? "all"} className="space-y-1">
                {multiTrade && <legend className="pt-2 text-xs font-bold uppercase tracking-wider text-muted">{tradeLabels[trade ?? ""] ?? trade ?? "Other"}</legend>}
                {list.map((s) => (
                  <label key={s.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <input type="checkbox" className="h-4 w-4" checked={included.includes(s.id)} onChange={(e) => setIncluded((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                    <span className="min-w-0 flex-1 font-semibold text-navy">{s.name}</span>
                    <span className="text-xs text-muted">{s.items.length} line item{s.items.length === 1 ? "" : "s"}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="label">Proposed start date</span><input type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} data-testid="start-date" /></label>
            <label className="block"><span className="label">Business time zone</span>
              <select className="field" value={cal.timezone} onChange={(e) => setCal({ ...cal, timezone: e.target.value })}>
                {[...new Set([cal.timezone, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
              </select>
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="label">Working days</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_NAMES.map((d, i) => {
                  const on = cal.workdays.includes(i);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => setCal(normalizeCalendar({ ...cal, workdays: on ? cal.workdays.filter((x) => x !== i) : [...cal.workdays, i] }))}
                      className={cn("min-h-11 min-w-12 rounded-lg border px-3 text-sm font-semibold", on ? "border-navy bg-navy text-white" : "border-line text-ink-soft")}>{d}</button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted">Durations count only these days. Pick at least one.</p>
            </fieldset>
            <div className="sm:col-span-2">
              <span className="label">Non-working dates (holidays) <span className="font-normal text-muted">(optional)</span></span>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" className="field max-w-[12rem]" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label="Add a non-working date" />
                <Button type="button" variant="secondary" size="sm" disabled={!isIsoDate(holiday)} onClick={() => { setCal(normalizeCalendar({ ...cal, holidays: [...cal.holidays, holiday] })); setHoliday(""); }}><Plus className="h-4 w-4" aria-hidden /> Add</Button>
                {cal.holidays.map((h) => (
                  <span key={h} className="inline-flex items-center gap-1 rounded-full bg-black/5 py-1 pl-3 pr-1 text-xs font-semibold">{formatDay(h, { month: "short", day: "numeric", year: "numeric" })}
                    <button type="button" className="grid h-6 w-6 place-items-center rounded-full hover:bg-black/10" aria-label={`Remove ${h}`} onClick={() => setCal({ ...cal, holidays: cal.holidays.filter((x) => x !== h) })}><X className="h-3 w-3" aria-hidden /></button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-ink-soft">How many working days will each section take?</p>
            {chosen.map((s) => (
              <label key={s.id} className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 flex-1 font-semibold text-navy">{s.name}</span>
                <input type="number" min={1} max={3650} inputMode="numeric" className="field w-24" value={durations[s.id] ?? 1} aria-label={`${s.name} working days`}
                  onChange={(e) => setDurations((d) => ({ ...d, [s.id]: Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1))) }))} />
                <span className="text-sm text-muted">working days</span>
              </label>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-ink-soft">Choose what each section waits for. Sections that start with the project can overlap. Overlap you allow here is only used if you ask the scheduler to meet a target date.</p>
            {chosen.map((s) => {
              const l = links[s.id];
              const after = l?.after && included.includes(l.after) ? l.after : "";
              return (
                <div key={s.id} className="rounded-lg border border-line p-3" data-testid={`dep-${s.id}`}>
                  <p className="font-semibold text-navy">{s.name}</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <label className="block"><span className="label">Starts</span>
                      <select className="field" value={after} onChange={(e) => setLink(s.id, { after: e.target.value || null })} aria-label={`${s.name} starts`}>
                        <option value="">With the project start</option>
                        {chosen.filter((o) => o.id !== s.id && !wouldCycle(chosen.map((c) => c.id), deps.filter((d) => d.to !== s.id), o.id, s.id)).map((o) => <option key={o.id} value={o.id}>After {o.name} finishes</option>)}
                      </select>
                    </label>
                    {after && <>
                      <label className="block"><span className="label">Wait after it (working days)</span>
                        <input type="number" min={0} max={365} className="field" value={Math.max(0, l.lag)} onChange={(e) => setLink(s.id, { lag: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} /></label>
                      <label className="block"><span className="label">May overlap by up to (days)</span>
                        <input type="number" min={0} max={365} className="field" value={l.overlap} onChange={(e) => setLink(s.id, { overlap: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} /></label>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {step === 5 && plan && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">Optional. With the plan as it is, the job finishes <strong>{formatDay(finishOf(plan), { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</strong>.</p>
            <label className="block max-w-xs"><span className="label">Target completion date <span className="font-normal text-muted">(optional)</span></span>
              <input type="date" className="field" value={target} min={start} onChange={(e) => setTarget(e.target.value)} data-testid="target-date" /></label>
            {feas?.feasible && <Notice tone="ok" title="The plan meets your target">It finishes {formatDay(feas.finish)}, on or before {formatDay(target)}.</Notice>}
            {feas && !feas.feasible && (
              <div className="space-y-3" data-testid="target-conflict">
                <Notice tone="warn" title={`The plan finishes ${formatDay(feas.finish)}, ${feas.overBy} working day${feas.overBy === 1 ? "" : "s"} after the target`}>
                  We won&apos;t shorten any section or overlap work you haven&apos;t allowed. Choose how to handle it:
                </Notice>
                <div className="grid gap-2 sm:grid-cols-2">
                  {feas.suggestion && (
                    <ChoiceButton onClick={() => {
                      for (const c of feas.suggestion!.changed) setLink(c.to, { lag: -c.overlap });
                    }} title={`Use the overlaps you allowed (finishes ${formatDay(feas.suggestion.finish)})`}
                      detail={`${feas.suggestion.changed.map((c) => `${nameOf(sections, c.to)} overlaps ${nameOf(sections, c.from)} by ${c.overlap} day${c.overlap === 1 ? "" : "s"}`).join("; ")}.${feas.suggestion.feasible ? "" : " This still misses the target."}`} testid="use-overlaps" />
                  )}
                  {feas.startBy && feas.startBy >= todayIn(cal.timezone) && <ChoiceButton onClick={() => setStart(feas.startBy!)} title={`Start ${formatDay(feas.startBy)} instead`} detail="Keeps every duration and dependency." testid="start-earlier" />}
                  <ChoiceButton onClick={() => setTarget(feas.finish)} title={`Move the target to ${formatDay(feas.finish)}`} detail="Keeps the plan as it is." testid="move-target" />
                  <ChoiceButton onClick={() => setStep(3)} title="Change durations or dependencies yourself" detail="Go back to step 4." />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 6 && plan && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">{formatRange(plan.reduce((m, p) => (p.plannedStart < m ? p.plannedStart : m), plan[0].plannedStart), finishOf(plan))} · {workdaysBetween(start, finishOf(plan), cal)} working days{target ? ` · target ${formatDay(target)}` : ""}</p>
            <MiniTimeline rows={plan.map((p) => ({ id: p.key, name: p.name, start: p.plannedStart, end: p.plannedEnd, durationDays: p.durationDays }))} onEdit={reviewEdit} />
          </div>
        )}

        {step === 7 && plan && (
          <AssignStep sections={chosen} plan={plan} tradeLabels={tradeLabels} team={team} people={people} me={me} value={assign} onChange={setAssign} />
        )}

        {step === LAST && plan && (
          <div className="mt-3 space-y-3">
            {chosen.some((s) => assign[s.id]?.resourceId) && <p className="text-sm text-ink-soft">{chosen.filter((s) => assign[s.id]?.resourceId).length} section{chosen.filter((s) => assign[s.id]?.resourceId).length === 1 ? "" : "s"} will be assigned. No one is notified.</p>}
            <p className="text-ink-soft">Save this as a <strong>draft schedule</strong>. You can drag tasks, schedule individual line items and track progress next. Nothing is sent to your customer.</p>
            {!accepted && <Badge tone="warn">Provisional: bid not yet accepted</Badge>}
            {error && <Notice tone="danger">{error} {existing && <Link className="font-semibold underline" href={`/projects/${existing}`}>Open the existing schedule</Link>}</Notice>}
            {needsReview && (
              <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} data-testid="confirm-reviewed" />
                <span><strong>Newly approved: needs PM review.</strong> I reviewed the approved proposal, scope, notes and attachments. Saving records me as the reviewer with the time.</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={accepted ? "secondary" : "accent"} onClick={() => void save(false)} disabled={saving || (needsReview && !reviewed)} data-testid="save-schedule">{saving ? "Saving…" : needsReview ? "Mark reviewed & save draft" : "Save draft schedule"}</Button>
              {accepted && <Button type="button" variant="accent" onClick={() => void save(true)} disabled={saving || (needsReview && !reviewed)} data-testid="save-publish-schedule">{needsReview ? "Mark reviewed & publish" : "Save & publish as active"}</Button>}
            </div>
            {accepted && <p className="text-xs text-muted">Publishing makes it the active schedule and moves the project to Scheduled. A draft stays a draft until you publish it.</p>}
          </div>
        )}
      </section>

      <div className="flex justify-between gap-2">
        <Button type="button" variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft className="h-4 w-4" aria-hidden /> Back</Button>
        {step < LAST && <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext} data-testid="wizard-next">Next <ArrowRight className="h-4 w-4" aria-hidden /></Button>}
      </div>
      {step === 4 && !plan && <Notice tone="danger"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />These dependencies loop back on themselves.</Notice>}
      </div>

      {calExpanded && !phone && <div className="fixed inset-0 z-40 bg-ink/40" aria-hidden onClick={() => setCalExpanded(false)} />}
      <aside id="company-cal-panel" aria-label="Company Calendar" data-testid="company-cal-panel"
        className={cn(
          calOpen ? "block" : "hidden", "xl:block",
          // Phones: full screen over the wizard (the wizard stays mounted underneath, so nothing is lost).
          "max-md:fixed max-md:inset-0 max-md:z-50 max-md:bg-paper max-md:p-2",
          // Tablets: a panel under the wizard. Desktop: sticky beside it, scrolling inside when tall.
          "md:mt-5 xl:sticky xl:top-4 xl:mt-0 xl:h-[calc(100vh-2rem)] xl:max-h-[56rem]",
          calExpanded && "md:fixed md:inset-4 md:z-50 md:mt-0 md:block md:h-auto md:max-h-none xl:fixed xl:inset-6 xl:h-auto xl:max-h-none",
        )}>
        <CompanyCalendar
          plan={draftPlan} assign={assign} calendar={cal} team={team} today={todayIn(cal.timezone)} projectName={estimate.title}
          onPickStart={step < LAST ? (d) => setStart(d) : undefined}
          expanded={calExpanded && !phone} onToggleExpanded={() => setCalExpanded((v) => !v)}
          onClose={phone ? () => setCalOpen(false) : undefined} stepLabel={`step ${step + 1}`}
        />
      </aside>
      </div>
    </div>
  );
}

/** Phone layout (under the md breakpoint): the calendar opens full screen instead of inline. */
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function ChoiceButton({ title, detail, onClick, testid }: { title: string; detail: string; onClick: () => void; testid?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid} className="rounded-lg border border-line p-3 text-left hover:border-accent-ink hover:bg-accent-tint/40">
      <span className="block font-semibold text-navy">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-soft">{detail}</span>
    </button>
  );
}

const nameOf = (sections: WizardSection[], id: string) => sections.find((s) => s.id === id)?.name ?? "A section";

function groupByTrade(sections: WizardSection[], multi: boolean): [string | null, WizardSection[]][] {
  if (!multi) return [[null, sections]];
  const m = new Map<string | null, WizardSection[]>();
  for (const s of sections) m.set(s.trade, [...(m.get(s.trade) ?? []), s]);
  return [...m.entries()];
}
