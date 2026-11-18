/**
 * Dashboard layout resolution: code defaults (role + profile) <- company defaults (with locks) <- role
 * layout <- the user's own preferences. Essential alerts are always shown (the database also refuses to
 * store them hidden); cards the user has no permission for are dropped (presentation only: the RLS and
 * RPC checks are the real gate). Contractor Mode is the default; Accountant Mode only when authorized.
 */
import { canUseAccountantMode, type FinRole } from "../permissions";
import { CARDS, ESSENTIAL_ALERT_KEYS, KPI_KEYS, QUICK_ACTIONS, QUICK_ACTION_NEEDS, type CardKey, type KpiKey, type QuickAction } from "./catalog";
import type { ResolvedProfile } from "./engine";

export type DashboardRole = "owner" | "sales_rep" | "project_manager" | "bookkeeper" | "view_only" | "financial_admin" | "accountant";
export type Mode = "contractor" | "accountant";

/** Role-aware default layouts (before the profile adds trade cards). */
export const ROLE_DEFAULT_CARDS: Record<DashboardRole, readonly CardKey[]> = {
  owner: ["ar_aging", "job_profitability", "milestones_ready", "deposits_outstanding", "payments_received", "budget_vs_actual", "open_commitments", "bills_to_approve", "expenses_to_approve", "cash_position", "tax_updates"],
  financial_admin: ["ar_aging", "milestones_ready", "invoices_to_send", "payments_received", "bills_to_approve", "expenses_to_approve", "job_profitability", "budget_vs_actual"],
  bookkeeper: ["invoices_to_send", "milestones_ready", "payments_received", "ar_aging", "bills_to_approve", "open_commitments"],
  accountant: ["ar_aging", "payments_received", "job_profitability", "export_center", "audit_trail"],
  project_manager: ["my_jobs", "budget_vs_actual", "open_commitments", "my_expenses", "change_orders_billing", "milestones_ready"],
  sales_rep: ["my_jobs_billing", "deposits_outstanding", "change_orders_billing", "milestones_ready"],
  view_only: ["ar_aging", "job_profitability", "budget_vs_actual"],
};
export const ROLE_DEFAULT_KPIS: Record<DashboardRole, readonly KpiKey[]> = {
  owner: ["contract_value", "collected", "ar_outstanding", "projected_margin"],
  financial_admin: ["invoiced", "collected", "ar_outstanding", "overdue_amount"],
  bookkeeper: ["invoiced", "collected", "overdue_amount", "committed_cost"],
  accountant: ["invoiced", "collected", "ar_outstanding", "actual_cost"],
  project_manager: ["contract_value", "actual_cost", "committed_cost", "projected_margin"],
  sales_rep: ["contract_value", "invoiced", "collected"],
  view_only: ["contract_value", "ar_outstanding"],
};

export const dashboardRoleFor = (role: FinRole | null | undefined): DashboardRole => role ?? "view_only";

export interface CardPref { key: string; visible?: boolean }
export interface SavedView { name: string; filters: { estimateIds?: string[]; trades?: string[]; from?: string; to?: string } }
/** quick_actions: null/absent = no choice at this level; an array (even empty) is the choice, in order. */
export interface StoredPrefs { cards?: CardPref[]; kpis?: string[]; saved_views?: SavedView[]; collapsed_sections?: string[]; locked_cards?: string[]; quick_actions?: string[] | null }

export interface LayoutInput {
  profile: ResolvedProfile;
  role: FinRole | null;
  permissions: readonly string[];
  mode?: Mode | null;
  company?: StoredPrefs | null;
  roleLayout?: StoredPrefs | null;
  user?: StoredPrefs | null;
}

export interface ResolvedCard { key: CardKey; visible: boolean; locked: boolean; essential: boolean }
export interface ResolvedLayout {
  mode: Mode;
  cards: ResolvedCard[];
  kpis: KpiKey[];
  /** Quick actions in order, already filtered to the person's permissions. */
  quickActions: QuickAction[];
  /** Where the quick actions came from: the person's own choice, the company/role default, or the trade profile. */
  quickActionsFrom: "user" | "company" | "profile";
  savedViews: SavedView[];
  collapsedSections: string[];
}

