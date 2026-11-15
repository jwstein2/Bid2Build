// Builds realistic customer-facing proposal documents for the e-signature browser walk.
// Usage: npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
import { buildProposal } from "../../src/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "../../src/lib/proposal/types";
import type { Estimate } from "../../src/lib/estimate/types";

const biz = { ...defaultBusinessProfile(), companyName: "Summit Exteriors LLC", contactName: "Alex Rivera", phone: "(555) 010-2030", email: "office@summit.test", address: "120 Main St, Springfield" };
const base = (o: Partial<Estimate>): Estimate => ({
  id: "x", title: "", trades: ["decks"], estimateNumber: "B-1003", estimateDate: "2026-11-12", expirationDate: "2026-12-12", status: "finalized",
  customer: { name: "John Smith", email: "john@example.test", projectAddress: "48 Oak Lane, Springfield" }, location: {},
  pricing: { mode: "markup", percent: "25" }, fixedAdjustment: "0", taxRate: "0", displayMode: "by_group", defaultGroupVisibility: "itemized",
  groups: [{ id: "g1", name: "Demolition & disposal", visibility: null, sortOrder: 0 }, { id: "g2", name: "Composite decking package", visibility: null, sortOrder: 1 }, { id: "g3", name: "Railings & stairs", visibility: null, sortOrder: 2 }],
  items: [
    { id: "i1", groupId: "g1", name: "Remove existing deck", costType: "labor", treatment: "marked_up", quantity: "1", unit: "each", unitCost: "1800", taxable: false, sortOrder: 0 },
    { id: "i2", groupId: "g2", name: "Composite deck boards", costType: "material", treatment: "marked_up", quantity: "420", unit: "square foot", unitCost: "18", taxable: true, sortOrder: 0 },
    { id: "i3", groupId: "g2", name: "Framing and install labor", costType: "labor", treatment: "marked_up", quantity: "420", unit: "square foot", unitCost: "9", taxable: false, sortOrder: 1 },
    { id: "i4", groupId: "g3", name: "Aluminum railing", costType: "material", treatment: "marked_up", quantity: "48", unit: "linear foot", unitCost: "26", taxable: true, sortOrder: 0 },
  ],
  ...o,
} as Estimate);
const cfg = { ...defaultProposalConfig(), terms: "Work begins within 3 weeks of acceptance. Changes to scope require a written change order.", exclusions: "Permit fees, electrical work, and landscaping repair.", paymentSchedule: [{ label: "Deposit at signing", percent: "30" }, { label: "On completion", percent: "70" }] };
const signedDoc = buildProposal(base({ title: "Backyard Deck Replacement" }), biz, cfg as never);
const pendingDoc = buildProposal(base({ title: "Siding replacement – Johnson residence", estimateNumber: "B-1004", customer: { name: "Pat Johnson", email: "pat@example.test", projectAddress: "48 Oak Lane" } }), biz, cfg as never);
// Exclusions come from the exclusion list editor in the app; set the rendered text directly here.
for (const d of [signedDoc, pendingDoc]) d.exclusions = "Permit fees, electrical work, and landscaping repair.";
process.stdout.write(JSON.stringify({ signedDoc, pendingDoc }));
