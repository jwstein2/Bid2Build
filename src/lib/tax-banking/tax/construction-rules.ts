/**
 * Built2Bid construction sales-tax rules (V6.9 built-in tax engine). One record per state + DC.
 *
 * What this answers: for a line on a contractor's bid (materials, labor, equipment, permit…), should sales tax be
 * charged to the customer on the contract, given the kind of work (new construction / capital improvement vs repair),
 * the contract type (lump sum vs time & materials / cost plus) and residential vs commercial?
 *
 * Rules are deliberately conservative:
 *   - "review" means the answer depends on facts Built2Bid can't see (contract wording, exemption certificates, local
 *     options, elections a contractor made with the state). The line is shown as taxable so a bid isn't under-priced,
 *     and the calculation is flagged for a person to confirm.
 *   - These records are a guide for estimating, not legal advice. A change to a rule is a code change that goes
 *     through review (rule changes never auto-apply; the nightly job only auto-applies verified numeric rates).
 *   - RULES_VERSION goes into every calculation snapshot so an old snapshot shows which rules it used.
 */
import type { ContractType, LineClass } from "./types";

export const RULES_VERSION = "2026-11-18.1";

export type Treat = "taxable" | "exempt" | "review";
export type WorkKind = "new_construction" | "repair";
export type WorkMix = "residential" | "commercial" | null | undefined;

type ByMix = Treat | { residential: Treat; commercial: Treat };

export interface StateRule {
  /** How the state taxes contractors (shown as context). */
  model: "contractor_consumer" | "gross_receipts" | "retail_construction" | "repair_taxable" | "mixed" | "no_sales_tax";
  /** Materials (and equipment / other pass-through costs) billed to the customer. */
  materials: { new_construction: { lump_sum: Treat; separated: Treat }; repair: { lump_sum: Treat; separated: Treat } };
  labor: { new_construction: ByMix; repair: ByMix };
  note: string;
}

const CONSUMER_NOTE = "Contractors are usually the consumer of materials here: you pay sales or use tax when you buy them and don't charge sales tax on the contract.";
const consumer = (note = CONSUMER_NOTE, separated: Treat = "exempt"): StateRule => ({
  model: "contractor_consumer",
  materials: { new_construction: { lump_sum: "exempt", separated }, repair: { lump_sum: "exempt", separated } },
  labor: { new_construction: "exempt", repair: "exempt" }, note,
});
const all = (t: Treat, model: StateRule["model"], note: string): StateRule => ({
  model, materials: { new_construction: { lump_sum: t, separated: t }, repair: { lump_sum: t, separated: t } }, labor: { new_construction: t, repair: t }, note,
});
/** Capital improvements are exempt (contractor pays tax on materials); repair / maintenance is taxable in full. */
const repairTaxable = (note: string): StateRule => ({
  model: "repair_taxable",
  materials: { new_construction: { lump_sum: "exempt", separated: "exempt" }, repair: { lump_sum: "taxable", separated: "taxable" } },
  labor: { new_construction: "exempt", repair: "taxable" }, note,
});
const reviewRepair = (note: string): StateRule => ({
  model: "mixed",
  materials: { new_construction: { lump_sum: "exempt", separated: "exempt" }, repair: { lump_sum: "review", separated: "review" } },
  labor: { new_construction: "exempt", repair: "review" }, note,
});

