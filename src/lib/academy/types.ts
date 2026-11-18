/**
 * Contractor Academy shared types and constants (safe for client and server).
 */

export const PILLARS = [
  { key: "getting_started", label: "Getting Started", short: "Start", theme: "slate" },
  { key: "sales", label: "Sales & Customer Acquisition", short: "Sales", theme: "cyan" },
  { key: "estimating", label: "Estimating, Pricing & Profitability", short: "Estimating", theme: "navy" },
  { key: "project_management", label: "Project Management & Scheduling", short: "Projects", theme: "green" },
  { key: "accounting", label: "Accounting & Business Financials", short: "Financials", theme: "amber" },
  { key: "hr", label: "HR, Hiring & Team Development", short: "Hiring", theme: "rose" },
  { key: "growth", label: "Recurring Revenue & Growth", short: "Growth", theme: "cyan" },
  { key: "safety", label: "Regulations, Safety & Best Practices", short: "Safety", theme: "slate" },
] as const;

export type Pillar = (typeof PILLARS)[number]["key"];
export type CoverTheme = "navy" | "cyan" | "amber" | "green" | "slate" | "rose";
export type Access = "public" | "members" | "premium";
export type CourseStatus = "draft" | "upcoming" | "in_review" | "published" | "archived";
export type Level = "beginner" | "intermediate" | "advanced";

export const pillarMeta = (k: string) => PILLARS.find((p) => p.key === k) ?? PILLARS[0];
export const isPillar = (k: unknown): k is Pillar => typeof k === "string" && PILLARS.some((p) => p.key === k);

export const STATUS_LABEL: Record<CourseStatus, string> = {
  draft: "Draft", upcoming: "Coming soon", in_review: "In review", published: "Published", archived: "Archived",
};
export const ACCESS_LABEL: Record<Access, string> = { public: "Free", members: "Free for members", premium: "Premium" };
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

/** Original Built2Bid level names (1-9) and the all-time points each needs. */
export const LEVELS = [
  { level: 1, name: "Groundbreaker", min: 0 },
  { level: 2, name: "Layout", min: 10 },
  { level: 3, name: "Framer", min: 30 },
  { level: 4, name: "Builder", min: 75 },
  { level: 5, name: "Craftsman", min: 150 },
  { level: 6, name: "Foreman", min: 300 },
  { level: 7, name: "Superintendent", min: 600 },
  { level: 8, name: "Master Builder", min: 1200 },
  { level: 9, name: "Mentor", min: 2500 },
] as const;
/** Mirrors public.academy_level() in the migration. */
export function levelFor(points: number): number {
  let l = 1;
  for (const x of LEVELS) if (points >= x.min) l = x.level;
  return l;
}
export const levelName = (level: number) => LEVELS.find((l) => l.level === level)?.name ?? "Member";

export type AppFeature = "estimate" | "proposal" | "pipeline" | "customers" | "communications" | "pm" | "schedule" | "financials" | "team" | "saved_items";
export interface AppAction { label: string; href: string; area: AppFeature; why: string }

export interface QuizQuestion { q: string; options: string[]; answer: number; explain: string }

export type ResourceKind = "youtube" | "skool_community" | "skool_course" | "article" | "template" | "download" | "official";
export type PermissionStatus = "link_only" | "licensed" | "original";

export interface ResourceSeed {
  key: string;
  kind: ResourceKind;
  title: string;
  creatorName: string;
  creatorUrl?: string;
  communityName?: string;
  platform: string;
  sourceUrl: string;
  embedId?: string;
  embedAllowed: boolean;
  summary: string;
  whyItMatters: string;
  takeaways: string[];
  trades: string[]; // [] = every trade
  skill: Pillar | "marketing";
  accessNote?: string;
  permission: PermissionStatus;
  viewsAtVerification?: number;
  verifiedAt: string; // YYYY-MM-DD
  verificationNote: string;
}

export interface LessonSeed {
  slug: string;
  title: string;
  summary: string;
  module: string;
  access: Access;
  minutes: number;
  body: string; // limited Markdown: paragraphs, ### headings, - lists, **bold**
  takeaways: string[];
  checklist: string[];
  tradeNotes?: Record<string, string>;
  action?: AppAction;
  resources?: { key: string; note: string }[];
  quiz?: QuizQuestion[];
}

export interface CourseSeed {
  slug: string;
  trade: string | null;
  pillar: Pillar;
  title: string;
  summary: string;
  description: string;
  level: Level;
  access: Access;
  status: CourseStatus;
  contentClass: "original" | "curated" | "licensed" | "mixed";
  featured?: boolean;
  sort: number;
  plannedLessons: string[];
  seoTitle?: string;
  seoDescription?: string;
  lessons?: LessonSeed[];
  resources?: string[]; // course-level resource keys
}

export interface TradeSeedAcademy {
  slug: string;
  name: string;
  family: string;
  icon: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
  salesChallenge: string;
  sort: number;
}

export const POST_KINDS = [
  { key: "discussion", label: "Discussion" },
  { key: "question", label: "Question" },
  { key: "announcement", label: "Announcement" },
] as const;

export const REPORT_REASONS = [
  { key: "spam", label: "Spam or self-promotion" },
  { key: "harassment", label: "Harassment or abuse" },
  { key: "off_topic", label: "Off topic" },
  { key: "unsafe_advice", label: "Unsafe or misleading advice" },
  { key: "privacy", label: "Shares private information" },
  { key: "other", label: "Something else" },
] as const;

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
] as const;

/** Readable messages for the error codes raised by the academy_* database functions. */
export function academyErrorMessage(raw: string | undefined | null): string {
  const m = String(raw ?? "");
  const map: [string, string][] = [
    ["not_authenticated", "Please sign in first."],
    ["not_member", "Join the Academy to do that."],
    ["rules_required", "Please accept the community rules to join."],
    ["banned", "This account can't take part in the Academy."],
    ["suspended", "Your Academy posting is paused for now. You can still read."],
    ["premium_required", "That area is for premium members."],
    ["staff_only", "Only Academy staff can post there."],
    ["rate_limited", "You're posting very quickly. Please wait a bit and try again."],
    ["duplicate", "You already posted that title today."],
    ["own_content", "You can't react to your own post."],
    ["locked", "This discussion is locked."],
    ["bad_title", "Titles need 3 to 160 characters."],
    ["bad_body", "Please write something (up to 10,000 characters)."],
    ["bad_link", "Links must start with http:// or https://."],
    ["bad_trade", "Pick a trade from the list."],
    ["bad_category", "Pick a category."],
    ["forbidden", "You don't have permission to do that."],
    ["admin_only", "Only Academy admins can do that."],
    ["cannot_change_self", "You can't change your own role or status."],
    ["not_found", "That item isn't available."],
    ["license_required", "Licensed resources need an active creator licence on file."],
  ];
  for (const [code, msg] of map) if (m.includes(code)) return msg;
  return "Something went wrong. Please try again.";
}
