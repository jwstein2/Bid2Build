/**
 * Bulk import of employees and subcontractors from a CSV or Excel sheet. Pure helpers shared by the import page,
 * the import route and tests: the column catalog (which doubles as the downloadable template and field guide),
 * header matching (our template, plus common headers from payroll and HR exports), and per-cell validation.
 * The server re-runs the same validation before writing anything. Nothing here talks to the database.
 */
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, FLSA_STATUSES, PAY_FREQUENCIES, routingOk, W4_FILING_STATUSES } from "./hr";
import { DIVERSITY_CERTS, TAX_CLASSIFICATIONS } from "./records";

export type ImportKind = "employees" | "subs";
export type ColType = "text" | "email" | "phone" | "date" | "money" | "number" | "int" | "bool" | "enum" | "list" | "ssn" | "tin" | "routing" | "account" | "state";
export type Section = "Directory" | "Job" | "Personal" | "Emergency contacts" | "Pay and classification" | "Tax withholding" | "Direct deposit" | "Sensitive (encrypted)"
  | "W-9" | "Business and payment" | "General liability" | "Workers' comp" | "Auto liability" | "License";

export interface Column {
  key: string; header: string; section: Section; type: ColType; required?: boolean; max?: number;
  /** enum: stored value -> words accepted (the first is shown in the guide). */
  options?: Record<string, string[]>;
  aliases?: string[]; example?: string; help?: string; min?: number; maxValue?: number;
}

const opts = (o: Record<string, string>, extra: Record<string, string[]> = {}): Record<string, string[]> =>
  Object.fromEntries(Object.entries(o).map(([k, label]) => [k, [label, k, ...(extra[k] ?? [])]]));
const YES_NO = "yes / no";

