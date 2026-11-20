/**
 * Sales portal sign-in return paths. Pure and dependency free so the proxy can use it.
 */

const isSalesPath = (p: string) => p === "/sales" || p.startsWith("/sales/") || p.startsWith("/sales?");
const isPublicSalesPath = (p: string) => p.startsWith("/sales/login") || p.startsWith("/sales/invite");

/** Where a sign-in from the sales portal may return to: only pages inside /sales. */
export function safeSalesNext(next: string | null | undefined): string {
  if (!next || next.startsWith("//") || next.includes("\\") || !isSalesPath(next) || isPublicSalesPath(next)) return "/sales";
  return next.slice(0, 500);
}

/** For a signed-out visit to a private sales page: the login URL that brings them back, else null. */
export function salesLoginRedirect(pathname: string, search: string): string | null {
  if (!isSalesPath(pathname) || isPublicSalesPath(pathname)) return null;
  const back = safeSalesNext(pathname + search);
  return back === "/sales" ? "/sales/login" : `/sales/login?next=${encodeURIComponent(back)}`;
}

/**
 * Carries a sales invite token through sign-up, email verification and redirects (V8.9). Only a carrier:
 * the invite is checked against its server-side record (sales_invite_accept) when it is used, and the
 * cookie is cleared as soon as it has been. httpOnly, so page scripts never see it.
 */
export const SALES_JOIN_COOKIE = "b2b_sales_join";
export const SALES_JOIN_MAX_AGE = 60 * 60 * 24 * 14;

/** The invite token in /sales/invite/<token>, if it is well formed. */
export function inviteTokenFromPath(pathname: string): string | null {
  const m = /^\/sales\/invite\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return m ? m[1] : null;
}
