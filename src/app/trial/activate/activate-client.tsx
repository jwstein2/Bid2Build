"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { EXPIRY_FORMAT } from "@/lib/trial/text";

const KEY = "b2b_trial_invite";

const REASONS: Record<string, string> = {
  invalid: "This invite link isn't valid anymore. Ask for a new one in the Built2Bid Messenger chat, or email support@built2bid.org.",
  invite_expired: "This invite expired. Send your email again in the Built2Bid Messenger chat and we'll send a fresh link.",
  email_unverified: "Please confirm your email address first: sign out, then sign in again with the 6-digit code we email you.",
  already_has_access: "Good news: your account already has Unlimited access, so there's nothing to activate. Your current plan stays exactly as it is.",
  already_used: "This account has already used its free week.",
  error: "Something went wrong on our side. Please try again in a minute.",
};

/** signedInAs: verified email when signed in, null when signed in without a verified email, undefined when signed out. */
export function ActivateTrial({ signedInAs }: { signedInAs: string | null | undefined }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; expiresAt: string } | { ok: false; reason: string; hint?: string | null } | null>(null);

  // Read the token from the fragment, keep it for the sign-in round trip, and strip it from the address bar.
  useEffect(() => {
    let t: string | null = null;
    const m = window.location.hash.match(/(?:^#|&)t=([A-Za-z0-9._-]{20,200})/);
    if (m) {
      t = m[1];
      try { sessionStorage.setItem(KEY, t); } catch { /* private mode: token stays in memory */ }
      history.replaceState(null, "", window.location.pathname);
    } else {
      try { t = sessionStorage.getItem(KEY); } catch { t = null; }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setToken(t);
    setReady(true);
  }, []);

  async function activate() {
    if (!token || busy) return;
    setBusy(true);
    const r = await fetch("/api/trial/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { ok?: boolean; expiresAt?: string; reason?: string; hint?: string | null; error?: { code?: string } } | null;
    setBusy(false);
    if (body?.ok && body.expiresAt) {
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      setResult({ ok: true, expiresAt: body.expiresAt });
    } else {
      setResult({ ok: false, reason: body?.reason ?? (body?.error?.code === "not_authenticated" ? "signin" : "error"), hint: body?.hint });
    }
  }

  if (!ready) return <p className="mt-6 text-ink-soft">Loading…</p>;

  if (result?.ok) {
    const when = new Date(result.expiresAt).toLocaleString(undefined, EXPIRY_FORMAT);
    return (
      <>
        <h1 className="mt-6 font-display text-2xl font-extrabold">Your free week is on</h1>
        <p className="mt-2 text-ink-soft">Built2Bid Unlimited is active until <strong>{when}</strong>. No card is on file and nothing will be charged.</p>
        <p className="mt-3 text-sm text-muted">When it ends your account goes back to its normal plan. Your bids, customers and any remaining free credits stay right where they are.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href="/bids" variant="accent">Create a bid</ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">Go to dashboard</ButtonLink>
        </div>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <h1 className="mt-6 font-display text-2xl font-extrabold">Activate your free week</h1>
        <Notice tone="warn" className="mt-4">Open this page from the button in your Built2Bid invite email. Lost it? Send your email again in the Built2Bid Messenger chat for a fresh one.</Notice>
      </>
    );
  }

  return (
    <>
      <h1 className="mt-6 font-display text-2xl font-extrabold">Activate 7 free days of Unlimited</h1>
      <p className="mt-2 text-ink-soft">Unlimited bids, Saved Items &amp; Pricing, and Proposal Templates. Your 7 days start when you tap Activate. No card, no automatic charge.</p>
      {signedInAs === undefined ? (
        <>
          <p className="mt-4 text-sm text-ink-soft">First, sign in or create your free account with the email address the invite was sent to. We&apos;ll email you a 6-digit code.</p>
          <div className="mt-6"><ButtonLink href={`/login?next=${encodeURIComponent("/trial/activate")}`} variant="accent">Sign in to activate</ButtonLink></div>
        </>
      ) : (
        <>
          {signedInAs && <p className="mt-4 text-sm text-ink-soft">Signed in as <strong>{signedInAs}</strong>.</p>}
          {result && !result.ok && (
            <Notice tone="warn" className="mt-4">
              {result.reason === "email_mismatch"
                ? `This invite was sent to ${result.hint ?? "a different email"}. Sign out and sign in with that address to activate it.`
                : result.reason === "signin" ? "Your session ended. Please sign in again." : REASONS[result.reason] ?? REASONS.error}
            </Notice>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!(result && !result.ok && ["already_has_access", "already_used", "invalid", "invite_expired"].includes(result.reason)) && (
              <Button type="button" variant="accent" onClick={activate} disabled={busy}>{busy ? "Activating…" : "Activate my 7 days"}</Button>
            )}
            <form action="/auth/signout" method="post" className="text-sm text-ink-soft"><button type="submit" className="underline">Use a different account</button></form>
          </div>
        </>
      )}
    </>
  );
}
