"use client";
import { Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { getBrowserClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string | null; factor_type: string; status: string; created_at: string };
type Enrolling = { factorId: string; qr: string; secret: string };

const codeOk = (c: string) => /^\d{6}$/.test(c);
const friendly = (e: unknown) => {
  const m = (e as { message?: string } | null)?.message ?? "";
  if (/invalid|expired|code/i.test(m)) return "That code didn't match. Check the time on your phone and enter the newest 6-digit code.";
  if (/aal2|assurance/i.test(m)) return "Sign in with your authenticator code first, then try again.";
  return "Something went wrong. Nothing was changed.";
};

/**
 * Two-step sign-in: an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) on top of
 * the email code. Required before connecting a bank. Uses Supabase Auth MFA (TOTP); the secret never reaches
 * Built2Bid's servers beyond Supabase Auth.
 */
export function TwoStepSignIn() {
  const supabase = getBrowserClient();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const fetchFactors = useCallback(async () => {
    if (!supabase) return [] as Factor[];
    const { data } = await supabase.auth.mfa.listFactors();
    return ((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === "totp");
  }, [supabase]);
  const load = useCallback(async () => { setFactors(await fetchFactors()); }, [fetchFactors]);
  useEffect(() => {
    let live = true;
    fetchFactors().then((f) => { if (live) setFactors(f); }).catch(() => { if (live) setFactors([]); });
    return () => { live = false; };
  }, [fetchFactors]);

  const verified = (factors ?? []).filter((f) => f.status === "verified");

  async function start() {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    // Clear any half-finished setup first so a fresh QR code can be issued.
    for (const f of (factors ?? []).filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) { setMsg({ tone: "danger", text: friendly(error) }); return; }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function confirm() {
    if (!supabase || !enrolling || !codeOk(code)) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code });
    setBusy(false);
    if (error) { setMsg({ tone: "danger", text: friendly(error) }); return; }
    setEnrolling(null); setCode("");
    setMsg({ tone: "ok", text: "Two-step sign-in is on. Next time you sign in, you'll enter a code from your authenticator app after the email code." });
    await load();
  }

  async function remove(f: Factor) {
    if (!supabase) return;
    if (!window.confirm("Turn off two-step sign-in? You won't be able to connect or reconnect a bank until you turn it back on.")) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (!error) await supabase.auth.refreshSession().catch(() => null);
    setBusy(false);
    if (error) { setMsg({ tone: "danger", text: friendly(error) }); return; }
    setMsg({ tone: "ok", text: "Two-step sign-in is off." });
    await load();
  }

  return (
    <Card className="p-5" id="two-step" data-testid="two-step">
      <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden /> Two-step sign-in</h2>
      <p className="text-sm text-ink-soft">Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others) after your email code. It&apos;s required before you connect a bank account.</p>
      {!supabase ? <p className="mt-3 text-sm text-muted">Sign-in isn&apos;t configured on this site.</p> : factors === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…</p>
      ) : verified.length ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-ok" data-testid="two-step-on">On</p>
          {verified.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
              <span>{f.friendly_name || "Authenticator app"} · added {new Date(f.created_at).toLocaleDateString("en-US")}</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove(f)}>Turn off</Button>
            </div>
          ))}
          <p className="text-xs text-muted">Lost your phone? Email support from the address on your account and we&apos;ll verify you before resetting it.</p>
        </div>
      ) : enrolling ? (
        <div className="mt-3 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code, or type the setup key.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR code as an SVG data URL */}
          <img src={enrolling.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-lg border border-line bg-white p-2" />
          <p className="text-xs text-muted">Setup key: <code className="select-all break-all">{enrolling.secret}</code></p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="label">6-digit code</span>
              <input className="field w-36 tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }} data-testid="two-step-code" />
            </label>
            <Button disabled={busy || !codeOk(code)} onClick={() => void confirm()}>{busy ? "Checking…" : "Turn on"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setEnrolling(null); void load(); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3"><Button disabled={busy} onClick={() => void start()} data-testid="two-step-start">{busy ? "Starting…" : "Set up two-step sign-in"}</Button></div>
      )}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Card>
  );
}
