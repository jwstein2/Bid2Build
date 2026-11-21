import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AiUnavailableError, type StructuredResult } from "@/lib/ai/provider";
import { logError } from "@/lib/http/api";
import { pillarMeta } from "./types";
import { addDays, centralToday, lessonSlug, nextPlannedLesson } from "./release-plan";

/**
 * Contractor Academy weekly drip (see supabase/migrations/20270216001000_academy_release_schedule.sql).
 *   write:   for upcoming courses releasing within WRITE_AHEAD_DAYS, write the next missing planned lesson with Haiku.
 *            Lessons are stored published but stay hidden: lesson RLS only shows lessons of published courses, so
 *            staff can read, edit or delete them in Manage Academy before the release day.
 *   release: publish every upcoming course whose release day (Central time) has come and whose planned lessons are
 *            all written. A course that isn't ready yet goes out as soon as its last lesson is written.
 * Paused by Academy settings (auto_release) or ACADEMY_RELEASE_ENABLED=false.
 */
export const WRITE_AHEAD_DAYS = 14;
export const RELEASE_MODEL = () => process.env.ACADEMY_AI_MODEL?.trim() || "claude-haiku-5-5";

export const lessonSchema = z.object({
  summary: z.string(),
  body_md: z.string(),
  takeaways: z.array(z.string()),
  checklist: z.array(z.string()),
  estimated_minutes: z.number(),
  quiz: z.array(z.object({ q: z.string(), options: z.array(z.string()), answer: z.number(), explain: z.string() })),
});
export type LessonDraft = z.infer<typeof lessonSchema>;
export type LessonWriter = (opts: { system: string; user: string; schema: typeof lessonSchema; maxTokens?: number; model?: string }) => Promise<StructuredResult<LessonDraft>>;

export const releaseEnabled = () => process.env.ACADEMY_RELEASE_ENABLED !== "false";

export const LESSON_SYSTEM = [
  "You write lessons for Built2Bid Contractor Academy, a free course library for owners of small residential and light-commercial contracting businesses in the United States.",
  "Write one complete, original lesson in plain, practical English for a working contractor. Be specific and useful: steps, examples, scripts, what to check, common mistakes.",
  "Format body_md as limited Markdown only: short paragraphs, ### headings, - bullet lists and **bold**. No tables, links, images or a top-level title. Aim for 600 to 1,000 words.",
  "Rules: Do not quote statistics, percentages, survey results, prices or dollar figures as facts; use a clearly labelled example (\"for example, if your material cost is X\") instead.",
  "Do not name specific laws, code sections, agencies' fees, products, brands, software (other than Built2Bid) or people. Licensing, permits, insurance, tax, employment, contracts, lien rights and safety rules vary by state and city: say so and tell the reader to confirm with their state licensing board, local building department, insurer, accountant or attorney.",
  "Safety content must be conservative and point to the manufacturer's instructions and the applicable safety regulations. Never tell anyone to skip protection or permits.",
  "Stay on this lesson's topic and don't repeat the other lessons in the course.",
  "summary: one sentence, at most 250 characters. takeaways: 3 to 5 short points. checklist: 4 to 6 actions the reader can do this week. estimated_minutes: reading time, 5 to 15.",
  "quiz: exactly 3 multiple-choice questions on this lesson, each with 3 or 4 options, answer = the 0-based index of the correct option, explain = one sentence on why.",
].join("\n");

type CourseRow = {
  id: string; slug: string; title: string; summary: string; description: string | null; trade_slug: string | null; pillar: string; level: string; access: string;
  planned_lessons: string[]; release_on: string | null;
};
type LessonRow = { course_id: string; slug: string; title: string; summary: string | null; sort_order: number };

async function settings(db: SupabaseClient) {
  const { data } = await db.from("academy_settings").select("auto_release, release_per_week, release_weekday").eq("id", true).maybeSingle();
  return { autoRelease: data?.auto_release !== false, perWeek: data?.release_per_week ?? 2, weekday: data?.release_weekday ?? 1 };
}

