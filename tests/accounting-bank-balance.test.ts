/** Accountant Mode bank balance: a connected bank's reported balance is used when it is newer than the last statement. */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccountantMetrics, type BankData } from "@/lib/financials/accounting-load";

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[] | { error: { message: string; code?: string } }>) {
  return {
    from(name: string) {
      const t = tables[name] ?? [];
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        then: (res: (v: unknown) => unknown) => Promise.resolve(Array.isArray(t) ? { data: t, error: null } : { data: null, error: t.error }).then(res),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const acct = (id: string) => ({ id, name: id, kind: "checking", last4: "1234", opening_balance: "0", opening_date: "2026-01-01", status: "active" });
const imp = (account_id: string, end: string, bal: string) => ({ id: `i-${account_id}`, account_id, file_name: `${account_id}.csv`, statement_start: null, statement_end: end, opening_balance: null,
  ending_balance: bal, row_count: 1, inserted_count: 1, skipped_count: 0, balanced: true, imported_at: `${end}T12:00:00Z` });
const bank = (accounts: ReturnType<typeof acct>[], imports: ReturnType<typeof imp>[]): BankData =>
  ({ ready: true, accounts, imports, lines: [], reconciliations: [], candidates: [], balances: {} }) as unknown as BankData;
const base = { fin_ar_invoices_v: [], fin_bill_balances_v: [], fin_vendor_bills: [] };

describe("bank-reported balance", () => {
  it("uses a connected bank's balance when there is no statement", async () => {
    const m = await loadAccountantMetrics(fakeDb({ ...base, fin_bank_balances: [{ account_id: "a", current_balance: "1500.25", as_of: "2026-11-18T10:00:00Z" }] }), "b", bank([acct("a")], []), 0);
    expect(m.bankBalance).toMatchObject({ amount: "1500.25", source: "Connected bank", connected: true, asOf: "2026-11-18" });
    expect(m.projected?.amount).toBe("1500.25");
  });
  it("prefers the newer of statement and connected balance, per account", async () => {
    const db = fakeDb({ ...base, fin_bank_balances: [{ account_id: "a", current_balance: "100", as_of: "2026-10-01T00:00:00Z" }, { account_id: "b", current_balance: "50", as_of: "2026-11-18T00:00:00Z" }] });
    const m = await loadAccountantMetrics(db, "b", bank([acct("a"), acct("b")], [imp("a", "2026-10-31", "200"), imp("b", "2026-10-31", "70")]), 0);
    expect(m.bankBalance).toMatchObject({ amount: "250.00", accounts: 2, connected: true, source: "Connected bank and statement balances · 2 accounts" });
  });
  it("falls back to statements when balances can't be read", async () => {
    const m = await loadAccountantMetrics(fakeDb({ ...base, fin_bank_balances: { error: { message: "permission denied" } } }), "b", bank([acct("a")], [imp("a", "2026-10-31", "200")]), 0);
    expect(m.bankBalance).toMatchObject({ amount: "200.00", source: "Statement ending balance · a.csv", connected: false });
  });
});
