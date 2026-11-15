import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { finalizeProposal } from "@/lib/export/finalize";
import { isEsignEnabled, linkExpiry } from "@/lib/esign/config";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { requestPdfPath } from "@/lib/esign/server";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Create Signing Link. Goes through the same finalize path as Download PDF (readiness checks,
 * finalize_bid credit rules: one credit per bid, an unchanged proposal is never charged again), then
 * freezes that exact version and PDF behind a new secret link. Only the bid's owner can create one.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/estimates/[id]/signing">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Estimate not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("signing-create", 10, 60_000))) return fail(429, "rate_limited", "Too many signing links at once. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Create a free account to send a proposal for signature.");
  if (!user.verified) return fail(403, "email_not_verified", "Please verify your phone or email first.");

  // Ownership first (RLS client), so a teammate who can only view a company bid can't finalize it.
  const supabase = await createClient();
  const { data: own } = await supabase.from("estimates").select("id, status, expiration_date").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!own) return fail(404, "not_found", "Only the bid's owner can send it for signature.");
  if (own.status === "archived") return fail(409, "archived", "Restore this bid before sending it for signature.");
  const expires = linkExpiry(new Date(), own.expiration_date);
  if (expires === "proposal_expired") return fail(422, "proposal_expired", "This proposal's expiration date has passed. Update it on the Customer & project step, then create the link.", { missing: [{ code: "expiration_date", step: "project", fieldId: "p-exp", message: "Set a future expiration date." }] });

  const out = await finalizeProposal(user.id, id);
  if (out instanceof Response) return out;
  const { r, pdf, pdfHash, filename, doc } = out;

  const admin = createAdminClient();
  const token = newSigningToken();
  const { data: req, error } = await admin.rpc("create_signing_request", {
    p_user_id: user.id, p_estimate_id: id, p_version_id: r.version_id, p_token_hash: hashSigningToken(token),
    p_document_hash: pdfHash, p_expires_at: expires.toISOString(),
  });
  if (error) {
    if (error.message.includes("version_already_signed")) return fail(409, "already_signed", "This exact version is already signed. Make your changes first; a revision gets its own signing link.");
    if (error.message.includes("estimate_archived")) return fail(409, "archived", "Restore this bid before sending it for signature.");
    logError("esign.create", error, { user: user.id });
    return fail(500, "signing_failed", "We couldn't create the signing link. Please try again.");
  }
  const request = (Array.isArray(req) ? req[0] : req) as { id: string; expires_at: string; created_at: string };
  // The exact bytes the customer reviews, under a path that is written once.
  const up = await admin.storage.from("documents").upload(requestPdfPath(user.id, id, request.id), pdf, { contentType: "application/pdf", upsert: false });
  if (up.error) logError("esign.request_pdf", up.error, { user: user.id });

  return json({
    url: `${site.url}/sign/${token}`,
    requestId: request.id,
    expiresAt: request.expires_at,
    versionId: r.version_id,
    versionNumber: r.version_number,
    total: doc.pricing.total,
    filename,
    pdfBase64: pdf.toString("base64"),
    charged: r.charged,
    creditSource: r.credit_source,
    credits: { starter: r.starter_balance, monthly: r.monthly_balance, unlimited: r.unlimited, nextCycleAt: r.next_cycle_at },
  });
}

/** Signing requests and signatures for this bid (RLS: owner, plus Enterprise members who can view it). */
export async function GET(_req: Request, ctx: RouteContext<"/api/estimates/[id]/signing">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const [{ data: requests, error }, { data: signatures }] = await Promise.all([
    supabase.from("signing_requests").select("id, estimate_id, version_id, status, expires_at, created_at, revoked_at, revoke_reason, signed_at").eq("estimate_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("signatures").select("id, estimate_id, version_id, version_number, total, signed_at, signer_name, pdf_status").eq("estimate_id", id).order("signed_at", { ascending: false }).limit(50),
  ]);
  if (error) return fail(500, "load_failed", "Couldn't load signing status.");
  return json({ requests: requests ?? [], signatures: signatures ?? [] });
}
