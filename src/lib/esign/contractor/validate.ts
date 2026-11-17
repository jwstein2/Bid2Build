import { z } from "zod";

const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

/** Raw uploads are re-encoded on the server; this only bounds what we accept. */
export const MAX_UPLOAD_DATA_URL = 3_000_000;

export const policySchema = z.object({
  required: z.boolean(),
  mode: z.enum(["company_signer", "sales_rep", "manual"]),
  defaultSignerId: uuid.nullable(),
  autoApplyAllowed: z.boolean(),
  autoApplyTiming: z.enum(["before_send", "after_customer"]),
  repSignaturesAllowed: z.boolean(),
});
export type PolicyInput = z.infer<typeof policySchema>;

export const credentialSchema = z.object({
  legalName: z.string().transform(clean).pipe(z.string().min(2, "Enter your full legal name.").max(200)),
  title: z.string().transform(clean).pipe(z.string().max(120)).optional().default(""),
  method: z.enum(["drawn", "typed", "uploaded"]),
  signatureText: z.string().transform(clean).pipe(z.string().max(200)).optional(),
  signatureImage: z.string().max(MAX_UPLOAD_DATA_URL).optional(),
  // Must be literally true: never pre-checked.
  adopt: z.literal(true, { message: "Confirm that this is your signature to continue." }),
  autoApply: z.boolean().default(false),
  adoptionVersion: z.string().max(60),
}).superRefine((v, ctx) => {
  if (v.method === "typed") {
    if (!v.signatureText || v.signatureText.length < 2) ctx.addIssue({ code: "custom", path: ["signatureText"], message: "Type your name to create a typed signature." });
    else if (v.signatureText.toLowerCase() !== v.legalName.toLowerCase()) ctx.addIssue({ code: "custom", path: ["signatureText"], message: "A typed signature must match your full legal name." });
  } else if (!v.signatureImage || !/^data:image\/(png|jpeg|webp);base64,/.test(v.signatureImage)) {
    ctx.addIssue({ code: "custom", path: ["signatureImage"], message: v.method === "drawn" ? "Draw your signature in the box." : "Choose a PNG or JPG image of your signature." });
  }
});
export type CredentialInput = z.infer<typeof credentialSchema>;

export const authorizationSchema = z.object({
  userId: uuid,
  scope: z.enum(["own_bids", "company_bids"]),
  autoApplyAllowed: z.boolean(),
  title: z.string().transform(clean).pipe(z.string().max(120)).optional().default(""),
});

export const countersignSchema = z.object({
  versionId: uuid,
  // The signer affirms the statement shown; must be literally true.
  confirm: z.literal(true, { message: "Confirm the statement to sign." }),
});
