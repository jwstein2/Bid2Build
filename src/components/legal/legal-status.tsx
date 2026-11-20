import Link from "next/link";
import { cn } from "@/lib/cn";
import { PUBLIC_STATUS, REVIEW_DISCLOSURE, SHORT_DISCLOSURE, isPendingPublic, legalDate, type LegalStatusRecord } from "@/lib/legal/registry";

/** Small neutral pill: "Current Published Version" + subtitle. Never red, never a modal. */
export function LegalStatusBadge({ record, className }: { record: LegalStatusRecord; className?: string }) {
  const s = PUBLIC_STATUS[record.status];
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5 rounded-full border border-line-strong bg-paper px-2.5 py-0.5 text-xs", className)} data-testid="legal-status-badge" data-status={record.status}>
      <span className="font-semibold text-ink">{s.title}</span>
      <span aria-hidden className="text-muted">·</span>
      <em className="text-ink-soft">{s.subtitle}</em>
    </span>
  );
}

/** The explanatory paragraphs for a status. Pending uses the owner-approved wording verbatim. */
export function disclosureFor(record: LegalStatusRecord): string[] {
  if (isPendingPublic(record.status)) return [...REVIEW_DISCLOSURE];
  const [, revise, encourage] = REVIEW_DISCLOSURE;
  if (record.status === "in_review") return ["This document represents the current published version of Built2Bid LLC's applicable policies, terms, or disclosures and is currently in review by independent legal counsel.", revise, encourage];
  if (record.status === "reviewed") return [`This document represents the current published version of Built2Bid LLC's applicable policies, terms, or disclosures and was reviewed by independent legal counsel${record.reviewCompletedOn ? ` (review completed ${legalDate(record.reviewCompletedOn)})` : ""}.`, revise, encourage];
  return ["This version has been superseded and is kept for reference only. See the current version linked from the Legal Document Status page.", encourage];
}

/**
 * Status block placed under a legal document's title: badge, version, and the disclosure. It sits above
 * the document text and never covers acceptance controls. Prints with the page (Save as PDF).
 */
export function LegalStatusNotice({ record, version, className }: { record: LegalStatusRecord; version?: string; className?: string }) {
  const paras = disclosureFor(record);
  return (
    <section aria-label="Document status" className={cn("rounded-lg border border-line bg-surface px-4 py-3 text-sm", className)} data-testid="legal-status-notice">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Built2Bid LLC</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <LegalStatusBadge record={record} />
        {version && <span className="text-xs text-muted">Version: {version}</span>}
      </div>
      <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
        {paras.map((p) => <p key={p}>{p}</p>)}
        <p className="no-print"><Link href="/legal" className="underline">Legal document status</Link></p>
      </div>
    </section>
  );
}

/**
 * One-line notice for compact spots (sign-in, checkout, acceptance cards). Placed after the existing
 * agreement text, small and muted, linking to /legal. Client-safe.
 */
export function LegalStatusCompact({ className, center }: { className?: string; center?: boolean }) {
  return (
    <p className={cn("text-xs text-muted", center && "text-center", className)} data-testid="legal-status-compact">
      {SHORT_DISCLOSURE} <Link href="/legal" className="underline" target="_blank">Legal document status</Link>
    </p>
  );
}
