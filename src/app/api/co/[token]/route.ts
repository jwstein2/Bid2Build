import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { CONSENT_VERSION, isEsignEnabled } from "@/lib/esign/config";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { requestEvidence } from "@/lib/esign/server";
import { changeOrderAcceptanceText, changeOrderConsentText } from "@/lib/operations/change-orders";
import { loadCoRequest } from "@/lib/operations/co-signing";

export const runtime = "nodejs";
const schema = z.object({
  signerName: z.string().trim().min(2).max(200), signerEmail: z.string().trim().email().max(320),
  signatureText: z.string().trim().min(2).max(200), consent: z.literal(true), consentVersion: z.string().max(40),
});

/** Customer approves and signs one frozen change order version (wording rebuilt on the server). */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { token } = await ctx.params;
  if (!isSigningToken(token)) return fail(404, "link_invalid", "This link isn't valid.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("co-sign", 8, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(422, "invalid_signature", "Enter your name, email and typed signature, and check the consent box.");
  if (p.data.consentVersion !== CONSENT_VERSION) return fail(409, "consent_changed", "This page was updated. Please reload it and review again.");
  const admin = createAdminClient();
  const r = await loadCoRequest(admin, token);
  if (!r) return fail(404, "link_invalid", "This link isn't valid.");
  if (r.phase === "signed") return fail(409, "already_signed", "This change order has already been signed.");
  if (r.phase !== "pending") return fail(410, "link_inactive", "This link is no longer active. Please contact your contractor.");
  const { ip, userAgent } = await requestEvidence();
  const c = r.content;
  const { data, error } = await admin.rpc("change_order_accept_signing", {
    p_token_hash: hashSigningToken(token), p_signer_name: p.data.signerName, p_signer_email: p.data.signerEmail, p_signature_text: p.data.signatureText,
    p_consent_version: CONSENT_VERSION, p_consent_text: changeOrderConsentText(r.companyName),
    p_acceptance_text: changeOrderAcceptanceText({ companyName: r.companyName, number: c.number, projectTitle: c.project.title, amount: c.amount, version: c.version }),
    p_ip: ip, p_user_agent: userAgent,
  });
  if (error) {
    if (error.message.includes("link_invalid")) return fail(410, "link_inactive", "This link is no longer active. Please contact your contractor.");
    logError("co.sign", error);
    return fail(500, "sign_failed", "We couldn't record your signature. Nothing was signed. Please try again.");
  }
  return json({ signed: true, signatureId: data as string });
}
