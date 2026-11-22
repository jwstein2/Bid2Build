import { describe, expect, it } from "vitest";
import { buildGuide } from "@/lib/academy/startup/guide";
import { TRADE_NEEDS, needsFor } from "@/lib/academy/startup/trades";
import { CREDENTIAL_KEYS, type Credential, type FederalFile, type StateFile } from "@/lib/academy/startup/types";
import { FEDERAL, STATE_FILES } from "@/lib/academy/startup/data/index";
import { trades } from "@/lib/trades/catalog";

const v = (c: Partial<Credential>): Credential => ({ status: "state_license", summary: "Plain summary.", pending_reason: null, status_check: "verified", url: "https://example.gov/x", ...c });
const pending = (c: Partial<Credential>): Credential => ({ status: "state_license", summary: "Should not show.", pending_reason: "Quote not found.", status_check: "pending_review", url: "https://example.gov/y", ...c });

const fixture: StateFile = {
  state: "ZZ", researched_on: "2026-11-22", checked_at: "2026-11-22T00:00:00Z",
  general: {
    entity: { agency: "SOS", summary: "Register.", url: "https://sos.example.gov", quote: "q", pending_reason: null, status_check: "verified" },
    workers_comp: { agency: "DLI", summary: "Hidden.", url: "https://dli.example.gov", quote: "q", pending_reason: "x", status_check: "pending_review" },
  },
  credentials: {
    residential_building: v({ name: "Residential Contractor", prerequisites: ["Pass the exam"], bond: "a bond is required" }),
    commercial_building: v({ status: "local_only", name: "Commercial", summary: "Cities license it." }),
    electrical: v({ name: "Electrical Contractor", prerequisites: ["Master electrician on staff"] }),
    plumbing: pending({ name: "Plumbing" }),
    mechanical: v({ status: "no_state_license", summary: "No state HVAC license." }),
    roofing: v({ status: "unknown", summary: null }),
    pesticide: v({ name: "Commercial Applicator" }),
    asbestos: v({ name: "Asbestos Contractor" }),
    lead_rrp: v({ status: "no_state_license", summary: "EPA runs it here." }),
  },
  other: [{ key: "irrigation", name: "Irrigation license", agency: "Ag", trades: ["landscaping"], summary: "Irrigation.", url: "https://ag.example.gov", quote: "q", pending_reason: null, status_check: "verified" }],
};
const fed: FederalFile = {
  checked_at: "2026-11-22T00:00:00Z",
  facts: [
    { key: "ein", name: "EIN", agency: "IRS", trades: ["*"], when: null, summary: "Free.", url: "https://irs.gov", link: "https://irs.gov", quote: "q", pending_reason: null, status_check: "verified" },
    { key: "epa_608", name: "EPA 608", agency: "EPA", trades: ["hvac"], when: "Before you service refrigerant equipment", summary: "Pass the test.", url: "https://epa.gov", link: "https://epa.gov", quote: "q", pending_reason: null, status_check: "verified" },
    { key: "lead_rrp", name: "RRP", agency: "EPA", trades: ["painting"], when: "Before you disturb paint in pre-1978 homes", summary: "Get certified.", url: "https://epa.gov/l", link: "https://epa.gov/l", quote: "q", pending_reason: null, status_check: "verified" },
  ],
};

describe("Start Your Business guide", () => {
  it("puts the trade's state license prerequisites first, then federal certificates", () => {
    const g = buildGuide(fixture, fed, "electrical");
    expect(g.prerequisites.map((p) => p.title)).toEqual(["Electrical Contractor"]);
    expect(g.prerequisites[0].items).toContain("Master electrician on staff");
    const hvac = buildGuide(fixture, fed, "hvac");
    expect(hvac.prerequisites.map((p) => p.id)).toEqual(["pre-us-epa_608"]); // mechanical not licensed statewide here
    expect(hvac.noStateLicense.map((f) => f.id)).toContain("cred-mechanical");
  });

  it("never shows our summary for a fact that wasn't re-found on the official page", () => {
    const g = buildGuide(fixture, fed, "plumbing");
    const plumbing = g.steps.find((s) => s.id === "licenses")!.facts.find((f) => f.id === "cred-plumbing")!;
    expect(plumbing.verified).toBe(false);
    expect(plumbing.summary).toBeNull();
    const wc = g.steps.find((s) => s.id === "insurance")!.facts[0];
    expect(wc.summary).toBeNull();
    expect(g.prerequisites[0]).toMatchObject({ verified: false, items: [] });
  });

  it("lists bonds as prerequisites and unknown categories as still being researched", () => {
    const g = buildGuide(fixture, fed, "roofing");
    expect(g.prerequisites.find((p) => p.id === "pre-residential_building")!.items).toContain("Bond: a bond is required");
    expect(g.unconfirmed.map((u) => u.key)).toContain("roofing");
  });

  it("shows only the trade's own extra state credentials", () => {
    expect(buildGuide(fixture, fed, "landscaping").steps.find((s) => s.id === "licenses")!.facts.map((f) => f.id)).toContain("other-irrigation");
    expect(buildGuide(fixture, fed, "roofing").steps.find((s) => s.id === "licenses")!.facts.map((f) => f.id)).not.toContain("other-irrigation");
  });

  it("maps every catalog trade", () => {
    for (const t of trades.filter((x) => x.slug !== "other")) expect(TRADE_NEEDS[t.slug], t.slug).toBeDefined();
    expect(needsFor("pest-control").core).toEqual(["pesticide"]);
    expect(needsFor(null).core).toEqual(["residential_building"]);
  });
});

describe("checked state data", () => {
  const files = Object.values(STATE_FILES);
  it("has every credential category and official https links on verified facts", () => {
    for (const f of files) {
      for (const k of CREDENTIAL_KEYS) expect(f.credentials[k], `${f.state} ${k}`).toBeDefined();
      const facts = [...Object.values(f.general), ...Object.values(f.credentials), ...f.other];
      for (const x of facts) if (x && x.status_check === "verified") expect(x.url, f.state).toMatch(/^https:\/\//);
    }
  });
  it("has the federal facts every guide uses", () => {
    expect(FEDERAL.facts.map((f) => f.key)).toEqual(expect.arrayContaining(["structure", "ein", "worker_classification", "lead_rrp", "epa_608", "usdot"]));
    for (const f of FEDERAL.facts) expect(f.status_check, f.key).toBe("verified");
  });
});

describe("unconfirmed states", () => {
  it("doesn't claim the state has no license when the trade's license is unconfirmed", () => {
    const g = buildGuide(fixture, fed, "roofing");
    expect(g.coreUnconfirmed).toBe(true);
    expect(g.steps.find((s) => s.id === "licenses")!.intro).not.toMatch(/doesn't license/);
  });
});
