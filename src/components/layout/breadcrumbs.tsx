import Link from "next/link";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";

export interface Crumb { label: string; href?: string }

/**
 * Dashboard / Home control for nested screens (V4.3). Desktop: Dashboard › … › current page. Phones:
 * a compact home button plus "back to <parent>". Always the contractor dashboard (never the owner
 * command center).
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const parent = items.slice(0, -1).reverse().find((c) => c.href) ?? { label: "Dashboard", href: "/dashboard" };
  return (
    <nav aria-label="Breadcrumb" className={className} data-testid="breadcrumbs">
      <ol className="hidden flex-wrap items-center gap-1 text-sm md:flex">
        <li><Link href="/dashboard" className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline"><Home className="h-3.5 w-3.5" aria-hidden /> Dashboard</Link></li>
        {items.map((c, i) => (
          <li key={i} className="inline-flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            {c.href && i < items.length - 1 ? <Link href={c.href} className="font-semibold text-accent-ink hover:underline">{c.label}</Link>
              : <span aria-current="page" className="max-w-[22rem] truncate text-ink-soft">{c.label}</span>}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 md:hidden">
        <Link href="/dashboard" aria-label="Dashboard" className="grid h-9 w-9 place-items-center rounded-md border border-line bg-surface text-accent-ink"><Home className="h-4 w-4" aria-hidden /></Link>
        {parent.href && parent.href !== "/dashboard" && <Link href={parent.href} className="inline-flex min-h-9 items-center gap-0.5 text-sm font-semibold text-accent-ink"><ChevronLeft className="h-4 w-4" aria-hidden /> {parent.label}</Link>}
      </div>
    </nav>
  );
}
