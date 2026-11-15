import "server-only";
import { Page, StyleSheet, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
import type { ProposalDocument } from "../proposal/types";
import { ProposalPdf, pdfSafe as T } from "./proposal-pdf";

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
}

const utc = (iso: string) => `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC`;

/** The proposal exactly as reviewed, the signature in its acceptance line, then a certificate page. */
export async function renderSignedPdf(doc: ProposalDocument, logo: { data: Buffer; format: "png" | "jpg" } | null, c: SignatureCertificate): Promise<Buffer> {
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
      <Text style={s.h1}>Electronic Signature Certificate</Text>
      <Text style={s.muted}>{T(`${doc.brand.companyName} · ${doc.meta.title} · Proposal #${doc.meta.number} · Version ${c.versionNumber}`)}</Text>

      <Text style={s.h2}>Signature</Text>
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

      <Text style={s.h2}>Document integrity</Text>
      <KV k="Proposal PDF SHA-256" v={c.documentHash} mono />
      <KV k="Proposal content SHA-256" v={c.contentHash} mono />
      <KV k="Signing link issued" v={utc(c.linkCreatedAt)} />
      <KV k="Signature record ID" v={c.signatureId} mono />
      <KV k="Signing request ID" v={c.requestId} mono />
      {c.ipAddress ? <KV k="IP address" v={c.ipAddress} /> : null}
      {c.userAgent ? <KV k="Browser" v={c.userAgent.slice(0, 200)} /> : null}
      <Text style={[s.muted, { marginTop: 14, fontSize: 8 }]}>
        {T(`The proposal pages in this file are the version the signer reviewed (its PDF hash is listed above). Signed ${date}. A record of this signature is kept by ${doc.brand.companyName} through Built2Bid.`)}
      </Text>
    </Page>
  );
  return renderToBuffer(
    <ProposalPdf doc={doc} logo={logo} appendix={appendix}
      acceptance={{ name: c.signerName, date, image: c.method === "drawn" ? c.signatureImage : null, typed: c.method === "typed" ? c.signatureText : null }} />,
  );
}
