/**
 * Where a sign-in goes when it didn't ask for a specific page: a route that picks the person's workspace
 * (contractor dashboard or Sales Hub) and finishes a pending sales invite first. See app/auth/landing.
 */
export const DEFAULT_LANDING = "/auth/landing";

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return DEFAULT_LANDING;
  return next;
}

/**
 * Destinations that are route handlers (they redirect again), not pages. The client router can't render
 * them, so a sign-in dialog opens them with a full page load instead.
 */
export function needsFullLoad(next: string): boolean {
  const path = next.split(/[?#]/)[0];
  return path === DEFAULT_LANDING || path === "/sales/join" || path === "/switch";
}

/** After a code is verified in the browser: open `next` the right way. */
export function goAfterSignIn(next: string, router: { replace: (h: string) => void; refresh: () => void }) {
  if (needsFullLoad(next)) { window.location.assign(next); return; }
  router.replace(next); router.refresh();
}
