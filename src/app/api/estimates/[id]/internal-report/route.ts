import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";
import { rowToBusiness } from "@/lib/data/mappers";
import { fail, json, logError, rateLimit } from "@/lib/http/api";
import { internalReportAccess } from "@/lib/reports/access";
import { buildInternalReport, internalReportFilename } from "@/lib/reports/internal-estimate";
import { InternalReportPdf } from "@/lib/pdf/internal-report-pdf";

export const runtime = "nodejs";

const PRIVATE = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

/**
 * Internal Estimate Report (contractor-only). Separate from every customer-facing endpoint: it is
 * generated on request from the saved estimate, never stored, never cached, and never attached to a
 * proposal, share link or signing page.
 *   ?check=1         -> { allowed, canDownload, canSend, code?, message? } (drives the builder; no financial data)
 *   ?download=1      -> PDF as an attachment (needs download_internal_reports on company bids); otherwise inline (Preview)
 *   &purpose=send    -> the file is fetched to attach to an email (needs send_internal_reports on company bids)
 */
export async function GET(req: Request, ctx: RouteContext<"/api/estimates/[id]/internal-report">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Estimate not found.");
  const url = new URL(req.url);
  const user = await getUser();
  const supabase = await createClient();
  const access = await internalReportAccess(supabase, user?.id ?? null, id);
  if (url.searchParams.get("check") === "1") return json(access.ok ? { allowed: true, canDownload: access.canDownload, canSend: access.canSend } : { allowed: false, code: access.code, message: access.message });
  if (!access.ok) return fail(access.status, access.code, access.message);
  const download = url.searchParams.get("download") === "1";
  if (url.searchParams.get("purpose") === "send" ? !access.canSend : download && !access.canDownload)
    return fail(403, "forbidden", url.searchParams.get("purpose") === "send" ? "Your company role can't send internal financial documents." : "Your company role can't download internal reports. You can still preview them.");
  if (!(await rateLimit("internal-report", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");

  const data = await loadEstimate(supabase, id);
  if (!data) return fail(404, "not_found", "Estimate not found.");
  const { data: v } = await supabase.from("estimate_versions").select("version_number, created_at").eq("estimate_id", id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const report = buildInternalReport(data.estimate, { version: v ? { number: v.version_number, createdAt: v.created_at } : null });

  // Branding of the bid's owner (a teammate's company bid carries the owner's company profile).
  const admin = createAdminClient();
  const { data: bizRow } = await admin.from("business_profiles").select("*").eq("user_id", access.ownerId).maybeSingle();
  const biz = rowToBusiness(bizRow);
  let logo: { data: Buffer; format: "png" } | null = null;
  if (biz.logoPath) {
    const { data: file } = await admin.storage.from("logos").download(biz.logoPath);
    if (file) logo = { data: Buffer.from(await file.arrayBuffer()), format: "png" };
  }
  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(createElement(InternalReportPdf, { r: report, company: { name: biz.companyName, phone: biz.phone, email: biz.email }, logo }) as React.ReactElement<DocumentProps>);
  } catch (e) {
    logError("internal-report.render", e);
    return fail(500, "pdf_failed", "We couldn't create the report. Please try again.");
  }
  const name = internalReportFilename(report);
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...PRIVATE, "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}
