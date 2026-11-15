import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/estimate/engine";
import { createEstimate, defaultTitleFor, isDefaultTitle } from "@/lib/estimate/factory";
import { exportReadiness, isEstimateComplete, isProjectComplete } from "@/lib/estimate/readiness";
import { stepStatuses } from "@/lib/estimate/step-status";
import type { BuilderStep } from "@/lib/estimate/workflow";
import { buildProposal } from "@/lib/proposal/build";
import { customerText, displayPhone, LEGACY_TERMS_PLACEHOLDER, stripInstructionalText } from "@/lib/proposal/customer-text";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

const biz = { ...defaultBusinessProfile(), companyName: "Acme Decks", contactName: "Dana Lee", email: "hi@acme.test", phone: "5555550100", address: "1 Main St" };
const ready = (extra = {}) => est({ title: "Smith deck", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")], ...extra });

describe("project title (P0: starter title no longer concatenates)", () => {
  it("new bids get the trade's starter title, which counts as a suggestion", () => {
    const e = createEstimate("decks");
    expect(e.title).toBe(defaultTitleFor("decks"));
    expect(e.title).toMatch(/ Project$/);
    expect(isDefaultTitle(e)).toBe(true);
    expect(isDefaultTitle(createEstimate("other"))).toBe(true);
    expect(createEstimate("other").title).toBe("New Project");
  });
  it("saved and edited titles are never treated as the starter title", () => {
    const e = createEstimate("decks");
    expect(isDefaultTitle({ ...e, title: "Smith backyard deck" })).toBe(false);
    expect(isDefaultTitle({ ...e, title: `${e.title}Smith` })).toBe(false);
    expect(isDefaultTitle({ ...e, title: "" })).toBe(false);
    // a title from another trade is a real title for this bid
    expect(isDefaultTitle({ ...e, title: defaultTitleFor("roofing") })).toBe(false);
  });
  it("the proposal (preview and PDF share buildProposal) shows the edited title", () => {
    const doc = buildProposal(ready({ title: "  Smith backyard deck " }), biz, defaultProposalConfig());
    expect(doc.meta.title).toBe("Smith backyard deck");
  });
});

describe("customer-facing legal placeholders (P0)", () => {
  it("new proposals no longer ship the instructional sentence", () => {
    expect(defaultProposalConfig().terms).not.toMatch(/placeholder|attorney|\[/i);
  });
  it("legacy drafts with the old default terms print without the instruction", () => {
    const legacy = { ...defaultProposalConfig(), terms: `This proposal is valid until the expiration date shown. ${LEGACY_TERMS_PLACEHOLDER}` };
    const doc = buildProposal(ready(), biz, legacy);
    expect(doc.terms).toBe("This proposal is valid until the expiration date shown.");
    expect(JSON.stringify(doc)).not.toMatch(/attorney|placeholder/i);
  });
  it("terms that were only the placeholder are omitted entirely", () => {
    expect(buildProposal(ready(), biz, { ...defaultProposalConfig(), terms: LEGACY_TERMS_PLACEHOLDER }).terms).toBeUndefined();
    expect(buildProposal(ready(), biz, { ...defaultProposalConfig(), terms: "  " }).terms).toBeUndefined();
  });
  it("keeps genuine contractor terms exactly, including ordinary brackets and line breaks", () => {
    const t = "1. Deposit [30%] due at signing.\n\n2. Warranty: 2 years on labor.";
    expect(stripInstructionalText(t)).toBe(t);
    expect(buildProposal(ready(), biz, { ...defaultProposalConfig(), terms: t }).terms).toBe(t);
  });
  it("drops other editor notes in any customer text section", () => {
    expect(customerText("Start in 3 weeks. [Insert your crew size here]")).toBe("Start in 3 weeks.");
    expect(customerText("[TODO: replace with your schedule]")).toBeUndefined();
    const doc = buildProposal(ready(), biz, { ...defaultProposalConfig(), schedule: "About 5 days. [Placeholder: edit this]", introduction: "[Have this reviewed by counsel]" });
    expect(doc.schedule).toBe("About 5 days.");
    expect(doc.introduction).toBeUndefined();
  });
});

describe("phone numbers on customer documents", () => {
  it("formats US numbers and leaves everything else as typed", () => {
    expect(displayPhone("5555550100")).toBe("(555) 555-0100");
    expect(displayPhone("+1 555 555 0100")).toBe("(555) 555-0100");
    expect(displayPhone("555-555-0100 ext 2")).toBe("555-555-0100 ext 2");
    expect(displayPhone("+44 7700 900123")).toBe("+44 7700 900123");
    expect(displayPhone("555-0100")).toBe("555-0100");
    expect(buildProposal(ready(), biz, defaultProposalConfig()).brand.contact.find((c) => c.label === "Phone")?.value).toBe("(555) 555-0100");
  });
});

describe("export readiness (P0: required fields, shared by builder and export API)", () => {
  const check = (e = ready(), b: { companyName: string } | null = biz) => exportReadiness(e, b, computeEstimate(e)).map((i) => i.code);
  it("a complete, priced proposal is ready", () => expect(check()).toEqual([]));
  it("flags each missing required detail with the step and field to fix it", () => {
    const e = ready({ title: " ", customer: { name: "" } });
    const issues = exportReadiness(e, { companyName: "" }, computeEstimate(e));
    expect(issues.map((i) => i.code)).toEqual(["company_name", "customer_name", "project_title", "project_address"]);
    expect(issues.find((i) => i.code === "project_address")).toMatchObject({ step: "project", fieldId: "c-addr", message: "Add a project address before downloading this proposal." });
    expect(issues[0]).toMatchObject({ step: "company", fieldId: "b-name" });
  });
  it("requires valid, priced line items", () => {
    expect(check(ready({ items: [] }))).toEqual(["no_items"]);
    expect(check(ready({ items: [item("g1", "abc", "20")] }))).toEqual(["invalid_items"]);
    expect(check(ready({ items: [item("g1", "10", "")] }))).toEqual(["zero_total"]);
    expect(check(ready({ items: [item("g1", "10", "20", { isExample: true })] }))).toEqual(["no_items"]);
  });
  it("keeps optional fields optional (customer email/phone, ZIP, scope, business phone)", () => {
    expect(check(ready({ customer: { name: "Pat", projectAddress: "48 Oak" }, location: {} }), { companyName: "Acme" })).toEqual([]);
  });
});

describe("builder step indicators (P0: no false checkmarks)", () => {
  const cfg = defaultProposalConfig();
  const statuses = (e = est(), opts: { visited?: BuilderStep[]; finalized?: boolean; business?: typeof biz | null } = {}) =>
    stepStatuses({ estimate: e, business: opts.business === undefined ? biz : opts.business, config: cfg, totals: computeEstimate(e), visited: new Set(opts.visited ?? []), finalized: opts.finalized ?? false });

  it("empty estimate: opening steps never marks them complete", () => {
    const s = statuses(est({ customer: { name: "" }, items: [] }), { visited: ["project", "estimate", "scope", "proposal"], business: null });
    expect(s).toEqual({ company: "todo", project: "needs_attention", estimate: "needs_attention", scope: "visited", proposal: "visited" });
  });
  it("partially complete: customer without address, unpriced item", () => {
    const e = est({ customer: { name: "Pat" }, items: [item("g1", "4", "")] });
    expect(isProjectComplete(e)).toBe(false);
    expect(isEstimateComplete(e, computeEstimate(e))).toBe(false);
    const s = statuses(e, { visited: ["company", "project", "estimate"] });
    expect(s.company).toBe("complete");
    expect(s.project).toBe("needs_attention");
    expect(s.estimate).toBe("needs_attention");
  });
  it("invalid line items never show a check", () => {
    expect(statuses(ready({ items: [item("g1", "-2", "20")] }), { visited: ["estimate"] }).estimate).toBe("needs_attention");
  });
  it("priced estimate: required steps complete, proposal not yet finalized", () => {
    const s = statuses(ready(), { visited: ["proposal"] });
    expect(s).toMatchObject({ company: "complete", project: "complete", estimate: "complete", proposal: "visited" });
  });
  it("finalized estimate marks the proposal step complete", () => {
    expect(statuses(ready(), { finalized: true }).proposal).toBe("complete");
    expect(statuses(ready({ customer: { name: "Pat" } }), { finalized: true }).proposal).toBe("todo");
  });
});
