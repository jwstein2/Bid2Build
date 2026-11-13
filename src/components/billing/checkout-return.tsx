"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearIntent } from "@/lib/billing/checkout-intent";

/** Payment finished on Stripe: the pending selection is done with. */
export function ClearCheckoutIntent() {
  useEffect(() => { clearIntent(); }, []);
  return null;
}

/**
 * Shown after Stripe returns before the webhook has confirmed the subscription.
 * Re-checks every few seconds (the page reconciles with Stripe on each load); access is only granted
 * once Stripe confirms, never because of this redirect.
 */
export function ConfirmingPayment({ planName }: { planName: string }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const max = 10;
  useEffect(() => {
    if (tries >= max) return;
    const t = setTimeout(() => { router.refresh(); setTries((n) => n + 1); }, 3000);
    return () => clearTimeout(t);
  }, [tries, router]);
  const waiting = tries < max;
  return (
    <div role="status" className="rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">{waiting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{waiting ? `Confirming your ${planName} payment…` : "Still confirming your payment"}</p>
      <p className="mt-1 text-ink-soft">
        {waiting
          ? "Stripe usually confirms within a few seconds. This page updates on its own. Unlimited turns on as soon as Stripe confirms."
          : "Stripe hasn't confirmed yet. You won't be charged twice. Refresh in a minute, and check your email for Stripe's receipt."}
      </p>
      {!waiting && <button type="button" className="mt-2 min-h-11 font-semibold text-brand underline" onClick={() => setTries(0)}>Check again</button>}
    </div>
  );
}
