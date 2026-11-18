"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const PRIMARY = [
  { href: "/academy", label: "Community", match: (p: string) => p === "/academy" || p.startsWith("/academy/post") },
  { href: "/academy/classroom", label: "Classroom", match: (p: string) => p.startsWith("/academy/classroom") || p.startsWith("/academy/courses") },
  { href: "/academy/members", label: "Members", match: (p: string) => p.startsWith("/academy/members") },
  { href: "/academy/leaderboard", label: "Leaderboard", match: (p: string) => p.startsWith("/academy/leaderboard") },
];

/** The four primary Academy tabs (Community first), plus a small secondary menu. */
export function AcademyTabs({ secondary }: { secondary: { href: string; label: string }[] }) {
  const path = usePathname() ?? "/academy";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <nav aria-label="Academy" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" data-testid="academy-tabs">
        {PRIMARY.map((t) => {
          const on = t.match(path);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold sm:px-4 transition-colors duration-(--motion-fast)",
                on ? "bg-navy text-white" : "text-ink-soft hover:bg-brand-tint hover:text-navy")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {secondary.length > 0 && (
        <nav aria-label="Academy more" className="flex shrink-0 gap-1 sm:ml-auto sm:border-l sm:border-line sm:pl-2">
          {secondary.map((s) => (
            <Link key={s.href} href={s.href} aria-current={path.startsWith(s.href) ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold", path.startsWith(s.href) ? "text-navy underline underline-offset-4" : "text-muted hover:text-ink")}>
              {s.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
