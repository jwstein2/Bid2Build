import { describe, expect, it } from "vitest";
import { est, item } from "./helpers";
import { computeEstimate } from "@/lib/estimate/engine";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { canEditStyleKey, resolveProposalStyle, sanitizeCompanyStyle, sanitizeLocks, STYLE_KEYS, type StylePolicy } from "@/lib/operations/proposal-style";
import { contractSummary } from "@/lib/operations/contract";
import { approvedSubAmount, compareQuotes, primaryQuote, type SubQuote } from "@/lib/operations/sub-quotes";
import { filterSuggestions, normalizeLabels } from "@/lib/operations/photo-labels";
import { jobStatus } from "@/lib/operations/project-status";

const business = { ...defaultBusinessProfile(), companyName: "Member Co", primaryColor: "#111111", secondaryColor: "#222222" };
const owner = { ...defaultBusinessProfile(), companyName: "Owner Builders LLC", primaryColor: "#0a5c36", secondaryColor: "#f2a900", phone: "5555550100" };
const estimate = est({ items: [item("g1", "10", "20", { id: "a" }), item("g2", "2", "150", { id: "b", costType: "subcontractor" })] });
const bidConfig = { ...defaultProposalConfig(), template: "compact" as const, show: { ...defaultProposalConfig().show, itemPrices: false }, styleOverrides: ["template", "show.itemPrices"] };

const policy = (p: Partial<StylePolicy>): StylePolicy => ({ managed: true, companyId: "c1", style: {}, locked: [], allowCustomization: false, canCustomize: false, canOverride: false, revision: 3, ...p });

describe("proposal style resolver (V4.4)", () => {
  it("unmanaged bids keep their own choices", () => {
    const r = resolveProposalStyle({ policy: { managed: false }, estimate, business, config: bidConfig });
    expect(r.config.template).toBe("compact");
    expect(r.config.show.itemPrices).toBe(false);
    expect(r.business.primaryColor).toBe("#111111");
    expect(r.stamp.managed).toBe(false);
  });

  it("customization off: company template wins, bid choices are ignored, gaps use platform defaults", () => {
    const r = resolveProposalStyle({ policy: policy({ style: { template: "premium", primaryColor: "#123456" } }), estimate, business, config: bidConfig });
    expect(r.config.template).toBe("premium");
    expect(r.sources.template).toBe("company");
    expect(r.business.primaryColor).toBe("#123456");
    expect(r.config.show.itemPrices).toBe(true); // platform default, not the bid's false
    expect(r.sources["show.itemPrices"]).toBe("default");
    expect(r.stamp).toEqual({ managed: true, revision: 3, companyId: "c1" });
  });

  it("customization on (with permission): bid choices apply except locked elements", () => {
    const p = policy({ style: { template: "premium", show: { itemPrices: true } }, locked: ["template"], allowCustomization: true, canCustomize: true });
    const r = resolveProposalStyle({ policy: p, estimate, business, config: bidConfig });
    expect(r.config.template).toBe("premium");
    expect(r.sources.template).toBe("locked");
    expect(r.config.show.itemPrices).toBe(false);
    expect(r.sources["show.itemPrices"]).toBe("bid");
    expect(canEditStyleKey(p, "template")).toBe(false);
    expect(canEditStyleKey(p, "show.itemPrices")).toBe(true);
  });

  it("customization on: keys the bid never changed follow the company", () => {
    const p = policy({ style: { template: "premium" }, allowCustomization: true, canCustomize: true });
    const r = resolveProposalStyle({ policy: p, estimate, business, config: { ...bidConfig, styleOverrides: [] }, ownerBusiness: null });
    expect(r.config.template).toBe("premium");
    expect(r.sources.template).toBe("company");
  });

  it("customization on but the member lacks the permission: company style applies", () => {
    const p = policy({ style: { template: "modern" }, allowCustomization: true, canCustomize: false });
    expect(resolveProposalStyle({ policy: p, estimate, business, config: bidConfig }).config.template).toBe("modern");
    expect(canEditStyleKey(p, "template")).toBe(false);
  });

  it("company branding uses the owner's profile", () => {
    const r = resolveProposalStyle({ policy: policy({ style: { companyBranding: true } }), estimate, business, config: bidConfig, ownerBusiness: owner });
    expect(r.business.companyName).toBe("Owner Builders LLC");
    expect(r.business.primaryColor).toBe("#0a5c36");
  });

  it("platform rules drop malformed values", () => {
    expect(sanitizeCompanyStyle({ template: "nope", primaryColor: "red", show: { phone: "yes", email: false } })).toEqual({ show: { email: false } });
    expect(sanitizeLocks(["template", "bogus", "template"])).toEqual(["template"]);
    expect(STYLE_KEYS).toHaveLength(18);
  });

  it("formatting never changes calculations", () => {
    const p = policy({ style: { template: "detailed", displayMode: "project_total", defaultGroupVisibility: "group_total", show: { itemPrices: false, quantities: false } }, locked: ["defaultGroupVisibility"] });
    const r = resolveProposalStyle({ policy: p, estimate: { ...estimate, groups: estimate.groups.map((g) => ({ ...g, visibility: "itemized" as const })) }, business, config: bidConfig });
    const before = computeEstimate(estimate), after = computeEstimate(r.estimate);
    expect(after.total.toString()).toBe(before.total.toString());
    expect(after.totalCost.toString()).toBe(before.totalCost.toString());
    expect(r.estimate.groups.every((g) => g.visibility === null)).toBe(true);
    expect(buildProposal(r.estimate, r.business, r.config).pricing.total).toBe(buildProposal(estimate, business, bidConfig).pricing.total);
  });
});

