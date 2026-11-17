import Link from "next/link";
import { Notice } from "@/components/ui/misc";
import type { FinState } from "@/lib/financials/loaders";

/** What Financials shows when it can't show the books (no fake data, no upsell popup). */
export function FinStateNotice({ state }: { state: Exclude<FinState, { kind: "ready" }> }) {
  if (state.kind === "not_installed") return <Notice title="Not available yet">Financials turns on after the database update is installed.</Notice>;
  if (state.kind === "no_book") return <Notice title="Financials isn't set up for your company">Ask your company owner to open Financials once; it sets up your company&apos;s books.</Notice>;
  return (
    <Notice title="Not part of your access">
      Your company owner decides who sees financials. Ask them for a financial seat. <Link href="/dashboard" className="underline">Back to bids</Link>
    </Notice>
  );
}
