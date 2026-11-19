import { createAdminClient } from "@/lib/supabase/server";
import { checkUnsubscribeSig } from "@/lib/trial/token";

export const runtime = "nodejs";

/**
 * Stops the optional trial check-in emails. POST only (one-click List-Unsubscribe from mail apps, or
 * the button on /trial/unsubscribe), so a scanner fetching the link never unsubscribes anyone.
 */
export async function POST(req: Request) {
  const u = new URL(req.url);
  let i = u.searchParams.get("i") ?? "", s = u.searchParams.get("s") ?? "";
  if (!i) {
    const f = await req.formData().catch(() => null);
    i = String(f?.get("i") ?? ""); s = String(f?.get("s") ?? "");
  }
  if (!checkUnsubscribeSig(i, s)) {
    // From the button on the page (a browser), go back to the page with a plain explanation instead of a bare text reply.
    if ((req.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL("/trial/unsubscribe?invalid=1", req.url), 303);
    return new Response("Invalid link", { status: 400 });
  }
  await createAdminClient().rpc("trial_set_checkins", { p_invite_id: i, p_opt_in: false });
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) return Response.redirect(new URL("/trial/unsubscribe?done=1", u.origin), 303);
  return new Response("Unsubscribed", { status: 200 });
}
