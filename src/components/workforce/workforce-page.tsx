"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, LayoutGrid, ListChecks, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatRange } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import {
  allTrades, buildEntries, conflictsFor, DEFAULT_DIR_FILTERS, filterEntries, isSection, LIFECYCLE_LABEL, LIFECYCLE_TONE, lifecycleOf, matchesQuery, sectionCounts, SECTIONS, SORTS,
  type DirFilters, type Lifecycle, type Section, type SortKey, type WfResource, type Workforce,
} from "@/lib/workforce/model";
import { WorkforceCard } from "./card";
import { WorkforceProfile } from "./profile";
import { AssignDialog } from "./assign-dialog";
import { WorkforceForm } from "./form";

type View = "directory" | "assignments";

/**
 * PM Hub → Contractors & Workforce. Cards over the same directory and assignments PM Hub uses; assigning
 * here updates the project schedule (one record), and changes made in PM Hub show up here (realtime +
 * refresh on focus).
 */
export function WorkforcePage({ wf, today, people, initial }: {
  wf: Workforce; today: string; people: { id: string; name: string }[];
  initial: { q?: string; section?: string; open?: string; assignProject?: string; view?: string };
}) {
  const router = useRouter();
  const [f, setF] = useState<DirFilters>({ ...DEFAULT_DIR_FILTERS, q: initial.q ?? "", section: isSection(initial.section) ? initial.section : "all" });
  const [view, setView] = useState<View>(initial.view === "assignments" ? "assignments" : "directory");
  const [openId, setOpenId] = useState<string | null>(initial.open ?? null);
  const [assign, setAssign] = useState<{ people: WfResource[]; project: string | null } | null>(null);
  const [form, setForm] = useState<{ initial: WfResource | null; parent?: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const entries = useMemo(() => buildEntries(wf, today), [wf, today]);
  const list = useMemo(() => filterEntries(entries, f), [entries, f]);
  const counts = useMemo(() => sectionCounts(entries, f.archived), [entries, f.archived]);
  const trades = useMemo(() => allTrades(wf), [wf]);
  const workerCount = useMemo(() => { const m = new Map<string, number>(); for (const r of wf.resources) if (r.parentId && r.status === "active") m.set(r.parentId, (m.get(r.parentId) ?? 0) + 1); return m; }, [wf.resources]);
  const conflictTotal = entries.filter((e) => e.r.status === "active" && e.s.conflicts > 0).length;
  const open = openId ? wf.resources.find((r) => r.id === openId) ?? null : null;

  // Keep the search in the URL (shareable, back button), without a server round trip.
  useEffect(() => {
    const u = new URL(window.location.href);
    for (const [k, v] of [["q", f.q], ["section", f.section === "all" ? "" : f.section], ["view", view === "directory" ? "" : view], ["open", openId ?? ""]] as const) if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    u.searchParams.delete("assignProject");
    window.history.replaceState(null, "", u.toString());
  }, [f.q, f.section, view, openId]);

  // From a project page: "Assign people" opens the flow with that project chosen.
  const presetDone = useRef(false);
  useEffect(() => {
    if (presetDone.current || !initial.assignProject) return;
    presetDone.current = true;
    const first = wf.resources.find((r) => r.status === "active");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time open from a deep link
    if (first && wf.canManage) setAssign({ people: [first], project: initial.assignProject });
  }, [initial.assignProject, wf.resources, wf.canManage]);

  // PM Hub changes show up here: realtime when available, and on returning to the tab.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => router.refresh(), 600); };
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    const sb = getBrowserClient();
    const ch = sb?.channel("workforce-assignments").on("postgres_changes", { event: "INSERT", schema: "public", table: "pm_assignment_events" }, refresh).subscribe();
    return () => { document.removeEventListener("visibilitychange", onFocus); if (t) clearTimeout(t); if (ch) sb?.removeChannel(ch); };
  }, [router]);

  const set = (p: Partial<DirFilters>) => setF((x) => ({ ...x, ...p }));
  const noOne = wf.resources.length === 0;

  return (
    <div className="space-y-4" data-testid="workforce">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "directory"} onClick={() => setView("directory")} className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${view === "directory" ? "bg-navy text-white" : "text-ink-soft"}`} data-testid="wf-view-directory"><LayoutGrid className="h-4 w-4" aria-hidden />Directory</button>
          <button type="button" role="tab" aria-selected={view === "assignments"} onClick={() => setView("assignments")} className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${view === "assignments" ? "bg-navy text-white" : "text-ink-soft"}`} data-testid="wf-view-assignments" data-guide="workforce.assignments-tab"><ListChecks className="h-4 w-4" aria-hidden />Assignments</button>
        </div>
        {conflictTotal > 0 && <button type="button" onClick={() => { setView("directory"); set({ q: "", section: "all", availability: "all", assigned: "assigned", sort: "next" }); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-danger-tint px-3 text-sm font-semibold text-danger" data-testid="wf-conflict-banner"><AlertTriangle className="h-4 w-4" aria-hidden />{conflictTotal} with scheduling conflicts</button>}
        {wf.canManage && <Button size="sm" variant="accent" className="ml-auto min-h-10" onClick={() => setForm({ initial: null })} data-testid="wf-add" data-guide="workforce.add"><Plus className="h-4 w-4" aria-hidden /> Add</Button>}
      </div>
      {!wf.canManage && <Notice>You can view this directory. Ask your company admin to add people or change assignments.</Notice>}
      {msg && <Notice tone="ok">{msg}</Notice>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-0 flex-1 basis-64"><span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" className="field h-11 pl-9" placeholder="Search name, company, trade, project or customer" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid="wf-search" data-guide="workforce.search" /></label>
        {view === "directory" && <>
          <label><span className="sr-only">Trade</span>
            <select className="field h-11 py-0 text-sm" value={f.trade} onChange={(e) => set({ trade: e.target.value })} data-testid="wf-trade">
              <option value="all">All trades</option>{trades.map((t) => <option key={t} value={t}>{tradeLabel(t)}</option>)}
            </select></label>
          <label><span className="sr-only">Availability</span>
            <select className="field h-11 py-0 text-sm" value={f.availability} onChange={(e) => set({ availability: e.target.value as DirFilters["availability"] })} data-testid="wf-avail">
              <option value="all">Any availability</option><option value="available">Available</option><option value="partial">Has room / part booked</option><option value="busy">Booked</option><option value="unknown">Capacity unknown</option><option value="off">Off today</option>
            </select></label>
          <label><span className="sr-only">Sort</span>
            <select className="field h-11 py-0 text-sm" value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} data-testid="wf-sort">
              {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select></label>
        </>}
      </div>

      {view === "directory" && <>
        <nav aria-label="Directory sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max gap-1 border-b border-line">
            {SECTIONS.map((s) => (
              <li key={s.key}><button type="button" onClick={() => set({ section: s.key as Section })} aria-current={f.section === s.key ? "page" : undefined} data-testid={`wf-section-${s.key}`}
                className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${f.section === s.key ? "border-accent-ink text-navy" : "border-transparent text-ink-soft hover:text-navy"}`}>
                <span className="sm:hidden">{s.short}</span><span className="max-sm:hidden">{s.label}</span><span className="rounded-full bg-paper px-1.5 text-xs">{counts[s.key as Section]}</span></button></li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.assigned === "assigned"} onChange={(e) => set({ assigned: e.target.checked ? "assigned" : "all" })} />Only with assignments</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.archived} onChange={(e) => set({ archived: e.target.checked })} />Show archived</label>
          <span className="text-muted" aria-live="polite" data-testid="wf-count">{list.length} shown</span>
        </div>

        {noOne ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center" data-testid="wf-empty">
            <p className="font-semibold text-navy">Add the people and companies who do your work</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">Subcontracting companies and their workers, individual subs, your employees and crews. Subcontractors don&apos;t need a Built2Bid account. Then assign them to projects right from their card.</p>
            {wf.canManage && <Button className="mt-3" variant="accent" onClick={() => setForm({ initial: null })}><Plus className="h-4 w-4" aria-hidden /> Add the first one</Button>}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted" data-testid="wf-nomatch">No one matches. <button type="button" className="font-semibold text-accent-ink underline" onClick={() => setF({ ...DEFAULT_DIR_FILTERS })}>Clear filters</button></div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-guide="workforce.cards">
            {list.map((e) => <WorkforceCard key={e.r.id} e={e} workers={workerCount.get(e.r.id) ?? 0} canAssign={wf.canManage} onOpen={() => setOpenId(e.r.id)} onAssign={() => setAssign({ people: [e.r], project: null })} />)}
          </ul>
        )}
      </>}

      {view === "assignments" && <AssignmentsList wf={wf} today={today} q={f.q} onOpen={setOpenId} />}

      <p className="text-xs text-muted">Same people and assignments as <Link href="/projects" className="underline">Projects</Link> and <Link href="/projects/team" className="underline">Team &amp; Subcontractors</Link>. Nothing here sends messages, creates logins or adds paid seats.</p>

      {open && <WorkforceProfile key={open.id} wf={wf} r={open} today={today} open onOpenChange={(o) => { if (!o) setOpenId(null); }}
        onAssign={() => setAssign({ people: [open], project: null })} onEdit={() => setForm({ initial: open })} onOpenOther={setOpenId} />}
      {assign && <AssignDialog key={assign.people.map((p) => p.id).join(",") + (assign.project ?? "")} wf={wf} initial={assign.people} presetProjectId={assign.project} open
        onOpenChange={(o) => { if (!o) setAssign(null); }} onDone={() => router.refresh()} />}
      {form && <WorkforceForm key={form.initial?.id ?? "new"} wf={wf} initial={form.initial} presetParent={form.parent} people={people} open
        onOpenChange={(o) => { if (!o) setForm(null); }} onSaved={(name) => { setForm(null); setMsg(`${name} saved.`); router.refresh(); }} />}
    </div>
  );
}

/** Every assignment in one list, grouped by status. Same records the project schedules show. */
function AssignmentsList({ wf, today, q, onOpen }: { wf: Workforce; today: string; q: string; onOpen: (id: string) => void }) {
  const [life, setLife] = useState<Lifecycle | "live">("live");
  const byId = new Map(wf.resources.map((r) => [r.id, r]));
  const rows = wf.assignments.map((a) => ({ a, l: lifecycleOf(a, today), r: byId.get(a.resourceId) }))
    .filter((x) => x.r && (life === "live" ? x.l !== "completed" && x.l !== "cancelled" : x.l === life))
    .filter((x) => matchesQuery([x.a.project, x.a.customer, x.a.task, x.a.trade, x.r!.name, ...x.r!.trades].filter(Boolean).join(" ").toLowerCase(), q))
    .sort((x, y) => x.a.start.localeCompare(y.a.start));
  // Conflicts per resource, to flag rows.
  const conflicted = useMemo(() => {
    const out = new Set<string>();
    for (const r of wf.resources) if (r.status === "active") for (const c of conflictsFor(wf, r, today)) for (const b of c.bookings) out.add(b.taskId);
    return out;
  }, [wf, today]);
  return (
    <div className="space-y-3" data-testid="wf-assignments">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
        {(["live", "planned", "confirmed", "in_progress", "completed", "cancelled"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={life === k} onClick={() => setLife(k)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${life === k ? "border-navy bg-navy text-white" : "border-line text-ink-soft"}`}>{k === "live" ? "Open" : LIFECYCLE_LABEL[k]}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No assignments here yet.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map(({ a, l, r }) => (
            <li key={a.taskId} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="wf-assignment-row">
              <div className="min-w-0">
                <p className="font-semibold text-navy"><button type="button" className="hover:underline" onClick={() => onOpen(r!.id)}>{r!.name}</button> <span className="font-normal text-ink-soft">on</span> <Link href={`/projects/${a.scheduleId}`} className="hover:underline">{a.project}</Link></p>
                <p className="text-xs text-ink-soft">{[a.customer, a.task, a.trade ? tradeLabel(a.trade) : null].filter(Boolean).join(" · ")} · {formatRange(a.start, a.end)}{a.startTime && a.endTime ? ` · ${a.startTime}–${a.endTime}` : ""}{a.hours ? ` · ${a.hours} h` : ""}</p>
              </div>
              <span className="flex items-center gap-2">{conflicted.has(a.taskId) && <AlertTriangle className="h-4 w-4 text-danger" aria-label="Conflict" />}<Badge tone={LIFECYCLE_TONE[l]}>{LIFECYCLE_LABEL[l]}</Badge></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
