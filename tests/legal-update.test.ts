import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { activityErrorMessage, callReadiness, inCallWindow, stateTimeZone } from "@/lib/sales/calling";
import { consentText, CONSENT_VERSION } from "@/lib/esign/config";
import { sendSignerCopy, signerCopyEnabled, signerCopyText } from "@/lib/esign/signer-copy";
import { articles } from "@/lib/learn/articles";
import type { ProposalDocument } from "@/lib/proposal/types";

describe("calling compliance helpers", () => {
  const noonCentral = new Date("2026-11-18T18:00:00Z");
  const lateCentral = new Date("2026-11-19T03:30:00Z");
  it("uses the state's primary time zone and a 9 AM to 8 PM window", () => {
    expect(stateTimeZone("mn")).toBe("America/Chicago");
    expect(stateTimeZone("AZ")).toBe("America/Phoenix");
    expect(stateTimeZone(undefined)).toBe("America/Chicago");
    expect(inCallWindow("MN", noonCentral)).toBe(true);
    expect(inCallWindow("MN", lateCentral)).toBe(false);
  });
  it("explains what blocks a call or text", () => {
    expect(callReadiness({ do_not_contact: false, dnc_status: "unchecked", state: "MN" }, noonCentral)).toMatchObject({ canCall: false, canText: false });
    expect(callReadiness({ do_not_contact: false, dnc_status: "clear", state: "MN" }, noonCentral)).toMatchObject({ canCall: true, canText: false, reasons: [] });
    expect(callReadiness({ do_not_contact: false, dnc_status: "clear", text_consent_at: "2026-11-18T00:00:00Z", state: "MN" }, noonCentral).canText).toBe(true);
    expect(callReadiness({ do_not_contact: true, dnc_status: "clear", state: "MN" }, noonCentral).canCall).toBe(false);
    expect(callReadiness({ do_not_contact: false, dnc_status: "listed", state: "MN" }, noonCentral).reasons.join(" ")).toMatch(/Do Not Call Registry/);
  });
  it("maps database refusals to plain messages", () => {
    expect(activityErrorMessage('P0001: dnc_unchecked')).toMatch(/Do Not Call check/);
    expect(activityErrorMessage("something else")).toBe("That couldn't be logged.");
  });
});

describe("e-signature consent v2", () => {
  it("covers paper copies, withdrawal, contact changes and the ability to open the PDF", () => {
    const t = consentText("Acme Roofing");
    expect(CONSENT_VERSION).toBe("esign-consent-2026-11-19");
    for (const re of [/paper copy at no charge/, /withdraw this consent/, /email address changes/, /I confirm that I can open the proposal PDF/, /same legal effect/]) expect(t).toMatch(re);
    expect(t.length).toBeLessThan(4000);
  });
});

describe("signer copy email", () => {
  const doc = { brand: { companyName: "Acme Roofing", contact: [{ label: "Email", value: "office@acme.com" }, { label: "Phone", value: "555-0100" }] }, meta: { title: "Roof", number: "1001" }, pricing: { total: "$9,500.00" } } as unknown as ProposalDocument;
  it("is off unless switched on with an email key", async () => {
    expect(signerCopyEnabled({})).toBe(false);
    expect(signerCopyEnabled({ ESIGN_SIGNER_COPY_EMAIL: "on" })).toBe(false);
    expect(signerCopyEnabled({ ESIGN_SIGNER_COPY_EMAIL: "on", RESEND_API_KEY: "re_x" })).toBe(true);
    const f = vi.fn();
    expect(await sendSignerCopy({ to: "pat@example.com", signerName: "Pat", token: "t", doc, signatureId: "s1" }, {}, f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("sends one idempotent email from the contractor's name with a reply-to", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    expect(await sendSignerCopy({ to: "pat@example.com", signerName: "Pat", token: "tok", doc, signatureId: "s1" }, { ESIGN_SIGNER_COPY_EMAIL: "on", RESEND_API_KEY: "re_x" }, f as unknown as typeof fetch)).toBe(true);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe('"Acme Roofing" <updates@built2bid.org>');
    expect(body.reply_to).toBe("office@acme.com");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("esign-copy-s1");
    expect(body.text).toMatch(/\/sign\/tok/);
    expect(signerCopyText({ signerName: "Pat", companyName: "Acme", title: "Roof", number: "1", total: "$1", link: "L", contact: "" })).toMatch(/not a party/);
  });
});

describe("pricing guides", () => {
  it("marks every generated guide as AI-assisted and leaves hand-written guides alone", () => {
    const generated = articles.filter((a) => a.published);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((a) => a.aiAssisted)).toBe(true);
    expect(articles.find((a) => a.slug === "markup-vs-margin")?.aiAssisted).toBeFalsy();
  });
});
