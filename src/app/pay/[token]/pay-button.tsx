"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Starts Stripe Checkout on the contractor's account and sends the customer there. */
export function PayButton({ token, amount, label, method = "any", state, variant = "primary", testId = "pay-invoice" }:
  { token: string; amount: string; label?: string; method?: "any" | "card" | "ach"; state?: string | null; variant?: "primary" | "secondary"; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, ...(state ? { state } : {}) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data?.error?.message ?? "We couldn't start the payment. Please try again.");
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message); setBusy(false);
    }
  }
  return (
    <div>
      <Button loading={busy} size="lg" variant={variant} className="w-full sm:w-auto" onClick={go} disabled={busy} data-testid={testId}>{busy ? "Opening secure payment…" : label ?? `Pay ${amount}`}</Button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
