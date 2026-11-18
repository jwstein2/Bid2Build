/**
 * V6.7 capability registry + effective access (pure). Covers the §15 matrix that doesn't need a database:
 * workspace on/off, feature grants and denies, role templates, owner override, unlicensed features, PM editor
 * seats, dashboard widget gating, search kind filtering, Accountant Mode, nav + preview, and saved-profile safety.
 */
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, ROLE_PERMISSIONS, type CompanyRole } from "@/lib/enterprise/permissions";
import { canUseAccountantMode } from "@/lib/financials/permissions";
import { FEATURES, FEATURE_BY_ID, FEATURE_OF_PERMISSION, NONE, UNMAPPED_PERMISSIONS, featureForPath, levelFromPerms, permsForLevel, type Feature } from "@/lib/access/capabilities";
import {
  ROLE_TEMPLATES, TEMPLATE_BY_ID, applyTemplate, compilePerms, hasCapability, memberPermSet, parseProfile, resolveAccess, restrictedFor, roleDefaults, setLevelWithDeps,
  type AccessInput, type AccessProfile, type Licenses,
} from "@/lib/access/effective";
import { buildNav, sidebarAccess } from "@/lib/access/nav";
import { KIND_FEATURE, searchableKinds } from "@/lib/search/kind-access";
import { ACTIONS, actionAllowed, type SearchCaps } from "@/lib/search/actions";

const ALL: Licenses = { pm: true, pmEditor: true, financials: true, premium: true };
const FIN = ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "approve_expenses", "record_bills", "approve_vendor_bills", "manage_accounts", "post_journal_entries", "reconcile", "close_periods", "export_financials", "manage_financial_config", "manage_sub_compliance"];

function member(role: CompanyRole, perms: Set<string>, opts: { profile?: AccessProfile | null; licenses?: Partial<Licenses>; finSeat?: boolean; denied?: string[]; revoked?: string[]; owner?: boolean } = {}): AccessInput {
  const fin = opts.finSeat === false ? null : [...perms].filter((p) => FIN.includes(p) && !(opts.denied ?? []).includes(p));
  return {
    company: { id: "c", name: "Acme", role, isOwner: Boolean(opts.owner), perms: [...perms].filter((p) => !FIN.includes(p) && !(opts.denied ?? []).includes(p)), profile: opts.profile ?? null, policy: { denied: opts.denied ?? [], locked: [] }, revoked: opts.revoked ?? [] },
    finPerms: fin, licenses: { ...ALL, financials: opts.finSeat !== false, ...opts.licenses },
  };
}

describe("registry", () => {
  it("maps every company permission to exactly one feature", () => {
    expect(UNMAPPED_PERMISSIONS).toEqual([]);
    const seen = new Map<string, string>();
    for (const f of FEATURES as readonly Feature[]) for (const o of f.options) for (const p of o.perms) {
      expect(seen.get(p), `${p} in ${seen.get(p)} and ${f.id}`).toBeUndefined();
      seen.set(p, f.id);
    }
    expect(seen.size).toBe(PERMISSION_KEYS.length);
    expect(Object.keys(FEATURE_OF_PERMISSION)).toHaveLength(PERMISSION_KEYS.length);
  });
  it("levels are cumulative and dependencies point at real features and levels", () => {
    const s = FEATURE_BY_ID.schedule;
    expect(permsForLevel(s, "edit")).toEqual(["view_schedules", "download_schedule_pdf", "create_schedules", "edit_assigned_schedules", "manage_dependencies"]);
    expect(levelFromPerms(s, new Set(["view_schedules", "download_schedule_pdf", "edit_assigned_schedules"]))).toBe("view");
    for (const f of FEATURES as readonly Feature[]) if (f.requires) {
      const r = FEATURE_BY_ID[f.requires.feature as keyof typeof FEATURE_BY_ID];
      expect(r, f.id).toBeTruthy();
      if (f.requires.level) expect(r.options.map((o) => o.key)).toContain(f.requires.level);
    }
  });
  it("finds the feature that owns a URL", () => {
    expect(featureForPath("/financials/accounting/bank")?.id).toBe("bank");
    expect(featureForPath("/projects/team/subs")?.id).toBe("team_directory");
    expect(featureForPath("/dashboard")?.id).toBe("bids");
    expect(featureForPath("/dashboard/customers/123")?.id).toBe("customers");
    expect(featureForPath("/settings/account")).toBeNull();
  });
});

