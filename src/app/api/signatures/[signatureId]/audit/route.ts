import { createClient, getUser } from "@/lib/supabase/server";
import { fail } from "@/lib/http/api";
import { isEsignEnabled } from "@/lib/esign/config";
import { auditRecord } from "@/lib/esign/audit";

export const runtime = "nodejs";

/** Signature audit record as a JSON file, for anyone who may view the bid (RLS). */
export async function GET(_req: Request, ctx: RouteContext<"/api/signatures/[signatureId]/audit">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { signatureId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(signatureId)) return fail(404, "not_found", "Signature not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const record = await auditRecord(supabase, signatureId);
  if (!record) return fail(404, "not_found", "Signature not found.");
  return new Response(JSON.stringify(record, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="signature-audit-${signatureId.slice(0, 8)}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
