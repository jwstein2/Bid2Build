import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { isPracticeEnabled } from "@/lib/demo/server";
import { isGuideAiEnabled } from "@/lib/guide/ai";
import type { Progress } from "@/lib/guide/rules";

export const dynamic = "force-dynamic";

/**
 * The Built2Bid Guide's state for the signed-in person: which workspace they're in (real, demo or
 * practice, from the server-written login claim), their tour progress, and whether the welcome popup
 * has been answered. known=false when progress can't be read (e.g. the migration isn't applied yet):
 * the Guide then still works from its menu but never offers anything on its own.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return json({ signedIn: false });
  const user = await getUser();
  if (!user) return json({ signedIn: false });
  const supabase = await createClient();
  const workspace = user.demo ? (user.demo.kind === "practice" ? "practice" : "demo") : "real";
  const [prog, prof] = await Promise.all([
    supabase.from("guide_progress").select("tour_id, version, status, last_step, offered_count, snoozed_until, completed_at").eq("user_id", user.id).limit(200),
    workspace === "real" ? supabase.from("profiles").select("onboarding_status").eq("id", user.id).maybeSingle() : Promise.resolve({ data: { onboarding_status: "n/a" }, error: null }),
  ]);
  if (prog.error) logError("guide.read", prog.error);
  const progress: Progress[] = (prog.data ?? []).map((r) => ({
    tourId: String(r.tour_id), version: Number(r.version), status: r.status as Progress["status"], lastStep: r.last_step == null ? null : Number(r.last_step),
    offeredCount: Number(r.offered_count ?? 0), snoozedUntil: (r.snoozed_until as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null,
  }));
  // A welcome status that can't be read counts as answered, so the first-bid offer isn't blocked forever.
  const welcomeDone = prof.error ? true : Boolean((prof.data as { onboarding_status?: unknown } | null)?.onboarding_status);
  return json({
    signedIn: true, known: !prog.error, workspace, createdAt: user.createdAt ?? null, welcomeDone, progress,
    practice: !user.demo && isPracticeEnabled(), ai: isGuideAiEnabled(),
  });
}

const EVENTS = ["offered", "started", "step", "completed", "dismissed", "snoozed", "launcher_opened", "help_viewed", "help_search", "checklist_opened"] as const;
const Body = z.object({
  event: z.enum(EVENTS),
  tourId: z.string().regex(/^[a-z0-9-]{1,48}$/).optional(),
  version: z.number().int().min(1).max(999).optional(),
  step: z.number().int().min(0).max(99).optional(),
  page: z.string().regex(/^[a-z0-9.-]{1,64}$/).optional(),
  role: z.enum(["solo", "owner", "manager", "staff"]).optional(),
  dedupe: z.string().max(120).optional(),
});

/**
 * Records one guide event (first-party, no page content, no customer data). Search text is never
 * stored, only that a search happened. Progress rows are written by guide_record() for the caller only.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isSupabaseConfigured()) return fail(503, "not_configured", "Accounts aren't configured.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  if (!(await rateLimit(`guide:${user.id}`, 300, 60 * 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const { error } = await (await createClient()).rpc("guide_record", { p: p.data });
  if (error) {
    logError("guide.write", error);
    return fail(500, "write_failed", "Couldn't save.");
  }
  return json({ ok: true });
}
