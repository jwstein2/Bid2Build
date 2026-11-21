/**
 * Baseline Content Security Policy, enforced on every response (next.config.ts).
 *
 * Only directives that cannot break Next.js inline scripts or the third-party scripts the app loads (Stripe, Plaid,
 * Sentry, Google Maps):
 * - frame-ancestors 'none': no other site may frame Built2Bid (clickjacking); matches X-Frame-Options: DENY.
 * - object-src 'none': no Flash/plugin content.
 * - base-uri 'self': an injected <base> tag cannot re-point relative URLs.
 * - upgrade-insecure-requests (deployed copies): any stray http:// sub-resource is fetched over https.
 *
 * Deliberately not here yet: script-src / connect-src / form-action. Those need a per-request nonce and a full list
 * of third-party hosts, and should run as Content-Security-Policy-Report-Only first
 * (docs/security/SECURITY_PROGRAM.md, "CSP roadmap").
 */
export function baselineCsp(context: string): string {
  const parts = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"];
  if (context !== "local") parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
