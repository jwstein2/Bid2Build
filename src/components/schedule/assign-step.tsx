"use client";
import { useState } from "react";
import Link from "next/link";
import { HardHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { formatRange } from "@/lib/schedule/calendar";
import type { PlannedSection } from "@/lib/schedule/engine";
import { ASSIGNMENT_STATUSES, suggestFor, type Team, type TeamResource } from "@/lib/projects/team";
import type { AssignmentStatus } from "@/lib/projects/workspace";
import { ResourceForm } from "@/components/projects/resource-form";

export interface SectionAssignment { resourceId: string | null; status: AssignmentStatus }

/**
 * Schedule Now step 8: who's doing each section. Optional. Trade matches are suggested first; anyone can
 * be picked; a new subcontractor or crew can be added without leaving the wizard. Tasks inside a section
 * follow its assignment until a task gets its own. Nobody is notified.
 */
export function AssignStep({ sections, plan, tradeLabels, team, people, me, value, onChange }: {
  sections: { id: string; name: string; trade: string | null }[];
  plan: Pick<PlannedSection, "key" | "plannedStart" | "plannedEnd">[];
  tradeLabels: Record<string, string>; team: Team | null; people: { id: string; name: string }[]; me: string | null;
  value: Record<string, SectionAssignment>; onChange: (v: Record<string, SectionAssignment>) => void;
}) {
  const [added, setAdded] = useState<TeamResource[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  if (!team) return <Notice className="mt-3">Assigning crews and subcontractors will be available here once Team &amp; Subcontractors is set up. You can skip this step.</Notice>;
  const all = [...team.resources, ...added];
  const set = (id: string, patch: Partial<SectionAssignment>) => onChange({ ...value, [id]: { ...(value[id] ?? { resourceId: null, status: "tentative" }), ...patch } });

  return (
    <div className="mt-3 space-y-3" data-testid="assign-step">
      <p className="text-sm text-ink-soft">Optional. Pick who&apos;s doing each section. Tasks inside a section follow it unless you assign a task separately later. Nobody is notified.</p>
      {all.filter((r) => r.status === "active").length === 0 && !adding && (
        <Notice>Your Team &amp; Subcontractors list is empty. {team.canManage ? "Add someone below, or skip this step." : "You can skip this step."}</Notice>
      )}
      {sections.map((s) => {
        const p = plan.find((x) => x.key === s.id);
        const tl = s.trade ? tradeLabels[s.trade] ?? s.trade : null;
        const { match, others } = suggestFor(all, tl ?? s.trade, s.name);
        const v = value[s.id];
        return (
          <div key={s.id} className="rounded-lg border border-line p-3" data-testid={`assign-${s.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-navy">{s.name}</p>
              <p className="text-xs text-muted">{tl ? `${tl} · ` : ""}{p ? formatRange(p.plannedStart, p.plannedEnd) : ""}</p>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <label><span className="sr-only">Who&apos;s doing {s.name}</span>
                <select className="field" value={v?.resourceId ?? ""} onChange={(e) => set(s.id, { resourceId: e.target.value || null })} data-testid="assign-step-select">
                  <option value="">Not assigned yet</option>
                  {match.length > 0 && <optgroup label={`Suggested${tl ? ` for ${tl}` : ""}`}>{match.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
                  {others.length > 0 && <optgroup label={match.length ? "Everyone else" : "Team & Subcontractors"}>{others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
                </select></label>
              <label><span className="sr-only">Status for {s.name}</span>
                <select className="field" value={v?.status ?? "tentative"} disabled={!v?.resourceId} onChange={(e) => set(s.id, { status: e.target.value as AssignmentStatus })}>
                  {ASSIGNMENT_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select></label>
              {team.canManage && <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setAdding(adding === s.id ? null : s.id)} data-testid="assign-step-add"><Plus className="h-4 w-4" aria-hidden /> New</Button>}
            </div>
            {match.length === 0 && tl && all.length > 0 && <p className="mt-1 text-xs text-muted">No one in your list has {tl} as a trade yet.</p>}
            {adding === s.id && (
              <div className="mt-2">
                <ResourceForm compact initial={null} resources={all} people={people} me={me} companyMode={!!team.companyId} defaultTrade={tl}
                  onCancel={() => setAdding(null)}
                  onSaved={(name, id) => {
                    setAdded([...added, { id, name, kind: "subcontractor", contactName: null, linkedUserId: null, trades: tl ? [tl.toLowerCase()] : [], email: null, phone: null, notes: null, capacity: 1, unavailable: [], status: "active", members: [] }]);
                    setAdding(null); set(s.id, { resourceId: id });
                  }} />
              </div>
            )}
          </div>
        );
      })}
      <p className="flex items-center gap-1.5 text-xs text-muted"><HardHat className="h-3.5 w-3.5" aria-hidden /> Manage everyone in <Link href="/projects/team" className="font-semibold text-accent-ink underline" target="_blank">Team &amp; Subcontractors</Link>.</p>
    </div>
  );
}
