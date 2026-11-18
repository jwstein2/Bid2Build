/**
 * Online exemption certificate (V6.9). Customers fill this in on a secret link from their contractor: no uploads,
 * no account. The fields follow the Streamlined Sales Tax uniform exemption certificate (purchaser, business type,
 * reason A–M, identification number, signature). Built2Bid records it; it can't confirm a permit number with a state.
 */
import { z } from "zod";
import { STATE_CODES } from "../authorities";

export const EXEMPT_REASONS = {
  A: "Federal government", B: "State or local government", C: "Tribal government", D: "Foreign diplomat", E: "Charitable organization",
  F: "Religious organization", G: "Resale", H: "Agricultural production", I: "Industrial production / manufacturing", J: "Direct pay permit",
  K: "Direct mail", L: "Other", M: "Educational organization",
} as const;
export type ExemptReason = keyof typeof EXEMPT_REASONS;

export const ID_TYPES = { state_permit: "State sales tax or exemption permit number", fein: "Federal employer ID (FEIN)", drivers_license: "Driver's license number (sole proprietor)", foreign_diplomat: "Foreign diplomat number", other: "Other ID" } as const;

export const BUSINESS_TYPES = ["Construction", "Government", "Nonprofit / charity", "Religious", "Education", "Agriculture", "Manufacturing", "Retail / wholesale", "Other"] as const;

export const CERT_VERSION = "uniform_v1";

export function exemptionStatement(company: string, purchaser: string) {
  return `I, on behalf of ${purchaser}, certify that the purchases from ${company} described as exempt are exempt from sales and use tax for the reason and in the states selected, and that the information on this certificate is true and correct. I understand that if the purchases are not exempt, the purchaser may owe the tax, interest and penalties. I will tell ${company} if this exemption changes. I agree to sign this certificate electronically.`;
}

const state = z.string().length(2).toUpperCase().refine((s) => STATE_CODES.includes(s), "Choose a state.");
const t = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max, msg);

export const exemptionSchema = z.object({
  states: z.array(state).min(1, "Choose at least one state.").max(51),
  reasonCode: z.enum(Object.keys(EXEMPT_REASONS) as [ExemptReason, ...ExemptReason[]], { message: "Choose a reason." }),
  reasonOther: z.string().trim().max(200).optional(),
  purchaser: z.object({
    name: t(2, 120, "Enter the purchaser's name."), business: z.string().trim().max(200).optional(),
    line1: t(3, 200, "Enter the street address."), city: t(2, 100, "Enter the city."), state, zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code."),
    businessType: z.enum(BUSINESS_TYPES, { message: "Choose the type of business." }),
  }),
  idType: z.enum(Object.keys(ID_TYPES) as [keyof typeof ID_TYPES, ...(keyof typeof ID_TYPES)[]], { message: "Choose the kind of ID number." }),
  idNumber: z.string().trim().regex(/^[A-Za-z0-9 .\-/]{2,40}$/, "Enter the ID number (letters, numbers and dashes)."),
  idState: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional().or(z.literal("")),
  signerName: t(2, 120, "Type your full name to sign."),
  signerTitle: z.string().trim().max(120).optional(),
  agree: z.literal(true, { message: "Confirm the statement to sign." }),
}).superRefine((v, ctx) => {
  if (v.reasonCode === "L" && !v.reasonOther) ctx.addIssue({ code: "custom", path: ["reasonOther"], message: "Describe the reason." });
});
export type ExemptionInput = z.infer<typeof exemptionSchema>;
