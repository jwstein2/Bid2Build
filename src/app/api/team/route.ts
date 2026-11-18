import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { loadTeam, teamDbError } from "@/lib/projects/server";

export const runtime = "nodejs";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["staff", "subcontractor", "crew"]),
  name: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).nullish(),
  linkedUserId: z.string().uuid().nullish(),
  trades: z.array(z.string().trim().max(40)).max(20).default([]),
  email: z.union([z.literal(""), z.string().trim().email().max(320)]).nullish(),
  phone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  capacity: z.number().int().min(1).max(50).default(1),
  unavailable: z.array(day).max(400).default([]),
  members: z.array(z.string().uuid()).max(100).optional(),
  // V7.3 Contractors & Workforce (optional: the V4.2 form doesn't send them, and SQL keeps the saved values).
  entity: z.enum(["company", "individual"]).nullish(),
  parentId: z.string().uuid().nullish(),
  crewSize: z.number().int().min(1).max(500).nullish(),
  capacityDeclared: z.boolean().optional(),
  specialties: z.array(z.string().trim().max(60)).max(20).optional(),
});

/** The caller's Team & Subcontractors directory (company or solo account). */
export async function GET() {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const team = await loadTeam(await createClient());
  return team ? json(team) : fail(503, "not_ready", "Team & Subcontractors hasn't been set up yet.");
}

/** Create or update one entry. Permission and company checks are repeated in SQL. Nothing is sent to anyone. */
export async function POST(req: Request) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("team-save", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", p.error.issues.some((i) => i.path[0] === "email") ? "Check the email address." : "Check the details and try again.");
  const { data, error } = await (await createClient()).rpc("pm_resource_save", { p: p.data });
  if (error) {
    const m = teamDbError(error);
    if (m.status === 500) logError("team.save", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ id: data as string });
}
