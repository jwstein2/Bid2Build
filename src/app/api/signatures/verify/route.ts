import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/**
 * Public tamper check. The browser hashes a file locally (it is never uploaded) and sends only the
 * SHA-256. A match means the file is byte-for-byte a signed or executed copy Built2Bid produced.
 * The answer reveals only what the file itself already shows: company, proposal number, version and dates.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("sign-verify", 20, 10 * 60_000))) return fail(429, "rate_limited", "Too many checks. Please wait a few minutes.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That isn't a valid file fingerprint.");
  const admin = createAdminClient();
  const { data: s } = await admin.from("signatures").select("signed_at, proposal_number, version_number, version_id").eq("pdf_hash", p.data.sha256).maybeSingle();
  let kind: "signed" | "executed" = "signed";
  let row = s as { signed_at: string; proposal_number: string; version_number: number; version_id: string } | null;
  let executedAt: string | null = null;
  if (!row) {
    const { data: ex } = await admin.from("contractor_executed_documents").select("executed_at, signature_id").eq("pdf_hash", p.data.sha256).maybeSingle();
    if (ex) {
      const { data: s2 } = await admin.from("signatures").select("signed_at, proposal_number, version_number, version_id").eq("id", ex.signature_id).maybeSingle();
      if (s2) { row = s2; kind = "executed"; executedAt = ex.executed_at; }
    }
  }
  if (!row) return json({ match: false });
  const { data: v } = await admin.from("estimate_versions").select("proposal->brand->>companyName").eq("id", row.version_id).maybeSingle();
  return json({
    match: true, kind,
    companyName: (v as { companyName?: string } | null)?.companyName ?? null,
    proposalNumber: row.proposal_number, versionNumber: row.version_number,
    signedAt: row.signed_at, executedAt,
  });
}
