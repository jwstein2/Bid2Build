"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const PRIMARY: Tab[] = [
  { href: "/academy", label: "Community", match: (p: string) => p === "/academy" || p.startsWith("/academy/post") },
  { href: "/academy/classroom", label: "Classroom", match: (p: string) => p.startsWith("/academy/classroom") || p.startsWith("/academy/courses") },
  { href: "/academy/members", label: "Members", match: (p: string) => p.startsWith("/academy/members") },
  { href: "/academy/leaderboard", label: "Leaderboard", short: "Leaders", match: (p: string) => p.startsWith("/academy/leaderboard") },
];

type Tab = { href: string; label: string; short?: string; match: (p: string) => boolean };
const CODES: Tab = { href: "/academy/codes", label: "Codes", match: (p: string) => p.startsWith("/academy/codes") };
const START: Tab = { href: "/academy/start", label: "Start a business", short: "Start", match: (p: string) => p.startsWith("/academy/start") };
const STUDY: Tab = { href: "/academy/study", label: "Study", match: (p: string) => p.startsWith("/academy/study") };

/** The primary Academy tabs (Community first, Start a business always; Codes and Study once the code library is on), plus a small secondary menu. */
export function AcademyTabs({ secondary, codes = false }: { secondary: { href: string; label: string }[]; codes?: boolean }) {
  const path = usePathname() ?? "/academy";
  const tabs = codes ? [...PRIMARY.slice(0, 2), START, CODES, STUDY, ...PRIMARY.slice(2)] : [...PRIMARY.slice(0, 2), START, ...PRIMARY.slice(2)];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <nav aria-label="Academy" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" data-testid="academy-tabs">
        {tabs.map((t) => {
          const on = t.match(path);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full px-2.5 py-2 text-[13px] font-semibold sm:px-4 sm:text-sm transition-colors duration-(--motion-fast)",
                on ? "bg-navy text-white" : "text-ink-soft hover:bg-brand-tint hover:text-navy")}>
              {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
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