async function upcomingWithLessons(db: SupabaseClient, through: string) {
  const { data: courses, error } = await db.from("academy_courses")
    .select("id, slug, title, summary, description, trade_slug, pillar, level, access, planned_lessons, release_on")
    .eq("status", "upcoming").not("release_on", "is", null).lte("release_on", through)
    .order("release_on").order("sort_order").limit(50);
  if (error) throw error;
  const rows = (courses ?? []) as CourseRow[];
  const ids = rows.map((c) => c.id);
  const { data: lessons, error: lErr } = ids.length
    ? await db.from("academy_lessons").select("course_id, slug, title, summary, sort_order").in("course_id", ids).neq("status", "archived").order("sort_order")
    : { data: [], error: null };
  if (lErr) throw lErr;
  const byCourse = new Map<string, LessonRow[]>();
  for (const l of (lessons ?? []) as LessonRow[]) byCourse.set(l.course_id, [...(byCourse.get(l.course_id) ?? []), l]);
  return rows.map((c) => ({ course: c, lessons: byCourse.get(c.id) ?? [] }));
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Cleans a model draft into a row that passes the table's checks. Returns null if it's unusable. */
export function toLessonRow(d: LessonDraft, ctx: { courseId: string; title: string; slug: string; sortOrder: number; access: string }) {
  const body = d.body_md.replace(/^#{1,2}\s.*$/gm, "").trim();
  if (body.length < 1200) return null;
  const quiz = d.quiz
    .filter((q) => q.q.trim() && q.options.length >= 2 && q.options.length <= 6 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .slice(0, 5)
    .map((q) => ({ q: clip(q.q.trim(), 300), options: q.options.map((o) => clip(o.trim(), 200)), answer: q.answer, explain: clip(q.explain.trim(), 400) }));
  return {
    course_id: ctx.courseId, module_id: null, slug: ctx.slug, title: clip(ctx.title, 140), summary: clip(d.summary.trim(), 300), body_md: clip(body, 30000),
    takeaways: d.takeaways.map((t) => clip(t.trim(), 300)).filter(Boolean).slice(0, 6), checklist: d.checklist.map((t) => clip(t.trim(), 300)).filter(Boolean).slice(0, 8),
    trade_notes: {}, app_action: null, quiz: quiz.length ? quiz : null, access: ctx.access === "premium" ? "premium" : ctx.access === "members" ? "members" : "public",
    status: "published", estimated_minutes: Math.min(30, Math.max(3, Math.round(d.estimated_minutes) || 8)), sort_order: ctx.sortOrder,
  };
}

export type WriteResult = { wrote: { course: string; lesson: string; costUsd: number } | null; pending: number; skipped?: string };

/** Writes at most one lesson: the next missing planned lesson of the soonest course inside the write-ahead window. */
export async function writeNextLesson(db: SupabaseClient, writer: LessonWriter | null, now = new Date(), opts: { skip?: number } = {}): Promise<WriteResult> {
  if (!releaseEnabled()) return { wrote: null, pending: 0, skipped: "disabled" };
  const s = await settings(db);
  if (!s.autoRelease) return { wrote: null, pending: 0, skipped: "paused" };
  const today = centralToday(now);
  const due = (await upcomingWithLessons(db, addDays(today, WRITE_AHEAD_DAYS)))
    .map((x) => ({ ...x, next: nextPlannedLesson(x.course.planned_lessons, x.lessons) }))
    .filter((x) => x.next);
  if (!due.length) return { wrote: null, pending: 0 };
  if (!writer) return { wrote: null, pending: due.length, skipped: "ai_not_configured" };
  // Parallel callers pass skip=1, 2... so they work on different courses instead of racing for the same lesson.
  if ((opts.skip ?? 0) >= due.length) return { wrote: null, pending: due.length };
  const { course, lessons, next } = due[opts.skip ?? 0];
  const { data: trade } = course.trade_slug ? await db.from("academy_trades").select("name").eq("slug", course.trade_slug).maybeSingle() : { data: null };
  const tradeName = trade?.name ?? "every trade";
  const user = [
    `Course: ${course.title}`,
    `Trade: ${tradeName}`,
    `Topic area: ${pillarMeta(course.pillar).label}`,
    `Level: ${course.level}`,
    `Course summary: ${course.summary}`,
    course.description ? `Course description: ${course.description}` : "",
    `All lessons in this course, in order:\n${course.planned_lessons.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    lessons.length ? `Already written (don't repeat):\n${lessons.map((l) => `- ${l.title}: ${l.summary ?? ""}`).join("\n")}` : "",
    `Write lesson ${next!.index + 1}: "${next!.title}". Use ${tradeName === "every trade" ? "examples from several trades" : `${tradeName} examples throughout`}.`,
  ].filter(Boolean).join("\n\n");
  let r: StructuredResult<LessonDraft>;
  try {
    r = await writer({ system: LESSON_SYSTEM, user, schema: lessonSchema, maxTokens: 5000, model: RELEASE_MODEL() });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) logError("academy.release.write", e);
    return { wrote: null, pending: due.length, skipped: e instanceof AiUnavailableError ? e.reason : "error" };
  }
  const row = toLessonRow(r.data, { courseId: course.id, title: next!.title, slug: lessonSlug(next!.title, lessons.map((l) => l.slug)), sortOrder: next!.index + 1, access: course.access });
  if (!row) return { wrote: null, pending: due.length, skipped: "too_short" };
  const { error } = await db.from("academy_lessons").insert(row);
  if (error) {
    if (error.code === "23505") return { wrote: null, pending: due.length, skipped: "already_written" };
    throw error;
  }
  await db.from("academy_audit_log").insert({
    actor_id: null, action: "lesson.auto_write", target_type: "course", target_id: course.id,
    details: { lesson: row.slug, model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: Number(r.costUsd.toFixed(6)) },
  });
  return { wrote: { course: course.slug, lesson: row.slug, costUsd: r.costUsd }, pending: due.length };
}

export type ReleaseResult = { released: string[]; waiting: { slug: string; written: number; planned: number }[]; skipped?: string };

/** Publishes every upcoming course whose release day has come and whose planned lessons are all written. */
export async function releaseDueCourses(db: SupabaseClient, now = new Date()): Promise<ReleaseResult> {
  if (!releaseEnabled()) return { released: [], waiting: [], skipped: "disabled" };
  const s = await settings(db);
  if (!s.autoRelease) return { released: [], waiting: [], skipped: "paused" };
  const today = centralToday(now);
  const released: string[] = [];
  const waiting: ReleaseResult["waiting"] = [];
  for (const { course, lessons } of await upcomingWithLessons(db, today)) {
    const planned = Math.max(1, course.planned_lessons.length);
    if (lessons.length < planned || nextPlannedLesson(course.planned_lessons, lessons)) { waiting.push({ slug: course.slug, written: lessons.length, planned }); continue; }
    const stamp = new Date().toISOString();
    const { error } = await db.from("academy_courses").update({ status: "published", published_at: stamp }).eq("id", course.id).eq("status", "upcoming");
    if (error) { logError("academy.release.publish", error); continue; }
    await db.from("academy_audit_log").insert({ actor_id: null, action: "course.auto_release", target_type: "course", target_id: course.id, details: { slug: course.slug, release_on: course.release_on, lessons: lessons.length } });
    released.push(course.slug);
  }
  return { released, waiting };
}

/** Re-packs the schedule from the next release day (after today), e.g. after a course is deleted. */
export async function repackSchedule(db: SupabaseClient, now = new Date()) {
  const { data, error } = await db.rpc("academy_schedule_releases", { p_start: addDays(centralToday(now), 1) });
  if (error) throw error;
  return Number(data ?? 0);
}
