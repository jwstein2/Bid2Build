import { tradeSeeds } from "@/lib/trades/data";
import type { CourseSeed, LessonSeed, Pillar, TradeSeedAcademy } from "../types";
import { PILLARS } from "../types";
import { RESOURCES } from "./resources";
import { SALES_ACADEMY } from "./sales-academy";
import tradeCourses from "./trade-courses.json";

/**
 * The Academy's starting catalog, generated from the canonical trade list (src/lib/trades/data.ts) so every trade
 * gets a classroom without per-trade code. This file seeds the database (scripts/academy/gen-seed.ts) and is the
 * read-only fallback before the Academy migration has been applied. After seeding, the database is the source of
 * truth and admins manage content in /academy/manage.
 */

type Draft = Record<string, {
  intro: string; seoTitle: string; seoDescription: string; salesChallenge: string;
  cards: { pillar: Pillar; title: string; summary: string; description: string; level: "beginner" | "intermediate" | "advanced"; lessons: string[] }[];
}>;
const drafts = tradeCourses as Draft;

/** Trades that get a published Sales playbook now (the trade notes in the Sales Academy cover them). */
export const PLAYBOOK_TRADES = ["roofing", "concrete", "landscaping", "painting", "interior-remodeling", "general-contracting"] as const;

export const ACADEMY_TRADES: TradeSeedAcademy[] = tradeSeeds
  .filter((t) => t.slug !== "other" && drafts[t.slug])
  .map((t, i) => ({
    slug: t.slug, name: t.name, family: t.family, icon: t.icon, sort: i * 10,
    intro: drafts[t.slug].intro, seoTitle: drafts[t.slug].seoTitle, seoDescription: drafts[t.slug].seoDescription,
    salesChallenge: drafts[t.slug].salesChallenge,
  }));

const tradeName = new Map(ACADEMY_TRADES.map((t) => [t.slug, t.name]));

/** Trade-specific notes from every Sales Academy lesson, compiled into one playbook lesson for that trade. */
function playbookLesson(trade: string): LessonSeed {
  const name = tradeName.get(trade) ?? trade;
  const notes = (SALES_ACADEMY.lessons ?? []).filter((l) => l.tradeNotes?.[trade]);
  const challenge = drafts[trade]?.salesChallenge ?? "";
  const body = [
    `This playbook collects the ${name.toLowerCase()}-specific advice from the Contractor Sales Academy in one place. Use it alongside the full course: each section links back to the lesson it comes from.`,
    `### The sales situation you'll meet most\n${challenge}`,
    ...notes.map((l) => `### ${l.title}\n${l.tradeNotes![trade]}\n\nFull lesson: **${l.title}** in the Contractor Sales Academy.`),
  ].join("\n\n");
  return {
    slug: "sales-playbook", module: "Playbook", title: `${name} sales playbook`, access: "public", minutes: 6,
    summary: `The ${name.toLowerCase()}-specific sales advice from all twelve Sales Academy lessons, on one page.`,
    body,
    takeaways: notes.slice(0, 4).map((l) => l.tradeNotes![trade].split(/(?<=\.)\s/)[0]),
    checklist: ["Read the full Contractor Sales Academy lesson for each section.", "Pick one habit from this playbook to use on your next appointment.", "Share what works in the Community under Sales & Closing with your trade tagged."],
    resources: RESOURCES.filter((r) => r.skill === "sales" && r.trades.includes(trade)).map((r) => ({ key: r.key, note: "Credited resource for this trade." })),
    action: { label: "Start a proposal", href: `/start/${trade}`, area: "estimate", why: `Open the ${name.toLowerCase()} estimate template and put the playbook into practice.` },
  };
}

const coverFor = (p: Pillar) => PILLARS.find((x) => x.key === p)!.theme;
export const courseCover = coverFor;

export function tradeCourseSlug(trade: string, pillar: Pillar) {
  return `${trade}-${pillar.replace(/_/g, "-")}`;
}

export const TRADE_COURSES: CourseSeed[] = ACADEMY_TRADES.flatMap((t) =>
  drafts[t.slug].cards.map((c, i): CourseSeed => {
    const playbook = c.pillar === "sales" && (PLAYBOOK_TRADES as readonly string[]).includes(t.slug);
    return {
      slug: tradeCourseSlug(t.slug, c.pillar), trade: t.slug, pillar: c.pillar, title: c.title, summary: c.summary, description: c.description,
      level: c.level, access: "public", status: playbook ? "published" : "upcoming", contentClass: playbook ? "mixed" : "original",
      sort: (i + 1) * 10, plannedLessons: c.lessons,
      seoTitle: c.title.length <= 60 ? c.title : undefined,
      seoDescription: c.summary,
      lessons: playbook ? [playbookLesson(t.slug)] : undefined,
      // Credited resources recommended on the card while the course is being written.
      resources: RESOURCES.filter((r) => (r.skill === c.pillar || (c.pillar === "sales" && r.skill === "marketing")) && (r.trades.length === 0 || r.trades.includes(t.slug)))
        .sort((a, b) => Number(b.trades.includes(t.slug)) - Number(a.trades.includes(t.slug)))
        .slice(0, 4).map((r) => r.key),
    };
  }),
);

export const ALL_COURSES: CourseSeed[] = [SALES_ACADEMY, ...TRADE_COURSES];
