/**
 * Read-only bank aggregation adapters (V6.9). Balances + posted transactions only: no transfers, no payments, no
 * account/routing numbers (Plaid's Auth product is never requested). Credentials never pass through Built2Bid: the
 * user signs in to their bank inside the provider's own Link window.
 *
 * Only the mock runs today. The Plaid adapter is written against Plaid's public API (link/token/create,
 * item/public_token/exchange, accounts/balance/get, transactions/sync, item/remove) and stays unreachable until the
 * owner approves Plaid (BANK_PROVIDER=plaid, BANK_PROVIDER_LIVE=true, PLAID_CLIENT_ID/PLAID_SECRET, BANK_TOKEN_KEY).
 */
import { bankProviderMode } from "../isolation";

export type ConnectionStatus = "active" | "needs_reauth" | "revoked" | "institution_down" | "error";

export interface FeedAccount { ref: string; name: string; mask: string | null; kind: "checking" | "savings" | "credit_card" | "other"; subtype: string | null; currency: string }
export interface FeedBalance { ref: string; current: string | null; available: string | null; currency: string; asOf: string }
export interface FeedTxn { ref: string; txnRef: string; date: string; description: string; amount: string; checkNumber?: string | null }

export interface SyncResult {
  status: ConnectionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  historyPartial?: boolean;
  balances: FeedBalance[];
  transactions: FeedTxn[];
  cursor?: string | null;
}

export interface BankProvider {
  name: "mock" | "plaid";
  /** Short-lived token for the provider's secure sign-in window (Plaid Link). Never a bank credential. */
  createLinkToken(userRef: string, opts?: { accessToken?: string }): Promise<{ linkToken: string; expiresAt: string }>;
  /** Exchange the one-time public token from the provider window for a long-lived access token (stored encrypted, server only). */
  exchange(publicToken: string): Promise<{ accessToken: string; itemRef: string; institutionName: string; institutionRef: string | null; accounts: FeedAccount[] }>;
  /**
   * Pull new transactions and balances. `liveBalance` asks the bank for a real-time balance (Plaid's paid Balance
   * product, one billed call); otherwise the balance Plaid already refreshed with Transactions is used at no extra cost.
   */
  sync(accessToken: string, cursor?: string | null, opts?: { liveBalance?: boolean }): Promise<SyncResult>;
  remove(accessToken: string): Promise<void>;
}

// --- Mock ----------------------------------------------------------------------------------------------------
/** Scenarios a test or the sandbox can pick through the mock public token: "mock-public:<scenario>". */
export type MockScenario = "ok" | "two_accounts" | "expired" | "revoked" | "institution_down" | "partial" | "no_balance";

