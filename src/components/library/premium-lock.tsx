"use client";
import { PremiumUpgrade } from "../billing/premium";
import { Modal } from "../builder/dialogs";
import { FREE_ITEMS_KEPT_NOTE } from "@/lib/library/saved-items";

const keptNote = (n: number) =>
  n > 0 ? `Your ${n === 1 ? "1 saved entry is" : `${n} saved entries are`} kept safe and come back as soon as you upgrade.` : undefined;

/** Locked Saved Items & Pricing screen for free accounts, with the existing Stripe checkout buttons. */
export function LibraryLocked({ lockedCount = 0, signedIn, className, itemsFree }: { lockedCount?: number; signedIn: boolean; className?: string; itemsFree?: boolean }) {
  return <PremiumUpgrade feature="library" signedIn={signedIn} title={itemsFree ? STACKS_TITLE : undefined} note={itemsFree ? `${FREE_ITEMS_KEPT_NOTE}${lockedCount ? ` ${keptNote(lockedCount)}` : ""}` : keptNote(lockedCount)} notNowHref="/dashboard" className={className} />;
}

const STACKS_TITLE = "Saved Stacks, favorites and supplier price lists";

/** Shown when a free account taps Save Item / Save Stack in the builder. */
export function LibraryUpgradeDialog({ open, onOpenChange, signedIn, lockedCount = 0, itemsFree }: { open: boolean; onOpenChange: (o: boolean) => void; signedIn: boolean; lockedCount?: number; itemsFree?: boolean }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Save it to reuse on every bid" description={itemsFree ? "Saved Items are free. Saved Stacks and favorites are part of Built2Bid Unlimited." : "Saving items and stacks to your own library is part of Built2Bid Unlimited."}>
      <PremiumUpgrade feature="library" signedIn={signedIn} title={itemsFree ? STACKS_TITLE : undefined} note={itemsFree ? FREE_ITEMS_KEPT_NOTE : keptNote(lockedCount)} onNotNow={() => onOpenChange(false)} className="border-0 bg-transparent p-0 sm:p-0" />
    </Modal>
  );
}
