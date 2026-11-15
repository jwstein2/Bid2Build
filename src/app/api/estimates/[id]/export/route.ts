import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { finalizeProposal } from "@/lib/export/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Finalize + export. Authentication happens here; readiness, rendering, finalize_bid (credits and
 * idempotency) and private storage happen in finalizeProposal, the same path Create Signing Link uses.
 * Returns a short-lived signed URL (or the bytes for "Send via My Email").
 */
export async function POST(req: Request, ctx: RouteContext<"/api/estimates/[id]/export">) {
  const { id } = await ctx.params;
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("export", 20, 60_000))) return fail(429, "rate_limited", "Too many exports at once. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Create a free account to download your PDF.");
  if (!user.verified) return fail(403, "email_not_verified", "Please verify your phone or email first.");

  // "Send via My Email" asks for the PDF bytes so the browser can attach them to a share sheet
  // without fetching the private storage URL. Same checks, same finalize_bid, same credit rules.
  const body = (await req.json().catch(() => null)) as { deliver?: unknown } | null;
  const deliverBytes = body?.deliver === "bytes";

  const out = await finalizeProposal(user.id, id);
  if (out instanceof Response) return out;
  const { r, pdf, filename, storagePath, stored } = out;

  let url: string | null = null;
  if (stored) {
    const { data: signed } = await createAdminClient().storage.from("documents").createSignedUrl(storagePath, 300, { download: filename });
    url = signed?.signedUrl ?? null;
  }

  return json({
    url,
    // Fallback: if storage failed, deliver the bytes directly so the user still gets their PDF.
    pdfBase64: url && !deliverBytes ? undefined : pdf.toString("base64"),
    filename,
    versionId: r.version_id,
    versionNumber: r.version_number,
    charged: r.charged,
    creditSource: r.credit_source,
    credits: { starter: r.starter_balance, monthly: r.monthly_balance, unlimited: r.unlimited, nextCycleAt: r.next_cycle_at },
  });
}
