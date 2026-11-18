/**
 * Accountant Mode, pure logic (src/lib/financials/accounting.ts + audit-view.ts):
 *   statement parsing (CSV variants, OFX), match suggestions, duplicate lines, aging, the transaction filter,
 *   the reports catalog (blocked reports never link), accountant quick actions by permission.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_ACTIONS, accountantActionsFor, agingTotals, bucketFor, filterTxns, parseBankAmount, parseBankDate, parseStatement, possibleDuplicateLines,
  REPORT_CATALOG, searchCatalog, splitCsvLine, suggestMatches, type BankLine, type MatchCandidate, type Txn,
} from "@/lib/financials/accounting";
import { auditSummary } from "@/lib/financials/audit-view";
import { FIN_ROLE_PERMISSIONS } from "@/lib/financials/permissions";

describe("bank statement parsing", () => {
  it("reads dates and amounts the way banks print them", () => {
    expect(parseBankDate("2026-11-02")).toBe("2026-11-02");
    expect(parseBankDate("11/2/2026")).toBe("2026-11-02");
    expect(parseBankDate("11/02/26")).toBe("2026-11-02");
    expect(parseBankDate("20261102120000[-5:EST]")).toBe("2026-11-02");
    expect(parseBankDate("02/30/2026")).toBeNull();
    expect(parseBankAmount("$1,234.56")).toBe("1234.56");
    expect(parseBankAmount("(12.00)")).toBe("-12.00");
    expect(parseBankAmount("-45.1")).toBe("-45.10");
    expect(parseBankAmount("12.00 DR")).toBe("-12.00");
    expect(parseBankAmount("1.005")).toBeNull();
    expect(parseBankAmount("abc")).toBeNull();
    expect(splitCsvLine('2026-11-02,"Lumber, Inc ""Yard""",-600.00')).toEqual(["2026-11-02", 'Lumber, Inc "Yard"', "-600.00"]);
  });

  it("parses a single Amount column CSV, skipping bank preamble lines and listing unreadable rows", () => {
    const csv = ["Account: Business Checking ****4321", "", "Date,Description,Amount,Check Number", "11/02/2026,Deposit Pat Rivera,12000.00,", "11/03/2026,Check 1001,-600.00,1001", "bad,row,,", "11/04/2026,Gas,-45.10,"].join("\n");
    const p = parseStatement(csv);
    expect(p.rows).toEqual([
      { date: "2026-11-02", description: "Deposit Pat Rivera", amount: "12000.00", checkNumber: undefined, ref: undefined },
      { date: "2026-11-03", description: "Check 1001", amount: "-600.00", checkNumber: "1001", ref: undefined },
      { date: "2026-11-04", description: "Gas", amount: "-45.10", checkNumber: undefined, ref: undefined },
    ]);
    expect(p.errors).toHaveLength(1);
    expect([p.start, p.end]).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("parses Debit / Credit columns (debits are money out whatever sign the bank printed)", () => {
    const p = parseStatement("Posted Date,Payee,Debit,Credit\n2026-11-05,Transfer,1000.00,\n2026-11-06,Refund,,25.00\n2026-11-07,Fee,-12.00,");
    expect(p.rows.map((r) => r.amount)).toEqual(["-1000.00", "25.00", "-12.00"]);
  });

  it("refuses a file without the needed columns instead of guessing", () => {
    expect(parseStatement("Foo,Bar\n1,2").errors[0]).toMatch(/Date column/);
    expect(parseStatement("Date,Amount\n2026-11-01,5").errors[0]).toMatch(/Description/);
  });

  it("parses OFX / QFX with the ledger (ending) balance", () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><DTSTART>20261101<DTEND>20261130
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-600.00<FITID>A1<CHECKNUM>1001<NAME>LUMBER YARD</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261102<TRNAMT>12000.00<FITID>A2<NAME>DEPOSIT<MEMO>Pat Rivera</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>11400.00<DTASOF>20261130</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const p = parseStatement(ofx);
    expect(p.format).toBe("ofx");
    expect(p.rows).toEqual([
      { date: "2026-11-03", description: "LUMBER YARD", amount: "-600.00", checkNumber: "1001", ref: "A1" },
      { date: "2026-11-02", description: "DEPOSIT · Pat Rivera", amount: "12000.00", checkNumber: undefined, ref: "A2" },
    ]);
    expect([p.start, p.end, p.endingBalance]).toEqual(["2026-11-01", "2026-11-30", "11400.00"]);
  });
});

describe("match suggestions (a person always confirms)", () => {
  const line: BankLine = { id: "t1", account_id: "a", posted_on: "2026-11-10", description: "CHECK 1001", amount: "-600.00", check_number: "1001" };
  const c = (over: Partial<MatchCandidate>): MatchCandidate => ({ type: "bill_payment", id: "x", date: "2026-11-10", amount: "-600.00", label: "Bill", ...over });

  it("needs the same amount and direction, within 5 days, closest first; a check number wins at any date", () => {
    const s = suggestMatches(line, [
      c({ id: "far", date: "2026-11-20" }), c({ id: "near", date: "2026-11-12" }), c({ id: "same", date: "2026-11-10" }),
      c({ id: "other-amount", amount: "-600.01" }), c({ id: "money-in", amount: "600.00" }), c({ id: "check", date: "2026-10-01", reference: "#1001" }),
    ]);
    expect(s.map((x) => x.id)).toEqual(["check", "same", "near"]);
    expect(s[0].why).toMatch(/Check #1001/);
    expect(s[1].why).toBe("Same amount, same day");
  });

  it("skips records already matched to another line", () => {
    expect(suggestMatches(line, [c({ id: "same" })], new Set(["bill_payment:same"]))).toEqual([]);
  });

  it("flags the same charge twice within 3 days as a possible duplicate", () => {
    const l = (id: string, d: string, desc = "GAS STATION #12") => ({ id, account_id: "a", posted_on: d, description: desc, amount: "-45.10", check_number: null });
    expect(possibleDuplicateLines([l("1", "2026-11-04"), l("2", "2026-11-05"), l("3", "2026-11-20"), l("4", "2026-11-04", "Coffee")])).toEqual([["1", "2"]]);
  });
});

describe("aging", () => {
  it("buckets by days past due and totals per party to the cent", () => {
    expect(bucketFor(null, "2026-11-18")).toBe("current");
    expect(bucketFor("2026-11-18", "2026-11-18")).toBe("current");
    expect(bucketFor("2026-11-17", "2026-11-18")).toBe("1_30");
    expect(bucketFor("2026-08-01", "2026-11-18")).toBe("over_90");
    const a = agingTotals([
      { id: "1", party: "Lumber Yard", number: "B1", due_date: "2026-11-30", balance: "100.10" },
      { id: "2", party: "Lumber Yard", number: "B2", due_date: "2026-10-01", balance: "0.20" },
      { id: "3", party: "Sparky Electric", number: "B3", due_date: "2026-11-01", balance: "500.00" },
    ], "2026-11-18");
    expect(a.total).toBe("600.30");
    expect(a.byBucket).toMatchObject({ current: "100.10", "1_30": "500.00", "31_60": "0.20" });
    expect(a.byParty[0]).toMatchObject({ party: "Sparky Electric", total: "500.00" });
  });
});

describe("transaction ledger filter", () => {
  const t = (over: Partial<Txn>): Txn => ({ key: over.id ?? "k", source: "expense", id: "k", date: "2026-11-01", number: "E-1", description: "Screws", account: "Card", category: "Materials",
    direction: "out", amount: "10.00", party: "Hardware Co", jobId: null, project: "Overhead", posting: "posted", recon: "unmatched", documents: 0, href: null, ...over });
  const rows = [t({ id: "a", date: "2026-11-03", number: "E-2" }), t({ id: "b", source: "payment", direction: "in", party: "Pat Rivera", jobId: "j1", recon: "matched" }), t({ id: "c", posting: "void", date: "2026-10-01" })];
  it("filters by text, type, status, project and dates; newest first", () => {
    expect(filterTxns(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterTxns(rows, { q: "pat" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterTxns(rows, { source: "expense", posting: "posted" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterTxns(rows, { recon: "matched" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterTxns(rows, { job: "none" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterTxns(rows, { from: "2026-11-01", to: "2026-11-02" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterTxns(rows, { dir: "in" }).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("reports catalog", () => {
  it("blocked reports have a reason and no link; available ones always link", () => {
    for (const r of REPORT_CATALOG) {
      if (r.status === "blocked") { expect(r.href).toBeUndefined(); expect(r.blockedBy).toMatch(/general ledger/i); expect(r.csv).toBeUndefined(); }
      else expect(r.href).toMatch(/^\/financials\//);
    }
    expect(REPORT_CATALOG.filter((r) => r.status === "blocked").map((r) => r.key).sort()).toEqual(["balance_sheet", "cash_flow", "general_ledger", "trial_balance"]);
  });
  it("searches labels, descriptions and keywords; hides reports the role can't open", () => {
    expect(searchCatalog("1099", FIN_ROLE_PERMISSIONS.bookkeeper).map((r) => r.key)).toEqual(["sub_payments"]);
    expect(searchCatalog("aging", FIN_ROLE_PERMISSIONS.accountant).map((r) => r.key)).toEqual(["ar_aging", "ap_aging"]);
    expect(searchCatalog("", FIN_ROLE_PERMISSIONS.project_manager)).toEqual([]);
  });
});

describe("accountant quick actions", () => {
  it("are the nine asked for, each opening a real page", () => {
    expect(ACCOUNTANT_ACTIONS.map((a) => a.label)).toEqual(["Reconcile bank", "Review uncategorized", "Review bills", "Review AR", "Generate P&L", "Export transaction ledger", "Review duplicate transactions", "Review audit trail", "Review payroll costs"]);
    for (const a of ACCOUNTANT_ACTIONS) expect(a.href).toMatch(/^\/(financials|api\/financials)\//);
  });
  it("show only what the role allows", () => {
    expect(accountantActionsFor(FIN_ROLE_PERMISSIONS.accountant)).toHaveLength(9);
    expect(accountantActionsFor(FIN_ROLE_PERMISSIONS.accountant_readonly).map((a) => a.key)).not.toContain("reconcile");
    expect(accountantActionsFor(FIN_ROLE_PERMISSIONS.view_only).map((a) => a.key)).not.toContain("export_ledger");
    expect(accountantActionsFor(FIN_ROLE_PERMISSIONS.sales_rep)).toEqual([]);
    expect(accountantActionsFor(FIN_ROLE_PERMISSIONS.project_manager)).toEqual([]);
  });
});

describe("audit trail view", () => {
  it("labels actions and shows previous / new values", () => {
    const s = auditSummary("cost.filled", { new: { jobId: "j1", costCodeId: "c1" }, previous: { jobId: null, vendorId: null, costCodeId: null } });
    expect(s.title).toBe("Classification filled in");
    expect(s.changes).toEqual([{ field: "Project", before: "empty", after: "j1" }, { field: "Cost code", before: "empty", after: "c1" }]);
    expect(auditSummary("export.general_ledger", { from: "2026-11-01" })).toMatchObject({ title: "Exported general ledger", facts: ["From: 2026-11-01"] });
    expect(auditSummary("bank.matched", { target: "payment", amount: "12000.00" }).facts).toEqual(["Matched to: payment", "Amount: 12000.00"]);
    expect(auditSummary("weird.thing", null).title).toBe("Weird thing");
  });
});