export const CONSTRUCTION_RULES: Record<string, StateRule> = {
  AL: consumer(), AR: consumer(), GA: consumer(), ID: consumer(), IL: consumer(), IN: consumer(), KY: consumer(),
  LA: consumer(), ME: consumer(), MD: consumer(), MA: consumer(), MI: consumer(), MN: consumer(), MO: consumer(),
  NV: consumer(), ND: consumer(), OK: consumer(), RI: consumer(), SC: consumer(), TN: consumer(), UT: consumer(),
  VT: consumer(), VA: consumer(), WI: consumer(), WY: consumer(),
  FL: consumer(`${CONSUMER_NOTE} Some services to nonresidential buildings (cleaning, pest control) are taxable.`),
  OH: consumer(`${CONSUMER_NOTE} Landscaping, building maintenance and janitorial services are taxable.`),
  PA: consumer(`${CONSUMER_NOTE} Building maintenance and cleaning services are taxable. Philadelphia and Allegheny County add local tax.`),
  CO: consumer(`${CONSUMER_NOTE} Home-rule cities may require a building-materials use tax paid with the permit.`),
  CA: consumer(`${CONSUMER_NOTE} Contractors are retailers of fixtures (sinks, lights, cabinets), so separately billed fixtures may be taxable.`, "review"),
  NE: consumer(`${CONSUMER_NOTE} Nebraska contractors elect Option 1, 2 or 3 with the state; an Option 1 contractor charges tax on materials.`, "review"),
  DE: all("exempt", "no_sales_tax", "Delaware has no sales tax. Contractors pay a gross receipts tax themselves."),
  MT: all("exempt", "no_sales_tax", "Montana has no general sales tax. Resort areas may levy local taxes on some sales."),
  NH: all("exempt", "no_sales_tax", "New Hampshire has no general sales tax."),
  OR: all("exempt", "no_sales_tax", "Oregon has no sales tax."),
  AK: all("review", "mixed", "Alaska has no state sales tax, but many boroughs and cities tax sales and some tax labor and services. Check the local rules."),
  AZ: all("review", "mixed", "Arizona taxes contracting under the transaction privilege tax (prime contracting or MRRA). How it applies depends on the job. Review each contract."),
  HI: all("taxable", "gross_receipts", "Hawaii's general excise tax applies to contracting income, including labor. Contractors commonly pass it on as a visible charge."),
  NM: all("taxable", "gross_receipts", "New Mexico's gross receipts tax applies to construction services, including labor. Contractors commonly pass it on."),
  WA: all("taxable", "retail_construction", "Washington treats construction for a consumer as a retail sale: sales tax applies to the full contract price, including labor."),
  SD: all("review", "mixed", "South Dakota charges a contractor's excise tax on realty improvement contracts, and sales tax on some repair services. Review each contract."),
  MS: all("review", "mixed", "Mississippi has a contractor's tax on larger commercial contracts and treats residential work differently. Review each contract."),
  NY: repairTaxable("New York: capital improvements aren't taxed when you get a Certificate of Capital Improvement (ST-124). Repair and maintenance work is taxable, labor included."),
  NJ: repairTaxable("New Jersey: capital improvements aren't taxed when you get a Certificate of Capital Improvement (ST-8). Repair and maintenance work is taxable, labor included."),
  NC: repairTaxable("North Carolina taxes repair, maintenance and installation services to real property. Capital improvements aren't taxed; keep records showing the job is one."),
  DC: reviewRepair("DC: new construction materials are taxed when the contractor buys them. Some real property maintenance services are taxable."),
  CT: reviewRepair("Connecticut taxes some services to real property, including renovation and remodeling and services to commercial property. New construction labor isn't taxed."),
  IA: reviewRepair("Iowa doesn't tax new construction labor, but many repair and building services are taxable."),
  KS: reviewRepair("Kansas doesn't tax labor on original construction. Repair and remodeling labor can be taxable."),
  WV: reviewRepair("West Virginia: capital improvements aren't taxed, but repair and maintenance services generally are."),
  TX: {
    model: "mixed",
    materials: { new_construction: { lump_sum: "exempt", separated: "review" }, repair: { lump_sum: "review", separated: "review" } },
    labor: { new_construction: "exempt", repair: { residential: "exempt", commercial: "taxable" } },
    note: "Texas: new residential construction and residential repair labor aren't taxed. Nonresidential repair and remodeling is taxable in full. A separated contract makes you the retailer of the materials.",
  },
};

const NOT_TAXED_CLASSES: readonly LineClass[] = ["permit_fee"];

export interface LineTreatment { taxable: boolean; needsReview?: boolean; note?: string }

/** How one bid line is treated in a state. Unknown state → review (never a guess). */
export function constructionTreatment(state: string, cls: LineClass, opts: { work?: WorkKind | null; contract?: ContractType | null; workMix?: WorkMix } = {}): LineTreatment {
  const rule = CONSTRUCTION_RULES[(state ?? "").toUpperCase()];
  if (!rule) return { taxable: true, needsReview: true, note: "No construction rule on file for this state." };
  if (NOT_TAXED_CLASSES.includes(cls)) return { taxable: false, note: "Permit fees passed through at cost aren't taxed." };
  const work: WorkKind = cls === "labor_repair" ? "repair" : cls === "labor_new_construction" ? "new_construction" : opts.work ?? "repair";
  const separated = opts.contract === "time_and_materials" || opts.contract === "cost_plus" || opts.contract === "mixed";
  const isLabor = cls === "labor_new_construction" || cls === "labor_repair" || cls === "installation" || cls === "service";
  let t: Treat;
  if (isLabor) {
    const b = rule.labor[work];
    t = typeof b === "string" ? b : opts.workMix === "residential" ? b.residential : opts.workMix === "commercial" ? b.commercial : b.residential === b.commercial ? b.residential : "review";
  } else {
    t = rule.materials[work][separated ? "separated" : "lump_sum"];
  }
  // Texas nonresidential repair: materials follow the (taxable) labor.
  if (state.toUpperCase() === "TX" && !isLabor && work === "repair") t = opts.workMix === "commercial" ? "taxable" : opts.workMix === "residential" ? "exempt" : "review";
  return t === "review" ? { taxable: true, needsReview: true } : { taxable: t === "taxable" };
}

export const ruleNote = (state: string) => CONSTRUCTION_RULES[(state ?? "").toUpperCase()]?.note ?? null;
