/**
 * Effective workspace & feature access (V6.7). Pure and client-safe: the same function answers "what can I
 * see" for the signed-in person (from database-computed permissions) and "what will this employee see" in the
 * access editor's preview (from the unsaved draft). It never grants anything: it only reads permissions the
 * database already enforces, then hides what a plan, seat or profile setting rules out.
 *
 * Precedence, highest first (V6.7 §6):
 *   1. Platform security (RLS / database functions: they decide what records come back at all).
 *   2. Subscription and licensed entitlements (License): a grant can't bypass a missing seat or add-on.
 *   3-4. Primary account holder policies and company restrictions (policy.denied / policy.locked).
 *   5. User-specific grants and denies (permissions_granted / permissions_revoked; a deny always wins).
 *   6. Role-template defaults (company_role_permissions + the financial seat's role preset).
 */
import { PERMISSION_KEYS, ROLE_PERMISSIONS, effectivePermissions, type CompanyRole, type Permission } from "@/lib/enterprise/permissions";
import { FIN_PERMISSION_KEYS, FIN_ROLE_PERMISSIONS, type FinRole } from "@/lib/financials/permissions";
import {
  FEATURES, FEATURE_BY_ID, NONE, WORKSPACES, levelFromPerms, levelIndex, meets, permsForLevel,
  type CapabilityRequirement, type Feature, type FeatureId, type LevelKey, type License, type SectionId, type WorkspaceId,
} from "./capabilities";

export const ACCESS_PROFILE_VERSION = 1;

/**
 * Home pages an admin can assign a person (Team & Access). Each is a starting Home layout
 * (src/lib/dashboard/templates.ts uses the same keys). The person's own customized Home still wins.
 */
export const HOME_PAGES = {
  sales: { label: "Sales & estimating", blurb: "Bids awaiting signature, drafts, win rate, pipeline and recent estimates." },
  job: { label: "Project manager", blurb: "Active jobs, schedule, overdue tasks, crew time and job costs." },
  financial: { label: "Financial", blurb: "Bank and projected balance, AR and AP, P&L, reconciliation and alerts." },
  simple: { label: "Everything (simple)", blurb: "A little of everything: bids, projects, invoices and cash." },
} as const;
export type HomePage = keyof typeof HOME_PAGES;
export const HOME_PAGE_KEYS = Object.keys(HOME_PAGES) as HomePage[];
export const isHomePage = (v: unknown): v is HomePage => typeof v === "string" && Object.hasOwn(HOME_PAGES, v);

/** Stored per member (company_members.access_profile). UI intent only; permissions stay in granted/revoked. */
export interface AccessProfile {
  v: number;
  template?: string | null;
  /** Assigned Home page (HOME_PAGES); null/absent = pick automatically from their access. */
  home?: HomePage | null;
  /** false = master toggle off (the workspace's navigation is hidden except labelled exceptions). */
  workspaces?: Partial<Record<WorkspaceId, boolean>>;
  /** App-gated features switched off (no permission backs them). */
  app?: Partial<Record<FeatureId, "none" | "use">>;
}

export interface AccessPolicy {
  /** Company-wide restriction: no member except the primary account holder holds these. */
  denied: string[];
  /** Only the primary account holder may change these for anyone. */
  locked: string[];
}

export interface Licenses { pm: boolean; pmEditor: boolean; financials: boolean; premium: boolean }

export interface AccessInput {
  company: null | {
    id: string; name: string; role: CompanyRole; isOwner: boolean;
    /** Company permissions as the database computes them (member_permissions). */
    perms: readonly string[];
    profile: AccessProfile | null;
    policy: AccessPolicy;
    /** Explicit revocations (permissions_revoked). Lets "turned off for you" win over "needs a seat" in messages. */
    revoked?: readonly string[];
  };
  /** Financial permissions on the current book as the database computes them (fin_has_permission); null = no book access. */
  finPerms: readonly string[] | null;
  licenses: Licenses;
}

export type Blocked = License | "policy";
export interface FeatureAccess { level: LevelKey; blocked?: Blocked; exception?: boolean }
export type WorkspaceState = "full" | "limited" | "off";

