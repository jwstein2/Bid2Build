import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { requestEvidence } from "@/lib/esign/server";
import { exemptionSchema, exemptionStatement } from "@/lib/tax-banking/tax/exemption-form";

export const runtime = "nodejs";

const ERRORS: Record<string, [number, string, string]> = {
  link_invalid: [404, "link_invalid", "This link isn't valid. Ask your contractor for a new one."],
  link_used: [409, "link_used", "This certificate was already signed. Ask your contractor if anything needs to change."],
  link_expired: [410, "link_expired", "This link has expired. Ask your contractor for a new one."],
  bad_state: [422, "invalid", "Choose the states this certificate covers."],
};

/**
 * The customer signs their exemption certificate. No account: the secret link is the key (recorded as such). The
 * statement is rebuilt on the server, so what is stored is exactly what the page showed.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/exempt/[token]">) {
  const { token } = await ctx.params;
  if (!isSigningToken(token)) return fail(404, "link_invalid", ERRORS.link_invalid[2]);
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("exempt-sign", 8, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  const parsed = exemptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(422, "invalid", first?.message ?? "Check the highlighted fields.", { field: first?.path?.join(".") ?? null });
  }
  const admin = createAdminClient();
  const hash = hashSigningToken(token);
  const { data: view } = await admin.rpc("tax_exemption_request_view", { p_token_hash: hash });
  const v = view as { status: string; company: string } | null;
  if (!v) return fail(404, "link_invalid", ERRORS.link_invalid[2]);
  const input = parsed.data;
  const purchaser = input.purchaser.business || input.purchaser.name;
  const { ip, userAgent } = await requestEvidence();
  const { data, error } = await admin.rpc("tax_exemption_sign", { p_token_hash: hash, p: {
    states: input.states, reasonCode: input.reasonCode, reasonOther: input.reasonOther ?? null, purchaser: input.purchaser, idType: input.idType, idNumber: input.idNumber,
    idState: input.idState || null, signerName: input.signerName, signerTitle: input.signerTitle || null, statement: exemptionStatement(v.company, purchaser), ip, userAgent } });
  if (error) {
    const e = ERRORS[error.message];
    if (e) return fail(e[0], e[1], e[2]);
    logError("exempt.sign", error);
    return fail(500, "server_error", "We couldn't save the certificate. Nothing was signed. Please try again.");
  }
  return json({ ok: true, states: (data as { states: number }).states });
}
