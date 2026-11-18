"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { academyErrorMessage, isPillar } from "@/lib/academy/types";
import { sniffImage } from "@/lib/security/upload";
import { AiUnavailableError, generateStructured } from "@/lib/ai/provider";
import { logError } from "@/lib/http/api";

/**
 * Academy content management. Every action re-checks the caller's Academy role on the server, then writes with
 * the service role (content tables have no client write grants) and records an audit-log entry.
 * Community moderation (reports, members) goes through the role-checked RPCs as the signed-in user instead.
 */
type Role = "admin" | "moderator" | "instructor";
const uuid = z.string().uuid();
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const lines = (f: FormData, k: string, max: number) => str(f, k).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, max);
const go = (path: string, q: Record<string, string>): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`);
const ret = (f: FormData, fallback: string) => { const r = str(f, "return_to"); return r.startsWith("/academy/manage") ? r : fallback; };

async function staff(roles: Role[], path: string) {
  const s = await requireAcademyStaff(roles);
  if (!s) go(path, { err: "You don't have permission to do that." });
  return { ...s!, admin: createAdminClient() };
}
async function audit(actor: string, action: string, type: string, id: string | null, details?: Record<string, unknown>) {
  const { error } = await createAdminClient().from("academy_audit_log").insert({ actor_id: actor, action, target_type: type, target_id: id, details: details ?? null });
  if (error) logError("academy.audit", error);
}
const dbErr = (e: { message?: string; code?: string }) =>
  e.code === "23505" ? "That slug or link is already used." : e.code === "23514" ? "One of the fields isn't in the allowed format (check slugs, lengths and https links)." : academyErrorMessage(e.message);

// ---------------------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------------------
const PUBLISH_ROLES: Role[] = ["admin"];

export async function saveCourse(form: FormData) {
  const id = str(form, "id");
  const back = id ? `/academy/manage/courses/${id}` : "/academy/manage/courses";
  const { user, me, admin } = await staff(["admin", "instructor"], back);
  const status = str(form, "status");
  if (["published", "archived"].includes(status) && !PUBLISH_ROLES.includes(me.role as Role)) go(back, { err: "Only Academy admins can publish or archive courses. Set it to In review instead." });
  const pillar = str(form, "pillar");
  if (!isPillar(pillar)) go(back, { err: "Choose a pillar." });
  const row = {
    slug: str(form, "slug").toLowerCase(), title: str(form, "title"), summary: str(form, "summary"), description: opt(form, "description"),
    trade_slug: opt(form, "trade_slug"), pillar, level: str(form, "level") || "beginner", access: str(form, "access") || "public",
    status: status || "draft", content_class: str(form, "content_class") || "original", cover_theme: str(form, "cover_theme") || "navy",
    featured: form.get("featured") === "on", sort_order: Number(str(form, "sort_order")) || 0, planned_lessons: lines(form, "planned_lessons", 20),
    seo_title: opt(form, "seo_title"), seo_description: opt(form, "seo_description"),
  };
  let courseId = id;
  if (id) {
    if (!uuid.safeParse(id).success) go(back, { err: "Course not found." });
    const { data: prev } = await admin.from("academy_courses").select("status, published_at").eq("id", id).maybeSingle();
    const extra = row.status === "published" && prev?.status !== "published" ? { published_at: prev?.published_at ?? new Date().toISOString(), reviewed_by: user.id, reviewed_at: new Date().toISOString() } : {};
    const { error } = await admin.from("academy_courses").update({ ...row, ...extra }).eq("id", id);
    if (error) go(back, { err: dbErr(error) });
  } else {
    const { data, error } = await admin.from("academy_courses").insert({ ...row, owner_id: user.id, published_at: row.status === "published" ? new Date().toISOString() : null }).select("id").single();
    if (error || !data) go(back, { err: dbErr(error ?? {}) });
    courseId = data!.id;
  }
  const cover = form.get("cover");
  if (cover instanceof File && cover.size > 0) {
    const r = await storeCover(courseId, cover);
    if (!r.ok) return go(`/academy/manage/courses/${courseId}`, { err: r.message });
    const { data: old } = await admin.from("academy_courses").select("cover_path").eq("id", courseId).maybeSingle();
    await admin.from("academy_courses").update({ cover_path: r.path }).eq("id", courseId);
    if (old?.cover_path) await admin.storage.from("academy-media").remove([old.cover_path]);
  }
  if (form.get("remove_cover") === "on") {
    const { data: old } = await admin.from("academy_courses").select("cover_path").eq("id", courseId).maybeSingle();
    if (old?.cover_path) { await admin.storage.from("academy-media").remove([old.cover_path]); await admin.from("academy_courses").update({ cover_path: null }).eq("id", courseId); }
  }
  await audit(user.id, id ? "course.update" : "course.create", "course", courseId, { status: row.status, access: row.access, slug: row.slug });
  revalidatePath("/academy", "layout");
  go(`/academy/manage/courses/${courseId}`, { msg: "Course saved." });
}

async function storeCover(courseId: string, file: File): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (file.size > 5 * 1024 * 1024) return { ok: false, message: "Covers must be 5 MB or smaller." };
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind || kind === "svg") return { ok: false, message: "Upload a JPG, PNG or WebP cover." };
  const out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1280, height: 720, fit: "cover" }).webp({ quality: 82 }).toBuffer();
  const path = `covers/${randomUUID()}.webp`;
  const { error } = await createAdminClient().storage.from("academy-media").upload(path, out, { contentType: "image/webp", upsert: false });
  if (error) { logError("academy.cover", error); return { ok: false, message: "The cover couldn't be uploaded." }; }
  void courseId;
  return { ok: true, path };
}

export async function addModule(form: FormData) {
  const courseId = str(form, "course_id");
  const back = `/academy/manage/courses/${courseId}`;
  const { user, admin } = await staff(["admin", "instructor"], back);
  if (!uuid.safeParse(courseId).success) go("/academy/manage/courses", { err: "Course not found." });
  const { error } = await admin.from("academy_modules").insert({ course_id: courseId, title: str(form, "title"), sort_order: Number(str(form, "sort_order")) || 0 });
  if (error) go(back, { err: dbErr(error) });
  await audit(user.id, "module.create", "course", courseId, { title: str(form, "title") });
  go(back, { msg: "Module added." });
}

export async function setCourseResources(form: FormData) {
  const courseId = str(form, "course_id");
  const back = `/academy/manage/courses/${courseId}`;
  const { user, admin } = await staff(["admin", "instructor"], back);
  if (!uuid.safeParse(courseId).success) go("/academy/manage/courses", { err: "Course not found." });
  const ids = form.getAll("resource_ids").map(String).filter((x) => uuid.safeParse(x).success).slice(0, 24);
  await admin.from("academy_course_resources").delete().eq("course_id", courseId);
  if (ids.length) {
    const { error } = await admin.from("academy_course_resources").insert(ids.map((r, i) => ({ course_id: courseId, resource_id: r, sort_order: i })));
    if (error) go(back, { err: dbErr(error) });
  }
  await audit(user.id, "course.resources", "course", courseId, { count: ids.length });
  revalidatePath("/academy", "layout");
  go(back, { msg: "Recommended resources saved." });
}

// ---------------------------------------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------------------------------------
const appAction = z.object({ label: z.string().min(2).max(80), href: z.string().regex(/^\/[A-Za-z0-9/_\-?=&#.]*$/).max(200), area: z.enum(["estimate", "proposal", "pipeline", "customers", "communications", "pm", "schedule", "financials", "team", "saved_items"]), why: z.string().max(300) });
const quizSchema = z.array(z.object({ q: z.string().min(3).max(300), options: z.array(z.string().min(1).max(200)).min(2).max(6), answer: z.number().int().min(0).max(5), explain: z.string().max(500) })).max(10);

export async function saveLesson(form: FormData) {
  const id = str(form, "id");
  const courseId = str(form, "course_id");
  const back = id ? `/academy/manage/lessons/${id}` : `/academy/manage/courses/${courseId}`;
  const { user, me, admin } = await staff(["admin", "instructor"], back);
  if (!uuid.safeParse(courseId).success) go("/academy/manage/courses", { err: "Course not found." });
  const status = str(form, "status") || "draft";
  if (status === "published" && me.role !== "admin") go(back, { err: "Only Academy admins can publish lessons." });
  // Trade notes: one "trade-slug: note" per line.
  const notes: Record<string, string> = {};
  for (const l of lines(form, "trade_notes", 40)) { const m = l.match(/^([a-z0-9-]{2,60})\s*:\s*(.+)$/); if (m) notes[m[1]] = m[2].slice(0, 1200); }
  let action: z.infer<typeof appAction> | null = null;
  if (str(form, "action_label")) {
    const p = appAction.safeParse({ label: str(form, "action_label"), href: str(form, "action_href"), area: str(form, "action_feature"), why: str(form, "action_why") });
    if (!p.success) go(back, { err: "The Built2Bid action needs a label, an in-app link starting with / and a feature." });
    action = p.data!;
  }
  let quiz: z.infer<typeof quizSchema> | null = null;
  if (str(form, "quiz")) {
    try { const p = quizSchema.safeParse(JSON.parse(str(form, "quiz"))); if (!p.success) throw new Error(); quiz = p.data.filter((q) => q.answer < q.options.length); }
    catch { go(back, { err: "The quiz isn't valid JSON in the expected shape." }); }
  }
  const row = {
    course_id: courseId, module_id: uuid.safeParse(str(form, "module_id")).success ? str(form, "module_id") : null, slug: str(form, "slug").toLowerCase(), title: str(form, "title"),
    summary: opt(form, "summary"), body_md: opt(form, "body_md"), takeaways: lines(form, "takeaways", 12), checklist: lines(form, "checklist", 20), trade_notes: notes,
    app_action: action, quiz, access: str(form, "access") || "members", status, estimated_minutes: Number(str(form, "estimated_minutes")) || null, sort_order: Number(str(form, "sort_order")) || 0,
  };
  let lessonId = id;
  if (id) {
    if (!uuid.safeParse(id).success) go("/academy/manage/courses", { err: "Lesson not found." });
    const { error } = await admin.from("academy_lessons").update(row).eq("id", id);
    if (error) go(back, { err: dbErr(error) });
  } else {
    const { data, error } = await admin.from("academy_lessons").insert(row).select("id").single();
    if (error || !data) go(back, { err: dbErr(error ?? {}) });
    lessonId = data!.id;
  }
  await audit(user.id, id ? "lesson.update" : "lesson.create", "lesson", lessonId, { status, access: row.access, course_id: courseId });
  revalidatePath("/academy", "layout");
  go(`/academy/manage/lessons/${lessonId}`, { msg: "Lesson saved." });
}

const summarySchema = z.object({ summary: z.string().max(240), takeaways: z.array(z.string().max(200)).min(1).max(6) });

/** Optional AI help: drafts a lesson summary and takeaways from the body with claude-haiku-5-5. Staff review before saving. */
export async function draftLessonSummary(form: FormData) {
  const id = str(form, "id");
  const back = `/academy/manage/lessons/${id}`;
  const { user, admin } = await staff(["admin", "instructor"], back);
  if (!uuid.safeParse(id).success) go("/academy/manage/courses", { err: "Lesson not found." });
  const { data: l } = await admin.from("academy_lessons").select("title, body_md").eq("id", id).maybeSingle();
  if (!l?.body_md || l.body_md.length < 200) go(back, { err: "Write and save at least a few paragraphs of the lesson first." });
  let r: Awaited<ReturnType<typeof generateStructured<typeof summarySchema>>>;
  try {
    r = await generateStructured({
      system: "You help an editor at a contractor-education site. Using ONLY the lesson text provided, write a one-sentence summary (max 200 characters) and 3-5 short takeaways. Don't add facts, statistics, names or claims that aren't in the text.",
      user: `Lesson title: ${l!.title}\n\nLesson text:\n${l!.body_md!.slice(0, 12000)}`,
      schema: summarySchema,
      maxTokens: 600,
    });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) logError("academy.ai", e);
    return go(back, { err: e instanceof AiUnavailableError && e.reason === "not_configured" ? "AI isn't configured on this site." : "The AI draft didn't work this time. You can write the summary yourself." });
  }
  const { error: logErr } = await admin.from("ai_generations").insert({ user_id: user.id, kind: "academy_summary", engine: "ai", status: "ok", model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: Number(r.costUsd.toFixed(6)) });
  if (logErr) logError("academy.ai.log", logErr);
  await audit(user.id, "lesson.ai_draft", "lesson", id, { model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd });
  go(back, { msg: `Draft from ${r.model} (about $${r.costUsd.toFixed(4)}). Review it below, then save.`, ai_summary: r.data.summary, ai_takeaways: r.data.takeaways.join("\n") });
}

export async function setLessonResources(form: FormData) {
  const lessonId = str(form, "lesson_id");
  const back = `/academy/manage/lessons/${lessonId}`;
  const { user, admin } = await staff(["admin", "instructor"], back);
  if (!uuid.safeParse(lessonId).success) go("/academy/manage/courses", { err: "Lesson not found." });
  const ids = form.getAll("resource_ids").map(String).filter((x) => uuid.safeParse(x).success).slice(0, 12);
  await admin.from("academy_lesson_resources").delete().eq("lesson_id", lessonId);
  if (ids.length) {
    const { error } = await admin.from("academy_lesson_resources").insert(ids.map((r, i) => ({ lesson_id: lessonId, resource_id: r, sort_order: i })));
    if (error) go(back, { err: dbErr(error) });
  }
  await audit(user.id, "lesson.resources", "lesson", lessonId, { count: ids.length });
  revalidatePath("/academy", "layout");
  go(back, { msg: "Lesson resources saved." });
}

// ---------------------------------------------------------------------------------------------------------
// Resources and creator licences
// ---------------------------------------------------------------------------------------------------------
export async function saveResource(form: FormData) {
  const id = str(form, "id");
  const back = "/academy/manage/resources";
  const { user, me, admin } = await staff(["admin", "instructor"], back);
  const status = str(form, "status") || "candidate";
  if (status === "verified" && me.role !== "admin") go(back, { err: "Only Academy admins can mark a resource verified." });
  const permission = str(form, "permission_status") || "link_only";
  const views = str(form, "views_at_verification");
  const row = {
    kind: str(form, "kind"), title: str(form, "title"), creator_name: opt(form, "creator_name"), creator_url: opt(form, "creator_url"), community_name: opt(form, "community_name"),
    platform: opt(form, "platform"), source_url: str(form, "source_url"), embed_id: opt(form, "embed_id"), embed_allowed: form.get("embed_allowed") === "on",
    thumbnail_url: opt(form, "embed_id") ? `https://i.ytimg.com/vi/${str(form, "embed_id")}/hqdefault.jpg` : null,
    summary: opt(form, "summary"), why_it_matters: opt(form, "why_it_matters"), takeaways: lines(form, "takeaways", 8),
    trades: str(form, "trades").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40), skill: opt(form, "skill"), access_note: opt(form, "access_note"),
    permission_status: permission, license_id: permission === "licensed" && uuid.safeParse(str(form, "license_id")).success ? str(form, "license_id") : null,
    views_at_verification: views ? Number(views.replace(/[^0-9]/g, "")) || null : null, verified_at: opt(form, "verified_at"), verification_note: opt(form, "verification_note"), status,
  };
  const q = id && uuid.safeParse(id).success ? admin.from("academy_resources").update(row).eq("id", id).select("id").single() : admin.from("academy_resources").insert({ ...row, created_by: user.id }).select("id").single();
  const { data, error } = await q;
  if (error || !data) go(id ? `${back}?edit=${id}` : `${back}?edit=new`, { err: error?.message?.includes("license_required") ? "A licensed resource needs an active, unexpired licence record." : dbErr(error ?? {}) });
  await audit(user.id, id ? "resource.update" : "resource.create", "resource", data!.id, { status, permission_status: permission, source_url: row.source_url });
  revalidatePath("/academy", "layout");
  go(back, { msg: "Resource saved." });
}

