import Link from "next/link";
import { Notice } from "@/components/ui/misc";
import { loadDashboard } from "@/lib/affiliates/server";
import { usd } from "@/lib/affiliates/portfolio";
import { connectBank } from "../onboarding/actions";
import { openDispute } from "./actions";

export const metadata = { title: "Profile & payouts" };

const HOLD: Record<string, string> = {
  affiliate_payouts_off: "Affiliate payouts haven't started yet. Earned commissions are kept safely until they do.", w9_missing: "Submit your W-9.", no_bank: "Connect your payout bank account.",
  bank_unverified: "Your bank account is waiting for verification.", bank_change_hold: "Your new bank account is in its safety hold.", agreement_missing: "Sign the affiliate agreement.",
  unsupported_country: "Payouts aren't available in your country yet.", suspended: "Your account is paused.", not_active: "Your account isn't active yet.", terminated_review: "Under review.",
};
const MSG: Record<string, string> = { dispute: "Thanks. Your request was sent to Built2Bid for review.", bank: "Bank account connected.", bank_changed: "Bank account changed. We emailed you, and payouts go to it after the safety hold." };

export default async function Profile({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { dash, me } = await loadDashboard("/affiliate-hub/profile");
  const sp = await searchParams;
  const d = dash as unknown as { payout: { blockers: string[]; enabled: boolean; destination: { institution_name: string; last4: string; status: string; eligible_from: string | null } | null };
    tax: { w9_status: string; tin_last4: string | null } | null; channel: { title: string | null; url: string | null; platform: string; subscriber_count: number | null; data_source: string; verified: boolean } | null;
    disputes: { id: string; kind: string; status: string; description: string; resolution: string | null; created_at: string }[] };
  const input = "mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Profile &amp; payouts</h1>
      {sp.ok && MSG[sp.ok] && <Notice tone="ok">{MSG[sp.ok]}</Notice>}
      {sp.err && <Notice tone="danger">{sp.err === "dispute" ? "Please describe the issue (at least a sentence)." : "Something went wrong. Please try again."}</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Your details</h2>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Name</dt><dd>{me.legal_name}</dd>
            <dt className="text-muted">Display name</dt><dd>{me.display_name ?? "—"}</dd>
            <dt className="text-muted">Email</dt><dd className="break-all">{me.email}</dd>
            <dt className="text-muted">Phone</dt><dd>{me.phone ?? "—"}</dd>
            <dt className="text-muted">Contact by</dt><dd>{me.contact_pref ?? "email"}</dd>
            <dt className="text-muted">Affiliate code</dt><dd className="font-mono">{me.code}</dd>
          </dl>
          <Link href="/affiliate-hub/onboarding?step=profile" className="mt-3 inline-flex min-h-11 items-center text-sm underline">Edit details</Link>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Channel</h2>
          {d.channel ? (
            <p className="mt-2 text-sm">{d.channel.title ?? d.channel.url} · {d.channel.platform}{d.channel.subscriber_count != null ? ` · ${d.channel.subscriber_count.toLocaleString()} subscribers` : ""} · {d.channel.verified ? <span className="text-ok">verified</span> : "not verified yet"}</p>
          ) : <p className="mt-2 text-sm text-ink-soft">No channel connected.</p>}
          <Link href="/affiliate-hub/onboarding?step=channel" className="mt-3 inline-flex min-h-11 items-center text-sm underline">{d.channel?.data_source === "youtube_api" ? "Refresh or request a correction" : "Update channel"}</Link>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card" id="payouts">
        <h2 className="text-lg font-bold">Tax form and payout account</h2>
        <p className="mt-2 text-sm">W-9: {d.tax?.w9_status === "submitted" || d.tax?.w9_status === "verified" ? <span className="text-ok">on file (tax ID ending {d.tax.tin_last4})</span> : <Link className="underline" href="/affiliate-hub/onboarding?step=payout">submit your W-9</Link>}</p>
        <p className="mt-1 text-sm">Bank: {d.payout.destination ? <>{d.payout.destination.institution_name} ••{d.payout.destination.last4} · {d.payout.destination.status}{d.payout.destination.eligible_from && new Date(d.payout.destination.eligible_from) > new Date() ? ` (safety hold until ${new Date(d.payout.destination.eligible_from).toLocaleString()})` : ""}</> : "not connected"}</p>
        <form action={connectBank} className="mt-3"><input type="hidden" name="back" value="profile" /><button type="submit" className="min-h-11 rounded-md border border-line-strong px-4 text-sm font-semibold">{d.payout.destination ? "Change bank account" : "Connect bank account"}</button></form>
        {d.payout.blockers.length > 0 && <ul className="mt-3 space-y-1 text-sm text-ink-soft">{d.payout.blockers.map((b) => <li key={b}>• {HOLD[b] ?? b}</li>)}</ul>}
        <h3 className="mt-5 font-bold">Payout history</h3>
        {dash.payouts.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No payouts yet.</p> : (
          <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th scope="col">Reference</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col" className="text-right">Amount</th></tr></thead>
            <tbody>{dash.payouts.map((p) => <tr key={p.ref} className="border-t border-line"><td className="py-1 font-mono text-xs">{p.ref}{p.mode === "test" && <span className="ml-1 text-muted">(practice)</span>}</td><td>{p.status}{p.failure_code ? ` (${p.failure_code})` : ""}</td><td>{p.settled_at ? new Date(p.settled_at).toLocaleDateString() : p.scheduled_for ?? "—"}</td><td className="text-right tabular-nums">{usd(p.net_cents)}</td></tr>)}</tbody></table>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card" id="disputes">
        <h2 className="text-lg font-bold">Ask for a review</h2>
        <p className="mt-1 text-sm text-ink-soft">Think a customer should be attributed to you, or a commission or payout is wrong? Tell us and Built2Bid will review it. Every decision is recorded.</p>
        <form action={openDispute} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">Type<select name="kind" className={input}><option value="attribution">Attribution (who referred a customer)</option><option value="commission">Commission amount or status</option><option value="payout">Payout</option><option value="other">Other</option></select></label>
          <label className="text-sm font-semibold sm:col-span-2">Customer label or date <span className="font-normal text-muted">(optional)</span><input name="customer" placeholder="e.g. Customer 1A2B3C, or the date they signed up" className={input} /></label>
          <label className="text-sm font-semibold sm:col-span-3">What happened?<textarea name="description" required minLength={10} rows={3} className={input} /></label>
          <div><button type="submit" className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white">Send for review</button></div>
        </form>
        {d.disputes.length > 0 && <ul className="mt-4 divide-y divide-line text-sm">{d.disputes.map((x) => <li key={x.id} className="py-2"><strong>{x.kind}</strong> · {x.status} · {new Date(x.created_at).toLocaleDateString()}<p className="text-ink-soft">{x.description}</p>{x.resolution && <p className="text-ok">Decision: {x.resolution}</p>}</li>)}</ul>}
      </section>
    </div>
  );
}
