import Link from "next/link";
import { PageHead, Panel } from "@/components/admin/cc";
import { requireStaffCap, TWO_STEP_FINANCE } from "@/lib/staff/server";
import { CashView, type BankingData } from "@/components/banking/cash-view";
import { loadStripeCash } from "@/lib/banking/stripe-load";
import { designateBook } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banking & Cash Flow" };

/**
 * Owner Administration → Banking & Cash Flow. Read-only. Bank data comes from a book the owner explicitly designated
 * (its bank feed was authorized by the account holder through Plaid's own window, with two-step sign-in). Stripe data is
 * read live. Bank-confirmed, Stripe, scheduled and forecast figures are labeled separately.
 */
export default async function BankingPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { user, db, caps } = await requireStaffCap("banking.view");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 120 * 864e5).toISOString().slice(0, 10);
  const [{ data, error }, stripe] = await Promise.all([
    db.rpc("admin_banking_overview", { p_caller: user.id, p_since: since }),
    loadStripeCash(new Date(`${monthStart}T00:00:00Z`)),
  ]);
  if (error || !data) return <div className="space-y-6"><PageHead kicker="Owner administration" title="Banking & Cash Flow" /><Panel title="Not installed"><p className="text-sm text-ink-soft">Run migration 20270207001000_staff_payouts.sql first.</p></Panel></div>;
  const b = data as BankingData;
  const manage = caps.includes("banking.manage");
  return (
    <div className="space-y-6">
      <PageHead kicker="Owner administration" title="Banking & Cash Flow" intro="What came in, what went out, and what's due next. Read-only: nothing on this page can move money." />
      {sp.ok && <p role="status" className="cc-mono rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">Saved.</p>}
      {sp.err && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{sp.err === "two_step" ? TWO_STEP_FINANCE : sp.err === "book_not_owned" ? "You can only designate books you own." : "Please try again."}</p>}
      {manage && (
        <Panel title="Which books hold Built2Bid LLC's business bank accounts?" kicker={b.designated ? `Designated ${b.designated_at ? new Date(b.designated_at).toLocaleDateString() : ""}` : "Not set"}>
          <form action={designateBook} className="space-y-3 text-xs">
            <select name="book" defaultValue={b.books_available.find((x) => x.name === b.book_name)?.id ?? ""} className="field field-sm w-full sm:w-96">
              <option value="">None</option>
              {b.books_available.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {b.accounts.length > 0 && <fieldset><legend className="cc-kicker mb-1">Exclude from company totals (personal or not Built2Bid)</legend>
              <div className="flex flex-wrap gap-3">{b.accounts.map((a) => <label key={a.id} className="flex items-center gap-1.5 text-white"><input type="checkbox" name="excluded" value={a.id} defaultChecked={a.excluded} />{a.name} ••{a.last4 ?? "?"}</label>)}</div></fieldset>}
            <button className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-white hover:border-[var(--cc-blue)]">Save (needs two-step)</button>
            <p className="text-ink-soft">Connect business accounts read-only in that account&apos;s <Link className="underline" href="/financials">Financials</Link> (Plaid; real banks need two-step sign-in). An account connected for Stripe payouts doesn&apos;t give transaction history, and routing/account numbers alone can&apos;t read balances. Personal accounts are never added to company totals unless you leave them un-excluded.</p>
          </form>
        </Panel>
      )}
      {!b.designated ? <Panel title="Not set up yet"><p className="text-sm text-ink-soft">Designate the books that hold Built2Bid&apos;s business bank feed. Stripe figures and scheduled obligations still show below once it&apos;s set.</p></Panel>
        : <CashView b={b} stripe={stripe} monthStart={monthStart} />}
    </div>
  );
}
