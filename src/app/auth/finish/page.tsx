"use client";
import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/http/redirect";

/** Completes sign-in from an email link whose session arrives in the URL fragment. */
export default function FinishSignIn() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNext(query.get("next"));
    const fail = () => window.location.replace(`/login?error=link&next=${encodeURIComponent(next)}`);
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    const supabase = getBrowserClient();
    // Drop the tokens from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!supabase || !access_token || !refresh_token) { fail(); return; }
    supabase.auth.setSession({ access_token, refresh_token }).then(async ({ error }: { error: unknown }) => {
      if (error) { fail(); return; }
      if (query.get("marketing") === "1") {
        await fetch("/api/account/marketing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optIn: true }) }).catch(() => {});
      }
      window.location.replace(next);
    });
  }, []);
  return (
    <main id="main" className="flex min-h-[60vh] items-center justify-center px-4">
      <p className="text-sm text-muted" role="status">Signing you in…</p>
    </main>
  );
}
