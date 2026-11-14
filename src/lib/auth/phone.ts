/**
 * Phone sign-in helpers (pure: safe in the browser, the server and tests).
 *
 * Supabase phone auth wants E.164 ("+15551234567"). It stores numbers in auth.users.phone without the
 * leading "+", so compare by digits (phoneDigits) rather than by string.
 */

/** SMS sign-in is off until the owner sets NEXT_PUBLIC_SMS_SIGNIN=on (after Twilio + Supabase are configured). */
export const isSmsSignInEnabled = (env: Record<string, string | undefined> = { NEXT_PUBLIC_SMS_SIGNIN: process.env.NEXT_PUBLIC_SMS_SIGNIN }) =>
  ["on", "true", "1"].includes((env.NEXT_PUBLIC_SMS_SIGNIN ?? "").trim().toLowerCase());

export type Country = { iso: string; name: string; dial: string; flag: string };

/**
 * Countries offered in the picker. US first (almost every customer). Keep this list in step with the
 * Twilio Verify geo permissions: a country that's listed here but blocked there just fails to send.
 */
export const COUNTRIES: Country[] = [
  { iso: "US", name: "United States", dial: "1", flag: "🇺🇸" },
  { iso: "CA", name: "Canada", dial: "1", flag: "🇨🇦" },
  { iso: "PR", name: "Puerto Rico", dial: "1", flag: "🇵🇷" },
  { iso: "MX", name: "Mexico", dial: "52", flag: "🇲🇽" },
  { iso: "GB", name: "United Kingdom", dial: "44", flag: "🇬🇧" },
  { iso: "IE", name: "Ireland", dial: "353", flag: "🇮🇪" },
  { iso: "AU", name: "Australia", dial: "61", flag: "🇦🇺" },
  { iso: "NZ", name: "New Zealand", dial: "64", flag: "🇳🇿" },
];
export const DEFAULT_COUNTRY = COUNTRIES[0];
export const countryByIso = (iso: string | null | undefined) => COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;

const NANP = new Set(["1"]);

/**
 * Turn what someone typed into E.164, or null if it can't be a real mobile number.
 *  - "+44 7700 900123" (explicit +) wins over the picker.
 *  - US/Canada: 10 digits, or 11 starting with 1; area code and exchange can't start with 0 or 1.
 *  - Elsewhere: drop one trunk "0", then 6–14 national digits (E.164 allows 15 in total).
 */
export function normalizePhone(input: string, country: Country = DEFAULT_COUNTRY): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (/[a-z]/i.test(raw)) return null; // letters, "ext 12", "x12": not a textable number
  let digits = raw.replace(/\D/g, "");
  let dial = country.dial;
  if (raw.startsWith("+") || raw.startsWith("00")) {
    if (raw.startsWith("00")) digits = digits.slice(2);
    const known = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length).find((d) => digits.startsWith(d));
    if (known) { dial = known; digits = digits.slice(known.length); }
    else return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (NANP.has(dial)) {
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
    return `+1${digits}`;
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 6 || dial.length + digits.length > 15) return null;
  return `+${dial}${digits}`;
}

/** Digits only, no "+": the form Supabase keeps in auth.users.phone. */
export const phoneDigits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const x = phoneDigits(a), y = phoneDigits(b);
  return Boolean(x) && x === y;
};

/** "(555) 123-4567" for US/Canada numbers, "+44 7700900123" otherwise. Accepts E.164 or stored digits. */
export function formatPhone(p: string | null | undefined): string {
  const d = phoneDigits(p);
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  const dial = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length).find((x) => x !== "1" && d.startsWith(x));
  return dial ? `+${dial} ${d.slice(dial.length)}` : `+${d}`;
}

/** As-you-type formatting for the US/Canada field; other countries are left as typed. */
export function formatAsYouType(input: string, country: Country = DEFAULT_COUNTRY): string {
  if (!NANP.has(country.dial) || input.trim().startsWith("+")) return input;
  let d = input.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d.length === 3 && input.length > 3 ? `(${d}) ` : d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "(•••) •••-4567": safe to show on shared screens. */
export const maskPhone = (p: string | null | undefined) => {
  const d = phoneDigits(p);
  return d.length >= 4 ? `•••-${d.slice(-4)}` : "";
};

type AuthErr = { message?: string; code?: string; status?: number } | null | undefined;

/** Supabase refuses to send because the number has no account and we asked it not to create one. */
export function isNoAccountError(e: AuthErr): boolean {
  if (!e) return false;
  const msg = (e.message ?? "").toLowerCase();
  return e.code === "otp_disabled" || e.code === "signup_disabled" || msg.includes("signups not allowed") || msg.includes("user not found");
}

/** Plain-language messages for phone sign-in errors. Never reveals provider details. */
export function smsErrorMessage(e: AuthErr, stage: "send" | "verify" | "link"): string {
  const msg = (e?.message ?? "").toLowerCase();
  const code = e?.code ?? "";
  if (e?.status === 429 || code.startsWith("over_") || msg.includes("rate limit") || msg.includes("too many") || msg.includes("for security purposes"))
    return stage === "verify" ? "Too many tries. Wait a minute, then send a new code." : "Too many code requests. Please wait a minute before asking for another text.";
  if (msg.includes("fetch") || msg.includes("network")) return "We couldn't reach the server. Check your connection and try again.";
  if (code === "captcha_failed" || msg.includes("captcha")) return "Please complete the security check and try again.";
  if (stage === "link" && (code === "phone_exists" || msg.includes("already been registered") || msg.includes("already registered")))
    return "That number is already used by another Built2Bid account. Sign in with that number instead, or contact support.";
  if (code === "phone_provider_disabled" || code === "sms_send_failed" || msg.includes("provider") || msg.includes("sms"))
    return stage === "verify" ? "That code didn't work. Send a new code and try again." : "We couldn't text that number. Check it's a mobile number that can receive texts, or sign in with email instead.";
  if (stage !== "verify") return "We couldn't send a code to that number. Check it and try again.";
  if (code === "otp_expired" || msg.includes("expired")) return "That code has expired or is incorrect. Use the newest text from us, or send a new code.";
  return "That code is incorrect. Check the newest text from us and try again.";
}

/** Seconds a phone must wait before another code (Supabase's default per-number limit). */
export const RESEND_COOLDOWN_S = 60;
const COOLDOWN_KEY = "b2b.smsCooldown";

/** Remembers when each number was last texted in this tab, so reopening the dialog can't skip the cooldown. */
export function cooldownLeft(phone: string, now = Date.now(), storage: Pick<Storage, "getItem"> | null = safeSession()): number {
  try {
    const map = JSON.parse(storage?.getItem(COOLDOWN_KEY) ?? "{}") as Record<string, number>;
    const at = map[phoneDigits(phone)];
    if (!at) return 0;
    return Math.max(0, Math.ceil((at + RESEND_COOLDOWN_S * 1000 - now) / 1000));
  } catch { return 0; }
}

export function markSent(phone: string, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeSession()) {
  try {
    const map = JSON.parse(storage?.getItem(COOLDOWN_KEY) ?? "{}") as Record<string, number>;
    for (const k of Object.keys(map)) if (now - map[k] > RESEND_COOLDOWN_S * 1000) delete map[k];
    map[phoneDigits(phone)] = now;
    storage?.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch { /* storage blocked: Supabase still enforces the limit */ }
}

function safeSession(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
