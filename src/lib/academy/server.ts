import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient, getUser, type SessionUser } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { ACADEMY_TRADES, ALL_COURSES, courseCover } from "./content/catalog";
import { RESOURCES } from "./content/resources";
import type { Access, AppAction, CourseStatus, CoverTheme, Level, Pillar, QuizQuestion } from "./types";

/**
 * Contractor Academy read layer.
 * Reads go to Supabase as the visitor (RLS applies). Until the Academy migration has been applied, classroom reads
 * fall back to the static starting catalog (read-only) and the community shows a "being set up" state, so the
 * pages still render on a preview deploy.
 */

export type AcademyMe = {
  signed_in: boolean; member?: boolean; status?: string | null; suspended_until?: string | null; role?: string | null; platform_admin?: boolean;
  premium?: boolean; display_name?: string | null; primary_trade?: string | null; trades?: string[]; points?: number; level?: number;
};
export type AcademyStats = { members: number; online: number; admins: number; moderators: number; online_window_minutes: number; published_courses: number; published_lessons: number };
export type Trade = { slug: string; name: string; family: string | null; icon: string | null; intro: string | null; seo_title: string | null; seo_description: string | null; sales_challenge: string | null; sort_order: number };
export type Course = {
  id: string; slug: string; trade_slug: string | null; pillar: Pillar; title: string; summary: string; description: string | null; level: Level; access: Access;
  status: CourseStatus; content_class: string; cover_path: string | null; cover_theme: CoverTheme; featured: boolean; sort_order: number; planned_lessons: string[];
  seo_title: string | null; seo_description: string | null; updated_at?: string | null; published_at?: string | null; lesson_count?: number;
  /** Release day (YYYY-MM-DD) of an upcoming course; absent before the release-schedule migration. */
  release_on?: string | null;
};
export type OutlineItem = { id: string; slug: string; title: string; summary: string | null; module_id: string | null; module_title: string | null; access: Access; locked: boolean; estimated_minutes: number | null; sort_order: number; completed: boolean };
export type Resource = {
  id: string; kind: string; title: string; creator_name: string | null; creator_url: string | null; community_name: string | null; platform: string | null; source_url: string;
  embed_id: string | null; embed_allowed: boolean; thumbnail_url: string | null; summary: string | null; why_it_matters: string | null; takeaways: string[]; trades: string[];
  skill: string | null; access_note: string | null; permission_status: string; views_at_verification: number | null; verified_at: string | null; verification_note: string | null; note?: string | null;
};
export type Lesson = {
  id: string; course_id: string; slug: string; title: string; summary: string | null; body_md: string | null; takeaways: string[]; checklist: string[];
  trade_notes: Record<string, string>; app_action: AppAction | null; quiz: QuizQuestion[] | null; access: Access; estimated_minutes: number | null; updated_at?: string | null;
};

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205", "PGRST200"]);
export const isMissing = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (MISSING.has(e.code ?? "") || /does not exist|could not find/i.test(e.message ?? "")));

/** Anonymous-capable client: the visitor's session when signed in (RLS), otherwise anon. */
export const academyDb = cache(async (): Promise<SupabaseClient | null> => (isSupabaseConfigured() ? await createClient() : null));

export const loadMe = cache(async (): Promise<{ user: SessionUser | null; me: AcademyMe; migrated: boolean }> => {
  const user = await getUser();
  if (!user) return { user: null, me: { signed_in: false }, migrated: await isMigrated() };
  const db = await createClient();
  const { data, error } = await db.rpc("academy_me");
  if (error) return { user, me: { signed_in: true, member: false }, migrated: !isMissing(error) };
  // A null payload (no row yet) reads as a signed-in non-member instead of crashing every Academy page.
  return { user, me: (data as AcademyMe | null) ?? { signed_in: true, member: false }, migrated: true };
});

export const isMigrated = cache(async (): Promise<boolean> => {
  const db = await academyDb();
  if (!db) return false;
  const { error } = await db.rpc("academy_stats");
  return !error;
});