export const EMPLOYEE_COLUMNS: Column[] = [
  { key: "name", header: "Name", section: "Directory", type: "text", required: true, max: 200, aliases: ["full name", "employee name", "employee", "team member"], example: "Cris Lopez", help: "How they show up on schedules. Used to match people already in Built2Bid (with work email)." },
  { key: "email", header: "Work email", section: "Directory", type: "email", aliases: ["email", "email address", "work email address"], example: "cris@example.com" },
  { key: "phone", header: "Work phone", section: "Directory", type: "phone", aliases: ["phone", "mobile", "cell", "phone number", "mobile phone"], example: "555-201-4410" },
  { key: "trades", header: "Trades", section: "Directory", type: "list", aliases: ["trade", "skills"], example: "framing; drywall", help: "Separate with ; or |" },
  { key: "title", header: "Job title", section: "Job", type: "text", max: 120, aliases: ["title", "position", "job"], example: "Lead carpenter" },
  { key: "payType", header: "Pay type", section: "Job", type: "enum", options: { hourly: ["Hourly"], salary: ["Salary", "salaried"], owner: ["Owner"], other: ["Other"] }, example: "Hourly" },
  { key: "hourlyCost", header: "Loaded hourly cost", section: "Job", type: "money", maxValue: 10000, aliases: ["hourly cost", "burdened rate", "cost per hour"], example: "41.50", help: "What an hour costs you with taxes and insurance. Used for job costing." },
  { key: "hireDate", header: "Hire date", section: "Job", type: "date", aliases: ["start date", "date hired", "hired"], example: "2026-03-02" },
  { key: "employmentType", header: "Employment type", section: "Job", type: "enum", options: opts(EMPLOYMENT_TYPES, { full_time: ["full time", "ft"], part_time: ["part time", "pt"], temporary: ["temp"] }), example: "Full-time" },
  { key: "employmentStatus", header: "Status", section: "Job", type: "enum", options: opts(EMPLOYMENT_STATUSES, { separated: ["terminated", "inactive", "former"], on_leave: ["leave"] }), aliases: ["employment status"], example: "Active" },
  { key: "department", header: "Department or crew", section: "Job", type: "text", max: 100, aliases: ["department", "crew"], example: "Framing crew" },
  { key: "workLocation", header: "Work location", section: "Job", type: "text", max: 200, aliases: ["location", "work site"], example: "Minneapolis, MN" },
  { key: "legalFirstName", header: "Legal first name", section: "Personal", type: "text", max: 100, aliases: ["first name", "first"], example: "Cristina" },
  { key: "legalMiddleName", header: "Middle name", section: "Personal", type: "text", max: 100, aliases: ["middle name", "middle initial", "middle"], example: "" },
  { key: "legalLastName", header: "Legal last name", section: "Personal", type: "text", max: 100, aliases: ["last name", "last", "surname"], example: "Lopez" },
  { key: "preferredName", header: "Preferred name", section: "Personal", type: "text", max: 100, aliases: ["nickname", "goes by"], example: "Cris" },
  { key: "dateOfBirth", header: "Date of birth", section: "Personal", type: "date", aliases: ["birthday", "dob", "birth date"], example: "1990-04-02" },
  { key: "personalPhone", header: "Personal phone", section: "Personal", type: "phone", aliases: ["home phone", "personal cell"], example: "555-201-4411" },
  { key: "personalEmail", header: "Personal email", section: "Personal", type: "email", aliases: ["home email"], example: "cris.lopez@example.net" },
  { key: "addressLine1", header: "Home address", section: "Personal", type: "text", max: 200, aliases: ["address", "street address", "address line 1", "street"], example: "123 Main St" },
  { key: "addressLine2", header: "Apt or unit", section: "Personal", type: "text", max: 200, aliases: ["address line 2", "apt", "unit", "suite"], example: "" },
  { key: "city", header: "City", section: "Personal", type: "text", max: 100, example: "St. Paul" },
  { key: "state", header: "State", section: "Personal", type: "text", max: 40, aliases: ["home state"], example: "MN" },
  { key: "zip", header: "ZIP", section: "Personal", type: "text", max: 20, aliases: ["zip code", "postal code", "zipcode"], example: "55101" },
  { key: "emergency1Name", header: "Emergency contact name", section: "Emergency contacts", type: "text", max: 200, aliases: ["emergency contact", "emergency name"], example: "Ana Lopez" },
  { key: "emergency1Relation", header: "Emergency contact relationship", section: "Emergency contacts", type: "text", max: 60, aliases: ["emergency relationship", "relationship"], example: "Sister" },
  { key: "emergency1Phone", header: "Emergency contact phone", section: "Emergency contacts", type: "phone", aliases: ["emergency phone"], example: "555-201-4412" },
  { key: "emergency1AltPhone", header: "Emergency contact other phone", section: "Emergency contacts", type: "phone", example: "" },
  { key: "emergency2Name", header: "Second emergency contact name", section: "Emergency contacts", type: "text", max: 200, example: "" },
  { key: "emergency2Relation", header: "Second emergency contact relationship", section: "Emergency contacts", type: "text", max: 60, example: "" },
  { key: "emergency2Phone", header: "Second emergency contact phone", section: "Emergency contacts", type: "phone", example: "" },
  { key: "employeeNumber", header: "Employee ID", section: "Pay and classification", type: "text", max: 40, aliases: ["employee number", "employee #", "emp id", "id"], example: "E-104" },
  { key: "payRate", header: "Pay rate", section: "Pay and classification", type: "money", maxValue: 10000000, aliases: ["rate", "wage", "hourly rate", "salary"], example: "32.50" },
  { key: "payRateUnit", header: "Pay rate per", section: "Pay and classification", type: "enum", options: { hour: ["Hour", "hourly", "hr"], year: ["Year", "annual", "yearly", "salary"] }, aliases: ["pay per", "rate unit"], example: "Hour" },
  { key: "payFrequency", header: "Pay frequency", section: "Pay and classification", type: "enum", options: opts(PAY_FREQUENCIES, { biweekly: ["bi-weekly", "every other week"], semimonthly: ["semi-monthly", "twice monthly"] }), aliases: ["pay schedule", "pay period"], example: "Every 2 weeks" },
  { key: "flsaStatus", header: "Overtime status (FLSA)", section: "Pay and classification", type: "enum", options: opts(FLSA_STATUSES, { non_exempt: ["non-exempt", "nonexempt", "Non-exempt"], exempt: ["Exempt"] }), aliases: ["flsa", "flsa status", "exempt status", "overtime"], example: "Non-exempt" },
  { key: "tradeClassification", header: "Trade classification", section: "Pay and classification", type: "text", max: 100, aliases: ["classification", "craft", "job classification"], example: "Carpenter - Journeyman", help: "For prevailing wage / certified payroll." },
  { key: "wcClassCode", header: "Workers' comp class code", section: "Pay and classification", type: "text", max: 20, aliases: ["wc code", "workers comp code", "class code"], example: "5403" },
  { key: "unionLocal", header: "Union local", section: "Pay and classification", type: "text", max: 100, aliases: ["union"], example: "" },
  { key: "newHireReportedOn", header: "New-hire reported to state on", section: "Pay and classification", type: "date", aliases: ["new hire reported"], example: "2026-03-05" },
  { key: "i9CompletedOn", header: "I-9 completed on", section: "Pay and classification", type: "date", aliases: ["i9 date", "i-9 date"], example: "2026-03-02" },
  { key: "i9ReverifyOn", header: "I-9 reverify by", section: "Pay and classification", type: "date", aliases: ["work authorization expires"], example: "" },
  { key: "ptoHoursPerYear", header: "PTO hours per year", section: "Pay and classification", type: "number", maxValue: 2000, aliases: ["pto hours", "vacation hours"], example: "80" },
  { key: "sickHoursPerYear", header: "Sick hours per year", section: "Pay and classification", type: "number", maxValue: 2000, aliases: ["sick hours"], example: "40" },
  { key: "w4FilingStatus", header: "W-4 filing status", section: "Tax withholding", type: "enum", options: opts(W4_FILING_STATUSES, { single: ["Single", "married filing separately"], married_jointly: ["married", "mfj"], head_of_household: ["hoh"] }), aliases: ["filing status", "federal filing status"], example: "Married filing jointly" },
  { key: "w4MultipleJobs", header: "W-4 multiple jobs (step 2)", section: "Tax withholding", type: "bool", aliases: ["multiple jobs"], example: "no" },
  { key: "w4DependentsAmount", header: "W-4 dependents amount (step 3)", section: "Tax withholding", type: "money", maxValue: 1000000, aliases: ["dependents amount", "dependents"], example: "4000" },
  { key: "w4OtherIncome", header: "W-4 other income (step 4a)", section: "Tax withholding", type: "money", maxValue: 100000000, example: "" },
  { key: "w4Deductions", header: "W-4 deductions (step 4b)", section: "Tax withholding", type: "money", maxValue: 100000000, example: "" },
  { key: "w4ExtraWithholding", header: "W-4 extra withholding (step 4c)", section: "Tax withholding", type: "money", maxValue: 1000000, aliases: ["extra withholding", "additional withholding"], example: "25" },
  { key: "w4Exempt", header: "W-4 exempt", section: "Tax withholding", type: "bool", aliases: ["federal exempt"], example: "no" },
  { key: "w4SignedOn", header: "W-4 signed on", section: "Tax withholding", type: "date", example: "2026-03-01" },
  { key: "stateWithholdingState", header: "Withholding state", section: "Tax withholding", type: "state", aliases: ["work state", "tax state", "state withholding state"], example: "MN" },
  { key: "stateAllowances", header: "State allowances", section: "Tax withholding", type: "int", maxValue: 99, aliases: ["state exemptions"], example: "2" },
  { key: "stateExtraWithholding", header: "State extra withholding", section: "Tax withholding", type: "money", maxValue: 1000000, example: "" },
  { key: "stateExempt", header: "State exempt", section: "Tax withholding", type: "bool", example: "no" },
  { key: "ddBankName", header: "Bank name", section: "Direct deposit", type: "text", max: 100, aliases: ["direct deposit bank"], example: "First Bank" },
  { key: "ddAccountType", header: "Account type", section: "Direct deposit", type: "enum", options: { checking: ["Checking"], savings: ["Savings"] }, aliases: ["bank account type"], example: "Checking" },
  { key: "ddRouting", header: "Routing number", section: "Direct deposit", type: "routing", aliases: ["routing", "aba", "routing #", "bank routing number"], example: "011000015" },
  { key: "bankAccount", header: "Bank account number", section: "Sensitive (encrypted)", type: "account", aliases: ["account number", "account #", "bank account"], example: "", help: "Encrypted on arrival; only the last 4 are shown." },
  { key: "ssn", header: "SSN", section: "Sensitive (encrypted)", type: "ssn", aliases: ["social security number", "social security", "ss#", "ssn #"], example: "", help: "Encrypted on arrival; only the last 4 are shown." },
];

