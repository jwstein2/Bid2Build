/**
 * Feature registry metadata check (CI runs this on every pull request) plus the discovery rules:
 * unlocked-features modal, What's New notice and walkthrough steps.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FEATURES, LATEST_RELEASE, RELEASES, compareVersions, type Feature } from "@/lib/features/registry";
import { PREMIUM_FEATURES } from "@/lib/billing/premium-features";
import { FEATURE_BY_ID as ACCESS_FEATURES } from "@/lib/access/capabilities";
import { FEATURE_ICONS } from "@/components/features/icons";
import { applyAction, available, initialState, newlyUnlocked, parseState, tourSteps, whatsNew, type FeatureState } from "@/lib/features/state";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(p) : /\.(tsx?|mjs)$/.test(d.name) ? [p] : [];
  });
}
const SRC = sourceFiles(path.join(__dirname, "..", "src")).map((p) => ({ p, s: fs.readFileSync(p, "utf8") }));
const ids = new Set(FEATURES.map((f) => f.id));

describe("feature registry metadata (update it in the same PR as the feature)", () => {
  it.each(FEATURES.map((f) => [f.id, f] as const))("%s has complete metadata", (_id, f) => {
    expect(f.name.trim().length).toBeGreaterThan(2);
    expect(f.description.trim().length).toBeGreaterThan(20);
    expect(f.walkthrough.title.trim().length).toBeGreaterThan(2);
    expect(f.walkthrough.body.trim().length).toBeGreaterThan(20);
    expect(f.route).toMatch(/^\//);
    expect(["free", "unlimited", "pm"]).toContain(f.entitlement);
    expect(RELEASES.map((r) => r.version)).toContain(f.release);
    expect(FEATURE_ICONS[f.id]).toBeTruthy();
    if (f.entitlement !== "free") expect(f.pitch?.trim().length ?? 0).toBeGreaterThan(20);
  });

  it("releases are valid, dated and in order", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i].version, RELEASES[i - 1].version)).toBeGreaterThan(0);
      expect(RELEASES[i].date >= RELEASES[i - 1].date).toBe(true);
    }
    expect(LATEST_RELEASE).toBe(RELEASES[RELEASES.length - 1]);
  });

  it("every premium feature lock and upgrade message comes from the registry", () => {
    expect(Object.keys(PREMIUM_FEATURES).sort()).toEqual(FEATURES.filter((f) => f.entitlement === "unlimited").map((f) => f.id).sort());
    // Every <PremiumUpgrade feature="..."> and premium("...") reference names a registered premium feature.
    for (const { p, s } of SRC) {
      for (const m of s.matchAll(/PremiumUpgrade[^>]*?feature="([a-z_]+)"/g)) expect(PREMIUM_FEATURES, `${p}: ${m[1]}`).toHaveProperty(m[1]);
    }
  });

  it("every data-feature in the app names a registered feature", () => {
    const used = new Set<string>();
    for (const { p, s } of SRC) {
      for (const m of s.matchAll(/data-feature="([a-z_]+)"|\bfeature: "([a-z_]+)"/g)) {
        const id = m[1] ?? m[2];
        // V6.7 capability requirements ({ feature: "fin_visibility" }) name src/lib/access/capabilities.ts features, not walkthroughs.
        if (!m[1] && !ids.has(id as Feature["id"]) && id in ACCESS_FEATURES) continue;
        used.add(id);
        expect(ids.has(id as Feature["id"]), `${path.relative(process.cwd(), p)} uses unregistered feature "${id}"`).toBe(true);
      }
    }
    // ...and every released feature with a walkthrough target has that target in the app.
    for (const f of FEATURES) if (f.status === "released" && f.target) expect(used.has(f.target), `walkthrough target "${f.target}" for ${f.id} is not in the app`).toBe(true);
  });

  it("every premium sidebar link is a registered premium feature", () => {
    const nav = fs.readFileSync(path.join(__dirname, "..", "src/components/layout/app-nav.tsx"), "utf8");
    for (const m of nav.matchAll(/\{ href: "([^"]+)"[^}]*premium: true[^}]*\}/g)) {
      const f = FEATURES.find((x) => x.route === m[1]);
      expect(f?.entitlement, m[1]).toBe("unlimited");
      expect(m[0]).toContain(`feature: "${f!.id}"`);
    }
  });
});

const PAID = { unlimited: true }, FREE = { unlimited: false };
const st = (o: Partial<FeatureState> = {}): FeatureState => ({ v: 1, acked: [], notice: null, tour: null, ...o });
const premium = (list: Feature[]) => list.filter((f) => f.entitlement !== "free").map((f) => f.id).sort();

describe("unlocked features modal", () => {
  it("a free account sees nothing unlocked, and after upgrading sees every Unlimited feature", () => {
    const s = initialState(FREE, "2026-10-01T00:00:00Z");
    expect(newlyUnlocked(s, FREE)).toEqual([]);
    expect(premium(newlyUnlocked(s, PAID))).toEqual(["internal_report", "library", "templates"]);
  });
  it("an existing paying account is told only about premium features from the latest release", () => {
    const s = initialState(PAID, "2026-06-01T00:00:00Z");
    const latestPremium = FEATURES.filter((f) => f.entitlement === "unlimited" && f.status === "released" && f.release === LATEST_RELEASE.version).map((f) => f.id);
    expect(newlyUnlocked(s, PAID).map((f) => f.id)).toEqual(latestPremium);
  });
  it("never lists features the account doesn't have", () => {
    expect(newlyUnlocked(st(), FREE)).toEqual([]);
    for (const f of newlyUnlocked(st(), PAID)) expect(f.entitlement).toBe("unlimited");
  });
  it("doesn't reopen once acknowledged (Maybe Later, Close or Explore)", () => {
    const s = applyAction(st(), { ack: newlyUnlocked(st(), PAID).map((f) => f.id) });
    expect(newlyUnlocked(s, PAID)).toEqual([]);
  });
  it("ignores unknown ids and never removes acknowledgements", () => {
    const s = applyAction(st({ acked: ["library"] }), { ack: ["nope", "templates"] });
    expect(s.acked).toEqual(["library", "templates"]);
    expect(parseState({ acked: ["library", "bogus", "library"], notice: "9.9.9", tour: "x" })).toEqual(st({ acked: ["library"] }));
  });
});

describe("What's New notice", () => {
  it("shows the latest release's features this account can use, then stays dismissed", () => {
    const s = initialState(FREE, "2026-01-01T00:00:00Z");
    const list = whatsNew(s, FREE);
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) { expect(f.release).toBe(LATEST_RELEASE.version); expect(f.entitlement).toBe("free"); }
    expect(whatsNew(applyAction(s, { notice: LATEST_RELEASE.version }), FREE)).toEqual([]);
  });
  it("doesn't repeat what the unlocked modal shows", () => {
    const s = initialState(PAID, "2026-01-01T00:00:00Z");
    const modal = new Set(newlyUnlocked(s, PAID).map((f) => f.id));
    for (const f of whatsNew(s, PAID)) expect(modal.has(f.id)).toBe(false);
  });
  it("brand-new accounts aren't told the current release is 'new'", () => {
    expect(whatsNew(initialState(FREE, `${LATEST_RELEASE.date}T15:00:00Z`), FREE)).toEqual([]);
  });
  it("a dismissed notice can't be moved backwards", () => {
    const s = st({ notice: LATEST_RELEASE.version });
    expect(applyAction(s, { notice: RELEASES[0].version }).notice).toBe(LATEST_RELEASE.version);
    expect(applyAction(s, { notice: "0.0.1" }).notice).toBe(LATEST_RELEASE.version);
  });
});

describe("unreleased functionality is never exposed", () => {
  const hidden: Feature = { ...FEATURES[0], id: "library", name: "Secret", entitlement: "free", status: "unreleased", release: LATEST_RELEASE.version as Feature["release"] };
  it("is excluded from access, the notice and the modal", () => {
    expect(available(PAID, [hidden])).toEqual([]);
    expect(whatsNew(st(), PAID, [hidden])).toEqual([]);
    expect(newlyUnlocked(st(), PAID, [{ ...hidden, entitlement: "unlimited" }])).toEqual([]);
  });
});

describe("walkthrough steps", () => {
  it("only includes features the account can use", () => {
    expect(tourSteps(FREE).every((f) => f.entitlement === "free")).toBe(true);
    expect(tourSteps(FREE, ["internal_report", "pipeline"]).map((f) => f.id)).toEqual(["pipeline"]);
    expect(tourSteps(PAID, ["internal_report", "pipeline"]).map((f) => f.id)).toEqual(["internal_report", "pipeline"]);
  });
  it("newest release first by default", () => {
    const s = tourSteps(PAID);
    for (let i = 1; i < s.length; i++) expect(compareVersions(s[i - 1].release, s[i].release)).toBeGreaterThanOrEqual(0);
  });
});

describe("project scheduling stays hidden until it ships", () => {
  it("is registered but unreleased, so no modal, notice, tour or What's New entry shows it", () => {
    const f = FEATURES.find((x) => x.id === "project_scheduling")!;
    expect(f.status).toBe("unreleased");
    const all = { unlimited: true, pm: true };
    expect(available(all).some((x) => x.id === "project_scheduling")).toBe(false);
    expect(tourSteps(all, ["project_scheduling"])).toEqual([]);
    expect(newlyUnlocked(st(), all).some((x) => x.id === "project_scheduling")).toBe(false);
  });
});
