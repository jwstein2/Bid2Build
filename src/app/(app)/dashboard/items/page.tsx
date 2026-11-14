import type { Metadata } from "next";
import { LibraryManager } from "@/components/library/library-manager";

export const metadata: Metadata = { title: "Saved Items & Pricing Library", robots: { index: false } };

export default function ItemsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-navy">Saved Items &amp; Pricing Library</h1>
        <p className="text-ink-soft">
          Your own items and standard rates, organized by trade. Add them to any bid from “Suggested &amp; Saved Items”. Saved rates
          fill in automatically and can still be changed on each estimate.
        </p>
      </div>
      <LibraryManager />
    </div>
  );
}
