import { z } from "zod";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { site } from "@/lib/site";
import { looksLikePayToken } from "@/lib/financials/connect";
import { loadPayPage, startInvoiceCheckout } from "@/lib/financials/connect-server";

export const runtime = "nodejs";

const body = z.object({ method: z.enum(["any", "card", "ach"]).optional(), state: z.string().max(40).nullish() }).strict();

/** Public: a customer starts paying an invoice from its secure link. The link token is the only key. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("pay-invoice", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const { token } = await params;
  if (!looksLikePayToken(token)) return fail(404, "not_found", "This link isn't valid.");
  const b = body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return fail(400, "invalid", "Something in that request wasn't right.");
  try {
    const page = await loadPayPage(token);
    if (!page) return fail(404, "not_found", "This link isn't valid.");
    if (page.status !== "issued" || Number(page.balance) <= 0) return fail(409, "nothing_due", "Nothing is due on this invoice.");
    if (!page.account?.charges_enabled) return fail(409, "not_ready", "Online payment isn't available for this invoice right now.");
    const url = await startInvoiceCheckout(page, `${site.url}/pay/${token}`, b.data);
    return json({ url });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "amount_too_small") return fail(409, code, "The amount due is below the online payment minimum of $0.50.");
    if (code === "state_needed") return fail(409, code, "Choose your state first so we can show the right card total.");
    if (code === "method_off") return fail(409, code, "That way to pay isn't available for this invoice.");
    if (code === "connect_off") return fail(409, code, "Online payment isn't available right now.");
    logError("pay.checkout", e);
    return fail(502, "stripe_error", "We couldn't reach the payment service. Please try again in a minute.");
  }
}
