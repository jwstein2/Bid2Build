"use client";
import { PremiumUpgrade } from "../billing/premium";
import { Modal } from "../builder/dialogs";

const keptNote = (n: number) =>
  n > 0 ? `Your ${n === 1 ? "1 saved entry is" : `${n} saved entries are`} kept safe and come back as soon as you upgrade.` : undefined;

/** Locked Saved Items & Pricing screen for free accounts, with the existing Stripe checkout buttons. */
export function LibraryLocked({ lockedCount = 0, signedIn, className }: { lockedCount?: number; signedIn: boolean; className?: string }) {
  return <PremiumUpgrade feature="library" signedIn={signedIn} note={keptNote(lockedCount)} notNowHref="/dashboard" className={className} />;
}

/** Shown when a free account taps Save Item / Save Stack in the builder. */
export function LibraryUpgradeDialog({ open, onOpenChange, signedIn, lockedCount = 0 }: { open: boolean; onOpenChange: (o: boolean) => void; signedIn: boolean; lockedCount?: number }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Save it to reuse on every bid" description="Saving items and stacks to your own library is part of Built2Bid Unlimited.">
      <PremiumUpgrade feature="library" signedIn={signedIn} note={keptNote(lockedCount)} onNotNow={() => onOpenChange(false)} className="border-0 bg-transparent p-0 sm:p-0" />
    </Modal>
  );
}
