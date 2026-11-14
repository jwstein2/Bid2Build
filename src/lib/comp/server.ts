import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { createAdminClient } from "../supabase/server";
import { site } from "../site";

type Admin = ReturnType<typeof createAdminClient>;

/** 32 random bytes, URL-safe. Only its SHA-256 hash is stored. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Page that accepts an invitation (requires sign-in with the invited email). */
export function claimPath(token: string): string {
  return `/complimentary?token=${encodeURIComponent(token)}`;
}

export function inviteUrl(token: string, origin = site.url): string {
  return new URL(claimPath(token), origin).toString();
}

/**
 * Send the invitation through Supabase Auth's own invite email (the project's configured SMTP), so no
 * new mail provider or secret is needed. The email signs the recipient up and lands them on the claim
 * page; the grant also activates automatically when that email is verified by any sign-in method.
 * Supabase refuses to "invite" an address that already has an account: report that, the grant still
 * activates when they verify that email.
 */
export async function sendCompInvitation(db: Admin, email: string, token: string, origin = site.url): Promise<{ sent: true } | { sent: false; reason: string }> {
  const redirect = new URL("/auth/callback", origin);
  redirect.searchParams.set("next", claimPath(token));
  try {
    const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: redirect.toString(), data: { invited_for: "complimentary_access" } });
    if (!error) return { sent: true };
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already") && msg.includes("registered")) return { sent: false, reason: "account_exists" };
    if (msg.includes("rate")) return { sent: false, reason: "email_rate_limited" };
    return { sent: false, reason: "send_failed" };
  } catch {
    return { sent: false, reason: "send_failed" };
  }
}

export const INVITE_FAILURE_TEXT: Record<string, string> = {
  account_exists: "This email already has an unverified account, so no invitation email was sent. Access starts as soon as they verify the email. You can copy the invitation link and send it yourself.",
  email_rate_limited: "The email provider's hourly limit was reached, so no invitation was sent. Use Resend later or copy the link.",
  send_failed: "The invitation email could not be sent. Use Resend, or copy the link and send it yourself.",
};
