/**
 * V8.2 customer GPS timekeeping: types, mappers and labels (pure). SQL: 20270208001000_gps_timekeeping.sql.
 * Customer-facing only (a contractor company's own W-2 employees); unrelated to Built2Bid's internal staff.
 */
import { mapEntry, num, type TimeEntry, type WorkType } from "@/lib/team/records";
import type { OvertimeRule } from "./overtime";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const bool = (v: unknown) => v === true;

export interface GpsSettings {
  enabled: boolean; disclosureAckAt: string | null; disclosureVersion: number; disclosureExtra: string | null;
  defaultRadiusM: number; entryDwellMin: number; exitGraceMin: number; entryAction: "auto" | "ask"; exitAction: "ask" | "auto";
  startRule: "schedule" | "any_time"; workDays: number[]; workStart: string; workEnd: string; earlyMin: number; travelWindowMin: number;
  maxAccuracyM: number; overtimeRule: OvertimeRule; timezone: string; retentionDays: number; saved: boolean;
}
export function mapSettings(x: Record<string, unknown> | null | undefined): GpsSettings {
  const r = x ?? {};
  return {
    enabled: bool(r.enabled), disclosureAckAt: str(r.disclosureAckAt), disclosureVersion: num(r.disclosureVersion) ?? 1, disclosureExtra: str(r.disclosureExtra),
    defaultRadiusM: num(r.defaultRadiusM) ?? 322, entryDwellMin: num(r.entryDwellMin) ?? 3, exitGraceMin: num(r.exitGraceMin) ?? 10,
    entryAction: r.entryAction === "ask" ? "ask" : "auto", exitAction: r.exitAction === "auto" ? "auto" : "ask",
    startRule: r.startRule === "any_time" ? "any_time" : "schedule", workDays: Array.isArray(r.workDays) ? (r.workDays as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7) : [1, 2, 3, 4, 5],
    workStart: str(r.workStart) ?? "06:00", workEnd: str(r.workEnd) ?? "19:00", earlyMin: num(r.earlyMin) ?? 30, travelWindowMin: num(r.travelWindowMin) ?? 90,
    maxAccuracyM: num(r.maxAccuracyM) ?? 100, overtimeRule: (str(r.overtimeRule) ?? "federal") as OvertimeRule, timezone: str(r.timezone) ?? "America/Chicago",
    retentionDays: num(r.retentionDays) ?? 90, saved: bool(r.saved),
  };
}

export type LocationKind = "business" | "project" | "other";
export const LOCATION_KIND_LABEL: Record<LocationKind, string> = { business: "Main business address", project: "Project / jobsite", other: "Other approved place" };
export interface WorkLocation {
  id: string; kind: LocationKind; name: string; address: string | null; scheduleId: string | null; lat: number | null; lng: number | null; radiusM: number;
  pinSource: "device" | "census" | "manual" | null; pinAccuracyM: number | null; everyone: boolean; confirmedAt: string | null; status: "active" | "archived";
  ready: boolean; assigned: { resourceId: string; startsOn: string | null; endsOn: string | null }[]; scheduledToday: string[];
}
export interface GpsEmployee {
  id: string; name: string; kind: "staff" | "subcontractor"; status: "active" | "archived"; linked: boolean; payType: string; flsa: string | null;
  enrolled: boolean; w2ConfirmedAt: string | null; consentAt: string | null; consentVersion: number | null; consentWithdrawnAt: string | null;
  permission: Permission; permissionAt: string | null; appMode: string | null; lastSeenAt: string | null; active: boolean;
  open: { id: string; clockIn: string; locationId: string | null; source: string; awaySince: string | null } | null;
}
export type Permission = "unknown" | "granted" | "prompt" | "denied" | "unavailable";
export const PERMISSION_LABEL: Record<Permission, string> = { unknown: "Not checked yet", granted: "Allowed", prompt: "Not asked yet", denied: "Blocked", unavailable: "No location on device" };
export interface GpsAdmin {
  canAdmin: boolean; canSupervise: boolean; isOwner: boolean; companyId: string | null; settings: GpsSettings; locations: WorkLocation[]; employees: GpsEmployee[];
  supervisors: { userId: string; name: string; role: "admin" | "supervisor" | null }[];
  candidates: { business: string | null; projects: { scheduleId: string; name: string; address: string | null; status: string }[] };
}

