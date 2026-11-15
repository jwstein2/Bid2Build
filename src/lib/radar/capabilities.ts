import { plans } from "@/lib/site";

/**
 * What Built2Bid actually does today, checked against the product code (src/lib/trades, pricing
 * engine, proposal text, e-sign, billing). Drafts may only describe these. Anything in UNSUPPORTED
 * is flagged before the owner can approve a draft that claims it.
 */
export const CAPABILITIES = [
  { key: "trades", text: "trade templates with sections ready for roofing, siding, decks, concrete, kitchens, baths, drywall, painting, electrical, pressure and soft washing and more" },
  { key: "pricing", text: "labor and material line items with your own costs, priced with either markup or margin" },
  { key: "visibility", text: "you choose what the customer sees: itemized, grouped by section or a single total" },
  { key: "proposal", text: "a branded, professional PDF proposal with your logo" },
  { key: "scope", text: "help drafting the scope of work and exclusions from your line items, which you review and edit" },
  { key: "esign", text: "customers can review and e-sign the proposal online" },
  { key: "library", text: "a saved items library so you don't retype the same materials" },
  { key: "mobile", text: "works on a phone for starting a bid on site" },
  { key: "calculators", text: "free trade calculators on the site" },
  { key: "free", text: `${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} free bid every month, no credit card` },
] as const;

/** Claims Built2Bid must never make. Each pattern is matched against draft text (case-insensitive). */
export const UNSUPPORTED: { claim: string; re: RegExp }[] = [
  { claim: "Automated takeoff from plans, blueprints or CAD", re: /\b(take ?offs?|measure|read|import)\b.{0,40}\b(plans?|blueprints?|cad|drawings?|pdf plans?)\b|\bautomated takeoffs?\b/i },
  { claim: "QuickBooks or accounting integration", re: /\b(quick ?books|qbo|xero|accounting)\b.{0,30}\b(sync|integrat|connect|export)|\b(sync|integrat|connect|export)\w*\b.{0,30}\b(quick ?books|qbo|xero)\b/i },
  { claim: "Integration with other software", re: /\bintegrat(es|ion|ed) with\b/i },
  { claim: "Supplier or live material price feeds", re: /\b(live|real[- ]time|current|local)\b.{0,20}\b(material )?(prices|pricing|price feeds?)\b.{0,30}\b(pull|feed|automatic|supplier|update)/i },
  { claim: "Scheduling, CRM, invoicing or job costing", re: /\b(schedul(e|ing) (your )?(crews?|jobs?)|crm|invoic(e|es|ing)|job costing|payroll|time ?tracking|dispatch)\b/i },
  { claim: "MEP / commercial estimating", re: /\b(mep|commercial estimating|prevailing wage|bid bonds?)\b/i },
  { claim: "Invented statistics or performance promises", re: /\b\d{1,3}\s?%\s*(more|faster|higher|better|increase|of (contractors|users|customers))|\b(increase|boost|improve|save|cut)\w*\b.{0,25}\b\d{1,3}\s?%|\b\d+x (faster|more|the)\b|\b(double|triple|guarantee[sd]?)\b.{0,30}\b(win|close|revenue|sales|bids?)/i },
  { claim: "Testimonials or invented customers", re: /\b(our|my) (customers|users|clients) (say|love|tell)|\bthousands of contractors\b|\b\d[\d,]* contractors (use|trust)/i },
];

export function unsupportedClaims(text: string): string[] {
  return UNSUPPORTED.filter((u) => u.re.test(text)).map((u) => u.claim);
}
