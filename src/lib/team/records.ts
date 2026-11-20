/**
 * Team records: supplier directory, employees + time clock, subcontractor records and 1099 totals.
 * Pure helpers (types, mappers, hour and overtime math, CSV). No I/O here.
 * SQL: supabase/migrations/20261210001000_team_records.sql
 */
import { csvCell } from "@/lib/financials/csv";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** PostgREST returns numeric as JSON numbers (or strings in some paths): accept both. */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------------------------------
export interface Supplier {
  id: string; name: string; accountNumber: string | null; repName: string | null; email: string | null; phone: string | null;
  website: string | null; address: string | null; trades: string[]; notes: string | null; status: "active" | "archived";
  imports: number; lastImportAt: string | null; pricedItems: number;
}
export interface SupplierList { companyId: string | null; canManage: boolean; suppliers: Supplier[] }

export function mapSuppliers(raw: unknown): SupplierList {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.suppliers) ? (r.suppliers as Record<string, unknown>[]) : [];
  return {
    companyId: str(r.companyId), canManage: r.canManage === true,
    suppliers: list.map((x) => ({
      id: String(x.id), name: String(x.name ?? ""), accountNumber: str(x.accountNumber), repName: str(x.repName), email: str(x.email),
      phone: str(x.phone), website: str(x.website), address: str(x.address), trades: strs(x.trades), notes: str(x.notes),
      status: x.status === "archived" ? "archived" : "active", imports: num(x.imports) ?? 0, lastImportAt: str(x.lastImportAt), pricedItems: num(x.pricedItems) ?? 0,
    })),
  };
}

