/**
 * Guided Experience engine: the registry of guided tours and journeys.
 *
 * One framework for every walkthrough. A tour is data, not code: adding one means adding an entry
 * here (tests/guide-engine.test.ts checks every entry). The runner (src/components/guide/*) shows it
 * with the same accessible spotlight card the page walkthrough already uses (FeatureTour), so tours,
 * page guides and feature announcements look and behave alike.
 *
 * Building blocks reused, not duplicated:
 *   - targets are the stable `data-guide` ids and page keys from src/lib/features/page-guides.ts (never
 *     CSS classes or text). A step whose control isn't on screen is skipped, never shown empty.
 *   - who may see a step uses the same Requirement/GuideContext rules as page guides (plan, Project
 *     Command Center editor/viewer, Enterprise permission, owner). The database stays the authority;
 *     this only decides what is explained, never what is allowed.
 *   - trade-adapted copy uses the same {placeholders} (fill() in page-guides.ts).
 *
 * Copy is localization-ready: every string is addressed by `${tour.id}.${stepIndex}.title|body`
 * (messageKey) and resolved through translate(), which falls back to the English text here.
 */
import { meets, type GuideContext, type PageKey, type Requirement } from "../features/page-guides";

export type GuideRole = "solo" | "owner" | "manager" | "staff";
export type Workspace = "real" | "demo" | "practice";
export type TourArea = "getting-started" | "estimating" | "projects" | "enterprise" | "demo";

export interface TourStepDef {
  /** Page the step lives on. When the person is elsewhere the runner offers a link there (never auto-navigates). */
  page: PageKey;
  /** Where to go for that page (the link the runner offers). Omitted when it's reached by a step in the flow (the builder). */
  href?: string;
  /** Shown between pages when there's no link: what to do to get there. */
  continueHint?: string;
  /** `data-guide` id(s) of the control, alternatives in order. */
  target: string | readonly string[];
  title: string;
  body: string;
  hint?: string;
  requires?: Requirement;
}

export type Trigger =
  /** Offered once on the first eligible page after sign-up. */
  | { kind: "new_account"; pages: readonly PageKey[]; maxAgeDays: number }
  /** Offered the first time the person opens one of these pages. */
  | { kind: "first_visit"; pages: readonly PageKey[] }
  /** Only from the Guide menu or a link. */
  | { kind: "manual" };

export interface TourDef {
  id: string;
  version: number;
  title: string;
  description: string;
  area: TourArea;
  /** Roles this is written for (omitted = everyone). */
  roles?: readonly GuideRole[];
  requires?: Requirement;
  workspaces?: readonly Workspace[];
  trigger: Trigger;
  /** The question on the offer card ("Want a quick walkthrough?"). */
  offer?: string;
  steps: readonly TourStepDef[];
  /** "steps" = finishing the walkthrough; "checklist" = the first-bid checklist's real product actions. */
  completion: "steps" | "checklist";
  optional: true;
  replayable: boolean;
  /** Help resource ids (help.ts). */
  help: readonly string[];
}

const BIDS = "/dashboard";
const PROJECTS = "/projects";

