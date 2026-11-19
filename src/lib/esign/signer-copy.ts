import "server-only";
import { fromHeader, sendCommEmail } from "@/lib/comms/send";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import type { ProposalDocument } from "@/lib/proposal/types";

/**
 * Email the signer their copy right after they sign (a link back to their private page, where the signed
 * PDF downloads). Transactional: one email per signature, no tracking, no marketing. OFF unless
 * ESIGN_SIGNER_COPY_EMAIL=on and RESEND_API_KEY is set. Never throws and never affects the signature.
 */
export function signerCopyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ["on", "true", "1"].includes((env.ESIGN_SIGNER_COPY_EMAIL ?? "").trim().toLowerCase()) && Boolean(env.RESEND_API_KEY);
}

export function signerCopyText(p: { signerName: string; companyName: string; title: string; number: string; total: string; link: string; contact: string }): string {
  return [
    `Hi ${p.signerName},`,
    "",
    `You signed the proposal "${p.title}" (#${p.number}) from ${p.companyName} for ${p.total}.`,
    "",
    `Keep this email. Your signed copy is here, and you can download it any time:`,
    p.link,
    "",
    `The link is private to you. Questions about the proposal or the work go to ${p.companyName}${p.contact ? ` (${p.contact})` : ""}.`,
    "",
    `${site.name} provided the signing service for ${p.companyName} and is not a party to the proposal. If you didn't sign this, reply to this email or contact ${p.companyName} right away.`,
  ].join("\n");
}

export async function sendSignerCopy(p: { to: string; signerName: string; token: string; doc: ProposalDocument; signatureId: string }, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!signerCopyEnabled(env)) return false;
  try {
    const company = p.doc.brand.companyName.trim() || "Your contractor";
    const contactEmail = p.doc.brand.contact.find((c) => /@/.test(c.value ?? ""))?.value ?? null;
    const contact = p.doc.brand.contact.map((c) => c.value).filter(Boolean).join(" · ");
    const r = await sendCommEmail(env.RESEND_API_KEY ?? "", {
      idempotencyKey: `esign-copy-${p.signatureId}`,
      from: fromHeader(company, env.ESIGN_SIGNER_COPY_FROM || "updates@built2bid.org"),
      to: p.to,
      replyTo: contactEmail,
      subject: `Your signed proposal from ${company}`,
      text: signerCopyText({ signerName: p.signerName, companyName: company, title: p.doc.meta.title, number: p.doc.meta.number, total: p.doc.pricing.total, link: `${site.url}/sign/${p.token}`, contact }),
      messageId: `<esign-copy-${p.signatureId}@built2bid.org>`,
      tags: [{ name: "kind", value: "esign_copy" }],
    }, fetchImpl);
    if (!r.ok) logError("esign.copy_email", r.error, { signature: p.signatureId });
    return r.ok;
  } catch (e) {
    logError("esign.copy_email", e, { signature: p.signatureId });
    return false;
  }
}
