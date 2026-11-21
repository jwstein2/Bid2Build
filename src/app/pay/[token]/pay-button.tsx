"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Starts Stripe Checkout on the contractor's account and sends the customer there. */
export function PayButton({ token, amount }: { token: string; amount: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data?.error?.message ?? "We couldn't start the payment. Please try again.");
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message); setBusy(false);
    }
  }
  return (
    <div>
      <Button size="lg" className="w-full sm:w-auto" onClick={go} disabled={busy} data-testid="pay-invoice">{busy ? "Opening secure payment…" : `Pay ${amount}`}</Button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
