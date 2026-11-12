import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProposalDocument, ProposalSection } from "../proposal/types";
import { onColor, templateStyle } from "../proposal/templates";

/**
 * PDF rendering of the canonical ProposalDocument (the same object the HTML preview renders).
 * Uses the built-in Helvetica family, so text is sanitized to the WinAnsi character set.
 */
export function pdfSafe(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-‒]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    // Keep Latin-1 plus the WinAnsi extras (– — • € ™ etc.); drop anything else (emoji, CJK).
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF–—•€™ŒœŠšŸŽžƒˆ˜†‡‰‹›]/g, "");
}

const T = (s?: string | null) => pdfSafe(s);

export function ProposalPdf({ doc, logo }: { doc: ProposalDocument; logo?: { data: Buffer; format: "png" | "jpg" } | null }) {
  const st = templateStyle(doc.template);
  const brand = doc.brand.primaryColor;
  const accent = doc.brand.secondaryColor;
  const fs = st.baseSize;
  const headerBg = st.header === "dark" ? "#16202e" : st.header === "band" ? brand : "#ffffff";
  const headerFg = st.header === "dark" || st.header === "band" ? onColor(headerBg) : "#16202e";
  const pad = st.compact ? 34 : 44;

  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: fs, color: "#16202e", paddingBottom: 46, paddingTop: 0 },
    header: { backgroundColor: headerBg, color: headerFg, paddingHorizontal: pad, paddingVertical: st.compact ? 14 : 20, borderBottomWidth: st.header === "rule" ? 3 : st.header === "split" ? 1 : 0, borderBottomColor: st.header === "rule" ? accent : "#e4e0d8" },
    body: { paddingHorizontal: pad, paddingTop: st.compact ? 12 : 18 },
    h2: { fontFamily: "Helvetica-Bold", fontSize: fs * 1.25, color: brand, marginBottom: 4 },
    muted: { color: "#6b7686" },
    small: { fontSize: fs * 0.85 },
    row: { flexDirection: "row" },
    footer: { position: "absolute", bottom: 18, left: pad, right: pad, flexDirection: "row", justifyContent: "space-between", fontSize: fs * 0.8, color: "#6b7686", borderTopWidth: 0.5, borderTopColor: "#e4e0d8", paddingTop: 6 },
  });

  const centered = doc.brand.logoLayout === "center";
  const stacked = doc.brand.logoLayout !== "left";

  return (
    <Document title={T(`${doc.meta.title} - ${doc.meta.number}`)} author={T(doc.brand.companyName)} creator={T(doc.brand.companyName)} producer="Proposal generator">
      <Page size="LETTER" style={s.page} wrap>
        {/* Header (first page) */}
        <View style={s.header}>
          <View style={{ flexDirection: stacked ? "column" : "row", justifyContent: "space-between", alignItems: centered ? "center" : stacked ? "flex-start" : "center", gap: 10 }}>
            <View style={{ flexDirection: stacked ? "column" : "row", alignItems: centered ? "center" : stacked ? "flex-start" : "center", gap: 10 }}>
              {logo && (
                <View style={headerBg !== "#ffffff" ? { backgroundColor: "#ffffff", padding: 4, borderRadius: 3 } : {}}>
                  <Image src={{ data: logo.data, format: logo.format }} style={{ maxHeight: st.compact ? 40 : 52, maxWidth: 150, objectFit: "contain" }} />
                </View>
              )}
              <View style={{ alignItems: centered ? "center" : "flex-start" }}>
                <Text style={{ fontFamily: "Helvetica-Bold", fontSize: st.titleSize * 0.75 }}>{T(doc.brand.companyName)}</Text>
                {doc.brand.tagline ? <Text style={{ opacity: 0.85 }}>{T(doc.brand.tagline)}</Text> : null}
              </View>
            </View>
            {doc.brand.contact.length > 0 && (
              <View style={{ alignItems: centered ? "center" : stacked ? "flex-start" : "flex-end" }}>
                {doc.brand.contact.map((c) => <Text key={c.label} style={{ fontSize: fs * 0.88, opacity: 0.92 }}>{T(c.value)}</Text>)}
              </View>
            )}
          </View>
        </View>
        {st.header === "dark" && <View style={{ height: 4, backgroundColor: accent }} />}

        <View style={s.body}>
          {/* Title block */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 0.75, borderBottomColor: "#e4e0d8", paddingBottom: 8 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: "Helvetica-Bold", color: accent, fontSize: fs * 0.82, letterSpacing: 1 }}>PROPOSAL</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: st.titleSize, color: brand }}>{T(doc.meta.title)}</Text>
            </View>
            <View style={{ fontSize: fs * 0.9 }}>
              <KV k="Proposal #" v={doc.meta.number} />
              <KV k="Date" v={doc.meta.date} />
              {doc.meta.expires ? <KV k="Valid until" v={doc.meta.expires} /> : null}
            </View>
          </View>

          <View style={{ flexDirection: "row", marginTop: st.compact ? 8 : 12, gap: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.muted, { fontSize: fs * 0.75, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 }]}>PREPARED FOR</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{T(doc.customer.name)}</Text>
              {doc.customer.email ? <Text>{T(doc.customer.email)}</Text> : null}
              {doc.customer.phone ? <Text>{T(doc.customer.phone)}</Text> : null}
            </View>
            {doc.customer.projectAddress ? (
              <View style={{ flex: 1 }}>
                <Text style={[s.muted, { fontSize: fs * 0.75, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 }]}>PROJECT LOCATION</Text>
                <Text>{T(doc.customer.projectAddress)}</Text>
              </View>
            ) : null}
          </View>

          {doc.introduction ? <Prose body={doc.introduction} gap={st.sectionGap} /> : null}
          {doc.scopeOfWork ? <Prose title="Scope of Work" body={doc.scopeOfWork} gap={st.sectionGap} color={brand} fs={fs} /> : null}

          {/* Pricing */}
          <View style={{ marginTop: st.sectionGap * 1.4 }}>
            <Text style={s.h2} minPresenceAhead={60}>Pricing</Text>
            {doc.pricing.displayMode === "project_total" ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: "#e4e0d8", paddingVertical: 5 }} wrap={false}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{T(doc.pricing.projectLabel)}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{T(doc.pricing.subtotal)}</Text>
              </View>
            ) : (
              doc.pricing.sections.map((sec, i) => <PdfSection key={i} s={sec} fs={fs} brand={brand} striped={st.tableStriped} bar={st.showSectionTotalsBar} />)
            )}

            <View style={{ marginTop: 8, marginLeft: "auto", width: 220 }} wrap={false}>
              {doc.pricing.adjustment ? <Total k={doc.pricing.adjustment.label} v={doc.pricing.adjustment.amount} /> : null}
              {doc.pricing.tax || doc.pricing.adjustment ? <Total k="Subtotal" v={doc.pricing.subtotal} /> : null}
              {doc.pricing.tax ? <Total k={doc.pricing.tax.label} v={doc.pricing.tax.amount} /> : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: brand, color: onColor(brand), paddingVertical: 5, paddingHorizontal: 8, marginTop: 3, borderRadius: 2 }}>
                <Text style={{ fontFamily: "Helvetica-Bold", fontSize: fs * 1.2 }}>Total</Text>
                <Text style={{ fontFamily: "Helvetica-Bold", fontSize: fs * 1.2 }}>{T(doc.pricing.total)}</Text>
              </View>
            </View>
          </View>

          {doc.allowances ? <Prose title="Allowances" body={doc.allowances} gap={st.sectionGap} color={brand} fs={fs} /> : null}
          {doc.exclusions ? <Prose title="Exclusions & Clarifications" body={doc.exclusions} gap={st.sectionGap} color={brand} fs={fs} /> : null}
          {doc.customerResponsibilities ? <Prose title="Customer Responsibilities" body={doc.customerResponsibilities} gap={st.sectionGap} color={brand} fs={fs} /> : null}
          {doc.schedule ? <Prose title="Estimated Schedule" body={doc.schedule} gap={st.sectionGap} color={brand} fs={fs} /> : null}

          {doc.paymentSchedule.length > 0 && (
            <View style={{ marginTop: st.sectionGap * 1.4 }} wrap={false}>
              <Text style={[s.h2, { fontSize: fs * 1.12 }]}>Payment Schedule</Text>
              {doc.paymentSchedule.map((p, i) => (
                <View key={i} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#eee9e0", paddingVertical: 3 }}>
                  <Text style={{ flex: 1 }}>{T(p.label)}</Text>
                  <Text style={[s.muted, { width: 50, textAlign: "right" }]}>{T(p.percent)}%</Text>
                  <Text style={{ width: 90, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{T(p.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {doc.terms ? <Prose title="Terms and Conditions" body={doc.terms} gap={st.sectionGap} color={brand} fs={fs} small /> : null}

          {doc.signature && (
            <View style={{ flexDirection: "row", gap: 30, marginTop: st.sectionGap * 2 }} wrap={false}>
              {["Customer acceptance", doc.brand.companyName].map((who) => (
                <View key={who} style={{ flex: 1 }}>
                  <View style={{ height: 28, borderBottomWidth: 0.75, borderBottomColor: "#16202e" }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}>
                    <Text style={[s.muted, s.small]}>{T(who)}</Text>
                    <Text style={[s.muted, s.small]}>Date</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>{T(doc.footer)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${T(doc.meta.number)}  ·  Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
      <Text style={{ color: "#6b7686" }}>{k}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold", minWidth: 70, textAlign: "right" }}>{T(v)}</Text>
    </View>
  );
}

function Total({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 1.5 }}>
      <Text style={{ color: "#3b4656" }}>{T(k)}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold" }}>{T(v)}</Text>
    </View>
  );
}

function Prose({ title, body, gap, color, fs = 10, small }: { title?: string; body: string; gap: number; color?: string; fs?: number; small?: boolean }) {
  return (
    <View style={{ marginTop: gap * 1.2 }}>
      {title ? <Text style={{ fontFamily: "Helvetica-Bold", fontSize: fs * 1.12, color, marginBottom: 2 }} minPresenceAhead={30}>{title}</Text> : null}
      <Text style={{ color: "#3b4656", fontSize: small ? fs * 0.9 : fs, lineHeight: 1.4 }}>{T(body)}</Text>
    </View>
  );
}

function PdfSection({ s, fs, brand, striped, bar }: { s: ProposalSection; fs: number; brand: string; striped: boolean; bar: boolean }) {
  const itemized = s.mode === "itemized";
  const hasQty = itemized && s.lines.some((l) => l.quantity);
  const hasUnit = itemized && s.lines.some((l) => l.unitPrice);
  const hasAmt = itemized && s.lines.some((l) => l.amount);
  return (
    <View style={{ marginTop: 7 }}>
      <View
        minPresenceAhead={40}
        wrap={false}
        style={{
          flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 5,
          ...(bar ? { backgroundColor: `${brand}1A`, borderLeftWidth: 2.5, borderLeftColor: brand } : { borderBottomWidth: 0.75, borderBottomColor: brand }),
        }}
      >
        <Text style={{ fontFamily: "Helvetica-Bold", flex: 1, paddingRight: 8 }}>{T(s.title)}</Text>
        {s.amount ? <Text style={{ fontFamily: "Helvetica-Bold" }}>{T(s.amount)}</Text> : null}
      </View>
      {s.description ? <Text style={{ color: "#3b4656", paddingHorizontal: 5, paddingTop: 2 }}>{T(s.description)}</Text> : null}
      {itemized && (hasQty || hasAmt) && s.lines.length > 0 && (
        <View style={{ flexDirection: "row", paddingHorizontal: 5, paddingTop: 3, color: "#6b7686", fontSize: fs * 0.78 }} fixed={false}>
          <Text style={{ flex: 1 }}>Item</Text>
          {hasQty && <Text style={{ width: 70, textAlign: "right" }}>Qty</Text>}
          {hasUnit && <Text style={{ width: 70, textAlign: "right" }}>Unit price</Text>}
          {hasAmt && <Text style={{ width: 75, textAlign: "right" }}>Amount</Text>}
        </View>
      )}
      {s.lines.map((l, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", paddingHorizontal: 5, paddingVertical: 2.5, borderBottomWidth: 0.4, borderBottomColor: "#f0ece4", backgroundColor: striped && i % 2 ? "#f6f4ef" : undefined, fontSize: fs * 0.95 }}>
          <View style={{ flex: 1, paddingRight: 6 }}>
            <Text>{itemized ? T(l.name) : `•  ${T(l.name)}`}</Text>
            {l.description ? <Text style={{ color: "#6b7686" }}>{T(l.description)}</Text> : null}
            {l.notes ? <Text style={{ color: "#6b7686", fontFamily: "Helvetica-Oblique" }}>{T(l.notes)}</Text> : null}
          </View>
          {hasQty && <Text style={{ width: 70, textAlign: "right" }}>{l.quantity ? `${T(l.quantity)} ${T(l.unit)}` : ""}</Text>}
          {hasUnit && <Text style={{ width: 70, textAlign: "right" }}>{T(l.unitPrice)}</Text>}
          {hasAmt && <Text style={{ width: 75, textAlign: "right" }}>{T(l.amount)}</Text>}
        </View>
      ))}
    </View>
  );
}
