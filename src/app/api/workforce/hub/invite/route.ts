import { z } from "zod";
import { fail, json, logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { commConfig } from "@/lib/comms/config";
import { fromHeader, newRfcMessageId, sendCommEmail } from "@/lib/comms/send";
import { inDemoSession } from "@/lib/demo/guard";
import { PRACTICE_BLOCKED_MESSAGE } from "@/lib/demo/session";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";
import { inviteError, mapInviteStatus, workerInviteEmail } from "@/lib/workforce/hub/invite";

export const runtime = "nodejs";

/** Does this staff record have a login, or a pending worker-app invitation? */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const id = new URL(req.url).searchParams.get("resourceId") ?? "";
  if (!UUID_RE.test(id)) return fail(400, "invalid", "Pick a person.");
  const { data, error } = await g.supabase.rpc("pm_worker_invite_status", { p_resource_id: id });
  if (error) return dbFail("hub.invite.status", error);
  return json(mapInviteStatus(data));
}

const body = z.object({ resourceId: z.string().uuid(), email: z.string().trim().toLowerCase().email().max(320), send: z.boolean().optional() });

/**
 * Invite a staff member to the worker app (My work). Returns the one-time join link (only its hash is stored) and,
 * when asked, emails it from the company. Refused in Demo / Practice Mode: the data there is fake.
 */
export async function POST(req: Request) {
  const g = await guardWrite("worker-invite", 30);
  if (!g.ok) return g.res;
  if (await inDemoSession()) return fail(403, "practice_mode", PRACTICE_BLOCKED_MESSAGE);
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Enter the worker's email address.");
  const { data, error } = await g.supabase.rpc("pm_worker_invite_create", { p_resource_id: p.data.resourceId, p_email: p.data.email });
  if (error) { const e = inviteError(error.message); return e ? fail(e.status, e.code, e.message) : dbFail("hub.invite", error); }
  const r = (data ?? {}) as { status?: string; id?: string; token?: string; expiresAt?: string };
  if (r.status === "linked") return json({ status: "linked" });
  const link = `${site.url.replace(/\/+$/, "")}/company/join?token=${encodeURIComponent(String(r.token))}`;

  let emailed = false, emailNote: string | null = null;
  if (p.data.send) {
    const cfg = commConfig();
    const to = p.data.email;
    if (!cfg.enabled) emailNote = "Email sending is off right now, so copy the link or text it.";
    else if (cfg.mode === "test" && !cfg.testRecipients.includes(to)) emailNote = "Email is in test mode, so copy the link or text it.";
    else {
      const [{ data: res }, { data: c }, { data: me }] = await Promise.all([
        g.supabase.from("pm_resources").select("name").eq("id", p.data.resourceId).maybeSingle(),
        g.supabase.rpc("my_company"),
        g.supabase.from("business_profiles").select("company_name, email").eq("user_id", g.userId).maybeSingle(),
      ]);
      const company = (Array.isArray(c) ? c[0] : c) as { name?: string } | null;
      const companyName = String(company?.name || (me as { company_name?: string } | null)?.company_name || "Your company");
      const mail = workerInviteEmail({ companyName, workerName: String((res as { name?: string } | null)?.name ?? ""), link, expiresAt: String(r.expiresAt) });
      const sent = await sendCommEmail(cfg.apiKey, {
        idempotencyKey: `worker-invite/${r.id}`, from: fromHeader(companyName, cfg.fromAddress), to, replyTo: (me as { email?: string } | null)?.email ?? null,
        subject: mail.subject, text: mail.text, messageId: newRfcMessageId(), tags: [{ name: "kind", value: "worker_invite" }],
      });
      if (sent.ok) emailed = true; else { logError("hub.invite.email", sent.error); emailNote = "We couldn't send the email. Copy the link or text it."; }
    }
  }
  return json({ status: "invited", link, expiresAt: r.expiresAt, emailed, emailNote }, 201);
}
