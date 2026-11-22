import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyCommReply, newText } from "@/lib/comms/classify";
import type { CommConfig } from "@/lib/comms/config";
import type { InboundEmail } from "@/lib/comms/inbound";
import { tokenFromAddresses } from "@/lib/comms/tokens";
import { fromHeader } from "@/lib/comms/send";
import { site } from "@/lib/site";
import { logError } from "@/lib/http/api";

/**
 * A reply to a sales follow-up email that came back through the reply address (only used once reply
 * routing is set up and verified). Any human reply stops the campaign and is logged on the lead; an
 * opt-out request suppresses the address; out-of-office replies are ignored; bounce notices mark the
 * address bad. The reply is then forwarded to the rep so they can answer it. The body is untrusted
 * data: classified by fixed rules and stored only as a short excerpt.
 * Returns null when the message isn't a sales reply (the customer-communications handler takes it).
 */
export async function handleSalesInbound(admin: SupabaseClient, cfg: CommConfig, m: InboundEmail, fetchImpl: typeof fetch = fetch): Promise<{ matched: true; classification: string } | null> {
  const token = tokenFromAddresses(m.to, cfg.replyDomain);
  const ids = `${m.inReplyTo ?? ""} ${m.references ?? ""}`.match(/<sales-[^<>\s]+>/g) ?? [];
  if (!token && !ids.length) return null;
  const cls = classifyCommReply({ from: m.from, subject: m.subject, text: m.text });
  const kind = cls === "possible_opt_out" ? "human" : cls;
  const excerpt = newText(m.text).slice(0, 1200);
  const { data, error } = await admin.rpc("sales_campaign_reply_in", { p_token: token, p_rfc_ids: ids.length ? ids : null, p_class: kind, p_excerpt: excerpt });
  if (error || !data) return null;
  const r = data as { lead_id: string; company_name: string; rep_name: string; rep_email: string; to_email: string };
  if ((kind === "human" || kind === "opt_out") && cfg.apiKey) {
    const text = [`${r.company_name} replied to your Built2Bid follow-up${kind === "opt_out" ? " and asked to stop emails (they're now unsubscribed)" : ""}. The automatic follow-ups have stopped.`, "",
      `From: ${m.from}`, `Subject: ${m.subject}`, "", excerpt || "(no text)", "", `Open the lead: ${new URL(`/sales/leads/${r.lead_id}`, site.url)}`,
      ...(kind === "human" ? ["", "Reply to this email to answer them directly."] : [])].join("\n");
    await fetchImpl("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": `sales-reply/${m.providerEventId ?? token ?? ids[0]}` },
      body: JSON.stringify({ from: fromHeader("Built2Bid Sales Hub", "noreply@built2bid.org"), to: [r.rep_email], reply_to: kind === "human" ? r.to_email : undefined,
        subject: `Reply from ${r.company_name}: ${m.subject}`.slice(0, 200), text }),
    }).catch((e) => logError("sales_nurture.forward", e));
  }
  return { matched: true, classification: kind };
}
