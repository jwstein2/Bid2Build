/**
 * Employee HR files (20270105001000): labels, the page's data shape, and plain-words errors. Shared by the
 * HR routes, the HR pages and tests. No SSN ever passes through here: only whether one is on file and its last 4.
 */
export const HR_DOC_TYPES = [
  { value: "application", label: "Job application", group: "hiring" },
  { value: "resume", label: "Résumé", group: "hiring" },
  { value: "offer_letter", label: "Offer letter", group: "hiring" },
  { value: "background_check", label: "Background check", group: "hiring" },
  { value: "drug_test", label: "Drug test", group: "hiring" },
  { value: "w4", label: "W-4 (federal withholding)", group: "payroll" },
  { value: "state_w4", label: "State withholding form", group: "payroll" },
  { value: "i9", label: "I-9 (work eligibility)", group: "payroll" },
  { value: "direct_deposit", label: "Direct deposit form", group: "payroll" },
  { value: "handbook_ack", label: "Handbook acknowledgment", group: "policy" },
  { value: "license", label: "Driver's or trade license", group: "credentials" },
  { value: "certification", label: "Certification card", group: "credentials" },
  { value: "review", label: "Performance review", group: "employment" },
  { value: "warning", label: "Written warning", group: "employment" },
  { value: "medical", label: "Medical / leave paperwork", group: "employment" },
  { value: "separation", label: "Separation paperwork", group: "employment" },
  { value: "other", label: "Other", group: "employment" },
] as const;
export type HrDocType = (typeof HR_DOC_TYPES)[number]["value"];
export const hrDocLabel = (t: string) => HR_DOC_TYPES.find((d) => d.value === t)?.label ?? t;

export const EMPLOYMENT_TYPES = { full_time: "Full-time", part_time: "Part-time", seasonal: "Seasonal", temporary: "Temporary", intern: "Intern" } as const;
export const EMPLOYMENT_STATUSES = { applicant: "Applicant", active: "Active", on_leave: "On leave", separated: "No longer employed" } as const;
export const SEPARATION_REASONS = { resigned: "Resigned", laid_off: "Laid off", terminated: "Terminated", retired: "Retired", contract_ended: "Job / season ended", other: "Other" } as const;
export const TIME_OFF_KINDS = { pto: "Paid time off", sick: "Sick", unpaid: "Unpaid", holiday: "Holiday", bereavement: "Bereavement", jury: "Jury duty", other: "Other" } as const;

/** camelCase keys the HR save accepts, with their database column. */
export const HR_FIELDS = {
  legalFirstName: "legal_first_name", legalMiddleName: "legal_middle_name", legalLastName: "legal_last_name", preferredName: "preferred_name",
  dateOfBirth: "date_of_birth", personalPhone: "personal_phone", personalEmail: "personal_email", addressLine1: "address_line1", addressLine2: "address_line2",
  city: "city", state: "state", zip: "zip", emergency1Name: "emergency1_name", emergency1Relation: "emergency1_relation", emergency1Phone: "emergency1_phone",
  emergency1AltPhone: "emergency1_alt_phone", emergency2Name: "emergency2_name", emergency2Relation: "emergency2_relation", emergency2Phone: "emergency2_phone",
  employmentType: "employment_type", employmentStatus: "employment_status", department: "department", supervisorId: "supervisor_id", workLocation: "work_location",
  separationDate: "separation_date", separationReason: "separation_reason", rehireEligible: "rehire_eligible", i9CompletedOn: "i9_completed_on",
  i9ReverifyOn: "i9_reverify_on", ptoHoursPerYear: "pto_hours_per_year", sickHoursPerYear: "sick_hours_per_year", notes: "notes",
} as const;
export type HrField = keyof typeof HR_FIELDS;
export type HrValues = Partial<Record<HrField, string | number | boolean | null>>;

