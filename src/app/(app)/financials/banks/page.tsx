import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { Badge, Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { TbShell } from "@/components/tax-banking/shell";
import { ConnectBank, ConnectionActions, SetPrimary } from "@/components/tax-banking/banks";
import { can } from "@/lib/tax-banking/capabilities";
import { loadBanks } from "@/lib/tax-banking/load";
import { bankModeFor } from "@/lib/tax-banking/bank/service";
import { fmtWhen } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Connected banks", robots: { index: false } };
const STALE_HOURS = 36;
const olderThanHours = (ts: string | null, h: number) => !ts || Date.now() - new Date(ts).getTime() > h * 3600e3;
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; help?: string }> = {
  active: { label: "Connected", tone: "ok" },
  needs_reauth: { label: "Needs reconnect", tone: "warn", help: "The bank needs you to sign in again in its secure window. Use Reconnect. Nothing was lost." },
  revoked: { label: "Access removed at the bank", tone: "danger", help: "Access was removed from the bank's side. Reconnect to resume updates." },
  institution_down: { label: "Bank temporarily unavailable", tone: "warn", help: "The bank isn't answering right now. Balances shown are from the last update; we'll retry automatically." },
  error: { label: "Update failed", tone: "danger", help: "The last update failed. Try Refresh, or Reconnect if it keeps failing." },
  disconnected: { label: "Disconnected", tone: "neutral", help: "Updates stopped. Past bank lines and reconciliations are kept." },
};

/**
 * Connected Banks (Company Settings → Financials). Read-only: balances and transactions only, through a provider's
 * secure window. Built2Bid never asks for a bank login, never stores full account or routing numbers, and can't move money.
 */
