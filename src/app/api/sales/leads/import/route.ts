import { resolveMx } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { cleanRows, ImportBody, importAuthCheck, type ImportLeadRow, type ImportResult } from "@/lib/sales/import";
import { fillBriefs, type BriefLead } from "@/lib/sales/brief";

export const runtime = "nodejs";

/**
 * Weekly automated lead import. Authorization: Bearer $SALES_LEAD_IMPORT_SECRET (set in Netlify and in
 * the agent's environment; never in code or chat). Without the secret configured the route is closed.
 *   GET  → this week's target (ZIP, trade, radius, how many) set by the owner in the Sales Hub.
 *   POST → import verified leads. They arrive unassigned; duplicates and do-not-contact businesses are
 *          skipped in the database, and each new lead gets a Haiku sales brief.
 * Body format: docs/sales-portal/LEAD_IMPORT.md.
 */
/** null when allowed; otherwise a 401 that says which side is missing (never anything about the value). */
function denied(req: Request): Response | null {
  const r = importAuthCheck(req.headers.get("authorization"), process.env.SALES_LEAD_IMPORT_SECRET);
  if (r === "ok") return null;
  const why = { not_configured: "The server has no import secret of 24+ characters for this deploy.", no_credentials: "No Authorization header arrived.", mismatch: "The Authorization header doesn't match the server's import secret." }[r];
  return fail(401, r, why);
}

export async function GET(req: Request) {
  const no = denied(req); if (no) return no;
  const { data, error } = await createAdminClient().rpc("sales_import_target", {});
  if (error) { logError("sales.lead_target", error); return fail(500, "target_failed", "Could not read the target."); }
  return json(data);
}

/** The email's domain must accept mail (MX record). Cached per request; DNS errors count as no. */
async function mailDomainsOk(rows: ImportLeadRow[]): Promise<Set<string>> {
  const domains = [...new Set(rows.map((r) => r.email.split("@")[1]))];
  const ok = new Set<string>();
  await Promise.all(domains.map(async (d) => {
    try {
      const mx = await Promise.race([resolveMx(d), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      if (mx.some((m) => m.exchange)) ok.add(d);
    } catch { /* no MX → unverified */ }
  }));
  return ok;
}

export async function POST(req: Request) {
  const no = denied(req); if (no) return no;
  const raw = await req.text();
  if (raw.length > 2_000_000) return fail(413, "too_large", "Send at most 1,000 leads per request.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid_json", "Body must be JSON."); }
  const p = ImportBody.safeParse(body);
  if (!p.success) return fail(400, "invalid_body", "Expected { batch_id, label?, leads: [...] } with at most 1,000 leads.", { issues: p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const { valid, unverified, reasons } = cleanRows(p.data.leads);
  const okDomains = await mailDomainsOk(valid);
  const rows = valid.filter((r) => okDomains.has(r.email.split("@")[1]))
    .map((r) => ({ ...r, verification: { ...r.verification, email_domain_mx: true, checked_at: new Date().toISOString() } }));
  const noMx = valid.length - rows.length;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sales_import_batch", { p_external_id: p.data.batch_id, p_label: p.data.label ?? null, p_rows: rows, p_unverified: unverified + noMx });
  if (error) {
    logError("sales.lead_import", error, { batch: p.data.batch_id });
    return fail(500, "import_failed", "Import failed; nothing partial was reported. Try again.");
  }
  const r = data as ImportResult;
  // Briefs for the new leads, within a time budget; the daily sales job fills any left over.
  const added = new Set(r.added_ids ?? []);
  let briefs = 0;
  if (added.size) {
    const { data: missing } = await admin.rpc("sales_leads_missing_brief", { p_limit: 200 });
    briefs = await fillBriefs(admin, { leads: ((missing ?? []) as BriefLead[]).filter((l) => added.has(l.id)), budgetMs: 8000 });
  }
  return json({
    batch_id: p.data.batch_id, received: p.data.leads.length, added: r.added, duplicates: r.duplicates, suppressed: r.suppressed,
    invalid: r.invalid, unverified: r.unverified, unverified_fields: noMx ? [...reasons, "email (domain has no mail server)"] : reasons,
    briefs_written: briefs, replayed: r.replayed,
  });
}
