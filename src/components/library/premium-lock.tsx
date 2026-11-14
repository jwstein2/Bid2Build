"use client";
import { Lock } from "lucide-react";
import { LIBRARY_LOCKED_MESSAGE } from "@/lib/library/saved-items";
import { CheckoutButton } from "../billing/checkout-button";
import { Modal } from "../builder/dialogs";
import { cn } from "@/lib/cn";

/** Locked Saved Items panel for free accounts, with the existing Stripe checkout buttons. */
export function LibraryLocked({ lockedCount = 0, signedIn, className }: { lockedCount?: number; signedIn: boolean; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-paper p-4 sm:p-5", className)}>
      <p className="flex items-center gap-2 font-display font-bold text-navy"><Lock className="h-4 w-4 text-accent-ink" aria-hidden /> Premium Only</p>
      <p className="mt-1 text-sm text-ink-soft">{LIBRARY_LOCKED_MESSAGE.replace(/^Premium Only — /, "")}</p>
      {lockedCount > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          Your {lockedCount === 1 ? "1 saved entry is" : `${lockedCount} saved entries are`} kept safe and come back as soon as you upgrade.
        </p>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CheckoutButton plan="monthly" signedIn={signedIn} label="Upgrade to Unlimited" />
        <CheckoutButton plan="annual" signedIn={signedIn} label="Go Annual and save" variant="secondary" />
      </div>
    </div>
  );
}

/** Shown when a free account taps Save Item / Save Stack in the builder. */
export function LibraryUpgradeDialog({ open, onOpenChange, signedIn, lockedCount }: { open: boolean; onOpenChange: (o: boolean) => void; signedIn: boolean; lockedCount?: number }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Saved Items & Pricing Library" description="Reuse your own items and rates on every bid.">
      <LibraryLocked signedIn={signedIn} lockedCount={lockedCount} className="border-0 p-0 sm:p-0 bg-transparent" />
    </Modal>
  );
}