export const TOURS: readonly TourDef[] = [
  {
    id: "first-estimate", version: 1, area: "getting-started",
    title: "Get your first bid out",
    description: "Pick your trade, price a few line items and preview the proposal your customer will see. About 10 minutes.",
    offer: "Welcome to Built2Bid. Want help getting your first bid out? It takes about 10 minutes, and you can stop any time.",
    workspaces: ["real", "practice"],
    trigger: { kind: "new_account", pages: ["dashboard.pipeline", "dashboard.table"], maxAgeDays: 14 },
    completion: "checklist", optional: true, replayable: true,
    help: ["video.getting-started", "article.first-bid", "academy"],
    steps: [
      { page: "dashboard.pipeline", href: `${BIDS}?view=pipeline`, target: "bids.new-bid", title: "Estimates start here", body: "Create New Bid opens the builder. Pick your trade and the estimate starts with the usual sections, such as {phases}." },
      { page: "builder.project", continueHint: "Click Create New Bid and pick a trade. The walkthrough picks up in the builder.", target: "builder.customer", title: "Add the customer", body: "Pick an existing customer or type a new one. You can use a made-up name while you learn." },
      { page: "builder.estimate", continueHint: "Go to the Estimate step in the builder to continue.", target: ["builder.section", "builder.calculator"], title: "Price a few line items", body: "Enter quantities and your own costs for {materials} and {labor}. The calculator next to Qty can work out quantities." },
      { page: "builder.proposal", continueHint: "Go to the Proposal step in the builder to continue.", target: ["builder.preview", "builder.send"], title: "Review the proposal", body: "This is exactly what your customer sees. Your costs and markup stay hidden. Download or send it when you're ready." },
    ],
  },
  {
    id: "pm-hub", version: 1, area: "projects",
    title: "Project Command Center walkthrough",
    description: "How won estimates become organized projects: stages, scheduling, assignments and progress.",
    offer: "Welcome to the Project Command Center. This is where your estimates become organized, manageable projects. Want a quick walkthrough?",
    requires: { pmView: true },
    trigger: { kind: "first_visit", pages: ["projects.overview", "projects.list"] },
    completion: "steps", optional: true, replayable: true,
    help: ["article.projects", "academy"],
    steps: [
      { page: "projects.overview", href: PROJECTS, target: "projects.metrics", title: "Your projects at a glance", body: "Active jobs, what's behind, what's starting and what needs review. Click a card to focus the list." },
      { page: "projects.overview", href: PROJECTS, target: "projects.ready", title: "From won bid to project", body: "Won or signed bids land in Ready to schedule. Schedule Now builds a timeline from the bid's sections, such as {phases}.", requires: { pmEdit: true } },
      { page: "projects.overview", href: PROJECTS, target: "projects.ready", title: "From won bid to project", body: "Won or signed bids land in Ready to schedule, and a schedule editor on your team builds them.", requires: { pmEdit: false } },
      { page: "projects.overview", href: PROJECTS, target: "projects.card", title: "Track progress", body: "Each project card shows dates, progress and the next task. Open one for the full schedule." },
      { page: "projects.calendar", href: `${PROJECTS}?view=calendar`, target: "projects.cal-event", title: "Scheduling", body: "Every task from every job on one calendar, colored by project." },
      { page: "projects.workload", href: `${PROJECTS}?view=workload`, target: ["projects.workload-table", "projects.conflicts"], title: "Assign responsibilities", body: "See who is booked and catch double-bookings before they happen." },
      { page: "projects.team", href: `${PROJECTS}/team`, target: "team.directory", title: "Your crew and subs", body: "Add staff and subcontractors such as {sub}, then assign them to tasks on any schedule." },
    ],
  },
  {
    id: "contractors-workforce", version: 1, area: "projects",
    title: "Contractors & Workforce walkthrough",
    description: "Find a sub or employee, check who's free, assign them to a project and see it in PM Hub.",
    offer: "This is your directory of subs, employees and crews. Want a quick walkthrough?",
    requires: { pmView: true },
    trigger: { kind: "first_visit", pages: ["projects.workforce"] },
    completion: "steps", optional: true, replayable: true,
    help: ["article.projects", "academy"],
    steps: [
      { page: "projects.workforce", href: `${PROJECTS}/workforce`, target: "workforce.search", title: "Search by trade or name", body: "Type a trade like Electrician, a company, a person or a project. Filters narrow it by availability." },
      { page: "projects.workforce", href: `${PROJECTS}/workforce`, target: "workforce.cards", title: "Inspect a contractor", body: "Each card shows active and upcoming jobs, availability and any conflict. Open one for workers, projects and history." },
      { page: "projects.workforce", href: `${PROJECTS}/workforce`, target: "workforce.assign", title: "Assign to a project", body: "Pick a project and a section. Built2Bid checks for double-bookings before anything is saved.", requires: { pmEdit: true } },
      { page: "projects.workforce", href: `${PROJECTS}/workforce`, target: "workforce.assignments-tab", title: "Conflicts and assignments", body: "Every assignment in one list, with conflicts flagged. A manager can override a conflict with a reason, and nothing is moved for you." },
      { page: "projects.workforce", href: `${PROJECTS}/workforce`, target: "workforce.add", title: "Add your people", body: "Add a subcontracting company and its workers, an individual sub, an employee or a crew. No logins or seats are created.", requires: { pmEdit: true } },
    ],
  },
  {
    id: "enterprise-owner", version: 1, area: "enterprise",
    title: "Set up your company",
    description: "Licensed seats, inviting your team, roles and permissions, team projects and billing.",
    offer: "Your Team workspace is ready. Want a short tour of company setup?",
    roles: ["owner"], requires: { company: true, owner: true },
    trigger: { kind: "first_visit", pages: ["company.overview", "company.users"] },
    completion: "steps", optional: true, replayable: true,
    help: ["article.enterprise", "academy"],
    steps: [
      { page: "company.overview", href: "/company", target: "company.kpis", title: "Company overview", body: "Pipeline, wins and win rate for your whole team." },
      { page: "company.users", href: "/company/users", target: "company.members", title: "Your team and roles", body: "Everyone in the company with their role. A role sets what each person can see and do." },
      { page: "company.users", href: "/company/users", target: "company.invite", title: "Invite team members", body: "Invite a teammate by email. They get access when they accept, within your licensed seats.", requires: { permission: "manage_users" } },
      { page: "company.users", href: "/company/users", target: "company.teams", title: "Teams", body: "Group people into teams, such as a crew per trade.", requires: { permission: "manage_teams" } },
      { page: "company.pipeline", href: "/company/pipeline", target: "company.pipeline-list", title: "Manage projects as a team", body: "Every team bid with its owner, stage and value." },
      { page: "company.billing", href: "/company/billing", target: "company.licenses", title: "Billing and extra seats", body: "Seats you pay for and seats in use. Price changes are shown before you confirm.", requires: { permission: "manage_billing" } },
    ],
  },
  {
    id: "enterprise-manager", version: 1, area: "enterprise",
    title: "Managing your team's work",
    description: "Which projects you can see, team coordination, reporting and your permissions.",
    offer: "You're a manager in this company. Want a quick look at your team tools?",
    roles: ["manager"], requires: { company: true },
    trigger: { kind: "first_visit", pages: ["company.pipeline", "company.overview"] },
    completion: "steps", optional: true, replayable: true,
    help: ["article.enterprise"],
    steps: [
      { page: "company.pipeline", href: "/company/pipeline", target: "company.pipeline-filters", title: "Bids you can see", body: "You see the bids your role and teams allow. Filter by person, team, stage or date." },
      { page: "company.pipeline", href: "/company/pipeline", target: "company.pipeline-list", title: "Team coordination", body: "Open a teammate's bid to review it, or move it along if your permissions allow." },
      { page: "company.overview", href: "/company", target: "company.team", title: "Reporting", body: "Bids, wins and value by person.", requires: { permission: "view_analytics" } },
      { page: "company.users", href: "/company/users", target: "company.members", title: "Your permissions", body: "Your role and any extra permissions are set by the owner. Ask them if you need more access." },
    ],
  },
  {
    id: "enterprise-staff", version: 1, area: "enterprise",
    title: "Your work at a glance",
    description: "Your assigned work, the projects you can open and where to get help.",
    offer: "Welcome to the team. Want a quick look at where your work lives?",
    roles: ["staff"], requires: { company: true },
    trigger: { kind: "first_visit", pages: ["dashboard.pipeline", "projects.mywork"] },
    completion: "steps", optional: true, replayable: true,
    help: ["article.first-bid", "academy"],
    steps: [
      { page: "dashboard.pipeline", href: `${BIDS}?view=pipeline`, target: "bids.kpis", title: "Your bids", body: "The bids you created, by stage. Your role decides what else you can see." },
      { page: "dashboard.pipeline", href: `${BIDS}?view=pipeline`, target: "bids.new-bid", title: "Start a bid", body: "Create New Bid opens the builder for a fresh estimate." },
      { page: "projects.mywork", href: `${PROJECTS}?view=mywork`, target: "projects.mywork", title: "Assigned work", body: "Tasks assigned to you: overdue, today and coming up.", requires: { pmView: true } },
    ],
  },
  {
    id: "demo-tour", version: 1, area: "demo",
    title: "Demo walkthrough",
    description: "A guided path through the sample company for live demonstrations: bids, customers, projects and team.",
    workspaces: ["demo"],
    trigger: { kind: "manual" },
    completion: "steps", optional: true, replayable: true,
    help: [],
    steps: [
      { page: "dashboard.pipeline", href: `${BIDS}?view=pipeline`, target: "bids.kpis", title: "A busy pipeline", body: "The sample company has bids in every stage, from drafts to completed jobs. Click a card to filter." },
      { page: "dashboard.pipeline", href: `${BIDS}?view=pipeline`, target: "bids.card", title: "Every bid tells its story", body: "Open any card to see the estimate, the proposal and its history." },
      { page: "customers.directory", href: "/dashboard/customers", target: ["customers.row", "customers.metrics"], title: "150 sample customers", body: "Repeat customers, leads and businesses, each linked to their bids and projects." },
      { page: "projects.overview", href: PROJECTS, target: "projects.metrics", title: "Projects in motion", body: "Scheduled, in progress, delayed and completed jobs with crews assigned.", requires: { pmView: true } },
      { page: "projects.team", href: `${PROJECTS}/team`, target: "team.directory", title: "Team and subcontractors", body: "8 employees and 12 subcontractors, all fictional.", requires: { pmView: true } },
    ],
  },
];

