import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { json, rateLimit, sameOrigin } from "@/lib/http/api";
import { deviceType } from "@/lib/growth/attribution";
import { EVENT_TYPES, recordSessionEvent } from "@/lib/bid-check/server";

export const runtime = "nodejs";

/**
 * Anonymous questionnaire progress (start, complete, result shown, bonus answers, sample opened, free
 * bid clicked). Accepts answer keys only; never an email or name. Always answers 200 so analytics can
 * never break the page.
 */
const slug = z.string().trim().toLowerCase().max(100).regex(/^[a-z0-9][a-z0-9_.-]*$/).nullable().optional();
const Body = z.object({
  sid: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  answers: z.record(z.string(), z.string().max(600)).optional(),
  arrival: z.object({ campaign: slug, source: slug, content: slug, tradeHint: slug }).optional(),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return json({ ok: false }, 403);
  if (!(await rateLimit("bid-check-event", 120, 15 * 60_000))) return json({ ok: false }, 429);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isSupabaseConfigured()) return json({ ok: false });
  const a = parsed.data.arrival;
  await recordSessionEvent(createAdminClient(), {
    id: parsed.data.sid,
    type: parsed.data.type,
    answers: parsed.data.answers,
    arrival: a ? { campaign: a.campaign ?? null, source: a.source ?? null, content: a.content ?? null, tradeHint: a.tradeHint ?? null } : undefined,
    device: deviceType((await headers()).get("user-agent")) ?? null,
  });
  return json({ ok: true });
}
