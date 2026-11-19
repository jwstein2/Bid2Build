/**
 * V7.3 Contractors & Workforce: pure helpers for the directory, the profile and the assign flow.
 * Reads the same rows as PM Hub (pm_resources + schedule_tasks via pm_workforce), so nothing here is a
 * second source of truth. No I/O. Unit tested in tests/workforce.test.ts.
 */
import { addDays } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import type { AssignmentStatus } from "@/lib/projects/workspace";

export type WfKind = "staff" | "subcontractor" | "crew";
export type WfStatus = AssignmentStatus | "cancelled";
export interface WfResource {
  id: string; kind: WfKind; name: string; contactName: string | null; linkedUserId: string | null;
  trades: string[]; specialties: string[]; email: string | null; phone: string | null; contactHidden: boolean; notes: string | null;
  capacity: number; capacityDeclared: boolean; crewSize: number | null; unavailable: string[]; status: "active" | "archived";
  entity: "company" | "individual" | null; parentId: string | null; members: string[]; createdAt: string | null;
}
export interface WfAssignment {
  taskId: string; scheduleId: string; parentId: string | null; kind: "section" | "item"; task: string; start: string; end: string;
  taskStatus: string; percent: number; resourceId: string; status: WfStatus | null; inherited: boolean;
  notes: string | null; hours: number | null; startTime: string | null; endTime: string | null;
  project: string; projectStatus: string; customer: string; trade: string | null; revision: number;
}
export interface Workforce { companyId: string | null; me: string | null; canManage: boolean; resources: WfResource[]; assignments: WfAssignment[] }

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const time = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null);