export async function saveLicense(form: FormData) {
  const back = "/academy/manage/licenses";
  const { user, admin } = await staff(["admin"], back);
  const id = str(form, "id");
  const row = {
    creator_name: str(form, "creator_name"), creator_contact_note: opt(form, "creator_contact_note"), permission_date: str(form, "permission_date"),
    authorized_content: str(form, "authorized_content"), permitted_uses: str(form, "permitted_uses"), commercial_use: form.get("commercial_use") === "on",
    attribution_requirements: opt(form, "attribution_requirements"), expires_at: opt(form, "expires_at"), source_documentation: opt(form, "source_documentation"), status: str(form, "status") || "active",
  };
  const q = id && uuid.safeParse(id).success ? admin.from("academy_creator_licenses").update(row).eq("id", id).select("id").single() : admin.from("academy_creator_licenses").insert({ ...row, recorded_by: user.id }).select("id").single();
  const { data, error } = await q;
  if (error || !data) go(back, { err: dbErr(error ?? {}) });
  await audit(user.id, id ? "license.update" : "license.create", "license", data!.id, { creator: row.creator_name, status: row.status, commercial_use: row.commercial_use });
  go(back, { msg: "Licence record saved." });
}

// ---------------------------------------------------------------------------------------------------------
// Moderation (through the role-checked RPCs, as the signed-in user)
// ---------------------------------------------------------------------------------------------------------
export async function resolveReport(form: FormData) {
  const back = ret(form, "/academy/manage/reports");
  await staff(["admin", "moderator"], back);
  const db = await createClient();
  const id = str(form, "report_id");
  const hide = form.get("hide") === "1";
  if (hide) {
    const t = str(form, "target_type"); const tid = str(form, "target_id");
    if ((t === "post" || t === "comment") && uuid.safeParse(tid).success) {
      const { error } = await db.rpc("academy_moderate", { p_target_type: t, p_target_id: tid, p_action: "hide", p_note: str(form, "note") || null });
      if (error) go(back, { err: academyErrorMessage(error.message) });
    }
  }
  const { error } = await db.rpc("academy_resolve_report", { p_report_id: id, p_status: str(form, "status") || "dismissed", p_note: str(form, "note") || null });
  if (error) go(back, { err: academyErrorMessage(error.message) });
  go(back, { msg: hide ? "Content hidden and report closed." : "Report updated." });
}

