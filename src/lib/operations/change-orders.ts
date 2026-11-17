import { z } from "zod";
import { consentText } from "@/lib/esign/config";
import { formatCurrency } from "@/lib/estimate/money";

export const changeOrderSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  lines: z.array(z.object({
    kind: z.enum(["add", "remove", "modify"]),
    description: z.string().trim().min(1).max(1000),
    amount: z.union([z.number(), z.string().trim().regex(/^-?\d{1,9}(\.\d{1,2})?$/)]).transform((v) => Number(v)),
  })).max(100),
  scheduleDays: z.number().int().min(-365).max(365).nullable().optional(),
  customerNotes: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
  sourceQuoteRevisionId: z.string().uuid().optional(),
});
export type ChangeOrderInput = z.infer<typeof changeOrderSchema>;

export const CHANGE_ORDER_LINK_DAYS = 30;

/** The e-sign consent, worded for a change order. */
export const changeOrderConsentText = (company: string) =>
  consentText(company).replace(/this proposal/g, "this change order").replace(/signed proposal/g, "signed change order");

export function changeOrderAcceptanceText(p: { companyName: string; number: number; projectTitle: string; amount: number | string; version: number }): string {
  const amt = Number(p.amount);
  const money = formatCurrency(Math.abs(amt).toFixed(2));
  const effect = amt === 0 ? "with no change to the contract price" : amt > 0 ? `adding ${money} to the contract price` : `reducing the contract price by ${money}`;
  return `I have reviewed change order #${p.number} (version ${p.version})${p.projectTitle ? ` for "${p.projectTitle}"` : ""} from ${p.companyName.trim() || "the contractor"}, including the scope changes listed, and I approve it, ${effect}.`;
}
