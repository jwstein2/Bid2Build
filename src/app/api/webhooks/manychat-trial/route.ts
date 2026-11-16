import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { trialConfig } from "@/lib/trial/config";
import { requestTrialInvite } from "@/lib/trial/service";
import { maskEmail } from "@/lib/trial/text";

export const runtime = "nodejs";

/**
 * ManyChat External Request target (fallback route when the direct Meta webhook isn't available).
 * POST https://built2bid.org/api/webhooks/manychat-trial
 *   Authorization: Bearer <MANYCHAT_TRIAL_SECRET>
 *   { "email": "{{email}}", "checkins": true|false, "subscriber_id": "{{user_id}}" }
 * Responds { status, message } for ManyChat's response mapping; "message" is safe to show in chat.
 * Uses the same trial service, limits and emails as the Messenger and claim-page routes.
 */
const Body = z.object({
  email: z.string().trim().toLowerCase().max(320),
  checkins: z.union([z.boolean(), z.string()]).optional(),
  subscriber_id: z.union([z.string(), z.number()]).optional(),
});

const reply = (status: string, message: string, code = 200) => Response.json({ status, message }, { status: code, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const cfg = trialConfig();
  if (!cfg.manychatSecret || !isSupabaseConfigured()) return reply("not_configured", "Invites aren't available right now.", 503);
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(cfg.manychatSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return reply("unauthorized", "Not allowed.", 401);
  if (!cfg.enabled) return reply("paused", "Invites are paused right now. Please check back soon.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parsed.data.email)) return reply("invalid_email", "That doesn't look like an email address. Please try again.");
  const { email } = parsed.data;
  const checkins = parsed.data.checkins === true || parsed.data.checkins === "true" || parsed.data.checkins === "yes";
  const db = createAdminClient();
  try {
    // ManyChat subscribers become contacts too, so duplicates and opt-outs are tracked per person.
    let contactId: string | null = null;
    const sub = parsed.data.subscriber_id != null ? String(parsed.data.subscriber_id).slice(0, 128) : "";
    if (/^[0-9A-Za-z_-]{1,128}$/.test(sub)) {
      const now = new Date().toISOString();
      const { data } = await db.from("trial_campaign_contacts")
        .upsert({ channel: "manychat", page_id: cfg.pageId || "manychat", psid: sub, interacted_at: now, last_inbound_at: now }, { onConflict: "channel,page_id,psid" })
        .select("id").single();
      contactId = (data?.id as string | undefined) ?? null;
    }
    const r = await requestTrialInvite(db, { email, source: "manychat", contactId, checkins });
    const masked = maskEmail(email);
    if (r.status === "queued" || r.status === "resent") return reply("sent", `Done! Your invite is on its way to ${masked}. Open it and tap "Activate my 7 days".`);
    if (r.status === "duplicate") return reply("duplicate", `I just sent it to ${masked}. Check Spam or Promotions if you don't see it.`);
    if (r.status === "limit") return reply("limit", `I've already sent a few invites to ${masked}. Please check Spam or Promotions.`);
    return reply("already_activated", "That email has already used its free week. Sign in at built2bid.org to keep going.");
  } catch (e) {
    if ((e as Error).message === "invalid_email") return reply("invalid_email", "That doesn't look like an email address. Please try again.");
    logError("manychat.trial", e);
    return reply("error", "Something went wrong on our side. Please try again in a minute.", 500);
  }
}
