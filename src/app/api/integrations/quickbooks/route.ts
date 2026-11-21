import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { guardRead, guardWrite } from "@/lib/team/route-helpers";
import { isQuickBooksEnabled, qbConfigured } from "@/lib/quickbooks/config";
import { QbError } from "@/lib/quickbooks/client";
import { disconnect, entities, liveConnection, loadLinks, saveLink, scopeFor, syncHours } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

const qbId = z.string().regex(/^\d{1,32}$/);
const name = z.string().trim().max(200).nullish().transform((v) => v ?? null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ops = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link_worker"), resourceId: z.string().uuid(), qbType: z.enum(["Employee", "Vendor"]).nullable(), qbId: qbId.nullable(), qbName: name }),
  z.object({ action: z.literal("link_job"), scheduleId: z.string().uuid(), qbId: qbId.nullable(), qbName: name }),
  z.object({ action: z.literal("sync"), from: day, to: day }),
  z.object({ action: z.literal("disconnect") }),
]);

function qbFail(where: string, e: unknown) {
  if (e instanceof QbError) {
    if (e.reauth) return fail(409, "reauth", "QuickBooks asked to sign in again. Click Reconnect QuickBooks.");
    if (e.status === 403) return fail(403, "forbidden", e.message);
    return fail(502, "quickbooks", e.message);
  }
  if (e instanceof Error && /qb_scope_mismatch/.test(e.message)) return fail(403, "forbidden", "That record belongs to another company.");
  logError(where, e);
  return fail(500, "error", "Something went wrong talking to QuickBooks. Please try again.");
}

async function ctx(g: { supabase: Parameters<typeof scopeFor>[0] }) {
  if (!isQuickBooksEnabled()) return { res: fail(404, "not_found", "Not found.") } as const;
  const scope = await scopeFor(g.supabase);
  if (!scope) return { res: fail(503, "not_ready", "The QuickBooks database update hasn't been applied yet.") } as const;
  if (!scope.canManage) return { res: fail(403, "forbidden", "Only people who manage your team can connect QuickBooks.") } as const;
  const admin = createAdminClient();
  return { scope, admin, conn: await liveConnection(admin, scope) } as const;
}

/** Connection status, matches and (with ?entities=1) the QuickBooks employees, vendors and customers to pick from. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const c = await ctx(g);
  if ("res" in c) return c.res;
  const base = { configured: qbConfigured(), connection: c.conn };
  if (!c.conn) return json({ ...base, links: { workers: [], jobs: [] }, entities: [] });
  const links = await loadLinks(c.admin, c.conn);
  if (new URL(req.url).searchParams.get("entities") !== "1" || c.conn.status !== "active") return json({ ...base, links, entities: [] });
  try {
    return json({ ...base, links, entities: await entities(c.admin, c.conn) });
  } catch (e) {
    if (e instanceof QbError) return json({ ...base, connection: await liveConnection(c.admin, c.scope), links, entities: [], entitiesError: e.message });
    return qbFail("quickbooks.entities", e);
  }
}

export async function POST(req: Request) {
  const g = await guardWrite("quickbooks", 60);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const c = await ctx(g);
  if ("res" in c) return c.res;
  if (!c.conn) return fail(409, "not_connected", "Connect QuickBooks first.");
  const o = p.data;
  try {
    switch (o.action) {
      case "link_worker":
        await saveLink(c.admin, c.conn, g.userId, { kind: "worker", resourceId: o.resourceId, qbType: o.qbType, qbId: o.qbId, qbName: o.qbName });
        return json({ ok: true });
      case "link_job":
        await saveLink(c.admin, c.conn, g.userId, { kind: "job", scheduleId: o.scheduleId, qbId: o.qbId, qbName: o.qbName });
        return json({ ok: true });
      case "disconnect":
        await disconnect(c.admin, c.conn, g.userId);
        return json({ ok: true });
      case "sync": {
        if (c.conn.status !== "active") return fail(409, "reauth", "QuickBooks asked to sign in again. Click Reconnect QuickBooks.");
        const from = new Date(`${o.from}T00:00:00Z`), to = new Date(`${o.to}T00:00:00Z`);
        if (!(to >= from) || to.getTime() - from.getTime() > 62 * 864e5) return fail(400, "invalid", "Pick a range of up to two months.");
        // Pad a day each side for time zones; entries are filtered to the chosen days by their local date below.
        const r = await syncHours(c.admin, g.supabase, c.conn, g.userId, new Date(from.getTime() - 864e5).toISOString(), new Date(to.getTime() + 2 * 864e5).toISOString(), { from: o.from, to: o.to });
        return json(r);
      }
    }
  } catch (e) {
    return qbFail(`quickbooks.${o.action}`, e);
  }
}