export function mapWorkforce(raw: unknown): Workforce {
  const r = (raw ?? {}) as Row;
  return {
    companyId: str(r.companyId), me: str(r.me), canManage: r.canManage === true,
    resources: (Array.isArray(r.resources) ? (r.resources as Row[]) : []).map((x) => ({
      id: String(x.id), kind: (["staff", "subcontractor", "crew"].includes(String(x.kind)) ? x.kind : "staff") as WfKind,
      name: String(x.name ?? ""), contactName: str(x.contactName), linkedUserId: str(x.linkedUserId),
      trades: strs(x.trades), specialties: strs(x.specialties), email: str(x.email), phone: str(x.phone), contactHidden: x.contactHidden === true,
      notes: str(x.notes), capacity: Number(x.capacity) || 1, capacityDeclared: x.capacityDeclared === true,
      crewSize: x.crewSize == null ? null : Number(x.crewSize) || null, unavailable: strs(x.unavailable),
      status: x.status === "archived" ? "archived" : "active",
      entity: x.entity === "company" || x.entity === "individual" ? x.entity : null, parentId: str(x.parentId), members: strs(x.members), createdAt: str(x.createdAt),
    })),
    assignments: (Array.isArray(r.assignments) ? (r.assignments as Row[]) : []).map((a) => ({
      taskId: String(a.taskId), scheduleId: String(a.scheduleId), parentId: str(a.parentId), kind: a.kind === "item" ? "item" : "section",
      task: String(a.task ?? ""), start: String(a.start), end: String(a.end), taskStatus: String(a.taskStatus ?? "not_started"), percent: Number(a.percent) || 0,
      resourceId: String(a.resourceId), status: (str(a.status) as WfStatus | null) ?? null, inherited: a.inherited === true,
      notes: str(a.notes), hours: a.hours == null ? null : Number(a.hours), startTime: time(a.startTime), endTime: time(a.endTime),
      project: String(a.project ?? "Project"), projectStatus: String(a.projectStatus ?? "active"), customer: String(a.customer ?? ""),
      trade: str(a.trade), revision: Number(a.revision) || 1,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------
// Sections and labels
// ---------------------------------------------------------------------------------------------------
export type Section = "all" | "companies" | "individuals" | "employees" | "crews";
export const SECTIONS: { key: Section; label: string; short: string }[] = [
  { key: "all", label: "All", short: "All" },
  { key: "companies", label: "Subcontracting companies", short: "Companies" },
  { key: "individuals", label: "Individual subcontractors", short: "Individuals" },
  { key: "employees", label: "Employees", short: "Employees" },
  { key: "crews", label: "Crews", short: "Crews" },
];
export const isSection = (s: unknown): s is Section => SECTIONS.some((x) => x.key === s);

/** Subcontractors saved before V7.3 have no entity: they're listed with companies (the safer reading). */
export function sectionOf(r: Pick<WfResource, "kind" | "entity">): Exclude<Section, "all"> {
  if (r.kind === "staff") return "employees";
  if (r.kind === "crew") return "crews";
  return r.entity === "individual" ? "individuals" : "companies";
}

export function relationshipLabel(r: WfResource, parent: WfResource | null): string {
  if (r.kind === "staff") return r.linkedUserId ? "Employee · Built2Bid user" : "Employee";
  if (r.kind === "crew") return "Crew";
  if (parent) return `Worker at ${parent.name}`;
  return r.entity === "individual" ? "Individual subcontractor" : r.entity === "company" ? "Subcontracting company" : "Subcontractor";
}

/** How bookings are counted: a person is in one place at a time; crews and companies have capacity. */
export type BookingMode = "person" | "crew" | "company";
export const bookingMode = (r: Pick<WfResource, "kind" | "entity">): BookingMode =>
  r.kind === "crew" ? "crew" : r.kind === "staff" || r.entity === "individual" ? "person" : "company";

// ---------------------------------------------------------------------------------------------------
// Assignment lifecycle (derived from the task, so PM Hub progress shows here too)
// ---------------------------------------------------------------------------------------------------
export type Lifecycle = "planned" | "confirmed" | "in_progress" | "completed" | "cancelled";
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { planned: "Planned", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
export const LIFECYCLE_TONE: Record<Lifecycle, "neutral" | "accent" | "ok" | "warn" | "brand"> = { planned: "neutral", confirmed: "accent", in_progress: "brand", completed: "ok", cancelled: "neutral" };

export function lifecycleOf(a: Pick<WfAssignment, "status" | "taskStatus" | "projectStatus" | "start" | "end">, today: string): Lifecycle {
  if (a.status === "cancelled" || a.status === "declined") return "cancelled";
  if (a.taskStatus === "complete" || a.projectStatus === "completed") return "completed";
  if (a.taskStatus === "in_progress" || a.taskStatus === "delayed" || (a.start <= today && a.end >= today && a.status === "confirmed")) return "in_progress";
  if (a.status === "confirmed") return "confirmed";
  return "planned";
}
export const isLive = (l: Lifecycle) => l !== "completed" && l !== "cancelled";

// ---------------------------------------------------------------------------------------------------
// Who's booked on what
// ---------------------------------------------------------------------------------------------------
export interface Booking extends WfAssignment { lifecycle: Lifecycle; via: { id: string; name: string; relation: "worker" | "crew" } | null }

/**
 * Bookings that show on an entry's card and profile: its own, plus its workers' (a company) or the crews
 * it's on (a person). A crew shows its own bookings; its members' other work shows up as conflicts.
 */
export function bookingsFor(wf: Workforce, r: WfResource, today: string): Booking[] {
  const byId = new Map(wf.resources.map((x) => [x.id, x]));
  const out: Booking[] = [];
  const via = new Map<string, Booking["via"]>([[r.id, null]]);
  if (bookingMode(r) === "company") for (const w of wf.resources) if (w.parentId === r.id) via.set(w.id, { id: w.id, name: w.name, relation: "worker" });
  if (bookingMode(r) === "person") for (const c of wf.resources) if (c.kind === "crew" && c.members.includes(r.id)) via.set(c.id, { id: c.id, name: c.name, relation: "crew" });
  for (const a of wf.assignments) {
    if (!via.has(a.resourceId) || !byId.has(a.resourceId)) continue;
    out.push({ ...a, lifecycle: lifecycleOf(a, today), via: via.get(a.resourceId) ?? null });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.project.localeCompare(b.project));
}

export type AvailabilityState = "available" | "busy" | "partial" | "off" | "unknown";
export interface Availability { state: AvailabilityState; label: string; detail: string | null }

const timesOverlap = (a: { startTime: string | null; endTime: string | null }, b: { startTime: string | null; endTime: string | null }) =>
  !(a.startTime && a.endTime && b.startTime && b.endTime && (a.endTime <= b.startTime || a.startTime >= b.endTime));

/**
 * Today's availability, only from what's actually known. A company without a stated capacity is
 * "Capacity unknown" (never "unavailable" just because it has another job).
 */
export function availabilityOf(r: WfResource, bookings: Booking[], today: string): Availability {
  const live = bookings.filter((b) => isLive(b.lifecycle));
  const now = live.filter((b) => b.start <= today && b.end >= today);
  const jobsNow = new Set(now.map((b) => b.scheduleId)).size;
  const next = live.filter((b) => b.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const mode = bookingMode(r);
  if (r.unavailable.includes(today)) return { state: "off", label: "Off today", detail: null };
  if (mode === "company") {
    if (!r.capacityDeclared) return { state: "unknown", label: "Capacity unknown", detail: jobsNow ? `${jobsNow} job${jobsNow === 1 ? "" : "s"} today` : "No jobs today" };
    if (jobsNow >= r.capacity) return { state: "busy", label: "At capacity", detail: `${jobsNow} of ${r.capacity} jobs today` };
    return jobsNow ? { state: "partial", label: "Has room", detail: `${jobsNow} of ${r.capacity} jobs today` } : { state: "available", label: "Available", detail: `Up to ${r.capacity} jobs at once` };
  }
  if (mode === "crew") {
    const cap = Math.max(1, r.capacity);
    if (jobsNow >= cap) return { state: "busy", label: "Booked today", detail: cap > 1 ? `${jobsNow} of ${cap} jobs` : now[0]?.project ?? null };
    if (jobsNow) return { state: "partial", label: "Has room", detail: `${jobsNow} of ${cap} jobs today` };
  } else if (now.length) {
    const timed = now.every((b) => b.startTime && b.endTime);
    return { state: timed ? "partial" : "busy", label: timed ? "Part of today booked" : "Booked today", detail: now.map((b) => b.project).filter((x, i, a) => a.indexOf(x) === i).join(", ") };
  }
  if (next) return { state: "available", label: "Available", detail: `Next job ${next.start}` };
  return { state: "available", label: "Available", detail: null };
}

export interface CardSummary {
  active: number; upcoming: number; completed: number; projects: string[]; next: Booking | null; availability: Availability; conflicts: number;
}

export function summarize(wf: Workforce, r: WfResource, today: string): CardSummary {
  const b = bookingsFor(wf, r, today);
  const live = b.filter((x) => isLive(x.lifecycle));
  const active = live.filter((x) => x.start <= today);
  const upcoming = live.filter((x) => x.start > today);
  const next = [...live].filter((x) => x.end >= today).sort((a, c) => a.start.localeCompare(c.start))[0] ?? null;
  return {
    active: new Set(active.map((x) => x.taskId)).size,
    upcoming: new Set(upcoming.map((x) => x.taskId)).size,
    completed: new Set(b.filter((x) => x.lifecycle === "completed").map((x) => x.scheduleId)).size,
    projects: [...new Set(live.map((x) => x.project))],
    next,
    availability: availabilityOf(r, b, today),
    conflicts: conflictsFor(wf, r, today).length,
  };
}

// ---------------------------------------------------------------------------------------------------
// Conflicts (same rules as the server's pm_resource_conflicts; the server re-checks on every assign)
// ---------------------------------------------------------------------------------------------------
export interface DirConflict { kind: "double_booked" | "over_capacity" | "possible_overbooking"; from: string; to: string; bookings: Booking[] }

/**
 * Upcoming and current conflicts for one entry, each overlapping pair reported once:
 * a person on two projects at overlapping dates (and times, when both have them); a crew or a company
 * with a STATED capacity going over it. A company without a stated capacity never conflicts.
 */
export function conflictsFor(wf: Workforce, r: WfResource, today: string): DirConflict[] {
  const mode = bookingMode(r);
  if (mode === "company" && !r.capacityDeclared) return [];
  const live = bookingsFor(wf, r, today).filter((b) => isLive(b.lifecycle) && b.end >= today);
  const out: DirConflict[] = [];
  if (mode === "person") {
    const seen = new Set<string>();
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.scheduleId === b.scheduleId || a.start > b.end || b.start > a.end || !timesOverlap(a, b)) continue;
      const key = [a.scheduleId, b.scheduleId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "double_booked", from: a.start > b.start ? a.start : b.start, to: a.end < b.end ? a.end : b.end, bookings: [a, b] });
    }
    return out;
  }
  // Crews and companies: find days where distinct projects exceed capacity; merge consecutive days.
  const cap = Math.max(1, r.capacity);
  const first = live.reduce<string | null>((m, b) => (!m || b.start < m ? b.start : m), null);
  const last = live.reduce<string | null>((m, b) => (!m || b.end > m ? b.end : m), null);
  if (!first || !last) return out;
  let cur: DirConflict | null = null;
  for (let d = first < today ? today : first, n = 0; d <= last && n < 400; d = addDays(d, 1), n++) {
    const on = live.filter((b) => b.start <= d && b.end >= d);
    const jobs = new Set(on.map((b) => b.scheduleId));
    if (jobs.size > cap) {
      const sig = [...jobs].sort().join("|");
      if (cur && cur.to === addDays(d, -1) && [...new Set(cur.bookings.map((b) => b.scheduleId))].sort().join("|") === sig) cur.to = d;
      else { cur = { kind: mode === "crew" ? "over_capacity" : "possible_overbooking", from: d, to: d, bookings: on }; out.push(cur); }
    } else cur = null;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Search, filters, sorting
// ---------------------------------------------------------------------------------------------------
/** "Electrician" finds "electrical", "painter" finds "painting", "plumber" finds "plumbing". */
export function stem(w: string): string {
  const s = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const suf of ["icians", "ician", "ical", "ers", "ing", "er", "es", "s"]) if (s.length - suf.length >= 4 && s.endsWith(suf)) return s.slice(0, -suf.length);
  return s;
}
const ALIASES: Record<string, string[]> = {
  sparky: ["electrical"], carpent: ["framing", "carpentry", "trim"], carpenter: ["framing", "carpentry"], mason: ["masonry", "concrete"],
  hvac: ["hvac", "heating", "cooling"], heat: ["hvac"], cool: ["hvac"], ac: ["hvac"], sheetrock: ["drywall"], drywal: ["drywall"], tiler: ["tile"],
  handyman: ["general"], gc: ["general"], landscap: ["landscaping"], gutter: ["gutters"], deck: ["decking"], window: ["windows"], cabinet: ["cabinets"],
  countertop: ["countertops"], floor: ["flooring"], demo: ["demolition"], roof: ["roofing"], paint: ["painting"], plumb: ["plumbing"],
  pest: ["pest control"], exterminator: ["pest control"], extermin: ["pest control"], termite: ["pest control"],
};
function queryTerms(q: string): string[][] {
  return q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
    const s = stem(w);
    return [w, s, ...(ALIASES[s] ?? ALIASES[w] ?? []).map(stem)].filter((x, i, a) => x && a.indexOf(x) === i);
  });
}

/** Every word a card can be found by: names, company, trades, specialties, projects, customers, statuses. */
export function searchText(wf: Workforce, r: WfResource, today: string): string {
  const parent = r.parentId ? wf.resources.find((x) => x.id === r.parentId) : null;
  const workers = wf.resources.filter((x) => x.parentId === r.id).map((x) => x.name);
  const b = bookingsFor(wf, r, today);
  return [
    r.name, r.contactName, parent?.name, ...workers, relationshipLabel(r, parent ?? null),
    ...r.trades, ...r.trades.map(tradeLabel), ...r.specialties,
    ...b.flatMap((x) => [x.project, x.customer, x.task, x.trade, LIFECYCLE_LABEL[x.lifecycle], x.projectStatus]),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchesQuery(haystack: string, q: string): boolean {
  const terms = queryTerms(q);
  if (!terms.length) return true;
  const words = haystack.split(/[\s,·/()-]+/).filter(Boolean);
  const stems = new Set(words.map(stem));
  // Every query word must hit: as a substring of the text, or by word stem / alias.
  return terms.every((alts) => alts.some((t) => haystack.includes(t) || stems.has(t) || words.some((w) => w.length > 3 && t.length > 3 && w.startsWith(t))));
}

export type SortKey = "name" | "busiest" | "next" | "trade";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" }, { key: "busiest", label: "Most assigned" }, { key: "next", label: "Next scheduled" }, { key: "trade", label: "Primary trade" },
];
export interface DirFilters { section: Section; q: string; trade: string; availability: "all" | AvailabilityState; assigned: "all" | "assigned" | "free"; archived: boolean; sort: SortKey }
export const DEFAULT_DIR_FILTERS: DirFilters = { section: "all", q: "", trade: "all", availability: "all", assigned: "all", archived: false, sort: "name" };

export interface DirEntry { r: WfResource; parent: WfResource | null; s: CardSummary; text: string }

export function buildEntries(wf: Workforce, today: string): DirEntry[] {
  const byId = new Map(wf.resources.map((x) => [x.id, x]));
  return wf.resources.map((r) => ({ r, parent: r.parentId ? byId.get(r.parentId) ?? null : null, s: summarize(wf, r, today), text: searchText(wf, r, today) }));
}

export function filterEntries(list: DirEntry[], f: DirFilters): DirEntry[] {
  const out = list.filter((e) =>
    (f.archived ? e.r.status === "archived" : e.r.status === "active")
    && (f.section === "all" || sectionOf(e.r) === f.section)
    && (f.trade === "all" || e.r.trades.includes(f.trade))
    && (f.availability === "all" || e.s.availability.state === f.availability)
    && (f.assigned === "all" || (f.assigned === "assigned" ? e.s.active + e.s.upcoming > 0 : e.s.active + e.s.upcoming === 0))
    && matchesQuery(e.text, f.q));
  const byName = (a: DirEntry, b: DirEntry) => a.r.name.localeCompare(b.r.name);
  const sorters: Record<SortKey, (a: DirEntry, b: DirEntry) => number> = {
    name: byName,
    busiest: (a, b) => b.s.active + b.s.upcoming - (a.s.active + a.s.upcoming) || byName(a, b),
    next: (a, b) => (a.s.next?.start ?? "9999").localeCompare(b.s.next?.start ?? "9999") || byName(a, b),
    trade: (a, b) => (a.r.trades[0] ?? "zzz").localeCompare(b.r.trades[0] ?? "zzz") || byName(a, b),
  };
  return out.sort(sorters[f.sort]);
}

export function sectionCounts(list: DirEntry[], archived: boolean): Record<Section, number> {
  const c: Record<Section, number> = { all: 0, companies: 0, individuals: 0, employees: 0, crews: 0 };
  for (const e of list) if ((e.r.status === "archived") === archived) { c.all++; c[sectionOf(e.r)]++; }
  return c;
}

export const allTrades = (wf: Workforce) => [...new Set(wf.resources.filter((r) => r.status === "active").flatMap((r) => r.trades))].sort();

// ---------------------------------------------------------------------------------------------------
// Assign flow
// ---------------------------------------------------------------------------------------------------
export interface TargetTask { id: string; parentId: string | null; kind: "section" | "item"; name: string; start: string; end: string; status: string; resourceId: string | null; assignee: string | null; assignmentStatus: WfStatus | null; inherited: boolean; trade: string | null }
export interface TargetProject { id: string; name: string; status: string; revision: number; startDate: string; customer: string; canEdit: boolean; tasks: TargetTask[] }

export function mapTargets(raw: unknown): TargetProject[] {
  return (Array.isArray(raw) ? (raw as Row[]) : []).map((p) => ({
    id: String(p.id), name: String(p.name ?? "Project"), status: String(p.status ?? "active"), revision: Number(p.revision) || 1,
    startDate: String(p.startDate ?? ""), customer: String(p.customer ?? ""), canEdit: p.canEdit === true,
    tasks: (Array.isArray(p.tasks) ? (p.tasks as Row[]) : []).map((t) => ({
      id: String(t.id), parentId: str(t.parentId), kind: t.kind === "item" ? "item" : "section", name: String(t.name ?? ""), start: String(t.start), end: String(t.end),
      status: String(t.status ?? "not_started"), resourceId: str(t.resourceId), assignee: str(t.assignee),
      assignmentStatus: (str(t.assignmentStatus) as WfStatus | null) ?? null, inherited: t.inherited === true, trade: str(t.trade),
    })),
  }));
}

/** Projects matching a search (name, customer, trade, task names). Editable ones first. */
export function searchProjects(list: TargetProject[], q: string): TargetProject[] {
  const hit = list.filter((p) => matchesQuery([p.name, p.customer, ...p.tasks.flatMap((t) => [t.name, t.trade])].filter(Boolean).join(" ").toLowerCase(), q));
  return hit.sort((a, b) => Number(b.canEdit) - Number(a.canEdit) || b.startDate.localeCompare(a.startDate));
}

/**
 * Sections / tasks to offer for an entry: ones whose trade or name matches the entry's trades first,
 * unassigned before assigned. Never hides anything. Completed tasks are left out.
 */
export function rankTasks(p: TargetProject, r: Pick<WfResource, "trades">): { match: TargetTask[]; others: TargetTask[] } {
  const open = p.tasks.filter((t) => t.status !== "complete");
  const mine = r.trades.map(stem);
  const hit = (t: TargetTask) => {
    const words = [t.trade ?? "", t.name, t.parentId ? p.tasks.find((x) => x.id === t.parentId)?.trade ?? "" : ""].join(" ").toLowerCase().split(/[\s/,-]+/).map(stem);
    return mine.some((m) => m && words.some((w) => w && (w === m || w.startsWith(m) || m.startsWith(w))));
  };
  const order = (a: TargetTask, b: TargetTask) => Number(!!a.resourceId && !a.inherited) - Number(!!b.resourceId && !b.inherited) || a.start.localeCompare(b.start);
  return { match: open.filter(hit).sort(order), others: open.filter((t) => !hit(t)) };
}

/** Problems with a set of picks before anything is sent: the same task twice, or the same person twice. */
export function pickProblems(picks: { resourceId: string; taskId: string | null }[]): string[] {
  const out: string[] = [];
  const tasks = picks.map((p) => p.taskId).filter(Boolean);
  if (new Set(tasks).size !== tasks.length) out.push("Two people are on the same section. Each section or task holds one assignee (use a crew for a group).");
  if (new Set(picks.map((p) => p.resourceId)).size !== picks.length) out.push("The same person is listed twice.");
  if (picks.some((p) => !p.taskId)) out.push("Pick a section or task for everyone.");
  return out;
}

export interface ServerConflict { kind: string; resource: string; resourceId: string; days?: string[]; jobs?: number; capacity?: number; tasks: { taskId: string; project: string; task: string; start: string; end: string; via: string | null }[] }

/** Plain-language line for a server conflict. "capacity_unknown" is information, not a warning. */
export function describeConflict(c: ServerConflict): { text: string; warn: boolean } {
  const t = c.tasks ?? [];
  const where = t.map((x) => `${x.project} (${x.start === x.end ? x.start : `${x.start} to ${x.end}`}${x.via ? `, with ${x.via}` : ""})`).join("; ");
  switch (c.kind) {
    case "double_booked": return { text: `${c.resource} is already booked on ${where}.`, warn: true };
    case "unavailable": return { text: `${c.resource} marked ${(c.days ?? []).join(", ")} as unavailable.`, warn: true };
    case "over_capacity": return { text: `${c.resource} already has ${c.jobs} job${c.jobs === 1 ? "" : "s"} at that time (capacity ${c.capacity}).`, warn: true };
    case "possible_overbooking": return { text: `${c.resource} already has ${c.jobs} job${c.jobs === 1 ? "" : "s"} at that time. Their stated capacity is ${c.capacity}, so this may overbook them.`, warn: true };
    case "capacity_unknown": return { text: `${c.resource} has ${c.jobs} other job${c.jobs === 1 ? "" : "s"} at that time. Their capacity isn't set, so we can't tell if they're overbooked.`, warn: false };
    default: return { text: `${c.resource}: possible scheduling conflict.`, warn: true };
  }
}
