/**
 * Google Analytics 4 settings.
 *
 * GA loads only when all of these hold:
 *  - NEXT_PUBLIC_GA_MEASUREMENT_ID is set (a public "G-XXXXXXXXXX" id, not a secret),
 *  - the deploy is production and indexable (previews and local builds never send data),
 *  - the page is not one that carries a secret token or a customer's details in its URL.
 */
const ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export function gaMeasurementId(raw: string | undefined | null): string | null {
  const id = (raw ?? "").trim().toUpperCase();
  return ID_PATTERN.test(id) ? id : null;
}

/** Paths whose URLs carry signing tokens, auth codes or claim tokens: never sent to analytics. */
const EXCLUDED_PREFIXES = ["/sign/", "/api/", "/auth/", "/complimentary", "/admin", "/trial/activate", "/trial/unsubscribe"];

export function analyticsAllowedOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return !EXCLUDED_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}