export function mapLocation(x: Record<string, unknown>): WorkLocation {
  return {
    id: String(x.id), kind: (["business", "project", "other"].includes(String(x.kind)) ? x.kind : "other") as LocationKind, name: String(x.name ?? ""), address: str(x.address),
    scheduleId: str(x.scheduleId), lat: num(x.lat), lng: num(x.lng), radiusM: num(x.radiusM) ?? 322,
    pinSource: (["device", "census", "manual"].includes(String(x.pinSource)) ? x.pinSource : null) as WorkLocation["pinSource"], pinAccuracyM: num(x.pinAccuracyM),
    everyone: bool(x.everyone), confirmedAt: str(x.confirmedAt), status: x.status === "archived" ? "archived" : "active", ready: bool(x.ready),
    assigned: arr(x.assigned).map((a) => ({ resourceId: String(a.resourceId), startsOn: str(a.startsOn), endsOn: str(a.endsOn) })),
    scheduledToday: Array.isArray(x.scheduledToday) ? (x.scheduledToday as unknown[]).map(String) : [],
  };
}
const perm = (v: unknown): Permission => (["granted", "prompt", "denied", "unavailable"].includes(String(v)) ? v : "unknown") as Permission;
export function mapAdmin(raw: unknown): GpsAdmin {
  const r = (raw ?? {}) as Record<string, unknown>;
  const c = (r.candidates ?? {}) as Record<string, unknown>;
  return {
    canAdmin: bool(r.canAdmin), canSupervise: bool(r.canSupervise), isOwner: bool(r.isOwner), companyId: str(r.companyId),
    settings: mapSettings(r.settings as Record<string, unknown>), locations: arr(r.locations).map(mapLocation),
    employees: arr(r.employees).map((x) => {
      const o = x.open as Record<string, unknown> | null;
      return {
        id: String(x.id), name: String(x.name ?? ""), kind: x.kind === "subcontractor" ? "subcontractor" : "staff", status: x.status === "archived" ? "archived" : "active",
        linked: bool(x.linked), payType: String(x.payType ?? "hourly"), flsa: str(x.flsa), enrolled: bool(x.enrolled), w2ConfirmedAt: str(x.w2ConfirmedAt),
        consentAt: str(x.consentAt), consentVersion: num(x.consentVersion), consentWithdrawnAt: str(x.consentWithdrawnAt), permission: perm(x.permission),
        permissionAt: str(x.permissionAt), appMode: str(x.appMode), lastSeenAt: str(x.lastSeenAt), active: bool(x.active),
        open: o ? { id: String(o.id), clockIn: String(o.clockIn), locationId: str(o.locationId), source: String(o.source ?? ""), awaySince: str(o.awaySince) } : null,
      };
    }),
    supervisors: arr(r.supervisors).map((s) => ({ userId: String(s.userId), name: String(s.name ?? ""), role: s.role === "admin" || s.role === "supervisor" ? s.role : null })),
    candidates: { business: str(c.business), projects: arr(c.projects).map((p) => ({ scheduleId: String(p.scheduleId), name: String(p.name ?? ""), address: str(p.address), status: String(p.status ?? "") })) },
  };
}

/** Setup checklist for the company switch. */
export function setupSteps(a: GpsAdmin): { key: string; label: string; done: boolean }[] {
  const staff = a.employees.filter((e) => e.kind === "staff" && e.status === "active");
  return [
    { key: "location", label: "Confirm at least one work location (pin + radius)", done: a.locations.some((l) => l.ready) },
    { key: "settings", label: "Review timing, exit behavior and work hours", done: a.settings.saved },
    { key: "disclosure", label: "Confirm employees were told how GPS time tracking works", done: Boolean(a.settings.disclosureAckAt) },
    { key: "enroll", label: "Turn it on for W-2 employees whose hours you track", done: staff.some((e) => e.enrolled) },
  ];
}

