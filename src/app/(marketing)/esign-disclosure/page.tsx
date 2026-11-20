import type { Metadata } from "next";
import { LegalPage, H2, UL, A, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { site } from "@/lib/site";
import { CONSENT_VERSION } from "@/lib/esign/config";

export const metadata: Metadata = { title: "Electronic Signature Disclosure", alternates: { canonical: "/esign-disclosure" } };

/**
 * The standing version of the consent shown on every signing page, so a signer can read, print or save it
 * before agreeing. The signing page shows the same points with the contractor's name filled in.
 */
export default function EsignDisclosure() {
  return (
    <LegalPage title="Electronic Signature Disclosure" updated={LEGAL_UPDATED} docKey="esign-disclosure">
      <p>Contractors use {site.name} to send proposals for you to review and sign online. Before you sign, you are asked to agree to use electronic records and signatures. This page explains what that means. The contractor who sent you the proposal is the other party to it; {site.name} only provides the signing service and is not a party to your proposal.</p>
      <H2>What you agree to</H2>
      <p>If you tick the consent box, you agree to receive, review and sign that proposal electronically, and that your electronic signature (typed or drawn) has the same legal effect as a handwritten signature. The consent covers that proposal and the records about signing it.</p>
      <H2>Paper copies</H2>
      <p>You can ask the contractor for a paper copy at any time, at no charge. Their contact details are on the proposal.</p>
      <H2>Withdrawing your consent</H2>
      <p>You don&apos;t have to sign electronically. You can withdraw your consent before you sign by not signing and telling the contractor, who can then give you the proposal on paper. Withdrawing consent does not undo anything you already signed.</p>
      <H2>Keeping your contact details current</H2>
      <p>If your email address changes, tell the contractor so they can reach you.</p>
      <H2>What you need</H2>
      <UL>
        <li>A phone, tablet or computer with a current web browser.</li>
        <li>A way to open PDF files (most browsers can).</li>
        <li>Somewhere to save or print a copy, if you want to keep one outside the link.</li>
      </UL>
      <p>On the signing page you confirm that you can open the proposal PDF on your device.</p>
      <H2>Getting your copy</H2>
      <p>Before signing you can download or print the proposal. After signing, your private link lets you download the signed copy, with a certificate page that records how and when it was signed. You may also receive it by email. You can check that a signed copy has not been changed on our <A href="/verify">document check page</A>.</p>
      <H2>What is recorded</H2>
      <p>When you open, download or sign, we record the time, your device&apos;s IP address and browser. When you sign we also record the name, email and signature you enter, the consent and acceptance wording you agreed to, and a fingerprint (SHA-256 hash) of the exact proposal you reviewed. Identity is confirmed only by possession of the private link unless the contractor uses extra checks. See our <A href="/privacy">Privacy Policy</A>.</p>
      <H2>Questions</H2>
      <p>Questions about the proposal, the price or the work go to the contractor. Questions about the signing service: <A href={`mailto:${site.supportEmail}`}>{site.supportEmail}</A>.</p>
      <p className="text-xs text-muted">Disclosure version {CONSENT_VERSION}.</p>
    </LegalPage>
  );
}
