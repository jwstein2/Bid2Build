"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Lock, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { KPI_LABELS } from "@/lib/financials/ui-labels";
import { finAction } from "./fin-client";

export interface CustomCard { key: string; title: string; visible: boolean; locked: boolean; essential: boolean }
export interface QuickOption { key: string; label: string; built: boolean }
export interface QuickSetup { ready: boolean; selected: string[]; options: QuickOption[]; from: "user" | "company" | "profile" }

/**
 * Customize the Financials home: show/hide and reorder cards, pick the headline numbers, choose the quick
 * actions (add, remove, reorder), and restore the defaults. Essential alerts are always shown (the database also refuses to hide them); cards the company
 * locked stay put. Admins (manage_financial_config) can save the layout as the company default and lock cards.
 * An inline panel, not a popup: it opens only when the person asks.
 */
export function CustomizeDashboard({ cards: initial, kpis: initialKpis, allKpis, canCompany, quick }: { cards: CustomCard[]; kpis: string[]; allKpis: readonly string[]; canCompany: boolean; quick: QuickSetup }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState(initial);
  const [kpis, setKpis] = useState(initialKpis);
  const [scope, setScope] = useState<"user" | "company">("user");
  const [locks, setLocks] = useState<string[]>(initial.filter((c) => c.locked).map((c) => c.key));
  const [quickSel, setQuickSel] = useState(quick.selected);
  // undefined = untouched (keep what's saved), null = back to the trade defaults, array = a new choice.
  const [quickChoice, setQuickChoice] = useState<string[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  // A drag on the home page (or another save) refreshes the server layout: take it in while the panel is closed,
  // so saving the panel later never puts back an older order.
  const serverSig = JSON.stringify([initial, initialKpis, quick.selected]);
  const [seenSig, setSeenSig] = useState(serverSig);
  if (serverSig !== seenSig && !open) {
    setSeenSig(serverSig); setCards(initial); setKpis(initialKpis); setLocks(initial.filter((c) => c.locked).map((c) => c.key));
    setQuickSel(quick.selected); setQuickChoice(undefined);
  }

  const move = (i: number, d: -1 | 1) => setCards((cs) => {
    const j = i + d; if (j < 0 || j >= cs.length) return cs;
    const next = [...cs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const pickQuick = (next: string[]) => { setQuickSel(next); setQuickChoice(next); };
  const moveQuick = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= quickSel.length) return;
    const next = [...quickSel]; [next[i], next[j]] = [next[j], next[i]]; pickQuick(next);
  };
  const label = (k: string) => quick.options.find((o) => o.key === k)?.label ?? k;
  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await finAction({ action: "save_dashboard", scope, role: null, p: {
      cards: cards.map((c) => ({ key: c.key, visible: c.visible })), kpis, ...(scope === "company" ? { lockedCards: locks } : {}),
      ...(quick.ready && quickChoice !== undefined ? { quickActions: quickChoice } : {}),
    } });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: r.message });
    setMsg({ tone: "ok", text: scope === "company" ? "Saved as the company default." : "Saved for you." });
    setQuickChoice(undefined);
    router.refresh();
  };
  const restore = async () => {
    setBusy(true); setMsg(null);
    const r = await finAction({ action: "reset_dashboard" });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: r.message });
    setMsg({ tone: "ok", text: "Restored the defaults." });
    router.refresh();
  };

  return (
    <section aria-label="Customize Financials home" data-guide="fin.customize" className="rounded-xl border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="fin-customize"
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-ink-soft hover:text-ink" data-testid="fin-customize-toggle">
        <SlidersHorizontal className="h-4 w-4" aria-hidden /> Customize this page
        <span className="ml-auto text-xs font-normal text-muted">{open ? "Close" : "Choose cards, numbers and quick actions"}</span>
      </button>
      {open && (
        <div id="fin-customize" className="space-y-4 border-t border-line p-4">
          {canCompany && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="label">Save for</legend>
              {(["user", "company"] as const).map((s) => (
                <label key={s} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm">
                  <input type="radio" name="fin-scope" checked={scope === s} onChange={() => setScope(s)} /> {s === "user" ? "Just me" : "Everyone (company default)"}
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <p className="label">Headline numbers (pick up to 6)</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {allKpis.map((k) => {
                const on = kpis.includes(k);
                return (
                  <label key={k} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm">
                    <input type="checkbox" checked={on} disabled={!on && kpis.length >= 6} onChange={() => setKpis(on ? kpis.filter((x) => x !== k) : [...kpis, k])} />
                    {KPI_LABELS[k as keyof typeof KPI_LABELS] ?? k}
                  </label>
                );
              })}
            </div>
          </div>
          <fieldset data-testid="fin-customize-quick">
            <legend className="label">Quick actions</legend>
            {!quick.ready ? (
              <p className="text-sm text-muted">Choosing your own quick actions turns on after a short database update. For now they follow your trade setup.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">
                  {quick.from === "user" ? "You picked these." : quick.from === "company" ? "Your company picked these." : "These come from your trade setup."} Tick to add or remove, and use the arrows (or press and hold on the home page) to change the order.
                </p>
                {quickSel.length > 0 && (
                  <ol className="divide-y divide-line rounded-lg border border-line" aria-label="Quick actions in order">
                    {quickSel.map((k, i) => (
                      <li key={k} className="flex items-center gap-2 px-3 py-1 text-sm">
                        <span className="w-5 text-xs text-muted">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">{label(k)}</span>
                        <Button variant="ghost" size="sm" aria-label={`Move ${label(k)} earlier`} disabled={i === 0} onClick={() => moveQuick(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                        <Button variant="ghost" size="sm" aria-label={`Move ${label(k)} later`} disabled={i === quickSel.length - 1} onClick={() => moveQuick(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {quick.options.map((o) => {
                    const on = quickSel.includes(o.key);
                    return (
                      <label key={o.key} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm">
                        <input type="checkbox" checked={on} disabled={!on && quickSel.length >= 12} onChange={() => pickQuick(on ? quickSel.filter((x) => x !== o.key) : [...quickSel, o.key])} />
                        <span className="min-w-0">{o.label}{!o.built && <span className="text-xs text-muted"> · coming later</span>}</span>
                      </label>
                    );
                  })}
                </div>
                {quick.from !== "profile" && scope === "user" && (
                  <Button variant="ghost" size="sm" onClick={() => setQuickChoice(null)} disabled={quickChoice === null}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> {quickChoice === null ? "Will use the defaults when you save" : "Use the default quick actions"}
                  </Button>
                )}
              </div>
            )}
          </fieldset>
          <div>
            <p className="label">Cards</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {cards.map((c, i) => {
                const fixed = c.essential || (scope === "user" && c.locked);
                return (
                  <li key={c.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" checked={fixed || c.visible} disabled={fixed} onChange={() => setCards((cs) => cs.map((x) => (x.key === c.key ? { ...x, visible: !x.visible } : x)))} />
                      <span className="min-w-0 truncate">{c.title}</span>
                      {c.essential && <span className="text-xs text-muted">Always shown</span>}
                      {!c.essential && c.locked && scope === "user" && <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="h-3 w-3" aria-hidden /> Set by your company</span>}
                    </label>
                    {scope === "company" && !c.essential && (
                      <label className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-soft">
                        <input type="checkbox" checked={locks.includes(c.key)} onChange={() => setLocks(locks.includes(c.key) ? locks.filter((x) => x !== c.key) : [...locks, c.key])} /> Lock
                      </label>
                    )}
                    <span className="flex gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Move ${c.title} up`} disabled={i === 0 || fixed} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                      <Button variant="ghost" size="sm" aria-label={`Move ${c.title} down`} disabled={i === cards.length - 1 || fixed} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy} data-testid="fin-customize-save">{busy ? "Saving…" : "Save layout"}</Button>
            <Button variant="secondary" onClick={restore} disabled={busy}><RotateCcw className="h-4 w-4" aria-hidden /> Restore defaults</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Contractor Mode (default) / Accountant Mode. Offered only to people authorized for accounting work. */
export function ModeToggle({ mode }: { mode: "contractor" | "accountant" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const set = async (m: "contractor" | "accountant") => {
    if (m === mode) return;
    setBusy(true);
    const r = await finAction({ action: "set_mode", mode: m });
    setBusy(false);
    if (r.ok) router.refresh();
  };
  return (
    <div role="group" aria-label="View mode" className="inline-flex rounded-lg border border-line bg-surface p-0.5" data-testid="fin-mode" data-guide="fin.mode">
      {(["contractor", "accountant"] as const).map((m) => (
        <button key={m} type="button" disabled={busy} aria-pressed={mode === m} onClick={() => set(m)}
          className={`min-h-10 rounded-md px-3 text-sm font-semibold ${mode === m ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}>
          {m === "contractor" ? "Contractor Mode" : "Accountant Mode"}
        </button>
      ))}
    </div>
  );
}
