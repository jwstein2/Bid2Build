/**
 * Worker hub (V8.3): the worker's week built on the one employee record. Mappers for pm_worker_week,
 * pm_labor_report and pm_pay_admin_overview, plus small pure helpers (scheduled vs actual, "where am I now").
 */
import { entryHours, isWorkCategory, localDay, mapEntry, WORK_CATEGORY_LABEL, type TimeEntry, type WorkCategory } from "@/lib/team/records";
import { mapCorrections, type Correction } from "@/lib/workforce/gps/model";

export type Classification = "w2" | "1099" | "owner" | "other";
export const CLASSIFICATION_LABEL: Record<Classification, string> = { w2: "W-2 employee", "1099": "1099 contractor", owner: "Owner", other: "Other" };
export const isClassification = (v: unknown): v is Classification => typeof v === "string" && v in CLASSIFICATION_LABEL;
export function mapClassifications(x: unknown): Record<string, Classification | null> {
  return Object.fromEntries(Object.entries((x && typeof x === "object" ? x : {}) as Record<string, unknown>).map(([k, v]) => [k, isClassification(v) ? v : null]));
}

export type ScheduleKind = "shift" | "task" | "time_off";
export interface ScheduleItem {
  kind: ScheduleKind; id: string; date: string; startTime: string | null; endTime: string | null; hours: number; unpaidBreakMinutes: number;
  category: WorkCategory | "time_off"; scheduleId: string | null; project: string | null; title: string; task: string | null;
  locationId: string | null; location: string | null; address: string | null; notes: string | null; responsibilities: string | null;
  status: string; via: string | null; estimated: boolean;
}
export const SHIFT_CATEGORIES: WorkCategory[] = ["shop", "office", "training", "admin", "travel", "other_paid", "project"];
export const categoryLabel = (c: string) => (c === "time_off" ? "Time off" : isWorkCategory(c) ? WORK_CATEGORY_LABEL[c] : c);

