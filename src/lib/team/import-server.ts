import "server-only";
import { createAdminClient, type createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/http/api";
import { piiReady, sealPii } from "@/lib/security/pii";
import { HR_FIELDS } from "./hr";
import { parseRecord, type Cell, type ImportKind, type ImportResult, type ParsedRow } from "./import";

type Db = Awaited<ReturnType<typeof createClient>>;
type Json = Record<string, unknown>;


interface Existing {
  id: string; kind: string; name: string; email: string | null; contactName: string | null; linkedUserId: string | null; trades: string[]; phone: string | null;
  notes: string | null; capacity: number; unavailable: string[]; capacityDeclared: boolean; entity: string | null;
}

const HR_KEYS = Object.keys(HR_FIELDS) as (keyof typeof HR_FIELDS)[];
const TAX_KEYS = ["legalName", "businessName", "taxClassification", "tinType", "tin", "w9Address", "w9SignedOn"] as const;
const PROFILE_KEYS = ["paymentTerms", "retainagePct", "backupWithholding", "emr", "yearsInBusiness", "diversityCerts", "website", "achBankName", "achAccountType", "achRouting", "prequalifiedOn"] as const;
const pick = (v: Record<string, Cell>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));
const plain = (e: { message?: string } | null | undefined) => {
  const m = e?.message ?? "";
  if (/forbidden|42501/.test(m)) return "you don't have permission for this part";
  if (/bad_routing/.test(m)) return "the routing number isn't valid";
  if (/has_workers/.test(m)) return "this sub has workers listed under it, so it must stay a company";
  if (/bad_email/.test(m)) return "check the personal email";
  return "something in this row couldn't be saved";
};

/** Find the existing entry a row refers to: same kind, by email first, then by exact name (case-insensitive). */
function findMatch(team: Existing[], kind: "staff" | "subcontractor", row: ParsedRow): { match?: Existing; ambiguous?: boolean } {
  const pool = team.filter((r) => r.kind === kind);
  const email = typeof row.values.email === "string" ? row.values.email.toLowerCase() : null;
  if (email) { const byEmail = pool.filter((r) => (r.email ?? "").toLowerCase() === email); if (byEmail.length === 1) return { match: byEmail[0] }; }
  const byName = pool.filter((r) => r.name.trim().toLowerCase() === row.name.trim().toLowerCase());
  if (byName.length > 1) return { ambiguous: true };
  return { match: byName[0] };
}

async function loadTeamList(db: Db): Promise<Existing[]> {
  const { data, error } = await db.rpc("pm_team");
  if (error) throw error;
  return (((data as Json | null)?.resources ?? []) as Json[]).map((r) => ({
    id: String(r.id), kind: String(r.kind), name: String(r.name ?? ""), email: (r.email as string | null) ?? null, contactName: (r.contactName as string | null) ?? null,
    linkedUserId: (r.linkedUserId as string | null) ?? null, trades: Array.isArray(r.trades) ? (r.trades as string[]) : [], phone: (r.phone as string | null) ?? null,
    notes: (r.notes as string | null) ?? null, capacity: Number(r.capacity ?? 1), unavailable: Array.isArray(r.unavailable) ? (r.unavailable as string[]) : [],
    capacityDeclared: r.capacityDeclared === true, entity: (r.entity as string | null) ?? null,
  }));
}

/** Store an encrypted SSN / TIN / bank account number: permission check + access log as the user first. */
async function storeSensitive(db: Db, userId: string, resourceId: string, kind: "ssn" | "tin" | "bank", digits: string): Promise<boolean> {
  const { error } = await db.rpc("pm_sensitive_log", { p_resource_id: resourceId, p_kind: kind, p_action: "saved", p_note: "CSV import" });
  if (error) return false;
  const { error: e1 } = await createAdminClient().from("pm_sensitive_ids").upsert(
    { resource_id: resourceId, kind, sealed: sealPii(digits), last4: digits.slice(-4), updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "resource_id,kind" });
  if (e1) { logError("import.sensitive", { code: (e1 as { code?: string }).code }); return false; }
  return true;
}

/**
 * Import (or, with dryRun, only match) a chunk of rows. Every row is re-validated here. Each write goes through
 * the same database functions as the screens, as the signed-in user, so permissions are enforced there: a
 * manager without HR access still adds people to the directory, and the HR columns are skipped with a warning.
 */