describe("contract summary", () => {
  it("original + approved additions − approved deductions; pending separate", () => {
    const s = contractSummary("10000", [
      { status: "approved", amount: 1500, lines: [{ kind: "add", description: "Railing", amount: 2000 }, { kind: "remove", description: "Skirting", amount: -500 }] },
      { status: "signed", amount: -250 },
      { status: "sent", amount: 900 },
      { status: "draft", amount: -100 },
      { status: "declined", amount: 5000 },
      { status: "void", amount: 5000 },
    ]);
    expect(s).toMatchObject({ original: "10000.00", approvedAdditions: "2000.00", approvedDeductions: "750.00", current: "11250.00",
      pendingAdditions: "900.00", pendingDeductions: "100.00", pendingNet: "800.00", approvedCount: 2, pendingCount: 2 });
  });
});

describe("subcontractor quote comparison", () => {
  const rev = (id: string, n: number, amount: number) => ({ id, revision: n, amount, quoteDate: null, note: null, documentPath: null, documentName: null, createdAt: "", createdBy: null });
  const q = (p: Partial<SubQuote>): SubQuote => ({ id: "q1", itemId: "b", groupId: "g2", itemName: "Sub", resourceId: null, vendorName: "Ace Framing", estimatedCost: 300, status: "received", internalNotes: null, appliedRevisionId: null, createdAt: "", revisions: [rev("r1", 1, 280), rev("r2", 2, 360)], ...p });

  it("compares original vs latest quote without touching the estimate", () => {
    const c = compareQuotes(estimate, { quotes: [q({})], adjustments: [] });
    const line = c.lines[0];
    expect(line).toMatchObject({ originalCost: "300.00", originalQuote: "280.00", revisedQuote: "360.00", latestQuote: "360.00", difference: "60.00", unapproved: true, appliedForecast: null });
    expect(line.sellingPrice).toBe("375.00");
    expect(line.forecastProfit).toBe("15.00");
    expect(c.totals.originalCost).toBe("500.00");
    expect(c.totals.forecastCost).toBe("560.00");
    expect(c.totals.sellingPrice).toBe("625.00");
    expect(c.totals.forecastMargin).toBe("10.4");
    expect(c.totals.unapprovedLines).toBe(1);
  });

  it("an applied forecast that matches the latest quote is approved", () => {
    const c = compareQuotes(estimate, { quotes: [q({ appliedRevisionId: "r2", status: "accepted" })], adjustments: [{ id: "a1", itemId: "b", groupId: "g2", quoteId: "q1", revisionId: "r2", amount: 60, forecastCost: 360, note: null, createdAt: "", createdBy: null }] });
    expect(c.lines[0].unapproved).toBe(false);
    expect(c.totals.appliedAdjustments).toBe("60.00");
  });

  it("rejected quotes are never the primary quote", () => {
    expect(primaryQuote([q({ id: "x", status: "rejected" }), q({ id: "y" })])?.id).toBe("y");
    expect(primaryQuote([q({ status: "rejected" })])).toBeNull();
  });
});

