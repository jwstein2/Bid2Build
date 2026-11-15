import { verifyUnsubscribeToken } from "@/lib/creator/outreach/unsubscribe";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, rateLimit } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Opt-out. Accepts the button's JSON ({ t }) and RFC 8058 one-click POSTs from mail clients
 * (List-Unsubscribe-Post, token in ?t=). Idempotent; suppression is permanent.
 */
export async function POST(req: Request) {
  if (!(await rateLimit("creator-unsub", 30, 10 * 60_000))) return fail(429, "rate_limited", "Try again later.");
  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { t?: string } | null;
  const email = verifyUnsubscribeToken(body?.t ?? url.searchParams.get("t") ?? "", process.env.CREATOR_OUTREACH_SECRET ?? "");
  if (!email) return fail(400, "invalid", "Invalid link.");
  const db = createAdminClient();
  await db.from("creator_outreach_suppressions").upsert({ email, reason: "unsubscribe" }, { onConflict: "email", ignoreDuplicates: true });
  const { data: p } = await db.from("creator_prospects").select("id, stage").eq("contact_email", email).maybeSingle();
  if (p) {
    await db.from("creator_prospects").update({ stage: "unsubscribed" }).eq("id", p.id);
    await db.from("creator_outreach_messages").update({ status: "cancelled", last_error: "unsubscribed" }).eq("prospect_id", p.id).in("status", ["draft", "approved", "failed"]);
    await db.from("creator_outreach_events").insert({ prospect_id: p.id, kind: "suppressed", details: { reason: "unsubscribe", via: "link", from: p.stage } });
  }
  return json({ ok: true });
}
