"use client";
import { Loader2, Mail, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getBrowserClient, getOtpClient } from "@/lib/supabase/client";
import { plans } from "@/lib/site";
import {
  COUNTRIES, DEFAULT_COUNTRY, RESEND_COOLDOWN_S, cooldownLeft, countryByIso, formatAsYouType, formatPhone,
  isNoAccountError, isSmsSignInEnabled, markSent, normalizePhone, smsErrorMessage, type Country,
} from "@/lib/auth/phone";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { Modal } from "../builder/dialogs";
import { Captcha, captchaEnabled } from "./captcha";

export type AuthDialogCopy = {
  title: string;
  emailDescription: string;
  sentDescription: (email: string) => string;
  /** Shown on the phone step when SMS sign-in is on. Falls back to emailDescription. */
  phoneDescription?: string;
  phoneSentDescription?: (phone: string) => string;
  submitLabel?: string;
};

/** Maps Supabase email auth errors to plain guidance. */
function emailError(e: { message?: string; code?: string; status?: number }, stage: "send" | "verify"): string {
  const msg = (e.message ?? "").toLowerCase();
  if (e.status === 429 || msg.includes("rate") || e.code === "over_email_send_rate_limit") return "Too many attempts. Please wait a minute and try again.";
  if (msg.includes("fetch") || msg.includes("network")) return "We couldn't reach the server. Check your connection and try again.";
  if (e.code === "captcha_failed" || msg.includes("captcha")) return "Please complete the security check and try again.";
  if (stage === "send") return "We couldn't send the email. Check the address and try again.";
  if (e.code === "otp_expired" || msg.includes("expired")) return "That code is incorrect or has expired. Check the newest email from us, or send a new code.";
  return "That code didn't work. Check the newest email from us, or send a new code.";
}

type Stage =
  | "phone" // enter mobile number
  | "phone-code" // enter the texted code
  | "phone-new" // number has no account yet: new, or an existing email account?
  | "email" // enter email
  | "email-code" // enter emailed code (or tap the link)
  | "link-code"; // signed in by email; confirm the phone to attach it to that same account

const Err = ({ id, children }: { id?: string; children: ReactNode }) => <div id={id}><Notice tone="danger">{children}</Notice></div>;

/** Fills the code from the SMS on Android Chrome (WebOTP) when the text carries the `@built2bid.org #code` line. */
function useWebOtp(active: boolean, onCode: (code: string) => void) {
  const cb = useRef(onCode);
  useEffect(() => { cb.current = onCode; }, [onCode]);
  useEffect(() => {
    if (!active || typeof window === "undefined" || !("OTPCredential" in window)) return;
    const ac = new AbortController();
    (navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal } as CredentialRequestOptions) as Promise<(Credential & { code?: string }) | null>)
      .then((c) => { if (c?.code) cb.current(c.code.replace(/\D/g, "").slice(0, 8)); })
      .catch(() => {});
    return () => ac.abort();
  }, [active]);
}

/**
 * Sign in or sign up with a one-time code.
 *  - SMS on (NEXT_PUBLIC_SMS_SIGNIN=on): mobile number → texted code, with email as the fallback.
 *    A number with no account asks whether the person already has an email account; if so they sign
 *    in by email first and then confirm the phone, which attaches it to that same account (no duplicate).
 *  - SMS off: the existing email code / link flow, unchanged.
 * The code is entered in this browser, so a code read on a phone works on a desktop.
 */
