/**
 * Guided Experience engine (src/lib/guide): every tour points at controls and pages that exist, tours
 * follow plan/role/workspace rules, smart offers respect "Skip"/"Maybe later" and never interrupt,
 * multi-page tours split correctly, and help search only returns verified help copy.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUEST_CONTEXT, PAGE_GUIDES, isPageKey, type GuideContext } from "@/lib/features/page-guides";
import { TOURS, eligibleTours, getTour, guideRole, messageKey, tourEligible, translate } from "@/lib/guide/tours";
import { MAX_OFFERS, decideOffer, resumeStep, stillOfferable, type Progress } from "@/lib/guide/rules";
import { RUN_TTL_MS, parseRun, planTour, segmentAt } from "@/lib/guide/runner";
import { HELP_RESOURCES, getResource, helpIndex, searchHelp } from "@/lib/guide/help";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const SRC = sourceFiles(path.join(__dirname, "..", "src"))
  .filter((p) => !p.includes(`${path.sep}lib${path.sep}guide${path.sep}`) && !p.endsWith("page-guides.ts"))
  .map((p) => fs.readFileSync(p, "utf8")).join("\n");
const pageGuideTargets = new Set(Object.values(PAGE_GUIDES).flatMap((g) => g.steps.flatMap((s) => (typeof s.target === "string" ? [s.target] : [...s.target]))));

const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ ...GUEST_CONTEXT, signedIn: true, ...over });
const owner = ctx({ unlimited: true, pm: { view: true, edit: true }, company: { role: "owner", owner: true, permissions: ["manage_users", "manage_teams", "manage_billing", "view_analytics"] } });
const manager = ctx({ unlimited: true, pm: { view: true, edit: false }, company: { role: "manager", owner: false, permissions: ["view_analytics"] } });
const staff = ctx({ unlimited: true, pm: { view: true, edit: false }, company: { role: "member", owner: false, permissions: [] } });
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-18T12:00:00Z");
const base = { ctx: ctx(), workspace: "real" as const, progress: [] as Progress[], createdAt: new Date(NOW - 2 * DAY).toISOString(), welcomeDone: true, busy: false, offeredThisLoad: false, now: NOW };
const prog = (tourId: string, over: Partial<Progress>): Progress => ({ tourId, version: getTour(tourId)!.version, status: "offered", lastStep: null, offeredCount: 1, snoozedUntil: null, completedAt: null, ...over });

describe("tour registry", () => {
  it("has unique ids, 3 to 7 steps, and the required fields", () => {
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const t of TOURS) {
      expect(t.id).toMatch(/^[a-z0-9-]{1,48}$/);
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.steps.length, t.id).toBeLessThanOrEqual(7);
      expect(t.optional).toBe(true);
      for (const r of t.help) expect(getResource(r), `${t.id} help ${r}`).toBeDefined();
      if (t.trigger.kind !== "manual") for (const p of t.trigger.pages) expect(isPageKey(p), `${t.id} trigger page ${p}`).toBe(true);
    }
  });

  it("points every step at a page and a control that exist in the app (never CSS or text)", () => {
    for (const t of TOURS) for (const s of t.steps) {
      expect(isPageKey(s.page), `${t.id}: page ${s.page}`).toBe(true);
      const ids = typeof s.target === "string" ? [s.target] : [...s.target];
      for (const id of ids) expect(id, `${t.id}: ${id}`).toMatch(/^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/);
      expect(ids.some((id) => pageGuideTargets.has(id) || SRC.includes(`"${id}"`)), `${t.id}: none of ${ids.join(", ")} found`).toBe(true);
      expect(Boolean(s.href) || Boolean(s.continueHint), `${t.id}: step needs a link or a hint`).toBe(true);
    }
  });

  it("copy is addressable for translation with an English fallback", () => {
    expect(messageKey("pm-hub", 2, "title")).toBe("pm-hub.2.title");
    expect(translate(null, "pm-hub.0.title", "Fallback")).toBe("Fallback");
    const steps = planTour(getTour("pm-hub")!, owner, "general", { "pm-hub.0.title": "Sus proyectos" });
    expect(steps[0].title).toBe("Sus proyectos");
  });
});

describe("who sees which tour", () => {
  it("maps company roles to onboarding roles", () => {
    expect(guideRole(ctx())).toBe("solo");
    expect(guideRole(owner)).toBe("owner");
    expect(guideRole(manager)).toBe("manager");
    expect(guideRole(staff)).toBe("staff");
  });

  it("gives each Enterprise role only its own walkthrough, and never billing or admin steps to others", () => {
    const ids = (c: GuideContext) => eligibleTours(c, "real").map((t) => t.id);
    expect(ids(owner)).toContain("enterprise-owner");
    expect(ids(owner)).not.toContain("enterprise-staff");
    expect(ids(manager)).toEqual(expect.arrayContaining(["enterprise-manager"]));
    expect(ids(manager)).not.toContain("enterprise-owner");
    expect(ids(staff)).toContain("enterprise-staff");
    expect(ids(staff)).not.toContain("enterprise-owner");
    expect(ids(ctx())).not.toContain("enterprise-owner");
    // An owner without the billing permission doesn't get the billing step.
    const noBilling = { ...owner, company: { ...owner.company!, permissions: ["manage_users"] } };
    expect(planTour(getTour("enterprise-owner")!, noBilling).map((s) => s.target)).not.toContain("company.licenses");
  });

  it("only offers PM Hub to people with Project Command Center access, and tells viewers they can't edit", () => {
    expect(tourEligible(getTour("pm-hub")!, ctx(), "real")).toBe(false);
    const viewer = planTour(getTour("pm-hub")!, staff).map((s) => s.body).join(" ");
    expect(viewer).toMatch(/schedule editor on your team/);
    expect(viewer).not.toMatch(/Schedule Now builds/);
  });

  it("keeps the demo walkthrough inside Demo Mode", () => {
    expect(tourEligible(getTour("demo-tour")!, owner, "real")).toBe(false);
    expect(tourEligible(getTour("demo-tour")!, owner, "demo")).toBe(true);
    expect(tourEligible(getTour("first-estimate")!, owner, "demo")).toBe(false);
  });
});

describe("smart offers", () => {
  it("offers the first-bid journey to a new account on the dashboard, after the welcome popup", () => {
    expect(decideOffer({ ...base, page: "dashboard.pipeline" })?.id).toBe("first-estimate");
    expect(decideOffer({ ...base, page: "dashboard.pipeline", welcomeDone: false })).toBeNull();
    expect(decideOffer({ ...base, page: "dashboard.pipeline", createdAt: new Date(NOW - 30 * DAY).toISOString() })).toBeNull();
  });

  it("never interrupts, never repeats in a page load, never in Demo Mode", () => {
    expect(decideOffer({ ...base, page: "dashboard.pipeline", busy: true })).toBeNull();
    expect(decideOffer({ ...base, page: "dashboard.pipeline", offeredThisLoad: true })).toBeNull();
    expect(decideOffer({ ...base, page: "dashboard.pipeline", workspace: "demo" })).toBeNull();
    expect(decideOffer({ ...base, page: null })).toBeNull();
  });

  it("respects Skip, Maybe later (7 days), finished tours and the offer cap", () => {
    const at = (p: Progress) => decideOffer({ ...base, page: "dashboard.pipeline", progress: [p] });
    expect(at(prog("first-estimate", { status: "dismissed" }))).toBeNull();
    expect(at(prog("first-estimate", { status: "completed" }))).toBeNull();
    expect(at(prog("first-estimate", { status: "snoozed", snoozedUntil: new Date(NOW + DAY).toISOString() }))).toBeNull();
    expect(at(prog("first-estimate", { status: "snoozed", snoozedUntil: new Date(NOW - DAY).toISOString() }))?.id).toBe("first-estimate");
    expect(at(prog("first-estimate", { offeredCount: MAX_OFFERS }))).toBeNull();
    // A new version of a tour counts as new.
    expect(stillOfferable(undefined, NOW)).toBe(true);
  });

  it("offers PM Hub the first time the projects page opens", () => {
    expect(decideOffer({ ...base, ctx: owner, page: "projects.list", createdAt: new Date(NOW - 90 * DAY).toISOString() })?.id).toBe("pm-hub");
    expect(decideOffer({ ...base, ctx: ctx(), page: "projects.list" })).toBeNull();
  });

  it("resumes a tour where it was left", () => {
    expect(resumeStep(prog("pm-hub", { status: "in_progress", lastStep: 3 }), 7)).toBe(3);
    expect(resumeStep(prog("pm-hub", { status: "in_progress", lastStep: 30 }), 7)).toBe(6);
    expect(resumeStep(undefined, 7)).toBe(0);
  });
});

describe("multi-page runner", () => {
  it("splits a tour into same-page runs", () => {
    const steps = planTour(getTour("pm-hub")!, owner);
    const first = segmentAt(steps, 0)!;
    expect(first.page).toBe("projects.overview");
    expect(first.end).toBeGreaterThan(1);
    expect(segmentAt(steps, first.end)!.page).not.toBe("projects.overview");
    expect(segmentAt(steps, steps.length)).toBeNull();
  });

  it("only resumes a recent run from this tab", () => {
    const run = { tourId: "pm-hub", version: 1, at: 2, startedAt: NOW };
    expect(parseRun(JSON.stringify(run), NOW + 1000)).toEqual(run);
    expect(parseRun(JSON.stringify(run), NOW + RUN_TTL_MS + 1)).toBeNull();
    expect(parseRun("not json", NOW)).toBeNull();
  });
});

describe("help search", () => {
  it("finds verified help for common questions, filtered by plan and role", () => {
    const idx = helpIndex(owner, "real");
    expect(searchHelp(idx, "how do I add a customer").length).toBeGreaterThan(0);
    expect(searchHelp(idx, "schedule").some((e) => e.kind === "tour" || /schedul/i.test(e.title + e.body))).toBe(true);
    expect(searchHelp(idx, "the of to")).toEqual([]);
    const soloIdx = helpIndex(ctx(), "real");
    expect(soloIdx.some((e) => e.tourId === "enterprise-owner")).toBe(false);
  });

  it("help destinations are internal links or the shipped video", () => {
    for (const r of HELP_RESOURCES) expect(r.href.startsWith("/")).toBe(true);
    // While a new intro video is being made (WELCOME_VIDEO.src null) the video isn't listed at all.
    const video = getResource("video.getting-started");
    if (video) expect(fs.existsSync(path.join(__dirname, "..", "public", video.href))).toBe(true);
    else expect(HELP_RESOURCES.some((r) => r.kind === "video")).toBe(false);
  });
});
