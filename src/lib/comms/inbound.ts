import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyCommReply, newText, REPLY_CLASS_LABEL } from "./classify";
import type { CommConfig } from "./config";
import { accountOwner, logEvent, notify, projectReviewer, suppress } from "./server";
import { tokenFromAddresses } from "./tokens";
import { QUEUED_STATUSES } from "./types";

type Row = Record<string, unknown>;
export interface InboundEmail { from: string; to: string[]; subject: string; text: string; inReplyTo: string | null; references: string | null; providerEventId: string | null }

const addr = (s: string) => s.match(/[^<\s@]+@[^>\s@]+\.[^>\s]+/)?.[0]?.toLowerCase() ?? "";

/**
 * A message arrived at the reply address. Matching uses our own reply token (reply+<token>@domain)
 * first, then the In-Reply-To / References Message-ID we set when sending. Unknown mail is ignored.
 * The body is untrusted data: classified by fixed rules, stored as a short excerpt, never followed.
 */
export async function processInbound(admin: SupabaseClient, cfg: CommConfig, m: InboundEmail): Promise<{ matched: boolean; test?: boolean; classification?: string; duplicate?: boolean }> {
  const token = tokenFromAddresses(m.to, cfg.replyDomain);
  // Setup check: the owner's test message proves the receiving route really works.
  if (token) {
    const { data: g } = await admin.from("comm_global").select("inbound_test_token").eq("id", 1).maybeSingle();
    if (g && (g as Row).inbound_test_token === token) {
      await admin.from("comm_global").update({ inbound_verified_at: new Date().toISOString(), inbound_test_token: null, updated_at: new Date().toISOString() }).eq("id", 1);
      await logEvent(admin, { accountId: null, kind: "settings", details: { inbound: "verified" }, providerEventId: m.providerEventId });
      return { matched: true, test: true };
    }
  }
  let msg: Row | null = null;
  if (token) msg = (await admin.from("comm_messages").select("*").eq("reply_token", token).maybeSingle()).data as Row | null;
  if (!msg) {
    const ids = `${m.inReplyTo ?? ""} ${m.references ?? ""}`.match(/<[^<>\s]+>/g) ?? [];
    for (const id of ids.reverse()) {
      msg = (await admin.from("comm_messages").select("*").eq("rfc_message_id", id).maybeSingle()).data as Row | null;
      if (msg) break;
    }
  }
  if (!msg) return { matched: false };

  const accountId = String(msg.account_id);
  const toEmail = String(msg.to_email ?? "").toLowerCase();
  const from = addr(m.from);
  const cls = classifyCommReply({ from: m.from, subject: m.subject, text: m.text });
  const excerpt = newText(m.text).slice(0, 1200);
  const kind = cls === "auto_reply" ? "auto_reply" : cls === "bounce" ? "bounce" : cls === "opt_out" ? "opt_out_request" : cls === "possible_opt_out" ? "ambiguous_reply" : "reply";
  const fresh = await logEvent(admin, {
    accountId, kind, messageId: String(msg.id), contactId: (msg.contact_id as string) ?? null, fromEmail: from, subject: m.subject, excerpt,
    details: { classification: cls, label: REPLY_CLASS_LABEL[cls], senderMatches: from === toEmail }, needsAttention: cls !== "auto_reply" && cls !== "bounce", providerEventId: m.providerEventId,
  });
  if (!fresh) return { matched: true, duplicate: true };
  const now = new Date().toISOString();

  if (cls === "bounce") {
    await suppress(admin, { accountId: null, email: toEmail, scope: "all", reason: "bounce", source: "bounce notice", messageId: String(msg.id) });
    return { matched: true, classification: cls };
  }
  if (cls === "auto_reply") return { matched: true, classification: cls };

  // A person wrote back: stop automated follow-ups for them until the contractor resumes.
  if (msg.status === "sent" || msg.status === "delivered") await admin.from("comm_messages").update({ status: "replied", replied_at: now }).eq("id", String(msg.id));
  else await admin.from("comm_messages").update({ replied_at: now }).eq("id", String(msg.id));
  await admin.from("comm_contacts").update({ status: "replied", status_reason: "Customer replied", status_changed_at: now, last_reply_at: now })
    .eq("account_id", accountId).eq("email", toEmail).eq("status", "eligible");
  await admin.from("comm_messages").update({ status: "canceled", status_reason: "Customer replied" })
    .eq("account_id", accountId).eq("to_email", toEmail).eq("kind", "nurture").in("status", QUEUED_STATUSES);
  if (cls === "opt_out") {
    await suppress(admin, { accountId, email: toEmail, scope: msg.kind === "nurture" ? "marketing" : "all", reason: "stop_request", source: "reply", messageId: String(msg.id) });
    await admin.from("comm_messages").update({ opt_out_at: now }).eq("id", String(msg.id));
  } else if (cls === "possible_opt_out") {
    await suppress(admin, { accountId, email: toEmail, scope: "marketing", reason: "ambiguous_opt_out", source: "reply (flagged for review)", messageId: String(msg.id) });
  }

  // Tell the right person, with a link to the conversation.
  let userId: string;
  if (msg.kind === "project_update" && msg.schedule_id) {
    const { data: s } = await admin.from("project_schedules").select("project_manager_id, created_by, user_id").eq("id", String(msg.schedule_id)).maybeSingle();
    userId = s ? projectReviewer(s as Row) : (await accountOwner(admin, accountId)).ownerId;
  } else userId = String(msg.approved_by ?? msg.initiated_by ?? (await accountOwner(admin, accountId)).ownerId);
  const owner = await accountOwner(admin, accountId);
  await notify(admin, {
    userId, companyId: owner.kind === "company" ? accountId : null, kind: "customer_reply", dedupeKey: `customer_reply:${msg.id}:${m.providerEventId ?? now}`,
    title: `${REPLY_CLASS_LABEL[cls]}: ${String(msg.to_name ?? toEmail)}`, scheduleId: (msg.schedule_id as string) ?? null,
    data: { messageId: msg.id, customerName: msg.to_name ?? null, subject: m.subject.slice(0, 200), classification: cls, kind: msg.kind },
  });
  return { matched: true, classification: cls };
}
