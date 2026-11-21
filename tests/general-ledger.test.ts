import { describe, expect, it } from "vitest";
import { balanceSheet, checkJournal, incomeStatement, journalPayload, journalTotals, trialBalance, type GlBalance, type GlType } from "@/lib/financials/general-ledger";

const row = (code: string, type: GlType, debit: number, credit: number): GlBalance => ({
  account_id: code, code, name: `Acct ${code}`, type, system_key: null, debit: debit.toFixed(2), credit: credit.toFixed(2),
  balance: (["asset", "cogs", "expense"].includes(type) ? debit - credit : credit - debit).toFixed(2),
});

// Invoice 3,000 (+0 tax), payment 2,000, bill 1,200 (1,000 job + 200 overhead), bill paid 600, opening cash 5,000.
const BOOK: GlBalance[] = [
  row("1000", "asset", 2000 + 5000, 600),
  row("1100", "asset", 3000, 2000),
  row("1500", "asset", 0, 0),
  row("2000", "liability", 600, 1200),
  row("3100", "equity", 0, 5000),
  row("4000", "income", 0, 3000),
  row("5000", "cogs", 1000, 0),
  row("6000", "expense", 200, 0),
];

describe("general ledger statements", () => {
  it("trial balance nets each account to one side and balances", () => {
    const t = trialBalance(BOOK);
    expect(t.balanced).toBe(true);
    expect(t.debit).toBe(t.credit);
    expect(t.rows.find((r) => r.code === "1500")).toBeUndefined();   // zero accounts hidden
    expect(t.rows.find((r) => r.code === "2000")).toMatchObject({ debit: "", credit: "600.00" });
  });

  it("income statement: gross profit and net income", () => {
    const i = incomeStatement(BOOK);
    expect(i.income.total).toBe("3000.00");
    expect(i.grossProfit).toBe("2000.00");
    expect(i.netIncome).toBe("1800.00");
  });

  it("balance sheet balances with current profit in equity", () => {
    const b = balanceSheet(BOOK);
    expect(b.assets.total).toBe("7400.00");
    expect(b.liabilities.total).toBe("600.00");
    expect(b.earnings).toBe("1800.00");
    expect(b.totalLiabilitiesAndEquity).toBe("7400.00");
    expect(b.balanced).toBe(true);
  });

  it("handles cents without float drift", () => {
    const rows = [row("1000", "asset", 0.1 + 0.2, 0), row("4000", "income", 0, 0.3)];
    expect(trialBalance(rows).balanced).toBe(true);
    expect(balanceSheet(rows).balanced).toBe(true);
  });
});

describe("manual journal checks", () => {
  const ok = [{ account: "a", debit: "100.00" }, { account: "b", credit: "100" }];
  it("accepts a balanced entry and builds the payload", () => {
    expect(checkJournal("Owner put in cash", "2026-11-21", ok)).toBeNull();
    expect(journalPayload([...ok, { account: "", debit: "" }])).toEqual([{ account: "a", debit: "100.00" }, { account: "b", credit: "100" }]);
    expect(journalTotals(ok)).toEqual({ debit: "100.00", credit: "100.00", difference: "0.00" });
  });
  it("rejects bad entries", () => {
    expect(checkJournal("", "2026-11-21", ok)).toBe("memo_required");
    expect(checkJournal("x", "11/21/2026", ok)).toBe("gl_bad_date");
    expect(checkJournal("x", "2026-11-21", [{ account: "a", debit: "100" }, { account: "b", credit: "99.99" }])).toBe("journal_unbalanced");
    expect(checkJournal("x", "2026-11-21", [{ account: "a", debit: "100" }])).toBe("journal_needs_two_lines");
    expect(checkJournal("x", "2026-11-21", [{ account: "a", debit: "1", credit: "1" }, { account: "b", credit: "1" }])).toBe("bad_lines");
    expect(checkJournal("x", "2026-11-21", [{ account: "", debit: "1" }, { account: "b", credit: "1" }])).toBe("unknown_account");
    expect(checkJournal("x", "2026-11-21", [{ account: "a", debit: "1.234" }, { account: "b", credit: "1.234" }])).toBe("bad_amount");
  });
});
