"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { postDelete } from "@/components/pipeline/delete-dialog";
import { money } from "@/components/pipeline/format";

export interface DeletedBid {
  id: string; title: string; customer: string | null; number: string | null; stage: string | null;
  deletedAt: string; deletedBy: string; owner: string; reason: string | null; mine: boolean; total: number | string | null;
  history: { action: "deleted" | "restored"; at: string; by: string; reason: string | null }[];
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function DeletedBidList({ rows }: { rows: DeletedBid[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [, start] = useTransition();
  const shown = rows.filter((r) => !gone.has(r.id));
  const showOwner = rows.some((r) => !r.mine);

  async function restore(r: DeletedBid) {
    setBusy(r.id); setMsg(null);
    const err = await postDelete(r.id, "restore");
    setBusy(null);
    if (err) { setMsg({ ok: false, text: err }); return; }
    setGone((g) => new Set(g).add(r.id));
    setMsg({ ok: true, text: `Restored "${r.title}". It's back on My bids.` });
    start(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok" : "rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger"}>{msg.text}</p>}
      <Card>
        <ul className="divide-y divide-line" data-testid="deleted-bids">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 max-sm:basis-full">
                <p className="font-semibold text-navy">{r.title}</p>
                <p className="text-sm text-muted">
                  {[r.customer, r.number ? `#${r.number}` : null, r.total != null ? money(Number(r.total), true) : null, showOwner ? `Bid by ${r.owner}` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 text-sm text-ink-soft">Deleted by <b>{r.deletedBy}</b> on {when(r.deletedAt)}{r.reason ? <> · &ldquo;{r.reason}&rdquo;</> : null}</p>
                {r.history.length > 1 && (
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer">Audit history ({r.history.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {r.history.map((h, i) => <li key={i}>{h.action === "deleted" ? "Deleted" : "Restored"} by {h.by} · {when(h.at)}{h.reason ? ` · "${h.reason}"` : ""}</li>)}
                    </ul>
                  </details>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={() => restore(r)} disabled={busy === r.id} data-testid="restore-bid">
                {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArchiveRestore className="h-4 w-4" aria-hidden />}Restore
              </Button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="p-6 text-center text-sm text-muted">Everything here was restored.</p>}
      </Card>
    </div>
  );
}
