import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCurrency } from "../estimate/money";
import { pdfSafe } from "./proposal-pdf";

/**
 * Payment receipt PDF (V6 §12). Two kinds, one layout:
 *   - customer: money the contractor RECEIVED from a customer (fin_payments), applied to invoices.
 *   - vendor:   money the contractor PAID a sub or supplier (fin_bill_payments) against their bill.
 * Built only from a recorded, non-void payment. It never receives costs, margins or other jobs, and
 * it is a record of the payment as entered: it doesn't claim the funds cleared the bank.
 */
export interface ReceiptPdfData {
  kind: "customer" | "vendor";
  company: { name: string; phone?: string; email?: string; address?: string; website?: string; license?: string; color?: string };
  receipt: { number: string; date: string; method: string; reference?: string | null; amount: string; memo?: string | null };
  /** Customer (who paid) or sub/supplier (who was paid). */
  party: { name: string; email?: string; phone?: string; address?: string };
  project?: { name: string; jobNumber?: string; address?: string | null } | null;
  appliedTo: { label: string; amount: string; balanceNow?: string | null }[];
  unapplied?: string | null;
  /** Practice sandbox: the receipt carries a watermark. */
  sandbox?: boolean;
}

const T = (v?: string | null) => pdfSafe(v);
const $ = (v: string) => formatCurrency(v || "0");
const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#dde5ee", TINT = "#f5f8fb";
export const receiptDay = (d: string) => {
  if (!d) return "";
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
export const RECEIPT_METHOD: Record<string, string> = { check: "Check", cash: "Cash", ach: "Bank transfer (ACH)", card: "Card", wire: "Wire transfer", other: "Other" };

export function ReceiptPdf({ d, logo }: { d: ReceiptPdfData; logo?: { data: Buffer; format: "png" | "jpg" } | null }) {
  const brand = d.company.color || NAVY;
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 10, color: INK, paddingTop: 32, paddingBottom: 54, paddingHorizontal: 36 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: brand, paddingBottom: 10, marginBottom: 16 },
    h1: { fontFamily: "Helvetica-Bold", fontSize: 20, color: NAVY },
    muted: { color: MUTED },
    label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
    bold: { fontFamily: "Helvetica-Bold" },
    amount: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: brand, color: "#ffffff", borderRadius: 4, marginTop: 6 },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5 },
    th: { flexDirection: "row", backgroundColor: TINT, paddingVertical: 5, fontFamily: "Helvetica-Bold", fontSize: 8, color: MUTED },
    box: { backgroundColor: TINT, borderRadius: 4, padding: 8, marginTop: 14 },
    footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6 },
  });
  const customer = d.kind === "customer";
  const title = customer ? "Payment receipt" : "Payment to subcontractor / supplier";
  return (
    <Document title={T(`${title} ${d.receipt.number}`)} author={T(d.company.name)} creator={T(d.company.name)} producer="Built2Bid">
      <Page size="LETTER" style={s.page}>
        {d.sandbox && <View fixed style={{ backgroundColor: "#fff4d6", borderWidth: 1, borderColor: "#b7791f", borderStyle: "dashed", borderRadius: 4, padding: 6, marginBottom: 10 }}><Text style={{ fontFamily: "Helvetica-Bold", color: "#7a4a00", textAlign: "center" }}>SANDBOX  |  Practice only. This is not a real receipt.</Text></View>}
        <View style={s.head}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", maxWidth: "55%" }}>
            {logo && <Image src={{ data: logo.data, format: logo.format }} style={{ maxHeight: 44, maxWidth: 130, objectFit: "contain" }} />}
            <View>
              <Text style={[s.bold, { fontSize: 12 }]}>{T(d.company.name)}</Text>
              {d.company.address && <Text style={s.muted}>{T(d.company.address)}</Text>}
              <Text style={s.muted}>{T([d.company.phone, d.company.email].filter(Boolean).join("  |  "))}</Text>
              {d.company.license && <Text style={s.muted}>License {T(d.company.license)}</Text>}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{customer ? "RECEIPT" : "PAYMENT RECORD"}</Text>
            <Text style={s.bold}>{T(d.receipt.number)}</Text>
            <Text style={s.muted}>{receiptDay(d.receipt.date)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{customer ? "Received from" : "Paid to"}</Text>
            <Text style={s.bold}>{T(d.party.name)}</Text>
            {d.party.address && <Text>{T(d.party.address)}</Text>}
            {(d.party.email || d.party.phone) && <Text style={s.muted}>{T([d.party.phone, d.party.email].filter(Boolean).join("  |  "))}</Text>}
          </View>
          {d.project && (
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Project</Text>
              <Text style={s.bold}>{T(d.project.name)}</Text>
              {d.project.jobNumber && <Text style={s.muted}>{T(d.project.jobNumber)}</Text>}
              {d.project.address && <Text>{T(d.project.address)}</Text>}
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Payment method</Text>
            <Text>{RECEIPT_METHOD[d.receipt.method] ?? "Payment"}{d.receipt.reference ? ` #${T(d.receipt.reference)}` : ""}</Text>
          </View>
        </View>

        <View style={s.amount}><Text style={s.bold}>{customer ? "Amount received" : "Amount paid"}</Text><Text style={s.bold}>{$(d.receipt.amount)}</Text></View>

        {d.appliedTo.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <View style={s.th}>
              <Text style={{ flex: 1, paddingLeft: 6 }}>Applied to</Text>
              <Text style={{ width: 100, textAlign: "right" }}>Amount</Text>
              <Text style={{ width: 110, textAlign: "right", paddingRight: 6 }}>Balance now</Text>
            </View>
            {d.appliedTo.map((a, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={{ flex: 1, paddingLeft: 6 }}>{T(a.label)}</Text>
                <Text style={{ width: 100, textAlign: "right" }}>{$(a.amount)}</Text>
                <Text style={{ width: 110, textAlign: "right", paddingRight: 6 }}>{a.balanceNow === null || a.balanceNow === undefined ? "" : $(a.balanceNow)}</Text>
              </View>
            ))}
          </View>
        )}
        {d.unapplied && Number(d.unapplied) > 0 && (
          <Text style={{ marginTop: 6 }}>{$(d.unapplied)} of this payment is not yet applied to an invoice and is held as a credit on your account.</Text>
        )}

        {d.receipt.memo && <View style={{ marginTop: 10 }}><Text style={s.label}>Notes</Text><Text>{T(d.receipt.memo)}</Text></View>}

        <View style={s.box} wrap={false}>
          <Text style={s.muted}>
            {customer
              ? `Thank you. This receipt confirms we recorded your payment on the date shown.${d.receipt.method === "check" ? " Check payments are subject to collection by the bank." : ""}`
              : `${d.company.name} recorded this payment to ${d.party.name} on the date shown, against the bill listed above.`}
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text>{T(d.company.name)}  |  {customer ? "Receipt" : "Payment record"} {T(d.receipt.number)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
