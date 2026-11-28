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
export function TwoStepSignIn({ admin = false, adminRequired = false }: { admin?: boolean; adminRequired?: boolean } = {}) {
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
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}` /* unique per account; a backup gets its own name */ });
    setBusy(false);
    if (error || !data?.totp) { setMsg({ tone: "danger", text: friendly(error) }); return; }
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
    setMsg({ tone: "ok", text: adminRequired
      ? "Two-step sign-in is on. You can open the admin area now. Next time you sign in, you'll enter a code from your authenticator app after the email code."
      : "Two-step sign-in is on. Next time you sign in, you'll enter a code from your authenticator app after the email code." });
    await load();
  }

  async function remove(f: Factor) {
    if (!supabase) return;
    const last = verified.length <= 1;
    const warn = admin && last
      ? "Remove your only authenticator? The admin area will ask you to set up a new one before it opens, and you won't be able to connect a bank until you do."
      : last ? "Turn off two-step sign-in? You won't be able to connect or reconnect a bank until you turn it back on." : "Remove this authenticator? Your other one keeps working.";
    if (!window.confirm(warn)) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (!error) await supabase.auth.refreshSession().catch(() => null);
    setBusy(false);
    if (error) { setMsg({ tone: "danger", text: friendly(error) }); return; }
    setMsg({ tone: "ok", text: verified.length > 1 ? "Authenticator removed." : "Two-step sign-in is off." });
    await load();
  }

  return (
    <Card className="p-5" id="two-step" data-testid="two-step">
      <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden /> Two-step sign-in</h2>
      <p className="text-sm text-ink-soft">Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others) after your email code. It&apos;s required before you connect a bank account.</p>
      {adminRequired && !verified.length && <Notice tone="warn" className="mt-3">The admin area requires two-step sign-in. Set it up below, then open <a className="font-semibold underline" href="/admin">the admin area</a> again.</Notice>}
      {adminRequired && verified.length > 0 && <Notice tone="ok" className="mt-3">Two-step sign-in is on. <a className="font-semibold underline" href="/admin">Open the admin area</a>.</Notice>}
      {!supabase ? <p className="mt-3 text-sm text-muted">Sign-in isn&apos;t configured on this site.</p> : factors === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…</p>
      ) : verified.length && !enrolling ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-ok" data-testid="two-step-on">On</p>
          {verified.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
              <span>{f.friendly_name || "Authenticator app"} · added {new Date(f.created_at).toLocaleDateString("en-US")}</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove(f)}>Turn off</Button>
            </div>
          ))}
          {admin ? (
            <>
              {verified.length < 2 && <p className="text-sm text-ink-soft" data-testid="two-step-backup-tip">Admin account: add a backup so a lost phone can&apos;t lock you out, for example a second phone or 1Password on your computer.</p>}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void start()} data-testid="two-step-add-backup">Add a backup authenticator</Button>
            </>
          ) : (
            <p className="text-xs text-muted">Lost your phone? Email support from the address on your account and we&apos;ll verify you before resetting it.</p>
          )}
        </div>
      ) : enrolling ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-accent/40 bg-accent-tint px-3 py-2 text-sm text-ink" role="note" data-testid="two-step-app-note">
            <p className="font-semibold">You need an authenticator app first.</p>
            <p className="mt-1">
              Download <b>Microsoft Authenticator</b> (the blue shield icon) from the{" "}
              <a href="https://play.google.com/store/apps/details?id=com.azure.authenticator" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink underline">Google Play Store</a> or the{" "}
              <a href="https://apps.apple.com/us/app/microsoft-authenticator/id983156458" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink underline">Apple App Store</a>,
              or use one you already have, such as Google Authenticator or 1Password.
            </p>
            <p className="mt-1">Scan the QR code from <b>inside that app</b>. Your phone&apos;s regular camera will only show a line of text, not set anything up.</p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open your authenticator app and tap <b>+</b> (add account).</li>
            <li>Choose <b>Scan a QR code</b> and scan this code, or type the setup key.</li>
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
            <Button loading={busy} disabled={busy || !codeOk(code)} onClick={() => void confirm()}>{busy ? "Checking…" : "Turn on"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setEnrolling(null); void load(); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3"><Button loading={busy} disabled={busy} onClick={() => void start()} data-testid="two-step-start">{busy ? "Starting…" : "Set up two-step sign-in"}</Button></div>
      )}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Card>
  );
}
