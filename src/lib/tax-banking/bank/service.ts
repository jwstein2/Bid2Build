import "server-only";
/**
 * Server side of bank linking (V6.9). The user's client does every permission-checked write (connection rows,
 * disconnect, refresh gate); the service-role client only stores/reads the sealed token and records provider sync
 * results. Tokens never leave this module.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { bankProviderMode, isProductionDeploy } from "../isolation";
import { resolveBankProvider, type BankProvider, mockBankProvider } from "./providers";
import { MOCK_TOKEN_KEY, openToken, sealToken } from "./token-crypto";

type Db = SupabaseClient;
export class BankError extends Error { constructor(public code: string) { super(code); } }

const keyFor = (provider: string) => (provider === "mock" ? MOCK_TOKEN_KEY : process.env.BANK_TOKEN_KEY);
export const practiceMode = (sandboxBook: boolean) => sandboxBook || !isProductionDeploy();

/** Plaid's test environment (PLAID_ENV other than "production") only ever serves practice books: previews share the real database. */
const plaidTestOnly = (name: string | undefined, sandboxBook: boolean) => name === "plaid" && process.env.PLAID_ENV !== "production" && !sandboxBook;

export function providerFor(sandboxBook: boolean): BankProvider | null {
  const p = resolveBankProvider(process.env, { sandbox: practiceMode(sandboxBook) });
  return p && plaidTestOnly(p.name, sandboxBook) ? null : p;
}
/** What the Connected banks page offers: "none" (Coming soon), "mock" (practice bank) or "plaid". */
export function bankModeFor(sandboxBook: boolean): "none" | "mock" | "plaid" {
  const m = bankProviderMode(process.env, { sandbox: practiceMode(sandboxBook) });
  return plaidTestOnly(m, sandboxBook) ? "none" : m;
}
const providerByName = (name: string, sandboxBook: boolean) => (name === "mock" ? mockBankProvider() : providerFor(sandboxBook));

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new BankError(error.message.split(/\s/)[0] || "rpc_failed");
  return data as T;
}

export async function startLink(db: Db, bookId: string, userId: string, sandboxBook: boolean) {
  if (!(await rpc<boolean>(db, "tb_can", { p_book_id: bookId, p_cap: "bank.connect", p_write: true }))) throw new BankError("forbidden");
  const p = providerFor(sandboxBook);
  if (!p) throw new BankError("provider_not_approved");
  const t = await p.createLinkToken(userId);
  return { provider: p.name, linkToken: t.linkToken, expiresAt: t.expiresAt };
}

export async function finishLink(db: Db, bookId: string, sandboxBook: boolean, publicToken: string) {
  const p = providerFor(sandboxBook);
  if (!p) throw new BankError("provider_not_approved");
  const ex = await p.exchange(publicToken);
  const created = await rpc<{ connectionId: string }>(db, "fin_bank_connection_create", { p_book_id: bookId, p: {
    provider: p.name, itemRef: ex.itemRef, institutionName: ex.institutionName, institutionRef: ex.institutionRef, sandbox: p.name === "mock",
    accounts: ex.accounts.map((a) => ({ ref: a.ref, name: a.name, mask: a.mask, kind: a.kind, subtype: a.subtype, currency: a.currency })) } });
  const admin = createAdminClient();
  const { error } = await admin.from("fin_bank_connection_secrets").insert({ connection_id: created.connectionId, token_ciphertext: sealToken(ex.accessToken, keyFor(p.name)) });
  if (error) throw new BankError("token_store_failed");
  const sync = await syncConnection(created.connectionId, p, ex.accessToken);
  return { connectionId: created.connectionId, sync };
}

async function readToken(connectionId: string, provider: string) {
  const { data } = await createAdminClient().from("fin_bank_connection_secrets").select("token_ciphertext").eq("connection_id", connectionId).maybeSingle();
  if (!data) throw new BankError("needs_reconnect");
  return openToken(String((data as { token_ciphertext: string }).token_ciphertext), keyFor(provider));
}

