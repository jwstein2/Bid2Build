import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inDemoSession } from "../demo/guard";
import { logError } from "../http/api";
import { site } from "../site";

/**
 * Affiliate emails from partners@ / noreply@built2bid.org via Resend. Every send is recorded once per key
 * (affiliate_email_log), so retries never double-send. Two switches, both OFF until James turns them on:
 *  - AFFILIATE_EMAILS=on            transactional program emails (welcome, approval, payout notices)
 *  - affiliate_settings.recruitment_emails  recruitment/outreach to prospects (also checks suppressions)
 * Without RESEND_API_KEY nothing is sent (the log shows "logged_off" with the reason).
 */
export type AffiliateTemplate =
  | "invite" | "invite_follow_up" | "application_received" | "approved" | "rejected" | "onboarding_reminder" | "activated"
  | "commission_payable" | "payout_sent" | "payout_problem" | "policy_notice" | "suspended" | "terminated";

export function transactionalOn(): boolean {
  return process.env.AFFILIATE_EMAILS === "on";
}

export interface EmailBody { subject: string; text: string }

const sign = ["", "James", "Built2Bid", site.url].join("\n");
const optOut = (email: string) => `\n\nDon't want these emails? ${site.url}/unsubscribe?e=${encodeURIComponent(email)}&list=affiliates`;

/** Plain-text bodies (no tracking pixels). Recruitment templates carry the sender address and an opt-out line. */
export function render(t: AffiliateTemplate, v: { name?: string | null; email: string; link?: string; note?: string | null; amount?: string; reason?: string | null; ref?: string }): EmailBody {
  const hi = `Hi ${(v.name ?? "").split(" ")[0] || "there"},`;
  switch (t) {
    case "invite":
      return { subject: "An invitation to the Built2Bid affiliate program",
        text: [hi, "", v.note ?? "I run Built2Bid, estimating and bid software for contractors. I think your audience would get real value from it, and I'd like to invite you to our affiliate program.",
          "", "How it pays: when someone you refer becomes a paying customer, you earn one month of their subscription value once a year, for up to 10 years while they stay a paying customer. It's paid annually, not monthly. Earnings depend on your referrals and are not guaranteed.",
          "", `Your private invitation (expires in 14 days): ${v.link}`, sign, "", "Built2Bid L.L.C., Minnesota, USA"].join("\n") + optOut(v.email) };
    case "invite_follow_up":
      return { subject: "Following up: Built2Bid affiliate invitation", text: [hi, "", "Just following up on my note about the Built2Bid affiliate program. No pressure; if it's not a fit, no reply needed.", "", `Invitation: ${v.link}`, sign, "", "Built2Bid L.L.C., Minnesota, USA"].join("\n") + optOut(v.email) };
    case "application_received":
      return { subject: "We got your Built2Bid affiliate application", text: [hi, "", "Thanks for applying. We review every application by hand and will email you either way, usually within a week.", sign].join("\n") };
    case "approved":
      return { subject: "You're approved: finish your Built2Bid affiliate setup", text: [hi, "", "You're approved to join the Built2Bid affiliate program. Sign in with this email address to finish setup (about 15 minutes): your details, your channel, a short training, the agreement, and tax and payout info.", "", `${site.url}/affiliate-hub`, sign].join("\n") };
    case "rejected":
      return { subject: "Your Built2Bid affiliate application", text: [hi, "", "Thank you for applying. We're not able to approve your application right now.", v.reason ? `\nReason: ${v.reason}` : "", "", "You're welcome to apply again later.", sign].join("\n") };
    case "onboarding_reminder":
      return { subject: "Reminder: finish your Built2Bid affiliate setup", text: [hi, "", "Your affiliate setup isn't finished yet. Your link starts working once it's complete and approved.", "", `${site.url}/affiliate-hub`, sign].join("\n") };
    case "activated":
      return { subject: "Your Built2Bid affiliate link is live", text: [hi, "", "Your affiliate account is active. Your link and resources are in the Affiliate Hub. Please always disclose the relationship when you share it (for example, \"I earn a commission if you sign up\").", "", `${site.url}/affiliate-hub`, sign].join("\n") };
    case "commission_payable":
      return { subject: `Commission ready to pay: ${v.amount}`, text: [hi, "", `An annual commission of ${v.amount} finished its 30-day hold and is ready for the next payout.`, "", `${site.url}/affiliate-hub/earnings`, sign].join("\n") };
    case "payout_sent":
      return { subject: `Payout deposited: ${v.amount}`, text: [hi, "", `Your affiliate payout ${v.ref} of ${v.amount} was deposited.`, "", `${site.url}/affiliate-hub/earnings`, sign].join("\n") };
    case "payout_problem":
      return { subject: "Action needed: your affiliate payout didn't arrive", text: [hi, "", `Your payout ${v.ref} (${v.amount}) didn't go through. The money is still owed to you; please check your bank details in the Affiliate Hub and we'll send it again.`, "", `${site.url}/affiliate-hub/profile`, sign].join("\n") };
    case "policy_notice":
      return { subject: "Update to the Built2Bid affiliate program", text: [hi, "", v.note ?? "", "", `${site.url}/affiliate-hub`, sign].join("\n") };
    case "suspended":
      return { subject: "Your Built2Bid affiliate account is paused", text: [hi, "", "Your affiliate account is paused while we review it. Earned commissions are kept on hold, not lost.", v.reason ? `\nReason: ${v.reason}` : "", "", "Reply to this email with any questions.", sign].join("\n") };
    case "terminated":
      return { subject: "Your Built2Bid affiliate agreement has ended", text: [hi, "", "Your Built2Bid affiliate agreement has ended. Commissions already earned are handled as described in your agreement.", v.reason ? `\nReason: ${v.reason}` : "", sign].join("\n") };
  }
}

