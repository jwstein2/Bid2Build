import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, logError, rateLimit } from "@/lib/http/api";
import { PDF_HEADERS, renderScheduleReportPdf } from "@/lib/pdf/schedule-report";
import { reportFilename } from "@/lib/schedule/report";
import { getPublication, loadLogoData } from "@/lib/schedule/publications";

export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** PDF of a published update, from its frozen content. Needs download_schedule_pdf (Phase 9). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit("schedule-update-pdf", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const { id, pid } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(pid)) return fail(404, "not_found", "Update not found.");
  const supabase = await createClient();
  const pub = await getPublication(supabase, id, pid);
  if (!pub) return fail(404, "not_found", "Update not found.");
  // Before the Phase 9 SQL is applied the function doesn't exist; viewing the schedule was the rule then.
  const { data: perm, error: permError } = await supabase.rpc("schedule_permissions", { p_schedule_id: id });
  if (!permError && !(perm as { pdf?: boolean } | null)?.pdf) return fail(403, "forbidden", "Your company role can't download schedule PDFs.");
  const admin = createAdminClient();
  const { data: row } = await admin.from("schedule_publications").select("logo_path").eq("id", pid).maybeSingle();
  let pdf: Buffer;
  try {
    pdf = await renderScheduleReportPdf(pub.content, pub.version, await loadLogoData(admin, (row as { logo_path?: string | null } | null)?.logo_path ?? null));
  } catch (e) {
    logError("schedule.update_pdf", e);
    return fail(500, "pdf_failed", "We couldn't create the PDF. Please try again.");
  }
  const inline = new URL(req.url).searchParams.get("download") !== "1";
  return new Response(new Uint8Array(pdf), { headers: { ...PDF_HEADERS, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${reportFilename(pub.content, pub.version)}"` } });
}