export const loadStats = cache(async (): Promise<AcademyStats | null> => {
  const db = await academyDb();
  if (!db) return null;
  const { data, error } = await db.rpc("academy_stats");
  return error ? null : (data as AcademyStats);
});

// Presence heartbeats come from the browser: see src/lib/academy/presence.ts and /api/academy/presence.

// ---------------------------------------------------------------------------------------------------------
// Static fallback (before the migration is applied)
// ---------------------------------------------------------------------------------------------------------
const staticId = (k: string) => `static-${k}`;
const staticTrades = (): Trade[] => ACADEMY_TRADES.map((t) => ({ slug: t.slug, name: t.name, family: t.family, icon: t.icon, intro: t.intro, seo_title: t.seoTitle, seo_description: t.seoDescription, sales_challenge: t.salesChallenge, sort_order: t.sort }));
const staticCourses = (): Course[] => ALL_COURSES.map((c) => ({
  id: staticId(c.slug), slug: c.slug, trade_slug: c.trade, pillar: c.pillar, title: c.title, summary: c.summary, description: c.description, level: c.level,
  access: c.access, status: c.status, content_class: c.contentClass, cover_path: null, cover_theme: courseCover(c.pillar), featured: Boolean(c.featured),
  sort_order: c.sort, planned_lessons: c.plannedLessons, seo_title: c.seoTitle ?? null, seo_description: c.seoDescription ?? null, lesson_count: c.lessons?.length ?? 0,
}));
const staticResource = (key: string, note?: string): Resource | null => {
  const r = RESOURCES.find((x) => x.key === key);
  if (!r) return null;
  return {
    id: staticId(r.key), kind: r.kind, title: r.title, creator_name: r.creatorName, creator_url: r.creatorUrl ?? null, community_name: r.communityName ?? null, platform: r.platform,
    source_url: r.sourceUrl, embed_id: r.embedId ?? null, embed_allowed: r.embedAllowed, thumbnail_url: r.embedId && r.embedAllowed ? `https://i.ytimg.com/vi/${r.embedId}/hqdefault.jpg` : null,
    summary: r.summary, why_it_matters: r.whyItMatters, takeaways: r.takeaways, trades: r.trades, skill: r.skill, access_note: r.accessNote ?? null, permission_status: r.permission,
    views_at_verification: r.viewsAtVerification ?? null, verified_at: r.verifiedAt, verification_note: r.verificationNote, note: note ?? null,
  };
};

// ---------------------------------------------------------------------------------------------------------
// Classroom reads
// ---------------------------------------------------------------------------------------------------------
export const listTrades = cache(async (): Promise<Trade[]> => {
  const db = await academyDb();
  if (db) {
    const { data, error } = await db.from("academy_trades").select("slug, name, family, icon, intro, seo_title, seo_description, sales_challenge, sort_order").eq("active", true).order("sort_order");
    if (!error) return (data ?? []) as Trade[];
    if (!isMissing(error)) return [];
  }
  return staticTrades();
});

export async function getTrade(slug: string): Promise<Trade | null> {
  return (await listTrades()).find((t) => t.slug === slug) ?? null;
}

const BASE_COURSE_COLS = "id, slug, trade_slug, pillar, title, summary, description, level, access, status, content_class, cover_path, cover_theme, featured, sort_order, planned_lessons, seo_title, seo_description, updated_at, published_at";
const COURSE_COLS = `${BASE_COURSE_COLS}, release_on`;
/** Undefined column (release_on before 20270216001000 is applied): retry with the original column list. */
const noColumn = (e: { code?: string } | null | undefined) => e?.code === "42703";

