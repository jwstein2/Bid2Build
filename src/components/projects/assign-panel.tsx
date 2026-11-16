"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, HardHat, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/components/schedule/client";
import { formatRange } from "@/lib/schedule/calendar";
import { ASSIGNMENT_STATUSES, assignmentNotice, busyElsewhere, suggestFor, type Team } from "@/lib/projects/team";
import type { AssignmentStatus, WsProject, WsTask } from "@/lib/projects/workspace";
import { loadFull } from "./edit";
import { ResourceForm } from "./resource-form";

/**
 * "Who's doing this?" inside the task drawer: pick from Team & Subcontractors (trade matches first),
 * set the status, quick-add someone new, and draft a notice for the user's own email app. Saves through
 * the revision-checked assign API; never sends anything.
 */
export function AssignPanel({ task, project, team, tasks, people, me, myName, onSaved }: {
  task: WsTask; project: WsProject; team: Team; tasks: WsTask[]; people: { id: string; name: string }[]; me: string | null; myName: string; onSaved: () => void;
}) {
  const [resourceId, setResourceId] = useState(task.resourceId ?? "");
  const [status, setStatus] = useState<AssignmentStatus>(task.assignmentStatus ?? "tentative");
  const [adding, setAdding] = useState(false);
  const [extraRes, setExtraRes] = useState<Team["resources"]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const all = useMemo(() => [...team.resources, ...extraRes], [team.resources, extraRes]);
  const { match, others } = suggestFor(all, task.trade, task.name);
  const chosen = all.find((r) => r.id === resourceId) ?? null;
  const busyList = chosen ? busyElsewhere(tasks, chosen.id, project.id, task.plannedStart, task.plannedEnd) : [];
  const changed = resourceId !== (task.resourceId ?? "") || (resourceId !== "" && status !== (task.assignmentStatus ?? "tentative"));
  const notice = chosen ? assignmentNotice({ resource: chosen, project: project.name, work: task.name, start: task.plannedStart, end: task.plannedEnd, sender: myName || "Thanks" }) : null;

  async function save() {
    setBusy(true); setMsg(null);
    const full = await loadFull(project.id);
    if (!full.ok) { setBusy(false); setMsg({ ok: false, text: full.message }); return; }
    const r = await api(`/api/projects/${project.id}/assign`, { method: "POST", body: JSON.stringify({
      baseRevision: full.data.schedule.revision, items: [{ taskId: task.id, resourceId: resourceId || null, status: resourceId ? status : null }],
      summary: resourceId ? `Assigned ${chosen?.name ?? "someone"} to ${task.name} (${status})` : `Cleared assignment on ${task.name}`,
    }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: resourceId ? "Assignment saved. Nothing was sent: use Draft notice to let them know." : "Assignment cleared." });
    onSaved();
  }
  async function copyNotice() {
    if (!notice) return;
    try { await navigator.clipboard.writeText(`${notice.subject}\n\n${notice.body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  if (!project.permissions.edit) return null;
  return (
    <section className="rounded-lg border border-line p-3" aria-labelledby="assign-h" data-testid="assign-panel">
      <h3 id="assign-h" className="flex items-center gap-1.5 font-semibold text-navy"><HardHat className="h-4 w-4" aria-hidden /> Who&apos;s doing this?</h3>
      {task.parentId && <p className="mt-0.5 text-xs text-muted">Choosing someone here overrides the section&apos;s assignment for this task only.</p>}
      <div className="mt-2 grid gap-2 min-[380px]:grid-cols-[1fr_auto]">
        <label><span className="sr-only">Assigned to</span>
          <select className="field" value={resourceId} onChange={(e) => setResourceId(e.target.value)} data-testid="assign-select">
            <option value="">Not assigned{task.assignee && !task.resourceId ? ` (was "${task.assignee}")` : ""}</option>
            {match.length > 0 && <optgroup label="Suggested">{match.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={match.length ? "Everyone else" : "Team & Subcontractors"}>{others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
          </select></label>
        <label><span className="sr-only">Status</span>
          <select className="field" value={status} disabled={!resourceId} onChange={(e) => setStatus(e.target.value as AssignmentStatus)} data-testid="assign-status">
            {ASSIGNMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select></label>
      </div>
      {resourceId && <p className="mt-1 text-xs text-muted">{ASSIGNMENT_STATUSES.find((s) => s.value === status)?.hint}</p>}
      {busyList.length > 0 && (
        <p className="mt-1 text-xs font-semibold text-warn" data-testid="assign-busy">Also booked then: {busyList.slice(0, 3).map((b) => `${b.name} (${formatRange(b.plannedStart, b.plannedEnd)})`).join(", ")}{busyList.length > 3 ? "…" : ""}. You can still assign them.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={busy || !changed} data-testid="assign-save">{busy ? "Saving…" : "Save assignment"}</Button>
        {team.canManage && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)} data-testid="assign-quick-add"><Plus className="h-4 w-4" aria-hidden /> New contact</Button>}
      </div>
      {adding && (
        <div className="mt-2">
          <ResourceForm compact initial={null} resources={all} people={people} me={me} companyMode={!!team.companyId} defaultTrade={task.trade}
            onCancel={() => setAdding(false)}
            onSaved={(name, id) => { setAdding(false); setExtraRes([...extraRes, { id, name, kind: "subcontractor", contactName: null, linkedUserId: null, trades: task.trade ? [task.trade.toLowerCase()] : [], email: null, phone: null, notes: null, capacity: 1, unavailable: [], status: "active", members: [] }]); setResourceId(id); }} />
        </div>
      )}
      {chosen && notice && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
          <span className="text-xs text-muted">Let them know (from your own email):</span>
          {notice.mailto && <a href={notice.mailto} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold" data-testid="assign-mailto"><Mail className="h-4 w-4" aria-hidden /> Draft notice</a>}
          <button type="button" onClick={copyNotice} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-ink-soft hover:bg-paper" data-testid="assign-copy"><Copy className="h-4 w-4" aria-hidden />{copied ? "Copied" : "Copy message"}</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      {all.length === 0 && !adding && <p className="mt-2 text-xs text-muted">No one in <Link href="/projects/team" className="font-semibold text-accent-ink underline">Team &amp; Subcontractors</Link> yet.</p>}
    </section>
  );
}
