/**
 * Two-step sign-in (TOTP authenticator app) on top of the email one-time code.
 *
 * Supabase marks a session `aal1` after the email code and `aal2` after the authenticator code. A person who
 * has turned on two-step sign-in and has only passed the email code (aal1 with a verified factor) is sent to
 * /auth/mfa before any app page, and gets 401 two_step_required from any API route. Connecting a real bank
 * always requires aal2, so a bank connection can only be made by someone who has two-step sign-in turned on.
 */

export const TWO_STEP_REQUIRED = "two_step_required";
export const TWO_STEP_SETTINGS = "/settings/account#two-step";
export const TWO_STEP_BANK_MESSAGE =
  "For your security, turn on two-step sign-in (Account settings → Two-step sign-in) before connecting a bank.";

/** Paths a half-signed-in person (email code passed, authenticator code not yet) may still open. */
const OPEN_PREFIXES = ["/auth/", "/login", "/signup", "/api/auth/", "/sign/", "/api/sign", "/exempt/", "/api/exempt", "/sub-docs/", "/api/sub-docs/", "/api/health", "/privacy", "/terms", "/security"];

export function stepUpExempt(pathname: string): boolean {
  return OPEN_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/** True when this session must pass the authenticator step before using the app. */
export function needsStepUp(level: { currentLevel: string | null; nextLevel: string | null } | null | undefined): boolean {
  return Boolean(level && level.currentLevel === "aal1" && level.nextLevel === "aal2");
}
