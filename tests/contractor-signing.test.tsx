/**
 * V5.3 contractor signatures: status derivation, statements, identity freshness, signature image
 * normalization, and the real PDFs (customer copy, contractor-first, executed agreement, unsigned block).
 */
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { renderToBuffer } from "@react-pdf/renderer";
import { executionState, applicationLabel, signingOrder, EXECUTION_LABELS } from "@/lib/esign/contractor/status";
import { adoptionText, autoApplyText, countersignText, isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { credentialSchema, policySchema } from "@/lib/esign/contractor/validate";
import { normalizeSignatureImage } from "@/lib/esign/contractor/image";
import { recentAuth } from "@/lib/esign/contractor/server";
import { renderSignedPdf, type ContractorCertificate, type SignatureCertificate } from "@/lib/pdf/signed-pdf";
import { ProposalPdf } from "@/lib/pdf/proposal-pdf";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

async function png(w = 400, h = 120) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/><path d="M20 80 C 80 10, 140 110, 200 40 S 320 90, 380 30" stroke="#0e2238" stroke-width="5" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function pdfText(pdf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const perPage: string[] = [];
  for (let p = 1; p <= d.numPages; p++) perPage.push((await (await d.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" "));
  return { text: perPage.join("\n"), pages: d.numPages, perPage };
}
const doc = () => buildProposal(est({ title: "Backyard Deck Replacement", customer: { name: "John Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] }), { ...defaultBusinessProfile(), companyName: "Acme Decks" }, defaultProposalConfig());
const sig = () => ({ ...doc(), signature: true });
// pdf.js splits letter-spaced text and react-pdf hyphenates long words at line ends.
const squash = (t: string) => t.replace(/\s+/g, "").replace(/([a-z])-([a-z])/g, "$1$2");
const customer = (image: Buffer): SignatureCertificate => ({
  signatureId: "11111111-1111-1111-1111-111111111111", requestId: "22222222-2222-2222-2222-222222222222", signerName: "John Smith", signerEmail: "john@example.com",
  method: "drawn", signatureImage: image, signedAt: "2026-11-17T15:00:00Z", consentedAt: "2026-11-17T14:59:30Z", consentVersion: "v1",
  consentText: "I consent.", acceptanceText: "I accept.", verification: "link_possession", documentHash: "a".repeat(64), contentHash: "b".repeat(64),
  versionNumber: 2, total: "$1,000.00", ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0", linkCreatedAt: "2026-11-17T14:00:00Z",
});
const contractor = (over: Partial<ContractorCertificate> = {}): ContractorCertificate => ({
  id: "33333333-3333-3333-3333-333333333333", signerName: "Dana Owner", signerTitle: "President", companyName: "Acme Decks", authority: "company_owner",
  application: "interactive", applicationLabel: "Countersigned by the signer in person after review", method: "typed", signatureText: "Dana Owner",
  appliedAt: "2026-11-18T09:30:00Z", credentialVersion: 3, policyRevision: 2, statementText: "I sign this on behalf of Acme Decks.", ipAddress: "198.51.100.9",
  userAgent: "Mozilla/5.0", corrective: false, ...over,
});

describe("execution status", () => {
  const sig = { request_id: "r1", version_id: "v1" };
  it("is fully executed only with a recorded contractor signature on the same version", () => {
    expect(executionState(sig, { required: true }, { version_id: "v1" })).toBe("fully_executed");
    expect(executionState(sig, { required: true }, { version_id: "v2" })).toBe("awaiting_contractor");
    expect(executionState(sig, { required: true }, null)).toBe("awaiting_contractor");
    expect(executionState(sig, { required: false }, null)).toBe("not_required");
    expect(executionState(sig, null, null)).toBe("historical");
    expect(EXECUTION_LABELS.awaiting_contractor).toBe("Awaiting Contractor Signature");
  });
  it("describes automatic application honestly and orders events by real time", () => {
    expect(applicationLabel({ application: "auto_policy", trigger: "signing_link_created", corrective: false })).toMatch(/prior authorization/);
    expect(applicationLabel({ application: "interactive", trigger: "countersign_action", corrective: true })).toMatch(/corrective/);
    expect(signingOrder("2026-11-17T15:00:00Z", "2026-11-17T10:00:00Z")).toEqual(["contractor", "customer"]);
    expect(signingOrder("2026-11-17T15:00:00Z", null)).toEqual(["customer"]);
  });
});

describe("statements, flags and validation", () => {
  it("statements name the person and company and say automatic use is not a personal signing", () => {
    expect(adoptionText({ legalName: "Dana Owner", companyName: "Acme" })).toContain("I, Dana Owner, adopt");
    expect(autoApplyText({ legalName: "Dana Owner", companyName: "Acme" })).toMatch(/not as a signature I personally made/);
    expect(countersignText({ signerName: "Dana", companyName: "Acme", proposalNumber: "1042", projectTitle: "Deck", total: "$1,000.00", versionNumber: 2, customerSigned: true })).toContain("version 2 for a total of $1,000.00, as accepted by the customer");
  });
  it("needs both flags", () => {
    expect(isContractorSigningEnabled({ NEXT_PUBLIC_CONTRACTOR_SIGNING: "on", NEXT_PUBLIC_ESIGNATURES: "on" })).toBe(true);
    expect(isContractorSigningEnabled({ NEXT_PUBLIC_CONTRACTOR_SIGNING: "on" })).toBe(false);
    expect(isContractorSigningEnabled({ NEXT_PUBLIC_ESIGNATURES: "on" })).toBe(false);
  });
  it("adoption must be affirmative and a typed signature must match the legal name", () => {
    const base = { legalName: "Dana Owner", method: "typed", signatureText: "Dana Owner", adopt: true, adoptionVersion: "x" };
    expect(credentialSchema.safeParse(base).success).toBe(true);
    expect(credentialSchema.safeParse({ ...base, adopt: false }).success).toBe(false);
    expect(credentialSchema.safeParse({ ...base, signatureText: "Someone Else" }).success).toBe(false);
    expect(credentialSchema.safeParse({ ...base, method: "drawn", signatureText: undefined }).success).toBe(false);
    expect(policySchema.safeParse({ required: true, mode: "rogue", defaultSignerId: null, autoApplyAllowed: true, autoApplyTiming: "before_send", repSignaturesAllowed: false }).success).toBe(false);
  });
  it("identity check needs a sign-in within 15 minutes", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(recentAuth("2026-11-17T11:50:00Z", now).ok).toBe(true);
    expect(recentAuth("2026-11-17T11:40:00Z", now).ok).toBe(false);
    expect(recentAuth(null, now).ok).toBe(false);
  });
});

describe("signature images", () => {
  it("re-encodes a real image to a trimmed PNG and rejects non-images", async () => {
    const jpg = await sharp(await png(900, 400)).jpeg().toBuffer();
    const out = await normalizeSignatureImage(`data:image/jpeg;base64,${jpg.toString("base64")}`);
    expect(out.ok).toBe(true);
    if (out.ok) { expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true); expect(out.sha256).toMatch(/^[0-9a-f]{64}$/); }
    expect((await normalizeSignatureImage(`data:image/png;base64,${Buffer.from("not an image at all, just text ".repeat(10)).toString("base64")}`)).ok).toBe(false);
    expect((await normalizeSignatureImage("data:image/svg+xml;base64,PHN2Zz4=")).ok).toBe(false);
  });
});

describe("PDFs", () => {
  it("unsigned proposal: Customer Signature | Contractor Signature with empty lines, no fake signature", async () => {
    const { text } = await pdfText(await renderToBuffer(<ProposalPdf doc={sig()} />));
    expect(squash(text)).toContain("CUSTOMERSIGNATURE");
    expect(squash(text)).toContain("CONTRACTORSIGNATURE");
    expect(text).toContain("Authorized signer, Acme Decks");
    expect(text).not.toMatch(/Date signed/);
  });
  it("customer copy awaiting countersignature says so and is not labelled executed", async () => {
    const { text } = await pdfText(await renderSignedPdf(sig(), null, customer(await png()), { contractorPending: true }));
    expect(text).toMatch(/Contractor countersignature: pending/);
    expect(text).not.toMatch(/Fully Executed/);
    expect(text).toContain("Authorized signer, Acme Decks");
  }, 30_000);
  it("executed agreement: both signers, their real dates, title, company and both certificates", async () => {
    const { text, pages } = await pdfText(await renderSignedPdf(sig(), null, customer(await png()), { contractor: contractor(), executed: true, executedAt: "2026-11-18T09:30:00Z" }));
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Fully Executed");
    expect(text).toContain("Customer: John Smith");
    expect(text).toContain("Electronic signature");
    expect(text).toContain("Date signed: 2026-11-17");
    expect(text).toContain("Dana Owner, President");
    expect(text).toContain("Date signed: 2026-11-18");
    expect(text).toContain("For Acme Decks (electronic signature)");
    expect(text).toContain("2026-11-18 09:30:00 UTC");
    expect(text).toContain("198.51.100.9");
  }, 30_000);
  it("automatic application never shows device evidence and says it was under prior authorization", async () => {
    const auto = contractor({ application: "auto_policy", applicationLabel: "Applied automatically", ipAddress: null, userAgent: null, authorizationGivenAt: "2026-11-01T10:00:00Z", method: "drawn", signatureImage: await png(), signatureText: null });
    const { text } = await pdfText(await renderSignedPdf(sig(), null, customer(await png()), { contractor: auto, executed: true, executedAt: "2026-11-18T09:30:00Z" }));
    expect(squash(text)).toContain("appliedunderpriorauthorization");
    expect(text).toMatch(/not a record of the signer personally signing/);
    expect(text).toContain("Prior authorization given");
    expect(text).not.toContain("Signer IP address");
    // The integrity heading stays on the same page as its first rows.
    const { perPage } = await pdfText(await renderSignedPdf(sig(), null, customer(await png()), { contractor: auto, executed: true, executedAt: "2026-11-18T09:30:00Z" }));
    const page = perPage.find((t) => t.includes("Document integrity"));
    expect(page).toContain("Proposal PDF SHA-256");
  }, 30_000);
  it("every template renders the same signature block", async () => {
    for (const template of ["classic", "modern", "premium", "detailed", "compact"] as const) {
      const d = { ...sig(), template };
      const { text } = await pdfText(await renderSignedPdf(d, null, customer(await png()), { contractor: contractor(), executed: true, executedAt: "2026-11-18T09:30:00Z" }));
      expect(squash(text), template).toContain("CONTRACTORSIGNATURE");
      expect(text, template).toContain("Dana Owner, President");
    }
  }, 60_000);
});
