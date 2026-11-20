import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { dateLabel } from "@/lib/sales/format";
import { acceptAmendment } from "./actions";

export const metadata = { title: "Agreement updates" };

export interface Amendment { id: string; code: string; version: number; title: string; body: string; legal_status: string; accepted_at: string | null }

/** Versioned amendments to the rep's sales compensation agreement. Accepting records the exact text, name and time. */
export default async function SalesAmendments({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const q = await searchParams;
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_amendments");
  if (error) return <Notice title="Agreement updates are getting set up">Check back in a little while.</Notice>;
  const rows = (data ?? []) as Amendment[];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Agreement updates</h1>
        <p className="mt-1 text-ink-soft">Changes to your sales compensation agreement. Read each one and accept it with your name.</p>
      </div>
      {q.ok && <Notice tone="ok" title="Accepted">Thanks. Your acceptance is recorded.</Notice>}
      {q.err && <Notice tone="danger" title="Not saved">Tick the box and type your full name to accept.</Notice>}
      {rows.length === 0 && <Card className="p-6 text-ink-soft">No agreement updates right now.</Card>}
      {rows.map((a) => (
        <Card key={a.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{a.title} <span className="text-sm font-normal text-muted">v{a.version}</span></h2>
            {a.legal_status !== "counsel_approved" && <Badge tone="warn">Draft: legal review pending</Badge>}
          </div>
          <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-line rounded-lg border border-line bg-paper p-4 text-sm leading-relaxed">{a.body}</div>
          {a.accepted_at ? (
            <p className="mt-3 text-sm font-semibold text-ok">Accepted {dateLabel(a.accepted_at)}</p>
          ) : (
            <form action={acceptAmendment} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={a.id} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-1" /> I have read this amendment and agree to it.</label>
              <label className="block text-sm">Type your full name
                <input name="typed_name" required minLength={2} maxLength={120} autoComplete="name" className="mt-1 block min-h-11 w-full max-w-sm rounded-lg border border-line px-3" />
              </label>
              <button type="submit" className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-white">Accept amendment</button>
            </form>
          )}
        </Card>
      ))}
    </div>
  );
}
