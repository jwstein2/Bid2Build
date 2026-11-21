import "server-only";
import { inDemoSession } from "@/lib/demo/guard";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { money } from "./labels";

/**
 * Staff payout emails (transactional, from noreply@built2bid.org). Sent only when RESEND_API_KEY is set.
 * Bank-change notices are always sent (security). Payment notices are sent for live payouts only, so practice
 * (test-mode) runs never email anyone about money that didn't move. Owner alerts go to OWNER_ALERT_EMAIL when set;
 * every alert is also on the Payments & Payouts page.
 */
async function send(to: string, subject: string, text: string, key: string, f: typeof fetch): Promise<boolean> {
  const api = process.env.RESEND_API_KEY;
  if (!api || !to) return false;
  if (await inDemoSession()) return false; // never from a Demo / Practice session (the proxy blocks these routes too)
  try {
    const r = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${api}`, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ from: "Built2Bid <noreply@built2bid.org>", to: [to], subject, text }),
    });
    if (!r.ok) logError("payouts.email", new Error(`resend ${r.status}`));
    return r.ok;
  } catch (e) {
    logError("payouts.email", e);
    return false;
  }
}

export function bankChangeText(name: string, last4: string | null, institution: string | null, holdUntil: string | null) {
  const until = holdUntil ? new Date(holdUntil).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " Central" : null;
  return {
    subject: "Your Built2Bid payout bank account was changed",
    text: [`Hi ${name.split(" ")[0]},`, "",
      `The bank account for your Built2Bid payouts was just set to ${institution ?? "a new account"}${last4 ? ` ending in ${last4}` : ""}.`,
      until ? `For your protection, payouts start going to it after ${until}.` : "",
      "", "If you didn't make this change, reply to this email or contact support@built2bid.org right away so we can pause your payouts.",
      "", `Payout settings: ${site.url}/staff/payouts`, "", "Built2Bid"].filter((l) => l !== null).join("\n"),
  };
}

export async function emailBankChanged(to: string, name: string, last4: string | null, institution: string | null, holdUntil: string | null, id: string, f: typeof fetch = fetch) {
  const { subject, text } = bankChangeText(name, last4, institution, holdUntil);
  await send(to, subject, text, `staff-bank-change/${id}`, f);
  const owner = process.env.OWNER_ALERT_EMAIL;
  if (owner) await send(owner, `Payout bank changed: ${name}`, `${name} changed their payout bank to ${institution ?? "a new account"} ••${last4 ?? "????"}. Payouts to it are held until ${holdUntil ?? "verified"}.\n\n${site.url}/admin/staff`, `owner-bank-change/${id}`, f);
}

export async function emailPayoutResult(to: string, name: string, kind: "paid" | "failed" | "returned", p: { ref: string; net_cents: number; gross_cents: number; fee_cents: number; fee_bearer: string }, f: typeof fetch = fetch) {
  const lines = kind === "paid"
    ? [`Your Built2Bid payout ${p.ref} was deposited.`, "", `Gross: ${money(p.gross_cents)}`, ...(p.fee_bearer === "recipient" ? [`Processing fee: -${money(p.fee_cents)}`] : []), `Net deposit: ${money(p.net_cents)}`]
    : [`Your Built2Bid payout ${p.ref} (${money(p.net_cents)}) ${kind === "returned" ? "was returned by your bank" : "didn't go through"}.`, "",
      "The money is still owed to you. Please check your bank account in Payout Settings; we'll send it again once it's fixed."];
  await send(to, kind === "paid" ? `Payout deposited: ${money(p.net_cents)}` : "Action needed: your payout didn't arrive",
    [`Hi ${name.split(" ")[0]},`, "", ...lines, "", `Details: ${site.url}/staff/payouts`, "", "Built2Bid"].join("\n"), `staff-payout/${p.ref}/${kind}`, f);
}

export async function emailOwnerAlert(subject: string, body: string, key: string, f: typeof fetch = fetch) {
  const owner = process.env.OWNER_ALERT_EMAIL;
  if (owner) await send(owner, subject, `${body}\n\n${site.url}/admin/payouts`, key, f);
}
