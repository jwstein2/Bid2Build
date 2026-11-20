/**
 * Clickable metric cards: the one place the KPI-card interaction lives (Built2Bid UX standard: every
 * dashboard number opens the records behind it in one click).
 *
 * - `href`: the whole card is a link to the filtered records (full-page view, URL keeps the filters).
 * - `drawer`: the whole card is a button that opens a side drawer (small lists, metric calculations).
 * - neither: a static card (use only for numbers with nothing behind them).
 *
 * Interaction (pointer cursor, hover, pressed, focus ring, arrow) comes from the .metric-action class in
 * globals.css, so the owner theme (.cc) and the customer Light / Dark / Black themes share it. Never put
 * another link or button inside an actionable card. Works in server and client components.
 *
 * Navigation is never authorization: every destination re-checks the viewer's access on the server.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { MetricDrawer } from "./metric-drawer";

export interface MetricDrawerSpec { id: string; title: string; description?: string; body: ReactNode }

export interface MetricActionProps {
  /** Destination for the filtered records. */
  href?: string;
  /** Quick-inspection drawer (used instead of href). */
  drawer?: MetricDrawerSpec;
  /** Short destination text, e.g. "View active grants". Shown on the card and read by screen readers. */
  action?: string;
  /**
   * Client-side filter on the same screen (client components only). The caller updates the URL so Back
   * and refresh restore the view. `pressed` marks the card whose filter is applied.
   */
  onSelect?: () => void;
  pressed?: boolean;
}

/** The interactive shell. Renders a Link, a drawer button, or a plain div. */
export function MetricShell({ href, drawer, action, onSelect, pressed, className, children, testId, title }: MetricActionProps & { className?: string; children: ReactNode; testId?: string; title?: string }) {
  const actionable = Boolean(href || drawer || onSelect);
  const cls = cn("flex h-full min-w-0 flex-col text-left", actionable && "metric-action group", className);
  const cta = actionable ? <MetricCta drawer={Boolean(drawer) && !href} label={action} /> : null;
  if (href) return <Link href={href} className={cls} data-testid={testId} data-metric-href={href} title={title} prefetch={false}>{children}{cta}</Link>;
  if (onSelect) return <button type="button" onClick={onSelect} aria-pressed={pressed} className={cn(cls, pressed && "metric-pressed")} data-testid={testId} title={title}>{children}{cta}</button>;
  if (drawer) return <MetricDrawer id={drawer.id} title={drawer.title} description={drawer.description} body={drawer.body} className={cls} testId={testId}>{children}{cta}</MetricDrawer>;
  return <div className={cls} data-testid={testId} title={title}>{children}</div>;
}

/** Destination line at the bottom of an actionable card. */
export function MetricCta({ label, drawer }: { label?: string; drawer?: boolean }) {
  const Icon = drawer ? PanelRightOpen : ArrowRight;
  return (
    <span className="metric-cta mt-auto flex items-center gap-1 pt-2 text-[11px] font-semibold">
      <span className="min-w-0 leading-snug">{label ?? (drawer ? "Show details" : "View records")}</span>
      <Icon className="metric-arrow h-3.5 w-3.5 shrink-0" aria-hidden />
    </span>
  );
}

export interface MetricCardProps extends MetricActionProps {
  title: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Top-right slot: a status badge or delta. */
  status?: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
  /** Shows a skeleton instead of the value. */
  loading?: boolean;
  /** Mutes the value (e.g. a zero that is still clickable). */
  empty?: boolean;
  size?: "md" | "sm";
  className?: string;
  testId?: string;
  /** Native tooltip with the metric definition. */
  hint?: string;
  children?: ReactNode;
}

const TONE = { default: "text-navy", ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** Customer-app (and light admin) metric card on the shared tokens: Light, Dark and Black themes. */
export function MetricCard({ title, value, sub, status, tone = "default", loading, empty, size = "md", className, testId, hint, children, ...action }: MetricCardProps) {
  return (
    <MetricShell {...action} testId={testId} title={hint}
      className={cn("rounded-xl border border-line bg-surface shadow-card", size === "sm" ? "p-3" : "p-4", className)}>
      <span className="metric-head flex items-start justify-between gap-2">
        <span className={cn("font-semibold text-ink-soft", size === "sm" ? "text-xs" : "text-sm")}>{title}</span>
        {status}
      </span>
      {loading
        ? <span className="mt-2 block h-7 w-20 animate-pulse rounded bg-black/10" aria-label="Loading" />
        : <span className={cn("metric-value tabular mt-1 block truncate font-display font-extrabold", size === "sm" ? "text-xl" : "text-3xl", empty ? "text-muted" : TONE[tone])}>{value}</span>}
      {sub && <span className={cn("mt-0.5 block leading-snug text-muted", size === "sm" ? "text-[11px]" : "text-xs")}>{sub}</span>}
      {children}
    </MetricShell>
  );
}

/** Drawer body helpers: a formula, a short record list, and an empty state with an optional next step. */
export function MetricFormula({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-paper p-3 text-sm"><p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">How it&apos;s calculated</p>{children}</div>;
}

export interface MetricRecord { key: string; label: ReactNode; detail?: ReactNode; value?: ReactNode; href?: string }

export function MetricRecords({ title, rows, empty, more }: { title?: string; rows: MetricRecord[]; empty: ReactNode; more?: { href: string; label: string } }) {
  return (
    <div>
      {title && <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{title}</p>}
      {rows.length === 0 ? <MetricEmpty>{empty}</MetricEmpty> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.label}</span>{r.detail && <span className="block truncate text-xs text-muted">{r.detail}</span>}</span>
                {r.value !== undefined && <span className="tabular shrink-0 font-semibold">{r.value}</span>}
              </>
            );
            return <li key={r.key}>{r.href ? <Link href={r.href} className="flex items-center gap-3 px-3 py-2 hover:bg-black/5">{inner}</Link> : <div className="flex items-center gap-3 px-3 py-2">{inner}</div>}</li>;
          })}
        </ul>
      )}
      {more && <Link href={more.href} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink underline">{more.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>}
    </div>
  );
}

export function MetricEmpty({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-ink-soft" data-testid="metric-empty">
      <p>{children}</p>
      {action && <Link href={action.href} className="mt-2 inline-flex items-center gap-1 font-semibold text-accent-ink underline">{action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>}
    </div>
  );
}
