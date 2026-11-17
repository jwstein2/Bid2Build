/**
 * Page walkthrough registry (src/lib/features/page-guides.ts): every target exists in the app, copy
 * adapts to the trade, steps follow plan / role / add-on access, and the walkthrough never navigates.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUEST_CONTEXT, PAGE_GUIDES, TRADE_VOCAB, fill, isPageKey, meets, pickTrade, resolveGuide, tradeGroup, type GuideContext, type PageKey, type TradeGroup } from "@/lib/features/page-guides";
import { trades } from "@/lib/trades/catalog";
import { applyAction, parseState } from "@/lib/features/state";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const ROOT = path.join(__dirname, "..", "src");
const SRC = sourceFiles(ROOT).filter((p) => !p.endsWith(path.join("features", "page-guides.ts"))).map((p) => ({ p, s: fs.readFileSync(p, "utf8") }));

/** Quoted dotted ids on lines that set data-guide / data-guide-page (or a GUIDE_PAGE map) in the app. */
function idsFor(attr: RegExp): Set<string> {
  const out = new Set<string>();
  for (const { s } of SRC) {
    for (const line of s.split("\n")) {
      if (!attr.test(line)) continue;
      for (const m of line.matchAll(/["'`]([a-z][a-z-]*(?:\.[a-z][a-z-]*)+|admin|whats-new)["'`]/g)) out.add(m[1]);
    }
  }
  return out;
}
const targetsInApp = idsFor(/data-guide=|guide="|guide=\{/);
const pagesInApp = idsFor(/data-guide-page=|GUIDE_PAGE = \{/);

const PAGES = Object.keys(PAGE_GUIDES) as PageKey[];
const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ ...GUEST_CONTEXT, signedIn: true, ...over });
const titles = (page: PageKey, c: GuideContext, t?: TradeGroup) => resolveGuide(page, c, t).map((s) => s.title);
const bodies = (page: PageKey, c: GuideContext, t?: TradeGroup) => resolveGuide(page, c, t).map((s) => `${s.body} ${s.hint ?? ""}`).join(" ");

describe("page guide registry", () => {
  it.each(PAGES)("%s is marked in the app and every target exists as a stable data-guide id", (page) => {
    expect(pagesInApp.has(page), `no data-guide-page="${page}" in the app`).toBe(true);
    for (const s of PAGE_GUIDES[page].steps) {
      for (const t of typeof s.target === "string" ? [s.target] : s.target) expect(targetsInApp.has(t), `target "${t}" (${page}) is not in the app`).toBe(true);
    }
  });

  it.each(PAGES)("%s has complete, plain-language copy", (page) => {
    const g = PAGE_GUIDES[page];
    expect(g.label.length).toBeGreaterThan(3);
    expect(g.route).toMatch(/^\//);
    expect(g.steps.length).toBeGreaterThan(0);
    for (const s of g.steps) {
      expect(s.title.trim().length).toBeGreaterThan(3);
      expect(s.body.trim().length).toBeGreaterThan(25);
      expect(s.body).not.toMatch(/—/);
    }
  });

  it("targets are semantic ids, never CSS selectors or DOM positions", () => {
    for (const page of PAGES) for (const s of PAGE_GUIDES[page].steps) {
      for (const t of typeof s.target === "string" ? [s.target] : s.target) expect(t).toMatch(/^[a-z][a-z-]*\.[a-z][a-z-]*$/);
    }
  });

  it("isPageKey only accepts registered pages", () => {
    expect(isPageKey("dashboard.pipeline")).toBe(true);
    expect(isPageKey("toString")).toBe(false);
    expect(isPageKey("nope")).toBe(false);
  });
});

describe("the active view decides the tutorial", () => {
  it("Pipeline, Table and Analytics each teach their own controls", () => {
    const c = ctx();
    expect(titles("dashboard.pipeline", c)).toEqual(expect.arrayContaining(["Bid cards", "Stages"]));
    expect(titles("dashboard.pipeline", c)).not.toContain("Estimate your sales pay");
    expect(titles("dashboard.table", c)).toEqual(expect.arrayContaining(["Open and edit an estimate"]));
    expect(titles("dashboard.table", c)).not.toContain("Bid cards");
    expect(titles("dashboard.analytics", c)).toEqual(expect.arrayContaining(["How sales are going", "Estimate your sales pay"]));
    expect(titles("dashboard.analytics", c)).not.toContain("Stages");
  });
  it("Financials screens (behind NEXT_PUBLIC_FINANCIALS) have their own guides, marked only on Financials screens", () => {
    for (const p of ["financials.home", "financials.records", "financials.tools", "financials.job", "financials.job.billing", "financials.job.costs", "financials.job.review", "company.business-config", "company.ai-automation"]) expect(isPageKey(p), p).toBe(true);
    const marked = SRC.filter(({ s }) => /data-guide-page="financials|financials\.job\.billing/.test(s)).map(({ p }) => path.relative(ROOT, p));
    expect(marked.length).toBeGreaterThan(0);
    for (const f of marked) expect(f).toMatch(/financials/);
    expect(titles("financials.job.costs", ctx())).toContain("Add a cost");
    expect(titles("financials.job.costs", ctx())).not.toContain("Payments");
    expect(bodies("financials.job.billing", ctx())).toMatch(/doesn't charge anyone/);
  });
});

describe("trade-adaptive copy (deterministic, no AI)", () => {
  it("maps every catalog trade to a family", () => {
    const covered = new Set(["other", "general-contracting", "handyman", "garages", "framing"]);
    for (const t of trades) if (!covered.has(t.slug)) expect(tradeGroup(t.slug), t.slug).not.toBe("general");
  });
  it("fills every placeholder for every family", () => {
    for (const g of Object.keys(TRADE_VOCAB) as TradeGroup[]) {
      for (const page of PAGES) for (const s of resolveGuide(page, ctx({ unlimited: true, pm: { view: true, edit: true }, admin: true, company: { role: "owner", owner: true, permissions: ["view_analytics", "view_proposal_style", "manage_billing", "manage_users", "manage_teams", "change_proposal_policy", "view_communications"] } }), g)) {
        expect(`${s.title} ${s.body} ${s.hint ?? ""}`, `${page} ${g}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
  it("speaks to deck builders, electricians and landscapers differently, with one engine", () => {
    const c = ctx({ unlimited: true });
    const deck = bodies("builder.estimate", c, "decks");
    const elec = bodies("builder.estimate", c, "electrical");
    const land = bodies("builder.estimate", c, "landscaping");
    expect(deck).toContain("decking");
    expect(elec).toMatch(/breaker|rough-in/);
    expect(land).toMatch(/mulch|crew hours|equipment/i);
    expect(new Set([deck, elec, land]).size).toBe(3);
    expect(bodies("customers.directory", c, "landscaping")).toContain("mowing");
  });
  it("prefers the trades on screen (bid or project) over the account's usual trades", () => {
    expect(pickTrade(["electrical"], ["decks", "decks", "decks"])).toBe("electrical");
    expect(pickTrade([], ["decks", "fencing", "roofing"])).toBe("decks");
    expect(pickTrade(["other"], ["landscaping"])).toBe("landscaping");
    expect(pickTrade([], [])).toBe("general");
  });
  it("leaves unknown placeholders alone", () => {
    expect(fill("{job} and {nope}", "decks")).toBe("a 16×20 composite deck and {nope}");
  });
});

describe("permission and entitlement filtering", () => {
  it("free accounts are told saved items are an Unlimited feature, not shown how to use them", () => {
    const free = resolveGuide("builder.estimate", ctx({ unlimited: false }));
    const saved = free.find((s) => s.targets.includes("builder.saved-items"))!;
    expect(saved.locked).toBe(true);
    expect(saved.body).toMatch(/included with Unlimited/i);
    expect(saved.hint).toBeUndefined();
    const paid = resolveGuide("builder.estimate", ctx({ unlimited: true })).find((s) => s.targets.includes("builder.saved-items"))!;
    expect(paid.locked).toBe(false);
  });
  it("schedule viewers aren't told to edit; editors are", () => {
    const viewer = bodies("project.detail", ctx({ pm: { view: true, edit: false } }));
    const editor = bodies("project.detail", ctx({ pm: { view: true, edit: true } }));
    expect(viewer).toMatch(/You can view it/);
    expect(viewer).not.toMatch(/Editors drag/);
    expect(editor).toMatch(/Editors drag/);
    expect(resolveGuide("projects.schedule-now", ctx({ pm: { view: true, edit: false } }))).toEqual([]);
    expect(resolveGuide("projects.overview", ctx())).toEqual([]);
  });
  it("Enterprise screens follow company permissions; solo accounts don't see them", () => {
    const solo = ctx();
    expect(resolveGuide("company.users", solo)).toEqual([]);
    const staff = ctx({ company: { role: "estimator", owner: false, permissions: ["view_own_bids"] } });
    expect(titles("company.users", staff)).toEqual(["Your team"]);
    expect(resolveGuide("company.billing", staff)).toEqual([]);
    expect(resolveGuide("company.overview", staff)).toEqual([]);
    const owner = ctx({ company: { role: "owner", owner: true, permissions: ["view_analytics", "manage_users", "manage_teams", "manage_billing"] } });
    expect(titles("company.users", owner)).toEqual(["Your team", "Invite people", "Teams"]);
    expect(titles("company.overview", owner)).toContain("Approval rule");
    const manager = ctx({ company: { role: "manager", owner: false, permissions: ["view_analytics"] } });
    expect(titles("company.overview", manager)).not.toContain("Approval rule");
  });
  it("communications steps need view_communications in a company", () => {
    const staff = ctx({ company: { role: "estimator", owner: false, permissions: [] } });
    expect(titles("customers.detail.overview", staff)).not.toContain("Communications");
    expect(titles("customers.detail.overview", ctx())).toContain("Communications");
  });
  it("the owner command center walkthrough is for platform admins only", () => {
    expect(resolveGuide("admin", ctx())).toEqual([]);
    expect(resolveGuide("admin", ctx({ admin: true })).length).toBeGreaterThan(2);
  });
  it("steps for unreleased features are never shown", () => {
    const owner = ctx({ pm: { view: true, edit: true }, company: { role: "owner", owner: true, permissions: ["view_communications"] } });
    expect(resolveGuide("customers.communications", owner)).toHaveLength(1);
  });
  it("meets() treats a solo account as owning its own data", () => {
    expect(meets({ permission: "manage_users", owner: true }, ctx())).toBe(true);
    expect(meets({ company: true }, ctx())).toBe(false);
  });
});

describe("remembering finished walkthroughs", () => {
  it("records a finished page guide without stopping replays, and ignores junk", () => {
    const s0 = parseState({})!;
    const s1 = applyAction(s0, { guide: "dashboard.pipeline" });
    expect(s1.guides).toEqual(["dashboard.pipeline"]);
    expect(applyAction(s1, { guide: "dashboard.pipeline" })).toBe(s1);
    expect(applyAction(s1, { guide: "<script>" })).toBe(s1);
    expect(parseState({ guides: ["dashboard.table", 4, "Bad Key"] })!.guides).toEqual(["dashboard.table"]);
    expect(parseState({})!.guides).toBeUndefined();
  });
});

describe("the walkthrough never navigates or acts", () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, "components", "features", f), "utf8");
  it.each(["feature-host.tsx", "feature-tour.tsx", "client.ts", "tour-buttons.tsx"])("%s has no router pushes or programmatic clicks", (f) => {
    const s = read(f);
    expect(s).not.toMatch(/useRouter|router\.push|location\.assign|location\.href\s*=|\.click\(\)/);
  });
});
