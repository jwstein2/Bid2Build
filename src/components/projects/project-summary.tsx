"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, FileText, History, MessageSquare, RotateCcw, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { formatDay, formatRange, isIsoDate } from "@/lib/schedule/calendar";
import { api } from "@/components/schedule/client";
import { projectDot } from "@/lib/projects/workspace";

export interface SummaryProps {
  id: string; estimateId: string; companyId: string | null; status: string; revision: number; startDate: string; finishDate: string | null;
  targetEndDate: string | null; actualFinish: string | null; closeoutNote: string | null; progress: number; customerName: string;
  salesRepId: string | null; projectManagerId: string | null; canEdit: boolean; canPublish: boolean;
  people: { id: string; name: string }[]; openTasks: number; lastUpdateAt: string | null; signatureId: string | null; manuallyApproved: boolean;
  activity: { kind: string; audience: string; summary: string; actor: string | null; at: string }[];
  today: string;
}

const KIND_LABEL: Record<string, string> = {
  bid_approved: "Bid approved", proposal_signed: "Proposal signed", schedule_created: "Schedule created", schedule_changed: "Schedule changed",
  people_changed: "People", task_started: "Task started", task_completed: "Task completed", delay_recorded: "Delay", customer_update: "Customer update",
  project_completed: "Completed", project_reopened: "Reopened", note: "Note",
};

/**
 * Project detail header: customer, status, who sold it, who manages it, dates, progress, documents,
 * activity history and closeout. The schedule editor below is unchanged.
 */
