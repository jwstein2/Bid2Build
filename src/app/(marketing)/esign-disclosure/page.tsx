import type { Metadata } from "next";
import { LegalPage, H2, UL, A } from "@/components/legal/legal-page";
import { site } from "@/lib/site";
import { CONSENT_VERSION } from "@/lib/esign/config";
import { ADOPTION_VERSION } from "@/lib/esign/contractor/config";

export const metadata: Metadata = { title: "Electronic Signature Disclosure", alternates: { canonical: "/esign-disclosure" } };

/**
 * The standing version of the consent shown on every signing page, so a signer can read, print or save it
 * before agreeing. The signing page shows the same points with the contractor's name filled in.
 * Structured after the elements of a mature provider's electronic record and signature disclosure (DocuSign's
 * public ERSD was the benchmark; the wording is our own). Attorney review is pending (shown by LegalPage).
 */
export default function EsignDisclosure() {
  return (
    <LegalPage title="Electronic Signature Disclosure" updated="November 21, 2026" docKey="esign-disclosure">
      <p>Contractors use {site.name} to send proposals and change orders for you to review and sign online. Before you sign, you are asked to agree to use electronic records and signatures. This page explains what that means. The contractor who sent you the document is the other party to it; {site.name} only provides the signing service and is not a party to your agreement.</p>

      <H2>What you agree to</H2>
      <p>If you tick the consent box, you agree to do business electronically with that contractor for that document. You agree to receive, review and sign it electronically, and to receive your signed copy and any notices and records about signing it electronically. The consent covers that document and the records about signing it, not other documents.</p>

      <H2>Your electronic signature is a legal signature</H2>
      <p>Your electronic signature, whether typed or drawn, has the same legal effect as a handwritten signature under the federal Electronic Signatures in Global and National Commerce Act (ESIGN Act, 15 U.S.C. 7001 et seq.) and your state&apos;s version of the Uniform Electronic Transactions Act. When you select <strong>Accept &amp; Sign</strong>, you are signing that exact version of the document and agreeing to be bound by it.</p>

      <H2>Paper copies</H2>
      <p>You can ask the contractor for a paper copy of the document or the signed record at any time, at no charge. Their contact details are on the proposal.</p>

      <H2>Withdrawing your consent</H2>
      <p>You don&apos;t have to sign electronically. You can withdraw your consent before you sign by not signing and telling the contractor, who can then give you the document on paper. There is no fee for withdrawing. Withdrawing consent does not change the legal effect of anything you already signed electronically.</p>

      <H2>Keeping your contact details current</H2>
      <p>If your email address changes, tell the contractor so they can reach you.</p>

      <H2>What you need</H2>
      <UL>
        <li>A phone, tablet or computer with a current web browser.</li>
        <li>A way to open PDF files (most browsers can).</li>
        <li>An email account, if you want to receive your copy by email.</li>
        <li>Somewhere to save or print a copy, if you want to keep one outside the link.</li>
      </UL>
      <p>On the signing page you confirm that you can open the proposal PDF on your device. That confirms you can open and keep the records this consent covers.</p>

      <H2>Getting your copy</H2>
      <p>Before signing you can download or print the document. After signing, your private link lets you download the signed copy, with a certificate page that records how and when it was signed and the activity on the link. You may also receive it by email. When the contractor also signs, the fully executed copy carries both signatures. You can check that a signed copy has not been changed on our <A href="/verify">document check page</A>.</p>

      <H2>What is recorded</H2>
      <p>When you open, download or sign, we record the time, your device&apos;s IP address and browser. When you sign we also record the name, email and signature you enter, the consent and acceptance wording you agreed to, and a fingerprint (SHA-256 hash) of the exact document you reviewed. Signed records are locked so they can&apos;t be edited or deleted. Identity is confirmed only by possession of the private link unless the contractor uses extra checks. See our <A href="/privacy">Privacy Policy</A>.</p>

      <H2>For contractors who sign for their company</H2>
      <p>People who sign proposals for a contractor&apos;s business on {site.name} agree to these terms as well:</p>
      <UL>
        <li><strong>Adopting a signature.</strong> You confirm your identity (a recent sign-in or a one-time email code), then adopt a drawn, uploaded or typed signature, or your company&apos;s name with &quot;By:&quot; your name and title. You agree to do business electronically and that each time you apply the signature, or authorize it to be applied, you intend to sign and it has the same effect as your handwritten signature.</li>
        <li><strong>Authority.</strong> You sign for your company only within the authority it has given you. The company owner decides who may sign and for which contracts; nobody can authorize themselves.</li>
        <li><strong>Automatic application.</strong> It is optional and off unless you separately authorize it. Each automatic signature is your signature adopted in advance, binds your company, and is labeled on the contract and certificate as applied under your prior authorization, not as a signature you made at that moment. You can revoke it at any time in My Signature; revoking affects future contracts only.</li>
        <li><strong>Countersigning.</strong> When you countersign, you confirm you are authorized to bind the company, that you reviewed the exact version and total, and that you intend to sign. The time, your IP address and browser are recorded.</li>
        <li><strong>Security.</strong> Keep your sign-in secure and don&apos;t let anyone else use your signature. Remove your signature right away if you think someone else has used it or your account.</li>
        <li><strong>Your legal duties.</strong> You are responsible for any notices, cancellation rights, licensing details or paper-signature requirements that apply to your contracts in your state. See section 7 of our <A href="/terms">Terms</A>.</li>
      </UL>

      <H2>Questions</H2>
      <p>Questions about the proposal, the price or the work go to the contractor. Questions about the signing service: <A href={`mailto:${site.supportEmail}`}>{site.supportEmail}</A>.</p>
      <p className="text-xs text-muted">Signer disclosure version {CONSENT_VERSION}. Contractor adoption version {ADOPTION_VERSION}.</p>
    </LegalPage>
  );
}
