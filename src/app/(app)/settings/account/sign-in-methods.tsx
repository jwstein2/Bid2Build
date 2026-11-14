"use client";
import { Loader2, Mail, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { getBrowserClient } from "@/lib/supabase/client";
import {
  COUNTRIES, DEFAULT_COUNTRY, RESEND_COOLDOWN_S, cooldownLeft, countryByIso, formatAsYouType, formatPhone,
  markSent, normalizePhone, samePhone, smsErrorMessage, type Country,
} from "@/lib/auth/phone";

type Props = { email: string | null; emailVerified: boolean; phone: string | null; phoneVerified: boolean; smsEnabled: boolean };

/**
 * Sign-in methods on one account. Adding a phone (or an email) here is how an existing account gets a
 * second way in: the person is already signed in, and Supabase only attaches the new phone/email after
 * its own code is entered, so nobody can claim an account just by knowing its email or number.
 */
export function SignInMethods({ email, emailVerified, phone, phoneVerified, smsEnabled }: Props) {
  return (
    <Card className="p-5">
      <h2 className="font-bold">Sign-in methods</h2>
      <p className="text-sm text-ink-soft">You sign in with a one-time code. There is no password to manage.</p>
      <div className="mt-4 divide-y divide-line">
        {(smsEnabled || phone) && <PhoneRow phone={phone} verified={phoneVerified} canChange={smsEnabled} />}
        <EmailRow email={email} verified={emailVerified} />
      </div>
    </Card>
  );
}

function useCooldown(initial = 0) {
  const [s, set] = useState(initial);
  useEffect(() => {
    if (s <= 0) return;
    const t = setTimeout(() => set((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [s]);
  return [s, set] as const;
}

function PhoneRow({ phone, verified, canChange }: { phone: string | null; verified: boolean; canChange: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "enter" | "code">("view");
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useCooldown();

  async function send(resend = false) {
    const supabase = getBrowserClient();
    const e164 = resend ? target : normalizePhone(input, country);
    if (!supabase || !e164) { setErr("Enter a valid mobile number, including the area code."); return; }
    if (samePhone(e164, phone) && verified) { setErr("That's already the number on your account."); return; }
    const wait = cooldownLeft(e164);
    if (wait > 0) { setTarget(e164); setMode("code"); setCooldown(wait); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.updateUser({ phone: e164 }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) { setErr(smsErrorMessage(error, "link")); return; }
    markSent(e164); setTarget(e164); setCode(""); setMode("code"); setCooldown(RESEND_COOLDOWN_S);
  }
  async function verify() {
    const supabase = getBrowserClient();
    if (!supabase || !target) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ phone: target, token: code.trim(), type: "phone_change" }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) { setErr(smsErrorMessage(error, "verify")); return; }
    setDone(true); setMode("view"); router.refresh();
  }

  return (
    <div className="py-3 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted"><MessageSquareText className="h-4 w-4" aria-hidden /> Mobile phone (text codes)</p>
          <p className="font-semibold">{phone ? formatPhone(phone) : "Not added"}</p>
          <p className="text-sm text-ink-soft">{phone ? (verified ? "Verified. You can sign in with a texted code." : "Not verified yet.") : "Add your mobile number to sign in by text instead of waiting for an email."}</p>
        </div>
        {canChange && mode === "view" && <Button variant="secondary" size="sm" onClick={() => { setMode("enter"); setErr(null); setDone(false); }}>{phone ? "Change number" : "Add phone"}</Button>}
      </div>
      {done && <Notice tone="ok" className="mt-3">Phone added. Next time, sign in with a code sent to it.</Notice>}
      {mode === "enter" && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label htmlFor="settings-phone" className="label">Mobile number</label>
          <div className="flex gap-2">
            <label htmlFor="settings-country" className="sr-only">Country code</label>
            <select id="settings-country" className="field w-auto shrink-0 pr-7" value={country.iso} onChange={(e) => setCountry(countryByIso(e.target.value))}>
              {COUNTRIES.map((c) => <option key={c.iso} value={c.iso}>{c.flag} +{c.dial}</option>)}
            </select>
            <input id="settings-phone" type="tel" autoComplete="tel-national" inputMode="tel" className="field min-w-0 flex-1" placeholder={country.dial === "1" ? "(555) 123-4567" : ""}
              value={input} onChange={(e) => { setInput(formatAsYouType(e.target.value, country)); setErr(null); }} />
          </div>
          <p className="text-xs text-muted">We&apos;ll text a one-time code to confirm it. Msg &amp; data rates may apply.</p>
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || input.replace(/\D/g, "").length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Text me a code</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        </form>
      )}
      {mode === "code" && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <label htmlFor="settings-phone-code" className="label">Code texted to {formatPhone(target)}</label>
          <input id="settings-phone-code" autoFocus inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8} className="field max-w-[220px] tabular text-center text-lg tracking-[0.4em]"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm phone</Button>
            <button type="button" className="min-h-11 text-sm text-brand underline disabled:text-muted disabled:no-underline" disabled={busy || cooldown > 0} onClick={() => void send(true)}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button>
            <button type="button" className="min-h-11 text-sm text-brand underline" onClick={() => setMode("enter")}>Different number</button>
          </div>
        </form>
      )}
    </div>
  );
}

function EmailRow({ email, verified }: { email: string | null; verified: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "enter" | "sent">("view");
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    const supabase = getBrowserClient();
    if (!supabase) return;
    setBusy(true); setErr(null);
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("next", "/settings/account");
    const { error } = await supabase.auth.updateUser({ email: input.trim() }, { emailRedirectTo: redirect.toString() }).catch((e: unknown) => ({ error: e as { message?: string; code?: string } }));
    setBusy(false);
    if (error) {
      const m = (error.message ?? "").toLowerCase();
      setErr((error as { code?: string }).code === "email_exists" || m.includes("already been registered")
        ? "That email is already used by another Built2Bid account. Sign in with it instead, or contact support to merge accounts."
        : "We couldn't send to that email. Check it and try again.");
      return;
    }
    setMode("sent");
  }
  async function verify() {
    const supabase = getBrowserClient();
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: input.trim(), token: code.trim(), type: "email_change" }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) { setErr("That code didn't work. Use the link in the email instead, or send it again."); return; }
    setMode("view"); router.refresh();
  }

  return (
    <div className="py-3 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted"><Mail className="h-4 w-4" aria-hidden /> Email</p>
          <p className="break-all font-semibold">{email ?? "Not added"}</p>
          <p className="text-sm text-ink-soft">{email ? (verified ? "Verified. Used for receipts, account notices, and as a backup way to sign in." : "Not verified yet: check your inbox.") : "Add an email for receipts, account notices, and a backup way to sign in."}</p>
        </div>
        {!email && mode === "view" && <Button variant="secondary" size="sm" onClick={() => setMode("enter")}>Add email</Button>}
      </div>
      {mode === "enter" && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label htmlFor="settings-email" className="label">Email</label>
          <input id="settings-email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} className="field" value={input} onChange={(e) => setInput(e.target.value)} />
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !input.includes("@")}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send confirmation</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        </form>
      )}
      {mode === "sent" && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <p className="text-sm text-ink-soft">We sent a confirmation to <b className="break-all">{input.trim()}</b>. Tap the link in it, or enter the code here.</p>
          <label htmlFor="settings-email-code" className="label">Code from the email</label>
          <input id="settings-email-code" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8} className="field max-w-[220px] tabular text-center text-lg tracking-[0.4em]"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm email</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("enter")}>Change email</Button>
          </div>
        </form>
      )}
    </div>
  );
}
