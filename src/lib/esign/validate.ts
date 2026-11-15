import { z } from "zod";

const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const EMAIL = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/;

/** Max size of a drawn signature image (PNG data URL). */
export const MAX_SIGNATURE_DATA_URL = 400_000;

export const acceptSchema = z.object({
  signerName: z.string().transform(clean).pipe(z.string().min(2, "Enter your full legal name.").max(200)),
  signerEmail: z.string().transform(clean).pipe(z.string().max(320).regex(EMAIL, "Enter a valid email address.")),
  method: z.enum(["typed", "drawn"]),
  signatureText: z.string().transform(clean).pipe(z.string().max(200)).optional(),
  signatureImage: z.string().max(MAX_SIGNATURE_DATA_URL).optional(),
  // Must be literally true: the boxes are never pre-checked, and a missing value is a refusal.
  consent: z.literal(true, { message: "Agree to use electronic records and signatures to continue." }),
  accept: z.literal(true, { message: "Confirm that you accept this proposal to continue." }),
  consentVersion: z.string().max(40),
  consentedAt: z.string().datetime().optional(),
}).superRefine((v, ctx) => {
  if (v.method === "typed") {
    if (!v.signatureText || v.signatureText.length < 2) ctx.addIssue({ code: "custom", path: ["signatureText"], message: "Type your name to sign." });
    else if (v.signatureText.toLowerCase() !== v.signerName.toLowerCase()) ctx.addIssue({ code: "custom", path: ["signatureText"], message: "Your typed signature must match your full legal name." });
  } else if (!v.signatureImage || !isPngDataUrl(v.signatureImage)) {
    ctx.addIssue({ code: "custom", path: ["signatureImage"], message: "Draw your signature in the box." });
  }
});
export type AcceptInput = z.infer<typeof acceptSchema>;

/** A real, non-trivial PNG (magic bytes, IHDR, sane size), not just any string claiming to be one. */
export function isPngDataUrl(s: string): boolean {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return false;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 200 || buf.length > 280_000) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) return false;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return false;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return w >= 50 && h >= 20 && w <= 2000 && h <= 1000;
}
