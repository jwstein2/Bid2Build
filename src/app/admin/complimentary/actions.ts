"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/server";
import { ExtendInput, GrantInput, SeatsInput, compErrorMessage, INVITE_DAYS, type CompHistoryEntry, type CompRow } from "@/lib/comp/grants";
import { INVITE_FAILURE_TEXT, inviteUrl, newInviteToken, sendCompInvitation } from "@/lib/comp/server";

/**
 * Complimentary Access server actions. Each one re-authorizes with requireAdmin() (404 for anyone
 * else) and then calls an admin_comp_* database function, which checks is_admin(caller) again and
 * writes the audit log in the same transaction. Nothing here talks to Stripe.
 */

export type ActionResult =
  | { ok: true; message: string; row?: CompRow; inviteLink?: string; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const Id = z.string().uuid();
const PATH = "/admin/complimentary";

function dbError(error: { message?: string } | null): ActionResult {
  return { ok: false, error: compErrorMessage(error?.message) };
}

export async function createGrant(input: unknown): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  const parsed = GrantInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const invite = newInviteToken();
  const { data, error } = await db.rpc("admin_comp_create", {
    p_caller: user.id, p_email: v.email, p_plan: v.plan, p_days: v.days, p_extra_seats: v.extraSeats,
    p_note: v.note ?? null, p_token_hash: invite.hash, p_invite_days: INVITE_DAYS,
  });
  if (error || !data) return dbError(error);
  const row = data as CompRow & { existing_account: boolean };
  revalidatePath(PATH);

  if (row.existing_account) {
    return { ok: true, row, message: `${v.email} already has a verified account, so access is active now until ${fmt(row.expires_at)}.` };
  }
  const link = inviteUrl(invite.token);
  if (!v.sendInvite) {
    return { ok: true, row, inviteLink: link, message: `Grant created for ${v.email}. Access starts when they sign up and verify this email. No email was sent; copy the link below if you want to send it yourself.` };
  }
  const sent = await sendCompInvitation(db, v.email, invite.token);
  await db.rpc("admin_comp_record_invite", { p_caller: user.id, p_id: row.id, p_sent: sent.sent, p_error: sent.sent ? null : sent.reason });
  revalidatePath(PATH);
  if (sent.sent) return { ok: true, row, inviteLink: link, message: `Invitation sent to ${v.email}. Their ${v.days}-day period starts when they accept.` };
  return { ok: true, row, inviteLink: link, message: `Grant created for ${v.email}.`, warning: INVITE_FAILURE_TEXT[sent.reason] };
}

export async function extendGrant(input: unknown): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  const p = ExtendInput.safeParse(input);
  if (!p.success) return { ok: false, error: "Choose between 1 and 365 days." };
  const { data, error } = await db.rpc("admin_comp_extend", { p_caller: user.id, p_id: p.data.id, p_days: p.data.days });
  if (error || !data) return dbError(error);
  revalidatePath(PATH);
  const row = data as CompRow;
  return { ok: true, row, message: row.status === "pending" ? `Extended: the period is now ${row.duration_days} days from activation.` : `Extended to ${fmt(row.expires_at)}.` };
}

export async function pauseGrant(id: string): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown grant." };
  const { data, error } = await db.rpc("admin_comp_pause", { p_caller: user.id, p_id: id });
  if (error || !data) return dbError(error);
  revalidatePath(PATH);
  return { ok: true, row: data as CompRow, message: "Paused. Access is off now; resuming adds the paused time back." };
}

export async function resumeGrant(id: string): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown grant." };
  const { data, error } = await db.rpc("admin_comp_resume", { p_caller: user.id, p_id: id });
  if (error || !data) return dbError(error);
  revalidatePath(PATH);
  const row = data as CompRow;
  return { ok: true, row, message: `Resumed. Access now runs until ${fmt(row.expires_at)}.` };
}

export async function revokeGrant(id: string, reason: string): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown grant." };
  const { data, error } = await db.rpc("admin_comp_revoke", { p_caller: user.id, p_id: id, p_reason: reason.slice(0, 500) || null });
  if (error || !data) return dbError(error);
  revalidatePath(PATH);
  return { ok: true, row: data as CompRow, message: "Revoked. Complimentary access ended now; their account, bids and any paid plan are untouched." };
}

export async function setExtraSeats(input: unknown): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  const p = SeatsInput.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter 0 to 50 extra seats and confirm you are authorizing them." };
  const { data, error } = await db.rpc("admin_comp_set_extra_seats", { p_caller: user.id, p_id: p.data.id, p_extra: p.data.extraSeats });
  if (error || !data) return dbError(error);
  revalidatePath(PATH);
  const row = data as CompRow;
  return { ok: true, row, message: `Seats updated: ${row.included_seats + row.extra_seats} licensed users in total.` };
}

export async function resendInvitation(id: string): Promise<ActionResult> {
  const { user, db } = await requireAdmin();
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown grant." };
  const invite = newInviteToken();
  const { data, error } = await db.rpc("admin_comp_rotate_invite", { p_caller: user.id, p_id: id, p_token_hash: invite.hash, p_invite_days: INVITE_DAYS });
  if (error || !data) return dbError(error);
  const row = data as CompRow;
  const sent = await sendCompInvitation(db, row.email, invite.token);
  await db.rpc("admin_comp_record_invite", { p_caller: user.id, p_id: id, p_sent: sent.sent, p_error: sent.sent ? null : sent.reason });
  revalidatePath(PATH);
  const link = inviteUrl(invite.token);
  if (sent.sent) return { ok: true, row, inviteLink: link, message: `New invitation sent to ${row.email}. Earlier links no longer work.` };
  return { ok: true, row, inviteLink: link, message: "A new invitation link was created. Earlier links no longer work.", warning: INVITE_FAILURE_TEXT[sent.reason] };
}

export async function grantDetail(id: string): Promise<{ ok: true; row: CompRow; history: CompHistoryEntry[] } | { ok: false; error: string }> {
  const { user, db } = await requireAdmin();
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown grant." };
  const { data, error } = await db.rpc("admin_comp_detail", { p_caller: user.id, p_id: id });
  if (error || !data) return { ok: false, error: compErrorMessage(error?.message ?? "not_found") };
  const { history, ...row } = data as CompRow & { history: CompHistoryEntry[] };
  return { ok: true, row: row as CompRow, history };
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "—";
}
