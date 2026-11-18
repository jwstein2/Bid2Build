import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { commGate, ensureSettings, logEvent, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

/** Pause All: nothing automated goes to this account's customers until resumed. Anyone who can approve may pause; resuming needs settings rights. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = z.object({ paused: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  const perms = g.access.perms;
  const allowed = p.data.paused ? perms.some((k) => ["approve_marketing_outreach", "approve_customer_updates", "configure_project_updates", "enable_customer_nurture", "manage_opt_outs"].includes(k))
    : perms.includes("enable_customer_nurture") || perms.includes("configure_project_updates");
  if (!allowed) return fail(403, "forbidden", "You don't have permission to do that.");
  if (!p.data.paused) { const off = await commGate(g.admin, g.access.accountId); if (off) return off; }
  await ensureSettings(g.admin, g.access.accountId, g.access.kind === "company" ? "company" : "user");
  await g.admin.from("comm_settings").update({ paused_at: p.data.paused ? new Date().toISOString() : null, paused_by: p.data.paused ? g.userId : null }).eq("account_id", g.access.accountId);
  await logEvent(g.admin, { accountId: g.access.accountId, kind: p.data.paused ? "paused" : "resumed", actorId: g.userId, details: { all: true } });
  return json({ paused: p.data.paused });
}