export const getTour = (id: string) => TOURS.find((t) => t.id === id);

/** Role used for onboarding from the company role (solo accounts own everything they see). */
export function guideRole(ctx: Pick<GuideContext, "company">): GuideRole {
  const c = ctx.company;
  if (!c) return "solo";
  if (c.owner || c.role === "owner") return "owner";
  if (c.role === "manager") return "manager";
  return "staff";
}

export function tourEligible(t: TourDef, ctx: GuideContext, ws: Workspace): boolean {
  if (!ctx.signedIn) return false;
  if ((t.workspaces ?? ["real", "demo", "practice"]).indexOf(ws) < 0) return false;
  if (t.roles && !t.roles.includes(guideRole(ctx))) return false;
  return meets(t.requires, ctx);
}

/** Tours this person can open from the Guide (inapplicable ones are never listed). */
export function eligibleTours(ctx: GuideContext, ws: Workspace): TourDef[] {
  return TOURS.filter((t) => tourEligible(t, ctx, ws));
}

export const messageKey = (tourId: string, i: number, field: "title" | "body" | "hint") => `${tourId}.${i}.${field}`;

/** Locale lookup with English fallback. A locale pack is a flat { key: text } map. */
export function translate(pack: Readonly<Record<string, string>> | null | undefined, key: string, fallback: string): string {
  return pack?.[key] ?? fallback;
}
