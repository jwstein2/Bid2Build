"use server";
/**
 * Participant (gifted subscriber) mentorship controls. Everything is opt-in and revocable, runs as the
 * participant through their own RLS client, and only ever touches their own records.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";
import { computeEstimate } from "@/lib/estimate/engine";
import { ConsentInput, ShareInput, creatorErrorMessage } from "@/lib/creator/program";

const done = (q: Record<string, string>) => redirect(`/mentorship?${new URLSearchParams(q)}`);

async function session() {
  const user = await getUser();
  if (!user) redirect("/login?next=/mentorship");
  return { user, db: await createClient() };
}

export async function saveConsent(form: FormData) {
  const { db } = await session();
  const parsed = ConsentInput.safeParse({
    programId: form.get("programId"),
    allowComments: form.get("allowComments") === "on",
    allowSuggestions: form.get("allowSuggestions") === "on",
    sharePipelineSummary: form.get("sharePipelineSummary") === "on",
  });
  if (!parsed.success) done({ err: "Check the settings." });
  const c = parsed.data!;
  const { error } = await db.rpc("set_mentorship_consent", { p_program_id: c.programId, p_allow_comments: c.allowComments, p_allow_suggestions: c.allowSuggestions, p_share_pipeline: c.sharePipelineSummary });
  if (error) done({ err: creatorErrorMessage(error.message) });
  revalidatePath("/mentorship");
  done({ msg: "Sharing settings saved." });
}

/**
 * Share (or change what's shared for) one of my bids. Totals are computed here from the participant's
 * own estimate (read under their RLS session) so the mentor sees the same numbers as the proposal.
 */
export async function shareBid(form: FormData) {
  const { db } = await session();
  const parsed = ShareInput.safeParse({
    programId: form.get("programId"), estimateId: form.get("estimateId"),
    shareCosts: form.get("shareCosts") === "on", shareMargin: form.get("shareMargin") === "on", shareProjectInfo: form.get("shareProjectInfo") === "on",
  });
  if (!parsed.success) done({ err: "Pick a bid to share." });
  const s = parsed.data!;
  const loaded = await loadEstimate(db, s.estimateId);
  if (!loaded) done({ err: "That bid wasn't found." });
  const t = computeEstimate(loaded!.estimate);
  const snapshot = { subtotal: t.subtotal.toFixed(2), tax: t.tax.toFixed(2), total: t.total.toFixed(2), adjustment: t.adjustment.toFixed(2) };
  const { error } = await db.rpc("share_estimate_for_mentorship", {
    p_program_id: s.programId, p_estimate_id: s.estimateId, p_costs: s.shareCosts, p_margin: s.shareMargin, p_project_info: s.shareProjectInfo, p_snapshot: snapshot,
  });
  if (error) done({ err: creatorErrorMessage(error.message) });
  revalidatePath("/mentorship");
  done({ msg: "Shared. You can change what's included or stop sharing at any time." });
}

export async function unshareBid(form: FormData) {
  const { db } = await session();
  const { error } = await db.rpc("revoke_mentorship_share", { p_share_id: String(form.get("shareId") ?? "") });
  if (error) done({ err: creatorErrorMessage(error.message) });
  revalidatePath("/mentorship");
  done({ msg: "Sharing turned off for that bid. Your mentor can no longer see it." });
}

export async function resolveComment(form: FormData) {
  const { db } = await session();
  const returnTo = String(form.get("returnTo") ?? "");
  const safe = /^\/mentorship\/shares\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : "/mentorship";
  await db.rpc("mentorship_resolve_comment", { p_comment_id: String(form.get("commentId") ?? "") });
  revalidatePath(safe);
  redirect(safe);
}
