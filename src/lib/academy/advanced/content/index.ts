import type { CourseSeed } from "../../types";

export type SubjectSeed = {
  slug: string;
  title: string;
  summary: string;
  description?: string;
  outcomes?: string[];
  icon: string;
  theme: "navy" | "cyan" | "amber" | "green" | "slate" | "rose";
  status: "draft" | "upcoming" | "published";
  next?: string;
  reason?: string;
  sort: number;
  /** File in private/academy-advanced/lessons/ holding the paid course (kept out of the public repo). */
  lessons?: { file: string; exportName: string };
};

/**
 * Advanced subjects. The two launch subjects are paired with each other for the "Learn + Expand" choice; the rest
 * are shown as Upcoming (never sold) until an admin adds lessons and publishes them. Pairings and status are
 * editable in Academy → Manage → Advanced; this file only seeds first values.
 */
export const ADV_SUBJECTS: SubjectSeed[] = [
  {
    slug: "ai-for-contractors", title: "AI for Contractors", icon: "Bot", theme: "navy", status: "published", sort: 10,
    summary: "Use AI to estimate, write scopes, answer customers and document jobs faster, with a review step every time.",
    description: "A practical course for owners, estimators and project leads. You'll learn what today's AI tools are actually good at, how to write prompts that get usable answers, and how to build AI into estimating, customer communication and jobsite documentation with a review step every time. Each lesson ends with an exercise and a short knowledge check, and the capstone walks one fictional customer inquiry from first message to signed proposal.",
    outcomes: [
      "Know what AI tools are good at and where they fail",
      "Write prompts that give usable estimating and scope drafts",
      "Answer customers faster without losing your voice",
      "Turn jobsite notes and photos into clean daily logs",
      "Run one repeatable AI-assisted workflow from inquiry to proposal",
    ],
    next: "business-management",
    reason: "AI saves you time; Business Management shows where to put that time so each job earns more.",
    lessons: { file: "ai-for-contractors", exportName: "AI_FOR_CONTRACTORS" },
  },
  {
    slug: "business-management", title: "Contractor Business Management", icon: "BriefcaseBusiness", theme: "green", status: "published", sort: 20,
    summary: "Understand margins, price with confidence, track job costs and cash flow, and grow without losing control.",
    description: "For owners who are good at the work and want the business side to be just as solid. You'll learn how money really moves through a contracting company, how to price jobs from your own costs instead of gut feel, how to see whether each job made money, how to schedule payments so you aren't financing customers, how to run several jobs and subcontractors at once, and how to grow without the wheels coming off. Every lesson uses clearly labeled hypothetical numbers you can swap for your own, ends with an exercise and a knowledge check, and connects to the tools in Built2Bid.",
    outcomes: [
      "Read revenue, costs and margin the way a lender does",
      "Set prices from overhead and target margin, not guesses",
      "Track job costs while the job is running",
      "Plan cash flow so payroll and suppliers never surprise you",
      "Run crews, subs and several projects at once",
    ],
    next: "ai-for-contractors",
    reason: "Once your numbers are clear, AI for Contractors helps you produce estimates and updates in less time.",
    lessons: { file: "business-management", exportName: "BUSINESS_MANAGEMENT" },
  },
  { slug: "contractor-automation", title: "Contractor Automation", icon: "Workflow", theme: "cyan", status: "upcoming", sort: 30, summary: "Automate follow-ups, reminders and paperwork so fewer jobs fall through the cracks." },
  { slug: "advanced-estimating", title: "Advanced Estimating", icon: "Calculator", theme: "amber", status: "upcoming", sort: 40, summary: "Takeoffs, assemblies, unit costs and contingency for larger and more complex bids." },
  { slug: "job-costing", title: "Job Costing", icon: "Landmark", theme: "slate", status: "upcoming", sort: 50, summary: "Estimate-to-actual tracking, cost codes and closing out a job with real numbers." },
  { slug: "sales-and-retention", title: "Sales and Customer Retention", icon: "Handshake", theme: "rose", status: "upcoming", sort: 60, summary: "Win more of the right jobs and turn finished projects into repeat work and referrals." },
  { slug: "project-scheduling", title: "Project Scheduling", icon: "CalendarCheck", theme: "cyan", status: "upcoming", sort: 70, summary: "Sequence trades, plan around lead times and keep several jobs on schedule." },
  { slug: "financial-management", title: "Financial Management", icon: "TrendingUp", theme: "green", status: "upcoming", sort: 80, summary: "Budgets, financial statements, taxes to plan for and working with your accountant." },
  { slug: "hiring-and-leadership", title: "Hiring and Leadership", icon: "Users", theme: "slate", status: "upcoming", sort: 90, summary: "Hire, train and lead crews and office staff as the business grows." },
  { slug: "business-growth", title: "Business Growth", icon: "Repeat", theme: "amber", status: "upcoming", sort: 100, summary: "Choose where to grow, when to add capacity and how to keep quality as you scale." },
];

/**
 * The paid lesson text is not in this (public) repository. It lives in private/academy-advanced/lessons/ (gitignored;
 * the owner keeps the copy in the project files) and reaches customers only through the database, behind the
 * server-side paywall. Returns [] when the files aren't present, so builds, CI and tests work without them.
 */
export async function loadAdvCourses(dir?: string): Promise<{ subject: string; course: CourseSeed }[]> {
  const { pathToFileURL } = await import("node:url");
  const path = await import("node:path");
  const { existsSync } = await import("node:fs");
  const base = dir ?? path.resolve(import.meta.dirname, "../../../../../private/academy-advanced/lessons");
  const out: { subject: string; course: CourseSeed }[] = [];
  for (const s of ADV_SUBJECTS) {
    if (!s.lessons) continue;
    const file = path.join(base, `${s.lessons.file}.ts`);
    if (!existsSync(file)) continue;
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ pathToFileURL(file).href)) as Record<string, CourseSeed>;
    if (mod[s.lessons.exportName]) out.push({ subject: s.slug, course: mod[s.lessons.exportName] });
  }
  return out;
}