/** Readable names for the audit trail (field names only; values are never stored there). */
export const HR_FIELD_LABEL: Record<string, string> = {
  legal_first_name: "legal first name", legal_middle_name: "middle name", legal_last_name: "legal last name", preferred_name: "preferred name",
  date_of_birth: "date of birth", personal_phone: "personal phone", personal_email: "personal email", address_line1: "address", address_line2: "address",
  city: "city", state: "state", zip: "ZIP", emergency1_name: "emergency contact", emergency1_relation: "emergency contact", emergency1_phone: "emergency contact",
  emergency1_alt_phone: "emergency contact", emergency2_name: "second emergency contact", emergency2_relation: "second emergency contact", emergency2_phone: "second emergency contact",
  employment_type: "employment type", employment_status: "status", department: "department", supervisor_id: "supervisor", work_location: "work location",
  separation_date: "separation date", separation_reason: "separation reason", rehire_eligible: "rehire eligibility", i9_completed_on: "I-9 date",
  i9_reverify_on: "I-9 reverification", pto_hours_per_year: "PTO allowance", sick_hours_per_year: "sick allowance", notes: "notes",
};

export function describeHistory(action: string, fields: string[]): string {
  if (action === "hr_file.updated") return `Updated ${[...new Set(fields.map((f) => HR_FIELD_LABEL[f] ?? f))].join(", ")}`;
  const [what, verb] = action.split(".");
  const subject = what === "ssn" ? "Social Security number" : what === "document" ? hrDocLabel(fields[0] ?? "") : what === "certification" ? `Certification ${fields[0] ?? ""}`.trim() : what === "time_off" ? "Time off" : action;
  const v = { saved: "saved", revealed: "viewed", removed: "removed", exported: "exported", added: "added", opened: "opened", approved: "approved", denied: "denied", canceled: "canceled" }[verb ?? ""] ?? verb;
  return `${subject} ${v}`;
}

export interface HrFile {
  resourceId: string; name: string; email: string | null; phone: string | null;
  profile: { title: string | null; payType: string | null; hireDate: string | null } | null;
  hr: Record<string, string | number | boolean | null> | null;
  ssn: { onFile: boolean; last4: string | null };
  documents: { id: string; docType: HrDocType; title: string | null; signedOn: string | null; expiresOn: string | null; note: string | null; fileName: string | null; hasFile: boolean; recordedAt: string }[];
  certifications: { id: string; name: string; issuer: string | null; number: string | null; issuedOn: string | null; expiresOn: string | null; note: string | null }[];
  timeOff: { id: string; kind: keyof typeof TIME_OFF_KINDS; startDate: string; endDate: string; hours: number; status: "requested" | "approved" | "denied" | "canceled"; note: string | null }[];
  balances: { year: number; ptoAllowance: number | null; sickAllowance: number | null; ptoUsed: number; sickUsed: number };
  supervisors: { id: string; name: string }[];
  history: { action: string; fields: string[]; at: string; by: string }[];
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function mapHrFile(raw: unknown): HrFile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const p = r.profile as Record<string, unknown> | null;
  const s = (r.ssn ?? {}) as Record<string, unknown>;
  const b = (r.balances ?? {}) as Record<string, unknown>;
  return {
    resourceId: String(r.resourceId), name: String(r.name ?? ""), email: str(r.email), phone: str(r.phone),
    profile: p ? { title: str(p.title), payType: str(p.payType), hireDate: str(p.hireDate) } : null,
    hr: (r.hr as HrFile["hr"]) ?? null,
    ssn: { onFile: s.onFile === true, last4: str(s.last4) },
    documents: arr(r.documents).map((d) => ({ id: String(d.id), docType: String(d.docType) as HrDocType, title: str(d.title), signedOn: str(d.signedOn), expiresOn: str(d.expiresOn),
      note: str(d.note), fileName: str(d.fileName), hasFile: d.hasFile === true, recordedAt: String(d.recordedAt ?? "") })),
    certifications: arr(r.certifications).map((c) => ({ id: String(c.id), name: String(c.name ?? ""), issuer: str(c.issuer), number: str(c.number), issuedOn: str(c.issuedOn), expiresOn: str(c.expiresOn), note: str(c.note) })),
    timeOff: arr(r.timeOff).map((e) => ({ id: String(e.id), kind: String(e.kind) as keyof typeof TIME_OFF_KINDS, startDate: String(e.startDate), endDate: String(e.endDate), hours: Number(e.hours),
      status: String(e.status) as HrFile["timeOff"][number]["status"], note: str(e.note) })),
    balances: { year: Number(b.year ?? new Date().getFullYear()), ptoAllowance: num(b.ptoAllowance), sickAllowance: num(b.sickAllowance), ptoUsed: Number(b.ptoUsed ?? 0), sickUsed: Number(b.sickUsed ?? 0) },
    supervisors: arr(r.supervisors).map((x) => ({ id: String(x.id), name: String(x.name ?? "") })),
    history: arr(r.history).map((x) => ({ action: String(x.action), fields: Array.isArray(x.fields) ? (x.fields as string[]) : [], at: String(x.at), by: String(x.by ?? "") }))
      .sort((a, b2) => b2.at.localeCompare(a.at)).slice(0, 30),
  };
}

