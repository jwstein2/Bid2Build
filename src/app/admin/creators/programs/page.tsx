import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { GIFT_TIERS, PROGRAM_STATE_LABELS, type CreatorProgramRow } from "@/lib/creator/program";
import { Flash, btn, fmtDate, input } from "@/components/creator/flash";
import { createProgram } from "../actions";
import { CreatorSubNav } from "../sub-nav";

export const dynamic = "force-dynamic";

export default async function Programs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db } = await requireAdmin();
  const sp = await searchParams;
  const { data, error } = await db.rpc("admin_creator_programs", { p_caller: user.id });
  if (error || !data) return <p className="text-ink-soft">The Creator Partner Program tables aren&apos;t installed yet.</p>;
  const { rows, metrics } = data as { rows: CreatorProgramRow[]; metrics: Record<string, number> };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Learning Team grants</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">Invitation-only. Not a public plan: it never appears on pricing, checkout or plan selection. Each program gives a creator 12 months of complimentary Team for their own business (through Complimentary Access, no Stripe), a private mentorship dashboard, and a gift allowance of independent Unlimited accounts for their subscribers.</p>
      </div>
      <CreatorSubNav current="/admin/creators/programs" />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Active programs", metrics.programs_active], ["Drafts", metrics.programs_draft], ["Gifted memberships active", metrics.gifts_active], ["Gift invitations pending", metrics.gifts_pending],
          ["Total gift allowance", metrics.gift_allowance], ["Estimates shared for coaching", metrics.shares_open], ["Gifted users now paying", metrics.gift_conversions]].map(([k, v]) => (
          <Card key={String(k)} className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-3xl font-extrabold">{Number(v ?? 0).toLocaleString("en-US")}</p></Card>
        ))}
      </section>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Workspace</th><th className="px-3 py-2">Creator</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Gifts used</th><th className="px-3 py-2">Ends</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="font-semibold text-accent-ink underline" href={`/admin/creators/programs/${r.id}`}>{r.workspace_name}</Link></td>
                <td className="break-all px-3 py-2">{r.creator_email}</td>
                <td className="px-3 py-2"><Badge tone={r.state === "active" ? "ok" : r.state === "draft" ? "neutral" : r.state === "awaiting_activation" ? "accent" : "warn"}>{PROGRAM_STATE_LABELS[r.state]}</Badge></td>
                <td className="tabular px-3 py-2">{r.seats_used} / {r.gift_allowance}</td>
                <td className="px-3 py-2">{fmtDate(r.expires_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-soft">No programs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">New program (draft)</h2>
        <p className="mt-1 text-sm text-ink-soft">Creating a draft issues nothing. You&apos;ll record the creator&apos;s explicit acceptance of the terms, then provision.</p>
        <form action={createProgram} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="prospect_id" value={/^[0-9a-f-]{36}$/i.test(sp.prospect ?? "") ? sp.prospect : ""} />
          <label className="text-sm"><span className="mb-1 block font-medium">Creator&apos;s email (they&apos;ll sign in with it)</span><input name="email" type="email" required defaultValue={sp.email ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Workspace name</span><input name="workspace_name" required defaultValue={sp.workspace ?? ""} placeholder="Johnson Deck Academy — Built2Bid Learning Team" className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Channel name</span><input name="channel_name" defaultValue={sp.channel ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Channel URL</span><input name="channel_url" defaultValue={sp.url ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Gift allowance</span>
            <input name="gift_allowance" type="number" min={0} max={50} defaultValue={GIFT_TIERS.includes(Number(sp.gifts) as 5 | 10) ? Number(sp.gifts) : 5} className={input} />
            <span className="mt-1 block text-xs text-muted">Recommended: 5 for a smaller qualified creator, 10 for an established one.</span></label>
          <div className="flex items-end"><button className={btn}>Create draft</button></div>
        </form>
      </Card>
    </div>
  );
}
