"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, Info, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { formatRange } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import {
  describeConflict, pickProblems, rankTasks, searchProjects, type ServerConflict, type TargetProject, type TargetTask, type WfResource, type WfStatus, type Workforce,
} from "@/lib/workforce/model";
import { Drawer } from "./drawer";

type Step = "project" | "scope" | "review" | "done";
interface Preview { conflicts: ServerConflict[]; alreadyOnProject: { taskId: string; task: string; start: string; end: string }[]; needsOverride: boolean; canOverride: boolean; duplicate?: boolean }
const STATUS_OPTIONS: { value: WfStatus; label: string }[] = [
  { value: "tentative", label: "Planned (not asked yet)" }, { value: "requested", label: "Planned (asked, waiting)" }, { value: "confirmed", label: "Confirmed" },
];
const STEPS: { key: Step; label: string }[] = [{ key: "project", label: "Project" }, { key: "scope", label: "Scope & time" }, { key: "review", label: "Review" }];

/**
 * Quick assignment: who → project → section/task + time → review conflicts → confirm. Writes the same
 * schedule_tasks assignment PM Hub uses, one revision per person. Several people can go on one project
 * (each on their own section or task). Never sends anything.
 */
export function AssignDialog({ wf, initial, open, onOpenChange, onDone, presetProjectId }: {
  wf: Workforce; initial: WfResource[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void; presetProjectId?: string | null;
}) {
  const [people, setPeople] = useState<WfResource[]>(initial);
  const [projects, setProjects] = useState<TargetProject[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string | null>(presetProjectId ?? null);
  const [picks, setPicks] = useState<Record<string, string>>({}); // resourceId -> taskId
  const [status, setStatus] = useState<WfStatus>("tentative");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<Step>(presetProjectId ? "scope" : "project");
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [reason, setReason] = useState("");
  const [sameOk, setSameOk] = useState(false);
  const [replaceOk, setReplaceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    if (!open || projects) return;
    let live = true;
    api<{ projects: TargetProject[] }>("/api/workforce/targets").then((r) => { if (!live) return; if (r.ok) setProjects(r.data.projects); else setLoadErr(r.message); });
    return () => { live = false; };
  }, [open, projects]);

  const project = projects?.find((p) => p.id === projectId) ?? null;
  const results = useMemo(() => (projects ? searchProjects(projects, q).slice(0, 30) : []), [projects, q]);
  const active = wf.resources.filter((r) => r.status === "active");
  const suggestions = useMemo(() => {
    // A company's workers first, then everyone else not already picked.
    const ids = new Set(people.map((p) => p.id));
    const companyIds = new Set(people.filter((p) => !p.parentId && p.kind === "subcontractor").map((p) => p.id));
    return [...active.filter((r) => !ids.has(r.id) && r.parentId && companyIds.has(r.parentId)), ...active.filter((r) => !ids.has(r.id) && !(r.parentId && companyIds.has(r.parentId)))];
  }, [active, people]);
  const taskById = new Map((project?.tasks ?? []).map((t) => [t.id, t]));
  const pickList = people.map((p) => ({ resourceId: p.id, taskId: picks[p.id] ?? null }));
  const problems = pickProblems(pickList);
  const replacing = pickList.map((x) => ({ x, t: x.taskId ? taskById.get(x.taskId) : undefined })).filter(({ x, t }) => t?.resourceId && t.resourceId !== x.resourceId && !t.inherited);
  const hoursNum = hours.trim() ? Number(hours) : null;
  const timeErr = startTime && endTime && endTime <= startTime ? "The end time must be after the start time." : null;
  const hoursErr = hoursNum !== null && (!Number.isFinite(hoursNum) || hoursNum <= 0 || hoursNum > 10000) ? "Hours must be a positive number." : null;
  const anyOverride = Object.values(previews).some((p) => p.needsOverride);
  const canOverride = Object.values(previews).every((p) => !p.needsOverride || p.canOverride);
  const anySame = Object.values(previews).some((p) => p.alreadyOnProject.length > 0);

  function body(resourceId: string, extra: Record<string, unknown> = {}) {
    return {
      taskId: picks[resourceId], resourceId, status, notes: notes.trim() || null, hours: hoursNum,
      startTime: startTime || null, endTime: endTime || null, ...extra,
    };
  }
  async function review() {
    setBusy(true); setErr(null); setPreviews({});
    const out: Record<string, Preview> = {};
    for (const p of people) {
      const r = await api<Preview>("/api/workforce/assign", { method: "POST", body: JSON.stringify(body(p.id, { dryRun: true })) });
      if (!r.ok) { setBusy(false); setErr(r.message); return; }
      out[p.id] = { ...r.data, conflicts: r.data.conflicts ?? [], alreadyOnProject: r.data.alreadyOnProject ?? [] };
    }
    setPreviews(out); setBusy(false); setStep("review");
  }
  async function confirm() {
    if (!project) return;
    setBusy(true); setErr(null);
    let rev = project.revision;
    const done: string[] = [];
    for (const p of people) {
      const r = await api<{ ok: boolean; revision?: number; duplicate?: boolean; needsOverride?: boolean; alreadyOnProject?: unknown[] }>("/api/workforce/assign", {
        method: "POST", body: JSON.stringify(body(p.id, { baseRevision: rev, overrideReason: anyOverride ? reason.trim() || null : null, allowSameProject: sameOk })),
      });
      if (!r.ok) { setBusy(false); setErr(`${done.length ? `${done.join(", ")} saved. ` : ""}${p.name}: ${r.message}`); setSaved(done); if (done.length) onDone(); return; }
      if (!r.data.ok) { setBusy(false); setErr(`${p.name}: ${r.data.needsOverride ? "a new conflict appeared. Review again." : "already on this project at the same time."}`); setStep("scope"); return; }
      if (r.data.revision) rev = r.data.revision;
      done.push(p.name);
    }
    setSaved(done); setBusy(false); setStep("done"); onDone();
  }

  const taskLabel = (t: TargetTask) => `${t.kind === "item" ? "— " : ""}${t.name}${t.trade && t.kind === "section" ? ` (${tradeLabel(t.trade)})` : ""} · ${formatRange(t.start, t.end)}${t.resourceId || t.assignee ? ` · now: ${t.assignee ?? "assigned"}${t.inherited ? " (from section)" : ""}` : ""}`;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} testId="wf-assign-dialog" guide="workforce.assign-dialog" wide
      title={step === "done" ? "Assigned" : `Assign ${people.length === 1 ? people[0].name : `${people.length} people`} to a project`}
      subtitle={step !== "done" && (
        <ol className="mt-1 flex flex-wrap gap-3 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => <li key={s.key} aria-current={s.key === step ? "step" : undefined} className={s.key === step ? "font-bold text-navy" : "text-muted"}>{i + 1}. {s.label}</li>)}
        </ol>)}>

      {step !== "done" && (
        <section aria-label="Who">
          <p className="text-sm font-semibold text-navy">Who</p>
          <ul className="mt-1 flex flex-wrap gap-2" data-testid="wf-assign-people">
            {people.map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-sm font-semibold">
                {p.name}
                {people.length > 1 && <button type="button" className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/5" aria-label={`Remove ${p.name}`} onClick={() => { setPeople(people.filter((x) => x.id !== p.id)); setPreviews({}); if (step === "review") setStep("scope"); }}><X className="h-4 w-4" aria-hidden /></button>}
              </li>
            ))}
            {suggestions.length > 0 && people.length < 12 && (
              <li><label className="sr-only" htmlFor="wf-add-person">Add another person</label>
                <select id="wf-add-person" className="field h-9 py-0 text-sm" value="" data-testid="wf-assign-add" onChange={(e) => { const r = active.find((x) => x.id === e.target.value); if (r) { setPeople([...people, r]); setPreviews({}); if (step === "review") setStep("scope"); } }}>
                  <option value="">+ Add another person</option>
                  {suggestions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.parentId ? ` (${wf.resources.find((x) => x.id === r.parentId)?.name ?? "worker"})` : ""}</option>)}
                </select></li>
            )}
          </ul>
        </section>
      )}

      {loadErr && <Notice tone="danger">{loadErr}</Notice>}
      {err && <Notice tone="danger">{err}</Notice>}

      {step === "project" && (
        <section aria-label="Project" className="space-y-2">
          <label className="relative block"><span className="sr-only">Search projects</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className="field h-11 pl-9" autoFocus placeholder="Search project, customer or trade" value={q} onChange={(e) => setQ(e.target.value)} data-testid="wf-assign-search" /></label>
          {projects === null && !loadErr && <p className="text-sm text-muted">Loading projects…</p>}
          {projects && projects.length === 0 && <Notice title="No open projects yet">Projects show up here once a won bid has a schedule. <Link href="/projects" className="font-semibold underline">Go to Projects</Link> to schedule one.</Notice>}
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="wf-assign-projects">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={!p.canEdit} onClick={() => { setProjectId(p.id); setPicks({}); setStep("scope"); }}
                  className="flex w-full min-h-12 items-center justify-between gap-3 px-3 py-2 text-left hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60" data-testid="wf-assign-project">
                  <span className="min-w-0"><span className="block font-semibold text-navy">{p.name}</span><span className="block text-xs text-ink-soft">{[p.customer, p.status === "draft" ? "Draft schedule" : null].filter(Boolean).join(" · ")}</span></span>
                  {p.canEdit ? <span className="text-sm font-semibold text-accent-ink">Select</span> : <Badge>View only</Badge>}
                </button>
              </li>
            ))}
            {projects && projects.length > 0 && results.length === 0 && <li className="p-3 text-sm text-muted">No project matches “{q}”.</li>}
          </ul>
        </section>
      )}

      {step === "scope" && project && (
        <section aria-label="Scope and time" className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2">
            <p className="min-w-0 text-sm"><span className="font-semibold text-navy">{project.name}</span>{project.customer ? <span className="text-ink-soft"> · {project.customer}</span> : null}</p>
            {!presetProjectId && <Button size="sm" variant="ghost" onClick={() => setStep("project")}><ChevronLeft className="h-4 w-4" aria-hidden /> Change</Button>}
          </div>
          {project.tasks.length === 0 && <Notice>This project has no sections yet. Add them in the schedule first.</Notice>}
          {people.map((p) => {
            const { match, others } = rankTasks(project, p);
            return (
              <div key={p.id}>
                <label className="label" htmlFor={`wf-task-${p.id}`}>{people.length > 1 ? `${p.name}: section or task` : "Section or task (trade / scope)"}</label>
                <select id={`wf-task-${p.id}`} className="field" value={picks[p.id] ?? ""} onChange={(e) => { setPicks({ ...picks, [p.id]: e.target.value }); setPreviews({}); }} data-testid="wf-assign-task">
                  <option value="">Choose…</option>
                  {match.length > 0 && <optgroup label={`Matches ${p.trades.slice(0, 2).map(tradeLabel).join(" / ") || "their trade"}`}>{match.map((t) => <option key={t.id} value={t.id}>{taskLabel(t)}</option>)}</optgroup>}
                  {others.length > 0 && <optgroup label={match.length ? "Other sections and tasks" : "Sections and tasks"}>{others.map((t) => <option key={t.id} value={t.id}>{taskLabel(t)}</option>)}</optgroup>}
                </select>
              </div>
            );
          })}
          <p className="flex items-start gap-1.5 text-xs text-ink-soft"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Dates come from the project schedule. To change them, open the project in PM Hub. Each section or task has one assignee; use a crew for a group.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="wf-status">Status</label>
              <select id="wf-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as WfStatus)}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><label className="label" htmlFor="wf-hours">Estimated hours <span className="font-normal text-muted">(optional)</span></label>
              <input id="wf-hours" className="field" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!!hoursErr} /></div>
            <div><label className="label" htmlFor="wf-start">Start time <span className="font-normal text-muted">(optional)</span></label>
              <input id="wf-start" type="time" className="field" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div><label className="label" htmlFor="wf-end">End time <span className="font-normal text-muted">(optional)</span></label>
              <input id="wf-end" type="time" className="field" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-invalid={!!timeErr} /></div>
          </div>
          <div><label className="label" htmlFor="wf-notes">Notes <span className="font-normal text-muted">(optional, internal)</span></label>
            <textarea id="wf-notes" className="field min-h-20" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {(timeErr || hoursErr) && <Notice tone="danger">{timeErr ?? hoursErr}</Notice>}
          {problems.length > 0 && Object.keys(picks).length > 0 && <Notice tone="warn">{problems.join(" ")}</Notice>}
          {replacing.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" data-testid="wf-replace">
              <input type="checkbox" className="mt-1" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} />
              <span>{replacing.map(({ t }) => `${t!.name} is assigned to ${t!.assignee ?? "someone"}`).join("; ")}. Replace them?</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="accent" disabled={busy || problems.length > 0 || !!timeErr || !!hoursErr || (replacing.length > 0 && !replaceOk)} onClick={review} data-testid="wf-assign-review">{busy ? "Checking…" : "Review"}</Button>
          </div>
        </section>
      )}

      {step === "review" && project && (
        <section aria-label="Review" className="space-y-3" data-guide="workforce.conflicts">
          <ul className="space-y-2">
            {people.map((p) => {
              const t = taskById.get(picks[p.id]);
              const pv = previews[p.id];
              const lines = (pv?.conflicts ?? []).map(describeConflict);
              return (
                <li key={p.id} className="rounded-xl border border-line p-3" data-testid="wf-review-row">
                  <p className="font-semibold text-navy">{p.name} → {t?.name}</p>
                  <p className="text-xs text-ink-soft">{project.name} · {t ? formatRange(t.start, t.end) : ""}{startTime && endTime ? ` · ${startTime}–${endTime}` : ""}{hoursNum ? ` · ${hoursNum} h` : ""} · {STATUS_OPTIONS.find((s) => s.value === status)?.label}</p>
                  {pv?.duplicate && <p className="mt-1 text-sm text-ink-soft">Already assigned exactly like this. Nothing will change.</p>}
                  {lines.length === 0 && !pv?.alreadyOnProject.length && !pv?.duplicate && <p className="mt-1 flex items-center gap-1.5 text-sm text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden />No conflicts found.</p>}
                  {lines.map((l, i) => <p key={i} className={`mt-1 flex items-start gap-1.5 text-sm ${l.warn ? "text-danger" : "text-ink-soft"}`} data-testid={l.warn ? "wf-conflict-line" : "wf-info-line"}>{l.warn ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}{l.text}</p>)}
                  {pv?.alreadyOnProject.map((x) => <p key={x.taskId} className="mt-1 text-sm text-warn">Already on this project: {x.task} ({formatRange(x.start, x.end)}).</p>)}
                </li>
              );
            })}
          </ul>
          {anySame && (
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sameOk} onChange={(e) => setSameOk(e.target.checked)} data-testid="wf-same-ok" />
              <span>Yes, add them to this project again for this work.</span></label>
          )}
          {anyOverride && (canOverride ? (
            <div><label className="label" htmlFor="wf-reason">Reason for overriding the conflict (saved in the history)</label>
              <textarea id="wf-reason" className="field min-h-16" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="wf-override-reason" placeholder="For example: half day at each site" /></div>
          ) : <Notice tone="warn" title="A manager needs to approve this">Only someone who can edit all schedules can override a conflict. Pick another person or other dates, or ask your manager.</Notice>)}
          <p className="text-xs text-muted">Nothing is moved or rescheduled, and nobody is notified. Confirming updates the project in PM Hub right away.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep("scope")}><ChevronLeft className="h-4 w-4" aria-hidden /> Back</Button>
            <Button variant="accent" data-testid="wf-assign-confirm"
              disabled={busy || (anyOverride && (!canOverride || reason.trim().length < 3)) || (anySame && !sameOk)} onClick={confirm}>
              {busy ? "Saving…" : anyOverride ? "Override and assign" : "Confirm assignment"}</Button>
          </div>
        </section>
      )}

      {step === "done" && project && (
        <section className="space-y-3" data-testid="wf-assign-done">
          <Notice tone="ok" title={`${saved.join(", ")} ${saved.length === 1 ? "is" : "are"} on ${project.name}`}>The project schedule, Workload and this directory now show the assignment.</Notice>
          <div className="flex flex-wrap justify-end gap-2">
            <Link href={`/projects/${project.id}`} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-paper" data-testid="wf-view-in-pm" data-guide="workforce.view-in-pm">View in PM Hub</Link>
            <Button variant="accent" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </section>
      )}
    </Drawer>
  );
}