export interface MyLocation { id: string; name: string; kind: LocationKind; lat: number; lng: number; radiusM: number; scheduleId: string | null }
export interface MyStaff {
  resourceId: string; name: string; enrolled: boolean; consentAt: string | null; consentVersion: number | null; permission: Permission; active: boolean;
  open: TimeEntry | null; pendingCorrections: number; locations: MyLocation[]; choices: { id: string; name: string; kind: LocationKind; scheduleId: string | null }[];
}
export interface MyStatus {
  companyName: string | null;
  settings: Pick<GpsSettings, "enabled" | "disclosureVersion" | "disclosureExtra" | "entryDwellMin" | "exitGraceMin" | "entryAction" | "exitAction" | "maxAccuracyM" | "retentionDays" | "timezone" | "overtimeRule">;
  me: MyStaff[];
}
export function mapMyStatus(raw: unknown): MyStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = mapSettings(r.settings as Record<string, unknown>);
  return {
    companyName: str(r.companyName),
    settings: { enabled: s.enabled, disclosureVersion: s.disclosureVersion, disclosureExtra: s.disclosureExtra, entryDwellMin: s.entryDwellMin, exitGraceMin: s.exitGraceMin,
      entryAction: s.entryAction, exitAction: s.exitAction, maxAccuracyM: s.maxAccuracyM, retentionDays: s.retentionDays, timezone: s.timezone, overtimeRule: s.overtimeRule },
    me: arr(r.me).map((m) => ({
      resourceId: String(m.resourceId), name: String(m.name ?? ""), enrolled: bool(m.enrolled), consentAt: str(m.consentAt), consentVersion: num(m.consentVersion),
      permission: perm(m.permission), active: bool(m.active), open: m.open ? mapEntry(m.open as Record<string, unknown>) : null, pendingCorrections: num(m.pendingCorrections) ?? 0,
      locations: arr(m.locations).flatMap((l) => {
        const lat = num(l.lat), lng = num(l.lng);
        return lat === null || lng === null ? [] : [{ id: String(l.id), name: String(l.name ?? ""), kind: (l.kind ?? "other") as LocationKind, lat, lng, radiusM: num(l.radiusM) ?? 322, scheduleId: str(l.scheduleId) }];
      }),
      choices: arr(m.choices).map((l) => ({ id: String(l.id), name: String(l.name ?? ""), kind: (l.kind ?? "other") as LocationKind, scheduleId: str(l.scheduleId) })),
    })),
  };
}

export interface Correction {
  id: string; resourceId: string; entryId: string | null; kind: "fix" | "missing"; clockIn: string; clockOut: string; breakMinutes: number; paidBreakMinutes: number;
  scheduleId: string | null; locationId: string | null; workType: WorkType; reason: string; status: "pending" | "approved" | "denied" | "withdrawn";
  requestedAt: string; decidedAt: string | null; decisionNote: string | null; current: TimeEntry | null;
}
export function mapCorrections(raw: unknown): Correction[] {
  return arr(raw).map((k) => ({
    id: String(k.id), resourceId: String(k.resourceId), entryId: str(k.entryId), kind: k.kind === "missing" ? "missing" : "fix", clockIn: String(k.clockIn), clockOut: String(k.clockOut),
    breakMinutes: num(k.breakMinutes) ?? 0, paidBreakMinutes: num(k.paidBreakMinutes) ?? 0, scheduleId: str(k.scheduleId), locationId: str(k.locationId),
    workType: (["travel", "offsite"].includes(String(k.workType)) ? k.workType : "regular") as WorkType, reason: String(k.reason ?? ""),
    status: (["approved", "denied", "withdrawn"].includes(String(k.status)) ? k.status : "pending") as Correction["status"],
    requestedAt: String(k.requestedAt), decidedAt: str(k.decidedAt), decisionNote: str(k.decisionNote), current: k.current ? mapEntry(k.current as Record<string, unknown>) : null,
  }));
}

export interface Exceptions { entries: TimeEntry[]; people: { resourceId: string; name: string; permission: Permission; permissionAt: string | null; lowAccuracy7d: number; consent: boolean }[]; pendingCorrections: number }
export function mapExceptions(raw: unknown): Exceptions {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    entries: arr(r.entries).map(mapEntry),
    people: arr(r.people).map((p) => ({ resourceId: String(p.resourceId), name: String(p.name ?? ""), permission: perm(p.permission), permissionAt: str(p.permissionAt), lowAccuracy7d: num(p.lowAccuracy7d) ?? 0, consent: bool(p.consent) })),
    pendingCorrections: num(r.pendingCorrections) ?? 0,
  };
}

