/**
 * Versioned feature registry: the single source of truth for what Built2Bid can do, who gets it,
 * where it lives in the app and how it is explained. It powers feature locks and upgrade copy
 * (PREMIUM_FEATURES), the "Your New Features Are Ready" modal, the feature walkthrough, the
 * What's New page and contextual help.
 *
 * Rules (enforced by tests/feature-registry.test.ts, which CI runs on every pull request):
 * - A PR that adds or changes user-facing functionality updates its entry here in the same PR.
 * - Every premium (entitlement "unlimited") feature has an entry with complete copy.
 * - Every `data-feature="<id>"` in the app names an entry, and every released entry with a `target`
 *   has that target somewhere in the app.
 * - `release` must name an entry in RELEASES. Features with status "unreleased" are never shown.
 * Release notes are written by people in this file; nothing is generated from code changes.
 */

/**
 * What a feature needs. "free" = every account; "unlimited" = Unlimited subscription, Enterprise or
 * complimentary access (library_access()); "pm" = project scheduling editor (pm_entitlement()).
 */
export type Entitlement = "free" | "unlimited" | "pm";

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
}

/** Newest last. */
export const RELEASES = [
  { version: "3.0.0", date: "2026-11-14", title: "Saved items and proposal templates" },
  { version: "4.0.0", date: "2026-11-15", title: "Sales pipeline and internal cost reports" },
] as const satisfies readonly Release[];

export type ReleaseVersion = (typeof RELEASES)[number]["version"];

interface FeatureInput {
  name: string;
  entitlement: Entitlement;
  /** Where the feature lives. */
  route: string;
  /** `data-feature` value on the control the walkthrough highlights, when there is one. */
  target?: string;
  /**
   * Bids dashboard view (Pipeline, Table or Analytics) the walkthrough switches to before it looks
   * for `target`, when the control only exists in that view. Without it the step would point at a
   * control that isn't rendered and say "This isn't on the current screen".
   */
  view?: "pipeline" | "table" | "analytics";
  /** One sentence, plain language. */
  description: string;
  /** Upgrade copy for locked accounts (premium features). */
  pitch?: string;
  walkthrough: { title: string; body: string; cta?: string };
  release: ReleaseVersion;
  status: "released" | "unreleased";
}

const DEFS = {
  library: {
    name: "Saved Items & Pricing",
    entitlement: "unlimited",
    route: "/dashboard/items",
    target: "library",
    description: "Save your labor rates, material costs and frequently used items, then add them to any bid in a tap.",
    pitch: "Save your labor rates, material costs, and frequently used estimating items. Included with Unlimited.",
    walkthrough: { title: "Reuse your prices", body: "Keep your own labor and material prices here. In any estimate, add saved items instead of typing them again.", cta: "Open Saved Items" },
    release: "3.0.0",
    status: "released",
  },
  templates: {
    name: "Proposal Templates",
    entitlement: "unlimited",
    route: "/dashboard/templates",
    target: "templates",
    description: "Customize and reuse proposal layouts, wording and defaults across bids.",
    pitch: "Customize and reuse professional proposal layouts. Included with Unlimited.",
    walkthrough: { title: "Proposals your way", body: "Set up your proposal layout and default wording once. Every new bid starts from it.", cta: "Open Templates" },
    release: "3.0.0",
    status: "released",
  },
  pipeline: {
    name: "Sales pipeline",
    entitlement: "free",
    route: "/dashboard?view=pipeline",
    target: "pipeline",
    view: "pipeline",
    description: "See every bid as a card from Draft to Won, drag it to a new stage, and see what's next for each one.",
    walkthrough: { title: "Your bids as a pipeline", body: "Each column is a sales stage. Drag a card or use its menu to move it. A signed bid moves to Won by itself.", cta: "Show pipeline" },
    release: "4.0.0",
    status: "released",
  },
  analytics: {
    name: "Sales analytics",
    entitlement: "free",
    route: "/dashboard?view=analytics",
    target: "analytics",
    view: "analytics",
    description: "Bids sent, won and lost, win rate and average job size for any date range.",
    walkthrough: { title: "How sales are going", body: "Pick a date range to see bids sent, approved and declined, your win rate and average bid.", cta: "Show analytics" },
    release: "4.0.0",
    status: "released",
  },
  sales_pay: {
    name: "Sales pay calculator",
    entitlement: "free",
    route: "/dashboard?view=analytics",
    target: "sales_pay",
    view: "analytics",
    description: "A private planning calculator for commission on won bids. Your settings are visible only to you.",
    walkthrough: { title: "Estimate your sales pay", body: "Choose percent of sale, percent of profit or a flat amount per job to estimate pay on won bids. It never changes bid prices." },
    release: "4.0.0",
    status: "released",
  },
  internal_report: {
    name: "Internal Estimate Report",
    entitlement: "unlimited",
    route: "/dashboard?view=table",
    target: "internal_report",
    // On the dashboard this highlights the first bid's Open link in the Table view; inside a bid it
    // highlights the Internal report button itself.
    view: "table",
    description: "A private PDF of costs, markup, margin and profit by section and line item. Never shown to customers.",
    pitch: "A private PDF of your costs, markup, margin and profit by section and line item, for you and your team. Never shown to customers. Included with Unlimited and Enterprise.",
    walkthrough: { title: "Know your numbers", body: "Open any saved bid and choose Internal report in the header to preview, download or email your private cost and profit report.", cta: "Open a bid" },
    release: "4.0.0",
    status: "released",
  },
  project_scheduling: {
    name: "Project Command Center",
    entitlement: "pm",
    route: "/projects",
    description: "Turn won bids into job schedules with a visual timeline, tasks from your estimate, progress tracking and customer schedule updates.",
    pitch: "Schedule won jobs on a visual timeline built from your estimate. $4.99/month add-on for Unlimited; one editor included with Enterprise.",
    walkthrough: { title: "Schedule the job", body: "Choose Schedule Now on a won bid to build a timeline from its sections, then drag tasks to adjust dates." },
    release: "4.0.0",
    // Billing and entitlements ship first (Phase 5); the scheduler itself ships in Phases 6-7.
    status: "unreleased",
  },
} as const satisfies Record<string, FeatureInput>;

export type FeatureId = keyof typeof DEFS;
export type PremiumFeatureId = { [K in FeatureId]: (typeof DEFS)[K]["entitlement"] extends "unlimited" ? K : never }[FeatureId];

export interface Feature extends FeatureInput {
  id: FeatureId;
}

export const FEATURES: readonly Feature[] = (Object.keys(DEFS) as FeatureId[]).map((id) => ({ id, ...(DEFS[id] as FeatureInput) }));

export function getFeature(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}

export const LATEST_RELEASE: Release = RELEASES[RELEASES.length - 1];

/** Compares dotted versions numerically ("4.10.0" > "4.9.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