export interface EffectiveAccess {
  version: 1;
  company: null | { id: string; name: string; role: CompanyRole; isOwner: boolean };
  features: Record<FeatureId, FeatureAccess>;
  workspaces: Record<WorkspaceId, { state: WorkspaceState; visible: boolean; exceptions: FeatureId[] }>;
  /** Template the admin last applied (shown in the editor; dashboards may use it to pick a starting layout). */
  template: string | null;
  /** Home page the admin assigned (null = automatic). */
  home: HomePage | null;
}

const FIN = new Set<string>(FIN_PERMISSION_KEYS);
const licensed = (l: License | undefined, lic: Licenses) => !l || (l === "pm" ? lic.pm : l === "pm_editor" ? lic.pm && lic.pmEditor : l === "financials" ? lic.financials : lic.premium);

/** Cap a level at the last step whose license is available. */
function capByLicense(f: Feature, level: LevelKey, lic: Licenses): FeatureAccess {
  if (!licensed(f.license, lic)) return { level: NONE, blocked: f.license };
  if (level === NONE) return { level };
  const idx = levelIndex(f, level);
  for (let i = 0; i <= idx; i++) {
    const need = f.options[i].license;
    if (need && !licensed(need, lic)) return { level: i === 0 ? NONE : f.options[i - 1].key, blocked: need };
  }
  return { level };
}

export function resolveAccess(input: AccessInput): EffectiveAccess {
  const c = input.company;
  const features = {} as Record<FeatureId, FeatureAccess>;
  const profile = c?.profile ?? null;
  const allPerms = new Set<string>([...(c ? c.perms : PERMISSION_KEYS).filter((p) => !FIN.has(p)), ...(input.finPerms ?? [])]);
  for (const f of FEATURES as readonly Feature[]) {
    const id = f.id as FeatureId;
    let level: LevelKey;
    if (!c) {
      // Solo account: everything its plan allows (no company administration).
      level = f.section === "admin" ? NONE : f.section === "financials" ? levelFromPerms(f, allPerms) : f.options[f.options.length - 1].key;
    } else if (c.isOwner) {
      level = f.section === "financials" ? levelFromPerms(f, allPerms) : f.options[f.options.length - 1].key;
    } else if (f.appGated) {
      const ws = f.section as WorkspaceId;
      const explicit = profile?.app?.[id];
      level = explicit === "none" ? NONE : explicit === "use" ? f.options[0].key : profile?.workspaces?.[ws] === false ? NONE : f.options[0].key;
    } else {
      level = levelFromPerms(f, allPerms);
    }
    const capped = capByLicense(f, level, input.licenses);
    // Switched off by the company (workspace off, or the feature's first step explicitly revoked): that's the
    // reason to show, not a missing seat, so navigation hides it and URL guards apply.
    if (c && !c.isOwner && capped.level === NONE && capped.blocked && capped.blocked !== "policy"
        && (level === NONE || profile?.workspaces?.[f.section as WorkspaceId] === false)
        && (profile?.workspaces?.[f.section as WorkspaceId] === false
          || (f.appGated ? profile?.app?.[id] === "none" : f.options[0].perms.every((p) => c.revoked?.includes(p))))) delete capped.blocked;
    if (c && !c.isOwner && f.section !== "admin" && profile?.workspaces?.[f.section as WorkspaceId] === false && capped.level !== NONE) capped.exception = true;
    if (c && !c.isOwner && capped.level === NONE && !capped.blocked && f.options.some((x) => x.perms.some((p) => c.policy.denied.includes(p)))) capped.blocked = "policy";
    features[id] = capped;
  }
  const workspaces = {} as EffectiveAccess["workspaces"];
  for (const ws of WORKSPACES) {
    const list = (FEATURES as readonly Feature[]).filter((f) => f.section === ws);
    const on = list.filter((f) => features[f.id as FeatureId].level !== NONE);
    const off = Boolean(c && !c.isOwner && profile?.workspaces?.[ws] === false);
    const exceptions = off ? on.map((f) => f.id as FeatureId) : [];
    const full = !off && list.every((f) => {
      const a = features[f.id as FeatureId];
      return a.blocked || levelIndex(f, a.level) === f.options.length - 1;
    });
    workspaces[ws] = { state: on.length === 0 || (off && !exceptions.length) ? "off" : full ? "full" : "limited", visible: on.length > 0, exceptions };
  }
  return {
    version: 1,
    company: c ? { id: c.id, name: c.name, role: c.role, isOwner: c.isOwner } : null,
    features, workspaces, template: profile?.template ?? null, home: profile?.home ?? null,
  };
}

