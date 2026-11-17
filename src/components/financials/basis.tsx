import { Badge } from "@/components/ui/misc";
import { BASIS_TONE } from "@/lib/financials/ui-labels";

/** Every amount says what it is: Contracted, Invoiced, Paid, Outstanding, Estimated, Committed, Actual or Forecast. */
export function BasisBadge({ basis }: { basis: string }) {
  if (basis === "Count") return null;
  return <Badge tone={BASIS_TONE[basis] ?? "neutral"} className="shrink-0 uppercase tracking-wide text-[10px]">{basis}</Badge>;
}