describe("V6-15 approved subcontractor amount", () => {
  const rev = (id: string, n: number, amount: number) => ({ id, revision: n, amount, quoteDate: null, note: null, documentPath: null, documentName: null, createdAt: "", createdBy: null });
  const q = (p: Partial<SubQuote>): SubQuote => ({ id: "q", itemId: "i", groupId: "g", itemName: "Sub", resourceId: "r1", vendorName: "Ace", estimatedCost: 0, status: "accepted", internalNotes: null, appliedRevisionId: null, createdAt: "", revisions: [rev("a", 1, 1000), rev("b", 2, 1100)], ...p });
  it("sums accepted quotes in the section for the named sub, preferring the applied revision", () => {
    const quotes = [q({}), q({ id: "q2", appliedRevisionId: "a", status: "under_review" }), q({ id: "q3", resourceId: "r2" }), q({ id: "q4", status: "received" }), q({ id: "q5", groupId: "other" })];
    expect(approvedSubAmount(quotes, "g", "r1")).toBe("2100.00");
    expect(approvedSubAmount(quotes, "g", null)).toBe("3200.00");
    expect(approvedSubAmount([q({ status: "rejected" })], "g", null)).toBeNull();
  });
});

describe("photo labels and job status", () => {
  it("normalizes labels and limits AI suggestions to the vocabulary", () => {
    expect(normalizeLabels([" Before ", "before", "Roof  Leak", 3])).toEqual(["before", "roof leak"]);
    expect(filterSuggestions(["roof", "made up tag", "Damage"])).toEqual(["roof", "damage"]);
  });
  it("derives one status for every entry point", () => {
    expect(jobStatus({ stage: "won", reviewStatus: "needs_review" })).toBe("needs_review");
    expect(jobStatus({ stage: "won", reviewStatus: "reviewed" })).toBe("ready_to_schedule");
    expect(jobStatus({ stage: "won", reviewStatus: "reviewed", scheduleStatus: "draft" })).toBe("draft_schedule");
    expect(jobStatus({ stage: "scheduled", scheduleStatus: "active" })).toBe("scheduled");
    expect(jobStatus({ stage: "in_progress", scheduleStatus: "active" })).toBe("in_progress");
    expect(jobStatus({ stage: "completed" })).toBe("completed");
    expect(jobStatus({ stage: "sent" })).toBeNull();
    // Stage set to Scheduled by hand, but no schedule exists (review queue knows: null) → still needs one.
    expect(jobStatus({ stage: "scheduled", reviewStatus: "reviewed", scheduleStatus: null })).toBe("ready_to_schedule");
    expect(jobStatus({ stage: "scheduled", reviewStatus: "needs_review", scheduleStatus: null })).toBe("needs_review");
    expect(jobStatus({ stage: "scheduled", reviewStatus: "reviewed", scheduleStatus: "draft" })).toBe("draft_schedule");
    expect(jobStatus({ stage: "scheduled" })).toBe("scheduled");
  });
});