/** A website typed without a scheme still opens as https. Anything that isn't http(s) is dropped. */
export function websiteHref(w: string | null): string | null {
  if (!w) return null;
  const t = w.trim();
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try { const u = new URL(withScheme); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------
// Employees + time clock
// ---------------------------------------------------------------------------------------------------
export type PayType = "hourly" | "salary" | "owner" | "other";
export const PAY_TYPE_LABEL: Record<PayType, string> = { hourly: "Hourly", salary: "Salary", owner: "Owner", other: "Other" };
export interface Employee {
  id: string; name: string; email: string | null; phone: string | null; trades: string[]; status: "active" | "archived"; linkedUserId: string | null;
  title: string | null; payType: PayType; hourlyCost: number | null; hireDate: string | null; emergencyName: string | null; emergencyPhone: string | null;
  clockEnabled: boolean; clockedInAt: string | null;
}
export interface EmployeeList { canManage: boolean; employees: Employee[] }

export function mapEmployees(raw: unknown): EmployeeList {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.employees) ? (r.employees as Record<string, unknown>[]) : [];
  return {
    canManage: r.canManage === true,
    employees: list.map((x) => ({
      id: String(x.id), name: String(x.name ?? ""), email: str(x.email), phone: str(x.phone), trades: strs(x.trades),
      status: x.status === "archived" ? "archived" : "active", linkedUserId: str(x.linkedUserId), title: str(x.title),
      payType: (["hourly", "salary", "owner", "other"].includes(String(x.payType)) ? x.payType : "hourly") as PayType,
      hourlyCost: num(x.hourlyCost), hireDate: str(x.hireDate), emergencyName: str(x.emergencyName), emergencyPhone: str(x.emergencyPhone),
      clockEnabled: x.clockEnabled !== false, clockedInAt: str(x.clockedInAt),
    })),
  };
}

export type TimeStatus = "open" | "pending" | "approved" | "rejected";
export const TIME_STATUS_LABEL: Record<TimeStatus, string> = { open: "Clocked in", pending: "Waiting for approval", approved: "Approved", rejected: "Sent back" };
export interface Punch { lat: number; lng: number; accuracyM: number | null }
export type TimeSource = "clock" | "manual" | "gps" | "gps_confirmed" | "travel" | "correction";
export const TIME_SOURCE_LABEL: Record<TimeSource, string> = {
  clock: "Time clock", manual: "Added by manager", gps: "GPS (automatic)", gps_confirmed: "GPS (employee confirmed)", travel: "Travel between sites (GPS)", correction: "Employee correction",
};
export type WorkType = "regular" | "travel" | "offsite";
export const WORK_TYPE_LABEL: Record<WorkType, string> = { regular: "On site", travel: "Travel between sites", offsite: "Paid offsite work" };
/** What the time was spent on (job costing / overhead). Unpaid time is recorded but never paid or costed. */
export type WorkCategory = "project" | "shop" | "office" | "training" | "admin" | "travel" | "other_paid" | "unpaid";
export const WORK_CATEGORY_LABEL: Record<WorkCategory, string> = {
  project: "Customer project", shop: "Shop / warehouse", office: "Company office", training: "Training", admin: "Administrative work",
  travel: "Paid travel", other_paid: "Other paid work", unpaid: "Unpaid (break / non-working)",
};
export const WORK_CATEGORIES = Object.keys(WORK_CATEGORY_LABEL) as WorkCategory[];
export const isWorkCategory = (v: unknown): v is WorkCategory => typeof v === "string" && v in WORK_CATEGORY_LABEL;
export type ReviewFlag = "auto_clock_out" | "travel" | "away_no_answer" | "travel_gap" | "long_shift";
export const REVIEW_FLAG_LABEL: Record<ReviewFlag, string> = {
  auto_clock_out: "Clocked out automatically when they left. Check the time.",
  travel: "Travel between two sites, recorded automatically.",
  away_no_answer: "Left the site and didn't answer.",
  travel_gap: "Long gap between two sites. Travel wasn't added; check with the employee.",
  long_shift: "Shift of 16 hours or more.",
};
export interface TimeEntry {
  id: string; resourceId: string; scheduleId: string | null; clockIn: string; clockOut: string | null; breakMinutes: number;
  note: string | null; status: TimeStatus; source: TimeSource; inLocation: Punch | null; outLocation: Punch | null;
  edited: boolean; decisionNote: string | null;
  /** V8.2 GPS timekeeping (absent until that SQL runs). */
  locationId?: string | null; workType?: WorkType; paidBreakMinutes?: number; shiftId?: string | null; awaySince?: string | null;
  reviewFlag?: ReviewFlag | null; originalClockIn?: string | null; originalClockOut?: string | null; workCategory?: WorkCategory;
}
export interface Signoff { resourceId: string; week: string; signedAt: string; hours: number | null }
export interface Timesheet {
  canManage: boolean; entries: TimeEntry[]; projects: Record<string, string>; rates: Record<string, number>;
  locations?: Record<string, string>; exempt?: string[]; signoffs?: Signoff[]; overtimeRule?: string; timezone?: string;
}

const punch = (v: unknown): Punch | null => {
  const p = v as Record<string, unknown> | null;
  const lat = num(p?.lat), lng = num(p?.lng);
  return p && lat !== null && lng !== null ? { lat, lng, accuracyM: num(p.accuracyM) } : null;
};
export function mapEntry(x: Record<string, unknown>): TimeEntry {
  return {
    id: String(x.id), resourceId: String(x.resourceId), scheduleId: str(x.scheduleId), clockIn: String(x.clockIn), clockOut: str(x.clockOut),
    breakMinutes: num(x.breakMinutes) ?? 0, note: str(x.note),
    status: (["open", "pending", "approved", "rejected"].includes(String(x.status)) ? x.status : "pending") as TimeStatus,
    source: (Object.keys(TIME_SOURCE_LABEL).includes(String(x.source)) ? x.source : "clock") as TimeSource, inLocation: punch(x.inLocation), outLocation: punch(x.outLocation),
    edited: x.edited === true, decisionNote: str(x.decisionNote),
    locationId: str(x.locationId), workType: (["travel", "offsite"].includes(String(x.workType)) ? x.workType : "regular") as WorkType,
    paidBreakMinutes: num(x.paidBreakMinutes) ?? 0, shiftId: str(x.shiftId), awaySince: str(x.awaySince),
    reviewFlag: (Object.keys(REVIEW_FLAG_LABEL).includes(String(x.reviewFlag)) ? x.reviewFlag : null) as ReviewFlag | null,
    originalClockIn: str(x.originalClockIn), originalClockOut: str(x.originalClockOut),
    workCategory: isWorkCategory(x.workCategory) ? x.workCategory : (x.scheduleId ? "project" : "other_paid"),
  };
}
export function mapTimesheet(raw: unknown): Timesheet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries((r.rates ?? {}) as Record<string, unknown>)) { const n = num(v); if (n !== null) rates[k] = n; }
  const projects: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.projects ?? {}) as Record<string, unknown>)) if (typeof v === "string") projects[k] = v;
  const locations: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.locations ?? {}) as Record<string, unknown>)) if (typeof v === "string") locations[k] = v;
  const signoffs = (Array.isArray(r.signoffs) ? (r.signoffs as Record<string, unknown>[]) : []).map((x) => ({
    resourceId: String(x.resourceId), week: String(x.week), signedAt: String(x.signedAt), hours: num(x.hours) }));
  return {
    canManage: r.canManage === true,
    entries: (Array.isArray(r.entries) ? (r.entries as Record<string, unknown>[]) : []).map(mapEntry),
    projects, rates, locations, exempt: strs(r.exempt), signoffs, overtimeRule: str(r.overtimeRule) ?? undefined, timezone: str(r.timezone) ?? undefined,
  };
}

