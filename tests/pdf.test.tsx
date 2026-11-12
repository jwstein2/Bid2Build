import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderProposalPdf, pdfFilename } from "@/lib/pdf/render";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig, type ProposalTemplateId } from "@/lib/proposal/types";
import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency } from "@/lib/estimate/money";
import { est, item } from "./helpers";

async function pdfText(buf: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    text += c.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  }
  return { pages: doc.numPages, text };
}

const biz = { ...defaultBusinessProfile(), companyName: "Acme Decks & Porches", phone: "555-0100", website: "acme.test" };

function bigEstimate() {
  const groups = Array.from({ length: 6 }, (_, g) => ({ id: `g${g}`, name: `Section ${g + 1} with a fairly long descriptive name`, visibility: null, sortOrder: g }));
  const items = groups.flatMap((g, gi) =>
    Array.from({ length: 18 }, (_, k) =>
      item(g.id, String(k + 1), (12.37 * (k + 1) + gi).toFixed(2), {
        name: `Line item ${gi + 1}.${k + 1}`,
        description: k % 3 === 0 ? "A long description that wraps onto multiple lines in the PDF table so we can verify that long text is handled without clipping or overlapping the price columns on the right side of the page. ".repeat(2) : undefined,
      }),
    ),
  );
  return est({ groups, items, taxRate: "7.25", defaultGroupVisibility: "itemized", title: "Whole-home renovation — phase 2 “premium”" });
}

describe("20. multi-page PDF rendering", () => {
  it("renders a long estimate across several US Letter pages with consistent totals", async () => {
    const e = bigEstimate();
    const doc = buildProposal(e, biz, { ...defaultProposalConfig(), template: "detailed" });
    const buf = await renderProposalPdf(doc);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const { pages, text } = await pdfText(buf);
    expect(pages).toBeGreaterThan(2);
    expect(text).toContain(doc.pricing.total);
    expect(text).toContain("Page 1 of");
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // letter size
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const d = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const vp = (await d.getPage(1)).getViewport({ scale: 1 });
    expect([Math.round(vp.width), Math.round(vp.height)]).toEqual([612, 792]);
  }, 60000);

  it("every template renders, with logo, and no internal costs in the text", async () => {
    const e = est({ items: [item("g1", "3", "100", { name: "Composite Decking" }), item("g2", "10", "50", { name: "Install" })], taxRate: "5" });
    const t = computeEstimate(e);
    const logo = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#1f3a5f" } }).png().toBuffer();
    for (const template of ["classic", "modern", "premium", "detailed", "compact"] as ProposalTemplateId[]) {
      const doc = buildProposal(e, biz, { ...defaultProposalConfig(), template });
      const { text, pages } = await pdfText(await renderProposalPdf(doc, { data: logo, format: "png" }));
      expect(pages, template).toBeGreaterThanOrEqual(1);
      expect(text, template).toContain(formatCurrency(t.total));
      expect(text, template).not.toContain(formatCurrency(t.items[e.items[0].id].unitCost)); // $100.00 internal cost
    }
  }, 60000);

  it("9. PDF and preview show identical totals (same canonical document)", async () => {
    const e = bigEstimate();
    e.fixedAdjustment = "-250";
    const doc = buildProposal(e, biz, defaultProposalConfig());
    const { text } = await pdfText(await renderProposalPdf(doc));
    for (const v of [doc.pricing.subtotal, doc.pricing.tax!.amount, doc.pricing.total, doc.pricing.adjustment!.amount]) expect(text).toContain(v);
    for (const sec of doc.pricing.sections) expect(text).toContain(sec.amount!);
  }, 60000);

  it("builds safe filenames", () => {
    const doc = buildProposal(est({ title: "Smith / Deck: \"Phase 1\"" }), biz, defaultProposalConfig());
    expect(pdfFilename(doc, 2)).toMatch(/^[\w-]+_[\w-]+_[\w-]+_v2\.pdf$/);
  });
});