/** HR form values from the stored file (column names -> camelCase), all as strings for inputs. */
export function hrFormValues(hr: HrFile["hr"]): Record<HrField, string> {
  const out = {} as Record<HrField, string>;
  for (const [k, col] of Object.entries(HR_FIELDS) as [HrField, string][]) {
    const v = hr?.[col];
    out[k] = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  }
  if (!out.employmentStatus) out.employmentStatus = "active";
  return out;
}

/** Only the fields that changed, typed for the database ("" clears). */
export function hrChanges(before: Record<HrField, string>, after: Record<HrField, string>): HrValues {
  const out: HrValues = {};
  for (const k of Object.keys(HR_FIELDS) as HrField[]) {
    if ((before[k] ?? "") === (after[k] ?? "")) continue;
    const v = (after[k] ?? "").trim();
    if (k === "rehireEligible") out[k] = v === "" ? null : v === "yes";
    else if (k === "ptoHoursPerYear" || k === "sickHoursPerYear") out[k] = v === "" ? null : Number(v);
    else out[k] = v;
  }
  return out;
}

export function hrDbError(e: { message?: string; code?: string } | null): { status: number; code: string; message: string } | null {
  const m = e?.message ?? "";
  if (m.includes("unknown_field")) return { status: 400, code: "invalid", message: "Something on the form isn't recognized. Reload and try again." };
  if (m.includes("bad_supervisor")) return { status: 400, code: "invalid", message: "Pick another employee as supervisor." };
  if (m.includes("bad_email")) return { status: 400, code: "invalid", message: "Check the personal email address." };
  if (m.includes("not_member")) return { status: 400, code: "invalid", message: "Only active members of your company can be HR managers." };
  if (m.includes("forbidden") || e?.code === "42501") return { status: 403, code: "forbidden", message: "Only the owner and HR managers can open HR files." };
  return null;
}

export interface HrOverview {
  canManage: boolean; isOwner: boolean;
  managers: { userId: string; name: string; hr: boolean }[];
  people: { resourceId: string; name: string; resourceStatus: string; employmentStatus: keyof typeof EMPLOYMENT_STATUSES; hrStarted: boolean; ssnOnFile: boolean; emergencyOnFile: boolean; i9OnFile: boolean; w4OnFile: boolean; nextExpiry: string | null; expired: number }[];
}
export function mapHrOverview(raw: unknown): HrOverview {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    canManage: r.canManage === true, isOwner: r.isOwner === true,
    managers: arr(r.managers).map((m) => ({ userId: String(m.userId), name: String(m.name ?? ""), hr: m.hr === true })),
    people: arr(r.people).map((p) => ({ resourceId: String(p.resourceId), name: String(p.name ?? ""), resourceStatus: String(p.resourceStatus ?? "active"),
      employmentStatus: (String(p.employmentStatus ?? "active") as HrOverview["people"][number]["employmentStatus"]), hrStarted: p.hrStarted === true, ssnOnFile: p.ssnOnFile === true,
      emergencyOnFile: p.emergencyOnFile === true, i9OnFile: p.i9OnFile === true, w4OnFile: p.w4OnFile === true, nextExpiry: str(p.nextExpiry), expired: Number(p.expired ?? 0) })),
  };
}
