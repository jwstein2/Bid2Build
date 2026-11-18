import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { commConfig, replyMonitoring } from "@/lib/comms/config";
import { validateTemplate } from "@/lib/comms/nurture";
import { commGate, ensureSettings, loadSettings, logEvent, requireComm } from "@/lib/comms/server";
import { safeTz } from "@/lib/comms/time";

export const runtime = "nodejs";

const Body = z.object({
  nurtureEnabled: z.boolean().optional(),
  nurtureMonths: z.number().int().min(3).max(24).optional(),
  nurtureIncludeOffers: z.boolean().optional(),
  nurtureMode: z.enum(["review", "automatic"]).optional(),
  nurtureSubject: z.string().max(200).nullable().optional(),
  nurtureBody: z.string().max(4000).nullable().optional(),
  updatesFrequency: z.enum(["off", "weekly", "milestone", "both"]).optional(),
  updatesMode: z.enum(["review", "automatic"]).optional(),
  updatesWeekday: z.number().int().min(1).max(7).optional(),
  updatesHour: z.number().int().min(6).max(20).optional(),
  timezone: z.string().max(64).optional(),
  postalAddress: z.string().max(300).nullable().optional(),
  senderName: z.string().max(120).nullable().optional(),
  replyTo: z.string().max(320).email().nullable().optional().or(z.literal("")),
  confirmAutomatic: z.boolean().optional(),
}).strict();

/**
 * Company-wide communication settings. Each field needs its own permission; switching anything to
 * automatic needs the owner-delegated permission plus an explicit confirmation in the same request.
 */
export async function PUT(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Those settings aren't valid.");
  const b = p.data;
  const off = await commGate(g.admin, g.access.accountId);
  if (off) return off;
  if (b.nurtureEnabled === true) {
    const t = await commGate(g.admin, g.access.accountId, { terms: true });
    if (t) return t;
  }
  const has = (k: Parameters<typeof g.access.perms.includes>[0]) => g.access.perms.includes(k);
  const cur = await loadSettings(g.admin, g.access.accountId);
  const patch: Record<string, unknown> = {};
  if (b.nurtureEnabled !== undefined || b.nurtureMonths !== undefined) {
    if (!has("enable_customer_nurture")) return fail(403, "forbidden", "Only someone allowed to turn on customer follow-ups can change this.");
    if (b.nurtureEnabled !== undefined) {
      patch.nurture_enabled = b.nurtureEnabled;
      // Turning it off clears activation: switching back on needs the audience confirmed again.
      if (!b.nurtureEnabled) { patch.nurture_activated_at = null; patch.nurture_activated_by = null; }
    }
    if (b.nurtureMonths !== undefined) patch.nurture_months = b.nurtureMonths;
  }
  if (b.nurtureMode !== undefined) {
    if (!has("enable_customer_nurture")) return fail(403, "forbidden", "Only someone allowed to turn on customer follow-ups can change the sending mode.");
    if (b.nurtureMode === "automatic" && cur.nurtureMode !== "automatic") {
      if (!b.confirmAutomatic) return fail(400, "confirm_required", "Confirm that follow-ups may send without review.");
      const cfg = commConfig();
      const { data: gl } = await g.admin.from("comm_global").select("inbound_verified_at").eq("id", 1).maybeSingle();
      if (!replyMonitoring(cfg, (gl as { inbound_verified_at?: string | null } | null)?.inbound_verified_at ?? null).active)
        return fail(409, "reply_monitoring_required", "Automatic follow-ups need working reply monitoring, so a customer who replies is never emailed again automatically. Until then every follow-up waits for your approval.");
    }
    patch.nurture_mode = b.nurtureMode;
  }
  if (b.nurtureIncludeOffers !== undefined || b.nurtureSubject !== undefined || b.nurtureBody !== undefined) {
    if (!has("edit_nurture_templates")) return fail(403, "forbidden", "You can't edit follow-up templates.");
    if (b.nurtureIncludeOffers !== undefined) patch.nurture_include_offers = b.nurtureIncludeOffers;
    if (b.nurtureSubject !== undefined || b.nurtureBody !== undefined) {
      const subject = b.nurtureSubject ?? cur.nurtureSubject, body = b.nurtureBody ?? cur.nurtureBody;
      if (subject || body) {
        const why = validateTemplate(subject ?? "", body ?? "");
        if (why) return fail(400, "invalid_template", why);
      }
      patch.nurture_subject = subject || null; patch.nurture_body = body || null; patch.template_version = cur.templateVersion + 1;
    }
  }
  if (b.updatesFrequency !== undefined || b.updatesWeekday !== undefined || b.updatesHour !== undefined || b.timezone !== undefined) {
    if (!has("configure_project_updates")) return fail(403, "forbidden", "You can't change project update settings.");
    if (b.updatesFrequency !== undefined) patch.updates_frequency = b.updatesFrequency;
    if (b.updatesWeekday !== undefined) patch.updates_weekday = b.updatesWeekday;
    if (b.updatesHour !== undefined) patch.updates_hour = b.updatesHour;
    if (b.timezone !== undefined) patch.timezone = safeTz(b.timezone);
  }
  if (b.updatesMode !== undefined) {
    // Automatic project updates are confirmed per project (with the disclaimer), never as a company default.
    if (b.updatesMode === "automatic") return fail(400, "per_project", "Automatic sending is turned on for each project in its Customer updates panel.");
    if (!has("configure_project_updates")) return fail(403, "forbidden", "You can't change project update settings.");
    patch.updates_mode = b.updatesMode;
  }
  if (b.postalAddress !== undefined || b.senderName !== undefined || b.replyTo !== undefined) {
    if (!has("edit_nurture_templates") && !has("configure_project_updates")) return fail(403, "forbidden", "You can't change sender details.");
    if (b.postalAddress !== undefined) patch.postal_address = b.postalAddress?.trim() || null;
    if (b.senderName !== undefined) patch.sender_name = b.senderName?.trim() || null;
    if (b.replyTo !== undefined) patch.reply_to = (b.replyTo || "").trim().toLowerCase() || null;
  }
  if (!Object.keys(patch).length) return json({ settings: cur });
  await ensureSettings(g.admin, g.access.accountId, g.access.kind === "company" ? "company" : "user");
  const { error } = await g.admin.from("comm_settings").update({ ...patch, updated_by: g.userId }).eq("account_id", g.access.accountId);
  if (error) return fail(500, "save_failed", "Could not save settings.");
  await logEvent(g.admin, { accountId: g.access.accountId, kind: "settings", actorId: g.userId, details: { changed: Object.keys(patch) } });
  return json({ settings: await loadSettings(g.admin, g.access.accountId) });
}
