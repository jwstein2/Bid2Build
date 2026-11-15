/**
 * E-signature pure logic: signing status derivation, accept payload validation, link expiry,
 * tokens, consent wording, the signing-link email, and the signed PDF (rendered for real).
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { bidSigning, recentSignatures, signedWhen, signingByEstimate, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { acceptSchema, isPngDataUrl } from "@/lib/esign/validate";
import { acceptanceText, consentText, CONSENT_VERSION, isEsignEnabled, linkExpiry } from "@/lib/esign/config";
import { hashSigningToken, isSigningToken, newSigningToken } from "@/lib/esign/token";
import { buildShareEmail } from "@/lib/proposal/share-email";
import { renderSignedPdf } from "@/lib/pdf/signed-pdf";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

const NOW = new Date("2026-11-15T20:00:00Z");
const req = (p: Partial<RequestRow>): RequestRow => ({ id: "r", estimate_id: "e1", version_id: "v1", status: "pending", expires_at: "2026-12-15T00:00:00Z", created_at: "2026-11-10T00:00:00Z", ...p });
const sig = (p: Partial<SignatureRow>): SignatureRow => ({ id: "s", estimate_id: "e1", version_id: "v1", version_number: 1, total: "18450.00", signed_at: "2026-11-15T19:14:00Z", signer_name: "John Smith", pdf_status: "ready", ...p });

async function png(w = 400, h = 120) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><path d="M10 80 C 60 10, 120 110, 200 40 S 320 90, 380 30" stroke="#0e2238" stroke-width="3" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("signing status", () => {
  it("is 'none' without requests and 'awaiting' for a live pending link", () => {
    expect(bidSigning([], [], NOW).state).toBe("none");
    expect(bidSigning([req({})], [], NOW).state).toBe("awaiting");
  });
  it("expired and revoked links show as such, never as signed", () => {
    expect(bidSigning([req({ expires_at: "2026-11-14T00:00:00Z" })], [], NOW).state).toBe("expired");
    expect(bidSigning([req({ status: "revoked" })], [], NOW).state).toBe("revoked");
  });
  it("is signed only with a committed signature, and keeps the signed amount", () => {
    const s = bidSigning([req({ status: "signed" })], [sig({})], NOW);
    expect(s.state).toBe("signed");
    expect(s.signed).toMatchObject({ id: "s", total: 18450, versionNumber: 1 });
  });
  it("a revision out for signature shows Awaiting while the earlier signature stays visible", () => {
    const s = bidSigning([req({ id: "r1", status: "signed" }), req({ id: "r2", version_id: "v2", created_at: "2026-11-15T00:00:00Z" })], [sig({})], NOW);
    expect(s.state).toBe("awaiting");
    expect(s.signed?.id).toBe("s");
    // ...and when that newer link is revoked or expires, the bid reads as Signed again.
    expect(bidSigning([req({ status: "signed" }), req({ id: "r2", status: "revoked", created_at: "2026-11-15T00:00:00Z" })], [sig({})], NOW).state).toBe("signed");
  });
  it("groups by estimate and keeps a pending PDF as Signed (document state is separate)", () => {
    const m = signingByEstimate([req({}), req({ id: "r9", estimate_id: "e2", status: "signed" })], [sig({ id: "s9", estimate_id: "e2", pdf_status: "failed" })], NOW);
    expect(m.get("e1")?.state).toBe("awaiting");
    expect(m.get("e2")).toMatchObject({ state: "signed", signed: { pdfStatus: "failed" } });
  });
  it("recent signatures: last N days, newest first", () => {
    const rows = [sig({ id: "old", signed_at: "2026-09-01T00:00:00Z" }), sig({ id: "a", signed_at: "2026-11-01T00:00:00Z" }), sig({ id: "b", signed_at: "2026-11-15T10:00:00Z" })];
    expect(recentSignatures(rows, 30, NOW).map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("formats signing time in the viewer's zone", () => {
    expect(signedWhen("2026-11-15T19:14:00Z", NOW, "UTC")).toBe("Today at 7:14 PM");
    expect(signedWhen("2026-11-15T19:14:00Z", NOW, "America/Los_Angeles")).toBe("Today at 11:14 AM");
    expect(signedWhen("2026-11-14T19:14:00Z", NOW, "UTC")).toBe("Yesterday at 7:14 PM");
    expect(signedWhen("2026-11-03T16:30:00Z", NOW, "UTC")).toBe("Nov 3 at 4:30 PM");
  });
});

describe("accept payload validation", () => {
  const base = { signerName: "John Smith", signerEmail: "john@example.com", method: "typed", signatureText: "John Smith", consent: true, accept: true, consentVersion: CONSENT_VERSION };
  it("accepts a typed signature that matches the legal name", () => {
    expect(acceptSchema.safeParse(base).success).toBe(true);
    expect(acceptSchema.safeParse({ ...base, signatureText: "  john   smith " }).success).toBe(true);
  });
  it("refuses unchecked or missing consent / acceptance (never assumed)", () => {
    for (const patch of [{ consent: false }, { accept: false }, { consent: undefined }, { accept: "true" }]) {
      expect(acceptSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });
  it("refuses a typed signature that differs from the name, bad emails and short names", () => {
    expect(acceptSchema.safeParse({ ...base, signatureText: "J" }).success).toBe(false);
    expect(acceptSchema.safeParse({ ...base, signatureText: "Jane Doe" }).success).toBe(false);
    expect(acceptSchema.safeParse({ ...base, signerEmail: "nope" }).success).toBe(false);
    expect(acceptSchema.safeParse({ ...base, signerName: "J", signatureText: "J" }).success).toBe(false);
  });
  it("drawn signatures must be a real PNG of sane size", async () => {
    const good = `data:image/png;base64,${(await png()).toString("base64")}`;
    expect(isPngDataUrl(good)).toBe(true);
    expect(acceptSchema.safeParse({ ...base, method: "drawn", signatureText: undefined, signatureImage: good }).success).toBe(true);
    expect(isPngDataUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isPngDataUrl(`data:image/jpeg;base64,${(await png()).toString("base64")}`)).toBe(false);
    expect(isPngDataUrl(`data:image/png;base64,${(await png(5000, 100)).toString("base64")}`)).toBe(false);
    expect(acceptSchema.safeParse({ ...base, method: "drawn", signatureImage: "data:text/html;base64,PHNjcmlwdD4=" }).success).toBe(false);
  });
});

describe("config, tokens and wording", () => {
  it("flag is off unless explicitly on", () => {
    expect(isEsignEnabled({})).toBe(false);
    expect(isEsignEnabled({ NEXT_PUBLIC_ESIGNATURES: "off" })).toBe(false);
    expect(isEsignEnabled({ NEXT_PUBLIC_ESIGNATURES: "on" })).toBe(true);
  });
  it("links last 30 days, cut short by the proposal's expiration date, refused once it has passed", () => {
    expect((linkExpiry(NOW) as Date).toISOString()).toBe("2026-12-15T20:00:00.000Z");
    expect((linkExpiry(NOW, "2026-11-20") as Date).toISOString()).toBe("2026-11-21T07:59:59.000Z");
    expect(linkExpiry(NOW, "2026-11-10")).toBe("proposal_expired");
    expect((linkExpiry(NOW, "2027-06-01") as Date).toISOString()).toBe("2026-12-15T20:00:00.000Z");
    expect((linkExpiry(NOW, null, 500) as Date).getTime() - NOW.getTime()).toBe(90 * 86_400_000);
  });
  it("tokens are 256-bit, URL-safe, and only their hash is stored", () => {
    const t = newSigningToken();
    expect(isSigningToken(t)).toBe(true);
    expect(newSigningToken()).not.toBe(t);
    expect(hashSigningToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(isSigningToken("../../etc")).toBe(false);
    expect(isSigningToken(t + "x")).toBe(false);
  });
  it("consent covers paper copies, withdrawal and system requirements; acceptance names the total", () => {
    const c = consentText("Acme Decks");
    expect(c).toMatch(/paper copy/);
    expect(c).toMatch(/withdraw/);
    expect(c).toMatch(/PDF/);
    expect(acceptanceText({ companyName: "Acme Decks", proposalNumber: "1042", projectTitle: "Deck", total: "$18,450.00" })).toBe(
      'I have reviewed the entire proposal ("Deck", proposal #1042) from Acme Decks, including its scope, pricing, exclusions, payment schedule and terms, and I accept it for a total of $18,450.00.');
  });
  it("the signing-link email carries the link and no attachment wording", () => {
    const e = buildShareEmail({ customerName: "John Smith", customerEmail: "john@example.com", projectTitle: "Backyard Deck Replacement", companyName: "Acme Decks", contactName: "Sam", phone: "(555) 010-0000", signingUrl: "https://built2bid.org/sign/abc" });
    expect(e.subject).toBe("Please Review & Sign Your Proposal — Backyard Deck Replacement");
    expect(e.body).toContain("https://built2bid.org/sign/abc");
    expect(e.body).not.toMatch(/attached/);
    expect(buildShareEmail({ signingUrl: "javascript:alert(1)" }).body).not.toContain("javascript");
  });
});

describe("signed PDF", () => {
  it("contains the proposal, the signature in the acceptance line, and a certificate page", async () => {
    const doc = buildProposal(est({ title: "Backyard Deck Replacement", customer: { name: "John Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] }), { ...defaultBusinessProfile(), companyName: "Acme Decks" }, defaultProposalConfig());
    const pdf = await renderSignedPdf(doc, null, {
      signatureId: "11111111-1111-1111-1111-111111111111", requestId: "22222222-2222-2222-2222-222222222222", signerName: "John Smith", signerEmail: "john@example.com",
      method: "drawn", signatureImage: await png(), signedAt: "2026-11-15T19:14:00Z", consentedAt: "2026-11-15T19:13:30Z", consentVersion: CONSENT_VERSION,
      consentText: consentText("Acme Decks"), acceptanceText: "I accept.", verification: "link_possession", documentHash: "a".repeat(64), contentHash: "b".repeat(64),
      versionNumber: 1, total: doc.pricing.total, ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0", linkCreatedAt: "2026-11-15T18:00:00Z",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    let text = "";
    for (let p = 1; p <= d.numPages; p++) text += (await (await d.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
    expect(d.numPages).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Electronic Signature Certificate");
    expect(text).toContain("John Smith (electronic signature)");
    expect(text).toContain("2026-11-15 19:14:00 UTC");
    expect(text).toContain("a".repeat(64));
    expect(text).toMatch(/Identity was not independently verified/);
    expect(text).toContain(doc.pricing.total);
  }, 30_000);
});
