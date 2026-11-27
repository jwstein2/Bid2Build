import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { depositGaps, efileCsv, federalDeadlines, maskTin, readiness, sheetCsv, stateSheets, summarySheet, withholdingSheets, ledgerSheet, type TaxSeason, type TaxPayee, type TaxStateRow } from "@/lib/payouts/tax-season";
import { TaxReportPdf } from "@/lib/pdf/tax-report-pdf";
import { NecCopyBPdf } from "@/lib/pdf/nec-copy-b";

const payee = (o: Partial<TaxPayee>): TaxPayee => ({
  kind: "staff", id: "11111111-2222-3333-4444-555555555555", name: "Pat Rep", business_name: null, email: "pat@reps.test", label: "contractor_1099",
  tin_type: "ssn", tin_last4: "4321", w9_status: "submitted", tax_class: "individual", exempt_code: null, backup_withholding: false, backup_reason: null, tin_match: "not_checked",
  address: "1 Main St, Town, MN 55901", address_line1: "1 Main St", address_line2: null, city: "Town", addr_state: "MN", postal_code: "55901",
  tax_state: "MN", gross_cents: 250000, federal_withheld_cents: 0, state_withheld_cents: 0, net_cents: 250000, recipient_fees_cents: 0, payouts: 2,
  likely_exempt: false, needs_1099: true, missing: [], ...o,
});
const state = (o: Partial<TaxStateRow>): TaxStateRow => ({
  state: "MN", name: "Minnesota", verified: false, verified_at: null, source_note: null, has_income_tax: true, state_1099_filing: "unknown", state_1099_threshold_cents: null,
  state_backup_withholding_bps: null, nonresident_withholding_note: null, contractor_reporting: "unknown", contractor_report_threshold_cents: null, contractor_report_days: null,
  agency_url: null, notes: null, payees: 1, needs_1099: 1, gross_cents: 250000, state_withheld_cents: 0, payer_state_id: null, filings: 0, ...o,
});
const season = (o: Partial<TaxSeason> = {}): TaxSeason => ({
  year: 2026, generated_at: "2026-12-01T12:00:00Z", threshold: { threshold_cents: 200000, verified: false, source_note: "P.L. 119-21" },
  settings: { payer_legal_name: "Built2Bid L.L.C.", payer_ein: "12-3456789", payer_address: "1 Office Rd, Rochester, MN 55901", payer_phone: null, payer_state_ids: { CA: "999-9999-9" },
    backup_withholding_enabled: true, backup_withholding_bps: 2400, backup_rate_verified: true, backup_rate_source: "IRS", filing_method: "filing_service", deposit_schedule: "monthly", cpa_name: null },
  payees: [payee({}), payee({ id: "aaaaaaaa-0000-0000-0000-000000000000", kind: "affiliate", name: "=HYPERLINK(evil)", tin_type: "ein", tin_last4: "9876", tax_state: "CA", addr_state: "CA",
    gross_cents: 80000, federal_withheld_cents: 19200, state_withheld_cents: 5600, net_cents: 55200, backup_withholding: true, backup_reason: "irs_b_notice" })],
  states: [state({}), state({ state: "CA", name: "California", verified: true, verified_at: "2026-11-30T00:00:00Z", contractor_reporting: "required", contractor_report_days: 20, state_withheld_cents: 5600 })],
  contractor_reports: [{ payee_kind: "affiliate", payee_id: "aaaaaaaa-0000-0000-0000-000000000000", name: "Aff", state: "CA", rule_verified: true, threshold_cents: 60000, crossed_on: "2026-04-15", due_on: "2026-05-05", filed_on: null, agency_url: null }],
  withholding_by_month: [{ month: "2026-06-01", federal_cents: 19200, state: { CA: 5600 } }],
  withholding_payouts: [{ ref: "B2B-AF-1", settled_at: "2026-06-20T17:00:00Z", payee: "Aff", tax_state: "CA", gross_cents: 80000, federal_cents: 19200, state_cents: 5600, net_cents: 55200 }],
  deposits: [{ id: "d1", jurisdiction: "federal", period_month: "2026-06-01", amount_cents: 19200, deposited_on: "2026-07-14", confirmation: "EFTPS-1", note: null }],
  ledger: [{ ref: "B2B-PO-1", payee: "Pat Rep", payee_kind: "staff", status: "paid", settled_at: "2026-03-10T17:00:00Z", tax_state: "MN", gross_cents: 250000, adjustments_cents: 0, fee_cents: 150,
    fee_bearer: "company", federal_cents: 0, state_cents: 0, net_cents: 250000, provider: "stripe_global_payouts", provider_ref: "obp_1", items: 2 }],
  employees_w2: [], filings: [], ...o,
});