async function syncConnection(connectionId: string, p: BankProvider, accessToken: string, liveBalance = false) {
  const r = await p.sync(accessToken, null, { liveBalance });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fin_bank_feed_ingest", { p_connection_id: connectionId, p: r });
  if (error) throw new BankError(error.message.split(/\s/)[0]);
  // Count billed real-time balance calls for the owner's Plaid cost estimate (best effort, never blocks the refresh).
  if (liveBalance && p.name === "plaid" && r.status === "active") {
    try {
      const { data: c } = await admin.from("fin_bank_connections").select("book_id").eq("id", connectionId).maybeSingle();
      if (c) await admin.from("fin_audit_log").insert({ book_id: (c as { book_id: string }).book_id, action: "bank.balance_live", entity_type: "bank_connection", entity_id: connectionId });
    } catch { /* metering only */ }
  }
  return data as { status: string; inserted: number; balances: number };
}

/** Manual "Refresh bank balance": permission + rate limit checked by the database first. */
export async function refresh(db: Db, connectionId: string, sandboxBook: boolean) {
  const gate = await rpc<{ provider: string }>(db, "fin_bank_refresh_allowed", { p_connection_id: connectionId });
  const p = providerByName(gate.provider, sandboxBook);
  if (!p) throw new BankError("provider_not_approved");
  return syncConnection(connectionId, p, await readToken(connectionId, gate.provider), true);
}

/** Reconnect, step 1 (real providers): a link token in update mode for this connection's existing access. */
export async function reconnectLink(db: Db, connectionId: string, userId: string, sandboxBook: boolean) {
  const gate = await rpc<{ provider: string; bookId: string }>(db, "fin_bank_refresh_allowed", { p_connection_id: connectionId });
  if (!(await rpc<boolean>(db, "tb_can", { p_book_id: gate.bookId, p_cap: "bank.connect", p_write: true }))) throw new BankError("forbidden");
  if (gate.provider === "mock") return { provider: "mock", linkToken: null };
  const p = providerByName(gate.provider, sandboxBook);
  if (!p) throw new BankError("provider_not_approved");
  const t = await p.createLinkToken(userId, { accessToken: await readToken(connectionId, gate.provider) });
  return { provider: p.name, linkToken: t.linkToken };
}

/** After the user re-authenticates in the provider window (update mode). The mock simply issues a healthy token. */
export async function reconnect(db: Db, connectionId: string, sandboxBook: boolean) {
  const gate = await rpc<{ provider: string; bookId: string }>(db, "fin_bank_refresh_allowed", { p_connection_id: connectionId });
  if (!(await rpc<boolean>(db, "tb_can", { p_book_id: gate.bookId, p_cap: "bank.connect", p_write: true }))) throw new BankError("forbidden");
  const p = providerByName(gate.provider, sandboxBook);
  if (!p) throw new BankError("provider_not_approved");
  let token = await readToken(connectionId, gate.provider).catch(() => null);
  if (gate.provider === "mock") {
    token = `mock-access:ok:${Math.random().toString(36).slice(2, 12)}`;
    await createAdminClient().from("fin_bank_connection_secrets").upsert({ connection_id: connectionId, token_ciphertext: sealToken(token, keyFor("mock")), updated_at: new Date().toISOString() });
  }
  if (!token) throw new BankError("needs_reconnect");
  return syncConnection(connectionId, p, token);
}

export async function disconnect(db: Db, connectionId: string, reason: string | null, sandboxBook: boolean) {
  const { data: c } = await db.from("fin_bank_connections").select("provider").eq("id", connectionId).maybeSingle();
  if (!c) throw new BankError("not_found");
  const provider = String((c as { provider: string }).provider);
  // Revoke at the provider first (best effort), then the database destroys the stored token.
  try { const p = providerByName(provider, sandboxBook); const t = await readToken(connectionId, provider); await p?.remove(t); } catch { /* token already gone or provider down */ }
  await rpc(db, "fin_bank_connection_disconnect", { p_connection_id: connectionId, p_reason: reason });
}

/** Daily job: sync every active connection (service role). */
export async function syncAll(limit = 500) {
  const admin = createAdminClient();
  const { data } = await admin.from("fin_bank_connections").select("id, provider, sandbox").in("status", ["active", "institution_down", "error"]).lte("next_sync_at", new Date().toISOString()).limit(limit);
  const out = { ok: 0, failed: 0 };
  for (const c of (data ?? []) as { id: string; provider: string; sandbox: boolean }[]) {
    try {
      const p = providerByName(c.provider, c.sandbox);
      if (!p) { out.failed++; continue; }
      const r = await syncConnection(c.id, p, await readToken(c.id, c.provider));
      if (r.status === "active") out.ok++; else out.failed++;
    } catch { out.failed++; }
  }
  return out;
}