/** Course cards. trade=null: cross-trade courses only; trade=undefined: every course. Lesson counts included. */
export const listCourses = cache(async (opts: { trade?: string | null; pillar?: string; q?: string } = {}): Promise<Course[]> => {
  const db = await academyDb();
  let rows: Course[] | null = null;
  if (db) {
    const run = (cols: string) => {
      let query = db.from("academy_courses").select(`${cols}, academy_lessons(count)`).in("status", ["published", "upcoming"]).order("sort_order").limit(400);
      if (opts.trade === null) query = query.is("trade_slug", null);
      else if (opts.trade) query = query.eq("trade_slug", opts.trade);
      if (opts.pillar) query = query.eq("pillar", opts.pillar);
      if (opts.q) query = query.ilike("title", `%${opts.q.replace(/[%_,()]/g, " ").slice(0, 60)}%`);
      return query;
    };
    let { data, error } = await run(COURSE_COLS);
    if (noColumn(error)) ({ data, error } = await run(BASE_COURSE_COLS));
    if (!error) {
      rows = (data ?? []).map((r) => {
        const { academy_lessons, ...rest } = r as unknown as Course & { academy_lessons?: { count: number }[] };
        // RLS hides members-only lessons from visitors, so a visitor's count undercounts (the Sales
        // Academy showed "3 lessons" of 12). The shipped seed knows the full count for seeded courses.
        const seeded = ALL_COURSES.find((c) => c.slug === rest.slug)?.lessons?.length ?? 0;
        return { ...rest, lesson_count: Math.max(academy_lessons?.[0]?.count ?? 0, rest.status === "published" ? seeded : 0) };
      });
    } else if (!isMissing(error)) rows = [];
  }
  if (!rows) {
    rows = staticCourses().filter((c) => (opts.trade === undefined ? true : opts.trade === null ? c.trade_slug === null : c.trade_slug === opts.trade))
      .filter((c) => !opts.pillar || c.pillar === opts.pillar).filter((c) => !opts.q || c.title.toLowerCase().includes(opts.q.toLowerCase()));
  }
  return rows;
});

export async function getCourse(slug: string): Promise<{ course: Course; outline: OutlineItem[]; resources: Resource[]; trade: Trade | null } | null> {
  const db = await academyDb();
  if (db) {
    let { data, error } = await db.from("academy_courses").select(COURSE_COLS).eq("slug", slug).maybeSingle();
    if (noColumn(error)) ({ data, error } = await db.from("academy_courses").select(BASE_COURSE_COLS).eq("slug", slug).maybeSingle());
    if (!error) {
      if (!data) return null;
      const course = data as Course;
      const [{ data: outline }, { data: cr }] = await Promise.all([
        db.rpc("academy_course_outline", { p_course_id: course.id }),
        db.from("academy_course_resources").select("sort_order, academy_resources(*)").eq("course_id", course.id).order("sort_order"),
      ]);
      const resources = ((cr ?? []) as unknown as { academy_resources: Resource | null }[]).map((x) => x.academy_resources).filter((x): x is Resource => Boolean(x));
      return { course, outline: (outline ?? []) as OutlineItem[], resources, trade: course.trade_slug ? await getTrade(course.trade_slug) : null };
    }
    if (!isMissing(error)) return null;
  }
  const seed = ALL_COURSES.find((c) => c.slug === slug);
  if (!seed) return null;
  const course = staticCourses().find((c) => c.slug === slug)!;
  const modules = [...new Set((seed.lessons ?? []).map((l) => l.module))];
  const outline: OutlineItem[] = (seed.lessons ?? []).map((l, i) => ({
    id: staticId(`${seed.slug}:${l.slug}`), slug: l.slug, title: l.title, summary: l.summary, module_id: staticId(l.module), module_title: l.module, access: l.access,
    locked: l.access !== "public", estimated_minutes: l.minutes, sort_order: modules.indexOf(l.module) * 1000 + i, completed: false,
  }));
  return { course, outline, resources: (seed.resources ?? []).map((k) => staticResource(k)).filter((x): x is Resource => Boolean(x)), trade: seed.trade ? await getTrade(seed.trade) : null };
}

export async function getLesson(courseSlug: string, lessonSlug: string): Promise<
  | { state: "ok"; course: Course; lesson: Lesson; resources: Resource[]; outline: OutlineItem[]; completed: boolean }
  | { state: "locked"; course: Course; title: string; access: Access; outline: OutlineItem[] }
  | null
