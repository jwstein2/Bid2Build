import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { buildAudience } from "@/lib/comms/eligibility";
import { PENDING_REASON, ensureSettings, loadContactFacts, loadEstimateFacts, loadSettings, loadSuppressions, logEvent, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

async function audienceFor(g: Extract<Awaited<ReturnType<typeof requireComm>>, { ok: true }>) {
  const kind = g.access.kind === "company" ? "company" : "user";
  const [settings, estimates, contacts, suppressions] = await Promise.all([
    loadSettings(g.admin, g.access.accountId), loadEstimateFacts(g.admin, g.access.accountId, kind), loadContactFacts(g.admin, g.access.accountId), loadSuppressions(g.admin, g.access.accountId),
  ]);
  return { settings, contacts, entries: buildAudience({ accountId: g.access.accountId, estimates, contacts, suppressions, now: new Date(), months: settings.nurtureMonths }) };
}

/** Who would be eligible (one row per email address) and who is already enrolled. Nothing is enrolled here. */
export async function GET() {
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const { entries } = await audienceFor(g);
  return json({ entries });
}

const Body = z.object({
  emails: z.array(z.string().max(320)).max(2000),
  /** For draft-only people: the contractor confirms a real relationship / permission to follow up. */
  confirmRelationship: z.array(z.string().max(320)).max(2000).default([]),
  activate: z.boolean().default(false),
}).strict();

/**
 * Enroll the people the contractor explicitly confirmed, and (activate) switch follow-ups on. Anyone
 * excluded (suppressed, replied, in progress...) is refused even if listed.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("approve_marketing_outreach");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That list isn't valid.");
  if (p.data.activate && !g.access.perms.includes("enable_customer_nurture")) return fail(403, "forbidden", "Only someone allowed to turn on customer follow-ups can activate them.");
  await ensureSettings(g.admin, g.access.accountId, g.access.kind === "company" ? "company" : "user");
  const confirmed = new Set(p.data.confirmRelationship.map((e) => e.toLowerCase()));
  // Confirming a relationship is recorded first so the draft-only rule can pass.
  for (const email of confirmed) {
    await g.admin.from("comm_contacts").upsert({ account_id: g.access.accountId, email, basis: "confirmed", status: "paused", status_reason: PENDING_REASON, enrolled_by: g.userId }, { onConflict: "account_id,email", ignoreDuplicates: true });
  }
  const { entries } = await audienceFor(g);
  const want = new Set(p.data.emails.map((e) => e.toLowerCase()));
  let enrolled = 0; const refused: { email: string; reason: string }[] = [];
  for (const e of entries.filter((x) => want.has(x.email))) {
    if (e.excluded || !e.basis) { refused.push({ email: e.email, reason: e.excluded ?? "Not eligible" }); continue; }
    const row = { account_id: g.access.accountId, email: e.email, name: e.name.slice(0, 200), customer_id: e.customerId, status: "eligible", status_reason: null, basis: e.basis, enrolled_at: new Date().toISOString(), enrolled_by: g.userId, status_changed_by: g.userId, status_changed_at: new Date().toISOString() };
    const { error } = e.contactId ? await g.admin.from("comm_contacts").update(row).eq("id", e.contactId).in("status", ["eligible", "paused"]) : await g.admin.from("comm_contacts").insert(row);
    if (!error) enrolled++;
  }
  if (p.data.activate) {
    await g.admin.from("comm_settings").update({ nurture_enabled: true, nurture_activated_at: new Date().toISOString(), nurture_activated_by: g.userId, updated_by: g.userId }).eq("account_id", g.access.accountId);
  }
  await logEvent(g.admin, { accountId: g.access.accountId, kind: "enrolled", actorId: g.userId, details: { enrolled, refused: refused.length, activated: p.data.activate } });
  return json({ enrolled, refused });
}
