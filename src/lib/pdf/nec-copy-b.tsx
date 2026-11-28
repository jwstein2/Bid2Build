import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCurrency } from "../estimate/money";
import { pdfSafe } from "./proposal-pdf";

/**
 * Recipient statements for Form 1099-NEC (Copy B), one page per subcontractor. The recipient's TIN is
 * truncated to the last 4 digits, which the IRS allows on recipient copies. Copy A (the IRS copy) is never
 * printed here: it's filed electronically from the e-file export or through a filing service.
 */
export interface NecCopyB {
  year: number;
  payer: { legalName: string; ein: string; address: string | null; phone: string | null };
  recipient: { name: string; businessName: string | null; tinType: "ssn" | "ein" | null; tinLast4: string | null; address: string | null; amount: string; account: string;
    /** Optional (Built2Bid payouts): box 4 and boxes 5-7. Omitted = $0 withheld, no state line. */
    federalWithheld?: string; state?: { code: string; payerStateNo: string | null; withheld: string; income: string } | null };
}

const T = (v?: string | null) => pdfSafe(v ?? "");
const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#8a99a8";
const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: INK, padding: 36 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 16, color: NAVY },
  sub: { color: MUTED, marginTop: 2, marginBottom: 12 },
  grid: { flexDirection: "row", borderWidth: 1, borderColor: LINE },
  col: { flex: 1, borderRightWidth: 1, borderRightColor: LINE },
  box: { borderBottomWidth: 1, borderBottomColor: LINE, padding: 6, minHeight: 40 },
  label: { fontSize: 7, color: MUTED, marginBottom: 3 },
  value: { fontSize: 10 },
  big: { fontFamily: "Helvetica-Bold", fontSize: 14 },
  note: { color: MUTED, fontSize: 8, marginTop: 12, lineHeight: 1.4 },
});

const masked = (t: "ssn" | "ein" | null, last4: string | null) => (last4 ? (t === "ein" ? `**-***${last4}` : `***-**-${last4}`) : "Not on file");

function CopyBPage({ d }: { d: NecCopyB }) {
  const r = d.recipient;
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.title}>Form 1099-NEC  ·  {d.year}</Text>
      <Text style={s.sub}>Nonemployee Compensation  ·  Copy B, for Recipient  ·  Substitute statement</Text>
      <View style={s.grid}>
        <View style={s.col}>
          <View style={[s.box, { minHeight: 90 }]}><Text style={s.label}>PAYER&apos;S name, street address, city, state, ZIP and telephone</Text>
            <Text style={s.value}>{T(d.payer.legalName)}</Text>{d.payer.address ? <Text style={s.value}>{T(d.payer.address)}</Text> : null}{d.payer.phone ? <Text style={s.value}>{T(d.payer.phone)}</Text> : null}</View>
          <View style={{ flexDirection: "row" }}>
            <View style={[s.box, { flex: 1, borderRightWidth: 1, borderRightColor: LINE }]}><Text style={s.label}>PAYER&apos;S TIN</Text><Text style={s.value}>{T(d.payer.ein)}</Text></View>
            <View style={[s.box, { flex: 1 }]}><Text style={s.label}>RECIPIENT&apos;S TIN</Text><Text style={s.value}>{masked(r.tinType, r.tinLast4)}</Text></View>
          </View>
          <View style={s.box}><Text style={s.label}>RECIPIENT&apos;S name</Text><Text style={s.value}>{T(r.name)}</Text>{r.businessName ? <Text style={s.value}>{T(r.businessName)}</Text> : null}</View>
          <View style={[s.box, { minHeight: 52 }]}><Text style={s.label}>Street address, city or town, state or province, country and ZIP</Text><Text style={s.value}>{T(r.address) || " "}</Text></View>
          <View style={[s.box, { borderBottomWidth: 0 }]}><Text style={s.label}>Account number</Text><Text style={s.value}>{T(r.account)}</Text></View>
        </View>
        <View style={[s.col, { borderRightWidth: 0 }]}>
          <View style={[s.box, { minHeight: 70 }]}><Text style={s.label}>1  Nonemployee compensation</Text><Text style={s.big}>{formatCurrency(r.amount)}</Text></View>
          <View style={s.box}><Text style={s.label}>2  Payer made direct sales totaling $5,000 or more of consumer products to recipient for resale</Text><Text style={s.value}> </Text></View>
          <View style={s.box}><Text style={s.label}>3  Excess golden parachute payments</Text><Text style={s.value}> </Text></View>
          <View style={s.box}><Text style={s.label}>4  Federal income tax withheld</Text><Text style={s.value}>{formatCurrency(r.federalWithheld ?? "0")}</Text></View>
          <View style={[s.box, { borderBottomWidth: 0 }]}><Text style={s.label}>5  State tax withheld  ·  6  State/Payer&apos;s state no.  ·  7  State income</Text><Text style={s.value}>{r.state ? T(`${formatCurrency(r.state.withheld)}  ·  ${r.state.code}${r.state.payerStateNo ? ` ${r.state.payerStateNo}` : ""}  ·  ${formatCurrency(r.state.income)}`) : " "}</Text></View>
        </View>
      </View>
      <Text style={s.note}>This is important tax information and is being furnished to the IRS. If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it has not been reported.</Text>
      <Text style={s.note}>Instructions for Recipient: You received this form instead of Form W-2 because the payer did not consider you an employee and did not withhold income tax or social security and Medicare tax. Report this amount on Schedule C or Schedule F (Form 1040) if you are self-employed. If you believe you are an employee, contact the payer. For your protection, this form may show only the last four digits of your TIN.</Text>
      {Number(r.federalWithheld ?? 0) > 0 ? <Text style={s.note}>Box 4. Shows backup withholding. A payer must backup withhold on certain payments if you did not give your TIN to the payer, or the IRS notified the payer that the TIN was incorrect. Include this amount on your income tax return as tax withheld.</Text> : null}
    </Page>
  );
}

export function NecCopyBPdf({ forms }: { forms: NecCopyB[] }) {
  return <Document title={`1099-NEC Copy B ${forms[0]?.year ?? ""}`} author={T(forms[0]?.payer.legalName)}>{forms.map((d, i) => <CopyBPage key={i} d={d} />)}</Document>;
}
