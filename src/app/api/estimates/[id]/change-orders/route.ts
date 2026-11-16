import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { changeOrderSchema } from "@/lib/operations/change-orders";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Create or edit a DRAFT change order (the database checks acceptance and "Create change orders"). */
export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("change-order-save", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");
  const p = changeOrderSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", p.error.issues[0]?.path.includes("description") ? "Every line needs a description." : "Check the change order and try again.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_order_save", { p_estimate_id: id, p: p.data });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("change_order.save", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "You need “Create change orders” for this project." : m.message);
  }
  return json({ id: data as string }, p.data.id ? 200 : 201);
}