export async function runImport(db: Db, userId: string, kind: ImportKind, raws: { line: number; raw: Record<string, string> }[], dryRun: boolean): Promise<ImportResult[]> {
  const team = await loadTeamList(db);
  const resKind = kind === "employees" ? "staff" : "subcontractor";
  const out: ImportResult[] = [];
  let canHr = false, canSubs = false, employees: Json[] = [];
  if (!dryRun) {
    if (kind === "employees") {
      const [ov, emp] = await Promise.all([db.rpc("pm_hr_overview"), db.rpc("pm_employees")]);
      canHr = (ov.data as Json | null)?.canManage === true;
      employees = ((emp.data as Json | null)?.employees ?? []) as Json[];
    } else {
      const s = await db.rpc("pm_sub_compliance_summary");
      canSubs = (s.data as Json | null)?.canManage === true;
    }
  }
  const pii = piiReady();
  const seen = new Set<string>();

  for (const r of raws) {
    const row = parseRecord(kind, r.line, r.raw);
    const res: ImportResult = { line: row.line, name: row.name, action: "failed", warnings: [...row.warnings] };
    out.push(res);
    if (row.errors.length) { res.message = row.errors.join("; "); continue; }
    const { match, ambiguous } = findMatch(team, resKind, row);
    if (ambiguous) { res.message = `More than one ${kind === "employees" ? "person" : "sub"} is named "${row.name}". Add their email so we know which one.`; continue; }
    const dupKey = match?.id ?? `new:${row.name.toLowerCase()}`;
    if (seen.has(dupKey)) { res.message = "This person is already in the file above. Combine the two rows."; continue; }
    seen.add(dupKey);
    if (dryRun) { res.action = match ? "match" : "new"; continue; }
    const v = row.values;

    // 1. The directory entry.
    const base: Json = match ? {
      id: match.id, name: match.name, contactName: match.contactName, linkedUserId: match.linkedUserId, trades: match.trades, email: match.email,
      phone: match.phone, notes: match.notes, capacity: match.capacity, unavailable: match.unavailable, capacityDeclared: match.capacityDeclared,
    } : { kind: resKind, name: row.name, trades: [] };
    const dir: Json = { ...base, name: row.name };
    for (const k of ["email", "phone", "contactName", "trades"] as const) if (v[k] !== undefined) dir[k] = v[k];
    if (kind === "subs" && v.entity !== undefined) dir.entity = v.entity;
    const saved = await db.rpc("pm_resource_save", { p: dir });
    if (saved.error) { res.message = `Couldn't add to the directory: ${plain(saved.error)}`; continue; }
    const id = String(saved.data);
    res.action = match ? "updated" : "created";
    if (!match) team.push({ id, kind: resKind, name: row.name, email: (v.email as string) ?? null, contactName: null, linkedUserId: null, trades: [], phone: null, notes: null, capacity: 1, unavailable: [], capacityDeclared: false, entity: null });

    if (kind === "employees") {
      // 2. Job details (Employees & time). The save replaces all of them, so start from what's there.
      if (["title", "payType", "hourlyCost", "hireDate"].some((k) => v[k] !== undefined)) {
        const cur = employees.find((e) => e.id === id) ?? {};
        const prof = { title: v.title ?? cur.title ?? null, payType: v.payType ?? cur.payType ?? "hourly", hourlyCost: v.hourlyCost ?? cur.hourlyCost ?? null,
          hireDate: v.hireDate ?? cur.hireDate ?? null, emergencyName: cur.emergencyName ?? null, emergencyPhone: cur.emergencyPhone ?? null, clockEnabled: cur.clockEnabled ?? true };
        const { error } = await db.rpc("pm_employee_profile_save", { p_resource_id: id, p: prof });
        if (error) res.warnings.push(`Job details skipped: ${plain(error)}`);
      }
      // 3. HR file + encrypted numbers (owner and HR managers only).
      const hr = pick(v, HR_KEYS);
      const wantsSensitive = v.ssn !== undefined || v.bankAccount !== undefined;
      if ((Object.keys(hr).length || wantsSensitive) && !canHr) { res.warnings.push("HR details skipped: only the owner and HR managers can add them"); continue; }
      if (Object.keys(hr).length) {
        const { error } = await db.rpc("pm_employee_hr_save", { p_resource_id: id, p: hr });
        if (error) res.warnings.push(`HR details skipped: ${plain(error)}`);
      }
      for (const [col, k] of [["ssn", "ssn"], ["bankAccount", "bank"]] as const) {
        if (typeof v[col] !== "string") continue;
        if (!pii) { res.warnings.push(`${col === "ssn" ? "SSN" : "Bank account"} not saved: the encryption key isn't set yet`); continue; }
        if (!(await storeSensitive(db, userId, id, k, v[col] as string))) res.warnings.push(`${col === "ssn" ? "SSN" : "Bank account"} not saved`);
      }
      continue;
    }

    // Subcontractors: W-9, business profile, ACH, documents (people who manage subcontractor compliance).
    const wantsRecords = TAX_KEYS.some((k) => v[k] !== undefined) || PROFILE_KEYS.some((k) => v[k] !== undefined) || v.achAccount !== undefined
      || Object.keys(v).some((k) => /^(gl|wc|auto|license)[A-Z]/.test(k));
    if (!wantsRecords) continue;
    if (!canSubs) { res.warnings.push("W-9, insurance and payment details skipped: you need “Manage subcontractor compliance”"); continue; }
    const rec = await db.rpc("pm_sub_record", { p_resource_id: id });
    if (rec.error) { res.warnings.push(`W-9 and documents skipped: ${plain(rec.error)}`); continue; }
    const record = rec.data as Json;
    const tax = (record.tax ?? {}) as Json;

    if (TAX_KEYS.some((k) => v[k] !== undefined)) {
      const tin = typeof v.tin === "string" ? v.tin : null;
      let last4 = (tax.tinLast4 as string | null) ?? null;
      if (tin) {
        last4 = tin.slice(-4);
        if (tin.length === 9) {
          if (!pii) res.warnings.push("Full tax ID not stored (encryption key isn't set yet); kept the last 4");
          else if (!(await storeSensitive(db, userId, id, "tin", tin))) res.warnings.push("Full tax ID not stored; kept the last 4");
        }
      }
      // pm_sub_tax_save replaces every W-9 field, so start from what's there.
      const t = { legalName: v.legalName ?? tax.legalName ?? null, businessName: v.businessName ?? tax.businessName ?? null,
        taxClassification: v.taxClassification ?? tax.taxClassification ?? null, tinType: v.tinType ?? tax.tinType ?? null, tinLast4: last4,
        address: v.w9Address ?? tax.address ?? null, w9SignedOn: v.w9SignedOn ?? tax.w9SignedOn ?? null, track1099: typeof tax.track1099 === "boolean" ? tax.track1099 : null };
      const { error } = await db.rpc("pm_sub_tax_save", { p_resource_id: id, p: t });
      if (error) res.warnings.push(`W-9 details skipped: ${plain(error)}`);
    }
    const prof = pick(v, PROFILE_KEYS);
    if (Object.keys(prof).length) {
      const { error } = await db.rpc("pm_sub_profile_save", { p_resource_id: id, p: prof });
      if (error) res.warnings.push(`Business details skipped: ${plain(error)}`);
    }
    if (typeof v.achAccount === "string") {
      if (!pii) res.warnings.push("ACH account not saved: the encryption key isn't set yet");
      else if (!(await storeSensitive(db, userId, id, "bank", v.achAccount))) res.warnings.push("ACH account not saved");
    }
    const docs: Json[] = [];
    if (["glInsurer", "glPolicy", "glEachOccurrence", "glAggregate", "glExpires"].some((k) => v[k] !== undefined)) {
      docs.push({ docType: "coi_general_liability", issuer: v.glInsurer, policyNumber: v.glPolicy, coverageAmount: v.glEachOccurrence, aggregateAmount: v.glAggregate,
        expiresOn: v.glExpires, additionalInsured: v.glAdditionalInsured, waiverOfSubrogation: v.glWaiver, primaryNoncontributory: v.glPrimary });
    }
    if (["wcInsurer", "wcPolicy", "wcExpires"].some((k) => v[k] !== undefined)) {
      docs.push({ docType: "workers_comp", issuer: v.wcInsurer, policyNumber: v.wcPolicy, expiresOn: v.wcExpires, waiverOfSubrogation: v.wcWaiver });
    }
    if (["autoInsurer", "autoPolicy", "autoLimit", "autoExpires"].some((k) => v[k] !== undefined)) {
      docs.push({ docType: "auto_liability", issuer: v.autoInsurer, policyNumber: v.autoPolicy, coverageAmount: v.autoLimit, expiresOn: v.autoExpires });
    }
    if (["licenseNumber", "licenseIssuer", "licenseExpires"].some((k) => v[k] !== undefined)) {
      docs.push({ docType: "license", issuer: v.licenseIssuer, policyNumber: v.licenseNumber, expiresOn: v.licenseExpires });
    }
    const existing = ((record.documents ?? []) as Json[]).filter((d) => d.status === "on_file");
    for (const d of docs) {
      const p = Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined).map(([k, x]) => [k, typeof x === "number" ? String(x) : x]));
      // Importing the same file twice doesn't stack duplicate certificates.
      if (existing.some((e) => e.docType === p.docType && (e.policyNumber ?? null) === (p.policyNumber ?? null) && (e.expiresOn ?? null) === (p.expiresOn ?? null))) continue;
      const { error } = await db.rpc("pm_sub_document_add", { p_resource_id: id, p: { ...p, note: "Imported from a spreadsheet" } });
      if (error) res.warnings.push(`${String(p.docType).replace(/_/g, " ")} skipped: ${plain(error)}`);
    }
  }
  return out;
}
