import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { isSuppressed } from "@/lib/comms/eligibility";
import { loadSuppressions, logEvent, requireComm, suppress } from "@/lib/comms/server";
import { QUEUED_STATUSES } from "@/lib/comms/types";

export const runtime = "nodejs";

const Body = z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "mark_replied", "suppress"]) }).strict();

/**
 * Per-contact control. Resuming never overrides a suppression (unsubscribe, STOP, bounce, complaint):
 * those are durable and only the customer can opt back in.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("manage_opt_outs");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  const { data: c } = await g.admin.from("comm_contacts").select("id, email, status").eq("id", p.data.id).eq("account_id", g.access.accountId).maybeSingle();
  if (!c) return fail(404, "not_found", "That contact wasn't found.");
  const email = String((c as { email: string }).email);
  const now = new Date().toISOString();
  const set = (status: string, reason: string, extra: Record<string, unknown> = {}) =>
    g.admin.from("comm_contacts").update({ status, status_reason: reason, status_changed_at: now, status_changed_by: g.userId, ...extra }).eq("id", p.data.id);
  if (p.data.action === "suppress") {
    await suppress(g.admin, { accountId: g.access.accountId, email, scope: "marketing", reason: "manual", source: "team", actorId: g.userId });
    return json({ status: "suppressed" });
  }
  if (p.data.action === "resume") {
    const supp = isSuppressed(await loadSuppressions(g.admin, g.access.accountId, [email]), g.access.accountId, email, "marketing");
    if (supp) return fail(409, "suppressed", "This person opted out or their address bounced. Follow-ups can't be turned back on for them.");
    await set("eligible", "Resumed by your team");
  } else {
    await set(p.data.action === "pause" ? "paused" : "replied", p.data.action === "pause" ? "Paused by your team" : "Marked as replied by your team", p.data.action === "mark_replied" ? { last_reply_at: now } : {});
    await g.admin.from("comm_messages").update({ status: "canceled", status_reason: p.data.action === "pause" ? "Contact paused" : "Customer replied" })
      .eq("account_id", g.access.accountId).eq("to_email", email).eq("kind", "nurture").in("status", QUEUED_STATUSES);
  }
  await logEvent(g.admin, { accountId: g.access.accountId, kind: p.data.action === "resume" ? "resumed" : "paused", contactId: p.data.id, actorId: g.userId, details: { action: p.data.action } });
  return json({ status: p.data.action === "resume" ? "eligible" : p.data.action === "pause" ? "paused" : "replied" });
}
