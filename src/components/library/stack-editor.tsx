"use client";
import { ArrowDown, ArrowUp, Loader2, Plus, Search, X } from "lucide-react";
import { useId, useState } from "react";
import { UNIT_ABBR, tradeName, trades } from "@/lib/trades/catalog";
import { byUse, matchesQuery, stackDraftProblems, stackRowFromSaved, type SavedItem, type SavedStack, type StackItem, type StackScale } from "@/lib/library/saved-items";
import type { LibraryResult } from "../builder/library";
import { Button } from "../ui/button";
import { ScaleFields } from "./scale-stack";
import { rateLabel } from "./rate-label";

const abbr = (u: string) => UNIT_ABBR[u] ?? u;

/** The trade most of the rows are filed under (a new stack's starting trade). */
function commonTrade(rows: Pick<SavedItem, "trade">[]): string | null {
  const n = new Map<string, number>();
  for (const r of rows) if (r.trade) n.set(r.trade, (n.get(r.trade) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Build or edit a Saved Stack on Saved Items & Pricing, without opening an estimate: pick saved items, set
 * each one's quantity, and optionally turn on scaling (amount per unit of a measurement, waste, round up).
 * For office staff who keep the item list but don't build bids. Rows are copies of the saved items.
 */
export function StackEditor({ initial, items, canShare, onSave, onCancel }: {
  initial?: SavedStack;
  items: SavedItem[];
  /** May save straight to the company as a template (company pricing permission). New stacks only. */
  canShare?: boolean;
  onSave: (stack: SavedStack) => Promise<LibraryResult>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [trade, setTrade] = useState<string | null>(initial?.trade ?? null);
  const [tradeTouched, setTradeTouched] = useState(Boolean(initial));
  const [rows, setRows] = useState<StackItem[]>(initial?.items.map((i) => ({ ...i, per: i.per ?? "", wastePct: i.wastePct ?? "", roundUp: Boolean(i.roundUp) })) ?? []);
  const [scale, setScale] = useState<StackScale | null>(initial?.scale ?? null);
  const [company, setCompany] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const problems = stackDraftProblems({ name, items: rows, scale });
  const u = scale ? abbr(scale.unit) : "";
  const matches = [...items].filter((i) => matchesQuery(i, q)).sort(byUse).slice(0, q.trim() ? 12 : 8);
  const inStack = new Set(rows.map((r) => r.name.trim().toLowerCase()));

  const setRow = (rid: string, patch: Partial<StackItem>) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, ...patch } : x)));
  const move = (k: number, by: -1 | 1) => setRows((r) => {
    const j = k + by;
    if (j < 0 || j >= r.length) return r;
    const next = [...r];
    [next[k], next[j]] = [next[j], next[k]];
    return next;
  });
  const add = (s: SavedItem) => {
    const next = [...rows, stackRowFromSaved(s)];
    setRows(next);
    if (!tradeTouched) setTrade(commonTrade(next));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setErr(null);
    const stack: SavedStack = {
      id: initial?.id ?? crypto.randomUUID(), name: name.trim(), trade, scale,
      company: initial ? initial.company : company, canEdit: true, starterKey: initial?.starterKey ?? null,
      items: rows.map((r) => ({
        ...r, quantity: r.quantity.trim() || "1",
        per: scale && r.per ? r.per : undefined, wastePct: scale && r.wastePct ? r.wastePct : undefined, roundUp: scale ? Boolean(r.roundUp) : undefined,
      })),
    };
    const r = await onSave(stack);
    setBusy(false);
    if (!r.ok) setErr(r.message);
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="stack-editor" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-name`}>Stack name</label>
          <input id={`${id}-name`} className="field" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bathroom demo package" autoFocus={!initial} data-testid="stack-name" />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-trade`}>Trade</label>
          <select id={`${id}-trade`} className="field" value={trade ?? ""} onChange={(e) => { setTrade(e.target.value || null); setTradeTouched(true); }}>
            <option value="">General</option>
            {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            {trade && !trades.some((t) => t.slug === trade) && <option value={trade}>{tradeName(trade)}</option>}
          </select>
        </div>
      </div>

      <ScaleFields value={scale} onChange={setScale} />

      <fieldset>
        <legend className="label">Items in this stack</legend>
        {!rows.length ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">Pick saved items below to add them.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line" data-testid="stack-editor-rows">
            {rows.map((r, k) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="stack-editor-row">
                <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-muted">{rateLabel(r)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input className="field field-sm w-20 tabular" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.id, { quantity: e.target.value.replace(/[,\s]/g, "") })}
                    aria-label={`${r.name} quantity`} placeholder="1" data-testid="stack-row-qty" />
                  <span className="text-xs text-muted">{abbr(r.unit)}{scale ? (r.per ? " (scaled)" : " fixed") : ""}</span>
                </span>
                {scale && (
                  <span className="flex flex-wrap items-center gap-1">
                    <input className="field field-sm w-24 tabular" inputMode="decimal" value={r.per ?? ""} onChange={(e) => setRow(r.id, { per: e.target.value.trim() })} aria-label={`${r.name} per ${u}`} placeholder="fixed" data-testid="stack-row-per" />
                    <span className="text-xs text-muted">per {u}</span>
                    <input className="field field-sm w-16 tabular" inputMode="decimal" value={r.wastePct ?? ""} onChange={(e) => setRow(r.id, { wastePct: e.target.value.trim() })} aria-label={`${r.name} waste percent`} placeholder="0" />
                    <span className="text-xs text-muted">% waste</span>
                    <label className="flex min-h-9 items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(r.roundUp)} onChange={(e) => setRow(r.id, { roundUp: e.target.checked })} />Round up</label>
                  </span>
                )}
                <span className="flex items-center">
                  <button type="button" onClick={() => move(k, -1)} disabled={k === 0} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted hover:text-ink disabled:opacity-30 md:min-h-9 md:min-w-9" aria-label={`Move ${r.name} up`}><ArrowUp className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => move(k, 1)} disabled={k === rows.length - 1} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted hover:text-ink disabled:opacity-30 md:min-h-9 md:min-w-9" aria-label={`Move ${r.name} down`}><ArrowDown className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-danger hover:bg-danger-tint md:min-h-9 md:min-w-9" aria-label={`Remove ${r.name} from the stack`} data-testid="stack-row-remove"><X className="h-4 w-4" aria-hidden /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {scale && rows.length > 0 && <p className="mt-1 text-xs text-muted">Amount per 1 {u} sets a row&apos;s quantity from the measurement. Leave it blank to keep the row&apos;s fixed quantity (a dumpster, a permit).</p>}
      </fieldset>

      <div className="rounded-lg border border-line bg-paper p-3">
        <label className="label" htmlFor={`${id}-pick`}>Add saved items</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id={`${id}-pick`} className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your saved items…" autoComplete="off" data-testid="stack-pick-search" />
        </div>
        {!items.length ? (
          <p className="mt-2 text-sm text-muted">You have no saved items yet. Add some with <b>New Saved Item</b> first.</p>
        ) : !matches.length ? (
          <p className="mt-2 text-sm text-muted">Nothing matches “{q}”.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface" aria-label="Saved items to add">
            {matches.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">{s.name}</span>
                  <span className="block text-xs text-muted">{[s.trade ? tradeName(s.trade) : "General", s.category].filter(Boolean).join(" · ")} · {rateLabel(s)}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => add(s)} aria-label={`Add ${s.name} to the stack`} data-testid="stack-pick-add">
                  <Plus className="h-4 w-4" aria-hidden />{inStack.has(s.name.trim().toLowerCase()) ? "Add again" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!initial && canShare && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} data-testid="stack-company-toggle" />
          Share with my company as a template
        </label>
      )}

      {tried && problems.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy} data-testid="stack-editor-save">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{initial ? "Save stack" : "Create stack"}
        </Button>
      </div>
    </form>
  );
}
