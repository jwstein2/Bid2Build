import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { ensureSettings, isAccountOwner, loadSettings, logEvent, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

const Body = z.object({ off: z.boolean(), reason: z.string().max(300).optional(), confirm: z.literal(true) }).strict();

/**
 * The account owner's switch for customer follow-ups and project update emails. Off: everything queued is
 * canceled, follow-ups are deactivated and projects go back to review first; it stays off (no expiry) and
 * nobody but the owner can turn it on again. On: nothing restarts by itself.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Confirm the change first.");
  if (!(await isAccountOwner(g.admin, g.access, g.userId))) return fail(403, "owner_only", "Only the account owner can turn customer emails on or off for the company.");
  await ensureSettings(g.admin, g.access.accountId, g.access.kind === "company" ? "company" : "user");
  const cur = await loadSettings(g.admin, g.access.accountId);
  const now = new Date().toISOString();
  if (p.data.off) {
    if (cur.disabledAt) return json({ off: true, settings: cur });
    const reason = p.data.reason?.trim() || null;
    const { error } = await g.admin.from("comm_settings").update({
      disabled_at: now, disabled_by: g.userId, disabled_reason: reason, nurture_enabled: false, nurture_activated_at: null, nurture_activated_by: null, updated_by: g.userId,
    }).eq("account_id", g.access.accountId);
    if (error) return fail(503, "not_ready", "This needs a database update before it can be saved.");
    await g.admin.from("project_comm_settings").update({ mode: "review", updated_by: g.userId }).eq("account_id", g.access.accountId).eq("mode", "automatic");
    await g.admin.from("comm_messages").update({ status: "canceled", status_reason: "Customer emails were turned off by the account owner", locked_until: null })
      .eq("account_id", g.access.accountId).in("kind", ["nurture", "project_update"]).in("status", ["draft", "scheduled", "awaiting_review", "approved", "failed", "paused"]);
    await logEvent(g.admin, { accountId: g.access.accountId, kind: "disabled", actorId: g.userId, details: { reason } });
  } else {
    if (!cur.disabledAt) return json({ off: false, settings: cur });
    await g.admin.from("comm_settings").update({ disabled_at: null, disabled_by: null, disabled_reason: null, updated_by: g.userId }).eq("account_id", g.access.accountId);
    await logEvent(g.admin, { accountId: g.access.accountId, kind: "enabled", actorId: g.userId });
  }
  return json({ off: p.data.off, settings: await loadSettings(g.admin, g.access.accountId) });
}
