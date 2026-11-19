/**
 * Signed-in app return paths. Pure and dependency free so the proxy can use it.
 *
 * A signed-out visit to a private app page (a link in an email, a bookmark, a shared job URL) goes to
 * /login with the page as `next`, so sign-in lands where the person was going instead of /dashboard.
 * Pages still authorize on their own; this only keeps the destination.
 */

const APP_PREFIXES = ["/company", "/dashboard", "/financials", "/home", "/industry", "/learning", "/mentorship", "/projects", "/search", "/settings", "/signed", "/whats-new"];
/** Public pages that live under an app prefix. */
const PUBLIC_UNDER_APP = ["/company/join"];

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

export function isPrivateAppPath(pathname: string): boolean {
  if (PUBLIC_UNDER_APP.some((p) => under(pathname, p))) return false;
  return APP_PREFIXES.some((p) => under(pathname, p));
}

/** For a signed-out visit to a private app page: the login URL that brings them back, else null. */
export function appLoginRedirect(pathname: string, search: string): string | null {
  if (!isPrivateAppPath(pathname)) return null;
  const back = `${pathname}${search}`.slice(0, 500);
  if (back.startsWith("//") || back.includes("\\") || /[\r\n]/.test(back)) return "/login";
  return `/login?next=${encodeURIComponent(back)}`;
}
