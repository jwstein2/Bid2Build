"use client";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { safeNext } from "@/lib/http/redirect";
import { getBrowserClient } from "@/lib/supabase/client";

/** Where to go after this step: same-site path only (safeNext, then an explicit same-origin check). */
function nextPath(): string {
  const u = new URL(safeNext(new URLSearchParams(window.location.search).get("next")), window.location.origin);
  return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : "/dashboard";
}

/** Second sign-in step for people who turned on two-step sign-in: the 6-digit code from their authenticator app. */
export default function TwoStepChallenge() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    void (async () => {
      if (!supabase) { setState("none"); return; }
      const next = nextPath();
      const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!lvl?.currentLevel) { window.location.replace(`/login?next=${encodeURIComponent(next)}`); return; }
      if (lvl.currentLevel === "aal2" || lvl.nextLevel !== "aal2") { window.location.replace(next); return; }
      const { data } = await supabase.auth.mfa.listFactors();
      const f = data?.totp?.find((x: { status: string }) => x.status === "verified");
      if (!f) { setState("none"); return; }
      setFactorId(f.id); setState("ready");
    })();
  }, []);

  async function submit() {
    const supabase = getBrowserClient();
    if (!supabase || !factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) { setBusy(false); setErr("That code didn't match. Enter the newest 6-digit code from your authenticator app."); setCode(""); return; }
    window.location.replace(nextPath());
  }

  return (
    <main id="main" className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <h1 className="flex items-center gap-2 text-xl font-extrabold"><ShieldCheck className="h-6 w-6 text-brand" aria-hidden /> Two-step sign-in</h1>
        {state === "loading" && <p className="text-sm text-muted" role="status">Checking your sign-in…</p>}
        {state === "none" && <div className="text-sm text-ink-soft">No authenticator is set up on this account. <form action="/auth/signout" method="post" className="inline"><button type="submit" className="underline">Sign out</button></form> and sign in again.</div>}
        {state === "ready" && (
          <>
            <p className="text-sm text-ink-soft">Enter the 6-digit code from your authenticator app.</p>
            <input className="field w-full text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} aria-label="6-digit code"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} data-testid="mfa-code" />
            {err && <Notice tone="danger">{err}</Notice>}
            <Button loading={busy} className="w-full" disabled={busy || code.length !== 6} onClick={() => void submit()}>{busy ? "Checking…" : "Continue"}</Button>
            <div className="text-xs text-muted">Lost your phone? Email support from the address on your account. <form action="/auth/signout" method="post" className="inline"><button type="submit" className="underline">Sign out</button></form></div>
          </>
        )}
      </Card>
    </main>
  );
}
