import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { checkUnsubSig } from "@/lib/comms/tokens";
import { unsubscribeByMessage } from "@/lib/comms/unsubscribe";

export const runtime = "nodejs";

/**
 * One-click unsubscribe (RFC 8058: mail apps POST "List-Unsubscribe=One-Click" here). Needs no sign-in;
 * the signed link can only opt that recipient out. GET just reports validity (link scanners must not
 * unsubscribe people), the page at /email/preferences confirms with a button.
 */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  if (!checkUnsubSig(q.get("m"), q.get("s"))) return fail(400, "invalid", "This unsubscribe link isn't valid.");
  const r = await unsubscribeByMessage(createAdminClient(), q.get("m")!);
  return r.ok ? json({ unsubscribed: true }) : fail(404, "not_found", "We couldn't find that email.");
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return json({ valid: checkUnsubSig(q.get("m"), q.get("s")) });
}