const RECRUITMENT: AffiliateTemplate[] = ["invite", "invite_follow_up"];

/**
 * Sends (or records a skip) once per key. Recruitment templates need affiliate_settings.recruitment_emails and a
 * non-suppressed address; everything else needs AFFILIATE_EMAILS=on. Returns the recorded status.
 */
export async function sendAffiliateEmail(db: SupabaseClient, key: string, t: AffiliateTemplate, to: string, vars: Parameters<typeof render>[1],
  ids: { affiliateId?: string | null; prospectId?: string | null } = {}, f: typeof fetch = fetch): Promise<"sent" | "skipped" | "failed" | "duplicate"> {
  const record = async (status: string, providerId: string | null, error: string | null) => {
    const { data } = await db.rpc("affiliate_email_record", { p_key: key, p_template: t, p_to: to, p_affiliate: ids.affiliateId ?? null, p_prospect: ids.prospectId ?? null, p_status: status, p_provider_id: providerId, p_error: error });
    return data !== false;
  };
  try {
    const { data: prior } = await db.from("affiliate_email_log").select("status").eq("key", key).maybeSingle();
    if (prior) return "duplicate";   // one attempt per key (the log row is the idempotency record)
    const recruitment = RECRUITMENT.includes(t);
    let reason: string | null = null;
    if (recruitment) {
      const { data: s } = await db.from("affiliate_settings").select("recruitment_emails").eq("id", true).maybeSingle();
      if (!s?.recruitment_emails) reason = "recruitment_emails_off";
      const { data: sup } = await db.from("creator_outreach_suppressions").select("email").eq("email", to.toLowerCase()).maybeSingle();
      if (sup) reason = "suppressed";
    } else if (!transactionalOn()) reason = "affiliate_emails_off";
    // Last line of defence: nothing is emailed from a Demo / Practice session (sample data, never a real person).
    if (await inDemoSession()) reason = "demo_mode_no_send";
    const api = process.env.RESEND_API_KEY;
    if (!api) reason = reason ?? "no_resend_key";
    if (reason) { await record(reason === "suppressed" ? "suppressed" : "logged_off", null, reason); return "skipped"; }
    const body = render(t, vars);
    const r = await f("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${api}`, "content-type": "application/json", "idempotency-key": `aff/${key}` },
      body: JSON.stringify({ from: recruitment ? "James at Built2Bid <partners@built2bid.org>" : "Built2Bid Affiliates <noreply@built2bid.org>", reply_to: "partners@built2bid.org", to: [to], subject: body.subject, text: body.text }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    await record(r.ok ? "sent" : "failed", j.id ?? null, r.ok ? null : `resend ${r.status}: ${j.message ?? ""}`.slice(0, 300));
    return r.ok ? "sent" : "failed";
  } catch (e) {
    logError("affiliate.email", e, { key, template: t });
    await record("failed", null, (e as Error).message?.slice(0, 300) ?? "error").catch(() => false);
    return "failed";
  }
}
