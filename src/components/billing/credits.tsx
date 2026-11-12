"use client";
import Link from "next/link";
import { CalendarClock, Infinity as InfinityIcon, Layers } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCycleDate, monthlyHint, type CreditStatus } from "@/lib/credits/status";
import { Card } from "../ui/misc";

/** Subtle, always-available upgrade entry point. Never a popup. */
export function UpgradeLink({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/pricing"
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-3 text-sm font-semibold text-accent-ink transition-colors hover:border-accent hover:bg-accent-tint",
        className,
      )}
    >
      <InfinityIcon className="h-4 w-4" aria-hidden />
      {compact ? <><span className="sm:hidden">Upgrade</span><span className="hidden sm:inline">Upgrade to Unlimited</span></> : "Upgrade to Unlimited"}
    </Link>
  );
}

function Tile({ icon, label, value, total, note, tone }: { icon: React.ReactNode; label: string; value: number; total: number; note: string; tone: "cyan" | "teal" }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{icon}{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold text-navy tabular">
        {value} <span className="text-sm font-semibold text-muted">of {total}</span>
      </p>
      <div className="mt-1.5 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < value ? (tone === "cyan" ? "bg-accent" : "bg-teal") : "bg-black/10")} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-soft" suppressHydrationWarning>{note}</p>
    </div>
  );
}

/** Dashboard / billing card: starter and monthly balances shown separately. */
export function CreditBalances({ credits, className, showUpgrade = true }: { credits: CreditStatus; className?: string; showUpgrade?: boolean }) {
  if (credits.unlimited) {
    return (
      <Card className={cn("p-4", className)}>
        <p className="text-sm text-muted">Plan</p>
        <p className="flex items-center gap-2 text-2xl font-extrabold text-ok"><InfinityIcon className="h-6 w-6" aria-hidden /> Unlimited</p>
        <p className="mt-1 text-xs text-muted">Finalize as many bids as you like. Your free credits are kept if you ever switch back.</p>
      </Card>
    );
  }
  const empty = credits.starter + credits.monthly === 0;
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Free bid credits</p>
          <p className="text-xs text-muted">One credit finalizes one new bid. Updates and re-downloads are free.</p>
        </div>
        {showUpgrade && <UpgradeLink className="hidden shrink-0 sm:inline-flex" />}
      </div>
      {!credits.emailVerified ? (
        <p className="mt-3 rounded-lg bg-warn-tint px-3 py-2 text-sm text-ink-soft">Verify your email to unlock your {credits.starterTotal} starter credits.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Tile icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />} label="Monthly" value={credits.monthly} total={1} tone="cyan" note={monthlyHint(credits)} />
          <Tile icon={<Layers className="h-3.5 w-3.5" aria-hidden />} label="Starter" value={credits.starter} total={credits.starterTotal} tone="teal" note={credits.starter > 0 ? "Never expire. Used after your monthly bid." : "All starter credits used."} />
        </div>
      )}
      {empty && credits.emailVerified && (
        <p className="mt-3 text-sm text-ink-soft" suppressHydrationWarning>
          Out of free credits. Drafts and previews still work. <Link href="/pricing" className="font-semibold text-accent-ink underline">Go Unlimited</Link> or wait for your next free bid on {formatCycleDate(credits.nextCycleAt, { month: "long", day: "numeric" })}.
        </p>
      )}
      {showUpgrade && <UpgradeLink className="mt-3 w-full justify-center sm:hidden" />}
    </Card>
  );
}

/** One-line balance for tight spaces such as the builder header. */
export function CreditSummary({ credits }: { credits: CreditStatus }) {
  if (credits.unlimited) return <span className="text-[11px] text-ok">Unlimited plan</span>;
  return (
    <span className="text-[11px] text-muted tabular" title={monthlyHint(credits)}>
      Monthly {credits.monthly} · Starter {credits.starter}
    </span>
  );
}