describe("tax season builders", () => {
  it("masks TINs and never puts a full TIN in the summary", () => {
    expect(maskTin("ssn", "4321")).toBe("***-**-4321");
    expect(maskTin("ein", "9876")).toBe("**-***9876");
    const csv = sheetCsv([summarySheet(season())]);
    expect(csv).toContain("***-**-4321");
    expect(csv).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    // Formula injection is neutralized.
    expect(csv).toContain("\"'=HYPERLINK(evil)");
  });

  it("deposit gaps compare withheld to deposited by month and jurisdiction", () => {
    expect(depositGaps(season())).toEqual([
      { month: "2026-06", jurisdiction: "federal", withheld_cents: 19200, deposited_cents: 19200, gap_cents: 0 },
      { month: "2026-06", jurisdiction: "CA", withheld_cents: 5600, deposited_cents: 0, gap_cents: 5600 },
    ]);
  });

  it("e-file CSV carries full TINs only from the map, plus boxes 4-7 and the payer state number", () => {
    const out = efileCsv(season(), new Map([["11111111-2222-3333-4444-555555555555", "123-45-4321"]]));
    const lines = out.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("\"123-45-4321\"");
    expect(lines[2]).toContain("\"192.00\",\"56.00\",\"CA\",\"999-9999-9\",\"800.00\"");
    // No TIN supplied -> blank, never guessed.
    expect(lines[2].split(",")[7]).toBe("\"\"");
  });

  it("readiness lists what's left, including unverified states and late reports", () => {
    const r = readiness(season());
    expect(r.join(" ")).toMatch(/Verify the 2026 1099-NEC threshold/);
    expect(r.join(" ")).toMatch(/Verify the tax rules for: MN/);
    expect(r.join(" ")).toMatch(/contractor report is past due/);
    expect(r.join(" ")).toMatch(/Withholding not yet deposited/);
    expect(readiness(season({ settings: { ...season().settings, payer_ein: null } }))[0]).toMatch(/EIN/);
  });

  it("federal deadlines follow the year and what applies", () => {
    const d = federalDeadlines(2026, season());
    expect(d[0]).toMatchObject({ due: "2027-01-31", applies: true });
    expect(d.find((x) => x.what.startsWith("Form 945"))?.applies).toBe(true);
    expect(federalDeadlines(2026, season({ payees: [payee({ needs_1099: false })] })).every((x) => !x.applies)).toBe(true);
  });

  it("renders the packet PDF and Copy B with withholding", async () => {
    const s = season();
    const pdf = await renderToBuffer(createElement(TaxReportPdf, { title: "Tax season packet, 2026", subtitle: "test", payer: "Built2Bid L.L.C.", checklist: readiness(s), deadlines: federalDeadlines(2026, s),
      sheets: [summarySheet(s), ...withholdingSheets(s), ...stateSheets(s), ledgerSheet(s)] }) as React.ReactElement<DocumentProps>);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const b = await renderToBuffer(createElement(NecCopyBPdf, { forms: [{ year: 2026, payer: { legalName: "Built2Bid L.L.C.", ein: "12-3456789", address: null, phone: null },
      recipient: { name: "Aff", businessName: null, tinType: "ein", tinLast4: "9876", address: null, amount: "800.00", account: "AAAA", federalWithheld: "192.00", state: { code: "CA", payerStateNo: "1", withheld: "56.00", income: "800.00" } } }] }) as React.ReactElement<DocumentProps>);
    expect(b.subarray(0, 4).toString()).toBe("%PDF");
  }, 30000);
});
