/**
 * Page guides: the "Feature walkthrough" teaches the page and view the person is looking at, on that
 * page. It never changes the route, the selected view, filters or anything typed; it only highlights
 * real controls and explains them.
 *
 * How a guide is chosen (src/components/features/feature-host.tsx):
 * - Every screen that has a guide marks its root with `data-guide-page="<page key>"`. The component
 *   that knows the active view or tab sets the key (Bids sets dashboard.pipeline / .table / .analytics),
 *   so the active view decides the tutorial. When several are on screen the innermost one wins, and one
 *   inside an open dialog wins over the page behind it.
 * - Each step points at `data-guide="<target id>"` on a real control. Ids are semantic and stable; they
 *   are never CSS classes or DOM positions. A step may list alternatives (`targets`) for layouts that
 *   differ by screen size, e.g. the company calendar panel on wide screens and its toggle on phones.
 * - Steps whose control isn't on screen are skipped (and reported in development), never shown as an
 *   empty spotlight, and the walkthrough never navigates to find them.
 * - `requires` hides steps the person can't use (plan, Project Command Center editor vs viewer, Enterprise
 *   permissions, platform owner). The database stays the authority; this only decides what is explained.
 * - Copy adapts to the contractor's trade through {placeholders} filled from TRADE_VOCAB. The trade comes
 *   from the screen (`data-guide-trade` on a bid or project, so project-level trades win) and otherwise
 *   from the trades on the account's recent bids. Deterministic: no AI call is made to write a tour.
 *
 * Rules (tests/page-guides.test.ts, run in CI):
 * - Every target and page key here is used in the app as a literal `data-guide` / `data-guide-page`.
 * - Copy only describes controls that exist on main. Financial Command Center screens render only when
 *   NEXT_PUBLIC_FINANCIALS is on, so their guides can only start there; each screen already hides what a
 *   person's financial role can't use, and the walkthrough skips steps whose control isn't on screen.
 */
import type { Permission } from "@/lib/enterprise/permissions";
import { getFeature, type FeatureId } from "./registry";

/** Trade families with their own examples. Every trade slug maps to one (tradeGroup). */
export type TradeGroup = "decks" | "electrical" | "service" | "landscaping" | "exterior" | "concrete" | "remodel" | "finishes" | "washing" | "cleaning" | "trees" | "pest" | "general";

interface Vocab {
  /** Name used in sentences ("deck builders"). */
  trade: string;
  job: string;
  materials: string;
  labor: string;
  item: string;
  sub: string;
  /** Repeat work worth scheduling or following up on. */
  recurring: string;
  /** What a project calendar holds for this trade. */
  phases: string;
}

export const TRADE_VOCAB: Record<TradeGroup, Vocab> = {
  decks: { trade: "deck builders", job: "a 16×20 composite deck", materials: "decking boards, joists and railing", labor: "framing and board installation", item: "Composite decking, 16 ft board", sub: "a footing or concrete sub", recurring: "staining and seal-coat visits", phases: "footings, framing, decking and railing" },
  electrical: { trade: "electricians", job: "a 200 A panel upgrade", materials: "breakers, wire and devices", labor: "rough-in and trim-out", item: "20 A breaker", sub: "a drywall patch sub", recurring: "service calls and inspections", phases: "permit, rough-in, inspection and trim-out" },
  service: { trade: "plumbing and HVAC contractors", job: "a water heater or furnace replacement", materials: "parts, fittings and equipment", labor: "install and service labor", item: "50-gallon water heater", sub: "an electrician for the disconnect", recurring: "maintenance agreements and tune-ups", phases: "removal, install, startup and inspection" },
  landscaping: { trade: "landscapers", job: "a patio and planting install", materials: "pavers, mulch and plants", labor: "crew hours and equipment time", item: "Mulch, per cubic yard", sub: "an irrigation sub", recurring: "weekly mowing and seasonal cleanups", phases: "grading, hardscape, planting and cleanup" },
  exterior: { trade: "roofing and exterior contractors", job: "a full roof replacement", materials: "shingles, underlayment and flashing", labor: "tear-off and install", item: "Architectural shingles, per square", sub: "a gutter sub", recurring: "inspections and gutter cleanings", phases: "tear-off, dry-in, install and cleanup" },
  concrete: { trade: "concrete and masonry contractors", job: "a 20×24 driveway pour", materials: "concrete, rebar and forms", labor: "forming, pouring and finishing", item: "Concrete, per cubic yard", sub: "an excavation sub", recurring: "sealing visits", phases: "excavation, forming, pour and cure" },
  remodel: { trade: "remodelers", job: "a kitchen remodel", materials: "cabinets, countertops and fixtures", labor: "demo, install and finish work", item: "Base cabinet, 36 in", sub: "a plumber or electrician", recurring: "warranty walk-throughs", phases: "demo, rough-ins, install and punch list" },
  finishes: { trade: "painting, flooring and tile contractors", job: "an interior repaint", materials: "paint, primer and supplies", labor: "prep and application", item: "Interior wall paint, per gallon", sub: "a drywall repair sub", recurring: "touch-ups and repeat rooms", phases: "prep, prime, finish coats and cleanup" },
  washing: { trade: "pressure and soft washing pros", job: "a house wash and driveway clean", materials: "detergents and surface cleaner time", labor: "wash time per surface", item: "House wash, per sq ft", sub: "a gutter-cleaning sub", recurring: "annual and seasonal repeat washes", phases: "setup, pre-treat, wash and rinse" },
  cleaning: { trade: "cleaning companies", job: "a post-construction final clean", materials: "cleaning supplies and equipment", labor: "crew hours per area", item: "Final clean, per sq ft", sub: "a carpet or window-cleaning sub", recurring: "weekly and monthly recurring cleanings", phases: "rough clean, final clean and touch-up before walkthrough" },
  trees: { trade: "tree service companies", job: "a large tree removal with stump grinding", materials: "equipment time, disposal and haul-away", labor: "crew and climber hours", item: "Stump grinding, per stump", sub: "a crane service", recurring: "yearly and multi-year pruning cycles", phases: "setup, takedown, chipping, stump grinding and cleanup" },
  pest: { trade: "pest control companies", job: "an initial treatment with a quarterly service plan", materials: "treatment products, bait stations and exclusion materials", labor: "technician time per visit", item: "Quarterly service visit", sub: "a fumigation or wildlife sub", recurring: "monthly, bi-monthly and quarterly service plans", phases: "inspection, initial treatment, follow-up and recurring visits" },
  general: { trade: "contractors", job: "a garage addition", materials: "materials and allowances", labor: "your crew's labor", item: "Framing lumber package", sub: "your trade subcontractors", recurring: "repeat and referral work", phases: "site prep, framing, rough-ins and finish" },
};

