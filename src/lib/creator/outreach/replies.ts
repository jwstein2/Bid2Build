import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyReply, newText, stageForReply, type ReplyClass } from "./classify";
import { addBusinessDays } from "./schedule";

/**
 * Record a reply from a creator (inbound mail webhook, or the owner logging it by hand). Any real reply
 * cancels pending follow-ups immediately. Unsubscribes and bounces are suppressed permanently.
 * "Accepted" is never set here: only the owner can record explicit acceptance of the terms.
 */
export async function recordReply(db: SupabaseClient, input: {
  prospectId: string; from?: string | null; subject?: string | null; text?: string | null; classification?: ReplyClass; actorId?: string | null; now?: Date;
}): Promise<{ classification: ReplyClass; stage: string | null }> {
  const now = input.now ?? new Date();
  const classification = input.classification ?? classifyReply(input);
  const { data: p } = await db.from("creator_prospects").select("id, contact_email, follow_up_sent_at, follow_up_due_at, stage").eq("id", input.prospectId).maybeSingle();
  if (!p) throw new Error("not_found");
  const excerpt = newText(input.text ?? "").slice(0, 600);
  await db.from("creator_outreach_events").insert({ prospect_id: p.id, kind: classification === "bounce" ? "bounce" : "reply", actor_id: input.actorId ?? null,
    details: { classification, subject: (input.subject ?? "").slice(0, 200), excerpt, from: (input.from ?? "").slice(0, 200) } });

  if (classification === "out_of_office") {
    // Not a real reply: push the follow-up out 2 business days, never send during the absence.
    const until = addBusinessDays(now, 2);
    const due = p.follow_up_due_at && new Date(p.follow_up_due_at) > until ? p.follow_up_due_at : until.toISOString();
    await db.from("creator_prospects").update({ postponed_until: until.toISOString(), follow_up_due_at: due, reply_classification: "out_of_office" }).eq("id", p.id);
    await db.from("creator_outreach_messages").update({ scheduled_for: until.toISOString() }).eq("prospect_id", p.id).in("status", ["approved", "failed"]);
    return { classification, stage: null };
  }

  const stage = stageForReply(classification);
  await db.from("creator_outreach_messages").update({ status: "cancelled", last_error: `reply: ${classification}` })
    .eq("prospect_id", p.id).in("status", ["draft", "approved", "failed"]);
  await db.from("creator_prospects").update({
    replied_at: now.toISOString(), replied_after: p.follow_up_sent_at ? "follow_up" : "initial", reply_classification: classification,
    ...(stage ? { stage } : {}),
  }).eq("id", p.id);
  if (stage && stage !== p.stage) await db.from("creator_outreach_events").insert({ prospect_id: p.id, kind: "stage", actor_id: input.actorId ?? null, details: { from: p.stage, to: stage } });
  const suppress = classification === "unsubscribe" ? "unsubscribe" : classification === "bounce" ? "bounce" : classification === "not_interested" ? "declined" : null;
  if (suppress && p.contact_email) {
    await db.from("creator_outreach_suppressions").upsert({ email: p.contact_email, reason: suppress }, { onConflict: "email", ignoreDuplicates: true });
    await db.from("creator_outreach_events").insert({ prospect_id: p.id, kind: "suppressed", details: { reason: suppress } });
  }
  return { classification, stage };
}

/** Find the prospect an inbound email belongs to: In-Reply-To first, then the sender address. */
export async function matchProspect(db: SupabaseClient, from: string | null, inReplyTo: string | null): Promise<string | null> {
  if (inReplyTo) {
    const { data } = await db.from("creator_outreach_messages").select("prospect_id").eq("rfc_message_id", inReplyTo.trim()).maybeSingle();
    if (data) return data.prospect_id as string;
  }
  const addr = (from ?? "").match(/[^<\s@]+@[^>\s@]+\.[^>\s]+/)?.[0]?.toLowerCase();
  if (!addr) return null;
  const { data } = await db.from("creator_prospects").select("id").eq("contact_email", addr).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
