import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { cleanRows, ImportBody, type ImportResult } from "@/lib/sales/import";

export const runtime = "nodejs";

/**
 * Weekly automated lead import. Authorization: Bearer $SALES_LEAD_IMPORT_SECRET (set in Netlify and in
 * the agent's environment; never in code or chat). Without the secret configured the route is closed.
 * Leads arrive unassigned; duplicates and do-not-contact businesses are skipped in the database.
 * Body format: docs/sales-portal/LEAD_IMPORT.md.
 */
export async function POST(req: Request) {
  const secret = process.env.SALES_LEAD_IMPORT_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (secret.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const raw = await req.text();
  if (raw.length > 2_000_000) return fail(413, "too_large", "Send at most 1,000 leads per request.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid_json", "Body must be JSON."); }
  const p = ImportBody.safeParse(body);
  if (!p.success) return fail(400, "invalid_body", "Expected { batch_id, label?, leads: [...] } with at most 1,000 leads.", { issues: p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const { valid, invalid } = cleanRows(p.data.leads);
  const { data, error } = await createAdminClient().rpc("sales_import_batch", { p_external_id: p.data.batch_id, p_label: p.data.label ?? null, p_rows: valid });
  if (error) {
    logError("sales.lead_import", error, { batch: p.data.batch_id });
    return fail(500, "import_failed", "Import failed; nothing partial was reported. Try again.");
  }
  const r = data as ImportResult;
  return json({ batch_id: p.data.batch_id, received: p.data.leads.length, added: r.added, duplicates: r.duplicates, suppressed: r.suppressed, invalid: r.invalid + invalid, replayed: r.replayed });
}