export interface GeoEventRow { id: string; kind: string; occurredAt: string; accuracyM: number | null; distanceM: number | null; source: string; outcome: string; entryId: string | null; location: string | null; detail: string | null }
export const mapEvents = (raw: unknown): GeoEventRow[] => arr(raw).map((g) => ({
  id: String(g.id), kind: String(g.kind), occurredAt: String(g.occurredAt), accuracyM: num(g.accuracyM), distanceM: num(g.distanceM), source: String(g.source ?? ""),
  outcome: String(g.outcome ?? ""), entryId: str(g.entryId), location: str(g.location), detail: str(g.detail),
}));
export const EVENT_KIND_LABEL: Record<string, string> = { enter: "Arrived", dwell: "Stayed", exit: "Left", exit_confirmed: "Still away", resolve: "Answered" };
export const OUTCOME_LABEL: Record<string, string> = {
  noted: "Recorded", clocked_in: "Clocked in", clocked_out: "Clocked out", transferred: "Moved to this site", asked: "Asked the employee", confirmed: "Employee confirmed",
  returned: "Came back", ignored_not_assigned: "Not assigned here: ignored", ignored_duplicate: "Already clocked in", ignored_low_accuracy: "GPS too weak: ignored",
  ignored_no_arrival: "Didn't stay long enough",
};

export interface ProjectLaborSummary {
  canSeeCost: boolean; estimatedHours: number | null; estimatedCost: number | null; actualHours: number; approvedHours: number; openHours: number;
  actualCost: number | null; allocatedCost: number | null; uncostedHours: number; people: number;
}
export function mapProjectLabor(raw: unknown): ProjectLaborSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    canSeeCost: bool(r.canSeeCost), estimatedHours: num(r.estimatedHours), estimatedCost: num(r.estimatedCost), actualHours: num(r.actualHours) ?? 0,
    approvedHours: num(r.approvedHours) ?? 0, openHours: num(r.openHours) ?? 0, actualCost: num(r.actualCost), allocatedCost: num(r.allocatedCost),
    uncostedHours: num(r.uncostedHours) ?? 0, people: num(r.people) ?? 0,
  };
}
/** Variance and the effect on expected profit (positive = labor came in under the estimate). */
export function laborVariance(l: ProjectLaborSummary): { hours: number | null; cost: number | null; profitImpact: number | null } {
  const hours = l.estimatedHours === null ? null : Math.round((l.actualHours - l.estimatedHours) * 100) / 100;
  const cost = l.estimatedCost === null || l.allocatedCost === null ? null : Math.round((l.allocatedCost - l.estimatedCost) * 100) / 100;
  return { hours, cost, profitImpact: cost === null ? null : -cost };
}

export const WEEKDAYS = [
  { n: 1, short: "Mon" }, { n: 2, short: "Tue" }, { n: 3, short: "Wed" }, { n: 4, short: "Thu" }, { n: 5, short: "Fri" }, { n: 6, short: "Sat" }, { n: 7, short: "Sun" },
] as const;

/** The disclosure every employee reads and accepts before automatic GPS time tracking runs for them. */
export function disclosureText(company: string | null, s: Pick<GpsSettings, "entryDwellMin" | "exitGraceMin" | "exitAction" | "retentionDays">): string[] {
  const who = company ?? "Your employer";
  return [
    `${who} uses Built2Bid to record your work hours automatically when you arrive at and leave approved work locations (the shop, office and the jobsites you're assigned to).`,
    `Only while you have Built2Bid open on your phone, it checks your location against those places. When you've been at one for about ${s.entryDwellMin} minute${s.entryDwellMin === 1 ? "" : "s"}, it clocks you in. When you've been away about ${s.exitGraceMin} minutes, it ${s.exitAction === "auto" ? "clocks you out at the time you left (your manager reviews it)" : "asks whether you're still working"}.`,
    "Built2Bid stores arrivals and departures with how far you were from the site and how accurate your GPS was. It does not store a trail of where you go, and it ignores places that aren't approved work locations.",
    `Your employer's time admins and supervisors can see these events. They're deleted after ${s.retentionDays} days; your hours stay on your timesheet.`,
    "GPS never takes away time you worked. If GPS is wrong or your phone can't get a signal, clock in or out by hand or ask for a correction.",
    "You can say no or turn this off at any time and use the manual time clock instead.",
  ];
}
