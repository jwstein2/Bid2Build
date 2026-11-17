"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, HardHat, Mail, Pencil, Phone, Plus, RotateCcw, Search, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { KIND_LABEL, tradeLabel, type ResourceKind, type Team, type TeamResource } from "@/lib/projects/team";
import { ResourceForm } from "./resource-form";

const ICON = { staff: User, subcontractor: HardHat, crew: Users } as const;

/**
 * Team & Subcontractors: staff (optionally linked to a company member), subcontractors and crews.
 * Subcontractors never get a login. Contact buttons copy or open the user's own email/phone app;
 * Built2Bid sends nothing.
 */
export function TeamDirectory({ team, people, me, usage }: {
  team: Team; people: { id: string; name: string }[]; me: string | null;
  /** Open (not complete) task count per resource id, for "currently booked" hints. */
  usage: Record<string, number>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ResourceKind | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TeamResource | "new" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const byId = useMemo(() => new Map(team.resources.map((r) => [r.id, r])), [team.resources]);

  const list = team.resources.filter((r) => (showArchived ? r.status === "archived" : r.status === "active"))
    .filter((r) => kind === "all" || r.kind === kind)
    .filter((r) => { const s = q.trim().toLowerCase(); return !s || [r.name, r.contactName, r.email, r.phone, ...r.trades].some((x) => x?.toLowerCase().includes(s)); });
  const counts = { staff: 0, subcontractor: 0, crew: 0 };
  for (const r of team.resources) if (r.status === "active") counts[r.kind]++;

  async function setStatus(r: TeamResource, status: "active" | "archived") {
    setMsg(null);
    const res = await api(`/api/team/${r.id}`, { method: "POST", body: JSON.stringify({ status }) });
    if (!res.ok) { setMsg({ ok: false, text: res.message }); return; }
    setMsg({ ok: true, text: status === "archived" ? `${r.name} archived. Past assignments are kept.` : `${r.name} restored.` });
    router.refresh();
  }
  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { setMsg({ ok: false, text: "Couldn't copy. Select the text instead." }); }
  }

  return (
    <div className="space-y-4" data-testid="team-directory" data-guide="team.directory">
      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        {(Object.keys(counts) as ResourceKind[]).map((k) => {
          const Icon = ICON[k];
          return <div key={k} className="rounded-xl border border-line bg-surface p-3"><p className="flex items-center gap-1.5 text-xs text-muted"><Icon className="h-3.5 w-3.5" aria-hidden />{KIND_LABEL[k]}{k === "crew" ? "s" : k === "staff" ? "" : "s"}</p><p className="text-xl font-extrabold text-navy">{counts[k]}</p></div>;
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field h-10 pl-9" placeholder="Search name, trade, phone" value={q} onChange={(e) => setQ(e.target.value)} data-testid="team-search" /></label>
        <label><span className="sr-only">Type</span>
          <select className="field h-10 py-0 text-sm" value={kind} onChange={(e) => setKind(e.target.value as ResourceKind | "all")} data-testid="team-kind">
            <option value="all">Everyone</option><option value="staff">Staff</option><option value="subcontractor">Subcontractors</option><option value="crew">Crews</option>
          </select></label>
        <Button size="sm" variant="secondary" className="min-h-10" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}>{showArchived ? "Show active" : "Show archived"}</Button>
        {team.canManage && <Button size="sm" variant="accent" className="min-h-10" onClick={() => setEditing("new")} data-testid="team-add" data-guide="team.add"><Plus className="h-4 w-4" aria-hidden /> Add</Button>}
      </div>
      {!team.canManage && <Notice>You can view this list. Ask your company admin if you need to add or change someone.</Notice>}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}

      {editing && (
        <ResourceForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} resources={team.resources} people={people} me={me} companyMode={!!team.companyId}
          onCancel={() => setEditing(null)} onSaved={(name) => { setEditing(null); setMsg({ ok: true, text: `${name} saved.` }); router.refresh(); }} />
      )}

      {list.length === 0 && !editing && (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted" data-testid="team-empty">
          {team.resources.length === 0
            ? <>Add the people and companies who do your work: your own staff, subcontractors (no login needed) and crews. Then assign them in Schedule Now or from any task.</>
            : "No one matches."}
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((r) => {
          const Icon = ICON[r.kind];
          const members = r.members.map((m) => byId.get(m)?.name).filter(Boolean);
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4" data-testid="team-card">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-navy"><Icon className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">{r.name} <Badge>{KIND_LABEL[r.kind]}</Badge>
                    {r.linkedUserId && <Badge tone="accent">{r.linkedUserId === me ? "You" : "Team member"}</Badge>}
                    {r.status === "archived" && <Badge tone="warn">Archived</Badge>}</p>
                  {r.contactName && <p className="text-sm text-ink-soft">Contact: {r.contactName}</p>}
                  {r.trades.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{r.trades.map((t) => <span key={t} className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{tradeLabel(t)}</span>)}</p>}
                  {r.kind === "crew" && <p className="mt-1 text-sm text-ink-soft">{members.length ? `Members: ${members.join(", ")}` : "No members listed"}{r.capacity > 1 ? ` · Can run ${r.capacity} jobs at once` : ""}</p>}
                  {usage[r.id] ? <p className="mt-1 text-xs text-muted">{usage[r.id]} open task{usage[r.id] === 1 ? "" : "s"} assigned</p> : null}
                  {r.unavailable.length > 0 && <p className="mt-1 text-xs text-muted">{r.unavailable.length} day{r.unavailable.length === 1 ? "" : "s"} marked unavailable</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
                {r.phone && <>
                  <a href={`tel:${r.phone}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Phone className="h-4 w-4" aria-hidden />{r.phone}</a>
                  <button type="button" onClick={() => copy(r.phone!, `${r.id}-p`)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-ink-soft hover:bg-paper" aria-label={`Copy phone for ${r.name}`}><Copy className="h-4 w-4" aria-hidden />{copied === `${r.id}-p` ? "Copied" : ""}</button>
                </>}
                {r.email && <>
                  <a href={`mailto:${r.email}`} className="inline-flex min-h-9 min-w-0 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Mail className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{r.email}</span></a>
                  <button type="button" onClick={() => copy(r.email!, `${r.id}-e`)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-ink-soft hover:bg-paper" aria-label={`Copy email for ${r.name}`} data-testid="copy-email"><Copy className="h-4 w-4" aria-hidden />{copied === `${r.id}-e` ? "Copied" : ""}</button>
                </>}
                {team.canManage && <span className="ml-auto flex gap-1">
                  {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`} data-testid="team-edit"><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
                  {r.status === "active"
                    ? <Button size="sm" variant="ghost" onClick={() => setStatus(r, "archived")} aria-label={`Archive ${r.name}`}><Archive className="h-4 w-4" aria-hidden /></Button>
                    : <Button size="sm" variant="ghost" onClick={() => setStatus(r, "active")}><RotateCcw className="h-4 w-4" aria-hidden /> Restore</Button>}
                </span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">Subcontractors don&apos;t get a Built2Bid login. Nothing is emailed or texted automatically: use the buttons to call, copy, or open your own email app.</p>
    </div>
  );
}
