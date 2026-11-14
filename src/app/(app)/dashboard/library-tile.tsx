import Link from "next/link";
import { ChevronRight, LayoutTemplate, Library, Lock } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { PremiumDiamond } from "@/components/billing/premium";
import { PREMIUM_FEATURES, type PremiumFeature } from "@/lib/billing/premium-features";

const TILES: Record<PremiumFeature, { href: string; icon: typeof Library; unlockedText: string }> = {
  library: { href: "/dashboard/items", icon: Library, unlockedText: "Your labor rates, material prices and saved stacks, ready for every bid." },
  templates: { href: "/dashboard/templates", icon: LayoutTemplate, unlockedText: "Your default proposal style, wording and payment schedule for new bids." },
};

/**
 * Dashboard tile for an Unlimited feature. Free accounts see what it does and that it is included
 * with Unlimited; the tile still opens the feature page, which shows the upgrade options.
 */
export function PremiumTile({ feature, unlocked }: { feature: PremiumFeature; unlocked: boolean }) {
  const t = TILES[feature];
  const f = PREMIUM_FEATURES[feature];
  const Icon = unlocked ? t.icon : Lock;
  return (
    <Link
      href={t.href}
      aria-label={`${f.title}${unlocked ? "" : " (Unlimited feature)"}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
    >
      <Card className="flex h-full items-center gap-3 p-4 transition-colors group-hover:border-brand/40">
        <span className={unlocked ? "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand" : "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/5 text-muted"}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-display font-bold text-navy">{f.title} <PremiumDiamond /></span>
          <span className="block text-sm text-ink-soft">{unlocked ? t.unlockedText : f.pitch}</span>
          {!unlocked && <span className="mt-1 block text-sm font-semibold text-accent-ink">See Unlimited plans</span>}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Card>
    </Link>
  );
}

export function PremiumTiles({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PremiumTile feature="library" unlocked={unlocked} />
      <PremiumTile feature="templates" unlocked={unlocked} />
    </div>
  );
}
