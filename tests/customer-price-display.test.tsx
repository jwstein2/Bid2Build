/**
 * Phase 1 (Nov 18 review): customer-facing price display. Every presentation mode, every template,
 * the web view and the PDF; company-managed bids honor "Single project total"; nothing internal leaks.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { est, item } from "./helpers";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig, type ProposalConfig } from "@/lib/proposal/types";
import { TEMPLATES } from "@/lib/proposal/templates";
import { ProposalView } from "@/components/proposal/proposal-view";
import { ProposalPdf } from "@/lib/pdf/proposal-pdf";
import { canEditStyleKey, resolveProposalStyle, type StylePolicy } from "@/lib/operations/proposal-style";
import type { Estimate, GroupVisibility } from "@/lib/estimate/types";

const business = { ...defaultBusinessProfile(), companyName: "Acme Concrete" };
// Costs: 10 x $20.00 = $200.00 and 2 x $150.00 = $300.00, 25% markup -> prices $250.00 and $375.00.
const base = est({
  title: "Driveway Pour",
  trades: ["concrete"],
  taxRate: "7",
  items: [
    item("g1", "10", "20", { id: "a", name: "Ready-mix concrete", notes: "Internal: supplier quote #77" }),
    item("g2", "2", "150", { id: "b", name: "Finishing crew", costType: "labor" }),
  ],
});
const config: ProposalConfig = { ...defaultProposalConfig(), show: { ...defaultProposalConfig().show, notes: false } };
const INTERNAL = ["$200.00", "$300.00", "$20.00", "$150.00", "$500.00", "25%", "$125.00", "markup", "margin", "supplier quote"];

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
async function pdfText(pdf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let p = 1; p <= d.numPages; p++) out.push((await (await d.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" "));
  return out.join("\n");
}
const withMode = (e: Estimate, displayMode: Estimate["displayMode"], vis: GroupVisibility = "itemized"): Estimate => ({ ...e, displayMode, defaultGroupVisibility: vis });
const noLeak = (s: string) => { for (const x of INTERNAL) expect(s.toLowerCase()).not.toContain(x.toLowerCase()); };

describe("customer price display modes", () => {
  it("Single project total: one project line, totals intact, no sections or line items", () => {
    const doc = buildProposal(withMode(base, "project_total"), business, config);
    expect(doc.pricing.displayMode).toBe("project_total");
    expect(doc.pricing.sections).toEqual([]);
    expect(doc.pricing.projectLabel).toBe("Driveway Pour");
    expect(doc.pricing.subtotal).toBe("$625.00");
    expect(doc.pricing.tax?.amount).toBe("$43.75");
    expect(doc.pricing.total).toBe("$668.75");
    const html = textOf(renderToStaticMarkup(<ProposalView doc={doc} />));
    expect(html).toContain("Driveway Pour");
    expect(html).toContain("$668.75");
    expect(html).not.toContain("Ready-mix concrete");
    expect(html).not.toContain("Finishing crew");
    expect(html).not.toContain("$250.00");
    noLeak(html);
  });

  it("a discount folds into the single total instead of showing as its own line", () => {
    const doc = buildProposal({ ...withMode(base, "project_total"), fixedAdjustment: "-25" }, business, config);
    expect(doc.pricing.adjustment).toBeUndefined();
    expect(doc.pricing.subtotal).toBe("$600.00");
  });

  it("itemized, section totals and names only show exactly what they promise", () => {
    const itemized = buildProposal(withMode(base, "by_group", "itemized"), business, config);
    expect(itemized.pricing.sections.flatMap((s) => s.lines.map((l) => l.amount))).toEqual(["$250.00", "$375.00"]);
    const totals = buildProposal(withMode(base, "by_group", "group_total"), business, config);
    expect(totals.pricing.sections.map((s) => [s.amount, s.lines.length])).toEqual([["$250.00", 0], ["$375.00", 0]]);
    const names = buildProposal(withMode(base, "by_group", "names_only"), business, { ...config, show: { ...config.show, groupPrices: false } });
    expect(names.pricing.sections.flatMap((s) => s.lines.map((l) => l.name))).toEqual(["Ready-mix concrete", "Finishing crew"]);
    expect(names.pricing.sections.flatMap((s) => [s.amount, ...s.lines.map((l) => l.amount)]).filter(Boolean)).toEqual([]);
    for (const d of [itemized, totals, names]) expect(d.pricing.total).toBe("$668.75");
  });

  it("every mode in every template keeps cost, markup and internal notes out of the web view", () => {
    for (const t of TEMPLATES) {
      for (const [mode, vis] of [["project_total", "itemized"], ["by_group", "itemized"], ["by_group", "group_total"], ["by_group", "names_only"]] as const) {
        const doc = buildProposal(withMode(base, mode, vis), business, { ...config, template: t.id });
        const html = textOf(renderToStaticMarkup(<ProposalView doc={doc} />));
        expect(html, `${t.id} ${mode} ${vis}`).toContain("$668.75");
        noLeak(html);
      }
    }
  });

  it("the PDF shows the single project total in every template", async () => {
    for (const t of TEMPLATES) {
      const doc = buildProposal(withMode(base, "project_total"), business, { ...config, template: t.id });
      const text = (await pdfText(await renderToBuffer(<ProposalPdf doc={doc} />))).replace(/\s+/g, " ");
      expect(text, t.id).toContain("Driveway Pour");
      expect(text, t.id).toContain("$668.75");
      expect(text, t.id).not.toContain("Ready-mix");
      noLeak(text);
    }
  });

  it("editing the estimate immediately changes the customer total", () => {
    const before = buildProposal(withMode(base, "project_total"), business, config);
    const edited = { ...withMode(base, "project_total"), items: base.items.map((i) => (i.id === "a" ? { ...i, quantity: "20" } : i)) };
    const after = buildProposal(edited, business, config);
    expect(before.pricing.subtotal).toBe("$625.00");
    expect(after.pricing.subtotal).toBe("$875.00");
  });
});

describe("company-managed bids (Team) and Single project total", () => {
  const policy = (p: Partial<StylePolicy>): StylePolicy => ({ managed: true, companyId: "c1", style: {}, locked: [], allowCustomization: false, canCustomize: false, canOverride: true, revision: 1, ...p });

  it("company left price display as 'Each bid decides': the bid's Single project total applies", () => {
    // This was the demo bug: new companies get a style row with customization off, so the bid's choice was dropped.
    const r = resolveProposalStyle({ policy: policy({}), estimate: withMode(base, "project_total"), business, config });
    expect(r.estimate.displayMode).toBe("project_total");
    expect(r.sources.displayMode).toBe("bid");
    expect(buildProposal(r.estimate, r.business, r.config).pricing.sections).toEqual([]);
    expect(canEditStyleKey(policy({}), "displayMode")).toBe(true);
    const vis = resolveProposalStyle({ policy: policy({}), estimate: withMode(base, "by_group", "names_only"), business, config });
    expect(vis.estimate.defaultGroupVisibility).toBe("names_only");
  });

  it("a company price display setting is respected when members can't customize", () => {
    const p = policy({ style: { displayMode: "by_group" } });
    const r = resolveProposalStyle({ policy: p, estimate: withMode(base, "project_total"), business, config });
    expect(r.estimate.displayMode).toBe("by_group");
    expect(canEditStyleKey(p, "displayMode")).toBe(false);
  });

  it("with customization allowed, the bid's recorded choice wins over the company setting", () => {
    const p = policy({ style: { displayMode: "by_group" }, allowCustomization: true });
    const r = resolveProposalStyle({ policy: p, estimate: withMode(base, "project_total"), business, config: { ...config, styleOverrides: ["displayMode"] } });
    expect(r.estimate.displayMode).toBe("project_total");
  });

  it("a locked company setting always wins", () => {
    const p = policy({ style: { displayMode: "project_total" }, locked: ["displayMode"], allowCustomization: true });
    const r = resolveProposalStyle({ policy: p, estimate: withMode(base, "by_group"), business, config: { ...config, styleOverrides: ["displayMode"] } });
    expect(r.estimate.displayMode).toBe("project_total");
    expect(r.sources.displayMode).toBe("locked");
    expect(canEditStyleKey(p, "displayMode")).toBe(false);
  });
});
