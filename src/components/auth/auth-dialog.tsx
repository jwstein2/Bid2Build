"use client";
import { isNewAccount, track } from "@/lib/analytics/track";
import { Inbox, Loader2, Mail, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getBrowserClient, getOtpClient } from "@/lib/supabase/client";
import { plans } from "@/lib/site";
import {
  COUNTRIES, DEFAULT_COUNTRY, RESEND_COOLDOWN_S, cooldownLeft, countryByIso, formatAsYouType, formatPhone,
  abandonPhoneSignup, isNoAccountError, isSendFailure, isSmsSignInEnabled, markSent, normalizePhone, smsErrorMessage, type Country,
} from "@/lib/auth/phone";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { Modal } from "../builder/dialogs";
import { Captcha, captchaEnabled } from "./captcha";
import { EMAIL_SENDS_BEFORE_HELP, SMS_OTP_LENGTH, codeProblem, codeRequestedText, emailOtpLength, readCode, resendCooldownS } from "@/lib/auth/config";
import { MARKETING_CONSENT_TEXT } from "@/lib/email/consent-copy";

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
 *  - Default (email only): email → 6-digit emailed code → verified in this browser → onVerified.
 *    No phone number is asked for and nothing is texted.
 *  - SMS on (NEXT_PUBLIC_SMS_AUTH_ENABLED=true, Twilio approved): mobile number → texted code, with email as the fallback.
 *    A number with no account asks whether the person already has an email account; if so they sign
 *    in by email first and then confirm the phone, which attaches it to that same account (no duplicate).
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
  // The text to confirm the phone could not be sent: say so plainly instead of asking for a code.
  const [linkFailed, setLinkFailed] = useState(false);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [marketing, setMarketing] = useState(false);
  // Codes requested in this dialog (drives the resend back-off; never stored).
  const [emailSends, setEmailSends] = useState(initialEmail ? 1 : 0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() => (initialPhone ? cooldownLeft(initialPhone) : 0));
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const needCaptcha = captchaEnabled();
  const emailLen = emailOtpLength();
  const codeLen = stage === "email-code" ? emailLen : SMS_OTP_LENGTH;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const go = (s: Stage) => { setStage(s); setCode(""); setErr(null); setInfo(null); };
  const usedCaptcha = () => { setCaptchaToken(null); setCaptchaReset((n) => n + 1); };
  const captchaMissing = needCaptcha && !captchaToken;

  const finish = useCallback(async () => {
    if (marketing) await fetch("/api/account/marketing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optIn: true, source: "signup_dialog" }) }).catch(() => {});
    try { await onVerified?.(); } finally { setBusy(false); }
  }, [marketing, onVerified]);

  // ---- Phone ------------------------------------------------------------------------------
  async function sendPhone({ create, resend }: { create: boolean; resend?: boolean }) {
    if (!sms) return; // SMS auth disabled: never ask Supabase to text anyone.
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
    if (error) {
      setErr(smsErrorMessage(error, "send"));
      // A failed text after "I'm new here" leaves a half-made phone account behind; ask the server
      // to remove it (it checks the account is exactly that leftover before deleting anything).
      if (create && isSendFailure(error)) void abandonPhoneSignup(e164);
      return;
    }
    markSent(e164);
    go("phone-code"); setCooldown(RESEND_COOLDOWN_S);
    if (resend) setInfo(`We texted a new code to ${formatPhone(e164)}. Use the newest one.`);
    onPhoneSent?.(e164);
  }

  async function verifyPhone() {
    if (!sms || !supabase || !phone) return;
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
    const sends = emailSends + 1;
    setEmailSends(sends);
    go("email-code"); setCooldown(resendCooldownS(sends));
    if (!resend) track("signup_started", { method: "email" });
    track(resend ? "otp_resent" : "otp_requested", { method: "email", attempt: sends });
    // Accepted by Supabase is not the same as delivered, so the wording never says it arrived.
    if (resend) setInfo(sends >= EMAIL_SENDS_BEFORE_HELP
      ? `We asked for another code for ${email.trim()}. Still nothing? Check the address is spelled right, look in Spam, Junk or Promotions, or email support@built2bid.org.`
      : `A new code is on its way to ${email.trim()}. Use the newest one; older codes stop working.`);
    onEmailSent?.(email.trim());
  }

  async function verifyEmail() {
    if (!supabase) return;
    const checked = readCode(code, emailLen);
    if (!checked.ok) { setErr(codeProblem(checked.reason, emailLen)); return; }
    setBusy(true); setErr(null); setInfo(null);
    const { data: verified, error } = await supabase.auth
      .verifyOtp({ email: email.trim(), token: checked.code, type: "email" })
      .catch((e: unknown) => ({ data: null, error: e as { message?: string } }));
    if (error) {
      setBusy(false); setErr(emailError(error, "verify"));
      track("otp_verify_failed", { method: "email", reason: (error as { code?: string }).code === "otp_expired" ? "expired_or_wrong" : "other" });
      return;
    }
    track("otp_verified", { method: "email" });
    // A brand-new account (created in the last 15 minutes): mirror the server's account_created event.
    const u = verified?.user;
    if (u?.created_at && isNewAccount(u.created_at)) track("sign_up", { method: "email" }, `account_created:${u.id}`);
    if (linkPhone && sms) {
      // Signed in to the existing account. Now prove the phone too: Supabase texts a code to it and
      // only attaches it to this account once that code is entered.
      const { error: e2 } = await supabase.auth.updateUser({ phone: linkPhone }).catch((e: unknown) => ({ error: e as { message?: string } }));
      setBusy(false);
      go("link-code");
      if (e2) { setLinkFailed(isSendFailure(e2)); if (!isSendFailure(e2)) setErr(smsErrorMessage(e2, "link")); return; }
      setLinkFailed(false); markSent(linkPhone); setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    await finish();
  }

  async function resendLink() {
    if (!sms || !supabase || !linkPhone) return;
    setBusy(true); setErr(null); setInfo(null);
    const { error } = await supabase.auth.updateUser({ phone: linkPhone }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) {
      if (isSendFailure(error)) { setLinkFailed(true); setErr(null); setInfo(null); return; }
      setErr(smsErrorMessage(error, "link")); return;
    }
    const wasFailed = linkFailed;
    setLinkFailed(false); markSent(linkPhone); setCooldown(RESEND_COOLDOWN_S);
    setInfo(wasFailed ? null : `We texted a new code to ${formatPhone(linkPhone)}.`);
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
  // Builder gate: say exactly what happens next, so nobody is surprised by a credit or a sign-up.
  const defaultLead = `No password needed, and your bid stays saved on this device. Downloading or sending finalizes the bid: that uses 1 bid credit (new accounts get ${plans.starterCredits} free, plus ${plans.monthlyCredits} every month; Individual Unlimited plans never use credits). Editing and downloading it again is free.`;
  const heading = (() => {
    if (stage === "phone-new") return "Is this your first time here?";
    if (stage === "link-code") return linkFailed ? "We couldn't add your phone yet" : "Confirm your phone";
    if (copy) return copy.title;
    if (stage === "phone") return title ?? "Create your free account to finish your bid";
    if (stage === "phone-code") return "Enter the code we texted you";
    if (stage === "email") return title ?? "Create your free account to finish your bid";
    return "Check your email";
  })();
  const description = (() => {
    switch (stage) {
      case "phone": return copy ? (copy.phoneDescription ?? copy.emailDescription) : `${defaultLead}`;
      case "phone-code": return copy?.phoneSentDescription ? copy.phoneSentDescription(shown) : `We texted a 6-digit code to ${shown}.`;
      case "phone-new": return `We don't have a Built2Bid account for ${shown} yet.`;
      case "email": return linkPhone ? `Sign in to your existing account with the email you used before. Then we'll add ${shown} to it, so next time you can sign in by text.` : copy ? copy.emailDescription : defaultLead;
      case "email-code": return copy && !linkPhone ? copy.sentDescription(email.trim()) : codeRequestedText(email.trim(), emailLen);
      case "link-code": return linkFailed
        ? `You're signed in. We couldn't send a text to ${shown} right now, so it wasn't added. Your account works as normal, and you can add your phone later in Account settings.`
        : `You're signed in. We texted a code to ${shown}. Enter it to add this number to your account.`;
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
      <span>{MARKETING_CONSENT_TEXT}</span>
    </label>
  );
  // One box, exactly codeLen digits. Typing, pasting the whole code ("012 345" too) and iOS/Android
  // one-time-code autofill all land here. A pasted code that's too long is reported, never trimmed.
  const takeCode = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > codeLen) { setErr(codeProblem("too_long", codeLen)); return; }
    setErr(null); setCode(digits);
  };
  const codeField = (id: string) => (
    <>
      <label htmlFor={id} className="label">{codeLen}-digit verification code</label>
      <input id={id} name="one-time-code" autoFocus type="text" inputMode="numeric" pattern={`[0-9]{${codeLen}}`} autoComplete="one-time-code" enterKeyHint="go" maxLength={codeLen}
        className="field tabular text-center text-lg tracking-[0.4em]" placeholder={"•".repeat(codeLen)}
        value={code}
        onPaste={(ev) => { ev.preventDefault(); takeCode(ev.clipboardData.getData("text")); }}
        onChange={(ev) => takeCode(ev.target.value)}
        aria-describedby={err ? `${id}-error` : undefined} aria-invalid={Boolean(err) || undefined} />
      {err && <Err id={`${id}-error`}>{err}</Err>}
      {info && !err && <Notice tone="ok">{info}</Notice>}
    </>
  );
  const resendButton = (onClick: () => void) => (
    <button type="button" className="min-h-11 text-brand underline disabled:text-muted disabled:no-underline" disabled={busy || cooldown > 0 || (stage === "email-code" && captchaMissing)} onClick={onClick}>
      {cooldown > 0 ? `Resend code in ${cooldown >= 60 ? `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}` : `${cooldown}s`}` : "Resend code"}
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
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length !== codeLen}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {copy?.submitLabel ?? "Verify and continue"}</Button>
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
          {!linkPhone && <p className="text-xs text-muted">We&apos;ll email you a {emailLen}-digit code. Enter it here to sign in or create your account. We also use your email for receipts.</p>}
          {!linkPhone && marketingBox}
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          {err && <Err>{err}</Err>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || !email.includes("@") || captchaMissing}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email me a verification code
          </Button>
          {sms && <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" onClick={() => { setLinkPhone(null); go("phone"); }}>{linkPhone ? "Back" : "Use my phone instead"}</button>}
          {emailTerms}
        </form>
      )}

      {stage === "email-code" && (
        <form onSubmit={(ev) => { ev.preventDefault(); void verifyEmail(); }} className="space-y-3">
          <p className="text-sm text-ink-soft">{`Keep this ${copy ? "window" : "tab"} open${copy || linkPhone ? "" : "; your bid is saved on this device"}. Nothing is lost while you wait.`}</p>
          {codeField("auth-code")}
          {/* Codes sometimes land in spam: say so plainly, up front, so a slow inbox never feels like a failed sign-up. */}
          <div className="rounded-lg border border-line bg-paper p-3 text-sm" data-testid="code-spam-help">
            <p className="flex items-center gap-1.5 font-semibold"><Inbox className="h-4 w-4 shrink-0 text-brand" aria-hidden /> Don&apos;t see the email?</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
              <li>Check <b className="font-semibold text-ink">Spam</b>, <b className="font-semibold text-ink">Junk</b> or <b className="font-semibold text-ink">Promotions</b> for &quot;Your Built2Bid verification code&quot;.</li>
              <li>Found it there? Mark it <b className="font-semibold text-ink">Not spam</b> so your proposals and receipts reach your inbox.</li>
              <li>Still nothing after a minute? Resend below; the newest code is the one that works.</li>
            </ul>
          </div>
          <Captcha onToken={setCaptchaToken} resetKey={captchaReset} />
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length !== codeLen}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {copy?.submitLabel ?? "Verify and continue"}</Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            {resendButton(() => void sendEmail(true))}
            <button type="button" className="min-h-11 text-brand underline" onClick={() => go("email")}>Use a different email</button>
          </div>
        </form>
      )}

      {stage === "link-code" && linkFailed && (
        <div className="space-y-3">
          <Button type="button" className="w-full" size="lg" disabled={busy} onClick={() => { setBusy(true); void finish(); }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue</Button>
          <button type="button" className="min-h-11 w-full text-center text-sm text-brand underline" disabled={busy} onClick={() => void resendLink()}>Try texting again</button>
        </div>
      )}

      {stage === "link-code" && !linkFailed && (
        <form onSubmit={(ev) => { ev.preventDefault(); void verifyLink(); }} className="space-y-3">
          {codeField("auth-link-code")}
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length !== codeLen}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add phone and continue</Button>
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
