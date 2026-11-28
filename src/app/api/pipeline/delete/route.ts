import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";

const Body = z.object({
  estimateId: z.string().uuid(),
  action: z.enum(["delete", "restore"]).default("delete"),
  reason: z.string().max(500).optional(),
});

/**
 * Deletes (hides) or restores a bid. Nothing is erased: the bid stays in the database with who, when and why
 * in its audit trail (estimate_deletions + the company audit log). Who may do it, and which bids must stay
 * on record (e-signed, won, with a project, invoices or payments), is decided in delete_estimate /
 * restore_estimate (SQL).
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("pipeline-delete", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  const b = p.data;
  const supabase = await createClient();
  const { error } = b.action === "restore"
    ? await supabase.rpc("restore_estimate", { p_estimate_id: b.estimateId })
    : await supabase.rpc("delete_estimate", { p_estimate_id: b.estimateId, p_reason: b.reason?.trim() || null });
  if (error) {
    if (/function .*(delete|restore)_estimate|could not find the function/i.test(error.message ?? ""))
      return fail(409, "migration_pending", "Deleting bids needs a quick database update. Please try again later.");
    const e = companyRpcError(error);
    if (e.status >= 500) logError("pipeline.delete", error, { action: b.action });
    return fail(e.status, e.code, e.message);
  }
  revalidatePath("/dashboard");
  return json({ ok: true });
}