/** Paid hours for an entry: clock time minus break, never negative. Open entries count up to `now`. */
export function entryHours(e: Pick<TimeEntry, "clockIn" | "clockOut" | "breakMinutes">, now: Date = new Date()): number {
  const start = Date.parse(e.clockIn);
  const end = e.clockOut ? Date.parse(e.clockOut) : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 3_600_000 - (e.breakMinutes || 0) / 60);
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtHours = (h: number) => `${round2(h).toFixed(2)} h`;

/** YYYY-MM-DD of an instant in a time zone. */
export function localDay(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** Monday of the week that contains a YYYY-MM-DD day (weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface PersonWeek {
  resourceId: string; week: string; hours: number; approvedHours: number; regular: number; overtime: number; cost: number | null; entries: number;
}
/**
 * Hours per person per week (Monday start, in the company time zone). Overtime here is simply the hours
 * over 40 in a week, a common federal rule; some states also count daily overtime, so the payroll
 * preparation export is a starting point for whoever runs payroll, not a pay calculation.
 * Rejected entries are left out; open entries count up to now.
 */
export function weeklyTotals(entries: TimeEntry[], tz: string, rates: Record<string, number> = {}, now: Date = new Date()): PersonWeek[] {
  const map = new Map<string, PersonWeek>();
  for (const e of entries) {
    if (e.status === "rejected") continue;
    const week = weekStart(localDay(e.clockIn, tz));
    const key = `${e.resourceId}|${week}`;
    const row = map.get(key) ?? { resourceId: e.resourceId, week, hours: 0, approvedHours: 0, regular: 0, overtime: 0, cost: null, entries: 0 };
    const h = entryHours(e, now);
    row.hours += h;
    if (e.status === "approved") row.approvedHours += h;
    row.entries++;
    map.set(key, row);
  }
  return [...map.values()].map((r) => {
    const regular = Math.min(40, r.hours);
    const rate = rates[r.resourceId];
    return { ...r, hours: round2(r.hours), approvedHours: round2(r.approvedHours), regular: round2(regular), overtime: round2(Math.max(0, r.hours - 40)),
      cost: rate === undefined ? null : round2(r.approvedHours * rate) };
  }).sort((a, b) => a.week.localeCompare(b.week) || a.resourceId.localeCompare(b.resourceId));
}

export interface ProjectLabor { scheduleId: string | null; hours: number; approvedHours: number; cost: number | null; people: number }
/** Approved labor per project: approved hours x each person's hourly cost rate (cost is null when no rate is set). */
export function laborByProject(entries: TimeEntry[], rates: Record<string, number> = {}, now: Date = new Date()): ProjectLabor[] {
  const map = new Map<string, { hours: number; approvedHours: number; cost: number; missingRate: boolean; people: Set<string> }>();
  for (const e of entries) {
    if (e.status === "rejected") continue;
    const k = e.scheduleId ?? "";
    const row = map.get(k) ?? { hours: 0, approvedHours: 0, cost: 0, missingRate: false, people: new Set<string>() };
    const h = entryHours(e, now);
    row.hours += h;
    row.people.add(e.resourceId);
    if (e.status === "approved") {
      row.approvedHours += h;
      const rate = rates[e.resourceId];
      if (rate === undefined) row.missingRate = true; else row.cost += h * rate;
    }
    map.set(k, row);
  }
  return [...map.entries()].map(([k, r]) => ({
    scheduleId: k || null, hours: round2(r.hours), approvedHours: round2(r.approvedHours),
    cost: r.approvedHours > 0 && r.missingRate && r.cost === 0 ? null : round2(r.cost), people: r.people.size,
  })).sort((a, b) => b.hours - a.hours);
}

/** Payroll preparation CSV: one row per person per week. Never a pay or tax calculation. */
export function payrollCsv(weeks: PersonWeek[], names: Record<string, string>, includeCost: boolean): string {
  const head = ["Week starting (Mon)", "Employee", "Total hours", "Approved hours", "Regular hours (up to 40)", "Hours over 40", "Entries", ...(includeCost ? ["Labor cost (approved x cost rate)"] : [])];
  const rows = weeks.map((w) => [w.week, names[w.resourceId] ?? "Unknown", w.hours.toFixed(2), w.approvedHours.toFixed(2), w.regular.toFixed(2), w.overtime.toFixed(2), w.entries,
    ...(includeCost ? [w.cost === null ? "" : w.cost.toFixed(2)] : [])]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Detailed time CSV: every entry with its project, times in the company time zone and status. */
export function timeEntriesCsv(entries: TimeEntry[], names: Record<string, string>, projects: Record<string, string>, tz: string, now: Date = new Date()): string {
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");
  const head = ["Employee", "Project", "Clock in", "Clock out", "Break (min)", "Hours", "Status", "Source", "Edited", "Note"];
  const rows = [...entries].sort((a, b) => a.clockIn.localeCompare(b.clockIn)).map((e) => [
    names[e.resourceId] ?? "Unknown", e.scheduleId ? projects[e.scheduleId] ?? "" : "", fmt(e.clockIn), fmt(e.clockOut), e.breakMinutes,
    entryHours(e, now).toFixed(2), TIME_STATUS_LABEL[e.status], TIME_SOURCE_LABEL[e.source] ?? "Time clock", e.edited ? "Yes" : "", e.note ?? "",
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Rough accuracy label for a punch location (shown next to the map link). */
export function accuracyLabel(p: Punch | null): string | null {
  if (!p) return null;
  if (p.accuracyM === null) return "location recorded";
  if (p.accuracyM <= 50) return `within ${Math.max(1, Math.round(p.accuracyM))} m`;
  if (p.accuracyM <= 500) return `within ${Math.round(p.accuracyM)} m (approximate)`;
  return `within ${(p.accuracyM / 1000).toFixed(1)} km (rough)`;
}
export const mapLink = (p: Punch) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

// ---------------------------------------------------------------------------------------------------
// Subcontractor records
// ---------------------------------------------------------------------------------------------------
export type SubDocType = "w9" | "coi_general_liability" | "workers_comp" | "auto_liability" | "umbrella" | "license" | "subcontract_agreement" | "master_agreement" | "lien_waiver" | "other"
  | "wc_exemption" | "bond" | "safety_program" | "prequalification";
export const SUB_DOC_TYPES: { value: SubDocType; label: string; group: "tax" | "insurance" | "license" | "agreement" | "other"; expires: boolean }[] = [
  { value: "w9", label: "W-9", group: "tax", expires: false },
  { value: "coi_general_liability", label: "General liability certificate", group: "insurance", expires: true },
  { value: "workers_comp", label: "Workers' comp certificate", group: "insurance", expires: true },
  { value: "auto_liability", label: "Auto liability certificate", group: "insurance", expires: true },
  { value: "umbrella", label: "Umbrella / excess certificate", group: "insurance", expires: true },
  { value: "wc_exemption", label: "Workers' comp exemption certificate", group: "license", expires: true },
  { value: "bond", label: "Bond (license, performance or payment)", group: "license", expires: true },
  { value: "license", label: "Contractor license", group: "license", expires: true },
  { value: "subcontract_agreement", label: "Subcontract agreement", group: "agreement", expires: true },
  { value: "master_agreement", label: "Master subcontract agreement (MSA)", group: "agreement", expires: true },
  { value: "lien_waiver", label: "Lien waiver", group: "agreement", expires: false },
  { value: "safety_program", label: "Safety program / OSHA logs", group: "other", expires: true },
  { value: "prequalification", label: "Prequalification form", group: "other", expires: true },
  { value: "other", label: "Other document", group: "other", expires: true },
];
export const docTypeLabel = (t: string) => SUB_DOC_TYPES.find((x) => x.value === t)?.label ?? "Document";

export type TaxClassification = "individual" | "c_corp" | "s_corp" | "partnership" | "trust_estate" | "llc_c" | "llc_s" | "llc_p" | "other";
export const TAX_CLASSIFICATIONS: { value: TaxClassification; label: string; corp: boolean }[] = [
  { value: "individual", label: "Individual / sole proprietor or single-member LLC", corp: false },
  { value: "c_corp", label: "C corporation", corp: true },
  { value: "s_corp", label: "S corporation", corp: true },
  { value: "partnership", label: "Partnership", corp: false },
  { value: "trust_estate", label: "Trust / estate", corp: false },
  { value: "llc_c", label: "LLC taxed as a C corporation", corp: true },
  { value: "llc_s", label: "LLC taxed as an S corporation", corp: true },
  { value: "llc_p", label: "LLC taxed as a partnership", corp: false },
  { value: "other", label: "Other", corp: false },
];

export interface SubTax {
  legalName: string | null; businessName: string | null; taxClassification: TaxClassification | null; tinType: "ssn" | "ein" | null;
  tinLast4: string | null; address: string | null; w9SignedOn: string | null; track1099: boolean | null; tracks1099: boolean;
}
export interface SubDocument {
  id: string; docType: SubDocType; title: string | null; issuer: string | null; policyNumber: string | null; coverageAmount: number | null;
  aggregateAmount: number | null; additionalInsured: boolean | null; waiverOfSubrogation: boolean | null; primaryNoncontributory: boolean | null;
  effectiveOn: string | null; expiresOn: string | null; signedOn: string | null; fileName: string | null; hasFile: boolean; note: string | null;
  status: "on_file" | "replaced" | "removed"; recordedAt: string;
}
export const DIVERSITY_CERTS = {
  mbe: "Minority-owned (MBE)", wbe: "Women-owned (WBE)", dbe: "Disadvantaged (DBE)", sbe: "Small business (SBE)", vosb: "Veteran-owned (VOSB)",
  sdvosb: "Service-disabled veteran-owned (SDVOSB)", hubzone: "HUBZone", "8a": "SBA 8(a)",
} as const;
export type DiversityCert = keyof typeof DIVERSITY_CERTS;
export interface SubProfile {
  paymentTerms: string | null; retainagePct: number | null; backupWithholding: boolean; emr: number | null; yearsInBusiness: number | null;
  diversityCerts: DiversityCert[]; website: string | null; achBankName: string | null; achAccountType: "checking" | "savings" | null; achRouting: string | null;
  prequalifiedOn: string | null;
}
export interface SubRecord {
  resourceId: string; name: string; tax: SubTax | null; documents: SubDocument[];
  profile: SubProfile | null; bank: { onFile: boolean; last4: string | null } | null;
}
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function mapSubRecord(raw: unknown): SubRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  const t = r.tax as Record<string, unknown> | null;
  const pr = r.profile as Record<string, unknown> | null | undefined;
  const bk = r.bank as Record<string, unknown> | null | undefined;
  return {
    resourceId: String(r.resourceId), name: String(r.name ?? ""),
    profile: pr ? {
      paymentTerms: str(pr.paymentTerms), retainagePct: num(pr.retainagePct), backupWithholding: pr.backupWithholding === true, emr: num(pr.emr),
      yearsInBusiness: num(pr.yearsInBusiness), diversityCerts: (Array.isArray(pr.diversityCerts) ? pr.diversityCerts : []).filter((c): c is DiversityCert => typeof c === "string" && c in DIVERSITY_CERTS),
      website: str(pr.website), achBankName: str(pr.achBankName), achAccountType: pr.achAccountType === "checking" || pr.achAccountType === "savings" ? pr.achAccountType : null,
      achRouting: str(pr.achRouting), prequalifiedOn: str(pr.prequalifiedOn),
    } : null,
    // null until the 20270205001000 database update is applied (the card stays hidden).
    bank: bk ? { onFile: bk.onFile === true, last4: str(bk.last4) } : null,
    tax: t ? {
      legalName: str(t.legalName), businessName: str(t.businessName), taxClassification: (str(t.taxClassification) as TaxClassification | null),
      tinType: t.tinType === "ssn" || t.tinType === "ein" ? t.tinType : null, tinLast4: str(t.tinLast4), address: str(t.address),
      w9SignedOn: str(t.w9SignedOn), track1099: typeof t.track1099 === "boolean" ? t.track1099 : null, tracks1099: t.tracks1099 !== false,
    } : null,
    documents: (Array.isArray(r.documents) ? (r.documents as Record<string, unknown>[]) : []).map((d) => ({
      id: String(d.id), docType: String(d.docType) as SubDocType, title: str(d.title), issuer: str(d.issuer), policyNumber: str(d.policyNumber),
      coverageAmount: num(d.coverageAmount), aggregateAmount: num(d.aggregateAmount), additionalInsured: bool(d.additionalInsured),
      waiverOfSubrogation: bool(d.waiverOfSubrogation), primaryNoncontributory: bool(d.primaryNoncontributory), effectiveOn: str(d.effectiveOn), expiresOn: str(d.expiresOn), signedOn: str(d.signedOn),
      fileName: str(d.fileName), hasFile: d.hasFile === true, note: str(d.note),
      status: d.status === "replaced" ? "replaced" : d.status === "removed" ? "removed" : "on_file", recordedAt: String(d.recordedAt ?? ""),
    })),
  };
}

/** Masked tax ID for display: only the last 4 digits are ever stored. */
export const maskTin = (type: "ssn" | "ein" | null, last4: string | null) =>
  !last4 ? "Not recorded" : type === "ein" ? `EIN ••-•••${last4}` : type === "ssn" ? `SSN •••-••-${last4}` : `•••••${last4}`;

export interface ComplianceSummary {
  w9OnFile: boolean; insuranceOnFile: boolean; agreementOnFile: boolean; nextExpiry: string | null; expired: number; expiringSoon: number;
}
export function mapComplianceSummary(raw: unknown): { canManage: boolean; subs: Record<string, ComplianceSummary> } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const subs: Record<string, ComplianceSummary> = {};
  for (const [k, v] of Object.entries((r.subs ?? {}) as Record<string, Record<string, unknown>>)) {
    subs[k] = { w9OnFile: v.w9OnFile === true, insuranceOnFile: v.insuranceOnFile === true, agreementOnFile: v.agreementOnFile === true,
      nextExpiry: str(v.nextExpiry), expired: num(v.expired) ?? 0, expiringSoon: num(v.expiringSoon) ?? 0 };
  }
  return { canManage: r.canManage === true, subs };
}

export type ExpiryState = "expired" | "soon" | "ok" | "none";
/** Expired (before today), expiring within 30 days, fine, or no expiry date. */
export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (!expiresOn) return "none";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, 30) ? "soon" : "ok";
}

/** The badges shown on a subcontractor card. Wording says "on file", never "verified". */
export function complianceBadges(s: ComplianceSummary | undefined): { tone: "ok" | "warn" | "danger" | "neutral"; text: string }[] {
  if (!s) return [];
  const out: { tone: "ok" | "warn" | "danger" | "neutral"; text: string }[] = [];
  if (s.expired > 0) out.push({ tone: "danger", text: `${s.expired} expired` });
  if (s.expiringSoon > 0) out.push({ tone: "warn", text: `${s.expiringSoon} expiring within 30 days` });
  out.push(s.w9OnFile ? { tone: "ok", text: "W-9 on file" } : { tone: "neutral", text: "No W-9" });
  if (!s.insuranceOnFile) out.push({ tone: "neutral", text: "No insurance on file" });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// 1099 totals
// ---------------------------------------------------------------------------------------------------
export interface Row1099 {
  vendorId: string; vendorName: string; vendorKind: string; resourceId: string | null; legalName: string | null; tinType: "ssn" | "ein" | null;
  tinLast4: string | null; taxClassification: string | null; w9OnFile: boolean; tracks1099: boolean; paid: number; cardPaid: number; needs1099: boolean;
}
export interface Totals1099 { year: number; threshold: number; rows: Row1099[] }

/** 1099-NEC reporting threshold: $600 for payments through 2025, $2,000 from tax year 2026. */
export const threshold1099 = (year: number) => (year >= 2026 ? 2000 : 600);

export function map1099(raw: unknown): Totals1099 {
  const r = (raw ?? {}) as Record<string, unknown>;
  const year = num(r.year) ?? new Date().getFullYear();
  return {
    year, threshold: num(r.threshold) ?? threshold1099(year),
    rows: (Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : []).map((x) => ({
      vendorId: String(x.vendorId), vendorName: String(x.vendorName ?? ""), vendorKind: String(x.vendorKind ?? ""), resourceId: str(x.resourceId),
      legalName: str(x.legalName), tinType: x.tinType === "ssn" || x.tinType === "ein" ? x.tinType : null, tinLast4: str(x.tinLast4),
      taxClassification: str(x.taxClassification), w9OnFile: x.w9OnFile === true, tracks1099: x.tracks1099 !== false,
      paid: num(x.paid) ?? 0, cardPaid: num(x.cardPaid) ?? 0, needs1099: x.needs1099 === true,
    })),
  };
}

export function totals1099Csv(t: Totals1099): string {
  const head = ["Payee (as entered)", "Legal name (W-9)", "Tax ID (masked)", "Tax classification", "W-9 on file", "Paid in " + t.year + " (not card)", "Paid by card (not counted)", "Needs a 1099-NEC"];
  const rows = t.rows.map((r) => [r.vendorName, r.legalName ?? "", maskTin(r.tinType, r.tinLast4), TAX_CLASSIFICATIONS.find((c) => c.value === r.taxClassification)?.label ?? "",
    r.w9OnFile ? "Yes" : "No", r.paid.toFixed(2), r.cardPaid.toFixed(2), r.needs1099 ? "Yes" : r.tracks1099 ? "Below threshold" : "Usually not (corporation)"]);
  return [head, ...rows].map((x) => x.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Maps team-records RPC errors to API errors. */
export function recordsDbError(e: { message?: string; code?: string } | null): { status: number; code: string; message: string } {
  const m = e?.message ?? "";
  if (m.includes("duplicate_name")) return { status: 409, code: "duplicate_name", message: "You already have a supplier with that name." };
  if (m.includes("name_required")) return { status: 400, code: "name_required", message: "Add a name." };
  if (m.includes("already_in")) return { status: 409, code: "already_in", message: "Already clocked in. Clock out first." };
  if (m.includes("not_open")) return { status: 409, code: "not_open", message: "That shift was already clocked out. Reload to see the latest." };
  if (m.includes("overlap")) return { status: 409, code: "overlap", message: "That time overlaps another entry for this person." };
  if (m.includes("approved_locked")) return { status: 409, code: "approved_locked", message: "This entry is approved. Reopen it before changing it." };
  if (m.includes("reason_required")) return { status: 400, code: "reason_required", message: "Add a short reason. It's kept with the entry's history." };
  if (m.includes("times_required") || m.includes("bad_times")) return { status: 400, code: "bad_times", message: "Check the clock-in and clock-out times." };
  if (m.includes("too_long")) return { status: 400, code: "too_long", message: "One entry can't be longer than 24 hours. Split it into two." };
  if (m.includes("bad_project")) return { status: 400, code: "bad_project", message: "Pick one of your own projects." };
  if (m.includes("bad_tin")) return { status: 400, code: "bad_tin", message: "Enter only the last 4 digits of the SSN or EIN." };
  if (m.includes("bad_routing")) return { status: 400, code: "bad_routing", message: "That routing number isn't valid. Check the 9 digits on the check or bank letter." };
  if (m.includes("bad_supplier")) return { status: 400, code: "bad_supplier", message: "Pick one of your own suppliers." };
  if (m.includes("forbidden_own")) return { status: 403, code: "forbidden_own", message: "Someone else needs to approve your own time." };
  if (m.includes("disclosure_required")) return { status: 400, code: "disclosure_required", message: "Confirm that your employees were told how GPS time tracking works before switching it on." };
  if (m.includes("location_required")) return { status: 400, code: "location_required", message: "Add and confirm at least one work location before switching GPS time tracking on." };
  if (m.includes("not_w2")) return { status: 400, code: "not_w2", message: "This person is set as a 1099 contractor, owner or other. Change their classification to W-2 first." };
  if (m.includes("bad_classification")) return { status: 400, code: "bad_classification", message: "Pick W-2, 1099, owner or other." };
  if (m.includes("bad_category")) return { status: 400, code: "bad_category", message: "Pick what the time was for: a project, shop, office, training, admin, travel, other paid work or unpaid." };
  if (m.includes("project_required")) return { status: 400, code: "project_required", message: "Pick the project for project work, or choose shop, office, training or another category." };
  if (m.includes("shift_overlap")) return { status: 409, code: "shift_overlap", message: "That overlaps another shift on the same day." };
  if (m.includes("bad_break")) return { status: 400, code: "bad_break", message: "The unpaid break has to be shorter than the shift." };
  if (m.includes("date_required") || m.includes("bad_date")) return { status: 400, code: "bad_date", message: "Pick a date within the next year." };
  if (m.includes("too_many_dates")) return { status: 400, code: "too_many_dates", message: "Schedule up to 62 days at a time." };
  if (m.includes("bad_range")) return { status: 400, code: "bad_range", message: "Pick a shorter date range." };
  if (m.includes("bad_rates") || m.includes("bad_differentials")) return { status: 400, code: "bad_rates", message: "Rates must be numbers of zero or more." };
  if (m.includes("bad_issue")) return { status: 400, code: "bad_issue", message: "Pick what went wrong." };
  if (m.includes("w2_required")) return { status: 400, code: "w2_required", message: "Confirm this person is a W-2 employee whose hours you track before turning on GPS time tracking for them." };
  if (m.includes("staff_only")) return { status: 400, code: "staff_only", message: "GPS time tracking is only for your own employees, not subcontractors, vendors or crews." };
  if (m.includes("bad_radius")) return { status: 400, code: "bad_radius", message: "Pick a radius between 30 m and 0.2 miles (322 m)." };
  if (m.includes("pin_required")) return { status: 400, code: "pin_required", message: "Set the pin on the map first (find the address or use your current location)." };
  if (m.includes("stale_disclosure")) return { status: 409, code: "stale_disclosure", message: "Your company updated its notice. Read it again and accept." };
  if (m.includes("not_enrolled")) return { status: 400, code: "not_enrolled", message: "Your company hasn't turned on GPS time tracking for you." };
  if (m.includes("already_requested")) return { status: 409, code: "already_requested", message: "You already asked for a fix to this entry. Wait for a decision or withdraw it." };
  if (m.includes("not_pending")) return { status: 409, code: "not_pending", message: "That request was already decided." };
  if (m.includes("still_open")) return { status: 409, code: "still_open", message: "Clock out before confirming this week." };
  if (m.includes("bad_location")) return { status: 400, code: "bad_location", message: "Pick one of your company's work locations." };
  if (m.includes("bad_time")) return { status: 400, code: "bad_time", message: "That location event is too old to use." };
  if (m.includes("not_member")) return { status: 400, code: "not_member", message: "Pick an active member of your company." };
  if (m.includes("not_found")) return { status: 404, code: "not_found", message: "That record no longer exists." };
  if (m.includes("forbidden") || e?.code === "42501") return { status: 403, code: "forbidden", message: "You don't have permission to do that." };
  if (m.includes("bad_") || e?.code === "22023" || e?.code === "22P02" || e?.code === "23514") return { status: 400, code: "invalid", message: "Check the details and try again." };
  return { status: 500, code: "server_error", message: "We couldn't save that. Please try again." };
}

/** True when the team-records SQL hasn't been applied yet. */
export const recordsMissing = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42883" || e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|could not find the function/i.test(e.message ?? "")));
