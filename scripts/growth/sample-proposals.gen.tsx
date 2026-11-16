/**
 * Renders the landing-page proposal images from the real proposal engine and PDF renderer, so the
 * screenshots on /bids/<trade> are genuine Built2Bid output. The customer, company and numbers are
 * clearly example data (labelled as such on the page). Re-run after proposal design changes:
 *   npx vitest run -c scripts/growth/vitest.samples.mts
 * Output: public/media/proposals/<trade>-v1.webp (bump the version to replace; images are cached).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { it } from "vitest";
import { createEstimate, newLineItem } from "@/lib/estimate/factory";
import { buildProposal } from "@/lib/proposal/build";
import { renderProposalPdf } from "@/lib/pdf/render";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { getTrade } from "@/lib/trades/catalog";
import { LANDING_TRADES, landingFor } from "@/lib/trades/landing";

const OUT = path.resolve("public/media/proposals");
// Plausible example quantities and unit costs by unit (not pricing advice; example only).
const SAMPLE: Record<string, [string, string]> = {
  "square foot": ["420", "4.75"], "square yard": ["60", "38"], square: ["24", "95"], "linear foot": ["120", "6.5"],
  "cubic yard": ["9", "165"], each: ["12", "38"], hour: ["24", "65"], day: ["2", "325"], "lump sum": ["1", "450"],
  gallon: ["10", "42"], box: ["6", "48"], bundle: ["30", "36"], roll: ["4", "70"], sheet: ["40", "16"], bag: ["20", "14"], ton: ["8", "42"],
};

it("renders landing proposal samples", async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b2b-samples-"));
  for (const slug of LANDING_TRADES) {
    const trade = getTrade(slug)!;
    const e = createEstimate(slug, { now: new Date("2026-11-16T12:00:00Z"), number: "EST-1001" });
    e.title = landingFor(slug)!.sampleTitle;
    e.customer = { name: "Sample Homeowner", projectAddress: "123 Example St, Springfield" };
    e.defaultGroupVisibility = "names_only";
    e.items = trade.template.groups.flatMap((g, gi) => g.items.slice(0, 4).map((t, k) => {
      const [q, c] = SAMPLE[t.unit] ?? ["1", "250"];
      return newLineItem(e.groups[gi].id, k, { ...t, quantity: q, unitCost: c });
    }));
    const biz = { ...defaultBusinessProfile(), companyName: "Your Company Name", phone: "(555) 010-0000", email: "office@example.com" };
    const doc = buildProposal(e, biz, { ...defaultProposalConfig(), template: "modern" });
    const pdf = await renderProposalPdf(doc);
    const pdfPath = path.join(tmp, `${slug}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", pdfPath, path.join(tmp, slug)]);
    await sharp(path.join(tmp, `${slug}.png`)).resize({ width: 900 }).webp({ quality: 82 }).toFile(path.join(OUT, `${slug}-v1.webp`));
  }
});