export default async function BanksPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const shell = { state, title: "Connected banks", active: "banks" as const, cap: "bank.view_balances" as const };
  if (state.kind !== "ready" || !can(state.ctx.access.permissions, "bank.view_balances")) return <TbShell {...shell} />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const writable = ctx.access.active && !ctx.access.readOnly;
  const canManage = writable && can(perms, "bank.connect");
  const canRefresh = writable && can(perms, "bank.view_balances");
  const b = await loadBanks(db, ctx.bookId);
  if (!b.installed) return <TbShell {...shell}><Notice title="Connected banks turn on after the database update">The V6.9 SQL (20261226001000) hasn&apos;t been installed on this database yet. Statement import still works.</Notice></TbShell>;
  const mode = bankModeFor(Boolean(ctx.access.sandbox));
  const live = b.connections.filter((c) => c.status !== "disconnected");
  const past = b.connections.filter((c) => c.status === "disconnected");
  const manual = b.accounts.filter((a) => a.source !== "provider_feed" && a.status === "active");

  return (
    <TbShell {...shell}
      intro="Connect your business bank to see bank-reported balances and bring transactions into reconciliation automatically. Read-only: Built2Bid can't move money, never asks for your bank login, and stores only the last 4 digits of an account."
      actions={<div className="flex flex-wrap items-start gap-2"><ConnectBank mode={mode} canConnect={canManage} laterHref={sp.onboarding ? "/financials" : undefined} /><ButtonLink href="/financials/accounting/bank" variant="secondary" data-testid="banks-upload-statement">Upload a bank statement</ButtonLink></div>}>
      {mode === "plaid" && ctx.access.sandbox && process.env.PLAID_ENV !== "production" && <Notice title="Plaid test mode">This practice book uses Plaid&apos;s test banks. Sign in with user_good / pass_good. No real bank is contacted.</Notice>}
      {live.some((c) => c.sandbox) && (
        <Notice title="Simulation — no real transaction" tone="warn">
          This is a simulated bank with made-up sample data. It is not a real bank connection: no bank login, account number, token or money is involved,
          and it never contacts a bank. Create a free account and connect your own bank in your real books to see your actual balances.
        </Notice>
      )}
      {mode === "mock" && !live.some((c) => c.sandbox) && <Notice title="Practice mode">Bank connections here use a practice bank with made-up data. Real banks connect only in your real books after the owner approves a provider.</Notice>}
      {!live.length && (
        <div className="rounded-xl border border-dashed border-line p-6 text-center">
          <p className="font-display text-lg font-extrabold">No bank connected yet</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-ink-soft">You can still import statements under Accounting → Reconciliation. Connecting adds daily balance updates and a cash-flow forecast that starts from your real bank balance.</p>
        </div>
      )}
      {live.map((c) => {
        const st = STATUS[c.status] ?? STATUS.error;
        const accts = b.accounts.filter((a) => a.connectionId === c.id);
        const stale = olderThanHours(c.lastSuccessAt, STALE_HOURS);
        return (
          <section key={c.id} aria-labelledby={`conn-${c.id}`} className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="bank-connection">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`conn-${c.id}`} className="font-display text-lg font-extrabold">{c.institution}</h2>
              <Badge tone={st.tone}>{st.label}</Badge>
              {c.sandbox && <Badge tone="warn">Simulated bank · not a real account</Badge>}
              {c.historyPartial && <Badge tone="warn">Partial history</Badge>}
              <span className="text-sm text-muted">Last updated {c.lastSuccessAt ? fmtWhen(c.lastSuccessAt) : "never"}</span>
            </div>
            {st.help && <p className="text-sm text-ink-soft">{st.help}{c.errorMessage ? ` (${c.errorMessage})` : ""}</p>}
            {stale && c.status === "active" && !c.sandbox && <p className="text-sm text-warn">This balance is more than {STALE_HOURS} hours old. Refresh to update it.</p>}
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {accts.map((a) => (
                <li key={a.id} className="rounded-lg border border-line p-3">
                  <p className="font-semibold">{a.name}{a.last4 ? ` ••${a.last4}` : ""} {a.isPrimary && <Badge tone="brand">Primary</Badge>}</p>
                  <p className="text-xs text-muted">{a.kind.replace(/_/g, " ")}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
                    <dt className="text-muted">Bank-reported</dt><dd className="text-right font-semibold tabular-nums">{a.current !== null ? formatCurrency(a.current) : "Not reported"}</dd>
                    <dt className="text-muted">Available</dt><dd className="text-right tabular-nums">{a.available !== null ? formatCurrency(a.available) : "—"}</dd>
                  </dl>
                  <p className="mt-1 text-xs text-muted">{a.asOf ? `As of ${fmtWhen(a.asOf)}` : "No balance yet"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={`/financials/accounting/bank?account=${a.id}`} className="inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">Reconcile</a>
                    {canManage && !a.isPrimary && <SetPrimary accountId={a.id} />}
                  </div>
                </li>
              ))}
            </ul>
            {c.sandbox
              ? <p className="text-sm text-muted">Sample feed for practice: it doesn&apos;t refresh or reconnect, and nothing here moves money.</p>
              : <ConnectionActions id={c.id} status={c.status} canWrite={canRefresh} canManage={canManage} />}
          </section>
        );
      })}
      {manual.length > 0 && (
        <section aria-labelledby="manual-h" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="manual-h" className="font-display text-base font-extrabold">Accounts from statement imports</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{manual.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2"><span className="font-semibold">{a.name}{a.last4 ? ` ••${a.last4}` : ""}</span><span className="text-muted">Balance comes from imported statements</span><a href={`/financials/accounting/bank?account=${a.id}`} className="ml-auto text-accent-ink underline">Open</a></li>)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-semibold">Disconnected ({past.length})</summary>
          <ul className="mt-2 text-sm">{past.map((c) => <li key={c.id} className="py-1">{c.institution} <span className="text-muted">· connected {fmtWhen(c.createdAt)}</span></li>)}</ul></details>
      )}
      <p className="text-xs text-muted">Bank-reported balances come straight from your bank and can differ from your books until every line is matched. Disconnecting removes Built2Bid&apos;s access token and keeps your history.</p>
    </TbShell>
  );
}