export function AuthDialog({ open, onOpenChange, next, onVerified, title, copy, summary, footer, initialEmail, initialPhone, onEmailSent, onPhoneSent }: {
  open: boolean; onOpenChange: (o: boolean) => void; next: string; onVerified?: () => void | Promise<void>; title?: string;
  /** Overrides the default "download your bid" wording (used by checkout). */
  copy?: AuthDialogCopy;
  /** Shown above the form in every step, e.g. the plan being purchased. */
  summary?: ReactNode;
  footer?: ReactNode;
  /** Reopen at the code step for this email (after a refresh mid-verification). */
  initialEmail?: string;
  /** Reopen at the code step for this phone (E.164). */
  initialPhone?: string;
  onEmailSent?: (email: string) => void;
  onPhoneSent?: (phone: string) => void;
}) {
  const sms = isSmsSignInEnabled();
  const supabase = getBrowserClient();
  const [stage, setStage] = useState<Stage>(() => {
    if (sms && initialPhone && normalizePhone(initialPhone)) return "phone-code";
    if (initialEmail) return "email-code";
    return sms ? "phone" : "email";
  });
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phoneInput, setPhoneInput] = useState(initialPhone ? formatPhone(initialPhone) : "");
  const [phone, setPhone] = useState<string | null>(initialPhone ? normalizePhone(initialPhone) : null);
  const [linkPhone, setLinkPhone] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [marketing, setMarketing] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() => (initialPhone ? cooldownLeft(initialPhone) : 0));
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const needCaptcha = captchaEnabled();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const go = (s: Stage) => { setStage(s); setCode(""); setErr(null); setInfo(null); };
  const usedCaptcha = () => { setCaptchaToken(null); setCaptchaReset((n) => n + 1); };
  const captchaMissing = needCaptcha && !captchaToken;

  const finish = useCallback(async () => {
    if (marketing) await fetch("/api/account/marketing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optIn: true }) }).catch(() => {});
    try { await onVerified?.(); } finally { setBusy(false); }
  }, [marketing, onVerified]);

  // ---- Phone ------------------------------------------------------------------------------
  async function sendPhone({ create, resend }: { create: boolean; resend?: boolean }) {
    if (!supabase) { setErr("Accounts aren't configured on this server yet."); return; }
    const e164 = resend || create ? phone : normalizePhone(phoneInput, country);
    if (!e164) { setErr(country.dial === "1" ? "Enter a 10-digit mobile number, like (555) 123-4567." : "Enter a valid mobile number, including the area code."); return; }
    const wait = cooldownLeft(e164);
    if (wait > 0 && !create) {
      // Already texted this number moments ago from this tab: reuse that code instead of paying for another.
      setPhone(e164); setCooldown(wait); go("phone-code");
      setInfo(`We already texted a code to ${formatPhone(e164)}. Enter it below, or request a new one in ${wait}s.`);
      return;
    }
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth
      .signInWithOtp({ phone: e164, options: { shouldCreateUser: create, channel: "sms", ...(captchaToken ? { captchaToken } : {}) } })
      .catch((e: unknown) => ({ error: e as { message?: string } }));
    usedCaptcha();
    setBusy(false);
    setPhone(e164);
    if (error && !create && isNoAccountError(error)) { go("phone-new"); return; }
    if (error) { setErr(smsErrorMessage(error, "send")); return; }
    markSent(e164);
    go("phone-code"); setCooldown(RESEND_COOLDOWN_S);
    if (resend) setInfo(`We texted a new code to ${formatPhone(e164)}. Use the newest one.`);
    onPhoneSent?.(e164);
  }

  async function verifyPhone() {
    if (!supabase || !phone) return;
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth
      .verifyOtp({ phone, token: code.trim(), type: "sms" })
      .catch((e: unknown) => ({ error: e as { message?: string } }));
    if (error) { setBusy(false); setErr(smsErrorMessage(error, "verify")); return; }
    await finish();
  }

  // ---- Email (fallback, recovery, and linking a phone to an existing account) -------------
  async function sendEmail(resend = false) {
    if (!supabase) { setErr("Accounts aren't configured on this server yet."); return; }
    setBusy(true); setErr(null); setInfo(null);
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("next", next);
    if (marketing) redirect.searchParams.set("marketing", "1");
    const { error } = await (getOtpClient() ?? supabase).auth
      .signInWithOtp({
        email: email.trim(),
        // Linking: only existing accounts may continue, so a typo can't create a second account.
        options: { emailRedirectTo: redirect.toString(), shouldCreateUser: !linkPhone, ...(captchaToken ? { captchaToken } : {}) },
      })
      .catch((e: unknown) => ({ error: e as { message?: string } }));
    usedCaptcha();
    setBusy(false);
    if (error && linkPhone && isNoAccountError(error)) { setErr("We couldn't find an account with that email. Check the spelling, or go back and create a new account with your phone."); return; }
    if (error) { setErr(emailError(error, "send")); return; }
    go("email-code"); setCooldown(60);
    if (resend) setInfo(`We sent a new code to ${email.trim()}. Use the newest one.`);
    onEmailSent?.(email.trim());
  }

  async function verifyEmail() {
    if (!supabase) return;
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth
      .verifyOtp({ email: email.trim(), token: code.trim(), type: "email" })
      .catch((e: unknown) => ({ error: e as { message?: string } }));
    if (error) { setBusy(false); setErr(emailError(error, "verify")); return; }
    if (linkPhone) {
      // Signed in to the existing account. Now prove the phone too: Supabase texts a code to it and
      // only attaches it to this account once that code is entered.
      const { error: e2 } = await supabase.auth.updateUser({ phone: linkPhone }).catch((e: unknown) => ({ error: e as { message?: string } }));
      setBusy(false);
      if (e2) { go("link-code"); setErr(smsErrorMessage(e2, "link")); return; }
      markSent(linkPhone);
      go("link-code"); setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    await finish();
  }

  async function resendLink() {
    if (!supabase || !linkPhone) return;
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth.updateUser({ phone: linkPhone }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) { setErr(smsErrorMessage(error, "link")); return; }
    markSent(linkPhone); setCooldown(RESEND_COOLDOWN_S);
    setInfo(`We texted a new code to ${formatPhone(linkPhone)}.`);
  }

  async function verifyLink() {
    if (!supabase || !linkPhone) return;
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth
      .verifyOtp({ phone: linkPhone, token: code.trim(), type: "phone_change" })
      .catch((e: unknown) => ({ error: e as { message?: string } }));
    if (error) { setBusy(false); setErr(smsErrorMessage(error, "verify")); return; }
    await finish();
  }

  const codeStage = stage === "phone-code" || stage === "link-code";
  useWebOtp(open && codeStage, (c) => setCode(c));

  // ---- Copy ---------------------------------------------------------------------------------
  const shown = formatPhone(stage === "link-code" ? linkPhone : phone);
  const defaultLead = `No password needed. Your bid is saved and will be waiting. ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} every month.`;
  const heading = (() => {
    if (stage === "phone-new") return "Is this your first time here?";
    if (stage === "link-code") return "Confirm your phone";
    if (copy) return copy.title;
    if (stage === "phone") return title ?? "Create your free account to download";
    if (stage === "phone-code") return "Enter the code we texted you";
    if (stage === "email") return title ?? "Create your free account to download";
    return "Check your email";
  })();
  const description = (() => {
    switch (stage) {
      case "phone": return copy ? (copy.phoneDescription ?? copy.emailDescription) : `${defaultLead}`;
      case "phone-code": return copy?.phoneSentDescription ? copy.phoneSentDescription(shown) : `We texted a 6-digit code to ${shown}.`;
      case "phone-new": return `We don't have a Built2Bid account for ${shown} yet.`;
      case "email": return linkPhone ? `Sign in to your existing account with the email you used before. Then we'll add ${shown} to it, so next time you can sign in by text.` : copy ? copy.emailDescription : defaultLead;
      case "email-code": return copy && !linkPhone ? copy.sentDescription(email.trim()) : `We sent a sign-in link and code to ${email}.`;
      case "link-code": return `You're signed in. We texted a code to ${shown}. Enter it to add this number to your account.`;
    }
  })();

  const smsTerms = (
    <p className="text-center text-xs text-muted">
      By continuing you agree to the <Link href="/terms" className="underline" target="_blank">Terms</Link> and <Link href="/privacy" className="underline" target="_blank">Privacy Policy</Link>, and to receive a one-time verification text from Built2Bid. Msg &amp; data rates may apply.
    </p>
  );
  const emailTerms = <p className="text-center text-xs text-muted">By continuing you agree to the <Link href="/terms" className="underline" target="_blank">Terms</Link> and <Link href="/privacy" className="underline" target="_blank">Privacy Policy</Link>.</p>;
  const marketingBox = (
    <label className="flex items-start gap-2 text-sm text-ink-soft">
      <input type="checkbox" checked={marketing} onChange={(ev) => setMarketing(ev.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
      <span>Also email me occasional product tips and offers (optional, unsubscribe anytime).</span>
    </label>
  );
  const codeField = (id: string) => (
    <>
      <label htmlFor={id} className="label">Verification code</label>
      <input id={id} autoFocus inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" enterKeyHint="go" maxLength={8} className="field tabular text-center text-lg tracking-[0.4em]"
        value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))} aria-describedby={err ? `${id}-error` : undefined} aria-invalid={Boolean(err) || undefined} />
      {err && <Err id={`${id}-error`}>{err}</Err>}
      {info && !err && <Notice tone="ok">{info}</Notice>}
    </>
  );
  const resendButton = (onClick: () => void) => (
    <button type="button" className="min-h-11 text-brand underline disabled:text-muted disabled:no-underline" disabled={busy || cooldown > 0 || (stage === "email-code" && captchaMissing)} onClick={onClick}>
      {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
    </button>
  );

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={heading} description={description}>
      {summary}

      {stage === "phone" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void sendPhone({ create: false }); }} className="space-y-3">
          <label htmlFor="auth-phone" className="label">Mobile number</label>
          <div className="flex gap-2">
            <label htmlFor="auth-country" className="sr-only">Country code</label>
            <select id="auth-country" className="field w-auto shrink-0 pr-7" value={country.iso} autoComplete="tel-country-code"
              onChange={(ev) => { setCountry(countryByIso(ev.target.value)); setErr(null); }}>
              {COUNTRIES.map((c) => <option key={c.iso} value={c.iso}>{c.flag} +{c.dial}</option>)}
            </select>
            <input id="auth-phone" type="tel" required autoFocus autoComplete="tel-national" inputMode="tel" className="field min-w-0 flex-1"
              placeholder={country.dial === "1" ? "(555) 123-4567" : ""} value={phoneInput}
              onChange={(ev) => { setPhoneInput(formatAsYouType(ev.target.value, country)); setErr(null); }}
              aria-describedby="auth-phone-hint" aria-invalid={Boolean(err) || undefined} />
          </div>
          <p id="auth-phone-hint" className="text-xs text-muted">We&apos;ll text you a 6-digit code. Enter it here, even if your phone and computer are different devices.</p>
          {marketingBox}
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          {err && <Err>{err}</Err>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || phoneInput.replace(/\D/g, "").length < 6 || captchaMissing}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />} Text me a code
          </Button>
          <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" onClick={() => { setLinkPhone(null); go("email"); }}>Use email instead</button>
          {smsTerms}
        </form>
      )}

      {stage === "phone-code" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void verifyPhone(); }} className="space-y-3">
          <p className="text-sm text-ink-soft">Keep this {copy ? "window" : "tab"} open. Codes expire after 10 minutes.</p>
          {codeField("auth-code")}
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {copy?.submitLabel ?? "Verify and continue"}</Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            {resendButton(() => void sendPhone({ create: false, resend: true }))}
            <button type="button" className="min-h-11 text-brand underline" onClick={() => go("phone")}>Use a different number</button>
          </div>
          <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" onClick={() => { setLinkPhone(null); go("email"); }}>Didn&apos;t get a text? Use email instead</button>
        </form>
      )}

      {stage === "phone-new" && (
        <div className="space-y-3">
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          {err && <Err>{err}</Err>}
          <Button className="w-full whitespace-normal px-4 text-center" size="lg" disabled={busy || captchaMissing} onClick={() => void sendPhone({ create: true })}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <MessageSquareText className="h-4 w-4 shrink-0" />} I&apos;m new here
          </Button>
          <Button variant="secondary" className="w-full whitespace-normal px-4 text-center" size="lg" disabled={busy} onClick={() => { setLinkPhone(phone); go("email"); }}>
            <Mail className="h-4 w-4 shrink-0" /> I signed up with email before
          </Button>
          <p className="text-xs text-muted">Used Built2Bid with your email before? Choose the second option. You&apos;ll sign in with a code sent to that email, then confirm this phone, and your bids, customers and subscription stay together in one account.</p>
          <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" onClick={() => go("phone")}>Use a different number</button>
          {smsTerms}
        </div>
      )}

      {stage === "email" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void sendEmail(); }} className="space-y-3">
          <label htmlFor="auth-email" className="label">{linkPhone ? "Email on your account" : "Business email"}</label>
          <input id="auth-email" type="email" required autoFocus autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} className="field" value={email} onChange={(ev) => setEmail(ev.target.value)} />
          {!linkPhone && <p className="text-xs text-muted">We use your email to verify your account and send sign-in links and receipts.</p>}
          {!linkPhone && marketingBox}
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          {err && <Err>{err}</Err>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || !email.includes("@") || captchaMissing}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {copy || linkPhone || sms ? "Email me a verification code" : "Email me a sign-in link"}
          </Button>
          {sms && <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" onClick={() => { setLinkPhone(null); go("phone"); }}>{linkPhone ? "Back" : "Use my phone instead"}</button>}
          {emailTerms}
        </form>
      )}

      {stage === "email-code" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void verifyEmail(); }} className="space-y-3">
          <p className="text-sm text-ink-soft">{linkPhone ? "Enter the 6-digit code from the email. Keep this tab open." : copy ? "Enter the 6-digit code from the email, or tap the link in it. Keep this tab open." : "Click the link in the email, or enter the 6-digit code here. Keep this tab open; your bid is saved on this device."}</p>
          {codeField("auth-code")}
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {copy?.submitLabel ?? "Verify and continue"}</Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            {resendButton(() => void sendEmail(true))}
            <button type="button" className="min-h-11 text-brand underline" onClick={() => go("email")}>Use a different email</button>
          </div>
        </form>
      )}

      {stage === "link-code" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void verifyLink(); }} className="space-y-3">
          {codeField("auth-link-code")}
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add phone and continue</Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            {resendButton(() => void resendLink())}
            <button type="button" className="min-h-11 text-brand underline" disabled={busy} onClick={() => { setBusy(true); void finish(); }}>Skip for now</button>
          </div>
          <p className="text-xs text-muted">You can add or change your phone any time in Account settings.</p>
        </form>
      )}

      {footer}
    </Modal>
  );
}
