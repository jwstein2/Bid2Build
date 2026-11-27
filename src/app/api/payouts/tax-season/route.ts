import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { requireStaffCap, hasTwoStep } from "@/lib/staff/server";
import { logError } from "@/lib/http/api";
import { formatTaxId, openPii, piiReady } from "@/lib/security/pii";
import { TaxReportPdf } from "@/lib/pdf/tax-report-pdf";
import { NecCopyBPdf, type NecCopyB } from "@/lib/pdf/nec-copy-b";
import {
  efileCsv, federalDeadlines, ledgerSheet, readiness, sheetCsv, stateSheets, summarySheet, usd, withholdingSheets, type Sheet, type TaxSeason,
} from "@/lib/payouts/tax-season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCS = ["summary", "ledger", "withholding", "states", "packet", "efile", "copy-b"] as const;
type Doc = (typeof DOCS)[number];
const TITLES: Record<Doc, string> = {
  summary: "1099-NEC summary", ledger: "Payout ledger", withholding: "Withholding report", states: "State-by-state report", packet: "Tax season packet",
  efile: "1099-NEC e-file", "copy-b": "1099-NEC recipient copies",
};
const HEADERS = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...HEADERS } });

/**
 * Tax-season downloads for Built2Bid's own payees (owner, finance, external accountant).
 *   ?year=2026&doc=summary|ledger|withholding|states|packet&format=csv|pdf
 *   ?doc=copy-b (PDF, recipient copies, last 4 of TIN only; needs payer EIN)
 *   ?doc=efile  (CSV with FULL TINs: owner only, two-step sign-in, every TIN logged as exported)
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const doc = u.searchParams.get("doc") as Doc | null;
  const year = Number(u.searchParams.get("year") ?? "");
  const format = u.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  if (!doc || !DOCS.includes(doc)) return text(400, "Pick a document.");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return text(400, "Pick a year.");
  const { user, db, owner } = await requireStaffCap("reports.export");
  const { data, error } = await db.rpc("admin_tax_season", { p_caller: user.id, p_year: year });
  if (error || !data) { logError("payouts.tax_season", error); return text(503, "Run migration 20270304001000_payout_tax_compliance.sql first."); }
  const s = data as TaxSeason;
  const file = `built2bid-${doc}-${year}`;

  if (doc === "efile") {
    if (!owner) return text(403, "Only the owner can download full taxpayer IDs.");
    if (!(await hasTwoStep())) return text(403, "Sign in with your authenticator code (two-step) first.");
    if (!piiReady()) return text(503, "The encryption key isn't set on the server.");
    if (!s.settings.payer_ein) return text(409, "Add Built2Bid's EIN in Year-end tax → Payer details first.");
    const need = s.payees.filter((p) => p.needs_1099);
    const staffIds = need.filter((p) => p.kind === "staff").map((p) => p.id);
    const affIds = need.filter((p) => p.kind === "affiliate").map((p) => p.id);
    const [st, af] = await Promise.all([
      staffIds.length ? db.from("staff_tin_secrets").select("staff_id, tin_ciphertext").in("staff_id", staffIds) : Promise.resolve({ data: [] as { staff_id: string; tin_ciphertext: string }[] }),
      affIds.length ? db.from("affiliate_tin_secrets").select("affiliate_id, tin_ciphertext").in("affiliate_id", affIds) : Promise.resolve({ data: [] as { affiliate_id: string; tin_ciphertext: string }[] }),
    ]);
    const sealed = new Map<string, string>([
      ...((st.data ?? []) as { staff_id: string; tin_ciphertext: string }[]).map((r) => [r.staff_id, r.tin_ciphertext] as [string, string]),
      ...((af.data ?? []) as { affiliate_id: string; tin_ciphertext: string }[]).map((r) => [r.affiliate_id, r.tin_ciphertext] as [string, string]),
    ]);
    const tins = new Map<string, string | null>();
    for (const p of need) {
      const c = sealed.get(p.id);
      let tin: string | null = null;
      // A TIN that can't be opened stays blank so the row can't be filed by mistake.
      if (c) { try { tin = formatTaxId(openPii(c), p.tin_type === "ein" ? "ein" : "ssn"); } catch (e) { logError("payouts.tax_season.tin", e, { payee: p.id }); } }
      tins.set(p.id, tin);
    }
    await db.rpc("staff_audit", { p_actor: user.id, p_action: "payout_tax.tins_exported", p_type: "tax_year", p_id: String(year), p_details: { payees: need.map((p) => ({ kind: p.kind, id: p.id })) } });
    return new Response(efileCsv(s, tins), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"`, ...HEADERS } });
  }

  if (doc === "copy-b") {
    if (!s.settings.payer_ein) return text(409, "Add Built2Bid's EIN in Year-end tax → Payer details first.");
    const one = u.searchParams.get("payee");
    const forms: NecCopyB[] = s.payees.filter((p) => p.needs_1099 && (!one || p.id === one)).map((p) => ({
      year, payer: { legalName: s.settings.payer_legal_name, ein: s.settings.payer_ein!, address: s.settings.payer_address, phone: s.settings.payer_phone },
      recipient: { name: p.name, businessName: p.business_name, tinType: p.tin_type === "ein" ? "ein" : p.tin_type ? "ssn" : null, tinLast4: p.tin_last4, address: p.address,
        amount: usd(p.gross_cents), account: p.id.slice(0, 8).toUpperCase(), federalWithheld: usd(p.federal_withheld_cents),
        state: p.tax_state ? { code: p.tax_state, payerStateNo: s.settings.payer_state_ids[p.tax_state] ?? null, withheld: usd(p.state_withheld_cents), income: usd(p.gross_cents) } : null },
    }));
    if (!forms.length) return text(404, "Nobody needs a 1099-NEC for that year yet.");
    return pdf(createElement(NecCopyBPdf, { forms }), file);
  }

  const sheets: Sheet[] = doc === "summary" ? [summarySheet(s)] : doc === "ledger" ? [ledgerSheet(s)] : doc === "withholding" ? withholdingSheets(s) : doc === "states" ? stateSheets(s)
    : [summarySheet(s), ...withholdingSheets(s), ...stateSheets(s), ledgerSheet(s)];
  await db.rpc("staff_audit", { p_actor: user.id, p_action: "payout_tax.report_downloaded", p_type: "tax_year", p_id: String(year), p_details: { doc, format } });
  if (format === "csv") return new Response(sheetCsv(sheets), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"`, ...HEADERS } });
  return pdf(createElement(TaxReportPdf, {
    title: `${TITLES[doc]}, ${year}`, subtitle: `${s.settings.payer_legal_name} · prepared ${new Date(s.generated_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" })} · live payouts to Built2Bid's own contractors, reps and affiliates`,
    payer: s.settings.payer_legal_name, sheets, ...(doc === "packet" ? { checklist: readiness(s), deadlines: federalDeadlines(year, s) } : {}),
  }), file);
}

async function pdf(el: React.ReactElement, file: string) {
  try {
    const buf = await renderToBuffer(el as React.ReactElement<DocumentProps>);
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file}.pdf"`, ...HEADERS } });
  } catch (e) {
    logError("payouts.tax_season.pdf", e);
    return text(500, "We couldn't make the PDF. Please try again.");
  }
}
