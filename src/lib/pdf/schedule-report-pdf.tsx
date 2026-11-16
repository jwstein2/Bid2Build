import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { daysBetween, formatDay, formatRange } from "../schedule/calendar";
import type { CustomerReport, ReportSection } from "../schedule/report";
import { pdfSafe } from "./proposal-pdf";

const T = (s?: string | null) => pdfSafe(s);
const NAVY = "#0b2d4d", INK = "#16202e", MUTED = "#56677a", LINE = "#dde5ee", TINT = "#f5f8fb";
const STATE_COLOR = { completed: "#15803d", current: "#0e7490", upcoming: "#64748b" } as const;
const long = (d: string) => formatDay(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** Customer schedule update PDF: the same frozen content as the share page. No prices or costs. */
export function ScheduleReportPdf({ r, version, logo }: { r: CustomerReport; version?: number; logo?: { data: Buffer; format: "png" | "jpg" } | null }) {
  const brand = r.brand.color ?? NAVY;
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 9.5, color: INK, paddingTop: 32, paddingBottom: 48, paddingHorizontal: 36 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: brand, paddingBottom: 10, marginBottom: 14 },
    h1: { fontFamily: "Helvetica-Bold", fontSize: 17, color: NAVY },
    h2: { fontFamily: "Helvetica-Bold", fontSize: 11.5, color: NAVY, marginTop: 14, marginBottom: 6 },
    muted: { color: MUTED },
    kpis: { flexDirection: "row", gap: 8 },
    kpi: { flex: 1, backgroundColor: TINT, borderRadius: 4, padding: 8 },
    kpiLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase" },
    kpiVal: { fontFamily: "Helvetica-Bold", fontSize: 14, color: NAVY, marginTop: 2 },
    card: { borderWidth: 0.75, borderColor: LINE, borderRadius: 4, padding: 8, marginBottom: 6 },
    chip: { fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 6, color: "#ffffff" },
    footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5 },
  });
  const groups: { title: string; items: ReportSection[] }[] = [
    { title: "Current work", items: r.sections.filter((x) => x.state === "current") },
    { title: "Completed", items: r.sections.filter((x) => x.state === "completed") },
    { title: "Upcoming", items: r.sections.filter((x) => x.state === "upcoming") },
  ].filter((g) => g.items.length);

  // Timeline: one bar per section across the project's dates.
  const start = r.projectStart, end = r.forecastFinish;
  const span = start && end ? Math.max(1, daysBetween(start, end) + 1) : 1;
  const pos = (d: string) => (start ? Math.max(0, Math.min(1, daysBetween(start, d) / span)) : 0);

  return (
    <Document title={T(`Project update - ${r.projectTitle}`)} author={T(r.company.name)} creator={T(r.company.name)} producer="Built2Bid">
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.head}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", maxWidth: "55%" }}>
            {logo && <Image src={{ data: logo.data, format: logo.format }} style={{ maxHeight: 40, maxWidth: 120, objectFit: "contain" }} />}
            <View>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11.5 }}>{T(r.company.name)}</Text>
              <Text style={s.muted}>{T([r.company.phone, r.company.email, r.company.website].filter(Boolean).join("  |  "))}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: "45%" }}>
            <Text style={s.h1}>Project Update</Text>
            <Text style={s.muted}>{T(r.projectTitle)}</Text>
            <Text style={s.muted}>Prepared for {T(r.customerName || "you")}</Text>
            {r.projectAddress && <Text style={s.muted}>{T(r.projectAddress)}</Text>}
            <Text style={s.muted}>{long(r.reportDate)}{version ? `  |  Update ${version}` : ""}</Text>
          </View>
        </View>

        {r.provisional && <Text style={{ backgroundColor: "#fef3c7", color: "#92400e", padding: 6, marginBottom: 10, borderRadius: 3 }}>Tentative schedule: dates are provisional until the project is confirmed.</Text>}

        <View style={s.kpis}>
          {r.progress !== null && <View style={s.kpi}><Text style={s.kpiLabel}>Overall progress</Text><Text style={s.kpiVal}>{r.progress}% complete</Text></View>}
          {r.forecastFinish && (
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Forecast completion</Text>
              <Text style={s.kpiVal}>{formatDay(r.forecastFinish, { month: "short", day: "numeric", year: "numeric" })}</Text>
              {r.previousForecast && <Text style={s.muted}>Previously {formatDay(r.previousForecast, { month: "short", day: "numeric", year: "numeric" })}</Text>}
            </View>
          )}
          <View style={s.kpi}><Text style={s.kpiLabel}>Work status</Text><Text style={{ ...s.kpiVal, fontSize: 10 }}>{r.counts.completed} complete · {r.counts.current} in progress · {r.counts.upcoming} upcoming</Text></View>
        </View>

        {r.notes && (<><Text style={s.h2}>Notes from {T(r.company.name)}</Text><Text>{T(r.notes)}</Text></>)}

        {r.showTimeline && start && end && r.sections.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>Timeline</Text>
            {r.sections.map((x) => (
              <View key={x.key} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
                <Text style={{ width: "28%", fontSize: 8.5 }}>{T(x.name)}</Text>
                <View style={{ width: "72%", height: 9, backgroundColor: TINT, position: "relative" }}>
                  <View style={{ position: "absolute", left: `${pos(x.plannedStart) * 100}%`, width: `${Math.max(1.5, (pos(x.plannedEnd) - pos(x.plannedStart)) * 100 + 100 / span)}%`, height: 9, backgroundColor: STATE_COLOR[x.state], borderRadius: 2 }} />
                </View>
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginLeft: "28%", fontSize: 7.5, color: MUTED }}>
              <Text>{formatDay(start)}</Text><Text>{formatDay(end)}</Text>
            </View>
          </View>
        )}

        {groups.map((g) => (
          <View key={g.title}>
            <Text style={s.h2}>{g.title}</Text>
            {g.items.map((x) => (
              <View key={x.key} style={s.card} wrap={false}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY }}>{T(x.name)}{x.trade ? <Text style={{ ...s.muted, fontFamily: "Helvetica", fontSize: 8.5 }}>{`  ${T(x.trade)}`}</Text> : null}</Text>
                  <Text style={{ ...s.chip, backgroundColor: x.status === "delayed" ? "#b45309" : x.status === "on_hold" ? "#6a4ba8" : STATE_COLOR[x.state] }}>{T(x.statusLabel)}{x.progress !== null && x.state === "current" ? ` · ${x.progress}%` : ""}</Text>
                </View>
                <Text style={{ marginTop: 3 }}>Scheduled {formatRange(x.plannedStart, x.plannedEnd)}{x.actualFinish ? `  |  Completed ${formatDay(x.actualFinish, { month: "short", day: "numeric", year: "numeric" })}` : ""}</Text>
                {x.change && <Text style={{ marginTop: 2, color: "#92400e" }}>{T(x.change)}</Text>}
                {x.assignedTo && <Text style={{ marginTop: 3, ...s.muted }}>Done by: {T(x.assignedTo)}</Text>}
                {x.scope && <Text style={{ marginTop: 3, ...s.muted }}>Scope: {T(x.scope)}</Text>}
                {x.tasks && x.tasks.map((t, i) => <Text key={i} style={{ marginTop: 2, marginLeft: 8, fontSize: 8.5 }}>• {T(t.name)}: {formatRange(t.plannedStart, t.plannedEnd)} ({T(t.statusLabel)})</Text>)}
              </View>
            ))}
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text>{T(r.company.name)} · Project update {long(r.reportDate)}. Dates are forecasts and may change.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
