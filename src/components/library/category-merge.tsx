"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { categoryDuplicates, childCategory, type CategoryDupGroup } from "@/lib/library/categories";
import { typeLabel, type SavedItem } from "@/lib/library/saved-items";
import { tradeName } from "@/lib/trades/catalog";
import type { LibraryResult } from "../builder/library";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";

/**
 * "Similar categories" notice on the Saved Items page: finds spellings like Labor / Labour / labor in the same
 * trade and merges them into one with a tap (each affected item is re-saved with the chosen spelling).
 */
export function CategoryMerge({ items, onUpdate, onDone }: {
  items: SavedItem[];
  onUpdate: (s: SavedItem) => Promise<LibraryResult>;
  onDone: (message: string) => void;
}) {
  const groups = categoryDuplicates(items, typeLabel);
  if (!groups.length) return null;
  return (
    <Card className="space-y-3 p-4 text-sm" data-testid="category-merge">
      <div>
        <p className="font-semibold text-ink">Similar categories found</p>
        <p className="text-ink-soft">Merge them so your items stay grouped together. Only the category name changes.</p>
      </div>
      <ul className="space-y-2">
        {groups.map((g) => <MergeRow key={`${g.trade ?? ""}:${g.costType}:${g.names.map((n) => n.name).join("|")}`} group={g} items={items} onUpdate={onUpdate} onDone={onDone} />)}
      </ul>
    </Card>
  );
}

function MergeRow({ group, items, onUpdate, onDone }: {
  group: CategoryDupGroup;
  items: SavedItem[];
  onUpdate: (s: SavedItem) => Promise<LibraryResult>;
  onDone: (message: string) => void;
}) {
  const [target, setTarget] = useState(group.target);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = group.names.map((n) => n.name);

  async function merge() {
    setBusy(true); setErr(null);
    const label = typeLabel(group.costType);
    const moving = items.filter((i) => (i.trade ?? null) === group.trade && i.costType === group.costType && names.includes(childCategory(i.category, label)) && i.category !== target);
    let failed = 0;
    for (const i of moving) { const r = await onUpdate({ ...i, category: target }); if (!r.ok) failed++; }
    setBusy(false);
    if (failed) setErr(`${failed} of ${moving.length} items could not be updated. Try again.`);
    else onDone(`Merged into “${target}” (${moving.length} item${moving.length === 1 ? "" : "s"} updated).`);
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
      <span className="min-w-0 basis-full sm:basis-auto sm:flex-1"><span className="text-muted">{group.trade ? tradeName(group.trade) : "General"} · {typeLabel(group.costType)}:</span> {group.names.map((n) => `${n.name} (${n.count})`).join(", ")}</span>
      <label className="sr-only" htmlFor={`merge-${group.trade ?? "general"}-${group.costType}-${group.target}`}>Merge into</label>
      <select id={`merge-${group.trade ?? "general"}-${group.costType}-${group.target}`} className="field w-auto" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <Button size="sm" variant="secondary" onClick={merge} disabled={busy} data-testid="category-merge-btn">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Merge into {target}</Button>
      {err && <p role="alert" className="w-full text-xs text-danger">{err}</p>}
    </li>
  );
}