export interface WorkerLocation { id: string; name: string; kind: string; category: string; address: string | null; scheduleId: string | null }
export interface WorkerWeek {
  resource: { id: string; name: string; title: string | null; classification: Classification | null; payType: string; exempt: boolean; isMe: boolean; gpsActive: boolean };
  week: string; today: string; timezone: string; overtimeRule: string;
  schedule: ScheduleItem[]; upcoming: ScheduleItem[]; entries: TimeEntry[]; open: TimeEntry | null; corrections: Correction[]; signedOff: boolean;
  locations: WorkerLocation[]; pay: { admin: boolean; visible: boolean };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

export function mapScheduleItem(x: Record<string, unknown>): ScheduleItem {
  const kind = (["shift", "task", "time_off"].includes(String(x.kind)) ? x.kind : "shift") as ScheduleKind;
  const cat = x.category === "time_off" ? "time_off" : isWorkCategory(x.category) ? x.category : "other_paid";
  return {
    kind, id: String(x.id ?? ""), date: String(x.date ?? "").slice(0, 10), startTime: str(x.startTime), endTime: str(x.endTime), hours: num(x.hours),
    unpaidBreakMinutes: num(x.unpaidBreakMinutes), category: cat, scheduleId: str(x.scheduleId), project: str(x.project),
    title: str(x.title) ?? (kind === "task" ? "Project work" : categoryLabel(cat)), task: str(x.task), locationId: str(x.locationId), location: str(x.location),
    address: str(x.address), notes: str(x.notes), responsibilities: str(x.responsibilities), status: String(x.status ?? "scheduled"), via: str(x.via), estimated: x.estimated === true,
  };
}

export function mapWorkerWeek(x: unknown): WorkerWeek {
  const o = (x ?? {}) as Record<string, unknown>;
  const r = (o.resource ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const pay = (o.pay ?? {}) as Record<string, unknown>;
  return {
    resource: { id: String(r.id ?? ""), name: String(r.name ?? ""), title: str(r.title), classification: isClassification(r.classification) ? r.classification : null,
      payType: String(r.payType ?? "hourly"), exempt: r.exempt === true, isMe: r.isMe === true, gpsActive: r.gpsActive === true },
    week: String(o.week ?? "").slice(0, 10), today: String(o.today ?? "").slice(0, 10), timezone: String(o.timezone ?? "America/Chicago"), overtimeRule: String(o.overtimeRule ?? "federal"),
    schedule: arr(o.schedule).map(mapScheduleItem), upcoming: arr(o.upcoming).map(mapScheduleItem), entries: arr(o.entries).map(mapEntry),
    open: o.open ? mapEntry(o.open as Record<string, unknown>) : null, corrections: mapCorrections(o.corrections), signedOff: o.signedOff === true,
    locations: arr(o.locations).map((l) => ({ id: String(l.id), name: String(l.name ?? ""), kind: String(l.kind ?? "other"), category: String(l.category ?? "other_paid"), address: str(l.address), scheduleId: str(l.scheduleId) })),
    pay: { admin: pay.admin === true, visible: pay.visible === true },
  };
}

export interface DayCompare { date: string; scheduled: number; actual: number; diff: number; items: ScheduleItem[]; entries: TimeEntry[] }
/** Scheduled vs recorded hours for each of the 7 days (unpaid time and time off kept out of "actual"/"scheduled" work). */
export function compareWeek(w: Pick<WorkerWeek, "week" | "schedule" | "entries" | "timezone">, now: Date = new Date()): DayCompare[] {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${w.week}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  return days.map((date) => {
    const items = w.schedule.filter((s) => s.date === date);
    const entries = w.entries.filter((e) => localDay(e.clockIn, w.timezone) === date);
    const scheduled = items.filter((s) => s.category !== "time_off" && s.category !== "unpaid").reduce((s, i) => s + i.hours, 0);
    const actual = entries.filter((e) => e.workCategory !== "unpaid").reduce((s, e) => s + entryHours(e, now), 0);
    return { date, scheduled: r2(scheduled), actual: r2(actual), diff: r2(actual - scheduled), items, entries };
  });
}

export interface Breakdown { key: string; label: string; category: string; scheduled: number; actual: number; diff: number }
/** Hours by project or internal work location / category for the week. */
export function breakdown(w: Pick<WorkerWeek, "schedule" | "entries" | "timezone" | "locations">, projectNames: Record<string, string> = {}, now: Date = new Date()): Breakdown[] {
  const map = new Map<string, Breakdown>();
  const add = (key: string, label: string, category: string, s: number, a: number) => {
    const b = map.get(key) ?? { key, label, category, scheduled: 0, actual: 0, diff: 0 };
    b.scheduled += s; b.actual += a; map.set(key, b);
  };
  for (const i of w.schedule) {
    if (i.category === "time_off" || i.category === "unpaid") continue;
    if (i.scheduleId) add(`p:${i.scheduleId}`, i.project ?? "Project", "project", i.hours, 0);
    else add(`c:${i.category}`, categoryLabel(i.category), i.category, i.hours, 0);
  }
  for (const e of w.entries) {
    const cat = e.workCategory ?? (e.scheduleId ? "project" : "other_paid");
    if (cat === "unpaid") continue;
    const h = entryHours(e, now);
    if (e.scheduleId) add(`p:${e.scheduleId}`, projectNames[e.scheduleId] ?? w.schedule.find((s) => s.scheduleId === e.scheduleId)?.project ?? "Project", "project", 0, h);
    else add(`c:${cat}`, categoryLabel(cat), cat, 0, h);
  }
  return [...map.values()].map((b) => ({ ...b, scheduled: r2(b.scheduled), actual: r2(b.actual), diff: r2(b.actual - b.scheduled) })).sort((a, b) => b.scheduled + b.actual - (a.scheduled + a.actual));
}

export type DutyState = { kind: "project"; label: string; detail: string | null } | { kind: "internal"; label: string; detail: string | null } | { kind: "off"; label: string; detail: string | null };
/** What the worker is doing right now: on a customer project, at an internal location / activity, or off duty. */
export function dutyState(w: Pick<WorkerWeek, "open" | "locations" | "schedule" | "today">, projectNames: Record<string, string> = {}): DutyState {
  const e = w.open;
  const nextToday = w.schedule.find((s) => s.date === w.today && s.category !== "time_off");
  if (!e) return { kind: "off", label: "Off duty", detail: nextToday ? `Scheduled today: ${nextToday.title}${nextToday.startTime ? ` at ${nextToday.startTime}` : ""}` : "Nothing scheduled today" };
  const loc = w.locations.find((l) => l.id === e.locationId);
  const cat = e.workCategory ?? (e.scheduleId ? "project" : "other_paid");
  if (e.scheduleId || cat === "project") {
    const name = (e.scheduleId && (projectNames[e.scheduleId] ?? w.schedule.find((s) => s.scheduleId === e.scheduleId)?.project)) || loc?.name || "Customer project";
    return { kind: "project", label: `On a customer project: ${name}`, detail: loc?.address ?? null };
  }
  return { kind: "internal", label: `${categoryLabel(cat)}${loc ? `: ${loc.name}` : ""}`, detail: "Paid company time (not a customer job)" };
}

// ---- Labor report ----------------------------------------------------------------------------------------------
export interface LaborJob { scheduleId: string; name: string; scheduledHours: number; actualHours: number; approvedHours: number; scheduledCost: number | null; actualCost: number | null; approvedCost: number | null; uncostedHours: number; people: number }
export interface LaborCategory { category: string; scheduledHours: number; actualHours: number; approvedHours: number; actualCost: number | null }
export interface LaborReport {
  from: string; to: string; canSeeCost: boolean; timezone: string; jobs: LaborJob[]; nonProject: LaborCategory[];
  totals: { scheduledHours: number; actualHours: number; projectHours: number; overheadHours: number; unpaidHours: number; actualCost: number | null; overheadCost: number | null };
}
const n0 = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export function mapLaborReport(x: unknown): LaborReport {
  const o = (x ?? {}) as Record<string, unknown>;
  const t = (o.totals ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    from: String(o.from ?? ""), to: String(o.to ?? ""), canSeeCost: o.canSeeCost === true, timezone: String(o.timezone ?? "America/Chicago"),
    jobs: arr(o.jobs).map((j) => ({ scheduleId: String(j.scheduleId), name: String(j.name ?? "Project"), scheduledHours: num(j.scheduledHours), actualHours: num(j.actualHours), approvedHours: num(j.approvedHours),
      scheduledCost: n0(j.scheduledCost), actualCost: n0(j.actualCost), approvedCost: n0(j.approvedCost), uncostedHours: num(j.uncostedHours), people: num(j.people) })),
    nonProject: arr(o.nonProject).map((c) => ({ category: String(c.category), scheduledHours: num(c.scheduledHours), actualHours: num(c.actualHours), approvedHours: num(c.approvedHours), actualCost: n0(c.actualCost) })),
    totals: { scheduledHours: num(t.scheduledHours), actualHours: num(t.actualHours), projectHours: num(t.projectHours), overheadHours: num(t.overheadHours), unpaidHours: num(t.unpaidHours),
      actualCost: n0(t.actualCost), overheadCost: n0(t.overheadCost) },
  };
}

// ---- Pay admin -------------------------------------------------------------------------------------------------
export interface PayWorker {
  id: string; name: string; linked: boolean; classification: Classification | null; payType: string; payRate: number | null; payRateUnit: string | null;
  payFrequency: string | null; exempt: boolean; projectionEnabled: boolean; workerCanSee: boolean | null; rates: Record<string, number>; workerSees: boolean;
}
export function mapPayWorkers(x: unknown): PayWorker[] {
  return (Array.isArray(x) ? (x as Record<string, unknown>[]) : []).map((w) => ({
    id: String(w.id), name: String(w.name ?? ""), linked: w.linked === true, classification: isClassification(w.classification) ? w.classification : null,
    payType: String(w.payType ?? "hourly"), payRate: n0(w.payRate), payRateUnit: str(w.payRateUnit), payFrequency: str(w.payFrequency), exempt: w.exempt === true,
    projectionEnabled: w.projectionEnabled !== false, workerCanSee: typeof w.workerCanSee === "boolean" ? w.workerCanSee : null,
    rates: Object.fromEntries(Object.entries((w.rates ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])), workerSees: w.workerSees === true,
  }));
}

function r2(n: number) { return Math.round(n * 100) / 100; }
export const ISSUE_LABEL: Record<string, string> = {
  gps_unavailable: "GPS wasn't working", forgot_phone: "Forgot my phone", missed_event: "An arrival or departure was missed",
  wrong_location: "Assigned to the wrong place", dispute_auto: "I disagree with an automatic punch", other: "Something else",
};
