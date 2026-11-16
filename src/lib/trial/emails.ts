/**
 * Copy for the trial emails (pure; reviewed and tested on its own). Sent through Resend by
 * src/lib/trial/delivery.ts.
 */
import { TRIAL_DAYS, TRIAL_PLAN_NAME } from "./config";
import { formatExpiry } from "./text";

export interface Rendered { subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(paragraphs: string[], cta: { href: string; label: string } | null, footer: string[]): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${esc(t)}</p>`;
  const button = cta ? `<p style="margin:24px 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#f26b1d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${esc(cta.label)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a2433;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55">
<div style="max-width:560px">
<p style="margin:0 0 20px;font-weight:800;font-size:20px;color:#14284b">Built2Bid</p>
${paragraphs.map(p).join("\n")}
${button}
<p style="margin:24px 0 0;font-size:13px;color:#5b6675">${footer.map(esc).join("<br>")}</p>
</div></body></html>`;
}

export function inviteEmail(o: { activateUrl: string; inviteExpiresAt: string }): Rendered {
  const until = new Date(o.inviteExpiresAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "America/Chicago" });
  const paras = [
    "Here's the Built2Bid invite you asked for on Facebook.",
    `Tap the button, sign in with this email address, and tap "Activate". Your ${TRIAL_DAYS} free days of ${TRIAL_PLAN_NAME} start the moment you activate: unlimited bids, Saved Items & Pricing, and Proposal Templates.`,
    "No card is needed and nothing is charged automatically. When the week ends your account simply goes back to its normal plan, and your bids and customers stay right where they are.",
    `This link works until ${until}.`,
  ];
  const footer = ["You're getting this because someone asked for a Built2Bid invite for this address in Facebook Messenger or on built2bid.org. If that wasn't you, ignore this email and nothing will happen.", "Built2Bid · built2bid.org"];
  return {
    subject: `Your ${TRIAL_DAYS} free days of Built2Bid Unlimited`,
    text: [...paras, `Activate: ${o.activateUrl}`, ...footer].join("\n\n") + "\n",
    html: layout(paras, { href: o.activateUrl, label: `Activate my ${TRIAL_DAYS} days` }, footer),
  };
}

export function day2Email(o: { appUrl: string; unsubscribeUrl: string }): Rendered {
  const paras = [
    "Quick walkthrough for your first Built2Bid bid (about 5 minutes):",
    "1. Tap Create New Bid and pick your trade.",
    "2. Add the job's measurements. The calculators work out quantities for you.",
    "3. Check your price and margin, then tap Finalize to get a professional PDF you can send.",
    "Reply to this email if you get stuck. A real person reads every reply.",
  ];
  const footer = ["You asked for two short check-ins during your trial. This is the first.", `Stop check-ins: ${o.unsubscribeUrl}`];
  return {
    subject: "Your first Built2Bid bid in 5 minutes",
    text: [...paras, `Start a bid: ${o.appUrl}`, ...footer].join("\n\n") + "\n",
    html: layout(paras, { href: o.appUrl, label: "Start a bid" }, footer),
  };
}

export function day6Email(o: { expiresAt: string; billingUrl: string; unsubscribeUrl: string }): Rendered {
  const when = formatExpiry(o.expiresAt);
  const paras = [
    `Heads up: your free ${TRIAL_PLAN_NAME} week ends ${when}.`,
    "Nothing happens to your bids, customers or saved work when it ends, and you won't be charged. Your account just goes back to its normal plan.",
    "If you'd like to keep unlimited bids, you can upgrade any time. It's completely optional.",
  ];
  const footer = ["You asked for two short check-ins during your trial. This is the last one.", `Stop check-ins: ${o.unsubscribeUrl}`];
  return {
    subject: "Your free Built2Bid week ends soon",
    text: [...paras, `See plans: ${o.billingUrl}`, ...footer].join("\n\n") + "\n",
    html: layout(paras, { href: o.billingUrl, label: "See plans (optional)" }, footer),
  };
}
