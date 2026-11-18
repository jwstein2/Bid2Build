import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { COMM_TERMS_VERSION } from "@/lib/comms/rollout";
import { commGate, ensureSettings, loadSettings, logEvent, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

const Body = z.object({ accept: z.literal(true), version: z.number().int() }).strict();

/** Accept the customer email terms for the account (someone who may turn follow-ups or project updates on). */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Tick the box to accept the terms.");
  if (p.data.version !== COMM_TERMS_VERSION) return fail(409, "terms_changed", "The terms were updated. Reload the page and read them again.");
  if (!g.access.perms.includes("enable_customer_nurture") && !g.access.perms.includes("configure_project_updates"))
    return fail(403, "forbidden", "Only someone allowed to turn on customer emails can accept the terms.");
  const off = await commGate(g.admin, g.access.accountId);
  if (off) return off;
  await ensureSettings(g.admin, g.access.accountId, g.access.kind === "company" ? "company" : "user");
  const { error } = await g.admin.from("comm_settings").update({ terms_accepted_at: new Date().toISOString(), terms_accepted_by: g.userId, terms_version: COMM_TERMS_VERSION, updated_by: g.userId }).eq("account_id", g.access.accountId);
  if (error) return fail(503, "not_ready", "This needs a database update before it can be saved.");
  await logEvent(g.admin, { accountId: g.access.accountId, kind: "terms_accepted", actorId: g.userId, details: { version: COMM_TERMS_VERSION } });
  return json({ settings: await loadSettings(g.admin, g.access.accountId) });
}
