"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";

export function CheckoutButton({ plan, signedIn, label, variant = "accent", className }: { plan: "monthly" | "annual"; signedIn: boolean; label: string; variant?: "accent" | "primary" | "secondary"; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!signedIn) { window.location.assign(`/login?next=${encodeURIComponent(`/pricing?upgrade=${plan}`)}`); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
      const d = await r.json();
      if (r.ok && d.url) window.location.assign(d.url);
      else if (d?.error?.code === "already_subscribed") window.location.assign("/settings/billing");
      else setErr(d?.error?.message ?? "Checkout is unavailable right now.");
    } catch { setErr("Checkout is unavailable right now."); }
    finally { setBusy(false); }
  }
  return (
    <div className={className}>
      <Button variant={variant} size="lg" className="w-full" onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{label}</Button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}

export function PortalButton({ label = "Manage subscription" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/stripe/portal", { method: "POST" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (r?.ok && d?.url) window.location.assign(d.url);
    else { setErr(d?.error?.message ?? "Billing portal unavailable."); setBusy(false); }
  }
  return (
    <div>
      <Button variant="secondary" onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{label}</Button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
