import Link from "next/link";
import { ChevronRight, Library, Lock } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { UpgradeLink } from "@/components/billing/credits";
import { LIBRARY_LOCKED_MESSAGE } from "@/lib/library/saved-items";

/** Dashboard tile for the premium Saved Items & Pricing Library (locked on free accounts). */
export function LibraryTile({ unlocked }: { unlocked: boolean }) {
  if (unlocked) {
    return (
      <Link href="/dashboard/items" className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
        <Card className="flex items-center gap-3 p-4 transition-colors group-hover:border-brand/40">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand"><Library className="h-5 w-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-bold text-navy">Saved Items &amp; Pricing Library</span>
            <span className="block text-sm text-ink-soft">Your labor rates, material prices and saved stacks, ready for every bid.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        </Card>
      </Link>
    );
  }
  return (
    <section aria-label="Saved Items & Pricing Library (Premium only)">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/5 text-muted"><Lock className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1 basis-56">
          <span className="block font-display font-bold text-navy">Saved Items &amp; Pricing Library</span>
          <span className="block text-sm text-ink-soft">{LIBRARY_LOCKED_MESSAGE}</span>
        </span>
        <UpgradeLink />
      </Card>
    </section>
  );
}