describe("V4.3 amendment helpers", async () => {
  const { inheritedProfilePatch } = await import("@/lib/enterprise/inherit-profile");
  const { frequentItems, usageCounts, usesFor, organizeLibrary } = await import("@/lib/library/saved-items");
  const { shareContent } = await import("@/lib/operations/scope");
  const { liveDateChanges } = await import("@/lib/operations/live-schedule");

  it("an invited member inherits blank company details but keeps their own email and choices", () => {
    const ownerRow = { company_name: "Owner Builders", phone: "555", email: "owner@co.test", primary_color: "#0a5c36", logo_layout: "left", website: "https://co.test" };
    const mine = { company_name: "", phone: null, email: null, website: "https://me.test", primary_color: "#1f3a5f" };
    const p = inheritedProfilePatch(mine, ownerRow, "member@me.test");
    expect(p).toMatchObject({ company_name: "Owner Builders", phone: "555", primary_color: "#0a5c36", email: "member@me.test" });
    expect(p.website).toBeUndefined();        // already set by the member
    expect(p.email).not.toBe("owner@co.test"); // never the owner's email
    expect(p.logo_layout).toBeUndefined();     // owner is on the platform default
    expect(inheritedProfilePatch(mine, null, "m@x.test")).toEqual({});
  });

  it("saved items: frequently used first, editing never touches estimates (values are copied)", () => {
    const counts = usageCounts(["Framing", "framing ", "Drywall", "Framing", null]);
    expect(usesFor(counts, "FRAMING")).toBe(3);
    const items = [
      { id: "1", name: "Drywall", costType: "material", treatment: "marked_up", unit: "sheet", unitCost: "12", taxable: true, uses: 1 },
      { id: "2", name: "Framing", costType: "labor", treatment: "pass_through", unit: "hour", unitCost: "60", taxable: false, uses: 3 },
      { id: "3", name: "Anchors", costType: "material", treatment: "marked_up", unit: "each", unitCost: "1", taxable: true, uses: 2 },
    ] as const;
    expect(frequentItems([...items]).map((i) => i.name)).toEqual(["Framing", "Anchors"]);
    const lib = organizeLibrary([...items].map((i) => ({ ...i, category: "General" })));
    expect(lib[0].categories[0].items.map((i) => i.name)).toEqual(["Framing", "Anchors", "Drywall"]);
  });

  it("scope sharing only includes the chosen fields and never internal notes or costs", () => {
    const sec = { id: "s", estimate_id: "e", source_group_id: "g", trade: "electrical", title: "Rough-in", sort_order: 0, approved_scope: "Panel", work_description: "Run wire",
      technical_instructions: "14 AWG", installation_notes: null, internal_notes: "Margin is thin", customer_info: "Kids at home", resource_id: null, revision: 2, updated_at: "", updated_by: null };
    const c = shareContent(sec, ["workDescription", "technicalInstructions"], { projectTitle: "Smith", company: "Co" });
    expect(c.fields).toEqual({ workDescription: "Run wire", technicalInstructions: "14 AWG" });
    expect(JSON.stringify(c)).not.toMatch(/Margin is thin|Kids at home/);
  });

  it("V6-15: customer contact and pricing are shared only when chosen", () => {
    const sec = { id: "s", estimate_id: "e", source_group_id: "g", trade: "roofing", title: "Roof", sort_order: 0, approved_scope: null, work_description: "Tear off",
      technical_instructions: null, installation_notes: null, internal_notes: "Markup 35%", customer_info: null, resource_id: null, revision: 1, updated_at: "", updated_by: null };
    const customer = { name: "Pat Example", phone: "555-0100", email: "pat@example.test" };
    const off = shareContent(sec, ["workDescription"], { projectTitle: "P", company: "Co", customer });
    expect(off.fields).toEqual({ workDescription: "Tear off" });
    expect("pricing" in off).toBe(false);
    const on = shareContent(sec, ["workDescription", "customerName", "customerPhone"], { projectTitle: "P", company: "Co", customer, pricing: { kind: "budget", amount: "4200.00" } });
    expect(on.fields).toEqual({ workDescription: "Tear off", customerName: "Pat Example", customerPhone: "555-0100" });
    expect(on.pricing).toEqual({ kind: "budget", amount: "4200.00" });
    expect(JSON.stringify(on)).not.toMatch(/pat@example|Markup/);
  });

  it("live schedule changes list previous and proposed dates and flag downstream tasks", () => {
    const t = (id: string, s: string, e: string) => ({ id, name: id, plannedStart: s, plannedEnd: e }) as never;
    const ch = liveDateChanges([t("a", "2026-11-16", "2026-11-18"), t("b", "2026-11-19", "2026-11-20")], [t("a", "2026-11-17", "2026-11-19"), t("b", "2026-11-20", "2026-11-23")], [{ from: "a", to: "b" }] as never);
    expect(ch).toHaveLength(2);
    expect(ch.find((c) => c.taskId === "b")?.downstream).toBe(true);
    expect(ch.find((c) => c.taskId === "a")).toMatchObject({ from: { start: "2026-11-16" }, to: { start: "2026-11-17" }, downstream: false });
  });
});
