import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InternalReport } from "../reports/internal-estimate";
import { pdfSafe } from "./proposal-pdf";

const T = (s?: string | null) => pdfSafe(s);
const $ = (s: string) => {
  const n = Number(s);
  const neg = n < 0;
  return `${neg ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const P = (s: string | null) => (s === null ? "-" : `${s}%`);

const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#dde5ee", RED = "#b91c1c", TINT = "#f5f8fb";

/** Internal Estimate Report PDF: confidential contractor document (costs, markup, margin, profit). */
export function InternalReportPdf({ r, company, logo }: { r: InternalReport; company: { name: string; phone?: string; email?: string }; logo?: { data: Buffer; format: "png" | "jpg" } | null }) {
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 8.5, color: INK, paddingTop: 30, paddingBottom: 44, paddingHorizontal: 32 },
    banner: { backgroundColor: RED, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 12, textAlign: "center", letterSpacing: 0.5 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 10, marginBottom: 12 },
    h1: { fontFamily: "Helvetica-Bold", fontSize: 16, color: NAVY },
    h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY, marginTop: 12, marginBottom: 4 },
    muted: { color: MUTED },
    kpis: { flexDirection: "row", gap: 6, marginBottom: 4 },
    kpi: { flex: 1, backgroundColor: TINT, borderRadius: 4, padding: 7 },
    kpiLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase" },
    kpiVal: { fontFamily: "Helvetica-Bold", fontSize: 12, color: NAVY, marginTop: 2 },
    th: { flexDirection: "row", backgroundColor: NAVY, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 7, paddingVertical: 3, paddingHorizontal: 3 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 2.5, paddingHorizontal: 3 },
    sub: { flexDirection: "row", backgroundColor: TINT, fontFamily: "Helvetica-Bold", paddingVertical: 3, paddingHorizontal: 3 },
    footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5 },
  });
  // Column widths: item, type, qty, unit cost, ext cost, unit price, ext price, profit, markup, margin
  const W = ["24%", "11%", "9%", "8%", "9%", "8%", "9%", "8%", "7%", "7%"];
  const R = { textAlign: "right" as const };
  const cells = (vals: string[], bold = false) => vals.map((v, i) => <Text key={i} style={{ width: W[i], ...(i >= 2 ? R : {}), ...(bold ? { fontFamily: "Helvetica-Bold" } : {}) }}>{T(v)}</Text>);
  const t = r.totals;
  return (
    <Document title={T(`INTERNAL cost report - ${r.title} - ${r.number}`)} author={T(company.name)} creator={T(company.name)} producer="Built2Bid internal report">
      <Page size="LETTER" orientation="landscape" style={s.page} wrap>
        <Text style={s.banner} fixed>INTERNAL - CONFIDENTIAL. CONTAINS COSTS, MARKUP, MARGIN AND PROFIT. DO NOT SEND TO THE CUSTOMER.</Text>
        <View style={s.head}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {logo && <Image src={{ data: logo.data, format: logo.format }} style={{ maxHeight: 38, maxWidth: 110, objectFit: "contain" }} />}
            <View>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{T(company.name || "Your company")}</Text>
              <Text style={s.muted}>{T([company.phone, company.email].filter(Boolean).join("  |  "))}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>Internal Estimate Report</Text>
            <Text style={s.muted}>{T(r.title)}  |  #{T(r.number)}</Text>
            <Text style={s.muted}>{T(r.customer || "No customer")}{r.projectAddress ? `  |  ${T(r.projectAddress)}` : ""}</Text>
            <Text style={s.muted}>
              Estimate date {T(r.estimateDate)}  |  {r.version ? `Latest finalized v${r.version.number} (${r.version.createdAt.slice(0, 10)})` : "Not finalized yet"}  |  Generated {r.generatedAt.slice(0, 10)} from the saved estimate
            </Text>
          </View>
        </View>

        <View style={s.kpis}>
          {[["Direct cost", $(t.directCost)], ["Selling price (pre-tax)", $(t.sellingPrice)], ["Gross profit", $(t.grossProfit)], ["Gross margin", P(t.marginPct)], ["Markup on cost", P(t.markupPct)], ["Customer total", $(t.customerTotal)]].map(([l, v]) => (
            <View key={l} style={s.kpi}><Text style={s.kpiLabel}>{l}</Text><Text style={s.kpiVal}>{v}</Text></View>
          ))}
        </View>
        <Text style={[s.muted, { fontSize: 7 }]}>Default pricing: {T(r.pricingRule)}. Markup = profit / cost. Gross margin = profit / selling price.</Text>

        <Text style={s.h2}>Line items by section</Text>
        <View style={s.th} fixed>{cells(["Item", "Cost type", "Qty", "Unit cost", "Ext. cost", "Unit price", "Ext. price", "Profit", "Markup", "Margin"])}</View>
        {r.sections.map((sec, si) => (
          <View key={si} wrap>
            <View style={[s.tr, { backgroundColor: "#eef3f8" }]} minPresenceAhead={30}><Text style={{ fontFamily: "Helvetica-Bold", color: NAVY }}>{T(sec.name)}</Text></View>
            {sec.lines.length === 0 && <View style={s.tr}><Text style={s.muted}>No line items</Text></View>}
            {sec.lines.map((l, li) => (
              <View key={li} style={s.tr} wrap={false}>
                {cells([l.name + (l.passThrough ? " (at cost)" : ""), l.costTypeLabel, `${l.quantity} ${l.unit}`.trim(), $(l.unitCost), $(l.extendedCost), $(l.unitPrice), $(l.extendedPrice), $(l.grossProfit), P(l.markupPct), P(l.marginPct)])}
              </View>
            ))}
            <View style={s.sub} wrap={false}>{cells([`${sec.name} subtotal`, "", "", "", $(sec.cost), "", $(sec.price), $(sec.grossProfit), P(sec.markupPct), P(sec.marginPct)], true)}</View>
          </View>
        ))}

        <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }} wrap={false}>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Direct cost by type</Text>
            {r.costBreakdown.map((c) => (
              <View key={c.costType} style={s.tr}><Text style={{ width: "55%" }}>{T(c.label)}</Text><Text style={{ width: "25%", ...R }}>{$(c.cost)}</Text><Text style={{ width: "20%", ...R }}>{c.share}%</Text></View>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Project totals</Text>
            {([
              ["Total estimated direct cost", $(t.directCost)],
              ["Line items at selling price", $(t.itemsPrice)],
              ...(Number(t.adjustment) !== 0 ? [[t.adjustmentLabel || "Project adjustment", $(t.adjustment)]] : []),
              ["Selling price (before tax)", $(t.sellingPrice)],
              ["Estimated gross profit", $(t.grossProfit)],
              ["Estimated gross margin", P(t.marginPct)],
              ["Effective markup on cost", P(t.markupPct)],
              [`Sales tax (${t.taxRate}%)`, $(t.tax)],
              ...(Number(t.rounding) !== 0 ? [["Rounding", $(t.rounding)]] : []),
              ["Customer total", $(t.customerTotal)],
            ] as [string, string][]).map(([l, v], i, a) => (
              <View key={l} style={[s.tr, i === a.length - 1 ? { fontFamily: "Helvetica-Bold" } : {}]}><Text style={{ width: "65%" }}>{T(l)}</Text><Text style={{ width: "35%", ...R }}>{v}</Text></View>
            ))}
          </View>
        </View>
        {(r.notes.length > 0 || r.issues.length > 0) && (
          <View style={{ marginTop: 8 }} wrap={false}>
            {r.notes.map((n, i) => <Text key={i} style={s.muted}>- {T(n)}</Text>)}
            {r.issues.map((n, i) => <Text key={`i${i}`} style={{ color: RED }}>- Check: {T(n)}</Text>)}
          </View>
        )}
        <Text style={[s.muted, { fontSize: 6.5, marginTop: 8 }]}>
          Calculations match the Built2Bid estimator: extended cost = qty x unit cost; unit price = unit cost x pricing factor, rounded to the cent; extended price = qty x unit price.
          Money is rounded half up to the cent; percentages to 0.1%. Only cost components entered on this estimate are shown.
        </Text>
        <View style={s.footer} fixed>
          <Text>Internal use only  |  {T(company.name)}  |  #{T(r.number)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