export async function setMember(form: FormData) {
  const back = ret(form, "/academy/manage/members");
  await staff(["admin", "moderator"], back);
  const p: Record<string, string> = {};
  for (const k of ["status", "role", "tier", "suspended_until", "note"]) if (str(form, k)) p[k] = str(form, k);
  if (p.suspended_until) p.suspended_until = new Date(`${p.suspended_until}T23:59:59Z`).toISOString();
  const { error } = await (await createClient()).rpc("academy_set_member", { p_user_id: str(form, "user_id"), p });
  if (error) go(back, { err: academyErrorMessage(error.message) });
  revalidatePath("/academy", "layout");
  go(back, { msg: "Member updated." });
}

export async function saveSettings(form: FormData) {
  const back = "/academy/manage/settings";
  const { user, admin } = await staff(["admin"], back);
  const num = (k: string) => Number(str(form, k));
  const row = {
    name: str(form, "name"), tagline: str(form, "tagline"), description: str(form, "description"), rules: lines(form, "rules", 12),
    online_window_minutes: num("online_window_minutes"), free_members_can_post: form.get("free_members_can_post") === "on", premium_enabled: form.get("premium_enabled") === "on",
    premium_bundles: form.get("bundle_unlimited") === "on" ? ["unlimited"] : [],
    points_reaction: num("points_reaction"), points_helpful: num("points_helpful"), points_course: num("points_course"), daily_point_cap: num("daily_point_cap"), pair_daily_cap: num("pair_daily_cap"),
  };
  const { error } = await admin.from("academy_settings").update(row).eq("id", true);
  if (error) go(back, { err: dbErr(error) });
  await audit(user.id, "settings.update", "settings", null, row);
  revalidatePath("/academy", "layout");
  go(back, { msg: "Settings saved." });
}
