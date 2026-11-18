import Link from "next/link";
import { BookOpen, Calculator, CalendarCheck, HardHat, Landmark, Repeat, ShieldCheck, Users, Handshake, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ACCESS_LABEL, LEVEL_LABEL, pillarMeta, type CoverTheme, type Pillar } from "@/lib/academy/types";
import type { Course } from "@/lib/academy/server";

const ICONS: Record<Pillar, LucideIcon> = {
  getting_started: HardHat, sales: Handshake, estimating: Calculator, project_management: CalendarCheck,
  accounting: Landmark, hr: Users, growth: Repeat, safety: ShieldCheck,
};
const THEMES: Record<CoverTheme, string> = {
  navy: "bg-navy text-cyan",
  cyan: "bg-[#007c91] text-white",
  amber: "bg-[#8a4b0f] text-[#ffe2b8]",
  green: "bg-[#0f5f59] text-[#c8f3ec]",
  slate: "bg-[#33465a] text-[#d7e3ee]",
  rose: "bg-[#6a2c4f] text-[#f6d7e7]",
};

/** Original Built2Bid course cover: themed blueprint pattern, pillar icon and trade label. */
export function CourseCover({ course, tradeName, coverUrl, className }: { course: Pick<Course, "pillar" | "cover_theme" | "title">; tradeName?: string | null; coverUrl?: string | null; className?: string }) {
  const Icon = ICONS[course.pillar] ?? BookOpen;
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded cover served by signed URL
    return <img src={coverUrl} alt="" className={cn("aspect-[16/9] w-full object-cover", className)} />;
  }
  return (
    <div className={cn("relative aspect-[16/9] w-full overflow-hidden", THEMES[course.cover_theme] ?? THEMES.navy, className)} aria-hidden>
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="absolute -right-6 -bottom-8 opacity-25"><Icon className="h-36 w-36" strokeWidth={1.25} /></div>
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
        <Icon className="h-3.5 w-3.5" /> {pillarMeta(course.pillar).short}
      </div>
      {tradeName && <div className="absolute bottom-3 left-3 text-xs font-bold tracking-wide uppercase opacity-90">{tradeName}</div>}
    </div>
  );
}

export function CourseCard({ course, tradeName, progress, coverUrl }: { course: Course; tradeName?: string | null; progress?: { completed: number; total: number }; coverUrl?: string | null }) {
  const live = course.status === "published";
  const pct = progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <li className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-md" data-testid="course-card" data-status={course.status}>
      <Link href={`/academy/courses/${course.slug}`} className="flex flex-1 flex-col focus-visible:outline-offset-[-2px]">
        <CourseCover course={course} tradeName={tradeName} coverUrl={coverUrl} />
        <div className="flex flex-1 flex-col p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {live ? <span className="rounded bg-ok-tint px-1.5 py-0.5 text-ok">{ACCESS_LABEL[course.access]}</span> : <span className="rounded bg-idle-tint px-1.5 py-0.5 text-ink-soft">Coming soon</span>}
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-ink-soft">{LEVEL_LABEL[course.level]}</span>
            {live && course.lesson_count ? <span className="text-muted">{course.lesson_count} {course.lesson_count === 1 ? "lesson" : "lessons"}</span> : course.planned_lessons.length ? <span className="text-muted">{course.planned_lessons.length} lessons planned</span> : null}
          </div>
          <h3 className="mt-2 font-display text-base leading-snug font-bold group-hover:underline">{course.title}</h3>
          <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{course.summary}</p>
          {live && progress && progress.total > 0 && (
            <div className="mt-auto pt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress"><div className="h-full bg-ok" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1 text-xs text-muted">{pct}% complete</p>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