/** Does the person have this capability? (Widgets, nav links, actions.) */
export function hasCapability(access: EffectiveAccess | null | undefined, req: CapabilityRequirement): boolean {
  if (!access) return false;
  const f = FEATURE_BY_ID[req.feature];
  const a = access.features[req.feature];
  return Boolean(f && a && meets(f, a.level, req.level));
}
/**
 * Turned off for this person by their company access settings (not by a missing plan, seat or add-on, where
 * the page's own upgrade or "needs a seat" message applies). Solo accounts and the primary account holder are
 * never restricted.
 */
export function restrictedFor(access: EffectiveAccess | null | undefined, req: CapabilityRequirement): boolean {
  if (!access?.company || access.company.isOwner || hasCapability(access, req)) return false;
  const a = access.features[req.feature];
  return !a || !a.blocked || a.blocked === "policy";
}
export const hasAll = (access: EffectiveAccess | null | undefined, reqs: readonly CapabilityRequirement[]) => reqs.every((r) => hasCapability(access, r));
export const workspaceVisible = (access: EffectiveAccess | null | undefined, ws: WorkspaceId) => Boolean(access?.workspaces[ws]?.visible);

// ---------------------------------------------------------------------------------------------------------
// Editing another member: draft -> granted / revoked (+ profile), and the preview input.
// ---------------------------------------------------------------------------------------------------------

/** Role defaults for a member: company role permissions + their financial seat role preset (if any). */
export function baseFor(role: CompanyRole, finRole: FinRole | null): Set<string> {
  return new Set<string>([...ROLE_PERMISSIONS[role], ...(finRole ? FIN_ROLE_PERMISSIONS[finRole] : [])]);
}

/** A member's current permission set (company + financial) the way the database computes it. */
export function memberPermSet(role: CompanyRole, granted: readonly string[], revoked: readonly string[], finRole: FinRole | null): Set<string> {
  const company = effectivePermissions(role, granted, revoked);
  const fin = finRole ? FIN_PERMISSION_KEYS.filter((k) => (FIN_ROLE_PERMISSIONS[finRole].includes(k) || granted.includes(k)) && !revoked.includes(k)) : [];
  return new Set<string>([...company.filter((k) => !FIN.has(k)), ...fin, ...granted.filter((k) => FIN.has(k) && !revoked.includes(k))]);
}

/** Final permission set -> the arrays update_company_member / company_member_access_save store. */
export function compilePerms(role: CompanyRole, perms: ReadonlySet<string>, finRole: FinRole | null, denied: readonly string[] = []) {
  const base = baseFor(role, finRole);
  const keys = PERMISSION_KEYS as readonly Permission[];
  const granted = keys.filter((k) => perms.has(k) && !base.has(k) && !denied.includes(k));
  const revoked = keys.filter((k) => !perms.has(k) && base.has(k));
  return { granted, revoked };
}

/** Set one feature to a level inside a draft permission set (replaces that feature's permissions only). */
export function setLevel(perms: ReadonlySet<string>, feature: FeatureId, level: LevelKey): Set<string> {
  const f = FEATURE_BY_ID[feature];
  const next = new Set(perms);
  for (const opt of f.options) for (const p of opt.perms) next.delete(p);
  for (const p of permsForLevel(f, level)) next.add(p);
  return next;
}