const CLASS_ALIASES: Record<string, string[]> = {
  individual: ["Individual", "sole proprietor", "sole prop", "single-member llc", "single member llc"], c_corp: ["C corp", "c corporation"], s_corp: ["S corp", "s corporation"],
  partnership: ["Partnership"], trust_estate: ["Trust", "estate"], llc_c: ["LLC C"], llc_s: ["LLC S"], llc_p: ["LLC P", "llc partnership"], other: ["Other"],
};

export const SUB_COLUMNS: Column[] = [
  { key: "name", header: "Company or person name", section: "Directory", type: "text", required: true, max: 200, aliases: ["name", "company", "company name", "vendor", "vendor name", "subcontractor", "business name dba"], example: "Stone Works LLC", help: "Used to match subs already in Built2Bid (with email)." },
  { key: "entity", header: "Company or individual", section: "Directory", type: "enum", options: { company: ["Company", "business", "crew"], individual: ["Individual", "person", "solo"] }, aliases: ["entity", "type"], example: "Company" },
  { key: "contactName", header: "Contact name", section: "Directory", type: "text", max: 200, aliases: ["contact", "primary contact"], example: "Dana Stone" },
  { key: "email", header: "Email", section: "Directory", type: "email", aliases: ["email address", "contact email"], example: "office@stoneworks.example" },
  { key: "phone", header: "Phone", section: "Directory", type: "phone", aliases: ["phone number", "office phone", "mobile"], example: "555-330-1200" },
  { key: "trades", header: "Trades", section: "Directory", type: "list", aliases: ["trade", "scope"], example: "masonry; concrete", help: "Separate with ; or |" },
  { key: "legalName", header: "Legal name (W-9 line 1)", section: "W-9", type: "text", max: 200, aliases: ["legal name", "w9 name"], example: "Stone Works LLC" },
  { key: "businessName", header: "Business name (W-9 line 2)", section: "W-9", type: "text", max: 200, aliases: ["dba", "doing business as"], example: "" },
  { key: "taxClassification", header: "Tax classification", section: "W-9", type: "enum", options: Object.fromEntries(TAX_CLASSIFICATIONS.map((c) => [c.value, [c.label, c.value, ...(CLASS_ALIASES[c.value] ?? [])]])), aliases: ["federal tax classification", "entity type"], example: "LLC taxed as a partnership" },
  { key: "tinType", header: "Tax ID type", section: "W-9", type: "enum", options: { ein: ["EIN", "fein"], ssn: ["SSN"] }, aliases: ["tin type"], example: "EIN" },
  { key: "tin", header: "Tax ID (EIN or SSN)", section: "Sensitive (encrypted)", type: "tin", aliases: ["tin", "ein", "tax id", "federal tax id", "fein"], example: "", help: "Full 9 digits are encrypted on arrival; last 4 alone is fine too." },
  { key: "w9Address", header: "W-9 address", section: "W-9", type: "text", max: 500, aliases: ["address", "mailing address", "remit address"], example: "40 Quarry Rd, Mankato, MN 56001" },
  { key: "w9SignedOn", header: "W-9 signed on", section: "W-9", type: "date", aliases: ["w9 date"], example: "2026-01-15" },
  { key: "paymentTerms", header: "Payment terms", section: "Business and payment", type: "text", max: 60, aliases: ["terms"], example: "Net 30" },
  { key: "retainagePct", header: "Retainage %", section: "Business and payment", type: "number", maxValue: 50, aliases: ["retainage", "retention"], example: "10" },
  { key: "backupWithholding", header: "Backup withholding", section: "Business and payment", type: "bool", example: "no" },
  { key: "emr", header: "EMR (safety rating)", section: "Business and payment", type: "number", maxValue: 5, aliases: ["emr", "experience modifier", "mod rate"], example: "0.85" },
  { key: "yearsInBusiness", header: "Years in business", section: "Business and payment", type: "int", maxValue: 300, example: "12" },
  { key: "diversityCerts", header: "Certified business types", section: "Business and payment", type: "list", aliases: ["diversity", "certifications", "mbe/wbe"], example: "WBE; DBE", help: `Any of: ${Object.keys(DIVERSITY_CERTS).map((k) => k.toUpperCase()).join(", ")}` },
  { key: "website", header: "Website", section: "Business and payment", type: "text", max: 300, example: "stoneworks.example" },
  { key: "prequalifiedOn", header: "Prequalified on", section: "Business and payment", type: "date", example: "" },
  { key: "achBankName", header: "ACH bank name", section: "Business and payment", type: "text", max: 100, aliases: ["bank name"], example: "" },
  { key: "achAccountType", header: "ACH account type", section: "Business and payment", type: "enum", options: { checking: ["Checking"], savings: ["Savings"] }, aliases: ["account type"], example: "" },
  { key: "achRouting", header: "ACH routing number", section: "Business and payment", type: "routing", aliases: ["routing number", "routing", "aba"], example: "" },
  { key: "achAccount", header: "ACH account number", section: "Sensitive (encrypted)", type: "account", aliases: ["account number", "bank account number"], example: "", help: "Encrypted on arrival; only the last 4 are shown." },
  { key: "glInsurer", header: "GL insurer", section: "General liability", type: "text", max: 200, aliases: ["general liability insurer", "gl carrier"], example: "Acme Mutual" },
  { key: "glPolicy", header: "GL policy number", section: "General liability", type: "text", max: 80, aliases: ["gl policy"], example: "GL-778812" },
  { key: "glEachOccurrence", header: "GL each occurrence", section: "General liability", type: "money", maxValue: 1e12, aliases: ["gl limit", "gl per occurrence"], example: "1000000" },
  { key: "glAggregate", header: "GL aggregate", section: "General liability", type: "money", maxValue: 1e12, example: "2000000" },
  { key: "glExpires", header: "GL expires", section: "General liability", type: "date", aliases: ["gl expiration", "coi expires", "insurance expires"], example: "2027-01-31" },
  { key: "glAdditionalInsured", header: "GL additional insured", section: "General liability", type: "bool", aliases: ["additional insured"], example: "yes" },
  { key: "glWaiver", header: "GL waiver of subrogation", section: "General liability", type: "bool", example: "yes" },
  { key: "glPrimary", header: "GL primary and non-contributory", section: "General liability", type: "bool", example: "yes" },
  { key: "wcInsurer", header: "Workers' comp insurer", section: "Workers' comp", type: "text", max: 200, aliases: ["wc insurer", "wc carrier"], example: "State Fund" },
  { key: "wcPolicy", header: "Workers' comp policy number", section: "Workers' comp", type: "text", max: 80, aliases: ["wc policy"], example: "WC-55120" },
  { key: "wcExpires", header: "Workers' comp expires", section: "Workers' comp", type: "date", aliases: ["wc expires", "wc expiration"], example: "2027-01-31" },
  { key: "wcWaiver", header: "Workers' comp waiver of subrogation", section: "Workers' comp", type: "bool", aliases: ["wc waiver"], example: "yes" },
  { key: "autoInsurer", header: "Auto insurer", section: "Auto liability", type: "text", max: 200, example: "" },
  { key: "autoPolicy", header: "Auto policy number", section: "Auto liability", type: "text", max: 80, example: "" },
  { key: "autoLimit", header: "Auto combined limit", section: "Auto liability", type: "money", maxValue: 1e12, example: "" },
  { key: "autoExpires", header: "Auto expires", section: "Auto liability", type: "date", example: "" },
  { key: "licenseNumber", header: "Contractor license number", section: "License", type: "text", max: 80, aliases: ["license number", "license #", "license"], example: "BC123456" },
  { key: "licenseIssuer", header: "License issued by", section: "License", type: "text", max: 200, aliases: ["license state", "licensing board"], example: "Minnesota DLI" },
  { key: "licenseExpires", header: "License expires", section: "License", type: "date", aliases: ["license expiration"], example: "2028-03-31" },
];

