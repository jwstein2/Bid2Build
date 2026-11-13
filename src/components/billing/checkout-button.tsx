"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import type { PlanId } from "@/lib/billing/plans";
import { resumePath, saveIntent } from "@/lib/billing/checkout-intent";
import { startCheckout } from "@/lib/billing/start-checkout";
import { useCheckoutFlow } from "./checkout-context";

/**
 * Starts checkout for an approved plan id. On the pricing page it hands off to the checkout flow
 * (verification modal + automatic resume). Elsewhere signed-out visitors go through /login, which
 * returns to /pricing?resume=<plan> so checkout continues without choosing again.
 */
export function CheckoutButton({ plan, signedIn, label, variant = "accent", className }: { plan: PlanId; signedIn: boolean; label: string; variant?: "accent" | "primary" | "secondary"; className?: string }) {
  const flow = useCheckoutFlow();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Coming back from Stripe with the Back button restores this page from cache mid-"busy".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusy(false); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function go() {
    if (flow) { flow.choose(plan); return; }
    saveIntent(plan);
    if (!signedIn) { router.push(`/login?next=${encodeURIComponent(resumePath(plan))}`); return; }
    setBusy(true); setErr(null);
    const r = await startCheckout(plan);
    if (r.kind === "redirecting") return;
    setBusy(false);
    if (r.kind === "already_subscribed") router.push("/settings/billing?notice=already_subscribed");
    else if (r.kind === "signed_out") router.push(`/login?next=${encodeURIComponent(resumePath(plan))}`);
    else if (r.kind === "busy") setErr("Checkout is already opening in another tab.");
    else setErr(r.message);
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
