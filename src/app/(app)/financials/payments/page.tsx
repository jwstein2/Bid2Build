import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { Badge, Notice } from "@/components/ui/misc";
import { accountState, ACCOUNT_STATE_LABEL, connectMode, surchargeAllowed } from "@/lib/financials/connect";
import { businessState, getPaymentAccount, refreshAccount, surchargeSettingsOf } from "@/lib/financials/connect-server";
import { noticeReadyOn, surchargeDecision } from "@/lib/financials/surcharge";
import { PaymentsSetup } from "@/components/financials/payments-setup";
import { fmtWhen } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Online payments", robots: { index: false } };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  open: { label: "Started, not paid", tone: "neutral" }, processing: { label: "Bank payment clearing", tone: "warn" },
  succeeded: { label: "Paid", tone: "ok" }, failed: { label: "Failed", tone: "danger" }, expired: { label: "Not completed", tone: "neutral" },
  refunded: { label: "Refunded in Stripe", tone: "warn" }, partially_refunded: { label: "Partly refunded in Stripe", tone: "warn" }, disputed: { label: "Disputed", tone: "danger" },
};

/** Online invoice payments: the contractor's own Stripe account, card / bank settings and recent online payments. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "Online payments" }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<h1 className="text-3xl font-extrabold">Online payments</h1><FinStateNotice state={state} /></div>;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  if (!perms.includes("view_company_financials")) notFound();
  const mode = connectMode();
  const canManage = ctx.access.active && !ctx.access.readOnly && perms.includes("manage_financial_config");
  let account = mode === "off" || ctx.access.sandbox ? null : await getPaymentAccount(ctx.bookId).catch(() => null);
  if (account && sp.stripe === "return") account = (await refreshAccount(ctx.bookId).catch(() => null)) ?? account;
  const home = account ? await businessState(ctx.bookId).catch(() => null) : null;
  const homeDecision = surchargeDecision(home, home);
  const st = accountState(account ? { ...account, requirements: { currently_due: account.requirements_due, disabled_reason: account.disabled_reason } } : null);
  const { data: recent } = account
    ? await createAdminClient().from("fin_online_payments").select("id, amount, method, status, created_at, settled_at, refunded_amount, surcharge_amount, fin_invoices(number)")
        .eq("book_id", ctx.bookId).neq("status", "open").order("created_at", { ascending: false }).limit(25)
    : { data: [] };
  type Row = { id: string; amount: string; method: string | null; status: string; created_at: string; refunded_amount: string; surcharge_amount?: string | null; fin_invoices: { number: string | null } | null };
  const rows = (recent ?? []) as unknown as Row[];
  const attention = rows.filter((r) => ["refunded", "partially_refunded", "disputed", "failed"].includes(r.status));

  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="fin-payments">
      {crumbs}
      <h1 className="text-3xl font-extrabold">Online payments</h1>
      <p className="text-ink-soft">Let customers pay invoices by card or straight from their bank. Money goes to your own Stripe account and on to your bank. Built2Bid takes no fee. You pay only Stripe&apos;s standard processing fees.</p>
      {ctx.access.sandbox && <Notice title="Practice books">Practice books can&apos;t take real payments. Switch back to your real books to set this up.</Notice>}
      {mode === "off" && <Notice title="Coming soon">Online invoice payments are being switched on. You&apos;ll be able to connect your Stripe account here.</Notice>}
      {mode === "test" && <Notice title="Stripe test mode">This copy of Built2Bid uses Stripe test mode. Use Stripe&apos;s test card 4242 4242 4242 4242. No real money moves.</Notice>}
      {mode !== "off" && !ctx.access.sandbox && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-labelledby="pay-acct-h">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="pay-acct-h" className="font-display text-lg font-extrabold">Your Stripe account</h2>
            <Badge tone={st === "ready" ? "ok" : st === "restricted" ? "danger" : st === "not_started" ? "neutral" : "warn"}>{ACCOUNT_STATE_LABEL[st]}</Badge>
            {account?.status_synced_at && <span className="text-xs text-muted">Checked {fmtWhen(account.status_synced_at)}</span>}
          </div>
          <PaymentsSetup canManage={canManage} state={st} hasAccount={Boolean(account)} surchargeAllowed={surchargeAllowed()}
            surchargeState={{ code: home, ok: homeDecision.ok, maxPct: homeDecision.maxPct, reasons: homeDecision.reasons, notes: homeDecision.rules.map((r) => r.summary) }}
            settings={account ? (() => { const x = surchargeSettingsOf(account); return {
              cardEnabled: account.card_enabled, achEnabled: account.ach_enabled, cardFeePayer: account.card_fee_payer,
              surchargePct: x.pct, cardCostPct: x.costPct, cardCostFixedCents: x.costFixedCents, surchargeNoticeDate: x.noticeDate ?? "", surchargeAttested: x.attested,
              noticeReadyOn: noticeReadyOn(x.noticeDate) }; })() : null} />
        </section>
      )}
      <section className="rounded-xl border border-line bg-surface p-4 text-sm" aria-labelledby="pay-fees-h">
        <h2 id="pay-fees-h" className="font-display text-lg font-extrabold">What it costs</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
          <li>Card: Stripe&apos;s standard rate (2.9% + 30¢ in the US), paid by you.</li>
          <li>Bank (ACH): 0.8%, capped at $5 per payment. On a $10,000 invoice that&apos;s $5 instead of about $290 by card.</li>
          <li>Built2Bid fee: none.</li>
        </ul>
        <p className="mt-2 text-xs text-muted">Stripe sets and may change its rates. Your Stripe Dashboard shows the exact fee on every payment.</p>
      </section>
      {attention.length > 0 && <Notice tone="warn" title="Needs attention">{attention.length} online payment{attention.length === 1 ? " was" : "s were"} refunded, disputed or failed in Stripe. Record any refund in Financials so invoice balances stay right.</Notice>}
      {account && (
        <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="pay-recent-h">
          <h2 id="pay-recent-h" className="font-display text-lg font-extrabold">Recent online payments</h2>
          {!rows.length ? <p className="mt-2 text-sm text-ink-soft">None yet. On any issued invoice, use <strong>Pay online link</strong> to get a link for your customer.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {rows.map((r) => {
                const s = STATUS[r.status] ?? STATUS.open;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-semibold">Invoice {r.fin_invoices?.number ?? ""}</span>
                    <span className="tabular">{Number(r.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
                    <span className="text-muted">{r.method === "ach" ? "Bank" : r.method === "card" ? "Card" : ""}</span>
                    {Number(r.surcharge_amount ?? 0) > 0 && <span className="text-xs text-muted">+ {Number(r.surcharge_amount).toLocaleString("en-US", { style: "currency", currency: "USD" })} card surcharge</span>}
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <span className="ml-auto text-xs text-muted">{fmtWhen(r.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
