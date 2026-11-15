import { z } from "zod";
import { secretMatches } from "@/lib/creator/outreach/auth";
import { matchProspect, recordReply } from "@/lib/creator/outreach/replies";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Inbound reply hook for the outreach mailbox (e.g. a Resend inbound route, or a mail-forwarding rule).
 * Header `x-built2bid-webhook-secret: $CREATOR_OUTREACH_SECRET`. Body: { from, subject, text, in_reply_to }.
 * The text is treated as untrusted data: it is classified by fixed rules and stored as a short excerpt,
 * never executed or followed. Unknown senders are ignored (200, so the sender doesn't retry forever).
 */
const Body = z.object({
  from: z.string().max(400),
  subject: z.string().max(1000).optional().default(""),
  text: z.string().max(100_000).optional().default(""),
  in_reply_to: z.string().max(400).optional().nullable(),
});

export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-built2bid-webhook-secret"), process.env.CREATOR_OUTREACH_SECRET)) return fail(401, "unauthorized", "Not allowed.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Invalid payload.");
  const db = createAdminClient();
  try {
    const prospectId = await matchProspect(db, parsed.data.from, parsed.data.in_reply_to ?? null);
    if (!prospectId) return json({ matched: false });
    const r = await recordReply(db, { prospectId, from: parsed.data.from, subject: parsed.data.subject, text: parsed.data.text });
    return json({ matched: true, classification: r.classification });
  } catch (e) {
    logError("creator_outreach.reply", e);
    return fail(500, "failed", "Could not record the reply.");
  }
}
