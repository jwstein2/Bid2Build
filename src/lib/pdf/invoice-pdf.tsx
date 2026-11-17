import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCurrency } from "../estimate/money";
import { pdfSafe } from "./proposal-pdf";

/**
 * Customer invoice PDF. Built only from the issued invoice (frozen bill-to, lines, totals) and its applied
 * payments / credits. It never receives costs, margin, supplier prices, sub quotes or internal notes, so
 * it can't show them.
 */
export interface InvoicePdfData {
  company: { name: string; phone?: string; email?: string; address?: string; website?: string; license?: string; color?: string };
  invoice: { number: string; issueDate: string; dueDate: string; kind: string; memo?: string | null; status: "issued" | "void" };
  project: { name: string; jobNumber: string; address?: string | null };
  billTo: { name?: string; email?: string; phone?: string; address?: string };
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  subtotal: string; tax: string; taxRate: string; total: string;
  paid: string; credited: string; balance: string;
  payments: { date: string; method: string; amount: string }[];
  contract?: { current: string; invoicedToDate: string; paidToDate: string } | null;
  /** Practice sandbox: every page carries a watermark. */
  sandbox?: boolean;
}

const T = (s?: string | null) => pdfSafe(s);
const $ = (v: string) => formatCurrency(v || "0");
const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#dde5ee", TINT = "#f5f8fb";
const day = (d: string) => {
  if (!d) return "";
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const KIND: Record<string, string> = { deposit: "Deposit invoice", milestone: "Progress payment", progress: "Progress payment", final: "Final invoice", custom: "Invoice" };
const METHOD: Record<string, string> = { check: "Check", cash: "Cash", ach: "Bank transfer", card: "Card", wire: "Wire", other: "Payment" };

export function InvoicePdf({ d, logo }: { d: InvoicePdfData; logo?: { data: Buffer; format: "png" | "jpg" } | null }) {
  const brand = d.company.color || NAVY;
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 9.5, color: INK, paddingTop: 32, paddingBottom: 54, paddingHorizontal: 36 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: brand, paddingBottom: 10, marginBottom: 14 },
    h1: { fontFamily: "Helvetica-Bold", fontSize: 20, color: NAVY },
    muted: { color: MUTED },
    label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
    bold: { fontFamily: "Helvetica-Bold" },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5 },
    th: { flexDirection: "row", backgroundColor: TINT, paddingVertical: 5, fontFamily: "Helvetica-Bold", fontSize: 8, color: MUTED },
    totals: { marginTop: 8, marginLeft: "auto", width: 230 },
    trow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
    due: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, padding: 8, backgroundColor: brand, color: "#ffffff", borderRadius: 4 },
    box: { backgroundColor: TINT, borderRadius: 4, padding: 8, marginTop: 12 },
    footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6 },
  });
  const void_ = d.invoice.status === "void";
  return (
    <Document title={T(`Invoice ${d.invoice.number} - ${d.project.name}`)} author={T(d.company.name)} creator={T(d.company.name)} producer="Built2Bid">
      <Page size="LETTER" style={s.page} wrap>
        {d.sandbox && <View fixed style={{ backgroundColor: "#fff4d6", borderWidth: 1, borderColor: "#b7791f", borderStyle: "dashed", borderRadius: 4, padding: 6, marginBottom: 10 }}><Text style={{ fontFamily: "Helvetica-Bold", color: "#7a4a00", textAlign: "center" }}>SANDBOX  |  Practice only. This is not a real invoice and nothing is owed.</Text></View>}
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
            <Text style={s.h1}>{void_ ? "VOID" : "INVOICE"}</Text>
            <Text style={s.bold}>{T(d.invoice.number)}</Text>
            <Text style={s.muted}>{T(KIND[d.invoice.kind] ?? "Invoice")}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 16, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{T(d.billTo.name || "Customer")}</Text>
            {d.billTo.address && <Text>{T(d.billTo.address)}</Text>}
            {d.billTo.email && <Text style={s.muted}>{T(d.billTo.email)}</Text>}
            {d.billTo.phone && <Text style={s.muted}>{T(d.billTo.phone)}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Project</Text>
            <Text style={s.bold}>{T(d.project.name)}</Text>
            {d.project.address && <Text>{T(d.project.address)}</Text>}
            <Text style={s.muted}>Job {T(d.project.jobNumber)}</Text>
          </View>
          <View style={{ width: 150 }}>
            <Text style={s.label}>Invoice date</Text><Text>{day(d.invoice.issueDate)}</Text>
            <Text style={[s.label, { marginTop: 6 }]}>Due date</Text><Text style={s.bold}>{day(d.invoice.dueDate)}</Text>
          </View>
        </View>

        <View style={s.th}>
          <Text style={{ flex: 1, paddingLeft: 6 }}>Description</Text>
          <Text style={{ width: 50, textAlign: "right" }}>Qty</Text>
          <Text style={{ width: 80, textAlign: "right" }}>Rate</Text>
          <Text style={{ width: 85, textAlign: "right", paddingRight: 6 }}>Amount</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ flex: 1, paddingLeft: 6 }}>{T(l.description)}</Text>
            <Text style={{ width: 50, textAlign: "right" }}>{Number(l.quantity).toString()}</Text>
            <Text style={{ width: 80, textAlign: "right" }}>{$(l.unitPrice)}</Text>
            <Text style={{ width: 85, textAlign: "right", paddingRight: 6 }}>{$(l.amount)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.trow}><Text style={s.muted}>Subtotal</Text><Text>{$(d.subtotal)}</Text></View>
          {Number(d.tax) !== 0 && <View style={s.trow}><Text style={s.muted}>Tax ({Number(d.taxRate).toString()}%)</Text><Text>{$(d.tax)}</Text></View>}
          <View style={[s.trow, { borderTopWidth: 0.75, borderTopColor: LINE, marginTop: 2, paddingTop: 4 }]}><Text style={s.bold}>Invoice total</Text><Text style={s.bold}>{$(d.total)}</Text></View>
          {Number(d.paid) !== 0 && <View style={s.trow}><Text style={s.muted}>Payments received</Text><Text>-{$(d.paid)}</Text></View>}
          {Number(d.credited) !== 0 && <View style={s.trow}><Text style={s.muted}>Credits</Text><Text>-{$(d.credited)}</Text></View>}
          {!void_ && <View style={s.due}><Text style={s.bold}>Amount due</Text><Text style={s.bold}>{$(d.balance)}</Text></View>}
        </View>

        {d.payments.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={s.label}>Payments applied to this invoice</Text>
            {d.payments.map((p, i) => <Text key={i}>{day(p.date)}  |  {METHOD[p.method] ?? "Payment"}  |  {$(p.amount)}</Text>)}
          </View>
        )}

        {d.contract && (
          <View style={s.box} wrap={false}>
            <Text style={s.label}>Project account</Text>
            <View style={s.trow}><Text style={s.muted}>Current contract total (incl. approved change orders)</Text><Text>{$(d.contract.current)}</Text></View>
            <View style={s.trow}><Text style={s.muted}>Invoiced to date</Text><Text>{$(d.contract.invoicedToDate)}</Text></View>
            <View style={s.trow}><Text style={s.muted}>Paid to date</Text><Text>{$(d.contract.paidToDate)}</Text></View>
          </View>
        )}

        <View style={s.box} wrap={false}>
          <Text style={s.label}>How to pay</Text>
          <Text>Make payment to {T(d.company.name)} and include invoice number {T(d.invoice.number)} with your payment.</Text>
          {(d.company.phone || d.company.email) && <Text style={s.muted}>Questions about this invoice: {T([d.company.phone, d.company.email].filter(Boolean).join(" or "))}</Text>}
        </View>

        {d.invoice.memo && <View style={{ marginTop: 10 }}><Text style={s.label}>Notes</Text><Text>{T(d.invoice.memo)}</Text></View>}

        <View style={s.footer} fixed>
          <Text>{T(d.company.name)}  |  Invoice {T(d.invoice.number)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
