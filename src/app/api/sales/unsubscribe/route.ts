import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, rateLimit } from "@/lib/http/api";
import { verifyUnsubscribeToken } from "@/lib/sales/nurture/tokens";

export const runtime = "nodejs";

/**
 * Opt-out from Built2Bid sales emails. Accepts the page button's JSON ({ t }) and RFC 8058 one-click
 * POSTs from mail clients (List-Unsubscribe-Post, token in ?t=). Idempotent and permanent: the address
 * goes on the sales suppression list, which every rep's campaigns and imports respect.
 */
export async function POST(req: Request) {
  if (!(await rateLimit("sales-unsub", 30, 10 * 60_000))) return fail(429, "rate_limited", "Try again later.");
  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { t?: string } | null;
  const email = verifyUnsubscribeToken(body?.t ?? url.searchParams.get("t") ?? "");
  if (!email) return fail(400, "invalid", "Invalid link.");
  const { error } = await createAdminClient().rpc("sales_nurture_unsubscribe", { p_email: email });
  if (error) return fail(500, "failed", "Couldn't save that. Reply \"unsubscribe\" to the email instead.");
  return json({ ok: true });
}
