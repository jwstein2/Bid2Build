/**
 * The founder's one-time welcome email (owner-approved copy, November 14, 2026). Plain text plus a
 * simple HTML version. Kept separate from delivery so the copy can be tested and reviewed on its own.
 */
export const FOUNDER_FROM_NAME = "James Stein — Founder, Built2Bid";
export const FOUNDER_ADDRESS = "james@built2bid.org";
export const FOUNDER_SUBJECT = "A personal thank you from the founder of Built2Bid";

const PARAGRAPHS = [
  "Hey there!",
  "I'm James Stein, owner and founder of Built2Bid, and I just wanted to personally thank you for giving us a shot.",
  "I've spent over 12 years in sales and more than five in construction, helping a small three-person company generate around $2 million in annual sales scaling the company 4x in just a few years.",
  "After preparing thousands of estimates, I've learned that a professional, detailed bid can make a real difference in winning a job. That's why I built Built2Bid: to help contractors spend less time estimating, look more professional, and win more work without expensive, complicated software.",
  "We're a small, growing company building something for an industry I genuinely love, and your support means a lot.",
  "If you ever have feedback, ideas, or run into an issue, please reply directly. I'd love to hear from you.",
  "Thanks again, and happy bidding!",
];
const SIGNATURE = ["James Stein", "Owner & Founder | Built2Bid", FOUNDER_ADDRESS, "https://built2bid.org"];

export function founderWelcomeText(): string {
  return [...PARAGRAPHS, SIGNATURE.join("\n")].join("\n\n") + "\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function founderWelcomeHtml(): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${esc(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a2433;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55">
<div style="max-width:560px">
${PARAGRAPHS.map(p).join("\n")}
<p style="margin:0">${esc(SIGNATURE[0])}<br>${esc(SIGNATURE[1])}<br><a href="mailto:${FOUNDER_ADDRESS}" style="color:#0b6e99">${FOUNDER_ADDRESS}</a><br><a href="https://built2bid.org" style="color:#0b6e99">https://built2bid.org</a></p>
</div></body></html>`;
}

/**
 * Only the first paid subscription invoice qualifies: Stripe marks it billing_reason
 * "subscription_create". Renewals ("subscription_cycle"), plan/seat changes ("subscription_update"),
 * $0 invoices (100% coupons, trials) and unpaid invoices never do.
 */
export function isFirstPaidSubscriptionInvoice(inv: { billing_reason?: string | null; amount_paid?: number | null; status?: string | null }): boolean {
  return inv.billing_reason === "subscription_create" && (inv.amount_paid ?? 0) > 0 && (inv.status == null || inv.status === "paid");
}
