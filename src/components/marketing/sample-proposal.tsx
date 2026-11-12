import { buildProposal } from "@/lib/proposal/build";
import { defaultProposalConfig, type BusinessProfile } from "@/lib/proposal/types";
import type { Estimate } from "@/lib/estimate/types";
import { ProposalView } from "@/components/proposal/proposal-view";
import { site } from "@/lib/site";

/**
 * The real customer-facing proposal renderer (same component as the builder preview and the
 * source of the PDF), fed with clearly labelled EXAMPLE data. Not a customer, not real pricing.
 */
const estimate: Estimate = {
  id: "sample", title: "Backyard deck replacement", trades: ["decks"], estimateNumber: "EST-SAMPLE", estimateDate: "2026-11-02", expirationDate: "2026-12-02",
  status: "draft", customer: { name: "Example Customer", projectAddress: "123 Sample Street" }, location: {}, pricing: { mode: "markup", percent: "25" },
  fixedAdjustment: "0", taxRate: "6", displayMode: "by_group", defaultGroupVisibility: "itemized",
  groups: [
    { id: "a", name: "Decking Material Package", visibility: "group_total", sortOrder: 0 },
    { id: "b", name: "Framing & Footings", visibility: "names_only", sortOrder: 1 },
    { id: "c", name: "Installation", visibility: "itemized", sortOrder: 2 },
  ],
  items: [
    { id: "1", groupId: "a", name: "Composite deck boards", costType: "material", treatment: "marked_up", quantity: "96", unit: "each", unitCost: "42", taxable: true, showOnProposal: true, sortOrder: 0 },
    { id: "2", groupId: "a", name: "Hidden fasteners", costType: "material", treatment: "marked_up", quantity: "12", unit: "box", unitCost: "38", taxable: true, showOnProposal: true, sortOrder: 1 },
    { id: "3", groupId: "b", name: "Pressure-treated framing", costType: "material", treatment: "marked_up", quantity: "1", unit: "lump sum", unitCost: "2350", taxable: true, showOnProposal: true, sortOrder: 0 },
    { id: "4", groupId: "b", name: "Concrete footings", costType: "material", treatment: "marked_up", quantity: "9", unit: "each", unitCost: "65", taxable: true, showOnProposal: true, sortOrder: 1 },
    { id: "5", groupId: "c", name: "Demolition and haul-away", costType: "labor", treatment: "marked_up", quantity: "1", unit: "lump sum", unitCost: "850", taxable: false, showOnProposal: true, sortOrder: 0 },
    { id: "6", groupId: "c", name: "Deck installation", costType: "labor", treatment: "marked_up", quantity: "64", unit: "hour", unitCost: "58", taxable: false, showOnProposal: true, sortOrder: 1 },
  ],
};

const business: BusinessProfile = {
  companyName: "Example Decks & Exteriors",
  phone: "(555) 010-0100",
  email: "office@example.com",
  primaryColor: "#0B2D4D",
  secondaryColor: "#14B8A6",
  logoLayout: "left",
  headerStyle: "solid",
};

export function SampleProposal({ className = "" }: { className?: string }) {
  const config = {
    ...defaultProposalConfig(),
    introduction: "",
    scopeOfWork: "Remove the old deck and build a new 16 x 20 ft composite deck on new footings and framing.",
    terms: "Example terms for illustration only.",
  };
  const doc = buildProposal(estimate, business, config);
  return (
    <figure className={className}>
      <div className="relative max-h-[600px] overflow-hidden rounded-xl bg-[#e4eaf1] p-3 shadow-raised ring-1 ring-line sm:p-4" aria-label="Sample proposal built with example data">
        <div className="pointer-events-none select-none [zoom:0.62] sm:[zoom:0.72]" inert>
          <ProposalView doc={doc} />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#e4eaf1] to-transparent" />
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">
        Sample proposal made with {site.name} using example data. Each section can show a total, item names, or full detail.
      </figcaption>
    </figure>
  );
}
