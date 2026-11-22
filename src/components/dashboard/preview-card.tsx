/**
 * Summary card with record previews (Home dashboard): the headline metric on top, then the few records behind
 * it, then the "View all" action. Used by Outstanding receivables, Collected, Draft bids and Win rate.
 *
 * The headline, each preview row and the footer action are separate links, so nothing interactive is nested
 * (MetricCard makes its whole card one link, which is why this is its own component). Every destination
 * re-checks the viewer's access on the server: navigation is never authorization. Works in server components.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type PreviewTone = "ok" | "warn" | "danger" | "neutral";

export interface PreviewRow {
  key: string;
  href?: string;
  /** Client, customer or project name (truncates; the full text is the row's tooltip and accessible label). */
  label: string;
  /** Second line: invoice number, dates, project. */
  detail?: string;
  /** Right-hand figure, usually an amount. */
  value?: string;
  /** Small status pill under the value. */
  status?: { text: string; tone: PreviewTone };
}

const VALUE_TONE = { default: "text-navy", ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;
const PILL: Record<PreviewTone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-black/5 text-ink-soft",
};

export function PreviewPill({ text, tone }: { text: string; tone: PreviewTone }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold leading-4", PILL[tone])}>{text}</span>;
}

export function PreviewCard({ title, value, sub, status, tone = "default", empty, href, hint, action, testId, extra, rows, emptyText, more, explain }: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  tone?: keyof typeof VALUE_TONE;
  /** Mutes the headline (a zero that is still clickable). */
  empty?: boolean;
  /** Where the headline and the footer action go (the existing "View all" route). */
  href: string;
  hint?: string;
  /** Footer action text, e.g. "View invoices". */
  action: string;
  testId?: string;
  /** Between the headline and the rows (e.g. the win / loss bar). */
  extra?: ReactNode;
  rows: PreviewRow[];
  /** One calm line shown when there are no rows. */
  emptyText: string;
  /** "+ N more" count after the shown rows. */
  more?: number;
  /** Plain-language "How it's calculated" note, behind a small disclosure (keyboard and touch friendly). */
  explain?: ReactNode;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card" aria-label={title} data-testid={testId} data-preview-card="">
      <Link href={href} prefetch={false} title={hint} data-metric-href={href}
        className="preview-head block rounded-t-xl px-4 pt-4 pb-2 transition-colors hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus active:bg-black/5">
        <span className="metric-head flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-ink-soft">{title}</span>
          {status}
        </span>
        <span className={cn("metric-value tabular mt-1 block truncate font-display text-3xl font-extrabold", empty ? "text-muted" : VALUE_TONE[tone])}>{value}</span>
        {sub && <span className="mt-0.5 block text-xs leading-snug text-muted">{sub}</span>}
      </Link>
      {explain && (
        <details className="group/explain mx-4 mb-2 text-[11px] text-muted" data-testid={testId ? `${testId}-explain` : undefined}>
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded font-semibold hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
            <Info className="h-3 w-3 shrink-0" aria-hidden />How it&apos;s calculated
          </summary>
          <p className="mt-1 rounded-md bg-black/[0.03] px-2 py-1.5 leading-snug text-ink-soft">{explain}</p>
        </details>
      )}
      {extra && <div className="px-4 pb-2">{extra}</div>}
      {rows.length ? (
        <ul className="mx-2 divide-y divide-line border-t border-line" data-testid={testId ? `${testId}-rows` : undefined}>
          {rows.map((r) => <PreviewItem key={r.key} row={r} />)}
        </ul>
      ) : (
        <p className="mx-4 border-t border-line py-2.5 text-xs text-ink-soft" data-testid={testId ? `${testId}-empty` : undefined}>{emptyText}</p>
      )}
      <Link href={href} prefetch={false}
        className="group mt-auto flex min-h-10 items-center gap-1 rounded-b-xl px-4 pt-1 pb-3 text-[11px] font-semibold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus">
        <span className="min-w-0 leading-snug">{action}{more ? <span className="font-normal text-muted"> · {more} more</span> : null}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </Link>
    </section>
  );
}

function PreviewItem({ row }: { row: PreviewRow }) {
  const label = [row.label, row.detail, row.value, row.status?.text].filter(Boolean).join(", ");
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{row.label}</span>
        {row.detail && <span className="block truncate text-xs text-muted">{row.detail}</span>}
      </span>
      {(row.value || row.status) && (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {row.value && <span className="tabular text-sm font-semibold text-ink">{row.value}</span>}
          {row.status && <PreviewPill {...row.status} />}
        </span>
      )}
    </>
  );
  const cls = "flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5";
  return (
    <li>
      {row.href
        ? <Link href={row.href} prefetch={false} title={label} aria-label={label}
            className={cn(cls, "transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-focus active:bg-black/10")}>{body}</Link>
        : <div className={cls} title={label}>{body}</div>}
    </li>
  );
}

/** Compact won / lost bar for the Win rate card. Green for won, muted red for lost. */
export function WinLossBar({ won, lost }: { won: number; lost: number }) {
  const total = won + lost;
  const pct = total ? (won / total) * 100 : 0;
  return (
    <div data-testid="win-loss-bar">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/5" role="img" aria-label={total ? `${won} won, ${lost} lost` : "No decided bids yet"}>
        {total > 0 && <span className="h-full bg-teal" style={{ width: `${pct}%` }} />}
        {total > 0 && <span className="h-full bg-danger/35" style={{ width: `${100 - pct}%` }} />}
      </div>
    </div>
  );
}

/** Placeholder with the same shape as a PreviewCard, for cards still loading. */
export function PreviewSkeleton({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 shadow-card" aria-busy="true" aria-label={`${title}, loading`}>
      <p className="text-sm font-semibold text-ink-soft">{title}</p>
      <span className="mt-2 block h-7 w-24 animate-pulse rounded bg-black/10" />
      <span className="mt-1.5 block h-3 w-32 animate-pulse rounded bg-black/5" />
      <ul className="mt-3 space-y-2 border-t border-line pt-2.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex-1 space-y-1"><span className="block h-3 w-3/4 animate-pulse rounded bg-black/10" /><span className="block h-2.5 w-1/2 animate-pulse rounded bg-black/5" /></span>
            <span className="h-3 w-12 animate-pulse rounded bg-black/10" />
          </li>
        ))}
      </ul>
    </div>
  );
}