export const columnsFor = (kind: ImportKind) => (kind === "employees" ? EMPLOYEE_COLUMNS : SUB_COLUMNS);
export const MAX_IMPORT_PEOPLE = 1000;
export const IMPORT_CHUNK = 25;

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9#]+/g, " ").trim();

/** Which column each header is (index -> key), plus headers we don't use. The first match wins. */
export function matchHeaders(kind: ImportKind, headers: string[]): { map: (string | null)[]; ignored: string[]; missingRequired: string[] } {
  const cols = columnsFor(kind);
  const lookup = new Map<string, string>();
  for (const c of cols) for (const h of [c.header, c.key, ...(c.aliases ?? [])]) if (!lookup.has(norm(h))) lookup.set(norm(h), c.key);
  // Our own headers win over aliases ("Name" is the employee template's own header; aliases never override it).
  for (const c of cols) lookup.set(norm(c.header), c.key);
  const used = new Set<string>();
  const map = headers.map((h) => {
    const k = lookup.get(norm(h.replace(/\*/g, ""))) ?? null;
    if (!k || used.has(k)) return null;
    used.add(k);
    return k;
  });
  const ignored = headers.filter((h, i) => h.trim() !== "" && map[i] === null);
  // Payroll exports often have first + last name and no single name column: the name is built from them.
  const nameFromParts = kind === "employees" && used.has("legalFirstName") && used.has("legalLastName");
  const missingRequired = cols.filter((c) => c.required && !used.has(c.key) && !(c.key === "name" && nameFromParts)).map((c) => c.header);
  return { map, ignored, missingRequired };
}

