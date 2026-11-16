/**
 * Central sign-in configuration (pure: safe in the browser, the server and tests).
 *
 * Built2Bid signs people in with a 6-digit code sent by email. SMS (Twilio via Supabase phone auth)
 * stays in the codebase for later but is OFF unless explicitly turned on:
 *
 *  - NEXT_PUBLIC_SMS_AUTH_ENABLED=true  shows the phone UI in the browser. It is a display switch only.
 *  - SMS_AUTH_ENABLED=true (server only) is also required before any server route does phone work.
 *  - The real control is the Supabase phone provider: while it is disabled, Supabase refuses every
 *    phone sign-up, sign-in and phone-change request, whatever a browser sends it.
 *
 * The retired NEXT_PUBLIC_SMS_SIGNIN flag is deliberately ignored, so a stale "on" left in Netlify can't
 * bring the phone UI back. See docs/auth/EMAIL_SIGN_IN.md.
 */

const truthy = (v: string | undefined) => ["on", "true", "1", "yes"].includes((v ?? "").trim().toLowerCase());

/** Browser-visible switch for the phone sign-in UI. Default off. */
export const isSmsAuthEnabled = (env: Record<string, string | undefined> = { NEXT_PUBLIC_SMS_AUTH_ENABLED: process.env.NEXT_PUBLIC_SMS_AUTH_ENABLED }) =>
  truthy(env.NEXT_PUBLIC_SMS_AUTH_ENABLED);

/** Server routes that touch phone auth need both the public switch and the server-only one. */
export const isSmsAuthAllowedOnServer = (env: Record<string, string | undefined> = {
  NEXT_PUBLIC_SMS_AUTH_ENABLED: process.env.NEXT_PUBLIC_SMS_AUTH_ENABLED,
  SMS_AUTH_ENABLED: process.env.SMS_AUTH_ENABLED,
}) => isSmsAuthEnabled(env) && truthy(env.SMS_AUTH_ENABLED);

/**
 * Digits in an emailed sign-in code. Must equal Supabase "Email OTP Length" (Authentication > Sign In /
 * Providers > Email). NEXT_PUBLIC_EMAIL_OTP_LENGTH exists only as an emergency override (6–10) so the
 * site and Supabase can be brought back into step without a code change; leave it unset.
 */
export const DEFAULT_EMAIL_OTP_LENGTH = 6;
export const emailOtpLength = (env: Record<string, string | undefined> = { NEXT_PUBLIC_EMAIL_OTP_LENGTH: process.env.NEXT_PUBLIC_EMAIL_OTP_LENGTH }) => {
  const n = Number.parseInt((env.NEXT_PUBLIC_EMAIL_OTP_LENGTH ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 6 && n <= 10 ? n : DEFAULT_EMAIL_OTP_LENGTH;
};

/** Texted codes (Twilio Verify) are 6 digits. */
export const SMS_OTP_LENGTH = 6;

export type CodeCheck = { ok: true; code: string } | { ok: false; reason: "empty" | "too_short" | "too_long" };

/**
 * Reads a typed or pasted code. Keeps it as a string so leading zeros survive ("012345"), drops
 * spaces/dashes people paste ("012 345", "012-345"), and never cuts a longer code down to size: a code
 * with too many digits is reported, because trimming it would silently send a wrong code.
 */
export function readCode(raw: string, length: number): CodeCheck {
  const code = (raw ?? "").replace(/\D/g, "");
  if (!code) return { ok: false, reason: "empty" };
  if (code.length > length) return { ok: false, reason: "too_long" };
  if (code.length < length) return { ok: false, reason: "too_short" };
  return { ok: true, code };
}

export const codeProblem = (reason: "empty" | "too_short" | "too_long", length: number) =>
  reason === "too_long"
    ? `That code has more than ${length} digits. Copy the ${length}-digit code from the newest email, or send a new code.`
    : `Enter all ${length} digits of the code.`;
