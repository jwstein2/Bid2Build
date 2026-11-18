import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { GIFT_STATE_LABELS, GIFT_STATE_TONES, PROGRAM_STATE_LABELS, TERMS_VERSION, type CreatorProgramRow, type GiftState } from "@/lib/creator/program";
import { Flash, btn, btnSecondary, fmtDate, input } from "@/components/creator/flash";
import { endProgram, provisionProgram, recordTerms, setAllowance } from "../../actions";

export const dynamic = "force-dynamic";

type Detail = CreatorProgramRow & {
  gifts: { id: string; email: string; state: GiftState; invited_at: string; claimed_at: string | null; revoked_at: string | null; expires_at: string | null; company_name: string | null; paid_now: boolean }[];
  history: { at: string; action: string; details: Record<string, unknown> | null; actor_email: string | null }[];
};

export default async function ProgramDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { user, db } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db.rpc("admin_creator_program_detail", { p_caller: user.id, p_id: id });
  if (!data) notFound();
  const p = data as Detail;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/creators/programs" className="text-ink-soft underline">Learning Team grants</Link> <span className="text-muted">/</span></p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">{p.workspace_name}</h1><p className="break-all text-ink-soft">{p.creator_email}{p.channel_name ? ` · ${p.channel_name}` : ""}</p></div>
        <Badge tone={p.state === "active" ? "ok" : "neutral"} className="text-sm">{PROGRAM_STATE_LABELS[p.state]}</Badge>
      </div>
      <Flash msg={sp.msg} err={sp.err} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Gift seats in use", `${p.seats_used} / ${p.gift_allowance}`], ["Active gifted members", p.gifts_active], ["Pending invitations", p.gifts_pending], ["Shared estimates", p.shares_open],
          ["Program starts", fmtDate(p.starts_at)], ["Program ends", fmtDate(p.expires_at)], ["Creator's Team grant", p.creator_grant_state ?? "Not issued"], ["Gifted users now paying", p.gift_conversions]].map(([k, v]) => (
          <Card key={String(k)} className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="mt-1 text-xl font-extrabold">{String(v)}</p></Card>
        ))}
      </section>

      {p.status === "draft" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">1. Record acceptance of terms</h2>
            {p.terms_accepted_at ? <Notice tone="ok">Accepted {fmtDate(p.terms_accepted_at, true)} ({p.terms_version}): {p.terms_evidence}</Notice> : (
              <form action={recordTerms} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <label className="block text-sm"><span className="mb-1 block font-medium">Terms version</span><input name="terms_version" defaultValue={TERMS_VERSION} className={input} /></label>
                <label className="block text-sm"><span className="mb-1 block font-medium">Evidence (e.g. &quot;Signed terms PDF received 2026-11-20&quot; or the reply that explicitly accepts)</span><textarea name="evidence" rows={3} maxLength={1000} className={input} /></label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> The creator explicitly accepted the program terms. Casual interest isn&apos;t acceptance.</label>
                <button className={btnSecondary}>Record acceptance</button>
              </form>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">2. Provision</h2>
            <p className="mt-1 text-sm text-ink-soft">Issues a 12-month complimentary Team grant for {p.creator_email} through Complimentary Access (no Stripe, no billing details). If they already have a verified account it starts now; otherwise you get a private link to send them. No email is sent automatically.</p>
            <form action={provisionProgram} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" disabled={!p.terms_accepted_at} /> Issue the real complimentary account now.</label>
              <button className={btn} disabled={!p.terms_accepted_at}>Provision program</button>
            </form>
          </Card>
        </div>
      )}

      {["active", "awaiting_activation"].includes(p.state) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Gift allowance</h2>
            <form action={setAllowance} className="mt-2 flex items-end gap-2"><input type="hidden" name="id" value={p.id} />
              <label className="text-sm"><span className="mb-1 block font-medium">Seats</span><input name="gift_allowance" type="number" min={p.seats_used} max={50} defaultValue={p.gift_allowance} className={input} /></label>
              <button className={btnSecondary}>Update</button></form>
          </Card>
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">End program</h2>
            <form action={endProgram} className="mt-2 space-y-2"><input type="hidden" name="id" value={p.id} />
              <input name="reason" placeholder="Reason" maxLength={500} className={input} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="end_gifts" className="mt-1" /> Also end the gifted Unlimited memberships now</label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="end_creator_grant" className="mt-1" /> Also end the creator&apos;s complimentary Team now</label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> End this program. Mentorship access stops immediately; nobody loses business data.</label>
              <button className="min-h-10 rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white">End program</button></form>
          </Card>
        </div>
      )}

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">Gifted memberships</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Email</th><th>Business</th><th>Status</th><th>Joined</th><th>Ends</th><th>Paying now</th></tr></thead>
            <tbody>{p.gifts.map((g) => (
              <tr key={g.id} className="border-t border-line"><td className="break-all py-2">{g.email}</td><td>{g.company_name ?? "—"}</td><td><Badge tone={GIFT_STATE_TONES[g.state]}>{GIFT_STATE_LABELS[g.state]}</Badge></td><td>{fmtDate(g.claimed_at)}</td><td>{fmtDate(g.expires_at)}</td><td>{g.paid_now ? "Yes" : "No"}</td></tr>
            ))}{p.gifts.length === 0 && <tr><td colSpan={6} className="py-4 text-ink-soft">No gifts yet.</td></tr>}</tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">History</h2>
        <ol className="mt-2 space-y-1 text-sm">{p.history.map((h, i) => <li key={i}><span className="font-medium">{h.action}</span> · {fmtDate(h.at, true)}{h.actor_email ? ` · ${h.actor_email}` : ""}</li>)}</ol>
      </Card>
    </div>
  );
}
