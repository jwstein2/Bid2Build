import "server-only";
import { Page, StyleSheet, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
import type { ProposalDocument } from "../proposal/types";
import { ProposalPdf, pdfSafe as T, type PdfContractorSignature } from "./proposal-pdf";

export interface SignatureCertificate {
  signatureId: string;
  requestId: string;
  signerName: string;
  signerEmail: string;
  method: "typed" | "drawn";
  signatureText?: string | null;
  signatureImage?: Buffer | null;
  signedAt: string; // ISO UTC
  consentedAt: string;
  consentVersion: string;
  consentText: string;
  acceptanceText: string;
  verification: string;
  documentHash: string;
  contentHash: string;
  versionNumber: number;
  total: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  linkCreatedAt: string;
  /** Audit trail of the signing link (opened, downloaded, signed), oldest first. */
  events?: { label: string; at: string; ipAddress?: string | null }[];
}

/** The contractor-side signature record shown on the certificate (V5.3). Always a recorded row. */
export interface ContractorCertificate {
  id: string;
  signerName: string;
  signerTitle?: string | null;
  companyName: string;
  authority: string;
  application: "auto_policy" | "interactive";
  applicationLabel: string;
  method: "drawn" | "typed" | "uploaded";
  signatureText?: string | null;
  signatureImage?: Buffer | null;
  appliedAt: string;
  credentialVersion: number;
  policyRevision?: number | null;
  authorizationGivenAt?: string | null;
  statementText: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  corrective: boolean;
}

/**
 * What the document is: the customer's signed copy (optionally noting a pending countersignature), or
 * the fully executed agreement (both signatures recorded).
 */
export interface SignedPdfOptions {
  contractor?: ContractorCertificate | null;
  /** True only when every required signature is recorded. */
  executed?: boolean;
  /** Customer signed, a contractor signature is required and not yet applied. */
  contractorPending?: boolean;
  executedAt?: string | null;
}

const AUTHORITY_LABELS: Record<string, string> = {
  business_owner: "Business owner",
  company_owner: "Company owner",
  company_authorization: "Authorized by the company owner",
};

const utc = (iso: string) => `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC`;

/**
 * Printed on every signature certificate. Explains why the record is a valid signed original under ESIGN/UETA
 * (consent, intent, attribution, integrity, retention), in the way a certificate of completion does.
 */
export const LEGAL_BASIS_TEXT = "Each signature in this document is an electronic signature under the U.S. Electronic Signatures in Global and National Commerce Act (15 U.S.C. 7001 et seq.) and the Uniform Electronic Transactions Act as adopted by the applicable state. Before signing, each signer agreed to use electronic records and signatures and affirmed the statement shown above, which records their intent to sign (for a signature applied automatically, the signer adopted it and authorized its use in advance, as shown). Each signer's name, signing method and time, the IP address and browser for signatures made in person, the activity on the signing link, and the SHA-256 fingerprints of the exact document reviewed are kept with this record so the signature can be attributed and any later change to the file can be detected. Built2Bid provided the signing service and is not a party to this agreement.";

/** The proposal exactly as reviewed, the signature in its acceptance line, then a certificate page. */
export async function renderSignedPdf(doc: ProposalDocument, logo: { data: Buffer; format: "png" | "jpg" } | null, c: SignatureCertificate, opts: SignedPdfOptions = {}): Promise<Buffer> {
  const k = opts.contractor ?? null;
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 9, color: "#16202e", padding: 44 },
    h1: { fontFamily: "Helvetica-Bold", fontSize: 16, color: "#0B2A4A", marginBottom: 4 },
    h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: "#0B2A4A", marginTop: 14, marginBottom: 4 },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e4e0d8", paddingVertical: 3 },
    k: { width: 150, color: "#6b7686" },
    v: { flex: 1 },
    mono: { fontFamily: "Courier", fontSize: 8 },
    muted: { color: "#6b7686" },
  });
  const KV = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
    <View style={s.row} wrap={false}><Text style={s.k}>{k}</Text><Text style={[s.v, mono ? s.mono : {}]}>{T(v)}</Text></View>
  );
  const date = new Date(c.signedAt).toISOString().slice(0, 10);
  const appendix = (
    <Page size="LETTER" style={s.page} wrap>
      <Text style={s.h1}>{opts.executed ? "Electronic Signature Certificate - Fully Executed" : "Electronic Signature Certificate"}</Text>
      <Text style={s.muted}>{T(`${doc.brand.companyName} · ${doc.meta.title} · Proposal #${doc.meta.number} · Version ${c.versionNumber}`)}</Text>

      {opts.executed && opts.executedAt ? <Text style={{ marginTop: 6 }}>{T(`All required signatures are recorded. Fully executed ${utc(opts.executedAt)} (the later of the two signing times).`)}</Text> : null}
      {opts.contractorPending ? <Text style={{ marginTop: 6, fontFamily: "Helvetica-Bold" }}>Contractor countersignature: pending. This copy is signed by the customer and is not yet fully executed.</Text> : null}

      <Text style={s.h2}>Customer signature</Text>
      <View style={{ borderWidth: 0.75, borderColor: "#16202e", borderRadius: 3, padding: 10, minHeight: 60, justifyContent: "center" }}>
        {c.method === "drawn" && c.signatureImage
          ? <Image src={{ data: c.signatureImage, format: "png" }} style={{ height: 50, maxWidth: 260, objectFit: "contain" }} />
          : <Text style={{ fontFamily: "Times-Italic", fontSize: 22 }}>{T(c.signatureText ?? c.signerName)}</Text>}
      </View>
      <KV k="Signer name" v={c.signerName} />
      <KV k="Signer email" v={c.signerEmail} />
      <KV k="Signing method" v={c.method === "drawn" ? "Drawn electronic signature" : "Typed electronic signature (name applied as signature)"} />
      <KV k="Accepted total" v={c.total} />
      <KV k="Signed at" v={utc(c.signedAt)} />
      <KV k="Consent given at" v={utc(c.consentedAt)} />
      <KV k="Signer verification" v={c.verification === "email_code" ? "Email code confirmed" : "Possession of a private signing link only. Identity was not independently verified."} />

      <Text style={s.h2}>Consent to electronic records and signatures ({T(c.consentVersion)})</Text>
      <Text>{T(c.consentText)}</Text>
      <Text style={s.h2}>Acceptance statement</Text>
      <Text>{T(c.acceptanceText)}</Text>

      {k ? (
        <View wrap={false}>
          <Text style={s.h2}>Contractor signature</Text>
          <View style={{ borderWidth: 0.75, borderColor: "#16202e", borderRadius: 3, padding: 10, minHeight: 60, justifyContent: "center" }}>
            {k.signatureImage
              ? <Image src={{ data: k.signatureImage, format: "png" }} style={{ height: 50, maxWidth: 260, objectFit: "contain" }} />
              : <Text style={{ fontFamily: "Times-Italic", fontSize: 22 }}>{T(k.signatureText ?? k.signerName)}</Text>}
          </View>
        </View>
      ) : null}
      {k ? <KV k="Signer" v={`${k.signerName}${k.signerTitle ? `, ${k.signerTitle}` : ""}`} /> : null}
      {k ? <KV k="On behalf of" v={k.companyName} /> : null}
      {k ? <KV k="Authority" v={AUTHORITY_LABELS[k.authority] ?? k.authority} /> : null}
      {k ? <KV k="How it was applied" v={k.applicationLabel} /> : null}
      {k ? <KV k={k.application === "auto_policy" ? "Applied by the system at" : "Signed at"} v={utc(k.appliedAt)} /> : null}
      {k && k.application === "auto_policy" && k.authorizationGivenAt ? <KV k="Prior authorization given" v={utc(k.authorizationGivenAt)} /> : null}
      {k ? <KV k="Signature on file" v={`Version ${k.credentialVersion} (${k.method === "drawn" ? "drawn" : k.method === "uploaded" ? "uploaded image" : k.signatureText && k.signatureText.toLowerCase() !== k.signerName.toLowerCase() ? "typed company name, signed by the person named above" : "typed"})`} /> : null}
      {k && k.policyRevision ? <KV k="Company signing policy" v={`Revision ${k.policyRevision}`} /> : null}
      {k && k.application === "interactive" && k.ipAddress ? <KV k="Signer IP address" v={k.ipAddress} /> : null}
      {k && k.application === "interactive" && k.userAgent ? <KV k="Signer browser" v={k.userAgent.slice(0, 200)} /> : null}
      {k ? <KV k="Contractor signature ID" v={k.id} mono /> : null}
      {k ? <Text style={[s.muted, { marginTop: 4 }]}>{T(`${k.application === "auto_policy" ? "Authorization relied on" : "Statement affirmed"}: ${k.statementText}`)}</Text> : null}
      {k && k.application === "auto_policy" ? <Text style={[s.muted, { marginTop: 2 }]}>This signature was applied automatically under the signer&apos;s prior authorization. It is not a record of the signer personally signing at that moment, and no device or IP address is recorded for it.</Text> : null}

      {/* Keep the heading with its first rows so it never sits alone at the bottom of a page. */}
      <View wrap={false}>
        <Text style={s.h2}>Document integrity</Text>
        <KV k="Proposal PDF SHA-256" v={c.documentHash} mono />
        <KV k="Proposal content SHA-256" v={c.contentHash} mono />
      </View>
      <KV k="Signing link issued" v={utc(c.linkCreatedAt)} />
      {c.events && c.events.length ? (
        <View>
          <Text style={s.h2}>Activity on the signing link</Text>
          {c.events.slice(0, 40).map((e, i) => <KV key={i} k={utc(e.at)} v={`${e.label}${e.ipAddress ? ` (IP ${e.ipAddress})` : ""}`} />)}
          {c.events.length > 40 ? <Text style={s.muted}>{T(`${c.events.length - 40} more events are in the audit record.`)}</Text> : null}
        </View>
      ) : null}
      <KV k="Signature record ID" v={c.signatureId} mono />
      <KV k="Signing request ID" v={c.requestId} mono />
      {c.ipAddress ? <KV k="IP address" v={c.ipAddress} /> : null}
      {c.userAgent ? <KV k="Browser" v={c.userAgent.slice(0, 200)} /> : null}
      <View wrap={false}>
        <Text style={s.h2}>Legal basis of this record</Text>
        <Text>{T(LEGAL_BASIS_TEXT)}</Text>
      </View>
      <Text style={[s.muted, { marginTop: 14, fontSize: 8 }]}>
        {T(`The proposal pages in this file are the version the signer reviewed (its PDF hash is listed above). Signed ${date}. A record of this signature is kept by ${doc.brand.companyName} through Built2Bid. To check that this file has not been changed since it was signed, upload it at built2bid.org/verify.`)}
      </Text>
    </Page>
  );
  return renderToBuffer(
    <ProposalPdf doc={doc} logo={logo} appendix={appendix}
      acceptance={{ name: c.signerName, date, image: c.method === "drawn" ? c.signatureImage : null, typed: c.method === "typed" ? c.signatureText : null }}
      contractor={k ? contractorOnProposal(k) : null} />,
  );
}

/** The contractor signature as it appears in the proposal's signature block. */
export function contractorOnProposal(k: ContractorCertificate): PdfContractorSignature {
  return {
    name: k.signerName, title: k.signerTitle, company: k.companyName, date: new Date(k.appliedAt).toISOString().slice(0, 10),
    image: k.method === "typed" ? null : k.signatureImage ?? null, typed: k.method === "typed" ? k.signatureText ?? k.signerName : null,
    auto: k.application === "auto_policy",
  };
}
