/**
 * Email-only sign-in: exactly N-digit codes (6 by default), leading zeros kept, pasted spacing
 * tolerated, longer codes reported instead of trimmed, and SMS switches off by default.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_OTP_LENGTH, codeProblem, emailOtpLength, isSmsAuthAllowedOnServer, isSmsAuthEnabled, readCode } from "@/lib/auth/config";

describe("email OTP length", () => {
  it("defaults to 6", () => {
    expect(DEFAULT_EMAIL_OTP_LENGTH).toBe(6);
    expect(emailOtpLength({})).toBe(6);
    expect(emailOtpLength({ NEXT_PUBLIC_EMAIL_OTP_LENGTH: "" })).toBe(6);
  });
  it("accepts only Supabase's 6–10 range as an override", () => {
    expect(emailOtpLength({ NEXT_PUBLIC_EMAIL_OTP_LENGTH: "8" })).toBe(8);
    for (const bad of ["5", "11", "abc", "-6", "0"]) expect(emailOtpLength({ NEXT_PUBLIC_EMAIL_OTP_LENGTH: bad })).toBe(6);
  });
});

describe("readCode", () => {
  it("accepts exactly six digits and keeps leading zeros", () => {
    expect(readCode("123456", 6)).toEqual({ ok: true, code: "123456" });
    expect(readCode("012345", 6)).toEqual({ ok: true, code: "012345" });
    expect(readCode("000000", 6)).toEqual({ ok: true, code: "000000" });
  });
  it("accepts a pasted code with spaces, dashes or a newline", () => {
    expect(readCode(" 012 345\n", 6)).toEqual({ ok: true, code: "012345" });
    expect(readCode("012-345", 6)).toEqual({ ok: true, code: "012345" });
  });
  it("never trims a longer code to six digits", () => {
    expect(readCode("12345678", 6)).toEqual({ ok: false, reason: "too_long" });
    expect(readCode("123456789", 6)).toEqual({ ok: false, reason: "too_long" });
    expect(codeProblem("too_long", 6)).toMatch(/more than 6 digits/);
  });
  it("rejects short or empty codes", () => {
    expect(readCode("12345", 6)).toEqual({ ok: false, reason: "too_short" });
    expect(readCode("", 6)).toEqual({ ok: false, reason: "empty" });
    expect(readCode("abcdef", 6)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("SMS auth switches", () => {
  it("are off by default", () => {
    expect(isSmsAuthEnabled({})).toBe(false);
    expect(isSmsAuthAllowedOnServer({})).toBe(false);
  });
  it("need the server-only switch as well for server routes", () => {
    expect(isSmsAuthAllowedOnServer({ NEXT_PUBLIC_SMS_AUTH_ENABLED: "true" })).toBe(false);
    expect(isSmsAuthAllowedOnServer({ SMS_AUTH_ENABLED: "true" })).toBe(false);
    expect(isSmsAuthAllowedOnServer({ NEXT_PUBLIC_SMS_AUTH_ENABLED: "true", SMS_AUTH_ENABLED: "true" })).toBe(true);
  });
  it("ignore the retired NEXT_PUBLIC_SMS_SIGNIN flag", () => {
    expect(isSmsAuthEnabled({ NEXT_PUBLIC_SMS_SIGNIN: "on" })).toBe(false);
  });
});

describe("verification email templates", () => {
  for (const f of ["supabase/templates/magic-link.html", "supabase/templates/confirm-signup.html"]) {
    const html = readFileSync(f, "utf8");
    it(`${f} is code-first with no sign-in link, tracking pixel or hardcoded code`, () => {
      expect(html).toContain("{{ .Token }}");
      expect(html).not.toMatch(/ConfirmationURL|TokenHash|<a\s/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/\b\d{6,10}\b/);
      expect(html).toContain("Use this code to securely sign in to Built2Bid:");
      expect(html).toContain("If you didn't request this code, you can safely ignore this email.");
    });
  }
});
