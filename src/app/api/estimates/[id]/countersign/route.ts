import { createAdminClient, createClient, getAuthUser, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { isContractorSigningEnabled, countersignText } from "@/lib/esign/contractor/config";
import { countersignSchema } from "@/lib/esign/contractor/validate";
import { contractorError, ensureExecutedPdf, type ContractorSignature } from "@/lib/esign/contractor/server";
import { requestEvidence } from "@/lib/esign/server";
import type { ProposalDocument } from "@/lib/proposal/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Countersign (interactive). The signed-in person applies THEIR OWN signature to one frozen version, after
 * affirming the statement shown. The database checks their authority (company owner, or authorized by
 * the owner within scope) and that the signature is theirs. Recorded with the real time, IP and browser.
 * Applying it never charges, invoices or moves the pipeline; the executed PDF is prepared, not sent.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/estimates/[id]/countersign">) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Estimate not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("countersign", 10, 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to countersign.");
  if (!user.verified) return fail(403, "email_not_verified", "Please verify your email first.");
  const parsed = countersignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid", parsed.error.issues[0]?.message ?? "Confirm the statement to sign.");

  // The viewer must be able to see the bid at all (RLS), before anything else is revealed.
  const supabase = await createClient();
  const { data: visible } = await supabase.from("estimates").select("id").eq("id", id).maybeSingle();
  if (!visible) return fail(404, "not_found", "Estimate not found.");

  const admin = createAdminClient();
  const [{ data: v }, { data: cred }, { data: customer }] = await Promise.all([
    admin.from("estimate_versions").select("id, version_number, proposal").eq("id", parsed.data.versionId).eq("estimate_id", id).maybeSingle(),
    admin.from("contractor_signer_credentials").select("legal_name").eq("user_id", user.id).eq("status", "active").maybeSingle(),
    admin.from("signatures").select("id").eq("version_id", parsed.data.versionId).maybeSingle(),
  ]);
  if (!v) return fail(404, "not_found", "That proposal version wasn't found.");
  if (!cred) return fail(409, "no_signature_on_file", "Set up your signature first (Account settings → My Signature).");
  // Countersigning follows the customer's signature. Signing first happens when the link is created
  // ("Sign before sending"), so the customer always reviews exactly what they sign.
  if (!customer) return fail(409, "customer_not_signed", "The customer hasn't signed this version yet. To sign first, use \"Sign before sending\" when you create the signing link.");
  const doc = v.proposal as ProposalDocument;
  const statement = countersignText({ signerName: cred.legal_name, companyName: doc.brand.companyName, proposalNumber: doc.meta.number, projectTitle: doc.meta.title, total: doc.pricing.total, versionNumber: v.version_number, customerSigned: Boolean(customer) });
  const ev = await requestEvidence();
  const { data, error } = await admin.rpc("contractor_apply_signature", {
    p_estimate_id: id, p_version_id: v.id, p_signer: user.id, p_actor: user.id, p_application: "interactive", p_trigger: "countersign_action",
    p_statement: statement, p_ip: ev.ip, p_user_agent: ev.userAgent, p_session_authenticated_at: (await getAuthUser())?.last_sign_in_at ?? null,
  });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  const k = (Array.isArray(data) ? data[0] : data) as ContractorSignature;
  const executed = customer ? await ensureExecutedPdf(admin, customer.id) : null;
  return json({ contractorSignatureId: k.id, appliedAt: k.applied_at, corrective: k.corrective, executed: Boolean(customer), executedPdfReady: executed?.ok ?? false, signatureId: customer?.id ?? null });
}
