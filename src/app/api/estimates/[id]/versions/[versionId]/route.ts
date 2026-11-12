import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { renderProposalPdf, pdfFilename } from "@/lib/pdf/render";
import type { ProposalDocument } from "@/lib/proposal/types";
import { fail, json } from "@/lib/http/api";

export const runtime = "nodejs";

/** Re-download an existing finalized version. Never consumes a credit. */
export async function GET(_req: Request, ctx: RouteContext<"/api/estimates/[id]/versions/[versionId]">) {
  const { id, versionId } = await ctx.params;
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { data: v } = await supabase.from("estimate_versions").select("id, version_number, proposal, snapshot").eq("id", versionId).eq("estimate_id", id).maybeSingle();
  if (!v) return fail(404, "not_found", "Version not found.");
  const doc = v.proposal as ProposalDocument;
  const filename = pdfFilename(doc, v.version_number);
  const { data: gd } = await supabase.from("generated_documents").select("storage_path").eq("version_id", versionId).maybeSingle();
  const admin = createAdminClient();
  if (gd?.storage_path) {
    const { data: signed } = await supabase.storage.from("documents").createSignedUrl(gd.storage_path, 300, { download: filename });
    if (signed?.signedUrl) return json({ url: signed.signedUrl, filename, charged: false });
  }
  // Regenerate from the frozen document if the stored file is missing.
  const logoPath = (v.snapshot as { business?: { logoPath?: string } })?.business?.logoPath;
  let logo: { data: Buffer; format: "png" } | null = null;
  if (logoPath) {
    const { data: file } = await admin.storage.from("logos").download(logoPath);
    if (file) logo = { data: Buffer.from(await file.arrayBuffer()), format: "png" };
  }
  const pdf = await renderProposalPdf(doc, logo);
  return json({ pdfBase64: pdf.toString("base64"), filename, charged: false });
}
