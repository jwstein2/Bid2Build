import { createAdminClient } from "@/lib/supabase/server";
import { checkLifecycleUnsubSig } from "@/lib/email/unsubscribe";
import { logError } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Stops Built2Bid lifecycle emails for one account. POST only (one-click List-Unsubscribe from mail
 * apps, or the button on /email/unsubscribe), so a link scanner fetching the URL never unsubscribes
 * anyone. Changes nothing else: sign-in codes, receipts and the account itself are unaffected.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let u = url.searchParams.get("u") ?? "", s = url.searchParams.get("s") ?? "";
  if (!u) {
    const f = await req.formData().catch(() => null);
    u = String(f?.get("u") ?? ""); s = String(f?.get("s") ?? "");
  }
  if (!checkLifecycleUnsubSig(u, s)) return new Response("Invalid link", { status: 400 });
  const { error } = await createAdminClient().from("profiles").update({ lifecycle_unsubscribed_at: new Date().toISOString() }).eq("id", u).is("lifecycle_unsubscribed_at", null);
  if (error) { logError("lifecycle.unsubscribe", error); return new Response("Please try again", { status: 503 }); }
  if ((req.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL("/email/unsubscribe?done=1", url.origin), 303);
  return new Response("Unsubscribed", { status: 200 });
}