export type Cell = string | number | boolean | string[];
export interface ImportResult { line: number; name: string; action: "created" | "updated" | "failed" | "new" | "match"; message?: string; warnings: string[] }
export interface ParsedRow { line: number; name: string; values: Record<string, Cell>; errors: string[]; warnings: string[] }

/** A cell a spreadsheet would treat as a formula. Never evaluated; refused. */
const looksLikeFormula = (v: string) => /^[=+@\t\r]/.test(v) || /^-[^\d.\s]/.test(v);

export function parseDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) { m = +r[1]; d = +r[2]; y = +r[3]; if (r[3].length === 2) y += y < 50 ? 2000 : 1900; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseBool(v: string): boolean | null {
  const s = norm(v);
  if (["yes", "y", "true", "1", "x", "checked"].includes(s)) return true;
  if (["no", "n", "false", "0", "unchecked"].includes(s)) return false;
  return null;
}

function parseEnum(c: Column, v: string): string | null {
  const s = norm(v);
  for (const [value, words] of Object.entries(c.options ?? {})) if (words.some((w) => norm(w) === s)) return value;
  return null;
}

/** Validate one cell. Returns the typed value, or an error in plain words. "" means blank (skipped). */
export function parseCell(c: Column, raw: string): { value?: Cell; error?: string } {
  const v = (raw ?? "").trim();
  if (v === "") return {};
  if (looksLikeFormula(v)) return { error: `${c.header}: looks like a spreadsheet formula, so it wasn't read` };
  const bad = (what: string) => ({ error: `${c.header}: ${what}` });
  switch (c.type) {
    case "text": return v.length > (c.max ?? 500) ? bad(`longer than ${c.max ?? 500} characters`) : { value: v };
    case "phone": return v.length > 40 ? bad("too long") : { value: v };
    case "email": return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 320 ? { value: v.toLowerCase() } : bad(`"${v}" isn't an email address`);
    case "date": { const d = parseDate(v); return d ? { value: d } : bad(`"${v}" isn't a date (use 2026-03-02 or 3/2/2026)`); }
    case "money": case "number": case "int": {
      const n = Number(v.replace(/[$,%\s]/g, ""));
      if (!Number.isFinite(n) || n < (c.min ?? 0)) return bad(`"${v}" isn't a number`);
      if (c.type === "int" && !Number.isInteger(n)) return bad("use a whole number");
      if (c.maxValue !== undefined && n > c.maxValue) return bad(`can't be more than ${c.maxValue.toLocaleString("en-US")}`);
      return { value: Math.round(n * 100) / 100 };
    }
    case "bool": { const b = parseBool(v); return b === null ? bad(`use ${YES_NO}`) : { value: b }; }
    case "enum": { const e = parseEnum(c, v); return e ? { value: e } : bad(`"${v}" isn't one of: ${Object.values(c.options ?? {}).map((w) => w[0]).join(", ")}`); }
    case "list": {
      const items = v.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      if (c.key === "diversityCerts") {
        const out = items.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const unknown = out.filter((x) => !(x in DIVERSITY_CERTS));
        return unknown.length ? bad(`unknown type ${unknown.join(", ")}`) : { value: [...new Set(out)] };
      }
      return items.length > 20 ? bad("20 at most") : { value: items.map((x) => x.slice(0, 40)) };
    }
    case "state": return /^[A-Za-z]{2}$/.test(v) ? { value: v.toUpperCase() } : bad("use the 2-letter state code, like MN");
    case "routing": { const d = v.replace(/[\s-]/g, ""); return routingOk(d) ? { value: d } : bad("isn't a valid 9-digit routing number"); }
    case "account": { const d = v.replace(/[\s-]/g, ""); return /^\d{4,17}$/.test(d) ? { value: d } : bad("use 4 to 17 digits"); }
    case "ssn": { const d = v.replace(/[\s-]/g, ""); return /^\d{9}$/.test(d) && !/^0{9}$/.test(d) ? { value: d } : bad("use the 9-digit number"); }
    case "tin": { const d = v.replace(/[\s-]/g, ""); return /^\d{9}$/.test(d) && !/^0{9}$/.test(d) || /^\d{4}$/.test(d) ? { value: d } : bad("use all 9 digits, or just the last 4"); }
  }
}

/** Rows keyed by column key (raw strings), from a sheet's header + data rows. Example rows are skipped. */
/** Reports exported from QuickBooks, payroll and accounting apps put the company name, report title and date
 *  range above the column names. The header is the first of the opening rows that has the required columns. */
const HEADER_SCAN_ROWS = 10;
export function headerRowIndex(kind: ImportKind, table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, HEADER_SCAN_ROWS); i++) {
    const row = table[i] ?? [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    if (matchHeaders(kind, row.map((c) => String(c ?? ""))).missingRequired.length === 0) return i;
  }
  return 0;
}

