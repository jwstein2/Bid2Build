import { describe, expect, it } from "vitest";
import {
  COUNTRIES, RESEND_COOLDOWN_S, cooldownLeft, countryByIso, formatAsYouType, formatPhone, isNoAccountError,
  isSmsSignInEnabled, markSent, maskPhone, normalizePhone, phoneDigits, samePhone, smsErrorMessage,
} from "@/lib/auth/phone";
import { parseIntent } from "@/lib/billing/checkout-intent";
import { sessionUserFrom } from "@/lib/supabase/server";

const US = countryByIso("US");
const GB = countryByIso("GB");
const MX = countryByIso("MX");

describe("normalizePhone", () => {
  it("accepts the ways contractors type US numbers", () => {
    for (const s of ["(555) 234-5678", "555-234-5678", "555.234.5678", "5552345678", "1 555 234 5678", "+1 (555) 234-5678", "  555 234 5678 "])
      expect(normalizePhone(s, US)).toBe("+15552345678");
  });
  it("rejects numbers that can't be US mobiles", () => {
    for (const s of ["", "555-1234", "055-234-5678", "155-234-5678", "555-034-5678", "55523456789", "555-234-5678 ext 12", "call me"])
      expect(normalizePhone(s, US)).toBeNull();
  });
  it("handles other countries, trunk zeros, and an explicit + overriding the picker", () => {
    expect(normalizePhone("07700 900123", GB)).toBe("+447700900123");
    expect(normalizePhone("+44 7700 900123", US)).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123", US)).toBe("+447700900123");
    expect(normalizePhone("55 1234 5678", MX)).toBe("+525512345678");
    expect(normalizePhone("123", GB)).toBeNull();
  });
  it("lists the US first and has unique ISO codes", () => {
    expect(COUNTRIES[0].iso).toBe("US");
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
  });
});

describe("display helpers", () => {
  it("formats stored digits and E.164 the same way", () => {
    expect(formatPhone("15552345678")).toBe("(555) 234-5678");
    expect(formatPhone("+15552345678")).toBe("(555) 234-5678");
    expect(formatPhone("447700900123")).toBe("+44 7700900123");
    expect(formatPhone(null)).toBe("");
    expect(maskPhone("+15552345678")).toBe("•••-5678");
  });
  it("formats US numbers as you type and leaves others alone", () => {
    expect(formatAsYouType("555", US)).toBe("555");
    expect(formatAsYouType("5552", US)).toBe("(555) 2");
    expect(formatAsYouType("5552345678", US)).toBe("(555) 234-5678");
    expect(formatAsYouType("555234567899", US)).toBe("(555) 234-5678");
    expect(formatAsYouType("07700 900", GB)).toBe("07700 900");
    expect(formatAsYouType("+44 7700", US)).toBe("+44 7700");
  });
  it("compares numbers by digits, as Supabase stores them", () => {
    expect(phoneDigits("+1 (555) 234-5678")).toBe("15552345678");
    expect(samePhone("+15552345678", "15552345678")).toBe(true);
    expect(samePhone("+15552345678", "+15552345679")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });
});

describe("feature flag", () => {
  it("is off unless explicitly turned on", () => {
    expect(isSmsSignInEnabled({})).toBe(false);
    expect(isSmsSignInEnabled({ NEXT_PUBLIC_SMS_SIGNIN: "off" })).toBe(false);
    expect(isSmsSignInEnabled({ NEXT_PUBLIC_SMS_SIGNIN: "on" })).toBe(true);
    expect(isSmsSignInEnabled({ NEXT_PUBLIC_SMS_SIGNIN: " TRUE " })).toBe(true);
  });
});

describe("errors", () => {
  it("recognises 'no account for this number' so we can ask about an existing email account", () => {
    expect(isNoAccountError({ code: "otp_disabled", message: "Signups not allowed for otp" })).toBe(true);
    expect(isNoAccountError({ message: "Signups not allowed for otp" })).toBe(true);
    expect(isNoAccountError({ code: "over_sms_send_rate_limit" })).toBe(false);
    expect(isNoAccountError(null)).toBe(false);
  });
  it("gives plain messages for rate limits, expiry, wrong codes and taken numbers", () => {
    expect(smsErrorMessage({ status: 429 }, "send")).toMatch(/wait a minute/);
    expect(smsErrorMessage({ code: "over_sms_send_rate_limit" }, "send")).toMatch(/wait a minute/);
    expect(smsErrorMessage({ code: "otp_expired", message: "Token has expired or is invalid" }, "verify")).toMatch(/expired/);
    expect(smsErrorMessage({ message: "Invalid token" }, "verify")).toMatch(/incorrect/);
    expect(smsErrorMessage({ code: "phone_exists" }, "link")).toMatch(/another Built2Bid account/);
    expect(smsErrorMessage({ code: "captcha_failed" }, "send")).toMatch(/security check/);
    expect(smsErrorMessage({ code: "sms_send_failed", message: "Error sending sms: twilio 21211" }, "send")).not.toMatch(/twilio/i);
  });
});

describe("resend cooldown", () => {
  function mem() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; }
  it("blocks another text to the same number for 60s, across dialog reopenings", () => {
    const s = mem();
    const t = 1_000_000;
    expect(cooldownLeft("+15552345678", t, s)).toBe(0);
    markSent("+15552345678", t, s);
    expect(cooldownLeft("15552345678", t + 1000, s)).toBe(RESEND_COOLDOWN_S - 1);
    expect(cooldownLeft("+15552345679", t + 1000, s)).toBe(0);
    expect(cooldownLeft("+15552345678", t + RESEND_COOLDOWN_S * 1000, s)).toBe(0);
  });
  it("never throws when storage is unavailable", () => {
    expect(cooldownLeft("+15552345678", Date.now(), null)).toBe(0);
    expect(() => markSent("+15552345678", Date.now(), null)).not.toThrow();
  });
});

describe("checkout intent keeps the phone being verified", () => {
  const base = { v: 1, id: "x", plan: "monthly", createdAt: 1000, status: "pending" };
  it("round-trips a valid E.164 phone and drops junk", () => {
    expect(parseIntent(JSON.stringify({ ...base, phone: "+15552345678" }), 2000).intent?.phone).toBe("+15552345678");
    expect(parseIntent(JSON.stringify({ ...base, phone: "javascript:alert(1)" }), 2000).intent?.phone).toBeUndefined();
    expect(parseIntent(JSON.stringify({ ...base, plan: "annual", phone: "+447700900123" }), 2000).intent).toMatchObject({ plan: "annual", phone: "+447700900123" });
  });
});

describe("session user", () => {
  it("counts a confirmed phone as verified and normalises it to E.164", () => {
    expect(sessionUserFrom({ id: "u", phone: "15552345678", phone_confirmed_at: "2026-11-14T00:00:00Z", email: "" }))
      .toEqual({ id: "u", email: null, emailVerified: false, phone: "+15552345678", phoneVerified: true, verified: true });
  });
  it("keeps email accounts exactly as before", () => {
    expect(sessionUserFrom({ id: "u", email: "a@b.co", email_confirmed_at: "2026-11-14T00:00:00Z", phone: "" }))
      .toEqual({ id: "u", email: "a@b.co", emailVerified: true, phone: null, phoneVerified: false, verified: true });
    expect(sessionUserFrom({ id: "u", email: "a@b.co", email_confirmed_at: null }).verified).toBe(false);
  });
  it("an unconfirmed phone does not verify the account", () => {
    expect(sessionUserFrom({ id: "u", phone: "15552345678", phone_confirmed_at: null }).verified).toBe(false);
  });
});
