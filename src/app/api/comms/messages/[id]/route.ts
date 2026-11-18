import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { messageAction } from "@/lib/comms/actions";
import { commGate, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ action: z.enum(["approve", "send_now", "skip", "refresh", "cancel"]) }).strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Not found.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  // Skipping or canceling is always allowed; approving, sending or refreshing needs the switch on and the terms accepted.
  if (!["skip", "cancel"].includes(p.data.action)) {
    const gate = await commGate(g.admin, g.access.accountId, { terms: p.data.action !== "refresh" });
    if (gate) return gate;
  }
  const r = await messageAction(g.admin, g.access, g.userId, id, p.data.action);
  return r.ok ? json(r) : fail(r.status, r.code, r.message);
}
