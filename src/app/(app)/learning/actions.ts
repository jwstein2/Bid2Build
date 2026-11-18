"use server";
/**
 * Creator (Learning Team) actions. Every call runs as the signed-in creator through their own
 * RLS client; ownership, seat capacity, consent and redaction are all enforced in Postgres.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { CommentInput, GiftInviteInput, ResourceInput, creatorErrorMessage } from "@/lib/creator/program";
import { giftUrl, newInviteToken } from "@/lib/creator/server";
import { rateLimit } from "@/lib/http/api";

export type LinkResult = { ok: true; link: string; email?: string; message: string } | { ok: false; message: string } | null;

const uuid = /^[0-9a-f-]{36}$/i;
const back = (programId: string, q: Record<string, string>) =>
  `/learning?${new URLSearchParams({ program: programId, ...q }).toString()}`;

async function session() {
  const user = await getUser();
  if (!user) redirect("/login?next=/learning");
  return { user, db: await createClient() };
}

export async function confirmTerms(form: FormData) {
  const programId = String(form.get("programId") ?? "");
  const { db } = await session();
  if (!uuid.test(programId) || form.get("agree") !== "on") redirect(back(programId, { err: "Tick the box to confirm you've read the program terms." }));
  const { error } = await db.rpc("creator_confirm_terms", { p_program_id: programId });
  if (error) redirect(back(programId, { err: creatorErrorMessage(error.message) }));
  revalidatePath("/learning");
  redirect(back(programId, { msg: "Thanks. Your Learning Team workspace is ready." }));
}

/** Creates a single-use invitation and returns the private link once. Nothing is emailed. */
export async function inviteGift(_prev: LinkResult, form: FormData): Promise<LinkResult> {
  const { user, db } = await session();
  if (!(await rateLimit(`creator-invite:${user.id}`, 20, 60 * 60_000))) return { ok: false, message: creatorErrorMessage("rate_limited") };
  const parsed = GiftInviteInput.safeParse({
    programId: form.get("programId"), email: form.get("email"),
    displayName: String(form.get("displayName") ?? "") || undefined,
    replaces: String(form.get("replaces") ?? "") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const { token, hash } = newInviteToken();
  const { error } = await db.rpc("creator_invite_gift", {
    p_program_id: parsed.data.programId, p_email: parsed.data.email, p_display_name: parsed.data.displayName ?? null,
    p_token_hash: hash, p_replaces: parsed.data.replaces ?? null,
  });
  if (error) return { ok: false, message: creatorErrorMessage(error.message) };
  revalidatePath("/learning");
  return { ok: true, link: giftUrl(token), email: parsed.data.email, message: `Invitation created for ${parsed.data.email}. Copy the private link below and send it to them yourself. It works once, only for that email address, and expires in 30 days.` };
}

/** New link for an unclaimed invitation; the old link stops working. */
export async function rotateGift(_prev: LinkResult, form: FormData): Promise<LinkResult> {
  const giftId = String(form.get("giftId") ?? "");
  const { user, db } = await session();
  if (!uuid.test(giftId)) return { ok: false, message: "That invitation no longer exists." };
  if (!(await rateLimit(`creator-invite:${user.id}`, 20, 60 * 60_000))) return { ok: false, message: creatorErrorMessage("rate_limited") };
  const { token, hash } = newInviteToken();
  const { error } = await db.rpc("creator_rotate_gift", { p_gift_id: giftId, p_token_hash: hash });
  if (error) return { ok: false, message: creatorErrorMessage(error.message) };
  revalidatePath("/learning");
  return { ok: true, link: giftUrl(token), message: "New private link created. The previous link no longer works." };
}

export async function markGiftSent(form: FormData) {
  const giftId = String(form.get("giftId") ?? "");
  const { db } = await session();
  if (uuid.test(giftId)) await db.rpc("creator_record_gift_sent", { p_gift_id: giftId });
}

export async function revokeGift(form: FormData) {
  const programId = String(form.get("programId") ?? "");
  const giftId = String(form.get("giftId") ?? "");
  const { db } = await session();
  if (form.get("confirm") !== "on") redirect(back(programId, { err: "Tick the confirmation box to remove this membership." }));
  const { error } = await db.rpc("creator_revoke_gift", { p_gift_id: giftId, p_reason: String(form.get("reason") ?? "").slice(0, 300) || null });
  if (error) redirect(back(programId, { err: creatorErrorMessage(error.message) }));
  revalidatePath("/learning");
  redirect(back(programId, { msg: "Removed. The seat is free again; their account and bids stay theirs.", tab: "team" }));
}

export async function saveResource(form: FormData) {
  const programId = String(form.get("programId") ?? "");
  const { db } = await session();
  const checklist = String(form.get("checklist") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const parsed = ResourceInput.safeParse({
    programId, id: String(form.get("id") ?? "") || undefined, kind: form.get("kind"), title: form.get("title"),
    url: String(form.get("url") ?? ""), body: String(form.get("body") ?? "") || undefined, checklist: checklist.length ? checklist : undefined,
  });
  if (!parsed.success) redirect(back(programId, { err: parsed.error.issues[0]?.message ?? "Check the resource fields.", tab: "resources" }));
  const r = parsed.data;
  const { error } = await db.rpc("creator_save_resource", {
    p_program_id: r.programId, p_id: r.id ?? null, p_kind: r.kind, p_title: r.title, p_url: r.url || null,
    p_body: r.body ?? null, p_checklist: r.checklist ?? null, p_sort: Number(form.get("sort") ?? 0) || 0,
  });
  if (error) redirect(back(programId, { err: creatorErrorMessage(error.message), tab: "resources" }));
  revalidatePath("/learning");
  redirect(back(programId, { msg: "Resource saved.", tab: "resources" }));
}

export async function deleteResource(form: FormData) {
  const programId = String(form.get("programId") ?? "");
  const { db } = await session();
  const { error } = await db.rpc("creator_delete_resource", { p_program_id: programId, p_id: String(form.get("id") ?? "") });
  if (error) redirect(back(programId, { err: creatorErrorMessage(error.message), tab: "resources" }));
  revalidatePath("/learning");
  redirect(back(programId, { msg: "Resource deleted.", tab: "resources" }));
}

/** Coaching comment or edit suggestion on a shared bid (used by both the creator and participant views). */
export async function addComment(form: FormData) {
  const { user, db } = await session();
  const returnTo = String(form.get("returnTo") ?? "");
  const safeReturn = /^\/(learning|mentorship)\/shares\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : "/learning";
  const parsed = CommentInput.safeParse({ shareId: form.get("shareId"), kind: form.get("kind"), body: form.get("body") });
  if (!parsed.success) redirect(`${safeReturn}?err=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the note.")}`);
  if (!(await rateLimit(`mentor-comment:${user.id}`, 60, 60 * 60_000))) redirect(`${safeReturn}?err=${encodeURIComponent(creatorErrorMessage("rate_limited"))}`);
  const { error } = await db.rpc("mentorship_add_comment", { p_share_id: parsed.data.shareId, p_kind: parsed.data.kind, p_body: parsed.data.body });
  if (error) redirect(`${safeReturn}?err=${encodeURIComponent(creatorErrorMessage(error.message))}`);
  revalidatePath(safeReturn);
  redirect(`${safeReturn}?msg=${encodeURIComponent("Posted.")}`);
}