// ---------------------------------------------------------------------------------------------------------
// Role templates (V6.7 §5): starting points, customizable per person.
// ---------------------------------------------------------------------------------------------------------
export interface RoleTemplate {
  id: string; label: string; role: Exclude<CompanyRole, "owner">; blurb: string;
  levels: Partial<Record<FeatureId, LevelKey>>;
  off?: WorkspaceId[];
  app?: Partial<Record<FeatureId, "none" | "use">>;
  /** Home page the template assigns. */
  home?: HomePage;
}

const ALL_NONE = (section: SectionId): Partial<Record<FeatureId, LevelKey>> =>
  Object.fromEntries((FEATURES as readonly Feature[]).filter((f) => f.section === section && !f.appGated).map((f) => [f.id, NONE]));
const MAX = (section: SectionId, except: FeatureId[] = []): Partial<Record<FeatureId, LevelKey>> =>
  Object.fromEntries((FEATURES as readonly Feature[]).filter((f) => f.section === section && !f.appGated && !f.ownerOnly && !except.includes(f.id as FeatureId)).map((f) => [f.id, f.options[f.options.length - 1].key]));

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "sales_rep", label: "Sales Representative", role: "estimator", blurb: "Win the Job on; projects view only; no Financials.",
    levels: {
      ...ALL_NONE("run"), ...ALL_NONE("grow"), ...ALL_NONE("financials"), ...ALL_NONE("admin"),
      bids: "create", bid_visibility: NONE, costs: "view", internal_reports: "view", company_pricing: NONE, proposal_style: "edit",
      schedule: "view", communications: "replies",
    },
    off: ["financials"], app: { team_directory: "none" }, home: "sales",
  },
  {
    id: "project_manager", label: "Project Manager", role: "manager", blurb: "Run the Job on; bids view only; project-level Financials.",
    levels: {
      ...ALL_NONE("admin"), ...ALL_NONE("financials"),
      bids: "view", bid_visibility: "team", costs: "view", internal_reports: "download", company_pricing: NONE, proposal_style: "view",
      ...MAX("run"), communications: "replies", analytics: NONE,
      fin_visibility: "project", expenses: "create", sub_compliance: "manage",
    },
    app: { customers: "use", pricing_library: "none", proposal_templates: "none" }, home: "job",
  },
  {
    id: "accountant", label: "Accountant / Bookkeeper", role: "viewer", blurb: "Financials on; read-only elsewhere.",
    levels: {
      ...ALL_NONE("win"), ...ALL_NONE("run"), ...ALL_NONE("grow"), ...ALL_NONE("admin"),
      bids: "view", bid_visibility: "company", costs: "margin", internal_reports: "view",
      schedule: "view", project_costs: "view", analytics: "view",
      ...MAX("financials"),
    },
    app: { customers: "use", pricing_library: "none", proposal_templates: "none", team_directory: "none" }, home: "financial",
  },
  {
    id: "operations_manager", label: "Operations Manager", role: "manager", blurb: "Win, Run and Grow on; limited Financials.",
    levels: {
      ...ALL_NONE("admin"), ...MAX("win"), ...MAX("run"), ...MAX("grow"), ...ALL_NONE("financials"),
      fin_visibility: "company", expenses: "approve", bills: "create", manage_teams: "manage",
    },
    home: "job",
  },
  {
    id: "company_admin", label: "Company Administrator", role: "manager", blurb: "Everything your plan includes, except rights only the primary account holder can grant.",
    levels: { ...MAX("win"), ...MAX("run"), ...MAX("grow"), ...MAX("financials"), ...MAX("admin") },
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(ROLE_TEMPLATES.map((t) => [t.id, t])) as Record<string, RoleTemplate>;

/** Apply a template to a member: its role, then its levels on top of that role's defaults. */
export function applyTemplate(t: RoleTemplate, finRole: FinRole | null): { role: CompanyRole; perms: Set<string>; profile: AccessProfile } {
  let perms = baseFor(t.role, finRole);
  for (const [fid, lvl] of Object.entries(t.levels) as [FeatureId, LevelKey][]) perms = setLevel(perms, fid, lvl);
  return {
    role: t.role, perms,
    profile: { v: ACCESS_PROFILE_VERSION, template: t.id, home: t.home ?? null, workspaces: Object.fromEntries(WORKSPACES.map((w) => [w, !(t.off ?? []).includes(w)])), app: { ...(t.app ?? {}) } },
  };
}

/** Role defaults (Reset to Role Defaults): the role's own permissions, every workspace on. */
export function roleDefaults(role: Exclude<CompanyRole, "owner">, finRole: FinRole | null): { perms: Set<string>; profile: AccessProfile } {
  return { perms: baseFor(role, finRole), profile: { v: ACCESS_PROFILE_VERSION, template: null, workspaces: Object.fromEntries(WORKSPACES.map((w) => [w, true])), app: {} } };
}

/** Accept only known keys from a stored profile (old or newer versions never break the app). */
export function parseProfile(raw: unknown): AccessProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ws = (r.workspaces && typeof r.workspaces === "object" ? r.workspaces : {}) as Record<string, unknown>;
  const app = (r.app && typeof r.app === "object" ? r.app : {}) as Record<string, unknown>;
  return {
    v: Number(r.v) || ACCESS_PROFILE_VERSION,
    template: typeof r.template === "string" && r.template in TEMPLATE_BY_ID ? r.template : null,
    home: isHomePage(r.home) ? r.home : null,
    workspaces: Object.fromEntries(WORKSPACES.filter((w) => typeof ws[w] === "boolean").map((w) => [w, ws[w] as boolean])),
    app: Object.fromEntries(Object.entries(app).filter(([k, v]) => k in FEATURE_BY_ID && FEATURE_BY_ID[k as FeatureId].appGated && (v === "none" || v === "use"))) as AccessProfile["app"],
  };
}

