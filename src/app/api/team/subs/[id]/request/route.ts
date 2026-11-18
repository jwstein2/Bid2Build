import { z } from "zod";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { fail, json, logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { commConfig } from "@/lib/comms/config";
import { fromHeader, newRfcMessageId, sendCommEmail } from "@/lib/comms/send";
import { dbFail, guardWrite, UUID_RE } from "@/lib/team/route-helpers";
import { SUB_REQUEST_KINDS, subRequestEmail } from "@/lib/team/sub-requests";

export const runtime = "nodejs";

const body = z.object({
  kinds: z.array(z.enum(SUB_REQUEST_KINDS)).min(1).max(6),
  toEmail: z.string().trim().email().max(320).optional(),
  note: z.string().trim().max(1000).optional(),
  send: z.boolean().optional(),
});

/**
 * Ask a subcontractor to fill in their own W-9 and upload insurance certificates / licenses. Creates a
 * one-time link (14 days; only its hash is stored) and, when customer email is on and an address is given,
 * emails it under the company's name. The link is always returned so it can be copied and texted.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("sub-request", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose what to ask for, and check the email address.");
  const token = newSigningToken();
  const tokenHash = hashSigningToken(token);
  const { data: reqId, error } = await g.supabase.rpc("pm_sub_request_create", { p_resource_id: id, p: { kinds: p.data.kinds, toEmail: p.data.toEmail, note: p.data.note, tokenHash } });
  if (error) return dbFail("subs.request", error);
  const link = `${site.url.replace(/\/+$/, "")}/sub-docs/${token}`;

  let emailed = false, emailNote: string | null = null;
  if (p.data.send && p.data.toEmail) {
    const cfg = commConfig();
    const to = p.data.toEmail.toLowerCase();
    if (!cfg.enabled) emailNote = "Email sending is off right now, so copy the link and send it yourself.";
    else if (cfg.mode === "test" && !cfg.testRecipients.includes(to)) emailNote = "Email is in test mode, so copy the link and send it yourself.";
    else {
      const [{ data: rec }, { data: me }] = await Promise.all([
        g.supabase.rpc("pm_sub_record", { p_resource_id: id }),
        g.supabase.from("business_profiles").select("company_name, email").eq("user_id", g.userId).maybeSingle(),
      ]);
      const { data: company } = await g.supabase.rpc("my_company_id");
      const { data: c } = company ? await g.supabase.from("companies").select("name").eq("id", company as string).maybeSingle() : { data: null };
      const companyName = String((c as { name?: string } | null)?.name || (me as { company_name?: string } | null)?.company_name || "Your contractor");
      const mail = subRequestEmail({ companyName, subName: String((rec as { name?: string } | null)?.name ?? ""), kinds: p.data.kinds, note: p.data.note ?? null, link });
      const res = await sendCommEmail(cfg.apiKey, {
        idempotencyKey: `subreq/${reqId}`, from: fromHeader(companyName, cfg.fromAddress), to, replyTo: (me as { email?: string } | null)?.email ?? null,
        subject: mail.subject, text: mail.text, messageId: newRfcMessageId(), tags: [{ name: "kind", value: "sub_request" }],
      });
      if (res.ok) emailed = true; else { logError("subs.request.email", res.error); emailNote = "We couldn't send the email. Copy the link and send it yourself."; }
    }
  }
  return json({ id: reqId as string, link, emailed, emailNote }, 201);
}

/** Cancel an open link. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("sub-request", 30);
  if (!g.ok) return g.res;
  await ctx.params;
  const reqId = new URL(req.url).searchParams.get("request") ?? "";
  if (!UUID_RE.test(reqId)) return fail(400, "invalid", "Choose a link.");
  const { error } = await g.supabase.rpc("pm_sub_request_revoke", { p_id: reqId });
  if (error) return dbFail("subs.request.revoke", error);
  return json({ ok: true }, 200);
}
