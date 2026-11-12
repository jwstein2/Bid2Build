import type { Metadata } from "next";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { PROVIDER_CATALOG, UNAVAILABLE_MESSAGE } from "@/lib/pricing/provider";

export const metadata: Metadata = { title: "Pricing data", robots: { index: false } };

export default function PricingSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Regional pricing data</h1>
        <p className="mt-1 text-ink-soft">Optional reference prices shown next to your own cost. We only show prices from licensed or authorized sources, always with the source, region, unit, and date.</p>
      </div>
      <Notice tone="neutral" title="Currently">{UNAVAILABLE_MESSAGE} Your own costs drive every price on your proposals.</Notice>
      <div className="space-y-3">
        {PROVIDER_CATALOG.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{p.name}</p>
              <Badge>Not connected</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{p.notes}</p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted">Want a specific supplier or dataset? Contact support; integrations are enabled after licensing is confirmed.</p>
    </div>
  );
}