export function mockBankProvider(opts: { today?: string } = {}): BankProvider {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const day = (n: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() - n * 864e5).toISOString().slice(0, 10);
  const scenarioOf = (t: string) => (t.split(":")[1] ?? "ok") as MockScenario;
  return {
    name: "mock",
    async createLinkToken() { return { linkToken: `mock-link-${Math.random().toString(36).slice(2, 10)}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }; },
    async exchange(publicToken) {
      const sc = scenarioOf(publicToken);
      const accounts: FeedAccount[] = [{ ref: "mock-chk", name: "Business Checking", mask: "4821", kind: "checking", subtype: "checking", currency: "USD" }];
      if (sc === "two_accounts") accounts.push({ ref: "mock-sav", name: "Business Savings", mask: "9034", kind: "savings", subtype: "savings", currency: "USD" });
      return { accessToken: `mock-access:${sc}:${Math.random().toString(36).slice(2, 12)}`, itemRef: `mock-item-${Math.random().toString(36).slice(2, 12)}`,
        institutionName: "Sandbox Community Bank (mock)", institutionRef: "ins_mock", accounts };
    },
    async sync(accessToken) {
      const sc = scenarioOf(accessToken);
      if (sc === "expired") return { status: "needs_reauth", errorCode: "ITEM_LOGIN_REQUIRED", errorMessage: "The bank needs you to sign in again.", balances: [], transactions: [] };
      if (sc === "revoked") return { status: "revoked", errorCode: "ACCESS_REVOKED", errorMessage: "Access was revoked at the bank.", balances: [], transactions: [] };
      if (sc === "institution_down") return { status: "institution_down", errorCode: "INSTITUTION_DOWN", errorMessage: "The bank isn't responding right now.", balances: [], transactions: [] };
      const asOf = `${today}T13:00:00.000Z`;
      const balances: FeedBalance[] = sc === "no_balance" ? [] : [{ ref: "mock-chk", current: "42500.00", available: "41250.00", currency: "USD", asOf }];
      const transactions: FeedTxn[] = [
        { ref: "mock-chk", txnRef: "m1", date: day(9), description: "Deposit Pat Rivera", amount: "12000.00" },
        { ref: "mock-chk", txnRef: "m2", date: day(7), description: "Check 1001 Lumber Yard", amount: "-600.00", checkNumber: "1001" },
        { ref: "mock-chk", txnRef: "m3", date: day(5), description: "Gas station", amount: "-45.10" },
        { ref: "mock-chk", txnRef: "m4", date: day(3), description: "Online transfer to savings", amount: "-1000.00" },
      ];
      if (sc === "two_accounts") {
        balances.push({ ref: "mock-sav", current: "8000.00", available: "8000.00", currency: "USD", asOf });
        transactions.push({ ref: "mock-sav", txnRef: "m5", date: day(3), description: "Online transfer from checking", amount: "1000.00" });
      }
      return { status: "active", historyPartial: sc === "partial", balances, transactions, cursor: `mock-cursor-${today}` };
    },
    async remove() { /* nothing to revoke */ },
  };
}

// --- Plaid (read-only products: transactions + balance) ------------------------------------------------------
type Fetch = typeof fetch;
const PLAID_HOSTS = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" } as const;
const plaidStatus = (code: string | undefined): ConnectionStatus =>
  code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION" ? "needs_reauth" : code === "ACCESS_NOT_GRANTED" || code === "USER_PERMISSION_REVOKED" ? "revoked"
    : code === "INSTITUTION_DOWN" || code === "INSTITUTION_NOT_RESPONDING" || code === "INSTITUTION_NOT_AVAILABLE" ? "institution_down" : "error";

export function plaidProvider(cfg: { clientId: string; secret: string; env: "sandbox" | "production"; webhookUrl?: string }, f: Fetch = fetch): BankProvider {
  const host = PLAID_HOSTS[cfg.env];
  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const r = await f(`${host}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, ...body }), signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({})) as T & { error_code?: string; error_message?: string };
    if (!r.ok) throw Object.assign(new Error(j.error_code ?? `plaid_${r.status}`), { code: j.error_code, plaidMessage: j.error_message });
    return j;
  }
  const kind = (t: string, s: string | null): FeedAccount["kind"] => s === "checking" ? "checking" : s === "savings" ? "savings" : t === "credit" ? "credit_card" : "other";
  return {
    name: "plaid",
    async createLinkToken(userRef, opts) {
      const r = await call<{ link_token: string; expiration: string }>("/link/token/create", {
        client_name: "Built2Bid", language: "en", country_codes: ["US"], user: { client_user_id: userRef },
        ...(opts?.accessToken ? { access_token: opts.accessToken } : { products: ["transactions"] }),   // update mode for reconnects
        ...(cfg.webhookUrl ? { webhook: cfg.webhookUrl } : {}),
      });
      return { linkToken: r.link_token, expiresAt: r.expiration };
    },
    async exchange(publicToken) {
      const ex = await call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
      const acc = await call<{ accounts: { account_id: string; name: string; official_name?: string; mask: string | null; type: string; subtype: string | null; balances: { iso_currency_code?: string } }[]; item: { institution_id?: string } }>("/accounts/get", { access_token: ex.access_token });
      let institutionName = "Your bank";
      if (acc.item.institution_id) {
        const ins = await call<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: acc.item.institution_id, country_codes: ["US"] }).catch(() => null);
        if (ins) institutionName = ins.institution.name;
      }
      return { accessToken: ex.access_token, itemRef: ex.item_id, institutionName, institutionRef: acc.item.institution_id ?? null,
        accounts: acc.accounts.map((a) => ({ ref: a.account_id, name: a.official_name || a.name, mask: a.mask && /^\d{4}$/.test(a.mask) ? a.mask : null, kind: kind(a.type, a.subtype), subtype: a.subtype, currency: a.balances.iso_currency_code ?? "USD" })) };
    },
    async sync(accessToken, cursor, opts) {
      try {
        // Daily sync: /accounts/get returns the balance cached with Transactions (no Balance charge).
        // Manual refresh: /accounts/balance/get asks the bank in real time (billed per call).
        const bal = await call<{ accounts: { account_id: string; balances: { current: number | null; available: number | null; iso_currency_code?: string; last_updated_datetime?: string | null } }[] }>(opts?.liveBalance ? "/accounts/balance/get" : "/accounts/get", { access_token: accessToken });
        const txns: FeedTxn[] = [];
        let next = cursor ?? null; let more = true; let pages = 0;
        while (more && pages < 10) {
          const t = await call<{ added: { account_id: string; transaction_id: string; date: string; name: string; merchant_name?: string | null; amount: number; pending: boolean; check_number?: string | null }[]; has_more: boolean; next_cursor: string }>("/transactions/sync", { access_token: accessToken, ...(next ? { cursor: next } : {}), count: 500 });
          // Plaid amounts are positive for money OUT; Built2Bid stores + in / - out. Pending lines are skipped (they post later with a new id).
          for (const x of t.added) if (!x.pending) txns.push({ ref: x.account_id, txnRef: x.transaction_id, date: x.date, description: x.merchant_name || x.name, amount: (-x.amount).toFixed(2), checkNumber: x.check_number ?? null });
          next = t.next_cursor; more = t.has_more; pages++;
        }
        const money = (n: number | null) => (n === null || n === undefined ? null : n.toFixed(2));
        return { status: "active", historyPartial: more, cursor: next, transactions: txns,
          balances: bal.accounts.map((a) => ({ ref: a.account_id, current: money(a.balances.current), available: money(a.balances.available), currency: a.balances.iso_currency_code ?? "USD", asOf: a.balances.last_updated_datetime ?? new Date().toISOString() })) };
      } catch (e) {
        const code = (e as { code?: string }).code;
        return { status: plaidStatus(code), errorCode: code ?? "provider_error", errorMessage: (e as { plaidMessage?: string }).plaidMessage ?? null, balances: [], transactions: [] };
      }
    },
    async remove(accessToken) { await call("/item/remove", { access_token: accessToken }); },
  };
}

