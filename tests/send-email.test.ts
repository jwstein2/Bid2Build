import { describe, expect, it } from "vitest";
import { buildShareEmail, canShareFile, firstName, mailtoHref, validEmail } from "@/lib/proposal/share-email";

const full = { customerName: "Pat Smith", customerEmail: "pat@example.com", projectTitle: "Smith backyard deck", companyName: "Acme Decks", contactName: "Dana Lee", phone: "(555) 555-0100" };

describe("Send via My Email: message content", () => {
  it("uses the approved subject and message with the estimate's details", () => {
    const m = buildShareEmail(full);
    expect(m.to).toBe("pat@example.com");
    expect(m.subject).toBe("Your Estimate from Acme Decks — Smith backyard deck");
    expect(m.body).toBe([
      "Hi Pat,", "",
      "Thank you for the opportunity to provide an estimate for Smith backyard deck.", "",
      "I've attached our proposal for your review. Please let me know if you have any questions or would like to discuss anything further.", "",
      "Thank you,", "Dana Lee", "Acme Decks", "(555) 555-0100",
    ].join("\n"));
  });
  it("leaves out missing fields instead of inventing them", () => {
    const m = buildShareEmail({ companyName: "Acme Decks", projectTitle: "Deck" });
    expect(m.to).toBe("");
    expect(m.body.startsWith("Hi,\n")).toBe(true);
    expect(m.body.trimEnd().endsWith("Thank you,\nAcme Decks")).toBe(true);
    expect(m.body).not.toMatch(/undefined|null|\[|Contractor Name|Phone/);
  });
  it("rejects invalid recipient addresses and strips header-breaking characters", () => {
    expect(validEmail("not-an-email")).toBe("");
    expect(validEmail("a@b.co\r\nbcc:evil@x.com")).toBe("");
    const m = buildShareEmail({ ...full, projectTitle: "Deck\r\nBcc: evil@x.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(firstName("  Pat   Smith ")).toBe("Pat");
  });
});

describe("mailto link", () => {
  it("percent-encodes every part and uses CRLF line breaks", () => {
    const m = buildShareEmail(full);
    const href = mailtoHref(m);
    expect(href.startsWith("mailto:pat@example.com?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(m.subject);
    expect(url.searchParams.get("body")).toBe(m.body.replace(/\n/g, "\r\n"));
    expect(href).not.toMatch(/\s/);
  });
  it("encodes &, ?, # and + so they can't add parameters", () => {
    const href = mailtoHref({ to: "pat@example.com", subject: "A & B ? #1 + tax", body: "x&cc=evil@x.com" });
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe("A & B ? #1 + tax");
    expect(url.searchParams.get("body")).toBe("x&cc=evil@x.com");
    expect(url.searchParams.get("cc")).toBeNull();
  });
  it("omits an invalid recipient", () => {
    expect(mailtoHref({ to: "nope", subject: "s", body: "b" }).startsWith("mailto:?subject=")).toBe(true);
  });
});

describe("file sharing feature detection", () => {
  const file = new File([new Uint8Array([37, 80, 68, 70])], "p.pdf", { type: "application/pdf" });
  it("is true only when share and canShare({ files }) both say yes", () => {
    expect(canShareFile(file, { share: async () => {}, canShare: () => true })).toBe(true);
    expect(canShareFile(file, { share: async () => {}, canShare: () => false })).toBe(false);
    expect(canShareFile(file, { share: async () => {} })).toBe(false);
    expect(canShareFile(file, { canShare: () => true })).toBe(false);
    expect(canShareFile(file, { share: async () => {}, canShare: () => { throw new Error("x"); } })).toBe(false);
    expect(canShareFile(file, undefined)).toBe(false);
  });
});
