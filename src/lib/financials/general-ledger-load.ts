import "server-only";
/**
 * General ledger reads for the Accounting pages and CSV exports. Everything goes through the caller's own client:
 * the RPCs re-check "view company financials", and the tables' RLS does the same.
 */
import { isMissing } from "./loaders";
import type { GlBalance, GlType } from "./general-ledger";

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

export interface GlAccount { id: string; code: string; name: string; type: GlType; system_key: string | null; description: string | null; active: boolean }
export interface GlEntry { id: string; entry_date: string; memo: string; source_type: string; source_ref: string; event_kind: string; reverses: string | null; posted_at: string;
  lines: { account_id: string; debit: string; credit: string; job_id: string | null; description: string | null }[] }
export interface GlActivity { entry_id: string; entry_date: string; memo: string; source_type: string; event_kind: string; debit: string; credit: string; job_id: string | null; description: string | null; running: string }

/** Bring the ledger up to date (idempotent). Returns false when the general-ledger SQL isn't installed yet. */
export async function syncLedger(db: Db, bookId: string): Promise<{ ready: boolean; posted: number }> {
  const { data, error } = await db.rpc("fin_gl_sync", { p_book_id: bookId });
  if (error) {
    if (isMissing(error)) return { ready: false, posted: 0 };
    throw new Error(error.message);
  }
  return { ready: true, posted: Number(data ?? 0) };
}

export async function loadBalances(db: Db, bookId: string, from: string | null, to: string | null): Promise<GlBalance[]> {
  const { data, error } = await db.rpc("fin_gl_balances", { p_book_id: bookId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as GlBalance[];
}

export async function loadAccounts(db: Db, bookId: string): Promise<GlAccount[]> {
  const { data } = await db.from("fin_gl_accounts").select("id, code, name, type, system_key, description, active").eq("book_id", bookId).order("code");
  return (data ?? []) as GlAccount[];
}

export async function loadActivity(db: Db, bookId: string, accountId: string, from: string | null, to: string | null): Promise<GlActivity[]> {
  const { data, error } = await db.rpc("fin_gl_activity", { p_book_id: bookId, p_account_id: accountId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as GlActivity[];
}

/** Journal entries in a date range, newest first, with their lines. */
export async function loadJournal(db: Db, bookId: string, from: string, to: string, limit = 200): Promise<GlEntry[]> {
  const { data } = await db.from("fin_journal_entries")
    .select("id, entry_date, memo, source_type, source_ref, event_kind, reverses, posted_at, lines:fin_journal_lines(account_id, debit, credit, job_id, description)")
    .eq("book_id", bookId).gte("entry_date", from).lte("entry_date", to)
    .order("entry_date", { ascending: false }).order("posted_at", { ascending: false }).limit(limit);
  return (data ?? []) as GlEntry[];
}

export async function loadLockedThrough(db: Db, bookId: string): Promise<string | null> {
  const { data } = await db.from("fin_books").select("locked_through").eq("id", bookId).maybeSingle();
  return (data as { locked_through: string | null } | null)?.locked_through ?? null;
}

/** Entries already reversed (so the Reverse button is hidden). */
export async function loadReversedIds(db: Db, bookId: string): Promise<Set<string>> {
  const { data } = await db.from("fin_journal_entries").select("reverses").eq("book_id", bookId).not("reverses", "is", null).limit(5000);
  return new Set(((data ?? []) as { reverses: string }[]).map((r) => r.reverses));
}