> {
  const c = await getCourse(courseSlug);
  if (!c || c.course.status !== "published") return null;
  const item = c.outline.find((o) => o.slug === lessonSlug);
  if (!item) return null;
  if (item.locked) return { state: "locked", course: c.course, title: item.title, access: item.access, outline: c.outline };
  const db = await academyDb();
  if (db && !item.id.startsWith("static-")) {
    const { data, error } = await db.from("academy_lessons").select("id, course_id, slug, title, summary, body_md, takeaways, checklist, trade_notes, app_action, quiz, access, estimated_minutes, updated_at").eq("id", item.id).maybeSingle();
    if (error || !data) return { state: "locked", course: c.course, title: item.title, access: item.access, outline: c.outline };
    const { data: lr } = await db.from("academy_lesson_resources").select("sort_order, note, academy_resources(*)").eq("lesson_id", item.id).order("sort_order");
    const resources = ((lr ?? []) as unknown as { note: string | null; academy_resources: Resource | null }[]).filter((x) => x.academy_resources).map((x) => ({ ...x.academy_resources!, note: x.note }));
    return { state: "ok", course: c.course, lesson: data as Lesson, resources, outline: c.outline, completed: item.completed };
  }
  const seed = ALL_COURSES.find((x) => x.slug === courseSlug)?.lessons?.find((l) => l.slug === lessonSlug);
  if (!seed) return null;
  const lesson: Lesson = {
    id: item.id, course_id: c.course.id, slug: seed.slug, title: seed.title, summary: seed.summary, body_md: seed.body, takeaways: seed.takeaways, checklist: seed.checklist,
    trade_notes: seed.tradeNotes ?? {}, app_action: seed.action ?? null, quiz: seed.quiz ?? null, access: seed.access, estimated_minutes: seed.minutes,
  };
  return { state: "ok", course: c.course, lesson, resources: (seed.resources ?? []).map((r) => staticResource(r.key, r.note)).filter((x): x is Resource => Boolean(x)), outline: c.outline, completed: false };
}

export async function myProgress(): Promise<Map<string, { completed: number; total: number }>> {
  const { me } = await loadMe();
  const out = new Map<string, { completed: number; total: number }>();
  if (!me.member) return out;
  const db = await createClient();
  const { data } = await db.rpc("academy_my_progress");
  for (const r of (data ?? []) as { course_id: string; completed: number; total: number }[]) out.set(r.course_id, { completed: r.completed, total: r.total });
  return out;
}

/** Public, verified resources for a trade (cross-trade resources included). */
export async function tradeResources(trade: string, limit = 8): Promise<Resource[]> {
  const db = await academyDb();
  if (db) {
    const { data, error } = await db.from("academy_resources").select("*").eq("status", "verified").or(`trades.cs.{${trade}},trades.eq.{}`).limit(60);
    if (!error) {
      return ((data ?? []) as Resource[]).sort((a, b) => Number(b.trades.includes(trade)) - Number(a.trades.includes(trade))).slice(0, limit);
    }
    if (!isMissing(error)) return [];
  }
  return RESOURCES.filter((r) => r.trades.length === 0 || r.trades.includes(trade)).sort((a, b) => Number(b.trades.includes(trade)) - Number(a.trades.includes(trade)))
    .slice(0, limit).map((r) => staticResource(r.key)!);
}

// ---------------------------------------------------------------------------------------------------------
// Media (private bucket, signed URLs)
// ---------------------------------------------------------------------------------------------------------
export async function signedMediaUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!list.length || !serverEnv().supabaseServiceKey) return out;
  const { data } = await createAdminClient().storage.from("academy-media").createSignedUrls(list, 60 * 60);
  for (const d of data ?? []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  return out;
}

/** Academy staff check for server actions and the manage area. */
export async function requireAcademyStaff(roles: ("admin" | "moderator" | "instructor")[]) {
  const { user, me } = await loadMe();
  if (!user || !me.role || !(roles as string[]).includes(me.role)) return null;
  return { user, me };
}
