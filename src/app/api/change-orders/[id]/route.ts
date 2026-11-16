import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { isEsignEnabled } from "@/lib/esign/config";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { site } from "@/lib/site";
import { CHANGE_ORDER_LINK_DAYS } from "@/lib/operations/change-orders";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ action: z.enum(["send", "link", "revise", "approve", "decline", "void"]), note: z.string().max(1000).optional() });

/**
 * Change order actions. "send" freezes the next version (the contractor delivers it themselves);
 * "link" also creates a customer signing link for that frozen version. Nothing is emailed to the
 * customer automatically. Approval without a signature needs a note.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("change-order-action", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Change order not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose an action.");
  const supabase = await createClient();
  const { action, note } = p.data;

  if (action === "send" || action === "link") {
    const { data, error } = await supabase.rpc("change_order_send", { p_id: id, p_content_hash: null });
    if (error) {
      const m = opsDbError(error);
      if (m.status === 500) logError("change_order.send", error);
      return fail(m.status, m.code, m.code === "forbidden" ? "You need “Send change orders” for this project." : m.message);
    }
    const sent = data as { version: number };
    if (action === "send") return json({ status: "sent", version: sent.version });
    if (!isEsignEnabled()) return fail(409, "esign_off", "E-signatures aren't turned on. The change order is marked sent; record the customer's approval when you have it.");
    const token = newSigningToken();
    const expires = new Date(Date.now() + CHANGE_ORDER_LINK_DAYS * 86_400_000).toISOString();
    const { error: linkErr } = await createAdminClient().rpc("change_order_create_signing", { p_change_order_id: id, p_actor: user.id, p_token_hash: hashSigningToken(token), p_expires_at: expires });
    if (linkErr) { logError("change_order.link", linkErr); return fail(500, "link_failed", "The change order was sent, but we couldn't create the signing link. Try again."); }
    return json({ status: "sent", version: sent.version, url: `${site.url}/co/${token}`, expiresAt: expires });
  }

  const { data, error } = await supabase.rpc("change_order_decide", { p_id: id, p_action: action, p_note: note ?? null });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("change_order.decide", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ status: data as string });
}
