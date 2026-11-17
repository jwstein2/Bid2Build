"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";

/**
 * Possible duplicates of this customer (same name, email or phone). Nothing is merged automatically:
 * the contractor confirms each merge, which moves the other record's bids, photos and email history here.
 */
export function MergeDuplicates({ keepId, keepName, candidates }: { keepId: string; keepName: string; candidates: { id: string; name: string; detail: string; bids: number }[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function merge(removeId: string) {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/customers/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepId, removeId }) });
    setBusy(false); setAsking(null);
    if (!r.ok) { setMsg((await r.json().catch(() => null))?.error?.message ?? "Could not merge these customers."); return; }
    setMsg("Merged."); router.refresh();
  }

  return (
    <Card className="space-y-3 border-warn/40 p-4" data-testid="customer-duplicates">
      <div>
        <h2 className="font-bold">Possible duplicates</h2>
        <p className="text-sm text-ink-soft">These records share a name, email or phone with {keepName}. Merge only if they are the same customer.</p>
      </div>
      <ul className="divide-y divide-line text-sm">
        {candidates.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0"><a className="font-semibold hover:underline" href={`/dashboard/customers/${c.id}`}>{c.name}</a><span className="block text-muted">{c.detail} · {c.bids} bid{c.bids === 1 ? "" : "s"}</span></span>
            {asking === c.id ? (
              <span className="flex flex-wrap items-center gap-1" role="group" aria-label={`Confirm merging ${c.name}`}>
                <span className="text-ink-soft">Move {c.bids} bid{c.bids === 1 ? "" : "s"} into {keepName}?</span>
                <Button size="sm" onClick={() => merge(c.id)} disabled={busy} autoFocus data-testid="merge-confirm">Merge</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              </span>
            ) : <Button size="sm" variant="secondary" onClick={() => setAsking(c.id)} data-testid="merge-start">Merge into this customer</Button>}
          </li>
        ))}
      </ul>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </Card>
  );
}
