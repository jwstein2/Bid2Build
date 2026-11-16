import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { eventIds, recordEvent } from "@/lib/growth/events";

/**
 * Browser-reported product events. Only events the server cannot see itself are accepted, and only
 * for the signed-in account's own bids:
 *   preview_opened: the contractor opened the customer-facing proposal preview of a saved bid.
 * Stored once per bid per day. Business milestones (exports, sends, payments) are recorded where
 * they actually happen on the server, never from here.
 */
const body = z.object({ event: z.literal("preview_opened"), estimateId: z.string().uuid() });

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("events", 60, 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const user = await getUser();
  if (!user) return json({ ok: true, recorded: false });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid event.");
  // Ownership through RLS: a bid the account can't read is ignored without saying why.
  const { data: est } = await (await createClient()).from("estimates").select("id, user_id, trades").eq("id", p.data.estimateId).maybeSingle();
  if (!est || est.user_id !== user.id) return json({ ok: true, recorded: false });
  const recorded = await recordEvent(createAdminClient(), { userId: user.id, event: "preview_opened", eventId: eventIds.previewOpened(est.id), trade: (est.trades as string[] | null)?.[0] ?? null, estimateId: est.id });
  return json({ ok: true, recorded });
}