const isCard = (k: string): k is CardKey => k in CARDS;
const isKpi = (k: string): k is KpiKey => (KPI_KEYS as readonly string[]).includes(k);
export const isQuickAction = (k: string): k is QuickAction => (QUICK_ACTIONS as readonly string[]).includes(k);

/**
 * Apply one stored layer: the cards it mentions come first in its order (with its visibility), then the
 * cards it didn't mention in their previous order. Frozen (locked) cards keep their previous position.
 */
function applyLayer(prev: { key: CardKey; visible: boolean }[], layer: CardPref[] | undefined, frozen: Set<CardKey>): { key: CardKey; visible: boolean }[] {
  if (!layer?.length) return prev;
  const mentioned: { key: CardKey; visible: boolean }[] = [];
  for (const p of layer) {
    if (!isCard(p.key) || frozen.has(p.key) || mentioned.some((c) => c.key === p.key)) continue;
    mentioned.push({ key: p.key, visible: p.visible ?? true });
  }
  const seen = new Set(mentioned.map((c) => c.key));
  const movable = [...mentioned, ...prev.filter((c) => !seen.has(c.key) && !frozen.has(c.key))];
  const out = [...movable];
  prev.forEach((c, i) => { if (frozen.has(c.key)) out.splice(Math.min(i, out.length), 0, c); });
  return out;
}

export function resolveLayout(input: LayoutInput): ResolvedLayout {
  const role = dashboardRoleFor(input.role);
  const mode: Mode = input.mode === "accountant" && canUseAccountantMode(input.permissions) ? "accountant" : "contractor";
  const allowed = (k: CardKey) => CARDS[k].needs.every((n) => input.permissions.includes(n)) && (!CARDS[k].accountantOnly || mode === "accountant");

  // 1. Code defaults: essential alerts, then the role's cards, then the profile's cards.
  let cards = [...ESSENTIAL_ALERT_KEYS, ...ROLE_DEFAULT_CARDS[role], ...input.profile.cards, ...(mode === "accountant" ? (["export_center", "audit_trail"] as CardKey[]) : [])]
    .filter((k, i, a) => a.indexOf(k) === i)
    .map((key) => ({ key, visible: true }));

  // 2. Company defaults, 3. role layout, 4. user preferences. Locked company cards can't be moved or hidden by users.
  const locks = new Set((input.company?.locked_cards ?? []).filter(isCard));
  cards = applyLayer(cards, input.company?.cards, new Set());
  cards = applyLayer(cards, input.roleLayout?.cards, new Set());
  cards = applyLayer(cards, input.user?.cards, locks);

  const resolved = cards.filter((c) => allowed(c.key)).map((c) => {
    const essential = CARDS[c.key].essential === true;
    const locked = locks.has(c.key);
    return { key: c.key, visible: essential || locked || c.visible, locked, essential };
  });

  const kpis = (input.user?.kpis ?? input.roleLayout?.kpis ?? input.company?.kpis ?? ROLE_DEFAULT_KPIS[role]).filter(isKpi);
  // Quick actions: the first level that made a choice wins (user, role, company), else the trade profile.
  const has = (p?: StoredPrefs | null) => Array.isArray(p?.quick_actions);
  const quickFrom = has(input.user) ? "user" : has(input.roleLayout) || has(input.company) ? "company" : "profile";
  const quickRaw = (has(input.user) ? input.user!.quick_actions : has(input.roleLayout) ? input.roleLayout!.quick_actions : has(input.company) ? input.company!.quick_actions : input.profile.quickActions) ?? [];
  const quickActions = quickRaw.filter(isQuickAction).filter((q, i, a) => a.indexOf(q) === i && input.permissions.includes(QUICK_ACTION_NEEDS[q]));

  return {
    mode,
    cards: resolved,
    kpis: kpis.length ? kpis : [...ROLE_DEFAULT_KPIS[role]],
    quickActions,
    quickActionsFrom: quickFrom,
    savedViews: input.user?.saved_views ?? [],
    collapsedSections: input.user?.collapsed_sections ?? [],
  };
}