describe("effective access", () => {
  const rep = memberPermSet("estimator", [], [], null);

  it("solo accounts and the primary account holder are never restricted", () => {
    const solo = resolveAccess({ company: null, finPerms: FIN, licenses: ALL });
    expect(hasCapability(solo, { feature: "schedule", level: "manage" })).toBe(true);
    expect(hasCapability(solo, { feature: "fin_visibility", level: "company" })).toBe(true);
    expect(hasCapability(solo, { feature: "manage_users" })).toBe(false);
    const owner = resolveAccess(member("owner", new Set(FIN), { owner: true, profile: { v: 1, workspaces: { financials: false } } }));
    expect(hasCapability(owner, { feature: "manage_billing" })).toBe(true);
    expect(owner.workspaces.financials.state).not.toBe("off");
    expect(sidebarAccess(owner)).toBeNull();
  });

  it("role defaults: an estimator wins jobs and views schedules, no Financials without a seat", () => {
    const a = resolveAccess(member("estimator", rep, { finSeat: false }));
    expect(a.features.bids.level).toBe("create");
    expect(a.features.schedule.level).toBe("approve");
    expect(a.features.fin_visibility).toEqual({ level: NONE, blocked: "financials" });
    // Missing seat = not "restricted": the page explains how to get one, the link stays.
    expect(restrictedFor(a, { feature: "fin_visibility" })).toBe(false);
  });

  it("workspace off hides every feature in it; re-enabling restores; exceptions are labelled", () => {
    let perms = rep;
    for (const f of (FEATURES as readonly Feature[]).filter((x) => x.section === "run" && !x.appGated)) perms = setLevelWithDeps(perms, f.id as never, NONE).perms;
    const profile: AccessProfile = { v: 1, workspaces: { run: false } };
    const off = resolveAccess(member("estimator", perms, { profile }));
    expect(off.workspaces.run).toEqual({ state: "off", visible: false, exceptions: [] });
    expect(off.features.team_directory.level).toBe(NONE);   // app-gated follows the master switch
    expect(restrictedFor(off, { feature: "schedule" })).toBe(true);
    // Keep only Photos (needs Projects view, raised automatically).
    const kept = setLevelWithDeps(perms, "photos", "create");
    expect(kept.also).toContain("schedule");
    const ex = resolveAccess(member("estimator", kept.perms, { profile }));
    expect(ex.workspaces.run.exceptions.sort()).toEqual(["photos", "schedule"]);
    const nav = buildNav(ex);
    expect(nav.find((g) => g.id === "run")).toBeUndefined();
    expect(nav.find((g) => g.id === "other")?.items[0]).toMatchObject({ href: "/projects", label: expect.stringContaining("Run the Job") });
    // Back on: role defaults return.
    const on = resolveAccess(member("estimator", roleDefaults("estimator", null).perms, { profile: { v: 1, workspaces: { run: true } } }));
    expect(on.features.schedule.level).toBe("approve");
  });

  it("a user-specific deny beats the role default; a grant can't bypass a missing license or a company restriction", () => {
    const denied = resolveAccess(member("manager", memberPermSet("manager", [], ["approve_bids"], null)));
    expect(denied.features.bids.level).toBe("edit");
    const noPm = resolveAccess(member("manager", memberPermSet("manager", ["edit_all_schedules"], [], null), { licenses: { pm: false } }));
    expect(noPm.features.schedule).toEqual({ level: NONE, blocked: "pm" });
    const policy = resolveAccess(member("manager", memberPermSet("manager", [], [], null), { denied: ["view_analytics"] }));
    expect(policy.features.analytics).toEqual({ level: NONE, blocked: "policy" });
    expect(restrictedFor(policy, { feature: "analytics" })).toBe(true);
  });

  it("PM editor seat: schedule editing caps at View without a seat, and says why", () => {
    const a = resolveAccess(member("manager", memberPermSet("manager", [], [], null), { licenses: { pmEditor: false } }));
    expect(a.features.schedule).toEqual({ level: "view", blocked: "pm_editor" });
    expect(hasCapability(a, { feature: "schedule", level: "view" })).toBe(true);
    expect(hasCapability(a, { feature: "schedule", level: "edit" })).toBe(false);
  });

  it("Financials turned off is a restriction even when the database hides the book", () => {
    const perms = setLevelWithDeps(memberPermSet("viewer", [], [], "bookkeeper"), "fin_visibility", NONE).perms;
    const { revoked } = compilePerms("viewer", perms, "bookkeeper");
    expect(revoked).toEqual(expect.arrayContaining(["view_company_financials", "create_invoices", "reconcile"]));
    const a = resolveAccess(member("viewer", perms, { finSeat: false, revoked, profile: { v: 1, workspaces: { financials: false } } }));
    expect(restrictedFor(a, { feature: "fin_visibility" })).toBe(true);
    expect(sidebarAccess(a)?.hidden).toContain("/financials");
  });

  it("Accountant Mode is a view, not a grant: no accounting permissions, no mode", () => {
    const perms = setLevelWithDeps(memberPermSet("viewer", [], [], "accountant"), "fin_visibility", NONE).perms;
    expect(canUseAccountantMode([...perms].filter((p) => FIN.includes(p)))).toBe(false);
    expect(canUseAccountantMode([...memberPermSet("viewer", [], [], "accountant")].filter((p) => FIN.includes(p)))).toBe(true);
  });
});

