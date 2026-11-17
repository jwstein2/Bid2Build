import Link from "next/link";
import { Hourglass, PenLine } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { formatCurrency } from "@/lib/estimate/money";
import { LocalTime } from "@/components/esign/local-time";

export interface AwaitingRow { signature_id: string; estimate_id: string; customer_name: string; project_title: string; total: number | string; signed_at: string; version_number: number }

/**
 * V5.3 notification: customer-signed contracts that need a contractor signature this person may give.
 * Only listed for people the database confirms are authorized to sign each one.
 */
export function AwaitingCountersign({ rows, max = 5 }: { rows: AwaitingRow[]; max?: number }) {
  return (
    <Card className="border-warn/40" aria-labelledby="awaiting-cs-h" data-testid="awaiting-countersign">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warn-tint/60 px-4 py-3">
        <h2 id="awaiting-cs-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy"><Hourglass className="h-5 w-5 text-warn" aria-hidden /> Awaiting Contractor Signature</h2>
        <p className="text-sm text-ink-soft">{rows.length} signed by the customer, waiting for your countersignature</p>
      </div>
      <ul className="divide-y divide-line">
        {rows.slice(0, max).map((r) => (
          <li key={r.signature_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1 max-sm:basis-full">
              <p className="truncate font-semibold">{r.project_title || "Untitled bid"}</p>
              <p className="text-sm text-ink-soft">{r.customer_name} · version {r.version_number} · customer signed <LocalTime iso={r.signed_at} /></p>
            </div>
            <span className="tabular font-bold text-navy">{formatCurrency(String(r.total))}</span>
            <Link href={`/signed/${r.signature_id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-navy hover:bg-accent-hover"><PenLine className="h-4 w-4" aria-hidden /> Review &amp; countersign</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
