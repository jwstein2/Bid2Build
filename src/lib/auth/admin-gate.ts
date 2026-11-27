/**
 * Owner admin area sign-in rules. Pure and dependency free so the proxy, the admin layout and tests share them.
 *
 * - A signed-out visit to /admin (any page) goes to /admin-login, which signs in with the owner's regular
 *   Built2Bid account (same email code as the app) and comes back to the page afterwards.
 * - Admin pages and actions require a session that passed the authenticator step (aal2). This is ON unless the
 *   owner sets ADMIN_REQUIRE_TWO_STEP=false in Netlify, which is the emergency switch if the authenticator is lost.
 * - An admin with no authenticator yet is sent to Account settings to set one up (never locked out); an admin who
 *   has one but only passed the email code is sent to /auth/mfa for the 6-digit code.
 */

export const ADMIN_LOGIN = "/admin-login";
export const ADMIN_HOME = "/admin";
export const ADMIN_TWO_STEP_SETUP = "/settings/account?reason=admin_two_step#two-step";

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

export function isAdminPath(pathname: string): boolean {
  return under(pathname, ADMIN_HOME);
}

/** Same-site admin path only; anything else falls back to /admin. */
export function safeAdminNext(next: string | null | undefined): string {
  if (!next || !isAdminPath(next.split(/[?#]/)[0]) || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return ADMIN_HOME;
  return next.slice(0, 500);
}

/** For a signed-out visit to an admin page: the admin sign-in URL that brings them back, else null. */
export function adminLoginRedirect(pathname: string, search: string): string | null {
  if (!isAdminPath(pathname)) return null;
  const back = safeAdminNext(`${pathname}${search}`);
  return back === ADMIN_HOME ? ADMIN_LOGIN : `${ADMIN_LOGIN}?next=${encodeURIComponent(back)}`;
}

/** On unless ADMIN_REQUIRE_TWO_STEP is exactly "false" (owner's emergency switch). */
export function adminTwoStepRequired(env: Record<string, string | undefined>): boolean {
  return (env.ADMIN_REQUIRE_TWO_STEP ?? "").trim().toLowerCase() !== "false";
}

type Level = { currentLevel: string | null; nextLevel: string | null } | null | undefined;

/** Where an admin session must go before the admin area opens, or null when it may continue. */
export function adminStepUpTarget(level: Level, next: string = ADMIN_HOME): string | null {
  if (level?.currentLevel === "aal2") return null;
  if (level?.nextLevel === "aal2") return `/auth/mfa?next=${encodeURIComponent(safeAdminNext(next))}`;
  return ADMIN_TWO_STEP_SETUP;
}
