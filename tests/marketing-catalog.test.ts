import { describe, expect, it } from "vitest";
import {
  MARKETING_FEATURES, PRICES, PM_PRODUCT_NAME, cellFor, cellLabel, featureStatus, featuresFor, pmMarketedLive, pmUpgradeCopy, tierBadge,
} from "@/lib/marketing/catalog";
import { getFeature } from "@/lib/features/registry";

const ON = { NEXT_PUBLIC_PROJECT_SCHEDULING: "on", NEXT_PUBLIC_ESIGNATURES: "on" };
const OFF = { NEXT_PUBLIC_PROJECT_SCHEDULING: "", NEXT_PUBLIC_ESIGNATURES: "" };
const PLANS = ["free", "unlimited", "enterprise"] as const;

describe("marketing catalog", () => {
  it("shows only the approved prices", () => {
    expect(PRICES).toMatchObject({
      unlimitedMonthly: "$19.99", unlimitedAnnual: "$199", pmMonthly: "$4.99", pmAnnual: "$49.99", pmEditor: "$1.99",
      pmIncludedEnterpriseEditors: 1, enterpriseBase: "$49.99", enterpriseIncludedUsers: 3,
    });
    expect(PM_PRODUCT_NAME).toBe("Project Command Center");
  });

  it("has unique ids and complete entries", () => {
    const ids = MARKETING_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of MARKETING_FEATURES) {
      expect(f.name.length, f.id).toBeGreaterThan(2);
      expect(f.description.endsWith("."), f.id).toBe(true);
      expect(f.destination.startsWith("/"), f.id).toBe(true);
      expect(f.upgrade.startsWith("/"), f.id).toBe(true);
    }
  });

  it("never shows a Coming Soon feature as included on any plan", () => {
    const soon = MARKETING_FEATURES.filter((f) => f.release === "coming_soon");
    // Customer communications released 2026-11-18 (V8 MKT-7); nothing is coming soon right now.
    expect(soon.map((f) => f.id).sort()).toEqual([]);
    for (const f of soon) {
      expect(featureStatus(f, ON)).toBe("coming_soon");
      expect(tierBadge(f, ON).label).toBe("Coming soon");
      for (const p of PLANS) expect(cellFor(f, p, ON)).toBe("soon");
    }
  });

  it("treats a released feature as Coming Soon while its production switch is off", () => {
    const gated = MARKETING_FEATURES.filter((f) => f.gate && f.release === "live");
    expect(gated.length).toBeGreaterThan(0);
    for (const f of gated) {
      expect(featureStatus(f, OFF)).toBe("coming_soon");
      expect(featureStatus(f, ON)).toBe("live");
      for (const p of PLANS) expect(cellFor(f, p, OFF)).toBe("soon");
    }
    expect(pmMarketedLive(OFF)).toBe(false);
    expect(pmMarketedLive(ON)).toBe(true);
  });

  it("matches the entitlement the app enforces (feature registry)", () => {
    const map = { free: "core", unlimited: "unlimited", pm: "pm" } as const;
    for (const f of MARKETING_FEATURES.filter((x) => x.registry)) {
      const r = getFeature(f.registry!);
      expect(r, f.id).toBeDefined();
      expect(f.tier, f.id).toBe(map[r!.entitlement]);
    }
  });

  it("puts separately billed scheduling features behind the add-on, never in Unlimited", () => {
    for (const f of MARKETING_FEATURES.filter((x) => x.tier === "pm" && x.release === "live")) {
      expect(cellFor(f, "free", ON)).toBe("no");
      expect(cellFor(f, "unlimited", ON)).toBe("addon");
      expect(cellFor(f, "enterprise", ON)).toBe("enterprise");
    }
    // One bundle price, shown once on the pricing page: rows never say "$4.99" per feature.
    expect(cellLabel("addon")).toBe("In the add-on bundle");
    expect(cellLabel("addon")).not.toMatch(/\$/);
  });

  it("explains that a PM editor seat is not a user license", () => {
    const f = MARKETING_FEATURES.find((x) => x.id === "pm_editors")!;
    expect(f.description).toMatch(/needs a licensed user/);
    expect(f.hint).toMatch(/not a user license/);
    expect(cellLabel(cellFor(f, "enterprise", ON))).toBe("1 included, extra $1.99/mo each");
  });

  it("keeps enterprise-only features off Free and Unlimited", () => {
    for (const f of MARKETING_FEATURES.filter((x) => x.tier === "enterprise" && !x.cells)) {
      expect(cellFor(f, "free", ON)).toBe("no");
      expect(cellFor(f, "unlimited", ON)).toBe("no");
      expect(cellFor(f, "enterprise", ON)).toBe("included");
    }
  });

  it("gives every pillar homepage features", () => {
    for (const p of ["win", "run", "grow"] as const) expect(featuresFor(p, { homeOnly: true }).length).toBeGreaterThanOrEqual(4);
  });

  it("sends each account to the right purchase path", () => {
    const free = pmUpgradeCopy("free");
    expect(free.href).toBe("/pricing#project-command-center");
    expect(free.body).toMatch(/Start Individual Unlimited \(\$19\.99\/month or \$199\/year\), then add Project Command Center for \$4\.99\/month/);
    const unl = pmUpgradeCopy("unlimited");
    expect(unl.href).toBe("/settings/billing#project-command-center");
    expect(unl.title).toBe("Unlock Project Command Center");
    expect(unl.body).toMatch(/Schedule jobs, manage subcontractors, track progress and keep customers informed\. \$4\.99\/month/);
    expect(pmUpgradeCopy("company").cta).toBe("");
  });
});
