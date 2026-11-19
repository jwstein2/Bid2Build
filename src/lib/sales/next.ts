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
