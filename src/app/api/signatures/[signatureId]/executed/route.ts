import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { ensureExecutedPdf } from "@/lib/esign/contractor/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Download the fully executed agreement (contractor side). Visibility via RLS on signatures. */
export async function GET(_req: Request, ctx: RouteContext<"/api/signatures/[signatureId]/executed">) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  const { signatureId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(signatureId)) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { data: visible } = await supabase.from("signatures").select("id").eq("id", signatureId).maybeSingle();
  if (!visible) return fail(404, "not_found", "Signed proposal not found.");
  const admin = createAdminClient();
  const out = await ensureExecutedPdf(admin, signatureId);
  if (!out.ok) return out.reason === "not_executed"
    ? fail(409, "not_executed", "This agreement isn't fully executed yet: it still needs the contractor's signature.")
    : fail(503, "pdf_pending", "The executed agreement couldn't be prepared yet. Please try again in a minute.");
  const { data: signed } = await admin.storage.from("documents").createSignedUrl(out.path, 300, { download: out.filename });
  if (!signed?.signedUrl) return fail(503, "pdf_pending", "Couldn't prepare the download. Please try again.");
  return json({ url: signed.signedUrl, filename: out.filename });
}
