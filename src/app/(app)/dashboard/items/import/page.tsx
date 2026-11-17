import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PriceImport } from "@/components/library/price-import";
import { PremiumDiamond } from "@/components/billing/premium";

export const metadata: Metadata = { title: "Import supplier price list", robots: { index: false } };

export default function PriceImportPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-guide-page="library.import">
      <div>
        <Link href="/dashboard/items" className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><ChevronLeft className="h-4 w-4" aria-hidden /> Saved Items &amp; Pricing</Link>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-navy">Import supplier price list <PremiumDiamond className="[&_svg]:h-5 [&_svg]:w-5" /></h1>
        <p className="text-ink-soft">
          Bring your account pricing in from a supplier file. We match rows to your Saved Items by SKU or name, show every change
          before anything is saved, and keep a history you can undo.
        </p>
      </div>
      <PriceImport />
    </div>
  );
}