export function resolveBankProvider(env: Record<string, string | undefined> = process.env, opts: { sandbox?: boolean } = {}): BankProvider | null {
  const mode = bankProviderMode(env, opts);
  if (mode === "mock") return mockBankProvider();
  if (mode === "plaid") return plaidProvider({ clientId: env.PLAID_CLIENT_ID!, secret: env.PLAID_SECRET!, env: env.PLAID_ENV === "production" ? "production" : "sandbox", webhookUrl: env.PLAID_WEBHOOK_URL });
  return null;
}

/** Plaid errors carry an UPPER_CASE error_code. Map them to plain words; never show Plaid's raw text to customers. */
export function plaidFailure(e: unknown): { code: string; message: string; detail: string | undefined } | null {
  const x = e as { code?: unknown; plaidMessage?: unknown } | null;
  if (!x || typeof x.code !== "string" || !/^[A-Z_]+$/.test(x.code)) return null;
  const detail = typeof x.plaidMessage === "string" ? x.plaidMessage.slice(0, 300) : undefined;
  if (/^INSTITUTION_/.test(x.code)) return { code: "bank_unavailable", message: "Your bank isn't responding right now. Nothing was changed. Please try again later.", detail };
  if (x.code === "RATE_LIMIT_EXCEEDED" || x.code === "PRODUCTS_NOT_READY") return { code: "bank_busy", message: "The bank connection service is busy. Nothing was changed. Please try again in a few minutes.", detail };
  return { code: "bank_setup", message: "Bank connections are temporarily unavailable while Built2Bid finishes setup with Plaid, our bank connection partner. Nothing was changed. Please try again later.", detail };
}