describe("templates and compile", () => {
  it("every template compiles to valid arrays and reads back as its levels", () => {
    for (const t of ROLE_TEMPLATES) {
      const r = applyTemplate(t, "bookkeeper");
      const { granted, revoked } = compilePerms(r.role, r.perms, "bookkeeper");
      for (const k of [...granted, ...revoked]) expect(PERMISSION_KEYS).toContain(k);
      const back = memberPermSet(r.role, granted, revoked, "bookkeeper");
      expect([...back].sort()).toEqual([...r.perms].sort());
      for (const [fid, lvl] of Object.entries(t.levels)) {
        const f = FEATURE_BY_ID[fid as keyof typeof FEATURE_BY_ID];
        if (!f.ownerOnly) expect(levelFromPerms(f, r.perms), `${t.id}.${fid}`).toBe(lvl);
      }
    }
  });
  it("Sales Representative: Win on, Run view only, no Financials; Accountant: Financials full", () => {
    const sales = applyTemplate(TEMPLATE_BY_ID.sales_rep, null);
    const a = resolveAccess(member(sales.role, sales.perms, { profile: sales.profile }));
    expect(a.workspaces.financials.state).toBe("off");
    expect(a.features.schedule.level).toBe("view");
    expect(a.features.bids.level).toBe("create");
    const acct = applyTemplate(TEMPLATE_BY_ID.accountant, "accountant");
    const b = resolveAccess(member(acct.role, acct.perms, { profile: acct.profile }));
    expect(b.features.fin_visibility.level).toBe("company");
    expect(b.features.bank.level).toBe("reconcile");
    expect(b.features.bids.level).toBe("view");
  });
  it("Project Manager gets project-level Financials only (no bank / P&L widgets)", () => {
    const t = applyTemplate(TEMPLATE_BY_ID.project_manager, "project_manager");
    const a = resolveAccess(member(t.role, t.perms, { profile: t.profile }));
    expect(hasCapability(a, { feature: "fin_visibility", level: "project" })).toBe(true);
    expect(hasCapability(a, { feature: "fin_visibility", level: "company" })).toBe(false);
    expect(hasCapability(a, { feature: "bank" })).toBe(false);
  });
  it("role defaults compile to no adjustments", () => {
    for (const r of ["manager", "estimator", "viewer"] as const) {
      expect(compilePerms(r, roleDefaults(r, null).perms, null)).toEqual({ granted: [], revoked: [] });
      expect([...roleDefaults(r, null).perms].sort()).toEqual([...ROLE_PERMISSIONS[r]].sort());
    }
  });
  it("lowering a feature lowers what depends on it", () => {
    const r = setLevelWithDeps(memberPermSet("manager", [], [], null), "schedule", NONE);
    expect(r.also).toEqual(expect.arrayContaining(["change_orders", "photos", "progress"]));
    expect(levelFromPerms(FEATURE_BY_ID.change_orders, r.perms)).toBe(NONE);
  });
  it("parses stored profiles defensively (unknown keys, templates and features dropped)", () => {
    expect(parseProfile({ v: 9, template: "hacker", workspaces: { win: false, nope: true }, app: { customers: "none", bids: "none", evil: "use" } }))
      .toEqual({ v: 9, template: null, workspaces: { win: false }, app: { customers: "none" } });
    expect(parseProfile(null)).toBeNull();
  });
});

describe("search and actions", () => {
  const capsFor = (access: ReturnType<typeof resolveAccess>, perms: string[]): SearchCaps => ({
    premium: true, admin: false, flags: { pm: true, financials: true }, company: { id: "c", role: "estimator", perms }, fin: { book: "b", sandbox: false, perms: [] }, access,
  });
  it("turned-off workspaces drop their result kinds and actions", () => {
    let perms = memberPermSet("estimator", [], [], null);
    perms = setLevelWithDeps(perms, "schedule", NONE).perms;
    const a = resolveAccess(member("estimator", perms, { finSeat: false, revoked: compilePerms("estimator", perms, null).revoked, profile: { v: 1, workspaces: { run: false, financials: false } } }));
    const caps = capsFor(a, [...perms]);
    const kinds = searchableKinds(caps);
    expect(kinds).toContain("customer");
    expect(kinds).toContain("estimate");
    expect(kinds).not.toContain("project");
    expect(kinds).not.toContain("task");
    expect(kinds).not.toContain("invoice");
    const ids = ACTIONS.filter((x) => actionAllowed(x, caps)).map((x) => x.id);
    expect(ids).toContain("new-bid");
    expect(ids).not.toContain("open-projects");
    expect(ids).not.toContain("create-invoice");
    expect(Object.keys(KIND_FEATURE).length).toBeGreaterThan(10);
  });
  it("a person with Projects but no Financials can find projects, not invoices", () => {
    const perms = memberPermSet("manager", [], [], null);
    const a = resolveAccess(member("manager", perms, { finSeat: false, revoked: ["view_project_financials"], profile: { v: 1, workspaces: { financials: false } } }));
    const kinds = searchableKinds(capsFor(a, [...perms]));
    expect(kinds).toEqual(expect.arrayContaining(["project", "task", "customer"]));
    for (const k of ["invoice", "payment", "bill", "expense", "vendor"]) expect(kinds).not.toContain(k);
  });
});
