import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { cleanRows, ImportBody, importAuthCheck, type ImportResult } from "@/lib/sales/import";
import { fillBriefs, type BriefLead } from "@/lib/sales/brief";
import { checkEmails, knownBadEmails } from "@/lib/sales/email-check";

export const runtime = "nodejs";

/**
 * Weekly automated lead import. Authorization: Bearer $SALES_LEAD_IMPORT_SECRET (set in Netlify and in
 * the agent's environment; never in code or chat). Without the secret configured the route is closed.
 *   GET  → this week's target set by the owner in the Sales Hub: a state region (counties, ZIPs, the
 *          free license download to work through and where the last run stopped) or a ZIP + radius.
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

export async function POST(req: Request) {
  const no = denied(req); if (no) return no;
  const raw = await req.text();
  if (raw.length > 2_000_000) return fail(413, "too_large", "Send at most 1,000 leads per request.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid_json", "Body must be JSON."); }
  const p = ImportBody.safeParse(body);
  if (!p.success) return fail(400, "invalid_body", "Expected { batch_id, label?, leads: [...] } with at most 1,000 leads.", { issues: p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const { valid, unverified, reasons } = cleanRows(p.data.leads);
  // The email must be able to receive mail: the domain has an MX record AND that mail server exists
  // (an MX pointing at a dead host bounces everything). Known bounces are skipped too. DNS failures count
  // as not verified, so the agent can resend the row next run.
  const admin = createAdminClient();
  const [checks, bad] = await Promise.all([checkEmails(valid.map((r) => r.email)), knownBadEmails(admin, valid.map((r) => r.email))]);
  const checkedAt = new Date().toISOString();
  const rows = valid.filter((r) => checks.get(r.email)?.status === "ok" && !bad.has(r.email))
    .map((r) => ({ ...r, verification: { ...r.verification, email_domain_mx: true, email_mail_server: true, checked_at: checkedAt } }));
  const noMx = valid.length - rows.length;
  const badReasons = [...new Set(valid.filter((r) => bad.has(r.email) || checks.get(r.email)?.status !== "ok")
    .map((r) => bad.has(r.email) ? "email (bounced before)" : checks.get(r.email)?.status === "unknown" ? "email (mail lookup failed, resend next run)" : "email (domain can't receive mail)"))];
  const { data, error } = await admin.rpc("sales_import_batch", { p_external_id: p.data.batch_id, p_label: p.data.label ?? null, p_rows: rows, p_unverified: unverified + noMx });
  if (error) {
    logError("sales.lead_import", error, { batch: p.data.batch_id });
    return fail(500, "import_failed", "Import failed; nothing partial was reported. Try again.");
  }
  const r = data as ImportResult;
  const added = new Set(r.added_ids ?? []);
  // Every stored row passed the mail check just now; record that on the new leads.
  if (added.size) {
    await admin.from("sales_leads").update({ email_status: "ok", email_checked_at: checkedAt, email_check_note: "Mail server checked at import." })
      .in("id", [...added]).then(() => null, () => null);
  }
  // Briefs for the new leads, within a time budget; the daily sales job fills any left over.
  let briefs = 0;
  if (added.size) {
    const { data: missing } = await admin.rpc("sales_leads_missing_brief", { p_limit: 200 });
    briefs = await fillBriefs(admin, { leads: ((missing ?? []) as BriefLead[]).filter((l) => added.has(l.id)), budgetMs: 8000 });
  }
  // Where this run stopped in the target's list, so the next run resumes after it (once per batch).
  let progress: unknown = null;
  if (p.data.progress) {
    const { data: pr, error: pe } = await admin.rpc("sales_import_progress_save", {
      p_batch: p.data.batch_id, p_cursor: p.data.progress.cursor, p_checked: p.data.progress.checked, p_exhausted: p.data.progress.exhausted ?? false,
    });
    if (pe) logError("sales.lead_progress", pe, { batch: p.data.batch_id });
    else progress = pr;
  }
  return json({
    progress,
    batch_id: p.data.batch_id, received: p.data.leads.length, added: r.added, duplicates: r.duplicates, suppressed: r.suppressed,
    invalid: r.invalid, unverified: r.unverified, unverified_fields: noMx ? [...reasons, ...badReasons] : reasons,
    briefs_written: briefs, replayed: r.replayed,
    // Which addresses failed the mail check and why, so the agent can find another contact for them.
    email_rejected: valid.filter((x) => bad.has(x.email) || checks.get(x.email)?.status !== "ok").slice(0, 100)
      .map((x) => ({ company_name: x.company_name, email: x.email, reason: bad.has(x.email) ? "Bounced before." : checks.get(x.email)?.reason ?? "Not checked." })),
  });
}