const GROUP_OF: Record<string, TradeGroup> = {
  decks: "decks", fencing: "decks", "pole-barns": "decks",
  electrical: "electrical",
  plumbing: "service", hvac: "service",
  landscaping: "landscaping", excavation: "landscaping",
  roofing: "exterior", siding: "exterior", gutters: "exterior", "windows-doors": "exterior", "exterior-remodeling": "exterior", insulation: "exterior",
  concrete: "concrete", masonry: "concrete", foundations: "concrete", "asphalt-paving": "concrete", demolition: "concrete",
  kitchens: "remodel", bathrooms: "remodel", basements: "remodel", "cabinets-countertops": "remodel", "interior-remodeling": "remodel", "commercial-remodeling": "remodel", additions: "remodel",
  painting: "finishes", drywall: "finishes", flooring: "finishes", tile: "finishes", "finish-carpentry": "finishes",
  "pressure-washing": "washing", "soft-washing": "washing", cleaning: "cleaning",
  "tree-removal": "trees", "tree-trimming": "trees",
  "pest-control": "pest",
};

export function tradeGroup(slug: string | null | undefined): TradeGroup {
  return (slug && GROUP_OF[slug]) || "general";
}

/** The trade a guide speaks to: the most frequent trade among the given slugs (screen first, then account). */
export function pickTrade(screen: readonly string[], account: readonly string[]): TradeGroup {
  for (const list of [screen, account]) {
    const counts = new Map<TradeGroup, number>();
    for (const s of list) { const g = tradeGroup(s); if (g !== "general") counts.set(g, (counts.get(g) ?? 0) + 1); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return "general";
}

/** What the signed-in person can do, from GET /api/features?guide=1 (computed on the server). */
export interface GuideContext {
  signedIn: boolean;
  /** library_access(): Unlimited, Enterprise, complimentary or admin. */
  unlimited: boolean;
  /** Project Command Center: can see schedules / can edit them. */
  pm: { view: boolean; edit: boolean };
  /** Enterprise membership; null for a solo account (who owns everything they see). */
  company: { role: string; owner: boolean; permissions: readonly string[] } | null;
  /** Platform owner (is_admin). */
  admin: boolean;
}

export const GUEST_CONTEXT: GuideContext = { signedIn: false, unlimited: false, pm: { view: false, edit: false }, company: null, admin: false };

export interface Requirement {
  signedIn?: boolean;
  unlimited?: boolean;
  pmView?: boolean;
  /** true = schedule editors only; false = viewers only (so viewers aren't told to edit). */
  pmEdit?: boolean;
  /** Enterprise permission; solo accounts have every permission on their own data. */
  permission?: Permission;
  /** Company owner (or a solo account). */
  owner?: boolean;
  /** Member of an Enterprise company. */
  company?: boolean;
  admin?: boolean;
}

export function meets(r: Requirement | undefined, c: GuideContext): boolean {
  if (!r) return true;
  if (r.signedIn !== undefined && r.signedIn !== c.signedIn) return false;
  if (r.unlimited !== undefined && r.unlimited !== c.unlimited) return false;
  if (r.pmView && !(c.pm.view || c.pm.edit)) return false;
  if (r.pmEdit !== undefined && r.pmEdit !== c.pm.edit) return false;
  if (r.permission && c.company && !c.company.permissions.includes(r.permission)) return false;
  if (r.owner && c.company && !c.company.owner) return false;
  if (r.company !== undefined && r.company !== Boolean(c.company)) return false;
  if (r.admin && !c.admin) return false;
  return true;
}

export interface GuideStepDef {
  /** `data-guide` id of the control. With several, the first visible one is used. */
  target: string | readonly string[];
  title: string;
  /** Plain language; {job}, {materials}, {labor}, {item}, {sub}, {recurring}, {phases}, {trade} adapt to the trade. */
  body: string;
  /** Optional "Try:" line, also trade-adapted. Never performed by the walkthrough. */
  hint?: string;
  requires?: Requirement;
  /** Reuses a registered feature's entitlement and release status instead of repeating them here. */
  feature?: FeatureId;
  /** When the requirement isn't met but the control is still shown (e.g. a locked button), explain availability instead of hiding the step. */
  locked?: string;
  /**
   * Local, non-persistent UI the step may open first (a phone menu, a "More" list, a collapsed column).
   * The component that owns it listens for REVEAL_GUIDE_EVENT and puts it back when the walkthrough ends.
   */
  reveal?: string;
}

export interface PageGuide {
  /** Where it applies (documentation and tests; the page marker decides at runtime). */
  route: string;
  /** Area · view shown on the first card. */
  label: string;
  requires?: Requirement;
  steps: readonly GuideStepDef[];
}

// Shared steps, reused across views so copy is written once.
const S = {
  newBid: { target: "bids.new-bid", title: "Start a new bid", body: "Create New Bid opens the builder for a fresh estimate, such as {job}. Your bids list stays exactly as it is." },
  viewTabs: { target: "bids.view-tabs", title: "Three ways to see your bids", body: "Pipeline shows bids as cards by sales stage, Table lists every bid with all its actions, and Analytics shows how sales are going. Switching views keeps your search." },
  helpLink: { target: "bids.help", title: "Help for this page", body: "The ? explains the view you're on, and Show me how this page works replays this walkthrough any time." },
  pageGuide: { target: "page.guide-button", title: "Replay this walkthrough", body: "Show me how this page works runs this walkthrough again whenever you want a refresher." },
} satisfies Record<string, GuideStepDef>;

export const PAGE_GUIDES = {
  // ── Bids (the signed-in dashboard) ──────────────────────────────────────────────────────────────
  "dashboard.pipeline": {
    route: "/dashboard?view=pipeline",
    label: "Bids · Pipeline",
    steps: [
      { target: "bids.alerts", title: "What needs you today", body: "Signed bids, jobs waiting for review and setup reminders appear at the top so nothing slips." },
      S.viewTabs,
      { target: "bids.kpis", title: "Your pipeline at a glance", body: "Active pipeline value, open bids, drafts, sent, awaiting signature, won value and win rate. Click a card to show only those bids; click it again to show all." },
      { target: "bids.search", title: "Search and date filters", body: "Search by project, customer or bid number, and pick a date range. Filters only change what you see, never the bids." },
      { target: "bids.stage", title: "Stages", body: "Each column is a sales stage, from Draft to Won, with the total value of the bids in it. A signed bid moves to Won by itself.", feature: "pipeline" },
      { target: "bids.card", title: "Bid cards", body: "Each card shows the customer, the value and what's next. Click a card to open the bid; drag it, or use ⋮, to move it to another stage.", hint: "For {job}, the card's next step tells you whether to finish the estimate, send it or follow up." },
      { target: "bids.card-menu", title: "Move a bid", body: "The ⋮ menu moves a bid to another stage without dragging, which is handy on a phone. Nothing moves until you pick a stage." },
      S.newBid,
      S.helpLink,
    ],
  },
  "dashboard.table": {
    route: "/dashboard?view=table",
    label: "Bids · Table",
    steps: [
      S.viewTabs,
      { target: "bids.table-search", title: "Find any bid", body: "Search by project, customer or bid number." },
      { target: "bids.table-filters", title: "Status and signature filters", body: "Show active, finalized or archived bids, and narrow to signed bids or bids awaiting a signature." },
      { target: "bids.row", title: "One row per bid", body: "The bid's name, customer, trade, number and last edit, with its status and total on the right." },
      { target: "bids.open", title: "Open and edit an estimate", body: "The pencil opens the bid in the builder, where you can change items, prices and the proposal.", hint: "Inside a bid, Internal report shows your private costs, markup and profit." },
      { target: "bids.row-actions", title: "Everything else for a bid", body: "Preview, download the latest PDF without using a credit, duplicate, rename, archive or delete. Delete always asks first." },
      S.newBid,
    ],
  },
  "dashboard.analytics": {
    route: "/dashboard?view=analytics",
    label: "Bids · Analytics",
    steps: [
      S.viewTabs,
      { target: "bids.search", title: "Pick the period", body: "Choose a date range (and search, if you like). Every number below follows it." },
      { target: "bids.analytics-kpis", title: "How sales are going", body: "Bids sent, approved and declined, your win rate and average bid for the period. Click a card to see the bids behind it.", feature: "analytics" },
      { target: "bids.sales-pay", title: "Estimate your sales pay", body: "A private planning calculator: choose percent of sale, percent of profit or a flat amount per job. It never changes bid prices, and only you see your settings.", feature: "sales_pay" },
      S.newBid,
    ],
  },

  // ── Estimate builder (one guide per step) ───────────────────────────────────────────────────────
  "builder.company": {
    route: "/estimates/[id] · Company",
    label: "Estimate builder · Company",
    steps: [
      { target: "builder.steps", title: "Five steps to a proposal", body: "Company, Customer & project, Estimate, Scope & exclusions, Proposal. A check means the step is done; you can jump between steps any time without losing work." },
      { target: "company.business", title: "Your business details", body: "Name, contact, email, phone and address go on every proposal. They're saved once and reused on every bid." },
      { target: "company.branding", title: "Logo and colors", body: "Upload your logo and pick brand colors so every proposal looks like yours." },
      { target: "builder.save", title: "Saving", body: "Changes save automatically. This badge shows when everything is saved." },
    ],
  },
  "builder.project": {
    route: "/estimates/[id] · Customer & project",
    label: "Estimate builder · Customer & project",
    steps: [
      { target: "builder.steps", title: "Where you are", body: "You're on Customer & project. Jump to any step without losing work." },
      { target: "builder.customer", title: "Customer", body: "Pick an existing customer or type a new one. The bid links to their customer record, so it shows on their page too." },
      { target: "builder.project-details", title: "Project details", body: "Project address and dates go on the proposal; the ZIP code also helps local pricing.", hint: "For {job}, add the job-site address so your crew and the customer see the same place." },
      { target: "builder.trades", title: "Trades on this job", body: "Each trade adds its own sections and suggested items. Add another trade when a job needs more than one; nothing is removed unless you choose to." },
    ],
  },
  "builder.estimate": {
    route: "/estimates/[id] · Estimate",
    label: "Estimate builder · Estimate",
    steps: [
      { target: "builder.section", title: "Estimate sections", body: "Sections group the work, such as {phases}. Each line has a quantity, unit and your internal cost.", hint: "Add {materials} as material lines and {labor} as labor lines." },
      { target: "builder.calculator", title: "Quantity calculators", body: "The calculator next to a quantity works out how much you need from measurements, with waste included, then fills in the quantity for you to confirm." },
      { target: "builder.saved-items", title: "Saved Items", body: "Add items you've saved, like \"{item}\", with your own prices instead of typing them again.", requires: { unlimited: true }, locked: "Saved items with your own prices are included with Unlimited. You can still type any item." },
      // The quote panel lives inside a line's details; the step explains the visible ▸ toggle rather than opening it.
      { target: "builder.item-details", title: "Line details and sub quotes", body: "The ▸ next to a line opens its details, where you can add notes and record a quote from {sub} to compare with your cost. Prices only change when you choose to.", feature: "sub_quotes" },
      { target: "builder.add-trade", title: "Add sections or trades", body: "Add another section, or another trade with its own sections, to the same bid." },
      { target: "builder.pricing", title: "Pricing", body: "Choose markup or margin, see the project summary by trade, and decide how prices show to the customer. Your internal costs never appear on the proposal." },
      { target: "builder.customer-view", title: "Customer view", body: "See exactly what your customer will see, without your costs." },
    ],
  },
  "builder.scope": {
    route: "/estimates/[id] · Scope & exclusions",
    label: "Estimate builder · Scope & exclusions",
    steps: [
      { target: "builder.scope", title: "Scope of work", body: "Describe what's included in plain language. A draft can be written from your estimate's sections, and you edit it before it goes anywhere.", hint: "For {job}, list each phase: {phases}." },
      { target: "builder.exclusions", title: "Exclusions", body: "Say what isn't included so there are no surprises later." },
    ],
  },
  "builder.proposal": {
    route: "/estimates/[id] · Proposal",
    label: "Estimate builder · Proposal",
    steps: [
      { target: "builder.signing", title: "E-signature", body: "Create a signing link so the customer can review and sign online. Nothing is sent until you choose to send it." },
      { target: "builder.payment-schedule", title: "Payment schedule", body: "Set the deposit and progress payments the proposal shows, such as a deposit up front and the balance on completion." },
      { target: "builder.preview", title: "Proposal preview", body: "Preview customer proposal shows the finished proposal before you download or send it." },
      { target: "builder.send", title: "Send or download", body: "Send via My Email opens a message for you to review first, and Download PDF saves the proposal. Neither happens until you click." },
      { target: "builder.internal-report", title: "Internal report", body: "A private PDF of costs, markup, margin and profit by section. Never shown to customers.", feature: "internal_report", locked: "The Internal Estimate Report is included with Unlimited and Team." },
    ],
  },

  // ── Customers ───────────────────────────────────────────────────────────────────────────────────
  "customers.directory": {
    route: "/dashboard/customers",
    label: "Customers · Directory",
    steps: [
      { target: "customers.tabs", title: "Customers and communications", body: "The directory lists everyone you've bid for. Communications, where your plan and role include it, holds follow-ups and project updates." },
      { target: "customers.metrics", title: "Customer metrics", body: "Total customers, those with open bids, active projects and anyone needing attention. Click a card to filter the list." },
      { target: "customers.controls", title: "Search, focus and sort", body: "Find a customer by name, email or phone, narrow the list, and sort it. Filters never change customer records." },
      { target: "customers.row", title: "Customer rows", body: "Each row shows contact details, bids and projects. Click a customer to open their page.", hint: "Customers you bid for show up here automatically, with their {recurring} history in one place." },
      { target: "customers.new", title: "Add a customer", body: "New customer adds someone before you bid; Create New Bid starts a bid right away." },
    ],
  },
  "customers.detail.overview": {
    route: "/dashboard/customers/[id]",
    label: "Customer · Overview",
    steps: [
      { target: "customer.tabs", title: "Customer sections", body: "Overview, Bids, Projects and Activity for this customer. Switching tabs keeps your place." },
      { target: "customer.contact", title: "Contact details", body: "Phone, email, address and notes. Edit contact changes them here and on future bids.", hint: "Note what matters for {job}, like gate codes or site access." },
      { target: "customer.next", title: "Next action", body: "What needs doing next for this customer, such as a proposal to send or a job to schedule." },
      { target: "customer.activity-summary", title: "Recent activity", body: "The latest bids, signatures and messages, newest first." },
      { target: "customer.comms", title: "Communications", body: "Follow-ups and project update emails for this customer. Nothing sends without review.", requires: { permission: "view_communications" } },
      { target: "customer.new-bid", title: "New bid for this customer", body: "Starts a bid with this customer's details already filled in." },
    ],
  },
  "customers.detail.bids": {
    route: "/dashboard/customers/[id]?tab=bids",
    label: "Customer · Bids",
    steps: [
      { target: "customer.tabs", title: "Customer sections", body: "You're on Bids. Overview, Projects and Activity are one tap away." },
      { target: "customer.bids", title: "Linked bids", body: "Every bid for this customer with its stage and total. Click one to open it." },
      { target: "customer.new-bid", title: "New bid for this customer", body: "Starts a bid with their details already filled in." },
    ],
  },
  "customers.detail.projects": {
    route: "/dashboard/customers/[id]?tab=projects",
    label: "Customer · Projects",
    steps: [
      { target: "customer.tabs", title: "Customer sections", body: "You're on Projects. Overview, Bids and Activity are one tap away." },
      { target: "customer.projects", title: "Projects", body: "Scheduled jobs for this customer with start dates. Click one to open its schedule.", requires: { pmView: true } },
      { target: "customer.projects", title: "Projects", body: "Jobs for this customer appear here once they're scheduled in the Project Command Center.", requires: { pmView: false } },
    ],
  },
  "customers.detail.activity": {
    route: "/dashboard/customers/[id]?tab=activity",
    label: "Customer · Activity",
    steps: [
      { target: "customer.tabs", title: "Customer sections", body: "You're on Activity. Overview, Bids and Projects are one tap away." },
      { target: "customer.activity", title: "Full history", body: "Every bid, signature, email and reply for this customer, newest first." },
    ],
  },
  "customers.communications": {
    route: "/dashboard/customers/communications",
    label: "Customers · Communications",
    requires: { permission: "view_communications" },
    steps: [
      { target: "customers.tabs", title: "Customers and communications", body: "You're on Communications. The directory is one tap away." },
      { target: "customers.comms-center", title: "Follow-ups and project updates", body: "Accept the customer email terms once, apply the recommended settings, then review who's eligible for follow-ups about {recurring}. Nothing sends without your say-so.", feature: "customer_communications" },
    ],
  },

  // ── Projects (Project Command Center) ───────────────────────────────────────────────────────────
  "projects.overview": {
    route: "/projects",
    label: "Projects · Overview",
    requires: { pmView: true },
    steps: [
      { target: "projects.views", title: "Project views", body: "Overview, Calendar, Timeline, Workload and My work all read the same jobs. On smaller screens the last views are under More." },
      { target: "projects.filters", title: "Filters", body: "Narrow by salesperson, project manager, project, status or trade. Filters only change what you see." },
      { target: "projects.metrics", title: "What needs attention", body: "Active projects, what's behind, what's starting and what needs review. Click a card to focus the list." },
      { target: "projects.card", title: "Project cards", body: "Each job shows its customer, dates, progress and next task. Open it for the full schedule.", hint: "A {job} card shows where it is across {phases}." },
      { target: "projects.ready", title: "Ready to schedule", body: "Won or signed bids without a schedule. Schedule Now builds a timeline from the bid's sections.", requires: { pmEdit: true } },
      { target: "projects.ready", title: "Ready to schedule", body: "Won or signed bids waiting for a schedule. A schedule editor on your team builds them.", requires: { pmEdit: false } },
    ],
  },
  "projects.calendar": {
    route: "/projects?view=calendar",
    label: "Projects · Calendar",
    requires: { pmView: true },
    steps: [
      { target: "projects.views", title: "Project views", body: "You're on Calendar: every project's tasks on one calendar." },
      { target: "projects.cal-modes", title: "Month, week or agenda", body: "Switch the layout and move between dates. Your filters stay put." },
      { target: "projects.cal-event", title: "Tasks on the calendar", body: "Each task is colored by project. Click one for its details.", hint: "For {job}, you'll see {phases} laid out by day." },
      { target: "projects.filters", title: "Filters", body: "Show one project, one person or one trade." },
    ],
  },
  "projects.timeline": {
    route: "/projects?view=timeline",
    label: "Projects · Timeline",
    requires: { pmView: true },
    steps: [
      { target: "projects.views", title: "Project views", body: "You're on Timeline: all projects on one Gantt chart." },
      { target: "projects.timeline", title: "The timeline", body: "Each row is a project with its tasks as bars; the red line is today. Dragging a bar opens the task to confirm new dates; nothing changes until you save.", requires: { pmEdit: true } },
      { target: "projects.timeline", title: "The timeline", body: "Each row is a project with its tasks as bars; the red line is today. Click a bar to see the task.", requires: { pmEdit: false } },
      { target: "projects.filters", title: "Filters", body: "Narrow to one project, person or trade." },
    ],
  },
  "projects.workload": {
    route: "/projects?view=workload",
    label: "Projects · Workload",
    requires: { pmView: true },
    steps: [
      { target: "projects.views", title: "Project views", body: "You're on Workload: who is booked, and when." },
      { target: "projects.conflicts", title: "Double-bookings", body: "People or crews booked on two jobs the same day show up here first." },
      { target: "projects.workload-table", title: "Who's booked", body: "One row per person or crew, with their tasks by day. Click a task to see it." },
    ],
  },
  "projects.mywork": {
    route: "/projects?view=mywork",
    label: "Projects · My work",
    requires: { pmView: true },
    steps: [
      { target: "projects.views", title: "Project views", body: "You're on My work: the tasks assigned to you." },
      { target: "projects.mywork", title: "Your tasks", body: "Overdue, today and coming up. Click a task to see it or update progress where you're allowed to." },
    ],
  },
  "projects.list": {
    route: "/projects",
    label: "Projects",
    steps: [
      { target: "projects.schedules", title: "Schedules", body: "Every job schedule with its dates and progress. Click one to open it." },
      { target: "projects.ready", title: "Ready to schedule", body: "Won or signed bids without a schedule. Schedule Now builds a timeline from the bid's sections.", requires: { pmEdit: true } },
      { target: "projects.ready", title: "Ready to schedule", body: "Won or signed bids waiting for a schedule.", requires: { pmEdit: false } },
    ],
  },
  "project.detail": {
    route: "/projects/[id]",
    label: "Project details",
    requires: { pmView: true },
    steps: [
      { target: "project.summary", title: "Project summary", body: "Status, dates, progress, open tasks, salesperson and project manager for this job." },
      { target: "project.tabs", title: "Project tabs", body: "Schedule plus the Trade scope, Documents, Photos and Internal costs tabs your role allows." },
      { target: "project.schedule", title: "The schedule", body: "Tasks from the estimate, such as {phases}. Editors drag or open a task to change dates; changes are drafts until published.", requires: { pmEdit: true } },
      { target: "project.schedule", title: "The schedule", body: "Tasks from the estimate, such as {phases}, with dates and progress. You can view it; a schedule editor makes changes.", requires: { pmEdit: false } },
      { target: "project.updates", title: "Customer updates", body: "Project update emails for this customer. They're reviewed before anything is sent.", requires: { permission: "view_communications" } },
    ],
  },
  "projects.schedule-now": {
    route: "/projects/new?estimate=[id]",
    label: "Schedule Now",
    requires: { pmEdit: true },
    steps: [
      { target: "schedule.steps", title: "Schedule Now, step by step", body: "Source estimate, sections, start date, durations, dependencies, target date, review, assign and save. Nothing is saved until the Save step, and your customer isn't notified." },
      { target: "schedule.step", title: "This step", body: "Fill in this step and choose Next. Back keeps what you've entered.", hint: "For {job}, the tasks come from your estimate's sections: {phases}." },
      { target: ["schedule.calendar", "schedule.calendar-toggle"], title: "Company Calendar", body: "See every other job on the calendar while you pick dates, with overlaps and double-bookings flagged. On smaller screens it opens beside the wizard." },
    ],
  },
  "projects.team": {
    route: "/projects/team",
    label: "Projects · Team & subcontractors",
    requires: { pmView: true },
    steps: [
      { target: "team.directory", title: "Team and subcontractors", body: "Your crew and subs with their trades and contact details, such as {sub}. Assign them to tasks on any schedule." },
      { target: "team.add", title: "Add a person or sub", body: "Add crew members and subcontractors so you can assign them to tasks.", requires: { pmEdit: true } },
    ],
  },

  "projects.workforce": {
    route: "/projects/workforce",
    label: "Projects · Contractors & Workforce",
    requires: { pmView: true },
    steps: [
      { target: "workforce.search", title: "Find who you need", body: "Search by name, company, trade (try \"electrician\"), project or customer." },
      { target: "workforce.cards", title: "Who's booked where", body: "Each card shows active and upcoming jobs, the next scheduled work and availability. Click a card for the full profile." },
      { target: "workforce.assign", title: "Assign to another job", body: "Pick a project and section, set times, review conflicts and confirm. The project schedule updates right away.", requires: { pmEdit: true } },
      { target: "workforce.assignments-tab", title: "Every assignment", body: "All assignments in one list, from planned to completed. It's the same list your project schedules use." },
      { target: "workforce.add", title: "Add companies, workers and crews", body: "Subcontracting companies, their workers, individual subs, employees and crews. Subs don't need a Built2Bid account.", requires: { pmEdit: true } },
    ],
  },

  // ── Libraries ───────────────────────────────────────────────────────────────────────────────────
  "library.items": {
    route: "/dashboard/items",
    label: "Saved Items & Pricing",
    steps: [
      { target: "items.search", title: "Your saved prices", body: "Labor rates, material costs and frequent items, like \"{item}\". Search them here; in any bid, add them in a tap.", requires: { unlimited: true } },
      { target: "items.add", title: "Add an item", body: "Save a new item with its unit and your cost. Nothing is saved until you press Save.", requires: { unlimited: true } },
      { target: "items.locked", title: "Included with Unlimited", body: "Save your own labor rates and material costs, then add them to any bid. Included with Unlimited.", requires: { unlimited: false } },
      { target: "items.generate", title: "Generate your price library", body: "Type your trade or a scope and get a draft list of items to review. The AI never sets a price, and nothing is saved until you approve it." },
    ],
  },
  "library.generate": {
    route: "/dashboard/items/generate",
    label: "Generate My Price Library",
    steps: [
      { target: "generate.describe", title: "Describe your work", body: "A word like \"Concrete\" builds a catalog for your trade. A detailed scope builds the items that job needs. You can pick up to four trades." },
    ],
  },
  "library.generate-review": {
    route: "/dashboard/items/generate",
    label: "Review your price library draft",
    steps: [
      { target: "generate.items", title: "Review by category", body: "Rename items, fix units and remove what you don't use. Changes save as you go, and the draft waits for you if you leave." },
      { target: "generate.toolbar", title: "Find what needs you", body: "Filter to items with no cost or possible duplicates. Items that match something you already saved are flagged so nothing is overwritten by surprise." },
      { target: "generate.more", title: "Add more when you need it", body: "Add labor, equipment, material options or stacks in small batches instead of one huge list." },
      { target: "generate.stacks", title: "Check each stack", body: "Stacks scale with a measurement, like slab area. Check every ratio; saving items never saves a stack." },
      { target: "generate.approve", title: "Approve what's ready", body: "You see exactly what will be added or changed before you confirm. Approved items show up in every bid under Suggested & Saved Items." },
    ],
  },
  "library.templates": {
    route: "/dashboard/templates",
    label: "Proposal Templates",
    steps: [
      { target: "templates.editor", title: "Your proposal defaults", body: "Choose your default style, wording and payment schedule. New bids start with these; you can still change anything per bid.", requires: { unlimited: true }, locked: "Saving your own proposal defaults is included with Unlimited. You can preview the styles here." },
    ],
  },

  // ── Company & account ───────────────────────────────────────────────────────────────────────────
  "settings.company": {
    route: "/settings/company",
    label: "Company profile",
    steps: [
      { target: "company.website", title: "Start from your website", body: "Enter your website and Built2Bid suggests your logo, colors and details; you approve each one." },
      { target: "company.business", title: "Business details", body: "Name, contact, email, phone and address. They appear on every proposal." },
      { target: "company.branding", title: "Logo and colors", body: "Your logo and brand colors make every proposal look like yours." },
      { target: "company.saved", title: "Saved automatically", body: "Changes save as you type. This line tells you when they're saved." },
    ],
  },
  "settings.billing": {
    route: "/settings/billing",
    label: "Subscription",
    steps: [
      { target: "billing.plan", title: "Your plan", body: "Your current plan and what it includes. Nothing changes here unless you choose an option and confirm it in checkout or the billing portal." },
      { target: "billing.credits", title: "Credits", body: "Your monthly and starter credits; each new PDF download uses one. Updates to a finalized bid are free.", requires: { unlimited: false } },
      { target: "billing.manage", title: "Manage billing", body: "Update your card, see invoices or cancel in the secure billing portal.", requires: { unlimited: true } },
      { target: "billing.upgrade", title: "Upgrade options", body: "Compare plans. Choosing one opens secure checkout, where the price is shown before you pay.", requires: { unlimited: false } },
      { target: "billing.pm-addon", title: "Project Command Center add-on", body: "Add project scheduling to your plan. The charge is shown before you confirm." },
    ],
  },
  "settings.account": {
    route: "/settings/account",
    label: "Account settings",
    steps: [
      { target: "account.signin", title: "How you sign in", body: "The email (and phone, where offered) you use to sign in, and whether each is verified." },
      { target: "account.sharing", title: "Pricing data sharing", body: "Choose whether anonymous price data from your bids helps improve local pricing. It's off unless you turn it on." },
      { target: "account.actions", title: "Emails, export and deletion", body: "Choose marketing emails, download all your data any time, or delete your account. Deleting always asks you to confirm first." },
    ],
  },
  "company.overview": {
    route: "/company",
    label: "Company · Overview",
    requires: { company: true, permission: "view_analytics" },
    steps: [
      { target: "company.kpis", title: "Company KPIs", body: "Pipeline value, won value, win rate and bids for your whole team in the period. Click a card for the bids behind it." },
      { target: "company.stages", title: "Pipeline by stage", body: "How many bids sit in each stage across the company." },
      { target: "company.team", title: "Team performance", body: "Bids, wins and value by person." },
      { target: "company.approval", title: "Approval rule", body: "Owners can require approval before team bids are sent.", requires: { owner: true } },
    ],
  },
  "company.pipeline": {
    route: "/company/pipeline",
    label: "Company · Bids & Pipeline",
    requires: { company: true },
    steps: [
      { target: "company.pipeline-filters", title: "Team pipeline filters", body: "Filter the bids you're allowed to see by person, team, stage or date." },
      { target: "company.pipeline-list", title: "Team bids", body: "Every bid you can see with its owner, stage and value. Open one to review it." },
    ],
  },
  "company.users": {
    route: "/company/users",
    label: "Company · Team & Access",
    requires: { company: true },
    steps: [
      { target: "company.members", title: "Your team", body: "Everyone in the company with their role. Roles and permission changes set what each person can see and do; they apply only when you save them." },
      { target: "company.invite", title: "Invite people", body: "Invite a teammate by email. They get access when they accept, within your licensed seats.", requires: { permission: "manage_users" } },
      { target: "company.teams", title: "Teams", body: "Group people into teams, such as a crew per trade. Managers see bids from the teams they belong to.", requires: { permission: "manage_teams" } },
    ],
  },
  "company.proposal-style": {
    route: "/company/proposal-style",
    label: "Company · Proposal & Bid Style",
    requires: { company: true, permission: "view_proposal_style" },
    steps: [
      { target: "style.editor", title: "One look for every bid", body: "Choose the template, colors and details every company bid uses." },
      { target: "style.policy", title: "What your team may change", body: "Decide which parts teammates can customize on their own bids.", requires: { permission: "change_proposal_policy" } },
    ],
  },
  "company.billing": {
    route: "/company/billing",
    label: "Company · Billing & Licenses",
    requires: { company: true, permission: "manage_billing" },
    steps: [
      { target: "company.licenses", title: "Licensed users", body: "How many seats you pay for and how many are in use." },
      { target: "company.seats", title: "Add or remove licenses", body: "Change your seat count. The price change is shown before you confirm." },
      { target: "company.portal", title: "Payment method and invoices", body: "Update your card, see invoices or cancel in the secure billing portal." },
    ],
  },
  // ── Financial Command Center (only reachable when NEXT_PUBLIC_FINANCIALS is on) ───────────────
  "financials.home": {
    route: "/financials",
    label: "Financials",
    steps: [
      { target: "fin.kpis", title: "Headline numbers", body: "Your key money numbers for the period. Each badge says what the number is based on, like Contracted, Invoiced or Paid. Click a number for the records behind it." },
      { target: "fin.attention", title: "Needs attention", body: "Always-on cards for money that needs action, like milestones ready to invoice or overdue invoices. You can't hide these." },
      { target: "fin.alerts", title: "Alerts", body: "Problems Financials found, such as a payment that doesn't match an invoice. Each one says what to check; nothing is changed for you.", hint: "On {job}, alerts point to the exact milestone or cost." },
      { target: "fin.quick", title: "Quick actions", body: "Shortcuts for your kind of work. They open the right job first, and nothing is recorded until you save a form. Press and hold one to move it, or tap Edit to turn more on or off." },
      { target: "fin.cards", title: "Your cards", body: "Cards picked for your trade and role, such as job profit or what's committed to {sub}. Click one for its records, or press and hold to drag it to a new spot." },
      { target: "fin.reports", title: "Reports for your kind of work", body: "Reports that fit how {trade} track money. Ones marked later aren't available yet." },
      { target: "fin.mode", title: "Contractor or Accountant Mode", body: "Accountant Mode adds the bank balance, receivables, payables, the review queue and accounting pages. It only changes what you see, never what you're allowed to do." },
      { target: "fin.contractor-nav", title: "Your shortcuts", body: "Projects, estimates, invoices, customer balances, job profit and cash received, one tap away." },
      { target: "fin.acct-kpis", title: "Accountant numbers", body: "The bank-reported balance comes only from a statement you imported, with its file and import time. Click any number for the records behind it." },
      { target: "fin.acct-queue-summary", title: "In the review queue", body: "How many items need a person in each group. Click a group to work through it." },
      { target: "fin.acct-quick", title: "Accountant quick actions", body: "Reconcile, review, export and audit shortcuts. You only see the ones your role allows." },
      { target: "fin.customize", title: "Customize this page", body: "Show, hide or reorder cards and pick your headline numbers. Restore puts the trade defaults back." },
      { target: "fin.tools", title: "All tools", body: "Every Financials tool in one list, whatever your home page shows." },
      { target: "fin.config", title: "Trade setup", body: "Tell Financials your trades and how you bill. The home page, quick actions and starter cost codes follow it." },
    ],
  },
  "financials.accounting": {
    route: "/financials/accounting",
    label: "Accounting · Review queue",
    steps: [
      { target: "fin.acct-nav", title: "Accounting pages", body: "Review queue, transactions, reconciliation, receivables and payables, accounts, reports and the audit trail." },
      { target: "fin.acct-queue-groups", title: "What needs review", body: "Items are grouped by what's wrong: uncategorized costs, unmatched bank lines, duplicates, unapplied payments, bills and more." },
      { target: "fin.acct-queue", title: "Fix one item", body: "Each item says the next step and opens its record. Missing project or cost code fields can be filled in right here. Nothing is changed for you." },
    ],
  },
  "financials.accounting.transactions": {
    route: "/financials/accounting/transactions",
    label: "Accounting · Transactions",
    steps: [
      { target: "fin.acct-txn-filters", title: "Find a transaction", body: "Search and filter by type, posting status, bank status, project, money in or out, and dates. The CSV download uses the same filters." },
      { target: "fin.acct-txn-table", title: "The transaction list", body: "Every invoice, payment, refund, credit, bill, bill payment and expense, from the same records your team enters. Click a number to open its record." },
    ],
  },
  "financials.accounting.bank": {
    route: "/financials/accounting/bank",
    label: "Accounting · Reconciliation",
    steps: [
      { target: "fin.bank-accounts", title: "Bank accounts", body: "Each account shows the balance of its imported lines and how many lines still need matching." },
      { target: "fin.bank-add", title: "Add a bank account", body: "Just a name, a type and the last 4 digits. Built2Bid never asks for your bank login and can't move money." },
      { target: "fin.bank-import", title: "Import a statement", body: "Upload the CSV, OFX or QFX file from your bank. Check the preview, then import. Lines already imported are skipped." },
      { target: "fin.bank-lines", title: "Match each line", body: "Confirm a suggested match, pick another record with the same amount, exclude it with a reason, or record it as an expense." },
      { target: "fin.bank-reconcile", title: "Confirm a period", body: "Type the statement's ending balance. Differences can only be confirmed with a note, and confirmed lines lock until the period is reopened." },
      { target: "fin.bank-history", title: "History", body: "Confirmed periods and every import, with who did it and when. Reopening needs a reason that stays in the audit trail." },
    ],
  },
  "financials.accounting.reports": {
    route: "/financials/accounting/reports",
    label: "Accounting · Reports",
    steps: [
      { target: "fin.acct-catalog", title: "Search reports", body: "Type a word like aging, labor or 1099. Reports that need the general ledger are listed with what they need and show no numbers." },
      { target: "fin.acct-report", title: "The report", body: "Built from recorded records. Download it as CSV, or print it or save it as a PDF." },
    ],
  },
  "financials.accounting.audit": {
    route: "/financials/accounting/audit",
    label: "Accounting · Audit trail",
    steps: [
      { target: "fin.acct-audit-filters", title: "Filter the trail", body: "Search any value, or narrow to invoices, payments, bank work or exports between two dates." },
      { target: "fin.acct-audit-list", title: "Who did what", body: "Each entry shows the person, the action, the record and the before and after values. Entries can't be edited, and tax IDs and account numbers are hidden." },
    ],
  },
  "financials.accounting.accounts": {
    route: "/financials/accounting/accounts",
    label: "Accounting · Chart of accounts",
    steps: [
      { target: "fin.acct-groups", title: "Balance groups", body: "Receivables, payables, your bank accounts and income. A full double-entry chart of accounts comes with the general ledger." },
      { target: "fin.acct-codes", title: "Cost codes", body: "Every bill line and expense is classified with one of these codes, grouped by trade." },
    ],
  },
  "financials.records": {
    route: "/financials/records",
    label: "Financials · Records",
    steps: [
      { target: "fin.record-tabs", title: "Record types", body: "Jobs, milestones, invoices, payments, costs, commitments, alerts and items that need review. Every number on the home page opens one of these lists." },
      { target: "fin.won-bids", title: "Won bids without financials", body: "Won bids that don't have job financials yet. Open one to set up its contract and payment schedule." },
      { target: "fin.records-list", title: "The records", body: "Each row shows the amount, what it's based on and its status. Click a row for that job's financials.", hint: "For {job}, the job row compares contract, invoiced and actual cost." },
    ],
  },
  "financials.overhead": {
    route: "/financials/overhead",
    label: "Financials · Overhead & bills",
    steps: [
      { target: "fin.overhead-form", title: "Add a company cost", body: "Rent, insurance, software, vehicles or office payroll: anything that isn't for a customer project. Mark it paid, partly paid or not paid yet, and attach the bill if you have it." },
      { target: "fin.overhead-open", title: "Bills still to pay", body: "Unpaid overhead bills by due date. They show in your cash-flow forecast. Record a payment here when you pay one outside Built2Bid." },
      { target: "fin.overhead-recurring", title: "Recurring costs", body: "Costs that repeat are planned in the cash-flow forecast. When the real bill arrives, choose Enter this bill and the plan moves to the next date, so nothing is counted twice." },
    ],
  },
  "financials.tools": {
    route: "/financials/tools",
    label: "Financials · All tools",
    steps: [
      { target: "fin.tool-groups", title: "Every tool, grouped", body: "Getting paid, job costs, cleanup and settings. Tools outside your role are greyed out, and ones coming later say when." },
    ],
  },
  "financials.job": {
    route: "/financials/jobs/[id]",
    label: "Job financials",
    steps: [
      { target: "fin.open-job", title: "Start job financials", body: "Once a bid is won, opening job financials locks in the contract amount and signed payment schedule. It doesn't create an invoice or send anything." },
    ],
  },
  "financials.job.billing": {
    route: "/financials/jobs/[id]",
    label: "Job financials · Billing",
    steps: [
      { target: "fin.job-tabs", title: "Billing, costs and review", body: "Switch between getting paid, what the job costs and items that need a second look." },
      { target: "fin.alerts", title: "Job alerts", body: "Anything on this job that doesn't add up, with what to check." },
      { target: "fin.contract", title: "The contract", body: "The amount from the signed proposal, plus approved change orders. Invoices are checked against it." },
      { target: "fin.milestones", title: "Payment milestones", body: "The payment schedule from the proposal. Each milestone shows when it's ready to invoice and what's been paid.", hint: "For {job}, milestones often follow {phases}." },
      { target: "fin.invoices", title: "Invoices", body: "Drafts and issued invoices with what's still owed. A draft isn't sent to anyone." },
      { target: "fin.payments", title: "Payments", body: "Payments you've recorded and whether they're verified. Recording a payment doesn't charge anyone." },
    ],
  },
  "financials.job.costs": {
    route: "/financials/jobs/[id]#costs",
    label: "Job financials · Costs",
    steps: [
      { target: "fin.job-tabs", title: "Billing, costs and review", body: "Switch between getting paid, what the job costs and items that need a second look." },
      { target: "fin.cost-actions", title: "Add a cost", body: "Record an expense, enter a vendor bill or commit a sub quote. Each opens a form; nothing is saved until you save it.", hint: "Typical costs here are {materials} and {sub}." },
      { target: "fin.budget", title: "Budget vs actual", body: "Your estimate's costs by cost code next to what's committed and spent so far." },
      { target: "fin.profit", title: "Job profit", body: "Contract value minus costs, so you can see the margin while the job is still running." },
      { target: "fin.cost-lists", title: "Expenses, bills and commitments", body: "Every cost on the job with its status, such as waiting for approval." },
    ],
  },
  "financials.job.review": {
    route: "/financials/jobs/[id]#review",
    label: "Job financials · Needs review",
    steps: [
      { target: "fin.job-tabs", title: "Billing, costs and review", body: "Switch between getting paid, what the job costs and items that need a second look." },
      { target: "fin.review", title: "Needs review", body: "Items Financials couldn't file on its own, like a cost without a cost code. People with approval access resolve them here." },
    ],
  },
  "company.business-config": {
    route: "/company/business-config",
    label: "Business & Trade Configuration",
    steps: [
      { target: "fin.trade-config", title: "Your trades and billing", body: "Pick your main trade, any others, your market and how you bill. Changes apply when you save.", hint: "For {trade}, the preset suggests starter cost codes for {materials}." },
      { target: "fin.config-preview", title: "Preview", body: "What your Financials home, quick actions and reports will look like with these choices, before you save." },
    ],
  },
  "company.ai-automation": {
    route: "/company/ai-automation",
    label: "AI & Automation",
    steps: [
      { target: "fin.ai-toggles", title: "Opt-in AI features", body: "Each AI feature is off until you turn it on, and says what it does. Balances, invoices and reports never depend on AI." },
    ],
  },
  "whats-new": {
    route: "/whats-new",
    label: "What's New",
    steps: [
      { target: "whats-new.releases", title: "Release notes", body: "Every release with what changed and who it's for, newest first." },
      { target: "whats-new.tour", title: "Take the feature walkthrough", body: "Walks through the newest features you can use, right where you are." },
    ],
  },

  // ── Platform owner (kept separate; only shown to platform super admins) ─────────────────────────
  admin: {
    route: "/admin/*",
    label: "Owner command center",
    requires: { admin: true },
    steps: [
      { target: "admin.nav", title: "Command center sections", body: "Overview, revenue, customers, marketing, operations and costs for the whole platform. Owner only." },
      { target: "admin.tools", title: "Tools", body: "Operational tools such as complimentary access, templates, flags and logs. Each one asks before it changes anything." },
      { target: "admin.test-data", title: "Test data", body: "Include or hide test accounts in the reports. It only changes what you see." },
      { target: "admin.exit", title: "Back to your account", body: "Exit returns to your own Built2Bid dashboard." },
    ],
  },
} as const satisfies Record<string, PageGuide>;

export type PageKey = keyof typeof PAGE_GUIDES;
export const isPageKey = (k: unknown): k is PageKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(PAGE_GUIDES, k);

/** A step ready to show: copy filled for the trade, plus whether it explains a locked control. */
export interface ResolvedStep {
  key: string;
  targets: string[];
  title: string;
  body: string;
  hint?: string;
  reveal?: string;
  locked: boolean;
}

export function fill(text: string, g: TradeGroup): string {
  const v = TRADE_VOCAB[g];
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k as keyof Vocab] : m));
}

/**
 * The steps this person should see on this page, in order. Steps for features that aren't released
 * or that the plan doesn't include are dropped (or explained, when the step has `locked` copy).
 */
export function resolveGuide(page: PageKey, ctx: GuideContext, trade: TradeGroup = "general"): ResolvedStep[] {
  const guide: PageGuide = PAGE_GUIDES[page];
  if (!meets(guide.requires, ctx)) return [];
  const out: ResolvedStep[] = [];
  guide.steps.forEach((s, i) => {
    const f = s.feature ? getFeature(s.feature) : undefined;
    if (f && f.status !== "released") return;
    const featureOk = !f || f.entitlement === "free" || (f.entitlement === "unlimited" && ctx.unlimited) || (f.entitlement === "pm" && (ctx.pm.view || ctx.pm.edit));
    const ok = featureOk && meets(s.requires, ctx);
    if (!ok && !s.locked) return;
    out.push({
      key: `${page}:${i}`,
      targets: typeof s.target === "string" ? [s.target] : [...s.target],
      title: fill(s.title, trade),
      body: fill(ok ? s.body : s.locked!, trade),
      hint: ok && s.hint ? fill(s.hint, trade) : undefined,
      reveal: s.reveal,
      locked: !ok,
    });
  });
  return out;
}
