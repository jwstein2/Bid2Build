import { Panel, Chip, Empty, Mini, Table } from "@/components/admin/cc";
import { money } from "@/lib/payouts/labels";
import { qbConfigured } from "@/lib/quickbooks/config";
import { QB_BLOCKER } from "@/lib/quickbooks/payout-bills";
import { candidates, expenseAccounts, platformConnection, recentBills } from "@/lib/quickbooks/platform";
import type { createAdminClient } from "@/lib/supabase/server";
import { qbCheckPaid, qbDisconnect, qbSendBills, qbSetAccount } from "./qb-actions";

const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";
const STATUS_TONE = { open: "amber", paid: "green", failed: "red", voided: "muted", sending: "blue" } as const;

/**
 * Admin → Payments & Payouts → QuickBooks: pay sales-rep commission statements and affiliate commissions as bills in
 * Built2Bid's own QuickBooks company. The owner pays the bills in QuickBooks; paid bills mark the payouts paid here.
 */
export async function QuickBooksTab({ db, owner }: { db: ReturnType<typeof createAdminClient>; owner: boolean }) {
  const c = await platformConnection(db).catch(() => null);
  const [list, bills, accounts] = await Promise.all([
    c ? candidates(db, c.environment) : Promise.resolve(null),
    recentBills(db).catch(() => []),
    c && c.status === "active" && owner ? expenseAccounts(db, c).catch(() => null) : Promise.resolve(null),
  ]);
  const ready = list?.items.filter((i) => i.blockers.length === 0) ?? [];
  const blocked = list?.items.filter((i) => i.blockers.length > 0) ?? [];
  const open = bills.filter((b) => b.status === "open");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini label="Ready to bill" value={money(ready.reduce((n, i) => n + i.amountCents, 0))} tone="blue" />
        <Mini label="Needs setup first" value={blocked.length} tone={blocked.length ? "amber" : "muted"} />
        <Mini label="Open bills in QuickBooks" value={money(open.reduce((n, b) => n + b.amount_cents, 0))} tone="violet" />
        <Mini label="Paid through QuickBooks" value={money(bills.filter((b) => b.status === "paid" && b.environment === "production").reduce((n, b) => n + b.amount_cents, 0))} tone="green" />
      </div>

      <Panel title="Built2Bid's QuickBooks company">
        {!qbConfigured() ? <p className="text-sm text-[var(--cc-amber)]">QuickBooks keys aren&apos;t set on the server yet (QBO_CLIENT_ID, QBO_CLIENT_SECRET, BANK_TOKEN_KEY).</p>
          : !c ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink-soft">Connect the QuickBooks Online company Built2Bid pays its reps and affiliates from. Each rep and affiliate becomes a 1099 vendor, and each approved statement or commission becomes a bill you pay with QuickBooks Bill Pay.</p>
              {owner ? <a href="/api/admin/quickbooks/connect" className={btn}>Connect QuickBooks</a> : <p className="text-xs text-ink-soft">Only the owner can connect QuickBooks.</p>}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white">{c.companyName ?? `Company ${c.realmId}`}</span>
                <Chip tone={c.environment === "production" ? "green" : "blue"}>{c.environment === "production" ? "LIVE BOOKS" : "SANDBOX (practice)"}</Chip>
                {c.status === "needs_reauth" && <Chip tone="red">SIGN IN AGAIN</Chip>}
              </div>
              {c.status === "needs_reauth" && owner && <a href="/api/admin/quickbooks/connect" className={btn}>Reconnect QuickBooks</a>}
              {c.environment === "sandbox" && <p className="text-xs text-ink-soft">Sandbox bills are practice: paying them in the sandbox doesn&apos;t mark any real statement or commission paid.</p>}
              {owner && accounts && (
                <form action={qbSetAccount} className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-ink-soft" htmlFor="qb-account">Book payouts to</label>
                  <select id="qb-account" name="account" defaultValue={c.expenseAccountId ?? ""} className="field field-sm">
                    <option value="" disabled>Choose an expense account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button className={btn}>Save</button>
                </form>
              )}
              {!owner && <p className="text-xs text-ink-soft">Expense account: {c.expenseAccountName ?? "not chosen"}</p>}
              <div className="flex flex-wrap gap-2">
                <form action={qbCheckPaid}><button className={btn}>Check for paid bills now</button></form>
                {owner && (
                  <form action={qbDisconnect} className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" name="confirm" /> Confirm</label>
                    <button className={btn}>Disconnect</button>
                  </form>
                )}
              </div>
              <p className="text-[11px] text-ink-soft">Paid bills are also checked automatically every day.{c.lastCheckAt ? ` Last check ${new Date(c.lastCheckAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT.` : ""}</p>
            </div>
          )}
      </Panel>

      {c && list && (
        <Panel title="Ready to send to QuickBooks">
          {list.automationLive ? <p className="text-sm text-[var(--cc-amber)]">Automatic payouts are live. Turn them off before paying through QuickBooks, so nobody is paid twice.</p>
            : ready.length === 0 ? <Empty>Nothing approved and unpaid right now.</Empty> : (
              <form action={qbSendBills} className="space-y-3">
                <Table head={["", "Payee", "For", "Amount"]} align={["l", "l", "l", "r"]}>
                  {ready.map((i) => (
                    <tr key={i.sourceId}>
                      <td><input type="checkbox" name="source" value={i.sourceId} defaultChecked aria-label={`Bill ${i.payeeName}`} /></td>
                      <td className="text-white">{i.payeeName}<span className="ml-2 text-[11px] text-ink-soft">{i.payeeKind === "affiliate" ? "Affiliate" : "Sales rep"}</span></td>
                      <td className="text-xs text-ink-soft">{i.description}</td>
                      <td className="text-right text-white">{money(i.amountCents)}</td>
                    </tr>
                  ))}
                </Table>
                {owner ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" name="confirm" /> Create these as bills in {c.environment === "production" ? "Built2Bid's live QuickBooks" : "the QuickBooks sandbox"}</label>
                    <button className={btn} disabled={!c.expenseAccountId || c.status !== "active"}>Create bills in QuickBooks</button>
                    {!c.expenseAccountId && <span className="text-xs text-[var(--cc-amber)]">Choose the expense account first.</span>}
                  </div>
                ) : <p className="text-xs text-ink-soft">Only the owner can create bills.</p>}
              </form>
            )}
        </Panel>
      )}

      {c && blocked.length > 0 && (
        <Panel title="Approved but not ready to bill">
          <Table head={["Payee", "For", "Amount", "What's missing"]}>
            {blocked.map((i) => (
              <tr key={i.sourceId}><td className="text-white">{i.payeeName}</td><td className="text-xs text-ink-soft">{i.description}</td><td className="text-white">{money(i.amountCents)}</td>
                <td className="text-xs text-[var(--cc-amber)]">{i.blockers.map((b) => QB_BLOCKER[b] ?? b).join(", ")}</td></tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-ink-soft">These follow the same rules as automatic payouts: a reviewed 1099 classification, accepted agreements and a W-9. W-2 employees are paid through payroll.</p>
        </Panel>
      )}

      <Panel title="QuickBooks bills">
        {bills.length === 0 ? <Empty>No bills yet.</Empty> : (
          <Table head={["Bill", "Payee", "Amount", "Status", "Created"]}>
            {bills.map((b) => (
              <tr key={b.id}>
                <td className="cc-mono text-xs text-white">{b.doc_number}{b.environment === "sandbox" && <span className="ml-1 text-ink-soft">(sandbox)</span>}</td>
                <td className="text-white">{b.payee_name}</td>
                <td className="text-white">{money(b.amount_cents)}</td>
                <td><Chip tone={STATUS_TONE[b.status as keyof typeof STATUS_TONE] ?? "muted"}>{b.status === "voided" ? "deleted in QB" : b.status}</Chip>{b.error && <p className="mt-1 max-w-xs text-[11px] text-[var(--cc-red)]">{b.error}</p>}</td>
                <td className="text-xs text-ink-soft">{new Date(b.created_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}{b.paid_at ? ` · paid ${new Date(b.paid_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}` : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
