import Link from "next/link";
import { Bot, BriefcaseBusiness, Calculator, CalendarCheck, GraduationCap, Handshake, Landmark, Repeat, TrendingUp, Users, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AdvSubject } from "@/lib/academy/advanced/server";

const ICONS: Record<string, LucideIcon> = { Bot, BriefcaseBusiness, Calculator, CalendarCheck, Handshake, Landmark, Repeat, TrendingUp, Users, Workflow };
const THEMES: Record<string, string> = {
  navy: "bg-navy text-cyan", cyan: "bg-[#007c91] text-white", amber: "bg-[#8a4b0f] text-[#ffe2b8]",
  green: "bg-[#0f5f59] text-[#c8f3ec]", slate: "bg-[#33465a] text-[#d7e3ee]", rose: "bg-[#6a2c4f] text-[#f6d7e7]",
};

export function SubjectIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || GraduationCap;
  return <Icon className={className} aria-hidden />;
}

/** Advanced subject card: "Advanced" marker, lesson count and status. Upcoming subjects say so and aren't sold. */
export function SubjectCard({ s, owned }: { s: AdvSubject; owned?: boolean }) {
  const lessons = s.courses.reduce((n, c) => n + c.lessons, 0);
  const minutes = s.courses.reduce((n, c) => n + c.minutes, 0);
  const live = s.status === "published" && s.purchasable;
  return (
    <li className={cn("group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card hover:border-line-strong", live ? "border-line" : "border-dashed border-line")} data-testid="subject-card" data-status={live ? "open" : s.status}>
      <Link href={`/academy/advanced/${s.slug}`} className="flex flex-1 flex-col">
        <div className={cn("relative flex aspect-[16/7] items-end overflow-hidden p-3", THEMES[s.cover_theme] ?? THEMES.navy)} aria-hidden>
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:18px_18px]" />
          <SubjectIcon name={s.icon} className="absolute -right-4 -bottom-6 h-28 w-28 opacity-25" />
          <span className="relative rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">Advanced</span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {owned ? <span className="rounded bg-ok-tint px-1.5 py-0.5 text-ok">Included in your membership</span>
              : live ? <span className="rounded bg-brand-tint px-1.5 py-0.5 text-navy">Free preview lesson</span>
              : <span className="rounded bg-idle-tint px-1.5 py-0.5 text-ink-soft">{s.status === "published" ? "In review" : "Upcoming"}</span>}
            {lessons > 0 && <span className="text-muted">{lessons} lessons{minutes ? ` · about ${Math.round(minutes / 60 * 10) / 10} hours` : ""}</span>}
          </div>
          <h3 className="mt-2 font-display text-base leading-snug font-bold group-hover:underline">{s.title}</h3>
          <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{s.summary}</p>
        </div>
      </Link>
    </li>
  );
}
