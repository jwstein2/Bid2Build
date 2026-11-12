export type ProposalTemplateId = "classic" | "modern" | "premium" | "detailed" | "compact";

export interface BusinessProfile {
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  logoUrl?: string | null;
  licenseNumber?: string;
  description?: string;
  tagline?: string;
  primaryColor: string;
  secondaryColor: string;
  logoLayout: "left" | "center" | "stacked";
  headerStyle: "solid" | "line" | "minimal";
}

export interface PaymentMilestone {
  label: string;
  /** percent of project total, as decimal string */
  percent: string;
}

export interface ProposalConfig {
  template: ProposalTemplateId;
  introduction: string;
  scopeOfWork: string;
  exclusions: string;
  allowances: string;
  customerResponsibilities: string;
  schedule: string;
  terms: string;
  paymentSchedule: PaymentMilestone[];
  showSignature: boolean;
  show: {
    phone: boolean;
    email: boolean;
    address: boolean;
    website: boolean;
    license: boolean;
    itemDescriptions: boolean;
    itemPrices: boolean;
    groupPrices: boolean;
    quantities: boolean;
    notes: boolean;
  };
}

export const defaultProposalConfig = (): ProposalConfig => ({
  template: "classic",
  introduction:
    "Thank you for the opportunity to bid on your project. This proposal outlines the work we will perform and the investment required.",
  scopeOfWork: "",
  exclusions: "",
  allowances: "",
  customerResponsibilities: "",
  schedule: "",
  terms:
    "This proposal is valid until the expiration date shown. Any changes to the scope of work may affect the price and will be documented in writing before work proceeds. [Placeholder terms: have these reviewed by your attorney.]",
  paymentSchedule: [
    { label: "Deposit due at signing", percent: "30" },
    { label: "Progress payment", percent: "40" },
    { label: "Due at completion", percent: "30" },
  ],
  showSignature: true,
  show: {
    phone: true,
    email: true,
    address: true,
    website: true,
    license: true,
    itemDescriptions: true,
    itemPrices: true,
    groupPrices: true,
    quantities: true,
    notes: false,
  },
});

export const defaultBusinessProfile = (): BusinessProfile => ({
  companyName: "",
  primaryColor: "#1f3a5f",
  secondaryColor: "#c8702a",
  logoLayout: "left",
  headerStyle: "solid",
});

/**
 * The customer-safe, render-ready proposal. Preview and PDF both render ONLY this.
 * It deliberately has no fields for internal cost, markup, margin, or profit.
 */
export interface ProposalLine {
  name: string;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  amount?: string;
  notes?: string;
}

export interface ProposalSection {
  title: string;
  description?: string;
  mode: "group_total" | "names_only" | "itemized";
  amount?: string;
  lines: ProposalLine[];
}

export interface ProposalDocument {
  template: ProposalTemplateId;
  brand: {
    companyName: string;
    tagline?: string;
    logoUrl?: string | null;
    primaryColor: string;
    secondaryColor: string;
    logoLayout: BusinessProfile["logoLayout"];
    headerStyle: BusinessProfile["headerStyle"];
    contact: { label: string; value: string }[];
  };
  customer: { name: string; email?: string; phone?: string; projectAddress?: string };
  meta: { title: string; number: string; date: string; expires: string; trades: string[] };
  introduction?: string;
  scopeOfWork?: string;
  pricing: {
    displayMode: "by_group" | "project_total";
    sections: ProposalSection[];
    projectLabel: string;
    adjustment?: { label: string; amount: string };
    subtotal: string;
    tax?: { label: string; amount: string };
    total: string;
  };
  exclusions?: string;
  allowances?: string;
  customerResponsibilities?: string;
  schedule?: string;
  paymentSchedule: { label: string; percent: string; amount: string }[];
  terms?: string;
  signature: boolean;
  footer: string;
}
