/**
 * Team & Subcontractors (V4.2): pure helpers shared by the directory page, the Schedule Now assign step,
 * the task drawer and the workspace views. No I/O here.
 */
import type { AssignmentStatus, ResourceRef, WsTask } from "./workspace";

export type ResourceKind = "staff" | "subcontractor" | "crew";
export interface TeamResource {
  id: string; kind: ResourceKind; name: string; contactName: string | null; linkedUserId: string | null;
  trades: string[]; email: string | null; phone: string | null; notes: string | null; capacity: number;
  unavailable: string[]; status: "active" | "archived"; members: string[];
}
export interface Team { companyId: string | null; canManage: boolean; resources: TeamResource[] }

export const KIND_LABEL: Record<ResourceKind, string> = { staff: "Staff", subcontractor: "Subcontractor", crew: "Crew" };
export const ASSIGNMENT_STATUSES: { value: AssignmentStatus; label: string; hint: string }[] = [
  { value: "tentative", label: "Tentative", hint: "Penciled in. Not asked yet." },
  { value: "requested", label: "Requested", hint: "You've asked them. Waiting to hear back." },
  { value: "confirmed", label: "Confirmed", hint: "They said yes. We record who confirmed it and when." },
  { value: "declined", label: "Declined", hint: "They can't do it. Pick someone else." },
];
export const statusLabelOf = (s: AssignmentStatus | null | undefined) => ASSIGNMENT_STATUSES.find((x) => x.value === s)?.label ?? "Assigned";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function mapTeam(raw: unknown): Team {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.resources) ? (r.resources as Record<string, unknown>[]) : [];
  return {
    companyId: str(r.companyId),
    canManage: r.canManage === true,
    resources: list.map((x) => ({
      id: String(x.id), kind: (["staff", "subcontractor", "crew"].includes(String(x.kind)) ? x.kind : "staff") as ResourceKind,
      name: String(x.name ?? ""), contactName: str(x.contactName), linkedUserId: str(x.linkedUserId), trades: strs(x.trades),
      email: str(x.email), phone: str(x.phone), notes: str(x.notes), capacity: Number(x.capacity) || 1,
      unavailable: strs(x.unavailable), status: x.status === "archived" ? "archived" : "active", members: strs(x.members),
    })),
  };
}

/** Trade names are stored lowercase; show them the way people write them. */
export const tradeLabel = (t: string) => t.replace(/(^|[\s/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
export const normTrade = (t: string | null | undefined) => (t ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");

/** Directory entries for workload/conflict checks: crews expand to their members. */
export function toResourceRefs(team: Team): ResourceRef[] {
  return team.resources.map((r) => ({
    key: `r:${r.id}`, label: r.name, kind: r.kind, members: r.members.map((m) => `r:${m}`),
    unavailable: r.unavailable, capacity: r.kind === "crew" || r.capacity > 1 ? r.capacity : null,
  }));
}

/** Keys that count as "me" for My Work: my staff entry and any crew I'm on. */
export function myResourceKeys(team: Team, me: string | null): string[] {
  if (!me) return [];
  const mine = team.resources.filter((r) => r.linkedUserId === me).map((r) => r.id);
  const crews = team.resources.filter((r) => r.kind === "crew" && r.members.some((m) => mine.includes(m))).map((r) => r.id);
  return [...mine, ...crews].map((id) => `r:${id}`);
}

/**
 * Suggestions for a section: active entries whose trades match the section's trade or its name
 * ("Countertops" on a kitchen remodel suggests a countertop sub), subcontractors and crews before
 * individual staff; then everyone else alphabetically. Never filters anyone out.
 */
export function suggestFor(resources: TeamResource[], trade: string | null | undefined, sectionName?: string | null): { match: TeamResource[]; others: TeamResource[] } {
  const t = normTrade(trade);
  const n = normTrade(sectionName);
  const active = resources.filter((r) => r.status === "active");
  const rank = (r: TeamResource) => (r.kind === "staff" ? 1 : 0);
  const byName = (a: TeamResource, b: TeamResource) => rank(a) - rank(b) || a.name.localeCompare(b.name);
  // Singular/plural tolerant: "countertop" matches "Countertops".
  const stem = (x: string) => x.replace(/(ing|s)$/, "");
  const hit = (r: TeamResource) => r.trades.map(normTrade).some((x) => !!x && (
    (!!t && (x === t || x.includes(t) || t.includes(x))) || (n.length > 2 && x.length > 2 && (n.includes(stem(x)) || x.includes(stem(n))))));
  return { match: active.filter(hit).sort(byName), others: active.filter((r) => !hit(r)).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Booked working days elsewhere that overlap [start, end] for a resource (for the "busy" hint). */
export function busyElsewhere(tasks: WsTask[], resourceId: string, scheduleId: string | null, start: string, end: string): WsTask[] {
  return tasks.filter((x) => x.resourceId === resourceId && x.scheduleId !== scheduleId && x.status !== "complete" && x.plannedStart <= end && x.plannedEnd >= start);
}

/**
 * A plain assignment notice the user sends from their own email app. Built2Bid never sends it.
 * Contains only dates and scope: no prices, no internal notes.
 */
export function assignmentNotice(o: { resource: Pick<TeamResource, "name" | "contactName" | "email">; project: string; address?: string | null; work: string; start: string; end: string; sender: string }): { subject: string; body: string; mailto: string | null } {
  const hello = o.resource.contactName || o.resource.name;
  const subject = `Work request: ${o.work} at ${o.project}`;
  const body = [
    `Hi ${hello},`,
    "",
    `Can you take ${o.work} for ${o.project}?`,
    `Dates: ${o.start === o.end ? o.start : `${o.start} to ${o.end}`}`,
    o.address ? `Location: ${o.address}` : null,
    "",
    "Please reply to confirm or let me know if those dates don't work.",
    "",
    `Thanks,`,
    o.sender,
  ].filter((x) => x !== null).join("\n");
  const mailto = o.resource.email ? `mailto:${encodeURIComponent(o.resource.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  return { subject, body, mailto };
}

/** What a customer report may show about the people doing the work. */
export type ReportAssignees = "hidden" | "names" | "names_contacts";
export const REPORT_ASSIGNEE_OPTIONS: { value: ReportAssignees; label: string }[] = [
  { value: "hidden", label: "Don't show who's doing the work" },
  { value: "names", label: "Show names only (recommended)" },
  { value: "names_contacts", label: "Show names with phone and email" },
];
export function reportAssignee(mode: ReportAssignees, r: { name: string; phone?: string | null; email?: string | null } | null, fallback: string | null): string | null {
  if (mode === "hidden") return null;
  if (!r) return fallback;
  if (mode === "names") return r.name;
  return [r.name, r.phone, r.email].filter(Boolean).join(" · ");
}
