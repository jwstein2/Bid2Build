import Link from "next/link";
import type { ReactNode } from "react";
import { Panel, Segmented, fmt } from "./cc";
import { RANGES, href, type RangeKey, type View } from "@/lib/admin/view";
import type { Scoped } from "@/lib/admin/model";

export function ReportUnavailable({ error }: { error: string | null }) {
  return <Panel title="Report unavailable"><p className="text-sm text-ink-soft">The platform data could not be loaded{error ? `: ${error}` : ""}.</p></Panel>;
}

/** 7d / 30d / 90d / 12m switch that keeps the other controls. */
export function RangeControl({ view, path, only }: { view: View; path: string; only?: RangeKey[] }) {
  const keys = (only ?? (Object.keys(RANGES) as RangeKey[]));
  return <Segmented active={view.range.key} options={keys.map((k) => ({ value: k, label: RANGES[k].label, href: href(path, view, { range: k, page: undefined }) }))} />;
}

/** States which accounts the numbers include, so a reader never mistakes test data for customers. */
export function ScopeNote({ sc }: { sc: Scoped }) {
  const parts = (["internal", "test", "demo"] as const).filter((k) => sc.excluded[k]).map((k) => `${fmt(sc.excluded[k])} ${k}`);
  const asOf = <span title={sc.d.loadedAt}>Data as of {new Date(sc.d.loadedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT</span>;
  if (sc.includeTest) return <p className="cc-mono rounded-md border border-[var(--cc-amber)]/50 bg-[rgb(255_181_71/0.06)] px-3 py-2 text-xs text-[var(--cc-amber)]">Diagnostic view: includes {parts.length ? parts.join(", ") : "no"} non-customer account{parts.length ? "s" : "s"}. Business totals below are not customer numbers. · {asOf}</p>;
  return <p className="cc-mono text-[11px] text-muted">{asOf} · Genuine accounts only{parts.length ? <> · excluding {parts.join(", ")} account{sc.excluded.internal + sc.excluded.test + sc.excluded.demo === 1 ? "" : "s"} · <Link href="/admin/customers?cls=all&data=all" className="underline hover:text-white">review labels</Link></> : null}</p>;
}

export function SectionTitle({ id, kicker, title, right }: { id?: string; kicker?: string; title: string; right?: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-wrap items-end justify-between gap-3">
      <div>{kicker && <p className="cc-kicker">{kicker}</p>}<h2 className="mt-0.5 text-lg font-bold text-white">{title}</h2></div>
      {right}
    </div>
  );
}
