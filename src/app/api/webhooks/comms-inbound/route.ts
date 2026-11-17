import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { secretMatches } from "@/lib/creator/outreach/auth";
import { commConfig } from "@/lib/comms/config";
import { processInbound } from "@/lib/comms/inbound";

export const runtime = "nodejs";

/**
 * Generic inbound reply hook for another approved receiving setup (e.g. a mail-forwarding rule).
 * Header x-built2bid-webhook-secret: $COMM_INBOUND_SECRET. Body: { id, from, to[], subject, text, in_reply_to, references }.
 */
const Body = z.object({
  id: z.string().max(200), from: z.string().max(400), to: z.array(z.string().max(400)).max(50), subject: z.string().max(1000).default(""),
  text: z.string().max(100_000).default(""), in_reply_to: z.string().max(1000).nullable().optional(), references: z.string().max(4000).nullable().optional(),
});

export async function POST(req: Request) {
  const cfg = commConfig();
  if (!secretMatches(req.headers.get("x-built2bid-webhook-secret"), cfg.inboundSecret)) return fail(401, "unauthorized", "Not allowed.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid payload.");
  try {
    return json(await processInbound(createAdminClient(), cfg, { from: p.data.from, to: p.data.to, subject: p.data.subject, text: p.data.text, inReplyTo: p.data.in_reply_to ?? null, references: p.data.references ?? null, providerEventId: `inbound:${p.data.id}` }));
  } catch (e) {
    logError("comms.inbound", e);
    return fail(500, "failed", "Could not record the reply.");
  }
}
