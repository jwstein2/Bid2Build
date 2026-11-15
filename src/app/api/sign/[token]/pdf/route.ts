import { createAdminClient } from "@/lib/supabase/server";
import { fail, rateLimit } from "@/lib/http/api";
import { isEsignEnabled } from "@/lib/esign/config";
import { ensureSignedPdf, loadRequestByToken, requestPdf, signedFilename } from "@/lib/esign/server";
import { pdfFilename } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The customer's copy: the exact proposal PDF under review, or the signed copy once signed (so they
 * can keep the record, as ESIGN expects). Streams bytes: no storage URL ever reaches the customer.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/sign/[token]/pdf">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { token } = await ctx.params;
  if (!(await rateLimit("sign-pdf", 30, 10 * 60_000))) return fail(429, "rate_limited", "Too many downloads. Please wait a few minutes.");
  const admin = createAdminClient();
  const r = await loadRequestByToken(admin, token);
  if (!r) return fail(404, "link_invalid", "This signing link isn't valid.");
  // A revoked or expired, never-signed link no longer serves the proposal.
  if (r.phase === "revoked" || r.phase === "expired") return fail(410, "link_inactive", "This signing link is no longer active.");

  let bytes: Buffer, filename: string;
  if (r.phase === "signed" && r.signatureId) {
    const out = await ensureSignedPdf(admin, r.signatureId);
    if (!out.ok) return fail(503, "pdf_pending", "Your signature is recorded. The signed PDF is still being prepared; please try again in a minute.");
    const { data: file } = await admin.storage.from("documents").download(out.path);
    if (!file) return fail(503, "pdf_pending", "Your signature is recorded. The signed PDF is still being prepared; please try again in a minute.");
    bytes = Buffer.from(await file.arrayBuffer());
    filename = signedFilename(r.doc, r.versionNumber);
  } else {
    bytes = await requestPdf(admin, r);
    filename = pdfFilename(r.doc, r.versionNumber);
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
