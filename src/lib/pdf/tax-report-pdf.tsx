import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Sheet } from "../payouts/tax-season";
import { pdfSafe } from "./proposal-pdf";

/**
 * Tax season report PDF (V8.4): a cover with the year's checklist, then one table per sheet. Same rows as the CSV
 * downloads. Recipient TINs appear only as last 4. Landscape so wide ledgers fit.
 */
const T = (v?: string | null) => pdfSafe(v ?? "");
const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#dde5ee", TINT = "#f5f8fb";
const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 7.5, color: INK, paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30 },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 16, color: NAVY },
  sub: { color: MUTED, marginTop: 2, marginBottom: 10, fontSize: 9 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY, marginTop: 12, marginBottom: 4 },
  th: { flexDirection: "row", backgroundColor: NAVY, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 6.8, paddingVertical: 3, paddingHorizontal: 2 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 2.5, paddingHorizontal: 2 },
  note: { color: MUTED, fontSize: 7, marginTop: 4, lineHeight: 1.35 },
  li: { fontSize: 9, marginBottom: 3 },
  box: { backgroundColor: TINT, padding: 8, borderRadius: 4, marginTop: 6 },
  footer: { position: "absolute", bottom: 16, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 6.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4 },
});

function SheetTable({ sh }: { sh: Sheet }) {
  const w = `${(100 / Math.max(sh.head.length, 1)).toFixed(3)}%`;
  return (
    <View wrap>
      <Text style={s.h2} minPresenceAhead={40}>{T(sh.title)}</Text>
      <View style={s.th} fixed={false}>{sh.head.map((h, i) => <Text key={i} style={{ width: w, paddingRight: 2 }}>{T(h)}</Text>)}</View>
      {sh.rows.length === 0 ? <Text style={[s.tr, { color: MUTED }]}>Nothing for this year.</Text> : sh.rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>{r.map((c, j) => <Text key={j} style={{ width: w, paddingRight: 2 }}>{T(c)}</Text>)}</View>
      ))}
      {sh.note ? <Text style={s.note}>{T(sh.note)}</Text> : null}
    </View>
  );
}

export function TaxReportPdf({ title, subtitle, payer, checklist, deadlines, sheets }: {
  title: string; subtitle: string; payer: string; checklist?: string[]; deadlines?: { what: string; due: string; applies: boolean }[]; sheets: Sheet[];
}) {
  return (
    <Document title={T(title)} author={T(payer)} producer="Built2Bid tax season">
      <Page size="LETTER" orientation="landscape" style={s.page} wrap>
        <Text style={s.h1}>{T(title)}</Text>
        <Text style={s.sub}>{T(subtitle)}</Text>
        {checklist && (
          <View style={s.box}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9.5, color: NAVY, marginBottom: 4 }}>{checklist.length ? "Still to do" : "Nothing outstanding"}</Text>
            {checklist.map((c, i) => <Text key={i} style={s.li}>• {T(c)}</Text>)}
          </View>
        )}
        {deadlines && deadlines.some((d) => d.applies) && (
          <View style={s.box}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9.5, color: NAVY, marginBottom: 4 }}>Federal deadlines (standard dates; confirm with your CPA)</Text>
            {deadlines.filter((d) => d.applies).map((d, i) => <Text key={i} style={s.li}>• {T(d.what)}: {T(d.due)}</Text>)}
          </View>
        )}
        {sheets.map((sh, i) => <SheetTable key={i} sh={sh} />)}
        <Text style={s.note}>Prepared from Built2Bid&apos;s payout records. Not tax advice: state rules marked unverified, thresholds and deadlines must be confirmed by a CPA. W-2 wages are not included; they go through a payroll provider.</Text>
        <View style={s.footer} fixed>
          <Text>{T(payer)} · {T(title)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
