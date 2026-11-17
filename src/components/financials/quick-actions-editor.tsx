"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Pencil, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveMyLayout, type CardSlot } from "./home-arrange";

export interface QuickLibraryItem { key: string; label: string; built: boolean; hint: string }

/**
 * The Quick actions section of the Financials home, with its own "Edit" button. Editing opens the library of
 * every quick action this person may use, each with an on/off switch: switching one on adds it to the end of
 * the row, off removes it, and each change saves right away for this person only. "Use defaults" goes back to
 * the trade's set. Order is changed by press-and-hold dragging on the row itself. Actions that aren't built
 * yet can still be switched on: they show as a "coming soon" chip until they ship. Nothing here grants anything: every form re-checks access.
 */
export function QuickActionsSection({ row, selected, library, from, ready, cards, kpis }: {
  row: ReactNode; selected: string[]; library: QuickLibraryItem[]; from: "user" | "company" | "profile"; ready: boolean;
  cards: CardSlot[]; kpis: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(selected);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  // Take in the server's list after a save or a drag (while not mid-change).
  const sig = selected.join("|");
  const [seen, setSeen] = useState(sig);
  if (sig !== seen && !busy) { setSeen(sig); setOn(selected); }

  const save = async (next: string[] | null, key: string) => {
    const prev = on;
    if (next) setOn(next);
    setBusy(key); setMsg(null);
    const err = await saveMyLayout({ cards, kpis, quickActions: next });
    setBusy(null);
    if (err) { setOn(prev); setMsg({ tone: "danger", text: err }); return; }
    setMsg({ tone: "ok", text: next === null ? "Back to the default quick actions." : "Saved for you." });
    router.refresh();
  };
  const toggle = (k: string) => void save(on.includes(k) ? on.filter((x) => x !== k) : [...on, k], k);

  const extra = library.filter((o) => !on.includes(o.key));
  const current = on.map((k) => library.find((o) => o.key === k)).filter((o): o is QuickLibraryItem => Boolean(o));
  const item = (o: QuickLibraryItem) => {
    const checked = on.includes(o.key);
    return (
      <li key={o.key} className="flex min-h-14 items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{o.label}{!o.built && <span className="ml-1 text-xs font-normal text-muted">· coming soon</span>}</p>
          <p className="text-xs text-muted">{o.hint}</p>
        </div>
        <button type="button" role="switch" aria-checked={checked} aria-label={o.label} disabled={busy !== null}
          onClick={() => toggle(o.key)} data-testid={`fin-quick-toggle-${o.key}`}
          className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-brand" : "bg-line-strong"}`}>
          <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-7" : "translate-x-1"}`} />
        </button>
      </li>
    );
  };

  return (
    <section aria-labelledby="fin-quick-h" data-guide="fin.quick" data-testid="fin-quick">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="fin-quick-h" className="font-display text-lg font-extrabold">Quick actions</h2>
        {ready && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="fin-quick-edit" data-testid="fin-quick-edit-toggle">
            {open ? <><X className="h-4 w-4" aria-hidden /> Done</> : <><Pencil className="h-4 w-4" aria-hidden /> Edit</>}
          </Button>
        )}
      </div>
      {on.length > 0 ? row : <p className="text-sm text-muted">No quick actions turned on.{ready ? " Use Edit to add some." : ""}</p>}
      {open && (
        <div id="fin-quick-edit" className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="fin-quick-edit">
          <p className="text-sm text-ink-soft">
            Turn quick actions on or off. New ones go at the end; press and hold one on the row to move it. {from === "company" ? "Your company picked the starting set." : from === "profile" ? "The starting set comes from your trade setup." : ""}
          </p>
          <div>
            <p className="label">On ({current.length})</p>
            {current.length
              ? <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Quick actions turned on">{current.map(item)}</ul>
              : <p className="text-sm text-muted">None yet.</p>}
          </div>
          {extra.length > 0 && (
            <div>
              <p className="label">More quick actions</p>
              <ul className="divide-y divide-line rounded-lg border border-line" aria-label="More quick actions">{extra.map(item)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {from === "user" && (
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void save(null, "reset")}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Use defaults
              </Button>
            )}
            <span role="status" aria-live="polite" className={`text-sm ${msg?.tone === "danger" ? "text-danger" : "text-muted"}`}>{busy ? "Saving…" : msg?.text}</span>
          </div>
        </div>
      )}
    </section>
  );
}
