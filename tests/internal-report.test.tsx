/**
 * Internal Estimate Report: numbers match the estimator, markup and margin stay distinct, nothing is
 * invented, the PDF renders, and customer-facing documents never carry internal cost or profit figures.
 */
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildInternalReport, internalReportFilename } from "@/lib/reports/internal-estimate";
import { InternalReportPdf } from "@/lib/pdf/internal-report-pdf";
import { renderProposalPdf } from "@/lib/pdf/render";
import { buildProposal } from "@/lib/proposal/build";
import { computeEstimate } from "@/lib/estimate/engine";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { isOutsideCompany } from "@/components/builder/internal-report";
import { est, item } from "./helpers";

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  return text;
}

// Distinctive costs (…17, …43) so they can't collide with customer prices.
const estimate = est({
  title: "Smith deck", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, taxRate: "8", fixedAdjustment: "-100",
  items: [
    item("g1", "10", "41.17", { name: "Composite boards", costType: "material" }),
    item("g1", "1", "250", { name: "Permit fee", costType: "permit", treatment: "pass_through", taxable: false }),
    item("g2", "16", "55.43", { name: "Install labor", costType: "labor", taxable: false }),
  ],
});

describe("internal report numbers", () => {
  const r = buildInternalReport(estimate, { now: new Date("2026-11-15T12:00:00Z") });
  const t = computeEstimate(estimate);
  it("matches the estimator's totals exactly", () => {
    expect(r.totals.directCost).toBe(t.totalCost.toFixed(2));
    expect(r.totals.sellingPrice).toBe(t.subtotal.toFixed(2));
    expect(r.totals.grossProfit).toBe(t.grossProfit.toFixed(2));
    expect(r.totals.customerTotal).toBe(t.total.toFixed(2));
    expect(r.totals.tax).toBe(t.tax.toFixed(2));
  });
  it("keeps markup and gross margin distinct", () => {
    const line = r.sections[0].lines[0]; // 25% markup
    expect(line.unitCost).toBe("41.17");
    expect(line.unitPrice).toBe("51.46");
    expect(line.markupPct).toBe("25.0");
    expect(line.marginPct).toBe("20.0");
    expect(r.totals.markupPct).not.toBe(r.totals.marginPct);
  });
  it("section subtotals add up to the project", () => {
    const cost = r.sections.reduce((s, x) => s + Number(x.cost), 0);
    expect(cost.toFixed(2)).toBe(r.totals.directCost);
  });
  it("shows only cost components that exist and explains pass-through and the discount", () => {
    expect(r.costBreakdown.map((c) => c.costType).sort()).toEqual(["labor", "material", "permit"]);
    expect(r.costBreakdown.some((c) => c.costType === "contingency")).toBe(false);
    const permit = r.sections[0].lines[1];
    expect(permit.passThrough).toBe(true);
    expect(permit.grossProfit).toBe("0.00");
    expect(r.notes.join(" ")).toMatch(/billed at cost/);
    expect(r.notes.join(" ")).toMatch(/discount of \$100\.00/);
  });
  it("filename is clearly internal", () => {
    expect(internalReportFilename(r)).toMatch(/^INTERNAL_Smith-deck_EST-1_cost-report\.pdf$/);
  });
});

describe("internal report PDF", () => {
  it("renders with the confidential banner, costs and margins", async () => {
    const r = buildInternalReport(estimate);
    const buf = await renderToBuffer(<InternalReportPdf r={r} company={{ name: "Acme Decks" }} />);
    const text = await pdfText(buf);
    expect(text).toMatch(/INTERNAL - CONFIDENTIAL/);
    expect(text).toMatch(/Internal Estimate Report/);
    expect(text).toContain("$41.17");
    expect(text).toMatch(/Gross margin/);
    expect(text).toMatch(/Markup on cost/i);
  }, 30_000);
});

describe("privacy boundary: customer documents carry no internal figures", () => {
  const biz = { ...defaultBusinessProfile(), companyName: "Acme Decks" };
  const r = buildInternalReport(estimate);
  const secrets = ["41.17", "55.43", r.totals.directCost, r.totals.grossProfit];
  it("proposal document data has no unit costs, total cost or profit", () => {
    const doc = JSON.stringify(buildProposal(estimate, biz, defaultProposalConfig()));
    for (const s of secrets) expect(doc).not.toContain(s);
    expect(doc.toLowerCase()).not.toMatch(/gross margin|gross profit|markup|unit cost|internal/);
  });
  it("customer proposal PDF has no unit costs, total cost or profit", async () => {
    const text = await pdfText(await renderProposalPdf(buildProposal(estimate, biz, defaultProposalConfig())));
    for (const s of secrets) expect(text).not.toContain(Number(s).toLocaleString("en-US", { minimumFractionDigits: 2 }));
    expect(text).not.toMatch(/INTERNAL|Gross margin|Markup/i);
  }, 30_000);
});

describe("send warning", () => {
  it("flags recipients outside the business email domain", () => {
    expect(isOutsideCompany("pat@gmail.com", "office@acme.test")).toBe(true);
    expect(isOutsideCompany("bob@acme.test", "office@acme.test")).toBe(false);
    expect(isOutsideCompany("bob@acme.test", null)).toBe(true);
    expect(isOutsideCompany("not-an-email", "office@acme.test")).toBe(false);
  });
});