/**
 * Set a feature's level and keep the draft consistent: raising a feature raises what it needs (Change orders
 * needs Projects), lowering a feature below what others need lowers those too. Returns the changed feature ids
 * besides the one set, so the editor can say what else moved.
 */
export function setLevelWithDeps(perms: ReadonlySet<string>, feature: FeatureId, level: LevelKey, app: Partial<Record<FeatureId, "none" | "use">> = {}) {
  let next = new Set(perms);
  const nextApp = { ...app };
  const also = new Set<FeatureId>();
  const levelOf = (fid: FeatureId) => {
    const f = FEATURE_BY_ID[fid];
    return f.appGated ? (nextApp[fid] === "none" ? NONE : f.options[0].key) : levelFromPerms(f, next);
  };
  const put = (fid: FeatureId, lvl: LevelKey) => {
    const f = FEATURE_BY_ID[fid];
    if (f.appGated) nextApp[fid] = lvl === NONE ? "none" : "use";
    else next = setLevel(next, fid, lvl);
  };
  const raise = (fid: FeatureId, lvl: LevelKey, seen = new Set<string>()) => {
    if (seen.has(fid)) return;
    seen.add(fid);
    put(fid, lvl);
    const req = FEATURE_BY_ID[fid].requires;
    if (lvl !== NONE && req) {
      const rf = FEATURE_BY_ID[req.feature as FeatureId];
      const want = req.level ?? rf.options[0].key;
      if (!meets(rf, levelOf(req.feature as FeatureId), want)) { also.add(req.feature as FeatureId); raise(req.feature as FeatureId, want, seen); }
    }
  };
  raise(feature, level);
  // Lower dependants that no longer have what they need (repeat until stable: chains are short).
  for (let pass = 0; pass < 3; pass++) {
    for (const f of FEATURES as readonly Feature[]) {
      if (!f.requires || levelOf(f.id as FeatureId) === NONE) continue;
      const rf = FEATURE_BY_ID[f.requires.feature as FeatureId];
      if (!meets(rf, levelOf(f.requires.feature as FeatureId), f.requires.level ?? rf.options[0].key)) { put(f.id as FeatureId, NONE); also.add(f.id as FeatureId); }
    }
  }
  also.delete(feature);
  return { perms: next, app: nextApp, also: [...also] };
}
