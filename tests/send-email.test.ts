import { describe, expect, it } from "vitest";
import { buildShareEmail, canShareFile, firstName, mailtoHref, plainEmail, validEmail, webComposeFits, webComposeHref } from "@/lib/proposal/share-email";

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

describe("Gmail and Outlook compose links", () => {
  const m = buildShareEmail(full);
  it("Gmail: opens a full-screen compose with recipient, subject and message", () => {
    const u = new URL(webComposeHref("gmail", m));
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("fs")).toBe("1");
    expect(u.searchParams.get("to")).toBe("pat@example.com");
    expect(u.searchParams.get("su")).toBe(m.subject);
    expect(u.searchParams.get("body")).toBe(m.body);
  });
  it("Outlook (work and personal): deeplink compose with %20 spaces, never +", () => {
    for (const app of ["outlook", "outlook-personal"] as const) {
      const href = webComposeHref(app, m);
      expect(href.startsWith(app === "outlook" ? "https://outlook.office.com/mail/deeplink/compose?" : "https://outlook.live.com/mail/0/deeplink/compose?")).toBe(true);
      expect(href).not.toMatch(/\+|\s/);
      const u = new URL(href);
      expect(u.searchParams.get("to")).toBe("pat@example.com");
      expect(u.searchParams.get("subject")).toBe(m.subject);
      expect(u.searchParams.get("body")).toBe(m.body);
    }
  });
  it("keeps a literal + and & in the text and can't add parameters", () => {
    const u = new URL(webComposeHref("outlook", { to: "pat@example.com", subject: "A + B & C", body: "x&cc=evil@x.com" }));
    expect(u.searchParams.get("subject")).toBe("A + B & C");
    expect(u.searchParams.get("body")).toBe("x&cc=evil@x.com");
    expect(u.searchParams.get("cc")).toBeNull();
  });
  it("drops an invalid recipient and header-breaking characters", () => {
    const u = new URL(webComposeHref("gmail", { to: "a@b.co\r\nbcc:x@y.z", subject: "Hi\r\nBcc: x@y.z", body: "b" }));
    expect(u.searchParams.has("to")).toBe(false);
    expect(u.searchParams.get("su")).not.toMatch(/[\r\n]/);
  });
  it("cuts a very long message instead of making an unusable link", () => {
    const href = webComposeHref("gmail", { to: "", subject: "s", body: "x".repeat(20000) });
    expect(href.length).toBeLessThan(8000);
    expect(new URL(href).searchParams.get("body")!.endsWith("…")).toBe(true);
  });
  it("a message too long for a web draft is reported, so the dialog can offer Copy message instead", () => {
    expect(webComposeFits("x".repeat(3000))).toBe(true);
    expect(webComposeFits("x".repeat(3001))).toBe(false);
  });
  it("signing-link messages carry the link and never mention an attachment", () => {
    const s = buildShareEmail({ ...full, signingUrl: "https://built2bid.org/sign/abc" });
    const body = new URL(webComposeHref("gmail", s)).searchParams.get("body")!;
    expect(body).toContain("https://built2bid.org/sign/abc");
    expect(body).not.toMatch(/attached/i);
  });
});

describe("Signing-link email", () => {
  it("uses the review-and-sign subject and message with the estimate's details", () => {
    const m = buildShareEmail({ ...full, signingUrl: "https://built2bid.org/sign/abc" });
    expect(m.to).toBe("pat@example.com");
    expect(m.subject).toBe("Please Review & Sign Your Proposal — Smith backyard deck");
    expect(m.body).toBe([
      "Hi Pat,", "",
      "Thank you for the opportunity to provide an estimate for your project.", "",
      "Please review your proposal and electronically sign it using the secure link below:", "",
      "https://built2bid.org/sign/abc", "",
      "If you have any questions or would like to discuss anything before signing, please let me know.", "",
      "Thank you,", "Dana Lee", "Acme Decks", "(555) 555-0100",
    ].join("\n"));
  });
  it("leaves out missing details instead of inventing them", () => {
    const m = buildShareEmail({ signingUrl: "https://built2bid.org/sign/abc" });
    expect(m.subject).toBe("Please Review & Sign Your Proposal");
    expect(m.body.startsWith("Hi,\n")).toBe(true);
    expect(m.body.trimEnd().endsWith("Thank you,")).toBe(true);
    expect(m.body).not.toMatch(/undefined|null|\[|attached/i);
  });
  it("the PDF email keeps its own subject and attachment wording", () => {
    const pdf = buildShareEmail(full);
    expect(pdf.subject).toBe("Your Estimate from Acme Decks — Smith backyard deck");
    expect(pdf.body).toMatch(/I've attached our proposal/);
    expect(pdf.body).not.toMatch(/sign/i);
  });
});

describe("Copy message", () => {
  it("is the whole email as plain text", () => {
    const m = buildShareEmail(full);
    expect(plainEmail(m)).toBe(`To: pat@example.com\nSubject: ${m.subject}\n\n${m.body}`);
    expect(plainEmail({ to: "", subject: "S", body: "B" })).toBe("Subject: S\n\nB");
  });
});
