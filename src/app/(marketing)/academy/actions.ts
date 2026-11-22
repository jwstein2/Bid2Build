"use server";
/**
 * Contractor Academy member actions. Every call runs as the signed-in member through their own RLS client; the
 * academy_* database functions enforce membership, roles, rate limits and abuse rules. Uploaded images are
 * validated, re-encoded (metadata stripped) and stored privately by the server.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { sniffImage } from "@/lib/security/upload";
import { rateLimit } from "@/lib/http/api";
import { academyErrorMessage } from "@/lib/academy/types";
import { deliverMyReward } from "@/lib/academy/rewards-server";

const uuid = z.string().uuid();
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, q: Record<string, string>) => `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(q).toString()}`;
const safePath = (p: string, fallback: string) => (p.startsWith("/academy") && !p.startsWith("//") ? p : fallback);

async function session(next = "/academy") {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { user, db: await createClient() };
}

// ---------------------------------------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------------------------------------
export async function joinAcademy(form: FormData) {
  const { db } = await session("/academy/join");
  const trades = form.getAll("trades").map(String).filter(Boolean).slice(0, 10);
  const primary = str(form, "primary_trade");
  const { error } = await db.rpc("academy_join", {
    p: {
      display_name: str(form, "display_name").slice(0, 60), trades: primary && !trades.includes(primary) ? [primary, ...trades] : trades, primary_trade: primary || null,
      state_code: str(form, "state_code") || null, company_name: str(form, "company_name").slice(0, 120) || null,
      show_company: form.get("show_company") === "on", accept_rules: form.get("accept_rules") === "on",
    },
  });
  if (error) redirect(back("/academy/join", { err: academyErrorMessage(error.message) }));
  revalidatePath("/academy", "layout");
  redirect(back("/academy", { msg: "Welcome to the Contractor Academy. Introduce yourself in General Contractor Discussion." }));
}

export async function updateProfile(form: FormData) {
  const { db } = await session("/academy/settings");
  const trades = form.getAll("trades").map(String).filter(Boolean).slice(0, 10);
  const { error } = await db.rpc("academy_update_profile", {
    p: {
      display_name: str(form, "display_name").slice(0, 60), headline: str(form, "headline").slice(0, 120), bio: str(form, "bio").slice(0, 1000),
      trades, primary_trade: str(form, "primary_trade") || null, state_code: str(form, "state_code") || null, company_name: str(form, "company_name").slice(0, 120),
      interests: form.getAll("interests").map(String).slice(0, 8),
      show_company: form.get("show_company") === "on", show_location: form.get("show_location") === "on", show_trades: form.get("show_trades") === "on",
      directory_visible: form.get("directory_visible") === "on", leaderboard_visible: form.get("leaderboard_visible") === "on",
    },
  });
  if (error) redirect(back("/academy/settings", { err: academyErrorMessage(error.message) }));
  revalidatePath("/academy", "layout");
  redirect(back("/academy/settings", { msg: "Profile saved." }));
}

export async function leaveAcademy() {
  const { db } = await session();
  const { error } = await db.rpc("academy_leave");
  if (error) redirect(back("/academy/settings", { err: academyErrorMessage(error.message) }));
  revalidatePath("/academy", "layout");
  redirect(back("/academy", { msg: "You've left the Academy community. Your Built2Bid account is unchanged." }));
}

// ---------------------------------------------------------------------------------------------------------
// Posts and comments
// ---------------------------------------------------------------------------------------------------------
const MAX_IMAGE = 5 * 1024 * 1024;

async function storePostImage(userId: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE) throw new Error("Images must be 5 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind || kind === "svg") throw new Error("Upload a JPG, PNG or WebP image.");
  // Re-encode: strips EXIF/GPS metadata and anything that isn't pixels.
  const out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const path = `posts/${userId}/${randomUUID()}.webp`;
  const { error } = await createAdminClient().storage.from("academy-media").upload(path, out, { contentType: "image/webp", upsert: false });
  if (error) throw new Error("The image couldn't be uploaded. Please try again.");
  return path;
}

export async function createPost(form: FormData) {
  const { user, db } = await session("/academy");
  const ret = safePath(str(form, "return_to"), "/academy");
  if (!(await rateLimit(`academy-post:${user.id}`, 10, 60 * 60_000))) redirect(back(ret, { err: academyErrorMessage("rate_limited") }));
  let image: string | null = null;
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    try { image = await storePostImage(user.id, file); } catch (e) { redirect(back(ret, { err: (e as Error).message })); }
  }
  const { data, error } = await db.rpc("academy_create_post", {
    p: {
      category_slug: str(form, "category"), title: str(form, "title"), body: str(form, "body"), kind: str(form, "kind") || "discussion",
      trade_slug: str(form, "trade") || null, state_code: str(form, "state_code") || null, link_url: str(form, "link_url") || null, image_path: image,
    },
  });
  if (error) {
    if (image) await createAdminClient().storage.from("academy-media").remove([image]);
    redirect(back(ret, { err: academyErrorMessage(error.message) }));
  }
  revalidatePath("/academy");
  redirect(`/academy/post/${data}`);
}

export async function editPost(form: FormData) {
  const id = str(form, "id");
  const { db } = await session(`/academy/post/${id}`);
  if (!uuid.safeParse(id).success) redirect("/academy");
  const { error } = await db.rpc("academy_edit_post", { p_id: id, p: { title: str(form, "title"), body: str(form, "body"), link_url: str(form, "link_url") || null } });
  if (error) redirect(back(`/academy/post/${id}`, { err: academyErrorMessage(error.message) }));
  revalidatePath(`/academy/post/${id}`);
  redirect(back(`/academy/post/${id}`, { msg: "Post updated." }));
}

export async function deletePost(form: FormData) {
  const id = str(form, "id");
  const { db } = await session();
  if (!uuid.safeParse(id).success) redirect("/academy");
  const { error } = await db.rpc("academy_delete_post", { p_id: id });
  if (error) redirect(back(`/academy/post/${id}`, { err: academyErrorMessage(error.message) }));
  revalidatePath("/academy");
  redirect(back("/academy", { msg: "Post deleted." }));
}

export async function addComment(form: FormData) {
  const postId = str(form, "post_id");
  const { user, db } = await session(`/academy/post/${postId}`);
  if (!uuid.safeParse(postId).success) redirect("/academy");
  if (!(await rateLimit(`academy-comment:${user.id}`, 40, 60 * 60_000))) redirect(back(`/academy/post/${postId}`, { err: academyErrorMessage("rate_limited") }));
  const parent = str(form, "parent_id");
  const { data, error } = await db.rpc("academy_comment", { p_post_id: postId, p_body: str(form, "body"), p_parent_id: uuid.safeParse(parent).success ? parent : null });
  if (error) redirect(back(`/academy/post/${postId}`, { err: academyErrorMessage(error.message) }));
  revalidatePath(`/academy/post/${postId}`);
  redirect(`/academy/post/${postId}#c-${data}`);
}

export async function deleteComment(form: FormData) {
  const id = str(form, "id"); const postId = str(form, "post_id");
  const { db } = await session();
  if (!uuid.safeParse(id).success || !uuid.safeParse(postId).success) redirect("/academy");
  const { error } = await db.rpc("academy_delete_comment", { p_id: id });
  if (error) redirect(back(`/academy/post/${postId}`, { err: academyErrorMessage(error.message) }));
  revalidatePath(`/academy/post/${postId}`);
  redirect(back(`/academy/post/${postId}`, { msg: "Comment deleted." }));
}

export async function markHelpful(form: FormData) {
  const id = str(form, "id"); const postId = str(form, "post_id");
  const { db } = await session();
  if (!uuid.safeParse(id).success || !uuid.safeParse(postId).success) redirect("/academy");
  const { error } = await db.rpc("academy_mark_helpful", { p_comment_id: id, p_on: form.get("on") !== "false" });
  if (error) redirect(back(`/academy/post/${postId}`, { err: academyErrorMessage(error.message) }));
  revalidatePath(`/academy/post/${postId}`);
  redirect(`/academy/post/${postId}#c-${id}`);
}

// ---------------------------------------------------------------------------------------------------------
// Reactions, bookmarks, reports (called from client components; return a result instead of redirecting)
// ---------------------------------------------------------------------------------------------------------
export type ToggleResult = { ok: true; count?: number } | { ok: false; message: string };

export async function toggleReaction(targetType: "post" | "comment", id: string, on: boolean): Promise<ToggleResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: academyErrorMessage("not_authenticated") };
  if (!uuid.safeParse(id).success || !["post", "comment"].includes(targetType)) return { ok: false, message: academyErrorMessage("not_found") };
  if (!(await rateLimit(`academy-react:${user.id}`, 120, 60 * 60_000))) return { ok: false, message: academyErrorMessage("rate_limited") };
  const { data, error } = await (await createClient()).rpc("academy_react", { p_target_type: targetType, p_target_id: id, p_on: on });
  return error ? { ok: false, message: academyErrorMessage(error.message) } : { ok: true, count: data as number };
}

export async function toggleBookmark(targetType: "post" | "course" | "lesson" | "resource", id: string, on: boolean): Promise<ToggleResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: academyErrorMessage("not_authenticated") };
  if (!uuid.safeParse(id).success || !["post", "course", "lesson", "resource"].includes(targetType)) return { ok: false, message: academyErrorMessage("not_found") };
  const { error } = await (await createClient()).rpc("academy_bookmark", { p_target_type: targetType, p_target_id: id, p_on: on });
  return error ? { ok: false, message: academyErrorMessage(error.message) } : { ok: true };
}

export async function reportContent(targetType: "post" | "comment" | "member", id: string, reason: string, details: string): Promise<ToggleResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: academyErrorMessage("not_authenticated") };
  if (!uuid.safeParse(id).success) return { ok: false, message: academyErrorMessage("not_found") };
  const { error } = await (await createClient()).rpc("academy_report", { p_target_type: targetType, p_target_id: id, p_reason: reason, p_details: details.slice(0, 1000) });
  return error ? { ok: false, message: academyErrorMessage(error.message) } : { ok: true };
}

// ---------------------------------------------------------------------------------------------------------
// Moderation shortcuts on posts (moderators/admins; the database checks the role)
// ---------------------------------------------------------------------------------------------------------
export async function moderate(form: FormData) {
  const type = str(form, "type"); const id = str(form, "id"); const action = str(form, "action");
  const ret = safePath(str(form, "return_to"), "/academy");
  const { db } = await session();
  if (!uuid.safeParse(id).success) redirect(ret);
  const { error } = await db.rpc("academy_moderate", { p_target_type: type, p_target_id: id, p_action: action, p_note: str(form, "note") || null });
  if (error) redirect(back(ret, { err: academyErrorMessage(error.message) }));
  revalidatePath("/academy");
  redirect(back(ret, { msg: "Done." }));
}

// ---------------------------------------------------------------------------------------------------------
// Classroom progress
// ---------------------------------------------------------------------------------------------------------
export async function completeLesson(form: FormData) {
  const id = str(form, "lesson_id"); const ret = safePath(str(form, "return_to"), "/academy/classroom");
  const { user, db } = await session(ret);
  if (!uuid.safeParse(id).success) redirect(ret);
  const done = form.get("done") !== "false";
  const score = form.get("quiz_score") ? Number(form.get("quiz_score")) : null;
  const { data, error } = await db.rpc("academy_complete_lesson", { p_lesson_id: id, p_done: done, p_quiz_score: Number.isFinite(score) ? score : null });
  if (error) redirect(back(ret, { err: academyErrorMessage(error.message) }));
  revalidatePath(ret);
  const r = data as { course_complete: boolean } | null;
  // Finishing a course can complete the monthly Academy challenge; deliver the free month if it was just earned.
  if (done && r?.course_complete) await deliverMyReward(user.id);
  redirect(back(ret, { msg: !done ? "Marked as not complete." : r?.course_complete ? "Course complete. Nice work: a badge has been added to your profile, and it counts toward your monthly Academy challenge." : "Lesson marked complete." }));
}
