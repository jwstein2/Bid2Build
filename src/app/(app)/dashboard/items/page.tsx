import type { Metadata } from "next";
import { LibraryManager } from "@/components/library/library-manager";
import { GenerateEntry } from "@/components/library/generator/generate-entry";
import { PremiumDiamond } from "@/components/billing/premium";
import { ButtonLink } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";

export const metadata: Metadata = { title: "Saved Items & Pricing Library", robots: { index: false } };

export default function ItemsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-guide-page="library.items">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold text-navy">Saved Items &amp; Pricing Library <PremiumDiamond className="[&_svg]:h-5 [&_svg]:w-5" /></h1>
        <p className="text-ink-soft">
          Your own items and standard rates, organized by trade. Add them to any bid from “Suggested &amp; Saved Items”. Saved rates
          fill in automatically and can still be changed on each estimate.
        </p>
        <ButtonLink href="/dashboard/items/import" variant="secondary" size="sm" className="mt-3" data-testid="items-import-link">
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Import supplier price list
        </ButtonLink>
      </div>
      <GenerateEntry />
      <LibraryManager />
    </div>
  );
}