export function ProjectSummary(p: SummaryProps) {
  const router = useRouter();
  const nameOf = (id: string | null) => (id ? p.people.find((x) => x.id === id)?.name ?? "Former member" : "Not assigned");
  const [editPeople, setEditPeople] = useState(false);
  const [rep, setRep] = useState(p.salesRepId ?? "");
  const [pm, setPm] = useState(p.projectManagerId ?? "");
  const [closing, setClosing] = useState(false);
  const [finish, setFinish] = useState(p.today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const completed = p.status === "completed";

  async function savePeople() {
    setBusy(true); setMsg(null);
    const r = await api(`/api/projects/${p.id}/people`, { method: "POST", body: JSON.stringify({ salesRepId: rep || null, projectManagerId: pm || null }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setEditPeople(false); setMsg({ ok: true, text: "People updated." }); router.refresh();
  }
  async function closeout(action: "complete" | "reopen") {
    setBusy(true); setMsg(null);
    const body = action === "complete" ? { action, baseRevision: p.revision, actualFinish: finish, overrideReason: p.openTasks > 0 ? reason : null } : { action, baseRevision: p.revision };
    const r = await api(`/api/projects/${p.id}/closeout`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setClosing(false); setMsg({ ok: true, text: action === "complete" ? "Project completed. Its history and schedule are kept." : "Project reopened." }); router.refresh();
  }

  const activity = showAll ? p.activity : p.activity.slice(0, 3);
  // Needs attention: only real, recorded conditions (status, people, sent updates, planned dates), most
  // important first. The first one becomes the single "Next step". Elapsed time is never read as progress.
  const attention: { key: string; text: string; action?: { label: string; href?: string; onClick?: () => void } }[] = [];
  if (!completed) {
    if (p.status !== "active" && p.canPublish) attention.push({ key: "publish", text: "This schedule is still a draft. Your crew and customer see it only after you publish.", action: { label: "Review dates and publish", onClick: () => {
      const b = document.querySelector<HTMLElement>('[data-testid="publish-schedule"]');
      if (b) { b.scrollIntoView({ block: "center", behavior: "smooth" }); b.focus({ preventScroll: true }); } else router.push(`/projects/${p.id}?tab=schedule`);
    } } });
    if (!p.projectManagerId && p.canEdit) attention.push({ key: "pm", text: "No project manager is assigned.", action: { label: "Assign a project manager", onClick: () => setEditPeople(true) } });
    if (p.status === "active" && !p.lastUpdateAt && p.canPublish) attention.push({ key: "update", text: "The customer hasn't received an update yet.", action: { label: "Prepare a customer update", href: `/projects/${p.id}/update` } });
    if (p.finishDate && p.finishDate < p.today && p.openTasks > 0) attention.push({ key: "late", text: `The planned finish (${formatDay(p.finishDate, { month: "short", day: "numeric" })}) has passed with ${p.openTasks} open task${p.openTasks === 1 ? "" : "s"}.`, action: p.canEdit ? { label: "Update the schedule", href: `/projects/${p.id}?tab=schedule` } : undefined });
  }
  const [next, ...more] = attention;
  return (
    <section className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]" aria-label="Project summary" data-testid="project-summary">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={projectDot(p.id)} aria-hidden />
          <span className="font-semibold text-navy">{p.customerName || "Customer"}</span>
          <Badge tone={completed ? "ok" : p.status === "active" ? "accent" : "neutral"}>{completed ? "Completed" : p.status === "active" ? "Active" : "Draft"}</Badge>
          {p.signatureId ? <Badge tone="ok">Signed electronically</Badge> : p.manuallyApproved ? <Badge>Approved manually</Badge> : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
          <div><dt className="text-xs text-muted">Sold by</dt><dd data-testid="summary-rep">{nameOf(p.salesRepId)}</dd></div>
          <div><dt className="text-xs text-muted">Project manager</dt><dd data-testid="summary-pm">{nameOf(p.projectManagerId)}</dd></div>
          <div><dt className="text-xs text-muted">Planned</dt><dd>{p.finishDate ? formatRange(p.startDate, p.finishDate) : formatDay(p.startDate)}</dd></div>
          <div><dt className="text-xs text-muted" title="From task % complete, never from elapsed time">Progress</dt><dd className="font-bold text-navy" data-testid="summary-progress">{p.progress}%</dd></div>
          <div><dt className="text-xs text-muted">{completed ? "Finished" : "Target"}</dt><dd>{completed && p.actualFinish ? formatDay(p.actualFinish, { month: "short", day: "numeric", year: "numeric" }) : p.targetEndDate ? formatDay(p.targetEndDate, { month: "short", day: "numeric", year: "numeric" }) : "—"}</dd></div>
        </dl>
        {completed && p.closeoutNote && <p className="mt-2 text-sm text-ink-soft">Closed with unfinished tasks: {p.closeoutNote}</p>}

        {next && (
          <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3" data-testid="next-step" aria-label="Next step">
            <p className="text-[11px] font-bold uppercase tracking-wider text-accent-ink">Next step</p>
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm text-ink">{next.text}</p>
              {next.action && (next.action.href
                ? <Link href={next.action.href} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-navy px-3 text-sm font-semibold text-white md:min-h-9" data-testid="next-step-action">{next.action.label} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                : <Button size="sm" onClick={next.action.onClick} data-testid="next-step-action">{next.action.label} <ArrowRight className="h-4 w-4" aria-hidden /></Button>)}
            </div>
            {more.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-accent/20 pt-2 text-sm text-ink-soft" aria-label="Also needs attention" data-testid="needs-attention">
                {more.map((m) => (
                  <li key={m.key} className="flex flex-wrap items-center gap-x-2">
                    <span>{m.text}</span>
                    {m.action && (m.action.href
                      ? <Link href={m.action.href} className="font-semibold text-accent-ink underline">{m.action.label}</Link>
                      : <button type="button" className="min-h-8 font-semibold text-accent-ink underline" onClick={m.action.onClick}>{m.action.label}</button>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {p.canEdit && !completed && <Button size="sm" variant="secondary" onClick={() => setEditPeople(!editPeople)} aria-expanded={editPeople} data-testid="edit-people"><UserCog className="h-4 w-4" aria-hidden /> Change people</Button>}
          {p.canPublish && !completed && <Link href={`/projects/${p.id}/update`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-sm font-semibold"><MessageSquare className="h-4 w-4" aria-hidden /> Update customer</Link>}
          {p.canEdit && !completed && <Button size="sm" variant="secondary" onClick={() => setClosing(!closing)} aria-expanded={closing} data-testid="closeout-open" id="closeout"><CheckCircle2 className="h-4 w-4" aria-hidden /> Close out project</Button>}
          {p.canEdit && completed && <Button size="sm" variant="secondary" onClick={() => closeout("reopen")} disabled={busy}><RotateCcw className="h-4 w-4" aria-hidden /> Reopen</Button>}
        </div>

        {editPeople && (
          <div className="mt-3 grid gap-2 rounded-lg bg-paper p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="people-form">
            <label><span className="label">Sold by (salesperson)</span>
              <select className="field" value={rep} onChange={(e) => setRep(e.target.value)}><option value="">Not assigned</option>{p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label><span className="label">Project manager</span>
              <select className="field" value={pm} onChange={(e) => setPm(e.target.value)} data-testid="pm-select"><option value="">Not assigned</option>{p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <Button size="sm" onClick={savePeople} disabled={busy} data-testid="save-people">Save</Button>
            <p className="text-xs text-muted sm:col-span-3">The salesperson and project manager are separate roles. Assigning a PM doesn&apos;t give them access to internal costs.</p>
          </div>
        )}

        {closing && (
          <div className="mt-3 space-y-2 rounded-lg bg-paper p-3" data-testid="closeout-form">
            <p className="font-semibold text-navy">Before you close out</p>
            <ul className="list-disc pl-5 text-sm text-ink-soft">
              <li>{p.openTasks === 0 ? "Every task is marked complete." : <strong className="text-warn">{p.openTasks} task{p.openTasks === 1 ? " isn't" : "s aren't"} marked complete.</strong>}</li>
              <li>{p.lastUpdateAt ? `Customer last updated ${formatDay(p.lastUpdateAt.slice(0, 10), { month: "short", day: "numeric" })}.` : "No customer update has been sent."}</li>
              <li>Payment isn&apos;t required to close the schedule.</li>
            </ul>
            <label className="block max-w-xs"><span className="label">Actual completion date</span><input type="date" className="field" value={finish} min={p.startDate} onChange={(e) => setFinish(e.target.value)} data-testid="closeout-date" /></label>
            {p.openTasks > 0 && <label className="block"><span className="label">Reason for closing with unfinished tasks</span><input className="field" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer removed the flooring scope" data-testid="closeout-reason" /></label>}
            <div className="flex gap-2">
              <Button size="sm" variant="accent" onClick={() => closeout("complete")} disabled={busy || !isIsoDate(finish) || (p.openTasks > 0 && reason.trim().length < 3)} data-testid="closeout-confirm">Mark project complete</Button>
              <Button size="sm" variant="secondary" onClick={() => setClosing(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted">Unfinished tasks stay as they are. Completed projects leave the Active list but keep their history.</p>
          </div>
        )}
        {msg && <Notice tone={msg.ok ? "ok" : "danger"} className="mt-3">{msg.text}</Notice>}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="flex items-center gap-1.5 font-semibold text-navy"><FileText className="h-4 w-4" aria-hidden /> Documents</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {p.signatureId && <li><Link className="font-semibold text-accent-ink underline" href={`/signed/${p.signatureId}`}>Signed agreement</Link></li>}
            {p.canEdit && <li><Link className="font-semibold text-accent-ink underline" href={`/estimates/${p.estimateId}`}>Original bid and proposal</Link></li>}
            <li><Link className="font-semibold text-accent-ink underline" href={`/projects/${p.id}/update`}>Customer updates</Link> <span className="text-muted">(preview, PDF, send)</span></li>
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4" data-testid="activity">
          <h2 className="flex items-center gap-1.5 font-semibold text-navy"><History className="h-4 w-4" aria-hidden /> Activity</h2>
          {p.activity.length === 0 && <p className="mt-1 text-sm text-muted">No activity yet.</p>}
          <ol className="mt-2 space-y-2">
            {activity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="text-sm">
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">{KIND_LABEL[a.kind] ?? a.kind}</span>{a.audience === "customer" && <Badge tone="accent">Customer</Badge>}
                  <span className="text-xs text-muted">{new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{a.actor ? ` · ${nameOf(a.actor)}` : ""}</span></span>
                <span className="block text-ink-soft">{a.summary}</span>
              </li>
            ))}
          </ol>
          {p.activity.length > 3 && <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-accent-ink md:min-h-8" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : `Show all ${p.activity.length}`}</button>}
        </div>
      </div>
    </section>
  );
}