/** Only our own template's sample row ("EXAMPLE … (delete this row)"); a real "Example Roofing" is imported. */
export const isTemplateExampleRow = (name: string | undefined) => /^\s*example\b.*\(delete this row\)\s*$/i.test(name ?? "");

export function sheetToRecords(kind: ImportKind, table: string[][]): { records: { line: number; raw: Record<string, string> }[]; ignored: string[]; missingRequired: string[] } {
  const at = headerRowIndex(kind, table);
  const header = table[at] ?? [];
  const data = table.slice(at + 1);
  const { map, ignored, missingRequired } = matchHeaders(kind, header);
  const records = data.slice(0, MAX_IMPORT_PEOPLE).map((cells, i) => {
    const raw: Record<string, string> = {};
    map.forEach((k, j) => { if (k && cells[j] !== undefined && String(cells[j]).trim() !== "") raw[k] = String(cells[j]); });
    return { line: at + i + 2, raw };
  }).filter((r) => Object.keys(r.raw).length > 0 && !isTemplateExampleRow(r.raw.name));
  return { records, ignored, missingRequired };
}

/** Validate one record. Unknown keys are ignored; the server calls this too. */
export function parseRecord(kind: ImportKind, line: number, input: Record<string, string>): ParsedRow {
  const raw = { ...input };
  if (kind === "employees" && !String(raw.name ?? "").trim() && String(raw.legalLastName ?? "").trim()) {
    raw.name = `${String(raw.preferredName ?? "").trim() || String(raw.legalFirstName ?? "").trim()} ${String(raw.legalLastName).trim()}`.trim();
  }
  const values: Record<string, Cell> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const c of columnsFor(kind)) {
    const r = parseCell(c, String(raw[c.key] ?? ""));
    if (r.error) errors.push(r.error);
    else if (r.value !== undefined) values[c.key] = r.value;
  }
  const name = typeof values.name === "string" ? values.name : "";
  if (!name) errors.push("Name is required");
  if (kind === "subs" && typeof values.tin === "string" && values.tin.length === 9 && !values.tinType) values.tinType = values.entity === "individual" ? "ssn" : "ein";
  if (kind === "employees" && values.employmentStatus === "separated") warnings.push("Marked no longer employed");
  return { line, name, values, errors, warnings };
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The downloadable template: our headers (required ones marked *) and one example row that the import skips. */
export function templateCsv(kind: ImportKind): string {
  const cols = columnsFor(kind);
  const head = cols.map((c) => csvCell(c.required ? `${c.header} *` : c.header)).join(",");
  const example = cols.map((c) => csvCell(c.key === "name" ? `EXAMPLE ${c.example ?? ""} (delete this row)` : c.example ?? "")).join(",");
  return `﻿${head}\r\n${example}\r\n`;
}

/** Accepted values for an enum / bool column, for the field guide. */
export function acceptedValues(c: Column): string {
  if (c.type === "enum") return Object.values(c.options ?? {}).map((w) => w[0]).join(" · ");
  if (c.type === "bool") return YES_NO;
  if (c.type === "date") return "2026-03-02 or 3/2/2026";
  if (c.type === "state") return "2-letter code";
  if (c.type === "routing") return "9 digits";
  return c.help ?? "";
}
