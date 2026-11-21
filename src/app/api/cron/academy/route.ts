import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { releaseDueCourses, writeNextLesson, type LessonWriter } from "@/lib/academy/release";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Contractor Academy weekly drip (netlify/functions/academy-cron.mts). Authorization: Bearer $EMAIL_OUTBOX_SECRET.
 *   ?phase=release        publish upcoming courses whose release day has come and whose lessons are all written
 *   ?phase=write&skip=N   write one missing lesson (Haiku) for a course releasing in the next 14 days;
 *                         skip=N lets parallel calls take different courses
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const q = new URL(req.url).searchParams;
  const db = createAdminClient();
  try {
    if (q.get("phase") === "write") {
      const skip = Math.min(5, Math.max(0, Number(q.get("skip")) || 0));
      return json(await writeNextLesson(db, isAiConfigured() ? (generateStructured as unknown as LessonWriter) : null, new Date(), { skip }));
    }
    return json(await releaseDueCourses(db));
  } catch (e) {
    logError("academy.cron", e);
    return fail(500, "server_error", "Academy release job failed.");
  }
}
