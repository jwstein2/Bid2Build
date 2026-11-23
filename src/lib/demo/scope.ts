/**
 * Where Practice Mode (and the owner's Demo Mode) applies. Pure and dependency free so the proxy, the
 * sidebar and tests share one list.
 *
 * James 2026-11-23: Practice Mode covers only the paid app, meaning /dashboard and the pages its menu links to
 * (bids, projects, workforce, customers, saved items, templates, financials, company, settings, plus the
 * bid builder those pages open). Everything else (the Academy, industry news, mentorship, What's New, the
 * public site, Sales / Affiliate hubs, admin, legal) always runs as the person's real account, so Academy
 * progress and rewards record for real and no practice banner or switch shows there.
 */
const SCOPE = [
  "/dashboard", "/home", "/projects", "/company", "/financials", "/settings", "/clock", "/search", "/signed", "/import",
  "/no-access",
  // The bid builder and trade picker that "Create New Bid" opens, and an existing bid's editor.
  "/bids", "/builder", "/start", "/estimates",
];
/** Pages under a scoped prefix that are not part of the paid app. */
const NOT_SCOPE = ["/company/join"];

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

/** True when a page belongs to the paid app, where a practice session stays in practice. */
export function inPracticeScope(pathname: string): boolean {
  if (NOT_SCOPE.some((p) => under(pathname, p))) return false;
  return SCOPE.some((p) => under(pathname, p));
}

/**
 * httpOnly cookie that holds a paused practice session (its refresh token) while the person is on a page
 * outside the paid app. Coming back to a paid-app page picks the practice up where they left it; turning
 * Practice Mode off, starting it again or signing out clears it.
 */
export const PRACTICE_PAUSE_COOKIE = "b2b-practice-paused";

/** Requests that switch between the practice and the real session: a page load, a client navigation or a server action. */
export function isSwitchableRequest(method: string, headers: { get(name: string): string | null }): boolean {
  if (headers.get("next-router-prefetch") || headers.get("next-router-segment-prefetch") || headers.get("purpose") === "prefetch" || headers.get("sec-purpose")?.includes("prefetch")) return false;
  const m = method.toUpperCase();
  if (m === "GET") return headers.get("sec-fetch-dest") === "document" || headers.get("rsc") === "1";
  if (m === "POST") return Boolean(headers.get("next-action"));
  return false;
}
