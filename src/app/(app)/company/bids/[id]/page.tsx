import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadMyCompany } from "@/lib/enterprise/server";
import { STAGE_LABELS, STAGE_TONES, money, type Stage } from "@/lib/enterprise/pipeline";
import { Badge, Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { StageControl } from "@/components/company/stage-control";

export const metadata: Metadata = { title: "Bid review", robots: { index: false } };

type Review = {
  id: string; title: string; estimateNumber: string; customerName: string; projectAddress: string | null; trades: string[]; stage: Stage; status: string;
  lostReason: string | null; isMine: boolean; ownerName: string; createdAt: string; updatedAt: string; canSeeCosts: boolean;
  version: null | { number: number; total: number; subtotal: number; tax: number; cost: number | null; marginPct: number | null; createdAt: string };
  history: { from: Stage; to: Stage; note: string | null; at: string; by: string }[];
};
type Item = { id: string; group_id: string; name: string; quantity: number; unit: string; unit_cost: number; cost_type: string };

/** Read-only view of a bid the member can see (teammates' bids included), with stage changes and history. */
export default async function BidReviewPage({ params }: PageProps<"/company/bids/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) notFound();
  const { data, error } = await supabase.rpc("company_bid_review", { p_estimate_id: id });
  if (error || !data) notFound();
  const r = data as Review;
  const [{ data: groups }, { data: items }] = await Promise.all([
    supabase.from("estimate_groups").select("id, name, sort_order").eq("estimate_id", id).order("sort_order"),
    supabase.from("estimate_items").select("id, group_id, name, quantity, unit, unit_cost, cost_type").eq("estimate_id", id).order("sort_order"),
  ]);
  const byGroup = new Map<string, Item[]>();
  for (const it of (items ?? []) as Item[]) byGroup.set(it.group_id, [...(byGroup.get(it.group_id) ?? []), it]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/company/pipeline" className="text-sm font-semibold text-accent-ink underline">← Bids & Pipeline</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-extrabold">{r.title || "Untitled bid"}</h1>
          <p className="text-ink-soft">{[r.estimateNumber && `#${r.estimateNumber}`, r.customerName, r.ownerName].filter(Boolean).join(" · ")}</p>
          {r.projectAddress && <p className="text-sm text-ink-soft">{r.projectAddress}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STAGE_TONES[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
          {r.isMine && <ButtonLink href={`/estimates/${r.id}`} variant="secondary" size="sm">Open in editor</ButtonLink>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="p-4" data-testid="review-totals">
          <h2 className="font-display text-lg font-bold">Totals</h2>
          {!r.version ? <p className="mt-1 text-sm text-ink-soft">No finalized version yet. Totals appear once the estimator finalizes the proposal.</p> : (
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-soft">Version</dt><dd className="text-right">v{r.version.number} · {new Date(r.version.createdAt).toLocaleDateString()}</dd>
              <dt className="text-ink-soft">Subtotal</dt><dd className="text-right tabular-nums">{money(r.version.subtotal)}</dd>
              <dt className="text-ink-soft">Tax</dt><dd className="text-right tabular-nums">{money(r.version.tax)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{money(r.version.total)}</dd>
              {r.version.cost !== null && <><dt className="text-ink-soft">Cost</dt><dd className="text-right tabular-nums">{money(r.version.cost)}</dd></>}
              {r.version.marginPct !== null && <><dt className="text-ink-soft">Margin</dt><dd className="text-right tabular-nums">{r.version.marginPct}%</dd></>}
            </dl>
          )}
          {r.lostReason && <p className="mt-3 text-sm"><b>Lost because:</b> {r.lostReason}</p>}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-bold">Stage</h2>
          <StageControl estimateId={r.id} stage={r.stage} title={r.title} />
        </Card>
      </div>

      <Card className="p-0">
        <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Scope</h2>
        {(groups ?? []).length === 0 ? <p className="px-4 py-4 text-sm text-ink-soft">No line items.</p> : (
          <div className="divide-y divide-line">{(groups ?? []).map((g) => (
            <div key={g.id} className="px-4 py-3">
              <p className="font-semibold">{g.name || "Section"}</p>
              <ul className="mt-1 space-y-0.5 text-sm">{(byGroup.get(g.id) ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{it.name || "Item"} <span className="text-ink-soft">· {Number(it.quantity)} {it.unit}</span></span>
                  {r.canSeeCosts && <span className="shrink-0 tabular-nums text-ink-soft">{money(Number(it.quantity) * Number(it.unit_cost))}</span>}
                </li>
              ))}</ul>
            </div>
          ))}</div>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Review history</h2>
        {r.history.length === 0 ? <p className="px-4 py-4 text-sm text-ink-soft">No stage changes yet.</p> : (
          <ol className="divide-y divide-line" data-testid="review-history">{r.history.map((h, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <p><b>{h.by}</b> moved it from {STAGE_LABELS[h.from]} to <b>{STAGE_LABELS[h.to]}</b> <span className="text-ink-soft">· {new Date(h.at).toLocaleString()}</span></p>
              {h.note && <p className="mt-0.5 text-ink-soft">“{h.note}”</p>}
            </li>
          ))}</ol>
        )}
      </Card>
    </div>
  );
}
