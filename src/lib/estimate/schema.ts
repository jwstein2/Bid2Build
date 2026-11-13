import { z } from "zod";

/** Server-side validation for anything the browser sends. Mirrors the DB constraints. */
const dec = (max = 20) => z.string().max(max).regex(/^-?\d*(\.\d*)?$/, "must be a number").or(z.literal(""));
const rule = z.object({ mode: z.enum(["markup", "margin"]), percent: dec(12) }).nullable().optional();
const uuid = z.string().uuid();

export const lineItemSchema = z.object({
  id: uuid,
  groupId: uuid,
  name: z.string().max(300),
  description: z.string().max(4000).optional(),
  category: z.string().max(100).optional(),
  costType: z.enum(["material", "labor", "equipment", "subcontractor", "overhead", "contingency", "permit", "delivery", "labor_burden", "other"]),
  treatment: z.enum(["marked_up", "pass_through"]),
  quantity: dec(),
  unit: z.string().min(1).max(40),
  unitCost: dec(),
  taxable: z.boolean(),
  pricingOverride: rule,
  showOnProposal: z.boolean(),
  notes: z.string().max(4000).optional(),
  sortOrder: z.number().int(),
  isExample: z.boolean().optional(),
});

export const groupSchema = z.object({
  id: uuid,
  name: z.string().max(200),
  description: z.string().max(4000).optional(),
  visibility: z.enum(["group_total", "names_only", "itemized"]).nullable(),
  sortOrder: z.number().int(),
  pricingOverride: rule,
  trade: z.string().max(60).nullable().optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const calcId = z.enum(["area", "roof", "linear", "perimeter", "volume", "stairs", "coverage", "boards", "convert", "labor"]);
const shortStr = z.string().max(40);
/** Saved calculator inputs: strings exactly as typed, bounded so a payload can't balloon. */
export const calcRecordSchema = z.object({
  v: z.literal(1),
  calc: calcId,
  output: shortStr,
  input: z.object({
    sections: z.array(z.object({
      id: shortStr,
      shape: shortStr,
      deduct: z.boolean().optional(),
      label: z.string().max(80).optional(),
      values: z.record(shortStr, shortStr),
    })).max(60),
    options: z.record(shortStr, shortStr),
  }),
  result: dec(),
  unit: z.string().min(1).max(40),
  appliedAt: z.string().max(40),
  previous: z.object({ quantity: dec(), unit: z.string().min(1).max(40) }).optional(),
});
export const worksheetSchema = z.object({
  calcs: z.record(uuid, calcRecordSchema).optional(),
  minimumCharge: dec().optional(),
  sectionTrades: z.record(uuid, z.string().max(60)).optional(),
}).nullable().optional();

export const estimateSchema = z.object({
  id: uuid,
  title: z.string().max(300),
  trades: z.array(z.string().max(60)).max(20),
  estimateNumber: z.string().max(50),
  estimateDate: isoDate,
  expirationDate: isoDate.or(z.literal("")),
  status: z.enum(["draft", "finalized", "archived"]),
  customer: z.object({
    name: z.string().max(200),
    email: z.string().max(320).optional(),
    phone: z.string().max(50).optional(),
    projectAddress: z.string().max(500).optional(),
    notes: z.string().max(4000).optional(),
  }),
  location: z.object({ zip: z.string().max(10).optional(), city: z.string().max(100).optional(), state: z.string().max(50).optional() }),
  pricing: z.object({ mode: z.enum(["markup", "margin"]), percent: dec(12) }),
  fixedAdjustment: dec(),
  adjustmentLabel: z.string().max(100).optional(),
  taxRate: dec(10),
  displayMode: z.enum(["by_group", "project_total"]),
  defaultGroupVisibility: z.enum(["group_total", "names_only", "itemized"]),
  groups: z.array(groupSchema).max(200),
  items: z.array(lineItemSchema).max(2000),
  templateRef: z.object({ trade: z.string(), version: z.number().int() }).nullable().optional(),
  customerId: uuid.nullable().optional(),
  projectProfile: z.object({
    sector: z.enum(["residential", "commercial"]).optional(),
    workType: z.enum(["new_construction", "remodel", "addition", "replacement", "repair"]).optional(),
    projectType: z.string().max(60).optional(),
    measurements: z.record(z.string().max(40), z.union([z.number(), z.string().max(40), z.boolean()])).optional(),
    outcome: z.enum(["quoted", "accepted", "declined", "completed"]).optional(),
  }).nullable().optional(),
  worksheet: worksheetSchema,
}).superRefine((e, ctx) => {
  const groupIds = new Set(e.groups.map((g) => g.id));
  const calcs = e.worksheet?.calcs ?? {};
  if (Object.keys(calcs).length > 2000) ctx.addIssue({ code: "custom", path: ["worksheet", "calcs"], message: "too many saved calculations" });
  e.items.forEach((it, i) => {
    if (!groupIds.has(it.groupId)) ctx.addIssue({ code: "custom", path: ["items", i, "groupId"], message: "unknown group" });
    if (it.quantity.startsWith("-")) ctx.addIssue({ code: "custom", path: ["items", i, "quantity"], message: "negative quantity" });
    if (it.unitCost.startsWith("-")) ctx.addIssue({ code: "custom", path: ["items", i, "unitCost"], message: "negative cost" });
  });
  const pct = Number(e.pricing.percent || 0);
  if (e.pricing.mode === "margin" && pct >= 100) ctx.addIssue({ code: "custom", path: ["pricing"], message: "margin must be below 100%" });
  if (e.pricing.mode === "markup" && pct < -100) ctx.addIssue({ code: "custom", path: ["pricing"], message: "markup must be at least -100%" });
  const tax = Number(e.taxRate || 0);
  if (tax < 0 || tax > 100) ctx.addIssue({ code: "custom", path: ["taxRate"], message: "tax rate must be 0-100" });
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const businessSchema = z.object({
  companyName: z.string().max(200),
  contactName: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  logoUrl: z.string().max(2000).nullable().optional(),
  logoPath: z.string().max(500).nullable().optional(),
  licenseNumber: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  tagline: z.string().max(200).optional(),
  primaryColor: hex,
  secondaryColor: hex,
  logoLayout: z.enum(["left", "center", "stacked"]),
  headerStyle: z.enum(["solid", "line", "minimal"]),
});

const writingStyle = z.enum(["simple", "professional", "detailed"]);
const textSource = z.enum(["manual", "generated", "edited"]);
const ts = z.string().max(40).nullable();
const exclusionItem = z.object({
  id: z.string().max(64),
  category: z.string().max(40),
  title: z.string().max(120),
  text: z.string().max(1000),
  status: z.enum(["approved", "suggested", "rejected"]),
  source: textSource,
  review: z.string().max(300).nullable().optional(),
});
export const scopeSettingsSchema = z.object({
  visible: z.boolean(),
  source: textSource,
  style: writingStyle,
  generatedAt: ts,
  generator: z.string().max(120).nullable(),
  basedOn: z.string().max(64).nullable(),
  updatedAt: ts,
  history: z.array(z.object({ at: z.string().max(40), content: z.string().max(20000), source: textSource })).max(10),
});
export const exclusionSettingsSchema = z.object({
  visible: z.boolean(),
  style: writingStyle,
  generatedAt: ts,
  generator: z.string().max(120).nullable(),
  basedOn: z.string().max(64).nullable(),
  updatedAt: ts,
  items: z.array(exclusionItem).max(40),
  history: z.array(z.object({ at: z.string().max(40), items: z.array(exclusionItem).max(40) })).max(10),
});

export const proposalConfigSchema = z.object({
  template: z.enum(["classic", "modern", "premium", "detailed", "compact"]),
  introduction: z.string().max(5000),
  scopeOfWork: z.string().max(20000),
  exclusions: z.string().max(10000),
  scope: scopeSettingsSchema.optional(),
  exclusionList: exclusionSettingsSchema.optional(),
  /** Persisted copy of Estimate.worksheet (written by the save route, read back by the loader). */
  worksheet: worksheetSchema,
  allowances: z.string().max(10000),
  customerResponsibilities: z.string().max(10000),
  schedule: z.string().max(5000),
  terms: z.string().max(20000),
  paymentSchedule: z.array(z.object({ label: z.string().max(200), percent: dec(8) })).max(12),
  showSignature: z.boolean(),
  show: z.object({
    phone: z.boolean(), email: z.boolean(), address: z.boolean(), website: z.boolean(), license: z.boolean(),
    itemDescriptions: z.boolean(), itemPrices: z.boolean(), groupPrices: z.boolean(), quantities: z.boolean(), notes: z.boolean(),
  }),
});
