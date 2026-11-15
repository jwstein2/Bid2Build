import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { isEsignEnabled } from "@/lib/esign/config";
import { ensureSignedPdf } from "@/lib/esign/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Download Signed PDF (contractor side). Visibility is decided by RLS on signatures (the bid's owner,
 * plus Enterprise members allowed to view that bid); only then does the server sign a short-lived URL.
 * Retries a signed copy that failed to render earlier. Never charges a credit.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/signatures/[signatureId]/pdf">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { signatureId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(signatureId)) return fail(404, "not_found", "Signed proposal not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { data: visible } = await supabase.from("signatures").select("id").eq("id", signatureId).maybeSingle();
  if (!visible) return fail(404, "not_found", "Signed proposal not found.");
  const admin = createAdminClient();
  const out = await ensureSignedPdf(admin, signatureId);
  if (!out.ok) return fail(503, "pdf_pending", "The signature is recorded and the bid is Signed. The signed PDF couldn't be prepared yet; please try again in a minute.");
  const { data: signed } = await admin.storage.from("documents").createSignedUrl(out.path, 300, { download: out.filename });
  if (!signed?.signedUrl) return fail(503, "pdf_pending", "Couldn't prepare the download. Please try again.");
  return json({ url: signed.signedUrl, filename: out.filename });
}
