"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/enterprise/pipeline";

/** Change a bid's pipeline stage, with an optional note (the lost reason, or review feedback). */
export function StageControl({ estimateId, stage, title }: { estimateId: string; stage: Stage; title: string }) {
  const router = useRouter();
  const id = useId();
  const [next, setNext] = useState<Stage>(stage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = next !== stage;

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/company/pipeline", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stage", estimateId, stage: next, note: note.trim() || undefined }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, text: d?.error?.message ?? "Something went wrong. Please try again." }); return; }
    setNote(""); setMsg({ ok: true, text: `Moved to ${STAGE_LABELS[next]}.` }); router.refresh();
  }

  return (
    <div className="min-w-0" data-testid="stage-control">
      <label htmlFor={`${id}-s`} className="sr-only">Stage for {title}</label>
      <div className="flex flex-wrap items-center gap-2">
        <select id={`${id}-s`} value={next} onChange={(e) => { setNext(e.target.value as Stage); setMsg(null); }}
          className="h-10 min-w-0 max-w-full rounded-lg border border-line bg-surface px-2 text-sm">
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        {changed && <Button size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>}
      </div>
      {changed && (
        <div className="mt-2">
          <label htmlFor={`${id}-n`} className="text-xs font-semibold text-ink-soft">{next === "lost" ? "Why was it lost? (optional)" : "Note (optional)"}</label>
          <input id={`${id}-n`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
            placeholder={next === "lost" ? "e.g. Price, timing, went with another contractor" : next === "draft" ? "What needs to change?" : ""}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base" />
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
