import { createAdminClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, logError, rateLimit } from "@/lib/http/api";
import { PDF_HEADERS, renderScheduleReportPdf } from "@/lib/pdf/schedule-report";
import { reportFilename } from "@/lib/schedule/report";
import { loadLogoData, loadUpdateByToken } from "@/lib/schedule/publications";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The customer's PDF copy of a shared update. Only while the link is active. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await rateLimit("update-share-pdf", 30, 10 * 60_000))) return fail(429, "rate_limited", "Too many downloads. Please wait a few minutes.");
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const u = await loadUpdateByToken(admin, token);
  if (!u) return fail(404, "link_invalid", "This link isn't valid.");
  if (u.phase !== "active") return fail(410, "link_inactive", "This link is no longer active.");
  let pdf: Buffer;
  try {
    pdf = await renderScheduleReportPdf(u.content, u.version, await loadLogoData(admin, u.logoPath));
  } catch (e) {
    logError("update_share.pdf", e);
    return fail(500, "pdf_failed", "We couldn't create the PDF. Please try again.");
  }
  return new Response(new Uint8Array(pdf), { headers: { ...PDF_HEADERS, "content-disposition": `attachment; filename="${reportFilename(u.content, u.version)}"` } });
}
