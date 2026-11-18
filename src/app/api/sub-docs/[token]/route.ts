import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { MAX_QUOTE_FILE_BYTES, safeFileName, sniffDocument } from "@/lib/operations/server";
import { normalizeTaxId, piiReady, sealPii } from "@/lib/security/pii";
import { SUB_REQUEST_KINDS, type SubRequestKind } from "@/lib/team/sub-requests";

export const runtime = "nodejs";

const MIME = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const w9 = z.object({
  legalName: z.string().trim().min(1).max(200), businessName: z.string().trim().max(200).optional(),
  taxClassification: z.enum(["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc_c", "llc_s", "llc_p", "other"]),
  tinType: z.enum(["ssn", "ein"]), tin: z.string().max(20), address: z.string().trim().min(5).max(500),
  signedName: z.string().trim().min(2).max(200), certify: z.literal(true),
});
const doc = z.object({ issuer: z.string().trim().max(200).optional(), policyNumber: z.string().trim().max(80).optional(),
  coverageAmount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(), effectiveOn: date, expiresOn: date });

const ERR: Record<string, [number, string, string]> = {
  link_closed: [410, "link_closed", "This link is no longer active. Ask your contractor for a new one."],
  bad_w9: [422, "invalid", "Check the W-9 details."], not_requested: [422, "invalid", "That document wasn't requested."],
  nothing_submitted: [422, "invalid", "Fill in the W-9 or add at least one file."], bad_path: [422, "invalid", "Upload the file again."],
};

/**
 * A subcontractor sends their W-9 and certificates through the secret link from their contractor. No account:
 * the link is the key. The TIN is encrypted before it is stored; files go to the private sub-records bucket
 * under that subcontractor's folder. Multipart form: "w9" (JSON), "doc:<type>" (JSON details) + "file:<type>".
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isSigningToken(token)) return fail(404, "link_invalid", "This link isn't valid.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("sub-docs-submit", 10, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) return fail(400, "invalid", "Send the form again.");
  if (Number(req.headers.get("content-length") ?? 0) > 6 * (MAX_QUOTE_FILE_BYTES + 64 * 1024)) return fail(413, "too_large", "Files must be 15 MB or smaller each.");
  const admin = createAdminClient();
  const hash = hashSigningToken(token);
  const { data: look } = await admin.rpc("pm_sub_request_lookup", { p_token_hash: hash });
  const v = look as { state: string; id: string; kinds: SubRequestKind[]; folder: string } | null;
  if (!v || v.state !== "open") return fail(410, "link_closed", ERR.link_closed[2]);
  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, "invalid", "Send the form again.");

  const payload: { w9?: Record<string, unknown>; sealedTin?: string; documents: Record<string, unknown>[] } = { documents: [] };
  const rawW9 = form.get("w9");
  if (typeof rawW9 === "string" && rawW9) {
    const p = w9.safeParse(JSON.parse(rawW9));
    if (!p.success) return fail(422, "invalid", "Check the W-9 details: every field marked required, and tick the certification.", { field: p.error.issues[0]?.path?.join(".") ?? null });
    const digits = normalizeTaxId(p.data.tin);
    if (!digits) return fail(422, "invalid", "Enter your 9-digit SSN or EIN.", { field: "tin" });
    if (!piiReady()) return fail(503, "pii_off", "Online W-9s aren't available yet. Please send your W-9 to your contractor another way.");
    payload.w9 = { legalName: p.data.legalName, businessName: p.data.businessName, taxClassification: p.data.taxClassification, tinType: p.data.tinType,
      tinLast4: digits.slice(-4), address: p.data.address, signedName: p.data.signedName };
    payload.sealedTin = sealPii(digits);
  }
  for (const kind of SUB_REQUEST_KINDS) {
    if (kind === "w9" || !v.kinds.includes(kind)) continue;
    const f = form.get(`file:${kind}`);
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_QUOTE_FILE_BYTES) return fail(413, "too_large", "Files must be 15 MB or smaller each.");
    const meta = doc.safeParse(JSON.parse(String(form.get(`doc:${kind}`) ?? "{}")));
    if (!meta.success) return fail(422, "invalid", "Check the certificate details.", { field: kind });
    const buf = Buffer.from(await f.arrayBuffer());
    const sniff = sniffDocument(buf);
    if (!sniff) return fail(422, "invalid_file", "Upload a PDF, JPG, PNG or WebP.", { field: kind });
    const path = `${v.folder}/req-${v.id}/${randomUUID()}.${sniff === "jpeg" ? "jpg" : sniff}`;
    const { error } = await admin.storage.from("sub-records").upload(path, buf, { contentType: MIME[sniff], upsert: false });
    if (error) { logError("subdocs.upload", error); return fail(500, "upload_failed", "We couldn't store a file. Please try again."); }
    payload.documents.push({ docType: kind, ...meta.data, filePath: path, fileName: safeFileName(f.name) });
  }
  const { data, error } = await admin.rpc("pm_sub_request_submit", { p_token_hash: hash, p: payload });
  if (error) {
    const e = ERR[error.message];
    if (e) return fail(e[0], e[1], e[2]);
    logError("subdocs.submit", error);
    return fail(500, "server_error", "We couldn't save that. Nothing was sent. Please try again.");
  }
  return json({ ok: true, recorded: (data as { recorded: number }).recorded });
}
